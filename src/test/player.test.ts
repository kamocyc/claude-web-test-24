import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { NO_INPUT, Player, movementDirection } from '../game/player';

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
