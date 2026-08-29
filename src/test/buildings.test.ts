import { describe, expect, it } from 'vitest';
import {
  buildingAt,
  buildingId,
  buildingsOf,
  defaultDepot,
  depotOf,
  describeBuilding,
  pathAroundPlots,
  pointAlongPath,
  useLabel,
} from '../game/buildings';
import {
  FACING_STEP,
  GROWTH_USES,
  HOUSES_PER_STAGE,
  planGrowth,
  planOutpost,
  dressFor,
  planVillage,
  useForGrowth,
  useForProfession,
  type HouseRecord,
} from '../world/generation/village';
import { Block } from '../world/blocks';
import { villageTrade, type VillageRecord } from '../game/villages';

const SITE = { cellX: 0, cellZ: 0, x: 100, z: 200 };
const BASE_Y = 60;

function village(): VillageRecord {
  const trade = villageTrade(1, SITE.x, SITE.z, 'plains');
  return {
    id: '100,200', x: SITE.x, z: SITE.z, baseY: BASE_Y, variant: 'plains', name: '麦',
    kind: trade.kind, produces: trade.produces, input: trade.input, inputStock: 0,
    needs: [], stage: 0, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0,
  };
}

describe('a village as buildings', () => {
  const plan = planVillage(999, SITE, BASE_Y, 'plains');

  it('reports a door on every house, in the wall it faces', () => {
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const house of plan.buildings) {
      const onEdge =
        house.door.x === house.x0 || house.door.x === house.x0 + house.w - 1 ||
        house.door.z === house.z0 || house.door.z === house.z0 + house.d - 1;
      expect(onEdge, `door of ${house.x0},${house.z0} is not in a wall`).toBe(true);
      // And the cell outside it is one step further out, away from the house.
      const [stepX, stepZ] = FACING_STEP[house.facing];
      expect(house.outside.x).toBe(house.door.x + stepX);
      expect(house.outside.z).toBe(house.door.z + stepZ);
      const outsideIn =
        house.outside.x >= house.x0 && house.outside.x < house.x0 + house.w &&
        house.outside.z >= house.z0 && house.outside.z < house.z0 + house.d;
      expect(outsideIn, 'the cell outside the door is inside the house').toBe(false);
    }
  });

  it('lays a path from each door towards the street', () => {
    const finished = new Map<string, number>();
    for (const p of [...plan.byChunk.values()].flat()) finished.set(`${p.x},${p.y},${p.z}`, p.b);
    // The village's own paths are DIRT_PATH on a plains palette, laid at the ground level
    // the door opens onto.
    for (const house of plan.buildings) {
      const at = finished.get(`${house.outside.x},${house.door.y - 1},${house.outside.z}`);
      expect(at, `nothing outside the door of ${house.x0},${house.z0}`).toBe(Block.DIRT_PATH);
    }
  });

  it('names each building, and tells two of a kind apart', () => {
    const buildings = buildingsOf(village(), plan.buildings);
    expect(buildings).toHaveLength(plan.buildings.length);
    expect(new Set(buildings.map((b) => b.label)).size).toBe(buildings.length);
    expect(new Set(buildings.map((b) => b.id)).size).toBe(buildings.length);
  });

  it('finds the building a cell belongs to, and nothing for open ground', () => {
    const buildings = buildingsOf(village(), plan.buildings);
    const first = buildings[0];
    expect(buildingAt(buildings, first.x0 + 1, first.z0 + 1)?.id).toBe(first.id);
    expect(buildingAt(buildings, SITE.x + 900, SITE.z)).toBeNull();
  });
});

