import { WORLD_MAX, WORLD_MIN, SEA_LEVEL } from '../chunk';

/** The island's drainage network.
 *
 *  Rivers used to be the level set of a noise field: a band of fixed width cut into the
 *  land wherever the noise happened to cross zero. That gives you a crack, not a river —
 *  the same nine blocks wide at the source as at the mouth, with no tributaries, because
 *  nothing in it knows which way is downhill.
 *
 *  This works the way water does. Fill the hollows so nothing is trapped, send every
 *  square metre of the island downhill one cell at a time, and count how much land drains
 *  through each cell. That count is the river: a few dozen cells at a mountain stream, a
 *  fifth of the island at the mouth. Width and depth follow from it, so a channel grows
 *  as its tributaries join, and the surface is guaranteed to fall the whole way to the
 *  sea because the flow was routed downhill in the first place.
 *
 *  The island is finite (384 by 384 blocks), so the whole network is computed once, up
 *  front, from the seed alone. Generation then only ever reads arrays. */

/** Side of the square the world occupies, in blocks. */
export const WORLD_SIZE = WORLD_MAX - WORLD_MIN + 1;
const CELLS = WORLD_SIZE * WORLD_SIZE;

/** Lifting each filled cell a hair above its outlet is the whole trick. Fill a hollow to
 *  exactly its rim and the result is dead flat, every cell of it a local minimum, and the
 *  flow routing has nowhere to send the water: on the test seed that dropped the largest
 *  catchment from 15,805 cells to 141. The slope this adds is far too small to see. */
const EPSILON = 0.001;

/** Cells of catchment a column needs before it counts as a channel rather than a damp
 *  patch of hillside. */
export const CHANNEL_FLOW = 600;
/** Catchment at which a river is big enough to have laid down a floodplain. */
export const PLAIN_FLOW = 5000;
/** Nothing is asked about the river beyond this many blocks, so nothing is recorded
 *  further out and everything past it is simply dry land. */
export const RIVER_REACH = 40;
/** How far a channel's works reach, in half widths. Matches the widest cross section the
 *  river geometry draws, which is the floodplain. */
const PAINT_SPAN = 5;
/** A narrow stream still has to be visible from far enough away that a village can be
 *  asked whether it is about to build on one. */
const MIN_PAINT_REACH = 24;

/** Widest and narrowest a channel gets, in blocks. */
const MIN_WIDTH = 2;
const MAX_WIDTH = 16;
const MIN_DEPTH = 1;
const MAX_DEPTH = 4;

/** How far a spring may sit downstream of a channel's head before it is left out. Keeps
 *  one spring per stream instead of one per cell of it. */
const SPRING_FLOW = CHANNEL_FLOW * 2;

const DIAGONAL = Math.SQRT2;
/** The eight neighbours, as (dx, dz, distance). */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [1, 1, DIAGONAL],
];

/** A min-heap of cells keyed by height. A plain array of pairs allocates a hundred
 *  thousand objects for one island; two typed arrays do not. */
class HeightQueue {
  private readonly value = new Float64Array(CELLS + 1);
  private readonly cell = new Int32Array(CELLS + 1);
  private size = 0;

  push(value: number, cell: number): void {
    let i = ++this.size;
    while (i > 1) {
      const parent = i >> 1;
      if (this.value[parent] <= value) break;
      this.value[i] = this.value[parent];
      this.cell[i] = this.cell[parent];
      i = parent;
    }
    this.value[i] = value;
    this.cell[i] = cell;
  }

  pop(): number {
    const top = this.cell[1];
    const value = this.value[this.size];
    const cell = this.cell[this.size];
    this.size--;
    let i = 1;
    for (;;) {
      const left = i << 1;
      if (left > this.size) break;
      const right = left + 1;
      const child = right <= this.size && this.value[right] < this.value[left] ? right : left;
      if (this.value[child] >= value) break;
      this.value[i] = this.value[child];
      this.cell[i] = this.cell[child];
      i = child;
    }
    this.value[i] = value;
    this.cell[i] = cell;
    return top;
  }

  get empty(): boolean {
    return this.size === 0;
  }
}

/** What the network says about one column. */
export interface DrainageSample {
  /** Blocks from the middle of the nearest channel. */
  distance: number;
  /** Full width of that channel, in blocks. */
  width: number;
  /** How far its bed is cut below its surface. */
  depth: number;
  /** Top face of its water, as a fraction rather than a whole block. */
  surface: number;
  /** Cells of land draining through it. */
  flow: number;
  /** How steeply it falls, in blocks per block. */
  slope: number;
}

