/** Ploughing a town's fields into the world.
 *
 *  The layout is decided in `fields.ts` without looking at anything; this is the half that
 *  meets the ground. It writes ordinary recorded edits, exactly as village growth does, so
 *  a field survives being walked away from without any of it being generated twice.
 *
 *  The ground gets a say. A parcel is not levelled — a town does not bulldoze a hill to
 *  square off a field, and a plateau of new soil hanging over a valley is the ugliest thing
 *  this game can draw. Each column is tilled at its own height, and only where the land is
 *  quiet enough to plough: a boulder, a pond or a bank of a stream is simply left in the
 *  middle of the field, the way one is in a real one.
 *
 *  Water is the reason the fields are striped. `ticks.ts` dries out farmland with no water
 *  within four blocks and wilts whatever is growing on it, so a field with no watercourses
 *  would be a field of dead wheat within an afternoon. Every eighth column is a channel,
 *  and a channel cell is only filled where the ground around it is high enough to hold it —
 *  which is why a field on a slope is a field of dry stripes, and looks it. */

import { Block, cropAt, isFarmland, type BlockId } from '../world/blocks';
import { toChunkCoord } from '../world/chunk';
import type { World } from '../world/world';
import { hashInts } from '../core/rng';
import { fieldsAt, isChannel, type FieldParcel, type FieldSurvey } from '../world/generation/fields';
import type { VillageRecord } from './villages';

/** Ground a field may be ploughed out of. Anything else — a road, a wall, a chest, a tree
 *  somebody left standing — stays exactly where it is. */
const SOIL: ReadonlySet<BlockId> = new Set<BlockId>([
  Block.GRASS,
  Block.DIRT,
  Block.SAND,
  Block.SNOW,
  Block.FARMLAND,
  Block.FARMLAND_WET,
]);

/** What may be standing on that ground and be cleared to plough it. */
function clearable(id: BlockId): boolean {
  return (
    id === Block.AIR
    || id === Block.TALL_GRASS
    || id === Block.FLOWER_RED
    || id === Block.FLOWER_YELLOW
    || id === Block.DEAD_BUSH
    || cropAt(id) !== null
  );
}

