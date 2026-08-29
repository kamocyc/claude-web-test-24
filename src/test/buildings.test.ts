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
} from '../game/buildings';
import {
  FACING_STEP,
  planGrowth,
  planOutpost,
  planVillage,
  type HouseRecord,
} from '../world/generation/village';
import { Block } from '../world/blocks';
import { townCraft, type VillageRecord } from '../game/villages';

const SITE = { cellX: 0, cellZ: 0, x: 100, z: 200 };
const BASE_Y = 60;

function village(): VillageRecord {
  const craft = townCraft(1, SITE.x, SITE.z);
  return {
    id: '100,200', x: SITE.x, z: SITE.z, baseY: BASE_Y, variant: 'plains', name: '麦',
    produces: craft.produces, inputs: craft.inputs, inputStock: new Map(),
    needs: [], stage: 0, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0, harvest: 0, harvestProgress: 0,
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

  it('raises the kinds of building its zoning asked for', () => {
    // A growth stage builds whole blocks, so what it raises follows from the zone of the
    // blocks that stage reaches — not from a roll.
    const seen = new Set<string>();
    for (let stage = 1; stage <= 4; stage++) {
      for (const house of planGrowth(1, SITE, BASE_Y, 'plains', stage, []).buildings) {
        seen.add(house.role);
      }
    }
    expect(seen.has('house')).toBe(true);
    expect([...seen].every((role) => role !== 'plaza')).toBe(true);
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

