/** Villages as an economy rather than as scenery.
 *
 *  Villages themselves are still a pure function of the seed — this module never decides
 *  where one is, it only remembers what has happened to the ones the player has met.
 *  Nothing here imports three.js, so the whole thing runs under Vitest in Node.
 *
 *  Two ideas make a network worth planning rather than merely worth finishing. A village
 *  *wants* particular goods, so which pair you join is a decision and not just a chore.
 *  And a workshop village makes nothing at all until somebody feeds it, so the map grows
 *  a shape: raw village -> workshop -> the towns that want what it makes. */

import { hashInts, mulberry32 } from '../core/rng';
import type { VillageVariant } from '../world/generation/village';
import { VILLAGE_RADIUS } from '../world/generation/village';

export type VillageId = string;
/** An ordinary item id. Villages trade in the goods the game already has, so stock,
 *  inventories, trades and the texture atlas all work without a parallel item set. */
export type GoodId = string;

/** Where a village's output comes from. A workshop is the interesting one: it converts,
 *  so it is worth nothing until a road reaches it. */
export type VillageKind = 'farm' | 'mine' | 'workshop';

/** Deliveries banked to reach each next stage. Later stages cost more, so a town is a
 *  long-running goal rather than an afternoon's work. */
export const STAGE_POINTS: readonly number[] = [8, 16, 26, 40];
export const MAX_STAGE = STAGE_POINTS.length;
/** Ranks a village passes through, indexed by stage. Shown instead of a bare number, so
 *  growth reads as somewhere becoming a town. */
export const RANKS: readonly string[] = ['集落', '村', '大きな村', '町', '都市'];
/** Walking onto the plateau is what counts as finding a village. */
export const DISCOVER_RADIUS = VILLAGE_RADIUS;
/** Seconds per unit produced at stage 0, and the ceiling stock piles up to. */
export const PRODUCE_SECONDS = 6;
export const MAX_STOCK = 64;
/** Delivering something a village asked for is worth this many times a delivery it did
 *  not. Matching supply to demand is the whole game, so the gap is deliberately wide. */
export const NEEDED_POINTS = 3;
export const SPARE_POINTS = 1;

/** What the land itself yields. */
const RAW: Record<VillageVariant, readonly GoodId[]> = {
  plains: ['wheat', 'carrot', 'potato', 'wool', 'oak_log'],
  desert: ['sand', 'coal', 'gravel'],
  snowy: ['coal', 'iron_ore', 'wool', 'oak_log'],
};

/** One-step conversions. A workshop village sits on one of these and needs its input
 *  hauled in — which is what turns a pair of roads into a supply chain. */
const CRAFTS: readonly { input: GoodId; output: GoodId }[] = [
  { input: 'wheat', output: 'bread' },
  { input: 'sand', output: 'glass' },
  { input: 'sand', output: 'sandstone' },
  { input: 'oak_log', output: 'oak_planks' },
  { input: 'iron_ore', output: 'iron_ingot' },
  { input: 'potato', output: 'baked_potato' },
];

/** Goods a settled village consumes whatever it makes. Every one of them is either a
 *  workshop's output or something the land yields, so demand always has a supplier. */
const CONSUMED: readonly GoodId[] = [
  'bread', 'glass', 'iron_ingot', 'oak_planks', 'wool', 'coal', 'sandstone', 'baked_potato',
];

/** Roughly a third of villages convert rather than produce. */
const WORKSHOP_SHARE = 0.34;

const GOOD_STEMS: Record<string, string> = {
  wheat: '麦',
  carrot: '人参',
  potato: '芋',
  wool: '羊毛',
  oak_log: '樵',
  sand: '砂',
  gravel: '砂利',
  sandstone: '砂岩',
  glass: '硝子',
  coal: '炭',
  iron_ore: '鉄鉱',
  iron_ingot: '鍛冶',
  bread: 'パン',
  oak_planks: '製材',
  baked_potato: '芋焼き',
};

const NAME_PREFIXES = ['朝', '霧', '丘', '川', '風', '石', '緑', '陽'] as const;

