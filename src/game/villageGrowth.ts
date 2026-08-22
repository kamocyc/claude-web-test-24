/** Building the extra houses a village earns.
 *
 *  Growth is written as ordinary recorded edits rather than fed back into terrain
 *  generation. `World.edits` is the only persisted block store and `World.addChunk`
 *  replays it on load (`world.ts:59`), so a grown village survives being walked away from
 *  for free — no worker protocol change, no plan cache to invalidate across N workers, and
 *  no world that differs depending on when a chunk happened to be generated.
 *
 *  Applying is idempotent, which is what removes the need to track anything: a village
 *  that grew while its chunks were unloaded simply builds itself when the player returns. */

import { Block, blockDef, cropAt, isFarmland, type BlockId } from '../world/blocks';
import { CHUNK_SIZE, type Chunk } from '../world/chunk';
import type { World } from '../world/world';
import {
  planGrowth,
  planOutpost,
  type Footprint,
  type GrowthPlan,
  type Pad,
  type Placement,
  type VillagerMarker,
} from '../world/generation/village';
import type { VillageRecord } from './villages';

/** What growth is allowed to build over. Anything else — a chest, a torch, a wall the
 *  player raised, the village's own original houses — is left where it is. The worst this
 *  can do is leave a hole in a new building; it can never eat somebody's work. */
const NATURAL: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.AIR,
  Block.GRASS,
  Block.DIRT,
  Block.SAND,
  Block.SNOW,
  Block.TALL_GRASS,
  Block.FLOWER_RED,
  Block.FLOWER_YELLOW,
  Block.DEAD_BUSH,
  Block.SUGAR_CANE,
  Block.CACTUS,
  Block.OAK_LEAVES,
  Block.BIRCH_LEAVES,
  Block.SPRUCE_LEAVES,
  Block.WATER,
]);

/** Crops and the soil under them are built over too, and they have to be: a village's own
 *  fields stand on the ring of ground its next row of houses is built on, so refusing to
 *  touch them left a house with its floor missing wherever last stage's wheat was. They
 *  are soil and plants, which is what the rest of this list is. The cost is that a field
 *  the player planted inside the village can be built on, the same way a lawn can. */
function buildableOver(id: BlockId): boolean {
  return NATURAL.has(id) || isFarmland(id) || cropAt(id) !== null;
}

const cache = new Map<string, GrowthPlan>();
/** Placements collapsed to one per cell, keyed by the plan they came from. */
const finalised = new WeakMap<GrowthPlan, Placement[]>();

/** The last block a plan asks for in each cell.
 *
 *  A plan is written the way a builder works: raise the walls, then knock the doorway and
 *  the windows out of them. That is fine for terrain generation, which overwrites without
 *  asking, but growth may only build over soil and air — so the doorway's `AIR` arrived to
 *  find a wall in the way and was refused, and every grown house was a sealed box with a
 *  villager inside it. Collapsing the plan first means each cell is written once, with the
 *  block the builder actually finished with. */
function finalPlacements(plan: GrowthPlan): Placement[] {
  const cached = finalised.get(plan);
  if (cached) return cached;
  const byCell = new Map<string, Placement>();
  for (const p of plan.placements) byCell.set(`${p.x},${p.y},${p.z}`, p);
  const out = [...byCell.values()];
  finalised.set(plan, out);
  return out;
}

/** Deterministic and cached: the same village at the same stage always grows the same
 *  buildings, however many times it is asked. */
export function growthFor(
  seed: number,
  village: VillageRecord,
  stage: number,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): GrowthPlan {
  const key = `${village.id},${stage}`;
  let plan = cache.get(key);
  if (!plan) {
    // Every earlier stage's plots count as taken too. Without this a village that grew
    // twice would try to raise its second pair of houses through its first pair.
    const taken = [...occupied];
    for (let earlier = 1; earlier < stage; earlier++) {
      taken.push(...growthFor(seed, village, earlier, occupied).footprints);
    }
    plan = planGrowth(
      seed,
      { cellX: 0, cellZ: 0, x: village.x, z: village.z },
      village.baseY,
      village.variant,
      stage,
      taken,
    );
    cache.set(key, plan);
  }
  return plan;
}

