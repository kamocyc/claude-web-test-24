import type { GeneratorParams } from './params';
import { GRID_SIZE, quantile } from './grid';
import { alpineLiftAt, createBasinField, terrainSampler, type TerrainConstants } from './terrain';

/**
 * The finite generator decides four things by looking at the whole map at once:
 * where the plains cut is, how high "high ground" starts, how much relief there
 * is, and where sea level sits. None of those questions has an answer on an
 * unbounded field, so they are answered once here against a fixed sample of the
 * world and then used as constants everywhere. Fixed means literally fixed: the
 * lattice below is anchored at world cell (0, 0) and never moves with the
 * camera, so every chunk agrees and nothing shifts as you fly around.
 */

/** 200 x 200 points, 24 cells apart: a 192 km window, ~3 ocean-mask wavelengths. */
const SAMPLE_COUNT = 200;
const SAMPLE_STEP = 24;

/**
 * `relief` is the one constant that must NOT be a world-wide statistic. The
 * finite generator takes `max(h)` over its own 5 km map, so it is the relief of
 * a typical map-sized window, and the alpine lift is proportional to it. The
 * global maximum of a 192 km sample is roughly twice that, and using it would
 * make every mountain twice as tall as the terrain this is meant to preserve.
 * So the world is probed with map-sized windows and the median of their reliefs
 * is taken: what a finite map of this world would have computed.
 */
const WINDOW_COUNT = 8;
const WINDOW_SPAN = GRID_SIZE;
const WINDOW_STEP = 4;

/**
 * How much taller the steepening makes the reference summit: `alpineLift` adds
 * `relief * ALPINE_LIFT * (0.3 + 0.7 * rugged)` at the top, plus the crag term.
 * Only the colour ramp needs this, so an approximation is fine.
 */
const ALPINE_HEADROOM = 0.62;

export interface TerrainCalibration extends TerrainConstants {
  seaLevel: number;
  /** Terrain units from sea level to the reference summit, for the colour ramp. */
  landHigh: number;
}

const cache = new Map<string, TerrainCalibration>();

const key = (p: GeneratorParams) => [p.seed, p.sea, p.rugged, p.flat, p.basin].join(':');

export function calibrateTerrain(p: GeneratorParams): TerrainCalibration {
  const cached = cache.get(key(p));
  if (cached) return cached;

  const half = (SAMPLE_COUNT - 1) * SAMPLE_STEP * 0.5;
  const coords: number[] = [];
  for (let k = 0; k < SAMPLE_COUNT; k++) coords.push(-half + k * SAMPLE_STEP);
  const basins = createBasinField(p);

  // A: the plains cut, which the raw height field then depends on.
  const draft: TerrainConstants = { plainsThreshold: 0, shore: 0, relief: 1 };
  const plainsField = terrainSampler(p, draft, basins);
  const plains = new Float32Array(SAMPLE_COUNT * SAMPLE_COUNT);
  for (let y = 0; y < SAMPLE_COUNT; y++) for (let x = 0; x < SAMPLE_COUNT; x++) {
    plains[y * SAMPLE_COUNT + x] = plainsField.plainsAt(coords[x], coords[y]);
  }
  const plainsThreshold = quantile(plains, 1 - p.flat);

  // B: the steepening reference levels, from the field before steepening. The
  // shore is where the water will end up, so it is a world-wide quantile; the
  // relief is a property of a map-sized window, so it is a median over windows.
  const rawConstants: TerrainConstants = { plainsThreshold, shore: 0, relief: 1 };
  const rawField = terrainSampler(p, rawConstants, basins);
  const raw = new Float32Array(SAMPLE_COUNT * SAMPLE_COUNT);
  for (let y = 0; y < SAMPLE_COUNT; y++) for (let x = 0; x < SAMPLE_COUNT; x++) {
    raw[y * SAMPLE_COUNT + x] = rawField.raw(coords[x], coords[y]);
  }
  const shore = quantile(raw, p.sea);

  const windowGap = Math.round((SAMPLE_COUNT - 1) * SAMPLE_STEP / WINDOW_COUNT);
  const reliefs: number[] = [];
  for (let wy = 0; wy < WINDOW_COUNT; wy++) for (let wx = 0; wx < WINDOW_COUNT; wx++) {
    const ox = -half + wx * windowGap, oy = -half + wy * windowGap;
    let peak = -Infinity;
    for (let y = 0; y < WINDOW_SPAN; y += WINDOW_STEP) for (let x = 0; x < WINDOW_SPAN; x += WINDOW_STEP) {
      peak = Math.max(peak, rawField.raw(ox + x, oy + y));
    }
    reliefs.push(peak - shore);
  }
  reliefs.sort((a, b) => a - b);
  const relief = Math.max(1e-6, reliefs[reliefs.length >> 1]);

  // C: sea level, from the finished field. The finite mode binary-searches the
  // ocean *area* connected to the map border; with no border to connect to, the
  // elevation quantile is the same statement about how much of the world is wet.
  // The steepening is applied to the heights sampled in B rather than resampled.
  const steep = new Float32Array(SAMPLE_COUNT * SAMPLE_COUNT);
  for (let y = 0; y < SAMPLE_COUNT; y++) for (let x = 0; x < SAMPLE_COUNT; x++) {
    const i = y * SAMPLE_COUNT + x;
    steep[i] = raw[i] + alpineLiftAt(raw[i], coords[x], coords[y], shore, relief, p);
  }
  const seaLevel = quantile(steep, p.sea);

  // The colour ramp ceiling follows the same "typical map" rule as the relief,
  // so the `height` mode reads the same as it does on a finite map.
  const result: TerrainCalibration = {
    plainsThreshold, shore, relief, seaLevel,
    landHigh: Math.max(1e-6, relief + relief * ALPINE_HEADROOM),
  };
  cache.set(key(p), result);
  return result;
}
