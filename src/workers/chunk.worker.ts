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
    // Work the island's drainage network out now rather than on the first chunk, so all
    // the workers pay for it at once instead of one after another.
    generator.prepare();
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
      seaColumn: result.seaColumn,
      springs: result.springs,
      villagers: result.villagers,
      chests: result.chests,
    };
    (self as unknown as Worker).postMessage(response, [
      result.blocks.buffer,
      result.water.buffer,
      result.seaColumn.buffer,
    ]);
  }
};