describe('choosing where goods go', () => {
  const plan = planVillage(999, SITE, BASE_Y, 'plains');

  it('defaults to the building nearest the middle of the village', () => {
    const buildings = buildingsOf(village(), plan.buildings);
    const chosen = defaultDepot(buildings)!;
    for (const other of buildings) expect(chosen.fromCentre).toBeLessThanOrEqual(other.fromCentre);
  });

  it('uses the one the player picked', () => {
    const record = village();
    const buildings = buildingsOf(record, plan.buildings);
    const wanted = buildings[buildings.length - 1];
    record.depot = wanted.id;
    expect(depotOf(record, buildings)?.id).toBe(wanted.id);
  });

  it('falls back when the stored building is no longer there', () => {
    const record = village();
    record.depot = 'nowhere';
    const buildings = buildingsOf(record, plan.buildings);
    expect(depotOf(record, buildings)?.id).toBe(defaultDepot(buildings)?.id);
  });

  it('says what a building is for', () => {
    const record = village();
    const buildings = buildingsOf(record, plan.buildings);
    expect(describeBuilding(buildings[0], record, true)).toContain('集荷所');
    expect(describeBuilding(buildings[0], record, false)).not.toContain('集荷所');
  });
});

describe('buildings a village earns', () => {
  it('reports growth houses the same way as the original ones', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const house of plan.buildings) expect(house.role).toBe('house');
    // Ids are made of the corner, so a village's buildings never collide with each other.
    const original = planVillage(999, SITE, BASE_Y, 'plains').buildings;
    const ids = new Set([...original, ...plan.buildings].map((h: HouseRecord) => buildingId(h)));
    expect(ids.size).toBe(original.length + plan.buildings.length);
  });

  it('gives a hamlet its two houses', () => {
    const plan = planOutpost(1, { cellX: 0, cellZ: 0, x: 200, z: -300 }, 64, 'plains');
    expect(plan.buildings).toHaveLength(2);
    // Both open onto the little street between them.
    for (const house of plan.buildings) expect(house.door.y).toBe(64);
  });

  it('gives a market its own way in', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 2, []);
    const market = plan.buildings.find((house) => house.role === 'market');
    expect(market).toBeDefined();
    if (!market) return;
    expect(market.outside.z).toBe(market.door.z - 1);
  });
});

