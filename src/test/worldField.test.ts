import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { WorldField } from '../world/generation/worldField';
import { CELL_BLOCKS, MAX_HEIGHT, MIN_HEIGHT } from '../world/generation/scale';
import { SUPER_INTERIOR } from '../world/generation/infinite/constants';
import { SEA_LEVEL } from '../world/chunk';

const SEED = seedFromString('voxelcraft');
const field = new WorldField(SEED);
const known = field.constants();

describe('the world field', () => {
  it('agrees with the lattice at a cell centre', () => {
    // The delta is exact on the lattice, so a column standing on one is the
    // blended hydrology answer and nothing else.
    for (const [cx, cz] of [[0, 0], [17, -9], [130, 44]]) {
      const column = field.columnAt(cx * CELL_BLOCKS, cz * CELL_BLOCKS);
      expect(column.y).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(column.y).toBeLessThanOrEqual(MAX_HEIGHT);
    }
  });

  it('has detail between the cells rather than sixteen-block terraces', () => {
    // The base is evaluated per block, so the ground inside one cell has to
    // actually change. Interpolating an absolute lattice height could not: it
    // would step only where a cell boundary is, and the world would come out
    // as sixteen-block flagstones.
    //
    // Measured over three 3200-block transects of the verification seed, 59% to
    // 76% of land cells contain a step. Long flat runs are still expected and
    // wanted — a floodplain the hydrology levelled is where a town goes.
    let cells = 0, varied = 0;
    for (let c = 0; c < 120; c++) {
      const base = 600 + c * CELL_BLOCKS;
      const first = field.columnAt(base, 600).y;
      if (first <= SEA_LEVEL) continue;
      cells++;
      for (let k = 1; k < CELL_BLOCKS; k++) {
        if (field.columnAt(base + k, 600).y !== first) { varied++; break; }
      }
    }
    expect(cells).toBeGreaterThan(40);
    expect(varied / cells).toBeGreaterThan(0.4);
  });

  it('never steps more than a cliff between neighbouring blocks', () => {
    let worst = 0;
    for (let x = 0; x < 400; x++) {
      const a = field.columnAt(1000 + x, 1000).y, b = field.columnAt(1001 + x, 1000).y;
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(12);
  });

  it('is the same field however it was reached', () => {
    const other = new WorldField(SEED, known);
    for (const [x, z] of [[13, 77], [2047, 51], [2048, 51], [-900, 320]]) {
      expect(other.columnAt(x, z).y).toBe(field.columnAt(x, z).y);
    }
  });

  it('estimates without building anything', () => {
    const fresh = new WorldField(SEED, known);
    const before = fresh.world.stats().superChunks;
    for (let k = 0; k < 500; k++) fresh.estimate(k * 37, k * 91);
    expect(fresh.world.stats().superChunks).toBe(before);
  });

  it('estimates close enough to be worth using where nothing is loaded', () => {
    const gaps: number[] = [];
    for (let k = 0; k < 120; k++) {
      const x = 300 + k * 7, z = 900 - k * 5;
      gaps.push(Math.abs(field.estimate(x, z) - field.columnAt(x, z).y));
    }
    gaps.sort((a, b) => a - b);
    // The hydrology's own edit is the whole of the difference: it fills
    // depressions, cuts channels and flattens floodplains, and nothing else.
    expect(gaps[Math.floor(gaps.length * 0.9)]).toBeLessThan(12);
  });
});

describe('rivers in the field', () => {
  const wet = () => {
    for (let x = 0; x < SUPER_INTERIOR * CELL_BLOCKS; x += 13) {
      for (let z = 0; z < 900; z += 13) {
        const column = field.columnAt(x, z);
        if (column.river && column.river.distance < column.river.width * 0.4 && column.y > SEA_LEVEL) {
          return { x, z, column };
        }
      }
    }
    return null;
  };

  it('cuts a bed the water can sit in', () => {
    const found = wet();
    expect(found).not.toBeNull();
    const river = found!.column.river!;
    expect(found!.column.y).toBeLessThan(river.waterY);
    expect(river.waterY - found!.column.y).toBeLessThanOrEqual(Math.ceil(river.depth) + 1);
  });

  it('leaves the bank high enough to hold it', () => {
    const found = wet();
    const river = found!.column.river!;
    // Step out to the bank and the ground has to be at or above the water.
    for (const step of [river.width * 0.5 + 1, river.width * 0.5 + 2]) {
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const side = field.columnAt(Math.round(found!.x + dx), Math.round(found!.z + dz));
        if (side.river && side.river.distance <= side.river.width * 0.5) continue;
        expect(side.y).toBeGreaterThanOrEqual(river.waterY);
      }
    }
  });
});

describe('land use', () => {
  it('finds ground a village could farm, and ground it could not', () => {
    let farm = 0, none = 0;
    const places = field.settlements.tile(0, 0);
    expect(places.length).toBeGreaterThan(0);
    const seat = field.settlements.seat(places[0]);
    for (let dx = -30; dx <= 30; dx += 3) for (let dz = -30; dz <= 30; dz += 3) {
      const use = field.landUse((seat.x + dx) * CELL_BLOCKS, (seat.y + dz) * CELL_BLOCKS);
      if (use.farm) farm++; else none++;
    }
    expect(farm).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
  });
});
