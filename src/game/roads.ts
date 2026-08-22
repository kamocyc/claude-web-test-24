/** The transport road network.
 *
 *  Villages sit 320 blocks apart at the very least, so a road between two of them spends
 *  most of its life in chunks that are not loaded — and `World.getBlock` answers `AIR`
 *  for those (`world.ts:95`). Reading raw blocks would also be wrong even when they are
 *  loaded: gravel veins reach y=100 (`features.ts:95`) and mountain tops are bare stone,
 *  so a material test would happily connect two villages through a hillside nobody built.
 *
 *  So a road column is not "a block that looks like a road". It is "a road block the
 *  player put there", and the player's blocks live in `World.edits` — the same map that
 *  gets saved, and the one thing that survives a chunk unload. Indexing that, rather than
 *  scanning the world, makes the answer identical whether or not the chunk is loaded.
 *
 *  A road is continuous, and it is walkable. Two columns belong to one road only when they
 *  touch: one of the eight cells around a column, no more than `MAX_STEP` above or below
 *  it, with `HEADROOM` cells clear overhead. Both numbers come from the creature that has
 *  to walk it — a porter's jump clears 1.11 blocks and its head is 1.95 up — because an
 *  index that calls a two block riser or the underside of an oak a road is an index that
 *  sends a walker at a wall and then teleports it out again.
 *
 *  Terrain needs no test of its own. A road over water is a bridge, and a bridge is blocks
 *  somebody laid. */

