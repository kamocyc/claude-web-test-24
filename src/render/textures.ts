import * as THREE from 'three';
import { mulberry32, type Rng } from '../core/rng';

/** Every block and item texture is drawn procedurally into one atlas at start-up,
 *  which keeps the game a single self-contained bundle with no image assets.
 *
 *  The look is low-poly, not pixel art: tiles are built from flat facets, rounded
 *  pebbles and soft curves rather than per-pixel noise. Drawings use a 16-unit
 *  grid and are rasterised several pixels to the unit, so a diagonal comes out as
 *  a smooth edge instead of a staircase of dots. */

/** Size of one atlas cell, in pixels. */
export const TILE = 64;
export const ATLAS_COLS = 16;
/** The grid tiles are drawn on. Every coordinate below is in units, not pixels;
 *  `buildAtlas` scales the context by `TILE / U` before handing it over. */
const U = 16;

export interface TileUv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

type Draw = (ctx: CanvasRenderingContext2D, rng: Rng) => void;

const drawings = new Map<string, Draw>();

function tile(name: string, draw: Draw): void {
  drawings.set(name, draw);
}

// --- tiny drawing helpers ----------------------------------------------------

type Color = [number, number, number];
type Pt = readonly [number, number];

function css(color: Color, alpha = 1): string {
  const [r, g, b] = color;
  return alpha >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

function shade(color: Color, amount: number): Color {
  return [
    Math.max(0, Math.min(255, color[0] + amount)),
    Math.max(0, Math.min(255, color[1] + amount)),
    Math.max(0, Math.min(255, color[2] + amount)),
  ];
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: Color, alpha = 1): void {
  ctx.fillStyle = css(color, alpha);
  ctx.fillRect(x, y, w, h);
}

/** One flat face. The hairline stroke around it closes the seam that antialiasing
 *  would otherwise leave between two facets sharing an edge. */
function poly(ctx: CanvasRenderingContext2D, points: Pt[], color: Color, alpha = 1): void {
  ctx.fillStyle = css(color, alpha);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 0.12;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: Color, alpha = 1): void {
  ctx.fillStyle = css(color, alpha);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: Color,
  alpha = 1,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.fillStyle = css(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

/** A horizontal band whose edges ripple through exactly one period, so it still
 *  lines up with itself where the tile repeats onto the next block. */
function band(
  ctx: CanvasRenderingContext2D,
  y: number,
  height: number,
  amp: number,
  color: Color,
  alpha = 1,
  phase = 0,
): void {
  const edge = (x: number): number => y + Math.sin((x / U) * Math.PI * 2 + phase) * amp;
  ctx.fillStyle = css(color, alpha);
  ctx.beginPath();
  ctx.moveTo(0, edge(0));
  for (let x = 0.5; x <= U; x += 0.5) ctx.lineTo(x, edge(x));
  for (let x = U; x >= 0; x -= 0.5) ctx.lineTo(x, edge(x) + height);
  ctx.closePath();
  ctx.fill();
}

/** One tapered blade, curving up from `(x, y)` and leaning over by `bend`. */
function blade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  bend: number,
  width: number,
  color: Color,
  alpha = 1,
): void {
  ctx.fillStyle = css(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y);
  ctx.quadraticCurveTo(x - width * 0.4 + bend * 0.4, y - height * 0.62, x + bend, y - height);
  ctx.quadraticCurveTo(x + width * 0.4 + bend * 0.4, y - height * 0.62, x + width / 2, y);
  ctx.closePath();
  ctx.fill();
}

/** Fills the tile with flat triangular facets — the low-poly base every opaque
 *  block is built on. Grid points are jittered inside the tile but pinned on its
 *  border, so facets meet the edge cleanly and neighbouring blocks still line up. */
function facets(ctx: CanvasRenderingContext2D, rng: Rng, base: Color, cells = 3, spread = 8): void {
  rect(ctx, 0, 0, U, U, base);
  const step = U / cells;
  const jitter = step * 0.3;
  const grid: Pt[][] = [];
  for (let j = 0; j <= cells; j++) {
    const row: Pt[] = [];
    for (let i = 0; i <= cells; i++) {
      const freeX = i > 0 && i < cells;
      const freeY = j > 0 && j < cells;
      row.push([
        i * step + (freeX ? (rng() - 0.5) * 2 * jitter : 0),
        j * step + (freeY ? (rng() - 0.5) * 2 * jitter : 0),
      ]);
    }
    grid.push(row);
  }
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const c = grid[j + 1][i + 1];
      const d = grid[j + 1][i];
      const flip = rng() < 0.5;
      poly(ctx, flip ? [a, b, c] : [a, b, d], shade(base, (rng() - 0.5) * 2 * spread));
      poly(ctx, flip ? [a, c, d] : [b, c, d], shade(base, (rng() - 0.5) * 2 * spread));
    }
  }
}

/** A scatter of soft flecks: few and round, where the old one was many and square. */
function speckle(ctx: CanvasRenderingContext2D, rng: Rng, color: Color, count: number, size = 1): void {
  const spots = Math.max(2, Math.round(count / 4));
  for (let i = 0; i < spots; i++) {
    disc(ctx, 1 + rng() * (U - 2), 1 + rng() * (U - 2), size * 0.75 + rng() * 0.5, shade(color, (rng() - 0.5) * 16));
  }
}

/** Rounded pebble, used for ores, gravel and berries: a rim, a body and a highlight,
 *  which is the whole of what makes a flat circle read as a little ball. */
function blob(ctx: CanvasRenderingContext2D, rng: Rng, cx: number, cy: number, r: number, color: Color): void {
  const x = cx + 0.5;
  const y = cy + 0.5;
  disc(ctx, x, y, r + 0.55, shade(color, -30));
  disc(ctx, x, y, r + 0.15, shade(color, (rng() - 0.5) * 10));
  disc(ctx, x - r * 0.3, y - r * 0.3, Math.max(0.35, r * 0.42), shade(color, 38));
}

// --- terrain -----------------------------------------------------------------

