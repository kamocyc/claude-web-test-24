import { describe, expect, it } from 'vitest';
import {
  applyGrowth,
  clearGrowthCache,
  growthChunks,
  growthFor,
  growthVillagers,
  ownPaving,
  roadCrosses,
} from '../game/villageGrowth';
import { MIN_FLOORS, STOREY } from '../world/generation/towers';
import {
  REDEVELOP_STAGE,
  overlaps,
  planGrowth,
  planRedevelopment,
  planVillage,
  type Footprint,
} from '../world/generation/village';
import { Block, blockDef, isElevator, type BlockId } from '../world/blocks';
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME } from '../world/chunk';
import { World } from '../world/world';
import { ROAD_BLOCKS, RoadNetwork } from '../game/roads';
import type { VillageRecord } from '../game/villages';

const SITE = { cellX: 0, cellZ: 0, x: 100, z: 200 };
const BASE_Y = 60;

function record(stage: number): VillageRecord {
  return {
    id: '100,200', x: SITE.x, z: SITE.z, baseY: BASE_Y, variant: 'plains',
    name: '麦', produces: 'bread', inputs: ['wheat'], inputStock: new Map(), needs: [],
    stage, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0, harvest: 0, harvestProgress: 0,
  };
}

/** A world of solid grass at ground level, so growth has natural ground to build on.
 *  The top solid block is `BASE_Y`, which is what a village plateau is: `TerrainGenerator`
 *  fills a column up to and including its height, so somebody standing on it stands at
 *  `BASE_Y + 1`. */
/** Blocks for one chunk, worked out once and copied into every world that wants it.
 *  The columns are the same in all thirty-six chunks and this file builds two dozen
 *  worlds, so filling them cell by cell each time was half a million writes per world. */
const columnCache = new Map<string, Uint16Array>();

function chunkBlocks(key: string, fill: (chunk: Chunk) => void): Uint16Array {
  let cached = columnCache.get(key);
  if (!cached) {
    const template = new Chunk(0, 0, new Uint16Array(CHUNK_VOLUME), new Uint8Array(CHUNK_VOLUME));
    fill(template);
    cached = template.blocks;
    columnCache.set(key, cached);
  }
  // A copy, never the template: growth writes through these.
  return cached.slice();
}

function grassWorld(): World {
  const world = new World(1);
  for (let cx = 4; cx <= 9; cx++) {
    for (let cz = 10; cz <= 15; cz++) {
      const blocks = chunkBlocks('grass', (template) => {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let y = 0; y < BASE_Y; y++) template.set(lx, y, lz, Block.DIRT);
            template.set(lx, BASE_Y, lz, Block.GRASS);
          }
        }
      });
      const chunk = new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME));
      chunk.generated = true;
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Cells around the edge of a footprint: where a wall stands, and where a door goes. */
function perimeter(f: { x0: number; z0: number; w: number; d: number }): [number, number][] {
  const x1 = f.x0 + f.w - 1;
  const z1 = f.z0 + f.d - 1;
  const out: [number, number][] = [];
  for (let x = f.x0; x <= x1; x++) {
    for (let z = f.z0; z <= z1; z++) {
      if (x === f.x0 || x === x1 || z === f.z0 || z === z1) out.push([x, z]);
    }
  }
  return out;
}

function chunksOf(world: World) {
  return [...world.chunks.values()];
}

