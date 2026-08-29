/** Towns as an economy rather than as scenery.
 *
 *  Towns themselves are still a pure function of the seed — this module never decides
 *  where one is, it only remembers what has happened to the ones the player has met.
 *  Nothing here imports three.js, so the whole thing runs under Vitest in Node.
 *
 *  A town does exactly one thing with goods: it *converts* them. It has a works that turns
 *  raw material into something finished, and homes and shops that eat what other towns'
 *  works have finished. Nothing in a town comes out of the ground — the ground is the
 *  player's business now, and a primary industry is something they site themselves beside
 *  a deposit.
 *
 *  So the map has two stages in it and they are both the player's:
 *
 *      産業（原料）→ 町の工場（加工品）→ 別の町の住宅と商店（消費）
 *
 *  A town with no line to an industry makes nothing at all, and a town with no line from
 *  another town's works goes hungry. Which is the whole game: neither half happens by
 *  itself, and neither half is worth anything without the other. */

import { hashInts, mulberry32 } from '../core/rng';
import { fieldArea } from '../world/generation/fields';
import type { VillageVariant } from '../world/generation/village';
import { VILLAGE_RADIUS } from '../world/generation/village';

export type VillageId = string;
/** An ordinary item id. Villages trade in the goods the game already has, so stock,
 *  inventories, trades and the texture atlas all work without a parallel item set. */
export type GoodId = string;

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

/** What a town's works turns into what.
 *
 *  Some of them take two things, and that is the point of taking any: a glassworks wants
 *  sand *and* something to fire the furnace with, so serving one is two lines from two
 *  different deposits rather than one line done twice. A town on a single-input craft is
 *  the easy one to get started on; a smelter is the one worth planning for.
 *
 *  Every output is on `CONSUMED`, and every input is on `INDUSTRY_GOODS` in
 *  `industry.ts` — so every demand in the game has a supplier somewhere, and every
 *  industry the player can site has somebody who wants what it digs. */
export const CRAFTS: readonly { inputs: readonly GoodId[]; output: GoodId }[] = [
  { inputs: ['wheat'], output: 'bread' },
  { inputs: ['oak_log'], output: 'oak_planks' },
  { inputs: ['sand'], output: 'sandstone' },
  { inputs: ['oak_log', 'coal'], output: 'torch' },
  { inputs: ['sand', 'coal'], output: 'glass' },
  { inputs: ['iron_ore', 'coal'], output: 'iron_ingot' },
];

/** People, as something a route can carry.
 *
 *  Not an item: `items.ts` has never heard of it and nothing can hold one in a hand. It is
 *  a `GoodId` because that is the only vocabulary `transport.ts` has, and because
 *  everything a delivery goes through — the fare, the points, the ledger row — is exactly
 *  what a trainload of people should go through. Somebody who wanted to travel and got
 *  there is worth what a crate that was wanted is worth. */
export const PASSENGER: GoodId = 'passenger';
/** What to call them. `itemLabel` cannot answer, because this is the one good that is not
 *  an item — so anything naming a cargo has to ask this first. */
export const PASSENGER_LABEL = '人';

/** What a town grows for itself, out in the fields on its own outskirts.
 *
 *  The one raw material no line ever carries. Everything else the economy eats is dug or
 *  cut somewhere the player chose to put an industry; food is not, because a settlement
 *  that cannot feed itself is not a settlement. The crop lands in the town's own depot and
 *  is carried from there to the shops that sell it and the works that bakes with it —
 *  entirely inside the town, by the people who live in it.
 *
 *  So it is never on a `needs` list and never on the panel: asking the player for a good
 *  nothing on the map can supply is the worst thing an economy can do to them. */
export const FARMED: readonly GoodId[] = ['wheat'];

/** Seconds of ploughing per column of field per unit of crop.
 *
 *  Divided by the acreage, so the rate is a property of the fields rather than a number
 *  chosen for a town: a 集落 with three parcels harvests one every half minute, and a 都市
 *  with seven manages one every twelve seconds. Both are comfortably ahead of what their
 *  shops get through, which is the point — a town's own food is not meant to be a problem
 *  the player solves, it is meant to be the reason the town is there. */
export const FIELD_SECONDS = 45000;
/** What the depot holds before the fields stop cutting. A barn, not a warehouse. */
export const MAX_HARVEST = 24;
/** What a town's own works keeps of its own crop in hand. Small, so a mill town does not
 *  eat the whole harvest before a shop has seen any of it. */
export const HARVEST_LARDER = 8;

/** Goods a town consumes whatever it makes. Every one of them comes out of some town's
 *  works, so a demand is always something another part of the network could be built to
 *  meet. */
export const CONSUMED: readonly GoodId[] = [
  'bread', 'torch', 'oak_planks', 'sandstone', 'glass', 'iron_ingot',
];

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
  torch: '灯り',
  passenger: '人',
};

