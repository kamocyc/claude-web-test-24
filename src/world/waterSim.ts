import { Block, blocksWater, isWaterSink } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL, type Chunk } from './chunk';
import { WATER_EPSILON, WATER_FULL, WATER_MAX } from './water';
import type { World } from './world';

/** Seconds between simulation steps. */
const WATER_TICK_SECONDS = 0.1;
/** Cells processed per step. A live river keeps tens of thousands of cells moving for
 *  as long as it runs, so this is the ceiling on what the water may cost a frame: past
 *  it the water flows more slowly instead of the frame rate falling. */
export const MAX_CELLS_PER_TICK = 8000;
/** How far from the player water is simulated at full speed. What the player digs out
 *  or breaks has to answer now, not when the island's round next comes to it. Measured
 *  on the trunk of the biggest river on the verification seed, this square holds 2,400
 *  to 3,500 moving cells, which fits inside the share below with room to spare. */
const NEAR_RADIUS = 32;
/** Most of the budget the water round the player may take. Standing in the middle of a
 *  lake must not stop the rest of the island. */
const NEAR_SHARE = 0.5;
/** Steps allowed in a single frame, so a slow frame cannot spiral. */
const MAX_TICKS_PER_FRAME = 1;
/** Most a single cell can give away per step. */
const MAX_FLOW = WATER_FULL;
/** Water added by a spring each step. Every river now lives on what its springs give
 *  it, so this is what holds them at their level: too little and they run shallow, too
 *  much and they climb their banks. */
const SPRING_RATE = 32;
/** Water a pump lifts each step. */
const PUMP_RATE = 70;
/** Exposed water columns checked for evaporation per simulation step. The queue only
 *  contains columns that have held water, so drought does not scan the whole island. */
const EVAPORATION_COLUMNS_PER_TICK = 1024;
/** Fill units lost whenever an exposed column comes round during a full drought. */
const EVAPORATION_RATE = 2;

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** What happens to water pushed into a cell. */
type Target = 'open' | 'blocked' | 'sink';

const COORD_BIAS = 1 << 20;
const COORD_SPAN = 1 << 21;

function packCell(x: number, y: number, z: number): number {
  return ((x + COORD_BIAS) * COORD_SPAN + (z + COORD_BIAS)) * CHUNK_HEIGHT + y;
}

function unpackY(key: number): number {
  return key % CHUNK_HEIGHT;
}

function unpackZ(key: number): number {
  return (Math.floor(key / CHUNK_HEIGHT) % COORD_SPAN) - COORD_BIAS;
}

function unpackX(key: number): number {
  return Math.floor(key / (CHUNK_HEIGHT * COORD_SPAN)) - COORD_BIAS;
}

export interface FlowVector {
  x: number;
  z: number;
}

const NO_FLOW: FlowVector = { x: 0, z: 0 };

/** A queue of cells that is always walked all the way round before it starts again.
 *
 *  The cursor is the whole point. The obvious version — snapshot the awake cells, run
 *  as many as the budget allows, put the rest back — quietly never runs the rest: a cell
 *  that moves wakes itself again from inside the loop, so it is queued ahead of the ones
 *  the budget could not reach, and the same head is at the front for ever. On an island
 *  with three times more moving water than one step can afford, two thirds of it was
 *  never simulated at all: rivers stopped short, water sat over holes the player had dug
 *  under it, and breaking the bank of a river did nothing. */
class CellSweep {
  /** Cells woken since this round started; they go into the round after it. */
  private waking = new Set<number>();
  private round: number[] = [];
  private at = 0;

  add(key: number): void {
    this.waking.add(key);
  }

  get size(): number {
    return this.waking.size + (this.round.length - this.at);
  }

  /** Runs at most `budget` cells, picking up where the last step stopped, and reports
   *  how many it got through. A round is only ever restarted once per call, so a queue
   *  that fits inside the budget runs every cell every step. */
  run(budget: number, simulate: (key: number) => void): number {
    if (this.at >= this.round.length) {
      this.round = [...this.waking];
      this.waking.clear();
      this.at = 0;
    }
    const end = Math.min(this.round.length, this.at + budget);
    const used = end - this.at;
    for (; this.at < end; this.at++) simulate(this.round[this.at]);
    return used;
  }
}

