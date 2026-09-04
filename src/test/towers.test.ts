import { describe, expect, it } from 'vitest';
import { Block, escalatorRise, isElevator } from '../world/blocks';
import {
  MAX_FLOORS,
  MIN_FLOORS,
  STOREY,
  buildTower,
  floorsFor,
  towerHeight,
} from '../world/generation/towers';
import {
  REDEVELOP_BLOCKS,
  REDEVELOP_STAGE,
  planRedevelopment,
  planVillage,
  type Footprint,
  type HouseRecord,
  type Placement,
  type Profession,
} from '../world/generation/village';
import { BLOCK_SIZE } from '../world/generation/districts';
import type { BuildSink } from '../world/generation/townBuildings';

const SITE = { cellX: 0, cellZ: 0, x: 100, z: 200 };
const BASE_Y = 60;
/** The walking level of a ground floor, which is what every builder is handed. */
const FLOOR = BASE_Y + 1;
const PLOT: Footprint = { x0: 40, z0: 70, w: BLOCK_SIZE, d: BLOCK_SIZE };
const CLERKS: readonly Profession[] = ['librarian', 'blacksmith', 'butcher', 'farmer'];

/** One built tower, as the last block written into each cell — which is what the world
 *  ends up holding, since a plan is collapsed cell by cell before it is applied. */
function raise(facing: 0 | 1 | 2 | 3, floors: number) {
  const placements: Placement[] = [];
  const sink: BuildSink = { buildings: [], villagers: [], chests: [] };
  buildTower(
    (x, y, z, b) => placements.push({ x, y, z, b }),
    sink,
    PLOT,
    facing,
    FLOOR,
    floors,
    CLERKS,
  );
  const cells = new Map<string, number>();
  for (const p of placements) cells.set(`${p.x},${p.y},${p.z}`, p.b);
  return {
    cells,
    tenants: sink.buildings,
    sink,
    at: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? -1,
  };
}

function inPlot(x: number, z: number): boolean {
  return x >= PLOT.x0 && x < PLOT.x0 + PLOT.w && z >= PLOT.z0 && z < PLOT.z0 + PLOT.d;
}

describe('a building with floors in it', () => {
  it('puts a shop on the ground floor and offices over it', () => {
    const tower = raise(1, 4);
    expect(tower.tenants).toHaveLength(4);
    expect(tower.tenants[0].use).toBe('commercial');
    expect(tower.tenants.slice(1).every((t) => t.use === 'office')).toBe(true);
    expect(tower.tenants.map((t) => t.floor)).toEqual([0, 1, 2, 3]);
    // One building from the street: every tenant shares the plot and the front door.
    for (const tenant of tower.tenants) {
      expect(tenant.role).toBe('tower');
      expect({ x: tenant.x0, z: tenant.z0 }).toEqual({ x: PLOT.x0, z: PLOT.z0 });
      expect(tenant.door).toEqual(tower.tenants[0].door);
    }
  });

  it('opens its door onto the street it faces, at every facing', () => {
    for (const facing of [0, 1, 2, 3] as const) {
      const tower = raise(facing, 3);
      const door = tower.tenants[0].door;
      const outside = tower.tenants[0].outside;
      expect(inPlot(door.x, door.z), `facing ${facing}: the door is in the wall`).toBe(true);
      expect(inPlot(outside.x, outside.z), `facing ${facing}: the step is outside`).toBe(false);
      // And it is a hole, not a wall with a name.
      expect(tower.at(door.x, FLOOR, door.z)).toBe(Block.AIR);
      expect(tower.at(door.x, FLOOR + 1, door.z)).toBe(Block.AIR);
    }
  });

  it('runs one lift shaft from the ground floor to the top', () => {
    const tower = raise(2, 5);
    const shaft: { x: number; y: number; z: number }[] = [];
    for (const [key, block] of tower.cells) {
      if (!isElevator(block)) continue;
      const [x, y, z] = key.split(',').map(Number);
      shaft.push({ x, y, z });
    }
    expect(shaft.length).toBeGreaterThan(0);
    // One column, and no gaps in it: a lift with a floor missing is a lift that stops.
    const column = new Set(shaft.map((cell) => `${cell.x},${cell.z}`));
    expect(column.size).toBe(1);
    const levels = shaft.map((cell) => cell.y).sort((a, b) => a - b);
    expect(levels[0]).toBe(FLOOR);
    expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(FLOOR + (5 - 1) * STOREY);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBe(1);
  });

  it('lays an escalator that rises a block a step, with air over every tread', () => {
    const tower = raise(3, 3);
    const treads: { x: number; y: number; z: number; rise: readonly [number, number] }[] = [];
    for (const [key, block] of tower.cells) {
      const rise = escalatorRise(block);
      if (!rise) continue;
      const [x, y, z] = key.split(',').map(Number);
      treads.push({ x, y, z, rise });
    }
    // Two abreast, a storey's worth of steps: a flight, not a token.
    expect(treads).toHaveLength(STOREY * 2);
    expect(new Set(treads.map((t) => `${t.rise[0]},${t.rise[1]}`)).size).toBe(1);
    for (const tread of treads) {
      // Each tread stands one higher than the cell behind it, and has headroom over it.
      const behind = tower.at(tread.x - tread.rise[0], tread.y - 1, tread.z - tread.rise[1]);
      expect(escalatorRise(behind) !== null || tread.y === FLOOR).toBe(true);
      for (let h = 1; h < STOREY; h++) {
        expect(tower.at(tread.x, tread.y + h, tread.z)).toBe(Block.AIR);
      }
    }
    // And it arrives at a floor rather than at a ceiling: the top tread's own level is
    // where the first floor's slab is, and the slab is missing over the well.
    const top = treads.reduce((best, t) => (t.y > best.y ? t : best));
    expect(top.y).toBe(FLOOR + STOREY - 1);
  });

  it('stands inside its own plot and no taller than it says', () => {
    const tower = raise(0, MAX_FLOORS);
    const height = towerHeight(MAX_FLOORS);
    let highest = 0;
    for (const [key, block] of tower.cells) {
      const [x, y, z] = key.split(',').map(Number);
      if (block === Block.AIR) continue;
      highest = Math.max(highest, y - FLOOR);
      // One block of overhang is allowed, and is the canopy, the signs and the pavement.
      expect(x).toBeGreaterThanOrEqual(PLOT.x0 - 1);
      expect(x).toBeLessThanOrEqual(PLOT.x0 + PLOT.w);
      expect(z).toBeGreaterThanOrEqual(PLOT.z0 - 1);
      expect(z).toBeLessThanOrEqual(PLOT.z0 + PLOT.d);
    }
    expect(highest).toBeLessThan(height);
    expect(highest).toBeGreaterThan(towerHeight(MAX_FLOORS) - STOREY);
  });

  it('walls every storey in, and glazes the ones above the shop', () => {
    const tower = raise(1, 4);
    const door = tower.tenants[0].door;
    let glazed = 0;
    for (let floor = 0; floor < 4; floor++) {
      const y = FLOOR + floor * STOREY;
      for (let x = PLOT.x0; x < PLOT.x0 + PLOT.w; x++) {
        for (let z = PLOT.z0; z < PLOT.z0 + PLOT.d; z++) {
          const edge = x === PLOT.x0 || x === PLOT.x0 + PLOT.w - 1
            || z === PLOT.z0 || z === PLOT.z0 + PLOT.d - 1;
          if (!edge) continue;
          if (floor === 0 && x === door.x && z === door.z) continue;
          expect(tower.at(x, y + 1, z), `floor ${floor} at ${x},${z}`).not.toBe(Block.AIR);
          if (floor > 0 && tower.at(x, y + 1, z) === Block.TINTED_GLASS) glazed++;
        }
      }
    }
    expect(glazed, 'the upper storeys have a window band').toBeGreaterThan(20);
  });

  it('puts somebody on every floor, and a chest in the shop', () => {
    const tower = raise(2, 4);
    expect(tower.sink.villagers).toHaveLength(4);
    const levels = tower.sink.villagers.map((v) => v.y).sort((a, b) => a - b);
    expect(levels).toEqual([0, 1, 2, 3].map((f) => FLOOR + f * STOREY));
    expect(tower.sink.chests).toHaveLength(1);
  });

  it('gets one floor taller for each stage past the first', () => {
    expect(floorsFor(REDEVELOP_STAGE, REDEVELOP_STAGE)).toBe(MIN_FLOORS);
    expect(floorsFor(REDEVELOP_STAGE + 1, REDEVELOP_STAGE)).toBe(MIN_FLOORS + 1);
    expect(floorsFor(REDEVELOP_STAGE + 40, REDEVELOP_STAGE)).toBe(MAX_FLOORS);
  });
});

