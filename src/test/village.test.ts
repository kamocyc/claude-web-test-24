import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import {
  planVillage,
  VILLAGE_RADIUS,
  type VillageVariant,
} from '../world/generation/village';
import { plateauWeight } from '../world/generation/villageSites';
import { Block } from '../world/blocks';
import { SEA_LEVEL } from '../world/chunk';
import { onStreet } from '../world/generation/districts';
import { architectureFor, paletteFor } from '../world/generation/townBuildings';

describe('village placement', () => {
  /** Where the towns are is the settlement lattice's answer, refused or accepted by
   *  `villageSites.ts` on the ground it finds. What is checked here is the part the rest
   *  of the game depends on: that the answer is the same every time, that a town stands
   *  somewhere buildable, and that two of them are never on top of one another.
   *
   *  The lattice itself — its scoring, its thinning, its tiers — is checked in
   *  `infiniteSettlements.test.ts`, and the density and spacing it produces across the
   *  world are pinned in `terrainShape.test.ts`. */
  it('puts the same towns in the same places for the same seed', () => {
    const a = new TerrainGenerator(4242).villagesAround(0, 0, 3);
    const b = new TerrainGenerator(4242).villagesAround(0, 0, 3);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('puts them in different places for different seeds', () => {
    const a = new TerrainGenerator(1).villagesAround(0, 0, 3);
    const b = new TerrainGenerator(2).villagesAround(0, 0, 3);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it('does not depend on which direction the world was walked in', () => {
    const forwards = new TerrainGenerator(11);
    const backwards = new TerrainGenerator(11);
    // Ask about ground far away first, so the lattice tiles are built in the other order.
    backwards.villagesAround(6000, -4000, 2);
    backwards.villagesAround(-3000, 5000, 2);
    expect(backwards.villagesAround(0, 0, 2)).toEqual(forwards.villagesAround(0, 0, 2));
  });

  it('answers a radius of zero with the town nearest the point, not with nothing', () => {
    // `game.ts` counts its radius in the old 320-block grid cells, where zero meant "the
    // cell this point is in" rather than "a circle of no size".
    const gen = new TerrainGenerator(31337);
    const village = gen.findNearestVillage(0, 0, 4);
    expect(village).not.toBeNull();
    if (!village) return;
    expect(gen.villagesAround(village.x, village.z, 0)).toHaveLength(1);
  });

  it('stands its towns on dry, buildable ground', () => {
    const gen = new TerrainGenerator(99);
    const villages = gen.villagesAround(0, 0, 4);
    expect(villages.length).toBeGreaterThan(2);
    for (const village of villages) {
      expect(village.baseY).toBeGreaterThan(SEA_LEVEL + 1);
      expect(['plains', 'desert', 'snowy']).toContain(village.variant);
      // The plateau has to be level all the way across the street grid.
      const centre = gen.height(village.x, village.z);
      for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10], [0, -10]] as const) {
        expect(gen.height(village.x + dx, village.z + dz)).toBe(centre);
      }
    }
  });

  it('falls to zero influence outside the plateau', () => {
    const site = { x: 400, z: -200 };
    expect(plateauWeight(site, site.x, site.z)).toBe(1);
    expect(plateauWeight(site, site.x + VILLAGE_RADIUS + 1, site.z)).toBe(0);
  });
});

describe('village layout', () => {
  const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
  const plan = planVillage(999, site, 60, 'plains');

  it('builds a square, shops and people', () => {
    const all = [...plan.byChunk.values()].flat();
    expect(all.length).toBeGreaterThan(500);
    expect(plan.villagers.length).toBeGreaterThanOrEqual(3);
    expect(plan.chests.length).toBeGreaterThanOrEqual(1);
    // The well on the square, the glass of a shopfront, and the cloth of its awning.
    expect(all.some((p) => p.b === Block.MOSSY_COBBLESTONE)).toBe(true);
    expect(all.some((p) => p.b === Block.GLASS)).toBe(true);
    expect(all.some((p) => p.b === Block.WOOL)).toBe(true);
  });

  it('zones what it builds, and puts the shops in the middle', () => {
    const shops = plan.buildings.filter((b) => b.role === 'shop');
    expect(shops.length).toBeGreaterThan(0);
    const homes = plan.buildings.filter((b) => b.role === 'house');
    expect(homes.length).toBeGreaterThan(0);
    // Every shop is nearer the middle than every home: that is the zoning, seen from the
    // only angle that matters.
    const far = (b: { x0: number; z0: number }): number => Math.hypot(b.x0 - site.x, b.z0 - site.z);
    expect(Math.max(...shops.map(far))).toBeLessThan(Math.min(...homes.map(far)));
  });

  it('opens every door onto a street', () => {
    // The grid is what makes this true without laying a path: a block is bounded by four
    // streets, so the cell outside any door on its edge is one of them.
    for (const house of plan.buildings) {
      expect(
        onStreet(site, house.outside.x, house.outside.z),
        `${house.role} at ${house.x0},${house.z0} opens onto nothing`,
      ).toBe(true);
    }
  });

  it('groups every placement into the chunk that contains it', () => {
    let checked = 0;
    let misfiled = 0;
    let first = '';
    for (const [key, placements] of plan.byChunk) {
      const [cx, cz] = key.split(',').map(Number);
      for (const p of placements) {
        checked++;
        // Counted rather than asserted per placement: there are tens of thousands of
        // them, and the expect() calls cost more than the walk that finds them.
        if (Math.floor(p.x / 16) === cx && Math.floor(p.z / 16) === cz) continue;
        misfiled++;
        first ||= `(${p.x}, ${p.z}) is filed under chunk ${key}`;
      }
    }
    // The sibling test above establishes the plan is 500-odd placements; this is the
    // guard that the walk actually reached them.
    expect(checked, 'the plan had no placements to check').toBeGreaterThan(500);
    expect(misfiled, first).toBe(0);
  });

  it('is deterministic', () => {
    const again = planVillage(999, site, 60, 'plains');
    expect([...again.byChunk.keys()].sort()).toEqual([...plan.byChunk.keys()].sort());
    expect(again.villagers).toEqual(plan.villagers);
  });

  it('uses a desert palette in the desert', () => {
    const desert = planVillage(999, site, 60, 'desert');
    const all = [...desert.byChunk.values()].flat();
    expect(all.some((p) => p.b === Block.SANDSTONE)).toBe(true);
  });
});

describe('village architecture', () => {
  const seed = 999;

  it('keeps one deterministic local style across a village', () => {
    const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
    const a = planVillage(seed, site, 60, 'plains');
    const b = planVillage(seed, site, 60, 'plains');
    expect(a.architecture).toEqual(b.architecture);
    expect(a.architecture.id.startsWith('plains-')).toBe(true);
  });

  it('gives neighbouring villages different traditions within the same biome', () => {
    for (const variant of ['plains', 'desert', 'snowy'] as VillageVariant[]) {
      const styles = new Set<string>();
      for (let i = 0; i < 32; i++) {
        styles.add(architectureFor(seed, { x: 100 + i * 37, z: 200 + i * 53 }, variant).id);
      }
      expect(styles.size, `${variant} only produced ${[...styles].join(', ')}`).toBe(2);
      expect([...styles].every((style) => style.startsWith(`${variant}-`))).toBe(true);
    }
  });

  it('builds a real triangular gable that narrows to a ridge', () => {
    let site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
    for (let i = 0; i < 32; i++) {
      const candidate = { cellX: 0, cellZ: 0, x: 100 + i * 37, z: 200 + i * 53 };
      if (architectureFor(seed, candidate, 'plains').homeRoof === 'gable') {
        site = candidate;
        break;
      }
    }
    const baseY = 60;
    const plan = planVillage(seed, site, baseY, 'plains');
    expect(plan.architecture.homeRoof).toBe('gable');
    const all = [...plan.byChunk.values()].flat();
    const slopes = new Set<number>([
      Block.STONE_ROOF_EAST,
      Block.STONE_ROOF_WEST,
      Block.STONE_ROOF_SOUTH,
      Block.STONE_ROOF_NORTH,
    ]);
    expect(all.some((placement) => slopes.has(placement.b))).toBe(true);
    const home = plan.buildings.find((building) => building.role === 'house')!;
    const finished = new Map<string, number>();
    for (const p of all) finished.set(`${p.x},${p.y},${p.z}`, p.b);
    const roof = paletteFor('plains', plan.architecture).roof;
    const eaveY = baseY + 1 + 4;
    const ridgeY = eaveY + plan.architecture.homeRise;
    const slopeAlongX = home.facing === 1 || home.facing === 3;
    const centreX = home.x0 + Math.floor(home.w / 2);
    const centreZ = home.z0 + Math.floor(home.d / 2);
    const eaveEdge = slopeAlongX
      ? { x: home.x0 - 1, z: centreZ }
      : { x: centreX, z: home.z0 - 1 };
    const ridge = { x: centreX, z: centreZ };
    expect(slopes.has(finished.get(`${eaveEdge.x},${eaveY},${eaveEdge.z}`) ?? Block.AIR)).toBe(true);
    expect(finished.get(`${ridge.x},${ridgeY},${ridge.z}`)).toBe(roof);
    expect(finished.get(`${eaveEdge.x},${ridgeY},${eaveEdge.z}`)).not.toBe(roof);
  });

  it('uses round columns for the well and square lamps', () => {
    const plan = planVillage(seed, { cellX: 0, cellZ: 0, x: 100, z: 200 }, 60, 'plains');
    const all = [...plan.byChunk.values()].flat();
    expect(all.filter((placement) => placement.b === Block.STONE_COLUMN).length).toBeGreaterThanOrEqual(12);
    expect(all.some((placement) => placement.b === Block.WOOD_COLUMN || placement.b === Block.STONE_COLUMN)).toBe(true);
  });
});

describe('village terrain integration', () => {
  it('finds a village and generates its blocks into the world', () => {
    const gen = new TerrainGenerator(4242);
    const village = gen.findNearestVillage(0, 0, 4);
    expect(village).not.toBeNull();
    if (!village) return;
    const cx = Math.floor(village.x / 16);
    const cz = Math.floor(village.z / 16);
    const { blocks, villagers, chests } = gen.generateChunk(cx, cz);
    expect(villagers.length + chests.length).toBeGreaterThanOrEqual(0);
    // The well sits at the centre of every village.
    const hasVillageBlock = Array.from(blocks).some(
      (id) => id === Block.MOSSY_COBBLESTONE || id === Block.OAK_PLANKS || id === Block.SANDSTONE,
    );
    expect(hasVillageBlock).toBe(true);
  });
});

describe('village houses can be walked into', () => {
  const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
  const baseY = 60;
  const plan = planVillage(999, site, baseY, 'plains');

  /** The village as the generator leaves it: the last block written to each cell. */
  const finished = new Map<string, number>();
  for (const p of [...plan.byChunk.values()].flat()) finished.set(`${p.x},${p.y},${p.z}`, p.b);
  const at = (x: number, y: number, z: number): number =>
    finished.get(`${x},${y},${z}`) ?? Block.STONE;

  it('opens every door onto the level the street is on', () => {
    // The plateau's top solid block is `baseY`, so anybody outside stands at `baseY + 1`
    // and needs those two cells clear to walk through a wall.
    const stand = baseY + 1;
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const b of plan.buildings) {
      const x1 = b.x0 + b.w - 1;
      const z1 = b.z0 + b.d - 1;
      let doors = 0;
      for (let x = b.x0; x <= x1; x++) {
        for (let z = b.z0; z <= z1; z++) {
          if (x !== b.x0 && x !== x1 && z !== b.z0 && z !== z1) continue;
          if (at(x, stand, z) === Block.AIR && at(x, stand + 1, z) === Block.AIR) doors++;
        }
      }
      expect(doors, `house at ${b.x0},${b.z0}`).toBeGreaterThan(0);
    }
  });

  it('lays its floor on the same level as the ground outside', () => {
    const b = plan.buildings[0];
    // Solid underfoot at the plateau top, clear where somebody stands.
    expect(at(b.x0 + 2, baseY, b.z0 + 2)).not.toBe(Block.AIR);
    expect(at(b.x0 + 2, baseY + 1, b.z0 + 2)).toBe(Block.AIR);
  });
});

