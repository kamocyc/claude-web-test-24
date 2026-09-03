import type { GeneratorParams } from './params';
import { lerp } from './grid';
import { calibrateTerrain, type TerrainCalibration } from './calibrate';
import { buildCoarseTile, coarseRiverThreshold, type CoarseTile } from './coarse';
import { buildSuperChunk, type SuperChunk } from './superchunk';
import { createSettlementField, type SettlementField } from './settlements';
import {
  COARSE_FACTOR, COARSE_HALO, COARSE_INTERIOR, COARSE_SIZE, SUPER_HALO, SUPER_INTERIOR, superOrigin,
} from './constants';

/**
 * One world: the calibration, the tile caches, and the lookups that let a fine
 * tile ask the coarse level about ground it cannot see. Everything hangs off
 * this object rather than off module state, so the main thread and each chunk
 * worker hold their own and nothing leaks between them.
 *
 * Ported from `src/infinite/world.ts` of the reference generator, with the
 * inter-settlement network dropped (this game's roads are the player's) and two
 * changes for running many copies of it:
 *
 *  - the caches are small. The reference sizes them for a camera flying over a
 *    10 km view; a player walks, and one super-chunk covers 2048 blocks, so two
 *    resident tiles cover any journey short of a sprint across a seam.
 *  - `calibration` and `riverThreshold` can be supplied. Measuring them costs
 *    two probe super-chunks, and six workers each measuring the same two is six
 *    times the wait for one answer they are all obliged to agree on. The main
 *    thread measures once and hands the numbers over in the init message.
 */

/**
 * A coarse tile is ~780 KB and covers 16384 blocks of interior. Four, not two:
 * building one civil tile of settlements reads the candidate scatter of its
 * eight neighbours as well, which spans 12288 blocks and so lands on up to two
 * coarse tiles in each axis. At two the scan evicted a tile it was about to
 * read again and every village lookup rebuilt the world.
 */
const COARSE_CACHE = 4;
/**
 * A super-chunk is ~2 MB and covers 2048 blocks of interior. Four, because a
 * column within the blend of a corner is spoken for by four of them and a cache
 * that cannot hold all four rebuilds one on every block.
 */
const SUPER_CACHE = 4;

/**
 * Fixed candidates for the probe chunks. The ones whose land fraction is closest
 * to the world average win — a land-locked probe would measure the threshold
 * against unusually large catchments and leave the whole world short of rivers,
 * an all-sea one the reverse.
 */
const PROBE_TILES: Array<[number, number]> = [[0, 0], [2, 1], [-3, 2], [4, -2], [1, 4], [-2, -3], [6, 3], [-5, -1]];
const PROBE_COUNT = 2;

/** What a worker is handed so it does not have to measure the world itself. */
export interface WorldConstants {
  calibration: TerrainCalibration;
  riverThreshold: number;
}

export interface InfiniteWorld {
  params: GeneratorParams;
  constants: TerrainCalibration;
  riverThreshold: number;
  coarseTile(tx: number, ty: number): CoarseTile;
  /** Absolute coarse-cell lookups, for cells anywhere in the world. */
  coarseIndex(cx: number, cy: number): { tile: CoarseTile; index: number };
  /** Where the settlements are. Scored from the coarse level, never from a tile. */
  settlements: SettlementField;
  superChunk(tx: number, ty: number): SuperChunk;
  /**
   * Build one without keeping it. For a caller that wants something small out
   * of a tile it will not ask about again — the river curves, say — and would
   * rather not evict the tiles that are answering for the ground underfoot.
   */
  uncachedSuperChunk(tx: number, ty: number): SuperChunk;
  /** Without building it, for a caller that would rather answer approximately. */
  peekSuperChunk(tx: number, ty: number): SuperChunk | undefined;
  /** The interior-owning chunk of a world cell, and the local index in it. */
  cellOwner(fineX: number, fineY: number): { chunk: SuperChunk; index: number };
  stats(): { coarseTiles: number; superChunks: number; lastBuildMs: number };
  clear(): void;
}

function lru<T>(limit: number) {
  const map = new Map<number, T>();
  return {
    get(key: number): T | undefined {
      const value = map.get(key);
      if (value !== undefined) { map.delete(key); map.set(key, value); }
      return value;
    },
    set(key: number, value: T) {
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value as number);
    },
    get size() { return map.size; },
    clear() { map.clear(); },
  };
}

const tileKey = (tx: number, ty: number) => tx * 1048576 + ty;

