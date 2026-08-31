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
 *  of this game's. And they are *outside*: a compact strip beyond the outermost street,
 *  kept on the best of four sides so the town stays legible at the middle and agriculture
 *  remains a district rather than scattered decoration.
 *
 *  Pure geometry and one hash, exactly like `districts.ts`. No blocks are written and no
 *  world is read, so the layout is the same layout however and whenever it is asked for —
 *  which is what lets the economy count acres for a town whose chunks are nowhere near
 *  loaded. */

import {
  BLOCKS_PER_STAGE,
  BLOCK_SIZE,
  farmSideFor,
  INITIAL_BLOCKS,
  MAX_TOWN_STAGE,
} from './districts';

/** One parcel, square. Twenty-three across, which is what fits between the outermost
 *  street and the edge of the plateau. */
export const FIELD_SIZE = 23;
/** Parcels visible by the old named-rank milestone. Kept as a useful scale constant. */
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

/** Four parcels across makes one readable agricultural strip; further growth adds rows
 *  beyond it instead of scattering lone squares around every side of town. */
const FIELD_ROW = 4;
export const FIELD_PITCH = FIELD_SIZE + 1;
const FIELD_CROSS: readonly number[] = [-36, -12, 12, 36];
const FIELD_SEARCH_AHEAD = FIELD_ROW * 8;
const FIELD_SIDE_SURVEY = FIELD_ROW * 8;
const SIDE_DIRS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/** Blocks of the street grid a town at this stage has built on. */
export function builtBlocks(stage: number): number {
  const grown = Math.max(0, Math.floor(stage));
  if (grown <= MAX_TOWN_STAGE) {
    return Math.min(16, INITIAL_BLOCKS + BLOCKS_PER_STAGE * grown);
  }
  return 16 + BLOCKS_PER_STAGE * (grown - MAX_TOWN_STAGE);
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
  return Math.ceil(fieldTarget(stage) / (FIELD_SIZE * FIELD_SIZE));
}

/** Columns those parcels actually cover, before the ground has its say. */
export function fieldArea(stage: number): number {
  return fieldCount(stage) * FIELD_SIZE * FIELD_SIZE;
}

export interface FieldParcel {
  /** Build order, 0 first. */
  index: number;
  /** Agricultural side: 0 north, then clockwise. */
  slot: number;
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** The stage that ploughs it. */
  stage: number;
}

export type FieldSurvey = (parcel: FieldParcel) => boolean;

function candidateParcel(
  site: { x: number; z: number },
  side: number,
  candidate: number,
  index: number,
): FieldParcel {
  const half = (FIELD_SIZE - 1) / 2;
  const [dx, dz] = SIDE_DIRS[side];
  const px = -dz;
  const pz = dx;
  const row = Math.floor(candidate / FIELD_ROW);
  const cross = FIELD_CROSS[candidate % FIELD_ROW];
  const outward = FIELD_RING + row * FIELD_PITCH;
  const cx = site.x + dx * outward + px * cross;
  const cz = site.z + dz * outward + pz * cross;
  return {
    index,
    slot: side,
    x0: cx - half,
    z0: cz - half,
    w: FIELD_SIZE,
    d: FIELD_SIZE,
    stage: stageOf(index),
  };
}

/** One side for the whole agricultural district. With no terrain survey it is seeded;
 *  with one, the town compares four equally sized strips and chooses the side with the
 *  most workable parcels. The comparison window is fixed, so the district never rotates
 *  when the town reaches another stage. */
export function fieldSideFor(
  seed: number,
  site: { x: number; z: number },
  survey?: FieldSurvey,
): number {
  const preferred = farmSideFor(seed, site);
  if (!survey) return preferred;
  let best = preferred;
  let bestScore = -1;
  for (let offset = 0; offset < 4; offset++) {
    const side = (preferred + offset) & 3;
    let score = 0;
    for (let candidate = 0; candidate < FIELD_SIDE_SURVEY; candidate++) {
      if (survey(candidateParcel(site, side, candidate, candidate))) score++;
    }
    if (score > bestScore) {
      best = side;
      bestScore = score;
    }
  }
  return best;
}

/** Every parcel a town will ever plough, in the order it ploughs them.
 *
 *  One seeded side is preferred, but a terrain-aware caller chooses the most workable of
 *  the four. Rows then extend forever along that same side, keeping the district compact
 *  and stable however often it is regenerated. */
export function townFields(
  seed: number,
  site: { x: number; z: number },
  stage = MAX_TOWN_STAGE,
  survey?: FieldSurvey,
): FieldParcel[] {
  const side = fieldSideFor(seed, site, survey);
  const out: FieldParcel[] = [];
  const wanted = fieldCount(stage);
  for (let candidate = 0; candidate < wanted + FIELD_SEARCH_AHEAD && out.length < wanted; candidate++) {
    const parcel = candidateParcel(site, side, candidate, out.length);
    if (!survey || survey(parcel)) out.push(parcel);
  }
  return out;
}

/** The parcels standing at a stage. */
export function fieldsAt(
  seed: number,
  site: { x: number; z: number },
  stage: number,
  survey?: FieldSurvey,
): FieldParcel[] {
  return townFields(seed, site, stage, survey).filter((parcel) => parcel.stage <= stage);
}

/** Which stage ploughs the `n`-th parcel. */
function stageOf(index: number): number {
  let stage = 0;
  while (index >= fieldCount(stage)) stage++;
  return stage;
}

/** Whether a column is a watercourse rather than soil. Lines down the parcel, stopping one
 *  short of each end so the water sits in a trough of its own soil and stays there. */
export function isChannel(parcel: FieldParcel, x: number, z: number): boolean {
  const dx = x - parcel.x0;
  const dz = z - parcel.z0;
  if (dz < 1 || dz > parcel.d - 2) return false;
  return dx % CHANNEL_EVERY === CHANNEL_OFFSET;
}
