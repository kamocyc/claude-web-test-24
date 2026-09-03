import { seedFromString } from '../core/rng';
import { CHUNK_HEIGHT } from '../world/chunk';
import { isWorldKind, type WorldKind } from '../world/generation/kind';
import type { TerrainGenerator } from '../world/generation/terrain';

/** The world used for verification: screenshots, the browser smoke test and the
 *  terrain tests all run on this seed, so a change in generation shows up as a
 *  failing assertion rather than as a world that quietly looks different. */
export const VERIFICATION_SEED_TEXT = 'voxelcraft';

export const VERIFICATION_SEED = seedFromString(VERIFICATION_SEED_TEXT);

/** The superflat building showcase. Its seed decides almost nothing — the layout is
 *  fixed and only the small decorative rolls read it — but a world still needs one,
 *  and a named one keeps the URL shareable. */
export const SHOWCASE_SEED_TEXT = 'showcase';
export const SHOWCASE_SEED = seedFromString(SHOWCASE_SEED_TEXT);

/** Seed named in the page URL (`?seed=...`), so a specific world can be shared as a
 *  link. Returns null when the URL does not ask for one. */
export function seedFromUrl(search: string): { text: string; seed: number } | null {
  const params = new URLSearchParams(search);
  const text = params.get('seed');
  if (text === null) return null;
  return { text, seed: seedFromString(text) };
}

/**
 * The generator named in the page URL (`?world=showcase`), so the test world can be
 * opened as a link and pinned by the browser smoke test. Returns null both when the
 * URL names no generator and when it names one that does not exist, which the caller
 * treats the same way: a mistyped `?world=` opens the title screen, exactly as a bare
 * URL does, rather than dropping the player into a world they did not ask for.
 */
export function worldKindFromUrl(search: string): WorldKind | null {
  const asked = new URLSearchParams(search).get('world');
  return isWorldKind(asked) ? asked : null;
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
