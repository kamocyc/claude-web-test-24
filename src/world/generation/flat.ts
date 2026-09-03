import { Block, type BlockId } from '../blocks';

/**
 * The superflat test world's ground.
 *
 * Deliberately the dullest terrain there is: one height everywhere, four layers,
 * no caves, no ore, no water and no villages. That is the point of it — a test
 * world exists so that what is being looked at is the *building*, and a hillside
 * behind an exhibit is one more thing that could be the reason something looks
 * wrong.
 *
 * The surface sits well above `SEA_LEVEL` so the biome classifier calls it
 * plains rather than ocean, and well below `CHUNK_HEIGHT` so the tallest exhibit
 * still has sky over it: the glass tower reaches 76 blocks, which lands at 116
 * with 12 to spare.
 */

/** Y of the topmost ground block. A player stands at `FLAT_GROUND_Y + 1`. */
export const FLAT_GROUND_Y = 40;

/** Downwards from the surface: turf, soil, and stone to the bedrock. */
export const FLAT_SOIL_DEPTH = 3;

/** The block a superflat column is made of at a given Y. */
export function flatBlockAt(y: number): BlockId {
  if (y > FLAT_GROUND_Y || y < 0) return Block.AIR;
  if (y === FLAT_GROUND_Y) return Block.GRASS;
  if (y > FLAT_GROUND_Y - 1 - FLAT_SOIL_DEPTH) return Block.DIRT;
  if (y === 0) return Block.BEDROCK;
  return Block.STONE;
}
