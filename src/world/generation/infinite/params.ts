/**
 * The reference generator exposes seventeen sliders; a voxel world has a seed
 * and nothing else. So the shape of `GeneratorParams` is kept exactly as the
 * ported code expects it, and every knob but the seed is frozen here into one
 * world recipe.
 *
 * Some of the frozen values feed layers this repo does not port — `roads`,
 * `rail`, `industry`, `development`, `agriInfra` and `quality` only mattered to
 * the reference's inter-settlement network, its city grid and its whole-map
 * scoring. They stay in the type so the ported files compile unchanged.
 */
export interface GeneratorParams {
  seed: number;
  sea: number;
  rugged: number;
  flat: number;
  basin: number;
  river: number;
  meander: number;
  erosion: number;
  settlement: number;
  agriculture: number;
  agriInfra: number;
  roads: number;
  development: number;
  industry: number;
  rail: number;
  quality: number;
  autoQuality: boolean;
}

/**
 * The reference's verification defaults, unchanged.
 *
 * `settlement` was the one worth checking rather than inheriting. It sets the
 * radius that keeps settlements apart, `0.72 * sqrt(1 / (pi * density))` cells,
 * and the arithmetic says 0.55 should put towns 190 blocks apart and make the
 * world two and a half times denser in towns than this game has ever been.
 *
 * Measured, it does the opposite. The lattice offers a site; whether a village
 * stands on it is then decided by the biome, the height and the flatness of the
 * ground (see `../villageSites.ts`), and only about a third of the offers
 * survive. At 0.20 the world came out at 0.63 villages per million square
 * blocks against the old generator's 1.72 — towns nearly three times as far
 * apart as the road reaches in `src/game/roads.ts`, the hamlet spacing in
 * `src/game/outpost.ts` and the quest chain were tuned for. 0.55 lands back on
 * the old density with a *larger* minimum separation than the old generator's
 * 144 blocks, because the lattice enforces one and a hashed grid cell did not.
 * `src/test/terrainShape.test.ts` pins both numbers.
 */
export const WORLD_PARAMS = {
  sea: 0.24,
  rugged: 0.65,
  flat: 0.36,
  basin: 0.45,
  river: 0.55,
  meander: 0.68,
  erosion: 0.55,
  settlement: 0.55,
  agriculture: 0.58,
  agriInfra: 0.65,
  roads: 0.55,
  development: 0.62,
  industry: 0.58,
  rail: 0.42,
  quality: 0.58,
  autoQuality: false,
} as const;

export const paramsFor = (seed: number): GeneratorParams => ({ seed, ...WORLD_PARAMS });
