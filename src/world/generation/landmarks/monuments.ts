import { Block, type BlockId } from '../../blocks';
import {
  COPPER_ROOF,
  box, fill, hipRoof, hollowOut, post, ring, slabAt, walls,
  type Brush,
} from './brush';
import type { Landmark } from './types';

/**
 * The two things a town builds to be looked at rather than used.
 *
 * A landmark's whole job is its outline against the sky, so both of these are
 * designed from the silhouette inwards: the clock tower is a shaft with one
 * event near the top, the lattice tower is four curves that meet. Neither has
 * much of an inside, and that is the honest shape of the thing.
 */

/** How far a leg of the lattice tower stands from the centre at a given height. */
function legOffset(y: number, y0: number, y1: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (y - y0) / Math.max(1, y1 - y0)));
  // Eased rather than linear: a real splayed leg is a curve that starts steep and
  // stands up as it rises, and a straight taper reads as a pylon instead.
  const eased = 1 - Math.pow(1 - t, 1.7);
  return Math.round(from + (to - from) * eased);
}

/**
 * The four legs of one stage, and the members that tie them together.
 *
 * The bracing is walked *across* the face rather than up it. A member that rises
 * one block per step advances three or four horizontally, so stepping in y left
 * every cell of it out of reach of the last — 112 blocks of the first version
 * hung in the air with no neighbour at all, which is exactly how it looked. Walk
 * the long axis and each brace comes out a connected run.
 */
function lattice(
  brush: Brush,
  c: number,
  y0: number,
  y1: number,
  from: number,
  to: number,
  beltPitch: number,
): void {
  for (let y = y0; y <= y1; y++) {
    const off = legOffset(y, y0, y1, from, to);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      brush.set(c + sx * off, y, c + sz * off, Block.STEEL_COLUMN);
    }
  }
  // One brace per bay, mirrored on the next, which is the pattern that reads as
  // lattice. The belt at the top of each bay is drawn from the same walk, so it
  // lands on the legs at that height rather than at some other stage's offset.
  for (let bay = y0; bay + beltPitch <= y1; bay += beltPitch) {
    const rise = beltPitch;
    const lean = ((bay - y0) / beltPitch) % 2 === 0 ? 1 : -1;
    const top = bay + rise;
    const beltOff = legOffset(top, y0, y1, from, to);
    ring(brush, top, c - beltOff, c - beltOff, c + beltOff, c + beltOff, Block.STEEL);
    const span = legOffset(bay, y0, y1, from, to);
    for (let step = 0; step <= 2 * span; step++) {
      const across = (-span + step) * lean;
      // y from the position across the face, so consecutive cells touch.
      const y = bay + Math.round((step / (2 * span)) * rise);
      const off = legOffset(y, y0, y1, from, to);
      brush.set(c + across, y, c - off, Block.STEEL);
      brush.set(c + across, y, c + off, Block.STEEL);
      brush.set(c - off, y, c + across, Block.STEEL);
      brush.set(c + off, y, c + across, Block.STEEL);
    }
  }
}

/** A deck with a railing: the only part of the tower anybody stands on. */
function platform(brush: Brush, c: number, y: number, half: number, deck: BlockId): void {
  slabAt(brush, y, c - half, c - half, c + half, c + half, deck);
  ring(brush, y + 1, c - half, c - half, c + half, c + half, Block.STEEL_COLUMN);
  ring(brush, y + 2, c - half, c - half, c + half, c + half, Block.STEEL);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    brush.set(c + sx * (half - 1), y + 1, c + sz * (half - 1), Block.LANTERN);
  }
}

