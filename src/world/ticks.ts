import type { Rng } from '../core/rng';
import { Block, cropAt, isFarmland } from './blocks';
import { WATER_FULL } from './water';
import { CHUNK_HEIGHT, CHUNK_SIZE, type Chunk } from './chunk';
import type { World } from './world';

/** Seconds between random tick rounds. */
export const TICK_INTERVAL = 0.4;
/** Random positions sampled per chunk per round. */
const SAMPLES_PER_CHUNK = 3;
/** How far a farmland block looks for water. */
const WATER_RANGE = 4;
/** Fill level a cell needs before it counts as a water source for irrigation. */
const IRRIGATION_MIN = WATER_FULL * 0.25;

/** Slow, ambient world changes: crops ripening, grass spreading, farmland drying out. */
export function randomTickChunk(world: World, chunk: Chunk, rng: Rng): void {
  for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
    const lx = Math.floor(rng() * CHUNK_SIZE);
    const lz = Math.floor(rng() * CHUNK_SIZE);
    const top = chunk.heightAt(lx, lz);
    if (top < 0) continue;
    // Sample around the surface, where almost everything interesting happens.
    const y = Math.max(0, Math.min(CHUNK_HEIGHT - 1, top - Math.floor(rng() * 4)));
    const x = chunk.originX + lx;
    const z = chunk.originZ + lz;
    tickBlock(world, x, y, z, rng);
  }
}

function lightAt(world: World, x: number, y: number, z: number): number {
  return Math.max(world.getSkyLight(x, y, z), world.getBlockLight(x, y, z));
}

function tickBlock(world: World, x: number, y: number, z: number, rng: Rng): void {
  const id = world.getBlock(x, y, z);

  const crop = cropAt(id);
  if (crop) {
    if (crop.stage >= crop.stages - 1) return;
    if (!isFarmland(world.getBlock(x, y - 1, z))) {
      world.setBlock(x, y, z, Block.AIR);
      return;
    }
    if (lightAt(world, x, y, z) < 9) return;
    // Wet farmland roughly doubles the growth rate.
    const wet = world.getBlock(x, y - 1, z) === Block.FARMLAND_WET;
    if (rng() < (wet ? 0.35 : 0.16)) world.setBlock(x, y, z, id + 1);
    return;
  }

  if (isFarmland(id)) {
    const wet = hasWaterNearby(world, x, y, z);
    const target = wet ? Block.FARMLAND_WET : Block.FARMLAND;
    if (target !== id) world.setBlock(x, y, z, target);
    // Untended dry farmland slowly turns back into dirt.
    if (!wet && cropAt(world.getBlock(x, y + 1, z)) === null && rng() < 0.05) {
      world.setBlock(x, y, z, Block.DIRT);
    }
    return;
  }

  if (id === Block.GRASS) {
    const above = world.getBlock(x, y + 1, z);
    if (above !== Block.AIR && above !== Block.TALL_GRASS && lightAt(world, x, y + 1, z) < 4) {
      world.setBlock(x, y, z, Block.DIRT);
    }
    return;
  }

  if (id === Block.DIRT) {
    if (world.getBlock(x, y + 1, z) !== Block.AIR) return;
    if (lightAt(world, x, y + 1, z) < 9) return;
    // Spread from an adjacent grass block.
    const dx = Math.floor(rng() * 3) - 1;
    const dz = Math.floor(rng() * 3) - 1;
    const dy = Math.floor(rng() * 3) - 1;
    if (world.getBlock(x + dx, y + dy, z + dz) === Block.GRASS && rng() < 0.4) {
      world.setBlock(x, y, z, Block.GRASS);
    }
  }
}

/** Farmland is only wet while there is genuinely deep enough water within reach, so
 *  a channel that runs dry leaves the field parched. */
function hasWaterNearby(world: World, x: number, y: number, z: number): boolean {
  for (let dz = -WATER_RANGE; dz <= WATER_RANGE; dz++) {
    for (let dx = -WATER_RANGE; dx <= WATER_RANGE; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        if (world.getWater(x + dx, y + dy, z + dz) >= IRRIGATION_MIN) return true;
      }
    }
  }
  return false;
}
