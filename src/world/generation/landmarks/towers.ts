import { Block } from '../../blocks';
import {
  box, corners, fill, hollowOut, opening, perimeter, post, ring, setback, slabAt, walls,
  type Brush,
} from './brush';
import type { Landmark } from './types';

/**
 * Tall buildings.
 *
 * A tower is the one silhouette a voxel world is bad at: extrude a square far
 * enough and it reads as a column of wallpaper. Both of these fight that the way
 * real towers do — by setting back. Each stage is narrower than the one under
 * it, and the ledge where they meet is a cornice you can see the sky past, so the
 * building has a top, a middle and a bottom instead of just a height.
 *
 * The second thing that makes a tower read is what the wall is *made* of, at the
 * scale of a storey. A curtain wall is glass in a steel grid and a 1930s shaft is
 * brick between stone piers; get the vertical rhythm right and 60 blocks of wall
 * is architecture rather than texture.
 */

/** Storeys between one spandrel band and the next on the glass tower. */
const BAND_PITCH = 5;

/**
 * A curtain wall: glazing held in a grid of mullions.
 *
 * Drawn as one continuous skin around a rectangle rather than four walls, so a
 * corner never ends up with a doubled mullion — which is exactly what makes a
 * naive four-wall loop look like four billboards leaning on each other.
 */
function curtainWall(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  mullionPitch: number,
): void {
  for (let y = y0; y <= y1; y++) {
    // A deeper band at every floor slab: the edge of the floor plate, which is
    // what you actually see through the glass of a real tower.
    const band = (y - y0) % BAND_PITCH === 0;
    perimeter(x0, z0, x1, z1, (x, z, along, corner) => {
      const mullion = corner || along % mullionPitch === 0;
      // Pale spandrel, dark mullion, glass between. Three tones rather than
      // two: a skin of glass and steel alone goes uniformly grey at any
      // distance, because the steel is the same value as the glass it holds.
      brush.set(x, y, z, band ? Block.CONCRETE : mullion ? Block.STEEL : Block.TINTED_GLASS);
    });
  }
}

/** Floor plates and a lift core, so a broken window shows a building rather than a shell. */
function floorPlates(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  core: { x0: number; z0: number; x1: number; z1: number } | null,
): void {
  for (let y = y0; y <= y1; y += BAND_PITCH) {
    slabAt(brush, y, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.CONCRETE);
  }
  if (!core) return;
  walls(brush, box(core.x0, y0, core.z0, core.x1, y1, core.z1), Block.CONCRETE);
  // The core is lit from inside, which is what makes a tower read as occupied
  // after dark rather than as a cliff.
  for (let y = y0 + 2; y <= y1; y += BAND_PITCH) {
    brush.set(core.x0 + 1, y, core.z0, Block.LANTERN);
  }
}

/** The lobby: a tall glazed ground floor with a way in and a canopy over it. */
function lobby(brush: Brush, x0: number, z0: number, x1: number, z1: number, y0: number, height: number): void {
  const top = y0 + height - 1;
  for (let y = y0; y <= top; y++) {
    perimeter(x0, z0, x1, z1, (x, z, _along, corner) => {
      brush.set(x, y, z, corner ? Block.CONCRETE : Block.TINTED_GLASS);
    });
  }
  slabAt(brush, y0 - 1, x0, z0, x1, z1, Block.MARBLE);
  const mid = Math.floor((x0 + x1) / 2);
  // Three bays wide and the full height of the storey, so the way in is obvious
  // from the far side of the square.
  hollowOut(brush, box(mid - 1, y0, z0, mid + 1, top - 1, z0));
  // The canopy, jutting one block into the plaza.
  for (let x = mid - 3; x <= mid + 3; x++) {
    brush.set(x, top, z0 - 1, Block.CONCRETE_SLAB);
    brush.set(x, top - 1, z0 - 1, Block.AIR);
  }
  brush.set(mid - 3, top - 1, z0 - 1, Block.STEEL_COLUMN);
  brush.set(mid + 3, top - 1, z0 - 1, Block.STEEL_COLUMN);
  for (const x of [mid - 4, mid + 4]) brush.set(x, y0, z0 - 1, Block.LANTERN);
}