export interface VillageSeed {
  x: number;
  z: number;
  baseY: number;
  variant: VillageVariant;
}

/** Whatever can list the villages near a point. `TerrainGenerator` implements it; tests
 *  hand in a literal. */
export interface VillageSource {
  villagesAround(x: number, z: number, cellRadius?: number): VillageSeed[];
}

export interface VillageRecord {
  id: VillageId;
  x: number;
  z: number;
  baseY: number;
  variant: VillageVariant;
  /** The stem of the name. The rank is appended for display, so a village that grows is
   *  called a town by everything that names it. */
  name: string;
  kind: VillageKind;
  produces: GoodId;
  /** What a workshop has to be fed. Null everywhere else. */
  input: GoodId | null;
  /** Goods hauled in and not yet converted. */
  inputStock: number;
  /** What this village is asking for, widening as it grows. Derived from the stage, so
   *  it is never stored. */
  needs: GoodId[];
  /** 0 is the village as generated. */
  stage: number;
  /** Goods delivered towards the next stage. */
  points: number;
  /** Produced goods waiting for a porter. */
  stock: number;
  /** Everything ever hauled in, for the ledger. */
  received: number;
  discovered: boolean;
  /** Highest stage whose extra villagers have been spawned. Kept per village rather than
   *  per chunk, because `populatedChunks` records "ever populated" forever and clearing it
   *  would spawn the original villagers a second time. */
  spawnedStage: number;
  /** Fractional carry so production does not depend on the frame rate. */
  progress: number;
}

export interface SavedVillage {
  id: string;
  produces: string;
  stage: number;
  points: number;
  stock: number;
  discovered: boolean;
  spawnedStage: number;
  /** Absent in saves written before workshops existed; such a village simply starts
   *  empty and fills up again from the next delivery. */
  inputStock?: number;
  received?: number;
}

export function villageId(x: number, z: number): VillageId {
  return `${x},${z}`;
}

/** What a village does with itself. Deterministic from the seed and the centre, so a
 *  village is the same trade however and whenever the player arrives. */
export function villageTrade(
  seed: number,
  x: number,
  z: number,
  variant: VillageVariant,
): { kind: VillageKind; produces: GoodId; input: GoodId | null } {
  const rng = mulberry32(hashInts(seed ^ 0x9d0d5, x, z));
  const roll = rng();
  const pool = RAW[variant] ?? RAW.plains;
  const raw = pool[Math.floor(rng() * pool.length)];
  const craft = CRAFTS[Math.floor(rng() * CRAFTS.length)];
  if (roll < WORKSHOP_SHARE) {
    return { kind: 'workshop', produces: craft.output, input: craft.input };
  }
  // Ore and stone come out of a mine, everything else off a field. Only the label
  // differs, but a snowy village calling itself a farm reads wrong.
  const kind: VillageKind = raw === 'coal' || raw === 'iron_ore' || raw === 'gravel' || raw === 'sand' ? 'mine' : 'farm';
  return { kind, produces: raw, input: null };
}

/** The goods a village is asking for right now. A workshop's input always comes first:
 *  it is not a preference, it is the thing that makes the place work at all. */
export function villageNeeds(
  seed: number,
  x: number,
  z: number,
  produces: GoodId,
  input: GoodId | null,
  stage: number,
): GoodId[] {
  const needs: GoodId[] = [];
  if (input) needs.push(input);
  const rng = mulberry32(hashInts(seed ^ 0x51ee3, x, z));
  const pool = CONSUMED.filter((good) => good !== produces && good !== input);
  // Shuffle once and take a prefix, so a village that grows keeps asking for what it
  // already asked for and merely adds to the list.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const wanted = 1 + Math.floor(stage / 2);
  for (let i = 0; i < wanted && i < pool.length; i++) needs.push(pool[i]);
  return needs;
}

export function villageName(seed: number, x: number, z: number, produces: GoodId): string {
  const rng = mulberry32(hashInts(seed ^ 0x4a3e1, x, z));
  const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  return `${prefix}の${GOOD_STEMS[produces] ?? produces}`;
}

