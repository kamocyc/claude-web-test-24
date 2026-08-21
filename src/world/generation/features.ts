import { hashInts, mulberry32, type Rng } from '../../core/rng';
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

/** Writes a tree with its base sitting on top of (x, groundY, z).
 *
 *  Trees are the one thing in a block world that must not look built. A trunk that
 *  runs dead straight up the middle of a box of leaves reads as a stack of cubes
 *  however the blocks themselves are drawn, so neither is what is written here: the
 *  trunk leans and carries branches, and the crown is the union of a few overlapping
 *  balls with a ragged edge, which is the shape a real canopy makes. */
export function placeTree(put: PlaceFn, rng: Rng, x: number, groundY: number, z: number, spec: TreeSpec): void {
  // Leaves are collected first and written before the wood, so a branch is never
  // buried by the crown that grew around it.
  const leaves: [number, number, number][] = [];
  const logs: [number, number, number][] = [];
  const ball = (cx: number, cy: number, cz: number, radius: number, squash: number): void => {
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const distance = Math.sqrt(dx * dx + dz * dz + (dy * squash) * (dy * squash));
          // The wobble is what keeps the outline from reading as a drawn sphere.
          if (distance > radius + (rng() - 0.5) * 0.9) continue;
          leaves.push([cx + dx, cy + dy, cz + dz]);
        }
      }
    }
  };

  if (spec.conifer) {
    const height = 9 + Math.floor(rng() * 5);
    const bare = 2 + Math.floor(rng() * 2);
    const top = groundY + height;
    for (let i = 0; i < height; i++) logs.push([x, groundY + 1 + i, z]);
    for (let y = groundY + bare + 1; y <= top + 1; y++) {
      // A spire tapers all the way up. The half-block step every other layer is what
      // gives a spruce its tiered look without cutting it into separate discs.
      const fromTop = top + 1 - y;
      const radius = Math.min(2.7, fromTop * 0.34 + ((y & 1) === 0 ? 0.75 : 0.35));
      if (radius <= 0.2) continue;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx === 0 && dz === 0 && y <= top) continue;
          if (Math.sqrt(dx * dx + dz * dz) > radius + (rng() - 0.5) * 0.6) continue;
          leaves.push([x + dx, y, z + dz]);
        }
      }
    }
    write(put, leaves, spec.leaves);
    write(put, logs, spec.log);
    return;
  }

  const height = 6 + Math.floor(rng() * 3);
  // A trunk that steps sideways once on its way up stops the column reading as one
  // extruded block. Both cells are filled at the step so the wood stays connected.
  const bendAt = 3 + Math.floor(rng() * 3);
  const bends = rng() < 0.7;
  const [bendX, bendZ] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)[Math.floor(rng() * 4)];
  let tx = x;
  let tz = z;
  for (let i = 0; i < height; i++) {
    const y = groundY + 1 + i;
    if (bends && i === bendAt) {
      logs.push([tx, y, tz]);
      tx += bendX;
      tz += bendZ;
    }
    logs.push([tx, y, tz]);
  }
  const top = groundY + height;

  // A wide ball over the top of the trunk, then three smaller ones slung around it,
  // each with a stub of a branch reaching out to meet it.
  // The crown sits above the trunk rather than around it: leaves hanging down to head
  // height turn a wood into a low ceiling, and hide the trunk that makes it a tree.
  ball(tx, top + 2, tz, 2.5, 1.25);
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const angle = turn + (i * Math.PI * 2) / 3 + (rng() - 0.5) * 0.7;
    const reach = 1.8 + rng() * 0.7;
    const ox = Math.round(Math.cos(angle) * reach);
    const oz = Math.round(Math.sin(angle) * reach);
    const oy = Math.floor(rng() * 3);
    ball(tx + ox, top + oy, tz + oz, 1.7 + rng() * 0.5, 1.3);
    logs.push([tx + Math.sign(ox), top - 1 + Math.min(1, oy), tz + Math.sign(oz)]);
  }
  write(put, leaves, spec.leaves);
  write(put, logs, spec.log);
}

function write(put: PlaceFn, cells: [number, number, number][], id: BlockId): void {
  for (const [x, y, z] of cells) put(x, y, z, id);
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
