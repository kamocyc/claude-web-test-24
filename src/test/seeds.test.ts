import { describe, expect, it } from 'vitest';
import { VERIFICATION_SEED, VERIFICATION_SEED_TEXT, findSpawn, seedFromUrl } from '../game/seeds';
import { seedFromString } from '../core/rng';
import { CHUNK_SIZE, SEA_LEVEL, blockIndex } from '../world/chunk';
import { Block } from '../world/blocks';
import { TerrainGenerator } from '../world/generation/terrain';

describe('seeds', () => {
  it('reads a seed out of the page URL', () => {
    expect(seedFromUrl('')).toBeNull();
    expect(seedFromUrl('?render=8')).toBeNull();
    expect(seedFromUrl('?seed=voxelcraft')).toEqual({
      text: 'voxelcraft',
      seed: seedFromString('voxelcraft'),
    });
    expect(seedFromUrl('?seed=1234')?.seed).toBe(1234);
    // An empty value still means "this seed", not "surprise me".
    expect(seedFromUrl('?seed=')?.text).toBe('');
  });

  it('pins the verification seed', () => {
    expect(seedFromString(VERIFICATION_SEED_TEXT)).toBe(VERIFICATION_SEED);
    expect(VERIFICATION_SEED).toBe(2061350291);
  });

  /** These landmarks are what the browser smoke test walks to. If terrain generation
   *  changes shape they move, and that should be a decision rather than a surprise.
   *
   *  They last moved when terrain and village generation were replaced with the
   *  port of the reference generator's infinite mode — a real height field with
   *  drainage, rivers and a scored settlement lattice. Every number below was
   *  re-measured against that world, deliberately, in the same commit. */
  describe('the verification world', () => {
    const generator = new TerrainGenerator(VERIFICATION_SEED);
    const spawn = findSpawn(generator);

    it('starts the player somewhere they can stand', () => {
      // The world has rivers in it, and a column in one has ground under it and
      // several blocks of water on top. Asked only how high the ground was, the
      // spawn search used to answer with the riverbed.
      for (const text of ['voxelcraft', 'alpha', 'seed-3', '4242', 'ocean-heavy']) {
        const generator = new TerrainGenerator(seedFromString(text));
        const at = findSpawn(generator);
        const cx = Math.floor(at.x / CHUNK_SIZE), cz = Math.floor(at.z / CHUNK_SIZE);
        const { blocks } = generator.generateChunk(cx, cz);
        const lx = at.x - cx * CHUNK_SIZE, lz = at.z - cz * CHUNK_SIZE;
        const at0 = blocks[blockIndex(lx, at.y, lz)];
        const above = blocks[blockIndex(lx, at.y + 1, lz)];
        const below = blocks[blockIndex(lx, at.y - 1, lz)];
        expect(below, `${text}: nothing to stand on`).not.toBe(Block.AIR);
        expect(below, `${text}: standing on water`).not.toBe(Block.WATER);
        expect(at0, `${text}: standing in water`).toBe(Block.AIR);
        expect(above, `${text}: head under water`).toBe(Block.AIR);
      }
    });

    it('starts the player on dry land', () => {
      expect(spawn).toEqual({ x: 0, y: 50, z: 0 });
      expect(generator.height(spawn.x, spawn.z)).toBeGreaterThan(SEA_LEVEL);
    });

    it('has a village to trade at', () => {
      const village = generator.findNearestVillage(spawn.x, spawn.z, 3);
      expect(village).not.toBeNull();
      if (!village) return;
      expect(Math.hypot(village.x - spawn.x, village.z - spawn.z)).toBeLessThan(700);
      // The plateau has to be flat, or the smoke test cannot walk around the village.
      const center = generator.height(village.x, village.z);
      for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        expect(generator.height(village.x + dx, village.z + dz)).toBe(center);
      }
    });

    /** The transport tutorial needs two towns a road can join. Without this the slice
     *  could quietly become unplayable in the very world CI and the smoke test use.
     *
     *  Asked of the towns *near the start* rather than of the neighbours of one of them,
     *  because that is the property the tutorial actually needs and the narrower question
     *  is luck. Terrain features are three times as wide as they used to be, so whether
     *  any one town happens to have a close neighbour now depends on where the plains it
     *  stands in happen to end — this world's nearest town to the spawn is an isolated
     *  one, and its own nearest neighbour is 979 blocks off. There is still a pair 248
     *  blocks apart within reach of the spawn, which is the road the tutorial teaches. */
    it('has two villages near the start close enough to link with a road', () => {
      const nearStart = generator
        .villagesAround(spawn.x, spawn.z, 4)
        .filter((v) => Math.hypot(v.x - spawn.x, v.z - spawn.z) < 1200);
      expect(nearStart.length).toBeGreaterThan(1);
      let closest = Infinity;
      for (const a of nearStart) {
        for (const b of nearStart) {
          if (a === b) continue;
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
      expect(closest).toBeLessThan(700);
    });
  });
});
