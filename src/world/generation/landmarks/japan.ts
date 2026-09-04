import { Block } from '../../blocks';
import {
  box, fill, hollowOut, opening, perimeter, post, ring, slabAt, walls,
  type Brush,
} from './brush';
import type { Landmark } from './types';

/**
 * The modern quarter: four buildings off a Japanese street.
 *
 * The eight exhibits in the ring around the plaza are all *old*, and all European. What
 * they cannot show is the thing a modern street is actually made of, which is not stone
 * and not brick: it is small white tiles, aluminium sashes, painted steel and signboards,
 * and the buildings themselves are shaped by rules rather than by masonry — a setback for
 * the sunlight the next plot is entitled to, an access balcony because the stair may not
 * be inside, a water tank on the roof because the mains will not reach the eighth floor.
 *
 * So these four are drawn from what those rules produce:
 *
 * - **超高層ビル** — a curtain-walled office tower over a glazed podium, with the machine
 *   room and the aircraft light that are on top of every one of them.
 * - **雑居ビル** — the narrow multi-tenant block: one plot wide, a shutter at the bottom,
 *   a different business on each floor and every one of them with a sign on the street.
 * - **マンション** — a block of flats with balconies down the front, an open access
 *   corridor down the back and a staircase at each end.
 * - **住宅** — the two storey house behind its block wall, with a carport, a tiled roof
 *   and washing out on the balcony.
 *
 * Everything is authored with the south-west corner at (0, 0) and the ground floor at
 * `y = 1`, facing north, exactly as the rest of the exhibition is; the showcase turns
 * them to face the plaza.
 */

/** The side of a lot in the exhibition. The modern buildings take the whole of theirs and
 *  pave it, which is the one thing that makes them read as a street rather than as four
 *  more objects standing in a park: a building in this quarter meets its neighbour's
 *  boundary, and what is between them is pavement.
 *
 *  Kept here rather than imported from the showcase, which imports this file. The tests
 *  hold the two numbers together. */
export const PLOT = 45;

/** The same brush, moved into the middle of the plot.
 *
 *  Each building is authored at its own size with its own origin, and then dropped into a
 *  paved lot — so nothing inside a `build` has to know how much pavement is around it. */
function inset(brush: Brush, ox: number, oz: number): Brush {
  return {
    set: (x, y, z, block) => brush.set(x + ox, y, z + oz, block),
    get: (x, y, z) => brush.get(x + ox, y, z + oz),
  };
}

/** A suburban plot: the road and its kerb along the front, and grass over the rest.
 *
 *  The difference between this and `plot` is the difference between the two halves of any
 *  Japanese town — the commercial street where the pavement goes to the boundary, and the
 *  residential one where every house has a few square metres of garden behind a wall. */
function suburb(brush: Brush): void {
  slabAt(brush, 0, 0, 0, PLOT - 1, PLOT - 1, Block.GRASS);
  fill(brush, box(0, 0, 0, PLOT - 1, 0, 2), Block.ASPHALT);
  ring(brush, 0, 0, 3, PLOT - 1, 3, Block.WHITE_TILE_SLAB);
  for (let x = 2; x < PLOT - 2; x += 3) brush.set(x, 0, 1, Block.WHITE_TILE);
}

/** How far back from the kerb a building in this quarter stands. Four: pavement, and no
 *  more than that. A building set in the middle of its plot is a building in a car park,
 *  and it is the single thing that would stop this quarter reading as a street. */
const FRONTAGE = 4;

/** The plot itself: paved to the boundary, with a kerb round it and the carriageway of
 *  the street along the front. */
function plot(brush: Brush, road: number): void {
  slabAt(brush, 0, 0, 0, PLOT - 1, PLOT - 1, Block.CONCRETE);
  ring(brush, 0, 0, 0, PLOT - 1, PLOT - 1, Block.WHITE_TILE_SLAB);
  fill(brush, box(1, 0, 1, PLOT - 2, 0, road), Block.ASPHALT);
  // The white line down the middle of it, which is what says road rather than yard.
  for (let x = 2; x < PLOT - 2; x += 3) brush.set(x, 0, 1, Block.WHITE_TILE);
}

/** The back of the plot: the service yard every one of these has, and the wall round it.
 *  `from` is where the building's own drawing ends. */
