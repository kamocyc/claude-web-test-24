import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { fbm, hash2 } from '../world/generation/infinite/grid';
import { paramsFor } from '../world/generation/infinite/params';
import { calibrateTerrain } from '../world/generation/infinite/calibrate';
import { terrainSampler } from '../world/generation/infinite/terrain';
import { createInfiniteWorld } from '../world/generation/infinite/world';
import { sampleGround, tileRange, tileWeight } from '../world/generation/infinite/ground';
import { SUPER_HALO, SUPER_INTERIOR } from '../world/generation/infinite/constants';
import { MAX_HEIGHT, MIN_HEIGHT, SEA_FLOOR_Y, unitsToHeight, unitsToY } from '../world/generation/scale';
import { SEA_LEVEL } from '../world/chunk';

/** One world, shared: a super-chunk takes a second to build and every case here
 *  wants the same one. `vitest.config.ts` runs without isolation, so this is a
 *  module-level fixture rather than a `beforeEach`. */
const SEED = seedFromString('voxelcraft');
const params = paramsFor(SEED);
const world = createInfiniteWorld(params);
const sampler = terrainSampler(params, world.constants);

describe('the ported noise', () => {
  // Taken from the reference generator's own `src/generator/grid.ts`, run
  // standalone. The terrain *is* this function, so a change here is a different
  // world however reasonable it looks.
  it('matches the reference bit for bit', () => {
    expect(fbm(1.5, 2.5, 42, 5)).toBe(0.2918596610175076);
    expect(fbm(-3.25, 0.125, 12345, 4)).toBe(0.10661507739626935);
    expect(fbm(0, 0, 7, 3)).toBe(-0.6466193361316388);
    expect(fbm(101.75, -47.5, 999, 2)).toBe(0.19556278253470963);
    expect(hash2(17, -5, 99)).toBe(0.5800287887873196);
  });
});

describe('calibration', () => {
  it('is a property of the world, not of what has been built', () => {
    const again = calibrateTerrain(paramsFor(SEED));
    expect(again).toEqual(world.constants);
  });

  it('differs between seeds', () => {
    const other = calibrateTerrain(paramsFor(seedFromString('somewhere else')));
    expect(other.seaLevel).not.toBe(world.constants.seaLevel);
  });
});

describe('the height field', () => {
  it('is a pure function of the world cell', () => {
    const before = sampler.height(37, -19);
    world.superChunk(1, 1);
    world.superChunk(-2, 3);
    expect(sampler.height(37, -19)).toBe(before);
  });

  it('is what the super-chunk array was filled from', () => {
    const chunk = world.superChunk(0, 0);
    const n = chunk.grid.size;
    for (const [x, y] of [[70, 70], [128, 90], [191, 200]]) {
      const wx = chunk.grid.originX + x, wy = chunk.grid.originY + y;
      // The array is Float32; the sampler is double. `fround` is the only
      // difference there is allowed to be.
      expect(Math.fround(sampler.height(wx, wy))).toBe(Math.fround(chunk.terrain[y * n + x]));
    }
  });

  it('rebuilds a super-chunk byte for byte after it has been evicted', () => {
    const first = world.superChunk(0, 0).terrain.slice();
    // The cache holds two, so three more builds evict it.
    world.superChunk(4, 4); world.superChunk(5, 4); world.superChunk(4, 5);
    expect(Array.from(world.superChunk(0, 0).terrain)).toEqual(Array.from(first));
  });
});

describe('super-chunk seams', () => {
  const cells: Array<[number, number]> = [];
  for (let k = 0; k < 24; k++) cells.push([SUPER_INTERIOR - 3 + (k % 7), 40 + k * 3]);

  it('let two neighbours agree about the ground they share', () => {
    const resolve = (tx: number, ty: number) => world.superChunk(tx, ty);
    let worst = 0, seaDisagreements = 0;
    for (const [cx, cy] of cells) {
      const [txLo, txHi] = tileRange(cx, cx);
      if (txLo === txHi) continue;
      const heights: number[] = [], seas: boolean[] = [];
      for (let tx = txLo; tx <= txHi; tx++) {
        if (tileWeight(tx, cx) <= 0) continue;
        const chunk = resolve(tx, 0);
        const n = chunk.grid.size;
        const at = (cy - chunk.grid.originY) * n + (cx - chunk.grid.originX);
        heights.push(chunk.terrain[at]);
        seas.push(chunk.sea[at] === 1);
      }
      if (heights.length < 2) continue;
      worst = Math.max(worst, Math.max(...heights) - Math.min(...heights));
      if (seas.some(s => s !== seas[0])) seaDisagreements++;
    }
    // Terrain units. The blend absorbs what is left; what must never happen is
    // one tile calling a cell sea and the other calling it hillside.
    expect(worst).toBeLessThan(0.03);
    expect(seaDisagreements).toBe(0);
  });

  it('hand the ground over smoothly rather than in a step', () => {
    const resolve = (tx: number, ty: number) => world.superChunk(tx, ty);
    let worst = 0;
    for (let cx = SUPER_INTERIOR - 24; cx <= SUPER_INTERIOR + 24; cx++) {
      const a = sampleGround(resolve, cx, 60).height;
      const b = sampleGround(resolve, cx + 1, 60).height;
      worst = Math.max(worst, Math.abs(unitsToHeight(b, world.constants.seaLevel) - unitsToHeight(a, world.constants.seaLevel)));
    }
    // Blocks, per cell. A seam that stepped would show up here as a cliff
    // sixteen blocks long running north-south through open country.
    expect(worst).toBeLessThan(14);
  });
});

