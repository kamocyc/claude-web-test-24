import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { SEA_LEVEL } from '../world/chunk';
import { VILLAGE_RADIUS } from '../world/generation/village';

/**
 * A town on a river keeps its river.
 *
 * The plateau a town stands on is a hard replacement of the ground — inside its
 * full radius it discards whatever was there — and it used to be applied *after*
 * the channel had been cut. So a river running through a town was filled in: the
 * water stopped at one edge of the plateau and started again at the other, and
 * the town sat on a dam of its own making.
 *
 * What is asserted is the invariant that failed: a column between a channel's
 * banks has water over it. Nothing about a plateau can be allowed to change
 * that, because a channel is where the drainage put the water — the town is the
 * thing that has to give way.
 */

const SEEDS = [2061350291, 1, 4242, 99, 31337];
/** One generator per seed, shared by both passes: a town's tiles are expensive. */
const gens = new Map(SEEDS.map((seed) => [seed, new TerrainGenerator(seed)]));
/** Blocks between the columns walked across a town. */
const STEP = 3;

/** Every column inside a channel within a town's plateau, over the seeds above. */
function channelColumns(): { seed: number; x: number; z: number; village: { x: number; z: number } }[] {
  const out: { seed: number; x: number; z: number; village: { x: number; z: number } }[] = [];
  for (const seed of SEEDS) {
    const gen = gens.get(seed)!;
    for (const village of gen.villagesAround(0, 0, 2)) {
      for (let dz = -VILLAGE_RADIUS; dz <= VILLAGE_RADIUS; dz += STEP) {
        for (let dx = -VILLAGE_RADIUS; dx <= VILLAGE_RADIUS; dx += STEP) {
          if (Math.hypot(dx, dz) > VILLAGE_RADIUS) continue;
          const x = village.x + dx, z = village.z + dz;
          const river = gen.field.riverAt(x, z);
          // Between the banks, and a real river rather than the sea: what the
          // sea does to a coastal town is a different question.
          if (!river || river.distance > river.width * 0.5) continue;
          if (river.waterY <= SEA_LEVEL) continue;
          out.push({ seed, x, z, village });
        }
      }
    }
  }
  return out;
}

describe('a town with a river through it', () => {
  const columns = channelColumns();

  it('finds towns standing on a river at all', () => {
    // The settlement lattice scores river access highly on purpose, so towns on
    // rivers are the common case, not a curiosity. If this ever finds none, the
    // test below is measuring nothing and should say so rather than pass.
    const towns = new Set(columns.map((c) => `${c.village.x},${c.village.z}`));
    expect(columns.length, 'no town has a channel running through its plateau').toBeGreaterThan(20);
    expect(towns.size).toBeGreaterThan(0);
  });

  it('does not fill the channel in', () => {
    for (const { seed, x, z, village } of columns) {
      // Nobody stands on water, and `standingY` is the exact answer the block
      // writer builds from — so this is the same question the world is made of.
      expect(
        gens.get(seed)!.standingY(x, z),
        `seed ${seed}, town at ${village.x},${village.z}: the channel at ${x},${z} was filled in`,
      ).toBeNull();
    }
  });
});
