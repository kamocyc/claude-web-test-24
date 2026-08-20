import { Block, type BlockId, blockDef } from './blocks';
import type { World } from './world';

export interface RaycastHit {
  /** Block that was hit. */
  x: number;
  y: number;
  z: number;
  block: BlockId;
  /** Face normal pointing out of the hit block: the position a new block goes into. */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
}

export interface RaycastOptions {
  maxDistance?: number;
  /** Treat liquids as solid (used for fishing/placement checks). */
  hitLiquids?: boolean;
}

/** Amanatides & Woo voxel traversal: walks the grid one block boundary at a time,
 *  which is both exact and far cheaper than sampling along the ray. */
export function raycastVoxels(
  world: World,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  options: RaycastOptions = {},
): RaycastHit | null {
  const maxDistance = options.maxDistance ?? 5;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0) return null;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

  let tMaxX = stepX === 0 ? Infinity : ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX);
  let tMaxY = stepY === 0 ? Infinity : ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY);
  let tMaxZ = stepZ === 0 ? Infinity : ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ);

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let travelled = 0;

  while (travelled <= maxDistance) {
    const id = world.getBlock(x, y, z);
    if (id !== Block.AIR) {
      const def = blockDef(id);
      const targetable = def.render === 'liquid' ? options.hitLiquids === true : true;
      if (targetable) {
        return { x, y, z, block: id, nx, ny, nz, distance: travelled };
      }
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      travelled = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      travelled = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      travelled = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }
  return null;
}