const STONE: Color = [195, 201, 216];
const DIRT: Color = [195, 154, 112];
const GRASS: Color = [169, 224, 109];
const SAND: Color = [242, 221, 170];
const WOOD: Color = [224, 178, 122];
const BARK: Color = [187, 143, 99];
const LEAF: Color = [127, 212, 95];
const SPRUCE_LEAF: Color = [86, 185, 123];
const BIRCH_LEAF: Color = [165, 232, 126];
const WATER: Color = [127, 214, 242];
const SNOW_C: Color = [240, 246, 255];

tile('stone', (ctx, rng) => {
  facets(ctx, rng, STONE, 3, 9);
  // Two long slivers across the facets, so the rock reads as chipped rather than quilted.
  poly(ctx, [[0, 4.5], [U, 2.5], [U, 4.5], [0, 7]], shade(STONE, -12), 0.5);
  poly(ctx, [[0, 11], [U, 9.5], [U, 11], [0, 12.5]], shade(STONE, 14), 0.4);
});

tile('dirt', (ctx, rng) => {
  facets(ctx, rng, DIRT, 3, 7);
  speckle(ctx, rng, shade(DIRT, -16), 12);
  speckle(ctx, rng, shade(DIRT, 14), 6);
});

tile('grass_top', (ctx, rng) => {
  facets(ctx, rng, GRASS, 3, 6);
  // Soft clumps rather than single bright pixels: at this size a dot is a speck of
  // dirt, a clump is a tussock.
  for (let i = 0; i < 5; i++) {
    disc(ctx, rng() * U, rng() * U, 1.4 + rng() * 1.3, shade(GRASS, i % 2 === 0 ? 16 : -18), 0.55);
  }
});

tile('grass_side', (ctx, rng) => {
  facets(ctx, rng, DIRT, 3, 7);
  speckle(ctx, rng, shade(DIRT, -24), 8);
  // One soft wave of turf over the soil, instead of a row of ragged pixel columns.
  const lip: Pt[] = [[0, 0], [U, 0]];
  for (let x = U; x >= 0; x -= 0.5) lip.push([x, 3.4 + Math.sin((x / U) * Math.PI * 4) * 0.55]);
  poly(ctx, lip, GRASS);
  poly(ctx, [[0, 0], [U, 0], [U, 1.6], [0, 1.6]], shade(GRASS, 14));
  // A couple of blades trailing down into the dirt.
  for (const x of [3.5, 9, 13]) blade(ctx, x, 5, 2, (rng() - 0.5) * 1.2, 1.6, shade(GRASS, -8));
});

tile('cobblestone', (ctx, rng) => {
  rect(ctx, 0, 0, U, U, shade(STONE, -46));
  const cells = [
    [0, 0, 7, 6], [8, 0, 8, 4], [0, 7, 5, 5], [6, 5, 5, 6],
    [12, 5, 4, 7], [0, 13, 8, 3], [9, 12, 7, 4],
  ];
  for (const [x, y, w, h] of cells) {
    const tone = shade(STONE, (rng() - 0.4) * 26);
    roundRect(ctx, x + 0.35, y + 0.35, w - 0.9, h - 0.9, 1.3, tone);
    roundRect(ctx, x + 0.9, y + 0.8, w - 2, (h - 0.9) * 0.42, 0.9, shade(tone, 16));
  }
});

tile('mossy_cobblestone', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  const moss: Color = [104, 168, 88];
  for (let i = 0; i < 7; i++) {
    disc(ctx, rng() * U, rng() * U, 1.2 + rng() * 1.5, shade(moss, (rng() - 0.5) * 30), 0.75);
  }
});

tile('sand', (ctx, rng) => {
  // Big, calm facets: sand is the tile the old per-pixel grain showed up worst on.
  facets(ctx, rng, SAND, 2, 4);
  band(ctx, 3.5, 2.6, 1.1, shade(SAND, 12), 0.85);
  band(ctx, 10, 2.2, 1.3, shade(SAND, -13), 0.6, Math.PI);
  for (let i = 0; i < 3; i++) disc(ctx, rng() * U, rng() * U, 0.55, shade(SAND, 26), 0.9);
});

tile('sandstone_top', (ctx, rng) => {
  facets(ctx, rng, shade(SAND, -6), 2, 4);
  disc(ctx, 8, 8, 5.5, shade(SAND, 8), 0.35);
});

tile('sandstone_side', (ctx, rng) => {
  facets(ctx, rng, shade(SAND, -6), 2, 4);
  for (let i = 0; i < 3; i++) band(ctx, 3 + i * 5, 1.1, 0.5, shade(SAND, -30), 0.65, i);
});

tile('gravel', (ctx, rng) => {
  rect(ctx, 0, 0, U, U, shade(STONE, -54));
  for (let i = 0; i < 12; i++) {
    const tone = shade(STONE, -22 + (rng() - 0.5) * 34);
    const r = 1 + rng() * 0.9;
    const x = rng() * U;
    const y = rng() * U;
    disc(ctx, x, y, r + 0.5, shade(tone, -26));
    disc(ctx, x, y, r, tone);
    disc(ctx, x - r * 0.3, y - r * 0.3, r * 0.4, shade(tone, 16));
  }
});

tile('bedrock', (ctx, rng) => {
  facets(ctx, rng, [70, 70, 74], 3, 16);
  speckle(ctx, rng, [34, 34, 38], 20, 1.4);
});

tile('water', (ctx, rng) => {
  facets(ctx, rng, WATER, 2, 4);
  band(ctx, 2.5, 2, 1.2, shade(WATER, 20), 0.55);
  band(ctx, 9.5, 1.6, 1.4, shade(WATER, 26), 0.45, Math.PI * 0.7);
  for (let i = 0; i < 2; i++) disc(ctx, 3 + rng() * 10, 3 + rng() * 10, 0.9, shade(WATER, 34), 0.6);
});

tile('snow', (ctx, rng) => {
  facets(ctx, rng, SNOW_C, 2, 3);
  for (let i = 0; i < 4; i++) disc(ctx, rng() * U, rng() * U, 1.8 + rng(), shade(SNOW_C, -10), 0.35);
});