/** Cellular water: every voxel holds a fill level, water falls, spreads sideways to
 *  level out, and a cell may hold a little more than full so pressure can push water
 *  back up on the far side of a dip. Cells that stop moving are dropped from the
 *  active set, so a settled ocean costs nothing at all. */
export class WaterSimulator {
  /** Water within `NEAR_RADIUS` of the player. It gets first call on the budget and
   *  normally fits inside its share, so it runs every cell every step. */
  private readonly near = new CellSweep();
  /** The rest of the island, which comes round in a few steps rather than one. */
  private readonly far = new CellSweep();
  /** Columns that contain non-ocean water. They keep cycling even after the flowing
   *  cells go to sleep, which lets a drought dry a perfectly still pond. */
  private readonly evaporating = new CellSweep();
  /** Spring and pump blocks that produce or lift water every step. */
  private readonly springs = new Set<number>();
  private readonly pumps = new Set<number>();
  /** Net horizontal movement of the last step, used to push entities along. */
  private flow = new Map<number, FlowVector>();
  private timer = 0;
  /** Flipped every step so the sweep does not always favour the same direction. */
  private parity = 0;
  /** Water removed by sinks, for tests and debugging. */
  drained = 0;
  /** Water removed from exposed surfaces by drought, for tests and debugging. */
  evaporated = 0;
  /** How hard the springs are running, by column. A drought upstream reaches them the
   *  same way it reaches the river, so a reservoir fed by a spring fills slowly in a dry
   *  season and quickly in a wet one. */
  flowFactor: (x: number, z: number) => number = () => 1;
  /** 0 in normal/rain weather, 1 at the peak of a drought. */
  evaporationFactor: () => number = () => 0;

  constructor(private readonly world: World) {}

  /** Where the player is standing, or null while there is nobody in the world yet. */
  focus: { x: number; z: number } | null = null;

  get activeCount(): number {
    return this.near.size + this.far.size;
  }

  get springCount(): number {
    return this.springs.size;
  }

  /** Wakes a cell and the water around it. */
  activate(x: number, y: number, z: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const key = packCell(x, y, z);
    if (this.isNear(x, z)) this.near.add(key);
    else this.far.add(key);
  }

  private isNear(x: number, z: number): boolean {
    const focus = this.focus;
    if (!focus) return false;
    return Math.abs(x - focus.x) <= NEAR_RADIUS && Math.abs(z - focus.z) <= NEAR_RADIUS;
  }

  private activateAround(x: number, y: number, z: number): void {
    this.activate(x, y, z);
    this.activate(x, y - 1, z);
    this.activate(x, y + 1, z);
    for (const [dx, dz] of NEIGHBORS) this.activate(x + dx, y, z + dz);
  }

  /** Keeps machines and the surrounding water in sync with block edits. */
  onBlockChanged(x: number, y: number, z: number, previous: number, next: number): void {
    const key = packCell(x, y, z);
    if (previous === Block.SPRING) this.springs.delete(key);
    if (previous === Block.PUMP) this.pumps.delete(key);
    if (next === Block.SPRING) this.springs.add(key);
    if (next === Block.PUMP) this.pumps.add(key);
    // A removed roof may have exposed a previously protected reservoir.
    this.trackWaterColumn(x, z);
    this.activateAround(x, y, z);
  }

