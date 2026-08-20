import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { Block } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, SEA_LEVEL, blockIndex } from '../world/chunk';
import { World } from '../world/world';
import { blocksWater } from '../world/blocks';

describe('TerrainGenerator', () => {
  it('is deterministic for a given seed', () => {
    const a = new TerrainGenerator(1234).generateChunk(3, -7).blocks;
    const b = new TerrainGenerator(1234).generateChunk(3, -7).blocks;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different terrain for different seeds', () => {
    const a = new TerrainGenerator(1).generateChunk(0, 0).blocks;
    const b = new TerrainGenerator(2).generateChunk(0, 0).blocks;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('keeps the surface continuous across a chunk border', () => {
    const gen = new TerrainGenerator(99);
    for (let z = -20; z < 20; z++) {
      const left = gen.height(CHUNK_SIZE - 1, z);
      const right = gen.height(CHUNK_SIZE, z);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(6);
    }
  });

  it('caps the terrain inside the world height', () => {
    const gen = new TerrainGenerator(7);
    for (let i = 0; i < 200; i++) {
      const h = gen.height(i * 37, i * -53);
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThan(CHUNK_HEIGHT);
    }
  });

  it('always puts bedrock at the bottom and air at the top', () => {
    const { blocks } = new TerrainGenerator(42).generateChunk(0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(blocks[blockIndex(x, 0, z)]).toBe(Block.BEDROCK);
        expect(blocks[blockIndex(x, CHUNK_HEIGHT - 1, z)]).toBe(Block.AIR);
      }
    }
  });

  it('fills every column below sea level with water or solid ground', () => {
    const { blocks } = new TerrainGenerator(2024).generateChunk(-5, 11);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(blocks[blockIndex(x, SEA_LEVEL, z)]).not.toBe(Block.AIR);
      }
    }
  });

  it('generates ores underground', () => {
    const { blocks } = new TerrainGenerator(555).generateChunk(2, 2);
    const ores = new Set([Block.COAL_ORE, Block.IRON_ORE, Block.GOLD_ORE, Block.DIAMOND_ORE]);
    let found = 0;
    for (const id of blocks) if (ores.has(id as never)) found++;
    expect(found).toBeGreaterThan(0);
  });

  it('keeps the river bed below the water line all along the channel', () => {
    // The bed used to be eased down towards the floor in proportion to the channel
    // strength, which left it above the water wherever the land rose, and broke the
    // river into a string of disconnected pools. Every core column must hold water.
    const gen = new TerrainGenerator(2061350291);
    let core = 0;
    let dry = 0;
    for (let z = -450; z < 450; z += 6) {
      for (let x = -450; x < 450; x += 6) {
        const river = gen.riverAt(x, z);
        if (river.strength < 0.35) continue;
        const height = gen.height(x, z);
        if (height <= SEA_LEVEL) continue;
        core++;
        if (height >= river.surface) dry++;
      }
    }
    expect(core).toBeGreaterThan(50);
    expect(dry / core).toBeLessThan(0.05);
  });

  it('never leaves generated water standing over dry land', () => {
    // A river surface that sat above its own banks left a film of water on every
    // terrace of the slope, which looked like the river climbing the hillside. Water
    // may only ever spill one block down into the next pool, never sideways onto land.
    const gen = new TerrainGenerator(2061350291);
    const world = new World(2061350291);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const generated = gen.generateChunk(cx, cz);
        const chunk = new Chunk(cx, cz);
        chunk.blocks.set(generated.blocks);
        chunk.water.set(generated.water);
        chunk.syncWaterMarkers();
        world.addChunk(chunk);
      }
    }

    let surfaceCells = 0;
    let spills = 0;
    for (let z = -CHUNK_SIZE + 1; z < CHUNK_SIZE * 2 - 1; z++) {
      for (let x = -CHUNK_SIZE + 1; x < CHUNK_SIZE * 2 - 1; x++) {
        for (let y = 1; y < CHUNK_HEIGHT - 1; y++) {
          if (world.getWater(x, y, z) <= 0) continue;
          if (world.getWater(x, y + 1, z) > 0) continue;
          surfaceCells++;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const nz = z + dz;
            if (world.getWater(nx, y, nz) > 0) continue;
            if (blocksWater(world.getBlock(nx, y, nz))) continue;
            // Open and dry. A pool one block down is a little waterfall and fine;
            // anything else is water perched above ground it should have run off.
            if (world.getWater(nx, y - 1, nz) <= 0) spills++;
          }
        }
      }
    }
    expect(surfaceCells).toBeGreaterThan(100);
    expect(spills).toBe(0);
  });

  it('never flattens a village over a river', () => {
    const gen = new TerrainGenerator(2061350291);
    for (let cell = -2; cell <= 2; cell++) {
      const village = gen.findNearestVillage(cell * 900, cell * 700, 2);
      if (!village) continue;
      // A plateau reaching over the channel would dam the river it crosses.
      for (let ring = 0; ring <= 38; ring += 8) {
        for (let step = 0; step < 8; step++) {
          const angle = (step / 8) * Math.PI * 2;
          const x = Math.round(village.x + Math.cos(angle) * ring);
          const z = Math.round(village.z + Math.sin(angle) * ring);
          expect(gen.riverAt(x, z).strength).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it('finds a village and flattens the ground under it', () => {
    const gen = new TerrainGenerator(31337);
    const village = gen.findNearestVillage(0, 0, 4);
    expect(village).not.toBeNull();
    if (!village) return;
    const center = gen.height(village.x, village.z);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [8, 8]]) {
      expect(gen.height(village.x + dx, village.z + dz)).toBe(center);
    }
  });
});