describe('the walk from a doorway to the road', () => {
  const ground = 64;
  const at = (x: number, z: number) => ({ x, y: ground, z });

  it('goes straight when nothing is in the way', () => {
    const path = pathAroundPlots(at(0, 0), at(0, 6), []);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(at(0, 0));
    expect(path?.[path.length - 1]).toEqual(at(0, 6));
    expect(path).toHaveLength(7);
  });

  it('goes round a house instead of through it', () => {
    // A house squarely between the two, with room either side.
    const house = { x0: -2, z0: 2, w: 5, d: 3 };
    const path = pathAroundPlots(at(0, 0), at(0, 8), [house]);
    expect(path).not.toBeNull();
    for (const p of path ?? []) {
      const inside = p.x >= house.x0 && p.x < house.x0 + house.w && p.z >= house.z0 && p.z < house.z0 + house.d;
      expect(inside, `walks through the house at ${p.x},${p.z}`).toBe(false);
    }
    // Every step is one block, up down left or right, so a porter following it never
    // cuts a corner across something.
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const a = (path ?? [])[i - 1];
      const b = (path ?? [])[i];
      expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBe(1);
    }
  });

  it('starts at the doorway even though the doorway is inside the house', () => {
    // A door is a cell in its own wall: the walk has to be allowed to stand in it.
    const house = { x0: 0, z0: 0, w: 5, d: 5 };
    const path = pathAroundPlots(at(2, 0), at(2, -6), [house]);
    expect(path?.[0]).toEqual(at(2, 0));
  });

  it('gives up rather than wandering when a house is a wall', () => {
    // Boxed in on every side: there is no way round, and the caller falls back to its
    // straight line.
    const walls = [
      { x0: -4, z0: -4, w: 9, d: 1 },
      { x0: -4, z0: 4, w: 9, d: 1 },
      { x0: -4, z0: -4, w: 1, d: 9 },
      { x0: 4, z0: -4, w: 1, d: 9 },
    ];
    expect(pathAroundPlots(at(0, 0), at(0, 20), walls)).toBeNull();
  });

  it('climbs evenly when the two ends are at different levels', () => {
    const path = pathAroundPlots({ x: 0, y: 60, z: 0 }, { x: 0, y: 64, z: 8 }, []);
    expect(path?.[0].y).toBe(60);
    expect(path?.[path.length - 1].y).toBe(64);
    for (let i = 1; i < (path?.length ?? 0); i++) {
      expect(Math.abs((path ?? [])[i].y - (path ?? [])[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('what a building is for', () => {
  it('reads a generated house off the trade already rolled for it', () => {
    // Nothing is drawn from `planVillage`'s stream to decide this, so the whole village is
    // exactly the village it was before uses existed — which `seeds.test.ts` also pins.
    const plan = planVillage(999, SITE, BASE_Y, 'plains');
    for (const house of plan.buildings) {
      expect(house.use).toBe(useForProfession(house.profession));
    }
  });

  it('turns a village into a town as it grows', () => {
    // A 集落 is somewhere people live; a 都市 is somewhere they also work and shop.
    for (let stage = 1; stage < GROWTH_USES.length; stage++) {
      const plan = planGrowth(1, SITE, BASE_Y, 'plains', stage, []);
      const houses = plan.buildings.filter((h) => h.role === 'house');
      expect(houses.length).toBeLessThanOrEqual(HOUSES_PER_STAGE);
      houses.forEach((house, i) => expect(house.use).toBe(useForGrowth(stage, i)));
    }
  });

  it('makes the market hall the village shop', () => {
    // Stage 2's landmark. A market is where a village sells, which is what a shop is.
    const market = planGrowth(1, SITE, BASE_Y, 'plains', 2, []).buildings
      .find((h) => h.role === 'market');
    expect(market?.use).toBe('commercial');
  });

  it('leaves a hamlet as two homes', () => {
    const plan = planOutpost(7, SITE, BASE_Y, 'plains');
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const house of plan.buildings) expect(house.use).toBe('residential');
  });

  it('holds the last stage rather than running off the end of the table', () => {
    // `MAX_STAGE` is the last row, so nothing reaches these in play. What they are for is
    // that raising the cap later should build a 都市 again, not nothing at all.
    const last = GROWTH_USES[GROWTH_USES.length - 1];
    expect(useForGrowth(99, 0)).toBe(last[0]);
    expect(useForGrowth(-1, 0)).toBe('residential');
    // A house past the ones a stage plans for is a home, which is what a house is when
    // nothing says otherwise.
    expect(useForGrowth(1, 99)).toBe('residential');
  });

  it('names a building by what it is for, keeping the trade of a home', () => {
    const record = village();
    const houses: HouseRecord[] = [
      { x0: 0, z0: 0, w: 5, d: 5, facing: 0, role: 'house', use: 'industrial',
        profession: 'librarian', door: { x: 0, y: 60, z: 2 }, outside: { x: -1, y: 60, z: 2 } },
      { x0: 20, z0: 0, w: 5, d: 5, facing: 0, role: 'house', use: 'commercial',
        profession: 'farmer', door: { x: 20, y: 60, z: 2 }, outside: { x: 19, y: 60, z: 2 } },
      { x0: 40, z0: 0, w: 5, d: 5, facing: 0, role: 'house', use: 'residential',
        profession: 'butcher', door: { x: 40, y: 60, z: 2 }, outside: { x: 39, y: 60, z: 2 } },
    ];
    const labels = buildingsOf(record, houses).map((b) => b.label);
    expect(labels).toEqual(['工場', '商店', '肉屋']);
  });

  it('says what a building is for when it is not the depot', () => {
    const record = village();
    const buildings = buildingsOf(record, planVillage(999, SITE, BASE_Y, 'plains').buildings);
    const line = describeBuilding(buildings[0], record, false, '麦を待っている');
    expect(line).toContain(useLabel(buildings[0].use));
    expect(line).toContain('麦を待っている');
  });
});

describe('walking along a path', () => {
  const path = [
    { x: 0, y: 60, z: 0 },
    { x: 0, y: 60, z: 4 },
    { x: 8, y: 64, z: 4 },
  ];

  it('lands on the ends at 0 and 1', () => {
    expect(pointAlongPath(path, 0)).toEqual(path[0]);
    expect(pointAlongPath(path, 1)).toEqual(path[2]);
  });

  it('walks between the corners in between', () => {
    // Halfway is the middle corner, because the fraction is of the corners rather than of
    // the distance — a town's streets are short and the two are close enough.
    expect(pointAlongPath(path, 0.5)).toEqual(path[1]);
    const quarter = pointAlongPath(path, 0.25)!;
    expect(quarter.z).toBeGreaterThan(0);
    expect(quarter.z).toBeLessThan(4);
  });

  it('holds at the ends rather than running off them', () => {
    expect(pointAlongPath(path, -3)).toEqual(path[0]);
    expect(pointAlongPath(path, 9)).toEqual(path[2]);
  });

  it('answers for a path that is one point, and for one that is none', () => {
    expect(pointAlongPath([path[0]], 0.5)).toEqual(path[0]);
    expect(pointAlongPath([], 0.5)).toBeNull();
  });
});

describe('seeing what a building is for', () => {
  /** Every block a plan puts down, collapsed the way the writer collapses it. */
  function blocks(placements: { x: number; y: number; z: number; b: number }[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of placements) out.set(`${p.x},${p.y},${p.z}`, p.b);
    return out;
  }

  it('leaves a home in the palette its village was built with', () => {
    const plains = { wall: Block.OAK_PLANKS, corner: Block.OAK_LOG, roof: Block.STONE_BRICKS,
      floor: Block.OAK_PLANKS, path: Block.DIRT_PATH };
    expect(dressFor(plains, 'residential')).toEqual(plains);
    expect(dressFor(plains, 'civic')).toEqual(plains);
    // A shop and a works change their walls and nothing else.
    expect(dressFor(plains, 'commercial').wall).not.toBe(plains.wall);
    expect(dressFor(plains, 'commercial').roof).toBe(plains.roof);
    expect(dressFor(plains, 'industrial').wall).toBe(Block.COBBLESTONE);
  });

  it('builds a works with a chimney and a home without one', () => {
    // Stage 4 raises a works first (see `GROWTH_USES`), stage 1 raises two homes.
    const works = planGrowth(5, SITE, BASE_Y, 'plains', 4, []);
    const homes = planGrowth(5, SITE, BASE_Y, 'plains', 1, []);
    const chimneyOver = (plan: typeof works): boolean => {
      const laid = blocks(plan.placements);
      return plan.buildings.some((house) => {
        // Three above the wall top, which is three above the floor.
        const top = BASE_Y + 1 + 3;
        return laid.get(`${house.x0 + 1},${top + 3},${house.z0 + 1}`) === Block.COBBLESTONE;
      });
    };
    expect(chimneyOver(works)).toBe(true);
    expect(chimneyOver(homes)).toBe(false);
  });

  it('leaves the village it was generated with alone', () => {
    // The fixed verification seed pins stage 0 block for block, so nothing about uses may
    // reach it: no dressing, and above all no chimney.
    const plan = planVillage(999, SITE, BASE_Y, 'plains');
    const laid = blocks([...plan.byChunk.values()].flat());
    const top = BASE_Y + 1 + 3;
    for (const house of plan.buildings) {
      expect(laid.get(`${house.x0 + 1},${top + 3},${house.z0 + 1}`)).toBeUndefined();
    }
  });

  it('keeps the plot, the doorway and the roof line whatever it is dressed as', () => {
    // Dressing is paint. If it moved anything, growth would be planning a different
    // village from the one `villageGrowth.ts` levelled the ground for.
    const plan = planGrowth(5, SITE, BASE_Y, 'plains', 4, []);
    for (const house of plan.buildings) {
      const plot = plan.footprints.find((f) => f.x0 === house.x0 && f.z0 === house.z0);
      expect(plot).toBeDefined();
      expect(house.w).toBe(plot!.w);
      expect(house.d).toBe(plot!.d);
    }
  });
});
