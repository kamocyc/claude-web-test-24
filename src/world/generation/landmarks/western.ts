import { Block, type BlockId } from '../../blocks';
import {
  SLATE_ROOF, TILE_ROOF,
  box, fill, gableRoof, hollowOut, post, ring, slabAt, walls,
  type Brush,
} from './brush';
import type { Landmark } from './types';

/**
 * Western domestic architecture: a country house and a terrace of town houses.
 *
 * Both are built the way the originals were, because that is what makes them
 * read as buildings rather than as decorated boxes:
 *
 *  - the wall changes material as it goes up. Stone plinth, brick ground floor,
 *    timber and plaster above. A wall of one material for four storeys is a
 *    warehouse.
 *  - the storeys are marked. A string course, a jetty, a cornice — one line of a
 *    different block at each floor, which is what gives a small building scale.
 *  - the roof is steep and it has things on it. Chimneys and dormers are most of
 *    what you see of a house from any distance at all.
 */

/** A window of `w` x `h` panes with its own sill and lintel. `axis` is the axis the
 *  wall runs along and `at` its fixed coordinate on the other one. Sills matter:
 *  without one a window is a hole. */
function sashWindow(
  brush: Brush,
  axis: 'x' | 'z',
  at: number,
  along: number,
  y: number,
  w: number,
  h: number,
  glazing: BlockId,
  trim: BlockId,
  /** Whether to run the trim over the head as well as under the sill. Off on a
   *  timber-framed wall: four windows with a lintel each put oak across two of
   *  the storey's four courses and turn the plaster panels back into a band. */
  head = true,
): void {
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const x = axis === 'x' ? along + i : at;
      const z = axis === 'x' ? at : along + i;
      brush.set(x, y + j, z, glazing);
    }
  }
  for (let i = 0; i < w; i++) {
    const x = axis === 'x' ? along + i : at;
    const z = axis === 'x' ? at : along + i;
    brush.set(x, y - 1, z, trim);
    if (head) brush.set(x, y + h, z, trim);
  }
}

