import type { RiverSample } from './riverField';

/**
 * The channel cross-section: a bed, banks rising to a shoulder, then a blend
 * back into whatever ground was already there.
 *
 * Ported from the reference generator's `src/river/carve.ts`, in blocks, with
 * one addition this game needs: `leveeHeight`. `channelHeight` only ever lowers
 * ground, which is right for a mesh — a river perched above its floodplain
 * simply looks odd there. Here the channel holds actual water, so a bank lower
 * than the water surface is a hole the river drains through.
 */

/** Smooth minimum. A plain `min` leaves a crease where the two surfaces meet,
 *  and that crease is exactly what makes a carved river look pasted on. */
export function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

const BLEND = 1.5;

/**
 * Height of the ground at `sample.distance` from the centreline, given the bare
 * terrain height there. Returns `base` untouched once outside the valley.
 */
export function channelHeight(sample: RiverSample, base: number): number {
  const half = sample.width * 0.5;
  const depth = sample.depth;
  const bed = sample.waterY - depth;
  const freeboard = 1 + depth * 0.25;
  const shoulder = sample.waterY + freeboard;
  // Only the channel and its immediate banks. Blending on out to a wide "valley"
  // pulls high ground down to river level, which gouges a flat trench through
  // every hillside the river passes; a bluff beside a river is correct.
  const bank = bankReach(sample);
  const d = sample.distance;

  if (d <= half) {
    // A shallow parabolic bed rather than a flat trench floor.
    const across = half > 1e-6 ? d / half : 0;
    return Math.min(base, bed + depth * 0.18 * across * across);
  }
  if (d <= half + bank) {
    const t = smoothstep((d - half) / bank);
    return smoothMin(base, bed + (shoulder - bed) * t, BLEND);
  }
  return base;
}

/** How far past the water's edge the banks reach. */
export const bankReach = (sample: RiverSample) => Math.max(2.5, sample.width * 0.6);

/**
 * The floor the bank has to stand at so the channel holds its water. Applied
 * after `channelHeight` and after everything else that shapes the ground, over
 * the bank corridor only, so a river crossing a hillside still has a bluff on
 * one side and a levee on the other rather than a flat trench.
 */
export function leveeHeight(sample: RiverSample, base: number): number {
  if (sample.distance <= sample.width * 0.5) return base;
  if (sample.distance > sample.width * 0.5 + bankReach(sample)) return base;
  return Math.max(base, sample.waterY + 1);
}

const smoothstep = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