tile('ice', (ctx, rng) => {
  facets(ctx, rng, [150, 190, 235], 2, 8);
  // A few long shards catching the light, the way a frozen surface cracks.
  for (let i = 0; i < 3; i++) {
    const x = 2 + rng() * 11;
    poly(ctx, [[x, 0], [x + 1.6, 0], [x + 3.4, U], [x + 2.2, U]], [196, 226, 250], 0.5);
  }
});

// --- wood --------------------------------------------------------------------

function barkTile(base: Color): Draw {
  return (ctx, rng) => {
    facets(ctx, rng, base, 2, 6);
    // Grooves down the trunk: rounded strips, not columns of dark pixels.
    let x = 0.6;
    while (x < U - 1) {
      const w = 1 + rng() * 1.4;
      roundRect(ctx, x, -1, w, U + 2, w / 2, shade(base, -22 - rng() * 12), 0.85);
      x += w + 1 + rng() * 1.6;
    }
  };
}

function logTopTile(base: Color): Draw {
  return (ctx, rng) => {
    facets(ctx, rng, shade(base, 26), 2, 5);
    // Growth rings, drawn as smooth circles.
    for (let r = 7.4; r > 0.8; r -= 1.9) {
      ctx.strokeStyle = css(shade(base, -18), 0.85);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(8 + (rng() - 0.5) * 0.4, 8 + (rng() - 0.5) * 0.4, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    disc(ctx, 8, 8, 1.1, shade(base, -24));
  };
}

tile('oak_log_side', barkTile(BARK));
tile('oak_log_top', logTopTile(BARK));
tile('birch_log_side', (ctx, rng) => {
  facets(ctx, rng, [222, 220, 208], 2, 4);
  for (let i = 0; i < 5; i++) {
    const w = 3 + rng() * 4;
    roundRect(ctx, rng() * (U - w), rng() * (U - 1.2), w, 1.2, 0.6, [72, 70, 64], 0.9);
  }
});
tile('birch_log_top', logTopTile([190, 186, 172]));
tile('spruce_log_side', barkTile([98, 72, 46]));
tile('spruce_log_top', logTopTile([120, 88, 56]));

function leafTile(base: Color): Draw {
  return (ctx, rng) => {
    ctx.clearRect(0, 0, U, U);
    // A solid canopy first, then clumps on it, then a few holes punched through it —
    // built this way round the foliage stays dense however the clumps happen to fall.
    rect(ctx, 0, 0, U, U, base);
    for (let i = 0; i < 7; i++) {
      disc(ctx, rng() * U, rng() * U, 2.2 + rng() * 1.8, shade(base, (rng() - 0.45) * 46), 0.8);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) disc(ctx, rng() * U, rng() * U, 0.6 + rng() * 0.6, [0, 0, 0]);
    ctx.restore();
  };
}

tile('oak_leaves', leafTile(LEAF));
tile('birch_leaves', leafTile(BIRCH_LEAF));
tile('spruce_leaves', leafTile(SPRUCE_LEAF));

tile('oak_planks', (ctx, rng) => {
  rect(ctx, 0, 0, U, U, shade(WOOD, -46));
  for (let y = 0; y < U; y += 4) {
    const tone = shade(WOOD, (rng() - 0.5) * 14);
    roundRect(ctx, 0.25, y + 0.4, U - 0.5, 3.2, 0.8, tone);
    roundRect(ctx, 0.25, y + 0.6, U - 0.5, 1.1, 0.55, shade(tone, 12));
    disc(ctx, 2 + rng() * 12, y + 2, 0.5, shade(tone, -26), 0.8);
  }
});

// --- ores --------------------------------------------------------------------

function oreTile(color: Color, count = 5): Draw {
  return (ctx, rng) => {
    drawings.get('stone')!(ctx, rng);
    for (let i = 0; i < count; i++) {
      blob(ctx, rng, 2 + rng() * 11, 2 + rng() * 11, 1.4 + rng() * 0.9, color);
    }
  };
}

tile('coal_ore', oreTile([54, 54, 58]));
tile('iron_ore', oreTile([196, 150, 110]));
tile('gold_ore', oreTile([236, 200, 70]));
tile('diamond_ore', oreTile([110, 226, 226], 4));
tile('emerald_ore', oreTile([70, 210, 110], 4));

// --- crafted blocks ----------------------------------------------------------

tile('glass', (ctx) => {
  ctx.clearRect(0, 0, U, U);
  roundRect(ctx, 0, 0, U, U, 2, [210, 235, 245], 0.22);
  ctx.strokeStyle = css([235, 250, 255], 0.85);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0.5, 0.5);
  ctx.lineTo(U - 0.5, 0.5);
  ctx.lineTo(U - 0.5, U - 0.5);
  ctx.lineTo(0.5, U - 0.5);
  ctx.closePath();
  ctx.stroke();
  poly(ctx, [[3, 3.5], [7, 3.5], [5.5, 5], [2.5, 5]], [255, 255, 255], 0.5);
});

tile('crafting_table_top', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  roundRect(ctx, 0, 0, U, 2.2, 0.8, shade(WOOD, -50));
  for (let i = 4; i < U; i += 5) {
    roundRect(ctx, i - 0.4, 2, 1, U - 2, 0.5, shade(WOOD, -46), 0.85);
    roundRect(ctx, 2, i - 0.4, U - 2, 1, 0.5, shade(WOOD, -46), 0.85);
  }
});

tile('crafting_table_side', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  roundRect(ctx, 2, 5, 5, 4, 1, shade(WOOD, -40));
  roundRect(ctx, 9, 8, 5, 5, 1, shade(WOOD, -30));
});

tile('furnace_top', (ctx, rng) => {
  drawings.get('stone')!(ctx, rng);
  roundRect(ctx, 3, 3, 10, 10, 1.6, shade(STONE, -26));
});

tile('furnace_front', (ctx, rng) => {
  drawings.get('stone')!(ctx, rng);
  roundRect(ctx, 2, 2, 12, 2.4, 0.8, shade(STONE, -34));
  roundRect(ctx, 3, 6, 10, 8, 1.6, [48, 44, 42]);
  roundRect(ctx, 4, 9.5, 8, 3.6, 1.4, [214, 116, 44]);
  roundRect(ctx, 5, 11.4, 6, 1.6, 0.8, [246, 196, 84]);
});

