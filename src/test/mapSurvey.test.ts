import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { TerrainGenerator } from '../world/generation/terrain';
import { MapMemory } from '../game/cartography';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, SEA_LEVEL, blockIndex } from '../world/chunk';

/** The map reveal: a survey of the generator, put on the map without the player
 *  having walked the ground. What matters is that it agrees with the ground, and
 *  that it does not end up in the save. */

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

describe('surveying the ground for the map', () => {
  const { cx, cz } = plainChunk();
  const survey = gen.surveyRegion(cx * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, 1);
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

  /** The sweep walks a region in patches rather than in reading order, because that is
   *  the whole cost of a wide survey — see `SURVEY_PATCH`. A patch boundary must not be
   *  able to change an answer, or the map would be a grid of subtly different squares. */
  it('gives the same answer whatever order the region is walked in', () => {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    // Wide enough to be cut into patches, sampled per chunk as a real reveal is.
    const wide = gen.surveyRegion(x0, z0, 80, 80, CHUNK_SIZE);
    for (const [i, j] of [[0, 0], [17, 3], [40, 40], [79, 79], [8, 61]] as const) {
      const one = gen.surveyRegion(x0 + i * CHUNK_SIZE, z0 + j * CHUNK_SIZE, 1, 1, CHUNK_SIZE);
      const index = j * wide.cols + i;
      expect(wide.height[index], `height at ${i},${j}`).toBe(one.height[0]);
      expect(wide.block[index], `block at ${i},${j}`).toBe(one.block[0]);
    }
  });
});

describe('a revealed region on the map', () => {
  it('reads back where it was written, and is not saved with the world', () => {
    const memory = new MapMemory();
    const x0 = 3 * CHUNK_SIZE;
    const z0 = -2 * CHUNK_SIZE;
    const survey = gen.surveyRegion(x0, z0, 4, 4, CHUNK_SIZE);
    memory.beginReveal(x0, z0, 4, 4, CHUNK_SIZE);
    memory.addRevealed(survey);
    // Every column of a chunk reads back the one sample taken for that chunk.
    expect(memory.heightAt(x0 + 5, z0 + 9)).toBe(survey.height[0]);
    expect(memory.heightAt(x0 + CHUNK_SIZE * 2 + 3, z0 + CHUNK_SIZE + 1)).toBe(survey.height[4 + 2]);
    expect(memory.revealedBlocks).toBe(4 * CHUNK_SIZE);
    // The map remembers where the player has been. A region somebody asked to
    // look at is not that, and is megabytes of it.
    expect(memory.toJSON()).toEqual({});
    expect(memory.size).toBe(0);

    expect(memory.forgetRevealed()).toBe(4 * CHUNK_SIZE);
    expect(memory.heightAt(x0 + 5, z0 + 9)).toBe(-1);
  });

  it('says nothing about ground outside the region it was given', () => {
    const memory = new MapMemory();
    memory.beginReveal(0, 0, 2, 2, CHUNK_SIZE);
    memory.addRevealed(gen.surveyRegion(0, 0, 2, 2, CHUNK_SIZE));
    expect(memory.heightAt(1, 1)).toBeGreaterThan(0);
    expect(memory.heightAt(-1, 1)).toBe(-1);
    expect(memory.heightAt(1, 2 * CHUNK_SIZE)).toBe(-1);
  });

  /** A patch lands on the region by its world position, so a sweep whose patches come
   *  back out of order — which is what several workers means — still assembles. */
  it('takes patches in any order and puts each where it belongs', () => {
    const memory = new MapMemory();
    memory.beginReveal(0, 0, 4, 4, CHUNK_SIZE);
    const whole = gen.surveyRegion(0, 0, 4, 4, CHUNK_SIZE);
    memory.addRevealed(gen.surveyRegion(CHUNK_SIZE * 2, CHUNK_SIZE * 2, 2, 2, CHUNK_SIZE));
    memory.addRevealed(gen.surveyRegion(0, 0, 2, 2, CHUNK_SIZE));
    expect(memory.heightAt(CHUNK_SIZE * 3, CHUNK_SIZE * 3)).toBe(whole.height[3 * 4 + 3]);
    expect(memory.heightAt(0, 0)).toBe(whole.height[0]);
    // Nothing was written for the two patches that never arrived.
    expect(memory.heightAt(CHUNK_SIZE * 3, 0)).toBe(-1);
  });
});
