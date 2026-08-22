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

/** Spirals outwards from the origin looking for dry land above the sea. Kept out of
 *  the game class so tests can ask where a seed actually starts the player. */
export function findSpawn(generator: TerrainGenerator): { x: number; y: number; z: number } {
  for (let radius = 0; radius < 400; radius += 8) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      const height = generator.height(x, z);
      if (height > 47 && height < CHUNK_HEIGHT - 20) return { x, y: height + 1, z };
    }
  }
  return { x: 0, y: 70, z: 0 };
}