const NOWHERE: DrainageSample = {
  distance: Infinity,
  width: 0,
  depth: 0,
  surface: 0,
  flow: 0,
  slope: 0,
};

export function cellIndex(x: number, z: number): number {
  return (z - WORLD_MIN) * WORLD_SIZE + (x - WORLD_MIN);
}

export function insideWorldColumn(x: number, z: number): boolean {
  return x >= WORLD_MIN && x <= WORLD_MAX && z >= WORLD_MIN && z <= WORLD_MAX;
}

/** How much a steep reach narrows a channel. The same water crossing a mountainside
 *  runs fast and deep in a gorge rather than lying across the hill in a wide sheet, and
 *  a wide sheet on a slope is also what makes a generated river look like a flight of
 *  shelves: the surface falls a block or more from one side of it to the other. */
const SLOPE_NARROWING = 3;

/** Width of a channel carrying this much catchment down this much of a slope. Square
 *  root, because a river that drains four times the land is about twice as wide. */
export function channelWidth(flow: number, slope: number): number {
  const w = (2 + 1.5 * Math.sqrt(flow / CHANNEL_FLOW)) / (1 + slope * SLOPE_NARROWING);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

export function channelDepth(flow: number, slope: number): number {
  const d = (0.9 + 0.6 * Math.sqrt(flow / CHANNEL_FLOW)) * (1 + slope);
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, d));
}

export class Drainage {
  /** Height once every hollow has been filled to its outlet. Strictly decreasing along
   *  the flow, which is what makes a river surface derived from it fall all the way. */
  private readonly filled = new Float32Array(CELLS);
  /** Cells of land draining through each cell, itself included. */
  private readonly flow = new Float32Array(CELLS);
  /** How steeply the cell falls towards the one it drains into. */
  private readonly slope = new Float32Array(CELLS);
  /** Blocks to the nearest channel, up to `RIVER_REACH`. */
  private readonly distance = new Float32Array(CELLS);
  /** Which channel cell that is, or -1 for none in reach. */
  private readonly nearest = new Int32Array(CELLS);
  /** Heads of streams, where a spring feeds the network. */
  readonly springs: { x: number; z: number }[] = [];

