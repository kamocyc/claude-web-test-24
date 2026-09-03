/**
 * Which square of the world an array covers.
 *
 * `size` counts the halo: it is the side of the array, not of the useful
 * interior. `originX`/`originY` are the world cell coordinates of local (0, 0),
 * and they are what every position-seeded noise lookup has to be expressed in,
 * or the pattern restarts at every tile.
 *
 * Ported from the reference generator's `src/generator/gridspec.ts`. The finite
 * mode's single `FINITE_GRID` is dropped: here every array belongs to a tile.
 */
export interface GridSpec {
  size: number;
  originX: number;
  originY: number;
}

export const gridLen = (g: GridSpec) => g.size * g.size;
