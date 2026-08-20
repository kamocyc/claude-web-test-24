import { blockDef, isOpaque, lightFilter } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, type Chunk, toChunkCoord } from './chunk';
import type { World } from './world';

const SKY = 0;
const BLOCK = 1;
type Channel = typeof SKY | typeof BLOCK;

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Flood-fill voxel lighting with two channels: skylight (fed from the sky, dimmed by
 *  the day/night cycle at render time) and block light (torches, lava...).
 *  Work is spread over frames through an explicit queue so a big change never stalls
 *  the render loop. */
export class LightEngine {
  /** Pending brightening: x, y, z, channel. */
  private add: number[] = [];
  private addHead = 0;
  /** Pending darkening: x, y, z, previousLevel, channel. */
  private remove: number[] = [];
  private removeHead = 0;

  constructor(private readonly world: World) {}

  get pending(): number {
    return (this.add.length - this.addHead) / 4 + (this.remove.length - this.removeHead) / 5;
  }

  /** Seeds skylight columns and torch light for a freshly generated chunk, and re-queues
   *  the borders of its neighbours so light can flow across the seam. */
  seedChunk(chunk: Chunk): void {
    const originX = chunk.originX;
    const originZ = chunk.originZ;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        let level = 15;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const id = chunk.get(lx, y, lz);
          if (isOpaque(id)) {
            level = 0;
          } else {
            const filter = lightFilter(id);
            // Sunlight travels straight down without losing strength, but a
            // translucent block such as water still dims it.
            if (filter > 1) level = Math.max(0, level - (filter - 1));
          }
          chunk.setSkyLight(lx, y, lz, level);
          if (level > 0) this.queueAdd(originX + lx, y, originZ + lz, SKY);

          const emission = blockDef(id).light;
          if (emission > 0) {
            chunk.setBlockLight(lx, y, lz, emission);
            this.queueAdd(originX + lx, y, originZ + lz, BLOCK);
          }
        }
      }
    }
    chunk.lit = true;
    this.queueChunkBorders(chunk.cx, chunk.cz);
  }

  /** Pushes the light values along the four seams so the flood fill can spread inwards. */
  private queueChunkBorders(cx: number, cz: number): void {
    const edges: [number, number][] = [];
    for (let i = 0; i < CHUNK_SIZE; i++) {
      edges.push([cx * CHUNK_SIZE + i, cz * CHUNK_SIZE - 1]);
      edges.push([cx * CHUNK_SIZE + i, cz * CHUNK_SIZE + CHUNK_SIZE]);
      edges.push([cx * CHUNK_SIZE - 1, cz * CHUNK_SIZE + i]);
      edges.push([cx * CHUNK_SIZE + CHUNK_SIZE, cz * CHUNK_SIZE + i]);
    }
    for (const [x, z] of edges) {
      if (!this.world.isLoadedAt(x, z)) continue;
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        if (this.world.getSkyLight(x, y, z) > 0) this.queueAdd(x, y, z, SKY);
        if (this.world.getBlockLight(x, y, z) > 0) this.queueAdd(x, y, z, BLOCK);
      }
    }
  }

  /** Called for every block change so light is kept consistent. */
  onBlockChanged(x: number, y: number, z: number, previous: number, next: number): void {
    const prevEmission = blockDef(previous).light;
    const nextEmission = blockDef(next).light;

    if (prevEmission > 0) {
      this.world.setBlockLight(x, y, z, 0);
      this.queueRemove(x, y, z, prevEmission, BLOCK);
    }

    const skyBefore = this.world.getSkyLight(x, y, z);
    if (isOpaque(next)) {
      if (skyBefore > 0) {
        this.world.setSkyLight(x, y, z, 0);
        this.queueRemove(x, y, z, skyBefore, SKY);
      }
      const blockBefore = this.world.getBlockLight(x, y, z);
      if (blockBefore > 0) {
        this.world.setBlockLight(x, y, z, 0);
        this.queueRemove(x, y, z, blockBefore, BLOCK);
      }
    } else {
      // Opening a hole: let every neighbour push its light back in.
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        if (this.world.getSkyLight(nx, ny, nz) > 0) this.queueAdd(nx, ny, nz, SKY);
        if (this.world.getBlockLight(nx, ny, nz) > 0) this.queueAdd(nx, ny, nz, BLOCK);
      }
      if (y === CHUNK_HEIGHT - 1) {
        this.world.setSkyLight(x, y, z, 15);
        this.queueAdd(x, y, z, SKY);
      }
    }

    if (nextEmission > 0) {
      this.world.setBlockLight(x, y, z, nextEmission);
      this.queueAdd(x, y, z, BLOCK);
    }
  }

  /** Processes queued light updates, stopping once the budget is used up. */
  update(budget = 40000): void {
    let work = 0;
    while (this.removeHead < this.remove.length && work < budget) {
      const x = this.remove[this.removeHead];
      const y = this.remove[this.removeHead + 1];
      const z = this.remove[this.removeHead + 2];
      const level = this.remove[this.removeHead + 3];
      const channel = this.remove[this.removeHead + 4] as Channel;
      this.removeHead += 5;
      work++;
      this.spreadRemoval(x, y, z, level, channel);
    }
    if (this.removeHead >= this.remove.length && this.remove.length > 0) {
      this.remove = [];
      this.removeHead = 0;
    }

    while (this.addHead < this.add.length && work < budget) {
      const x = this.add[this.addHead];
      const y = this.add[this.addHead + 1];
      const z = this.add[this.addHead + 2];
      const channel = this.add[this.addHead + 3] as Channel;
      this.addHead += 4;
      work++;
      this.spreadAddition(x, y, z, channel);
    }
    if (this.addHead >= this.add.length && this.add.length > 0) {
      this.add = [];
      this.addHead = 0;
    }
  }

  /** Runs the queue to completion. Used by tests and by the initial world load. */
  flush(maxIterations = 200): void {
    for (let i = 0; i < maxIterations && this.pending > 0; i++) this.update(1_000_000);
  }

  private spreadAddition(x: number, y: number, z: number, channel: Channel): void {
    const level = this.get(x, y, z, channel);
    if (level <= 0) return;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      if (!this.world.isLoadedAt(nx, nz)) continue;
      const id = this.world.getBlock(nx, ny, nz);
      if (isOpaque(id)) continue;
      const filter = lightFilter(id);
      // Sky light falls straight down at full strength.
      const target =
        channel === SKY && dy === -1 && level === 15 && filter <= 1 ? 15 : level - Math.max(1, filter);
      if (target <= 0) continue;
      if (this.get(nx, ny, nz, channel) >= target) continue;
      this.set(nx, ny, nz, channel, target);
      this.markDirty(nx, nz);
      this.queueAdd(nx, ny, nz, channel);
    }
  }

  private spreadRemoval(x: number, y: number, z: number, level: number, channel: Channel): void {
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      if (!this.world.isLoadedAt(nx, nz)) continue;
      const neighborLevel = this.get(nx, ny, nz, channel);
      if (neighborLevel === 0) continue;
      const fedFromHere = neighborLevel < level || (channel === SKY && dy === -1 && level === 15);
      if (fedFromHere) {
        this.set(nx, ny, nz, channel, 0);
        this.markDirty(nx, nz);
        this.queueRemove(nx, ny, nz, neighborLevel, channel);
      } else {
        // Independent source: it will re-light the hole we just made.
        this.queueAdd(nx, ny, nz, channel);
      }
    }
  }

  private get(x: number, y: number, z: number, channel: Channel): number {
    return channel === SKY ? this.world.getSkyLight(x, y, z) : this.world.getBlockLight(x, y, z);
  }

  private set(x: number, y: number, z: number, channel: Channel, value: number): void {
    if (channel === SKY) this.world.setSkyLight(x, y, z, value);
    else this.world.setBlockLight(x, y, z, value);
  }

  private markDirty(x: number, z: number): void {
    this.world.markDirty(toChunkCoord(x), toChunkCoord(z));
  }

  private queueAdd(x: number, y: number, z: number, channel: Channel): void {
    this.add.push(x, y, z, channel);
  }

  private queueRemove(x: number, y: number, z: number, level: number, channel: Channel): void {
    this.remove.push(x, y, z, level, channel);
  }
}
