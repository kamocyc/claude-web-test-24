import type { GeneratorParams } from './params';
import type { GridSpec } from './gridspec';
import { DX, DY } from './grid';
import {
  accumulate, breachDepressions, carveAndFlatten, classifyRiverLandforms, distanceField,
  meanderChannels, priorityFlood, slopeMap,
} from './hydrology';
import type { TerrainCalibration } from './calibrate';
import { seaMask, type CoarseTile } from './coarse';
import { COARSE_FACTOR, COARSE_HALO, COARSE_INTERIOR, COARSE_SIZE, SUPER_HALO, SUPER_SIZE, superOrigin } from './constants';
import { fillTerrain } from './terrain';

/**
 * A super-chunk is the finite generator's hydrology, run on a 5.12 km tile with
 * a 1.28 km halo. Only the interior is ever drawn; the halo exists so that every
 * stage which reaches outward — the meander displacement, the floodplain
 * flattening, the landform classification, the ambient occlusion, the render
 * upsample — sees real ground rather than an edge.
 */

export interface SuperChunkContext {
  params: GeneratorParams;
  constants: TerrainCalibration;
  coarseIndex(cx: number, cy: number): { tile: CoarseTile; index: number };
}

export interface SuperChunk {
  tx: number; ty: number;
  grid: GridSpec;
  params: GeneratorParams;
  terrain: Float32Array;
  sea: Uint8Array;
  filled: Float32Array;
  parent: Int32Array;
  accumulation: Float64Array;
  rivers: Uint8Array;
  slope: Float32Array;
  landform: Uint8Array;
  riverDistance: Int16Array;
  riverRelief: Float32Array;
  coastDistance: Int16Array;
  seaLevel: number;
  riverThreshold: number;
}

/**
 * A depression wider than the band two neighbouring chunks share cannot be seen
 * whole by both of them, so it is left unbreached and the flood fills it flat —
 * which is the answer both of them reach.
 */
const MAX_BREACH_SPAN = SUPER_HALO * 2;

/**
 * The discharge arriving from outside the tile, as extra catchment area on the
 * cells where it crosses in. Without this a river entering a super-chunk would
 * start counting its catchment from zero at the halo edge and be drawn as a
 * brook; with it, the width it is drawn at is the width its real catchment gives
 * it, which is what makes a river continuous across a seam.
 */
function buildInflow(ctx: SuperChunkContext, g: GridSpec, acc: Float64Array, sea: Uint8Array, height: Float32Array): Float64Array {
  const n = g.size, inflow = new Float64Array(n * n);
  const cx0 = g.originX / COARSE_FACTOR, cy0 = g.originY / COARSE_FACTOR;
  const block = n / COARSE_FACTOR;
  const area = COARSE_FACTOR * COARSE_FACTOR;
  for (let ry = -1; ry <= block; ry++) for (let rx = -1; rx <= block; rx++) {
    if (rx >= 0 && rx < block && ry >= 0 && ry < block) continue;
    const { tile, index } = ctx.coarseIndex(cx0 + rx, cy0 + ry);
    if (tile.sea[index]) continue;
    const parent = tile.parent[index];
    if (parent < 0) continue;
    const originCX = tile.tx * COARSE_INTERIOR - COARSE_HALO, originCY = tile.ty * COARSE_INTERIOR - COARSE_HALO;
    const bx = parent % COARSE_SIZE + originCX - cx0, by = Math.floor(parent / COARSE_SIZE) + originCY - cy0;
    if (bx < 0 || by < 0 || bx >= block || by >= block) continue;
    // Put the water in the valley, not on the ridge the same coarse cell covers.
    // The lowest ground is a far better channel indicator here than the local
    // accumulation, which is small and noisy this close to the array edge.
    let best = -1, bestZ = Infinity, bestAcc = -1;
    for (let fy = 0; fy < COARSE_FACTOR; fy++) for (let fx = 0; fx < COARSE_FACTOR; fx++) {
      const i = (by * COARSE_FACTOR + fy) * n + bx * COARSE_FACTOR + fx;
      if (sea[i]) continue;
      if (height[i] < bestZ || (height[i] === bestZ && acc[i] > bestAcc)) { bestZ = height[i]; bestAcc = acc[i]; best = i; }
    }
    if (best >= 0) inflow[best] += tile.acc[index] * area;
  }
  return inflow;
}

export function buildSuperChunk(ctx: SuperChunkContext, tx: number, ty: number, riverThreshold: number): SuperChunk {
  const p = ctx.params, c = ctx.constants;
  const grid: GridSpec = { size: SUPER_SIZE, originX: superOrigin(tx), originY: superOrigin(ty) };
  const len = SUPER_SIZE * SUPER_SIZE;

  const raw = fillTerrain(grid, p, c);
  // Every cell at or below sea level is water, coast included: see `seaMask`.
  // A threshold is a pure function of the world cell, so the two tiles sharing a
  // seam cut the coastline in exactly the same place.
  const sea = seaMask(raw, c.seaLevel);

  // Inflow placement follows the current drainage, so it is rebuilt after every
  // flood: the cell that is the valley before incision may not be after it.
  const drain = (hydro: ReturnType<typeof priorityFlood>) => {
    const local = accumulate(hydro.parent, hydro.order, sea, grid);
    return accumulate(hydro.parent, hydro.order, sea, grid, buildInflow(ctx, grid, local, sea, hydro.filled));
  };

  let hydro = priorityFlood(raw, sea, grid);
  const breached = breachDepressions(raw, sea, hydro, p.basin, grid, MAX_BREACH_SPAN);
  hydro = priorityFlood(breached.height, sea, grid);
  let accumulation = drain(hydro);
  let terrain = meanderChannels(breached.height, sea, hydro, accumulation, p, grid, riverThreshold);
  hydro = priorityFlood(terrain, sea, grid); terrain = hydro.filled; accumulation = drain(hydro);
  const carved = carveAndFlatten(terrain, sea, accumulation, p, grid, riverThreshold);
  hydro = priorityFlood(carved, sea, grid); terrain = hydro.filled; accumulation = drain(hydro);

  const rivers = new Uint8Array(len);
  for (let i = 0; i < len; i++) if (!sea[i] && accumulation[i] >= riverThreshold) rivers[i] = 1;
  const slope = slopeMap(terrain, grid);
  const geomorph = classifyRiverLandforms(terrain, sea, rivers, accumulation, riverThreshold, p, grid);

  const coast = new Uint8Array(len);
  for (let y = 1; y < SUPER_SIZE - 1; y++) for (let x = 1; x < SUPER_SIZE - 1; x++) {
    const i = y * SUPER_SIZE + x; if (sea[i]) continue;
    for (let k = 0; k < 8; k++) if (sea[(y + DY[k]) * SUPER_SIZE + x + DX[k]]) { coast[i] = 1; break; }
  }

  return {
    tx, ty, grid, params: p, terrain, sea, filled: hydro.filled, parent: hydro.parent, accumulation, rivers, slope,
    landform: geomorph.landform, riverDistance: geomorph.riverDist, riverRelief: geomorph.riverRelief,
    coastDistance: distanceField(coast, grid), seaLevel: c.seaLevel, riverThreshold,
  };
}
