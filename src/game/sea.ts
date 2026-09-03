/** The sea, as somewhere a line can run.
 *
 *  Every other way of moving goods in this game is something the player built: a road is
 *  blocks they laid, a railway is curves they solved. The sea is already there. That is
 *  the whole of what a ship is worth here — a pair of towns on two coasts is joined the
 *  moment both have a stop near the water, without a single block being placed, and the
 *  only thing the player decides is whether to put the stop where a ship can reach it.
 *
 *  **It is searched off the generator, not off the world.** A crossing is hundreds of
 *  blocks long and almost none of those blocks are loaded: the chunks behind the player
 *  were thrown away and the ones ahead do not exist yet. So the depth comes from
 *  `heightAt`, which answers from the seed for anywhere at all — which also means a lane
 *  is the same lane every time the world is opened, and that a canal somebody dug by hand
 *  is *not* a sea lane. Ships sail the sea; digging a channel through a headland is a
 *  thing the world does not notice, and the panel says so rather than pretending.
 *
 *  **A lattice, not a block grid.** Cells are `SEA_STEP` apart, which is what makes a
 *  three-hundred-block crossing a search over a few thousand cells instead of a hundred
 *  thousand, and a cell counts as water only when the five columns around its middle are
 *  all deep enough. A ship is two blocks wide and a lane that shaved the corner of a
 *  headland would put it through the rocks. */

import { SEA_LEVEL } from '../world/chunk';
import { toWaypoints, type RoadPoint } from './roads';
import type { SeaLane } from './transport';

/** What the lanes need of the world: how high the ground is, anywhere, loaded or not. */
export interface SeaWorld {
  heightAt(x: number, z: number): number;
}

/** Blocks between two cells of the lattice the search runs on. Four is a ship's width
 *  twice over: fine enough that a lane threads a strait a boat could actually use, coarse
 *  enough that crossing an ocean is a few thousand cells. */
export const SEA_STEP = 4;
/** Water under the keel, down the middle of the lane. Two blocks below the surface, so a
 *  lane never runs up a beach — the shallows are where a ship stops being a ship. */
export const MIN_DEPTH = 2;
/** And what the water beside it has to be: wet, and no more than that.
 *
 *  The two numbers are different on purpose. A real coastal shelf is noisy — the sea bed
 *  off this world's beaches wanders a block either side of the draught line from one
 *  column to the next — so demanding the full depth at all five samples finds no channel
 *  at all along a coast a boat can plainly sail. What matters is that the keel clears the
 *  bottom and that the ship is not aground on either side of itself. */
export const MIN_MARGIN = 1;
/** How far a stop may stand from navigable water and still be a port. About the width of
 *  a village's edge: near enough that the walk down to the quay is a walk, far enough that
 *  the player is not asked to put a stop in the surf. */
export const HARBOUR_REACH = 28;
/** The most cells one search may settle. Reached only by a lane nobody would want: an
 *  ocean has a great many cells and a route across the wrong one of them is not a route,
 *  it is a wait. */
export const MAX_LANE_CELLS = 12000;
/** How far outside the straight line between two ports the search may wander, as a
 *  multiple of the distance between them plus a fixed allowance. A lane round a peninsula
 *  is a real answer; a lane round a continent is a road, and a slow one. */
export const LANE_SPREAD = 1.6;
export const LANE_MARGIN = 160;
/** The waterline: the top of the last water block, which is what a hull sits on. */
export const WATERLINE = SEA_LEVEL;
/** How many crossings to remember. The sea never changes, so a lane once found is a lane
 *  for the rest of the session — which matters, because the survey asks for every leg of
 *  every line each time anybody moves a road block. */
const CACHE_LIMIT = 256;

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** A binary heap of cells by score. The same reason `roads.ts` has one: a linear scan for
 *  the cheapest node is fine on a hundred nodes and quietly quadratic on ten thousand,
 *  which is what an ocean is. */
class Frontier {
  private readonly keys: string[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: string, score: number): void {
    this.keys.push(key);
    this.scores.push(score);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] <= this.scores[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): string | null {
    if (this.keys.length === 0) return null;
    const top = this.keys[0];
    const lastKey = this.keys.pop() as string;
    const lastScore = this.scores.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.scores[0] = lastScore;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let small = i;
        if (left < this.keys.length && this.scores[left] < this.scores[small]) small = left;
        if (right < this.keys.length && this.scores[right] < this.scores[small]) small = right;
        if (small === i) break;
        this.swap(small, i);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]];
  }
}

/** Navigable water, and the lanes across it.
 *
 *  One of these per world. Everything it knows is derived from the seed, so it is neither
 *  saved nor invalidated: what it has worked out once stays true. */
export class SeaLanes {
  /** Whether each lattice cell is deep enough to sail, by cell coordinates. */
  private readonly deep = new Map<string, boolean>();
  /** Crossings already solved, by the two ports they run between. Null is a real answer
   *  and is cached too: "these two are not joined by water" is the expensive one. */
  private readonly lanes = new Map<string, SeaLane | null>();

  constructor(private readonly world: SeaWorld) {}

