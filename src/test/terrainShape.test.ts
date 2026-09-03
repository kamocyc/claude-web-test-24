import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { SEA_LEVEL } from '../world/chunk';
import { VILLAGE_CELL_BLOCKS } from '../world/generation/villageSites';
import { OUTCROPS, outcropIn } from '../world/generation/features';

/** What the terrain generation was tuned *for*, kept as numbers rather than as an
 *  impression of a screenshot.
 *
 *  Every "before" in this file is a real measurement, taken with exactly the sweeps
 *  below, of one of the two generators this world has had: the noise-stack one that
 *  came first, and the port of the reference generator's infinite mode that replaced
 *  it. The point of writing them down is that the next person to retune a shaping
 *  constant can see what was traded for what. */
const SEEDS = [2061350291, 1, 4242, 99, 31337];

/** How far the ground rises and falls over a window `r` blocks across, on a 5x5 of
 *  samples. A town needs about this much room, so it is the scale the flat/steep split is
 *  worth measuring at — a one-block window says nothing about whether you could build. */
function relief(gen: TerrainGenerator, x: number, z: number, r: number): number {
  let min = Infinity;
  let max = -Infinity;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const h = gen.rawHeight(x + (i * r) / 2, z + (j * r) / 2);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return max - min;
}

/** Land columns on a wide grid, and the relief around each. Strided rather than
 *  contiguous: features are hundreds of blocks across, so a solid block of ground would
 *  measure one valley rather than the world. */
function landReliefs(gen: TerrainGenerator, r: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < 90; j++) {
    for (let i = 0; i < 90; i++) {
      const x = (i - 45) * 53;
      const z = (j - 45) * 53;
      if (gen.rawHeight(x, z) <= SEA_LEVEL + 1) continue;
      out.push(relief(gen, x, z, r));
    }
  }
  return out;
}

describe('terrain shape', () => {
  /** Most of the land has to be ground a town could stand on.
   *
   *  This replaces a test that asserted the *opposite* shape: that land was either flat
   *  (>50% at four blocks of relief or less) or mountain (>12% at twenty-four or more)
   *  with very little in between. That bimodality was the noise-stack generator's — a
   *  ridged multifractal gated on an erosion field, which produced spikes. The terrain
   *  here is carved by a drainage solution instead, and eroded ground is not spiky: over
   *  the same five seeds and the same sweep, *no* land at all reaches twenty-four blocks
   *  of relief over a sixteen-block window, and the share below four fell from 50-76% to
   *  44-66% as the sub-cell relief in `relief.ts` broke the slopes up.
   *
   *  That is a deliberate change of character, not a regression, so what is pinned now
   *  is what the world is actually for: enough flat country to build in, and mountains
   *  that get their height by rising a long way rather than by rising steeply. */
  it('keeps most of the land flat enough to build a town on', () => {
    for (const seed of SEEDS) {
      const reliefs = landReliefs(new TerrainGenerator(seed), 16);
      expect(reliefs.length, `seed ${seed} found no land`).toBeGreaterThan(3000);
      const share = (pred: (r: number) => boolean) =>
        reliefs.filter(pred).length / reliefs.length;
      // 44% to 66% measured.
      expect(share((r) => r <= 4), `seed ${seed} flat share`).toBeGreaterThan(0.35);
      // And it is not *all* flat: something has to be worth climbing.
      expect(share((r) => r > 8), `seed ${seed} rolling share`).toBeGreaterThan(0.05);
    }
  });

  /** The drainage solution flattens a floodplain and cuts a valley; ground beside a
   *  river should therefore be measurably more level than ground away from one. This is
   *  the shape the old generator could not make at all, and the reason for the port. */
  it('levels the ground along a river', () => {
    const gen = new TerrainGenerator(2061350291);
    const near: number[] = [];
    const far: number[] = [];
    for (let z = -600; z <= 600; z += 24) {
      for (let x = -600; x <= 600; x += 24) {
        const column = gen.field.columnAt(x, z);
        if (column.y <= SEA_LEVEL + 1) continue;
        const r = relief(gen, x, z, 16);
        // `riverDistance` is in cells, so four of them is about sixty blocks.
        if (column.riverDistance <= 4) near.push(r); else if (column.riverDistance > 12) far.push(r);
      }
    }
    expect(near.length, 'the sweep found no river').toBeGreaterThan(60);
    expect(far.length, 'the sweep found no interfluve').toBeGreaterThan(60);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(near)).toBeLessThan(mean(far));
  });

  /** The sea has to come out at the share the world was calibrated for.
   *
   *  The stride is 970 blocks, not 97. What decides where the coasts are is a very low
   *  frequency mask with a wavelength around 24000 blocks, so a sweep spanning 19000
   *  blocks measures one continent or one ocean and reports 9% or 63% depending on which
   *  it landed in. Widening the stride ten times makes it a measurement of the world. */
  it('keeps the sea the share of the world it was calibrated for', () => {
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      let ocean = 0;
      let total = 0;
      for (let j = 0; j < 200; j++) {
        for (let i = 0; i < 200; i++) {
          total++;
          if (gen.rawHeight((i - 100) * 970, (j - 100) * 970) < SEA_LEVEL) ocean++;
        }
      }
      // `WORLD_PARAMS.sea` is 0.24; measured 19.1% to 27.8% over these five seeds.
      expect(ocean / total, `seed ${seed} ocean share`).toBeGreaterThan(0.17);
      expect(ocean / total, `seed ${seed} ocean share`).toBeLessThan(0.30);
    }
  });

  /** Mountains have to actually spend the height the lower sea paid for, or the rewrite
   *  bought nothing. Also the other way round: a world that clamps against the roof is a
   *  world of flat-topped mesas. */
  it('lets peaks use the height the world has, without flattening against the roof', () => {
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      let highest = 0;
      let clamped = 0;
      let total = 0;
      for (let j = 0; j < 140; j++) {
        for (let i = 0; i < 140; i++) {
          const h = gen.rawHeight((i - 70) * 37, (j - 70) * 37);
          total++;
          highest = Math.max(highest, h);
          if (h >= 116) clamped++;
        }
      }
      // 82 blocks between the sea and the ceiling, and the tallest ground reaches
      // 69 to 82 of them. `unitsToHeight` bends towards the ceiling rather than
      // clamping against it precisely so the summits keep a gradient; the clamped
      // share measures whether that is still true, and runs to 0.3% at worst.
      expect(highest - SEA_LEVEL, `seed ${seed} tallest ground`).toBeGreaterThan(60);
      expect(clamped / total, `seed ${seed} clamped share`).toBeLessThan(0.01);
    }
  });

  /** Chunks are generated independently, on any thread, in any order — so the surface has
   *  to be continuous by construction, `height()` being a pure function of world
   *  coordinates with nothing chunk-local in it. A seam would show up as steps across a
   *  chunk border that are bigger than the steps inside one.
   *
   *  The old version of this test asserted a flat `|Δh| <= 6` over forty columns near the
   *  origin of one seed. That was never a bound — the generator it was written for already
   *  produced steps of 9 elsewhere in the world — so it is swept properly here instead,
   *  and the ceiling is the measured maximum plus headroom rather than a hopeful number. */
  it('has no seam at a chunk border, and no cliffs anywhere', () => {
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      let worstBorder = 0;
      let worstInside = 0;
      for (let z = -900; z < 900; z += 7) {
        for (let x = -900; x < 900; x++) {
          const step = Math.abs(gen.rawHeight(x + 1, z) - gen.rawHeight(x, z));
          // x+1 crosses into the next chunk exactly when x is the last column of one.
          if (((x % 16) + 16) % 16 === 15) worstBorder = Math.max(worstBorder, step);
          else worstInside = Math.max(worstInside, step);
        }
      }
      expect(worstBorder, `seed ${seed} border step`).toBeLessThanOrEqual(worstInside);
      // Measured maximum is 2. The generator this replaced reached 10: its ridges were
      // noise and could turn over in a block, where these are cut by water and cannot.
      expect(worstInside, `seed ${seed} worst step`).toBeLessThanOrEqual(6);
    }
  });
});