function backYard(brush: Brush, from: number, rng: () => number): void {
  fill(brush, box(1, 0, from + 2, PLOT - 2, 0, PLOT - 2), Block.ASPHALT);
  for (let x = 1; x < PLOT - 1; x++) {
    brush.set(x, 1, PLOT - 2, Block.CONCRETE);
    brush.set(x, 2, PLOT - 2, Block.CONCRETE_SLAB);
  }
  for (const z of [from + 3, PLOT - 4]) {
    for (let y = 1; y <= 2; y++) {
      brush.set(1, y, z, Block.CONCRETE);
      brush.set(PLOT - 2, y, z, Block.CONCRETE);
    }
  }
  // The plant on the ground rather than on the roof: condensers, a bin store, a scrap of
  // green where nothing else fits.
  for (let i = 0; i < 3; i++) {
    const x = 6 + Math.floor(rng() * (PLOT - 14));
    const z = from + 4 + Math.floor(rng() * 4);
    brush.set(x, 1, z, Block.AC_UNIT);
    if (rng() < 0.5) brush.set(x + 1, 1, z, Block.AC_UNIT);
  }
}

/** Storey height through the whole quarter. Three is the smallest that leaves a person
 *  headroom under a floor slab, and it is what makes eight floors read as eight. */
const STOREY = 3;

/** A wall of small white tiles with a window band in it, which is most of what a modern
 *  Japanese facade is. `sill` is measured from the storey's own floor. */
function tiledStorey(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  floor: number,
  windows: { sill: number; height: number; pitch: number; width: number },
  wall: number = Block.WHITE_TILE,
): void {
  for (let y = floor; y < floor + STOREY; y++) {
    perimeter(x0, z0, x1, z1, (x, z, along, corner) => {
      const band = y >= floor + windows.sill && y < floor + windows.sill + windows.height;
      const opening = along % windows.pitch < windows.width;
      brush.set(x, y, z, band && opening && !corner ? Block.TINTED_GLASS : wall);
    });
  }
}

/** The parapet, the tank on its legs and the stair head: the three things on the roof of
 *  every building in this quarter, and the reason none of them ends in a flat lid. */
function rooftop(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  tank: { x: number; z: number } | null,
): void {
  slabAt(brush, y, x0, z0, x1, z1, Block.CONCRETE);
  ring(brush, y + 1, x0, z0, x1, z1, Block.CONCRETE_SLAB);
  if (!tank) return;
  // A cistern on four legs. Every building taller than the mains pressure has one, and
  // its silhouette is half of why a Japanese skyline looks the way it does.
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) post(brush, tank.x + dx, tank.z + dz, y + 1, y + 2, Block.STEEL_COLUMN);
  }
  fill(brush, box(tank.x - 2, y + 3, tank.z - 1, tank.x + 2, y + 4, tank.z + 1), Block.CONCRETE);
  slabAt(brush, y + 5, tank.x - 2, tank.z - 1, tank.x + 2, tank.z + 1, Block.WHITE_TILE_SLAB);
}

/** An air conditioner bracketed to a wall, which is on every wall there is. */
function airCon(brush: Brush, x: number, y: number, z: number): void {
  brush.set(x, y, z, Block.AC_UNIT);
  brush.set(x, y - 1, z, Block.STEEL);
}

// --- 超高層ビル ---------------------------------------------------------------

const TOWER_W = 27;
const TOWER_D = 27;
const TOWER_H = 84;

/** A tower's skin: glass in an aluminium grid, with a spandrel at every floor slab.
 *  Three tones, because glass and steel alone go uniformly grey at any distance. */
function curtainWall(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y++) {
    const slab = (y - y0) % STOREY === 0;
    perimeter(x0, z0, x1, z1, (x, z, along, corner) => {
      const mullion = corner || along % 3 === 0;
      brush.set(x, y, z, slab ? Block.WHITE_TILE : mullion ? Block.STEEL : Block.TINTED_GLASS);
    });
  }
}

