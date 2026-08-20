import { Block, type BlockId } from './blocks';
import { WATER_MAX } from './water';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;
/** Y level of the ocean surface. */
export const SEA_LEVEL = 46;

/** The world is a fixed island rather than an endless one. Every chunk inside these
 *  bounds is generated once and never thrown away, because the water is simulated
 *  across all of it at once: an unloaded chunk is a wall, and a wall in the middle of a
 *  river would stop the water arriving from upstream. */
export const WORLD_RADIUS_CHUNKS = 12;
export const WORLD_CHUNK_COUNT = (WORLD_RADIUS_CHUNKS * 2) ** 2;
/** Lowest and highest block coordinate, on both horizontal axes. */
export const WORLD_MIN = -WORLD_RADIUS_CHUNKS * CHUNK_SIZE;
export const WORLD_MAX = WORLD_RADIUS_CHUNKS * CHUNK_SIZE - 1;

export function isInsideWorld(cx: number, cz: number): boolean {
  return (
    cx >= -WORLD_RADIUS_CHUNKS &&
    cx < WORLD_RADIUS_CHUNKS &&
    cz >= -WORLD_RADIUS_CHUNKS &&
    cz < WORLD_RADIUS_CHUNKS
  );
}

export function blockIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

/** Floor division that also works for negative coordinates. */
export function toChunkCoord(worldCoord: number): number {
  return Math.floor(worldCoord / CHUNK_SIZE);
}

/** Coordinate within a chunk, always 0..15 even for negative world coordinates. */
export function toLocalCoord(worldCoord: number): number {
  return ((worldCoord % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

export class Chunk {
  readonly blocks: Uint16Array;
  /** High nibble = skylight, low nibble = block light. */
  readonly light: Uint8Array;
  /** Fill level per voxel, 0 when dry. See water.ts for the scale. */
  readonly water: Uint8Array;
  /** Y of the highest non-air block in each column, -1 when the column is empty. */
  readonly heightMap: Int16Array;
  /** Per column, the height of the river's water in a normal season, 0 where there is
   *  no river. `RiverFlow` moves the water between here and whatever the season calls
   *  for without having to run terrain generation again. */
  riverSurface: Float32Array;
  /** Set while the mesh no longer matches the block data. */
  dirty = true;
  /** Set when only the water levels changed, which needs a much cheaper rebuild. */
  waterDirty = false;
  /** Terrain generation finished. */
  generated = false;
  /** Initial light seeding finished. */
  lit = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
    blocks?: Uint16Array,
    water?: Uint8Array,
  ) {
    this.blocks = blocks ?? new Uint16Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.water = water ?? new Uint8Array(CHUNK_VOLUME);
    this.heightMap = new Int16Array(CHUNK_AREA).fill(-1);
    this.riverSurface = new Float32Array(CHUNK_AREA);
  }

  get key(): string {
    return chunkKey(this.cx, this.cz);
  }

  /** World-space X of local x = 0. */
  get originX(): number {
    return this.cx * CHUNK_SIZE;
  }

  get originZ(): number {
    return this.cz * CHUNK_SIZE;
  }

  get(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return Block.AIR;
    return this.blocks[blockIndex(x, y, z)];
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[blockIndex(x, y, z)] = id;
  }

  getWater(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.water[blockIndex(x, y, z)];
  }

  setWater(x: number, y: number, z: number, level: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.water[blockIndex(x, y, z)] = Math.max(0, Math.min(WATER_MAX, Math.round(level)));
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= CHUNK_HEIGHT) return 15;
    return this.light[blockIndex(x, y, z)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.light[blockIndex(x, y, z)] & 0xf;
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const i = blockIndex(x, y, z);
    this.light[i] = (this.light[i] & 0x0f) | (value << 4);
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const i = blockIndex(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | value;
  }

  /** Restores the "water level > 0 means a WATER block" invariant after the water
   *  array is replaced wholesale, such as when a save is loaded. */
  syncWaterMarkers(): void {
    for (let i = 0; i < this.water.length; i++) {
      const level = this.water[i];
      if (level > 0 && this.blocks[i] === Block.AIR) this.blocks[i] = Block.WATER;
      else if (level === 0 && this.blocks[i] === Block.WATER) this.blocks[i] = Block.AIR;
      else if (level > 0 && this.blocks[i] !== Block.WATER) this.water[i] = 0;
    }
  }

  /** Recomputes the per-column height map from the block data. */
  recomputeHeightMap(): void {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let top = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (this.blocks[blockIndex(x, y, z)] !== Block.AIR) {
            top = y;
            break;
          }
        }
        this.heightMap[z * CHUNK_SIZE + x] = top;
      }
    }
  }

  heightAt(x: number, z: number): number {
    return this.heightMap[z * CHUNK_SIZE + x];
  }

  updateHeightAfterChange(x: number, y: number, z: number, id: BlockId): void {
    const i = z * CHUNK_SIZE + x;
    if (id !== Block.AIR) {
      if (y > this.heightMap[i]) this.heightMap[i] = y;
    } else if (y === this.heightMap[i]) {
      let top = -1;
      for (let yy = y - 1; yy >= 0; yy--) {
        if (this.blocks[blockIndex(x, yy, z)] !== Block.AIR) {
          top = yy;
          break;
        }
      }
      this.heightMap[i] = top;
    }
  }
}
