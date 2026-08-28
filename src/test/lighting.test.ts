import { beforeAll, describe, expect, it } from 'vitest';
import { World } from '../world/world';
import { CHUNK_HEIGHT, Chunk, chunkKey } from '../world/chunk';
import { Block } from '../world/blocks';
import { LightEngine } from '../world/lighting';

const GROUND_Y = 20;

/** The settled blocks and light of one 3x3 flat world. Seeding the skylight is a flood
 *  fill over four hundred thousand cells, and every test in this file wanted the same
 *  answer out of it, so it is worked out once and copied. Each test still builds its own
 *  `World`, `LightEngine` and `Chunk`s, so nothing is shared between them at run time. */
const settled = new Map<string, { blocks: Uint16Array; light: Uint8Array }>();

beforeAll(() => {
  const world = new World(1);
  const light = new LightEngine(world);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y <= GROUND_Y; y++) chunk.set(x, y, z, Block.STONE);
        }
      }
      world.addChunk(chunk);
    }
  }
  for (const chunk of world.chunks.values()) light.seedChunk(chunk);
  light.flush();
  for (const chunk of world.chunks.values()) {
    settled.set(chunk.key, { blocks: chunk.blocks.slice(), light: chunk.light.slice() });
  }
});

function flatWorld(): { world: World; light: LightEngine } {
  const world = new World(1);
  const light = new LightEngine(world);
  world.onBlockChange((x, y, z, prev, next) => light.onBlockChanged(x, y, z, prev, next));
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new Chunk(cx, cz);
      // Looked up by key rather than by loop order: an array indexed by position is one
      // reordered loop away from handing a chunk somebody else's light.
      const cached = settled.get(chunkKey(cx, cz))!;
      chunk.blocks.set(cached.blocks);
      chunk.light.set(cached.light);
      chunk.lit = true;
      world.addChunk(chunk);
    }
  }
  // `flush` has already drained the queues that seeding filled, so a fresh engine with
  // empty queues is the same state the old per-test seed-and-flush left behind.
  return { world, light };
}

describe('LightEngine', () => {
  it('gives the open sky full skylight and leaves the ground dark', () => {
    const { world } = flatWorld();
    expect(world.getSkyLight(0, CHUNK_HEIGHT - 1, 0)).toBe(15);
    expect(world.getSkyLight(0, 21, 0)).toBe(15);
    expect(world.getSkyLight(0, 10, 0)).toBe(0);
  });

  it('spreads torch light with distance falloff', () => {
    const { world, light } = flatWorld();
    world.setBlock(0, 21, 0, Block.TORCH);
    light.flush();
    expect(world.getBlockLight(0, 21, 0)).toBe(14);
    expect(world.getBlockLight(2, 21, 0)).toBe(12);
    expect(world.getBlockLight(6, 21, 0)).toBe(8);
    expect(world.getBlockLight(15, 21, 0)).toBe(0);
  });

  it('removes light again when the torch is broken', () => {
    const { world, light } = flatWorld();
    world.setBlock(0, 21, 0, Block.TORCH);
    light.flush();
    world.setBlock(0, 21, 0, Block.AIR);
    light.flush();
    expect(world.getBlockLight(0, 21, 0)).toBe(0);
    expect(world.getBlockLight(3, 21, 0)).toBe(0);
  });

  it('darkens a covered space and re-lights it when reopened', () => {
    const { world, light } = flatWorld();
    // Dig a one block hole and roof it over.
    world.setBlock(0, 20, 0, Block.AIR);
    light.flush();
    expect(world.getSkyLight(0, 20, 0)).toBe(15);
    world.setBlock(0, 21, 0, Block.STONE);
    light.flush();
    expect(world.getSkyLight(0, 20, 0)).toBeLessThan(15);
    world.setBlock(0, 21, 0, Block.AIR);
    light.flush();
    expect(world.getSkyLight(0, 20, 0)).toBe(15);
  });

  it('carries skylight across a chunk border', () => {
    const { world } = flatWorld();
    expect(world.getSkyLight(-1, 21, -1)).toBe(15);
    expect(world.getSkyLight(16, 21, 16)).toBe(15);
  });
});