export const GLASS_TOWER: Landmark = {
  id: 'glass_tower',
  label: 'ガラスの塔',
  note: '青板ガラスのカーテンウォールと鉄骨の方立。二段のセットバックで頂部を作る。',
  kind: 'skyscraper',
  width: 23,
  depth: 23,
  height: 76,
  depthBelow: 2,
  build(brush) {
    const c = 11;
    // --- plaza and footings ------------------------------------------------
    slabAt(brush, 0, 0, 0, 22, 22, Block.CONCRETE);
    fill(brush, box(1, -2, 1, 21, 0, 21), Block.CONCRETE);
    // A band of paler stone around the tower's own footprint, so the podium is
    // read as standing on something rather than as buried in the lawn.
    ring(brush, 0, 0, 0, 22, 22, Block.MARBLE_SLAB);

    // --- podium: five storeys, 21 x 21 -------------------------------------
    const podiumTop = 12;
    lobby(brush, 1, 1, 21, 21, 1, 5);
    curtainWall(brush, 1, 1, 21, 21, 6, podiumTop - 1, 5);
    corners(brush, 1, 1, 21, 21, 1, podiumTop - 1, Block.CONCRETE);
    floorPlates(brush, 1, 1, 21, 21, 6, podiumTop - 1, null);
    // Podium roof: a terrace with a low parapet, which is the ledge that makes
    // the setback above it visible from the ground.
    slabAt(brush, podiumTop, 1, 1, 21, 21, Block.CONCRETE);
    ring(brush, podiumTop + 1, 1, 1, 21, 21, Block.CONCRETE_SLAB);
    for (const [x, z] of [[3, 3], [19, 3], [3, 19], [19, 19]] as const) {
      brush.set(x, podiumTop + 1, z, Block.LANTERN);
    }

    // --- shaft ------------------------------------------------------------
    // Rectangular in plan rather than square. Two square setback towers on
    // neighbouring lots read as the same building in two materials; making one
    // of them broader than it is deep separates them from any angle.
    const shaft0 = podiumTop + 1;
    const shaft1 = 48;
    const SHAFT_X = 6, SHAFT_Z = 5;
    curtainWall(brush, c - SHAFT_X, c - SHAFT_Z, c + SHAFT_X, c + SHAFT_Z, shaft0, shaft1, 4);
    corners(brush, c - SHAFT_X, c - SHAFT_Z, c + SHAFT_X, c + SHAFT_Z, shaft0, shaft1, Block.CONCRETE);
    floorPlates(brush, c - SHAFT_X, c - SHAFT_Z, c + SHAFT_X, c + SHAFT_Z, shaft0, shaft1,
      { x0: c - 2, z0: c - 2, x1: c + 2, z1: c + 2 });

    // --- upper stage --------------------------------------------------------
    // The terrace between the two is lidded before the moulding goes round it: a
    // ring on its own leaves the stage above standing over its own footprint
    // with nothing under it, which is visible from the ground as a slot of sky.
    const upper0 = shaft1 + 2;
    const upper1 = 63;
    const UPPER = 4;
    slabAt(brush, shaft1 + 1, c - SHAFT_X, c - SHAFT_Z, c + SHAFT_X, c + SHAFT_Z, Block.CONCRETE);
    ring(brush, shaft1 + 1, c - SHAFT_X - 1, c - SHAFT_Z - 1, c + SHAFT_X + 1, c + SHAFT_Z + 1, Block.CONCRETE_SLAB);
    curtainWall(brush, c - UPPER, c - UPPER, c + UPPER, c + UPPER, upper0, upper1, 4);
    corners(brush, c - UPPER, c - UPPER, c + UPPER, c + UPPER, upper0, upper1, Block.CONCRETE);
    floorPlates(brush, c - UPPER, c - UPPER, c + UPPER, c + UPPER, upper0, upper1, null);
    setback(brush, c, c, UPPER, upper1 + 1, Block.CONCRETE, Block.CONCRETE_SLAB);

    // --- crown and mast ----------------------------------------------------
    const crown0 = upper1 + 2;
    const crown1 = crown0 + 4;
    walls(brush, box(c - 2, crown0, c - 2, c + 2, crown1, c + 2), Block.STEEL);
    slabAt(brush, crown1 + 1, c - 2, c - 2, c + 2, c + 2, Block.STEEL);
    // Four stays and a mast: at this height the silhouette is the whole building,
    // and a bare post reads as a mistake where a guyed mast reads as an aerial.
    for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
      post(brush, c + dx, c + dz, crown1 + 2, crown1 + 4, Block.STEEL_COLUMN);
    }
    post(brush, c, c, crown1 + 2, 74, Block.STEEL_COLUMN);
    brush.set(c, 75, c, Block.GOLD_BLOCK);
    brush.set(c, 70, c, Block.LANTERN);
  },
};