/** The hamlet's own buildings. Cached on the same terms as growth, and just as
 *  deterministic: the same hamlet always builds the same two houses. */
export function outpostBuildings(seed: number, village: VillageRecord): GrowthPlan {
  const key = `${village.id},outpost`;
  let plan = cache.get(key);
  if (!plan) {
    plan = planOutpost(seed, { cellX: 0, cellZ: 0, x: village.x, z: village.z }, village.baseY, village.variant);
    cache.set(key, plan);
  }
  return plan;
}

export function clearGrowthCache(): void {
  cache.clear();
  paving.clear();
}

function inChunk(chunk: Chunk, p: { x: number; z: number }): boolean {
  return (
    p.x >= chunk.originX && p.x < chunk.originX + CHUNK_SIZE &&
    p.z >= chunk.originZ && p.z < chunk.originZ + CHUNK_SIZE
  );
}

/** The level of the road at a column, if the road index holds one. */
export type RoadLookup = (x: number, z: number) => number | undefined;

/** As much of a world as deciding "is that road ours" needs. */
export interface BlockSource {
  getBlock(x: number, y: number, z: number): BlockId;
}

/** Blocks of headroom a road keeps. The index itself only reads the cell directly above a
 *  road, but a porter is nearly two blocks tall and has to fit through. */
const ROAD_HEADROOM = 2;

/** How far above or below a plot's floor a road still counts as running through it. A road
 *  further off than this is a bridge over the plot or a tunnel under it, and a house is no
 *  trouble to either. */
const ROAD_REACH = 2;

/** True when a road runs through a plot.
 *
 *  Every block that would land on the road is refused, so a village that built here anyway
 *  raised a house with a road-shaped hole through it — a gap in two walls, a missing strip
 *  of floor, and the player's road running in one side and out the other. To whoever laid
 *  that road it reads as the village having eaten it.
 *
 *  So the plot is given up instead and the village builds elsewhere. The road was an
 *  afternoon's work; the house is one of eight the stage could have picked.
 *
 *  `own` is everything the village itself has put down, cell by cell, and without it this
 *  answers yes to every village that has ever built anything. A village paves a doorstep
 *  outside each door, and it builds its floors out of planks — both of them recorded
 *  edits, both of them blocks a road can be made of, so the index calls them road. A
 *  column only counts against a plot when what is standing there is not what this village
 *  planned to stand there. */
export function roadCrosses(
  plot: Footprint,
  floorY: number,
  world: BlockSource,
  roadAt?: RoadLookup,
  own?: ReadonlyMap<string, BlockId>,
): boolean {
  if (!roadAt) return false;
  // A plot with a house already on it is never given up. Somebody paving right up to
  // their own depot's door — the most ordinary thing a player does with a road — would
  // otherwise take that building off the list of places goods can leave from.
  const middle = { x: plot.x0 + (plot.w >> 1), z: plot.z0 + (plot.d >> 1) };
  if (ours(world, middle.x, floorY - 1, middle.z, own)) return false;
  for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
    for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
      const road = roadAt(x, z);
      if (road === undefined || Math.abs(road - floorY) > ROAD_REACH) continue;
      if (ours(world, x, road, z, own)) continue;
      return true;
    }
  }
  return false;
}

/** True when the block standing at a cell is the one this village put there.
 *
 *  The index cannot tell a road apart from a plank floor or a doorstep, because they are
 *  the same blocks in the same kind of recorded edit. What tells them apart is whether the
 *  village planned it: everything else at that cell is somebody else's. */
function ours(
  world: BlockSource,
  x: number,
  y: number,
  z: number,
  own?: ReadonlyMap<string, BlockId>,
): boolean {
  const planned = own?.get(`${x},${y},${z}`);
  return planned !== undefined && planned === world.getBlock(x, y, z);
}

