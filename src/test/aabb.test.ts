import { describe, expect, it } from 'vitest';
import { type EntityBox, type VoxelCollider, boxIntersectsWorld, canStepUp, sweepMove } from '../core/aabb';

/** Test world: solid wherever the predicate says so. */
function collider(solid: (x: number, y: number, z: number) => boolean): VoxelCollider {
  return { isSolidAt: solid };
}

const floorAt0 = collider((_x, y) => y < 0);

function player(x = 0.5, y = 0, z = 0.5): EntityBox {
  return { x, y, z, width: 0.6, height: 1.8 };
}

describe('sweepMove', () => {
  it('lands on the floor instead of falling through', () => {
    const box = player(0.5, 5, 0.5);
    const result = sweepMove(floorAt0, box, 0, -10, 0);
    expect(result.onGround).toBe(true);
    expect(box.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.y).toBeLessThan(0.01);
  });

  it('stops at a wall and still slides along it', () => {
    const world = collider((x, y) => y < 0 || x === 2);
    const box = player(0.5, 0, 0.5);
    sweepMove(world, box, 5, 0, 3);
    expect(box.x).toBeLessThan(2);
    expect(box.z).toBeGreaterThan(1);
  });

  it('does not tunnel through a thin wall at high speed', () => {
    const world = collider((x, y) => y < 0 || x === 3);
    const box = player(0.5, 0, 0.5);
    sweepMove(world, box, 40, 0, 0);
    expect(box.x).toBeLessThan(3);
  });

  it('bumps its head on a ceiling', () => {
    const world = collider((_x, y) => y < 0 || y === 3);
    const box = player(0.5, 0, 0.5);
    const result = sweepMove(world, box, 0, 5, 0);
    expect(result.collidedY).toBe(true);
    expect(box.y + box.height).toBeLessThanOrEqual(3);
  });

  it('reports being grounded while standing still', () => {
    const box = player(0.5, 0, 0.5);
    expect(sweepMove(floorAt0, box, 0, 0, 0).onGround).toBe(true);
  });
});

describe('canStepUp', () => {
  it('allows a one block step and refuses a two block wall', () => {
    const oneHigh = collider((x, y) => y < 0 || (x === 1 && y === 0));
    const twoHigh = collider((x, y) => y < 0 || (x === 1 && y <= 1));
    expect(canStepUp(oneHigh, player(0.7, 0, 0.5), 1, 0)).toBe(true);
    expect(canStepUp(twoHigh, player(0.7, 0, 0.5), 1, 0)).toBe(false);
  });
});

describe('boxIntersectsWorld', () => {
  it('detects overlap with a solid block', () => {
    const world = collider((x, y, z) => x === 0 && y === 0 && z === 0);
    expect(boxIntersectsWorld(world, player(0.5, 0, 0.5))).toBe(true);
    expect(boxIntersectsWorld(world, player(0.5, 2, 0.5))).toBe(false);
  });
});