export function createInfiniteWorld(p: GeneratorParams, known?: WorldConstants): InfiniteWorld {
  const constants = known?.calibration ?? calibrateTerrain(p);
  const coarse = lru<CoarseTile>(COARSE_CACHE);
  const supers = lru<SuperChunk>(SUPER_CACHE);
  let lastBuildMs = 0;

  const coarseTile = (tx: number, ty: number): CoarseTile => {
    const key = tileKey(tx, ty);
    let tile = coarse.get(key);
    if (!tile) { tile = buildCoarseTile(tx, ty, p, constants); coarse.set(key, tile); }
    return tile;
  };

  const coarseIndex = (cx: number, cy: number) => {
    const tx = Math.floor(cx / COARSE_INTERIOR), ty = Math.floor(cy / COARSE_INTERIOR);
    const tile = coarseTile(tx, ty);
    const lx = cx - (tx * COARSE_INTERIOR - COARSE_HALO), ly = cy - (ty * COARSE_INTERIOR - COARSE_HALO);
    return { tile, index: ly * COARSE_SIZE + lx };
  };

  const context = { params: p, constants, coarseIndex };

  /**
   * The river threshold is the reference's own statistic — the q-quantile of
   * log1p(catchment) over land cells — measured on the land-richest of a fixed
   * set of probe chunks instead of on "the map", since there is no map.
   */
  function measureThreshold(): number {
    if (p.river <= 0.005) return Infinity;
    // Provisional: the shape of the distribution at the coarse resolution,
    // resolution-corrected. It only has to be good enough to build the probes.
    const probeThreshold = coarseRiverThreshold(coarseTile(0, 0), p.river);
    const side = SUPER_INTERIOR / COARSE_FACTOR, target = 1 - p.sea;
    const ranked = PROBE_TILES.map(([tx, ty]) => {
      let land = 0;
      for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++) {
        const { tile, index } = coarseIndex(
          Math.floor((tx * SUPER_INTERIOR) / COARSE_FACTOR) + cx,
          Math.floor((ty * SUPER_INTERIOR) / COARSE_FACTOR) + cy);
        if (!tile.sea[index]) land++;
      }
      return { tx, ty, off: Math.abs(land / (side * side) - target) };
    }).sort((a, b) => a.off - b.off).slice(0, PROBE_COUNT);

    const values: number[] = [];
    for (const { tx, ty } of ranked) {
      const probe = buildSuperChunk(context, tx, ty, probeThreshold);
      const n = probe.grid.size;
      // Interior only: catchments in the halo are cut off by the array edge and
      // would drag the distribution down.
      for (let y = SUPER_HALO; y < n - SUPER_HALO; y++) for (let x = SUPER_HALO; x < n - SUPER_HALO; x++) {
        const i = y * n + x;
        if (!probe.sea[i] && probe.accumulation[i] > 1) values.push(Math.log1p(probe.accumulation[i]));
      }
    }
    if (!values.length) return probeThreshold;
    values.sort((a, b) => a - b);
    const q = lerp(0.992, 0.94, p.river);
    return Math.expm1(values[Math.floor((values.length - 1) * q)]);
  }

  const riverThreshold = known?.riverThreshold ?? measureThreshold();

  const superChunk = (tx: number, ty: number): SuperChunk => {
    const key = tileKey(tx, ty);
    let chunk = supers.get(key);
    if (!chunk) {
      const start = Date.now();
      chunk = buildSuperChunk(context, tx, ty, riverThreshold);
      lastBuildMs = Date.now() - start;
      supers.set(key, chunk);
    }
    return chunk;
  };

  const uncachedSuperChunk = (tx: number, ty: number) =>
    supers.get(tileKey(tx, ty)) ?? buildSuperChunk(context, tx, ty, riverThreshold);

  const peekSuperChunk = (tx: number, ty: number) => supers.get(tileKey(tx, ty));

  const settlements = createSettlementField({ params: p, constants, riverThreshold, coarseIndex });

  const cellOwner = (fineX: number, fineY: number) => {
    const tx = Math.floor(fineX / SUPER_INTERIOR), ty = Math.floor(fineY / SUPER_INTERIOR);
    const chunk = superChunk(tx, ty);
    const lx = fineX - superOrigin(tx), ly = fineY - superOrigin(ty);
    return { chunk, index: ly * chunk.grid.size + lx };
  };

  return {
    params: p, constants, riverThreshold, settlements,
    coarseTile, coarseIndex, superChunk, uncachedSuperChunk, peekSuperChunk, cellOwner,
    stats: () => ({ coarseTiles: coarse.size, superChunks: supers.size, lastBuildMs }),
    clear() { coarse.clear(); supers.clear(); settlements.clear(); },
  };
}

/** Measure the two numbers every copy of the world has to agree on. */
export function measureWorldConstants(p: GeneratorParams): WorldConstants {
  const world = createInfiniteWorld(p);
  const out = { calibration: world.constants, riverThreshold: world.riverThreshold };
  world.clear();
  return out;
}
