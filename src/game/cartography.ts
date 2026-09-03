/** The map's memory.
 *
 *  A chunk exists only while the player is standing near it: walk a few hundred blocks
 *  and everything behind is thrown away, because keeping the whole world in memory is the
 *  one thing a voxel game cannot do. That is fine for the world — it is regenerated from
 *  the seed on the way back — and wrong for a map, which was answering "what is over
 *  there?" with a black square for places the player had already walked through.
 *
 *  So the surface is written down as it goes past: one byte of height, the block on top
 *  and how much water is in it, per column, kept for every chunk that has been loaded and
 *  saved with the world. It is a survey, not a copy — nothing under the top face is in
 *  here, which is what makes it small enough to keep for thousands of chunks.
 *
 *  What has never been loaded is not in it, and the map draws nothing there. That is the
 *  point: the map shows where the player has been, and stays honest about the rest. */

import type { BlockId } from '../world/blocks';
import { CHUNK_AREA, CHUNK_SIZE, type Chunk, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';
import { base64ToBytes, bytesToBase64, decodeRuns, encodeRuns } from './save';
import type { World } from '../world/world';
import type { TreeMapSample } from '../world/trees';
import type { ChunkSurvey } from '../world/generation/terrain';

export interface TreeMapSurface {
  canopyAt(x: number, z: number): TreeMapSample | null;
}

/** What a map needs to know about a column, from wherever it is still known. Whole block
 *  coordinates, as with every other accessor that reaches into the block grid.
 *
 *  Three calls rather than one sample object because the map asks this of every pixel it
 *  paints — a quarter of a million of them on a full pass of the big map — and an object
 *  per pixel would be a quarter of a million pieces of garbage per pass. */
export interface MapSurface {
  /** Y of the top block of a column, or -1 where the player has never seen it. */
  heightAt(x: number, z: number): number;
  /** The block on top, for a column whose `top` the caller has just read. */
  blockAt(x: number, top: number, z: number): BlockId;
  /** Fill level of that same cell, 0 when dry. */
  waterAt(x: number, top: number, z: number): number;
}

/** One chunk's worth of surveyed surface, and the string it was last written as. */
interface Tile {
  /** Top of each column plus one, so 0 can mean "empty column" in a byte. */
  height: Uint8Array;
  block: Uint16Array;
  water: Uint8Array;
  /** The encoded form, kept until the tile is surveyed again. A save re-encodes only
   *  the chunks that have been near the player since the last one. */
  encoded: string | null;
  /** Taken off the generator by the debug reveal rather than walked past. Kept out
   *  of the save: the map remembers where the player has been, and a region somebody
   *  looked at in the console is not that — nor is it worth the megabytes. */
  revealed?: true;
}

function localIndex(x: number, z: number): number {
  return toLocalCoord(z) * CHUNK_SIZE + toLocalCoord(x);
}

export class MapMemory implements MapSurface {
  private readonly tiles = new Map<string, Tile>();

  /** How many chunks have been surveyed. */
  get size(): number {
    return this.tiles.size;
  }

  /** Drops everything the debug reveal put on the map, leaving what was walked. */
  forgetRevealed(): number {
    let dropped = 0;
    for (const [key, tile] of [...this.tiles]) {
      if (!tile.revealed) continue;
      this.tiles.delete(key);
      dropped++;
    }
    return dropped;
  }

  /** Whether a chunk has ever been walked past. */
  has(cx: number, cz: number): boolean {
    return this.tiles.has(chunkKey(cx, cz));
  }

  /** Writes down the top face of every column of a chunk, replacing whatever was there
   *  before: the ground the player has just changed is the ground the map should show. */
  record(chunk: Chunk, trees?: TreeMapSurface): void {
    let tile = this.tiles.get(chunk.key);
    if (!tile) {
      tile = {
        height: new Uint8Array(CHUNK_AREA),
        block: new Uint16Array(CHUNK_AREA),
        water: new Uint8Array(CHUNK_AREA),
        encoded: null,
      };
      this.tiles.set(chunk.key, tile);
    }
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = z * CHUNK_SIZE + x;
        const ground = chunk.heightAt(x, z);
        const canopy = trees?.canopyAt(chunk.originX + x, chunk.originZ + z) ?? null;
        const top = canopy && canopy.height > ground ? canopy.height : ground;
        tile.height[i] = top < 0 ? 0 : Math.min(255, top + 1);
        tile.block[i] = top < 0 ? 0 : canopy && canopy.height === top ? canopy.block : chunk.get(x, ground, z);
        tile.water[i] = top < 0 || (canopy && canopy.height === top) ? 0 : chunk.getWater(x, ground, z);
      }
    }
    tile.encoded = null;
  }

  /**
   * Writes down a survey taken from somewhere other than a loaded chunk.
   *
   * The map is a record of where the player has been, and this is the one thing
   * that puts something on it they have not walked past — a debug view of a
   * whole region, taken straight off the generator. It overwrites, like
   * `record`, so walking through afterwards replaces the survey with the ground
   * as it actually turned out, and is not saved with the world.
   */
  recordSurvey(cx: number, cz: number, survey: ChunkSurvey): void {
    const tile: Tile = {
      height: new Uint8Array(CHUNK_AREA),
      block: new Uint16Array(CHUNK_AREA),
      water: new Uint8Array(CHUNK_AREA),
      encoded: null,
      revealed: true,
    };
    for (let i = 0; i < CHUNK_AREA; i++) {
      const top = survey.height[i];
      tile.height[i] = top < 0 ? 0 : Math.min(255, top + 1);
      tile.block[i] = top < 0 ? 0 : survey.block[i];
      tile.water[i] = top < 0 ? 0 : survey.water[i];
    }
    this.tiles.set(chunkKey(cx, cz), tile);
  }

  heightAt(x: number, z: number): number {
    const tile = this.tiles.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!tile) return -1;
    return tile.height[localIndex(x, z)] - 1;
  }

  blockAt(x: number, _top: number, z: number): BlockId {
    const tile = this.tiles.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    return tile ? tile.block[localIndex(x, z)] : 0;
  }

  waterAt(x: number, _top: number, z: number): number {
    const tile = this.tiles.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    return tile ? tile.water[localIndex(x, z)] : 0;
  }

  /** Chunk key -> the tile, packed as four planes (see `pack`), which comes to around
   *  670 bytes a chunk of the terrain the generator actually makes. */
  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, tile] of this.tiles) {
      if (tile.revealed) continue;
      if (tile.encoded === null) tile.encoded = encodeTile(tile);
      out[key] = tile.encoded;
    }
    return out;
  }

  /** Replaces the survey with a saved one. A tile that will not decode is dropped rather
   *  than allowed to throw: a corrupt map is a map with a hole in it, not a lost world. */
  load(saved: Record<string, string> | undefined): void {
    this.tiles.clear();
    if (!saved) return;
    for (const [key, text] of Object.entries(saved)) {
      const tile = decodeTile(text);
      if (tile) this.tiles.set(key, tile);
    }
  }
}

