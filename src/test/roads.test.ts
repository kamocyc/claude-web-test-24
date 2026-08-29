import { describe, expect, it } from 'vitest';
import {
  HEADROOM,
  MAX_STEP,
  RoadNetwork,
  ROAD_BLOCKS,
  STREET_REACH,
  ROAD_SPEED,
  faultSummary,
  roadGrade,
  toWaypoints,
  type RoadWorld,
} from '../game/roads';
import { runRoad } from '../game/paving';
import { Block, type BlockId } from '../world/blocks';
import { blockIndex, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';
import type { VillageRecord } from '../game/villages';

/** The two ends every road in this file runs between: one column past each town's
 *  outermost street, so a finished road touches the grid at both ends. Derived rather than
 *  written down, because the town that decides it is generated geometry. */
const FROM = STREET_REACH + 1;
const TO = 240 - STREET_REACH - 1;


const GROUND = 60;

/** A world made only of what the test lays down. Nothing is loaded by default, which is
 *  the case the whole design exists for: a road between two villages spends most of its
 *  life in chunks that are not in memory. */
class FakeWorld implements RoadWorld {
  readonly edits = new Map<string, Map<number, BlockId>>();
  readonly loaded = new Set<string>();
  readonly blocks = new Map<string, BlockId>();
  readonly ground = new Map<string, number>();

  lay(x: number, y: number, z: number, id: BlockId): void {
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let edits = this.edits.get(key);
    if (!edits) {
      edits = new Map();
      this.edits.set(key, edits);
    }
    edits.set(blockIndex(toLocalCoord(x), y, toLocalCoord(z)), id);
    this.blocks.set(`${x},${y},${z}`, id);
  }

  load(x: number, z: number): void {
    this.loaded.add(chunkKey(toChunkCoord(x), toChunkCoord(z)));
  }

  setGround(x: number, z: number, y: number): void {
    this.ground.set(`${x},${z}`, y);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  heightAt(x: number, z: number): number {
    return this.ground.get(`${x},${z}`) ?? GROUND;
  }

  isLoadedAt(x: number, z: number): boolean {
    return this.loaded.has(chunkKey(toChunkCoord(x), toChunkCoord(z)));
  }
}

function village(id: string, x: number, z: number): VillageRecord {
  return {
    id, x, z, baseY: GROUND, variant: 'plains', name: id, kind: 'farm',
    produces: 'wheat', input: null, inputStock: 0, needs: [],
    stage: 0, points: 0, stock: 0, received: 0, discovered: true, spawnedStage: 0,
    progress: 0,
  };
}

const A = village('a', 0, 0);
const B = village('b', 240, 0);

/** An unbroken road between the two villages' street ends, which sit at x=30 and x=210.
 *  A road connects by touching an arm of a village's street cross, so it starts one block
 *  out from each. */
function pave(
  world: FakeWorld,
  from = FROM,
  to = TO,
  y = GROUND,
  surface: BlockId = Block.DIRT_PATH,
): void {
  for (let x = from; x <= to; x++) world.lay(x, y, 0, surface);
}

describe('road index', () => {
  it('indexes only blocks the player recorded', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    // Natural gravel exists in the world but was never placed, so it is not a road.
    world.load(30, 0);
    world.blocks.set(`30,${GROUND},0`, Block.GRAVEL);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columns.has('10,0')).toBe(true);
    expect(roads.columns.has('30,0')).toBe(false);
  });

  it('refuses a road with something standing on it', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    world.lay(10, GROUND + 1, 0, Block.OAK_LOG);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columns.has('10,0')).toBe(false);
  });

  it('rebuilds the same index from the same edits', () => {
    const world = new FakeWorld();
    pave(world, FROM, 60);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const first = [...roads.columns.entries()].sort();
    roads.seedFromEdits();
    expect([...roads.columns.entries()].sort()).toEqual(first);
  });

  it('bumps the revision when a road block appears', () => {
    const world = new FakeWorld();
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const before = roads.revision;
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    roads.onBlockChanged(10, GROUND, 0, Block.GRASS, Block.DIRT_PATH);
    expect(roads.revision).toBeGreaterThan(before);
    expect(roads.columns.get('10,0')).toBe(GROUND);
  });

  it('drops a column when its road is dug up', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    world.lay(10, GROUND, 0, Block.AIR);
    roads.onBlockChanged(10, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    expect(roads.columns.has('10,0')).toBe(false);
  });

  it('keeps the road where it is when a village paves over it', () => {
    // A village that grows beside a road raises its own ground and lays its own paving
    // above it. Both levels are roads; the one the player walks is the one that was
    // there first, and moving the index up onto the village's doorstep left a step in
    // the middle of a road that had been carrying goods all game.
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columns.get('10,0')).toBe(GROUND);

    const floor = GROUND + 11;
    world.lay(10, floor, 0, Block.STONE_BRICKS);
    roads.onBlockChanged(10, floor, 0, Block.AIR, Block.STONE_BRICKS);
    expect(roads.columns.get('10,0')).toBe(GROUND);

    // And it lets go, once the road that held it stops being one. What is up on the
    // village's floor is only picked up when something happens up there, because the
    // search only ever looks around the block that changed.
    world.lay(10, GROUND, 0, Block.AIR);
    roads.onBlockChanged(10, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    expect(roads.columns.has('10,0')).toBe(false);
    roads.onBlockChanged(10, floor, 0, Block.AIR, Block.STONE_BRICKS);
    expect(roads.columns.get('10,0')).toBe(floor);
  });

  it('lists every block a player can pave with', () => {
    expect(ROAD_BLOCKS.has(Block.DIRT_PATH)).toBe(true);
    expect(ROAD_BLOCKS.has(Block.COBBLESTONE)).toBe(true);
    // Bare stone and dirt are what the world is made of, so they could never be told
    // apart from natural ground.
    expect(ROAD_BLOCKS.has(Block.STONE)).toBe(false);
    expect(ROAD_BLOCKS.has(Block.DIRT)).toBe(false);
  });

  it('remembers what each column is paved with', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.surfaces.get('10,0')).toBe(Block.DIRT_PATH);

    world.lay(10, GROUND, 0, Block.STONE_BRICKS);
    roads.onBlockChanged(10, GROUND, 0, Block.DIRT_PATH, Block.STONE_BRICKS);
    expect(roads.surfaces.get('10,0')).toBe(Block.STONE_BRICKS);
    // Repaving moves nothing, but the routes still have to be told about it.
    expect(roads.columns.get('10,0')).toBe(GROUND);
  });

  it('hands the minimap the surface along with the column', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.GRAVEL);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columnsIn(0, -5, 20, 5)).toEqual([{ x: 10, z: 0, y: GROUND, b: Block.GRAVEL }]);
  });
});

