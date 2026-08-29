/** The tutorial's neighbour.
 *
 *  Two generated towns are never near each other: the grid puts them 320 blocks apart and
 *  each sits on a plateau wide enough to hold a street grid, so two of them a few dozen
 *  blocks apart would be standing on each other. That made the first errand in the game a four hundred block walk, and
 *  the road it teaches the player to lay an afternoon with a shovel — both of them the
 *  real game rather than the lesson.
 *
 *  So the tutorial gets its own destination: a hamlet a short walk from the first village
 *  the player finds. Close enough to carry a crate to, and to join up with a road by hand
 *  in a few minutes, which is the point of it.
 *
 *  It is written as recorded edits, exactly like village growth, so no generated world
 *  changes and no worker learns anything new. Nothing here imports three.js. */

import { villageId, type GoodId, type VillageId, type VillageRecord } from './villages';
import { hashInts, mulberry32 } from '../core/rng';
import { OUTPOST_FILL, OUTPOST_PAD, VILLAGE_RADIUS, type VillageVariant } from '../world/generation/village';

/** Walking this close is what counts as finding it. Smaller than a town's, because a
 *  hamlet is smaller. */
export const OUTPOST_RADIUS = 16;

/** How far from its parent town a hamlet stands.
 *
 *  Derived, not chosen: a town flattens the ground out to `VILLAGE_RADIUS` and a hamlet
 *  levels its own pad out to `OUTPOST_RADIUS`, so anything closer than the sum of those
 *  puts the hamlet's pad inside the town's plateau — two flat grounds at two heights
 *  overlapping, with the walk between them drawn through the step where they meet. Far
 *  enough to be somewhere else, near enough that carrying a crate there is a walk rather
 *  than an expedition. */
export const OUTPOST_NEAR = VILLAGE_RADIUS + OUTPOST_RADIUS;
export const OUTPOST_DISTANCE = OUTPOST_NEAR + 4;
/** The band of distances searched for level ground, above that. Only outwards: the near
 *  end is a hard floor rather than a preference. */
export const OUTPOST_FAR = OUTPOST_NEAR + 30;
/** How uneven the ground may be under a hamlet. The hamlet levels its own pad by filling
 *  up to the highest column it covers, and it will only fill so far — see OUTPOST_FILL,
 *  which is what this has to stay under. */
export const OUTPOST_LEVEL = OUTPOST_FILL - 1;

/** What a hamlet makes. Deliberately humble and always raw: it is the far end of the
 *  first road the player ever lays, not a workshop with an appetite. */
const OUTPOST_GOODS: Record<VillageVariant, readonly GoodId[]> = {
  plains: ['carrot', 'potato', 'oak_log'],
  desert: ['sand', 'gravel'],
  snowy: ['coal', 'oak_log'],
};

const NAMES: readonly string[] = ['小屋', '外れ', '分かれ', '峠', '渡り'];

export interface OutpostSite {
  x: number;
  z: number;
  baseY: number;
}

/** Reads the surface height of a column. Unloaded ground answers from the generator, so a
 *  hamlet can be sited before the player has ever been there. */
export type GroundAt = (x: number, z: number) => number;

/** Picks the spot, or nothing when there is nowhere level enough nearby.
 *
 *  The bearing is seed-derived so the same world always puts the hamlet in the same
 *  place, and the ring is walked from that bearing outwards so the first acceptable spot
 *  is the closest thing to the intended one. */
export function outpostSite(
  seed: number,
  parent: { id: VillageId; x: number; z: number },
  ground: GroundAt,
): OutpostSite | null {
  const rng = mulberry32(hashInts(seed ^ 0x0b7c, parent.x, parent.z));
  const start = rng() * Math.PI * 2;
  // Distance first, nearest the intended one first: a hamlet a little off the bearing is
  // barely noticeable, one twelve blocks further out is a longer walk every time.
  for (const distance of distances()) {
    for (let step = 0; step < 24; step++) {
      // Alternate sides of the starting bearing rather than sweeping one way, so a
      // blocked direction costs a little detour instead of half a circle.
      const turn = Math.ceil(step / 2) * (Math.PI / 12) * (step % 2 === 0 ? 1 : -1);
      const spot = levelSpot(start + turn, distance, parent, ground);
      if (spot) return spot;
    }
  }
  return null;
}

/** Every distance in the band, ordered by how far it is from the one we wanted. */
function distances(): number[] {
  const out: number[] = [];
  for (let d = OUTPOST_NEAR; d <= OUTPOST_FAR; d += 2) out.push(d);
  return out.sort((a, b) => Math.abs(a - OUTPOST_DISTANCE) - Math.abs(b - OUTPOST_DISTANCE));
}

/** A spot is buildable when the hamlet can fill its way up to a single floor level across
 *  the whole pad. `baseY` is the highest ground it covers, so the pad is all fill and no
 *  cut — the writer replaces soil, plants and air, and will not carve into a hillside. */
function levelSpot(
  angle: number,
  distance: number,
  parent: { x: number; z: number },
  ground: GroundAt,
): OutpostSite | null {
  const x = parent.x + Math.round(Math.cos(angle) * distance);
  const z = parent.z + Math.round(Math.sin(angle) * distance);
  let low = Infinity;
  let high = 0;
  // Every other column: a few hundred candidate spots times six hundred columns each is
  // not worth spending on ground that only ever slopes a block at a time. What it can
  // miss is a single column out of step with its neighbours, which the pad then fills or
  // leaves standing by one block.
  for (let dz = -OUTPOST_PAD; dz <= OUTPOST_PAD; dz += 2) {
    for (let dx = -OUTPOST_PAD; dx <= OUTPOST_PAD; dx += 2) {
      if (dx * dx + dz * dz > OUTPOST_PAD * OUTPOST_PAD) continue;
      const here = ground(x + dx, z + dz);
      if (here <= 0) return null;
      low = Math.min(low, here);
      high = Math.max(high, here);
    }
  }
  if (high - low > OUTPOST_LEVEL) return null;
  return { x, z, baseY: high + 1 };
}

/** The record for a hamlet. It is an ordinary village in every way the rest of the game
 *  cares about — it produces, it wants things, a route can end at it — so routes, porters,
 *  the ledger and growth all work on it without knowing what it is. */
export function outpostRecord(
  seed: number,
  parent: VillageRecord,
  site: OutpostSite,
): VillageRecord {
  const rng = mulberry32(hashInts(seed ^ 0x0b7d, site.x, site.z));
  const choices = OUTPOST_GOODS[parent.variant].filter((good) => good !== parent.produces);
  const produces = choices[Math.floor(rng() * choices.length)] ?? OUTPOST_GOODS[parent.variant][0];
  return {
    id: villageId(site.x, site.z),
    x: site.x,
    z: site.z,
    baseY: site.baseY,
    variant: parent.variant,
    name: `${parent.name}の${NAMES[Math.floor(rng() * NAMES.length)]}`,
    produces,
    // A hamlet makes its one thing out of nothing. It is the tutorial's supplier and the
    // only place in the world that does: everywhere else has to be fed before it works,
    // and a tutorial that opened with that would have nothing to teach the lesson with.
    inputs: [],
    inputStock: new Map(),
    needs: [],
    stage: 0,
    points: 0,
    stock: 0,
    received: 0,
    discovered: false,
    spawnedStage: 0,
    progress: 0,
    harvest: 0,
    harvestProgress: 0,
    outpost: true,
    parent: parent.id,
  };
}
