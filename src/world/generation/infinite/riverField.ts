import type { RiverNetwork } from './riverNetwork';

/**
 * Continuous distance to the nearest river centreline, with the channel's
 * dimensions at that point. Both the cell-resolution valley and the per-block
 * channel are cut from this, so the terrain and the water always agree.
 *
 * Ported from the reference generator's `src/river/field.ts`; lengths are in
 * blocks.
 */

export interface RiverSample {
  /** Blocks to the centreline. */
  distance: number;
  width: number;
  depth: number;
  /** Absolute block Y of the water surface. */
  waterY: number;
}

export interface RiverField {
  /** null when nothing is within reach, which is most of the map. */
  sample(x: number, z: number): RiverSample | null;
  /** How far the channel and its banks can influence the ground. */
  reach: number;
}

interface Segment {
  ax: number; az: number; bx: number; bz: number;
  width: number; depth: number;
  /** One level per end. A segment can span a weir, and averaging across one
   *  would put the water half a block into the ground on both sides of it. */
  waterA: number; waterB: number;
}

export function buildRiverField(network: RiverNetwork): RiverField {
  // One bucket per reach means a query only ever touches nine of them.
  const reach = Math.max(24, network.maxWidth * 3);
  const buckets = new Map<number, Segment[]>();
  const key = (bx: number, bz: number) => bx * 65536 + bz;
  const coord = (v: number) => Math.floor(v / reach);

  const add = (bx: number, bz: number, segment: Segment) => {
    const id = key(bx, bz);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(segment); else buckets.set(id, [segment]);
  };
  for (const stem of network.stems) {
    for (let k = 1; k < stem.points.length; k++) {
      const a = stem.points[k - 1], b = stem.points[k];
      const segment: Segment = {
        ax: a.x, az: a.z, bx: b.x, bz: b.z,
        width: (a.width + b.width) * 0.5,
        depth: (a.depth + b.depth) * 0.5,
        waterA: a.waterY, waterB: b.waterY,
      };
      // A segment can straddle buckets, so register it in every one it touches.
      const lo = coord(Math.min(a.x, b.x)), hi = coord(Math.max(a.x, b.x));
      const loZ = coord(Math.min(a.z, b.z)), hiZ = coord(Math.max(a.z, b.z));
      for (let bz = loZ; bz <= hiZ; bz++) for (let bx = lo; bx <= hi; bx++) add(bx, bz, segment);
    }
  }

  const sample = (x: number, z: number): RiverSample | null => {
    const bx = coord(x), bz = coord(z);
    let best: Segment | null = null, bestSq = Infinity, bestT = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const bucket = buckets.get(key(bx + dx, bz + dz));
      if (!bucket) continue;
      for (const segment of bucket) {
        const ex = segment.bx - segment.ax, ez = segment.bz - segment.az;
        const lengthSq = ex * ex + ez * ez;
        const t = lengthSq < 1e-9 ? 0
          : Math.max(0, Math.min(1, ((x - segment.ax) * ex + (z - segment.az) * ez) / lengthSq));
        const ddx = segment.ax + ex * t - x, ddz = segment.az + ez * t - z;
        const sq = ddx * ddx + ddz * ddz;
        if (sq < bestSq) { bestSq = sq; best = segment; bestT = t; }
      }
    }
    if (!best) return null;
    // Nearest end rather than an interpolation: the levels are whole blocks and
    // the step between two of them belongs at the midpoint of the segment.
    const waterY = bestT < 0.5 ? best.waterA : best.waterB;
    return { distance: Math.sqrt(bestSq), width: best.width, depth: best.depth, waterY };
  };

  return { sample, reach };
}
