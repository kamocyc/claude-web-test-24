import { describe, expect, it } from 'vitest';
import { CLEARABLE, PAVABLE, runRoad, treadBrush, treadColumn, treadLine, type PaveTarget } from '../game/paving';
import { HEADROOM } from '../game/roads';
import { Block, type BlockId } from '../world/blocks';

const GROUND = 60;

/** A world built out of a heightmap: everything at or below the surface is grass, and
 *  everything above it is air, until a test says otherwise. */
class FakeWorld implements PaveTarget {
  readonly blocks = new Map<string, BlockId>();
  readonly heights = new Map<string, number>();
  readonly roads = new Map<string, number>();

  surface(x: number, z: number): number {
    return this.heights.get(`${x},${z}`) ?? GROUND;
  }

  setHeight(x: number, z: number, y: number): void {
    this.heights.set(`${x},${z}`, y);
  }

  put(x: number, y: number, z: number, id: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, id);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const set = this.blocks.get(`${x},${y},${z}`);
    if (set !== undefined) return set;
    return y <= this.surface(x, z) ? Block.GRASS : Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: BlockId): void {
    this.put(x, y, z, id);
    if (id === Block.DIRT_PATH) this.roads.set(`${x},${z}`, y);
  }

  roadLevel(x: number, z: number): number | undefined {
    return this.roads.get(`${x},${z}`);
  }

  paths(): { x: number; z: number; y: number }[] {
    const out: { x: number; z: number; y: number }[] = [];
    for (const [key, y] of this.roads) {
      const comma = key.indexOf(',');
      out.push({ x: Number(key.slice(0, comma)), z: Number(key.slice(comma + 1)), y });
    }
    return out;
  }
}

/** The property the whole design now rests on: every column of a road touches the next. */
function unbroken(path: readonly { x: number; z: number; y: number }[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.z - b.z) > 1) return false;
    if (Math.abs(a.y - b.y) > 2) return false;
  }
  return true;
}

/** The world as `runRoad` sees it: a heightmap to follow and somewhere to write. */
function runner(world: FakeWorld) {
  return {
    ground: (x: number, z: number): number => world.surface(x, z),
    lay: (x: number, y: number, z: number): void => world.setBlock(x, y, z, Block.DIRT_PATH),
  };
}

describe('treading a path', () => {
  it('treads the ground the shovel is pointed at', () => {
    const world = new FakeWorld();
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND);
    expect(world.getBlock(0, GROUND, 0)).toBe(Block.DIRT_PATH);
  });

  it('brushes a flower aside rather than giving up on the column', () => {
    const world = new FakeWorld();
    world.put(0, GROUND + 1, 0, Block.FLOWER_RED);
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND);
    expect(world.getBlock(0, GROUND + 1, 0)).toBe(Block.AIR);
  });

  it('refuses a column with something standing on it', () => {
    const world = new FakeWorld();
    world.put(0, GROUND + 1, 0, Block.OAK_LOG);
    expect(treadColumn(world, 0, 0, GROUND)).toBeNull();
    expect(world.getBlock(0, GROUND, 0)).toBe(Block.GRASS);
  });

  it('refuses to tread under water', () => {
    const world = new FakeWorld();
    world.put(0, GROUND + 1, 0, Block.WATER);
    expect(treadColumn(world, 0, 0, GROUND)).toBeNull();
  });

  it('leaves a road somebody already paved exactly as it was', () => {
    const world = new FakeWorld();
    world.put(0, GROUND, 0, Block.STONE_BRICKS);
    world.roads.set('0,0', GROUND);
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND);
    expect(world.getBlock(0, GROUND, 0)).toBe(Block.STONE_BRICKS);
  });

  it('treads a natural gravel bank, because a bank is not a road until it is recorded', () => {
    const world = new FakeWorld();
    world.put(0, GROUND, 0, Block.GRAVEL);
    expect(PAVABLE.has(Block.GRAVEL)).toBe(true);
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND);
    expect(world.getBlock(0, GROUND, 0)).toBe(Block.DIRT_PATH);
  });

  it('will not tread bare stone into a road', () => {
    const world = new FakeWorld();
    world.put(0, GROUND, 0, Block.STONE);
    expect(treadColumn(world, 0, 0, GROUND)).toBeNull();
  });

  it('finds the surface one block off from where it was told to look', () => {
    const world = new FakeWorld();
    world.setHeight(0, 0, GROUND - 1);
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND - 1);
  });

  it('will not reach across a step the road index would refuse', () => {
    // Two blocks down is a drop a porter cannot climb back up, so laying a column there
    // would make a road that reads as continuous and walks as a dead end. Better to lay
    // nothing and let the player see the fault.
    const world = new FakeWorld();
    world.setHeight(0, 0, GROUND - 2);
    expect(treadColumn(world, 0, 0, GROUND)).toBeNull();
  });
});

