import type { GeneratorParams } from './params';
import type { GridSpec } from './gridspec';
import { lerp } from './grid';
import { accumulate, priorityFlood } from './hydrology';
import { COARSE_FACTOR, COARSE_HALO, COARSE_INTERIOR, COARSE_SIZE, coarseOrigin } from './constants';
import { fillTerrain, type TerrainConstants } from './terrain';

/**
 * The wide-area pass. At 320 m it sees 61 km at a time, which is what the fine
 * super-chunks cannot see: how much water is already in a river by the time it
 * crosses into a 5 km tile. It deliberately runs only flood + accumulate —
 * breaching, meandering and incision are 40 m shapes and running them here would
 * push the coarse flow away from the fine flow it is supposed to be describing.
 */

export interface CoarseTile {
  tx: number; ty: number;
  /** size = COARSE_SIZE, origin in *simulation* cells, stride COARSE_FACTOR. */
  grid: GridSpec;
  terrain: Float32Array;
  sea: Uint8Array;
  filled: Float32Array;
  parent: Int32Array;
  /** Catchment in coarse cells; multiply by COARSE_FACTOR^2 for simulation cells. */
  acc: Float64Array;
}

/**
 * Water is every cell at or below the calibrated sea level.
 *
 * It used to be "water that reaches the array border", the finite map's rule for
 * telling the open ocean from an inland lake. On an unbounded world that rule
 * cannot be applied: there is no border, only the edge of whichever window is
 * asking, so the answer depended on the window — and it threw away most of the
 * water. At `sea = 0.24`, a quarter to a third of the ground is below sea level
 * but only 2-19% of it reached a 205 km window's border; the rest was drawn as
 * dry land, filled flat by the depression flood, and disagreed with the
 * neighbouring tile by up to 67 m.
 *
 * A closed basin below sea level holds water, so this is also the more honest
 * answer. And being a plain threshold, it is a pure function of the world cell:
 * two tiles can no longer disagree about where the coast is.
 */
export function seaMask(terrain: Float32Array, level: number): Uint8Array {
  const sea = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i++) if (terrain[i] <= level) sea[i] = 1;
  return sea;
}

export function buildCoarseTile(tx: number, ty: number, p: GeneratorParams,
  c: TerrainConstants & { seaLevel: number }): CoarseTile {
  const grid: GridSpec = { size: COARSE_SIZE, originX: coarseOrigin(tx), originY: coarseOrigin(ty) };
  const terrain = fillTerrain(grid, p, c, COARSE_FACTOR);
  const sea = seaMask(terrain, c.seaLevel);
  const hydro = priorityFlood(terrain, sea, grid);
  const acc = accumulate(hydro.parent, hydro.order, sea, grid);
  return { tx, ty, grid, terrain, sea, filled: hydro.filled, parent: hydro.parent, acc };
}

/**
 * A first guess at the river threshold, in simulation cells of catchment.
 *
 * The finite mode takes a quantile over its own land cells, which cannot be done
 * once for an unbounded world. The coarse tile gives the shape of the
 * distribution; the resolution has to be corrected for, though. A river network
 * is a line, so rasterising the same network at 8x coarser cells covers 8x the
 * *fraction* of cells — hence the factor below. This is only a starting point:
 * the world calibration then measures the real fraction on a fine probe chunk
 * and corrects it.
 */
export function coarseRiverThreshold(tile: CoarseTile, density: number): number {
  if (density <= 0.005) return Infinity;
  const area = COARSE_FACTOR * COARSE_FACTOR;
  const values: number[] = [];
  for (let i = 0; i < tile.acc.length; i++) if (!tile.sea[i] && tile.acc[i] > 1) values.push(tile.acc[i] * area);
  if (!values.length) return Infinity;
  values.sort((a, b) => a - b);
  const fine = 1 - lerp(0.992, 0.94, density);
  const q = Math.max(0.02, 1 - fine * COARSE_FACTOR);
  return values[Math.floor((values.length - 1) * q)];
}

/**
 * The coarse level as scalar lookups, with the last tile kept.
 *
 * The settlement scan walks a 9 x 9 ring of coarse cells for every candidate it
 * scores, and there are a few hundred candidates per tile. Resolving each cell
 * through `coarseIndex` means a division, a hash lookup, an LRU touch and a
 * fresh `{ tile, index }` object: at 21,000 candidates a tile that allocation
 * alone was most of the half-second the scan took.
 *
 * The shortcut is deliberately confined to the cached tile's *interior*. A tile
 * computes its halo too, and its halo values for `acc` and `filled` are not the
 * neighbour's interior values — the flood and the accumulation saw a different
 * window. Answering out of the halo would make the answer depend on which tile
 * happened to be cached, which is the one thing none of this may do.
 */
export interface CoarseReader {
  /** The owning tile, for callers that need its neighbours as well. */
  tileAt(coarseX: number, coarseY: number): CoarseTile;
  /** Local index into whatever `tileAt` last returned. */
  index: number;
  height(coarseX: number, coarseY: number): number;
  sea(coarseX: number, coarseY: number): boolean;
  /** Catchment in simulation cells, comparable with the river threshold. */
  flow(coarseX: number, coarseY: number): number;
}

export function createCoarseReader(
  resolve: (coarseX: number, coarseY: number) => { tile: CoarseTile; index: number }): CoarseReader {
  let held: CoarseTile | null = null;
  let x0 = 0, y0 = 0, ix0 = 0, iy0 = 0, ix1 = -1, iy1 = -1;
  const reader: CoarseReader = {
    index: 0,
    tileAt(coarseX, coarseY) {
      if (held && coarseX >= ix0 && coarseX <= ix1 && coarseY >= iy0 && coarseY <= iy1) {
        reader.index = (coarseY - y0) * COARSE_SIZE + (coarseX - x0);
        return held;
      }
      const found = resolve(coarseX, coarseY);
      held = found.tile;
      ix0 = found.tile.tx * COARSE_INTERIOR; iy0 = found.tile.ty * COARSE_INTERIOR;
      ix1 = ix0 + COARSE_INTERIOR - 1; iy1 = iy0 + COARSE_INTERIOR - 1;
      x0 = ix0 - COARSE_HALO; y0 = iy0 - COARSE_HALO;
      reader.index = found.index;
      return held;
    },
    height(coarseX, coarseY) { const tile = reader.tileAt(coarseX, coarseY); return tile.terrain[reader.index]; },
    sea(coarseX, coarseY) { const tile = reader.tileAt(coarseX, coarseY); return tile.sea[reader.index] !== 0; },
    flow(coarseX, coarseY) {
      const tile = reader.tileAt(coarseX, coarseY);
      return tile.acc[reader.index] * COARSE_FACTOR * COARSE_FACTOR;
    },
  };
  return reader;
}

/**
 * The offsets of a square neighbourhood, ordered by distance. Scans that want
 * the *nearest* cell satisfying something can then stop at the first hit instead
 * of measuring all 81 of them, and still get the same answer — the order is
 * fixed, so a tie is always broken the same way.
 */
export function ringOffsets(reach: number): Array<{ dx: number; dy: number; d: number }> {
  const out: Array<{ dx: number; dy: number; d: number }> = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    out.push({ dx, dy, d: Math.hypot(dx, dy) });
  }
  return out.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx);
}