tile('chest_top', (ctx, rng) => {
  facets(ctx, rng, [172, 124, 68], 2, 8);
  roundRect(ctx, 0, 0, U, 1.6, 0.6, [110, 74, 36]);
  roundRect(ctx, 0, U - 1.6, U, 1.6, 0.6, [110, 74, 36]);
});

tile('chest_side', (ctx, rng) => {
  facets(ctx, rng, [172, 124, 68], 2, 8);
  roundRect(ctx, 0, 5.6, U, 2.6, 0.8, [110, 74, 36]);
  roundRect(ctx, 5.5, 5.6, 5, 5, 1.2, [222, 192, 96]);
  disc(ctx, 8, 8.4, 1, [78, 60, 26]);
});

tile('stone_bricks', (ctx, rng) => {
  rect(ctx, 0, 0, U, U, shade(STONE, -44));
  for (let y = 0; y < U; y += 4) {
    const offset = (y / 4) % 2 === 0 ? 0 : -4;
    for (let x = offset; x < U; x += 8) {
      const tone = shade(STONE, (rng() - 0.4) * 20);
      roundRect(ctx, x + 0.4, y + 0.4, 7.2, 3.2, 1, tone);
      roundRect(ctx, x + 0.9, y + 0.8, 6.2, 1.1, 0.5, shade(tone, 13));
    }
  }
});

tile('wool', (ctx, rng) => {
  rect(ctx, 0, 0, U, U, [236, 236, 240]);
  // Puffs, which is what wool looks like once it stops being a field of noise.
  for (let i = 0; i < 9; i++) {
    disc(ctx, rng() * U, rng() * U, 2 + rng() * 1.6, shade([236, 236, 240], (rng() - 0.55) * 24), 0.6);
  }
});

tile('bookshelf', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  const colors: Color[] = [[196, 82, 70], [78, 116, 196], [104, 176, 92], [214, 172, 74]];
  for (const row of [2, 9]) {
    roundRect(ctx, 0.5, row - 0.4, U - 1, 5.8, 0.6, shade(WOOD, -52));
    let x = 1;
    while (x < U - 1.5) {
      const w = 1.2 + rng() * 1.4;
      const color = colors[Math.floor(rng() * colors.length)];
      roundRect(ctx, x, row, w, 5, 0.5, color);
      roundRect(ctx, x, row, w, 1.4, 0.5, shade(color, 26));
      x += w + 0.7;
    }
  }
});

tile('farmland', (ctx, rng) => {
  facets(ctx, rng, shade(DIRT, -6), 3, 6);
  for (let i = 0; i < 3; i++) band(ctx, 1 + i * 5, 1.8, 0.6, shade(DIRT, -30), 0.8, i * 1.3);
});

tile('farmland_wet', (ctx, rng) => {
  facets(ctx, rng, shade(DIRT, -34), 3, 6);
  for (let i = 0; i < 3; i++) band(ctx, 1 + i * 5, 1.8, 0.6, shade(DIRT, -56), 0.85, i * 1.3);
});

tile('dirt_path_top', (ctx, rng) => {
  facets(ctx, rng, shade(DIRT, 16), 3, 6);
  speckle(ctx, rng, shade(DIRT, -14), 8);
  roundRect(ctx, 0, 0, U, 1.2, 0.5, shade(DIRT, -20), 0.9);
  roundRect(ctx, 0, U - 1.2, U, 1.2, 0.5, shade(DIRT, -20), 0.9);
});

// A length of rail, as it looks in the hand: a crossing rather than a straight run, so
// that a stack of it reads as track from any angle in a hotbar slot.
const RAIL_STEEL: Color = [176, 180, 188];
const RAIL_TIE: Color = [96, 72, 46];

tile('rail_top', (ctx, rng) => {
  drawings.get('gravel')!(ctx, rng);
  // Sleepers first, both ways, and thin: any wider and they cover half the tile, and the
  // block reads as a boardwalk with the track lost somewhere in it.
  for (let i = 2; i < U; i += 4) {
    roundRect(ctx, i, -1, 1.2, U + 2, 0.5, shade(RAIL_TIE, (rng() - 0.5) * 20));
    roundRect(ctx, -1, i, U + 2, 1.2, 0.5, shade(RAIL_TIE, (rng() - 0.5) * 20));
  }
  // Then the steel over the top of them, wide enough and bright enough to be what the
  // eye lands on.
  for (const at of [3, U - 5]) {
    roundRect(ctx, at, -1, 2, U + 2, 0.7, RAIL_STEEL);
    roundRect(ctx, -1, at, U + 2, 2, 0.7, RAIL_STEEL);
    roundRect(ctx, at, -1, 1, U + 2, 0.5, shade(RAIL_STEEL, 34));
    roundRect(ctx, -1, at, U + 2, 1, 0.5, shade(RAIL_STEEL, 34));
  }
});

// The tool that lays the free-form track. It cannot borrow `rail_top`: a stack of rails
// and the thing that draws curves would then be the same picture in the hotbar, and they
// do entirely different jobs on the same mouse button.
tile('track_tool', (ctx) => {
  iconBase(ctx);
  // The same bottom-left to top-right handle every tool in the game has.
  for (let i = 0; i < 7; i++) roundRect(ctx, 2 + i, 13 - i, 2, 2, 0.7, shade(BARK, 16));
  // A short length of track for a head, bending as it goes, because bending is the point.
  for (let j = 0; j < 7; j++) {
    const y = 2 + j;
    const x = 8 - (j * j) / 8;
    if (j % 2 === 0) roundRect(ctx, x, y, 7, 1, 0.5, RAIL_TIE);
    roundRect(ctx, x, y, 1, 1, 0.5, RAIL_STEEL);
    roundRect(ctx, x + 6, y, 1, 1, 0.5, shade(RAIL_STEEL, 30));
  }
});

