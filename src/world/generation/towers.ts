/** The building a town puts up when it runs out of ground.
 *
 *  Every other building in this game is one storey of one thing: a house is a house, a
 *  shop is a shop, and a town that grows puts another of them on the next plot along. That
 *  works until the plots run out — and it never gives the middle of a town the one thing
 *  that makes a middle: floors, stacked, with different businesses on them.
 *
 *  So a town that has reached 町 rebuilds its central blocks. The shop that stood there
 *  comes down and a building goes up on the same plot with a shop on the ground floor and
 *  offices above it, one tenant per floor, each of them an address the economy trades with
 *  in its own right. That is the whole point of the exercise: the plot did not get any
 *  bigger, and the number of places somebody can walk to went up three to six times.
 *
 *  A building with floors needs a way between them, so this is also the one place that
 *  builds a lift and an escalator — and they work: the player rides them (see `player.ts`),
 *  which is what stops the upper storeys being scenery.
 *
 *  Written in the plot's own frame rather than in world coordinates. `at(u, v)` is `u`
 *  across the frontage and `v` back from the street, so every measurement below reads as
 *  the floor plan it is and the four facings are one piece of code rather than four.
 *
 *  Concrete, tile, steel and tinted glass whatever the town is built out of, exactly as a
 *  works is always stone: what decides a building like this is the frame inside it, not
 *  the country it stands in. */

import { Block, escalatorTowards, type BlockId } from '../blocks';
import {
  FACING_STEP,
  type BuildingUse,
  type Footprint,
  type HouseRecord,
  type Profession,
} from './village';
import { doorOf, type BuildSink, type PutFn } from './townBuildings';

/** Walking level to walking level. Three blocks of clear air and the slab over them,
 *  which is the least a storey can be and still be walked through. */
export const STOREY = 4;
/** Floors of the first building a town puts up, and of the tallest it ever does. */
export const MIN_FLOORS = 3;
export const MAX_FLOORS = 6;
/** How far above the top floor the roof furniture reaches: the parapet, the tank and the
 *  lift's machine room. What `Landmark`-style height honesty needs, and what the growth
 *  writer clears the air to. */
export const ROOF_RISE = 4;

/** How tall this building stands above the level its ground floor is walked on. */
export function towerHeight(floors: number): number {
  return floors * STOREY + ROOF_RISE;
}

/** The plot's own frame: `u` across the frontage from one corner, `v` back from the
 *  street-facing wall. Both 0-based, both inside the plot. */
function localFrame(
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
): { at: (u: number, v: number) => { x: number; z: number }; span: number; depth: number } {
  const [ox, oz] = FACING_STEP[facing];
  // Across the frontage: the outward direction turned a quarter to the right.
  const ax = -oz;
  const az = ox;
  const x0 = ox > 0
    ? plot.x0 + plot.w - 1
    : ox < 0 ? plot.x0 : ax > 0 ? plot.x0 : plot.x0 + plot.w - 1;
  const z0 = oz > 0
    ? plot.z0 + plot.d - 1
    : oz < 0 ? plot.z0 : az > 0 ? plot.z0 : plot.z0 + plot.d - 1;
  return {
    at: (u, v) => ({ x: x0 + ax * u - ox * v, z: z0 + az * u - oz * v }),
    span: ax === 0 ? plot.d : plot.w,
    depth: ax === 0 ? plot.w : plot.d,
  };
}

/** Everything one tower needs to know about itself, worked out once. */
interface Tower {
  at: (u: number, v: number) => { x: number; z: number };
  span: number;
  depth: number;
  floors: number;
  /** Walking level of the ground floor. */
  base: number;
  /** The lift shaft, in plot coordinates. */
  liftU: number;
  liftV: number;
  /** The escalator well: two cells across, four deep, rising into the building. */
  wellU: number;
  wellV: number;
}

/** Cells of the escalator well, which is the one part of a floor that has a hole in it. */
function inWell(tower: Tower, u: number, v: number): boolean {
  return u >= tower.wellU && u < tower.wellU + WELL_WIDTH
    && v >= tower.wellV && v < tower.wellV + STOREY;
}

const WELL_WIDTH = 2;

/** True for a cell on the outside wall of the plot. */
function onWall(tower: Tower, u: number, v: number): boolean {
  return u === 0 || u === tower.span - 1 || v === 0 || v === tower.depth - 1;
}

function isCorner(tower: Tower, u: number, v: number): boolean {
  return (u === 0 || u === tower.span - 1) && (v === 0 || v === tower.depth - 1);
}

