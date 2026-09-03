import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { TerrainGenerator } from '../world/generation/terrain';
import { MapMemory } from '../game/cartography';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, SEA_LEVEL, blockIndex } from '../world/chunk';

/** The debug map reveal: a survey of the generator, put on the map without the
 *  player having walked the ground. What matters is that it agrees with the
 *  ground, and that it does not end up in the save. */

const gen = new TerrainGenerator(seedFromString('voxelcraft'));

/** What generation puts on top of a finished surface. */
const GROWS_ON_TOP = new Set<number>([
  Block.TALL_GRASS, Block.FLOWER_RED, Block.FLOWER_YELLOW,
  Block.DEAD_BUSH, Block.CACTUS, Block.SUGAR_CANE,
]);

/** A chunk with no village in it, so the survey and the blocks are comparable:
 *  a town's houses are written after the columns and are not surveyed. */
function plainChunk(): { cx: number; cz: number } {
  for (let cz = 0; cz < 40; cz++) {
    for (let cx = 0; cx < 40; cx++) {
      const x = cx * CHUNK_SIZE + 8, z = cz * CHUNK_SIZE + 8;
      // A town's plateau reaches 56 blocks and its buildings less; 120 from the
      // middle of the chunk clears both with room to spare.
      const near = gen.villagesAround(x, z, 1)
        .some((v) => Math.hypot(v.x - x, v.z - z) < 120);
      if (!near) return { cx, cz };
    }
  }
  throw new Error('every chunk near the origin has a village in it');
}

describe('surveying a chunk for the map', () => {
  const { cx, cz } = plainChunk();
  const survey = gen.surveyChunk(cx, cz, 1);
  const { blocks } = gen.generateChunk(cx, cz);

  it('says what is on top of the ground the generator built', () => {
    let checked = 0;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = lz * CHUNK_SIZE + lx;
        const top = survey.height[i];
        expect(top).toBeGreaterThan(0);
        checked++;
        expect(blocks[blockIndex(lx, top, lz)], `column ${lx},${lz}`).toBe(survey.block[i]);
        // Above the surveyed face is either nothing or something growing on it.
        // The survey is of the ground, so a column wearing a flower reads as
        // grass on a revealed map and as the flower on a walked one — the same
        // ground, a pixel of a different green.
        const over = blocks[blockIndex(lx, top + 1, lz)];
        expect(GROWS_ON_TOP.has(over) || over === Block.AIR, `over ${lx},${lz}: ${over}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('marks the water it found as water', () => {
    for (let i = 0; i < survey.height.length; i++) {
      const wet = survey.block[i] === Block.WATER;
      expect(survey.water[i] > 0).toBe(wet);
      if (wet) expect(survey.height[i]).toBeGreaterThanOrEqual(SEA_LEVEL);
    }
  });

  it('costs less at a coarser stride, and still covers every column', () => {
    const coarse = gen.surveyChunk(cx, cz, 4);
    for (let i = 0; i < coarse.height.length; i++) expect(coarse.height[i]).toBeGreaterThan(0);
    // Every fourth column is exact; the rest repeat it.
    for (let lz = 0; lz < CHUNK_SIZE; lz += 4) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 4) {
        const i = lz * CHUNK_SIZE + lx;
        expect(coarse.height[i]).toBe(survey.height[i]);
      }
    }
  });
});

describe('a revealed region on the map', () => {
  it('reads back where it was written, and is not saved with the world', () => {
    const memory = new MapMemory();
    memory.recordSurvey(3, -2, gen.surveyChunk(3, -2, 2));
    const x = 3 * CHUNK_SIZE + 5, z = -2 * CHUNK_SIZE + 9;
    expect(memory.heightAt(x, z)).toBe(gen.surveyChunk(3, -2, 2).height[9 * CHUNK_SIZE + 5]);
    expect(memory.size).toBe(1);
    // The map remembers where the player has been. A region somebody looked at
    // in the console is not that, and is megabytes of it.
    expect(memory.toJSON()).toEqual({});
    expect(memory.forgetRevealed()).toBe(1);
    expect(memory.size).toBe(0);
    expect(memory.heightAt(x, z)).toBe(-1);
  });
});
