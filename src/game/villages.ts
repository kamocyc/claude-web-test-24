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
/** A hamlet is smaller, and stands close enough to its parent that sharing the parent's
 *  radius would have the two of them claiming the same ground. */
export const OUTPOST_DISCOVER_RADIUS = 16;

/** How close the player has to be for this to be the place they are standing in. */
export function radiusOf(record: { outpost?: boolean }): number {
  return record.outpost ? OUTPOST_DISCOVER_RADIUS : DISCOVER_RADIUS;
}
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
  /** A tutorial hamlet rather than a village off the grid. It behaves like a village in
   *  every way the rest of the game cares about; it is only smaller, closer, and stored
   *  in full because nothing can re-derive it. */
  outpost?: boolean;
  parent?: VillageId;
  /** The building goods leave from and arrive at. Absent until the player chooses one,
   *  and then the nearest building to the centre is used. */
  depot?: string;
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
  /** A tutorial hamlet is not on the village grid, so unlike every other village it
   *  cannot be re-derived and its whole description is stored alongside its progress. */
  outpost?: boolean;
  parent?: string;
  /** Which building the player picked as the 集荷所, when they picked one. */
  depot?: string;
  x?: number;
  z?: number;
  baseY?: number;
  variant?: string;
  name?: string;
}

const VARIANTS: readonly VillageVariant[] = ['plains', 'desert', 'snowy'];

/** Rebuilds a hamlet from what was stored, or nothing when the entry is missing a piece
 *  of the description a hamlet cannot do without. */
export function outpostFromSave(entry: SavedVillage): VillageRecord | null {
  if (typeof entry.x !== 'number' || typeof entry.z !== 'number' || typeof entry.baseY !== 'number') {
    return null;
  }
  const variant = VARIANTS.find((v) => v === entry.variant) ?? 'plains';
  return {
    id: entry.id,
    x: entry.x,
    z: entry.z,
    baseY: entry.baseY,
    variant,
    name: entry.name ?? '出張所',
    kind: 'farm',
    produces: entry.produces,
    input: null,
    inputStock: entry.inputStock ?? 0,
    needs: [],
    stage: entry.stage,
    points: entry.points,
    stock: entry.stock,
    received: entry.received ?? 0,
    discovered: entry.discovered,
    spawnedStage: entry.spawnedStage,
    progress: 0,
    outpost: true,
    parent: entry.parent,
    depot: entry.depot,
  };
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

  /** The village the given point stands in, if any. The nearest one, because a hamlet
   *  stands close enough to its parent for both to claim the ground between them. */
  at(x: number, z: number): VillageRecord | undefined {
    let best: VillageRecord | undefined;
    let bestDistance = Infinity;
    for (const record of this.byId.values()) {
      const distance = Math.hypot(record.x - x, record.z - z);
      if (distance > radiusOf(record) || distance >= bestDistance) continue;
      best = record;
      bestDistance = distance;
    }
    return best;
  }

  /** Takes in a village nothing can re-derive — today that means a tutorial hamlet. Any
   *  saved progress waiting under its id lands on it, exactly as for a grid village. */
  adopt(record: VillageRecord): VillageRecord {
    const existing = this.byId.get(record.id);
    if (existing) return existing;
    this.byId.set(record.id, record);
    this.applyPending(record);
    this.refreshNeeds(record);
    return record;
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
      ...(v.depot ? { depot: v.depot } : {}),
      // A hamlet is not on the grid, so nothing can work out where it was or what it was
      // called. It is the one village whose description travels with its progress.
      ...(v.outpost
        ? { outpost: true, parent: v.parent, x: v.x, z: v.z, baseY: v.baseY, variant: v.variant, name: v.name }
        : {}),
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
    // A hamlet is rebuilt here rather than waiting for the player to walk back into it:
    // `ensureNear` re-derives villages from the grid, and a hamlet is not on it.
    for (const entry of data) {
      if (!entry?.outpost || this.byId.has(entry.id)) continue;
      const record = outpostFromSave(entry);
      if (record) this.adopt(record);
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
    if (saved.depot) record.depot = saved.depot;
  }
}
