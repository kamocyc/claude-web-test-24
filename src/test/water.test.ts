import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk, SEA_LEVEL } from '../world/chunk';
import { WATER_FULL, WATER_MAX } from '../world/water';
import { MAX_CELLS_PER_TICK, WaterSimulator } from '../world/waterSim';
import { World } from '../world/world';

interface Rig {
  world: World;
  sim: WaterSimulator;
  total(): number;
  run(steps: number): void;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void;
  /** Hollows out a room with stone walls around it. */
  basin(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
  /** Pours whole blocks of water into a column, one cell at a time. */
  pour(x: number, y: number, z: number, blocks: number): void;
}

function rig(radius = 1): Rig {
  const world = new World(1);
  const sim = new WaterSimulator(world);
  world.onBlockChange((x, y, z, previous, next) => sim.onBlockChanged(x, y, z, previous, next));
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) world.addChunk(new Chunk(cx, cz));
  }
  const box: Rig['box'] = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) world.setBlock(x, y, z, id, { record: false });
      }
    }
  };
  return {
    world,
    sim,
    box,
    pour: (x, y, z, blocks) => {
      for (let i = 0; i < blocks; i++) sim.pour(x, y + i, z, WATER_FULL);
    },
    basin: (x0, y0, z0, x1, y1, z1) => {
      box(x0 - 1, y0 - 1, z0 - 1, x1 + 1, y1 + 1, z1 + 1, Block.STONE);
      box(x0, y0, z0, x1, y1, z1, Block.AIR);
    },
    total: () => {
      let sum = 0;
      for (const chunk of world.chunks.values()) {
        for (const level of chunk.water) sum += level;
      }
      return sum;
    },
    run: (steps: number) => {
      for (let i = 0; i < steps; i++) sim.step();
    },
  };
}

describe('water flow', () => {
  it('falls to the floor of a shaft', () => {
    const r = rig();
    r.basin(0, 10, 0, 0, 30, 0);
    r.pour(0, 30, 0, 1);
    r.run(60);
    expect(r.world.getWater(0, 10, 0)).toBeGreaterThan(WATER_FULL * 0.9);
    expect(r.world.getWater(0, 30, 0)).toBe(0);
  });

  it('conserves water in a closed basin', () => {
    const r = rig();
    r.basin(0, 10, 0, 4, 20, 4);
    r.pour(2, 11, 2, 9);
    const poured = WATER_FULL * 9;
    expect(r.total()).toBe(poured);
    r.run(400);
    // Nothing leaks: a closed basin keeps every drop.
    expect(r.total()).toBe(poured);
    expect(r.sim.drained).toBe(0);
  });

  it('levels out across a basin instead of piling up in one corner', () => {
    const r = rig();
    r.basin(0, 10, 0, 4, 20, 4);
    r.pour(0, 11, 0, 9);
    r.run(600);
    const levels: number[] = [];
    for (let z = 0; z <= 4; z++) {
      for (let x = 0; x <= 4; x++) levels.push(r.world.getWater(x, 10, z));
    }
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    expect(min).toBeGreaterThan(0);
    // A settled surface is flat to within the dead band of the spreading rule.
    expect(max - min).toBeLessThan(WATER_FULL * 0.1);
  });

  it('goes to sleep once it has settled', () => {
    const r = rig();
    r.basin(0, 10, 0, 4, 20, 4);
    r.pour(2, 11, 2, 6);
    r.run(600);
    expect(r.sim.activeCount).toBe(0);
    // And stays asleep: another step changes nothing.
    const before = r.total();
    r.run(10);
    expect(r.total()).toBe(before);
  });

  it('is held back by a wall and only spills once it is deeper than the wall', () => {
    const r = rig();
    r.basin(0, 10, 0, 8, 20, 0);
    // A two block wall across the middle of the channel.
    r.box(4, 10, 0, 4, 11, 0, Block.STONE);
    r.pour(0, 12, 0, 2);
    r.run(200);
    expect(r.world.getWater(6, 10, 0)).toBe(0);
    expect(r.world.getWater(0, 10, 0)).toBeGreaterThan(0);

    // Keep pouring until it tops the wall.
    for (let i = 0; i < 30; i++) {
      r.pour(0, 14, 0, 1);
      r.run(20);
    }
    r.run(300);
    expect(r.world.getWater(6, 10, 0)).toBeGreaterThan(0);
  });

  it('climbs the far side of a dip, so an inverted siphon works', () => {
    const r = rig();
    // Two shafts joined by a channel at the bottom.
    r.basin(0, 10, 0, 6, 24, 0);
    r.box(1, 11, 0, 5, 24, 0, Block.STONE);
    for (let i = 0; i < 40; i++) {
      r.pour(0, 23, 0, 1);
      r.run(15);
    }
    r.run(600);
    // Water pushed by the column on the left climbed well above the connecting
    // channel on the right, which is what an aqueduct crossing a dip relies on.
    expect(columnHeight(r, 6)).toBeGreaterThan(5);
    expect(columnHeight(r, 0)).toBeGreaterThan(columnHeight(r, 6));
  });

  it('never exceeds the storage cap', () => {
    const r = rig();
    r.basin(0, 10, 0, 0, 12, 0);
    for (let i = 0; i < 50; i++) {
      r.pour(0, 12, 0, 1);
      r.run(5);
    }
    for (let y = 10; y <= 12; y++) expect(r.world.getWater(0, y, 0)).toBeLessThanOrEqual(WATER_MAX);
  });
});

