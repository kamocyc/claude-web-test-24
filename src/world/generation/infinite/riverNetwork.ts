import { SEA_LEVEL } from '../../chunk';
import { CELL_BLOCKS, riverDepthBlocks, riverWidthBlocks, unitsToHeight } from '../scale';
import { clamp, hash2 } from './grid';
import type { GridSpec } from './gridspec';
import { catmullRom, limitCurvature, resamplePath, type RibbonPoint } from './path';

/**
 * Ported from the reference generator's `src/river/network.ts`. Two changes:
 * the finite map's single un-gridded frame is gone, so every source names the
 * tile it belongs to; and every length is in blocks rather than in the
 * reference's world units, with the channel dimensions converted once here (see
 * `riverWidthBlocks` / `riverDepthBlocks` in `../scale.ts`). `waterY` is an
 * absolute block Y, which is what a column has to be filled to.
 */

/**
 * Everything the network needs from a generated world. `GeneratedWorld` satisfies
 * it as it stands; a super-chunk supplies the same fields plus a `grid`, which is
 * what lets one tile of an unbounded world be traced exactly like a finite map.
 */
export interface RiverSource {
  rivers: Uint8Array;
  sea: Uint8Array;
  parent: Int32Array;
  accumulation: Float64Array;
  filled: Float32Array;
  slope: Float32Array;
  landform: Uint8Array;
  seaLevel: number;
  riverThreshold: number;
  params: { seed: number };
  grid: GridSpec;
}

export interface RiverNetworkOptions {
  /**
   * Swing the channel by a wave field read at the point's own position instead
   * of by distance along the stem. Arc length is measured from wherever the
   * trace happened to start, so two tiles tracing the same river disagree about
   * it; a position field is the same for both, which is what keeps a river
   * continuous across a tile boundary.
   */
  worldMeander?: boolean;
  /**
   * Bound the downstream-monotone water level pass to this many samples. The
   * unbounded pass reaches back to the head of the stem, which again is not the
   * same place for two tiles tracing the same river.
   */
  levelWindow?: number;
}

/** Cell-to-block mapping and array size for the tile the source belongs to. */
function frameOf(src: RiverSource) {
  const grid = src.grid;
  return {
    n: grid.size, len: grid.size * grid.size,
    worldX: (c: number) => (grid.originX + c) * CELL_BLOCKS,
    worldZ: (c: number) => (grid.originY + c) * CELL_BLOCKS,
    cellX: (w: number) => Math.round(w / CELL_BLOCKS) - grid.originX,
    cellY: (w: number) => Math.round(w / CELL_BLOCKS) - grid.originY,
  };
}
type Frame = ReturnType<typeof frameOf>;

/**
 * The generator's drainage tree is an 8-neighbour raster: every river runs in
 * 45-degree steps between cell centres. Tracing it back out of the mask also
 * splits the network at every confluence, so each stub gets smoothed on its own
 * and the joins end up kinked. Here the tree is turned into continuous
 * source-to-mouth curves instead, and those curves become the single source of
 * truth for both the water surface and the terrain that holds it.
 */

export interface RiverPoint {
  /** Block coordinates of the centreline. */
  x: number; z: number;
  /** Channel width and depth, in blocks. */
  width: number;
  depth: number;
  /** Absolute block Y of the water surface. */
  waterY: number;
}

export interface RiverStem {
  points: RiverPoint[];
  /** 0 = trunk reaching the sea or the map edge, 1+ = tributary. */
  order: number;
}

export interface RiverNetwork {
  stems: RiverStem[];
  /** Blocks. Sizes the bucket grid the field is looked up through. */
  maxWidth: number;
}

/** Blocks between samples along a stem. 15 m in the reference. */
const SAMPLE_STEP = 6;
/** Real meanders run about 11 channel widths per wave, 2-3 widths of swing. */
const MEANDER_WAVELENGTH = 11;
const MEANDER_AMPLITUDE = 2.2;

/** How near a tributary's mouth has to pass a trunk to be pulled onto it. */
const SNAP_RADIUS = 64;