export const MANOR_HOUSE: Landmark = {
  id: 'manor_house',
  label: '木骨造の洋館',
  note: '石の基礎、レンガの一階、張り出した木骨の二階、急勾配の粘板岩屋根に屋根窓と煙突。',
  kind: 'western',
  width: 27,
  depth: 21,
  height: 24,
  depthBelow: 1,
  build(brush, ctx) {
    // --- grounds -----------------------------------------------------------
    slabAt(brush, 0, 0, 0, 26, 20, Block.GRASS);
    // A low garden wall with a gate: a house without a boundary sits in a field.
    ring(brush, 1, 0, 0, 26, 20, Block.BRICKS);
    ring(brush, 2, 0, 0, 26, 20, Block.STONE_BRICK_SLAB);
    hollowOut(brush, box(12, 1, 0, 14, 2, 0));
    for (const x of [11, 15]) {
      post(brush, x, 0, 1, 3, Block.STONE_BRICKS);
      brush.set(x, 4, 0, Block.LANTERN);
    }

    // --- the house ---------------------------------------------------------
    const x0 = 4, x1 = 22, z0 = 6, z1 = 18;
    fill(brush, box(x0, -1, z0, x1, 0, z1), Block.STONE_BRICKS);
    slabAt(brush, 1, x0, z0, x1, z1, Block.OAK_PLANKS);

    // Plinth, then brick to the first floor. Quoins on the corners: the stone
    // that turns two brick walls into one building.
    walls(brush, box(x0, 1, z0, x1, 1, z1), Block.STONE_BRICKS);
    walls(brush, box(x0, 2, z0, x1, 5, z1), Block.BRICKS);
    // Only as far as the brick goes: above the jetty the wall has moved out a
    // block and the quoins would be buried inside the storey above.
    for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) {
      post(brush, qx, qz, 1, 5, Block.STONE_BRICKS);
    }

    // The jetty: the upper floor oversails by a block all round, carried on the
    // ends of the joists. It is the single most recognisable thing about the
    // type, and it is also what stops the two storeys reading as one wall.
    ring(brush, 6, x0 - 1, z0 - 1, x1 + 1, z1 + 1, Block.OAK_SLAB);
    walls(brush, box(x0 - 1, 7, z0 - 1, x1 + 1, 10, z1 + 1), Block.TIMBER_FRAME);
    // Plaster panels between the posts, over the whole height of the storey and on
    // the long walls only — the gable ends keep their timber, where the bracing
    // would be. The panels have to run the full height: leave a course of timber
    // at the top and bottom of the wall and the elevation reads as a brown band
    // with white in it rather than as white panels in a frame.
    for (let x = x0; x <= x1; x++) {
      if ((x - x0) % 4 === 0) continue;
      for (let y = 7; y <= 10; y++) {
        brush.set(x, y, z0 - 1, Block.PLASTER);
        brush.set(x, y, z1 + 1, Block.PLASTER);
      }
    }
    slabAt(brush, 6, x0, z0, x1, z1, Block.OAK_PLANKS);
    // The wall plate the roof sits on.
    ring(brush, 11, x0 - 1, z0 - 1, x1 + 1, z1 + 1, Block.OAK_LOG);

    // --- windows -----------------------------------------------------------
    // Two windows either side of the door rather than four at an even pitch: at
    // four the second one runs into the doorway and loses a pane, and a facade
    // with one lopsided window on it is a facade nobody trusts.
    for (const at of [x0 + 2, x0 + 6, x1 - 7, x1 - 3]) {
      sashWindow(brush, 'x', z0, at, 3, 2, 2, Block.GLASS, Block.STONE_BRICKS);
      sashWindow(brush, 'x', z1, at, 3, 2, 2, Block.GLASS, Block.STONE_BRICKS);
      sashWindow(brush, 'x', z0 - 1, at, 8, 2, 2, Block.GLASS, Block.OAK_LOG, false);
      sashWindow(brush, 'x', z1 + 1, at, 8, 2, 2, Block.GLASS, Block.OAK_LOG, false);
    }
    for (const wall of [x0, x1]) {
      sashWindow(brush, 'z', wall, z0 + 5, 3, 3, 2, Block.GLASS, Block.STONE_BRICKS);
    }

    // --- porch and door ----------------------------------------------------
    const doorX = 13;
    hollowOut(brush, box(doorX - 1, 2, z0, doorX + 1, 4, z0));
    ring(brush, 5, doorX - 2, z0 - 3, doorX + 2, z0, Block.OAK_LOG);
    slabAt(brush, 5, doorX - 1, z0 - 2, doorX + 1, z0 - 1, Block.OAK_PLANKS);
    // Stopping a block short of the house: run it to `z0` and the ridge climbs to
    // eight, which is a grey wedge driven through the middle of the timbered storey.
    gableRoof(brush, SLATE_ROOF, doorX - 2, z0 - 3, doorX + 2, z0 - 1, 6, 'z');
    for (const x of [doorX - 2, doorX + 2]) post(brush, x, z0 - 3, 1, 4, Block.WOOD_COLUMN);
    brush.set(doorX - 3, 2, z0 - 2, Block.LANTERN);
    brush.set(doorX + 3, 2, z0 - 2, Block.LANTERN);
    // The path from the gate, and the two beds either side of it.
    for (let z = 1; z <= z0 - 3; z++) {
      for (let x = doorX - 1; x <= doorX + 1; x++) brush.set(x, 1, z, Block.STONE_BRICK_SLAB);
    }
    for (let z = 2; z <= 4; z++) {
      for (const x of [doorX - 3, doorX + 3]) {
        brush.set(x, 1, z, ctx.rng() < 0.5 ? Block.FLOWER_RED : Block.FLOWER_YELLOW);
      }
    }

    // --- roof, dormers and chimneys ----------------------------------------
    const ridge = gableRoof(brush, SLATE_ROOF, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 12, 'x');
    // Dormers, on the front slope only. Each is a little gabled box pushed out of
    // the roof, glazed on its face, with the slates cut back around it.
    for (const at of [x0 + 3, doorX, x1 - 3]) {
      const dz = z0 + 1;
      // Five wide rather than three. A dormer is mostly window — at three wide the
      // frame is the whole of it and the roof grows three brown lumps instead of
      // three little houses. The gables stay two blocks clear of one another.
      hollowOut(brush, box(at - 2, 14, dz - 2, at + 2, 17, dz + 1));
      walls(brush, box(at - 2, 14, dz - 2, at + 2, 15, dz), Block.PLASTER);
      for (const corner of [at - 2, at + 2]) post(brush, corner, dz - 2, 14, 15, Block.OAK_LOG);
      sashWindow(brush, 'x', dz - 2, at - 1, 14, 3, 2, Block.GLASS, Block.OAK_LOG);
      gableRoof(brush, SLATE_ROOF, at - 2, dz - 3, at + 2, dz, 16, 'z');
    }
    for (const at of [x0 + 1, x1 - 1]) {
      post(brush, at, z0 + 5, 12, ridge + 3, Block.BRICKS);
      post(brush, at, z0 + 6, 12, ridge + 3, Block.BRICKS);
      brush.set(at, ridge + 4, z0 + 5, Block.STONE_BRICK_SLAB);
      brush.set(at, ridge + 4, z0 + 6, Block.STONE_BRICK_SLAB);
    }
  },
};