const TOWER_BLOCK: Landmark = {
  id: 'tower_block',
  label: '超高層ビル',
  note: 'ガラスのカーテンウォール、低層部の店舗、屋上の塔屋と航空障害灯',
  kind: 'modern',
  width: PLOT,
  depth: PLOT,
  height: TOWER_H,
  depthBelow: 0,
  build(outer, ctx) {
    plot(outer, 3);
    const brush = inset(outer, (PLOT - TOWER_W) / 2, FRONTAGE);
    const mid = (TOWER_W - 1) / 2;
    // The forecourt, and a line of planters along the street. A tower on a lawn is an
    // office park; a tower on a pavement is a city.
    for (let x = 2; x < TOWER_W - 2; x += 6) {
      fill(brush, box(x, 1, 4, x + 1, 1, 5), Block.STONE_BRICKS);
      brush.set(x, 2, 4, Block.OAK_LOG);
      brush.set(x, 3, 4, Block.OAK_LEAVES);
    }

    // The podium: four storeys of shop, glazed to the pavement, set out to the plot's
    // edge the way a real one is.
    const p0 = 3;
    const p1 = TOWER_W - 4;
    const pz0 = 5;
    const pz1 = TOWER_D - 4;
    for (let storey = 0; storey < 4; storey++) {
      const floor = 1 + storey * STOREY;
      if (storey === 0) {
        for (let y = floor; y < floor + STOREY; y++) {
          perimeter(p0, pz0, p1, pz1, (x, z, _along, corner) => {
            const front = z === pz0;
            const door = front && Math.abs(x - mid) <= 2;
            brush.set(x, y, z, corner ? Block.WHITE_TILE : door ? Block.AIR : Block.TINTED_GLASS);
          });
        }
      } else {
        tiledStorey(brush, p0, pz0, p1, pz1, floor, { sill: 0, height: 2, pitch: 4, width: 3 });
      }
      slabAt(brush, floor + STOREY - 1, p0 + 1, pz0 + 1, p1 - 1, pz1 - 1, Block.CONCRETE);
    }
    // The canopy over the door, which is what makes an entrance rather than a hole.
    slabAt(brush, 5, mid - 4, pz0 - 2, mid + 4, pz0, Block.WHITE_TILE_SLAB);
    for (const dx of [-4, 4]) post(brush, mid + dx, pz0 - 2, 1, 4, Block.STEEL_COLUMN);
    ring(brush, 13, p0 - 1, pz0 - 1, p1 + 1, pz1 + 1, Block.CONCRETE_SLAB);

    // The shaft. Thirteen across, which at this scale is an office floor plate with a
    // core in the middle of it.
    const s0 = mid - 6;
    const s1 = mid + 6;
    const sz0 = 8;
    const sz1 = sz0 + 12;
    const shaftTop = 60;
    curtainWall(brush, s0, sz0, s1, sz1, 13, shaftTop);
    for (let y = 13; y <= shaftTop; y += STOREY) {
      slabAt(brush, y, s0 + 1, sz0 + 1, s1 - 1, sz1 - 1, Block.CONCRETE);
    }
    // The lift core, lit from inside so the tower reads as occupied after dark.
    walls(brush, box(mid - 2, 13, sz0 + 5, mid + 2, shaftTop, sz0 + 8), Block.CONCRETE);
    for (let y = 15; y < shaftTop; y += STOREY * 2) brush.set(mid, y, sz0 + 6, Block.LANTERN);

    // The upper stage, set back the way the sunlight rules make them.
    const u0 = mid - 4;
    const u1 = mid + 4;
    const uz0 = sz0 + 2;
    const uz1 = sz1 - 2;
    slabAt(brush, shaftTop + 1, s0, sz0, s1, sz1, Block.CONCRETE);
    ring(brush, shaftTop + 2, s0, sz0, s1, sz1, Block.CONCRETE_SLAB);
    curtainWall(brush, u0, uz0, u1, uz1, shaftTop + 2, 72);
    for (let y = shaftTop + 2; y <= 72; y += STOREY) {
      slabAt(brush, y, u0 + 1, uz0 + 1, u1 - 1, uz1 - 1, Block.CONCRETE);
    }

    // The crown: the machine room, its parapet, and the mast with the red light on it
    // that every tall building in the country carries.
    rooftop(brush, u0, uz0, u1, uz1, 73, null);
    fill(brush, box(mid - 2, 74, uz0 + 4, mid + 2, 77, uz0 + 8), Block.WHITE_TILE);
    hollowOut(brush, box(mid - 1, 74, uz0 + 5, mid + 1, 76, uz0 + 7));
    slabAt(brush, 78, mid - 3, uz0 + 3, mid + 3, uz0 + 9, Block.CONCRETE_SLAB);
    post(brush, mid, uz0 + 6, 79, 82, Block.STEEL_COLUMN);
    brush.set(mid, 83, uz0 + 6, Block.SIGN_RED);
    // Aerials, because the roof of an office tower is never empty.
    for (const [dx, dz] of [[-3, 2], [3, 10]] as const) {
      post(brush, mid + dx, uz0 + dz, 74, 77 + Math.floor(ctx.rng() * 2), Block.STEEL_COLUMN);
    }
    backYard(outer, FRONTAGE + TOWER_D, ctx.rng);
  },
};

