import { Block, type BlockId } from '../../blocks';
import {
  COPPER_ROOF, SLATE_ROOF,
  box, ellipse, fill, gableRoof, hipRoof, hollowOut, post, pyramid, ring, slabAt, verticalDisc, walls,
  type Brush,
} from './brush';
import type { Landmark } from './types';

/**
 * Two buildings from before anybody had steel.
 *
 * They are opposites, and that is why both are here. A classical temple is all
 * horizontal: a platform, a colonnade, an entablature, a shallow gable, and
 * nothing anywhere is taller than it is wide. A gothic cathedral is all vertical:
 * every line on it — buttress, lancet, pinnacle, spire — is doing the same one
 * thing. If a voxel building can hold on to that difference, the block palette is
 * doing its job.
 */

/**
 * A roof too shallow for the one-block-per-course wedges: each course steps in by
 * `run` instead of by one, with a slab on its outer edge to take the corner off.
 * At `run = 2` that is a pitch of 1 in 2, which is as shallow as a stepped roof
 * gets before the treads read as terraces; a 45-degree one reads as a barn.
 */
function shallowGable(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  base: number,
  run: number,
  solid: BlockId,
  lip: BlockId,
): number {
  let y = base;
  let ax0 = x0, ax1 = x1;
  while (ax0 <= ax1) {
    for (let z = z0; z <= z1; z++) {
      for (let x = ax0; x <= ax1; x++) {
        // Half a block on the two raking edges. The course below is wider, so the
        // slab lands on solid stone and takes the corner off a step that would
        // otherwise be a whole block deep.
        const rake = ax1 - ax0 > 1 && (x === ax0 || x === ax1);
        brush.set(x, y, z, rake ? lip : solid);
      }
    }
    if (ax1 - ax0 <= 1) break;
    ax0 += run;
    ax1 -= run;
    y++;
  }
  return y;
}