describe('village growth planning', () => {
  it('adds nothing at stage zero', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 0, []);
    expect(plan.placements).toHaveLength(0);
    expect(plan.villagers).toHaveLength(0);
  });

  it('is deterministic for the same village and stage', () => {
    const a = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    const b = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    expect(a.placements).toEqual(b.placements);
    expect(a.villagers).toEqual(b.villagers);
  });

  it('grows differently at different stages', () => {
    const one = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    const two = planGrowth(1, SITE, BASE_Y, 'plains', 2, []);
    expect(one.placements).not.toEqual(two.placements);
  });

  it('builds houses with villagers and chests to fill them', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    expect(plan.placements.length).toBeGreaterThan(100);
    expect(plan.villagers.length).toBeGreaterThanOrEqual(1);
    expect(plan.chests.length).toBeGreaterThanOrEqual(1);
  });

  it('never lands a new house on one that is already there', () => {
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const growth = planGrowth(999, SITE, BASE_Y, 'plains', 1, village.buildings);
    for (const marker of growth.villagers) {
      for (const b of village.buildings) {
        const inside =
          marker.x >= b.x0 && marker.x < b.x0 + b.w && marker.z >= b.z0 && marker.z < b.z0 + b.d;
        expect(inside).toBe(false);
      }
    }
  });

  it('leaves the original village alone when it is told what is occupied', () => {
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const growth = planGrowth(999, SITE, BASE_Y, 'plains', 1, village.buildings);
    // No growth block may sit inside an existing house footprint.
    for (const p of growth.placements) {
      for (const b of village.buildings) {
        const inside = p.x >= b.x0 && p.x < b.x0 + b.w && p.z >= b.z0 && p.z < b.z0 + b.d;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('growing past the first stage', () => {
  function footprints(stage: number) {
    clearGrowthCache();
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    return growthFor(999, record(stage), stage, village.buildings).footprints;
  }

  it('never lands a later stage on an earlier one', () => {
    clearGrowthCache();
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const taken: Footprint[] = [...village.buildings];
    for (let stage = 1; stage <= 4; stage++) {
      const plan = growthFor(999, record(stage), stage, village.buildings);
      for (const plot of plan.footprints) {
        for (const other of taken) {
          expect(overlaps(plot, other), `stage ${stage} plot overlaps`).toBe(false);
        }
        taken.push(plot);
      }
    }
  });

  it('finds room for a plot at every stage', () => {
    for (let stage = 1; stage <= 4; stage++) {
      expect(footprints(stage).length, `stage ${stage}`).toBeGreaterThan(0);
    }
  });

  it('continues adding non-overlapping outer blocks without a stage cap', () => {
    clearGrowthCache();
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const taken: Footprint[] = [...village.buildings];
    let earlyDistance = 0;
    let lateDistance = 0;
    for (let stage = 5; stage <= 30; stage++) {
      const plan = growthFor(999, record(stage), stage, village.buildings);
      expect(plan.footprints, `stage ${stage}`).toHaveLength(3);
      for (const plot of plan.footprints) {
        expect(taken.some((other) => overlaps(plot, other)), `stage ${stage} overlaps`).toBe(false);
        taken.push(plot);
        const distance = Math.hypot(plot.x0 + plot.w / 2 - SITE.x, plot.z0 + plot.d / 2 - SITE.z);
        if (stage === 5) earlyDistance = Math.max(earlyDistance, distance);
        if (stage === 30) lateDistance = Math.max(lateDistance, distance);
      }
    }
    expect(lateDistance).toBeGreaterThan(earlyDistance);
  });

  it('returns no stage when every searched outer plot is unsuitable', () => {
    const plan = planGrowth(999, SITE, BASE_Y, 'plains', 5, [], () => false);
    expect(plan.footprints).toHaveLength(0);
    expect(plan.placements).toHaveLength(0);
  });

  // The lamp posts and gate towers that used to mark stages 3 and 4 are gone with the
  // village they belonged to. A town grows by whole city blocks now, which is a far
  // louder change than a lamp — there is nothing left for a landmark to say.


});

describe('a house somebody can walk into', () => {
  /** The floor level of every building: one clear cell above the ground outside, so the
   *  doorway lines up with the street rather than opening below it. */
  const FLOOR = BASE_Y + 1;

  it('leaves a two block doorway in every grown house', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);

    const plan = growthFor(1, village, 1, []);
    expect(plan.footprints.length).toBeGreaterThan(0);
    for (const house of plan.footprints) {
      const door = perimeter(house).some(
        ([x, z]) =>
          world.getBlock(x, FLOOR, z) === Block.AIR && world.getBlock(x, FLOOR + 1, z) === Block.AIR,
      );
      expect(door, `house at ${house.x0},${house.z0} has no way in`).toBe(true);
    }
  });

  it('glazes the windows it planned', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);

    // Both of these arrive after the wall that stands in their cell, so both are the
    // case the writer used to refuse.
    const plan = growthFor(1, village, 1, []);
    const glass = plan.placements.filter((p) => p.b === Block.GLASS);
    expect(glass.length).toBeGreaterThan(0);
    expect(glass.every((p) => world.getBlock(p.x, p.y, p.z) === Block.GLASS)).toBe(true);
  });

  it('stands its floor level with the ground outside', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);

    const house = growthFor(1, village, 1, []).footprints[0];
    // Two in from the corner: one in is where the house puts its torch.
    const insideX = house.x0 + 2;
    const insideZ = house.z0 + 2;
    // Solid to stand on at the floor level, and clear above it.
    expect(world.getBlock(insideX, BASE_Y, insideZ)).not.toBe(Block.AIR);
    expect(world.getBlock(insideX, FLOOR, insideZ)).toBe(Block.AIR);
  });
});