describe('road quality', () => {
  function qualityOf(surface: BlockId): number {
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 0, surface);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    return result.quality;
  }

  it('rates a finished dirt path as the baseline', () => {
    expect(qualityOf(Block.DIRT_PATH)).toBeCloseTo(1, 5);
  });

  it('rates better pavement higher, in the order the blocks cost to make', () => {
    expect(qualityOf(Block.GRAVEL)).toBeGreaterThan(qualityOf(Block.DIRT_PATH));
    expect(qualityOf(Block.COBBLESTONE)).toBeGreaterThan(qualityOf(Block.GRAVEL));
    expect(qualityOf(Block.STONE_BRICKS)).toBeGreaterThan(qualityOf(Block.COBBLESTONE));
    expect(qualityOf(Block.STONE_BRICKS)).toBeCloseTo(ROAD_SPEED.get(Block.STONE_BRICKS) ?? 0, 5);
  });

  it('names the grades in order', () => {
    const names = [0.8, 1, 1.2, 1.45, 1.7].map((q) => roadGrade(q));
    expect(new Set(names).size).toBe(names.length);
  });

  it('follows the pavement rather than striding over it', () => {
    // The survey must step column to column on a finished road: a path that leapt along
    // it would report a paved road as rough, and would hand a porter waypoints that cut
    // its corners.
    const world = new FakeWorld();
    pave(world);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    // Two village stubs plus one straight run, once the straight parts are folded away.
    expect(toWaypoints(result.waypoints).length).toBeLessThanOrEqual(4);
    expect(result.length).toBeGreaterThan(150);
    // And every block of it is a waypoint before the straight parts are folded away.
    expect(result.waypoints.length).toBeGreaterThan(150);
  });
});

