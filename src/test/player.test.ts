import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { WATER_FULL } from '../world/water';
import { MAX_AIR, NO_INPUT, Player, movementDirection } from '../game/player';

function flatWorld(groundY = 20): World {
  const world = new World(1);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let y = 0; y <= groundY; y++) chunk.set(x, y, z, Block.STONE);
        }
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** A pool three blocks deep with a bank standing one block clear of the water, which
 *  is the shape the river generator now produces. */
function poolWithBank(): World {
  const world = flatWorld(20);
  for (let z = -12; z < 12; z++) {
    for (let x = 6; x < 40; x++) {
      for (let y = 21; y <= 23; y++) world.setBlock(x, y, z, Block.STONE);
    }
    for (let x = -12; x < 6; x++) {
      for (let y = 21; y <= 23; y++) world.setWater(x, y, z, WATER_FULL);
    }
  }
  return world;
}

/** Flat ground with a one block kerb running along x = 3. */
function worldWithStep(groundY = 20): World {
  const world = flatWorld(groundY);
  for (let z = -20; z < 20; z++) {
    for (let x = 3; x < 8; x++) world.setBlock(x, groundY + 1, z, Block.STONE);
  }
  return world;
}

/** Walks east for a second and reports where the player ended up. */
function walkEast(world: World, autoStep: boolean, groundY = 20): Player {
  const player = new Player();
  player.autoStep = autoStep;
  player.x = 0.5;
  player.y = groundY + 1;
  player.z = 0.5;
  // Yaw -PI/2 looks towards +X.
  player.yaw = -Math.PI / 2;
  for (let i = 0; i < 90; i++) player.update(1 / 60, world, { ...NO_INPUT, forward: true });
  return player;
}

/** Runs the player for a second and reports how far, and in which direction, it moved. */
function walk(yaw: number, keys: Partial<typeof NO_INPUT>): { x: number; z: number } {
  const world = flatWorld();
  const player = new Player();
  player.x = 0.5;
  player.y = 21;
  player.z = 0.5;
  player.yaw = yaw;
  const startX = player.x;
  const startZ = player.z;
  for (let i = 0; i < 60; i++) player.update(1 / 60, world, { ...NO_INPUT, ...keys });
  const dx = player.x - startX;
  const dz = player.z - startZ;
  const length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
}

const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.4];

describe('movement direction', () => {
  it('walks forward towards wherever the camera is pointing', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const moved = walk(yaw, { forward: true });
      // The direction walked must line up with the camera's horizontal facing.
      const dot = moved.x * (look.x / flatLength) + moved.z * (look.z / flatLength);
      expect(dot).toBeGreaterThan(0.999);
    }
  });

  it('walks backwards away from the camera direction', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const moved = walk(yaw, { back: true });
      const dot = moved.x * (look.x / flatLength) + moved.z * (look.z / flatLength);
      expect(dot).toBeLessThan(-0.999);
    }
  });

  it('strafes right to the right hand side of the camera', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const forwardX = look.x / flatLength;
      const forwardZ = look.z / flatLength;
      // Right of a heading (fx, fz) on the XZ plane is (-fz, fx).
      const rightX = -forwardZ;
      const rightZ = forwardX;
      const moved = walk(yaw, { right: true });
      expect(moved.x * rightX + moved.z * rightZ).toBeGreaterThan(0.999);
      const strafedLeft = walk(yaw, { left: true });
      expect(strafedLeft.x * rightX + strafedLeft.z * rightZ).toBeLessThan(-0.999);
    }
  });

  it('keeps diagonal input at the same speed as a straight line', () => {
    const straight = walk(0.4, { forward: true });
    const diagonal = walk(0.4, { forward: true, right: true });
    expect(Math.hypot(straight.x, straight.z)).toBeCloseTo(1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
  });

  it('is a pure rotation of the input vector', () => {
    expect(movementDirection(0, 0, -1)).toEqual({ x: 0, z: -1 });
    const turned = movementDirection(Math.PI / 2, 0, -1);
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);
  });
});

/** A flat world with a pool of water on top of the ground. */
function flooded(depth: number): { world: World; player: Player } {
  const world = flatWorld();
  for (let z = -8; z < 24; z++) {
    for (let x = -8; x < 24; x++) {
      for (let y = 21; y < 21 + depth; y++) world.setBlock(x, y, z, Block.WATER);
    }
  }
  const player = new Player();
  player.x = 0.5;
  player.y = 21;
  player.z = 0.5;
  return { world, player };
}

