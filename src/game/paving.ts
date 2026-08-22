/** Laying road, which is now the only way two stretches of it become one.
 *
 *  Roads used to be allowed to skip twenty blocks, and the reason was not that skipping
 *  made a better road: it was that laying four hundred blocks meant four hundred clicks.
 *  Take the clicking away and the concession is not needed, so this module is what pays
 *  for the stricter rule — a shovel that treads a path while the player walks, and a way
 *  to say "and the twenty blocks between here and there" in one keystroke.
 *
 *  Nothing here touches three.js or a chunk: it is block reads and block writes through
 *  a two-method interface, which is what lets a road be tested without a renderer. */

import { Block, blockDef, type BlockId } from '../world/blocks';
import { ROAD_BLOCKS } from './roads';

/** Ground a shovel treads into a path. Gravel is in the list because a natural bank of
 *  it is not a road until somebody records it as one; bare stone is not, because a road
 *  has to be told apart from the mountain it crosses. */
export const PAVABLE: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.GRASS,
  Block.DIRT,
  Block.SAND,
  Block.SNOW,
  Block.GRAVEL,
]);

/** How far above and below the last known level a column is looked for. Matches the step
 *  the road index will walk between two columns, so a sweep can only ever lay road the
 *  index will accept as continuous. */
export const TREAD_REACH = 2;

export interface PaveTarget {
  getBlock(x: number, y: number, z: number): BlockId;
  setBlock(x: number, y: number, z: number, id: BlockId): void;
  /** The level of the road already indexed at a column, if there is one. */
  roadLevel(x: number, z: number): number | undefined;
}

/** Makes room over a road column. A tuft of grass is brushed aside; anything solid or wet
 *  means this was not the surface after all. */
function clearAbove(target: PaveTarget, x: number, y: number, z: number): boolean {
  const above = target.getBlock(x, y + 1, z);
  if (above === Block.AIR) return true;
  if (above === Block.WATER || blockDef(above).solid) return false;
  target.setBlock(x, y + 1, z, Block.AIR);
  return true;
}

/** Treads one column into a path, at whatever level the ground is near `aroundY`.
 *  Returns the level it paved or found, or null when there is nothing there to tread. */
export function treadColumn(
  target: PaveTarget,
  x: number,
  z: number,
  aroundY: number,
): number | null {
  for (let y = aroundY + TREAD_REACH; y >= aroundY - TREAD_REACH; y--) {
    const id = target.getBlock(x, y, z);
    if (id === Block.AIR) continue;
    // Tall grass and flowers are not the ground; keep looking underneath them.
    if (!blockDef(id).solid) continue;
    // A road somebody already laid is left exactly as it is. Treading a paved street back
    // into dirt would undo the work rather than continue it.
    if (ROAD_BLOCKS.has(id) && target.roadLevel(x, z) === y) return y;
    if (!PAVABLE.has(id)) return null;
    if (!clearAbove(target, x, y, z)) return null;
    target.setBlock(x, y, z, Block.DIRT_PATH);
    return y;
  }
  return null;
}

/** Treads a cell and the eight around it, and reports the level the middle came out at.
 *
 *  The middle goes first so its neighbours are looked for at the height the road actually
 *  reached, which is what keeps a sweep across a slope from wandering off the hillside. */
export function treadBrush(
  target: PaveTarget,
  x: number,
  z: number,
  aroundY: number,
): { laid: number; level: number } {
  let laid = 0;
  const middle = treadColumn(target, x, z, aroundY);
  if (middle !== null) laid++;
  const level = middle ?? aroundY;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (treadColumn(target, x + dx, z + dz, level) !== null) laid++;
    }
  }
  return { laid, level };
}

/** Treads every cell along a line, which is what fills in behind a crosshair that jumped.
 *  The level carries from one cell to the next, so a sweep follows a slope instead of
 *  hunting for the ground from scratch at every step. */
export function treadLine(
  target: PaveTarget,
  from: { x: number; z: number },
  to: { x: number; z: number },
  startY: number,
): { laid: number; level: number } {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  let laid = 0;
  let level = startY;
  for (let i = 0; i <= steps; i++) {
    const x = steps === 0 ? from.x : Math.round(from.x + ((to.x - from.x) * i) / steps);
    const z = steps === 0 ? from.z : Math.round(from.z + ((to.z - from.z) * i) / steps);
    const brush = treadBrush(target, x, z, level);
    laid += brush.laid;
    level = brush.level;
  }
  return { laid, level };
}

export interface RoadRunner {
  /** Surface height at a column, wherever it comes from. */
  ground(x: number, z: number): number;
  /** Writes one column of road plus the headroom over it. */
  lay(x: number, y: number, z: number): void;
}

/** Runs an unbroken line of road columns from one point to another.
 *
 *  Every column touches the next — one step in x, in z, or in both — because that is now
 *  the only way two of them are one road. It follows the ground but never climbs more
 *  than `grade`, cutting into a rise and carrying over a dip, and it stays above `floor`
 *  rather than diving into the water, which is what a bridge is.
 *
 *  Both ends are commitments rather than suggestions. A road that ends on a village
 *  street has to *reach* that street: coming off high ground it can be three blocks above
 *  the plateau by the time it runs out of road, and three blocks is a road that connects
 *  to nothing. So each end is clamped to whatever still leaves room to get there — the
 *  way a road builder starts the descent early rather than discovering the problem at the
 *  gate. In between, the ground decides. */
export function runRoad(
  runner: RoadRunner,
  from: { x: number; z: number },
  to: { x: number; z: number },
  startY: number,
  grade: number,
  floor: number,
  endY?: number,
): number {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  let y = startY;
  let laid = 0;
  for (let i = 0; i <= steps; i++) {
    const x = steps === 0 ? from.x : Math.round(from.x + ((to.x - from.x) * i) / steps);
    const z = steps === 0 ? from.z : Math.round(from.z + ((to.z - from.z) * i) / steps);
    let wanted = Math.max(runner.ground(x, z), floor);
    const rise = grade * i;
    wanted = Math.min(startY + rise, Math.max(startY - rise, wanted));
    if (endY !== undefined) {
      const reach = grade * (steps - i);
      wanted = Math.min(endY + reach, Math.max(endY - reach, wanted));
    }
    y = Math.max(y - grade, Math.min(y + grade, wanted));
    runner.lay(x, y, z);
    laid++;
  }
  return laid;
}
