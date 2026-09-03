/** Persistence. Only the world seed plus the blocks the player changed are stored, so a
 *  save stays small no matter how far the player has explored. */

export const SAVE_KEY = 'voxelcraft.save.v1';
/** Bumped for the new terrain and village generation.
 *
 *  A save stores the seed and the blocks the player changed, and rebuilds the rest of the
 *  world from the seed on load. Terrain and village placement are now the port of the
 *  reference generator's infinite mode, so the same seed makes a different world: the
 *  ground under a saved house is not the ground it was built on, the towns are somewhere
 *  else, and a village's identity is its coordinates, so every town's stage, stock and
 *  depot would be orphaned. There is no honest way to convert that, so a version 5 save
 *  is refused rather than half read and the player starts a new world.
 *
 *  The precedent is version 3, which refused version 2 saves for the same reason when the
 *  line network arrived. That is the cost of the change and it is paid once. */
export const SAVE_VERSION = 6;

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

/** The saved shapes of the things that own them, rather than a second copy declared here.
 *
 *  There used to be two declarations of each of these — one beside the code that writes it
 *  and one here — and nothing made them agree: they are structural types, so TypeScript is
 *  happy to let them drift apart until a field one side writes is a field the other side
 *  has never heard of. Re-exporting the real ones is the fix. */
export type { SavedVillage } from './villages';
export type { SavedStop, SavedLine } from './lines';
export type { SavedIndustry } from './industry';
export type { SavedQuest } from './questline';

import { CHUNK_SIZE, parseChunkKey } from '../world/chunk';
import { DEFAULT_WORLD_KIND, isWorldKind, type WorldKind } from '../world/generation/kind';
import type { SavedVillage } from './villages';
import type { SavedStop, SavedLine } from './lines';
import type { SavedIndustry } from './industry';
import type { SavedQuest } from './questline';

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
  /** Which generator built this world. Optional so that saves written before the
   *  showcase existed open as what they are — ordinary terrain — instead of being
   *  refused by a version bump that would throw every world away. */
  kind?: WorldKind;
  time: number;
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
  /** The town economy. */
  villages?: SavedVillage[];
  /** Emeralds the transport network has paid the player. A running total rather than
   *  state, but it is the one number the ledger leads with. */
  freight?: number;
  /** The service the player designed: where they put stops, and which stops each line
   *  calls at. The roads and rails under it are already in `edits` and `tracks`, so a leg
   *  surveys itself again on load rather than storing its geometry twice. */
  network?: { stops: SavedStop[]; lines: SavedLine[] };
  /** Primary industries the player sited. Unlike a town these cannot be re-derived from
   *  anything — the player chose where each one stands — so the whole description is
   *  stored. */
  industries?: SavedIndustry[];
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
  /** Stable ids of natural object trees that have been felled or cleared. */
  removedTrees: string[];
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

/** What became of a save. `trimmed` is a save that is on disk but had to forget some of
 *  the map to get there, which is worth telling the player about: it is the one kind of
 *  loss that looks like nothing at all until they next open the world. */
export type SaveOutcome = 'saved' | 'trimmed' | 'failed';

function store(data: object): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota exceeded, or storage disabled entirely.
    return false;
  }
}

/** The surveyed chunks, nearest `near` first.
 *
 *  Nearest first because the map somebody is using is the one around them. A save that has
 *  to forget ground should forget the far edges of the world, not the town they are
 *  standing in. */
function nearestFirst(explored: Record<string, string>, near: { x: number; z: number }): string[] {
  const cx = near.x / CHUNK_SIZE;
  const cz = near.z / CHUNK_SIZE;
  return Object.keys(explored).sort((a, b) => {
    const [ax, az] = parseChunkKey(a);
    const [bx, bz] = parseChunkKey(b);
    return (ax - cx) ** 2 + (az - cz) ** 2 - ((bx - cx) ** 2 + (bz - cz) ** 2);
  });
}

/** Writes the world to local storage, giving up as little of it as it can.
 *
 *  The survey is the one part of a save that can be had again by walking, and it is much
 *  the largest, so it is what gets cut when the world will not fit. It is cut *down* and
 *  not out: half the map, then a quarter, until one of them fits. A player who has walked
 *  a continent loses the far edge of it rather than the whole thing, which is the
 *  difference between a map with a horizon and no map at all. */
export function writeSave(data: SaveData, near?: { x: number; z: number }): SaveOutcome {
  if (store(data)) return 'saved';
  const explored = data.explored;
  if (!explored) return 'failed';
  const ranked = nearestFirst(explored, near ?? { x: 0, z: 0 });
  for (let keep = Math.floor(ranked.length / 2); keep >= 1; keep = Math.floor(keep / 2)) {
    const kept: Record<string, string> = {};
    for (let i = 0; i < keep; i++) kept[ranked[i]] = explored[ranked[i]];
    if (store({ ...data, explored: kept })) return 'trimmed';
  }
  const { explored: _dropped, ...rest } = data;
  // The game keeps running either way; this is only whether it will still be here later.
  return store(rest) ? 'trimmed' : 'failed';
}

/** A save out of whatever held it — local storage, or a file the player chose. Null for
 *  anything that is not one, including a save from a version this build cannot read. */
export function parseSave(text: string): SaveData | null {
  try {
    const data = JSON.parse(text) as SaveData;
    if (!data || typeof data !== 'object') return null;
    if (data.version !== SAVE_VERSION) return null;
    if (typeof data.seed !== 'number' || !data.player || !data.edits || !Array.isArray(data.removedTrees)) return null;
    // A world opened under the wrong generator is a world of floating houses, so
    // an unrecognised kind falls back to the one every save before it was.
    data.kind = isWorldKind(data.kind) ? data.kind : DEFAULT_WORLD_KIND;
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
