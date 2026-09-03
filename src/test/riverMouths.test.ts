import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/rng';
import { TerrainGenerator } from '../world/generation/terrain';
import { Block } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL } from '../world/chunk';
import { leveeHeight } from '../world/generation/infinite/riverCarve';

/**
 * Where a river meets the sea.
 *
 * A river that stops short of the ocean is the one fault in this terrain that
 * every player finds: they follow the water down and it ends in a field. It
 * happened because three things each held the last stretch back — the drainage
 * tree ended a cell inland of the water, the levee walled the estuary in at one
 * block above the sea, and the block writer refused to place river water at
 * exactly sea level. What is asserted here is only the outcome: the two bodies
 * of water are one body of water.
 */

const gen = new TerrainGenerator(seedFromString('voxelcraft'));

const idx = (lx: number, y: number, lz: number) => (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
/** Whatever the water wears on top. A frozen sea is still the sea. */
const wet = (id: number) => id === Block.WATER || id === Block.ICE;

/** The blocks of a square of chunks, addressed in world coordinates. */
function region(cx0: number, cz0: number, span: number) {
  const chunks = new Map<string, Uint16Array>();
  for (let cz = cz0; cz < cz0 + span; cz++) {
    for (let cx = cx0; cx < cx0 + span; cx++) chunks.set(`${cx},${cz}`, gen.generateChunk(cx, cz).blocks);
  }
  return (x: number, y: number, z: number): number => {
    if (y < 0 || y >= CHUNK_HEIGHT) return -1;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const blocks = chunks.get(`${cx},${cz}`);
    if (!blocks) return -1;
    return blocks[idx(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
  };
}

/** Every water cell reachable from a starting cell without leaving the water. */
function pool(at: (x: number, y: number, z: number) => number, from: { x: number; y: number; z: number }) {
  const seen = new Set<string>();
  const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const queue = [from];
  seen.add(key(from));
  while (queue.length > 0) {
    const p = queue.pop()!;
    // Up as well as down: a river runs to the sea over weirs, and the pool above
    // a weir is still the same water as the pool below it.
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as const) {
      const next = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (seen.has(key(next)) || !wet(at(next.x, next.y, next.z))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

/**
 * A river column standing above sea level with open ocean within reach of it,
 * found by surveying rather than by generating: a survey of a whole region
 * costs what one chunk of blocks costs.
 */
function findEstuary(): { river: { x: number; z: number; top: number }; sea: { x: number; z: number } } | null {
  const STEP = CHUNK_SIZE;
  const SPAN = 220;
  const x0 = -SPAN / 2 * STEP, z0 = -SPAN / 2 * STEP;
  const survey = gen.surveyRegion(x0, z0, SPAN, SPAN, STEP);
  const river: { i: number; j: number }[] = [];
  const ocean = new Set<number>();
  for (let j = 0; j < SPAN; j++) {
    for (let i = 0; i < SPAN; i++) {
      const at = j * SPAN + i;
      if (!wet(survey.block[at])) continue;
      if (survey.height[at] > SEA_LEVEL) river.push({ i, j });
      else ocean.add(at);
    }
  }
  // The two within four samples of each other: that is a mouth, and it keeps the
  // block generation below down to a handful of chunks.
  for (const r of river) {
    for (let dj = -4; dj <= 4; dj++) {
      for (let di = -4; di <= 4; di++) {
        const at = (r.j + dj) * SPAN + (r.i + di);
        if (!ocean.has(at)) continue;
        return {
          river: { x: x0 + r.i * STEP, z: z0 + r.j * STEP, top: survey.height[r.j * SPAN + r.i] },
          sea: { x: x0 + (r.i + di) * STEP, z: z0 + (r.j + dj) * STEP },
        };
      }
    }
  }
  return null;
}

describe('a river mouth', () => {
  it('runs into the sea rather than stopping in a field', () => {
    const found = findEstuary();
    expect(found, 'the survey found no river running down to a coast').not.toBeNull();
    const { river, sea } = found!;
    // A square of chunks holding both, generated for real.
    const cx = Math.floor(Math.min(river.x, sea.x) / CHUNK_SIZE) - 3;
    const cz = Math.floor(Math.min(river.z, sea.z) / CHUNK_SIZE) - 3;
    const span = Math.max(
      Math.abs(river.x - sea.x), Math.abs(river.z - sea.z),
    ) / CHUNK_SIZE + 7;
    const at = region(cx, cz, Math.ceil(span));

    // The surveyed columns, checked against the blocks that were actually built.
    expect(wet(at(sea.x, SEA_LEVEL, sea.z)), 'the surveyed sea column is not water').toBe(true);
    expect(wet(at(river.x, river.top, river.z)), 'the surveyed river column is not water').toBe(true);

    const water = pool(at, { x: sea.x, y: SEA_LEVEL, z: sea.z });
    expect(
      water.has(`${river.x},${river.top},${river.z}`),
      `the river surface at ${river.x},${river.top},${river.z} is cut off from the sea `
      + `at ${sea.x},${SEA_LEVEL},${sea.z}`,
    ).toBe(true);
  });
});

describe('the bank a river builds for itself', () => {
  /** The levee is what holds a river in its channel. At the sea there is nothing
   *  to hold: the ocean keeps its own level, and a bank a block above it is a dam
   *  across the mouth. */
  it('is not built where the water has already reached the sea', () => {
    const inland = { distance: 6, width: 8, depth: 3, waterY: SEA_LEVEL + 10 };
    expect(leveeHeight(inland, SEA_LEVEL)).toBe(SEA_LEVEL + 11);
    const atTheCoast = { ...inland, waterY: SEA_LEVEL };
    expect(leveeHeight(atTheCoast, SEA_LEVEL - 3)).toBe(SEA_LEVEL - 3);
  });
});