export const LATTICE_TOWER: Landmark = {
  id: 'lattice_tower',
  label: '鉄骨の展望塔',
  note: '四本の脚が曲線を描いて立ち上がり、二段の展望台とマストで結ばれる。',
  kind: 'monument',
  width: 29,
  depth: 29,
  height: 74,
  depthBelow: 3,
  build(brush) {
    const c = 14;
    slabAt(brush, 0, 0, 0, 28, 28, Block.CONCRETE);
    ring(brush, 0, 0, 0, 28, 28, Block.STONE_BRICK_SLAB);

    // Footings. Each leg lands on its own block of concrete, which is what a
    // structure this heavy actually needs and also stops the legs looking as if
    // they are resting on the grass.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      fill(brush, box(c + sx * 13 - 1, -3, c + sz * 13 - 1, c + sx * 13 + 1, 1, c + sz * 13 + 1), Block.CONCRETE);
    }

    // --- first stage: 13 out at the ground, 5 out at the first platform -----
    const STAGE1 = { y0: 1, y1: 26, from: 13, to: 5 };
    lattice(brush, c, STAGE1.y0, STAGE1.y1, STAGE1.from, STAGE1.to, 6);
    // The arch under each face. Its plane has to follow the legs as they lean in,
    // or the springing lands two blocks inboard of the leg it is supposed to meet
    // and the arch stands in the middle of nothing.
    const ARCH_RISE = 13;
    for (let a = -12; a <= 12; a++) {
      const h = Math.round(ARCH_RISE * Math.sqrt(Math.max(0, 1 - (a / 13) * (a / 13))));
      if (h < 2) continue;
      const off = legOffset(h, STAGE1.y0, STAGE1.y1, STAGE1.from, STAGE1.to);
      if (Math.abs(a) > off) continue;
      brush.set(c + a, h, c - off, Block.STEEL);
      brush.set(c + a, h, c + off, Block.STEEL);
      brush.set(c - off, h, c + a, Block.STEEL);
      brush.set(c + off, h, c + a, Block.STEEL);
    }
    platform(brush, c, 27, 8, Block.STEEL);

    // --- second stage ------------------------------------------------------
    // Starting where the platform's railing ends rather than above it: leave the
    // two courses the railing occupies and the whole upper half of the tower
    // stands on a gap you can see daylight through.
    lattice(brush, c, 28, 52, 5, 3, 6);
    platform(brush, c, 53, 4, Block.STEEL);

    // --- mast --------------------------------------------------------------
    for (let y = 54; y <= 70; y++) {
      brush.set(c, y, c, Block.STEEL_COLUMN);
      if ((y - 54) % 5 === 0) ring(brush, y, c - 1, c - 1, c + 1, c + 1, Block.STEEL);
    }
    brush.set(c, 71, c, Block.LANTERN);
    brush.set(c, 72, c, Block.GOLD_BLOCK);
  },
};

/**
 * A clock face: a pale dial in a gilt ring, with dark hands on it.
 *
 * The first version had it the other way round — gold field, marble ring — and
 * on a marble-quoined stone tower the ring vanished into the wall and the dial
 * read as a yellow square. The dial has to be the *lightest* thing and the ring
 * the brightest, because at fifty blocks a clock is a light circle with a mark
 * across it and nothing else.
 */
function clockFace(brush: Brush, axis: 'x' | 'z', at: number, along: number, y: number): void {
  const put = (a: number, b: number, block: BlockId): void => {
    const x = axis === 'x' ? along + a : at;
    const z = axis === 'x' ? at : along + a;
    brush.set(x, y + b, z, block);
  };
  for (let b = -2; b <= 2; b++) {
    for (let a = -2; a <= 2; a++) {
      // The corners are cut back to the wall and the edge midpoints kept, so the
      // gilt ring comes out an octagon rather than a square.
      if (Math.abs(a) === 2 && Math.abs(b) === 2) continue;
      const edge = Math.abs(a) === 2 || Math.abs(b) === 2;
      put(a, b, edge ? Block.GOLD_BLOCK : Block.MARBLE);
    }
  }
  // Hands at ten past ten, which is where every clock in every photograph is.
  put(0, 0, Block.SLATE);
  put(0, 1, Block.SLATE);
  put(-1, 1, Block.SLATE);
}

