import type { GeneratorParams } from './params';
import type { GridSpec } from './gridspec';
import { GRID_SIZE, clamp, fbm, hash2, lerp } from './grid';
import { alpineLift } from './hydrology';

/**
 * The finite map writes its noise coordinates as `u = x / (N - 1)`, so one noise
 * unit is 127 cells = 5.08 km. Keeping that mapping is what makes the infinite
 * terrain the same terrain: every frequency in the finite generator (1.45, 0.55,
 * 1.8, the 5.0x1.8 ridge, 7.2, 2.0 and the 9.5 crag) then has exactly the
 * wavelength it has today.
 */
export const NOISE_SPAN = GRID_SIZE - 1;

/**
 * The finite map is an island: `edge` pulls its border under water so rivers
 * always have a mouth. An unbounded world cannot use distance-to-border, but it
 * needs coasts even more — without them every drainage ends in an inland lake.
 * A very low frequency mask takes over the job: 0.085 noise units is roughly a
 * 60 km wavelength, so coast is on average some 30 km away and a river reaching
 * the sea is the same length of river the 5 km finite window is a snapshot of.
 */
const OCEAN_FREQUENCY = 0.085;
const OCEAN_DEPTH = 0.30;
const OCEAN_SOFTNESS = 0.35;

export interface TerrainConstants {
  /** Replaces `quantile(plains, 1 - p.flat)`. */
  plainsThreshold: number;
  /** Replaces `quantile(h, p.sea)` inside steepenHighGround. */
  shore: number;
  /** Replaces `max(h) - shore`. */
  relief: number;
}

export interface Basin { u: number; v: number; r: number; d: number }

/**
 * The basins of one noise-unit tile. The finite map scatters
 * `2 + round(p.basin * 7)` of them over its unit square, so one tile-worth per
 * (5.08 km)^2 reproduces exactly that areal density, size and depth spread.
 */
function tileBasins(tu: number, tv: number, p: GeneratorParams): Basin[] {
  const count = 2 + Math.round(p.basin * 7);
  const seed = (p.seed ^ Math.imul(tu, 0x9e3779b9) ^ Math.imul(tv, 0x85ebca6b)) | 0;
  const out: Basin[] = [];
  for (let k = 0; k < count; k++) out.push({
    u: tu + 0.12 + hash2(k, 31, seed) * 0.76,
    v: tv + 0.12 + hash2(k, 57, seed) * 0.76,
    r: 0.055 + hash2(k, 73, seed) * 0.1,
    d: (0.05 + hash2(k, 97, seed) * 0.12) * p.basin,
  });
  return out;
}

/**
 * The basin depressions at a point, summed over the 3 x 3 tile neighbourhood.
 * Three tiles is enough in each axis: a basin sits at 0.12..0.88 within its tile
 * and reaches at most 0.155 beyond that, so nothing further out can touch the
 * point.
 *
 * The neighbourhood is always walked in the same order (tile row, then tile
 * column, then index), which is what lets two different tiles compute a shared
 * cell bit-identically rather than merely closely: they sum the same
 * contributing basins in the same sequence.
 */
export interface BasinField {
  drop(u: number, v: number): number;
}

export function createBasinField(p: GeneratorParams): BasinField {
  const tiles = new Map<number, Basin[]>();
  const tileKey = (tu: number, tv: number) => tu * 1048576 + tv;
  const tileAt = (tu: number, tv: number) => {
    const key = tileKey(tu, tv);
    let list = tiles.get(key);
    if (!list) { list = tileBasins(tu, tv, p); tiles.set(key, list); }
    return list;
  };

  // Neighbouring cells almost always share a neighbourhood, so the merged list
  // is kept until the query leaves the tile it was built for.
  let cachedU = NaN, cachedV = NaN, cached: Basin[] = [];

  return {
    drop(u: number, v: number): number {
      const tu = Math.floor(u), tv = Math.floor(v);
      if (tu !== cachedU || tv !== cachedV) {
        cached = [];
        for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) cached.push(...tileAt(tu + du, tv + dv));
        cachedU = tu; cachedV = tv;
      }
      let drop = 0;
      for (const basin of cached) {
        const d = Math.hypot(u - basin.u, v - basin.v) / basin.r;
        if (d < 1) drop += basin.d * (1 - d * d) ** 2;
      }
      return drop;
    },
  };
}