/** Name plus rank. Growth is meant to be visible in the language too, so a place the
 *  player has supplied stops being called a village. */
export function displayName(village: Pick<VillageRecord, 'name' | 'stage'>): string {
  return `${village.name}の${RANKS[Math.min(village.stage, RANKS.length - 1)]}`;
}

export function rankLabel(stage: number): string {
  return RANKS[Math.max(0, Math.min(stage, RANKS.length - 1))];
}

export function kindLabel(kind: VillageKind): string {
  if (kind === 'workshop') return '工房';
  if (kind === 'mine') return '採掘';
  return '農産';
}

export function goodLabel(good: GoodId): string {
  return GOOD_STEMS[good] ?? good;
}

/** Points earned by handing a village `count` of a good. */
export function pointsFor(village: VillageRecord, good: GoodId, count: number): number {
  return count * (village.needs.includes(good) ? NEEDED_POINTS : SPARE_POINTS);
}

/** Seconds per unit at a given stage. A village that has been supplied works faster,
 *  which is what makes feeding one worth more than feeding two a little. */
export function produceSeconds(stage: number): number {
  return PRODUCE_SECONDS / (1 + 0.35 * stage);
}

/** Every village the player has been near, and what has happened to it. */
export class VillageRegistry {
  readonly byId = new Map<VillageId, VillageRecord>();
  /** Saved state for villages that have not been re-derived from the seed yet. The player
   *  may be nowhere near them, and they are only rebuilt on approach. */
  private readonly pending = new Map<string, SavedVillage>();

  constructor(
    private readonly seed: number,
    private readonly source: VillageSource,
  ) {}

  /** Registers every village near a point. Idempotent: an already known village keeps
   *  its stock, points and stage. */
  ensureNear(x: number, z: number, cellRadius = 2): VillageRecord[] {
    const found: VillageRecord[] = [];
    for (const seed of this.source.villagesAround(x, z, cellRadius)) {
      const id = villageId(seed.x, seed.z);
      let record = this.byId.get(id);
      if (!record) {
        const trade = villageTrade(this.seed, seed.x, seed.z, seed.variant);
        record = {
          id,
          x: seed.x,
          z: seed.z,
          baseY: seed.baseY,
          variant: seed.variant,
          name: villageName(this.seed, seed.x, seed.z, trade.produces),
          kind: trade.kind,
          produces: trade.produces,
          input: trade.input,
          inputStock: 0,
          needs: [],
          stage: 0,
          points: 0,
          stock: 0,
          received: 0,
          discovered: false,
          spawnedStage: 0,
          progress: 0,
        };
        this.byId.set(id, record);
        // A village named in the save is re-derived from the seed the first time the
        // player comes back near it; that is when its saved progress lands on it.
        this.applyPending(record);
        this.refreshNeeds(record);
      }
      found.push(record);
    }
    return found;
  }

  private refreshNeeds(record: VillageRecord): void {
    record.needs = villageNeeds(
      this.seed, record.x, record.z, record.produces, record.input, record.stage,
    );
  }

  get(id: VillageId): VillageRecord | undefined {
    return this.byId.get(id);
  }

  /** The village the given point stands in, if any. */
  at(x: number, z: number): VillageRecord | undefined {
    for (const record of this.byId.values()) {
      if (Math.hypot(record.x - x, record.z - z) <= DISCOVER_RADIUS) return record;
    }
    return undefined;
  }

  /** True only the first time, so the caller can announce it. */
  discover(id: VillageId): boolean {
    const record = this.byId.get(id);
    if (!record || record.discovered) return false;
    record.discovered = true;
    return true;
  }

  discovered(): VillageRecord[] {
    return [...this.byId.values()].filter((v) => v.discovered);
  }

