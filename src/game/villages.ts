/** Villages as an economy rather than as scenery.
 *
 *  Villages themselves are still a pure function of the seed — this module never decides
 *  where one is, it only remembers what has happened to the ones the player has met.
 *  Nothing here imports three.js, so the whole thing runs under Vitest in Node. */

import { hashInts, mulberry32 } from '../core/rng';
import type { VillageVariant } from '../world/generation/village';
import { VILLAGE_RADIUS } from '../world/generation/village';

export type VillageId = string;
/** An ordinary item id. Villages trade in the goods the game already has, so stock,
 *  inventories, trades and the texture atlas all work without a parallel item set. */
export type GoodId = string;

/** Deliveries banked before a village grows. */
export const STAGE_POINTS = 8;
/** The vertical slice ships one growth step; `planGrowth` already generalises. */
export const MAX_STAGE = 1;
/** Walking onto the plateau is what counts as finding a village. */
export const DISCOVER_RADIUS = VILLAGE_RADIUS;
/** Seconds per unit produced, and the ceiling stock piles up to. */
export const PRODUCE_SECONDS = 6;
export const MAX_STOCK = 64;

/** What a village makes. Only goods that already exist as items. */
const PRODUCTS: Record<VillageVariant, readonly GoodId[]> = {
  plains: ['wheat', 'carrot', 'potato', 'wool'],
  desert: ['sandstone', 'glass', 'coal'],
  snowy: ['coal', 'iron_ingot', 'wool'],
};

const GOOD_STEMS: Record<string, string> = {
  wheat: '麦',
  carrot: '人参',
  potato: '芋',
  wool: '羊毛',
  sandstone: '砂岩',
  glass: '硝子',
  coal: '炭',
  iron_ingot: '鉄',
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
  name: string;
  produces: GoodId;
  /** 0 is the village as generated. */
  stage: number;
  /** Goods delivered towards the next stage. */
  points: number;
  /** Produced goods waiting for a porter. */
  stock: number;
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
}

export function villageId(x: number, z: number): VillageId {
  return `${x},${z}`;
}

/** Deterministic from the seed and the centre, so a village makes the same thing however
 *  and whenever the player arrives. */
export function villageProduct(seed: number, x: number, z: number, variant: VillageVariant): GoodId {
  const pool = PRODUCTS[variant] ?? PRODUCTS.plains;
  const rng = mulberry32(hashInts(seed ^ 0x9d0d5, x, z));
  return pool[Math.floor(rng() * pool.length)];
}

export function villageName(seed: number, x: number, z: number, produces: GoodId): string {
  const rng = mulberry32(hashInts(seed ^ 0x4a3e1, x, z));
  const prefix = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  return `${prefix}の${GOOD_STEMS[produces] ?? produces}村`;
}

export function goodLabel(good: GoodId): string {
  return GOOD_STEMS[good] ?? good;
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
        const produces = villageProduct(this.seed, seed.x, seed.z, seed.variant);
        record = {
          id,
          x: seed.x,
          z: seed.z,
          baseY: seed.baseY,
          variant: seed.variant,
          name: villageName(this.seed, seed.x, seed.z, produces),
          produces,
          stage: 0,
          points: 0,
          stock: 0,
          discovered: false,
          spawnedStage: 0,
          progress: 0,
        };
        this.byId.set(id, record);
        // A village named in the save is re-derived from the seed the first time the
        // player comes back near it; that is when its saved progress lands on it.
        this.applyPending(record);
      }
      found.push(record);
    }
    return found;
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

  /** Only discovered villages produce, so an unexplored world costs nothing to run. */
  produce(dt: number): void {
    for (const record of this.byId.values()) {
      if (!record.discovered || record.stock >= MAX_STOCK) continue;
      record.progress += dt;
      while (record.progress >= PRODUCE_SECONDS && record.stock < MAX_STOCK) {
        record.progress -= PRODUCE_SECONDS;
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

  /** Banks a delivery. Returns the new stage when it crossed a threshold, else null. */
  addPoints(id: VillageId, points: number): number | null {
    const record = this.byId.get(id);
    if (!record || points <= 0) return null;
    if (record.stage >= MAX_STAGE) {
      record.points += points;
      return null;
    }
    record.points += points;
    if (record.points < STAGE_POINTS) return null;
    record.points -= STAGE_POINTS;
    record.stage += 1;
    return record.stage;
  }

  toJSON(): SavedVillage[] {
    const out = [...this.byId.values()].map((v) => ({
      id: v.id,
      produces: v.produces,
      stage: v.stage,
      points: v.points,
      stock: v.stock,
      discovered: v.discovered,
      spawnedStage: v.spawnedStage,
    }));
    // A village the player has not been back to since loading is still only in `pending`.
    // Writing just the re-derived ones would quietly throw away everything earned
    // anywhere the player has not revisited this session.
    for (const [id, saved] of this.pending) {
      if (!this.byId.has(id)) out.push(saved);
    }
    return out;
  }

  /** Restores what the player earned. Position, variant and name are re-derived from the
   *  seed by `ensureNear`, so only the mutable part is stored. */
  loadJSON(data: SavedVillage[] | undefined): void {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (typeof entry?.id !== 'string') continue;
      this.pending.set(entry.id, entry);
    }
    for (const record of this.byId.values()) this.applyPending(record);
  }

  private applyPending(record: VillageRecord): void {
    const saved = this.pending.get(record.id);
    if (!saved) return;
    this.pending.delete(record.id);
    record.stage = saved.stage;
    record.points = saved.points;
    record.stock = saved.stock;
    record.discovered = saved.discovered;
    record.spawnedStage = saved.spawnedStage;
  }
}
