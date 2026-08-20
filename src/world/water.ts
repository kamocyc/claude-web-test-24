/** Water is stored as a fill level per voxel rather than as discrete block states, so
 *  lakes, shallows and dam reservoirs can hold any amount.
 *
 *  A cell may hold slightly more than a full block: that surplus is the pressure that
 *  lets water climb again on the far side of a U-bend, which is what makes aqueducts
 *  and inverted siphons work. */

/** Level of a completely full cell. */
export const WATER_FULL = 200;
/** Hard cap, leaving headroom above WATER_FULL for pressure. */
export const WATER_MAX = 255;
/** Anything thinner than this evaporates, so water never dribbles forever. */
export const WATER_MIN = 2;
/** How much extra a cell can hold per level of water stacked above it. */
export const WATER_COMPRESSION = 4;
/** Movements smaller than this count as "settled" and let a cell go to sleep. */
export const WATER_EPSILON = 1;

/** 0..1 fill fraction, used for rendering and depth checks. */
export function waterFraction(level: number): number {
  return Math.min(1, level / WATER_FULL);
}

/** How much the lower of two stacked cells holds once they settle.
 *  Callers clamp the result against what is actually available. */
export function stableState(total: number): number {
  if (total <= WATER_FULL) return WATER_FULL;
  if (total < 2 * WATER_FULL + WATER_COMPRESSION) {
    return (WATER_FULL * WATER_FULL + total * WATER_COMPRESSION) / (WATER_FULL + WATER_COMPRESSION);
  }
  return (total + WATER_COMPRESSION) / 2;
}

/** Depth in blocks of a column of water levels read from the surface downwards. */
export function depthOf(levels: readonly number[]): number {
  let depth = 0;
  for (const level of levels) depth += waterFraction(level);
  return depth;
}