describe('the shovel sweep', () => {
  it('treads the cell and the eight around it', () => {
    const world = new FakeWorld();
    expect(treadBrush(world, 0, 0, GROUND).laid).toBe(9);
    expect(world.paths()).toHaveLength(9);
  });

  it('reports the level it settled on, so the next cell knows where to look', () => {
    const world = new FakeWorld();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      world.setHeight(dx, dz, GROUND + 1);
    }
    expect(treadBrush(world, 0, 0, GROUND).level).toBe(GROUND + 1);
  });

  it('fills in behind a crosshair that jumped', () => {
    // A player turning their head moves the crosshair several blocks between frames.
    // Treading only where it landed would leave a dotted line, and a dotted line is no
    // longer a road.
    const world = new FakeWorld();
    treadLine(world, { x: 0, z: 0 }, { x: 9, z: 3 }, GROUND);
    for (let x = 0; x <= 9; x++) {
      expect(world.roadLevel(x, Math.round((x * 3) / 9)), `nothing at x=${x}`).toBe(GROUND);
    }
  });

  it('carries the level along a slope instead of hunting for it again', () => {
    const world = new FakeWorld();
    for (let x = 0; x <= 20; x++) for (let z = -2; z <= 2; z++) world.setHeight(x, z, GROUND + x);
    treadLine(world, { x: 0, z: 0 }, { x: 20, z: 0 }, GROUND);
    const along = Array.from({ length: 21 }, (_, x) => ({ x, z: 0, y: world.roadLevel(x, 0) ?? -1 }));
    expect(along.every((c) => c.y >= 0)).toBe(true);
    expect(unbroken(along)).toBe(true);
    expect(along[20].y).toBe(GROUND + 20);
  });
});

describe('running a road', () => {
  it('lays a column at every step, and every column touches the next', () => {
    const world = new FakeWorld();
    const laid = runRoad(runner(world), { x: 0, z: 0 }, { x: 40, z: 17 }, GROUND, 2, 47);
    expect(laid).toBe(41);
    const path = Array.from({ length: 41 }, (_, i) => {
      const x = Math.round((40 * i) / 40);
      const z = Math.round((17 * i) / 40);
      return { x, z, y: world.roadLevel(x, z) ?? -1 };
    });
    expect(unbroken(path)).toBe(true);
  });

  it('cuts into a rise rather than climbing it in one step', () => {
    const world = new FakeWorld();
    // A wall halfway along: twenty blocks of it, straight up.
    for (let x = 20; x <= 40; x++) world.setHeight(x, 0, GROUND + 20);
    runRoad(runner(world), { x: 0, z: 0 }, { x: 40, z: 0 }, GROUND, 2, 47);
    const path = Array.from({ length: 41 }, (_, x) => ({ x, z: 0, y: world.roadLevel(x, 0) ?? -1 }));
    expect(unbroken(path)).toBe(true);
  });

  it('carries a road over the water instead of dropping it in', () => {
    const world = new FakeWorld();
    for (let x = 10; x <= 30; x++) world.setHeight(x, 0, 30);
    runRoad(runner(world), { x: 0, z: 0 }, { x: 40, z: 0 }, GROUND, 2, 47);
    for (let x = 10; x <= 30; x++) expect(world.roadLevel(x, 0)).toBeGreaterThan(46);
  });

  it('starts and lands on the levels it was given, however high the ground was', () => {
    const world = new FakeWorld();
    // A village street cut two blocks into the hillside at each end, with high ground in
    // between. Both ends have to be the street, or the road connects to nothing.
    for (let x = 0; x <= 40; x++) world.setHeight(x, 0, GROUND + 20);
    runRoad(runner(world), { x: 0, z: 0 }, { x: 40, z: 0 }, GROUND, 2, 47, GROUND);
    expect(world.roadLevel(0, 0)).toBe(GROUND);
    expect(world.roadLevel(40, 0)).toBe(GROUND);
    const path = Array.from({ length: 41 }, (_, x) => ({ x, z: 0, y: world.roadLevel(x, 0) ?? -1 }));
    expect(unbroken(path)).toBe(true);
  });

  it('lays a single column when both ends are the same place', () => {
    const world = new FakeWorld();
    expect(runRoad(runner(world), { x: 3, z: 3 }, { x: 3, z: 3 }, GROUND, 2, 47)).toBe(1);
  });
});


