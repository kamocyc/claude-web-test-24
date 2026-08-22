/** Building the extra houses a village earns.
 *
 *  Growth is written as ordinary recorded edits rather than fed back into terrain
 *  generation. `World.edits` is the only persisted block store and `World.addChunk`
 *  replays it on load (`world.ts:59`), so a grown village survives being walked away from
 *  for free — no worker protocol change, no plan cache to invalidate across N workers, and
 *  no world that differs depending on when a chunk happened to be generated.
 *
 *  Applying is idempotent, which is what removes the need to track anything: a village
 *  that grew while its chunks were unloaded simply builds itself when the player returns. */

import { Block, type BlockId } from '../world/blocks';
import { CHUNK_SIZE, type Chunk } from '../world/chunk';
import type { World } from '../world/world';
import { planGrowth, planOutpost, type GrowthPlan, type Placement, type VillagerMarker } from '../world/generation/village';
import type { VillageRecord } from './villages';

/** What growth is allowed to build over. Anything else — a chest, a torch, a wall the
 *  player raised, the village's own original houses — is left where it is. The worst this
 *  can do is leave a hole in a new building; it can never eat somebody's work. */
const NATURAL: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.AIR,
  Block.GRASS,
  Block.DIRT,
  Block.SAND,
  Block.SNOW,
  Block.TALL_GRASS,
  Block.FLOWER_RED,
  Block.FLOWER_YELLOW,
  Block.DEAD_BUSH,
  Block.SUGAR_CANE,
  Block.CACTUS,
  Block.OAK_LEAVES,
  Block.BIRCH_LEAVES,
  Block.SPRUCE_LEAVES,
  Block.WATER,
]);

const cache = new Map<string, GrowthPlan>();

/** Deterministic and cached: the same village at the same stage always grows the same
 *  buildings, however many times it is asked. */
export function growthFor(
  seed: number,
  village: VillageRecord,
  stage: number,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): GrowthPlan {
  const key = `${village.id},${stage}`;
  let plan = cache.get(key);
  if (!plan) {
    // Every earlier stage's plots count as taken too. Without this a village that grew
    // twice would try to raise its second pair of houses through its first pair.
    const taken = [...occupied];
    for (let earlier = 1; earlier < stage; earlier++) {
      taken.push(...growthFor(seed, village, earlier, occupied).footprints);
    }
    plan = planGrowth(
      seed,
      { cellX: 0, cellZ: 0, x: village.x, z: village.z },
      village.baseY,
      village.variant,
      stage,
      taken,
    );
    cache.set(key, plan);
  }
  return plan;
}

/** The hamlet's own buildings. Cached on the same terms as growth, and just as
 *  deterministic: the same hamlet always builds the same two houses. */
export function outpostBuildings(seed: number, village: VillageRecord): GrowthPlan {
  const key = `${village.id},outpost`;
  let plan = cache.get(key);
  if (!plan) {
    plan = planOutpost(seed, { cellX: 0, cellZ: 0, x: village.x, z: village.z }, village.baseY, village.variant);
    cache.set(key, plan);
  }
  return plan;
}

export function clearGrowthCache(): void {
  cache.clear();
}

function inChunk(chunk: Chunk, p: { x: number; z: number }): boolean {
  return (
    p.x >= chunk.originX && p.x < chunk.originX + CHUNK_SIZE &&
    p.z >= chunk.originZ && p.z < chunk.originZ + CHUNK_SIZE
  );
}

/** Writes one placement, unless something worth keeping already stands there. */
function place(world: World, p: Placement): boolean {
  const current = world.getBlock(p.x, p.y, p.z);
  if (current === p.b) return false;
  if (!NATURAL.has(current)) return false;
  return world.setBlock(p.x, p.y, p.z, p.b);
}

export interface GrowthResult {
  /** Villagers whose houses now exist and who still need to be spawned. */
  villagers: VillagerMarker[];
  chests: { x: number; y: number; z: number; loot: string }[];
  changed: number;
}

/** Applies every stage this village has reached that falls inside one chunk. */
export function applyGrowth(
  world: World,
  seed: number,
  village: VillageRecord,
  chunk: Chunk,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): GrowthResult {
  const result: GrowthResult = { villagers: [], chests: [], changed: 0 };
  const plans: GrowthPlan[] = [];
  // A hamlet has no generated buildings at all, so its own two houses are what it is
  // made of; everything after that is the growth it earns like anywhere else.
  if (village.outpost) plans.push(outpostBuildings(seed, village));
  for (let stage = 1; stage <= village.stage; stage++) {
    plans.push(growthFor(seed, village, stage, occupied));
  }
  for (const plan of plans) {
    for (const p of plan.placements) {
      if (!inChunk(chunk, p)) continue;
      if (place(world, p)) result.changed++;
    }
    for (const v of plan.villagers) if (inChunk(chunk, v)) result.villagers.push(v);
    for (const c of plan.chests) if (inChunk(chunk, c)) result.chests.push(c);
  }
  return result;
}

/** Every villager a village owes, wherever their house happens to fall. Chunk by chunk
 *  would strand the ones whose house is in a chunk that arrives later — and whichever
 *  chunk came first would close the gate behind them. */
export function growthVillagers(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): VillagerMarker[] {
  const out: VillagerMarker[] = [];
  if (village.outpost) out.push(...outpostBuildings(seed, village).villagers);
  for (let stage = 1; stage <= village.stage; stage++) {
    out.push(...growthFor(seed, village, stage, occupied).villagers);
  }
  return out;
}

/** Every chunk key a village's growth could reach, so a stage-up can rebuild the ones
 *  that happen to be loaded right now. */
export function growthChunks(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): { cx: number; cz: number }[] {
  const seen = new Set<string>();
  const out: { cx: number; cz: number }[] = [];
  const plans: GrowthPlan[] = [];
  if (village.outpost) plans.push(outpostBuildings(seed, village));
  for (let stage = 1; stage <= village.stage; stage++) {
    plans.push(growthFor(seed, village, stage, occupied));
  }
  for (const plan of plans) {
    for (const p of plan.placements) {
      const cx = Math.floor(p.x / CHUNK_SIZE);
      const cz = Math.floor(p.z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cx, cz });
    }
  }
  return out;
}
