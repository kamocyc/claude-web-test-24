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
import { HEADROOM, MAX_STEP, ROAD_BLOCKS, ROAD_SPEED } from './roads';

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

/** Solid blocks a road builder is allowed to clear out of the way overhead. A branch over
 *  a path is exactly the thing the headroom rule now rejects, and cutting it back is road
 *  building rather than vandalism — so the sweep does it rather than quietly laying a
 *  column the index will refuse. Stone, walls and anything somebody built are not here. */
export const CLEARABLE: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.OAK_LEAVES,
  Block.BIRCH_LEAVES,
  Block.SPRUCE_LEAVES,
]);

/** How far above and below the last known level a column is looked for. Matches the step
 *  the road index will walk between two columns, so a sweep can only ever lay road the
 *  index will accept as continuous. Walking off a two block drop lays nothing now, which
 *  is honest: that is a cutting to dig, and `runRoad` is the tool that digs it. */
export const TREAD_REACH = MAX_STEP;

/** What a laying tool puts down, how wide, and what it costs.
 *
 *  A shovel treads dirt: free, and three columns across, because dirt costs nothing and a
 *  wide road is what buys a cart. Rails come out of the player's pack one at a time and
 *  go down single file, because a train needs one column and every one of them is iron.
 *  Keeping the three apart in one record is what stops the second material from becoming
 *  a second copy of the sweep. */
export interface PaveMaterial {
  block: BlockId;
  /** Columns across a sweep lays. */
  width: 1 | 3;
  /** Takes one block out of the player's pile and says whether there was one. Null when
   *  the material is free, which is the shovel and every test that does not care. */
  supply: { take(): boolean } | null;
}

/** What the shovel lays, and the default everywhere a material is not named. */
export const TREAD_DIRT: PaveMaterial = { block: Block.DIRT_PATH, width: 3, supply: null };

export interface PaveTarget {
  getBlock(x: number, y: number, z: number): BlockId;
  setBlock(x: number, y: number, z: number, id: BlockId): void;
  /** The level of the road already indexed at a column, if there is one. */
  roadLevel(x: number, z: number): number | undefined;
}

/** Makes `HEADROOM` cells of room over a road column. A tuft of grass is brushed aside and
 *  an overhanging branch is cut back; water, or anything else solid, means this was not the
 *  surface after all and the column is left alone.
 *
 *  Clearing the whole height matters more than it looks: the index wants two cells clear,
 *  so a sweep that only tidied the first one would lay a line of blocks under a canopy and
 *  report nothing, and the player would be left with a road that is visibly there and
 *  officially absent. */
function clearAbove(target: PaveTarget, x: number, y: number, z: number): boolean {
  for (let h = 1; h <= HEADROOM; h++) {
    const above = target.getBlock(x, y + h, z);
    if (above === Block.AIR) continue;
    if (above === Block.WATER) return false;
    if (blockDef(above).solid && !CLEARABLE.has(above)) return false;
    target.setBlock(x, y + h, z, Block.AIR);
  }
  return true;
}

/** Treads one column into a path, at whatever level the ground is near `aroundY`.
 *  Returns the level it paved or found, or null when there is nothing there to tread. */
