import type { ChestMarker, VillagerMarker } from '../world/generation/village';

export interface InitMessage {
  type: 'init';
  seed: number;
}

export interface GenerateMessage {
  type: 'generate';
  cx: number;
  cz: number;
  /** World clock, so a chunk generated during a drought arrives at the drought level
   *  instead of flashing at its normal level for a frame. */
  weatherSeconds: number;
}

export type WorkerRequest = InitMessage | GenerateMessage;

export interface ChunkReadyMessage {
  type: 'chunk';
  cx: number;
  cz: number;
  blocks: Uint16Array;
  water: Uint8Array;
  /** Per column, the river's normal water height, or 0 where there is no river. */
  riverSurface: Float32Array;
  /** The clock the water was filled for, which may be a frame or two old. */
  weatherSeconds: number;
  /** Spring blocks placed by generation, which the water simulator has to know about. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

export type WorkerResponse = ChunkReadyMessage;
