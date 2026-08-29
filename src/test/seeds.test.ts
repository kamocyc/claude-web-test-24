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
   *  changes shape they move, and that should be a decision rather than a surprise. */
  describe('the verification world', () => {
    const generator = new TerrainGenerator(VERIFICATION_SEED);
    const spawn = findSpawn(generator);

    it('starts the player on dry land', () => {
      expect(spawn).toEqual({ x: 0, y: 53, z: 0 });
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

    /** The transport tutorial needs somewhere to transport to. Without this the slice
     *  could quietly become unplayable in the very world CI and the smoke test use. */
    it('has a second village close enough to link with a road', () => {
      const village = generator.findNearestVillage(spawn.x, spawn.z, 3);
      expect(village).not.toBeNull();
      if (!village) return;
      const neighbours = generator
        .villagesAround(village.x, village.z, 2)
        .filter((other) => other.x !== village.x || other.z !== village.z)
        .map((other) => Math.hypot(other.x - village.x, other.z - village.z))
        .sort((a, b) => a - b);
      expect(neighbours.length).toBeGreaterThan(0);
      expect(neighbours[0]).toBeLessThan(700);
    });
  });
});