/** Writes one placement, unless something worth keeping already stands there. */
function place(
  world: World,
  p: Placement,
  roadAt?: RoadLookup,
  own?: ReadonlyMap<string, BlockId>,
): boolean {
  const current = world.getBlock(p.x, p.y, p.z);
  if (current === p.b) return false;
  if (!buildableOver(current)) return false;
  // A village growing over its own road used to be invisible, because a road was allowed
  // to skip twenty blocks and the survey simply stepped over the sealed column. Now one
  // column is the difference between one road and two, so the wall yields: the road was
  // somebody's afternoon, and a house can stand a block to the side.
  //
  // The surface itself is defended against everything, not only against being built on:
  // clearing a plot writes air, levelling one writes soil, and either of them landing on
  // a gravel road would take it away — gravel being both a road a player lays and ground
  // the world is made of, which is the one case the list above cannot tell apart.
  //
  // A village's own doorstep is not a road it has to build around, or its next row of
  // houses could not put a wall where the last row's path runs.
  if (roadAt) {
    const road = roadAt(p.x, p.z);
    if (road !== undefined && !ours(world, p.x, road, p.z, own)) {
      if (p.y === road) return false;
      if (blockDef(p.b).solid && p.y > road && p.y <= road + ROAD_HEADROOM) return false;
    }
  }
  return world.setBlock(p.x, p.y, p.z, p.b);
}

/** How far growth will fill downwards to put ground under a plot, and how far it will cut
 *  back into a rise above one. A plot needing more than this is on a cliff, and a village
 *  that would move a cliff is a village that would move anything. */
const PAD_FILL = 8;
const PAD_CUT = 5;
/** A block of ground beyond the walls, so the doorstep is not a ledge. */
const PAD_MARGIN = 1;

/** Every cell a plan writes, so levelling the ground for it does not fight it.
 *
 *  A pad clears the air above a plot and fills the ground under it, and both of those
 *  ranges cover cells the plan itself has something to put in — a field's crops stand in
 *  the air over its soil, a house's floor is the top of its own ground. Left alone the two
 *  take turns undoing each other every time the chunk is loaded. */
const written = new WeakMap<GrowthPlan, Set<string>>();

function planCells(plan: GrowthPlan): Set<string> {
  const cached = written.get(plan);
  if (cached) return cached;
  const out = new Set<string>();
  for (const p of finalPlacements(plan)) out.add(`${p.x},${p.y},${p.z}`);
  written.set(plan, out);
  return out;
}

/** Levels the ground a plot is about to be built on, within one chunk.
 *
 *  This is what stops a grown house standing in the air. The plateau a village sits on is
 *  only flat for its inner twenty-four blocks; over the next fourteen the terrain fades
 *  back to whatever the land was doing, and the back row of plots a growing village fills
 *  reaches into that band. Laying a floor at the village's own level out there leaves the
 *  downhill half of the house over a hole.
 *
 *  A hamlet has done exactly this since it was written — filling up to its floor and
 *  clearing the air above it — because a hamlet is built into ground nobody flattened
 *  first. A grown house needs the same treatment for the same reason.
 *
 *  Per column, so a plot that straddles two chunks is levelled by each of them in turn,
 *  and only ever over soil, plants and air: the road guard and the whole point of
 *  `place` still hold. */