describe('applying village growth', () => {
  it('writes its buildings into the world', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    let changed = 0;
    for (const chunk of chunksOf(world)) {
      changed += applyGrowth(world, 1, village, chunk, []).changed;
    }
    expect(changed).toBeGreaterThan(50);
  });

  it('changes nothing the second time it runs', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    const editCount = [...world.edits.values()].reduce((n, m) => n + m.size, 0);

    let again = 0;
    for (const chunk of chunksOf(world)) {
      again += applyGrowth(world, 1, village, chunk, []).changed;
    }
    expect(again).toBe(0);
    expect([...world.edits.values()].reduce((n, m) => n + m.size, 0)).toBe(editCount);
  });

  it('records its blocks so they survive a chunk being unloaded', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    const sample = [...world.edits.entries()].find(([, m]) => m.size > 0);
    expect(sample).toBeDefined();
  });

  it('refuses to build over anything the player put there', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    const plan = growthFor(1, village, 1, []);
    const wall = plan.placements.find((p) => p.b !== Block.AIR);
    expect(wall).toBeDefined();
    if (!wall) return;
    world.setBlock(wall.x, wall.y, wall.z, Block.CHEST);

    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    // The chest is still standing, and only that cell was skipped.
    expect(world.getBlock(wall.x, wall.y, wall.z)).toBe(Block.CHEST);
  });

  it('applies every stage up to the one the village has reached', () => {
    clearGrowthCache();
    const world = grassWorld();
    const one = record(1);
    let single = 0;
    for (const chunk of chunksOf(world)) single += applyGrowth(world, 1, one, chunk, []).changed;

    clearGrowthCache();
    const fresh = grassWorld();
    const two = record(2);
    let both = 0;
    for (const chunk of chunksOf(fresh)) both += applyGrowth(fresh, 1, two, chunk, []).changed;
    expect(both).toBeGreaterThan(single);
  });

  it('will not build a wall over a road', () => {
    // A village that grew across its own road used to be invisible: a road could skip
    // twenty blocks, so the survey stepped over the sealed column. Now that one column is
    // the difference between one road and two, the wall is the thing that gives way.
    clearGrowthCache();
    const world = grassWorld();
    const village = record(2);
    // Pretend the whole plateau is paved. Whatever growth wants to build, it wants to
    // build somewhere in here.
    const roadAt = (x: number, z: number): number | undefined =>
      Math.abs(x - SITE.x) <= 40 && Math.abs(z - SITE.z) <= 40 ? BASE_Y : undefined;
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, [], roadAt);
    for (let z = SITE.z - 40; z <= SITE.z + 40; z++) {
      for (let x = SITE.x - 40; x <= SITE.x + 40; x++) {
        for (let y = BASE_Y + 1; y <= BASE_Y + 2; y++) {
          expect(blockDef(world.getBlock(x, y, z)).solid, `sealed the road at ${x},${y},${z}`)
            .toBe(false);
        }
      }
    }
  });

  it('builds normally where there is no road', () => {
    clearGrowthCache();
    const world = grassWorld();
    let changed = 0;
    for (const chunk of chunksOf(world)) {
      changed += applyGrowth(world, 1, record(2), chunk, [], () => undefined).changed;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('lists the chunks its buildings reach into', () => {
    clearGrowthCache();
    const chunks = growthChunks(1, record(1), []);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(Number.isInteger(c.cx)).toBe(true);
      expect(Number.isInteger(c.cz)).toBe(true);
    }
  });
});

/** The same world with a step in it: everything east of the village centre is three
 *  blocks lower. That is what the outer ring of a plateau does — the flattening fades out
 *  over its last fourteen blocks — only sharper, so one test can stand in for a hillside. */