/** Every chunk any of a town's fields touches. */
export function fieldChunks(
  seed: number,
  village: VillageRecord,
  survey?: FieldSurvey,
): { cx: number; cz: number }[] {
  const seen = new Set<string>();
  const out: { cx: number; cz: number }[] = [];
  for (const parcel of fieldsAt(seed, village, village.stage, survey)) {
    for (const [x, z] of corners(parcel)) {
      const cx = toChunkCoord(x);
      const cz = toChunkCoord(z);
      const key = `${cx},${cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cx, cz });
    }
  }
  return out;
}

function corners(parcel: FieldParcel): [number, number][] {
  const out: [number, number][] = [];
  // Every chunk the rectangle crosses, not only its four corners: a parcel is wider than a
  // chunk, so the middle of one can fall in a chunk no corner is in.
  for (let z = parcel.z0; z < parcel.z0 + parcel.d; z += 8) {
    for (let x = parcel.x0; x < parcel.x0 + parcel.w; x += 8) out.push([x, z]);
  }
  out.push([parcel.x0 + parcel.w - 1, parcel.z0 + parcel.d - 1]);
  return out;
}

export interface FieldWork {
  /** Parcels ploughed by this call. */
  parcels: number;
  /** Columns of soil turned over. */
  tilled: number;
  /** Columns of water dug. */
  watered: number;
}

/** Ploughs whatever of a town's fields it owes and can reach.
 *
 *  A parcel is written whole or not at all: the channels have to know what their
 *  neighbours are, and a half-written one would spill its water into the chunk that had not
 *  arrived yet. A parcel whose chunks are not all loaded is left for the next time the
 *  player walks over — which is the same bargain village growth makes, and needs no state
 *  to remember. */
export function applyFields(
  world: World,
  seed: number,
  village: VillageRecord,
  roadLevelAt?: (x: number, z: number) => number | undefined,
  survey?: FieldSurvey,
): FieldWork {
  const work: FieldWork = { parcels: 0, tilled: 0, watered: 0 };
  if (village.outpost) return work;
  for (const parcel of fieldsAt(seed, village, village.stage, survey)) {
    if (!loaded(world, parcel)) continue;
    if (ploughed(world, parcel)) continue;
    const done = plough(world, seed, parcel, roadLevelAt);
    if (done.tilled === 0) continue;
    work.parcels += 1;
    work.tilled += done.tilled;
    work.watered += done.watered;
  }
  return work;
}

/** Whether every chunk the parcel lies in is in memory. */
function loaded(world: World, parcel: FieldParcel): boolean {
  for (const [x, z] of corners(parcel)) {
    if (!world.hasChunk(toChunkCoord(x), toChunkCoord(z))) return false;
  }
  return true;
}

/** Whether this parcel has been ploughed already. Read off the ground rather than
 *  remembered: the world is the record, and one sample of it is cheaper than any bookkeeping
 *  that could disagree with it. */
function ploughed(world: World, parcel: FieldParcel): boolean {
  const x = parcel.x0 + (parcel.w - 1) / 2;
  const z = parcel.z0 + (parcel.d - 1) / 2;
  const ground = groundAt(world, x, z);
  if (ground === null) return false;
  const at = world.getBlock(x, ground, z);
  return isFarmland(at) || at === Block.WATER;
}

/** The soil under a column: the top block, less whatever is growing on it. The height map
 *  counts the tall grass, and a field is ploughed out of the ground under it. */
function groundAt(world: World, x: number, z: number): number | null {
  let y = world.heightAt(x, z);
  if (y < 0) return null;
  for (let step = 0; step < 3 && y >= 0 && clearable(world.getBlock(x, y, z)); step++) y--;
  return y < 0 ? null : y;
}

function plough(
  world: World,
  seed: number,
  parcel: FieldParcel,
  roadLevelAt?: (x: number, z: number) => number | undefined,
): { tilled: number; watered: number } {
  let tilled = 0;
  let watered = 0;
  for (let z = parcel.z0; z < parcel.z0 + parcel.d; z++) {
    for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
      const top = tillable(world, x, z, roadLevelAt);
      if (top === null) continue;
      if (isChannel(parcel, x, z) && holdsWater(world, x, z, top)) {
        world.setBlock(x, top, z, Block.WATER);
        watered++;
        continue;
      }
      world.setBlock(x, top, z, Block.FARMLAND);
      // Wheat, mostly ripe. It is scenery — the harvest is a number the town keeps, not
      // something anybody reaps a block at a time — so it is planted at the stage it
      // spends its life at rather than grown from nothing.
      const grown = hashInts(seed ^ 0x63a0b, x, z) % 4;
      world.setBlock(x, top + 1, z, grown === 0 ? Block.WHEAT_2 : Block.WHEAT_3);
      tilled++;
    }
  }
  return { tilled, watered };
}

/** The level to plough a column at, or null when it is not to be touched. */
function tillable(
  world: World,
  x: number,
  z: number,
  roadLevelAt?: (x: number, z: number) => number | undefined,
): number | null {
  if (roadLevelAt?.(x, z) !== undefined) return null;
  const top = groundAt(world, x, z);
  if (top === null) return null;
  if (!SOIL.has(world.getBlock(x, top, z))) return null;
  if (!clearable(world.getBlock(x, top + 1, z))) return null;
  return top;
}

/** Whether a channel cell would keep the water it is given: every neighbour has to stand
 *  at least as high, or it runs out into the field and off down the hill. */
function holdsWater(world: World, x: number, z: number, top: number): boolean {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    // The rest of this same channel, already dug. Water beside water at one level is a
    // ditch, not a leak.
    if (world.getBlock(x + dx, top, z + dz) === Block.WATER) continue;
    const beside = groundAt(world, x + dx, z + dz);
    if (beside === null || beside < top) return false;
  }
  return true;
}

/** What is actually standing in a town's fields right now.
 *
 *  The plan says how much land a town works and the economy runs off that; this counts
 *  what the ground turned out to allow. The two differ wherever a hill, a pond or somebody
 *  else's road got there first, and that difference is worth being able to see. */
export function countFields(
  world: World,
  seed: number,
  village: VillageRecord,
  survey?: FieldSurvey,
): { soil: number; crops: number; water: number } {
  const out = { soil: 0, crops: 0, water: 0 };
  if (village.outpost) return out;
  for (const parcel of fieldsAt(seed, village, village.stage, survey)) {
    for (let z = parcel.z0; z < parcel.z0 + parcel.d; z++) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
        const ground = groundAt(world, x, z);
        if (ground === null) continue;
        const at = world.getBlock(x, ground, z);
        if (at === Block.WATER) out.water++;
        else if (isFarmland(at)) out.soil++;
        if (cropAt(world.getBlock(x, ground + 1, z))) out.crops++;
      }
    }
  }
  return out;
}