describe('village density', () => {
  /** Terrain changed twice; how many towns there are did not. That is a requirement
   *  rather than an accident — the road reaches in `src/game/roads.ts`, the hamlet
   *  spacing in `src/game/outpost.ts` and the quest chain all assume it — and it is not
   *  one anybody can eyeball, so it is measured.
   *
   *  It is also what sets `WORLD_PARAMS.settlement`. The lattice offers sites and
   *  `villageSites.ts` refuses about two thirds of them on biome, height and flatness,
   *  so the density cannot be read off the spacing arithmetic; it has to be swept. */
  it('puts as many villages on the map as the old generator did', () => {
    let villages = 0;
    let cells = 0;
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      for (let cz = -18; cz <= 18; cz++) {
        for (let cx = -18; cx <= 18; cx++) {
          cells++;
          villages += gen.villagesAround(
            cx * VILLAGE_CELL_BLOCKS + VILLAGE_CELL_BLOCKS / 2,
            cz * VILLAGE_CELL_BLOCKS + VILLAGE_CELL_BLOCKS / 2,
            0,
          ).length;
        }
      }
    }
    const perMillion = (villages / (cells * VILLAGE_CELL_BLOCKS * VILLAGE_CELL_BLOCKS)) * 1e6;
    // 1.722 per million square blocks under the noise-stack generator, over these same
    // seeds and this same sweep; 1.509 under the port.
    expect(perMillion).toBeGreaterThan(1.3);
    expect(perMillion).toBeLessThan(1.9);
  });

  /** Two towns closer together than this would be two plateaus overlapping.
   *
   *  The old grid had no real floor: a cell put its town anywhere inside an inset box, so
   *  two neighbours could end up 144 blocks apart. The lattice thins on a strict radius
   *  and only `seatAt` can eat into it, by at most `SEAT_REACH` cells from each side —
   *  measured, the closest pair over five seeds is 195 blocks. */
  it('never puts two villages on top of each other', () => {
    for (const seed of SEEDS) {
      const all = new TerrainGenerator(seed).villagesAround(0, 0, 6);
      expect(all.length).toBeGreaterThan(10);
      for (const a of all) {
        for (const b of all) {
          if (a === b) continue;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `seed ${seed}`).toBeGreaterThanOrEqual(160);
        }
      }
    }
  });
});

describe('outcrops', () => {
  /** Half as many places worth sinking a mine, which is the whole of "fewer mines": each
   *  one found is still exactly as rich, there are simply half as many to find. */
  it('breaks the surface half as often as it used to', () => {
    let hits = 0;
    let chunks = 0;
    for (const seed of SEEDS) {
      for (let cz = -30; cz <= 30; cz++) {
        for (let cx = -30; cx <= 30; cx++) {
          chunks++;
          if (outcropIn(seed, cx, cz)) hits++;
        }
      }
    }
    const rate = hits / chunks;
    // 8.5% of chunks before (0.05 coal + 0.035 iron); 4.3% now.
    expect(rate).toBeGreaterThan(0.035);
    expect(rate).toBeLessThan(0.05);
    expect(OUTCROPS.reduce((sum, spec) => sum + spec.chance, 0)).toBeCloseTo(0.043, 3);
  });
});
