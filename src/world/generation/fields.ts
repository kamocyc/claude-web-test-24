/** The fields a town works, out past its last street.
 *
 *  Everything else the economy eats is dug or made somewhere the player chose. Food is not:
 *  a town feeds itself, because a settlement that cannot put bread on its own table is not
 *  a settlement, it is a depot with houses. So every town ploughs the ring of land around
 *  itself, and keeps ploughing more of it as it grows.
 *
 *  Two things follow from that and are worth stating plainly, because they are what makes
 *  the fields readable from a hilltop:
 *
 *  They are *big*. A town's fields cover about twice the ground its blocks stand on — the
 *  built town is the small part of a town, which is true of every real one and was not true
 *  of this game's. And they are *outside*: a ring of parcels beyond the outermost street,
 *  spread around the compass so the town keeps its shape at the middle and spills into
 *  farmland at the edge.
 *
 *  Pure geometry and one hash, exactly like `districts.ts`. No blocks are written and no
 *  world is read, so the layout is the same layout however and whenever it is asked for —
 *  which is what lets the economy count acres for a town whose chunks are nowhere near
 *  loaded. */

import { hashInts, mulberry32 } from '../../core/rng';
import {
  BLOCKS_PER_STAGE,
  BLOCK_SIZE,
  GRID_HIGH,
  GRID_LOW,
  INITIAL_BLOCKS,
  MAX_TOWN_STAGE,
} from './districts';

/** One parcel, square. Twenty-three across, which is what fits between the outermost
 *  street and the edge of the plateau. */
export const FIELD_SIZE = 23;
/** Places around a town a parcel can stand: the four sides and the four corners. */
export const FIELD_SLOTS = 8;
/** How far out a parcel's middle sits, measured along the axis rather than as the crow
 *  flies — the town it stands outside of is a square grid, so the belt around it is a
 *  square belt. Past the outermost street (29) with room for a road between the town and
 *  its fields, and near enough that the four along the sides sit on the plateau. */
export const FIELD_RING = 44;
/** Watercourses run down every eighth column, so nothing is more than four from one —
 *  which is exactly how far farmland looks for water in `ticks.ts`. */
export const CHANNEL_EVERY = 8;
export const CHANNEL_OFFSET = 3;

/** The four sides, then the four corners. A town's first fields go along its sides, where
 *  the plateau is flat; the corners are earned, and are the ones that end up draped over
 *  whatever the land outside was doing. */
const SLOT_DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];

/** Blocks of the street grid a town at this stage has built on. */
export function builtBlocks(stage: number): number {
  const total = (GRID_HIGH - GRID_LOW + 1) ** 2;
  return Math.min(total, INITIAL_BLOCKS + BLOCKS_PER_STAGE * Math.max(0, stage));
}

/** Columns of field a town at this stage wants: twice the ground its blocks stand on.
 *
 *  Derived rather than chosen, so the fields grow because the town did and the ratio
 *  cannot drift when the grid changes. */
export function fieldTarget(stage: number): number {
  return 2 * builtBlocks(stage) * BLOCK_SIZE * BLOCK_SIZE;
}

/** Parcels ploughed by this stage. Rounded, so the fields land within half a parcel of
 *  twice the built area at every stage. */
export function fieldCount(stage: number): number {
  return Math.min(FIELD_SLOTS, Math.round(fieldTarget(stage) / (FIELD_SIZE * FIELD_SIZE)));
}

/** Columns those parcels actually cover, before the ground has its say. */
export function fieldArea(stage: number): number {
  return fieldCount(stage) * FIELD_SIZE * FIELD_SIZE;
}

export interface FieldParcel {
  /** Build order, 0 first. */
  index: number;
  /** Which of the eight places round the belt it stands in: 0-3 a side, 4-7 a corner. */
  slot: number;
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** The stage that ploughs it. */
  stage: number;
}

/** Every parcel a town will ever plough, in the order it ploughs them.
 *
 *  The one roll is which way round the ring the sequence starts, so two towns of the same
 *  size are not the same picture. Its own stream, off its own constant: the fields must
 *  not shift a single number in the streams that place the town itself. */
export function townFields(seed: number, site: { x: number; z: number }): FieldParcel[] {
  // A quarter turn, so two towns of the same size are not the same picture. Quarter turns
  // only: the sides have to stay sides, or a town's first field lands on its corner where
  // the ground is worst.
  const turn = Math.floor(mulberry32(hashInts(seed ^ 0x71e1d5, site.x, site.z))() * 4);
  const half = (FIELD_SIZE - 1) / 2;
  const out: FieldParcel[] = [];
  const ever = fieldCount(MAX_TOWN_STAGE);
  for (let index = 0; index < ever; index++) {
    const group = index < 4 ? 0 : 4;
    const slot = group + ((index % 4) + turn) % 4;
    const [dx, dz] = SLOT_DIRS[slot];
    const cx = site.x + dx * FIELD_RING;
    const cz = site.z + dz * FIELD_RING;
    out.push({
      index,
      slot,
      x0: cx - half,
      z0: cz - half,
      w: FIELD_SIZE,
      d: FIELD_SIZE,
      stage: stageOf(index),
    });
  }
  return out;
}

/** The parcels standing at a stage. */
export function fieldsAt(seed: number, site: { x: number; z: number }, stage: number): FieldParcel[] {
  return townFields(seed, site).filter((parcel) => parcel.stage <= stage);
}

/** Which stage ploughs the `n`-th parcel. */
function stageOf(index: number): number {
  for (let stage = 0; stage <= MAX_TOWN_STAGE; stage++) {
    if (index < fieldCount(stage)) return stage;
  }
  return MAX_TOWN_STAGE;
}

/** Whether a column is a watercourse rather than soil. Lines down the parcel, stopping one
 *  short of each end so the water sits in a trough of its own soil and stays there. */
export function isChannel(parcel: FieldParcel, x: number, z: number): boolean {
  const dx = x - parcel.x0;
  const dz = z - parcel.z0;
  if (dz < 1 || dz > parcel.d - 2) return false;
  return dx % CHANNEL_EVERY === CHANNEL_OFFSET;
}