describe('road survey', () => {
  it('connects two villages across a paved route', () => {
    const world = new FakeWorld();
    pave(world);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    expect(result.connected).toBe(true);
    if (!result.connected) return;
    // Street end to street end, which is the gap between the two towns' street grids.
    expect(result.length).toBeCloseTo(B.x - A.x - STREET_REACH * 2);
    expect(result.waypoints[0].x).toBeLessThanOrEqual(A.x + STREET_REACH + 1);
    expect(result.waypoints[result.waypoints.length - 1].x)
      .toBeGreaterThanOrEqual(B.x - STREET_REACH - 1);
  });

  it('refuses a road with a single block missing', () => {
    const world = new FakeWorld();
    pave(world, FROM, 119);
    pave(world, 121, TO);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(false);
  });

  it('follows a road round a corner', () => {
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 40, Block.DIRT_PATH);
    for (let z = 0; z <= 40; z++) world.lay(FROM, GROUND, z, Block.DIRT_PATH);
    for (let z = 0; z <= 40; z++) world.lay(TO, GROUND, z, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(true);
  });

  it('takes a road up a slope but not up a wall', () => {
    // A hill in the middle: two blocks up per step for twenty steps, then back down.
    const gentle = new FakeWorld();
    const height = (x: number): number => GROUND + MAX_STEP * Math.max(0, 20 - Math.abs(120 - x));
    for (let x = FROM; x <= TO; x++) gentle.lay(x, height(x), 0, Block.DIRT_PATH);
    const up = new RoadNetwork(gentle);
    up.seedFromEdits();
    expect(up.survey(A, B).connected).toBe(true);

    const steep = new FakeWorld();
    pave(steep, FROM, 119);
    pave(steep, 120, TO, GROUND + MAX_STEP + 1);
    const wall = new RoadNetwork(steep);
    wall.seedFromEdits();
    expect(wall.survey(A, B).connected).toBe(false);
  });

  it('crosses water on a bridge, because a bridge is blocks somebody laid', () => {
    const world = new FakeWorld();
    pave(world);
    // Open sea under the middle of it. The road is above the water, so it carries.
    for (let x = 100; x <= 140; x++) world.setGround(x, 0, 40);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(true);
  });

  it('reports where each side runs out when the road is unfinished', () => {
    const world = new FakeWorld();
    pave(world, FROM, 110);
    pave(world, 170, TO);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    expect(result.connected).toBe(false);
    if (result.connected) return;
    expect(result.frontierFrom.x).toBe(110);
    expect(result.frontierTo.x).toBe(170);
    expect(result.missing).toBeCloseTo(60);
  });

  it('points at the village street when no road has been started', () => {
    const world = new FakeWorld();
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    expect(result.connected).toBe(false);
    if (result.connected) return;
    // Nothing is laid, so each end is still standing on its own outermost street.
    expect(result.frontierFrom.x).toBe(A.x + STREET_REACH);
    expect(result.frontierTo.x).toBe(B.x - STREET_REACH);
  });

  it('gives the same answer whether or not the chunks are loaded', () => {
    const world = new FakeWorld();
    pave(world);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const away = roads.survey(A, B);
    for (let x = 0; x <= 240; x += 16) world.load(x, 0);
    roads.seedFromEdits();
    const nearby = roads.survey(A, B);
    expect(nearby.connected).toBe(away.connected);
  });
});

