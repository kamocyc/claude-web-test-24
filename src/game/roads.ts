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
 *  Roads may be dashed: two columns up to `MAX_LINK` apart still count as one road, as
 *  long as the ground between them is actually walkable. Laying every single block of a
 *  500 block route is a chore, not a tutorial — but the terrain check is what keeps the
 *  concession honest, so a road can never span a cliff or the sea. */

import { blockDef, Block, type BlockId } from '../world/blocks';
import { CHUNK_SIZE, SEA_LEVEL, blockIndex, parseChunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';
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

/** Open ground between two stretches of road. Walkable — that is what `linkOk` checks —
 *  but slower than anything anybody laid. */
export const GAP_SPEED = 0.75;

/** What to call a road of a given quality, for the panel and the ledger. */
export function roadGrade(quality: number): string {
  if (quality < 0.95) return 'けもの道';
  if (quality < 1.12) return '土の道';
  if (quality < 1.34) return '砂利道';
  if (quality < 1.58) return '石畳';
  return '街道';
}

/** How far apart two road columns may be and still count as one road. */
export const MAX_LINK = 20;
/** Height a walker may gain or lose between two adjacent columns of a gap. */
export const MAX_STEP = 2;
/** Search cap. The graph is only what the player laid, so this is never reached in play. */
export const MAX_NODES = 4096;
/** Half width of a village's street cross, from `putRoad` in village.ts. */
export const STREET_REACH = VILLAGE_RADIUS - 8;

export interface RoadPoint {
  x: number;
  z: number;
  y: number;
  /** The surface, where it is known. Only set by `columnsIn`, so the minimap can draw a
   *  paved road differently from a dirt one. */
  b?: BlockId;
}

export type SurveyResult =
  | {
      connected: true;
      waypoints: RoadPoint[];
      length: number;
      /** Weighted speed factor over the whole road: the length divided by the time a
       *  walker spends on it. One stretch of stone brick in a mile of dirt therefore
       *  barely moves it, which is the honest answer. */
      quality: number;
    }
  /** Where each side's road runs out, and how far apart those two ends are. This is what
   *  the HUD points the player at: "the gap is here", not "walk that way". */
  | { connected: false; frontierFrom: RoadPoint; frontierTo: RoadPoint; missing: number };

export interface RoadWorld {
  edits: Map<string, Map<number, BlockId>>;
  getBlock(x: number, y: number, z: number): BlockId;
  heightAt(x: number, z: number): number;
  isLoadedAt(x: number, z: number): boolean;
}

export interface RoadTerrain {
  height(x: number, z: number): number;
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

export class RoadNetwork {
  /** `${x},${z}` -> the y of the walkable road surface. Player-laid columns only. */
  readonly columns = new Map<string, number>();
  /** `${x},${z}` -> what that surface is made of, which is what sets a route's speed. */
  readonly surfaces = new Map<string, BlockId>();
  /** Bumped whenever the index changes, so the transport layer can skip re-surveying a
   *  network nobody has touched. */
  revision = 0;
  /** Columns bucketed by `MAX_LINK`-sized tiles, so finding a column's neighbours is a
   *  look at nine tiles rather than a walk over the whole network. Rebuilt lazily when
   *  the index has moved on. */
  private readonly buckets = new Map<string, string[]>();
  private bucketRevision = -1;
  /** Per-village search results, thrown away whenever the network moves. A dozen routes
   *  between six villages is six searches and a handful of set lookups, not two searches
   *  per pair — which is what makes surveying the whole network every couple of seconds
   *  affordable while the player is still laying blocks. */
  private readonly seedCache = new Map<string, string[]>();
  private readonly reachCache = new Map<string, Map<string, string | null>>();
  private cacheRevision = -1;

  constructor(
    private readonly world: RoadWorld,
    private readonly terrain: RoadTerrain,
  ) {}

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

  /** A road with something standing on it is not a road, and this is also what keeps a
   *  house floor laid by village growth from being mistaken for one. */
  private blockedAbove(x: number, y: number, z: number): boolean {
    if (this.world.isLoadedAt(x, z)) return blockDef(this.world.getBlock(x, y + 1, z)).solid;
    const above = editAt(this.world, x, y + 1, z);
    return above !== undefined && blockDef(above).solid;
  }

  private qualifies(x: number, y: number, z: number): boolean {
    const id = editAt(this.world, x, y, z);
    if (id === undefined || !ROAD_BLOCKS.has(id)) return false;
    return !this.blockedAbove(x, y, z);
  }

  /** Re-evaluates a column after a block changed. Both the cell itself and the one below
   *  it matter: placing a crate on a path un-roads the path underneath. */
  onBlockChanged(x: number, y: number, z: number, previous: BlockId, next: BlockId): void {
    const touchesRoad =
      ROAD_BLOCKS.has(previous) || ROAD_BLOCKS.has(next) ||
      blockDef(previous).solid !== blockDef(next).solid;
    if (!touchesRoad) return;
    const before = this.columns.get(key(x, z));
    this.refresh(x, z, y);
    if (this.columns.get(key(x, z)) !== before) this.revision++;
  }

  /** Picks the highest qualifying road level in a column, looking a few blocks either
   *  side of where the change happened. */
  private refresh(x: number, z: number, around: number): void {
    let best = -1;
    for (let y = around + MAX_STEP; y >= around - MAX_STEP - 1; y--) {
      if (this.qualifies(x, y, z)) {
        best = y;
        break;
      }
    }
    const existing = this.columns.get(key(x, z));
    if (best < 0) {
      // Only drop the entry when the change was about the level we had indexed; a column
      // may legitimately hold a road well below the block that just moved.
      if (existing !== undefined && Math.abs(existing - around) <= MAX_STEP + 1) {
        this.columns.delete(key(x, z));
        this.surfaces.delete(key(x, z));
      }
      return;
    }
    this.columns.set(key(x, z), best);
    // Repaving a column changes nothing about where the road goes, only how fast it is
    // walked — so the material is refreshed whether or not the level moved.
    const surface = editAt(this.world, x, best, z);
    const was = this.surfaces.get(key(x, z));
    if (surface !== undefined) this.surfaces.set(key(x, z), surface);
    if (existing === best && was !== surface) this.revision++;
  }

  /** Road columns inside a rectangle, for drawing the network on the minimap.
   *
   *  Asked for every frame, so it reads the tiles that overlap the rectangle rather than
   *  the whole index: a player who has laid ten thousand blocks of road should not pay
   *  for all of them to draw the corner of it they are standing on. */
  columnsIn(x0: number, z0: number, x1: number, z1: number): RoadPoint[] {
    this.rebuildBuckets();
    const out: RoadPoint[] = [];
    for (let bz = Math.floor(z0 / MAX_LINK); bz <= Math.floor(z1 / MAX_LINK); bz++) {
      for (let bx = Math.floor(x0 / MAX_LINK); bx <= Math.floor(x1 / MAX_LINK); bx++) {
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

  /** Ground height at a column, from the world when it is loaded and from the generator
   *  when it is not — so a survey costs the same wherever the player is standing. */
  private groundAt(x: number, z: number): number {
    if (this.world.isLoadedAt(x, z)) {
      const top = this.world.heightAt(x, z);
      if (top >= 0) return top;
    }
    return this.terrain.height(x, z);
  }

  /** True when a walker could get from one column to the other across open ground. */
  private linkOk(a: RoadPoint, b: RoadPoint): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps === 0) return true;
    if (steps > MAX_LINK) return false;
    let previous = a.y;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(a.x + (dx * i) / steps);
      const z = Math.round(a.z + (dz * i) / steps);
      const ground = i === steps ? b.y : this.groundAt(x, z);
      if (Math.abs(ground - previous) > MAX_STEP) return false;
      // No routes across the sea, and none along a river bed that has no bridge on it.
      if (i < steps && ground <= SEA_LEVEL) return false;
      previous = ground;
    }
    return true;
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

  private touchesVillage(village: VillageRecord, column: RoadPoint): boolean {
    const street = this.nearestStreet(village, column.x, column.z);
    return this.linkOk(street, column);
  }

  private rebuildBuckets(): void {
    if (this.bucketRevision === this.revision) return;
    this.bucketRevision = this.revision;
    this.buckets.clear();
    for (const k of this.columns.keys()) {
      const p = this.point(k);
      const bk = key(Math.floor(p.x / MAX_LINK), Math.floor(p.z / MAX_LINK));
      const list = this.buckets.get(bk);
      if (list) list.push(k);
      else this.buckets.set(bk, [k]);
    }
  }

  /** Column keys that could be within `MAX_LINK` of a point. */
  private near(x: number, z: number): string[] {
    const bx = Math.floor(x / MAX_LINK);
    const bz = Math.floor(z / MAX_LINK);
    const out: string[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.buckets.get(key(bx + dx, bz + dz));
        if (list) out.push(...list);
      }
    }
    return out;
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
      if (Math.hypot(column.x - village.x, column.z - village.z) > VILLAGE_RADIUS + MAX_LINK) continue;
      if (!this.touchesVillage(village, column)) continue;
      seeds.push(k);
    }
    this.seedCache.set(village.id, seeds);
    return seeds;
  }

  /** Every road column reachable from a village, with the step that reached it.
   *
   *  Pavement first: the search walks onto touching columns until it can go no further,
   *  and only then allows itself a jump across open ground. Searching by hop count
   *  instead — which is what a plain queue does — would stride over a finished road in
   *  `MAX_LINK` leaps, and a road walked in leaps reads as though it were all gaps: the
   *  route would be surveyed as rough however carefully it had been paved, and a porter
   *  handed those waypoints would cut every corner.
   *
   *  Each column is still reached once and each candidate tested once, so this costs what
   *  the plain queue cost. The two queues only change the order. */
  private reachFrom(village: VillageRecord): Map<string, string | null> {
    this.freshen();
    const cached = this.reachCache.get(village.id);
    if (cached) return cached;
    this.rebuildBuckets();
    const seen = new Map<string, string | null>();
    const steps: string[] = [];
    const links: string[] = [];
    for (const k of this.seedsFor(village)) {
      if (seen.size >= MAX_NODES) break;
      seen.set(k, null);
      steps.push(k);
    }
    let head = 0;
    while ((head < steps.length || links.length > 0) && seen.size < MAX_NODES) {
      if (head < steps.length) {
        const key = steps[head++];
        this.walkOn(key, seen, steps);
        // Every column also gets a turn at jumping, once nothing is left to walk to.
        links.push(key);
        continue;
      }
      this.jumpFrom(links.shift() as string, seen, steps);
    }
    this.reachCache.set(village.id, seen);
    return seen;
  }

  /** Expands onto the eight columns touching this one. */
  private walkOn(from: string, seen: Map<string, string | null>, out: string[]): void {
    const here = this.point(from);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const k = key(here.x + dx, here.z + dz);
        if (seen.has(k)) continue;
        const y = this.columns.get(k);
        if (y === undefined || Math.abs(y - here.y) > MAX_STEP) continue;
        seen.set(k, from);
        out.push(k);
        if (seen.size >= MAX_NODES) return;
      }
    }
  }

  /** Expands across open ground to any column within `MAX_LINK`. */
  private jumpFrom(from: string, seen: Map<string, string | null>, out: string[]): void {
    const here = this.point(from);
    for (const k of this.near(here.x, here.z)) {
      if (seen.has(k)) continue;
      const to = this.point(k);
      if (Math.abs(to.x - here.x) > MAX_LINK || Math.abs(to.z - here.z) > MAX_LINK) continue;
      if (!this.linkOk(here, to)) continue;
      seen.set(k, from);
      out.push(k);
      if (seen.size >= MAX_NODES) return;
    }
  }

  /** How good the road is, as the factor a porter's speed is multiplied by.
   *
   *  Measured over the columns the player actually laid, and not over the last hop into
   *  each village: those are the villages' own generated streets, which nobody can pave
   *  and which would otherwise drag every short route down. It is the length divided by
   *  the time spent, so one stretch of stone brick in a mile of dirt barely moves it —
   *  the honest answer, and the reason paving is a job rather than a gesture.
   *
   *  A gap counts too. A dashed road is allowed, but walking the open ground between two
   *  stretches is slower than walking either of them, so filling a road in is worth
   *  something even when it was already "connected". */
  private qualityOf(chain: readonly RoadPoint[]): number {
    if (chain.length < 2) return 1;
    let length = 0;
    let time = 0;
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      if (step === 0) continue;
      const surface = this.surfaces.get(key(b.x, b.z)) ?? this.surfaces.get(key(a.x, a.z));
      const speed = step > 1.5 ? GAP_SPEED : ROAD_SPEED.get(surface ?? Block.DIRT_PATH) ?? 1;
      length += step;
      time += step / speed;
    }
    return time > 0 ? length / time : 1;
  }

  /** Walks the road from one village to the other, or reports where it runs out. */
  survey(from: VillageRecord, to: VillageRecord): SurveyResult {
    const reachFrom = this.reachFrom(from);
    let arrival: string | null = null;
    // Arriving means reaching any column that touches the far village's streets, and
    // those are exactly that village's own seeds. Intersecting two sets beats testing
    // every reached column against the geometry.
    for (const k of this.seedsFor(to)) {
      if (reachFrom.has(k)) {
        arrival = k;
        break;
      }
    }

    if (arrival !== null) {
      const chain: RoadPoint[] = [];
      for (let k: string | null = arrival; k !== null; k = reachFrom.get(k) ?? null) {
        chain.push(this.point(k));
      }
      chain.reverse();
      const waypoints: RoadPoint[] = [
        this.nearestStreet(from, chain[0].x, chain[0].z),
        ...chain,
        this.nearestStreet(to, chain[chain.length - 1].x, chain[chain.length - 1].z),
      ];
      let length = 0;
      for (let i = 1; i < waypoints.length; i++) {
        length += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
      }
      return { connected: true, waypoints, length, quality: this.qualityOf(chain) };
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
    };
  }

  /** The reached column closest to the far village, or the village's own street when its
   *  road has not been started at all. */
  private frontier(
    reached: Map<string, string | null>,
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
