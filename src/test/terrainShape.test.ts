import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { SEA_LEVEL } from '../world/chunk';
import { VILLAGE_CELL } from '../world/generation/village';
import { OUTCROPS, outcropIn } from '../world/generation/features';

/** What the terrain generation was retuned *for*, kept as numbers rather than as an
 *  impression of a screenshot.
 *
 *  Every "before" in this file is a real measurement of the generator that came before
 *  this one — a sum of four noise fields, all of them at three times these frequencies —
 *  taken with exactly the sweeps below. The point of writing them down is that the next
 *  person to retune the shaping constants can see what was traded for what. */
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
  /** The whole point of the rewrite: land is either flat enough to put a town on or steep
   *  enough to be a mountain, and very little of it is the shallow rolling bumps that used
   *  to be most of the world. Both tails are asserted, because either one on its own is
   *  satisfied by terrain that is uniformly boring in one direction. */
  it('splits the land into flat country and steep country', () => {
    for (const seed of SEEDS) {
      const reliefs = landReliefs(new TerrainGenerator(seed), 16);
      expect(reliefs.length, `seed ${seed} found no land`).toBeGreaterThan(3000);
      const share = (pred: (r: number) => boolean) =>
        reliefs.filter(pred).length / reliefs.length;

      // Flat enough to build on. Was 20-22% before, and every bit of the rest carried the
      // old unconditional `detail * 2` roughness, so even a "plain" was never level.
      expect(share((r) => r <= 4), `seed ${seed} flat share`).toBeGreaterThan(0.5);
      // Mountain. Was 24%.
      expect(share((r) => r >= 24), `seed ${seed} steep share`).toBeGreaterThan(0.12);
      // The middle, which is what used to be the world: 46-48% before.
      expect(share((r) => r > 4 && r < 16), `seed ${seed} middling share`).toBeLessThan(0.2);
    }
  });

  /** Lowering the sea from 46 to 34 was supposed to buy height for the mountains, not to
   *  drain the oceans, so the share of the map under water has to come out where it was.
   *  Measured on a stride wide enough to cross several continents. */
  it('keeps the oceans the size they were after lowering the sea', () => {
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      let ocean = 0;
      let total = 0;
      for (let j = 0; j < 200; j++) {
        for (let i = 0; i < 200; i++) {
          total++;
          if (gen.rawHeight((i - 100) * 97, (j - 100) * 97) < SEA_LEVEL) ocean++;
        }
      }
      // 23.8% before, on this same sweep.
      expect(ocean / total, `seed ${seed} ocean share`).toBeGreaterThan(0.2);
      expect(ocean / total, `seed ${seed} ocean share`).toBeLessThan(0.28);
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
      // Before the rewrite the sea was at 46 and the ceiling the same 116, so a peak had
      // 70 blocks to work with. It has 82 now, and the tallest ground reaches most of it.
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
      // Measured maximum is 10, the same as the generator this replaced.
      expect(worstInside, `seed ${seed} worst step`).toBeLessThanOrEqual(14);
    }
  });
});

describe('village density', () => {
  /** Terrain changed; how many towns there are did not. That is a requirement rather than
   *  an accident, and it is not one anybody can eyeball, so it is measured.
   *
   *  A cell used to stake its town on one hashed point and go without whenever that point
   *  landed badly. It now picks the best of `VILLAGE_TRIES`, which finds far more usable
   *  ground — so `VILLAGE_CHANCE` had to come down from 0.62 to 0.38 to land back on the
   *  same number of towns per square of world. Change either of those and re-run this. */
  it('puts as many villages on the map as the old generator did', () => {
    let villages = 0;
    let cells = 0;
    for (const seed of SEEDS) {
      const gen = new TerrainGenerator(seed);
      for (let cz = -18; cz <= 18; cz++) {
        for (let cx = -18; cx <= 18; cx++) {
          cells++;
          villages += gen.villagesAround(
            cx * VILLAGE_CELL + VILLAGE_CELL / 2,
            cz * VILLAGE_CELL + VILLAGE_CELL / 2,
            0,
          ).length;
        }
      }
    }
    const perMillion = (villages / (cells * VILLAGE_CELL * VILLAGE_CELL)) * 1e6;
    // 1.722 villages per million square blocks before the rewrite, over these same seeds
    // and this same sweep. Measured 1.732 after.
    expect(perMillion).toBeGreaterThan(1.55);
    expect(perMillion).toBeLessThan(1.90);
  });

  /** Two towns closer together than this would be two plateaus overlapping. The candidate
   *  search may move a town anywhere inside its cell's inset box, so the floor is worth
   *  asserting rather than assuming. */
  it('never puts two villages on top of each other', () => {
    for (const seed of SEEDS) {
      const all = new TerrainGenerator(seed).villagesAround(0, 0, 6);
      expect(all.length).toBeGreaterThan(10);
      for (const a of all) {
        for (const b of all) {
          if (a === b) continue;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `seed ${seed}`).toBeGreaterThanOrEqual(144);
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