  /** @param heightAt natural land height at a column, before any channel is cut into it.
   *  Passed in rather than imported so the terrain generator and the network are not
   *  circular. */
  constructor(heightAt: (x: number, z: number) => number) {
    const base = new Float32Array(CELLS);
    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) base[cellIndex(x, z)] = heightAt(x, z);
    }
    const order = this.fillDepressions(base);
    this.accumulate(base, order);
    this.paintChannels(base);
    this.findSprings(base);
  }

  /** Priority flood: walk inland from the sea and the map edge, always taking the lowest
   *  cell reached so far, and raise anything lower than the way it came in. Returns the
   *  order cells were reached in, which is by construction sorted by filled height. */
  private fillDepressions(base: Float32Array): Int32Array {
    const filled = this.filled;
    const order = new Int32Array(CELLS);
    const closed = new Uint8Array(CELLS);
    const queue = new HeightQueue();

    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
        const i = cellIndex(x, z);
        const edge = x === WORLD_MIN || x === WORLD_MAX || z === WORLD_MIN || z === WORLD_MAX;
        // The ocean is the outlet, and so is the edge of the map: water that reaches
        // either has left the island and is no longer anyone's problem.
        if (!edge && base[i] >= SEA_LEVEL) continue;
        closed[i] = 1;
        filled[i] = base[i];
        queue.push(base[i], i);
      }
    }

    let count = 0;
    while (!queue.empty) {
      const i = queue.pop();
      order[count++] = i;
      const x = WORLD_MIN + (i % WORLD_SIZE);
      const z = WORLD_MIN + Math.floor(i / WORLD_SIZE);
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!insideWorldColumn(nx, nz)) continue;
        const n = cellIndex(nx, nz);
        if (closed[n]) continue;
        closed[n] = 1;
        filled[n] = Math.max(base[n], filled[i] + EPSILON);
        queue.push(filled[n], n);
      }
    }
    return order;
  }

  /** D8 flow accumulation. Every cell hands its catchment to its steepest downhill
   *  neighbour; working through the fill order backwards means a cell is always dealt
   *  with before anything it drains into. */
  private accumulate(base: Float32Array, order: Int32Array): void {
    const { filled, flow, slope } = this;
    flow.fill(1);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (base[i] < SEA_LEVEL) continue;
      const x = WORLD_MIN + (i % WORLD_SIZE);
      const z = WORLD_MIN + Math.floor(i / WORLD_SIZE);
      let best = -1;
      let steepest = 0;
      for (const [dx, dz, length] of NEIGHBOURS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!insideWorldColumn(nx, nz)) continue;
        const n = cellIndex(nx, nz);
        const slope = (filled[i] - filled[n]) / length;
        if (slope > steepest) {
          steepest = slope;
          best = n;
        }
      }
      slope[i] = steepest;
      if (best >= 0) flow[best] += flow[i];
    }
  }

  /** Which channel owns each column, and how far it is from the middle of it.
   *
   *  Ownership is by `t` — the distance as a fraction of the channel's own half width —
   *  and not by distance alone. Where a tributary joins the trunk their footprints
   *  overlap, and a column a stride from the trunk's water can easily be nearer the
   *  little stream: sized by the stream, the generator would then cut it a couple of
   *  blocks below the trunk's water line and let the big river out sideways. Measured in
   *  half widths the trunk wins its own banks, which is the right answer. */
  private paintChannels(base: Float32Array): void {
    const { distance, nearest, flow, slope } = this;
    const share = new Float32Array(CELLS).fill(Infinity);
    distance.fill(Infinity);
    nearest.fill(-1);
    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
        const c = cellIndex(x, z);
        if (base[c] < SEA_LEVEL || flow[c] < CHANNEL_FLOW) continue;
        const half = channelWidth(flow[c], slope[c]) / 2;
        const reach = Math.min(RIVER_REACH, Math.max(half * PAINT_SPAN, MIN_PAINT_REACH));
        const steps = Math.ceil(reach);
        for (let dz = -steps; dz <= steps; dz++) {
          const nz = z + dz;
          if (nz < WORLD_MIN || nz > WORLD_MAX) continue;
          for (let dx = -steps; dx <= steps; dx++) {
            const nx = x + dx;
            if (nx < WORLD_MIN || nx > WORLD_MAX) continue;
            const away = Math.sqrt(dx * dx + dz * dz);
            if (away > reach) continue;
            const t = away / half;
            const i = cellIndex(nx, nz);
            if (t >= share[i]) continue;
            share[i] = t;
            distance[i] = away;
            nearest[i] = c;
          }
        }
      }
    }
  }

  /** A spring goes at the head of every stream: the first cell that carries enough water
   *  to be a channel, with nothing upstream of it that does. This is what makes rivers
   *  start in the hills — and on a finite island every river lives or dies by its
   *  springs, so a valley without one dries out for good. */
  private findSprings(base: Float32Array): void {
    const { flow } = this;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
        const i = cellIndex(x, z);
        if (base[i] < SEA_LEVEL) continue;
        if (flow[i] < CHANNEL_FLOW || flow[i] > SPRING_FLOW) continue;
        let head = true;
        for (const [dx, dz] of NEIGHBOURS) {
          const nx = x + dx;
          const nz = z + dz;
          if (!insideWorldColumn(nx, nz)) continue;
          const n = cellIndex(nx, nz);
          // Anything upstream that is already a channel means this is not the head.
          if (flow[n] >= CHANNEL_FLOW && flow[n] < flow[i]) head = false;
        }
        if (head) this.springs.push({ x, z });
      }
    }
  }

  /** Height once the hollows are filled, for tests and probes. */
  filledAt(x: number, z: number): number {
    return insideWorldColumn(x, z) ? this.filled[cellIndex(x, z)] : 0;
  }

  /** Catchment draining through a column, in cells. */
  flowAt(x: number, z: number): number {
    return insideWorldColumn(x, z) ? this.flow[cellIndex(x, z)] : 0;
  }

  /** The nearest channel to a column, or a dry sample when there is none within reach. */
  sample(x: number, z: number): DrainageSample {
    if (!insideWorldColumn(x, z)) return NOWHERE;
    const i = cellIndex(x, z);
    const source = this.nearest[i];
    if (source < 0) return NOWHERE;
    const flow = this.flow[source];
    const slope = this.slope[source];
    return {
      distance: this.distance[i],
      width: channelWidth(flow, slope),
      depth: channelDepth(flow, slope),
      surface: this.surfaceOf(source),
      flow,
      slope,
    };
  }

  /** Top face of the water in a channel cell. It sits half a block above the filled
   *  land, so a river runs at grade with the country it crosses instead of in an
   *  aqueduct, and it inherits the filled height's guarantee of falling downstream. */
  private surfaceOf(source: number): number {
    return Math.max(SEA_LEVEL + 1, this.filled[source] + 0.5);
  }
}