  /** Whether a lattice cell has water enough for a ship.
   *
   *  Five columns and not one: the middle, where the keel is and where the full draught
   *  is wanted, and the four around it at half a step, which only have to be water. One
   *  sample would let a lane clip a rock that happened to fall between two of them; five
   *  at full draught would refuse every shelf coast in the world. */
  private navigable(cx: number, cz: number): boolean {
    const key = cellKey(cx, cz);
    const known = this.deep.get(key);
    if (known !== undefined) return known;
    const x = cx * SEA_STEP;
    const z = cz * SEA_STEP;
    const half = SEA_STEP / 2;
    let ok = this.world.heightAt(x, z) <= SEA_LEVEL - MIN_DEPTH;
    for (const [dx, dz] of [[-half, 0], [half, 0], [0, -half], [0, half]]) {
      if (!ok) break;
      ok = this.world.heightAt(x + dx, z + dz) <= SEA_LEVEL - MIN_MARGIN;
    }
    this.deep.set(key, ok);
    return ok;
  }

  /** The nearest cell a ship could lie at, within `HARBOUR_REACH` of a place. Null for a
   *  stop inland, which is most of them.
   *
   *  This is the whole of what makes a stop a port: not a building, not a recipe, just
   *  standing near enough to deep water. Where the player puts the stop is the decision,
   *  and it is one they can make with their eyes. */
  harbourAt(place: RoadPoint): { cx: number; cz: number } | null {
    const reach = Math.ceil(HARBOUR_REACH / SEA_STEP);
    const cx0 = Math.round(place.x / SEA_STEP);
    const cz0 = Math.round(place.z / SEA_STEP);
    let best: { cx: number; cz: number } | null = null;
    let bestAway = HARBOUR_REACH;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        const away = Math.hypot(cx * SEA_STEP - place.x, cz * SEA_STEP - place.z);
        if (away > bestAway || !this.navigable(cx, cz)) continue;
        best = { cx, cz };
        bestAway = away;
      }
    }
    return best;
  }

  /** The water from one place to another, or null when a ship could not make the trip.
   *
   *  Cached both ways round: a leg is run in both directions and the same water joins the
   *  two whichever end the question is asked from. */
  laneBetween(from: RoadPoint, to: RoadPoint): SeaLane | null {
    const key = `${Math.round(from.x)},${Math.round(from.z)}>${Math.round(to.x)},${Math.round(to.z)}`;
    const known = this.lanes.get(key);
    if (known !== undefined) return known;
    const lane = this.solve(from, to);
    if (this.lanes.size >= CACHE_LIMIT) {
      this.lanes.delete(this.lanes.keys().next().value as string);
    }
    this.lanes.set(key, lane);
    return lane;
  }

  /** A* over the lattice, eight ways out of every cell.
   *
   *  Diagonals are allowed and corners are not cut: a diagonal step is refused unless both
   *  cells beside it are water too, which is the difference between rounding a headland
   *  and sailing through it. */
  private solve(from: RoadPoint, to: RoadPoint): SeaLane | null {
    const start = this.harbourAt(from);
    const goal = this.harbourAt(to);
    if (!start || !goal) return null;
    if (start.cx === goal.cx && start.cz === goal.cz) return null;

    const direct = Math.hypot(
      (goal.cx - start.cx) * SEA_STEP,
      (goal.cz - start.cz) * SEA_STEP,
    );
    // The box the search may look in. A lane that leaves it is going somewhere else.
    const spread = (direct * LANE_SPREAD + LANE_MARGIN) / SEA_STEP;
    const minX = Math.min(start.cx, goal.cx) - spread;
    const maxX = Math.max(start.cx, goal.cx) + spread;
    const minZ = Math.min(start.cz, goal.cz) - spread;
    const maxZ = Math.max(start.cz, goal.cz) + spread;

    const startKey = cellKey(start.cx, start.cz);
    const goalKey = cellKey(goal.cx, goal.cz);
    const cost = new Map<string, number>([[startKey, 0]]);
    const cameFrom = new Map<string, string>();
    const settled = new Set<string>();
    const open = new Frontier();
    open.push(startKey, direct);
    const heuristic = (cx: number, cz: number): number =>
      Math.hypot((goal.cx - cx) * SEA_STEP, (goal.cz - cz) * SEA_STEP);

    let found = false;
    for (let steps = 0; steps < MAX_LANE_CELLS && open.size > 0; steps++) {
      const key = open.pop();
      if (key === null) break;
      if (settled.has(key)) continue;
      settled.add(key);
      if (key === goalKey) {
        found = true;
        break;
      }
      const [hereX, hereZ] = key.split(',').map(Number);
      const here = { key, cx: hereX, cz: hereZ };
      const base = cost.get(here.key) ?? 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const cx = here.cx + dx;
          const cz = here.cz + dz;
          if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
          const next = cellKey(cx, cz);
          if (settled.has(next) || !this.navigable(cx, cz)) continue;
          // No cutting corners: a diagonal needs the water on both sides of it.
          if (dx !== 0 && dz !== 0) {
            if (!this.navigable(here.cx + dx, here.cz) || !this.navigable(here.cx, here.cz + dz)) continue;
          }
          const walked = base + Math.hypot(dx, dz) * SEA_STEP;
          const had = cost.get(next);
          if (had !== undefined && had <= walked) continue;
          cost.set(next, walked);
          cameFrom.set(next, here.key);
          open.push(next, walked + heuristic(cx, cz));
        }
      }
    }
    if (!found) return null;

    const cells: string[] = [goalKey];
    for (let key = goalKey; key !== startKey;) {
      const previous = cameFrom.get(key);
      if (previous === undefined) return null;
      cells.unshift(previous);
      key = previous;
    }
    const path: RoadPoint[] = cells.map((key) => {
      const [cx, cz] = key.split(',').map(Number);
      return { x: cx * SEA_STEP, y: WATERLINE, z: cz * SEA_STEP };
    });
    const points = toWaypoints(path);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    if (points.length < 2 || length <= 0) return null;
    return { points, length };
  }
}