describe('drainage', () => {
  it('gives every interior land cell somewhere for its water to go', () => {
    const chunk = world.superChunk(0, 0);
    const n = chunk.grid.size;
    let sinks = 0, uphill = 0;
    for (let y = SUPER_HALO; y < n - SUPER_HALO; y++) for (let x = SUPER_HALO; x < n - SUPER_HALO; x++) {
      const i = y * n + x;
      if (chunk.sea[i]) continue;
      const parent = chunk.parent[i];
      if (parent < 0) { sinks++; continue; }
      if (chunk.filled[parent] > chunk.filled[i] + 1e-6) uphill++;
    }
    expect(sinks).toBe(0);
    expect(uphill).toBe(0);
  });

  it('cuts rivers, but not everywhere', () => {
    const chunk = world.superChunk(0, 0);
    let rivers = 0, cells = 0;
    const n = chunk.grid.size;
    for (let y = SUPER_HALO; y < n - SUPER_HALO; y++) for (let x = SUPER_HALO; x < n - SUPER_HALO; x++) {
      cells++;
      if (chunk.rivers[y * n + x]) rivers++;
    }
    expect(rivers / cells).toBeGreaterThan(0.005);
    expect(rivers / cells).toBeLessThan(0.09);
  });
});

describe('the sea', () => {
  it('covers roughly the share of the world it was asked for', () => {
    let wet = 0, total = 0;
    for (let y = -4000; y <= 4000; y += 97) for (let x = -4000; x <= 4000; x += 97) {
      total++;
      if (sampler.height(x, y) <= world.constants.seaLevel) wet++;
    }
    expect(Math.abs(wet / total - params.sea)).toBeLessThan(0.08);
  });
});

describe('the vertical mapping', () => {
  const seaLevel = world.constants.seaLevel;

  it('puts the calibrated sea level at the block sea level', () => {
    expect(unitsToY(seaLevel, seaLevel)).toBe(SEA_LEVEL);
  });

  it('is monotone and stays inside the world', () => {
    let previous = -Infinity;
    for (let u = -1.5; u <= 2.5; u += 0.005) {
      const y = unitsToHeight(u + seaLevel, seaLevel);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
      expect(unitsToY(u + seaLevel, seaLevel)).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(unitsToY(u + seaLevel, seaLevel)).toBeLessThanOrEqual(MAX_HEIGHT);
    }
  });

  it('approaches the ceiling and the sea floor rather than flattening onto them', () => {
    // A hard clamp turns the top few per cent of a mountain range into a mesa.
    expect(unitsToHeight(seaLevel + 1.2, seaLevel)).toBeLessThan(MAX_HEIGHT);
    expect(unitsToHeight(seaLevel + 1.2, seaLevel)).toBeGreaterThan(MAX_HEIGHT - 6);
    expect(unitsToHeight(seaLevel - 1.2, seaLevel)).toBeGreaterThan(SEA_FLOOR_Y);
    expect(unitsToHeight(seaLevel - 1.2, seaLevel)).toBeLessThan(SEA_FLOOR_Y + 6);
  });

  it('leaves the terrain the room the old world had', () => {
    const chunk = world.superChunk(0, 0);
    const n = chunk.grid.size;
    let highest = 0, clamped = 0, land = 0;
    for (let y = SUPER_HALO; y < n - SUPER_HALO; y++) for (let x = SUPER_HALO; x < n - SUPER_HALO; x++) {
      const i = y * n + x;
      if (chunk.sea[i]) continue;
      land++;
      const h = unitsToY(chunk.terrain[i], seaLevel);
      if (h > highest) highest = h;
      if (h >= MAX_HEIGHT) clamped++;
    }
    expect(highest - SEA_LEVEL).toBeGreaterThan(40);
    expect(clamped / land).toBeLessThan(0.001);
  });
});