/** Raises one building of `floors` floors on a plot, and records a tenant for each.
 *
 *  Returns the tenants in floor order, ground floor first — which is also the order they
 *  are recorded in the sink, so the shop is always the first thing named. */
export function buildTower(
  put: PutFn,
  sink: BuildSink,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  baseY: number,
  floors: number,
  professions: readonly Profession[],
): HouseRecord[] {
  const frame = localFrame(plot, facing);
  const tower: Tower = {
    ...frame,
    floors,
    base: baseY,
    // The core goes in the back corner, where it takes the least floor away from the
    // room it serves, and the well runs up the middle of the plan where somebody walking
    // in through the door is looking straight at it.
    liftU: frame.span - 2,
    liftV: frame.depth - 2,
    wellU: 2,
    wellV: 3,
  };

  clearPlot(put, tower);
  for (let floor = 0; floor < floors; floor++) shell(put, tower, floor);
  core(put, tower);
  escalator(put, tower, facing);
  roof(put, tower);
  return tenants(put, sink, tower, plot, facing, professions);
}

/** Takes down whatever was here and clears the air the building stands in.
 *
 *  One block beyond the plot as well, because the shop this replaces had a roof that
 *  oversailed its walls and an awning over the pavement, and a new building with the old
 *  one's eaves still stuck to it is worse than either. */
function clearPlot(put: PutFn, tower: Tower): void {
  const height = towerHeight(tower.floors);
  for (let v = -1; v <= tower.depth; v++) {
    for (let u = -1; u <= tower.span; u++) {
      const { x, z } = tower.at(u, v);
      const inside = u >= 0 && u < tower.span && v >= 0 && v < tower.depth;
      // The pavement outside, and the building's own slab under it.
      put(x, tower.base - 1, z, inside ? Block.WHITE_TILE : Block.ASPHALT);
      for (let y = tower.base; y < tower.base + height; y++) put(x, y, z, Block.AIR);
    }
  }
}

/** One storey: its floor slab, its walls, and the windows in them.
 *
 *  The facade is three courses to a storey and always the same three — the edge of the
 *  slab, the glazing, then the tiled spandrel over it. That is what makes a building of
 *  this kind readable at a distance: you can count the floors off the front of it. */
function shell(put: PutFn, tower: Tower, floor: number): void {
  const y0 = tower.base + floor * STOREY;
  const ground = floor === 0;
  for (let v = 0; v < tower.depth; v++) {
    for (let u = 0; u < tower.span; u++) {
      const { x, z } = tower.at(u, v);
      // The floor under this storey. The ground floor already has its slab from the
      // clearing pass; every storey above lays its own, minus the two holes.
      if (!ground && !inWell(tower, u, v) && !(u === tower.liftU && v === tower.liftV)) {
        put(x, y0 - 1, z, Block.CONCRETE);
      }
      if (!onWall(tower, u, v)) continue;
      for (let h = 0; h < STOREY - 1; h++) {
        put(x, y0 + h, z, wallAt(tower, u, v, floor, h));
      }
    }
  }
  // Under the top of each upper storey, a course of tile that reads as the ceiling from
  // the street. The slab above does the rest.
  if (ground) shopfront(put, tower);
}

/** How often a pier interrupts the window band. Every third bay, which is what stops a
 *  building of this kind reading as a multi-storey car park: a ribbon of glass with a
 *  concrete band over it and nothing vertical anywhere is exactly what one looks like. */
const BAY = 3;

/** What one cell of a wall is made of. */
function wallAt(tower: Tower, u: number, v: number, floor: number, h: number): BlockId {
  if (isCorner(tower, u, v)) return Block.STEEL_COLUMN;
  // The piers run the full height of the building, so the facade has a frame in it.
  const along = u === 0 || u === tower.span - 1 ? v : u;
  const pier = along % BAY === 0;
  if (floor === 0) {
    // The whole street-facing wall of the ground floor is glass, which is what a shop is.
    if (v === 0 && h < 2 && !pier) return Block.GLASS;
    return Block.WHITE_TILE;
  }
  // The spandrel under the window, the window band, and the tiled course over it.
  if (h === 0) return Block.CONCRETE;
  if (h === 1) return pier ? Block.WHITE_TILE : Block.TINTED_GLASS;
  return Block.WHITE_TILE;
}

/** The bits of the ground floor that face the street: the entrance, the canopy over it,
 *  and the shutter at the back that the deliveries come in through. */
