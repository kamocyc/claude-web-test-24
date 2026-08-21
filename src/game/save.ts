/** Persistence. Only the world seed plus the blocks the player changed are stored, so a
 *  save stays small no matter how far the player has explored. */

export const SAVE_KEY = 'voxelcraft.save.v1';
export const SAVE_VERSION = 2;

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
  /** Development of the village this villager lives in, at the time the offers were
   *  rolled. Kept so loading does not re-roll a table the player has already used. */
  villageStage?: number;
}

/** What has happened to a village. Where it is, what it makes and what it is called are
 *  all re-derived from the seed, so only the earned part is stored. */
export interface SavedVillage {
  id: string;
  produces: string;
  stage: number;
  points: number;
  stock: number;
  discovered: boolean;
  spawnedStage: number;
  /** Absent in saves written before workshops existed. */
  inputStock?: number;
  received?: number;
}

/** Only the pair. The road itself is already in `edits`, so a route surveys itself again
 *  on load rather than storing its geometry twice. */
export interface SavedRoute {
  from: string;
  to: string;
}

export interface SavedQuest {
  step: string;
  originId?: string;
  targetId?: string;
  good?: string;
  count?: number;
  /** Absent before the milestones existed; such a save starts the list from the top. */
  milestone?: number;
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
  /** Chunk key -> run length encoded water levels, for chunks the player changed. */
  water: Record<string, string>;
  chests: SavedChest[];
  furnaces: SavedFurnace[];
  villagers: SavedVillager[];
  /** Chunks whose village villagers have already been spawned. */
  populatedChunks: string[];
  /** The village economy. Optional, like `weatherSeconds`: a save written before it
   *  existed opens with no villages found yet and the tutorial at its first step, which
   *  is exactly right. Bumping SAVE_VERSION instead would throw every world away. */
  villages?: SavedVillage[];
  /** Emeralds the transport network has paid the player. A running total rather than
   *  state, but it is the one number the ledger leads with. */
  freight?: number;
  routes?: SavedRoute[];
  quest?: SavedQuest;
  /** Villagers a village earned by growing while their chunk was unloaded. */
  pendingVillagers?: { x: number; y: number; z: number; profession: string }[];
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