function slopedWorld(): World {
  const world = new World(1);
  for (let cx = 4; cx <= 9; cx++) {
    for (let cz = 10; cz <= 15; cz++) {
      // The step runs north-south, so a column depends on cx but not on cz: six templates
      // cover the whole world.
      const blocks = chunkBlocks(`sloped:${cx}`, (template) => {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const top = cx * CHUNK_SIZE + lx >= SITE.x + 8 ? BASE_Y - 3 : BASE_Y;
            for (let y = 0; y < top; y++) template.set(lx, y, lz, Block.DIRT);
            template.set(lx, top, lz, Block.GRASS);
          }
        }
      });
      const chunk = new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME));
      chunk.generated = true;
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Lays a road along a line of columns and answers where it is, the way the road index
 *  does. Real blocks, so a test can ask whether growth took them away. */
function layRoad(world: World, cells: [number, number][], y: number, surface: BlockId = Block.DIRT_PATH) {
  const at = new Map<string, number>();
  for (const [x, z] of cells) {
    world.setBlock(x, y, z, surface);
    for (let h = 1; h <= 2; h++) world.setBlock(x, y + h, z, Block.AIR);
    at.set(`${x},${z}`, y);
  }
  return { at, roadAt: (x: number, z: number) => at.get(`${x},${z}`) };
}

/** Every column of a plot, and the whole line through the middle of one. */
function columnsOf(f: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let x = f.x0; x < f.x0 + f.w; x++) {
    for (let z = f.z0; z < f.z0 + f.d; z++) out.push([x, z]);
  }
  return out;
}

describe('a village that grows around somebody else\'s road', () => {
  const FLOOR = BASE_Y + 1;

  /** A road straight through the middle of the first plot stage one means to fill, and
   *  well past it either side. */
  function acrossTheFirstPlot(world: World) {
    const plot = growthFor(1, record(1), 1, []).footprints[0];
    const lane = plot.z0 + (plot.d >> 1);
    const cells: [number, number][] = [];
    // Across this block and no further. A town's blocks are three apart, so a road with
    // twelve blocks of run-up either side crosses its neighbours too — and then "the plots
    // the road misses" is every plot, which proves nothing.
    for (let x = plot.x0 - 1; x < plot.x0 + plot.w + 1; x++) cells.push([x, lane]);
    return { plot, ...layRoad(world, cells, BASE_Y) };
  }

  it('knows when a road runs through a plot', () => {
    clearGrowthCache();
    const world = grassWorld();
    const { plot, roadAt } = acrossTheFirstPlot(world);
    expect(roadCrosses(plot, FLOOR, world, roadAt)).toBe(true);
    // Somewhere else on the plateau is somewhere else.
    expect(roadCrosses({ x0: SITE.x - 30, z0: SITE.z - 30, w: 5, d: 5 }, FLOOR, world, roadAt)).toBe(false);
    // So is the same plot with no road index to consult.
    expect(roadCrosses(plot, FLOOR, world)).toBe(false);
  });

  it('builds nothing at all on that plot', () => {
    clearGrowthCache();
    const world = grassWorld();
    const { plot, roadAt } = acrossTheFirstPlot(world);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, [], roadAt);

    // Not a wall, not a floor, not a pane of glass. A house raised around a road is a
    // house with a road-shaped hole through it, which is worse than no house.
    for (const [x, z] of columnsOf(plot)) {
      for (let y = FLOOR; y <= FLOOR + 4; y++) {
        expect(blockDef(world.getBlock(x, y, z)).solid, `built at ${x},${y},${z}`).toBe(false);
      }
    }
  });

  it('leaves every block of the road where it was', () => {
    clearGrowthCache();
    const world = grassWorld();
    const { at, roadAt } = acrossTheFirstPlot(world);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(2), chunk, [], roadAt);
    for (const [key, y] of at) {
      const [x, z] = key.split(',').map(Number);
      expect(world.getBlock(x, y, z), `road lost at ${key}`).toBe(Block.DIRT_PATH);
    }
  });

  it('leaves a gravel road alone, which the list of natural ground cannot', () => {
    // Gravel is both a road somebody lays and ground the world is made of, so the rule
    // that growth may build over soil is the one rule that would take it away.
    clearGrowthCache();
    const world = grassWorld();
    const cells: [number, number][] = [];
    for (let x = SITE.x - 20; x <= SITE.x + 20; x++) cells.push([x, SITE.z + 13]);
    const { at, roadAt } = layRoad(world, cells, BASE_Y, Block.GRAVEL);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(4), chunk, [], roadAt);
    for (const [key, y] of at) {
      const [x, z] = key.split(',').map(Number);
      expect(world.getBlock(x, y, z), `road lost at ${key}`).toBe(Block.GRAVEL);
    }
  });

  it('does not move a villager into a house it never built', () => {
    clearGrowthCache();
    const world = grassWorld();
    const { plot, roadAt } = acrossTheFirstPlot(world);
    const all = growthVillagers(1, record(1), []);
    const some = growthVillagers(1, record(1), [], world, roadAt);
    expect(some.length).toBeLessThan(all.length);
    for (const v of some) {
      const inside = v.x >= plot.x0 && v.x < plot.x0 + plot.w && v.z >= plot.z0 && v.z < plot.z0 + plot.d;
      expect(inside).toBe(false);
    }
  });

  it('keeps a house that somebody paved up to afterwards', () => {
    // Paving a spur to your own depot's door is the ordinary thing to do with a road, and
    // it must not take the building it leads to off the map.
    clearGrowthCache();
    const world = grassWorld();
    const plot = growthFor(1, record(1), 1, []).footprints[0];
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, []);
    // Now pave along the front of the finished house, doorstep included.
    const cells: [number, number][] = [];
    for (let x = plot.x0 - 6; x < plot.x0 + plot.w + 6; x++) cells.push([x, plot.z0]);
    const { roadAt } = layRoad(world, cells, BASE_Y);
    const own = ownPaving(1, record(1), []);
    expect(roadCrosses(plot, FLOOR, world, roadAt, own)).toBe(false);
    // An empty plot with the same road across it is still given up. Well clear of the
    // town: a plot a few blocks over is another of its blocks, and the ground a town has
    // laid for itself is never "somebody's road".
    const empty = { x0: plot.x0, z0: SITE.z + 40, w: plot.w, d: plot.d };
    for (let x = empty.x0 - 2; x < empty.x0 + empty.w + 2; x++) cells.push([x, empty.z0 + 1]);
    const road = layRoad(world, cells, BASE_Y);
    expect(roadCrosses(empty, FLOOR, world, road.roadAt, own)).toBe(true);
  });

  it('builds the plots the road misses as usual', () => {
    clearGrowthCache();
    const world = grassWorld();
    const { plot, roadAt } = acrossTheFirstPlot(world);
    let changed = 0;
    for (const chunk of chunksOf(world)) {
      changed += applyGrowth(world, 1, record(1), chunk, [], roadAt).changed;
    }
    expect(changed).toBeGreaterThan(50);
    const others = growthFor(1, record(1), 1, []).footprints.filter((f) => f !== plot);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      const raised = columnsOf(other).some(([x, z]) => blockDef(world.getBlock(x, FLOOR + 1, z)).solid);
      expect(raised, `nothing raised at ${other.x0},${other.z0}`).toBe(true);
    }
  });
});