// --- 雑居ビル -----------------------------------------------------------------

const TENANT_W = 17;
const TENANT_D = 15;
const TENANT_H = 27;

const TENANT_BLOCK: Landmark = {
  id: 'tenant_block',
  label: '雑居ビル',
  note: '間口の狭い賃貸ビル。シャッター、外階段、袖看板、屋上の貯水槽',
  kind: 'modern',
  width: PLOT,
  depth: PLOT,
  height: TENANT_H,
  depthBelow: 0,
  build(outer, ctx) {
    plot(outer, 3);
    const brush = inset(outer, (PLOT - TENANT_W) / 2, FRONTAGE);
    const x0 = 2;
    const x1 = TENANT_W - 3;
    const z0 = 3;
    const z1 = TENANT_D - 2;
    const mid = (TENANT_W - 1) / 2;
    // No garden: this building goes to its boundary on both sides, which is what makes
    // it the shape it is.

    // Seven storeys. The ground floor is a shop — shutter over half of it, glass over
    // the rest — and everything above is somebody's office with a window.
    const storeys = 7;
    for (let storey = 0; storey < storeys; storey++) {
      const floor = 1 + storey * STOREY;
      if (storey === 0) {
        for (let y = floor; y < floor + STOREY; y++) {
          perimeter(x0, z0, x1, z1, (x, z, _along, corner) => {
            const front = z === z0;
            const shutter = front && x < mid - 1;
            const door = front && x >= mid + 2 && x <= mid + 3;
            brush.set(
              x, y, z,
              corner ? Block.WHITE_TILE
                : !front ? Block.WHITE_TILE
                  : shutter ? Block.SHUTTER
                    : door ? Block.AIR : Block.TINTED_GLASS,
            );
          });
        }
      } else {
        tiledStorey(brush, x0, z0, x1, z1, floor, { sill: 0, height: 2, pitch: 3, width: 2 });
      }
      slabAt(brush, floor + STOREY - 1, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.CONCRETE);
    }

    // The signs. A board over the shopfront and a column of them up the corner, which is
    // the one thing that says "six different businesses are in here".
    for (let x = x0; x <= x1; x++) brush.set(x, 4, z0 - 1, x % 2 === 0 ? Block.SIGN_RED : Block.SIGN_BLUE);
    for (let y = 6; y <= 19; y++) {
      const board = y % 4 < 2 ? Block.SIGN_RED : Block.SIGN_BLUE;
      brush.set(x0 - 1, y, z0, board);
      brush.set(x0 - 1, y, z0 + 1, board);
    }
    // And one hanging over the pavement, at first floor level.
    fill(brush, box(x1 + 1, 7, z0, x1 + 1, 12, z0 + 1), Block.SIGN_BLUE);

    // The staircase up the back, outside the building the way the fire rules put it.
    for (let storey = 0; storey < storeys; storey++) {
      const floor = 1 + storey * STOREY;
      slabAt(brush, floor + STOREY - 1, x1 + 1, z1 - 3, x1 + 2, z1, Block.CONCRETE);
      for (let step = 0; step < STOREY; step++) {
        brush.set(x1 + 1, floor + step, z1 - 3 + step, Block.CONCRETE_SLAB);
        brush.set(x1 + 2, floor + step, z1 - 3 + step, Block.CONCRETE_SLAB);
      }
      post(brush, x1 + 2, z1, floor, floor + STOREY - 2, Block.STEEL_COLUMN);
    }

    // Air conditioners down the side wall, one to a tenant, and a vent or two.
    for (let storey = 1; storey < storeys; storey++) {
      airCon(brush, x0 - 1, 2 + storey * STOREY, z0 + 3 + (storey % 3));
    }
    rooftop(brush, x0, z0, x1, z1, 1 + storeys * STOREY - 1, { x: mid, z: z1 - 3 });
    // A little shed over the head of the stair, so the roof has something on it.
    fill(brush, box(x1 - 3, 23, z1 - 3, x1 - 1, 25, z1 - 1), Block.WHITE_TILE);
    slabAt(brush, 26, x1 - 4, z1 - 4, x1, z1, Block.CONCRETE_SLAB);
    if (ctx.rng() < 0.9) airCon(brush, x1 - 4, 25, z1 - 2);
    backYard(outer, FRONTAGE + TENANT_D, ctx.rng);
  },
};

