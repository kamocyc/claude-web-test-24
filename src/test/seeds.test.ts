import { describe, expect, it } from 'vitest';
import { VERIFICATION_SEED, VERIFICATION_SEED_TEXT, findSpawn, seedFromUrl } from '../game/seeds';
import { seedFromString } from '../core/rng';
import { SEA_LEVEL } from '../world/chunk';
import { TerrainGenerator } from '../world/generation/terrain';
import { riverCovers } from '../world/generation/rivers';

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
      expect(spawn).toEqual({ x: 8, y: 52, z: 0 });
      expect(generator.height(spawn.x, spawn.z)).toBeGreaterThan(SEA_LEVEL);
    });

    it('has a river within a short walk of the spawn', () => {
      let found: { x: number; z: number; distance: number } | null = null;
      for (let radius = 4; radius <= 120 && !found; radius += 4) {
        for (let step = 0; step < 48; step++) {
          const angle = (step / 48) * Math.PI * 2;
          const x = Math.round(spawn.x + Math.cos(angle) * radius);
          const z = Math.round(spawn.z + Math.sin(angle) * radius);
          const river = generator.riverAt(x, z);
          if (river.strength > 0.4 && riverCovers(river, generator.height(x, z))) {
            found = { x, z, distance: radius };
            break;
          }
        }
      }
      expect(found).not.toBeNull();
      expect(found?.distance).toBeLessThanOrEqual(16);
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
  });
});
