import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { Block } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, SEA_LEVEL, blockIndex } from '../world/chunk';
import { World } from '../world/world';
import { blocksWater } from '../world/blocks';
import { Biome } from '../world/generation/biome';

/** The highest y in the world that holds any water, so a sweep can stop there. */
function topWaterCell(world: World): number {
  let top = 0;
  for (const chunk of world.chunks.values()) {
    for (let i = chunk.water.length - 1; i >= 0; i--) {
      if (chunk.water[i] > 0) {
        top = Math.max(top, Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE)));
        break;
      }
    }
  }
  return Math.min(top + 1, CHUNK_HEIGHT - 2);
}

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

  /**
   * A chunk with standing water in it and dry ground beside it.
   *
   * A river first, because there is one within a few hundred blocks of anywhere
   * on land and a coast might be twenty kilometres off — this world is 94 per
   * cent land around its origin. The coast is the fallback for a seed that
   * happens to have no river near the middle.
   */
  function findWater(gen: TerrainGenerator): { cx: number; cz: number } {
    for (let radius = 0; radius < 24; radius++) {
      for (let cz = -radius; cz <= radius; cz++) {
        for (let cx = -radius; cx <= radius; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
          for (let z = 2; z < CHUNK_SIZE; z += 5) {
            for (let x = 2; x < CHUNK_SIZE; x += 5) {
              const river = gen.field.riverAt(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z);
              if (river && river.distance < river.width * 0.4 && river.waterY > SEA_LEVEL) {
                return { cx, cz };
              }
            }
          }
          let low = 0, high = 0;
          for (let z = 0; z < CHUNK_SIZE; z += 4) {
            for (let x = 0; x < CHUNK_SIZE; x += 4) {
              const h = gen.height(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z);
              if (h < SEA_LEVEL - 2) low++; else if (h > SEA_LEVEL + 2) high++;
            }
          }
          if (low >= 4 && high >= 4) return { cx, cz };
        }
      }
    }
    throw new Error('no river or coastline within 24 chunks of the origin');
  }

  it('never leaves generated water standing over dry land', () => {
    // Generated water may only ever spill one block down into the next pool, never
    // sideways onto open ground.
    const gen = new TerrainGenerator(2061350291);
    const world = new World(2061350291);
    // Somewhere with water in it, found rather than pinned: the coast moves
    // whenever generation changes, and a window pinned to where it used to run
    // reports "no spills" about ground that has been dry for three commits.
    // `height` is the bare field on a generator with nothing loaded, which is
    // cheap and quite good enough to find a coastline.
    const wet = findWater(gen);
    const originChunkX = wet.cx;
    const originChunkZ = wet.cz;
    for (let cz = originChunkZ - 1; cz <= originChunkZ + 1; cz++) {
      for (let cx = originChunkX - 1; cx <= originChunkX + 1; cx++) {
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
    let first = '';
    // Nothing above the highest wet cell can hold water, so the columns are walked only
    // that far rather than all the way to the roof of the world.
    const ceiling = topWaterCell(world);
    const fromX = (originChunkX - 1) * CHUNK_SIZE + 1;
    const fromZ = (originChunkZ - 1) * CHUNK_SIZE + 1;
    for (let z = fromZ; z < fromZ + CHUNK_SIZE * 3 - 2; z++) {
      for (let x = fromX; x < fromX + CHUNK_SIZE * 3 - 2; x++) {
        for (let y = 1; y <= ceiling; y++) {
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
            if (world.getWater(nx, y - 1, nz) > 0) continue;
            spills++;
            first ||= `water at (${x}, ${y}, ${z}) stands beside open dry ground at (${nx}, ${y}, ${nz})`;
          }
        }
      }
    }
    expect(surfaceCells, 'the sweep found no water surface').toBeGreaterThan(100);
    expect(spills, first).toBe(0);
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


describe('desert decoration', () => {
  /** The nearest chunk to the origin whose middle is desert. */
  function findDesert(gen: TerrainGenerator): { cx: number; cz: number } {
    for (let radius = 0; radius < 60; radius++) {
      for (let cz = -radius; cz <= radius; cz++) {
        for (let cx = -radius; cx <= radius; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
          const x = cx * CHUNK_SIZE + CHUNK_SIZE / 2, z = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
          if (gen.biomeAt(x, z) === Biome.DESERT) return { cx, cz };
        }
      }
    }
    throw new Error('no desert within 60 chunks of the origin');
  }

  /** Sand surface cells, and how many of them wear a cactus, over real desert. */
  function sandAndCacti(): { sand: number; cacti: number } {
    const gen = new TerrainGenerator(4242);
    let sand = 0;
    let cacti = 0;
    // Find a desert first and sweep around it. Sweeping a fixed band and taking
    // whatever it finds worked while the world had a desert near the origin;
    // what it does when the world moves is measure a rate over four sand cells
    // on a beach. `biomeAt` needs nothing loaded, so the search is cheap.
    const desert = findDesert(gen);
    for (let cz = desert.cz - 6; cz <= desert.cz + 6; cz += 3) {
      for (let cx = desert.cx - 6; cx <= desert.cx + 6; cx += 3) {
        const chunk = gen.generateChunk(cx, cz);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const h = gen.height(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z);
            if (chunk.blocks[blockIndex(x, h, z)] !== Block.SAND) continue;
            sand++;
            if (chunk.blocks[blockIndex(x, h + 1, z)] === Block.CACTUS) cacti++;
          }
        }
      }
    }
    return { sand, cacti };
  }

  it('scatters cacti thinly rather than filling the desert with them', () => {
    // A desert used to run about 26 cacti per thousand sand cells, which read as a
    // forest of them. The rate is per sand cell rather than a raw count so the test says
    // what was actually tuned, and both directions are guarded: too many is the bug that
    // was fixed, none at all is a desert with nothing in it.
    const { sand, cacti } = sandAndCacti();
    // 3952 sand cells at the time of writing. Without this the rate is measured over
    // whatever the sweep happened to find, and a sweep that finds no desert at all
    // reports a rate of nothing rather than failing.
    expect(sand, 'the sweep found no desert to measure').toBeGreaterThan(2000);
    const rate = (cacti * 1000) / sand;
    expect(rate).toBeGreaterThan(1);
    expect(rate).toBeLessThan(15);
  });
});