// --- マンション ---------------------------------------------------------------

const FLATS_W = 35;
const FLATS_D = 17;
const FLATS_H = 32;

const APARTMENT: Landmark = {
  id: 'apartment',
  label: 'マンション',
  note: '前面はバルコニー、背面は共用廊下、両端に外階段。屋上に貯水槽',
  kind: 'modern',
  width: PLOT,
  depth: PLOT,
  height: FLATS_H,
  depthBelow: 0,
  build(outer, ctx) {
    plot(outer, 3);
    const brush = inset(outer, (PLOT - FLATS_W) / 2, FRONTAGE);
    const x0 = 2;
    const x1 = FLATS_W - 3;
    const z0 = 4;
    const z1 = FLATS_D - 3;
    const storeys = 8;
    const mid = (FLATS_W - 1) / 2;

    for (let storey = 0; storey < storeys; storey++) {
      const floor = 1 + storey * STOREY;
      // The flats themselves: a tiled box with the front open to its balconies and the
      // back open to the walkway.
      for (let y = floor; y < floor + STOREY; y++) {
        perimeter(x0, z0, x1, z1, (x, z, _along, corner) => {
          if (corner) {
            brush.set(x, y, z, Block.WHITE_TILE);
            return;
          }
          if (z === z0) {
            // The front: a full-height sliding door in the middle of each flat and a
            // window beside it, which is the whole of what a Japanese flat shows.
            const inFlat = ((x - x0) % 6) + 1;
            const glazed = inFlat >= 2 && inFlat <= 4 && y < floor + STOREY - 1;
            brush.set(x, y, z, glazed ? Block.TINTED_GLASS : Block.WHITE_TILE);
            return;
          }
          if (z === z1) {
            // The back: a door to each flat off the walkway, and a small high window.
            const inFlat = (x - x0) % 6;
            const door = inFlat === 1 && y < floor + 2;
            const window = inFlat === 4 && y === floor + 1;
            brush.set(x, y, z, door ? Block.OAK_PLANKS : window ? Block.TINTED_GLASS : Block.WHITE_TILE);
            return;
          }
          brush.set(x, y, z, Block.WHITE_TILE);
        });
      }
      slabAt(brush, floor + STOREY - 1, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.CONCRETE);
      // Party walls, so the block is flats and not a warehouse with windows.
      for (let x = x0 + 6; x < x1; x += 6) {
        for (let y = floor; y < floor + STOREY - 1; y++) {
          for (let z = z0 + 1; z < z1; z++) brush.set(x, y, z, Block.CONCRETE);
        }
      }

      if (storey === 0) continue;
      // The balcony along the front and the walkway along the back, both cantilevered,
      // both with a parapet at the height a parapet actually is.
      slabAt(brush, floor - 1, x0, z0 - 2, x1, z0 - 1, Block.CONCRETE);
      ring(brush, floor, x0 - 1, z0 - 2, x1 + 1, z0 - 2, Block.CONCRETE);
      slabAt(brush, floor + 1, x0 - 1, z0 - 2, x1 + 1, z0 - 2, Block.WHITE_TILE_SLAB);
      slabAt(brush, floor - 1, x0, z1 + 1, x1, z1 + 2, Block.CONCRETE);
      ring(brush, floor, x0 - 1, z1 + 2, x1 + 1, z1 + 2, Block.CONCRETE);
      slabAt(brush, floor + 1, x0 - 1, z1 + 2, x1 + 1, z1 + 2, Block.WHITE_TILE_SLAB);
      // The dividers between one balcony and the next, which is what a run of balconies
      // has instead of one long ledge.
      for (let x = x0 + 6; x < x1; x += 6) {
        for (let y = floor; y < floor + 2; y++) brush.set(x, y, z0 - 2, Block.WHITE_TILE);
        brush.set(x, floor, z0 - 1, Block.WHITE_TILE);
      }
    }

    // The staircases at both ends, in the open air, with a half landing between floors.
    for (const [end, dir] of [[x0 - 1, -1], [x1 + 1, 1]] as const) {
      for (let storey = 0; storey < storeys; storey++) {
        const floor = 1 + storey * STOREY;
        for (let step = 0; step < STOREY; step++) {
          brush.set(end, floor + step, z1 - step, Block.CONCRETE_SLAB);
          brush.set(end + dir, floor + step, z1 - step, Block.CONCRETE_SLAB);
        }
        slabAt(brush, floor + STOREY - 1, end, z1 - STOREY, end + dir, z1 - STOREY + 1, Block.CONCRETE);
        post(brush, end + dir, z1 + 1, floor, floor + 2, Block.STEEL_COLUMN);
      }
    }

    // The ground floor: the entrance hall, the post boxes, and the bicycle shelter that
    // is on the end of every one of these.
    fill(brush, box(mid - 2, 1, z0, mid + 2, 3, z0), Block.AIR);
    slabAt(brush, 4, mid - 3, z0 - 3, mid + 3, z0, Block.WHITE_TILE_SLAB);
    for (const dx of [-3, 3]) post(brush, mid + dx, z0 - 3, 1, 3, Block.STEEL_COLUMN);
    for (let x = mid - 1; x <= mid + 1; x++) brush.set(x, 2, z0 + 1, Block.STEEL);
    fill(brush, box(x0, 0, z0 - 3, x0 + 5, 0, z0 - 1), Block.ASPHALT);
    slabAt(brush, 3, x0, z0 - 3, x0 + 5, z0 - 1, Block.STEEL);
    for (const x of [x0, x0 + 5]) post(brush, x, z0 - 3, 1, 2, Block.STEEL_COLUMN);

    rooftop(brush, x0, z0, x1, z1, 1 + storeys * STOREY - 1, { x: mid + 6, z: z0 + 3 });
    // The stair head at each end, and an aerial on top of one of them.
    for (const end of [x0 + 2, x1 - 2]) {
      fill(brush, box(end - 1, 25, z1 - 3, end + 1, 27, z1 - 1), Block.WHITE_TILE);
      slabAt(brush, 28, end - 2, z1 - 4, end + 2, z1, Block.CONCRETE_SLAB);
    }
    post(brush, x1 - 2, z1 - 2, 29, 30 + Math.floor(ctx.rng() * 2), Block.STEEL_COLUMN);
    backYard(outer, FRONTAGE + FLATS_D, ctx.rng);
  },
};

