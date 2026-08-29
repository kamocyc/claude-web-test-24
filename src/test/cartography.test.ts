import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { WATER_FULL } from '../world/water';
import { World } from '../world/world';
import { MapMemory, SurveyedTerrain } from '../game/cartography';

/** One chunk of ground with a puddle in the corner of it, at the given chunk coords. */
function ground(cx: number, cz: number, top = 20): Chunk {
  const chunk = new Chunk(cx, cz);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y <= top; y++) chunk.set(x, y, z, Block.STONE);
      chunk.set(x, top, z, Block.GRASS);
    }
  }
  chunk.set(0, top, 0, Block.WATER);
  chunk.setWater(0, top, 0, WATER_FULL);
  chunk.recomputeHeightMap();
  return chunk;
}

describe('MapMemory', () => {
  it('remembers the surface of a chunk after the world has thrown it away', () => {
    const world = new World(1);
    const memory = new MapMemory();
    const chunk = ground(0, 0);
    world.addChunk(chunk);
    memory.record(chunk);
    world.removeChunk(0, 0);

    expect(world.heightAt(4, 4)).toBe(-1);
    expect(memory.heightAt(4, 4)).toBe(20);
    expect(memory.blockAt(4, 20, 4)).toBe(Block.GRASS);
    expect(memory.waterAt(0, 20, 0)).toBe(WATER_FULL);
    expect(memory.has(0, 0)).toBe(true);
  });

  it('knows nothing about a chunk that has never been loaded', () => {
    const memory = new MapMemory();
    memory.record(ground(0, 0));
    expect(memory.has(9, 9)).toBe(false);
    expect(memory.heightAt(9 * CHUNK_SIZE, 9 * CHUNK_SIZE)).toBe(-1);
  });

  it('surveys negative chunks at the right columns', () => {
    const memory = new MapMemory();
    const chunk = ground(-1, -1, 30);
    chunk.set(15, 31, 15, Block.STONE);
    chunk.recomputeHeightMap();
    memory.record(chunk);
    expect(memory.heightAt(-1, -1)).toBe(31);
    expect(memory.heightAt(-16, -16)).toBe(30);
  });

  it('takes the newer survey of a chunk the player has changed', () => {
    const memory = new MapMemory();
    const chunk = ground(0, 0);
    memory.record(chunk);
    chunk.set(3, 21, 3, Block.OAK_PLANKS);
    chunk.recomputeHeightMap();
    memory.record(chunk);
    expect(memory.heightAt(3, 3)).toBe(21);
    expect(memory.blockAt(3, 21, 3)).toBe(Block.OAK_PLANKS);
  });

  it('survives a save and a load', () => {
    const memory = new MapMemory();
    memory.record(ground(0, 0));
    memory.record(ground(2, -3, 40));
    const saved = JSON.parse(JSON.stringify(memory.toJSON())) as Record<string, string>;

    const loaded = new MapMemory();
    loaded.load(saved);
    expect(loaded.size).toBe(2);
    expect(loaded.heightAt(4, 4)).toBe(20);
    expect(loaded.blockAt(4, 20, 4)).toBe(Block.GRASS);
    expect(loaded.waterAt(0, 20, 0)).toBe(WATER_FULL);
    expect(loaded.heightAt(2 * CHUNK_SIZE + 5, -3 * CHUNK_SIZE + 5)).toBe(40);
  });

  it('drops a tile it cannot read rather than throwing the world away', () => {
    const memory = new MapMemory();
    memory.record(ground(0, 0));
    const saved = memory.toJSON();
    const loaded = new MapMemory();
    loaded.load({ ...saved, '5,5': 'not a tile' });
    expect(loaded.size).toBe(1);
    expect(loaded.heightAt(4, 4)).toBe(20);
  });
});

describe('SurveyedTerrain', () => {
  it('prefers the world it can see to what it remembers', () => {
    const world = new World(1);
    const memory = new MapMemory();
    const chunk = ground(0, 0);
    world.addChunk(chunk);
    memory.record(chunk);
    const surface = new SurveyedTerrain(world, memory);

    world.setBlock(4, 21, 4, Block.OAK_PLANKS);
    expect(memory.heightAt(4, 4)).toBe(20);
    expect(surface.heightAt(4, 4)).toBe(21);
    expect(surface.blockAt(4, 21, 4)).toBe(Block.OAK_PLANKS);
  });

  it('falls back to the survey once the chunk is gone, and to nothing beyond it', () => {
    const world = new World(1);
    const memory = new MapMemory();
    const chunk = ground(0, 0);
    world.addChunk(chunk);
    memory.record(chunk);
    world.removeChunk(0, 0);
    const surface = new SurveyedTerrain(world, memory);

    expect(surface.heightAt(4, 4)).toBe(20);
    expect(surface.blockAt(4, 20, 4)).toBe(Block.GRASS);
    expect(surface.waterAt(0, 20, 0)).toBe(WATER_FULL);
    // Never been there: the map is told nothing rather than something plausible.
    expect(surface.heightAt(900, 900)).toBe(-1);
  });
});