export const GREEK_TEMPLE: Landmark = {
  id: 'greek_temple',
  label: '古代の列柱神殿',
  note: '三段の基壇、周柱、トリグリフの帯、浅い勾配の破風。すべて大理石。',
  kind: 'historic',
  width: 24,
  depth: 40,
  height: 24,
  depthBelow: 2,
  build(brush) {
    // --- precinct and crepidoma --------------------------------------------
    slabAt(brush, 0, 0, 0, 23, 39, Block.GRAVEL);
    fill(brush, box(1, -2, 1, 22, 0, 38), Block.STONE_BRICKS);
    // Three steps. A temple is raised, and the steps are how you read that it is.
    slabAt(brush, 1, 1, 1, 22, 38, Block.MARBLE);
    slabAt(brush, 2, 2, 2, 21, 37, Block.MARBLE);
    slabAt(brush, 3, 3, 3, 20, 36, Block.MARBLE);

    // --- peristyle ---------------------------------------------------------
    // Six columns across the front and eleven down the flank, at three blocks to
    // the bay: the proportion the order itself is defined by.
    const colsX = [4, 7, 10, 13, 16, 19];
    const colsZ = [4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
    const shaftTop = 12;
    const raise = (x: number, z: number): void => {
      brush.set(x, 4, z, Block.MARBLE);
      for (let y = 5; y <= shaftTop; y++) brush.set(x, y, z, Block.MARBLE_COLUMN);
      brush.set(x, shaftTop + 1, z, Block.MARBLE);
    };
    for (const x of colsX) {
      raise(x, colsZ[0]);
      raise(x, colsZ[colsZ.length - 1]);
    }
    for (const z of colsZ) {
      raise(colsX[0], z);
      raise(colsX[colsX.length - 1], z);
    }

    // --- entablature -------------------------------------------------------
    const arch = shaftTop + 2;
    ring(brush, arch, 4, 4, 19, 34, Block.MARBLE);
    // The frieze: triglyphs over every column and over every gap between them,
    // which is the rule the whole order is spaced by.
    for (let x = 4; x <= 19; x++) {
      for (const z of [4, 34]) {
        brush.set(x, arch + 1, z, (x - 4) % 3 === 0 ? Block.STONE_BRICKS : Block.MARBLE);
      }
    }
    for (let z = 4; z <= 34; z++) {
      for (const x of [4, 19]) {
        brush.set(x, arch + 1, z, (z - 4) % 3 === 0 ? Block.STONE_BRICKS : Block.MARBLE);
      }
    }
    // The cornice oversails the frieze by a block all round.
    ring(brush, arch + 2, 3, 3, 20, 35, Block.MARBLE_SLAB);
    slabAt(brush, arch + 2, 4, 4, 19, 34, Block.MARBLE);

    // --- cella -------------------------------------------------------------
    const c0 = 7, c1 = 16;
    walls(brush, box(c0, 4, 7, c1, arch - 1, 31), Block.MARBLE);
    slabAt(brush, 4, c0, 7, c1, 31, Block.MARBLE);
    // The doorway, and the two columns in antis that stand in front of it.
    hollowOut(brush, box(11, 5, 7, 13, 9, 7));
    ring(brush, 10, 10, 6, 14, 7, Block.MARBLE);
    for (const x of [10, 14]) {
      for (let y = 5; y <= 9; y++) brush.set(x, y, 6, Block.MARBLE_COLUMN);
      brush.set(x, 10, 6, Block.MARBLE);
    }
    // Inside: the cult statue at the far end, and two rows of braziers up to it.
    fill(brush, box(11, 5, 27, 13, 9, 29), Block.GOLD_BLOCK);
    brush.set(12, 10, 28, Block.GOLD_BLOCK);
    for (let z = 11; z <= 25; z += 4) {
      for (const x of [9, 14]) {
        post(brush, x, z, 5, 6, Block.STONE_COLUMN);
        brush.set(x, 7, z, Block.LANTERN);
      }
    }

    // --- roof and pediments ------------------------------------------------
    // Terracotta over marble. A white roof on a white building is one lump; the
    // pediment only becomes a triangle once the roof behind it is another colour,
    // and a Greek temple's tiles were fired clay in any case.
    const ridge = shallowGable(brush, 3, 3, 20, 35, arch + 3, 2, Block.ROOF_TILE, Block.MARBLE_SLAB);
    // The tympanum: the triangle the gable encloses at each end. Filled behind the
    // raking cornice, because a pediment with daylight through it is scaffolding.
    for (const z of [3, 35]) {
      for (let y = arch + 3; y <= ridge; y++) {
        const inset = (y - (arch + 3)) * 2;
        // Inside the rake, not over it. Filling the full width repainted the
        // slab on each raking edge with a whole block and turned the two faces
        // anybody actually looks at into a staircase.
        for (let x = 4 + inset; x <= 19 - inset; x++) brush.set(x, y, z, Block.MARBLE);
      }
    }
    // Acroteria: the ornaments on the three corners of each pediment.
    for (const z of [3, 35]) {
      brush.set(3, arch + 3, z, Block.GOLD_BLOCK);
      brush.set(20, arch + 3, z, Block.GOLD_BLOCK);
      brush.set(11, ridge + 1, z, Block.GOLD_BLOCK);
      brush.set(12, ridge + 1, z, Block.GOLD_BLOCK);
    }
  },
};

/** A buttress: a pier standing off the wall, stepped back as it rises and capped
 *  with a pinnacle. On a gothic building this is not decoration — it is why the
 *  wall can be mostly window — so it gets drawn like the structure it is. */
function buttress(brush: Brush, x: number, z: number, y0: number, y1: number, out: 1 | -1, axis: 'x' | 'z'): void {
  const dx = axis === 'x' ? out : 0;
  const dz = axis === 'x' ? 0 : out;
  for (let y = y0; y <= y1; y++) {
    brush.set(x + dx, y, z + dz, Block.STONE_BRICKS);
    // The outer half falls away two thirds of the way up, which is the profile
    // that reads as a buttress rather than as a pillar stuck to a wall.
    if (y < y0 + Math.floor((y1 - y0) * 0.62)) brush.set(x + dx * 2, y, z + dz * 2, Block.STONE_BRICKS);
  }
  brush.set(x + dx * 2, y0 + Math.floor((y1 - y0) * 0.62), z + dz * 2, Block.STONE_BRICK_SLAB);
  brush.set(x + dx, y1 + 1, z + dz, Block.MARBLE);
  brush.set(x + dx, y1 + 2, z + dz, Block.STONE_COLUMN);
  brush.set(x + dx, y1 + 3, z + dz, Block.GOLD_BLOCK);
}

/**
 * A lancet: one tall narrow window, pointed at the top by the block above it.
 *
 * `axis` is the axis the *wall* runs along, and `at` is its fixed coordinate on
 * the other one — so a window in the east wall of the nave is `('z', naveX1, z)`.
 */
function lancet(brush: Brush, axis: 'x' | 'z', at: number, along: number, y0: number, height: number): void {
  for (let y = y0; y < y0 + height; y++) {
    const x = axis === 'x' ? along : at;
    const z = axis === 'x' ? at : along;
    brush.set(x, y, z, Block.STAINED_GLASS);
  }
  const x = axis === 'x' ? along : at;
  const z = axis === 'x' ? at : along;
  brush.set(x, y0 + height, z, Block.MARBLE);
  brush.set(x, y0 - 1, z, Block.MARBLE);
}

export const CATHEDRAL: Landmark = {
  id: 'cathedral',
  label: 'ゴシックの大聖堂',
  note: '身廊と側廊、交差廊、半円の後陣。控壁と尖塔とステンドグラスで、線はすべて縦を向く。',
  kind: 'historic',
  width: 27,
  depth: 44,
  height: 53,
  depthBelow: 2,
  build(brush) {
    const c = 13;
    slabAt(brush, 0, 0, 0, 26, 43, Block.STONE_BRICKS);

    // --- footprint ---------------------------------------------------------
    // Body: aisles either side of a taller nave. Transept across it two thirds of
    // the way down, and a half-round apse closing the east end.
    const bodyX0 = 3, bodyX1 = 23;
    const naveX0 = 8, naveX1 = 18;
    const bodyZ0 = 4, bodyZ1 = 36;
    const transZ0 = 22, transZ1 = 30;

    fill(brush, box(bodyX0, -2, bodyZ0, bodyX1, 0, bodyZ1), Block.STONE_BRICKS);
    slabAt(brush, 1, bodyX0, bodyZ0, bodyX1, bodyZ1, Block.MARBLE);
    slabAt(brush, 1, 0, transZ0, 26, transZ1, Block.MARBLE);
    fill(brush, box(0, -2, transZ0, 26, 0, transZ1), Block.STONE_BRICKS);

    // --- aisle walls and the transept ---------------------------------------
    walls(brush, box(bodyX0, 2, bodyZ0, bodyX1, 15, bodyZ1), Block.STONE_BRICKS);
    walls(brush, box(0, 2, transZ0, 26, 21, transZ1), Block.STONE_BRICKS);
    // The transept opens into the crossing rather than being walled off from it.
    hollowOut(brush, box(bodyX0, 2, transZ0 + 1, bodyX1, 20, transZ1 - 1));

    for (let z = bodyZ0 + 2; z <= bodyZ1 - 2; z += 4) {
      if (z > transZ0 - 2 && z < transZ1 + 2) continue;
      lancet(brush, 'z', bodyX0, z, 5, 6);
      lancet(brush, 'z', bodyX1, z, 5, 6);
      buttress(brush, bodyX0, z, 2, 15, -1, 'x');
      buttress(brush, bodyX1, z, 2, 15, 1, 'x');
    }
    for (const x of [3, 10, 16, 23]) {
      lancet(brush, 'x', transZ0, x, 5, 9);
      lancet(brush, 'x', transZ1, x, 5, 9);
    }
    // The ends of the arms: two 27-block gable walls that were completely blank,
    // and are the first thing seen from the avenue the transept faces.
    for (const z of [transZ0 + 2, transZ1 - 2]) {
      for (const side of [0, 26]) {
        lancet(brush, 'z', side, z, 5, 9);
      }
    }
    for (const side of [0, 26]) {
      verticalDisc(brush, 'z', side, (transZ0 + transZ1) >> 1, 17, 3.4, Block.MARBLE);
      verticalDisc(brush, 'z', side, (transZ0 + transZ1) >> 1, 17, 2.4, Block.STAINED_GLASS);
    }
    for (const x of [1, 6, 20, 25]) {
      buttress(brush, x, transZ0, 2, 21, -1, 'z');
      buttress(brush, x, transZ1, 2, 21, 1, 'z');
    }

    // --- nave: clerestory over the aisle roofs ------------------------------
    walls(brush, box(naveX0, 2, bodyZ0, naveX1, 25, bodyZ1), Block.STONE_BRICKS);
    hollowOut(brush, box(naveX0 + 1, 2, bodyZ0 + 1, naveX1 - 1, 24, bodyZ1 - 1));
    // The arcade: the nave wall stands on piers, so the aisles are part of the
    // same room. Without this the nave is a corridor with two sheds beside it.
    for (let z = bodyZ0 + 2; z <= bodyZ1 - 2; z += 3) {
      hollowOut(brush, box(naveX0, 2, z, naveX0, 8, z + 1));
      hollowOut(brush, box(naveX1, 2, z, naveX1, 8, z + 1));
      post(brush, naveX0, z - 1, 2, 9, Block.STONE_COLUMN);
      post(brush, naveX1, z - 1, 2, 9, Block.STONE_COLUMN);
    }
    for (let z = bodyZ0 + 2; z <= bodyZ1 - 2; z += 3) {
      lancet(brush, 'z', naveX0, z, 17, 6);
      lancet(brush, 'z', naveX1, z, 17, 6);
    }
    // The aisle roofs lean *up* against the nave wall. Sloping the other way —
    // high at the outer wall, low at the nave — makes a valley down the middle of
    // the church and reads as a parapet rather than as a lean-to. They also stop
    // one block short of the nave wall and skip the transept, or they write slate
    // into both.
    const aisle = (x: number, rise: number, wedge: number): void => {
      for (let z = bodyZ0; z <= bodyZ1; z++) {
        if (z >= transZ0 && z <= transZ1) continue;
        brush.set(x, 11 + rise, z, wedge);
      }
    };
    for (let x = bodyX0; x < naveX0; x++) {
      aisle(x, x - bodyX0, x === bodyX0 ? Block.SLATE : Block.SLATE_ROOF_EAST);
    }
    for (let x = bodyX1; x > naveX1; x--) {
      aisle(x, bodyX1 - x, x === bodyX1 ? Block.SLATE : Block.SLATE_ROOF_WEST);
    }

    // --- apse ---------------------------------------------------------------
    const apseZ = 36;
    for (let y = 2; y <= 15; y++) ellipse(brush, y, c, apseZ, 5.6, 5.6, Block.STONE_BRICKS, true);
    ellipse(brush, 1, c, apseZ, 5.6, 5.6, Block.MARBLE);
    // Three, inside the apse's own arc: at four blocks out the wall has already
    // curved away and the window stands in open air behind the building.
    for (const dx of [-3, 0, 3]) lancet(brush, 'x', apseZ + 5, c + dx, 5, 7);
    hipRoof(brush, SLATE_ROOF, c - 6, apseZ - 6, c + 6, apseZ + 6, 16);
    hollowOut(brush, box(naveX0 + 1, 2, bodyZ1, naveX1 - 1, 9, bodyZ1));

    // --- west front and towers ----------------------------------------------
    const front = bodyZ0;
    // The great door, deeply recessed under a stepped arch of stone.
    hollowOut(brush, box(c - 2, 2, front, c + 2, 7, front));
    ring(brush, 8, c - 3, front - 1, c + 3, front, Block.MARBLE);
    for (const dx of [-3, 3]) post(brush, c + dx, front, 2, 7, Block.MARBLE);
    // The rose window: the one circular thing on the building, and the reason the
    // front is symmetrical about it. `ellipse` is horizontal and cannot draw a
    // disc standing up in a wall — stacked with a zero radius it makes a square,
    // which is what this was until somebody looked at it.
    verticalDisc(brush, 'x', front, c, 16, 5.4, Block.MARBLE);
    verticalDisc(brush, 'x', front, c, 16, 4.4, Block.STAINED_GLASS);
    // The tracery: a hub and four spokes, because a rose window is not a porthole.
    brush.set(c, 16, front, Block.MARBLE);
    for (let d = 2; d <= 4; d++) {
      brush.set(c + d, 16, front, Block.MARBLE);
      brush.set(c - d, 16, front, Block.MARBLE);
      brush.set(c, 16 + d, front, Block.MARBLE);
      brush.set(c, 16 - d, front, Block.MARBLE);
    }

    // Set wide apart, so the rose window between them is a whole circle rather
    // than one with its edges buried in two towers.
    for (const tx of [4, 22]) {
      const t0 = tx - 3, t1 = tx + 3;
      walls(brush, box(t0, 2, front - 3, t1, 40, front + 3), Block.STONE_BRICKS);
      for (const [qx, qz] of [[t0, front - 3], [t1, front - 3], [t0, front + 3], [t1, front + 3]] as const) {
        post(brush, qx, qz, 2, 40, Block.MARBLE);
      }
      // Two string courses, not three, and full-height shafts on the corners: a
      // tower on a building whose every other line is vertical must not be the
      // most horizontal thing on it.
      for (const y of [14, 28]) ring(brush, y, t0 - 1, front - 4, t1 + 1, front + 4, Block.MARBLE_SLAB);
      for (const [sx, sz] of [[t0 - 1, front - 4], [t1 + 1, front - 4], [t0 - 1, front + 4], [t1 + 1, front + 4]] as const) {
        post(brush, sx, sz, 2, 40, Block.STONE_COLUMN);
      }
      for (const y of [12, 22, 32]) {
        lancet(brush, 'x', front - 3, tx, y, 6);
        lancet(brush, 'z', t0, front, y, 6);
        lancet(brush, 'z', t1, front, y, 6);
      }
      slabAt(brush, 41, t0 - 1, front - 4, t1 + 1, front + 4, Block.MARBLE);
      // A spire, not a cap. A hip roof over nine blocks closes in four courses
      // and comes out a pyramid hat; stepping it in one course at a time gives
      // the eight the silhouette needs.
      const apex = pyramid(brush, t0 - 1, front - 4, t1 + 1, front + 4, 42, Block.COPPER_PANEL);
      post(brush, tx, front, apex + 1, apex + 4, Block.COPPER_PANEL);
      brush.set(tx, apex + 5, front, Block.GOLD_BLOCK);
      // Corner pinnacles, which is what keeps a spire from reading as a party hat.
      for (const [px, pz] of [[t0, front - 3], [t1, front - 3], [t0, front + 3], [t1, front + 3]] as const) {
        post(brush, px, pz, 41, 44, Block.STONE_COLUMN);
        brush.set(px, 45, pz, Block.GOLD_BLOCK);
      }
    }

    // --- nave roof and crossing flèche ---------------------------------------
    const ridge = gableRoof(brush, SLATE_ROOF, naveX0 - 1, bodyZ0, naveX1 + 1, bodyZ1, 26, 'z');
    gableRoof(brush, SLATE_ROOF, 0, transZ0 - 1, 26, transZ1 + 1, 22, 'x');
    const cross = hipRoof(brush, COPPER_ROOF, c - 4, transZ0 + 1, c + 4, transZ1 - 1, ridge + 1);
    post(brush, c, (transZ0 + transZ1) >> 1, cross + 1, cross + 5, Block.COPPER_PANEL);
    brush.set(c, cross + 6, (transZ0 + transZ1) >> 1, Block.GOLD_BLOCK);

    // --- inside --------------------------------------------------------------
    slabAt(brush, 1, naveX0, bodyZ0, naveX1, bodyZ1, Block.OAK_PLANKS);
    fill(brush, box(c - 1, 2, apseZ - 2, c + 1, 3, apseZ), Block.GOLD_BLOCK);
    // On the arcade wall itself. One block in is the middle of the nave floor,
    // where a lamp has nothing to hang from.
    for (let z = bodyZ0 + 3; z <= bodyZ1 - 3; z += 6) {
      brush.set(naveX0, 6, z, Block.LANTERN);
      brush.set(naveX1, 6, z, Block.LANTERN);
    }
    for (const [lx, lz] of [[c - 3, front - 2], [c + 3, front - 2]] as const) {
      post(brush, lx, lz, 2, 3, Block.STONE_COLUMN);
      brush.set(lx, 4, lz, Block.LANTERN);
    }
  },
};