/**
 * The height field as a pure function of world cell coordinates. `raw` is the
 * field before the upper slopes are steepened — calibration needs it on its own,
 * because the steepening reference levels are derived from it.
 */
export function terrainSampler(p: GeneratorParams, c: TerrainConstants, basins = createBasinField(p)) {
  // The finite map rotates the ridge field about the map centre; here it turns
  // about the world origin. Same anisotropy, only the absolute phase differs.
  const angle = hash2(p.seed, 11, p.seed) * Math.PI;
  const ca = Math.cos(angle), sa = Math.sin(angle);

  const plainsAt = (wx: number, wy: number) => fbm(wx / NOISE_SPAN * 2.0, wy / NOISE_SPAN * 2.0, p.seed + 1409, 3);

  const raw = (wx: number, wy: number) => {
    const u = wx / NOISE_SPAN, v = wy / NOISE_SPAN;
    const rx = u * ca - v * sa, ry = u * sa + v * ca;
    const continent = fbm(u * 1.45, v * 1.45, p.seed + 17, 4) * 0.46 + fbm(u * 0.55, v * 0.55, p.seed + 71, 3) * 0.28;
    const mountainMask = clamp((fbm(u * 1.8, v * 1.8, p.seed + 181, 3) + 0.18) * 1.25);
    const ridge = 1 - Math.abs(fbm(rx * 5.0, ry * 1.8, p.seed + 313, 4));
    const mountain = ridge * ridge * mountainMask * (0.12 + 0.58 * p.rugged);
    const detail = fbm(u * 7.2, v * 7.2, p.seed + 919, 5) * (0.025 + 0.12 * p.rugged);
    const ocean = clamp(-fbm(u * OCEAN_FREQUENCY, v * OCEAN_FREQUENCY, p.seed + 5501, 4) / OCEAN_SOFTNESS);
    const z = continent + mountain + detail - ocean * ocean * OCEAN_DEPTH - basins.drop(u, v);
    // The finite map divides by N here, not N - 1, unlike every other frequency.
    // Reproduced rather than tidied: it is what the current terrain looks like.
    const plainMask = clamp((plainsAt(wx, wy) - c.plainsThreshold) * 4 + 0.52);
    const broad = fbm(wx / GRID_SIZE * 1.35, wy / GRID_SIZE * 1.35, p.seed + 17, 4) * 0.42;
    return lerp(z, broad, plainMask * (0.46 + p.flat * 0.34));
  };

  const height = (wx: number, wy: number) => {
    const z = raw(wx, wy);
    return z + alpineLift(z, wx / NOISE_SPAN, wy / NOISE_SPAN, c.shore, c.relief, p);
  };

  return { raw, height, plainsAt };
}

/**
 * Fill a tile's height array. `step` is the cell stride: 1 for the 40 m
 * simulation grid, 8 for the 320 m coarse grid, with `g.originX/Y` always
 * counted in 40 m world cells so both levels share one coordinate system.
 */
export function fillTerrain(g: GridSpec, p: GeneratorParams, c: TerrainConstants, step = 1): Float32Array {
  const n = g.size, out = new Float32Array(n * n);
  const field = terrainSampler(p, c);
  for (let y = 0; y < n; y++) {
    const wy = g.originY + y * step;
    for (let x = 0; x < n; x++) out[y * n + x] = field.height(g.originX + x * step, wy);
  }
  return out;
}

/** `alpineLift` at a world cell, for callers that already have the raw height. */
export function alpineLiftAt(height: number, wx: number, wy: number, shore: number, relief: number, p: GeneratorParams): number {
  return alpineLift(height, wx / NOISE_SPAN, wy / NOISE_SPAN, shore, relief, p);
}