  /** Only discovered villages produce, so an unexplored world costs nothing to run.
   *  A workshop consumes one unit of its input per unit it makes, and simply stops when
   *  the road feeding it stops. */
  produce(dt: number): void {
    for (const record of this.byId.values()) {
      if (!record.discovered || record.stock >= MAX_STOCK) continue;
      if (record.input !== null && record.inputStock <= 0) {
        // Nothing to work with. Hold the carry so a starved workshop does not bank time
        // and then empty a whole delivery in one frame.
        record.progress = 0;
        continue;
      }
      const seconds = produceSeconds(record.stage);
      record.progress += dt;
      while (record.progress >= seconds && record.stock < MAX_STOCK) {
        if (record.input !== null) {
          if (record.inputStock <= 0) break;
          record.inputStock -= 1;
        }
        record.progress -= seconds;
        record.stock += 1;
      }
    }
  }

  takeStock(id: VillageId, count: number): number {
    const record = this.byId.get(id);
    if (!record) return 0;
    const taken = Math.min(count, record.stock);
    record.stock -= taken;
    return taken;
  }

  returnStock(id: VillageId, count: number): void {
    const record = this.byId.get(id);
    if (record) record.stock = Math.min(MAX_STOCK, record.stock + count);
  }

  /** Hands a village a load of something. This is the one place a delivery is judged:
   *  what it is worth, whether it feeds a workshop, and whether it tips a stage. */
  deliver(id: VillageId, good: GoodId, count: number): {
    needed: boolean;
    points: number;
    stage: number | null;
  } {
    const record = this.byId.get(id);
    if (!record || count <= 0) return { needed: false, points: 0, stage: null };
    const needed = record.needs.includes(good);
    if (record.input === good) {
      record.inputStock = Math.min(MAX_STOCK, record.inputStock + count);
    }
    record.received += count;
    const points = pointsFor(record, good, count);
    return { needed, points, stage: this.addPoints(id, points) };
  }

  /** Banks points. Returns the new stage when it crossed a threshold, else null. */
  addPoints(id: VillageId, points: number): number | null {
    const record = this.byId.get(id);
    if (!record || points <= 0) return null;
    record.points += points;
    if (record.stage >= MAX_STAGE) return null;
    const threshold = STAGE_POINTS[record.stage];
    if (record.points < threshold) return null;
    record.points -= threshold;
    record.stage += 1;
    // A bigger place wants more than it used to, which is what keeps a finished route
    // from being finished forever.
    this.refreshNeeds(record);
    return record.stage;
  }

  /** Points still to bank before the next rank, and how far along it is. */
  progressToNext(record: VillageRecord): { points: number; needed: number; fraction: number } {
    if (record.stage >= MAX_STAGE) return { points: record.points, needed: 0, fraction: 1 };
    const needed = STAGE_POINTS[record.stage];
    return { points: record.points, needed, fraction: Math.min(1, record.points / needed) };
  }

  toJSON(): SavedVillage[] {
    const out: SavedVillage[] = [...this.byId.values()].map((v) => ({
      id: v.id,
      produces: v.produces,
      stage: v.stage,
      points: v.points,
      stock: v.stock,
      discovered: v.discovered,
      spawnedStage: v.spawnedStage,
      inputStock: v.inputStock,
      received: v.received,
    }));
    // A village the player has not been back to since loading is still only in `pending`.
    // Writing just the re-derived ones would quietly throw away everything earned
    // anywhere the player has not revisited this session.
    for (const [id, saved] of this.pending) {
      if (!this.byId.has(id)) out.push(saved);
    }
    return out;
  }

  /** Restores what the player earned. Position, variant, trade and name are re-derived
   *  from the seed by `ensureNear`, so only the mutable part is stored. */
  loadJSON(data: SavedVillage[] | undefined): void {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (typeof entry?.id !== 'string') continue;
      this.pending.set(entry.id, entry);
    }
    for (const record of this.byId.values()) {
      this.applyPending(record);
      this.refreshNeeds(record);
    }
  }

  private applyPending(record: VillageRecord): void {
    const saved = this.pending.get(record.id);
    if (!saved) return;
    this.pending.delete(record.id);
    record.stage = Math.max(0, Math.min(MAX_STAGE, saved.stage));
    record.points = saved.points;
    record.stock = saved.stock;
    record.discovered = saved.discovered;
    record.spawnedStage = saved.spawnedStage;
    record.inputStock = saved.inputStock ?? 0;
    record.received = saved.received ?? 0;
  }
}
