import { Block, type BlockId, blockDef } from './blocks';
import { WATER_FULL, WATER_MAX } from './water';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  Chunk,
  chunkKey,
  toChunkCoord,
  toLocalCoord,
} from './chunk';

/** Extra state attached to a specific block position (chest contents, furnace progress...). */
export interface BlockEntity {
  type: string;
}

export type BlockChangeListener = (
  x: number,
  y: number,
  z: number,
  previous: BlockId,
  next: BlockId,
) => void;

export interface SetBlockOptions {
  /** Record the change so it survives a save/reload. Generation passes false. */
  record?: boolean;
  /** Skip notifying listeners (used for bulk edits that re-light afterwards). */
  silent?: boolean;
}

/** Holds every loaded chunk and provides coordinate-space-agnostic accessors.
 *  Deliberately free of any three.js dependency. */
export class World {
  readonly chunks = new Map<string, Chunk>();
  /** Player edits, per chunk: block index -> block id. This is all that gets saved. */
  readonly edits = new Map<string, Map<number, BlockId>>();
  readonly blockEntities = new Map<string, BlockEntity>();
  /** Water of chunks the player has changed, kept while they are unloaded. */
  readonly waterSnapshots = new Map<string, Uint8Array>();
  private readonly listeners: BlockChangeListener[] = [];
  /** Chunks whose mesh must be rebuilt. */
  readonly dirtyChunks = new Set<string>();
  /** Chunks where only the water changed. */
  readonly dirtyWaterChunks = new Set<string>();

  constructor(public readonly seed: number) {}

