/** Persistence. Only the world seed plus the blocks the player changed are stored, so a
 *  save stays small no matter how far the player has explored. */

export const SAVE_KEY = 'voxelcraft.save.v1';
export const SAVE_VERSION = 2;

/** The id the old block railway used, and what a world that still has some in it opens
 *  with instead.
 *
 *  There is no rail block any more: a railway is laid as curves in the open now, and a
 *  block whose whole job was to be walked over by a train has nothing left to do. Dropping
 *  the id and leaving it at that would punch holes in every road and bridge somebody
 *  railed, so the columns become their own ballast. Written here rather than as a version
 *  bump because a bump throws the world away, and this is one substitution.
 *
 *  Ids, not names, so that this does not depend on a block that no longer exists: 59 was
 *  `RAIL` and 7 is `GRAVEL`. */
const RETIRED_RAIL = 59;
const BALLAST = 7;

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
  /** A tutorial hamlet is not on the village grid, so unlike every other village it
   *  cannot be re-derived from the seed and its whole description is stored. */
  outpost?: boolean;
  parent?: string;
  x?: number;
  z?: number;
  baseY?: number;
  variant?: string;
  name?: string;
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

/** One end of a laid track: where it is, which way the track runs through it, and how
 *  steeply. The heading came from the player's yaw at the moment they clicked and cannot
 *  be re-derived from anything else, so it is the one thing that has to be written down. */
export interface SavedTrackNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Port zero's heading and slope, under the names they had before ports existed. */
  hx: number;
  hz: number;
  grade: number;
  /** Whether a station stands on this end. Absent on every node of a railway saved before
   *  stations existed, and on every end of one that has none. */
  station?: boolean;
  /** Whether a signal stands here. Absent for the same reason. */
  signal?: boolean;
  /** Every way out, written only for a switch. A node without this is a plain joint whose
   *  two ports are `(hx, hz, grade)` and its exact reverse — which is every node of every
   *  railway saved before switches existed. */
  ports?: { hx: number; hz: number; grade: number }[];
}

/** Only the pair of ends, and which way round the track runs through each. The curve
 *  between them is a pure function of the two, so it is solved again on load rather than
 *  stored twice — the same bargain SavedRoute makes with the road it lies on. */
/** Which port of each end the curve is attached to — but only in a save whose
 *  `SavedTracks.ports` says so. Before ports existed these were `1`/`-1` and meant the
 *  *side* of a node's single heading, differently at each end of the curve; see
 *  `legacyStartPort` in `tracks.ts`. */
export interface SavedTrackEdge {
  a: number;
  b: number;
  dirA: number;
  dirB: number;
  /** Where the curve's two arcs meet, for one that was cut out of a longer run. Absent on
   *  every curve a player laid in one gesture: those are the equal-tangent biarc of their
   *  own ends, which the solver finds again on its own. */
  jx?: number;
  jz?: number;
}

export interface SavedTracks {
  nodes: SavedTrackNode[];
  edges: SavedTrackEdge[];
  nextId: number;
  /** True in every save written since ports existed, and absent in every one written
   *  before. It says how to read `SavedTrackEdge.dirA`/`dirB`, and nothing else. */
  ports?: boolean;
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
  /** The free-form railway: curves laid in world coordinates, with no blocks under them.
   *  Optional for the same reason `villages` is — a save written before it existed opens
   *  with no track laid, which is exactly right, and bumping SAVE_VERSION to say so would
   *  throw every world away instead. */
  tracks?: SavedTracks;
  /** The map's memory: chunk key -> the surveyed surface of that chunk. Optional in the
   *  same way as the rest — a save written before the survey existed opens with a blank
   *  map that fills in again as the player walks, which costs nothing but a walk. */
  explored?: Record<string, string>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
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
  for (let i = 0; i < packed.length; i += 2) {
    const id = packed[i + 1];
    map.set(packed[i], id === RETIRED_RAIL ? BALLAST : id);
  }
  return map;
}

/** Run length encodes a plane of bytes: long stretches of the same value collapse to a
 *  couple of bytes, which is what keeps a reservoir — or a chunk of surveyed map — cheap
 *  to store. */
export function encodeRuns(bytes: Uint8Array): string {
  const out: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const value = bytes[index];
    let run = 1;
    while (run < 255 && index + run < bytes.length && bytes[index + run] === value) run++;
    out.push(run, value);
    index += run;
  }
  return bytesToBase64(new Uint8Array(out));
}

export function decodeRuns(text: string, length: number): Uint8Array {
  const bytes = base64ToBytes(text);
  const values = new Uint8Array(length);
  let index = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const run = bytes[i];
    const value = bytes[i + 1];
    for (let n = 0; n < run && index < length; n++) values[index++] = value;
  }
  return values;
}

/** Water levels, which are the runs above under the name the save calls them by. */
export function encodeWater(levels: Uint8Array): string {
  return encodeRuns(levels);
}

export function decodeWater(text: string, length: number): Uint8Array {
  return decodeRuns(text, length);
}

export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota exceeded or storage disabled. The survey is the one part of a save that can
    // be had again by walking, and it is much the largest, so a world that will not fit
    // is written without it rather than lost.
    if (!data.explored) return false;
    try {
      const { explored: _dropped, ...rest } = data;
      localStorage.setItem(SAVE_KEY, JSON.stringify(rest));
      return true;
    } catch {
      // The game keeps running, just unsaved.
      return false;
    }
  }
}

/** A save out of whatever held it — local storage, or a file the player chose. Null for
 *  anything that is not one, including a save from a version this build cannot read. */
export function parseSave(text: string): SaveData | null {
  try {
    const data = JSON.parse(text) as SaveData;
    if (!data || typeof data !== 'object') return null;
    if (data.version !== SAVE_VERSION) return null;
    if (typeof data.seed !== 'number' || !data.player || !data.edits) return null;
    return data;
  } catch {
    return null;
  }
}

export function readSave(): SaveData | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

/** What a world is called once it is a file: the seed it grew from and the day it was
 *  put down, so a folder of them can be told apart without opening any. */
export function saveFileName(data: SaveData): string {
  const when = new Date(data.savedAt || Date.now());
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `voxelcraft-${data.seed}-${stamp}.json`;
}

/** Hands the world to the browser as a download, and says what it called it. */
export function downloadSave(data: SaveData): string {
  const name = saveFileName(data);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Not before the click has been processed, or the browser is handed a dead URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** Reads a save the player picked out of their own files. */
export async function readSaveFile(file: File): Promise<SaveData | null> {
  try {
    return parseSave(await file.text());
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