describe('water works', () => {
  it('a spring keeps producing water', () => {
    const r = rig();
    r.basin(0, 10, 0, 4, 20, 4);
    r.world.setBlock(2, 10, 2, Block.SPRING, { record: false });
    r.run(100);
    expect(r.total()).toBeGreaterThan(WATER_FULL * 4);
  });

  it('a drain removes the water that reaches it', () => {
    const r = rig();
    r.basin(0, 10, 0, 4, 20, 4);
    r.world.setBlock(4, 10, 4, Block.DRAIN, { record: false });
    r.pour(0, 11, 0, 8);
    r.run(600);
    // A drain empties the basin; what is left is a damp film, not a pool.
    expect(r.total()).toBeLessThan(WATER_FULL);
  });

  it('a floodgate holds water while closed and lets it through when opened', () => {
    const r = rig();
    r.basin(0, 10, 0, 8, 20, 0);
    r.box(4, 10, 0, 4, 13, 0, Block.FLOODGATE_CLOSED);
    r.pour(0, 12, 0, 3);
    r.run(200);
    const heldBack = r.world.getWater(0, 10, 0);
    expect(heldBack).toBeGreaterThan(0);
    expect(r.world.getWater(6, 10, 0)).toBe(0);

    r.world.setBlock(4, 10, 0, Block.FLOODGATE_OPEN, { record: false });
    r.run(400);
    expect(r.world.getWater(6, 10, 0)).toBeGreaterThan(0);
    expect(r.world.getWater(0, 10, 0)).toBeLessThan(heldBack);
  });

  it('a stack of pumps lifts water upwards', () => {
    const r = rig();
    // A one block wide shaft: water at the bottom, two pumps stacked above it.
    r.basin(0, 10, 0, 0, 24, 0);
    r.pour(0, 10, 0, 1);
    r.world.setBlock(0, 11, 0, Block.PUMP, { record: false });
    r.world.setBlock(0, 13, 0, Block.PUMP, { record: false });
    r.run(60);
    expect(r.world.getWater(0, 14, 0)).toBeGreaterThan(0);
    expect(r.world.getWater(0, 10, 0)).toBe(0);
  });

  it('evaporates an exposed still pool during a drought', () => {
    const r = rig();
    r.basin(0, 10, 0, 2, 20, 2);
    // basin() builds a roof for flow tests; remove it to make this an outdoor pool.
    r.box(-1, 21, -1, 3, 21, 3, Block.AIR);
    r.pour(1, 10, 1, 3);
    r.run(80);
    const before = r.total();
    r.sim.evaporationFactor = () => 1;
    r.run(30);
    expect(r.total()).toBeLessThan(before);
    expect(r.sim.evaporated).toBeGreaterThan(0);
  });

  it('does not evaporate water protected by a solid roof', () => {
    const r = rig();
    r.basin(0, 10, 0, 0, 20, 0);
    r.box(-1, 21, -1, 1, 21, 1, Block.AIR);
    r.pour(0, 10, 0, 1);
    r.world.setBlock(0, 11, 0, Block.STONE, { record: false });
    const before = r.total();
    r.sim.evaporationFactor = () => 1;
    r.run(100);
    expect(r.total()).toBe(before);
    expect(r.sim.evaporated).toBe(0);

    r.world.setBlock(0, 11, 0, Block.AIR, { record: false });
    r.run(10);
    expect(r.total()).toBeLessThan(before);
    expect(r.sim.evaporated).toBeGreaterThan(0);
  });
});