describe('waypoint trimming', () => {
  it('folds a straight run down to its ends', () => {
    const path = Array.from({ length: 10 }, (_, i) => ({ x: i, z: 0, y: GROUND }));
    expect(toWaypoints(path)).toEqual([path[0], path[9]]);
  });

  it('keeps the corner where the road turns', () => {
    const path = [
      { x: 0, z: 0, y: GROUND },
      { x: 1, z: 0, y: GROUND },
      { x: 2, z: 0, y: GROUND },
      { x: 2, z: 1, y: GROUND },
      { x: 2, z: 2, y: GROUND },
    ];
    expect(toWaypoints(path)).toEqual([path[0], path[2], path[4]]);
  });

  it('leaves a short path alone', () => {
    const path = [{ x: 0, z: 0, y: GROUND }, { x: 5, z: 0, y: GROUND }];
    expect(toWaypoints(path)).toEqual(path);
  });
});


describe('a road goes up, down, left and right', () => {
  it('does not join two columns that only meet at a corner', () => {
    // The rule this whole feature turns on. A line of blocks laid corner to corner reads
    // as a road at a glance and is not one — and allowing it was where every awkward
    // corner of the width rule came from.
    const world = new FakeWorld();
    for (let i = 0; i <= 178; i++) world.lay(FROM + i, GROUND, i, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columns.size).toBe(179);
    // Every column is indexed, and no two of them are one road.
    const a = village('a', 0, 0);
    const b = village('b', 240, 178);
    expect(roads.survey(a, b).connected).toBe(false);
  });

  it('joins them once the corner is filled in', () => {
    const world = new FakeWorld();
    const rise = TO - FROM;
    for (let i = 0; i <= rise; i++) {
      world.lay(FROM + i, GROUND, i, Block.DIRT_PATH);
      // The step that turns a staircase from a diagonal into a road.
      if (i > 0) world.lay(FROM + i, GROUND, i - 1, Block.DIRT_PATH);
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const a = village('a', 0, 0);
    const b = village('b', 240, rise);
    expect(roads.survey(a, b).connected).toBe(true);
  });
});

describe('the step and the headroom', () => {
  /** A road that climbs `rise` in one go half way along, and comes back down a block at
   *  a time so the far end still meets the village it is arriving at. Only the one riser
   *  is ever in question. */
  function withStep(rise: number): RoadNetwork {
    const world = new FakeWorld();
    for (let x = FROM; x <= 120; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    for (let x = 121; x <= TO; x++) {
      world.lay(x, GROUND + Math.min(rise, TO - x), 0, Block.DIRT_PATH);
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    return roads;
  }

  it('walks up a step a porter can climb', () => {
    expect(withStep(MAX_STEP).survey(A, B).connected).toBe(true);
  });

  it('refuses one it cannot', () => {
    // The rule is the walker's, not the index's: a two block riser is a road that reads
    // as connected and walks as a dead end, which is what used to strand a porter.
    const result = withStep(MAX_STEP + 1).survey(A, B);
    expect(result.connected).toBe(false);
    if (result.connected) return;
    expect(result.nearMiss).not.toBeNull();
    expect(result.nearMiss?.x).toBe(120);
  });

  it('says so as a fault, at the block it happens on', () => {
    const faults = withStep(MAX_STEP + 1).faults(120, 0, 8);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ x: 120, z: 0, kind: 'step' });
    expect(faultSummary(faults)).toBe('段差 1 か所');
  });

  it('will not count a road with a branch over it', () => {
    const world = new FakeWorld();
    pave(world);
    // A canopy one block above head height: the road is still there, and nobody 1.95
    // tall gets under it.
    world.lay(120, GROUND + HEADROOM, 0, Block.OAK_LEAVES);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.columns.has('120,0')).toBe(false);
    expect(roads.survey(A, B).connected).toBe(false);
    expect(roads.faults(120, 0, 4)).toEqual([
      { x: 120, z: 0, y: GROUND, kind: 'headroom' },
    ]);
  });

  it('counts it again once the branch is cut', () => {
    const world = new FakeWorld();
    pave(world);
    world.lay(120, GROUND + HEADROOM, 0, Block.OAK_LEAVES);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    world.lay(120, GROUND + HEADROOM, 0, Block.AIR);
    roads.onBlockChanged(120, GROUND + HEADROOM, 0, Block.OAK_LEAVES, Block.AIR);
    expect(roads.columns.get('120,0')).toBe(GROUND);
    expect(roads.survey(A, B).connected).toBe(true);
    expect(roads.faults(120, 0, 4)).toEqual([]);
  });
});