const NAME_PREFIXES = ['朝', '霧', '丘', '川', '風', '石', '緑', '陽'] as const;

/** The town inside a village, as the three questions the registry has of it.
 *
 *  Narrow and duck typed, the way `DepotSource` and `RailSource` are in `transport.ts`:
 *  `TownEconomy` satisfies it, a test satisfies it with an object literal, and a registry
 *  handed nothing at all behaves exactly as it did before towns existed. That last one is
 *  what keeps every村-level test in this repository honest. */
export interface TownLink {
  /** How many people are waiting to travel out of a town. */
  waitingAt(id: VillageId): number;
  /** Takes people off that queue. */
  takeWaiting(id: VillageId, count: number): number;
  /** Puts them back, when the trip they were on never happened. */
  returnWaiting(id: VillageId, count: number): void;
  /** Hands a delivery to the buildings that asked for it, and says how much landed. */
  deliver(id: VillageId, good: GoodId, count: number): number;
}

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
  produces: GoodId;
  /** What the works has to be fed. Empty only on a tutorial hamlet, which is the one
   *  place in the world that makes something out of nothing. */
  inputs: GoodId[];
  /** Raw material hauled in and not yet converted, per input. */
  inputStock: Map<GoodId, number>;
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
  /** Crop cut in the town's own fields and waiting at the depot to be carried into the
   *  town. Not saved: it refills in seconds, and a barn's worth of wheat is not what a
   *  world is made of. */
  harvest: number;
  harvestProgress: number;
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
  /** Raw material on hand, per input. */
  inputStock?: Record<string, number>;
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
    produces: entry.produces,
    inputs: [],
    inputStock: stockFromSave(entry.inputStock),
    needs: [],
    stage: entry.stage,
    points: entry.points,
    stock: entry.stock,
    received: entry.received ?? 0,
    discovered: entry.discovered,
    spawnedStage: entry.spawnedStage,
    progress: 0,
    harvest: 0,
    harvestProgress: 0,
    outpost: true,
    parent: entry.parent,
    depot: entry.depot,
  };
}

export function villageId(x: number, z: number): VillageId {
  return `${x},${z}`;
}

/** What a town's works converts. Deterministic from the seed and the centre, so a town is
 *  the same works however and whenever the player arrives. */
export function townCraft(seed: number, x: number, z: number): { produces: GoodId; inputs: GoodId[] } {
  const rng = mulberry32(hashInts(seed ^ 0x9d0d5, x, z));
  const craft = CRAFTS[Math.floor(rng() * CRAFTS.length)];
  return { produces: craft.output, inputs: [...craft.inputs] };
}

/** The goods a town is asking for right now. The works' raw material always comes first:
 *  it is not a preference, it is the thing that makes the place work at all. */