/** The map's view of the world: whatever is loaded, and the survey everywhere else.
 *
 *  Loaded first, always. A chunk in memory is the ground as it is right now — the road
 *  that has just been laid across it included — and the survey is only as new as the last
 *  time the player was there. */
export class SurveyedTerrain implements MapSurface {
  constructor(
    private readonly world: World,
    private readonly memory: MapMemory,
    private readonly trees?: TreeMapSurface,
  ) {}

  /** The chunk itself rather than `world.isLoadedAt` and then a world accessor: both of
   *  those look the chunk up by a key they build a string for, and the big map asks these
   *  three questions of a quarter of a million pixels. */
  private chunkAt(x: number, z: number): Chunk | undefined {
    return this.world.getChunk(toChunkCoord(x), toChunkCoord(z));
  }

  heightAt(x: number, z: number): number {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return this.memory.heightAt(x, z);
    const ground = chunk.heightAt(toLocalCoord(x), toLocalCoord(z));
    const canopy = this.trees?.canopyAt(x, z);
    return canopy && canopy.height > ground ? canopy.height : ground;
  }

  blockAt(x: number, top: number, z: number): BlockId {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return this.memory.blockAt(x, top, z);
    const canopy = this.trees?.canopyAt(x, z);
    return canopy && canopy.height === top
      ? canopy.block
      : chunk.get(toLocalCoord(x), top, toLocalCoord(z));
  }

  waterAt(x: number, top: number, z: number): number {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return this.memory.waterAt(x, top, z);
    const canopy = this.trees?.canopyAt(x, z);
    return canopy && canopy.height === top ? 0 : chunk.getWater(toLocalCoord(x), top, toLocalCoord(z));
  }
}

/** The four planes, each packed on its own and joined. Base64 never contains a dot, so
 *  it is the one character that can separate them without escaping. */
function encodeTile(tile: Tile): string {
  const low = new Uint8Array(CHUNK_AREA);
  const high = new Uint8Array(CHUNK_AREA);
  for (let i = 0; i < CHUNK_AREA; i++) {
    low[i] = tile.block[i] & 0xff;
    high[i] = tile.block[i] >> 8;
  }
  return [pack(tile.height), pack(low), pack(high), pack(tile.water)].join('.');
}

/** Whichever of the two is shorter, with a letter in front saying which.
 *
 *  Which one wins is not the same for every plane, and not knowable in advance. Water
 *  levels are nearly all one value and collapse to a handful of bytes. Surface blocks are
 *  grass with a tree in it, which still halves. Heights are a hillside, where every other
 *  column is a run of one and the run lengths cost more than the heights they describe —
 *  there the plain bytes win. Measured over the terrain the generator actually makes, a
 *  surveyed chunk comes to around 670 bytes; taking runs for all four would cost 30 more,
 *  and plain bytes for all four, 700 more. */
function pack(bytes: Uint8Array): string {
  const runs = encodeRuns(bytes);
  const raw = bytesToBase64(bytes);
  return runs.length <= raw.length ? `r${runs}` : `b${raw}`;
}

function unpack(text: string, length: number): Uint8Array {
  if (text[0] === 'r') return decodeRuns(text.slice(1), length);
  if (text[0] !== 'b') throw new Error('unknown plane');
  const bytes = base64ToBytes(text.slice(1));
  if (bytes.length !== length) throw new Error('short plane');
  return bytes;
}

function decodeTile(text: string): Tile | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  try {
    const height = unpack(parts[0], CHUNK_AREA);
    const low = unpack(parts[1], CHUNK_AREA);
    const high = unpack(parts[2], CHUNK_AREA);
    const water = unpack(parts[3], CHUNK_AREA);
    const block = new Uint16Array(CHUNK_AREA);
    for (let i = 0; i < CHUNK_AREA; i++) block[i] = (high[i] << 8) | low[i];
    return { height, block, water, encoded: text };
  } catch {
    return null;
  }
}