describe('a house on ground that is not flat', () => {
  it('puts ground under every column of its floor', () => {
    clearGrowthCache();
    const world = slopedWorld();
    const village = record(4);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);

    for (let stage = 1; stage <= 4; stage++) {
      for (const plot of growthFor(1, village, stage, []).footprints) {
        for (const [x, z] of columnsOf(plot)) {
          // The floor is solid, and so is the block holding it up. A house whose floor
          // sits over air is the one that reads as floating.
          expect(blockDef(world.getBlock(x, BASE_Y, z)).solid, `no floor at ${x},${z}`).toBe(true);
          expect(blockDef(world.getBlock(x, BASE_Y - 1, z)).solid, `nothing under ${x},${z}`).toBe(true);
        }
      }
    }
  });

  it('leaves the same house standing on flat ground', () => {
    clearGrowthCache();
    const flat = grassWorld();
    for (const chunk of chunksOf(flat)) applyGrowth(flat, 1, record(4), chunk, []);
    clearGrowthCache();
    const sloped = slopedWorld();
    for (const chunk of chunksOf(sloped)) applyGrowth(sloped, 1, record(4), chunk, []);
    const plot = growthFor(1, record(4), 1, []).footprints[0];
    for (const [x, z] of columnsOf(plot)) {
      expect(sloped.getBlock(x, BASE_Y + 1, z)).toBe(flat.getBlock(x, BASE_Y + 1, z));
    }
  });

  it('does not fill a hillside it would have to move', () => {
    // Eight blocks of fill is a terrace; a cliff is somebody else's problem.
    clearGrowthCache();
    const world = grassWorld();
    const plot = growthFor(1, record(1), 1, []).footprints[0];
    // Cut a shaft under one corner of the plot, deeper than growth will ever fill.
    for (let y = BASE_Y; y > BASE_Y - 30; y--) world.setBlock(plot.x0, y, plot.z0, Block.AIR);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, []);
    expect(world.getBlock(plot.x0, BASE_Y - 9, plot.z0)).toBe(Block.AIR);
  });
});

