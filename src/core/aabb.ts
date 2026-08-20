/** Axis-aligned box collision against a voxel grid.
 *  Entities are described by a foot position plus a width and height, which is all the
 *  player and every mob need. */

export interface VoxelCollider {
  isSolidAt(x: number, y: number, z: number): boolean;
}

export interface EntityBox {
  /** Centre of the footprint. */
  x: number;
  /** Bottom of the box. */
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface MoveResult {
  collidedX: boolean;
  collidedY: boolean;
  collidedZ: boolean;
  onGround: boolean;
}

const EPSILON = 1e-3;
/** Longest distance resolved in one pass; longer moves are split so nothing tunnels. */
const MAX_STEP = 0.4;

function overlapsSolid(world: VoxelCollider, box: EntityBox): boolean {
  const minX = Math.floor(box.x - box.width / 2 + EPSILON);
  const maxX = Math.floor(box.x + box.width / 2 - EPSILON);
  const minY = Math.floor(box.y + EPSILON);
  const maxY = Math.floor(box.y + box.height - EPSILON);
  const minZ = Math.floor(box.z - box.width / 2 + EPSILON);
  const maxZ = Math.floor(box.z + box.width / 2 - EPSILON);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolidAt(x, y, z)) return true;
      }
    }
  }
  return false;
}

/** True when a box placed here would intersect terrain. */
export function boxIntersectsWorld(world: VoxelCollider, box: EntityBox): boolean {
  return overlapsSolid(world, box);
}

function moveAxis(world: VoxelCollider, box: EntityBox, axis: 'x' | 'y' | 'z', amount: number): boolean {
  if (amount === 0) return false;
  const original = box[axis];
  box[axis] = original + amount;
  if (!overlapsSolid(world, box)) return false;

  // Snap back to the face we ran into.
  if (axis === 'y') {
    box.y = amount > 0
      ? Math.floor(box.y + box.height) - box.height - EPSILON
      : Math.floor(box.y) + 1 + EPSILON;
  } else {
    const half = box.width / 2;
    box[axis] = amount > 0
      ? Math.floor(box[axis] + half) - half - EPSILON
      : Math.floor(box[axis] - half) + 1 + half + EPSILON;
  }
  // If the snap still overlaps (corner cases), give up on this axis entirely.
  if (overlapsSolid(world, box)) box[axis] = original;
  return true;
}

/** Moves the box, resolving each axis separately so sliding along walls feels natural. */
export function sweepMove(
  world: VoxelCollider,
  box: EntityBox,
  dx: number,
  dy: number,
  dz: number,
): MoveResult {
  const result: MoveResult = { collidedX: false, collidedY: false, collidedZ: false, onGround: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_STEP));
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;

  for (let i = 0; i < steps; i++) {
    if (moveAxis(world, box, 'y', sy)) {
      result.collidedY = true;
      if (sy < 0) result.onGround = true;
    }
    if (moveAxis(world, box, 'x', sx)) result.collidedX = true;
    if (moveAxis(world, box, 'z', sz)) result.collidedZ = true;
  }

  // Standing exactly on a surface counts as grounded even without downward motion.
  if (!result.onGround) {
    const probe: EntityBox = { ...box, y: box.y - 0.02 };
    if (overlapsSolid(world, probe)) result.onGround = true;
  }
  return result;
}

/** Whether the entity can step up onto the block directly in front of it. */
export function canStepUp(world: VoxelCollider, box: EntityBox, dirX: number, dirZ: number): boolean {
  const ahead: EntityBox = { ...box, x: box.x + dirX * 0.6, z: box.z + dirZ * 0.6 };
  if (!overlapsSolid(world, ahead)) return false;
  const stepped: EntityBox = { ...ahead, y: box.y + 1.05 };
  return !overlapsSolid(world, stepped);
}
