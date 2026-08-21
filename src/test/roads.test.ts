import { describe, expect, it } from 'vitest';
import {
  MAX_LINK,
  MAX_STEP,
  RoadNetwork,
  ROAD_BLOCKS,
  ROAD_SPEED,
  roadGrade,
  toWaypoints,
  type RoadTerrain,
  type RoadWorld,
} from '../game/roads';
import { Block, type BlockId } from '../world/blocks';
import { blockIndex, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';
import type { VillageRecord } from '../game/villages';

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

  terrain(): RoadTerrain {
    return { height: (x, z) => this.ground.get(`${x},${z}`) ?? GROUND };
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

/** Stepping stones every `step` blocks between the two villages' street ends. */
function pave(world: FakeWorld, step: number, from = 50, to = 190): void {
  for (let x = from; x <= to; x += step) world.lay(x, GROUND, 0, Block.DIRT_PATH);
}

describe('road index', () => {
  it('indexes only blocks the player recorded', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    // Natural gravel exists in the world but was never placed, so it is not a road.
    world.load(30, 0);
    world.blocks.set(`30,${GROUND},0`, Block.GRAVEL);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.columns.has('10,0')).toBe(true);
    expect(roads.columns.has('30,0')).toBe(false);
  });

  it('refuses a road with something standing on it', () => {
    const world = new FakeWorld();
    world.lay(10, GROUND, 0, Block.DIRT_PATH);
    world.lay(10, GROUND + 1, 0, Block.OAK_LOG);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.columns.has('10,0')).toBe(false);
  });

  it('rebuilds the same index from the same edits', () => {
    const world = new FakeWorld();
    pave(world, 10);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    const first = [...roads.columns.entries()].sort();
    roads.seedFromEdits();
    expect([...roads.columns.entries()].sort()).toEqual(first);
  });

  it('bumps the revision when a road block appears', () => {
    const world = new FakeWorld();
    const roads = new RoadNetwork(world, world.terrain());
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
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    world.lay(10, GROUND, 0, Block.AIR);
    roads.onBlockChanged(10, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    expect(roads.columns.has('10,0')).toBe(false);
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
    const roads = new RoadNetwork(world, world.terrain());
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
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.columnsIn(0, -5, 20, 5)).toEqual([{ x: 10, z: 0, y: GROUND, b: Block.GRAVEL }]);
  });
});

describe('road quality', () => {
  function qualityOf(surface: BlockId, step = 1): number {
    const world = new FakeWorld();
    for (let x = 50; x <= 190; x += step) world.lay(x, GROUND, 0, surface);
    const roads = new RoadNetwork(world, world.terrain());
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

  it('rates a dashed road below the surface it is dashed with', () => {
    // A road may skip, and one that does still works. It is simply slower than one
    // somebody finished, which is what makes filling it in worth doing.
    expect(qualityOf(Block.STONE_BRICKS, MAX_LINK)).toBeLessThan(qualityOf(Block.DIRT_PATH));
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
    for (let x = 50; x <= 190; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    if (!result.connected) throw new Error('fixture is not connected');
    // Two village stubs plus one straight run, once the straight parts are folded away.
    expect(toWaypoints(result.waypoints).length).toBeLessThanOrEqual(4);
    expect(result.length).toBeGreaterThan(150);
  });
});

describe('road survey', () => {
  it('connects two villages across a paved route', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    expect(result.connected).toBe(true);
    if (!result.connected) return;
    // Street end to street end: 30 -> 210.
    expect(result.length).toBeCloseTo(180);
    expect(result.waypoints[0].x).toBeLessThanOrEqual(A.x + 30);
    expect(result.waypoints[result.waypoints.length - 1].x).toBeGreaterThanOrEqual(B.x - 30);
  });

  it('allows a road to be dashed up to the link distance', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(true);
  });

  it('refuses a gap wider than the link distance', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK + 1);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(false);
  });

  it('refuses to cross a cliff even when the gap is short', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK);
    // A wall of ground halfway along: within the link distance, but not walkable.
    for (let x = 118; x <= 122; x++) world.setGround(x, 0, GROUND + MAX_STEP + 4);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(false);
  });

  it('refuses to cross open water', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK);
    for (let x = 118; x <= 122; x++) world.setGround(x, 0, 40);
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    expect(roads.survey(A, B).connected).toBe(false);
  });

  it('reports where each side runs out when the road is unfinished', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK, 50, 110);
    pave(world, MAX_LINK, 170, 190);
    const roads = new RoadNetwork(world, world.terrain());
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
    const roads = new RoadNetwork(world, world.terrain());
    roads.seedFromEdits();
    const result = roads.survey(A, B);
    expect(result.connected).toBe(false);
    if (result.connected) return;
    expect(result.frontierFrom.x).toBe(30);
    expect(result.frontierTo.x).toBe(210);
  });

  it('gives the same answer whether or not the chunks are loaded', () => {
    const world = new FakeWorld();
    pave(world, MAX_LINK);
    const roads = new RoadNetwork(world, world.terrain());
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