export const CLOCK_TOWER: Landmark = {
  id: 'clock_tower',
  label: '時計塔',
  note: '石の塔身に大理石の隅石、四面の金の文字盤、緑青の尖塔。',
  kind: 'monument',
  width: 17,
  depth: 17,
  height: 67,
  depthBelow: 2,
  build(brush) {
    const c = 8;
    slabAt(brush, 0, 0, 0, 16, 16, Block.STONE_BRICKS);

    // --- podium: three steps -----------------------------------------------
    fill(brush, box(1, -2, 1, 15, 0, 15), Block.STONE_BRICKS);
    slabAt(brush, 1, 1, 1, 15, 15, Block.MARBLE_SLAB);
    slabAt(brush, 2, 2, 2, 14, 14, Block.MARBLE);
    slabAt(brush, 3, 3, 3, 13, 13, Block.MARBLE);
    ring(brush, 4, 3, 3, 13, 13, Block.MARBLE_SLAB);

    // --- shaft: 9 x 9 to the clock stage -----------------------------------
    const s0 = c - 4, s1 = c + 4;
    walls(brush, box(s0, 4, s0, s1, 36, s1), Block.STONE_BRICKS);
    slabAt(brush, 4, s0, s0, s1, s1, Block.MARBLE);
    for (const [qx, qz] of [[s0, s0], [s1, s0], [s0, s1], [s1, s1]] as const) {
      post(brush, qx, qz, 4, 36, Block.MARBLE);
    }
    // A string course every eight blocks: without them a shaft this tall is one
    // long wall with nothing to measure it by.
    for (const y of [12, 20, 28]) {
      ring(brush, y, s0 - 1, s0 - 1, s1 + 1, s1 + 1, Block.MARBLE_SLAB);
    }
    // One recessed panel per storey, in a second stone. Thirty blocks of one
    // material with a slit in it is a chimney; the panel is what puts a shadow
    // on the shaft at the distance the tower is actually looked at from.
    for (const y of [6, 14, 22, 30]) {
      for (const [ax, az] of [[c, s0], [c, s1], [s0, c], [s1, c]] as const) {
        for (let d = -1; d <= 1; d++) {
          const px = ax === c ? c + d : ax;
          const pz = az === c ? c + d : az;
          fill(brush, box(px, y, pz, px, y + 5, pz), Block.SLATE);
        }
      }
    }
    // A tall lancet up the middle of each panel, framed in marble.
    for (const y of [7, 15, 23, 31]) {
      for (const [ax, az] of [[c, s0], [c, s1], [s0, c], [s1, c]] as const) {
        fill(brush, box(ax, y, az, ax, y + 4, az), Block.STAINED_GLASS);
        brush.set(ax, y + 5, az, Block.MARBLE);
        brush.set(ax, y - 1, az, Block.MARBLE);
      }
    }
    // A door at the foot, and the stair landing behind it.
    hollowOut(brush, box(c - 1, 5, s0, c + 1, 7, s0));
    ring(brush, 8, c - 2, s0 - 1, c + 2, s0, Block.MARBLE);
    brush.set(c - 3, 5, s0 - 1, Block.LANTERN);
    brush.set(c + 3, 5, s0 - 1, Block.LANTERN);

    // --- clock stage: corbelled out to 11 x 11 -----------------------------
    const k0 = c - 5, k1 = c + 5;
    ring(brush, 37, k0, k0, k1, k1, Block.MARBLE_SLAB);
    walls(brush, box(k0, 38, k0, k1, 46, k1), Block.STONE_BRICKS);
    for (const [qx, qz] of [[k0, k0], [k1, k0], [k0, k1], [k1, k1]] as const) {
      post(brush, qx, qz, 38, 46, Block.MARBLE);
    }
    // `at` is the wall's fixed coordinate on the other axis, which happens to be
    // the same number on both axes only because the clock stage is square. Named
    // rather than reused, so it stays right if it ever stops being.
    const north = k0, south = k1, west = k0, east = k1;
    clockFace(brush, 'x', north, c, 42);
    clockFace(brush, 'x', south, c, 42);
    clockFace(brush, 'z', west, c, 42);
    clockFace(brush, 'z', east, c, 42);

    // --- belfry and balcony ------------------------------------------------
    // Decked, not merely edged. A ring on its own leaves the whole bell chamber
    // and the spire above it standing over a two-course slot, and gives the
    // balcony no floor to stand on.
    slabAt(brush, 47, k0 - 1, k0 - 1, k1 + 1, k1 + 1, Block.MARBLE);
    ring(brush, 48, k0 - 1, k0 - 1, k1 + 1, k1 + 1, Block.MARBLE_SLAB);
    for (let i = 0; i <= (k1 + 1) - (k0 - 1); i += 2) {
      const a = k0 - 1 + i;
      post(brush, a, k0 - 1, 48, 50, Block.STONE_COLUMN);
      post(brush, a, k1 + 1, 48, 50, Block.STONE_COLUMN);
      post(brush, k0 - 1, a, 48, 50, Block.STONE_COLUMN);
      post(brush, k1 + 1, a, 48, 50, Block.STONE_COLUMN);
    }
    // The bell chamber itself: open on all four sides above the balustrade.
    walls(brush, box(k0, 49, k0, k1, 53, k1), Block.STONE_BRICKS);
    for (const [ax, az] of [[c, k0], [c, k1], [k0, c], [k1, c]] as const) {
      hollowOut(brush, box(ax - 1, 49, az, ax + 1, 52, az));
    }
    brush.set(c, 52, c, Block.GOLD_BLOCK);
    brush.set(c, 51, c, Block.LANTERN);
    ring(brush, 54, k0 - 1, k0 - 1, k1 + 1, k1 + 1, Block.MARBLE_SLAB);

    // --- spire -------------------------------------------------------------
    const apex = hipRoof(brush, COPPER_ROOF, k0 - 1, k0 - 1, k1 + 1, k1 + 1, 55);
    post(brush, c, c, apex + 1, apex + 4, Block.COPPER_PANEL);
    brush.set(c, apex + 5, c, Block.GOLD_BLOCK);
  },
};