describe('a town rebuilding its middle', () => {
  const plan = (stage: number) => planRedevelopment(1, SITE, BASE_Y, 'plains', stage);

  it('rebuilds nothing before the town is a 町', () => {
    for (let stage = 0; stage < REDEVELOP_STAGE; stage++) expect(plan(stage)).toBeNull();
  });

  it('rebuilds one central block per stage, and then stops', () => {
    const plots: Footprint[] = [];
    for (let stage = REDEVELOP_STAGE; stage < REDEVELOP_STAGE + REDEVELOP_BLOCKS; stage++) {
      const stagePlan = plan(stage);
      expect(stagePlan).not.toBeNull();
      expect(stagePlan!.replaces).toHaveLength(1);
      plots.push(stagePlan!.replaces[0]);
    }
    expect(plan(REDEVELOP_STAGE + REDEVELOP_BLOCKS)).toBeNull();
    // Three different plots: a town that rebuilt the same corner three times would have
    // one building and two demolitions.
    expect(new Set(plots.map((p) => `${p.x0},${p.z0}`)).size).toBe(REDEVELOP_BLOCKS);
  });

  it('rebuilds a plot the town actually had a shop on', () => {
    const town = planVillage(1, SITE, BASE_Y, 'plains');
    for (let stage = REDEVELOP_STAGE; stage < REDEVELOP_STAGE + REDEVELOP_BLOCKS; stage++) {
      const plot = plan(stage)!.replaces[0];
      const stood = town.buildings.find(
        (house: HouseRecord) => house.x0 === plot.x0 && house.z0 === plot.z0,
      );
      expect(stood, `stage ${stage} rebuilds a plot with a building on it`).toBeDefined();
      expect(stood!.use).toBe('commercial');
    }
  });

  it('is the same plan every time it is asked', () => {
    const once = plan(REDEVELOP_STAGE)!;
    const twice = plan(REDEVELOP_STAGE)!;
    expect(twice.placements).toEqual(once.placements);
    expect(twice.buildings.map((b) => b.use)).toEqual(once.buildings.map((b) => b.use));
  });

  it('covers every column of the plot it takes over', () => {
    const stagePlan = plan(REDEVELOP_STAGE)!;
    const plot = stagePlan.replaces[0];
    const written = new Set(stagePlan.placements.map((p) => `${p.x},${p.z}`));
    for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
      for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
        expect(written.has(`${x},${z}`), `nothing written at ${x},${z}`).toBe(true);
      }
    }
  });
});