export function treadColumn(
  target: PaveTarget,
  x: number,
  z: number,
  aroundY: number,
  material: PaveMaterial = TREAD_DIRT,
): number | null {
  for (let y = aroundY + TREAD_REACH; y >= aroundY - TREAD_REACH; y--) {
    const id = target.getBlock(x, y, z);
    if (id === Block.AIR) continue;
    // Tall grass and flowers are not the ground; keep looking underneath them.
    if (!blockDef(id).solid) continue;
    // A road somebody already laid is only ever improved. Treading a paved street back
    // into dirt would undo the work rather than continue it, so a material is written
    // over an existing road when it is the faster of the two and never otherwise — which
    // is what lets rails be laid along a road that is already there, and what stops a
    // shovel from scraping them off again on the way back.
    if (ROAD_BLOCKS.has(id) && target.roadLevel(x, z) === y) {
      if ((ROAD_SPEED.get(material.block) ?? 0) <= (ROAD_SPEED.get(id) ?? 0)) return y;
      if (material.supply && !material.supply.take()) return null;
      target.setBlock(x, y, z, material.block);
      return y;
    }
    if (!PAVABLE.has(id)) return null;
    if (!clearAbove(target, x, y, z)) return null;
    if (material.supply && !material.supply.take()) return null;
    target.setBlock(x, y, z, material.block);
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
  material: PaveMaterial = TREAD_DIRT,
): { laid: number; level: number } {
  let laid = 0;
  const middle = treadColumn(target, x, z, aroundY, material);
  if (middle !== null) laid++;
  const level = middle ?? aroundY;
  if (material.width === 1) return { laid, level };
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (treadColumn(target, x + dx, z + dz, level, material) !== null) laid++;
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
  material: PaveMaterial = TREAD_DIRT,
): { laid: number; level: number } {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  let laid = 0;
  let level = startY;
  for (let i = 0; i <= steps; i++) {
    const x = steps === 0 ? from.x : Math.round(from.x + ((to.x - from.x) * i) / steps);
    const z = steps === 0 ? from.z : Math.round(from.z + ((to.z - from.z) * i) / steps);
    const brush = treadBrush(target, x, z, level, material);
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
 *  gate. In between, the ground decides.
 *
 *  An angled road comes out as a staircase rather than a diagonal, because a road joins
 *  up left, right, up and down and nowhere else. That costs about four blocks in ten over
 *  a diagonal run, and buys a road that is a road everywhere along it rather than one that
 *  looks continuous and is not.
 *
 *  `width` lays the same level either side of the line, across the direction of *this
 *  step*, and each column gets the band for the way in as well as the way out — which
 *  only differ at a corner, and a corner given one of the two is a corner a cart cannot
 *  turn. Laying the band flat rather than following the ground under each side is
 *  deliberate too: a road wide enough to pull a cart down is a road somebody levelled.
 *
 *  Returns the road's length in columns, which is what every caller wants to say out
 *  loud — not the number of blocks a wide band put down. */
export function runRoad(
  runner: RoadRunner,
  from: { x: number; z: number },
  to: { x: number; z: number },
  startY: number,
  grade: number,
  floor: number,
  endY?: number,
  width = 1,
): number {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  const span = Math.floor((Math.max(1, width) - 1) / 2);
  const at = (i: number): { x: number; z: number } =>
    steps === 0
      ? { x: from.x, z: from.z }
      : {
          x: Math.round(from.x + ((to.x - from.x) * i) / steps),
          z: Math.round(from.z + ((to.z - from.z) * i) / steps),
        };

  // The line between the two points, with every corner folded into two steps so that no
  // two columns of the road are only diagonally adjacent. A road joins up left, right,
  // up and down and nowhere else, so a builder that stepped diagonally would lay a line
  // of blocks that looks like a road and is not one.
  const spine: { x: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const here = at(i);
    const last = spine[spine.length - 1];
    if (last && last.x === here.x && last.z === here.z) continue;
    if (last && last.x !== here.x && last.z !== here.z) spine.push({ x: here.x, z: last.z });
    spine.push(here);
  }
  if (spine.length === 0) spine.push({ x: from.x, z: from.z });

  // The height of every column of the line, worked out before anything is written. A road
  // that gains height has to be settled in one pass: the widening either side of it lands
  // on cells the line itself will use further along, and a band block dropped a level
  // above the line breaks the very road it was widening.
  const finish = spine.length - 1;
  const levels: number[] = [];
  let y = startY;
  for (let i = 0; i <= finish; i++) {
    const { x, z } = spine[i];
    let wanted = Math.max(runner.ground(x, z), floor);
    const rise = grade * i;
    wanted = Math.min(startY + rise, Math.max(startY - rise, wanted));
    if (endY !== undefined) {
      const reach = grade * (finish - i);
      wanted = Math.min(endY + reach, Math.max(endY - reach, wanted));
    }
    // `grade` may be a fraction of a block per column — a road wide enough for a cart has
    // to gain height slowly enough that the band either side of it stays level with the
    // line it is widening, and the cells of that band belong to columns several steps
    // apart once the road is a staircase.
    y = Math.max(y - grade, Math.min(y + grade, wanted));
    levels.push(Math.round(y));
  }

  // The line first, then the widening around it, and never the same column twice: the
  // line's own height wins wherever the two want the same cell.
  const claimed = new Map<string, number>();
  for (let i = 0; i <= finish; i++) {
    const { x, z } = spine[i];
    if (claimed.has(`${x},${z}`)) continue;
    claimed.set(`${x},${z}`, levels[i]);
    runner.lay(x, levels[i], z);
  }
  for (let i = 0; i <= finish; i++) {
    const { x, z } = spine[i];
    for (const heading of headingsAt(spine, i)) {
      for (let side = -span; side <= span; side++) {
        const cx = x - heading.z * side;
        const cz = z + heading.x * side;
        if (claimed.has(`${cx},${cz}`)) continue;
        claimed.set(`${cx},${cz}`, levels[i]);
        runner.lay(cx, levels[i], cz);
      }
    }
  }
  return spine.length;
}

/** The way into a column of the road and the way out of it, without repeats. They differ
 *  at a corner, and the band is laid across both: the width rule asks whether a cart has
 *  room as it arrives and as it leaves, so a corner given only one of the two is a corner
 *  it cannot turn. */
function headingsAt(
  spine: readonly { x: number; z: number }[],
  i: number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const add = (a: { x: number; z: number }, b: { x: number; z: number }): void => {
    const d = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    if (d.x === 0 && d.z === 0) return;
    if (!out.some((o) => o.x === d.x && o.z === d.z)) out.push(d);
  };
  if (i + 1 < spine.length) add(spine[i], spine[i + 1]);
  if (i > 0) add(spine[i - 1], spine[i]);
  return out.length > 0 ? out : [{ x: 1, z: 0 }];
}