/** The pinned seed test guards terrain; this guards the town layout itself. Growth adds
 *  blocks from a separate random stream, so stage 0 must keep emitting exactly what it
 *  always has. Any change to the order or count of `rng()` calls inside `planVillage`
 *  moves these numbers, and that is never accidental.
 *
 *  Re-pinned when villages gained local architecture: roof silhouettes, foundations and
 *  wall bands now differ as well as their materials. */
describe('town layout is pinned', () => {
  const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
  const expected: Record<VillageVariant, { count: number; hash: number }> = {
    plains: { count: 19705, hash: 288983372 },
    desert: { count: 19165, hash: -261237805 },
    snowy: { count: 19067, hash: 694585752 },
  };

  for (const variant of ['plains', 'desert', 'snowy'] as VillageVariant[]) {
    it(`lays the same ${variant} blocks it always has`, () => {
      const plan = planVillage(999, site, 60, variant);
      const all = [...plan.byChunk.values()].flat();
      let hash = 0;
      for (const p of all) hash = (hash * 31 + p.x * 7 + p.y * 13 + p.z * 17 + p.b) | 0;
      expect(all.length).toBe(expected[variant].count);
      expect(hash).toBe(expected[variant].hash);
      expect(plan.villagers.length).toBe(7);
      expect(plan.chests.length).toBe(5);
      // Six blocks at stage 0, one of them the square, so six buildings plus the pair of
      // houses that share a residential block.
      expect(plan.buildings.length).toBe(7);
    });
  }
});
