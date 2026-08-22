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

/** How high a single step an entity walks up without jumping. Mobs keep to this; the
 *  player climbs taller ledges by retrying the move at each height in turn. */
export const STEP_HEIGHT = 1.02;

/** Whether the entity can step up onto the ledge directly in front of it. */
export function canStepUp(
  world: VoxelCollider,
  box: EntityBox,
  dirX: number,
  dirZ: number,
  stepHeight = STEP_HEIGHT,
): boolean {
  const ahead: EntityBox = { ...box, x: box.x + dirX * 0.6, z: box.z + dirZ * 0.6 };
  if (!overlapsSolid(world, ahead)) return false;
  const stepped: EntityBox = { ...ahead, y: box.y + stepHeight + 0.03 };
  return !overlapsSolid(world, stepped);
}

/** Walks a blocked horizontal move up a ledge: the same move is retried `stepHeight`
 *  higher and then settles back down onto whatever was climbed. `box` holds
 *  the position from before the move and is updated in place when the step succeeds.
 *  `achieved` is how far the blocked move actually got, so a step is only taken when
 *  it gains ground. This is what lets a walker cross a kerb without jumping and a
 *  swimmer haul itself out onto the bank. */
export function stepUpMove(
  world: VoxelCollider,
  box: EntityBox,
  dx: number,
  dz: number,
  dirX: number,
  dirZ: number,
  achieved: number,
  stepHeight = STEP_HEIGHT,
): boolean {
  if (!canStepUp(world, box, dirX, dirZ, stepHeight)) return false;
  const fromX = box.x;
  const fromZ = box.z;
  const raised: EntityBox = { ...box, y: box.y + stepHeight };
  if (overlapsSolid(world, raised)) return false;
  sweepMove(world, raised, dx, 0, dz);
  if (Math.hypot(raised.x - fromX, raised.z - fromZ) <= achieved + 0.001) return false;
  // Fall back onto the step so nothing is left hovering above it.
  sweepMove(world, raised, 0, -stepHeight, 0);
  box.x = raised.x;
  box.y = raised.y;
  box.z = raised.z;
  return true;
}
