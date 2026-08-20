import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { Block } from '../world/blocks';
import { Chunk } from '../world/chunk';
import { LightEngine } from '../world/lighting';
import { randomTickChunk } from '../world/ticks';
import { World } from '../world/world';

function farmWorld(): { world: World; chunk: Chunk } {
  const world = new World(1);
  const light = new LightEngine(world);
  world.onBlockChange((x, y, z, previous, next) => light.onBlockChanged(x, y, z, previous, next));
  const chunk = new Chunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y <= 10; y++) chunk.set(x, y, z, Block.STONE);
      chunk.set(x, 10, z, Block.FARMLAND_WET);
    }
  }
  world.addChunk(chunk);
  light.seedChunk(chunk);
  light.flush();
  return { world, chunk };
}

describe('random ticks', () => {
  it('ripens crops planted on wet farmland', () => {
    const { world, chunk } = farmWorld();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) world.setBlock(x, 11, z, Block.WHEAT_0);
    }
    chunk.recomputeHeightMap();
    const rng = mulberry32(7);
    for (let i = 0; i < 4000; i++) randomTickChunk(world, chunk, rng);
    let ripe = 0;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) if (world.getBlock(x, 11, z) === Block.WHEAT_3) ripe++;
    }
    expect(ripe).toBeGreaterThan(0);
  });

  it('never grows a crop past its last stage', () => {
    const { world, chunk } = farmWorld();
    world.setBlock(3, 11, 3, Block.WHEAT_3);
    chunk.recomputeHeightMap();
    const rng = mulberry32(3);
    for (let i = 0; i < 2000; i++) randomTickChunk(world, chunk, rng);
    expect(world.getBlock(3, 11, 3)).toBe(Block.WHEAT_3);
  });

  it('drops crops whose farmland was removed', () => {
    const { world, chunk } = farmWorld();
    world.setBlock(5, 11, 5, Block.CARROTS_1);
    world.setBlock(5, 10, 5, Block.STONE);
    chunk.recomputeHeightMap();
    const rng = mulberry32(9);
    for (let i = 0; i < 3000; i++) randomTickChunk(world, chunk, rng);
    expect(world.getBlock(5, 11, 5)).toBe(Block.AIR);
  });

  it('dries farmland that is far from water', () => {
    const world = new World(1);
    const chunk = new Chunk(0, 0);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y <= 10; y++) chunk.set(x, y, z, Block.STONE);
        chunk.set(x, 10, z, Block.FARMLAND_WET);
      }
    }
    world.addChunk(chunk);
    chunk.recomputeHeightMap();
    const rng = mulberry32(11);
    for (let i = 0; i < 2000; i++) randomTickChunk(world, chunk, rng);
    let dry = 0;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = world.getBlock(x, 10, z);
        if (id === Block.FARMLAND || id === Block.DIRT) dry++;
      }
    }
    expect(dry).toBeGreaterThan(0);
  });
});