export function buildRiverNetwork(src: RiverSource, lakes: Uint8Array, opts: RiverNetworkOptions = {}): RiverNetwork {
  const frame = frameOf(src);
  const cellStems = traceStems(src, lakes, frame);
  const stems: RiverStem[] = [];
  const finished = new Map<number, RiverPoint[]>();
  const bucketOf = (x: number, z: number) => Math.round(x / SNAP_RADIUS) * 65536 + Math.round(z / SNAP_RADIUS);
  let maxWidth = 0;

  // Trunks first: a tributary is snapped onto its parent's *final* curve, so
  // the parent has to be finished before the tributary is built.
  for (const stem of cellStems.sort((a, b) => a.order - b.order)) {
    const points = shapeStem(src, stem.cells, (x, z) => nearbyPoints(finished, bucketOf, x, z), frame, opts);
    if (points.length < 2) continue;
    for (const point of points) {
      maxWidth = Math.max(maxWidth, point.width);
      const key = bucketOf(point.x, point.z);
      const bucket = finished.get(key);
      if (bucket) bucket.push(point); else finished.set(key, [point]);
    }
    stems.push({ points, order: stem.order });
  }
  return { stems, maxWidth };
}

function nearbyPoints(finished: Map<number, RiverPoint[]>, bucketOf: (x: number, z: number) => number,
  x: number, z: number): RiverPoint[] {
  const out: RiverPoint[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const bucket = finished.get(bucketOf(x + dx * SNAP_RADIUS, z + dz * SNAP_RADIUS));
    if (bucket) out.push(...bucket);
  }
  return out;
}

interface CellStem { cells: number[]; order: number }

/**
 * Walk the drainage tree into continuous runs. Starting at each mouth and
 * always climbing into the highest-accumulation child gives the trunk from
 * source to mouth; whatever is left over becomes a tributary that terminates
 * exactly on the cell where it joins an already-claimed run.
 */
function traceStems(world: RiverSource, lakes: Uint8Array, frame: Frame): CellStem[] {
  const { len } = frame;
  const children: number[][] = [];
  const isRiver = (i: number) => world.rivers[i] === 1 && !world.sea[i] && !lakes[i];
  for (let i = 0; i < len; i++) {
    if (!isRiver(i)) continue;
    const parent = world.parent[i];
    if (parent < 0 || !isRiver(parent)) continue;
    (children[parent] ??= []).push(i);
  }

  const claimed = new Uint8Array(len);
  const stems: CellStem[] = [];

  /** Climb from `start` to a headwater, always taking the biggest branch. */
  const climb = (start: number): number[] => {
    const up: number[] = [start];
    let current = start;
    while (true) {
      const kids = children[current];
      if (!kids || !kids.length) break;
      let best = -1, bestFlow = -1;
      for (const kid of kids) {
        if (claimed[kid]) continue;
        if (world.accumulation[kid] > bestFlow) { bestFlow = world.accumulation[kid]; best = kid; }
      }
      if (best < 0) break;
      up.push(best);
      current = best;
    }
    return up.reverse();
  };

  // A mouth is a river cell draining into water, or one running off the map:
  // priorityFlood only writes parent === -1 for sea cells and border cells.
  const mouths: number[] = [];
  for (let i = 0; i < len; i++) {
    if (!isRiver(i)) continue;
    const parent = world.parent[i];
    if (parent < 0 || world.sea[parent] || lakes[parent]) mouths.push(i);
  }
  mouths.sort((a, b) => world.accumulation[b] - world.accumulation[a]);
  for (const mouth of mouths) {
    if (claimed[mouth]) continue;
    const cells = climb(mouth);
    for (const cell of cells) claimed[cell] = 1;
    if (cells.length >= 2) stems.push({ cells, order: 0 });
  }

  // Everything still unclaimed is a tributary. Take them biggest-first so a
  // major branch is not left hanging off a minor one.
  const rest: number[] = [];
  for (let i = 0; i < len; i++) if (isRiver(i) && !claimed[i]) rest.push(i);
  rest.sort((a, b) => world.accumulation[b] - world.accumulation[a]);
  for (const seed of rest) {
    if (claimed[seed]) continue;
    const cells = climb(seed);
    for (const cell of cells) claimed[cell] = 1;
    // Extend downstream to the junction so the tributary actually touches the
    // run it feeds instead of stopping a cell short.
    const parent = world.parent[cells[cells.length - 1]];
    if (parent >= 0 && isRiver(parent)) cells.push(parent);
    if (cells.length >= 2) stems.push({ cells, order: 1 });
  }
  return stems;
}