function shopfront(put: PutFn, tower: Tower): void {
  const door = tower.span >> 1;
  const y = tower.base;
  for (let h = 0; h < 2; h++) {
    const { x, z } = tower.at(door, 0);
    put(x, y + h, z, Block.AIR);
  }
  // A canopy over the doorway, one block into the street: the same gesture the old shop's
  // awning made, in the material this building is made of.
  for (let u = door - 1; u <= door + 1; u++) {
    const { x, z } = tower.at(u, -1);
    put(x, y + STOREY - 2, z, Block.WHITE_TILE_SLAB);
  }
  // The service shutter on the back wall. Every building of this kind has one, and it is
  // the only thing that says which side of it is the back.
  for (let u = door - 1; u <= door; u++) {
    const { x, z } = tower.at(u, tower.depth - 1);
    for (let h = 0; h < 2; h++) put(x, y + h, z, Block.SHUTTER);
  }
}

/** The lift: a shaft the full height of the building, walled in steel, open on one side
 *  at every floor. Its car is a block the player stands in and rides. */
function core(put: PutFn, tower: Tower): void {
  const top = tower.base + tower.floors * STOREY - 2;
  const shaft = tower.at(tower.liftU, tower.liftV);
  const wall = tower.at(tower.liftU - 1, tower.liftV);
  for (let y = tower.base; y <= top; y++) {
    put(shaft.x, y, shaft.z, Block.ELEVATOR);
    put(wall.x, y, wall.z, Block.STEEL);
  }
  // The landing in front of the doors, lit, on every floor. Without the light the one
  // corner of every floor that has no window is the one you arrive in.
  for (let floor = 0; floor < tower.floors; floor++) {
    const landing = tower.at(tower.liftU, tower.liftV - 1);
    put(landing.x, tower.base + floor * STOREY + STOREY - 2, landing.z, Block.LANTERN);
  }
}

/** The escalator from the ground floor to the first floor, and the well it rises through.
 *
 *  One flight, going up. Coming down is the lift's job — which is exactly the bargain a
 *  building like this makes in the world, and it saves the player from a flight that
 *  carries them the wrong way while they try to walk down it. */
function escalator(put: PutFn, tower: Tower, facing: 0 | 1 | 2 | 3): void {
  const [ox, oz] = FACING_STEP[facing];
  // The flight rises the way somebody walking in through the door is already going.
  const tread = escalatorTowards(-ox, -oz);
  for (let step = 0; step < STOREY; step++) {
    const v = tower.wellV + step;
    const y = tower.base + step;
    for (let u = tower.wellU; u < tower.wellU + WELL_WIDTH; u++) {
      const { x, z } = tower.at(u, v);
      put(x, y, z, tread);
      // The air the rider travels through. Without it the flight arrives at a ceiling.
      for (let h = 1; h <= STOREY - 1; h++) put(x, y + h, z, Block.AIR);
    }
  }
  // A rail down each side of the well, so the hole in the first floor has an edge to it.
  for (let v = tower.wellV; v < tower.wellV + STOREY; v++) {
    for (const u of [tower.wellU - 1, tower.wellU + WELL_WIDTH]) {
      const { x, z } = tower.at(u, v);
      put(x, tower.base + STOREY, z, Block.STEEL_COLUMN);
    }
  }
}

/** The roof: a parapet round the edge, the tank and the plant that a building of this
 *  size actually carries, and the lift's machine room over its own shaft. */
function roof(put: PutFn, tower: Tower): void {
  const deck = tower.base + tower.floors * STOREY - 1;
  for (let v = 0; v < tower.depth; v++) {
    for (let u = 0; u < tower.span; u++) {
      const { x, z } = tower.at(u, v);
      put(x, deck, z, Block.CONCRETE);
      if (onWall(tower, u, v)) put(x, deck + 1, z, Block.WHITE_TILE_SLAB);
    }
  }
  // The water tank, on legs, in the corner opposite the lift.
  for (let v = 1; v <= 3; v++) {
    for (let u = 1; u <= 3; u++) {
      const { x, z } = tower.at(u, v);
      put(x, deck + 1, z, Block.STEEL_COLUMN);
      put(x, deck + 2, z, Block.STEEL);
      put(x, deck + 3, z, Block.CONCRETE_SLAB);
    }
  }
  // The machine room over the shaft, and the plant beside it.
  for (let v = tower.liftV - 1; v <= tower.liftV; v++) {
    for (let u = tower.liftU - 1; u <= tower.liftU; u++) {
      const { x, z } = tower.at(u, v);
      put(x, deck + 1, z, Block.WHITE_TILE);
      put(x, deck + 2, z, Block.WHITE_TILE_SLAB);
    }
  }
  for (const u of [tower.wellU, tower.wellU + WELL_WIDTH]) {
    const { x, z } = tower.at(u, tower.depth - 2);
    put(x, deck + 1, z, Block.AC_UNIT);
  }
}