describe('a house on last year\'s field', () => {
  it('lays its floor over the crops', () => {
    clearGrowthCache();
    const world = grassWorld();
    const plot = growthFor(1, record(1), 1, []).footprints[0];
    for (const [x, z] of columnsOf(plot)) {
      world.setBlock(x, BASE_Y - 1, z, Block.FARMLAND_WET);
      world.setBlock(x, BASE_Y, z, Block.WHEAT_2);
    }
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, []);
    for (const [x, z] of columnsOf(plot)) {
      expect(blockDef(world.getBlock(x, BASE_Y, z)).solid, `no floor at ${x},${z}`).toBe(true);
    }
  });
});

describe('a village that has already built something', () => {
  /** The world, plus a road index kept up to date the way the game keeps it: growth
   *  writes recorded edits, and a recorded edit made of planks or path is a road as far as
   *  the index is concerned. */
  function indexed() {
    const world = grassWorld();
    const roads = new RoadNetwork(world);
    world.onBlockChange((x, y, z, previous, next) => roads.onBlockChanged(x, y, z, previous, next));
    return { world, roads, roadAt: (x: number, z: number) => roads.columns.get(`${x},${z}`) };
  }

  it('keeps building, having paved its own doorsteps and floors', () => {
    // A village lays a few blocks of path outside each door and floors its houses with
    // planks. Both are road blocks in recorded edits, so a village that took its own work
    // for somebody else's road stopped building the moment it had built anything.
    clearGrowthCache();
    const { world, roads, roadAt } = indexed();
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, [], roadAt);
    expect(roads.columns.size, 'the village indexes as road at all').toBeGreaterThan(0);

    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(4), chunk, [], roadAt);
    for (let stage = 2; stage <= 4; stage++) {
      for (const plot of growthFor(1, record(4), stage, []).footprints) {
        // A floor across the whole plot, and something standing on it. Four is the market
        // hall, which is a roof on four corner posts and open on every side.
        for (const [x, z] of columnsOf(plot)) {
          expect(blockDef(world.getBlock(x, BASE_Y, z)).solid, `no floor at ${x},${z}`).toBe(true);
        }
        const raised = columnsOf(plot).filter(([x, z]) => blockDef(world.getBlock(x, BASE_Y + 2, z)).solid);
        expect(raised.length, `stage ${stage} built nothing at ${plot.x0},${plot.z0}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('still houses everybody it built a house for', () => {
    clearGrowthCache();
    const { world, roadAt } = indexed();
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(4), chunk, [], roadAt);
    expect(growthVillagers(1, record(4), [], world, roadAt).length)
      .toBe(growthVillagers(1, record(4), []).length);
  });

  it('does not call its own doorstep a road through the plot', () => {
    clearGrowthCache();
    const { world, roadAt } = indexed();
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(1), chunk, [], roadAt);
    const own = ownPaving(1, record(1), []);

    // Something the town laid for itself that the index has picked up. A house floor is
    // planks and a street is dirt path, and both are road materials lying at street level
    // — so without `own` a town reads as a road running through its own plots.
    const paved = [...own].find(([key, block]) => {
      const [x, y, z] = key.split(',').map(Number);
      return ROAD_BLOCKS.has(block) && roadAt(x, z) === y;
    });
    expect(paved, 'the town laid nothing the index picked up').toBeDefined();
    if (!paved) return;
    const [x, , z] = paved[0].split(',').map(Number);
    const plot = { x0: x, z0: z, w: 1, d: 1 };

    expect(roadCrosses(plot, BASE_Y + 1, world, roadAt, own)).toBe(false);
    // Without knowing what it laid, it cannot tell its own doorstep from anybody's road.
    expect(roadCrosses(plot, BASE_Y + 1, world, roadAt)).toBe(true);
  });
});

describe('a town that rebuilds its middle', () => {
  /** A world with the town's own generated buildings standing in it, which is what a
   *  redevelopment finds when it arrives. */
  function built() {
    const world = grassWorld();
    const plan = planVillage(1, SITE, BASE_Y, 'plains');
    for (const list of plan.byChunk.values()) {
      for (const p of list) world.setBlock(p.x, p.y, p.z, p.b);
    }
    return { world, plan };
  }

  function apply(world: World, stage: number): void {
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, record(stage), chunk, []);
  }

  /** Every cell the old shop stood in, and what it was made of. */
  function oldShop(plan: ReturnType<typeof planVillage>, plot: Footprint) {
    const out = new Map<string, BlockId>();
    for (const list of plan.byChunk.values()) {
      for (const p of list) {
        if (p.x < plot.x0 || p.x >= plot.x0 + plot.w) continue;
        if (p.z < plot.z0 || p.z >= plot.z0 + plot.d) continue;
        out.set(`${p.x},${p.y},${p.z}`, p.b);
      }
    }
    return out;
  }

  it('takes the old shop down and puts a building with floors up', () => {
    clearGrowthCache();
    const { world, plan } = built();
    const redevelopment = planRedevelopment(1, SITE, BASE_Y, 'plains', REDEVELOP_STAGE)!;
    const plot = redevelopment.replaces[0];
    const before = oldShop(plan, plot);
    // The shop is really standing there first, or this proves nothing.
    let standing = 0;
    for (const [key, block] of before) {
      const [x, y, z] = key.split(',').map(Number);
      if (block !== Block.AIR && world.getBlock(x, y, z) === block) standing++;
    }
    expect(standing, 'the shop this rebuilds was standing').toBeGreaterThan(40);

    apply(world, REDEVELOP_STAGE);
    // Every block the new building asked for is in the world, old walls and all. The
    // plan is read the way the writer reads it: one block per cell, the last one asked
    // for, because a builder raises a wall and then knocks the door out of it.
    const wanted = new Map<string, BlockId>();
    for (const p of redevelopment.placements) wanted.set(`${p.x},${p.y},${p.z}`, p.b);
    const missing: string[] = [];
    for (const [key, block] of wanted) {
      const [x, y, z] = key.split(',').map(Number);
      if (world.getBlock(x, y, z) !== block) missing.push(`${key}: ${world.getBlock(x, y, z)} not ${block}`);
    }
    expect(missing.slice(0, 5), 'the new building went up whole').toEqual([]);
    // And it is taller than anything the town had before: a lift shaft that reaches the
    // top floor is what a rebuilt middle is for.
    let lifts = 0;
    for (let y = BASE_Y; y < BASE_Y + 40; y++) {
      for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
        for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
          if (isElevator(world.getBlock(x, y, z))) lifts++;
        }
      }
    }
    expect(lifts).toBeGreaterThanOrEqual(STOREY * MIN_FLOORS - 2);
  });

  it('changes nothing the second time it runs', () => {
    clearGrowthCache();
    const { world } = built();
    apply(world, REDEVELOP_STAGE);
    const edits = new Map(world.edits);
    apply(world, REDEVELOP_STAGE);
    expect(world.edits.size).toBe(edits.size);
    for (const [key, block] of world.edits) expect(block).toBe(edits.get(key));
  });

  it('leaves anything the player put in the old shop where it is', () => {
    clearGrowthCache();
    const { world } = built();
    const plot = planRedevelopment(1, SITE, BASE_Y, 'plains', REDEVELOP_STAGE)!.replaces[0];
    // A chest on the shop floor, in the middle of the plot where the new building's own
    // walls and desks want to be.
    const x = plot.x0 + 3;
    const z = plot.z0 + 3;
    world.setBlock(x, BASE_Y + 1, z, Block.CHEST);
    apply(world, REDEVELOP_STAGE);
    expect(world.getBlock(x, BASE_Y + 1, z)).toBe(Block.CHEST);
  });

  it('builds nothing in the middle of a town that has not reached the stage', () => {
    clearGrowthCache();
    const { world, plan } = built();
    const plot = planRedevelopment(1, SITE, BASE_Y, 'plains', REDEVELOP_STAGE)!.replaces[0];
    apply(world, REDEVELOP_STAGE - 1);
    // The old shop is still every bit of itself.
    for (const [key, block] of oldShop(plan, plot)) {
      const [x, y, z] = key.split(',').map(Number);
      if (block === Block.AIR) continue;
      expect(world.getBlock(x, y, z)).toBe(block);
    }
  });
});
