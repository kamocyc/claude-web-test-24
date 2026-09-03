import ChunkWorker from './chunk.worker?worker';
import type { SurveyMessage, SurveyReadyMessage, WorkerRequest } from './chunkMessages';
import type { RegionSurvey } from '../world/generation/terrain';
import type { WorldConstants } from '../world/generation/infinite/world';

/** Blocks of world one request covers.
 *
 *  The drainage solution is held per 2048-block tile, so a request cut on that lattice
 *  is one tile's worth of work for the worker that gets it: it builds the tile and its
 *  neighbours' rivers once and then answers every sample from them. Cutting the sweep
 *  any other way makes several workers build the same tile. */
const PATCH_BLOCKS = 2048;

export interface SurveyorHandlers {
  /** One patch of the sweep, as soon as it lands. */
  onPatch(survey: RegionSurvey): void;
  /** Patches finished and patches asked for, for a progress line. */
  onProgress(done: number, total: number): void;
  /** Called once, when every patch has landed or the sweep was cancelled. */
  onDone(cancelled: boolean): void;
}

/**
 * Surveys a region of the world for the map, off the main thread.
 *
 * A survey costs what a chunk costs — the same drainage tiles have to be built — and a
 * region wide enough to be worth looking at is tens of seconds of them. Done on the main
 * thread that is a frozen tab, and it cannot be sliced across frames either, because the
 * indivisible unit of the work is one 2048-block tile.
 *
 * So it goes to workers of its own rather than to the chunk pool: the pool is what keeps
 * the ground under the player's feet arriving, and a sweep of a hundred square kilometres
 * would sit in front of it. They are started when a sweep starts and stopped when it
 * ends, because a survey is something the player asks for now and again, not something
 * the game is always doing.
 */
export class MapSurveyor {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: SurveyMessage[] = [];
  private inFlight = 0;
  private done = 0;
  private total = 0;
  private handlers: SurveyorHandlers | null = null;
  private nextId = 1;

  constructor(
    private readonly seed: number,
    private readonly constants: WorldConstants,
    private readonly size = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2))),
  ) {}

  get running(): boolean {
    return this.handlers !== null;
  }

  /**
   * Sweeps the rectangle whose first sample is (x0, z0) and which holds `cols` by `rows`
   * samples `step` blocks apart. Only one sweep runs at a time; starting another cancels
   * the one before it.
   */
  run(x0: number, z0: number, cols: number, rows: number, step: number, handlers: SurveyorHandlers): void {
    this.cancel();
    this.queue = MapSurveyor.cut(x0, z0, cols, rows, step).map((patch) => ({
      type: 'survey' as const,
      id: this.nextId++,
      ...patch,
    }));
    this.handlers = handlers;
    this.done = 0;
    this.total = this.queue.length;
    if (this.total === 0) {
      this.handlers = null;
      handlers.onProgress(0, 0);
      handlers.onDone(false);
      return;
    }
    handlers.onProgress(0, this.total);
    this.start();
    this.pump();
  }

  /** Stops the sweep and lets the workers go. Patches already delivered stay on the map. */
  cancel(): void {
    const handlers = this.handlers;
    this.handlers = null;
    this.queue = [];
    this.inFlight = 0;
    this.stop();
    if (handlers) handlers.onDone(true);
  }

  dispose(): void {
    this.handlers = null;
    this.queue = [];
    this.inFlight = 0;
    this.stop();
  }

  /** The rectangle cut on the 2048-block lattice the drainage tiles are held on. */
  private static cut(
    x0: number, z0: number, cols: number, rows: number, step: number,
  ): { x0: number; z0: number; cols: number; rows: number; step: number }[] {
    const out: { x0: number; z0: number; cols: number; rows: number; step: number }[] = [];
    if (cols <= 0 || rows <= 0) return out;
    // Sample indices, not block coordinates: a patch boundary has to fall between two
    // samples or a column would be surveyed twice, or not at all.
    const per = Math.max(1, Math.round(PATCH_BLOCKS / step));
    const firstEdge = Math.ceil((Math.ceil(x0 / PATCH_BLOCKS) * PATCH_BLOCKS - x0) / step);
    const firstEdgeZ = Math.ceil((Math.ceil(z0 / PATCH_BLOCKS) * PATCH_BLOCKS - z0) / step);
    const edges = (first: number, count: number): number[] => {
      const list = [0];
      for (let i = first; i < count; i += per) if (i > 0) list.push(i);
      list.push(count);
      return list;
    };
    const xs = edges(firstEdge, cols);
    const zs = edges(firstEdgeZ, rows);
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        out.push({
          x0: x0 + xs[i] * step,
          z0: z0 + zs[j] * step,
          cols: xs[i + 1] - xs[i],
          rows: zs[j + 1] - zs[j],
          step,
        });
      }
    }
    return out;
  }

  private start(): void {
    if (this.workers.length > 0) return;
    for (let i = 0; i < this.size; i++) {
      const worker = new ChunkWorker();
      worker.onmessage = (event: MessageEvent<SurveyReadyMessage>) => {
        if (event.data.type !== 'survey') return;
        this.inFlight--;
        this.idle.push(worker);
        if (!this.handlers) return;
        this.done++;
        this.handlers.onPatch(event.data.survey);
        this.handlers.onProgress(this.done, this.total);
        if (this.queue.length === 0 && this.inFlight === 0) {
          const handlers = this.handlers;
          this.handlers = null;
          this.stop();
          handlers.onDone(false);
          return;
        }
        this.pump();
      };
      this.post(worker, { type: 'init', seed: this.seed, constants: this.constants });
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  private stop(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.idle = [];
  }

  private pump(): void {
    // Every worker is given a patch and then left alone until it answers: a survey has
    // no priorities to reorder, so there is nothing to gain by holding any back.
    while (this.queue.length > 0 && this.idle.length > 0) {
      this.inFlight++;
      this.post(this.idle.pop()!, this.queue.shift()!);
    }
  }

  private post(worker: Worker, message: WorkerRequest): void {
    worker.postMessage(message);
  }
}
