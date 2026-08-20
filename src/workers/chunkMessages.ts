import type { ChestMarker, VillagerMarker } from '../world/generation/village';

export interface InitMessage {
  type: 'init';
  seed: number;
}

export interface GenerateMessage {
  type: 'generate';
  cx: number;
  cz: number;
}

export type WorkerRequest = InitMessage | GenerateMessage;

export interface ChunkReadyMessage {
  type: 'chunk';
  cx: number;
  cz: number;
  blocks: Uint16Array;
  water: Uint8Array;
  /** Per column, 1 where the ground is below sea level. */
  seaColumn: Uint8Array;
  /** Spring blocks placed by generation, which the water simulator has to know about. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

export type WorkerResponse = ChunkReadyMessage;
