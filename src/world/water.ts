/** Water is stored as a fill level per voxel rather than as discrete block states, so
 *  lakes, shallows and dam reservoirs can hold any amount.
 *
 *  A cell may hold more than a full block. That surplus is the pressure of water being
 *  pushed in from somewhere, and it is what lets a channel climb again on the far side
 *  of a dip. Water that is merely stacked carries no surplus, so a still sea stays
 *  perfectly flat and costs nothing to simulate. */

/** Level of a completely full cell. The headroom up to WATER_MAX is what carries
 *  pressure, so it has to be wide enough for deep columns. */
export const WATER_FULL = 128;
/** Hard cap, leaving headroom above WATER_FULL for pressure. */
export const WATER_MAX = 255;
/** Movements smaller than this count as "settled" and let a cell go to sleep. */
export const WATER_EPSILON = 1;

/** 0..1 fill fraction, used for rendering and depth checks. */
export function waterFraction(level: number): number {
  return Math.min(1, level / WATER_FULL);
}