function gradePad(
  world: World,
  pad: Pad,
  chunk: Chunk,
  surface: BlockId,
  writes: ReadonlySet<string>,
  roadAt?: RoadLookup,
  own?: ReadonlyMap<string, BlockId>,
): number {
  let changed = 0;
  for (let x = pad.x0 - PAD_MARGIN; x < pad.x0 + pad.w + PAD_MARGIN; x++) {
    for (let z = pad.z0 - PAD_MARGIN; z < pad.z0 + pad.d + PAD_MARGIN; z++) {
      if (!inChunk(chunk, { x, z })) continue;
      // Top down, so a cut never leaves a block hanging over the space it just made.
      for (let y = pad.y + PAD_CUT; y > pad.y; y--) {
        if (writes.has(`${x},${y},${z}`)) continue;
        if (place(world, { x, y, z, b: Block.AIR }, roadAt, own)) changed++;
      }
      // Then up to the floor from wherever the ground actually is. Stopping at the first
      // thing that will not give way is what keeps a pad from burying somebody's cellar.
      for (let y = pad.y; y > pad.y - PAD_FILL; y--) {
        if (writes.has(`${x},${y},${z}`)) continue;
        if (blockDef(world.getBlock(x, y, z)).solid) break;
        if (!place(world, { x, y, z, b: y === pad.y ? surface : Block.DIRT }, roadAt, own)) break;
        changed++;
      }
    }
  }
  return changed;
}

/** What a village lays its ground with. */
function padSurface(village: VillageRecord): BlockId {
  return village.variant === 'desert' ? Block.SAND : village.variant === 'snowy' ? Block.SNOW : Block.GRASS;
}

/** True when a column falls inside any of these plots. */
function within(plots: readonly Footprint[], x: number, z: number): boolean {
  return plots.some((f) => x >= f.x0 && x < f.x0 + f.w && z >= f.z0 && z < f.z0 + f.d);
}

/** The plots of one plan that a road runs through, which is everything the plan wanted to
 *  build there: its blocks, its villager and their chest. */
function givenUp(
  plan: GrowthPlan,
  floorY: number,
  world: BlockSource,
  roadAt?: RoadLookup,
  own?: ReadonlyMap<string, BlockId>,
): Footprint[] {
  if (!roadAt) return [];
  return plan.footprints.filter((plot) => roadCrosses(plot, floorY, world, roadAt, own));
}

/** Every block a village means to have standing, across every stage it has reached. */
function ownBlocks(plans: readonly GrowthPlan[]): Map<string, BlockId> {
  const out = new Map<string, BlockId>();
  for (const plan of plans) {
    for (const p of finalPlacements(plan)) out.set(`${p.x},${p.y},${p.z}`, p.b);
  }
  return out;
}

export interface GrowthResult {
  /** Villagers whose houses now exist and who still need to be spawned. */
  villagers: VillagerMarker[];
  chests: { x: number; y: number; z: number; loot: string }[];
  changed: number;
}

/** Applies every stage this village has reached that falls inside one chunk. */
export function applyGrowth(
  world: World,
  seed: number,
  village: VillageRecord,
  chunk: Chunk,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
  roadAt?: RoadLookup,
): GrowthResult {
  const result: GrowthResult = { villagers: [], chests: [], changed: 0 };
  const surface = padSurface(village);
  const plans = plansFor(seed, village, occupied);
  const own = roadAt ? ownPaving(seed, village, occupied) : undefined;
  for (const { plan, floorY, optional } of plans) {
    // A road through a plot means the village builds somewhere else instead. A hamlet is
    // exempt: it is somewhere the game sends the player, so it has to exist.
    const dropped = optional ? givenUp(plan, floorY, world, roadAt, own) : [];
    for (const pad of plan.pads) {
      if (within(dropped, pad.x0, pad.z0)) continue;
      result.changed += gradePad(world, pad, chunk, surface, planCells(plan), roadAt, own);
    }
    for (const p of finalPlacements(plan)) {
      if (!inChunk(chunk, p)) continue;
      if (within(dropped, p.x, p.z)) continue;
      if (place(world, p, roadAt, own)) result.changed++;
    }
    for (const v of plan.villagers) {
      if (inChunk(chunk, v) && !within(dropped, v.x, v.z)) result.villagers.push(v);
    }
    for (const c of plan.chests) {
      if (inChunk(chunk, c) && !within(dropped, c.x, c.z)) result.chests.push(c);
    }
  }
  return result;
}

