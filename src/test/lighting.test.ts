import { describe, expect, it } from 'vitest';
import { World } from '../world/world';
import { CHUNK_HEIGHT, Chunk } from '../world/chunk';
import { Block } from '../world/blocks';
import { LightEngine } from '../world/lighting';

function flatWorld(groundY = 20): { world: World; light: LightEngine } {
  const world = new World(1);
  const light = new LightEngine(world);
  world.onBlockChange((x, y, z, prev, next) => light.onBlockChanged(x, y, z, prev, next));
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y <= groundY; y++) chunk.set(x, y, z, Block.STONE);
        }
      }
      world.addChunk(chunk);
    }
  }
  for (const chunk of world.chunks.values()) light.seedChunk(chunk);
  light.flush();
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
