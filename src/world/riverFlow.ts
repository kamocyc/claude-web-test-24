import { Block } from './blocks';
import { CHUNK_SIZE, type Chunk } from './chunk';
import { riverCellLevel } from './generation/terrain';
import { inlandOfSurface, levelOffset, seasonalSurface } from './generation/rivers';
import { WATER_FULL } from './water';
import { localWetness } from './weather';
import type { World } from './world';

/** Generated rivers are deliberately kept out of the water simulation: a channel that
 *  slopes towards the sea is not something a fluid solver leaves alone, and letting it
 *  try flattens the river into one pond that creeps up its banks. So the seasons move
 *  the water themselves, by rewriting the levels the generator would have written had it
 *  run today.
 *
 *  The one thing this must never do is undo the player's work. Before a column is
 *  touched it is checked against exactly what was last written into it: a column that
 *  has been dug out, dammed, bridged or stirred by the simulator no longer matches and
 *  is left alone. */

/** Level change worth a rewrite and the water-only remesh that follows it. Below this
 *  the surface moves by less than a tenth of a block, which nobody can see. */
const LEVEL_QUANTUM = 10 / WATER_FULL;
/** Chunks retargeted per sweep, so a season costs a little every frame rather than one
 *  long stall when it turns. */
const CHUNKS_PER_SWEEP = 6;
/** Seconds between sweeps. The level moves slowly enough that this is plenty. */
const SWEEP_INTERVAL = 0.5;
/** How far above the bed the water is allowed to look for a ceiling. */
const MAX_DEPTH = 24;

interface Tracked {
  /** Clock the chunk's river water was last written for. */
  appliedAt: number;
  /** How far inland the chunk is, which decides how late the weather arrives here. */
  inland: number;
}

export class RiverFlow {
  /** Only chunks that actually contain a river are tracked. */
  private readonly tracked = new Map<string, Tracked>();
  private timer = 0;
  private cursor = 0;
  /** World clock, in seconds. The game owns it; this follows. */
  seconds = 0;
  /** Columns rewritten so far, for tests and debugging. */
  rewritten = 0;

  constructor(private readonly world: World) {}

  /** Takes on a freshly generated chunk. `weatherSeconds` is the clock its water was
   *  filled for, which the worker sends back along with it. */
  registerChunk(chunk: Chunk, weatherSeconds: number): void {
    let total = 0;
    let count = 0;
    for (const surface of chunk.riverSurface) {
      if (surface <= 0) continue;
      total += inlandOfSurface(surface);
      count++;
    }
    if (count === 0) return;
    this.tracked.set(chunk.key, { appliedAt: weatherSeconds, inland: total / count });
  }

  forgetChunk(key: string): void {
    this.tracked.delete(key);
  }

  get trackedCount(): number {
    return this.tracked.size;
  }

  /** Moves a slice of the loaded rivers towards the level this season calls for. */
  update(dt: number): void {
    this.timer += dt;
    if (this.timer < SWEEP_INTERVAL) return;
    this.timer = 0;
    this.sweep();
  }

  /** Brings every loaded river up to date at once, for a jump in the clock. */
  sweepAll(): void {
    for (const key of [...this.tracked.keys()]) this.retargetKey(key);
  }

  private sweep(): void {
    const keys = [...this.tracked.keys()];
    if (keys.length === 0) return;
    let done = 0;
    let scanned = 0;
    while (scanned < keys.length && done < CHUNKS_PER_SWEEP) {
      const key = keys[(this.cursor + scanned) % keys.length];
      scanned++;
      if (!this.needsWork(key)) continue;
      this.retargetKey(key);
      done++;
    }
    this.cursor = (this.cursor + scanned) % keys.length;
  }

  private needsWork(key: string): boolean {
    const entry = this.tracked.get(key);
    if (!entry) return false;
    const now = levelOffset(localWetness(this.world.seed, this.seconds, entry.inland));
    const applied = levelOffset(localWetness(this.world.seed, entry.appliedAt, entry.inland));
    return Math.abs(now - applied) >= LEVEL_QUANTUM;
  }

  private retargetKey(key: string): void {
    const entry = this.tracked.get(key);
    const chunk = this.world.chunks.get(key);
    if (!entry || !chunk) return;
    this.retarget(chunk, entry.appliedAt);
    entry.appliedAt = this.seconds;
  }

  private retarget(chunk: Chunk, appliedAt: number): void {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const base = chunk.riverSurface[lz * CHUNK_SIZE + lx];
        if (base <= 0) continue;
        const inland = inlandOfSurface(base);
        const was = seasonalSurface(base, localWetness(this.world.seed, appliedAt, inland));
        const now = seasonalSurface(base, localWetness(this.world.seed, this.seconds, inland));
        if (was === now) continue;
        const highest = Math.floor(Math.max(was, now));
        const ground = groundBelow(chunk, lx, lz, highest);
        if (ground < 0) continue;
        // A bridge or a lid caps how high the water may go, and stops the check there.
        const ceiling = ceilingAbove(chunk, lx, lz, ground, highest);
        if (!matches(chunk, lx, lz, was, ground, ceiling)) continue;
        const x = chunk.originX + lx;
        const z = chunk.originZ + lz;
        for (let y = ground + 1; y <= ceiling; y++) {
          this.world.setWater(x, y, z, riverCellLevel(now, ground, y));
        }
        this.rewritten++;
      }
    }
  }
}

/** Top of the river bed under a column: the first cell going down that is neither air
 *  nor water. */
function groundBelow(chunk: Chunk, lx: number, lz: number, from: number): number {
  for (let y = from; y > from - MAX_DEPTH && y > 0; y--) {
    const id = chunk.get(lx, y, lz);
    if (id === Block.AIR || id === Block.WATER) continue;
    return y;
  }
  return -1;
}

/** Highest cell the water may occupy: everything up to whatever is built over it. */
function ceilingAbove(chunk: Chunk, lx: number, lz: number, ground: number, upTo: number): number {
  for (let y = ground + 1; y <= upTo; y++) {
    const id = chunk.get(lx, y, lz);
    if (id !== Block.AIR && id !== Block.WATER) return y - 1;
  }
  return upTo;
}

/** True when a column holds exactly the water that was last written into it. Anything
 *  else means the player, or the simulator working on their behalf, has been here. */
function matches(
  chunk: Chunk,
  lx: number,
  lz: number,
  surface: number,
  ground: number,
  ceiling: number,
): boolean {
  for (let y = ground + 1; y <= ceiling; y++) {
    const id = chunk.get(lx, y, lz);
    const level = id === Block.WATER ? chunk.getWater(lx, y, lz) : 0;
    if (level !== riverCellLevel(surface, ground, y)) return false;
  }
  return true;
}