describe('climbing costs time', () => {
  it('prefers the level way round to the staircase', () => {
    // Two roads between the same villages: one straight and flat with a hill in the way
    // that has to be climbed and dropped again, one a little longer and level all the
    // way. The longer one is the one a walker gets there first on.
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) {
      const rise = Math.max(0, 20 - Math.abs(120 - x));
      world.lay(x, GROUND + rise, 0, Block.DIRT_PATH);
    }
    // The detour: out to z=12, along, and back. Level throughout.
    for (let z = 0; z <= 12; z++) world.lay(FROM, GROUND, z, Block.DIRT_PATH);
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 12, Block.DIRT_PATH);
    for (let z = 0; z <= 12; z++) world.lay(TO, GROUND, z, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.climb).toBe(0);
    expect(result.waypoints.some((p) => p.z === 12)).toBe(true);
  });

  it('drags a staircase road down to a track', () => {
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) {
      world.lay(x, GROUND + (x % 2), 0, Block.STONE_BRICKS);
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.climb).toBeGreaterThan(100);
    // Stone brick is the best surface there is, and up-and-down all the way still makes
    // it worse than a flat dirt path.
    expect(result.quality).toBeLessThan(1);
  });

  it('reports how much further round the road goes than the crow flies', () => {
    const world = new FakeWorld();
    pave(world);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.direct).toBeCloseTo(result.length, 5);
  });
});

describe('a road wide enough for a cart', () => {
  /** The same road, `width` columns across. */
  function band(width: number, gapAt: number | null = null): RoadNetwork {
    const world = new FakeWorld();
    const span = Math.floor((width - 1) / 2);
    for (let x = FROM; x <= TO; x++) {
      for (let z = -span; z <= span; z++) {
        if (gapAt !== null && x === gapAt && z !== 0) continue;
        world.lay(x, GROUND, z, Block.DIRT_PATH);
      }
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    return roads;
  }

  it('runs a cart down three columns', () => {
    const result = band(3).survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(true);
  });

  it('will not run one down a single track', () => {
    const result = band(1).survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(false);
  });

  it('points at the pinch when one block of the width is missing', () => {
    const roads = band(3, 120);
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('a narrow road still carries a porter');
    if (result.cart.ok) throw new Error('one narrow column should stop a cart');
    // The wide network stops just short of the waist, which is where to go and widen.
    expect(result.cart.pinch?.x).toBeGreaterThan(115);
    expect(result.cart.pinch?.x).toBeLessThan(120);
    expect(roads.wideAcross(120, 0, 1, 0)).toBe(false);
    expect(roads.wideAcross(100, 0, 1, 0)).toBe(true);
  });

  it('does not mistake a single file road for a wide one', () => {
    // Three columns *are* in a line through every column of a single track road — its
    // own line. Measuring across the way the cart is going is what makes the rule mean
    // something rather than being satisfied by every road there is.
    expect(band(1).wideAcross(100, 0, 1, 0)).toBe(false);
  });

  it('stops at a single missing block', () => {
    // One column out of one side is a hole in the road, and a hole in the road is where
    // the cart stops. A road only joins up left, right, up and down, so there is no way
    // round it any more.
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 120 && z === 1) continue;
        world.lay(x, GROUND, z, Block.DIRT_PATH);
      }
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('a road with a dent still carries a porter');
    expect(result.cart.ok).toBe(false);
    if (result.cart.ok) return;
    expect(result.cart.pinch?.x).toBeGreaterThan(110);
    expect(result.cart.pinch?.x).toBeLessThan(121);
  });

  it('and fills the hole back in', () => {
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) {
      for (let z = -1; z <= 1; z++) world.lay(x, GROUND, z, Block.DIRT_PATH);
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(true);
  });

  it('counts a swept diagonal as wide', () => {
    // What the shovel's 3x3 sweep leaves behind when the player walks a diagonal: a solid
    // band, which is wide whichever of the four ways a cart is going through it.
    const world = new FakeWorld();
    for (let i = 0; i <= 40; i++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          world.lay(100 + i + dx, GROUND, i + dz, Block.DIRT_PATH);
        }
      }
    }
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.wideAcross(120, 20, 1, 0)).toBe(true);
    expect(roads.wideAcross(120, 20, 0, 1)).toBe(true);
  });
});

