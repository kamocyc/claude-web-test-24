import { Block, blocksWater, isWaterSink } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, type Chunk } from './chunk';
import { WATER_EPSILON, WATER_FULL, WATER_MAX, WATER_MIN } from './water';
import type { World } from './world';

/** Seconds between simulation steps. */
export const WATER_TICK_SECONDS = 0.1;
/** Cells processed per step; anything over this is carried to the next step. */
const MAX_CELLS_PER_TICK = 20000;
/** Steps allowed in a single frame, so a slow frame cannot spiral. */
const MAX_TICKS_PER_FRAME = 2;
/** Water further than this from the player is left alone until they come back. */
const SIMULATION_RADIUS = 96;
/** Most a single cell can give away per step. */
const MAX_FLOW = WATER_FULL;
/** Water added by a spring each step. */
export const SPRING_RATE = 24;
/** Water a pump lifts each step. */
export const PUMP_RATE = 70;

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

/** Cellular water: every voxel holds a fill level, water falls, spreads sideways to
 *  level out, and a cell may hold a little more than full so pressure can push water
 *  back up on the far side of a dip. Cells that stop moving are dropped from the
 *  active set, so a settled ocean costs nothing at all. */
export class WaterSimulator {
  /** Cells to visit on the next step. */
  private active = new Set<number>();
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
  /** Centre of the simulated area; cells beyond the radius are left frozen. */
  private centerX = 0;
  private centerZ = 0;
  private limited = false;

  constructor(private readonly world: World) {}

  /** Restricts the simulation to the area around the player. Without a centre the
   *  whole loaded world is simulated, which is what the tests want. */
  setCenter(x: number, z: number): void {
    this.centerX = x;
    this.centerZ = z;
    this.limited = true;
  }

  private inRange(x: number, z: number): boolean {
    if (!this.limited) return true;
    const dx = x - this.centerX;
    const dz = z - this.centerZ;
    return dx * dx + dz * dz <= SIMULATION_RADIUS * SIMULATION_RADIUS;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get springCount(): number {
    return this.springs.size;
  }

  /** Wakes a cell and the water around it. */
  activate(x: number, y: number, z: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.active.add(packCell(x, y, z));
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

    // Wake the water along the seams so it can spill into the new chunk.
    this.wakeSeams(chunk);
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

  /** One simulation step. */
  step(): void {
    this.flow = new Map();
    this.parity ^= 1;
    this.runSprings();
    this.runPumps();

    const cells = [...this.active];
    this.active.clear();
    let processed = 0;
    for (const key of cells) {
      if (processed >= MAX_CELLS_PER_TICK) {
        // Out of budget: keep the rest for the next step rather than dropping them.
        this.active.add(key);
        continue;
      }
      const x = unpackX(key);
      const z = unpackZ(key);
      // Far away water is simply parked: it wakes again when the player returns.
      if (!this.inRange(x, z)) continue;
      processed++;
      this.simulateCell(key);
    }
  }

  private runSprings(): void {
    for (const key of this.springs) {
      const x = unpackX(key);
      const y = unpackY(key);
      const z = unpackZ(key);
      if (!this.inRange(x, z)) continue;
      if (this.world.getBlock(x, y, z) !== Block.SPRING) {
        this.springs.delete(key);
        continue;
      }
      // A spring keeps its own pool topped up rather than pumping without limit, so a
      // river always flows but a blocked one never floods the valley.
      const level = this.world.getWater(x, y + 1, z);
      if (level < WATER_FULL) this.give(x, y + 1, z, Math.min(SPRING_RATE, WATER_FULL - level));
    }
  }

  private runPumps(): void {
    for (const key of this.pumps) {
      const x = unpackX(key);
      const y = unpackY(key);
      const z = unpackZ(key);
      if (!this.inRange(x, z)) continue;
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
      this.world.setWater(x, y - 1, z, source - amount);
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
    this.world.setWater(x, y, z, level + accepted);
    this.activateAround(x, y, z);
    return amount - accepted;
  }

  private targetOf(x: number, y: number, z: number): Target {
    if (y < 0) return 'sink';
    if (y >= CHUNK_HEIGHT) return 'blocked';
    // Chunks that are not loaded act as a wall, never as a drain: the loaded area
    // moves with the player, and draining at its edge would empty the ocean.
    if (!this.world.isLoadedAt(x, z)) return 'blocked';
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
    // A block was placed into this cell: the water is gone with it.
    if (blocksWater(this.world.getBlock(x, y, z))) {
      this.world.setWater(x, y, z, 0);
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
      this.world.setWater(x, y, z, 0);
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
        this.world.setWater(x, y - 1, z, belowLevel + amount);
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
          this.world.setWater(receiver.x, y, receiver.z, receiver.level + amount);
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
        this.world.setWater(x, y + 1, z, aboveLevel + amount);
        remaining -= amount;
        this.activateAround(x, y + 1, z);
      }
    }

    if (remaining !== startLevel) {
      this.world.setWater(x, y, z, remaining);
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

/** True when a cell holds enough water to swim in or to irrigate from. */
export function isWet(level: number): boolean {
  return level >= WATER_MIN;
}
