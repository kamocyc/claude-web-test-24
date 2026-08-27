import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { WATER_FULL } from '../world/water';
import { Mob, type MobContext } from '../game/mobs/ai';
import type { StandingSurface } from '../core/aabb';
import { Player } from '../game/player';
import { DayCycle } from '../game/daycycle';

function stoneFloor(): World {
  const world = new World(1);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let y = 0; y <= 20; y++) chunk.set(x, y, z, Block.STONE);
        }
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Water three blocks deep from x >= bankX, with a bank one block clear of it to the
 *  west. Mobs in these tests always wander west, so the bank is what they walk into. */
function pool(bankX: number | null): World {
  const world = stoneFloor();
  for (let z = -20; z < 20; z++) {
    for (let x = -30; x < 30; x++) {
      const solid = bankX !== null && x < bankX;
      for (let y = 21; y <= 23; y++) {
        if (solid) world.setBlock(x, y, z, Block.STONE);
        else world.setWater(x, y, z, WATER_FULL);
      }
    }
  }
  return world;
}

/** A steady random source makes the wander direction due west every time. */
function context(world: World): MobContext {
  const day = new DayCycle();
  day.time = 0.25;
  const player = new Player();
  // Far enough away that nothing chases or flees.
  player.x = 500;
  player.z = 500;
  return { world, player, day, rng: () => 0.5, shoot: () => {} };
}

describe('mobs in water', () => {
  it('climbs out onto the bank instead of bobbing against it', () => {
    const world = pool(-6);
    const ctx = context(world);
    const cow = new Mob('cow', 1.5, 23, 0.5);
    for (let i = 0; i < 600; i++) cow.update(1 / 60, ctx);
    expect(cow.x).toBeLessThan(-6.5);
    expect(cow.y).toBeGreaterThan(23.5);
    expect(cow.onGround).toBe(true);
  });

  it('floats at the surface rather than sinking to the bed', () => {
    const world = pool(null);
    const ctx = context(world);
    const cow = new Mob('cow', 1.5, 30, 0.5);
    for (let i = 0; i < 300; i++) cow.update(1 / 60, ctx);
    expect(cow.y).toBeGreaterThan(22.5);
  });
});


/** A stone floor with a single block step at x <= stepX, which is what a road is allowed
 *  to have and what a porter has to be able to walk up. */
function ledge(stepX: number, height: number): World {
  const world = stoneFloor();
  for (let z = -20; z < 20; z++) {
    for (let x = -30; x <= stepX; x++) {
      for (let y = 21; y <= 20 + height; y++) world.setBlock(x, y, z, Block.STONE);
    }
  }
  return world;
}

describe('a porter following its shipment', () => {
  it('walks up a single block step without having to jump for it', () => {
    // The road index allows exactly one block between two columns, so this is the step a
    // porter meets constantly. It used to have no way over it but a ballistic hop that
    // clears 1.11 blocks on a 0.4s cooldown, and every corner it failed on became the
    // shipment running away from it.
    const world = ledge(-6, 1);
    const ctx = context(world);
    const porter = new Mob('porter', -2.5, 21, 0.5);
    porter.follow = { x: -12.5, z: 0.5 };
    let airborne = 0;
    for (let i = 0; i < 400; i++) {
      porter.update(1 / 60, ctx);
      if (porter.y > 22.4) airborne++;
    }
    expect(porter.x).toBeLessThan(-8);
    expect(porter.y).toBeGreaterThan(21.5);
    // It stepped up rather than launching itself over.
    expect(airborne).toBe(0);
  });

  it('keeps walking when it is hit', () => {
    // Fleeing is checked before `follow` is, so one punch used to send a porter running
    // for five seconds — long enough to lose its shipment and be dragged after it.
    const world = stoneFloor();
    const ctx = context(world);
    const porter = new Mob('porter', 0.5, 21, 0.5);
    porter.follow = { x: -10.5, z: 0.5 };
    porter.onHurt();
    expect(porter.state).not.toBe('flee');
    for (let i = 0; i < 600; i++) porter.update(1 / 60, ctx);
    expect(porter.x).toBeLessThan(-9);
  });

  it('still lets an animal run away', () => {
    const world = stoneFloor();
    const cow = new Mob('cow', 0.5, 21, 0.5);
    cow.onHurt();
    expect(cow.state).toBe('flee');
    expect(world.getBlock(0, 20, 0)).toBe(Block.STONE);
  });
});

describe('a train on a deck', () => {
  /** The deck of a railway, as the movement code sees one: a height over a strip of
   *  ground, and nothing in the block grid at all. */
  function deck(top: number, halfWidth = 1): StandingSurface {
    return {
      surfaceTopAt: (_x, z, low, high) =>
        Math.abs(z) <= halfWidth && top >= low && top <= high ? top : null,
    };
  }

  it('rides the deck rather than falling through it', () => {
    // The sweep cannot land anything on a railway: it resolves every contact onto the
    // nearest whole block, and a deck sits wherever the curve put it.
    const world = stoneFloor();
    const ctx = context(world);
    const train = new Mob('train', 0.5, 26, 0.5);
    train.surface = deck(24.4);
    for (let i = 0; i < 120; i++) train.update(1 / 60, ctx);
    expect(train.y).toBeCloseTo(24.4, 2);
    expect(train.onGround).toBe(true);
  });

  it('falls to the ground when it walks off the end of one', () => {
    const world = stoneFloor();
    const ctx = context(world);
    const train = new Mob('train', 0.5, 26, 0.5);
    train.surface = deck(24.4);
    for (let i = 0; i < 120; i++) train.update(1 / 60, ctx);
    // Off the side of the strip, where there is no deck to hold it up.
    train.z = 6;
    for (let i = 0; i < 240; i++) train.update(1 / 60, ctx);
    expect(train.y).toBeLessThan(22);
    expect(train.onGround).toBe(true);
  });

  it('leaves everything that was not given a deck on the ground', () => {
    // A porter has no reason to be up on a viaduct and no way down off one, so it is not
    // given the deck at all — and without the field nothing about it changes.
    const world = stoneFloor();
    const ctx = context(world);
    const porter = new Mob('porter', 0.5, 26, 0.5);
    for (let i = 0; i < 120; i++) porter.update(1 / 60, ctx);
    expect(porter.y).toBeCloseTo(21, 1);
  });
});