export const DECO_TOWER: Landmark = {
  id: 'deco_tower',
  label: 'アール・デコの摩天楼',
  note: 'レンガと石の付柱が作る縦線、四段のセットバック、金の頂華。',
  kind: 'skyscraper',
  width: 23,
  depth: 23,
  height: 70,
  depthBelow: 2,
  build(brush, ctx) {
    const c = 11;
    slabAt(brush, 0, 0, 0, 22, 22, Block.STONE_BRICKS);
    ring(brush, 0, 0, 0, 22, 22, Block.MARBLE_SLAB);
    fill(brush, box(1, -2, 1, 21, 0, 21), Block.CONCRETE);

    /**
     * One stage of the shaft.
     *
     * The pilasters are what the whole style is: an unbroken stone line from the
     * pavement to the cornice, with the brick and the windows recessed between
     * them. Two blocks of pier to two of bay, which is wide enough that the
     * verticals are still verticals at sixty blocks away — a one-block rhythm
     * dissolves into speckle at exactly the distance the building is looked at
     * from.
     *
     * The bay is *brick* with one continuous strip of window up the middle of
     * it, not window with brick between. Pale pier against pale glass is no
     * contrast at all; pale pier against warm brick is the whole elevation.
     */
    const stage = (half: number, y0: number, y1: number): void => {
      const x0 = c - half, x1 = c + half, z0 = c - half, z1 = c + half;
      for (let y = y0; y <= y1; y++) {
        perimeter(x0, z0, x1, z1, (x, z, along, corner) => {
          if (corner || along % 4 < 2) {
            brush.set(x, y, z, corner ? Block.MARBLE : Block.STONE_BRICKS);
            return;
          }
          // One of the bay's two cells is glazed all the way up, with a brick
          // spandrel across it at each floor line.
          const glazed = along % 4 === 2 && (y - y0) % 4 !== 0;
          brush.set(x, y, z, glazed ? Block.GLASS : Block.BRICKS);
        });
      }
      slabAt(brush, y0 - 1, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.CONCRETE);
      for (let y = y0 + 4; y < y1; y += 6) {
        slabAt(brush, y, x0 + 1, z0 + 1, x1 - 1, z1 - 1, Block.CONCRETE);
      }
    };

    /** The moulding a stage lands on: a lidded terrace, a projecting course and
     *  a slab lip over it. */
    const cornice = (half: number, y: number): void => {
      setback(brush, c, c, half, y, Block.CONCRETE, Block.MARBLE);
      ring(brush, y + 1, c - half - 1, c - half - 1, c + half + 1, c + half + 1, Block.MARBLE_SLAB);
    };

    stage(10, 1, 18);
    cornice(10, 19);
    stage(8, 20, 33);
    cornice(8, 34);
    stage(6, 35, 45);
    cornice(6, 46);
    stage(4, 47, 55);
    cornice(4, 56);

    // --- crown -------------------------------------------------------------
    walls(brush, box(c - 2, 57, c - 2, c + 2, 62, c + 2), Block.MARBLE);
    // Chevrons: the one ornament the style is unmistakable by. Gold on the
    // corners of each of the crown's four faces, stepping inwards as it rises.
    for (let i = 0; i < 3; i++) {
      const y = 58 + i;
      for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
        const ax = dx !== 0 ? c + dx : c - 1 + i;
        const az = dz !== 0 ? c + dz : c - 1 + i;
        brush.set(ax, y, az, Block.GOLD_BLOCK);
        if (dx !== 0) brush.set(ax, y, c + 1 - i, Block.GOLD_BLOCK);
        else brush.set(c + 1 - i, y, az, Block.GOLD_BLOCK);
      }
    }
    slabAt(brush, 63, c - 2, c - 2, c + 2, c + 2, Block.MARBLE);
    slabAt(brush, 64, c - 1, c - 1, c + 1, c + 1, Block.MARBLE);
    post(brush, c, c, 65, 68, Block.STEEL_COLUMN);
    brush.set(c, 69, c, Block.GOLD_BLOCK);

    // --- entrance ----------------------------------------------------------
    // Three storeys tall and framed in marble: the doorway of a building this
    // size has to be legible from the far side of its own plaza.
    const z0 = c - 10;
    opening(brush, box(c - 2, 1, z0, c + 2, 5, z0), Block.AIR, Block.MARBLE);
    for (let y = 2; y <= 5; y++) {
      brush.set(c - 3, y, z0, Block.MARBLE);
      brush.set(c + 3, y, z0, Block.MARBLE);
    }
    brush.set(c, 6, z0, Block.GOLD_BLOCK);
    brush.set(c - 4, 1, z0 - 1, Block.LANTERN);
    brush.set(c + 4, 1, z0 - 1, Block.LANTERN);
    // A few of the upper windows left lit, chosen from the lot's own stream so
    // the pattern is stable but not a grid. Only where there is a window: a lamp
    // set into a stone pier is a hole in the pier.
    for (let i = 0; i < 10; i++) {
      const y = 6 + Math.floor(ctx.rng() * 40);
      const along = Math.floor(ctx.rng() * 5) * 4 + 2;
      if (brush.get(c - 10 + along, y, z0) === Block.GLASS) {
        brush.set(c - 10 + along, y, z0, Block.LANTERN);
      }
    }
  },
};