// The station, as it looks in the hand. A platform with a shelter over it and a crate
// standing on it: what it is for has to be readable in a hotbar slot, and "somewhere the
// goods wait" is the half of it a picture can carry.
tile('station', (ctx) => {
  iconBase(ctx);
  // the platform
  roundRect(ctx, 1, 11, 14, 3, 0.8, shade(STONE, 8));
  roundRect(ctx, 1, 11, 14, 1.2, 0.6, shade(STONE, 40));
  // posts and a roof over them
  roundRect(ctx, 3, 5, 1.2, 6, 0.5, shade(BARK, 10));
  roundRect(ctx, 11.8, 5, 1.2, 6, 0.5, shade(BARK, 10));
  poly(ctx, [[1.5, 5], [8, 2.2], [14.5, 5], [14.5, 5.8], [1.5, 5.8]], [186, 88, 70]);
  poly(ctx, [[2.6, 4.6], [8, 2.6], [13.4, 4.6]], [214, 116, 92]);
  // a crate waiting on it
  roundRect(ctx, 6, 7, 5, 4, 0.8, [170, 130, 74]);
  roundRect(ctx, 6, 8, 5, 1, 0.4, shade(RAIL_TIE, 10));
});

// The signal, as it looks in the hand. A post with a lamp on it, showing green: the one
// that means "go", because a hotbar icon should not look like a warning.
tile('signal', (ctx) => {
  iconBase(ctx);
  // the post, standing on a foot
  roundRect(ctx, 7, 3, 2, 11, 0.8, shade(BARK, -6));
  roundRect(ctx, 5, 12.8, 6, 2, 0.8, shade(STONE, 4));
  // the lamp head, and the light in it
  roundRect(ctx, 2.8, 2, 6.4, 7, 1.6, shade(RAIL_STEEL, -20));
  disc(ctx, 6, 5.4, 2.1, [70, 210, 110]);
  disc(ctx, 5.4, 4.8, 0.9, [190, 255, 208]);
});

tile('cactus_top', (ctx, rng) => {
  facets(ctx, rng, [70, 132, 62], 2, 6);
  disc(ctx, 8, 8, 4.4, [96, 166, 82]);
  disc(ctx, 6.6, 6.6, 1.6, [120, 190, 100], 0.7);
});

tile('cactus_side', (ctx, rng) => {
  facets(ctx, rng, [70, 132, 62], 2, 6);
  roundRect(ctx, -1, -1, 2.2, U + 2, 0.8, [50, 100, 46]);
  roundRect(ctx, U - 1.2, -1, 2.2, U + 2, 0.8, [50, 100, 46]);
  roundRect(ctx, 6.4, -1, 3.2, U + 2, 1.4, [88, 156, 76], 0.7);
  for (let y = 1; y < U; y += 4) {
    disc(ctx, 3.2, y, 0.55, [232, 232, 214]);
    disc(ctx, 12.6, y + 2, 0.55, [232, 232, 214]);
  }
});

// --- water works ---------------------------------------------------------------

tile('spring_top', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  disc(ctx, 8, 8, 5.2, [70, 130, 210]);
  disc(ctx, 8, 8, 3.2, [104, 168, 226]);
  disc(ctx, 8, 8, 1.6, [166, 214, 244]);
});

tile('spring_side', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  for (let y = 4; y < U; y += 5) roundRect(ctx, 3, y, 10, 2, 1, [70, 130, 210]);
});

tile('pump_top', (ctx, rng) => {
  facets(ctx, rng, [150, 150, 158], 2, 6);
  disc(ctx, 8, 8, 4.6, [96, 96, 104]);
  disc(ctx, 8, 8, 2.4, [58, 110, 178]);
  disc(ctx, 6.9, 6.9, 0.9, [140, 190, 232], 0.8);
});

tile('pump_side', (ctx, rng) => {
  facets(ctx, rng, [150, 150, 158], 2, 6);
  roundRect(ctx, -1, 3, U + 2, 2, 0.8, [104, 104, 112]);
  roundRect(ctx, -1, 11, U + 2, 2, 0.8, [104, 104, 112]);
  roundRect(ctx, 5.6, 5, 4.8, 6, 1.4, [72, 72, 80]);
});

tile('drain_top', (ctx, rng) => {
  facets(ctx, rng, [122, 122, 130], 2, 6);
  for (let i = 3; i < U - 2; i += 3) roundRect(ctx, i, 3, 2, U - 6, 0.8, [40, 44, 52]);
});

tile('floodgate_closed', (ctx, rng) => {
  facets(ctx, rng, WOOD, 2, 5);
  roundRect(ctx, -1, 0, U + 2, 2, 0.8, [120, 120, 128]);
  roundRect(ctx, -1, U - 2, U + 2, 2, 0.8, [120, 120, 128]);
  for (let y = 3; y < U - 2; y += 4) roundRect(ctx, 1, y, U - 2, 2, 0.9, shade(WOOD, -34));
  disc(ctx, 8, 8, 2.2, [150, 150, 158]);
});

tile('floodgate_open', (ctx) => {
  ctx.clearRect(0, 0, U, U);
  // Only the frame remains once the gate is raised.
  roundRect(ctx, 0, 0, U, 3, 0.8, [120, 120, 128]);
  roundRect(ctx, 0, U - 3, U, 3, 0.8, shade(WOOD, -20));
  roundRect(ctx, 0, 0, 2, U, 0.8, [120, 120, 128]);
  roundRect(ctx, U - 2, 0, 2, U, 0.8, [120, 120, 128]);
});

// --- cross-shaped plants -----------------------------------------------------

function plantTile(draw: Draw): Draw {
  return (ctx, rng) => {
    ctx.clearRect(0, 0, U, U);
    draw(ctx, rng);
  };
}

tile('tall_grass', plantTile((ctx, rng) => {
  for (let i = 0; i < 7; i++) {
    const x = 1.6 + i * 2 + (rng() - 0.5);
    blade(ctx, x, U, 7 + rng() * 6, (rng() - 0.5) * 4, 1.7, shade(GRASS, (rng() - 0.5) * 34));
  }
}));

tile('dead_bush', plantTile((ctx, rng) => {
  const base: Color = [138, 104, 54];
  for (let i = 0; i < 5; i++) {
    const x = 3 + i * 2.4;
    blade(ctx, x, U, 6 + rng() * 5, (rng() - 0.5) * 5, 1.1, shade(base, (rng() - 0.5) * 26));
  }
}));

