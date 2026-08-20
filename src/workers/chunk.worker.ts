/// <reference lib="webworker" />
import { TerrainGenerator } from '../world/generation/terrain';
import type { WorkerRequest, ChunkReadyMessage } from './chunkMessages';

/** Terrain generation is the expensive part of loading a chunk, and it depends only on
 *  the seed, so it runs off the main thread. Meshing stays on the main thread where the
 *  neighbouring chunk data lives. */
let generator: TerrainGenerator | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    generator = new TerrainGenerator(message.seed);
    return;
  }
  if (message.type === 'generate') {
    if (!generator) throw new Error('worker used before init');
    generator.weatherSeconds = message.weatherSeconds;
    const result = generator.generateChunk(message.cx, message.cz);
    const response: ChunkReadyMessage = {
      type: 'chunk',
      cx: message.cx,
      cz: message.cz,
      blocks: result.blocks,
      water: result.water,
      riverSurface: result.riverSurface,
      weatherSeconds: result.weatherSeconds,
      springs: result.springs,
      villagers: result.villagers,
      chests: result.chests,
    };
    (self as unknown as Worker).postMessage(response, [
      result.blocks.buffer,
      result.water.buffer,
      result.riverSurface.buffer,
    ]);
  }
};
