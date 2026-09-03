import { buildRiverNetwork, type RiverStem } from './riverNetwork';
import { CELL_BLOCKS } from '../scale';
import { SUPER_INTERIOR, SUPER_SIZE } from './constants';
import type { SuperChunk } from './superchunk';

/**
 * River curves for one super-chunk.
 *
 * The stems are traced across the whole tile, halo included, so a river arriving
 * from outside is already the right width by the time it crosses into the
 * interior. What is kept, though, is only the part inside the interior: the
 * chunk that owns the ground owns the river on it, and each piece is drawn
 * exactly once.
 */

/** One sample of overhang each side, so neighbouring pieces meet rather than gap. */
const OVERHANG = 1;

/**
 * The infinite world has no lakes: its standing water is the sea, and the sea is
 * every cell at or below the calibrated level.
 *
 * `findLakes` marks whatever the last flood put back above the carved ground,
 * which on this terrain is almost entirely the trough left where the incision
 * cut deeper than the flood refilled — one cell wide, running along the channel.
 * The finite map drops those with `refineLakes`, by shape; a tile cannot. Shape
 * is measured inside the window doing the asking, so two tiles sharing a seam
 * clip the same basin differently and one can keep a lake the other drops.
 * Measured over six tiles, all 97 cells the flood marked were that artifact and
 * none survived refinement — so there is nothing here to keep, and a rule that
 * cannot be made to agree across a seam is not worth keeping for its own sake.
 */
const NO_LAKES = new Uint8Array(SUPER_SIZE * SUPER_SIZE);

/**
 * How far apart two pieces of the same river may be handed over and still be
 * pulled together. The channel is rastered on 40 m cells and the two chunks can
 * put it a couple of cells apart, so this has to clear that; it must stay well
 * under a channel's own length scale, or two genuinely different rivers meeting
 * near a corner could be joined.
 */
const STITCH_RADIUS = CELL_BLOCKS * 4;
/** Samples over which a stitch is blended back, so the join is a bend, not a kink. */
const STITCH_REACH = 8;

/**
 * The curves this tile is the one to draw: only the part of what it traced that
 * lies inside its own interior. Its halo's copy of a neighbour's river is thrown
 * away here, and that is deliberate — the neighbour traced the same river with a
 * different window and placed it a cell or two over, so keeping both would leave
 * the world covered by two of every river.
 */
export function buildChunkRivers(chunk: SuperChunk): RiverStem[] {
  const network = buildRiverNetwork(chunk, NO_LAKES, { worldMeander: true, levelWindow: 24 });
  const loX = chunk.tx * SUPER_INTERIOR * CELL_BLOCKS, hiX = loX + SUPER_INTERIOR * CELL_BLOCKS;
  const loZ = chunk.ty * SUPER_INTERIOR * CELL_BLOCKS, hiZ = loZ + SUPER_INTERIOR * CELL_BLOCKS;
  const inside = (x: number, z: number) => x >= loX && x < hiX && z >= loZ && z < hiZ;

  const stems: RiverStem[] = [];
  for (const stem of network.stems) {
    let run: typeof stem.points = [];
    const flush = () => {
      if (run.length >= 2) stems.push({ points: run, order: stem.order });
      run = [];
    };
    for (let k = 0; k < stem.points.length; k++) {
      const point = stem.points[k];
      if (inside(point.x, point.z)) {
        if (!run.length) for (let j = Math.max(0, k - OVERHANG); j < k; j++) run.push(stem.points[j]);
        run.push(point);
      } else if (run.length) {
        run.push(point);   // the overhang on the far side
        flush();
      }
    }
    flush();
  }
  return stems;
}

/**
 * Pull the loose ends of pieces that belong to the same river together.
 *
 * Two chunks agree about how much water a river carries but can put its channel
 * a cell or two apart, because the meander displacement is rounded to whole
 * cells. Left alone, that shows up as a step in the water where one chunk hands
 * the river to the next. Each pair of ends that meet at a boundary is moved to
 * the point between them and the correction is faded back upstream, which turns
 * what would be a step into a slight bend.
 */
export function stitchStems(stems: RiverStem[]): RiverStem[] {
  interface End { stem: RiverStem; head: boolean; }
  const ends: End[] = [];
  for (const stem of stems) { ends.push({ stem, head: true }); ends.push({ stem, head: false }); }
  const at = (end: End) => end.head ? end.stem.points[0] : end.stem.points[end.stem.points.length - 1];

  const used = new Set<End>();
  for (let a = 0; a < ends.length; a++) {
    if (used.has(ends[a])) continue;
    const pa = at(ends[a]);
    let best: End | null = null, bestDistance = STITCH_RADIUS;
    for (let b = a + 1; b < ends.length; b++) {
      if (used.has(ends[b]) || ends[b].stem === ends[a].stem) continue;
      const pb = at(ends[b]);
      // Only ends of comparable rivers: a brook meeting a trunk is a confluence,
      // which snapToParent has already dealt with, not a hand-over.
      if (Math.min(pa.width, pb.width) < Math.max(pa.width, pb.width) * 0.5) continue;
      const distance = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      if (distance < bestDistance) { bestDistance = distance; best = ends[b]; }
    }
    if (!best) continue;
    const pb = at(best);
    // Width and depth are blended along with the position: the two chunks agree
    // about how much water is in the river to within a factor of about two, and
    // without this the channel would visibly step at the hand-over.
    const midX = (pa.x + pb.x) * 0.5, midZ = (pa.z + pb.z) * 0.5, midY = Math.min(pa.waterY, pb.waterY);
    const midWidth = (pa.width + pb.width) * 0.5, midDepth = (pa.depth + pb.depth) * 0.5;
    for (const end of [ends[a], best]) {
      const point = at(end);
      const dx = midX - point.x, dz = midZ - point.z, dy = midY - point.waterY;
      const dw = midWidth - point.width, dd = midDepth - point.depth;
      const points = end.stem.points, reach = Math.min(points.length, STITCH_REACH);
      for (let k = 0; k < reach; k++) {
        const index = end.head ? k : points.length - 1 - k;
        const weight = 1 - k / reach;
        points[index] = {
          ...points[index],
          x: points[index].x + dx * weight,
          z: points[index].z + dz * weight,
          waterY: points[index].waterY + dy * weight,
          width: points[index].width + dw * weight,
          depth: points[index].depth + dd * weight,
        };
      }
      used.add(end);
    }
  }
  return stems;
}

/**
 * Put every water surface on a whole block, in steps that only ever go down.
 *
 * The reference's water is a mesh, so a surface sloping a few centimetres per
 * metre is exactly right there. Here it is voxels, and a sloping surface has to
 * be rounded to *something*: rounding each column on its own leaves a staircase
 * of one-block ledges every few blocks, each of which is a lip for the water
 * simulator to pour over. Rounding the curve instead turns the river into a
 * chain of flat pools with a weir between them, which is both what a small
 * river actually looks like and something that can sit still.
 *
 * Run after stitching, which blends levels across a hand-over and would
 * otherwise put fractions back.
 */
export function quantiseLevels(stems: RiverStem[]): RiverStem[] {
  return stems.map(stem => {
    let previous = Infinity;
    // New point objects rather than an edit in place: a point can belong to two
    // runs of the same stem through the overhang, and the two runs must not
    // hand each other a level that depends on which was rounded first.
    const points = stem.points.map(point => {
      previous = Math.min(previous, Math.round(point.waterY));
      return { ...point, waterY: previous };
    });
    return { points, order: stem.order };
  });
}