function flowerTile(petal: Color): Draw {
  return plantTile((ctx, rng) => {
    blade(ctx, 8, U, 10, -0.5, 1.1, shade(GRASS, -14));
    disc(ctx, 6.4, 8.2, 1.1, shade(GRASS, -4));
    disc(ctx, 9.6, 6.6, 1.1, shade(GRASS, -4));
    // Five round petals around a middle: the shape a child draws when asked for a flower.
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      disc(ctx, 8 + Math.cos(angle) * 2.4, 4.4 + Math.sin(angle) * 2.4, 2, shade(petal, (rng() - 0.5) * 18));
    }
    disc(ctx, 8, 4.4, 1.5, [250, 226, 120]);
    disc(ctx, 7.4, 3.8, 0.6, [255, 246, 200], 0.8);
  });
}

tile('flower_red', flowerTile([222, 84, 74]));
tile('flower_yellow', flowerTile([246, 210, 74]));

tile('sugar_cane', plantTile((ctx, rng) => {
  const cane: Color = [124, 186, 116];
  roundRect(ctx, 5.2, -1, 5.6, U + 2, 2, cane);
  roundRect(ctx, 6, -1, 1.8, U + 2, 0.9, shade(cane, 22), 0.7);
  for (let y = 3; y < U; y += 5) roundRect(ctx, 5.2, y, 5.6, 1, 0.5, shade(cane, -30 + (rng() - 0.5) * 10));
}));

tile('torch', plantTile((ctx) => {
  roundRect(ctx, 6.9, 5.5, 2.2, U - 5, 1, shade(BARK, -6));
  roundRect(ctx, 7.3, 5.5, 0.8, U - 5, 0.4, shade(BARK, 22), 0.7);
  disc(ctx, 8, 4.4, 2.2, [244, 168, 52], 0.9);
  disc(ctx, 8, 4, 1.4, [252, 214, 96]);
  disc(ctx, 8, 3.4, 0.7, [255, 250, 218]);
}));

function cropTile(stage: number, color: Color, ripe: Color): Draw {
  return plantTile((ctx, rng) => {
    const height = 3 + stage * 4;
    const tint = stage === 3 ? ripe : color;
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 3;
      const h = height * (0.82 + rng() * 0.36);
      blade(ctx, x, U, h, (rng() - 0.5) * 2.4, 1.6, shade(tint, (rng() - 0.5) * 24));
      // A ripe stalk carries a head of grain at the top.
      if (stage === 3) disc(ctx, x + 0.3, U - h, 1.1, shade(ripe, 24));
    }
  });
}

for (let stage = 0; stage < 4; stage++) {
  tile(`wheat_${stage}`, cropTile(stage, [110, 160, 70], [222, 194, 88]));
  tile(`carrots_${stage}`, cropTile(stage, [76, 150, 66], [236, 146, 56]));
  tile(`potatoes_${stage}`, cropTile(stage, [84, 148, 70], [204, 176, 100]));
}

// --- item icons ---------------------------------------------------------------

function iconBase(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, U, U);
}

function nugget(color: Color, count = 4): Draw {
  return (ctx, rng) => {
    iconBase(ctx);
    const spots = [[6, 5], [9, 7], [5, 9], [8, 10], [7, 7]];
    for (let i = 0; i < count; i++) {
      const [x, y] = spots[i % spots.length];
      blob(ctx, rng, x, y, 2, color);
    }
  };
}

tile('coal', nugget([44, 44, 46], 3));
tile('diamond', (ctx) => {
  iconBase(ctx);
  const c: Color = [120, 232, 232];
  // A cut stone is the one thing in the set that really is a handful of flat faces.
  poly(ctx, [[5, 4], [11, 4], [12.4, 7], [3.6, 7]], c);
  poly(ctx, [[3.6, 7], [12.4, 7], [8, 12.6]], shade(c, -30));
  poly(ctx, [[5, 4], [8, 7], [3.6, 7]], shade(c, 26));
  poly(ctx, [[3.6, 7], [8, 7], [8, 12.6]], shade(c, -10));
});
tile('emerald', (ctx) => {
  iconBase(ctx);
  const c: Color = [70, 214, 116];
  poly(ctx, [[8, 2.6], [12.6, 6], [10.8, 12.6], [5.2, 12.6], [3.4, 6]], c);
  poly(ctx, [[8, 2.6], [12.6, 6], [8, 7.6], [3.4, 6]], shade(c, 30));
  poly(ctx, [[8, 7.6], [10.8, 12.6], [5.2, 12.6]], shade(c, -26));
});

function ingot(color: Color): Draw {
  return (ctx) => {
    iconBase(ctx);
    poly(ctx, [[3.4, 11.4], [12.6, 11.4], [11, 6.4], [5, 6.4]], color);
    poly(ctx, [[5, 6.4], [11, 6.4], [10.2, 5.2], [5.8, 5.2]], shade(color, 30));
    poly(ctx, [[3.4, 11.4], [12.6, 11.4], [12.6, 10.4], [3.4, 10.4]], shade(color, -40));
  };
}

tile('iron_ingot', ingot([214, 214, 214]));
tile('gold_ingot', ingot([238, 202, 74]));

tile('bucket', (ctx) => {
  iconBase(ctx);
  const metal: Color = [186, 186, 194];
  // the handle, an arc over the pail
  ctx.strokeStyle = css(shade(metal, -30));
  ctx.lineCap = 'round';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(8, 5.4, 3.6, Math.PI, Math.PI * 2);
  ctx.stroke();
  poly(ctx, [[3.6, 5.4], [12.4, 5.4], [11, 13.4], [5, 13.4]], shade(metal, -18));
  roundRect(ctx, 3.4, 4.6, 9.2, 1.6, 0.8, metal);
  poly(ctx, [[5.2, 6.6], [7, 6.6], [6.4, 12.4], [5.4, 12.4]], shade(metal, 22), 0.6);
});

tile('water_bucket', (ctx, rng) => {
  drawings.get('bucket')!(ctx, rng);
  roundRect(ctx, 5, 7, 6, 5, 1, WATER);
  roundRect(ctx, 5.6, 7.4, 2, 1.4, 0.7, shade(WATER, 26), 0.9);
});

