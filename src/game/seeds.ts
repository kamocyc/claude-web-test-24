import { seedFromString } from '../core/rng';
import { CHUNK_HEIGHT } from '../world/chunk';
import type { TerrainGenerator } from '../world/generation/terrain';

/** The world used for verification: screenshots, the browser smoke test and the
 *  terrain tests all run on this seed, so a change in generation shows up as a
 *  failing assertion rather than as a world that quietly looks different. */
export const VERIFICATION_SEED_TEXT = 'voxelcraft';

export const VERIFICATION_SEED = seedFromString(VERIFICATION_SEED_TEXT);

/** Seed named in the page URL (`?seed=...`), so a specific world can be shared as a
 *  link. Returns null when the URL does not ask for one. */
export function seedFromUrl(search: string): { text: string; seed: number } | null {
  const params = new URLSearchParams(search);
  const text = params.get('seed');
  if (text === null) return null;
  return { text, seed: seedFromString(text) };
}

/**
 * Spirals outwards from the origin looking for somewhere a person can stand.
 *
 * "Somewhere to stand" is the generator's own judgement (`standingY`), not a
 * height above the sea: the world has rivers in it now, and a column in one has
 * ground under it and several blocks of water on top. Asking only how high the
 * ground was put the player in the water.
 *
 * Kept out of the game class so tests can ask where a seed actually starts the
 * player. Runs on respawn as well as at world creation, so the search is coarse
 * on purpose — every probe costs a lookup into the drainage solution.
 */
export function findSpawn(generator: TerrainGenerator): { x: number; y: number; z: number } {
  for (let radius = 0; radius < 1200; radius += 8) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      const y = generator.standingY(x, z);
      if (y !== null) return { x, y: y + 1, z };
    }
  }
  // Only reachable on a world with no dry land within 1200 blocks of the origin.
  // Above the ceiling rather than at it, so the player falls onto whatever is
  // there instead of starting inside it.
  return { x: 0, y: CHUNK_HEIGHT - 10, z: 0 };
}