  /** Registers the machines of a freshly loaded chunk and wakes its water edges. */
  registerChunk(chunk: Chunk, springs: readonly { x: number; y: number; z: number }[]): void {
    for (const spring of springs) this.springs.add(packCell(spring.x, spring.y, spring.z));

    // Player-placed machines come back through the chunk's saved edits.
    const edits = this.world.edits.get(chunk.key);
    if (edits) {
      for (const [index, id] of edits) {
        if (id !== Block.SPRING && id !== Block.PUMP) continue;
        const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
        const rest = index % (CHUNK_SIZE * CHUNK_SIZE);
        const lz = Math.floor(rest / CHUNK_SIZE);
        const lx = rest % CHUNK_SIZE;
        const key = packCell(chunk.originX + lx, y, chunk.originZ + lz);
        if (id === Block.SPRING) this.springs.add(key);
        else this.pumps.add(key);
      }
    }

    // Register every non-ocean column that already contains water. This is a one-time
    // load cost and means settled ponds can evaporate without keeping their flow cells
    // artificially awake for the lifetime of the world.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (chunk.seaColumn[lz * CHUNK_SIZE + lx] === 1) continue;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (chunk.getWater(lx, y, lz) <= 0) continue;
          this.trackWaterColumn(chunk.originX + lx, chunk.originZ + lz);
          break;
        }
      }
    }

    // Wake the water along the seams so it can flow into the new chunk.
    this.wakeSeams(chunk);
  }

  /** Wakes every drop of river water in a chunk, which is how the generated rivers are
   *  handed over to the simulation at the start of a world. The sea is left alone: it is
   *  flat and already at rest, and waking a quarter of a million cells to prove it would
   *  cost far more than it is worth. */
  wakeRivers(chunk: Chunk): void {
    for (let y = SEA_LEVEL + 1; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.getWater(lx, y, lz) > 0) {
            this.activate(chunk.originX + lx, y, chunk.originZ + lz);
          }
        }
      }
    }
  }

  /** Wakes water along a chunk seam, but only where the two sides disagree. Waking
   *  every border cell of an ocean chunk would cost thousands of pointless steps. */
  private wakeSeams(chunk: Chunk): void {
    const seams: readonly (readonly [number, number])[] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dx, dz] of seams) {
      const neighbor = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!neighbor) continue;
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const x = chunk.originX + (dx === -1 ? 0 : dx === 1 ? CHUNK_SIZE - 1 : i);
        const z = chunk.originZ + (dz === -1 ? 0 : dz === 1 ? CHUNK_SIZE - 1 : i);
        const nx = x + dx;
        const nz = z + dz;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const mine = this.world.getWater(x, y, z);
          const theirs = this.world.getWater(nx, y, nz);
          if (Math.abs(mine - theirs) < 2) continue;
          if (mine > theirs) this.activate(x, y, z);
          else this.activate(nx, y, nz);
        }
      }
    }
  }

  /** Advances the simulation, running whole steps at a fixed rate. */
  update(dt: number): number {
    this.timer += dt;
    let ticks = 0;
    while (this.timer >= WATER_TICK_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
      this.timer -= WATER_TICK_SECONDS;
      this.step();
      ticks++;
    }
    if (this.timer > WATER_TICK_SECONDS * MAX_TICKS_PER_FRAME) this.timer = 0;
    return ticks;
  }

  /** One simulation step. The budget goes to the water round the player first, so
   *  anything they dig or break answers at once, and what is left carries the island's
   *  sweep forward from wherever it stopped. */
  step(): void {
    this.flow = new Map();
    this.parity ^= 1;
    this.runEvaporation();
    this.runSprings();
    this.runPumps();

    const run = (key: number) => this.simulateCell(key);
    // The player's own water first, capped so that standing in the middle of a lake
    // cannot stop the rest of the island; whatever it leaves carries the island round.
    const spent = this.near.run(Math.floor(MAX_CELLS_PER_TICK * NEAR_SHARE), run);
    this.far.run(MAX_CELLS_PER_TICK - spent, run);
  }

  private runSprings(): void {
    for (const key of this.springs) {
      const x = unpackX(key);
      const y = unpackY(key);
      const z = unpackZ(key);
      if (this.world.getBlock(x, y, z) !== Block.SPRING) {
        this.springs.delete(key);
        continue;
      }
      // A spring keeps its own pool topped up rather than pumping without limit, so a
      // river always flows but a blocked one never floods the valley.
      const level = this.world.getWater(x, y + 1, z);
      const rate = SPRING_RATE * this.flowFactor(x, z);
      if (level < WATER_FULL) this.give(x, y + 1, z, Math.min(rate, WATER_FULL - level));
    }
  }

  private runPumps(): void {
    for (const key of this.pumps) {
      const x = unpackX(key);
      const y = unpackY(key);
      const z = unpackZ(key);
      if (this.world.getBlock(x, y, z) !== Block.PUMP) {
        this.pumps.delete(key);
        continue;
      }
      // Lifts water from directly below to directly above, so a stack of pumps
      // raises water as high as the player cares to build.
      const source = this.world.getWater(x, y - 1, z);
      if (source <= 0) continue;
      if (this.targetOf(x, y + 1, z) !== 'open') continue;
      const room = WATER_FULL - this.world.getWater(x, y + 1, z);
      const amount = Math.min(source, PUMP_RATE, Math.max(0, room));
      if (amount <= 0) continue;
      this.setWater(x, y - 1, z, source - amount);
      this.give(x, y + 1, z, amount);
      this.activateAround(x, y - 1, z);
    }
  }

  /** Adds water to a cell, respecting sinks and walls. Returns what did not fit. */
  private give(x: number, y: number, z: number, amount: number): number {
    if (amount <= 0) return 0;
    const target = this.targetOf(x, y, z);
    if (target === 'blocked') return amount;
    if (target === 'sink') {
      this.drained += amount;
      return 0;
    }
    const level = this.world.getWater(x, y, z);
    const accepted = Math.min(amount, WATER_MAX - level);
    if (accepted <= 0) return amount;
    this.setWater(x, y, z, level + accepted);
    this.activateAround(x, y, z);
    return amount - accepted;
  }

  /** Removes water only from surfaces open to the sky. Oceans are deliberately absent
   *  from the queue: they represent a body far larger than the finite island. */
  private runEvaporation(): void {
    const strength = Math.max(0, Math.min(1, this.evaporationFactor()));
    if (strength <= 0) return;
    const amount = Math.max(1, Math.round(EVAPORATION_RATE * strength));
    this.evaporating.run(EVAPORATION_COLUMNS_PER_TICK, (key) => {
      const x = unpackX(key);
      const z = unpackZ(key);
      if (this.world.isSea(x, z)) return;

      // The first water cell seen from the sky is the exposed surface. A solid block
      // first means a roof, so reservoirs and caves do not mysteriously lose water.
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const level = this.world.getWater(x, y, z);
        if (level > 0) {
          const removed = Math.min(level, amount);
          const remaining = level - removed;
          this.setWater(x, y, z, remaining);
          this.evaporated += removed;
          this.activateAround(x, y, z);
          // setWater tracks a partially full surface. When a whole cell vanishes,
          // explicitly keep the column in the sweep if there is more water below it.
          if (remaining === 0 && y > 0 && this.world.getWater(x, y - 1, z) > 0) {
            this.trackWaterColumn(x, z);
          }
          return;
        }
        if (blocksWater(this.world.getBlock(x, y, z))) return;
      }
    });
  }

  private trackWaterColumn(x: number, z: number): void {
    if (!this.world.isSea(x, z)) this.evaporating.add(packCell(x, 0, z));
  }

  /** Keeps evaporation tracking in sync with every water write made by the simulator. */
  private setWater(x: number, y: number, z: number, level: number): void {
    this.world.setWater(x, y, z, level);
    if (level > 0) this.trackWaterColumn(x, z);
  }

  private targetOf(x: number, y: number, z: number): Target {
    if (y < 0) return 'sink';
    if (y >= CHUNK_HEIGHT) return 'blocked';
    // Past the edge of the island a river simply runs away, the way it would if the
    // map carried on. Below the water line the edge is a wall instead, or the sea
    // itself would pour out through it.
    if (!this.world.isLoadedAt(x, z)) return y > SEA_LEVEL ? 'sink' : 'blocked';
    const id = this.world.getBlock(x, y, z);
    if (isWaterSink(id)) return 'sink';
    return blocksWater(id) ? 'blocked' : 'open';
  }

  private simulateCell(key: number): void {
    const x = unpackX(key);
    const y = unpackY(key);
    const z = unpackZ(key);
    let remaining = this.world.getWater(x, y, z);
    if (remaining <= 0) return;
    // Whatever a river delivers to the ocean is gone. The real ocean is far bigger than
    // this island, so it neither rises nor gives anything back.
    if (y >= SEA_LEVEL && this.world.isSea(x, z)) {
      const keep = y > SEA_LEVEL ? 0 : WATER_FULL;
      if (remaining > keep) {
        this.drained += remaining - keep;
        remaining = keep;
        this.setWater(x, y, z, remaining);
        this.activateAround(x, y, z);
        if (remaining <= 0) return;
      }
    }
    // A block was placed into this cell: the water is gone with it.
    if (blocksWater(this.world.getBlock(x, y, z))) {
      this.setWater(x, y, z, 0);
      return;
    }

    const startLevel = remaining;
    let flowX = 0;
    let flowZ = 0;

    // 1. Fall. The lower cell may take a little more than full, which is the
    //    pressure that later pushes water back up.
    const below = this.targetOf(x, y - 1, z);
    if (below === 'sink') {
      this.drained += remaining;
      this.setWater(x, y, z, 0);
      this.activateAround(x, y, z);
      return;
    }
    if (below === 'open') {
      const belowLevel = this.world.getWater(x, y - 1, z);
      const room = WATER_FULL - belowLevel;
      // Water falls into whatever room is left below it. Once that cell is full, only
      // the surplus of an over-filled cell is squeezed further down: that surplus is
      // the pressure, and it is what later pushes water back up. Water that is merely
      // stacked stays where it is, so a settled sea never churns or sinks.
      const push =
        room > 0 ? Math.min(remaining, room) : Math.min(remaining - WATER_FULL, WATER_MAX - belowLevel);
      const amount = clampFlow(push, remaining);
      if (amount > 0) {
        this.setWater(x, y - 1, z, belowLevel + amount);
        remaining -= amount;
        this.activateAround(x, y - 1, z);
      }
    }

    // 2. Spread sideways. Every neighbour that holds less is brought up to the local
    //    average in one step. Handing over a quarter of the difference at a time would
    //    also settle flat, but it crawls: water would take a minute to run down a
    //    channel that it should cross in a second.
    if (remaining > 0) {
      let total = remaining;
      let count = 1;
      const receivers: { x: number; z: number; dx: number; dz: number; level: number }[] = [];
      for (let i = 0; i < NEIGHBORS.length; i++) {
        // Alternate the order so the sweep does not drift in one direction.
        const [dx, dz] = NEIGHBORS[(i + this.parity * 2) % NEIGHBORS.length];
        const nx = x + dx;
        const nz = z + dz;
        const target = this.targetOf(nx, y, nz);
        if (target === 'blocked') continue;
        if (target === 'sink') {
          const amount = Math.min(remaining, MAX_FLOW);
          this.drained += amount;
          remaining -= amount;
          flowX += dx * amount;
          flowZ += dz * amount;
          continue;
        }
        const level = this.world.getWater(nx, y, nz);
        if (level >= remaining) continue;
        total += level;
        count++;
        receivers.push({ x: nx, z: nz, dx, dz, level });
      }

      if (receivers.length > 0) {
        const average = Math.floor(total / count);
        for (const receiver of receivers) {
          if (remaining <= average) break;
          const want = Math.min(average - receiver.level, remaining - average);
          const amount = clampFlow(want, remaining);
          if (amount <= 0) continue;
          this.setWater(receiver.x, y, receiver.z, receiver.level + amount);
          remaining -= amount;
          flowX += receiver.dx * amount;
          flowZ += receiver.dz * amount;
          this.activateAround(receiver.x, y, receiver.z);
        }
      }
    }

    // 3. Rise. Only water under pressure goes up, which is what lets a channel climb
    //    the far side of a dip instead of stopping at the bottom.
    if (remaining > WATER_FULL && this.targetOf(x, y + 1, z) === 'open') {
      const aboveLevel = this.world.getWater(x, y + 1, z);
      const amount = clampFlow(Math.min(remaining - WATER_FULL, WATER_MAX - aboveLevel), remaining);
      if (amount > 0) {
        this.setWater(x, y + 1, z, aboveLevel + amount);
        remaining -= amount;
        this.activateAround(x, y + 1, z);
      }
    }

    if (remaining !== startLevel) {
      this.setWater(x, y, z, remaining);
      this.activateAround(x, y, z);
      if (flowX !== 0 || flowZ !== 0) {
        this.flow.set(key, { x: flowX / WATER_FULL, z: flowZ / WATER_FULL });
      }
    }
  }

  /** Direction and strength of the current in a cell, in blocks per step. */
  flowAt(x: number, y: number, z: number): FlowVector {
    return this.flow.get(packCell(x, y, z)) ?? NO_FLOW;
  }

  /** Pours water into the world, used by buckets and by tests. Returns the leftover. */
  pour(x: number, y: number, z: number, amount = WATER_FULL): number {
    return this.give(x, y, z, amount);
  }

  /** Total water in a column, in blocks. Used for depth checks. */
  depthAt(x: number, y: number, z: number, maxDepth = 8): number {
    let depth = 0;
    for (let i = 0; i < maxDepth; i++) {
      const level = this.world.getWater(x, y - i, z);
      if (level <= 0) break;
      depth += Math.min(1, level / WATER_FULL);
    }
    return depth;
  }
}

/** Flows are whole numbers so no water is ever lost to rounding. */
function clampFlow(amount: number, available: number): number {
  const value = Math.floor(Math.min(amount, MAX_FLOW, available));
  return value < WATER_EPSILON ? 0 : value;
}
