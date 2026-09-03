import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { paramsFor } from '../world/generation/infinite/params';
import { createInfiniteWorld } from '../world/generation/infinite/world';
import { buildChunkRivers, quantiseLevels, stitchStems } from '../world/generation/infinite/riverTiles';
import { buildRiverField } from '../world/generation/infinite/riverField';
import { bankReach, channelHeight, leveeHeight } from '../world/generation/infinite/riverCarve';
import { CELL_BLOCKS } from '../world/generation/scale';
import { SUPER_INTERIOR } from '../world/generation/infinite/constants';
import { SEA_LEVEL } from '../world/chunk';

const SEED = seedFromString('voxelcraft');
const world = createInfiniteWorld(paramsFor(SEED));
const stemsOf = (tx: number, ty: number) => quantiseLevels(stitchStems(buildChunkRivers(world.superChunk(tx, ty))));
const stems = stemsOf(0, 0);

describe('river curves', () => {
  it('finds rivers in the tile it was asked about', () => {
    expect(stems.length).toBeGreaterThan(3);
    expect(stems.some(s => s.points.length > 20)).toBe(true);
  });

  it('gives them a cross-section a player would recognise', () => {
    const widths: number[] = [], depths: number[] = [];
    for (const stem of stems) for (const point of stem.points) { widths.push(point.width); depths.push(point.depth); }
    widths.sort((a, b) => a - b); depths.sort((a, b) => a - b);
    // Blocks. A 30-wide, 3-deep channel is a flooded field, not a river.
    expect(widths[0]).toBeGreaterThanOrEqual(3);
    expect(widths[widths.length - 1]).toBeLessThan(22);
    expect(depths[0]).toBeGreaterThanOrEqual(2);
    expect(depths[depths.length - 1]).toBeLessThan(7);
    expect(widths[widths.length - 1] / depths[depths.length - 1]).toBeGreaterThan(2.5);
  });

  it('keeps every piece inside the tile that owns it', () => {
    const lo = 0, hi = SUPER_INTERIOR * CELL_BLOCKS;
    for (const stem of stems) {
      // One sample of overhang each side is deliberate, so allow a stem's ends
      // out but not its middle.
      for (let k = 1; k < stem.points.length - 1; k++) {
        expect(stem.points[k].x).toBeGreaterThan(lo - CELL_BLOCKS * 8);
        expect(stem.points[k].x).toBeLessThan(hi + CELL_BLOCKS * 8);
      }
    }
  });

  it('puts every water surface on a whole block and never lets it climb', () => {
    for (const stem of stems) {
      let previous = Infinity;
      for (const point of stem.points) {
        expect(Number.isInteger(point.waterY)).toBe(true);
        expect(point.waterY).toBeLessThanOrEqual(previous);
        expect(point.waterY).toBeGreaterThanOrEqual(SEA_LEVEL);
        previous = point.waterY;
      }
    }
  });

  it('makes flat pools rather than a staircase', () => {
    // A pool per weir, not a ledge every sample. Anything approaching one drop
    // per sample means the levels were rounded per column after all.
    let drops = 0, samples = 0;
    for (const stem of stems) {
      for (let k = 1; k < stem.points.length; k++) {
        samples++;
        if (stem.points[k].waterY < stem.points[k - 1].waterY) drops++;
      }
    }
    expect(samples).toBeGreaterThan(100);
    expect(drops / samples).toBeLessThan(0.34);
  });

  it('is the same river however many other tiles have been built', () => {
    world.superChunk(3, 3); world.superChunk(-1, 2); world.superChunk(4, 1);
    const again = stemsOf(0, 0);
    expect(again.length).toBe(stems.length);
    expect(again[0].points.map(p => [p.x, p.z, p.waterY])).toEqual(stems[0].points.map(p => [p.x, p.z, p.waterY]));
  });
});

describe('the channel cross-section', () => {
  const field = buildRiverField({ stems, maxWidth: 20 });

  it('reaches only as far as the banks', () => {
    let found = 0;
    for (const stem of stems) for (const point of stem.points) {
      const sample = field.sample(point.x, point.z);
      if (!sample) continue;
      found++;
      expect(sample.distance).toBeLessThan(2);
      // Well outside the corridor the ground is left exactly as it was.
      const far = { ...sample, distance: sample.width * 0.5 + bankReach(sample) + 1 };
      expect(channelHeight(far, 90)).toBe(90);
    }
    expect(found).toBeGreaterThan(50);
  });

  it('cuts a bed below the water and never raises the ground', () => {
    for (const stem of stems.slice(0, 4)) for (const point of stem.points.slice(0, 12)) {
      const sample = field.sample(point.x, point.z);
      if (!sample) continue;
      // The sample's own numbers, not the point's: the field answers with the
      // segment's dimensions and the nearer end's level.
      const bed = channelHeight({ ...sample, distance: 0 }, sample.waterY + 30);
      expect(bed).toBeCloseTo(sample.waterY - sample.depth, 6);
      // Ground already lower than the channel is left alone: a river does not
      // fill a valley it happens to run past.
      expect(channelHeight({ ...sample, distance: 0 }, 0)).toBeLessThanOrEqual(0);
    }
  });

  it('lifts a bank that would let the water out', () => {
    const sample = { distance: 6, width: 8, depth: 4, waterY: 60 };
    expect(leveeHeight(sample, 50)).toBe(61);
    expect(leveeHeight(sample, 70)).toBe(70);
    // Not in the bed, and not out past the banks.
    expect(leveeHeight({ ...sample, distance: 1 }, 50)).toBe(50);
    expect(leveeHeight({ ...sample, distance: 40 }, 50)).toBe(50);
  });
});

describe('rivers across a super-chunk seam', () => {
  it('are continued by the neighbour rather than stopping at the line', () => {
    const here = stems, there = stemsOf(1, 0);
    const seam = SUPER_INTERIOR * CELL_BLOCKS;
    const nearSeam = (list: typeof here, side: number) => list.flatMap(s => s.points)
      .filter(p => Math.abs(p.x - seam) < CELL_BLOCKS * 3 && (side < 0 ? p.x <= seam : p.x >= seam));
    const left = nearSeam(here, -1), right = nearSeam(there, 1);
    expect(left.length).toBeGreaterThan(0);
    let matched = 0;
    for (const a of left) {
      if (right.some(b => Math.hypot(a.x - b.x, a.z - b.z) < CELL_BLOCKS * 4)) matched++;
    }
    expect(matched / left.length).toBeGreaterThan(0.6);
  });
});
