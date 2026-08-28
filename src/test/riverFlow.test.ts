import { describe, expect, it } from 'vitest';
import { RiverFlow } from '../world/riverFlow';
import { type ChunkGenResult, TerrainGenerator } from '../world/generation/terrain';
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

/** The four chunks `build` lays out, which are a pure function of the seed and a clock
 *  it never moves. Generating them nine times over was most of this file's runtime. */
let generated: ChunkGenResult[] | null = null;

function build(): { world: World; flow: RiverFlow; generator: TerrainGenerator } {
  const generator = new TerrainGenerator(SEED);
  const world = new World(SEED);
  const flow = new RiverFlow(world);
  if (!generated) {
    generated = [];
    for (let cz = -1; cz <= 0; cz++) {
      for (let cx = -1; cx <= 0; cx++) generated.push(generator.generateChunk(cx, cz));
    }
  }
  let i = 0;
  for (let cz = -1; cz <= 0; cz++) {
    for (let cx = -1; cx <= 0; cx++) {
      // Copies, always: the chunk takes ownership of what it is handed and `RiverFlow`
      // writes through it, so what is cached must never leave the cache.
      const g = generated[i++];
      const chunk = new Chunk(cx, cz, g.blocks.slice(), g.water.slice());
      chunk.riverSurface = g.riverSurface.slice();
      chunk.syncWaterMarkers();
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
      flow.registerChunk(chunk, g.weatherSeconds);
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
    let checked = 0;
    let mismatched = 0;
    let first = '';
    for (const index of [1, 3, 5]) {
      flow.seconds = peakOf(index, inland);
      flow.sweepAll();
      for (let x = -8; x < 8; x++) {
        for (let z = -18; z < -2; z++) {
          for (let y = 40; y < 70; y++) {
            const level = world.getWater(x, y, z);
            const block = world.getBlock(x, y, z);
            checked++;
            // Counted rather than asserted per cell: forty thousand expect() calls cost
            // far more than the sweep that produces them. Only the first mismatch is
            // formatted, so the message work stays out of the loop too.
            if (level > 0 === (block === Block.WATER)) continue;
            mismatched++;
            first ||=
              level > 0
                ? `season ${index}: (${x}, ${y}, ${z}) holds water ${level} in block ${block}`
                : `season ${index}: (${x}, ${y}, ${z}) is a WATER block with no water in it`;
          }
        }
      }
    }
    // The bounds are constants, so the exact count is the strongest guard against a
    // sweep that has quietly stopped covering anything.
    expect(checked).toBe(3 * 16 * 16 * 30);
    expect(mismatched, first).toBe(0);
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

  it('picks a chunk back up where it left off after a trip out of range', () => {
    // A chunk the player has edited keeps its water while it is unloaded, so it comes
    // back holding the level of whatever season it left in. Registering it against the
    // clock of the moment it returns would make it disagree with itself for ever, and
    // it would sit out every season from then on.
    const { world, flow, generator } = build();
    const river = generator.riverAt(RIVER_X, RIVER_Z);
    const chunk = world.getChunk(0, -1)!;
    const before = surfaceAt(world, RIVER_X, RIVER_Z)!;
    // One block placed anywhere in the chunk is enough to make its water worth keeping.
    world.setBlock(RIVER_X + 6, 60, RIVER_Z, Block.COBBLESTONE, { record: true });

    flow.forgetChunk(chunk.key);
    world.removeChunk(0, -1);
    expect(world.waterSnapshots.has(chunk.key)).toBe(true);

    // It comes back mid drought: generated at today's level, then overwritten by the
    // water it was carrying when it left.
    flow.seconds = peakOf(3, river.inland);
    generator.weatherSeconds = flow.seconds;
    const regenerated = generator.generateChunk(0, -1);
    const reloaded = new Chunk(0, -1, regenerated.blocks, regenerated.water);
    reloaded.riverSurface = regenerated.riverSurface;
    reloaded.syncWaterMarkers();
    world.addChunk(reloaded);
    flow.registerChunk(reloaded, regenerated.weatherSeconds);
    expect(surfaceAt(world, RIVER_X, RIVER_Z)).toBe(before);

    flow.sweepAll();
    expect(surfaceAt(world, RIVER_X, RIVER_Z)!).toBeLessThan(before - 0.9);
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