// --- 住宅 ---------------------------------------------------------------------

const HOUSE_W = 23;
const HOUSE_D = 19;
const HOUSE_H = 14;

const TOWN_HOUSE: Landmark = {
  id: 'jp_house',
  label: '住宅',
  note: 'ブロック塀の内側に二階建て。カーポート、瓦屋根、物干しのあるバルコニー',
  kind: 'modern',
  width: PLOT,
  depth: PLOT,
  height: HOUSE_H,
  depthBelow: 0,
  build(outer, ctx) {
    suburb(outer);
    const brush = inset(outer, (PLOT - HOUSE_W) / 2, FRONTAGE);
    // The block wall round the plot, and the garden inside it. A house here is a wall
    // with a house behind it, and leaving the wall off is what makes a Japanese street
    // look like a housing estate somewhere else.
    slabAt(brush, 0, 2, 3, HOUSE_W - 3, HOUSE_D - 2, Block.GRASS);
    const gate = { x0: 12, x1: 15 };
    perimeter(1, 2, HOUSE_W - 2, HOUSE_D - 2, (x, z, _along, corner) => {
      if (z === 2 && x >= gate.x0 && x <= gate.x1) return;
      // The carport opening: the wall stops for it.
      if (z === 2 && x >= 3 && x <= 8) return;
      for (let y = 1; y <= (corner ? 3 : 2); y++) brush.set(x, y, z, Block.CONCRETE);
      brush.set(x, corner ? 4 : 3, z, Block.CONCRETE_SLAB);
    });
    // The path from the gate to the door, and the carport beside it.
    fill(brush, box(gate.x0, 0, 2, gate.x1, 0, 8), Block.STONE_BRICKS);
    fill(brush, box(3, 0, 2, 8, 0, 8), Block.ASPHALT);
    for (const [x, z] of [[3, 3], [8, 3], [3, 8], [8, 8]] as const) post(brush, x, z, 1, 4, Block.STEEL_COLUMN);
    slabAt(brush, 5, 2, 2, 9, 9, Block.STEEL);

    // The house itself: two storeys, tiled below and rendered above, which is what half
    // the houses on any street look like.
    const hx0 = 9;
    const hx1 = HOUSE_W - 3;
    const hz0 = 6;
    const hz1 = HOUSE_D - 3;
    for (let y = 1; y <= 3; y++) {
      perimeter(hx0, hz0, hx1, hz1, (x, z, along, corner) => {
        const window = !corner && z !== hz0 && along % 3 === 0 && y === 2;
        brush.set(x, y, z, window ? Block.TINTED_GLASS : Block.WHITE_TILE);
      });
    }
    // The entrance: a recessed sliding door with a little roof over it.
    fill(brush, box(hx0 + 2, 1, hz0, hx0 + 3, 2, hz0), Block.AIR);
    brush.set(hx0 + 2, 3, hz0, Block.OAK_PLANKS);
    brush.set(hx0 + 3, 3, hz0, Block.OAK_PLANKS);
    slabAt(brush, 4, hx0 + 1, hz0 - 1, hx0 + 4, hz0, Block.SLATE);
    // A window onto the street, with a sill.
    opening(brush, box(hx1 - 4, 2, hz0, hx1 - 2, 2, hz0), Block.TINTED_GLASS, null);
    slabAt(brush, 4, hx0, hz0, hx1, hz1, Block.OAK_PLANKS);

    for (let y = 5; y <= 7; y++) {
      perimeter(hx0, hz0, hx1, hz1, (x, z, along, corner) => {
        const window = !corner && along % 4 < 2 && y === 6;
        brush.set(x, y, z, window ? Block.TINTED_GLASS : Block.PLASTER);
      });
    }
    // The balcony over the porch, with the washing pole that is on every one of them.
    slabAt(brush, 4, hx0 + 1, hz0 - 2, hx1 - 1, hz0 - 1, Block.CONCRETE);
    ring(brush, 5, hx0 + 1, hz0 - 2, hx1 - 1, hz0 - 2, Block.CONCRETE);
    slabAt(brush, 6, hx0 + 1, hz0 - 2, hx1 - 1, hz0 - 2, Block.WHITE_TILE_SLAB);
    for (const x of [hx0 + 2, hx1 - 2]) post(brush, x, hz0 - 1, 5, 6, Block.STEEL_COLUMN);
    for (let x = hx0 + 2; x <= hx1 - 2; x++) brush.set(x, 7, hz0 - 1, Block.STEEL);

    // The roof: a shallow tiled gable with the deep eaves that go with it.
    slabAt(brush, 8, hx0 - 1, hz0 - 1, hx1 + 1, hz1 + 1, Block.SLATE);
    for (let course = 0; course < 4; course++) {
      const z0 = hz0 - 1 + course;
      const z1 = hz1 + 1 - course;
      if (z0 > z1) break;
      const ridge = 9 + course;
      for (let z = z0; z <= z1; z++) {
        for (let x = hx0 - 1; x <= hx1 + 1; x++) {
          const block = course === 3 ? Block.SLATE
            : z === z0 ? Block.SLATE_ROOF_SOUTH
              : z === z1 ? Block.SLATE_ROOF_NORTH : Block.SLATE;
          brush.set(x, ridge, z, block);
        }
      }
    }
    // A garden: one tree, a hedge along the wall and a couple of flowers.
    brush.set(4, 1, HOUSE_D - 4, Block.OAK_LOG);
    brush.set(4, 2, HOUSE_D - 4, Block.OAK_LOG);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) brush.set(4 + dx, 3, HOUSE_D - 4 + dz, Block.OAK_LEAVES);
    }
    brush.set(4, 4, HOUSE_D - 4, Block.OAK_LEAVES);
    for (let z = 10; z <= HOUSE_D - 4; z += 2) brush.set(2, 1, z, Block.OAK_LEAVES);
    if (ctx.rng() < 0.9) brush.set(6, 1, 12, Block.FLOWER_RED);
    if (ctx.rng() < 0.9) brush.set(7, 1, 14, Block.FLOWER_YELLOW);
    // And the outdoor unit that every house has round the side.
    airCon(brush, hx1, 2, hz1 - 2);
  },
};

/** The modern quarter, in the order the showcase seats it. */
export const JAPANESE: readonly Landmark[] = [TOWER_BLOCK, TENANT_BLOCK, APARTMENT, TOWN_HOUSE];

export { TOWER_BLOCK, TENANT_BLOCK, APARTMENT, TOWN_HOUSE };