tile('stick', (ctx) => {
  iconBase(ctx);
  ctx.strokeStyle = css(shade(BARK, 20));
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(4.5, 12.5);
  ctx.lineTo(12.5, 3.5);
  ctx.stroke();
});

tile('leather', (ctx, rng) => {
  iconBase(ctx);
  const hide: Color = [168, 122, 78];
  roundRect(ctx, 3, 4, 10, 8, 2, hide);
  for (let i = 0; i < 3; i++) disc(ctx, 4 + rng() * 8, 5 + rng() * 6, 1.4, shade(hide, -16), 0.5);
  roundRect(ctx, 4, 5, 4, 1.4, 0.7, shade(hide, 24), 0.8);
});

tile('feather', (ctx) => {
  iconBase(ctx);
  blade(ctx, 8, 13.5, 10, 1.6, 4.6, [235, 238, 245]);
  ctx.strokeStyle = css([206, 210, 220]);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(7.6, 13.5);
  ctx.lineTo(9.6, 3.8);
  ctx.stroke();
});

tile('wheat_item', (ctx, rng) => {
  iconBase(ctx);
  const straw: Color = [222, 194, 88];
  for (const [x, bend] of [[4.5, -1.8], [8, 0], [11.5, 1.8]] as const) {
    blade(ctx, x, 14, 11, bend, 1.6, shade(straw, (rng() - 0.5) * 16));
    disc(ctx, x + bend * 0.9, 4.4, 1.3, shade(straw, 22));
  }
});

tile('wheat_seeds', (ctx, rng) => {
  iconBase(ctx);
  for (let i = 0; i < 6; i++) {
    disc(ctx, 5 + rng() * 6, 6 + rng() * 5, 0.9, shade([150, 170, 96], (rng() - 0.5) * 24));
  }
});

tile('bread', (ctx, rng) => {
  iconBase(ctx);
  const crust: Color = [196, 142, 72];
  roundRect(ctx, 3, 4.5, 10, 7, 3, crust);
  roundRect(ctx, 4, 5.2, 8, 2, 1, shade(crust, 26), 0.9);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = css(shade(crust, -34), 0.8);
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(4.6 + i * 2.6, 6.4 + rng() * 0.4);
    ctx.lineTo(6 + i * 2.6, 9.4);
    ctx.stroke();
  }
});

tile('apple', (ctx) => {
  iconBase(ctx);
  disc(ctx, 6.4, 8.6, 3.6, [212, 60, 52]);
  disc(ctx, 9.6, 8.6, 3.6, [212, 60, 52]);
  disc(ctx, 8, 10.4, 3.4, [212, 60, 52]);
  disc(ctx, 6.2, 6.8, 1.2, [240, 140, 130], 0.85);
  roundRect(ctx, 7.6, 2.6, 1, 3, 0.5, [110, 76, 40]);
  disc(ctx, 10, 3.2, 1.5, [96, 168, 68]);
});

tile('carrot', (ctx) => {
  iconBase(ctx);
  poly(ctx, [[5.4, 5], [10.2, 5], [8.4, 14]], [236, 146, 56]);
  poly(ctx, [[6.2, 5.4], [7.6, 5.4], [7.6, 11]], [250, 182, 104], 0.7);
  for (const bend of [-1.6, 0, 1.6]) blade(ctx, 8, 5.4, 4, bend, 1.6, [96, 172, 70]);
});

tile('potato', (ctx, rng) => {
  iconBase(ctx);
  const skin: Color = [204, 176, 100];
  roundRect(ctx, 3.6, 5, 8.8, 7, 3.4, skin);
  roundRect(ctx, 5, 5.8, 3.4, 1.6, 0.8, shade(skin, 22), 0.85);
  for (let i = 0; i < 3; i++) disc(ctx, 5 + rng() * 6, 7 + rng() * 4, 0.5, shade(skin, -34), 0.8);
});

tile('baked_potato', (ctx, rng) => {
  iconBase(ctx);
  const baked: Color = [168, 126, 62];
  roundRect(ctx, 3.6, 5, 8.8, 7, 3.4, baked);
  roundRect(ctx, 6, 7, 4, 2.4, 1.2, [236, 216, 156]);
  for (let i = 0; i < 3; i++) disc(ctx, 4.6 + rng() * 7, 6 + rng() * 5, 0.5, shade(baked, -30), 0.7);
});

function meatTile(raw: boolean, tint: Color): Draw {
  return (ctx, rng) => {
    iconBase(ctx);
    const base = raw ? tint : shade(tint, -34);
    roundRect(ctx, 3, 4, 10, 8, 2.6, base);
    for (let i = 0; i < 3; i++) disc(ctx, 4 + rng() * 8, 5 + rng() * 6, 1.3, shade(base, -20), 0.45);
    roundRect(ctx, 5, 6, 3.4, 2, 1, shade(base, raw ? 40 : 20));
  };
}

tile('raw_beef', meatTile(true, [204, 92, 88]));
tile('cooked_beef', meatTile(false, [176, 108, 62]));
tile('raw_porkchop', meatTile(true, [232, 152, 148]));
tile('cooked_porkchop', meatTile(false, [196, 132, 78]));
tile('raw_chicken', meatTile(true, [232, 186, 160]));
tile('cooked_chicken', meatTile(false, [198, 150, 84]));
tile('raw_mutton', meatTile(true, [214, 116, 104]));
tile('cooked_mutton', meatTile(false, [170, 106, 60]));

const TIER_COLORS: Record<string, Color> = {
  wooden: [156, 122, 74],
  stone: [136, 136, 136],
  iron: [218, 218, 218],
  diamond: [110, 230, 226],
  leather: [166, 118, 76],
};