/** The tenants, and what each of their floors is fitted out with.
 *
 *  Every one of them shares the street door, because they share the building: the walk to
 *  an office on the fourth floor is a walk to this doorway, and the lift inside is the
 *  rest of it. That is also why the record's `floor` matters — two tenants of one building
 *  have the same corner, and the corner is what a building's address is made of. */
function tenants(
  put: PutFn,
  sink: BuildSink,
  tower: Tower,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  professions: readonly Profession[],
): HouseRecord[] {
  const { door, outside } = doorOf(plot, facing, tower.base);
  const out: HouseRecord[] = [];
  for (let floor = 0; floor < tower.floors; floor++) {
    const y0 = tower.base + floor * STOREY;
    const use: BuildingUse = floor === 0 ? 'commercial' : 'office';
    const profession = professions[floor % professions.length];
    const record: HouseRecord = {
      ...plot,
      facing,
      role: 'tower',
      use,
      floor,
      profession,
      door,
      outside,
    };
    sink.buildings.push(record);
    out.push(record);
    fitOut(put, sink, tower, floor, profession);
    // Somebody is in there, standing by the window where the street can see them. A
    // different corner of the plan on each floor, because a villager's appearance is
    // hashed off where they were put: stacking every tenant on one column would fill the
    // building with the same person wearing the same coat.
    const spot = tower.at(2 + (floor * 3) % Math.max(1, tower.span - 4), 1 + (floor % 2));
    sink.villagers.push({ x: spot.x, y: y0, z: spot.z, profession });
  }
  signs(put, tower);
  return out;
}

/** What is inside one floor. A counter and a chest downstairs; desks and a lamp upstairs. */
function fitOut(
  put: PutFn,
  sink: BuildSink,
  tower: Tower,
  floor: number,
  profession: Profession,
): void {
  const y0 = tower.base + floor * STOREY;
  if (floor === 0) {
    // The counter runs across the back of the shop, clear of the shutter and the core.
    for (let u = 1; u < tower.span - 3; u++) {
      const { x, z } = tower.at(u, tower.depth - 2);
      if (inWell(tower, u, tower.depth - 2)) continue;
      put(x, y0, z, Block.CRAFTING_TABLE);
    }
    const chest = tower.at(1, tower.depth - 3);
    put(chest.x, y0, chest.z, Block.CHEST);
    sink.chests.push({ x: chest.x, y: y0, z: chest.z, loot: profession });
    const lamp = tower.at(1, 1);
    put(lamp.x, y0 + STOREY - 2, lamp.z, Block.LANTERN);
    return;
  }
  // Desks on a grid with gangways between them, clear of the well and the lift. A solid
  // row of them reads as a library wall; separate ones read as a floor of desks.
  for (let v = 1; v < tower.depth - 1; v += 2) {
    for (let u = 2; u < tower.span - 1; u += 2) {
      if (inWell(tower, u, v)) continue;
      if (u >= tower.liftU - 1 && v >= tower.liftV - 1) continue;
      const { x, z } = tower.at(u, v);
      put(x, y0, z, Block.BOOKSHELF);
    }
  }
  for (const u of [2, tower.span - 3]) {
    const { x, z } = tower.at(u, tower.depth >> 1);
    put(x, y0 + STOREY - 2, z, Block.LANTERN);
  }
}

/** The signboards up the front of the building, one per tenant above the shop.
 *
 *  Hung a block clear of the wall, over the pavement, which is where they belong and
 *  where they can be read from along the street rather than only from in front. */
function signs(put: PutFn, tower: Tower): void {
  for (let floor = 1; floor < tower.floors; floor++) {
    const y = tower.base + floor * STOREY + 1;
    const { x, z } = tower.at(1, -1);
    put(x, y, z, floor % 2 === 1 ? Block.SIGN_RED : Block.SIGN_BLUE);
  }
}

/** How many floors a town of this stage puts up. Its first building is the smallest one,
 *  and each one after that is a floor taller — so the middle of a town that kept growing
 *  reads as a skyline rather than as three copies of the same box. */
export function floorsFor(stage: number, first: number): number {
  return Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, MIN_FLOORS + stage - first));
}
