/**
 * The lattices the world is cut on. All of them are fixed integer grids anchored
 * at world cell (0, 0): a tile's contents depend only on the seed, the
 * parameters and its own tile coordinates, never on where the player has been.
 * That is what makes two neighbours agree about the ground they share.
 *
 * Coordinates here are counted in *simulation cells* everywhere, including
 * inside the coarse level, so the two resolutions share one coordinate system.
 * One cell is `CELL_BLOCKS` blocks — see `../scale.ts`, which is the only place
 * cells and blocks are allowed to meet. The metre figures in these comments are
 * the reference generator's own and are kept because they explain why each
 * number was chosen; divide by 2.5 for blocks.
 *
 * Ported from `src/infinite/constants.ts` of the reference generator. The
 * viewer-only constants (render chunk size, load radius, resident tile count)
 * are not ported: this game streams 16-block chunks on its own schedule.
 */

/** Coarse cells are 8 simulation cells = 320 m = 128 blocks. */
export const COARSE_FACTOR = 8;
export const COARSE_INTERIOR = 128;
export const COARSE_HALO = 32;
export const COARSE_SIZE = COARSE_INTERIOR + COARSE_HALO * 2;
/** 40.96 km of interior per coarse tile, in simulation cells. */
export const COARSE_INTERIOR_CELLS = COARSE_INTERIOR * COARSE_FACTOR;

/**
 * A super-chunk is where the real hydrology runs. 128 cells of interior is
 * 5.12 km (2048 blocks); the halo is derived, not chosen: the stages that have
 * to be correct at an interior cell reach 18 cells (meander displacement plus
 * its five-step downstream walk), then 5 (the floodplain flattening disc), then
 * 6 (the ambient-occlusion horizon sweep), then 2 (the upsample stencil) — 31
 * cells composed, so 32 with a cell to spare. The reference measured 64 to be
 * the width at which neighbours actually agree, and kept it.
 */
export const SUPER_INTERIOR = 128;
export const SUPER_HALO = 64;
export const SUPER_SIZE = SUPER_INTERIOR + SUPER_HALO * 2;

/**
 * The lattice the settlement layer is cut on: 256 cells = 10.24 km = 4096
 * blocks.
 *
 * Not the coarse tile, whose interior is 40.96 km — a 3 x 3 neighbourhood of
 * those is nine tiles and would thrash a cache holding eight. Not the
 * super-chunk either: the settlement spacing has to be decided in one window,
 * and at a low settlement density the rings that separate a city from a town
 * reach 250 cells. 256 is the smallest power-of-two multiple of `COARSE_FACTOR`
 * that clears them.
 */
export const CIVIL_TILE = 256;
export const civilTileOf = (cell: number) => Math.floor(cell / CIVIL_TILE);

export const superOrigin = (t: number) => t * SUPER_INTERIOR - SUPER_HALO;
export const superTileOf = (cell: number) => Math.floor(cell / SUPER_INTERIOR);
export const coarseOrigin = (t: number) => (t * COARSE_INTERIOR - COARSE_HALO) * COARSE_FACTOR;
export const coarseTileOf = (cell: number) => Math.floor(cell / COARSE_INTERIOR_CELLS);
