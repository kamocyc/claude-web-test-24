import { CHUNK_HEIGHT, SEA_LEVEL } from '../chunk';

/**
 * Where the two coordinate systems meet.
 *
 * The ported generator thinks in *simulation cells* of 40 m and in *terrain
 * units* of roughly 700 m of altitude. This game thinks in blocks. Nothing
 * outside this file is allowed to know both, so there is exactly one place to
 * look when the world comes out the wrong size.
 *
 * The conversion is deliberately not uniform. 16 blocks to the cell puts 2.5 m
 * of the reference world in a block horizontally; `BLOCKS_PER_UNIT` puts about
 * 5.4 m in one vertically. A 2.15x vertical exaggeration is what makes a
 * mountain read as a mountain when you are standing under it, and it is the
 * same trick the terrain this replaces was playing with `RIDGE_AMP`.
 *
 * ## Measured, not chosen
 *
 * Over super-chunk (0, 0) of three seeds, with `WORLD_PARAMS`:
 *
 * ```
 * seed         landHigh  above-sea units p50 / p90 / p99 / max   slope p50 / p90 / p99
 * voxelcraft   0.770     0.151 / 0.251 / 0.338 / 0.473           0.0093 / 0.0205 / 0.0370
 * alpha        0.804     0.071 / 0.184 / 0.282 / 0.331           0.0088 / 0.0190 / 0.0343
 * seed-3       0.853     0.255 / 0.547 / 0.862 / 1.006           0.0113 / 0.0310 / 0.0726
 * ```
 *
 * Deepest ground sampled below sea level: -0.40 to -0.66 units.
 *
 * `landHigh` is the reference's own summit estimate and is steady across seeds,
 * but it is a *median of map-sized windows* and real ranges overshoot it by a
 * third. A plain linear map either wastes the height budget on the gentle seeds
 * or flat-tops two per cent of the mountainous ones, so the mapping is linear
 * where the terrain actually lives and bends towards the ceiling above that.
 */

/** Blocks per simulation cell. One cell is exactly one chunk wide. */
export const CELL_BLOCKS = 16;

/** The reference counts river widths and depths in metres. */
export const BLOCKS_PER_METRE = CELL_BLOCKS / 40;

export const MIN_HEIGHT = 4;
export const MAX_HEIGHT = CHUNK_HEIGHT - 12;
/** The deepest the ocean is allowed to get. Nobody digs the sea bed. */
export const SEA_FLOOR_Y = 10;

/** Blocks per terrain unit, over the range the terrain actually occupies. */
export const BLOCKS_PER_UNIT = 130;
/**
 * Above this much terrain unit over sea level the mapping stops being linear.
 * 0.42 units is 55 blocks, which is above the 99th percentile of every seed
 * measured that is not itself a mountain range.
 */
const KNEE_UNITS = 0.42;
const KNEE_Y = KNEE_UNITS * BLOCKS_PER_UNIT;
/** What is left of the budget once the linear part has had its share. */
const HEAD_ROOM = MAX_HEIGHT - SEA_LEVEL - KNEE_Y;
const DEPTH_ROOM = SEA_LEVEL - SEA_FLOOR_Y;

/**
 * Terrain units to block Y, as a real number. `seaLevel` is the calibration's,
 * and is the only per-seed part: it is a quantile of the height field, so a
 * seed with more ocean simply has its shoreline at a different unit value.
 *
 * Both tails approach their limit rather than hitting it, so the summits keep a
 * gradient instead of turning into mesas at `MAX_HEIGHT`, and the sea bed keeps
 * one instead of turning into a plate at `SEA_FLOOR_Y`. The slope at the
 * shoreline is `BLOCKS_PER_UNIT` from either side, so nothing kinks there.
 */
export function unitsToHeight(units: number, seaLevel: number): number {
  const d = (units - seaLevel) * BLOCKS_PER_UNIT;
  if (d <= 0) return SEA_LEVEL - DEPTH_ROOM * (1 - Math.exp(d / DEPTH_ROOM));
  if (d <= KNEE_Y) return SEA_LEVEL + d;
  return SEA_LEVEL + KNEE_Y + HEAD_ROOM * (1 - Math.exp(-(d - KNEE_Y) / HEAD_ROOM));
}

/** The same, as the block Y a column's surface actually sits at. */
export function unitsToY(units: number, seaLevel: number): number {
  const y = Math.round(unitsToHeight(units, seaLevel));
  return y < MIN_HEIGHT ? MIN_HEIGHT : y > MAX_HEIGHT ? MAX_HEIGHT : y;
}

/**
 * How rugged the ground is, on the 0..1 scale `classifyBiome` wants. The old
 * generator took this from an erosion noise field; there is no such field any
 * more, so it comes from the slope the hydrology already computed. 0.038 units
 * per cell is the 99th percentile of the gentler seeds, so `rugged > 0.55`
 * — the mountain gate — lands a little above the 90th.
 */
const RUGGED_SLOPE = 0.038;
export const ruggedFromSlope = (slope: number) => (slope > RUGGED_SLOPE ? 1 : slope / RUGGED_SLOPE);

export const blockToCell = (block: number) => Math.floor(block / CELL_BLOCKS);
export const cellToBlock = (cell: number) => cell * CELL_BLOCKS;

/**
 * River widths and depths, converted out of the reference's metres.
 *
 * A straight metric conversion gives a trunk river 30 blocks wide and 3 deep,
 * which reads as a flooded field rather than a river, and rounds the smallest
 * tributaries down to no water at all. Width is pulled in and depth is pushed
 * out until the cross-section is one a player recognises: measured over
 * super-chunk (0, 0) of the verification seed, 3.0 to 16.7 blocks wide and 2 to
 * 5.6 deep, so the largest trunk is about three times as wide as it is deep and
 * the smallest brook still holds two blocks of water.
 *
 * Depth is scaled on its own rather than through `BLOCKS_PER_METRE`, because
 * the vertical scale is not the horizontal one — a metre of depth is worth more
 * blocks than a metre of width, the same way a metre of mountain is.
 */
const WIDTH_GAIN = 0.55;
const DEPTH_GAIN = 0.8;
export const riverWidthBlocks = (widthM: number) => Math.max(3, widthM * BLOCKS_PER_METRE * WIDTH_GAIN);
export const riverDepthBlocks = (depthM: number) => Math.max(2, depthM * DEPTH_GAIN);
