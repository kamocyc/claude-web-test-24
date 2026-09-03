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
 * The reference's verification defaults, with one deliberate change.
 *
 * `settlement` is 0.20 rather than the reference's 0.55. The radius that keeps
 * settlements apart is `0.72 * sqrt(1 / (pi * density))` cells, and at 16 blocks
 * to the cell 0.55 puts towns about 190 blocks apart — two and a half times as
 * dense as this game's world has ever been. Every reach constant in
 * `src/game/roads.ts`, the hamlet spacing in `src/game/outpost.ts` and the quest
 * chain assume roughly 320 blocks between towns, which is what 0.20 gives.
 * `src/test/infiniteSettlements.test.ts` pins it.
 */
export const WORLD_PARAMS = {
  sea: 0.24,
  rugged: 0.65,
  flat: 0.36,
  basin: 0.45,
  river: 0.55,
  meander: 0.68,
  erosion: 0.55,
  settlement: 0.2,
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