describe('water', () => {
  it('swims in deep water but only wades through a puddle', () => {
    const deep = flooded(3);
    deep.player.update(1 / 60, deep.world, NO_INPUT);
    expect(deep.player.inWater).toBe(true);

    const puddle = flooded(1);
    // A shallow film is not enough to swim in.
    for (let z = -8; z < 24; z++) {
      for (let x = -8; x < 24; x++) puddle.world.setWater(x, 21, z, WATER_FULL * 0.2);
    }
    puddle.player.update(1 / 60, puddle.world, NO_INPUT);
    expect(puddle.player.inWater).toBe(false);
    expect(puddle.player.waterLevel).toBeGreaterThan(0);
  });

  it('runs out of air under water and drowns, then recovers at the surface', () => {
    const { world, player } = flooded(5);
    for (let i = 0; i < 200; i++) player.update(0.1, world, NO_INPUT);
    expect(player.submerged).toBe(true);
    expect(player.air).toBe(0);
    expect(player.health).toBeLessThan(player.maxHealth);

    // Lift the player clear of the water and the breath comes back.
    const hurt = player.health;
    for (let y = 21; y < 26; y++) {
      for (let z = -8; z < 24; z++) for (let x = -8; x < 24; x++) world.setBlock(x, y, z, Block.AIR);
    }
    for (let i = 0; i < 60; i++) player.update(0.1, world, NO_INPUT);
    expect(player.air).toBe(MAX_AIR);
    expect(player.health).toBeGreaterThanOrEqual(hurt);
  });

  it('is swept along by a current', () => {
    const { world, player } = flooded(3);
    const startX = player.x;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT, { x: 0.5, z: 0 });
    expect(player.x).toBeGreaterThan(startX + 0.5);
  });

  it('is not pushed around on dry land', () => {
    const world = flatWorld();
    const player = new Player();
    player.x = 0.5;
    player.y = 21;
    player.z = 0.5;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT, { x: 0.5, z: 0 });
    expect(Math.abs(player.x - 0.5)).toBeLessThan(0.05);
  });

  it('walks up a single block step without jumping', () => {
    const climbed = walkEast(worldWithStep(), true);
    expect(climbed.x).toBeGreaterThan(4);
    expect(climbed.y).toBeCloseTo(22, 1);
    expect(climbed.onGround).toBe(true);
  });

  it('is stopped by the same step when auto stepping is off', () => {
    const blocked = walkEast(worldWithStep(), false);
    expect(blocked.x).toBeLessThan(3);
    expect(blocked.y).toBeCloseTo(21, 1);
  });

  it('does not climb a two block wall', () => {
    const world = worldWithStep();
    for (let z = -20; z < 20; z++) {
      for (let x = 3; x < 8; x++) world.setBlock(x, 22, z, Block.STONE);
    }
    const player = walkEast(world, true);
    expect(player.x).toBeLessThan(3);
    expect(player.y).toBeCloseTo(21, 1);
  });

  it('hauls itself onto a bank that stands a block above the water', () => {
    // The commonest shape of coast there is: the water ends at a ledge one block clear
    // of the surface. A floating body sits a third of a block low, so a walker's step
    // is not enough to get over it and the player used to bump against every beach.
    const world = flatWorld(20);
    for (let z = -12; z < 12; z++) {
      for (let x = 6; x < 40; x++) {
        for (let y = 21; y <= 24; y++) world.setBlock(x, y, z, Block.STONE);
      }
      for (let x = -12; x < 6; x++) {
        for (let y = 21; y <= 23; y++) world.setWater(x, y, z, WATER_FULL);
      }
    }
    const player = new Player();
    player.x = 1.5;
    player.y = 24;
    player.z = 0.5;
    player.yaw = -Math.PI / 2;
    for (let i = 0; i < 240; i++) {
      const ashore = !player.inWater && player.y > 24.5;
      player.update(1 / 60, world, { ...NO_INPUT, forward: !ashore, jump: !ashore });
    }
    expect(player.inWater).toBe(false);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(25, 1);
  });

  it('is still stopped by a wall two blocks above the water', () => {
    const world = flatWorld(20);
    for (let z = -12; z < 12; z++) {
      for (let x = 6; x < 40; x++) {
        for (let y = 21; y <= 25; y++) world.setBlock(x, y, z, Block.STONE);
      }
      for (let x = -12; x < 6; x++) {
        for (let y = 21; y <= 23; y++) world.setWater(x, y, z, WATER_FULL);
      }
    }
    const player = new Player();
    player.x = 1.5;
    player.y = 24;
    player.z = 0.5;
    player.yaw = -Math.PI / 2;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, world, { ...NO_INPUT, forward: true, jump: true });
    }
    expect(player.inWater).toBe(true);
    expect(player.x).toBeLessThan(6);
  });

  it('climbs out of the water onto the bank', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 24;
    player.z = 0.5;
    // Yaw -PI/2 looks towards +X, which is where the bank is.
    player.yaw = -Math.PI / 2;
    for (let i = 0; i < 180; i++) {
      // Swim forwards while holding jump, then stand still once out on the bank.
      const ashore = !player.inWater && player.y > 23.5;
      player.update(1 / 60, world, { ...NO_INPUT, forward: !ashore, jump: !ashore });
    }
    // Out of the water, standing on top of the bank rather than bobbing against it.
    expect(player.x).toBeGreaterThan(6.5);
    expect(player.y).toBeGreaterThan(23.5);
    expect(player.onGround).toBe(true);
    expect(player.inWater).toBe(false);
  });

  it('sinks slowly instead of dropping through the water', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 23.5;
    player.z = 0.5;
    for (let i = 0; i < 30; i++) player.update(1 / 60, world, NO_INPUT);
    const startY = player.y;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT);
    const sank = startY - player.y;
    // Roughly a block a second, where air would be more than ten times that.
    expect(sank).toBeGreaterThan(0.4);
    expect(sank).toBeLessThan(2);
  });

  it('slows a dive rather than stopping it dead at the surface', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 30;
    player.z = 0.5;
    let deepest = player.y;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, world, NO_INPUT);
      deepest = Math.min(deepest, player.y);
    }
    // The fall carries on past the surface and then settles on the bottom.
    expect(deepest).toBeLessThan(22);
    expect(player.y).toBeCloseTo(21, 1);
  });
});