/** Everything a village has put down for itself. Anyone asking whether a road runs
 *  through one of its plots needs this, or its own doorsteps and floorboards answer yes. */
export function ownPaving(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): ReadonlyMap<string, BlockId> {
  // Kept, because the caller is on the path the player walks: the building list is thrown
  // away whenever the road network moves, and the road network moves on every block a
  // shovel treads. What it is made of only changes when the village does.
  const key = `${village.id},${village.stage},${village.outpost ? 'h' : 'v'}`;
  const cached = paving.get(key);
  if (cached) return cached;
  const built = ownBlocks(plansFor(seed, village, occupied).map((p) => p.plan));
  paving.set(key, built);
  return built;
}

const paving = new Map<string, Map<string, BlockId>>();

/** Every plan a village owes, with the floor level its buildings stand at.
 *
 *  A hamlet's houses sit on the pad it levelled for itself; a growth stage's sit one above
 *  the plateau, which is the top solid block of it. The two numbers differ by one and
 *  everything that has to reason about a plot — is there a road through it, how high does
 *  its ground have to be — needs the right one. */
function plansFor(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): { plan: GrowthPlan; floorY: number; optional: boolean }[] {
  const out: { plan: GrowthPlan; floorY: number; optional: boolean }[] = [];
  // A hamlet has no generated buildings at all, so its own two houses are what it is
  // made of; everything after that is the growth it earns like anywhere else.
  if (village.outpost) {
    out.push({ plan: outpostBuildings(seed, village), floorY: village.baseY, optional: false });
  }
  for (let stage = 1; stage <= village.stage; stage++) {
    out.push({ plan: growthFor(seed, village, stage, occupied), floorY: village.baseY + 1, optional: true });
  }
  return out;
}

/** Every villager a village owes, wherever their house happens to fall. Chunk by chunk
 *  would strand the ones whose house is in a chunk that arrives later — and whichever
 *  chunk came first would close the gate behind them. */
export function growthVillagers(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
  world?: BlockSource,
  roadAt?: RoadLookup,
): VillagerMarker[] {
  const out: VillagerMarker[] = [];
  const plans = plansFor(seed, village, occupied);
  const own = roadAt && world ? ownPaving(seed, village, occupied) : undefined;
  for (const { plan, floorY, optional } of plans) {
    const dropped = optional && world ? givenUp(plan, floorY, world, roadAt, own) : [];
    for (const v of plan.villagers) if (!within(dropped, v.x, v.z)) out.push(v);
  }
  return out;
}

/** Every chunk key a village's growth could reach, so a stage-up can rebuild the ones
 *  that happen to be loaded right now. */
export function growthChunks(
  seed: number,
  village: VillageRecord,
  occupied: readonly { x0: number; z0: number; w: number; d: number }[],
): { cx: number; cz: number }[] {
  const seen = new Set<string>();
  const out: { cx: number; cz: number }[] = [];
  const plans: GrowthPlan[] = [];
  if (village.outpost) plans.push(outpostBuildings(seed, village));
  for (let stage = 1; stage <= village.stage; stage++) {
    plans.push(growthFor(seed, village, stage, occupied));
  }
  const reach = (x: number, z: number): void => {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cx, cz });
  };
  for (const plan of plans) {
    for (const p of plan.placements) reach(p.x, p.z);
    // The levelled ground reaches a block further out than anything standing on it.
    for (const pad of plan.pads) {
      reach(pad.x0 - PAD_MARGIN, pad.z0 - PAD_MARGIN);
      reach(pad.x0 + pad.w + PAD_MARGIN - 1, pad.z0 - PAD_MARGIN);
      reach(pad.x0 - PAD_MARGIN, pad.z0 + pad.d + PAD_MARGIN - 1);
      reach(pad.x0 + pad.w + PAD_MARGIN - 1, pad.z0 + pad.d + PAD_MARGIN - 1);
    }
  }
  return out;
}
