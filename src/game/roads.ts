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

/** Blocks a player lays to make a road. Bare stone and dirt are deliberately absent:
 *  they are what the world is already made of, so they could not be told apart from it. */
export const ROAD_BLOCKS: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.DIRT_PATH,
  Block.GRAVEL,
  Block.COBBLESTONE,
  Block.MOSSY_COBBLESTONE,
  Block.OAK_PLANKS,
  Block.STONE_BRICKS,
  Block.SANDSTONE,
]);

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
}

export type SurveyResult =
  | { connected: true; waypoints: RoadPoint[]; length: number }
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
  /** Bumped whenever the index changes, so the transport layer can skip re-surveying a
   *  network nobody has touched. */
  revision = 0;
  /** Columns bucketed by `MAX_LINK`-sized tiles, so finding a column's neighbours is a
   *  look at nine tiles rather than a walk over the whole network. Rebuilt lazily when
   *  the index has moved on. */
  private readonly buckets = new Map<string, string[]>();
  private bucketRevision = -1;

  constructor(
    private readonly world: RoadWorld,
    private readonly terrain: RoadTerrain,
  ) {}

  /** Rebuilds the index from the persisted edits. Called after a save is applied, where
   *  almost nothing is loaded yet — which is exactly why the index reads edits and not
   *  the world. */
  seedFromEdits(): void {
    this.columns.clear();
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
        if (existing === undefined || existing < y) this.columns.set(key(x, z), y);
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
      }
      return;
    }
    if (existing === undefined || existing !== best) this.columns.set(key(x, z), best);
  }

  /** Road columns inside a rectangle, for drawing the network on the minimap. */
  columnsIn(x0: number, z0: number, x1: number, z1: number): RoadPoint[] {
    const out: RoadPoint[] = [];
    for (const [k, y] of this.columns) {
      const comma = k.indexOf(',');
      const x = Number(k.slice(0, comma));
      const z = Number(k.slice(comma + 1));
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      out.push({ x, z, y });
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

  /** Every road column reachable from a village, with the step that reached it. */
  private reachFrom(village: VillageRecord): Map<string, string | null> {
    this.rebuildBuckets();
    const seen = new Map<string, string | null>();
    const queue: string[] = [];
    // Seeds are the columns that touch the village's own streets.
    for (const k of this.columns.keys()) {
      if (seen.size >= MAX_NODES) break;
      const column = this.point(k);
      if (Math.hypot(column.x - village.x, column.z - village.z) > VILLAGE_RADIUS + MAX_LINK) continue;
      if (!this.touchesVillage(village, column)) continue;
      seen.set(k, null);
      queue.push(k);
    }
    for (let head = 0; head < queue.length && seen.size < MAX_NODES; head++) {
      const from = this.point(queue[head]);
      for (const k of this.near(from.x, from.z)) {
        if (seen.has(k)) continue;
        const to = this.point(k);
        if (Math.abs(to.x - from.x) > MAX_LINK || Math.abs(to.z - from.z) > MAX_LINK) continue;
        if (!this.linkOk(from, to)) continue;
        seen.set(k, queue[head]);
        queue.push(k);
        if (seen.size >= MAX_NODES) break;
      }
    }
    return seen;
  }

  /** Walks the road from one village to the other, or reports where it runs out. */
  survey(from: VillageRecord, to: VillageRecord): SurveyResult {
    const reachFrom = this.reachFrom(from);
    let arrival: string | null = null;
    for (const k of reachFrom.keys()) {
      if (this.touchesVillage(to, this.point(k))) {
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
      return { connected: true, waypoints, length };
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
