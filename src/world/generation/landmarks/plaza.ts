import { Block, type BlockId } from '../../blocks';
import { box, ellipse, fill, post, ring, slabAt } from './brush';
import type { Landmark } from './types';

/**
 * The square the exhibits stand around.
 *
 * It is here for three reasons and each of them shows in the layout. It is
 * somewhere to arrive — the player is put down on it, so it has to be open,
 * level and obviously the middle of something. It is somewhere to look *from*:
 * every exhibit is on a radius from this point, so the whole set can be taken in
 * by turning round. And it is the legend: the eight pillars around the fountain
 * are each built of the material of the building they point at, which is a key
 * that needs no text to read.
 */

/** Rows of the compass, clockwise from north, which is the order the showcase
 *  seats its exhibits in and therefore the order the marker pillars go in. */
const MARKER_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

const SIDE = 45;

/**
 * Builds the plaza. `markers` are the eight facing materials, in `MARKER_DIRS`
 * order; a short list simply leaves the remaining pillars plain.
 */
export function createPlaza(markers: readonly BlockId[]): Landmark {
  return {
    id: 'plaza',
    label: '中央広場',
    note: '噴水と八本の標柱。標柱はその方角に建つ展示の素材でできている。',
    kind: 'plaza',
    width: SIDE,
    depth: SIDE,
    height: 8,
    depthBelow: 3,
    build(brush, ctx) {
      const c = (SIDE - 1) / 2;

      // --- paving -----------------------------------------------------------
      // Concentric rather than square: a round plaza tells you where its middle
      // is, and the middle is the only thing the player has to find.
      ellipse(brush, 0, c, c, 21.5, 21.5, Block.CONCRETE);
      ellipse(brush, 0, c, c, 21.5, 21.5, Block.MARBLE_SLAB, true);
      ellipse(brush, 0, c, c, 14.5, 14.5, Block.STONE_BRICKS, true);
      ellipse(brush, 0, c, c, 13.5, 13.5, Block.STONE_BRICKS, true);
      // Four ways in, paved through the ring so the avenues actually meet it.
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        for (let r = 13; r <= 22; r++) {
          for (let a = -2; a <= 2; a++) {
            const x = c + dx * r + (dx === 0 ? a : 0);
            const z = c + dz * r + (dz === 0 ? a : 0);
            brush.set(x, 0, z, Block.CONCRETE);
          }
        }
      }

      // --- fountain ----------------------------------------------------------
      // A sealed bowl: marble all the way round and underneath, because water
      // that can find a way out of its basin will.
      for (let y = -3; y <= 0; y++) ellipse(brush, y, c, c, 6.5, 6.5, Block.MARBLE);
      for (let y = -1; y <= 0; y++) ellipse(brush, y, c, c, 5.2, 5.2, Block.WATER);
      ellipse(brush, 0, c, c, 6.5, 6.5, Block.MARBLE_SLAB, true);
      // The pedestal in the middle of it, and the jet on top.
      fill(brush, box(c - 1, -1, c - 1, c + 1, 1, c + 1), Block.MARBLE);
      post(brush, c, c, 2, 4, Block.MARBLE_COLUMN);
      ellipse(brush, 5, c, c, 2.2, 2.2, Block.MARBLE_SLAB);
      brush.set(c, 6, c, Block.GOLD_BLOCK);

      // --- marker pillars ----------------------------------------------------
      for (let i = 0; i < MARKER_DIRS.length; i++) {
        const [dx, dz] = MARKER_DIRS[i];
        // Normalised so the diagonals sit on the same ring as the cardinals
        // rather than a factor of root two further out.
        const len = Math.hypot(dx, dz);
        const x = c + Math.round((dx / len) * 10);
        const z = c + Math.round((dz / len) * 10);
        const facing = markers[i] ?? Block.STONE_BRICKS;
        brush.set(x, 1, z, Block.MARBLE);
        post(brush, x, z, 2, 4, facing);
        brush.set(x, 5, z, Block.MARBLE_SLAB);
        brush.set(x, 6, z, Block.LANTERN);
      }

      // --- planting, benches and lamps ---------------------------------------
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const bx = c + dx * 14;
        const bz = c + dz * 14;
        // A raised bed: kerb, soil, and something growing out of it.
        ring(brush, 1, bx - 2, bz - 2, bx + 2, bz + 2, Block.MARBLE_SLAB);
        slabAt(brush, 0, bx - 2, bz - 2, bx + 2, bz + 2, Block.DIRT);
        slabAt(brush, 1, bx - 1, bz - 1, bx + 1, bz + 1, Block.GRASS);
        for (let z = bz - 1; z <= bz + 1; z++) {
          for (let x = bx - 1; x <= bx + 1; x++) {
            brush.set(x, 2, z, ctx.rng() < 0.5 ? Block.FLOWER_RED : Block.FLOWER_YELLOW);
          }
        }
        // One tree per bed, built out of blocks rather than left to the object
        // trees: those are placed by the world and would land anywhere.
        const tx = bx + dx * 4;
        const tz = bz + dz * 4;
        post(brush, tx, tz, 1, 5, Block.OAK_LOG);
        for (let y = 4; y <= 7; y++) {
          const r = y === 4 ? 2.6 : y === 5 ? 2.6 : y === 6 ? 2.0 : 1.2;
          ellipse(brush, y, tx, tz, r, r, Block.OAK_LEAVES);
        }
        brush.set(tx, 4, tz, Block.OAK_LOG);
        brush.set(tx, 5, tz, Block.OAK_LOG);
      }
      // Benches on the inner ring, facing the water. With a back: a row of flat
      // half-blocks on the ground reads as a doormat, and the back is the only
      // part of a bench that is visible from standing height anyway.
      for (const [dx, dz] of MARKER_DIRS) {
        const len = Math.hypot(dx, dz);
        const bx = c + Math.round((dx / len) * 13);
        const bz = c + Math.round((dz / len) * 13);
        const alongX = dz !== 0 ? 1 : 0;
        for (let a = -1; a <= 1; a++) {
          const x = bx + alongX * a;
          const z = bz + (alongX === 1 ? 0 : a);
          brush.set(x, 1, z, Block.OAK_SLAB);
          // Behind the seat, which is the side away from the fountain.
          brush.set(x + Math.sign(dx) * (alongX === 1 ? 0 : 1), 2, z + (alongX === 1 ? Math.sign(dz) : 0), Block.OAK_PLANKS);
        }
      }
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const x = c + Math.round(Math.cos(angle) * 20);
        const z = c + Math.round(Math.sin(angle) * 20);
        post(brush, x, z, 1, 3, Block.STONE_COLUMN);
        brush.set(x, 4, z, Block.LANTERN);
      }
    },
  };
}
