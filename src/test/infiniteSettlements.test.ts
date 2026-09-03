import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { WORLD_PARAMS, paramsFor } from '../world/generation/infinite/params';
import { createInfiniteWorld } from '../world/generation/infinite/world';
import { villageRadius } from '../world/generation/infinite/settlements';
import { CIVIL_TILE, COARSE_FACTOR } from '../world/generation/infinite/constants';
import { CELL_BLOCKS, unitsToY } from '../world/generation/scale';
import { VILLAGE_RADIUS } from '../world/generation/village';
import { SEA_LEVEL } from '../world/chunk';

const SEED = seedFromString('voxelcraft');
const params = paramsFor(SEED);
const world = createInfiniteWorld(params);
const field = world.settlements;
const known = { calibration: world.constants, riverThreshold: world.riverThreshold };
const radius = villageRadius(params);

/** A 3 x 3 block of civil tiles: 12288 blocks a side. */
const tiles: Array<[number, number]> = [];
for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) tiles.push([tx, ty]);
const all = tiles.flatMap(([tx, ty]) => field.tile(tx, ty));

describe('the settlement lattice', () => {
  it('is spaced for the world this game is', () => {
    // The town fabric needs `VILLAGE_RADIUS` of plateau around a centre and the
    // hamlet siting in `src/game/outpost.ts` needs room outside that, so two
    // anchors have to clear two plateaus with something to spare. How *many*
    // towns that works out to is a different question, swept in
    // `terrainShape.test.ts`, which is what `WORLD_PARAMS.settlement` is set by.
    expect(radius * CELL_BLOCKS).toBeGreaterThan(2 * VILLAGE_RADIUS + 60);
    expect(radius * CELL_BLOCKS).toBeLessThan(420);
    // The city ring has to fit inside the 3 x 3 neighbourhood a tile is thinned
    // against, or a "city" is only a city as far as its own tile can see.
    expect(radius * 6.5).toBeLessThanOrEqual(CIVIL_TILE);
  });

  it('finds settlements, and not too many of them', () => {
    expect(all.length).toBeGreaterThan(20);
    const areaBlocks = (3 * CIVIL_TILE * CELL_BLOCKS) ** 2;
    const perMillion = all.length / (areaBlocks / 1e6);
    // The old generator's own measured density, which every reach constant and
    // the quest chain were tuned against, was 1.55 to 1.90 per million blocks
    // squared — but that counted only the cells it let a village onto, and this
    // one counts sites before the biome gate. A little denser is expected.
    expect(perMillion).toBeGreaterThan(1);
    expect(perMillion).toBeLessThan(4);
  });

  it('keeps them apart', () => {
    let closest = Infinity;
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
      closest = Math.min(closest, Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y));
    }
    expect(closest).toBeGreaterThanOrEqual(radius);
    // Seating nudges a site onto flatter ground, and two neighbours can nudge
    // towards each other. What survives that has to still clear two plateaus.
    const seats = all.map(s => field.seat(s));
    let closestSeat = Infinity;
    for (let a = 0; a < seats.length; a++) for (let b = a + 1; b < seats.length; b++) {
      closestSeat = Math.min(closestSeat, Math.hypot(seats[a].x - seats[b].x, seats[a].y - seats[b].y));
    }
    expect(closestSeat * CELL_BLOCKS).toBeGreaterThan(2 * VILLAGE_RADIUS + 16);
  });

  it('builds a hierarchy rather than one flat rank', () => {
    const tiers = new Set(all.map(s => s.tier));
    expect(tiers.has('village')).toBe(true);
    expect(tiers.has('town')).toBe(true);
    expect(all.filter(s => s.tier === 'village').length).toBeGreaterThan(all.filter(s => s.tier === 'city').length);
  });

  it('never puts one in the water', () => {
    for (const s of all) {
      const { tile, index } = world.coarseIndex(s.x / COARSE_FACTOR, s.y / COARSE_FACTOR);
      expect(tile.sea[index]).toBe(0);
      const seat = field.seat(s);
      const owner = world.coarseIndex(Math.round(seat.x / COARSE_FACTOR), Math.round(seat.y / COARSE_FACTOR));
      expect(unitsToY(owner.tile.terrain[owner.index], world.constants.seaLevel)).toBeGreaterThan(SEA_LEVEL - 1);
    }
  });

  it('anchors every site on a coarse sample point', () => {
    // The coarse level holds the exact world cell a super-chunk would sample
    // there, so a site anchored on one can never turn out to be under water.
    for (const s of all) {
      expect(s.x % COARSE_FACTOR === 0).toBe(true);
      expect(s.y % COARSE_FACTOR === 0).toBe(true);
    }
  });

  it('gives the same answer to a world that arrived from elsewhere', () => {
    // The calibration and the river threshold are what a worker is handed, so
    // handing them over is exactly the case being tested.
    const fresh = createInfiniteWorld(paramsFor(SEED), known).settlements;
    const mine = field.tile(0, 0).map(s => `${s.id} ${s.tier} ${s.dominance.toFixed(6)} ${s.port}`);
    expect(fresh.tile(0, 0).map(s => `${s.id} ${s.tier} ${s.dominance.toFixed(6)} ${s.port}`)).toEqual(mine);
  });

  it('does not depend on the order the tiles were asked for', () => {
    const forwards = field.tile(2, 2).map(s => s.id);
    const other = createInfiniteWorld(paramsFor(SEED), known).settlements;
    other.tile(3, 3); other.tile(1, 1); other.tile(2, 3);
    expect(other.tile(2, 2).map(s => s.id)).toEqual(forwards);
  });

  it('answers "what is near here" from the same set', () => {
    const near = field.near(0, 0, CIVIL_TILE);
    expect(near.length).toBeGreaterThan(0);
    for (const s of near) expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(CIVIL_TILE);
  });
});

describe('the frozen world recipe', () => {
  it('keeps the settlement density where the rest of the game expects it', () => {
    // Not a range anybody derived — the number was swept, in
    // `terrainShape.test.ts`, against the town density the old generator
    // produced and the road reaches were tuned for. This is here so that a
    // change to it fails next to a comment saying where to re-measure.
    expect(WORLD_PARAMS.settlement).toBeGreaterThan(0.4);
    expect(WORLD_PARAMS.settlement).toBeLessThan(0.7);
  });
});
