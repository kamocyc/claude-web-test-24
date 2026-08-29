import { hashFloat, hashInts, mulberry32, type Rng } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import { CHUNK_SIZE } from '../chunk';

export type PlaceFn = (x: number, y: number, z: number, b: BlockId) => void;

export interface TreeSpec {
  log: BlockId;
  leaves: BlockId;
  /** Conifers get a narrow spire, broadleaf trees a blob canopy. */
  conifer: boolean;
}

/** Candidate tree positions for a chunk. Deterministic from the seed and chunk coords,
 *  so neighbouring chunks can replay the same list and place the parts that overlap them. */
export function treeCandidates(seed: number, cx: number, cz: number, density: number): { x: number; z: number; rng: Rng }[] {
  const rng = mulberry32(hashInts(seed ^ 0x7433, cx, cz));
  const count = density < 1 ? (rng() < density ? 1 : 0) : Math.round(density * (0.6 + rng() * 0.8));
  const out: { x: number; z: number; rng: Rng }[] = [];
  for (let i = 0; i < count; i++) {
    const lx = Math.floor(rng() * CHUNK_SIZE);
    const lz = Math.floor(rng() * CHUNK_SIZE);
    out.push({
      x: cx * CHUNK_SIZE + lx,
      z: cz * CHUNK_SIZE + lz,
      rng: mulberry32(hashInts(seed ^ 0x7434, cx, cz, i)),
    });
  }
  return out;
}

/** Writes a tree with its base sitting on top of (x, groundY, z). */
export function placeTree(put: PlaceFn, rng: Rng, x: number, groundY: number, z: number, spec: TreeSpec): void {
  if (spec.conifer) {
    const height = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < height; i++) put(x, groundY + 1 + i, z, spec.log);
    for (let y = groundY + 3; y <= groundY + height + 1; y++) {
      const layer = y - (groundY + 3);
      // Alternating wide and narrow rings give the classic spruce silhouette.
      let radius = layer % 2 === 0 ? 2 : 1;
      if (y > groundY + height - 1) radius = 0;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dz === 0 && y <= groundY + height) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          put(x + dx, y, z + dz, spec.leaves);
        }
      }
    }
    put(x, groundY + height + 2, z, spec.leaves);
    return;
  }

  const height = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < height; i++) put(x, groundY + 1 + i, z, spec.log);
  const top = groundY + height;
  for (let dy = -2; dy <= 1; dy++) {
    const radius = dy >= 1 ? 1 : 2;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && rng() < 0.6) continue;
        put(x + dx, top + dy, z + dz, spec.leaves);
      }
    }
  }
  put(x, top + 2, z, spec.leaves);
}

export function placeCactus(put: PlaceFn, rng: Rng, x: number, groundY: number, z: number): void {
  const height = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < height; i++) put(x, groundY + 1 + i, z, Block.CACTUS);
}

export function placeSugarCane(put: PlaceFn, rng: Rng, x: number, groundY: number, z: number): void {
  const height = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < height; i++) put(x, groundY + 1 + i, z, Block.SUGAR_CANE);
}

/** Ore veins: a short random walk that only replaces stone. */
export interface OreSpec {
  block: BlockId;
  tries: number;
  minY: number;
  maxY: number;
  size: number;
}

export const ORES: readonly OreSpec[] = [
  { block: Block.COAL_ORE, tries: 22, minY: 6, maxY: 112, size: 14 },
  { block: Block.IRON_ORE, tries: 16, minY: 5, maxY: 66, size: 9 },
  { block: Block.GOLD_ORE, tries: 4, minY: 4, maxY: 34, size: 7 },
  { block: Block.DIAMOND_ORE, tries: 2, minY: 3, maxY: 17, size: 6 },
  { block: Block.EMERALD_ORE, tries: 3, minY: 6, maxY: 48, size: 3 },
  { block: Block.GRAVEL, tries: 6, minY: 24, maxY: 100, size: 22 },
  { block: Block.DIRT, tries: 6, minY: 24, maxY: 110, size: 18 },
];

/** A seam of ore breaking the surface.
 *
 *  Veins are generated underground, which makes them the right thing to *mine* and the
 *  wrong thing to *site an industry on*: the player would have to dig a shaft to find out
 *  whether the field they were standing in was worth building a colliery beside. An
 *  outcrop is the same rock where it can be seen — a bare patch of coal or iron in the
 *  hillside, a few blocks across, visible from the ridge above it.
 *
 *  Both count. What qualifies a place as a deposit is how much of the rock is *there*,
 *  outcrop and buried seam alike; the outcrop is what tells the player where to look. */
export interface OutcropSpec {
  block: BlockId;
  /** Chance one appears in a given chunk. Deliberately small: an outcrop the player walks
   *  past every minute is scenery, and the point of this one is that finding it is worth
   *  something. */
  chance: number;
  minRadius: number;
  maxRadius: number;
  /** How far down the patch goes. Thick enough that a survey of the column finds a real
   *  quantity of rock rather than a coat of paint. */
  depth: number;
}

export const OUTCROPS: readonly OutcropSpec[] = [
  { block: Block.COAL_ORE, chance: 0.05, minRadius: 3, maxRadius: 6, depth: 4 },
  { block: Block.IRON_ORE, chance: 0.035, minRadius: 3, maxRadius: 5, depth: 4 },
];

/** Where a chunk's outcrop is, if it has one. Deterministic from the seed and the chunk,
 *  so a neighbouring chunk can replay the same answer and paint the part of the patch that
 *  overlaps it — which is what stops one being sliced off at a chunk boundary. */
export function outcropIn(
  seed: number,
  cx: number,
  cz: number,
): { x: number; z: number; block: BlockId; radius: number; depth: number } | null {
  const rng = mulberry32(hashInts(seed ^ 0x0c50, cx, cz));
  const roll = rng();
  let floor = 0;
  for (const spec of OUTCROPS) {
    if (roll >= floor + spec.chance) {
      floor += spec.chance;
      continue;
    }
    return {
      x: cx * CHUNK_SIZE + Math.floor(rng() * CHUNK_SIZE),
      z: cz * CHUNK_SIZE + Math.floor(rng() * CHUNK_SIZE),
      block: spec.block,
      radius: spec.minRadius + Math.floor(rng() * (spec.maxRadius - spec.minRadius + 1)),
      depth: spec.depth,
    };
  }
  return null;
}

/** Whether a column falls inside an outcrop, and so how deep the rock goes there.
 *
 *  The edge is wobbled off the column's own hash rather than being a circle, because a
 *  circle of coal in a hillside reads as something somebody built. Zero for a column the
 *  patch does not reach. */
export function outcropDepth(
  seed: number,
  patch: { x: number; z: number; radius: number; depth: number },
  x: number,
  z: number,
): number {
  const distance = Math.hypot(x - patch.x, z - patch.z);
  const wobble = hashFloat(seed ^ 0x0c51, x, z) * 1.6 - 0.6;
  if (distance > patch.radius + wobble) return 0;
  // Thickest in the middle and thinning to a single course at the rim, so the patch has a
  // shape rather than an edge.
  const middle = 1 - distance / Math.max(1, patch.radius);
  return Math.max(1, Math.round(patch.depth * (0.4 + 0.6 * middle)));
}