import { blockDef, Block, type BlockId } from '../world/blocks';
import { CHUNK_SIZE, blockIndex, parseChunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';
import { VILLAGE_RADIUS } from '../world/generation/village';
import type { VillageRecord } from './villages';

/** Blocks a player lays to make a road, and how fast a porter walks on each. Bare stone
 *  and dirt are deliberately absent: they are what the world is already made of, so they
 *  could not be told apart from it.
 *
 *  The spread is what keeps a finished road worth returning to. A trodden dirt path joins
 *  two villages; paving it over in stone brick is what makes the line pay. */
export const ROAD_SPEED: ReadonlyMap<BlockId, number> = new Map<BlockId, number>([
  [Block.DIRT_PATH, 1],
  [Block.GRAVEL, 1.2],
  [Block.SANDSTONE, 1.2],
  [Block.COBBLESTONE, 1.45],
  [Block.MOSSY_COBBLESTONE, 1.45],
  [Block.OAK_PLANKS, 1.45],
  [Block.STONE_BRICKS, 1.7],
]);

export const ROAD_BLOCKS: ReadonlySet<BlockId> = new Set<BlockId>(ROAD_SPEED.keys());

/** What to call a road of a given quality, for the panel and the ledger. */
export function roadGrade(quality: number): string {
  if (quality < 0.95) return 'けもの道';
  if (quality < 1.12) return '土の道';
  if (quality < 1.34) return '砂利道';
  if (quality < 1.58) return '石畳';
  return '街道';
}

/** Why a stretch of laid road does not count, in the fewest words that still say what to
 *  do about it. Both readings are the same shape: the work is done, and something else has
 *  to move before it counts. */
export function faultText(fault: RoadFault): string {
  return fault.kind === 'headroom'
    ? '頭上が塞がっている — ここは道にならない'
    : '段差が 2 マス以上 — ここで道が切れる';
}

/** A tally of faults for the panel: "段差 2 か所・頭上 1 か所". */
export function faultSummary(faults: readonly RoadFault[]): string {
  const steps = faults.filter((f) => f.kind === 'step').length;
  const heads = faults.filter((f) => f.kind === 'headroom').length;
  const parts: string[] = [];
  if (steps > 0) parts.push(`段差 ${steps} か所`);
  if (heads > 0) parts.push(`頭上 ${heads} か所`);
  return parts.join('・');
}

/** Height a walker may gain or lose between two touching columns.
 *
 *  This used to be two, and two was a lie: `JUMP_SPEED² / (2·GRAVITY)` in `mobs/ai.ts`
 *  clears 1.11 blocks, so a two block riser was a road the index called connected and the
 *  porter could not climb. It jumped at the wall until the shipment had run 7 blocks ahead
 *  of it and then got picked up and put down — which is what "the porter teleports" was. */
export const MAX_STEP = 1;
/** Cells that must be clear above a road column. A porter is 1.95 tall, so one was enough
 *  headroom for an overhanging branch to make a road nobody fits through. */
export const HEADROOM = 2;
/** Blocks of level walking that one block of climb is worth. Climbing is slow, and a road
 *  that staircases up a hill should lose to one that goes round it — both when the search
 *  picks a way through and when the panel reports how good the road is. */
export const CLIMB_COST = 1.5;
/** How far apart two columns may be vertically and still be worth pointing at as a step
 *  the player nearly joined. Beyond it they are not a broken road, they are a hillside. */
export const FAULT_STEP = 3;
/** Most faults reported at once. The display wants "there is a problem, here"; a hundred
 *  red beacons is the same information with none of the answer. */
const MAX_FAULTS = 64;
/** Tile size for the column index. An index only: it has no say in what connects. */
const BUCKET = 16;
/** Search cap. The graph is only what the player laid, so this is never reached in play. */
export const MAX_NODES = 4096;
/** Half width of a village's street cross, from `putRoad` in village.ts. */
export const STREET_REACH = VILLAGE_RADIUS - 8;

/** The four straight lines through a column: along x, along z, and both diagonals. */
const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** The eight cells a road may continue into. */
const AROUND: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export interface RoadPoint {
  x: number;
  z: number;
  y: number;
  /** The surface, where it is known. Only set by `columnsIn`, so the minimap can draw a
   *  paved road differently from a dirt one. */
  b?: BlockId;
}

/** Whether a cart can be pulled the whole way, and if not, where the road pinches. */
export type CartResult =
  | { ok: true; length: number; quality: number }
  | { ok: false; pinch: RoadPoint | null };

export type SurveyResult =
  | {
      connected: true;
      waypoints: RoadPoint[];
      length: number;
      /** Weighted speed factor over the whole road: the length divided by the time a
       *  walker spends on it, climb included. One stretch of stone brick in a mile of
       *  dirt therefore barely moves it, which is the honest answer. */
      quality: number;
      /** Blocks of up-and-down along the way. What the climb penalty is charged on. */
      climb: number;
      /** Straight line between the two ends. The road divided by this is the detour. */
      direct: number;
      cart: CartResult;
    }
  /** Where each side's road runs out, and how far apart those two ends are. This is what
   *  the HUD points the player at: "the gap is here", not "walk that way". */
  | {
      connected: false;
      frontierFrom: RoadPoint;
      frontierTo: RoadPoint;
      missing: number;
      /** A column that is beside what it should join and only too high or too low for it.
       *  Without this "あと 0m" and "未接続" appear together and neither explains itself. */
      nearMiss: RoadPoint | null;
    };

export type RoadFaultKind = 'headroom' | 'step';

/** A place the index refuses to call a road, and why. */
export interface RoadFault {
  x: number;
  z: number;
  y: number;
  kind: RoadFaultKind;
}

export interface RoadWorld {
  edits: Map<string, Map<number, BlockId>>;
  getBlock(x: number, y: number, z: number): BlockId;
  isLoadedAt(x: number, z: number): boolean;
}

interface Reached {
  parent: string | null;
  /** Seconds of walking from the origin village's streets. */
  cost: number;
}

function key(x: number, z: number): string {
  return `${x},${z}`;
}

/** The road block the player recorded at a cell, if any. */
function editAt(world: RoadWorld, x: number, y: number, z: number): BlockId | undefined {
  const chunk = world.edits.get(`${toChunkCoord(x)},${toChunkCoord(z)}`);
  if (!chunk) return undefined;
  return chunk.get(blockIndex(toLocalCoord(x), y, toLocalCoord(z)));
}

/** A binary heap of columns by cost. The graph is small, but the survey runs every couple
 *  of seconds while the player is still laying blocks, so a linear scan for the cheapest
 *  node is exactly the kind of cost that only shows up on somebody else's machine. */
class Frontier {
  private readonly keys: string[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(k: string, cost: number): void {
    this.keys.push(k);
    this.costs.push(cost);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): string | null {
    if (this.keys.length === 0) return null;
    const top = this.keys[0];
    const lastKey = this.keys.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let small = i;
        if (left < this.keys.length && this.costs[left] < this.costs[small]) small = left;
        if (right < this.keys.length && this.costs[right] < this.costs[small]) small = right;
        if (small === i) break;
        this.swap(small, i);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
  }
}

export class RoadNetwork {
  /** `${x},${z}` -> the y of the walkable road surface. Player-laid columns only. */
  readonly columns = new Map<string, number>();
  /** `${x},${z}` -> what that surface is made of, which is what sets a route's speed. */
  readonly surfaces = new Map<string, BlockId>();
  /** Bumped whenever the index changes, so the transport layer can skip re-surveying a
   *  network nobody has touched. */
  revision = 0;
  /** Columns bucketed by `BUCKET`-sized tiles, so drawing the corner of a network the
   *  player is standing in does not cost a walk over all of it. Rebuilt lazily when the
   *  index has moved on. */
  private readonly buckets = new Map<string, string[]>();
  private bucketRevision = -1;
  /** Per-village search results, thrown away whenever the network moves. A dozen routes
   *  between six villages is six searches and a handful of set lookups, not two searches
   *  per pair — which is what makes surveying the whole network every couple of seconds
   *  affordable while the player is still laying blocks. Carts get their own, over the
   *  smaller graph of columns wide enough to pull one down. */
  private readonly seedCache = new Map<string, string[]>();
  private readonly reachCache = new Map<string, Map<string, Reached>>();
  private readonly cartCache = new Map<string, Map<string, Reached>>();
  private cacheRevision = -1;

  constructor(private readonly world: RoadWorld) {}

  /** Rebuilds the index from the persisted edits. Called after a save is applied, where
   *  almost nothing is loaded yet — which is exactly why the index reads edits and not
   *  the world. */
  seedFromEdits(): void {
    this.columns.clear();
    this.surfaces.clear();
    for (const [chunkKey, edits] of this.world.edits) {
      const [cx, cz] = parseChunkKey(chunkKey);
      for (const [index, id] of edits) {
        if (!ROAD_BLOCKS.has(id)) continue;
        const lx = index % CHUNK_SIZE;
        const lz = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
        const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
        const x = cx * CHUNK_SIZE + lx;
        const z = cz * CHUNK_SIZE + lz;
        if (this.blockedAbove(x, y, z)) continue;
        const existing = this.columns.get(key(x, z));
        if (existing !== undefined && existing >= y) continue;
        this.columns.set(key(x, z), y);
        this.surfaces.set(key(x, z), id);
      }
    }
    this.revision++;
  }

  /** A road a walker does not fit through is not a road. `HEADROOM` cells have to be
   *  clear: one was enough for a branch to hang over a path at head height, and for a
   *  house floor laid by village growth to sit on one and be mistaken for one. */
  private blockedAbove(x: number, y: number, z: number): boolean {
    const loaded = this.world.isLoadedAt(x, z);
    for (let h = 1; h <= HEADROOM; h++) {
      if (loaded) {
        if (blockDef(this.world.getBlock(x, y + h, z)).solid) return true;
        continue;
      }
      const above = editAt(this.world, x, y + h, z);
      if (above !== undefined && blockDef(above).solid) return true;
    }
    return false;
  }

  private qualifies(x: number, y: number, z: number): boolean {
    const id = editAt(this.world, x, y, z);
    if (id === undefined || !ROAD_BLOCKS.has(id)) return false;
    return !this.blockedAbove(x, y, z);
  }

  /** Re-evaluates a column after a block changed. The cell itself matters and so does
   *  every level within `HEADROOM` below it: dropping a crate on a path un-roads the path,
   *  and so does growing a branch over it. */
  onBlockChanged(x: number, y: number, z: number, previous: BlockId, next: BlockId): void {
    const touchesRoad =
      ROAD_BLOCKS.has(previous) || ROAD_BLOCKS.has(next) ||
      blockDef(previous).solid !== blockDef(next).solid;
    if (!touchesRoad) return;
    const before = this.columns.get(key(x, z));
    const wasSurface = this.surfaces.get(key(x, z));
    this.refresh(x, z, y);
    if (this.columns.get(key(x, z)) !== before) this.revision++;
    else if (this.surfaces.get(key(x, z)) !== wasSurface) this.revision++;
  }

  /** Picks the highest qualifying road level in a column, over the range of levels the
   *  changed cell could have affected: itself, and the `HEADROOM` levels beneath it whose
   *  clearance it is part of. */
  private refresh(x: number, z: number, around: number): void {
    let best = -1;
    for (let y = around + 1; y >= around - HEADROOM - 1; y--) {
      if (this.qualifies(x, y, z)) {
        best = y;
        break;
      }
    }
    const existing = this.columns.get(key(x, z));
    if (best < 0) {
      // Only drop the entry when the change was about the level we had indexed; a column
      // may legitimately hold a road well below the block that just moved.
      if (existing !== undefined && Math.abs(existing - around) <= HEADROOM + 1) {
        this.columns.delete(key(x, z));
        this.surfaces.delete(key(x, z));
      }
      return;
    }
    this.columns.set(key(x, z), best);
    // Repaving a column changes nothing about where the road goes, only how fast it is
    // walked — so the material is refreshed whether or not the level moved.
    const surface = editAt(this.world, x, best, z);
    if (surface !== undefined) this.surfaces.set(key(x, z), surface);
  }

  /** Road columns inside a rectangle, for drawing the network on the minimap.
   *
   *  Asked for every frame, so it reads the tiles that overlap the rectangle rather than
   *  the whole index: a player who has laid ten thousand blocks of road should not pay
   *  for all of them to draw the corner of it they are standing on. */
  columnsIn(x0: number, z0: number, x1: number, z1: number): RoadPoint[] {
    this.rebuildBuckets();
    const out: RoadPoint[] = [];
    for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
      for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
        const list = this.buckets.get(key(bx, bz));
        if (!list) continue;
        for (const k of list) {
          const p = this.point(k);
          if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue;
          out.push({ x: p.x, z: p.z, y: p.y, b: this.surfaces.get(k) });
        }
      }
    }
    return out;
  }

  /** True when two columns touch: side by side or corner to corner, within a step. */
  private touches(a: RoadPoint, b: RoadPoint): boolean {
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.z - b.z) > 1) return false;
    return Math.abs(a.y - b.y) <= MAX_STEP;
  }

  /** True when a cart standing here and heading `(dx, dz)` has road on both sides of it.
   *
   *  Measured *across* the way the cart is going, which is the only way width means
   *  anything: three columns in a row along a single file road is a single file road.
   *  Counting neighbours instead is tempting and wrong — a road running diagonally is
   *  three across and has only four neighbours per column, fewer than a road pinched to
   *  one column has, so no count can tell the two apart.
   *
   *  Which leaves the direction, and the direction is not a problem: the search is
   *  already walking in one, and `runRoad` lays its band across the same one. */
  wideAcross(x: number, z: number, dx: number, dz: number): boolean {
    const y = this.columns.get(key(x, z));
    if (y === undefined) return false;
    const left = this.columns.get(key(x - dz, z + dx));
    if (left === undefined || Math.abs(left - y) > MAX_STEP) return false;
    const right = this.columns.get(key(x + dz, z - dx));
    return right !== undefined && Math.abs(right - y) <= MAX_STEP;
  }

  /** Nearest cell of a village's street cross to an arbitrary point. Derived from the
   *  geometry `planVillage` lays down, so no plan has to be built to ask. */
  private nearestStreet(village: VillageRecord, x: number, z: number): RoadPoint {
    const clamp = (v: number, limit: number): number => Math.max(-limit, Math.min(limit, v));
    const dx = x - village.x;
    const dz = z - village.z;
    const alongX: RoadPoint = {
      x: village.x + clamp(dx, STREET_REACH),
      z: village.z + clamp(dz, 1),
      y: village.baseY,
    };
    const alongZ: RoadPoint = {
      x: village.x + clamp(dx, 1),
      z: village.z + clamp(dz, STREET_REACH),
      y: village.baseY,
    };
    const da = Math.hypot(alongX.x - x, alongX.z - z);
    const db = Math.hypot(alongZ.x - x, alongZ.z - z);
    return da <= db ? alongX : alongZ;
  }

  /** The cell of a village's street cross nearest a point: where a road has to arrive,
   *  and so where one worth building starts. */
  streetPoint(village: VillageRecord, x: number, z: number): RoadPoint {
    return this.nearestStreet(village, x, z);
  }

  /** A road has arrived when it runs up against the village's own streets — which are
   *  generated, not recorded, so they are synthesised from the cross `planVillage` lays
   *  rather than read out of the index. Touching an arm is arriving; the road does not
   *  have to reach the middle. */
  private touchesVillage(village: VillageRecord, column: RoadPoint): boolean {
    const street = this.nearestStreet(village, column.x, column.z);
    return this.touches(street, column);
  }

  private rebuildBuckets(): void {
    if (this.bucketRevision === this.revision) return;
    this.bucketRevision = this.revision;
    this.buckets.clear();
    for (const k of this.columns.keys()) {
      const p = this.point(k);
      const bk = key(Math.floor(p.x / BUCKET), Math.floor(p.z / BUCKET));
      const list = this.buckets.get(bk);
      if (list) list.push(k);
      else this.buckets.set(bk, [k]);
    }
  }

  private point(k: string): RoadPoint {
    const comma = k.indexOf(',');
    return {
      x: Number(k.slice(0, comma)),
      z: Number(k.slice(comma + 1)),
      y: this.columns.get(k) ?? 0,
    };
  }

  private freshen(): void {
    if (this.cacheRevision === this.revision) return;
    this.cacheRevision = this.revision;
    this.seedCache.clear();
    this.reachCache.clear();
    this.cartCache.clear();
  }

  /** The columns that touch a village's own streets: where its road starts, and equally
   *  where somebody else's road has to end to have arrived. */
  private seedsFor(village: VillageRecord): string[] {
    this.freshen();
    const cached = this.seedCache.get(village.id);
    if (cached) return cached;
    const seeds: string[] = [];
    for (const k of this.columns.keys()) {
      const column = this.point(k);
      if (Math.hypot(column.x - village.x, column.z - village.z) > VILLAGE_RADIUS + 2) continue;
      if (!this.touchesVillage(village, column)) continue;
      seeds.push(k);
    }
    this.seedCache.set(village.id, seeds);
    return seeds;
  }

  /** Seconds of walking from one column onto the next, which is the only cost this layer
   *  understands. Distance is divided by what the surface is worth, and every block of
   *  climb is charged as `CLIMB_COST` blocks of level ground — so a staircase up a hill
   *  loses to a longer way round, both here and in the quality the panel reports. */
  private stepCost(a: RoadPoint, b: RoadPoint): number {
    const flat = Math.hypot(b.x - a.x, b.z - a.z);
    const surface = this.surfaces.get(key(b.x, b.z)) ?? this.surfaces.get(key(a.x, a.z));
    const speed = ROAD_SPEED.get(surface ?? Block.DIRT_PATH) ?? 1;
    return (flat + Math.abs(b.y - a.y) * CLIMB_COST) / speed;
  }

  /** Every road column reachable from a village, with the column that reached it and what
   *  it costs to get there.
   *
   *  Dijkstra rather than a breadth-first walk, because the cheapest road and the road
   *  with the fewest hops stopped being the same thing once climbing cost something. The
   *  whole graph is what the player laid, so this is a few hundred nodes on a finished
   *  road and none at all in a world where nobody has picked up a shovel. */
  private reachFrom(village: VillageRecord): Map<string, Reached> {
    this.freshen();
    const cached = this.reachCache.get(village.id);
    if (cached) return cached;
    const reached = this.walk(this.seedsFor(village), null);
    this.reachCache.set(village.id, reached);
    return reached;
  }

  /** The same search over the columns a cart fits down.
   *
   *  Cached per pair rather than per village, because both ends matter: a column touching
   *  either village's streets is let through whatever its neighbours say, since those
   *  streets are three across, generated, and so never in the index to be counted. Both
   *  ends of every road would otherwise be too narrow for the cart that just drove the
   *  length of it. */
  private cartReachFrom(from: VillageRecord, to: VillageRecord): Map<string, Reached> {
    this.freshen();
    const pair = `${from.id}|${to.id}`;
    const cached = this.cartCache.get(pair);
    if (cached) return cached;
    const ends = new Set([...this.seedsFor(from), ...this.seedsFor(to)]);
    const reached = this.walk(this.seedsFor(from), ends);
    this.cartCache.set(pair, reached);
    return reached;
  }

  /** Dijkstra over the road columns. `wideEnough`, when given, restricts the walk to
   *  columns a cart fits down, plus the named ends. */
  private walk(seeds: readonly string[], cartEnds: ReadonlySet<string> | null): Map<string, Reached> {
    const seen = new Map<string, Reached>();
    const settled = new Set<string>();
    const queue = new Frontier();
    for (const k of seeds) {
      seen.set(k, { parent: null, cost: 0 });
      queue.push(k, 0);
    }
    while (settled.size < MAX_NODES && queue.size > 0) {
      const k = queue.pop();
      if (k === null || settled.has(k)) continue;
      settled.add(k);
      const here = this.point(k);
      const cost = seen.get(k)!.cost;
      for (const [dx, dz] of AROUND) {
        const nk = key(here.x + dx, here.z + dz);
        const y = this.columns.get(nk);
        if (y === undefined || Math.abs(y - here.y) > MAX_STEP) continue;
        if (cartEnds && !cartEnds.has(nk) && !this.wideAcross(here.x + dx, here.z + dz, dx, dz)) {
          continue;
        }
        const next = cost + this.stepCost(here, { x: here.x + dx, z: here.z + dz, y });
        const known = seen.get(nk);
        if (known !== undefined && known.cost <= next) continue;
        seen.set(nk, { parent: k, cost: next });
        queue.push(nk, next);
      }
    }
    return seen;
  }

  /** Walks the parent links back to a seed and hands them over origin first. */
  private chainTo(reached: Map<string, Reached>, arrival: string): RoadPoint[] {
    const chain: RoadPoint[] = [];
    for (let k: string | null = arrival; k !== null; k = reached.get(k)?.parent ?? null) {
      chain.push(this.point(k));
      if (chain.length > MAX_NODES) break;
    }
    chain.reverse();
    return chain;
  }

  /** The cheapest column of the far village's seeds that this search reached. */
  private arrivalIn(reached: Map<string, Reached>, seeds: readonly string[]): string | null {
    let best: string | null = null;
    let cheapest = Infinity;
    for (const k of seeds) {
      const found = reached.get(k);
      if (!found || found.cost >= cheapest) continue;
      cheapest = found.cost;
      best = k;
    }
    return best;
  }

  /** How good the road is, as the factor a porter's speed is multiplied by.
   *
   *  Measured over the columns the player actually laid, and not over the last hop into
   *  each village: those are the villages' own generated streets, which nobody can pave
   *  and which would otherwise drag every short route down. It is the length divided by
   *  the time spent — climb included, since climbing is time — so one stretch of stone
   *  brick in a mile of dirt barely moves it, and a staircase drags it right down. */
  private qualityOf(chain: readonly RoadPoint[]): number {
    if (chain.length < 2) return 1;
    let length = 0;
    let time = 0;
    for (let i = 1; i < chain.length; i++) {
      const step = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z);
      if (step === 0) continue;
      length += step;
      time += this.stepCost(chain[i - 1], chain[i]);
    }
    return time > 0 ? length / time : 1;
  }

  private climbOf(chain: readonly RoadPoint[]): number {
    let climb = 0;
    for (let i = 1; i < chain.length; i++) climb += Math.abs(chain[i].y - chain[i - 1].y);
    return climb;
  }

  private lengthOf(chain: readonly RoadPoint[]): number {
    let length = 0;
    for (let i = 1; i < chain.length; i++) {
      length += Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z);
    }
    return length;
  }

  /** Walks the road from one village to the other, or reports where it runs out. */
  survey(from: VillageRecord, to: VillageRecord): SurveyResult {
    const reachFrom = this.reachFrom(from);
    // Arriving means reaching any column that touches the far village's streets, and
    // those are exactly that village's own seeds. Intersecting two sets beats testing
    // every reached column against the geometry.
    const arrival = this.arrivalIn(reachFrom, this.seedsFor(to));

    if (arrival !== null) {
      const chain = this.chainTo(reachFrom, arrival);
      const head = this.nearestStreet(from, chain[0].x, chain[0].z);
      const tail = this.nearestStreet(to, chain[chain.length - 1].x, chain[chain.length - 1].z);
      const waypoints: RoadPoint[] = [head, ...chain, tail];
      return {
        connected: true,
        waypoints,
        length: this.lengthOf(waypoints),
        quality: this.qualityOf(chain),
        climb: this.climbOf(waypoints),
        direct: Math.hypot(tail.x - head.x, tail.z - head.z),
        cart: this.surveyCart(from, to),
      };
    }

    // Not connected: report the far end of each side's road so the player is told which
    // stretch is missing rather than merely that something is.
    const reachTo = this.reachFrom(to);
    const frontierFrom = this.frontier(reachFrom, from, to);
    const frontierTo = this.frontier(reachTo, to, from);
    return {
      connected: false,
      frontierFrom,
      frontierTo,
      missing: Math.hypot(frontierTo.x - frontierFrom.x, frontierTo.z - frontierFrom.z),
      nearMiss:
        this.heightMiss(frontierFrom, frontierTo) ??
        this.heightMiss(frontierFrom, this.nearestStreet(to, frontierFrom.x, frontierFrom.z)) ??
        this.heightMiss(frontierTo, this.nearestStreet(from, frontierTo.x, frontierTo.z)),
    };
  }

  /** Whether a cart can be pulled the whole way, over the same search restricted to
   *  columns wide enough for one. When it cannot, the pinch is where the wide network
   *  stops on its way to the far village — the place to go and widen. */
  private surveyCart(from: VillageRecord, to: VillageRecord): CartResult {
    const reached = this.cartReachFrom(from, to);
    const arrival = this.arrivalIn(reached, this.seedsFor(to));
    if (arrival !== null) {
      const chain = this.chainTo(reached, arrival);
      return { ok: true, length: this.lengthOf(chain), quality: this.qualityOf(chain) };
    }
    // Where the wide network stops on its way to the far village — and, when none of the
    // road is wide at all, the village's own street end, which is where to start.
    return { ok: false, pinch: this.frontier(reached, from, to) };
  }

  /** Two columns that stand beside one another and are only too far apart in height. This
   *  is the failure mode a distance cannot describe: the panel would otherwise say the gap
   *  is nought metres wide and the road still would not join. */
  private heightMiss(a: RoadPoint, b: RoadPoint): RoadPoint | null {
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.z - b.z) > 1) return null;
    if (Math.abs(a.y - b.y) <= MAX_STEP) return null;
    return a;
  }

  /** The reached column closest to the far village, or the village's own street when its
   *  road has not been started at all. */
  private frontier(
    reached: Map<string, Reached>,
    village: VillageRecord,
    towards: VillageRecord,
  ): RoadPoint {
    let best = this.nearestStreet(village, towards.x, towards.z);
    let bestDistance = Math.hypot(best.x - towards.x, best.z - towards.z);
    for (const k of reached.keys()) {
      const column = this.point(k);
      const distance = Math.hypot(column.x - towards.x, column.z - towards.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = column;
      }
    }
    return best;
  }

  /** Every place near a point where the player laid road and the index will not have it.
   *
   *  Two kinds, and both of them are "you already did the work, it just does not count":
   *  a road block with something over its head, and two columns that stand beside one
   *  another with a riser between them the walker cannot climb. Only steps up to
   *  `FAULT_STEP` are reported — past that the two roads are not a broken join, they are
   *  a road and a hillside. */
  faults(cx: number, cz: number, radius: number): RoadFault[] {
    const out: RoadFault[] = [];
    const seen = new Set<string>();
    const x0 = cx - radius;
    const x1 = cx + radius;
    const z0 = cz - radius;
    const z1 = cz + radius;

    for (let ccz = toChunkCoord(z0); ccz <= toChunkCoord(z1); ccz++) {
      for (let ccx = toChunkCoord(x0); ccx <= toChunkCoord(x1); ccx++) {
        const edits = this.world.edits.get(`${ccx},${ccz}`);
        if (!edits) continue;
        for (const [index, id] of edits) {
          if (out.length >= MAX_FAULTS) return out;
          if (!ROAD_BLOCKS.has(id)) continue;
          const x = ccx * CHUNK_SIZE + (index % CHUNK_SIZE);
          const z = ccz * CHUNK_SIZE + (Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE);
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
          // A road block at or below an accepted surface is buried, not blocked.
          const indexed = this.columns.get(key(x, z));
          if (indexed !== undefined && indexed >= y) continue;
          if (!this.blockedAbove(x, y, z)) continue;
          if (seen.has(key(x, z))) continue;
          seen.add(key(x, z));
          out.push({ x, z, y, kind: 'headroom' });
        }
      }
    }

    for (const column of this.columnsIn(x0, z0, x1, z1)) {
      if (out.length >= MAX_FAULTS) return out;
      if (seen.has(key(column.x, column.z))) continue;
      for (const [dx, dz] of AXES) {
        const other = this.columns.get(key(column.x + dx, column.z + dz));
        if (other === undefined) continue;
        const rise = Math.abs(other - column.y);
        if (rise <= MAX_STEP || rise > FAULT_STEP) continue;
        seen.add(key(column.x, column.z));
        out.push({ x: column.x, z: column.z, y: Math.max(column.y, other), kind: 'step' });
        break;
      }
    }

    return out;
  }

  /** Walks the index from one point to another, over at most `limit` columns.
   *
   *  Used for the few metres between a depot's doorway and the street. Those are not part
   *  of any survey — a village's streets are generated and the door is a building — so
   *  before this the last leg of every trip was a straight line drawn through somebody's
   *  wall, and the porter walked into it. */
  pathBetween(from: RoadPoint, to: RoadPoint, limit: number): RoadPoint[] | null {
    const goal = key(to.x, to.z);
    const seen = new Map<string, string | null>();
    const queue: string[] = [];
    for (const [dx, dz] of [[0, 0], ...AROUND]) {
      const k = key(from.x + dx, from.z + dz);
      const y = this.columns.get(k);
      if (y === undefined || Math.abs(y - from.y) > MAX_STEP) continue;
      if (seen.has(k)) continue;
      seen.set(k, null);
      queue.push(k);
    }
    for (let head = 0; head < queue.length && seen.size <= limit; head++) {
      const k = queue[head];
      if (k === goal) {
        const chain: RoadPoint[] = [];
        for (let at: string | null = k; at !== null; at = seen.get(at) ?? null) {
          chain.push(this.point(at));
        }
        chain.reverse();
        return chain;
      }
      const here = this.point(k);
      for (const [dx, dz] of AROUND) {
        const nk = key(here.x + dx, here.z + dz);
        if (seen.has(nk)) continue;
        const y = this.columns.get(nk);
        if (y === undefined || Math.abs(y - here.y) > MAX_STEP) continue;
        seen.set(nk, k);
        queue.push(nk);
      }
    }
    return null;
  }
}

/** Trims a surveyed chain to the points where it actually turns, so a porter is not
 *  handed a waypoint for every block of a straight road. */
export function toWaypoints(path: readonly RoadPoint[]): RoadPoint[] {
  if (path.length <= 2) return [...path];
  const out: RoadPoint[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const straight =
      (b.x - a.x) * (c.z - b.z) === (b.z - a.z) * (c.x - b.x) && b.y === a.y && c.y === b.y;
    if (!straight) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
