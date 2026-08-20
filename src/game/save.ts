/** Persistence. Only the world seed plus the blocks the player changed are stored, so a
 *  save stays small no matter how far the player has explored. */

export const SAVE_KEY = 'voxelcraft.save.v1';
export const SAVE_VERSION = 3;

export interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  saturation: number;
  selected: number;
  inventory: ([string, number] | null)[];
  armor: ([string, number] | null)[];
}

export interface SavedChest {
  pos: [number, number, number];
  slots: ([string, number] | null)[];
}

export interface SavedFurnace {
  pos: [number, number, number];
  slots: ([string, number] | null)[];
  burnLeft: number;
  burnTotal: number;
  cookProgress: number;
}

export interface SavedVillager {
  x: number;
  y: number;
  z: number;
  profession: string;
  trades: unknown;
}

export interface SaveData {
  version: number;
  seed: number;
  time: number;
  /** Seconds of world time, which the weather cycle runs on. Absent in saves written
   *  before the seasons existed, where the cycle simply starts over. */
  weatherSeconds?: number;
  savedAt: number;
  player: SavedPlayer;
  /** Chunk key -> base64 encoded (blockIndex, blockId) pairs. */
  edits: Record<string, string>;
  /** Chunk key -> run length encoded water levels, for every chunk. The water is
   *  simulated rather than generated, so it cannot be recovered from the seed. */
  water: Record<string, string>;
  chests: SavedChest[];
  furnaces: SavedFurnace[];
  villagers: SavedVillager[];
  /** Chunks whose village villagers have already been spawned. */
  populatedChunks: string[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Packs a chunk's edits as pairs of 32 bit integers. */
export function encodeEdits(edits: Map<number, number>): string {
  const packed = new Uint32Array(edits.size * 2);
  let i = 0;
  for (const [index, id] of edits) {
    packed[i++] = index;
    packed[i++] = id;
  }
  return bytesToBase64(new Uint8Array(packed.buffer));
}

export function decodeEdits(text: string): Map<number, number> {
  const bytes = base64ToBytes(text);
  const packed = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const map = new Map<number, number>();
  for (let i = 0; i < packed.length; i += 2) map.set(packed[i], packed[i + 1]);
  return map;
}

/** Run length encodes water levels: long stretches of dry or full cells collapse to a
 *  couple of bytes, which keeps a reservoir cheap to store. */
export function encodeWater(levels: Uint8Array): string {
  const out: number[] = [];
  let index = 0;
  while (index < levels.length) {
    const value = levels[index];
    let run = 1;
    while (run < 255 && index + run < levels.length && levels[index + run] === value) run++;
    out.push(run, value);
    index += run;
  }
  return bytesToBase64(new Uint8Array(out));
}

export function decodeWater(text: string, length: number): Uint8Array {
  const bytes = base64ToBytes(text);
  const levels = new Uint8Array(length);
  let index = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const run = bytes[i];
    const value = bytes[i + 1];
    for (let n = 0; n < run && index < length; n++) levels[index++] = value;
  }
  return levels;
}

export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota exceeded or storage disabled: the game keeps running, just unsaved.
    return false;
  }
}

export function readSave(): SaveData | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as SaveData;
    if (data.version !== SAVE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
