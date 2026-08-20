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
import { planGrowth, type GrowthPlan, type Placement, type VillagerMarker } from '../world/generation/village';
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
    plan = planGrowth(seed, { cellX: 0, cellZ: 0, x: village.x, z: village.z }, village.baseY, village.variant, stage, occupied);
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
  for (let stage = 1; stage <= village.stage; stage++) {
    const plan = growthFor(seed, village, stage, occupied);
    for (const p of plan.placements) {
      if (!inChunk(chunk, p)) continue;
      if (place(world, p)) result.changed++;
    }
    for (const v of plan.villagers) if (inChunk(chunk, v)) result.villagers.push(v);
    for (const c of plan.chests) if (inChunk(chunk, c)) result.chests.push(c);
  }
  return result;
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
  for (let stage = 1; stage <= village.stage; stage++) {
    for (const p of growthFor(seed, village, stage, occupied).placements) {
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
