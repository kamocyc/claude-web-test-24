import { SUPER_INTERIOR } from './constants';
import type { SuperChunk } from './superchunk';

/**
 * Which super-chunks describe the ground at a world cell, and how loudly.
 *
 * Every super-chunk computes its halo as well as its interior, so a cell near a
 * seam is described by two of them — four at a corner — and they agree about it
 * almost everywhere, the terrain being a pure function of the world cell. Where
 * they do not is where the incision put a channel one cell over in one of them:
 * an isolated cell up to a channel's depth apart. Reading each cell from a
 * single owner turns that into a step at the seam, and a step at the seam is a
 * cliff running down the middle of an otherwise flat field.
 *
 * Here every tile that speaks for a cell is heard, weighted by how far inside its
 * own interior the cell is. The weights depend only on the world cell, so two
 * chunks asking about a cell they share ask the same question of the same
 * super-chunks and get bit-identical answers.
 *
 * Ported from `src/infinite/ground.ts` of the reference generator. The
 * reference gathers weights once per drawn tile because it rebuilds whole
 * meshes; this game asks column by column, so the tile-square API is replaced
 * by a pointwise one.
 */

/** Cells over which two super-chunks hand the ground over to each other. */
export const BLEND = 16;

const smooth = (edge: number) => {
  const t = edge < 0 ? 0 : edge > 1 ? 1 : edge;
  return t * t * (3 - 2 * t);
};

/** How much of world cell `at` (one axis) the super-chunk row `tile` speaks for. */
export const tileWeight = (tile: number, at: number) => {
  const lo = tile * SUPER_INTERIOR, hi = lo + SUPER_INTERIOR - 1;
  return smooth((at - lo + BLEND) / BLEND) * smooth((hi + BLEND - at) / BLEND);
};

/** The super-chunk rows that can have any say over world cells `from`..`to`. */
export const tileRange = (from: number, to: number): [number, number] => [
  Math.ceil((from - SUPER_INTERIOR + 1 - BLEND) / SUPER_INTERIOR),
  Math.floor((to + BLEND) / SUPER_INTERIOR),
];

export interface GroundSample {
  /** Weighted mean of the ground, in terrain units. */
  height: number;
  /**
   * The loudest source, for the fields that have no meaningful average: whether
   * the cell is sea, what landform it is, how much water passes through.
   * That rule depends only on the cell too, so the two sides still agree.
   */
  chunk: SuperChunk;
  index: number;
}

/**
 * Read one world cell. `resolve` supplies a super-chunk by tile coordinates and
 * is allowed to build one; the caller decides how patient it is willing to be.
 */
export function sampleGround(resolve: (tx: number, ty: number) => SuperChunk,
  cellX: number, cellY: number): GroundSample {
  const [txLo, txHi] = tileRange(cellX, cellX);
  const [tyLo, tyHi] = tileRange(cellY, cellY);
  let total = 0, height = 0, best = -1;
  let chunk: SuperChunk | null = null, index = 0;
  for (let ty = tyLo; ty <= tyHi; ty++) for (let tx = txLo; tx <= txHi; tx++) {
    const weight = tileWeight(tx, cellX) * tileWeight(ty, cellY);
    if (weight <= 0) continue;
    const source = resolve(tx, ty);
    const n = source.grid.size;
    const at = (cellY - source.grid.originY) * n + (cellX - source.grid.originX);
    total += weight;
    height += weight * source.terrain[at];
    if (weight > best) { best = weight; chunk = source; index = at; }
  }
  // The plateau reaches full strength well inside an interior, so at least one
  // tile always has a say; a zero total would mean `tileRange` and `tileWeight`
  // had drifted apart.
  if (!chunk) throw new Error(`no super-chunk speaks for cell ${cellX},${cellY}`);
  return { height: height / total, chunk, index };
}
