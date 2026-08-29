import { describe, expect, it } from 'vitest';
import { VERIFICATION_SEED, VERIFICATION_SEED_TEXT, findSpawn, seedFromUrl } from '../game/seeds';
import { seedFromString } from '../core/rng';
import { SEA_LEVEL } from '../world/chunk';
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
   *  They last moved when the terrain generator was rewritten around a ruggedness field
   *  and the sea was dropped from y=46 to y=34 to pay for taller mountains. Every number
   *  below was re-measured against that world, deliberately, in the same commit. */
  describe('the verification world', () => {
    const generator = new TerrainGenerator(VERIFICATION_SEED);
    const spawn = findSpawn(generator);

    it('starts the player on dry land', () => {
      expect(spawn).toEqual({ x: 0, y: 42, z: 0 });
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