function toolTile(kind: string, tierName: string): Draw {
  const head = TIER_COLORS[tierName];
  return (ctx) => {
    iconBase(ctx);
    // Handle runs from bottom-left to top-right for every tool.
    ctx.strokeStyle = css(shade(BARK, 16));
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(4.5, 13);
    ctx.lineTo(12.5, 4);
    ctx.stroke();
    switch (kind) {
      case 'pickaxe':
        // A head that curves, the way the business end of a pick does.
        poly(ctx, [[3.4, 5.6], [8, 2.4], [12.6, 5.6], [12.6, 3.6], [8, 1], [3.4, 3.6]], head);
        break;
      case 'axe':
        poly(ctx, [[7.6, 2.4], [12.4, 3.4], [12.4, 6.6], [7.6, 7.4]], head);
        roundRect(ctx, 7, 2.6, 1.4, 4.6, 0.6, shade(head, -24));
        break;
      case 'shovel':
        poly(ctx, [[8.6, 2], [13, 2], [13, 5.4], [10.8, 7.4], [8.6, 5.4]], head);
        break;
      case 'hoe':
        roundRect(ctx, 8, 2, 6, 2, 0.8, head);
        roundRect(ctx, 8, 2, 2, 4, 0.8, head);
        break;
      default:
        // A blade, tapering to a point, over a little crossguard.
        poly(ctx, [[4.4, 2.2], [6.6, 2.4], [10.4, 8.4], [8.4, 9.4]], head);
        roundRect(ctx, 3.2, 9.6, 5.4, 1.8, 0.9, shade(BARK, -20));
        break;
    }
  };
}

for (const tierName of ['wooden', 'stone', 'iron', 'diamond']) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
    tile(`${kind}_${tierName}`, toolTile(kind, tierName));
  }
}

function armorTile(slot: string, setName: string): Draw {
  const color = TIER_COLORS[setName] ?? [200, 200, 200];
  return (ctx) => {
    iconBase(ctx);
    switch (slot) {
      case 'helmet':
        roundRect(ctx, 3, 3.6, 10, 5, 2.4, color);
        roundRect(ctx, 3, 7, 3, 4, 1.2, color);
        roundRect(ctx, 10, 7, 3, 4, 1.2, color);
        break;
      case 'chestplate':
        roundRect(ctx, 3, 3, 10, 9, 2.2, color);
        roundRect(ctx, 5.6, 2.4, 4.8, 3.4, 1.6, shade(color, -50));
        break;
      case 'leggings':
        roundRect(ctx, 4, 3, 8, 4.4, 1.4, color);
        roundRect(ctx, 4, 6, 3.2, 7, 1.2, color);
        roundRect(ctx, 8.8, 6, 3.2, 7, 1.2, color);
        break;
      default:
        roundRect(ctx, 2.8, 7, 4.4, 5, 1.4, color);
        roundRect(ctx, 8.8, 7, 4.4, 5, 1.4, color);
        break;
    }
  };
}

for (const setName of ['leather', 'iron']) {
  for (const slot of ['helmet', 'chestplate', 'leggings', 'boots']) {
    tile(`${slot}_${setName}`, armorTile(slot, setName));
  }
}

// --- atlas assembly ------------------------------------------------------------

export interface Atlas {
  texture: THREE.Texture;
  uv(name: string): TileUv;
  /** Data URL of a single tile, used for the DOM inventory icons. */
  icon(name: string): string;
  canvas: HTMLCanvasElement;
}

let cached: Atlas | null = null;

export function buildAtlas(): Atlas {
  if (cached) return cached;

  const names = [...drawings.keys()];
  const rows = Math.ceil(names.length / ATLAS_COLS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;

  const uvs = new Map<string, TileUv>();
  const icons = new Map<string, string>();

  names.forEach((name, index) => {
    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    const cell = document.createElement('canvas');
    cell.width = TILE;
    cell.height = TILE;
    const cellCtx = cell.getContext('2d');
    if (!cellCtx) throw new Error('2D canvas is not available');
    // Drawings work in units; the cell is several pixels to the unit so their curves
    // and diagonals resolve instead of stepping.
    cellCtx.scale(TILE / U, TILE / U);
    // A per-tile seed keeps textures stable between runs.
    drawings.get(name)!(cellCtx, mulberry32(0x9e3779b9 ^ (index * 2654435761)));
    ctx.drawImage(cell, col * TILE, row * TILE);
    icons.set(name, cell.toDataURL());
    uvs.set(name, {
      u0: (col * TILE) / canvas.width,
      v0: (row * TILE) / canvas.height,
      u1: ((col + 1) * TILE) / canvas.width,
      v1: ((row + 1) * TILE) / canvas.height,
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;

  const fallback: TileUv = { u0: 0, v0: 0, u1: TILE / canvas.width, v1: TILE / canvas.height };
  cached = {
    texture,
    canvas,
    uv: (name) => uvs.get(name) ?? fallback,
    icon: (name) => icons.get(name) ?? '',
  };
  return cached;
}

export function tileNames(): string[] {
  return [...drawings.keys()];
}

// The stop, as it looks in the hand. A post with a sign on it standing on a paved square:
// not a building, because a stop is not one — it is a place a line calls at, and the
// picture has to say "a name on a pole" rather than "a shed".
tile('stop', (ctx) => {
  iconBase(ctx);
  // the paving it stands on
  rect(ctx, 2, 12, 12, 3, shade(STONE, 6));
  rect(ctx, 2, 12, 12, 1, shade(STONE, 36));
  // the post
  rect(ctx, 7, 4, 2, 8, shade(BARK, -4));
  // the sign, with a line of writing on it
  rect(ctx, 3, 2, 10, 5, [222, 214, 196]);
  rect(ctx, 3, 2, 10, 1, [250, 246, 234]);
  rect(ctx, 5, 4, 6, 1, [90, 84, 74]);
});

// The industry kit, as it looks in the hand. A surveyor's stake driven into a seam: what
// the tool actually does is *look at the ground and answer*, so the picture is the stake
// and the rock rather than a factory the player has not earned yet.
tile('industry_kit', (ctx) => {
  iconBase(ctx);
  // the seam it is driven into
  rect(ctx, 1, 11, 14, 4, shade(STONE, -14));
  rect(ctx, 3, 12, 3, 2, [46, 44, 48]);
  rect(ctx, 9, 12, 4, 2, [46, 44, 48]);
  // the stake
  rect(ctx, 7, 3, 2, 9, shade(BARK, 8));
  // the flag on it
  rect(ctx, 9, 3, 5, 4, [226, 138, 62]);
  rect(ctx, 9, 3, 5, 1, [248, 176, 104]);
});
