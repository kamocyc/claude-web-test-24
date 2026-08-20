import { describe, expect, it } from 'vitest';
import { RiverFlow } from '../world/riverFlow';
import { TerrainGenerator } from '../world/generation/terrain';
import { CHUNK_HEIGHT, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { Block } from '../world/blocks';
import { WATER_FULL } from '../world/water';
import { SEASON_LENGTH_SECONDS, travelDelay } from '../world/weather';
import { RIVER_DROUGHT, inlandOfSurface } from '../world/generation/rivers';

const SEED = 2061350291;
/** A column in the middle of the channel near the verification world's spawn. */
const RIVER_X = 6;
const RIVER_Z = -10;

function build(): { world: World; flow: RiverFlow; generator: TerrainGenerator } {
  const generator = new TerrainGenerator(SEED);
  const world = new World(SEED);
  const flow = new RiverFlow(world);
  for (let cz = -1; cz <= 0; cz++) {
    for (let cx = -1; cx <= 0; cx++) {
      const generated = generator.generateChunk(cx, cz);
      const chunk = new Chunk(cx, cz, generated.blocks, generated.water);
      chunk.riverSurface = generated.riverSurface;
      chunk.syncWaterMarkers();
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
      flow.registerChunk(chunk, generated.weatherSeconds);
    }
  }
  return { world, flow, generator };
}

/** Height of the water's top face in a column, or null when it is dry. */
function surfaceAt(world: World, x: number, z: number): number | null {
  for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
    const level = world.getWater(x, y, z);
    if (level > 0) return y + Math.min(1, level / WATER_FULL);
  }
  return null;
}

/** The moment a season of a kind is at its peak here, allowing for the trip downstream. */
function peakOf(index: number, inland: number): number {
  return (index + 0.5) * SEASON_LENGTH_SECONDS + travelDelay(inland);
}

describe('RiverFlow', () => {
  it('only takes on chunks that have a river in them', () => {
    const { flow } = build();
    expect(flow.trackedCount).toBeGreaterThan(0);
    expect(flow.trackedCount).toBeLessThanOrEqual(4);
  });

  it('drops the water through a drought and brings it back afterwards', () => {
    const { world, flow, generator } = build();
    const river = generator.riverAt(RIVER_X, RIVER_Z);
    expect(river.strength).toBeGreaterThan(0.5);
    const before = surfaceAt(world, RIVER_X, RIVER_Z);
    expect(before).not.toBeNull();

    // Season 3 is the drought.
    flow.seconds = peakOf(3, river.inland);
    flow.sweepAll();
    const low = surfaceAt(world, RIVER_X, RIVER_Z);
    expect(low).not.toBeNull();
    expect(low!).toBeLessThan(before! - 0.9);
    expect(low!).toBeGreaterThan(before! - RIVER_DROUGHT - 0.01);

    // Season 1 is the rain.
    flow.seconds = peakOf(1, river.inland);
    flow.sweepAll();
    const high = surfaceAt(world, RIVER_X, RIVER_Z);
    expect(high!).toBeGreaterThan(before! + 0.4);

    // Back to a calm season and the river is exactly as generated again.
    flow.seconds = peakOf(4, river.inland);
    flow.sweepAll();
    expect(surfaceAt(world, RIVER_X, RIVER_Z)).toBe(before);
  });

  it('keeps every water cell inside a water block', () => {
    const { world, flow, generator } = build();
    const inland = inlandOfSurface(generator.riverAt(RIVER_X, RIVER_Z).surface);
    for (const index of [1, 3, 5]) {
      flow.seconds = peakOf(index, inland);
      flow.sweepAll();
      for (let x = -8; x < 8; x++) {
        for (let z = -18; z < -2; z++) {
          for (let y = 40; y < 70; y++) {
            const level = world.getWater(x, y, z);
            const block = world.getBlock(x, y, z);
            if (level > 0) expect(block).toBe(Block.WATER);
            else expect(block).not.toBe(Block.WATER);
          }
        }
      }
    }
  });

  it('never drains water the player has impounded', () => {
    const { world, flow, generator } = build();
    const river = generator.riverAt(RIVER_X, RIVER_Z);
    const before = surfaceAt(world, RIVER_X, RIVER_Z)!;

    // A dam across the channel with a reservoir standing behind it.
    const dam = Math.floor(before) + 1;
    for (let z = RIVER_Z - 1; z <= RIVER_Z + 1; z++) {
      for (let y = 46; y <= dam; y++) world.setBlock(RIVER_X, y, z, Block.COBBLESTONE);
      for (let y = 46; y <= dam; y++) world.setWater(RIVER_X - 3, y, z, WATER_FULL);
    }
    const neighbour = surfaceAt(world, RIVER_X + 2, RIVER_Z)!;

    flow.seconds = peakOf(3, river.inland);
    flow.sweepAll();

    // The dam is still standing and the water behind it is still there, even though
    // the season says the river should be a good block lower.
    for (let y = 46; y <= dam; y++) {
      expect(world.getBlock(RIVER_X, y, RIVER_Z)).toBe(Block.COBBLESTONE);
      expect(world.getWater(RIVER_X - 3, y, RIVER_Z)).toBe(WATER_FULL);
    }
    // Downstream of it the river follows the season as usual.
    expect(surfaceAt(world, RIVER_X + 2, RIVER_Z)!).toBeLessThan(neighbour - 0.9);
  });

  it('does not refill a channel the player has emptied', () => {
    const { world, flow, generator } = build();
    const river = generator.riverAt(RIVER_X, RIVER_Z);
    for (let y = 40; y < 60; y++) world.setWater(RIVER_X, y, RIVER_Z, 0);
    expect(surfaceAt(world, RIVER_X, RIVER_Z)).toBeNull();

    // Even a flood leaves a column that no longer holds what was written into it.
    flow.seconds = peakOf(1, river.inland);
    flow.sweepAll();
    expect(surfaceAt(world, RIVER_X, RIVER_Z)).toBeNull();
    expect(surfaceAt(world, RIVER_X + 2, RIVER_Z)).not.toBeNull();
  });

  it('does the work a little at a time rather than all at once', () => {
    const { flow, generator } = build();
    const inland = inlandOfSurface(generator.riverAt(RIVER_X, RIVER_Z).surface);
    flow.seconds = peakOf(3, inland);
    flow.rewritten = 0;
    // Well short of the sweep interval: nothing should happen yet.
    flow.update(0.1);
    expect(flow.rewritten).toBe(0);
    flow.update(0.5);
    expect(flow.rewritten).toBeGreaterThan(0);
  });

  it('ignores a level change too small to see', () => {
    const { flow, generator } = build();
    const inland = inlandOfSurface(generator.riverAt(RIVER_X, RIVER_Z).surface);
    flow.seconds = peakOf(3, inland);
    flow.sweepAll();
    flow.rewritten = 0;
    // A fifth of a second later the surface has moved by a fraction of a millimetre.
    flow.seconds += 0.2;
    flow.update(1);
    expect(flow.rewritten).toBe(0);
  });
});
