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
});
