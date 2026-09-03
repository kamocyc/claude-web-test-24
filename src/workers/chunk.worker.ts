/// <reference lib="webworker" />
import { TerrainGenerator } from '../world/generation/terrain';
import type { WorkerRequest, ChunkReadyMessage, SurveyReadyMessage } from './chunkMessages';

/** Terrain generation is the expensive part of loading a chunk, and it depends only on
 *  the seed, so it runs off the main thread. Meshing stays on the main thread where the
 *  neighbouring chunk data lives. */
let generator: TerrainGenerator | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    generator = new TerrainGenerator(message.seed, message.constants ?? undefined, message.kind);
    return;
  }
  if (message.type === 'survey') {
    if (!generator) throw new Error('worker used before init');
    const survey = generator.surveyRegion(message.x0, message.z0, message.cols, message.rows, message.step);
    const response: SurveyReadyMessage = { type: 'survey', id: message.id, survey };
    (self as unknown as Worker).postMessage(response,
      [survey.height.buffer, survey.block.buffer, survey.water.buffer]);
    return;
  }
  if (message.type === 'generate') {
    if (!generator) throw new Error('worker used before init');
    const result = generator.generateChunk(message.cx, message.cz);
    const response: ChunkReadyMessage = {
      type: 'chunk',
      cx: message.cx,
      cz: message.cz,
      blocks: result.blocks,
      water: result.water,
      springs: result.springs,
      villagers: result.villagers,
      chests: result.chests,
      heights: result.heights,
    };
    (self as unknown as Worker).postMessage(response,
      [result.blocks.buffer, result.water.buffer, result.heights.buffer]);
  }
};