describe('walking from a doorway onto the road', () => {
  it('follows the index rather than cutting through the wall', () => {
    const world = new FakeWorld();
    // A spur out of a doorway, then the road proper.
    for (let z = 1; z <= 6; z++) world.lay(40, GROUND, z, Block.DIRT_PATH);
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    world.lay(40, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const path = roads.pathBetween({ x: 40, z: 7, y: GROUND }, { x: 40, z: 0, y: GROUND }, 32);
    expect(path).not.toBeNull();
    expect(path?.[0]).toMatchObject({ x: 40, z: 6 });
    expect(path?.[path.length - 1]).toMatchObject({ x: 40, z: 0 });
  });

  it('says so when there is no way at all', () => {
    const world = new FakeWorld();
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    expect(roads.pathBetween({ x: 40, z: 20, y: GROUND }, { x: 40, z: 0, y: GROUND }, 32)).toBeNull();
  });
});


describe('the road builder and the width rule agree', () => {
  /** Two villages on an angle, joined by `runRoad` at the given width. The angle is the
   *  case that matters: an angled road comes out as a staircase, and the builder and the
   *  rule have to mean the same thing at every step and every corner of it. */
  function built(width: number): { roads: RoadNetwork; a: VillageRecord; b: VillageRecord } {
    const world = new FakeWorld();
    const a = village('a', 0, 0);
    const b = village('b', 200, 160);
    const roads = new RoadNetwork(world);
    const start = roads.streetPoint(a, b.x, b.z);
    const end = roads.streetPoint(b, a.x, a.z);
    runRoad(
      { ground: () => GROUND, lay: (x, y, z) => world.lay(x, y, z, Block.DIRT_PATH) },
      start, end, GROUND, MAX_STEP, 0, GROUND, width,
    );
    roads.seedFromEdits();
    return { roads, a, b };
  }

  it('runs a cart the whole length of a road it laid three wide', () => {
    const { roads, a, b } = built(3);
    const result = roads.survey(a, b);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(true);
  });

  it('runs a cart up an angled road that climbs, too', () => {
    // The case the sample world is: an angled road that also gains height. The staircase
    // doubles the number of columns, so a builder allowed to climb a block at every one of
    // them puts the band cells either side of a column at heights that cannot both flank
    // it — and the road is three wide everywhere and passes nowhere.
    const world = new FakeWorld();
    const a = village('a', 0, 0);
    const b = village('b', 200, 160);
    const roads = new RoadNetwork(world);
    const start = roads.streetPoint(a, b.x, b.z);
    const end = roads.streetPoint(b, a.x, a.z);
    runRoad(
      {
        ground: (x) => GROUND + Math.floor((x - start.x) / 2),
        lay: (x, y, z) => world.lay(x, y, z, Block.DIRT_PATH),
      },
      start, end, GROUND, MAX_STEP / 2, 0, GROUND, 3,
    );
    roads.seedFromEdits();
    const result = roads.survey(a, b);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(true);
  });

  it('and none down the same road laid single track', () => {
    const { roads, a, b } = built(1);
    const result = roads.survey(a, b);
    if (!result.connected) throw new Error('fixture is not connected');
    expect(result.cart.ok).toBe(false);
  });
});
