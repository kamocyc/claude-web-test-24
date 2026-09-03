import type { ChestMarker, VillagerMarker } from '../world/generation/village';
import type { RegionSurvey } from '../world/generation/terrain';
import type { WorldConstants } from '../world/generation/infinite/world';

export interface InitMessage {
  type: 'init';
  seed: number;
  /**
   * The calibration and the river threshold, measured once on the main thread.
   *
   * Both are properties of the whole world rather than of any tile, and working
   * them out costs a sampling pass and two probe super-chunks. Every worker
   * would otherwise pay that separately, for an answer all of them are obliged
   * to agree on to the last bit — and disagreeing would put the sea at two
   * different heights in two different chunks.
   */
  constants: WorldConstants;
}

export interface GenerateMessage {
  type: 'generate';
  cx: number;
  cz: number;
}

/**
 * A rectangle of ground to survey for the map, on the lattice `step` describes.
 *
 * Off the main thread for the same reason chunk generation is: a survey builds
 * the same drainage tiles a chunk does, and a region wide enough to be worth
 * looking at is seconds of them. `id` comes back with the answer so the caller
 * can tell which patch of a many-patch sweep has landed.
 */
export interface SurveyMessage {
  type: 'survey';
  id: number;
  x0: number;
  z0: number;
  cols: number;
  rows: number;
  step: number;
}

export type WorkerRequest = InitMessage | GenerateMessage | SurveyMessage;

export interface ChunkReadyMessage {
  type: 'chunk';
  cx: number;
  cz: number;
  blocks: Uint16Array;
  water: Uint8Array;
  /** Spring blocks placed by generation, which the water simulator has to know about. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /**
   * Surface Y for each of the chunk's 256 columns.
   *
   * The worker has just worked these out; recomputing them on the main thread
   * costs a tile it does not have. `TreeStore` alone asks about sixty columns of
   * a chunk on the frame it arrives.
   */
  heights: Int16Array;
}

export interface SurveyReadyMessage {
  type: 'survey';
  id: number;
  survey: RegionSurvey;
}

export type WorkerResponse = ChunkReadyMessage | SurveyReadyMessage;
