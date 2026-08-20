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
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

export type WorkerResponse = ChunkReadyMessage;
