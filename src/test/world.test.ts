import { describe, expect, it } from 'vitest';
import { World } from '../world/world';
import {
  Chunk,
  CHUNK_SIZE,
  WORLD_CHUNK_COUNT,
  WORLD_MAX,
  WORLD_MIN,
  WORLD_RADIUS_CHUNKS,
  isInsideWorld,
  toChunkCoord,
  toLocalCoord,
} from '../world/chunk';
import { Block } from '../world/blocks';

function worldWithChunks(range = 1): World {
  const world = new World(1);
  for (let cz = -range; cz <= range; cz++) {
    for (let cx = -range; cx <= range; cx++) world.addChunk(new Chunk(cx, cz));
  }
  return world;
}

describe('chunk coordinates', () => {
  it('maps negative world coordinates to the right chunk and local offset', () => {
    expect(toChunkCoord(-1)).toBe(-1);
    expect(toLocalCoord(-1)).toBe(CHUNK_SIZE - 1);
    expect(toChunkCoord(-16)).toBe(-1);
    expect(toLocalCoord(-16)).toBe(0);
    expect(toChunkCoord(17)).toBe(1);
    expect(toLocalCoord(17)).toBe(1);
  });
});

describe('World', () => {
  it('reads and writes across chunk borders', () => {
    const world = worldWithChunks();
    world.setBlock(-1, 10, -1, Block.STONE);
    world.setBlock(0, 10, 0, Block.DIRT);
    expect(world.getBlock(-1, 10, -1)).toBe(Block.STONE);
    expect(world.getBlock(0, 10, 0)).toBe(Block.DIRT);
    expect(world.getChunk(-1, -1)?.get(15, 10, 15)).toBe(Block.STONE);
  });

  it('reports air for unloaded chunks but treats them as solid for collision', () => {
    const world = new World(1);
    expect(world.getBlock(500, 10, 500)).toBe(Block.AIR);
    expect(world.isSolidAt(500, 10, 500)).toBe(true);
  });

  it('marks the neighbouring chunk dirty when a border block changes', () => {
    const world = worldWithChunks();
    world.dirtyChunks.clear();
    world.setBlock(0, 5, 0, Block.STONE);
    expect(world.dirtyChunks.has('0,0')).toBe(true);
    expect(world.dirtyChunks.has('-1,0')).toBe(true);
    expect(world.dirtyChunks.has('0,-1')).toBe(true);
    expect(world.dirtyChunks.has('1,0')).toBe(false);
  });

  it('records edits and replays them when the chunk is reloaded', () => {
    const world = worldWithChunks(0);
    world.setBlock(3, 20, 4, Block.GLASS);
    world.removeChunk(0, 0);
    world.addChunk(new Chunk(0, 0));
    expect(world.getBlock(3, 20, 4)).toBe(Block.GLASS);
  });

  it('does not record generation writes', () => {
    const world = worldWithChunks(0);
    world.setBlock(1, 1, 1, Block.STONE, { record: false });
    expect(world.edits.size).toBe(0);
  });

  it('keeps the height map up to date', () => {
    const world = worldWithChunks(0);
    world.setBlock(2, 30, 2, Block.STONE);
    world.setBlock(2, 40, 2, Block.STONE);
    expect(world.heightAt(2, 2)).toBe(40);
    world.setBlock(2, 40, 2, Block.AIR);
    expect(world.heightAt(2, 2)).toBe(30);
  });

  it('notifies listeners about changes', () => {
    const world = worldWithChunks(0);
    const seen: number[] = [];
    world.onBlockChange((_x, _y, _z, previous, next) => seen.push(previous, next));
    world.setBlock(0, 0, 0, Block.STONE);
    expect(seen).toEqual([Block.AIR, Block.STONE]);
  });
});

describe('world bounds', () => {
  it('covers exactly the blocks its chunks cover', () => {
    expect(isInsideWorld(-WORLD_RADIUS_CHUNKS, 0)).toBe(true);
    expect(isInsideWorld(WORLD_RADIUS_CHUNKS - 1, 0)).toBe(true);
    expect(isInsideWorld(-WORLD_RADIUS_CHUNKS - 1, 0)).toBe(false);
    expect(isInsideWorld(0, WORLD_RADIUS_CHUNKS)).toBe(false);
    // Every block between the limits belongs to a chunk that exists, and the ones just
    // outside them do not: the player is stopped exactly where the world ends.
    expect(isInsideWorld(toChunkCoord(WORLD_MIN), toChunkCoord(WORLD_MIN))).toBe(true);
    expect(isInsideWorld(toChunkCoord(WORLD_MAX), toChunkCoord(WORLD_MAX))).toBe(true);
    expect(isInsideWorld(toChunkCoord(WORLD_MIN - 1), 0)).toBe(false);
    expect(isInsideWorld(toChunkCoord(WORLD_MAX + 1), 0)).toBe(false);
    expect(WORLD_CHUNK_COUNT).toBe(((WORLD_MAX - WORLD_MIN + 1) / CHUNK_SIZE) ** 2);
  });
});