  onBlockChange(listener: BlockChangeListener): void {
    this.listeners.push(listener);
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunk.key, chunk);
    this.applyEditsTo(chunk);
    const snapshot = this.waterSnapshots.get(chunk.key);
    if (snapshot && snapshot.length === chunk.water.length) {
      chunk.water.set(snapshot);
      chunk.syncWaterMarkers();
    }
    chunk.recomputeHeightMap();
    this.markDirty(chunk.cx, chunk.cz);
    for (const [dx, dz] of NEIGHBOR_OFFSETS) this.markDirty(chunk.cx + dx, chunk.cz + dz);
  }

  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    // Water the player made is not reproducible from the seed, so keep it around.
    if (chunk && this.edits.has(key)) this.waterSnapshots.set(key, chunk.water.slice());
    this.chunks.delete(key);
    this.dirtyWaterChunks.delete(key);
  }

  /** Current water of a chunk, whether it is loaded or only kept as a snapshot. */
  waterOf(key: string): Uint8Array | undefined {
    return this.chunks.get(key)?.water ?? this.waterSnapshots.get(key);
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  isLoadedAt(x: number, z: number): boolean {
    return this.hasChunk(toChunkCoord(x), toChunkCoord(z));
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return Block.AIR;
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return Block.AIR;
    return chunk.get(toLocalCoord(x), y, toLocalCoord(z));
  }

  /** Treats not-yet-loaded chunks as solid so entities never fall through the world. */
  isSolidAt(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= CHUNK_HEIGHT) return false;
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return true;
    return blockDef(chunk.get(toLocalCoord(x), y, toLocalCoord(z))).solid;
  }

  setBlock(x: number, y: number, z: number, id: BlockId, options: SetBlockOptions = {}): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;
    const lx = toLocalCoord(x);
    const lz = toLocalCoord(z);
    const previous = chunk.get(lx, y, lz);
    if (previous === id) return false;

    chunk.set(lx, y, lz, id);
    chunk.updateHeightAfterChange(lx, y, lz, id);
    // Placing anything solid displaces the water that was in the cell; placing water
    // (from a bucket, or during generation) fills it.
    chunk.setWater(lx, y, lz, id === Block.WATER ? WATER_FULL : 0);

    if (options.record !== false) {
      let edits = this.edits.get(chunk.key);
      if (!edits) {
        edits = new Map();
        this.edits.set(chunk.key, edits);
      }
      edits.set((y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx, id);
    }

    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);

    if (!options.silent) {
      for (const listener of this.listeners) listener(x, y, z, previous, id);
    }
    return true;
  }

  markDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.dirty = true;
    this.dirtyChunks.add(key);
  }

  /** True where the ground is below sea level, so the ocean stands over it. Water that
   *  reaches the sea is gone: the real ocean is far bigger than this map. */
  isSea(x: number, z: number): boolean {
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return false;
    return chunk.seaColumn[toLocalCoord(z) * CHUNK_SIZE + toLocalCoord(x)] === 1;
  }

  /** Fill level of a cell, 0 when dry or out of the loaded world. */
  getWater(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return 0;
    return chunk.getWater(toLocalCoord(x), y, toLocalCoord(z));
  }

  /** Writes a fill level and keeps the WATER block marker in sync with it. */
  setWater(x: number, y: number, z: number, level: number): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;
    const lx = toLocalCoord(x);
    const lz = toLocalCoord(z);
    const clamped = Math.max(0, Math.min(WATER_MAX, Math.round(level)));
    if (chunk.getWater(lx, y, lz) === clamped) return false;
    chunk.setWater(lx, y, lz, clamped);

    // The block id stays the marker for "there is water here", so every existing
    // check (rendering pass, replaceable, light filter, swimming) keeps working.
    const current = chunk.get(lx, y, lz);
    if (clamped > 0 && current === Block.AIR) chunk.set(lx, y, lz, Block.WATER);
    else if (clamped === 0 && current === Block.WATER) chunk.set(lx, y, lz, Block.AIR);

    this.markWaterDirty(cx, cz);
    if (lx === 0) this.markWaterDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markWaterDirty(cx + 1, cz);
    if (lz === 0) this.markWaterDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markWaterDirty(cx, cz + 1);
    return true;
  }

  /** Queues a water-only mesh rebuild, which is far cheaper than a full remesh. */
  markWaterDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.waterDirty = true;
    this.dirtyWaterChunks.add(key);
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= CHUNK_HEIGHT) return 15;
    if (y < 0) return 0;
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return 15;
    return chunk.getSkyLight(toLocalCoord(x), y, toLocalCoord(z));
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return 0;
    return chunk.getBlockLight(toLocalCoord(x), y, toLocalCoord(z));
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    chunk?.setSkyLight(toLocalCoord(x), y, toLocalCoord(z), value);
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    chunk?.setBlockLight(toLocalCoord(x), y, toLocalCoord(z), value);
  }

  /** Highest non-air block in a column, or -1 when unknown/empty. */
  heightAt(x: number, z: number): number {
    const chunk = this.getChunk(toChunkCoord(x), toChunkCoord(z));
    if (!chunk) return -1;
    return chunk.heightAt(toLocalCoord(x), toLocalCoord(z));
  }

  /** First free Y above the terrain where a 2-block-tall entity fits. */
  surfaceY(x: number, z: number): number {
    const top = this.heightAt(x, z);
    if (top < 0) return CHUNK_HEIGHT / 2;
    return top + 1;
  }

  blockEntityKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getBlockEntity<T extends BlockEntity>(x: number, y: number, z: number): T | undefined {
    return this.blockEntities.get(this.blockEntityKey(x, y, z)) as T | undefined;
  }

  setBlockEntity(x: number, y: number, z: number, entity: BlockEntity): void {
    this.blockEntities.set(this.blockEntityKey(x, y, z), entity);
  }

  removeBlockEntity(x: number, y: number, z: number): void {
    this.blockEntities.delete(this.blockEntityKey(x, y, z));
  }

  private applyEditsTo(chunk: Chunk): void {
    const edits = this.edits.get(chunk.key);
    if (!edits) return;
    for (const [index, id] of edits) {
      chunk.blocks[index] = id;
      // Keep the water array consistent; a saved water snapshot overwrites this after.
      chunk.water[index] = id === Block.WATER ? WATER_FULL : 0;
    }
  }
}

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];