export function villageNeeds(
  seed: number,
  x: number,
  z: number,
  produces: GoodId,
  inputs: readonly GoodId[],
  stage: number,
): GoodId[] {
  // What the town grows for itself never goes on the list: its own fields supply it, and a
  // demand nothing on the map can meet is a demand that only wastes the player's walk.
  const needs: GoodId[] = inputs.filter((good) => !FARMED.includes(good));
  const rng = mulberry32(hashInts(seed ^ 0x51ee3, x, z));
  const pool = CONSUMED.filter((good) => good !== produces && !inputs.includes(good));
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
    /** The buildings inside these villages, when anything is modelling them. Null in every
     *  test that only cares about a village as a producer, and the whole of what makes
     *  this class behave as it always did in that case. */
    private readonly town: TownLink | null = null,
  ) {}

  /** Registers every village near a point. Idempotent: an already known village keeps
   *  its stock, points and stage. */
  ensureNear(x: number, z: number, cellRadius = 2): VillageRecord[] {
    const found: VillageRecord[] = [];
    for (const seed of this.source.villagesAround(x, z, cellRadius)) {
      const id = villageId(seed.x, seed.z);
      let record = this.byId.get(id);
      if (!record) {
        const craft = townCraft(this.seed, seed.x, seed.z);
        record = {
          id,
          x: seed.x,
          z: seed.z,
          baseY: seed.baseY,
          variant: seed.variant,
          name: villageName(this.seed, seed.x, seed.z, craft.produces),
          produces: craft.produces,
          inputs: craft.inputs,
          inputStock: new Map(),
          needs: [],
          stage: 0,
          points: 0,
          stock: 0,
          received: 0,
          discovered: false,
          spawnedStage: 0,
          progress: 0,
          harvest: 0,
          harvestProgress: 0,
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
      this.seed, record.x, record.z, record.produces, record.inputs, record.stage,
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

  /** Only discovered towns work, so an unexplored world costs nothing to run.
   *
   *  A works takes one of *each* of its inputs per unit it makes, and stops the moment any
   *  one of them runs out. That is what makes a two-input craft a different job from a
   *  one-input craft rather than the same job at half the rate: a glassworks with all the
   *  sand in the world and no coal is a glassworks standing still. */
  produce(dt: number): void {
    for (const record of this.byId.values()) {
      if (!record.discovered) continue;
      this.harvest(record, dt);
      if (record.stock >= MAX_STOCK) continue;
      if (!this.fed(record)) {
        // Nothing to work with. Hold the carry so a starved works does not bank time and
        // then empty a whole delivery in one frame.
        record.progress = 0;
        continue;
      }
      const seconds = produceSeconds(record.stage);
      record.progress += dt;
      while (record.progress >= seconds && record.stock < MAX_STOCK) {
        if (!this.fed(record)) break;
        for (const good of record.inputs) {
          record.inputStock.set(good, (record.inputStock.get(good) ?? 0) - 1);
        }
        record.progress -= seconds;
        record.stock += 1;
      }
    }
  }

  /** Cuts the crop in the town's own fields, and carries it in from the depot.
   *
   *  Two takers, in the order a cart leaving the depot would visit them: the works that
   *  bakes with it — it stands beside the square, and a bakery with no flour is the one
   *  thing in a town that stops outright — and then the shops that sell it. It keeps only
   *  a larder's worth back for the works, so a town with a mill does not eat its whole
   *  harvest before a shop has seen any of it.
   *
   *  A hamlet has no fields. It has no grid either, and four houses on a track do not farm
   *  a hundred acres. */
  private harvest(record: VillageRecord, dt: number): void {
    if (record.outpost) return;
    const area = fieldArea(record.stage);
    if (area <= 0) return;
    const seconds = FIELD_SECONDS / area;
    record.harvestProgress += dt;
    while (record.harvestProgress >= seconds && record.harvest < MAX_HARVEST) {
      record.harvestProgress -= seconds;
      record.harvest += 1;
    }
    // A full barn stops the reaping rather than banking it, exactly as a full works does.
    if (record.harvest >= MAX_HARVEST) record.harvestProgress = 0;
    for (const good of FARMED) {
      if (record.harvest <= 0) return;
      if (record.inputs.includes(good)) {
        const held = record.inputStock.get(good) ?? 0;
        const room = Math.min(record.harvest, HARVEST_LARDER - held);
        if (room > 0) {
          record.inputStock.set(good, held + room);
          record.harvest -= room;
        }
      }
      if (record.harvest <= 0) return;
      record.harvest -= this.town?.deliver(record.id, good, record.harvest) ?? 0;
    }
  }

  /** Whether a works has one of everything it needs. */
  private fed(record: VillageRecord): boolean {
    for (const good of record.inputs) {
      if ((record.inputStock.get(good) ?? 0) <= 0) return false;
    }
    return true;
  }

  /** How much of one raw material a town has on hand. */
  inputHeld(record: VillageRecord, good: GoodId): number {
    return record.inputStock.get(good) ?? 0;
  }

  /** The raw material a town's works has run out of, if any. What the panel says when a
   *  town is quiet with a line running into it. */
  starvedOf(record: VillageRecord): GoodId | null {
    for (const good of record.inputs) {
      if ((record.inputStock.get(good) ?? 0) <= 0) return good;
    }
    return null;
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

  /** People waiting to travel out of a village, as `takeStock` is for crates. Always zero
   *  where nothing is modelling the town, which is what keeps a road between two producers
   *  behaving exactly as it always has. */
  takePassengers(id: VillageId, count: number): number {
    return this.town?.takeWaiting(id, count) ?? 0;
  }

  returnPassengers(id: VillageId, count: number): void {
    this.town?.returnWaiting(id, count);
  }

  /** How many people are waiting to travel out of a village. */
  waiting(id: VillageId): number {
    return this.town?.waitingAt(id) ?? 0;
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
    if (record.inputs.includes(good)) {
      const held = record.inputStock.get(good) ?? 0;
      record.inputStock.set(good, Math.min(MAX_STOCK, held + count));
    }
    // The buildings take their share of a crate. People are the one delivery no building
    // stocks: somebody who has arrived has arrived, and what they are worth is the fare
    // and the points below.
    if (good !== PASSENGER) this.town?.deliver(id, good, count);
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
      inputStock: Object.fromEntries(v.inputStock),
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
    record.inputStock = stockFromSave(saved.inputStock);
    record.received = saved.received ?? 0;
    if (saved.depot) record.depot = saved.depot;
  }
}

/** Raw material on hand, back out of a save. Anything that is not a number is dropped:
 *  the town simply starts empty and fills up again from the next delivery. */
function stockFromSave(saved: Record<string, number> | undefined): Map<GoodId, number> {
  const out = new Map<GoodId, number>();
  for (const [good, held] of Object.entries(saved ?? {})) {
    if (typeof held === 'number' && Number.isFinite(held)) out.set(good, Math.max(0, held));
  }
  return out;
}