describe('making room overhead', () => {
  it('cuts a branch back rather than laying road nobody fits under', () => {
    const world = new FakeWorld();
    world.put(0, GROUND + 2, 0, Block.OAK_LEAVES);
    expect(CLEARABLE.has(Block.OAK_LEAVES)).toBe(true);
    expect(treadColumn(world, 0, 0, GROUND)).toBe(GROUND);
    for (let h = 1; h <= HEADROOM; h++) {
      expect(world.getBlock(0, GROUND + h, 0), `headroom at +${h}`).toBe(Block.AIR);
    }
  });

  it('leaves a stone awning alone, and the road under it unlaid', () => {
    // Somebody built that. Treading under it would leave a line of path blocks the index
    // throws away, which is the fault the player is meant to be shown rather than given.
    const world = new FakeWorld();
    world.put(0, GROUND + 2, 0, Block.STONE_BRICKS);
    expect(treadColumn(world, 0, 0, GROUND)).toBeNull();
    expect(world.getBlock(0, GROUND + 2, 0)).toBe(Block.STONE_BRICKS);
    expect(world.getBlock(0, GROUND, 0)).toBe(Block.GRASS);
  });
});

describe('running a road wide enough for a cart', () => {
  it('lays the same level either side of the line', () => {
    const world = new FakeWorld();
    const laid = runRoad(runner(world), { x: 0, z: 0 }, { x: 20, z: 0 }, GROUND, 1, 0, undefined, 3);
    expect(laid).toBe(21 * 3);
    for (let x = 0; x <= 20; x++) {
      for (let z = -1; z <= 1; z++) {
        expect(world.roadLevel(x, z), `nothing at ${x},${z}`).toBe(GROUND);
      }
    }
  });

  it('widens the corner where the road turns', () => {
    // A corner has a way in and a way out, and the rule asks for room in both, so both
    // bands go down. A road that never turns is exactly three columns per step; one that
    // does is wider than that, and only at the corners.
    const world = new FakeWorld();
    const straight = runRoad(runner(world), { x: 0, z: 0 }, { x: 20, z: 0 }, GROUND, 1, 0, undefined, 3);
    expect(straight).toBe(21 * 3);

    const turning = new FakeWorld();
    const laid = runRoad(runner(turning), { x: 0, z: 0 }, { x: 20, z: 6 }, GROUND, 1, 0, undefined, 3);
    expect(laid).toBeGreaterThan(21 * 3);
  });

  it('carries the width round a diagonal', () => {
    const world = new FakeWorld();
    runRoad(runner(world), { x: 0, z: 0 }, { x: 20, z: 20 }, GROUND, 1, 0, undefined, 3);
    // Across a north-east line, the two sides are north-west and south-east of it.
    for (let i = 1; i < 20; i++) {
      expect(world.roadLevel(i, i), `middle at ${i}`).toBe(GROUND);
      expect(world.roadLevel(i - 1, i + 1), `left at ${i}`).toBe(GROUND);
      expect(world.roadLevel(i + 1, i - 1), `right at ${i}`).toBe(GROUND);
    }
  });
});