function shapeStem(world: RiverSource, cells: number[],
  nearby: (x: number, z: number) => RiverPoint[], frame: Frame, opts: RiverNetworkOptions): RiverPoint[] {
  const { n } = frame;
  const threshold = world.riverThreshold;
  const flowAt = (i: number) => Number.isFinite(threshold) && threshold > 0
    ? clamp(Math.log1p(world.accumulation[i] / threshold) / 3.4) : 0;

  // The reference's 14 m floor on the channel width survives the conversion:
  // these are the top few per cent of the drainage by discharge, so the
  // smallest of them is still a river rather than a ditch.
  const raw: RibbonPoint[] = cells.map(i => ({
    x: frame.worldX(i % n), z: frame.worldZ(Math.floor(i / n)), w: riverWidthBlocks(14 + flowAt(i) * 62),
  }));
  const depths = cells.map(i => riverDepthBlocks(2 + flowAt(i) * 5));
  // world.terrain and world.filled are the same array, so this is the bare
  // ground surface: the channel is cut below it rather than floated on top.
  const levels = cells.map(i => Math.max(SEA_LEVEL, unitsToHeight(world.filled[i], world.seaLevel)));

  const base = catmullRom(resamplePath(raw, SAMPLE_STEP), SAMPLE_STEP);
  if (base.length < 3) return [];

  // Per-sample depth and water level, carried across by arc-length fraction.
  const attr = alignAttributes(raw, base, depths, levels);
  const gates = meanderGate(world, base, frame, opts);
  const meandered = opts.worldMeander
    ? applyMeanderWorld(base, gates, world.params.seed)
    : applyMeander(base, gates, world.params.seed);
  const smoothed = catmullRom(
    limitCurvature(meandered, medianWidth(meandered) * 1.5, 19), SAMPLE_STEP);

  const points: RiverPoint[] = [];
  for (let k = 0; k < smoothed.length; k++) {
    const t = smoothed.length === 1 ? 0 : k / (smoothed.length - 1);
    const source = Math.min(attr.depth.length - 1, Math.round(t * (attr.depth.length - 1)));
    points.push({
      x: smoothed[k].x, z: smoothed[k].z, width: smoothed[k].w,
      depth: attr.depth[source], waterY: attr.level[source],
    });
  }
  smoothLevels(points, opts.levelWindow);
  snapToParent(points, nearby);
  // Snapping pins the mouth to the confluence it feeds, so that level is the
  // fixed one: anything upstream that now sits below it gets lifted, rather
  // than dragging the junction down away from the trunk.
  const lift = opts.levelWindow ?? points.length;
  for (let k = points.length - 2; k >= Math.max(0, points.length - 1 - lift); k--) {
    points[k].waterY = Math.max(points[k].waterY, points[k + 1].waterY);
  }
  return points;
}

/** Resampling changes the point count, so carry per-cell values by arc fraction. */
function alignAttributes(raw: RibbonPoint[], base: RibbonPoint[], depths: number[], levels: number[]) {
  const depth: number[] = [], level: number[] = [];
  for (let k = 0; k < base.length; k++) {
    const t = base.length === 1 ? 0 : k / (base.length - 1);
    const index = Math.min(raw.length - 1, Math.round(t * (raw.length - 1)));
    depth.push(depths[index]); level.push(levels[index]);
  }
  return { depth, level };
}

const medianWidth = (points: RibbonPoint[]) => {
  const widths = points.map(p => p.w).sort((a, b) => a - b);
  return widths[widths.length >> 1] || 4;
};

/**
 * Rivers only wander where there is room to wander. On a floodplain the gate is
 * open; in a steep valley it closes, and it tapers to nothing at both ends so
 * confluences stay put.
 */
function meanderGate(world: RiverSource, points: RibbonPoint[], frame: Frame, opts: RiverNetworkOptions): number[] {
  const { n } = frame;
  const gates: number[] = [];
  for (const point of points) {
    const x = Math.min(n - 1, Math.max(0, frame.cellX(point.x)));
    const y = Math.min(n - 1, Math.max(0, frame.cellY(point.z)));
    const i = y * n + x;
    const flat = clamp(1 - world.slope[i] / 0.014);
    const plain = world.landform[i] === 1 || world.landform[i] === 3 ? 1 : world.landform[i] === 2 ? 0.6 : 0.35;
    gates.push(flat * plain);
  }
  // The taper closes the swing at the stem's own ends so confluences stay put.
  // With a position-determined swing there is nothing to keep still — and the
  // ends of a stem are wherever this tile happened to clip it, so tapering
  // there would put a kink at every seam.
  if (!opts.worldMeander) {
    const taper = Math.min(12, Math.floor(gates.length / 3));
    for (let k = 0; k < taper; k++) {
      const ramp = k / taper;
      gates[k] *= ramp;
      gates[gates.length - 1 - k] *= ramp;
    }
  }
  return gates;
}

/**
 * The same wavelength (11 channel widths) and swing (2.2 widths) as
 * `applyMeander`, but read from a field in world space rather than from
 * distance along the stem. Three waves 60 degrees apart, because a single one
 * would leave rivers running along its direction unnaturally straight.
 */
