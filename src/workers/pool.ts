import ChunkWorker from './chunk.worker?worker';
import type { ChunkReadyMessage, WorkerRequest } from './chunkMessages';
import type { WorldConstants } from '../world/generation/infinite/world';
import { chunkKey } from '../world/chunk';

interface Job {
  cx: number;
  cz: number;
  /** Squared distance to the player; the closest chunk is always generated first. */
  priority: number;
}

/** A small pool of terrain generation workers with a nearest-first queue. */
export class ChunkWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue = new Map<string, Job>();
  private readonly inFlight = new Set<string>();
  private onChunk: ((message: ChunkReadyMessage) => void) | null = null;
  constructor(seed: number, constants: WorldConstants,
    size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const worker = new ChunkWorker();
      worker.onmessage = (event: MessageEvent<ChunkReadyMessage>) => {
        this.inFlight.delete(chunkKey(event.data.cx, event.data.cz));
        this.idle.push(worker);
        this.onChunk?.(event.data);
        this.pump();
      };
      this.post(worker, { type: 'init', seed, constants });
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  setHandler(handler: (message: ChunkReadyMessage) => void): void {
    this.onChunk = handler;
  }

  get pending(): number {
    return this.queue.size + this.inFlight.size;
  }

  isBusyWith(cx: number, cz: number): boolean {
    const key = chunkKey(cx, cz);
    return this.queue.has(key) || this.inFlight.has(key);
  }

  request(cx: number, cz: number, priority: number): void {
    const key = chunkKey(cx, cz);
    if (this.inFlight.has(key)) return;
    const existing = this.queue.get(key);
    if (existing) {
      existing.priority = priority;
      return;
    }
    this.queue.set(key, { cx, cz, priority });
    this.pump();
  }

  /** Drops queued work that is no longer near the player. */
  cancelFarther(keep: (cx: number, cz: number) => boolean): void {
    for (const [key, job] of this.queue) {
      if (!keep(job.cx, job.cz)) this.queue.delete(key);
    }
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.size > 0) {
      let bestKey: string | null = null;
      let best: Job | null = null;
      for (const [key, job] of this.queue) {
        if (!best || job.priority < best.priority) {
          best = job;
          bestKey = key;
        }
      }
      if (!best || !bestKey) return;
      this.queue.delete(bestKey);
      this.inFlight.add(bestKey);
      const worker = this.idle.pop()!;
      this.post(worker, { type: 'generate', cx: best.cx, cz: best.cz });
    }
  }

  private post(worker: Worker, message: WorkerRequest): void {
    worker.postMessage(message);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.queue.clear();
    this.inFlight.clear();
  }
}
