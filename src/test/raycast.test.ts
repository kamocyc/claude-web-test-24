import { describe, expect, it } from 'vitest';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import { Block } from '../world/blocks';
import { raycastVoxels } from '../world/raycast';

function emptyWorld(): World {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.addChunk(new Chunk(cx, cz));
  return world;
}

describe('raycastVoxels', () => {
  it('hits the first solid block along the ray and reports the entry face', () => {
    const world = emptyWorld();
    world.setBlock(5, 10, 0, Block.STONE);
    const hit = raycastVoxels(world, { x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, { maxDistance: 10 });
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([5, 10, 0]);
    expect([hit!.nx, hit!.ny, hit!.nz]).toEqual([-1, 0, 0]);
  });

  it('returns null when nothing is within range', () => {
    const world = emptyWorld();
    world.setBlock(9, 10, 0, Block.STONE);
    expect(raycastVoxels(world, { x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, { maxDistance: 5 })).toBeNull();
  });

  it('detects blocks below the camera and reports the top face', () => {
    const world = emptyWorld();
    world.setBlock(0, 4, 0, Block.GRASS);
    const hit = raycastVoxels(world, { x: 0.5, y: 8, z: 0.5 }, { x: 0, y: -1, z: 0 }, { maxDistance: 10 });
    expect(hit).not.toBeNull();
    expect(hit!.y).toBe(4);
    expect([hit!.nx, hit!.ny, hit!.nz]).toEqual([0, 1, 0]);
  });

  it('passes through water unless asked to hit liquids', () => {
    const world = emptyWorld();
    world.setBlock(2, 10, 0, Block.WATER);
    world.setBlock(4, 10, 0, Block.STONE);
    expect(raycastVoxels(world, { x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0, z: 0 })!.x).toBe(4);
    expect(
      raycastVoxels(world, { x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, { hitLiquids: true })!.x,
    ).toBe(2);
  });

  it('works with diagonal rays and negative coordinates', () => {
    const world = emptyWorld();
    world.setBlock(-3, 10, -3, Block.STONE);
    const hit = raycastVoxels(world, { x: 0.5, y: 10.5, z: 0.5 }, { x: -1, y: 0, z: -1 }, { maxDistance: 8 });
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.z]).toEqual([-3, -3]);
  });
});