function applyMeanderWorld(points: RibbonPoint[], gates: number[], seed: number): RibbonPoint[] {
  const base = hash2(0, 0, seed + 9311) * Math.PI * 2;
  const waves = [0, 1, 2].map(k => ({
    cos: Math.cos(base + k * Math.PI / 3), sin: Math.sin(base + k * Math.PI / 3),
    phase: hash2(k, 1, seed + 9311) * Math.PI * 2, phase2: hash2(k, 2, seed + 9319) * Math.PI * 2,
  }));
  const out: RibbonPoint[] = [];
  for (let k = 0; k < points.length; k++) {
    const point = points[k];
    const previous = points[Math.max(0, k - 1)], next = points[Math.min(points.length - 1, k + 1)];
    let tx = next.x - previous.x, tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length; tz /= length;
    const width = Math.max(point.w, 3.2);
    const long = MEANDER_WAVELENGTH * width, short = 4.5 * width;
    let swing = 0;
    for (const wave of waves) {
      const along = point.x * wave.cos + point.z * wave.sin;
      swing += MEANDER_AMPLITUDE / 3 * Math.sin(along / long * Math.PI * 2 + wave.phase)
        + 0.7 / 3 * Math.sin(along / short * Math.PI * 2 + wave.phase2);
    }
    const offset = gates[k] * width * swing;
    out.push({ x: point.x + -tz * offset, z: point.z + tx * offset, w: point.w });
  }
  return out;
}

function applyMeander(points: RibbonPoint[], gates: number[], seed: number): RibbonPoint[] {
  const phase = hash2(Math.round(points[0].x), Math.round(points[0].z), seed + 9311) * Math.PI * 2;
  const phase2 = hash2(Math.round(points[0].z), Math.round(points[0].x), seed + 9319) * Math.PI * 2;
  const out: RibbonPoint[] = [];
  let arc = 0;
  for (let k = 0; k < points.length; k++) {
    const point = points[k];
    if (k > 0) arc += Math.hypot(point.x - points[k - 1].x, point.z - points[k - 1].z);
    const previous = points[Math.max(0, k - 1)], next = points[Math.min(points.length - 1, k + 1)];
    let tx = next.x - previous.x, tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length; tz /= length;
    const width = Math.max(point.w, 3.2);
    const swing = MEANDER_AMPLITUDE * Math.sin(arc / (MEANDER_WAVELENGTH * width) * Math.PI * 2 + phase)
      + 0.7 * Math.sin(arc / (4.5 * width) * Math.PI * 2 + phase2);
    const offset = gates[k] * width * swing;
    out.push({ x: point.x + -tz * offset, z: point.z + tx * offset, w: point.w });
  }
  return out;
}

/** A water surface is smooth and never climbs downstream. */
function smoothLevels(points: RiverPoint[], window?: number) {
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k < points.length - 1; k++) {
      points[k].waterY = (points[k - 1].waterY + points[k].waterY * 2 + points[k + 1].waterY) * 0.25;
    }
  }
  if (window === undefined) {
    for (let k = 1; k < points.length; k++) {
      points[k].waterY = Math.min(points[k].waterY, points[k - 1].waterY);
    }
    return;
  }
  // A running minimum over a bounded reach instead: still monotone over any
  // stretch shorter than the window, but no longer a function of how far
  // upstream this particular trace happened to begin.
  const levels = points.map((point, k) => {
    let lowest = point.waterY;
    for (let j = Math.max(0, k - window); j < k; j++) lowest = Math.min(lowest, points[j].waterY);
    return lowest;
  });
  for (let k = 0; k < points.length; k++) points[k].waterY = levels[k];
}

/**
 * The trunk moved when it meandered, so a tributary computed against the
 * original raster would now end in mid-air. Pull its last points onto whichever
 * finished curve is nearest and blend the correction back upstream.
 */
function snapToParent(points: RiverPoint[], nearby: (x: number, z: number) => RiverPoint[]) {
  const tail = points[points.length - 1];
  let best: RiverPoint | null = null, bestDistance = Infinity;
  for (const candidate of nearby(tail.x, tail.z)) {
    const d = Math.hypot(candidate.x - tail.x, candidate.z - tail.z);
    if (d < bestDistance) { bestDistance = d; best = candidate; }
  }
  if (!best || bestDistance > SNAP_RADIUS) return;
  const dx = best.x - tail.x, dz = best.z - tail.z;
  const reach = Math.min(points.length, 24);
  for (let k = 0; k < reach; k++) {
    const index = points.length - 1 - k;
    const weight = 1 - k / reach;
    points[index].x += dx * weight;
    points[index].z += dz * weight;
  }
  tail.waterY = best.waterY;
}