export const TOWNHOUSE_ROW: Landmark = {
  id: 'townhouse_row',
  label: 'レンガの連棟住宅',
  note: '同じ間口が四つ並ぶ街並み。一階は店舗、上は下見窓、屋根は洋瓦と共用煙突。',
  kind: 'western',
  width: 35,
  depth: 17,
  height: 24,
  depthBelow: 1,
  build(brush, ctx) {
    const units = 4;
    const bay = 8;
    const x0 = 1;
    const x1 = x0 + units * bay;
    const z0 = 5, z1 = 13;

    // --- street ------------------------------------------------------------
    slabAt(brush, 0, 0, 0, 34, 16, Block.GRASS);
    slabAt(brush, 1, 0, 0, 34, 3, Block.STONE_BRICK_SLAB);
    slabAt(brush, 1, 0, 4, 34, 4, Block.CONCRETE);
    for (let x = 2; x <= 32; x += 10) {
      post(brush, x, 1, 2, 3, Block.STEEL_COLUMN);
      brush.set(x, 4, 1, Block.LANTERN);
    }

    // --- shell -------------------------------------------------------------
    fill(brush, box(x0, -1, z0, x1, 0, z1), Block.STONE_BRICKS);
    walls(brush, box(x0, 1, z0, x1, 1, z1), Block.STONE_BRICKS);
    walls(brush, box(x0, 2, z0, x1, 12, z1), Block.BRICKS);
    // Inside the walls. Laid over the full footprint they cut three bands of oak
    // straight through the brick, which on a terrace seen down an avenue is the
    // first thing anybody notices.
    for (const y of [1, 5, 9]) slabAt(brush, y, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.OAK_PLANKS);

    // Party walls carried up through the front: what makes four houses out of one
    // long building, and what the shared chimneys stand on.
    for (let unit = 0; unit <= units; unit++) {
      const px = x0 + unit * bay;
      post(brush, px, z0, 1, 13, Block.STONE_BRICKS);
      post(brush, px, z1, 1, 13, Block.STONE_BRICKS);
    }

    // --- fronts ------------------------------------------------------------
    for (let unit = 0; unit < units; unit++) {
      const left = x0 + unit * bay + 1;
      const mid = left + 3;
      // Ground floor: a glazed shopfront under a stone lintel, with the door on
      // the same side of every bay so the rhythm is a street rather than a wall.
      for (let x = left; x < left + bay - 1; x++) {
        for (let y = 2; y <= 4; y++) brush.set(x, y, z0, Block.GLASS);
      }
      hollowOut(brush, box(left, 2, z0, left + 1, 4, z0));
      // Two upper storeys of paired sashes.
      for (const y of [6, 10]) {
        sashWindow(brush, 'x', z0, left + 1, y, 2, 3, Block.GLASS, Block.MARBLE);
        sashWindow(brush, 'x', z0, left + 4, y, 2, 3, Block.GLASS, Block.MARBLE);
      }
      // The shopfront's lintel last: drawn before the sashes, their sills paint
      // over the whole of it and the ground floor loses its top edge.
      for (let x = left - 1; x <= left + bay - 1; x++) brush.set(x, 5, z0, Block.STONE_BRICK_SLAB);
      // Back windows, plainer, as they always are.
      for (const y of [6, 10]) sashWindow(brush, 'x', z1, mid - 1, y, 3, 2, Block.GLASS, Block.BRICKS);
      // The step up off the pavement.
      for (let x = left; x <= left + 1; x++) {
        brush.set(x, 1, z0 - 1, Block.STONE_BRICK_SLAB);
        brush.set(x, 1, z0 - 2, Block.STONE_BRICK_SLAB);
      }
      brush.set(left - 1, 2, z0 - 1, Block.LANTERN);
      // One shop in the row keeps its awning out.
      if (ctx.rng() < 0.5) {
        for (let x = left; x < left + bay - 1; x++) brush.set(x, 5, z0 - 1, Block.WOOL);
      }
    }

    // --- cornice, roof and chimneys ----------------------------------------
    ring(brush, 13, x0 - 1, z0 - 1, x1 + 1, z1 + 1, Block.MARBLE);
    ring(brush, 14, x0 - 1, z0 - 1, x1 + 1, z1 + 1, Block.MARBLE_SLAB);
    const ridge = gableRoof(brush, TILE_ROOF, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 14, 'x');
    for (let unit = 0; unit <= units; unit++) {
      const px = x0 + unit * bay;
      // The stack sits astride the party wall, which is why a terrace has one
      // chimney between every pair of houses rather than two.
      for (let z = z0 + 3; z <= z0 + 4; z++) post(brush, px, z, 14, ridge + 3, Block.BRICKS);
      for (let z = z0 + 3; z <= z0 + 4; z++) brush.set(px, ridge + 4, z, Block.STONE_BRICK_SLAB);
    }
    // Back yards, so the row has a behind as well as a front. One per house, and
    // the loop stops before it reaches the far party wall — running to `x1` adds
    // a fifth yard one block wide.
    for (let unit = 0; unit < units; unit++) {
      const left = x0 + unit * bay;
      ring(brush, 1, left, z1 + 1, left + bay, 16, Block.BRICKS);
    }
  },
};