describe('water at the edge of the loaded world', () => {
  it('treats unloaded chunks as a wall rather than a drain', () => {
    const r = rig(0);
    r.box(0, 10, 0, CHUNK_SIZE - 1, 10, CHUNK_SIZE - 1, Block.STONE);
    r.pour(8, 11, 8, 20);
    const poured = WATER_FULL * 20;
    r.run(400);
    // The loaded area moves with the player, so its edge must never empty the sea.
    expect(r.total()).toBe(poured);
    expect(r.sim.drained).toBe(0);
    expect(r.world.getWater(0, 11, 0)).toBeGreaterThan(0);
  });
});

/** Height in blocks of the water standing in one column. */
function columnHeight(r: Rig, x: number): number {
  let height = 0;
  for (let y = 10; y < 30; y++) height += Math.min(1, r.world.getWater(x, y, 0) / WATER_FULL);
  return height;
}

describe('loading a chunk', () => {
  /** A chunk holding a pool that stands above the open ground of its neighbour, the
   *  way a generated river sits above the land it steps down towards. */
  function pair(): { world: World; sim: WaterSimulator; loaded: Chunk } {
    const world = new World(1);
    const sim = new WaterSimulator(world);
    const left = new Chunk(-1, 0);
    const right = new Chunk(0, 0);
    world.addChunk(left);
    world.addChunk(right);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        left.set(x, 10, z, Block.STONE);
        right.set(x, 10, z, Block.STONE);
        left.setWater(x, 11, z, WATER_FULL);
      }
    }
    left.syncWaterMarkers();
    return { world, sim, loaded: right };
  }

  it('wakes the water along the seam so it can flow into the new ground', () => {
    const { world, sim, loaded } = pair();
    sim.registerChunk(loaded, []);
    expect(sim.activeCount).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) sim.step();
    // The pool has spread across the seam onto the ground next door.
    expect(world.getWater(2, 11, 3)).toBeGreaterThan(0);
  });

  it('hands the generated rivers to the simulation without waking the sea', () => {
    const world = new World(1);
    const sim = new WaterSimulator(world);
    const chunk = new Chunk(0, 0);
    world.addChunk(chunk);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        chunk.setWater(x, SEA_LEVEL, z, WATER_FULL);
        chunk.setWater(x, SEA_LEVEL + 4, z, WATER_FULL);
      }
    }
    chunk.syncWaterMarkers();
    sim.wakeRivers(chunk);
    // Only the river cells: the sea is flat, already at rest, and there are hundreds of
    // thousands of it.
    expect(sim.activeCount).toBe(CHUNK_SIZE * CHUNK_SIZE);
  });
});

/** Every drop in the world, wherever it is. */
function totalWater(world: World): number {
  let total = 0;
  for (const chunk of world.chunks.values()) {
    for (const level of chunk.water) total += level;
  }
  return total;
}

describe('the sea', () => {
  /** An ocean column with a river pouring onto it. */
  function ocean(): { world: World; sim: WaterSimulator } {
    const world = new World(1);
    const sim = new WaterSimulator(world);
    const chunk = new Chunk(0, 0);
    world.addChunk(chunk);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        chunk.set(x, 4, z, Block.STONE);
        chunk.seaColumn[z * CHUNK_SIZE + x] = 1;
        for (let y = 5; y <= SEA_LEVEL; y++) chunk.setWater(x, y, z, WATER_FULL);
      }
    }
    chunk.syncWaterMarkers();
    sim.registerChunk(chunk, []);
    return { world, sim };
  }

  it('swallows whatever a river delivers instead of rising', () => {
    const { world, sim } = ocean();
    const before = totalWater(world);
    for (let i = 0; i < 60; i++) {
      sim.pour(3, SEA_LEVEL + 1, 3, WATER_FULL * 4);
      sim.step();
    }
    for (let i = 0; i < 200; i++) sim.step();
    // Nothing stands above the surface, and the surface itself has not moved.
    expect(world.getWater(3, SEA_LEVEL + 1, 3)).toBe(0);
    expect(world.getWater(3, SEA_LEVEL, 3)).toBe(WATER_FULL);
    expect(totalWater(world)).toBe(before);
    expect(sim.drained).toBeGreaterThan(0);
  });

  it('does not drain itself', () => {
    const { world, sim } = ocean();
    const before = totalWater(world);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) sim.activate(x, SEA_LEVEL, z);
    }
    for (let i = 0; i < 200; i++) sim.step();
    expect(totalWater(world)).toBe(before);
  });

  it('does not evaporate the ocean during a drought', () => {
    const { world, sim } = ocean();
    const before = totalWater(world);
    sim.evaporationFactor = () => 1;
    for (let i = 0; i < 200; i++) sim.step();
    expect(totalWater(world)).toBe(before);
    expect(sim.evaporated).toBe(0);
  });
});

