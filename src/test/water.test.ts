import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { WATER_FULL, WATER_MAX } from '../world/water';
import { WaterSimulator } from '../world/waterSim';
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