describe('the step budget', () => {
  const LOW = -45;
  const HIGH = 45;
  /** Lowest point of the sloping bed. Solid rock below it, so a column dug out of it
   *  holds the water that falls in. */
  const FLOOR = 5;
  /** How far along the bed drops a block. */
  const RUN = 12;

  const bedAt = (x: number) => FLOOR + Math.floor((HIGH - x) / RUN);

  /** Far more moving water than one step can afford: a wide sheet running down a slope,
   *  fed by springs at the head and drained at the foot, so nothing in it ever settles
   *  and drops out of the queue. This is the shape a live island of rivers has, and the
   *  shape that used to leave two thirds of the water unsimulated for ever. */
  function crowded(): Rig {
    const r = rig(3);
    r.box(LOW - 1, 0, LOW - 1, HIGH + 1, FLOOR + 9, HIGH + 1, Block.STONE);
    for (let z = LOW; z <= HIGH; z++) {
      for (let x = LOW; x <= HIGH; x++) {
        const bed = bedAt(x);
        r.box(x, bed + 1, z, x, FLOOR + 9, z, Block.AIR);
        r.pour(x, bed + 1, z, 2);
      }
    }
    for (let z = LOW; z <= HIGH; z++) {
      r.world.setBlock(LOW, bedAt(LOW), z, Block.SPRING, { record: false });
      r.world.setBlock(HIGH, bedAt(HIGH), z, Block.DRAIN, { record: false });
    }
    r.run(40);
    return r;
  }

  /** Knocks the bed out from under a column, the way a player mining does. The water
   *  above it should fall in and stand on the rock two blocks down. */
  function digOut(r: Rig, x: number, z: number): void {
    r.world.setBlock(x, bedAt(x), z, Block.AIR, { record: false });
    r.world.setBlock(x, bedAt(x) - 1, z, Block.AIR, { record: false });
  }

  const fellIn = (r: Rig, x: number, z: number) => r.world.getWater(x, bedAt(x) - 1, z);

  it('comes round to every cell however many are awake', () => {
    // The budget used to put the cells it had just run back at the front of the queue,
    // ahead of the ones it had run out of budget for. The tail was then never reached
    // again: on a full island two thirds of the water stopped being simulated at all,
    // rivers ran short of the sea, and water stood in mid air over a hole dug under it.
    const r = crowded();
    expect(r.sim.activeCount).toBeGreaterThan(MAX_CELLS_PER_TICK * 2);

    // A hole in each corner and one in the middle. Wherever they land in the queue,
    // every one of them has to have water fall into it.
    const holes = [
      [LOW + 2, LOW + 2], [HIGH - 2, LOW + 2], [LOW + 2, HIGH - 2], [HIGH - 2, HIGH - 2], [0, 0],
    ] as const;
    for (const [x, z] of holes) digOut(r, x, z);
    r.run(30);
    for (const [x, z] of holes) expect(fellIn(r, x, z)).toBeGreaterThan(0);
  });

  it('answers at once around the player', () => {
    const r = crowded();
    r.sim.focus = { x: LOW + 2, z: LOW + 2 };
    r.run(4);
    digOut(r, LOW + 2, LOW + 2);
    // Two blocks to fall through, and the water round the player comes round every step
    // or two however busy the rest of the world is.
    r.run(4);
    expect(fellIn(r, LOW + 2, LOW + 2)).toBeGreaterThan(0);
  });

  it('never lets the water round the player starve the rest of the world', () => {
    const r = crowded();
    // Standing in the middle of all of it, so the near square alone is big enough to
    // eat the whole budget if it were allowed to.
    r.sim.focus = { x: 0, z: 0 };
    digOut(r, HIGH - 2, HIGH - 2);
    r.run(30);
    expect(fellIn(r, HIGH - 2, HIGH - 2)).toBeGreaterThan(0);
  });
});
