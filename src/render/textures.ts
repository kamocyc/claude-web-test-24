import * as THREE from 'three';
import { mulberry32, type Rng } from '../core/rng';

/** Every block and item texture is drawn procedurally into one atlas at start-up,
 *  which keeps the game a single self-contained bundle with no image assets. */

export const TILE = 16;
export const ATLAS_COLS = 16;

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

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

type Color = [number, number, number];

function shade(color: Color, amount: number): Color {
  return [
    Math.max(0, Math.min(255, color[0] + amount)),
    Math.max(0, Math.min(255, color[1] + amount)),
    Math.max(0, Math.min(255, color[2] + amount)),
  ];
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: Color, alpha = 1): void {
  ctx.fillStyle = alpha >= 1 ? rgb(...color) : `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: Color, alpha = 1): void {
  ctx.fillStyle = alpha >= 1 ? rgb(...color) : `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
  ctx.fillRect(x, y, w, h);
}

/** Fills the tile with a grainy version of the base colour. */
function grain(ctx: CanvasRenderingContext2D, rng: Rng, base: Color, spread = 18): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      px(ctx, x, y, shade(base, (rng() - 0.5) * 2 * spread));
    }
  }
}

function speckle(ctx: CanvasRenderingContext2D, rng: Rng, color: Color, count: number, size = 1): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    rect(ctx, x, y, size, size, shade(color, (rng() - 0.5) * 20));
  }
}

/** Rounded blob used for ores and berries. */
function blob(ctx: CanvasRenderingContext2D, rng: Rng, cx: number, cy: number, r: number, color: Color): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + 0.5) continue;
      const tx = cx + x;
      const ty = cy + y;
      if (tx < 0 || ty < 0 || tx >= TILE || ty >= TILE) continue;
      px(ctx, tx, ty, shade(color, (rng() - 0.5) * 26));
    }
  }
}

// --- terrain -----------------------------------------------------------------

const STONE: Color = [128, 128, 128];
const DIRT: Color = [134, 96, 67];
const GRASS: Color = [92, 160, 74];
const SAND: Color = [219, 207, 163];
const WOOD: Color = [160, 128, 80];
const BARK: Color = [104, 78, 48];
const LEAF: Color = [66, 130, 52];
const SPRUCE_LEAF: Color = [46, 96, 60];
const BIRCH_LEAF: Color = [110, 160, 70];
const WATER: Color = [58, 106, 200];
const SNOW_C: Color = [237, 244, 250];

tile('stone', (ctx, rng) => {
  grain(ctx, rng, STONE, 14);
  speckle(ctx, rng, shade(STONE, -28), 14);
  speckle(ctx, rng, shade(STONE, 20), 10);
});

tile('dirt', (ctx, rng) => {
  grain(ctx, rng, DIRT, 20);
  speckle(ctx, rng, shade(DIRT, -30), 16);
});

tile('grass_top', (ctx, rng) => {
  grain(ctx, rng, GRASS, 20);
  speckle(ctx, rng, shade(GRASS, -28), 18);
  speckle(ctx, rng, shade(GRASS, 24), 12);
});

tile('grass_side', (ctx, rng) => {
  grain(ctx, rng, DIRT, 20);
  for (let x = 0; x < TILE; x++) {
    const depth = 3 + Math.floor(rng() * 3);
    for (let y = 0; y < depth; y++) px(ctx, x, y, shade(GRASS, (rng() - 0.5) * 30));
  }
});

tile('cobblestone', (ctx, rng) => {
  grain(ctx, rng, shade(STONE, -22), 8);
  const cells = [
    [0, 0, 7, 6], [8, 0, 8, 4], [0, 7, 5, 5], [6, 5, 5, 6],
    [12, 5, 4, 7], [0, 13, 8, 3], [9, 12, 7, 4],
  ];
  for (const [x, y, w, h] of cells) {
    const tone = shade(STONE, (rng() - 0.4) * 34);
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) px(ctx, x + i, y + j, shade(tone, (rng() - 0.5) * 16));
    }
  }
});

tile('mossy_cobblestone', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  for (let i = 0; i < 60; i++) {
    if (rng() < 0.5) continue;
    px(ctx, Math.floor(rng() * TILE), Math.floor(rng() * TILE), shade([70, 120, 60], (rng() - 0.5) * 30));
  }
});

tile('sand', (ctx, rng) => {
  grain(ctx, rng, SAND, 12);
  speckle(ctx, rng, shade(SAND, -22), 10);
});

tile('sandstone_top', (ctx, rng) => grain(ctx, rng, shade(SAND, -6), 8));

tile('sandstone_side', (ctx, rng) => {
  grain(ctx, rng, shade(SAND, -6), 8);
  for (let y = 3; y < TILE; y += 5) rect(ctx, 0, y, TILE, 1, shade(SAND, -34));
});

tile('gravel', (ctx, rng) => {
  grain(ctx, rng, shade(STONE, -14), 22);
  for (let i = 0; i < 14; i++) {
    blob(ctx, rng, Math.floor(rng() * TILE), Math.floor(rng() * TILE), 1, shade(STONE, (rng() - 0.5) * 60));
  }
});

tile('bedrock', (ctx, rng) => {
  grain(ctx, rng, [70, 70, 74], 26);
  speckle(ctx, rng, [30, 30, 34], 26);
});

tile('water', (ctx, rng) => {
  grain(ctx, rng, WATER, 10);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if ((x + y * 2) % 7 === 0) px(ctx, x, y, shade(WATER, 22));
    }
  }
});

tile('snow', (ctx, rng) => grain(ctx, rng, SNOW_C, 8));

tile('ice', (ctx, rng) => {
  grain(ctx, rng, [150, 190, 235], 10);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * TILE);
    for (let y = 0; y < TILE; y++) if (rng() < 0.4) px(ctx, x, y, shade([190, 220, 250], 0));
  }
});

// --- wood --------------------------------------------------------------------

function barkTile(base: Color): Draw {
  return (ctx, rng) => {
    grain(ctx, rng, base, 14);
    for (let x = 0; x < TILE; x++) {
      if (rng() < 0.35) {
        for (let y = 0; y < TILE; y++) px(ctx, x, y, shade(base, -26 + (rng() - 0.5) * 14));
      }
    }
  };
}

function logTopTile(base: Color): Draw {
  return (ctx, rng) => {
    grain(ctx, rng, WOOD, 10);
    for (let r = 7; r > 0; r -= 2) {
      for (let a = 0; a < 64; a++) {
        const angle = (a / 64) * Math.PI * 2;
        const x = Math.round(7.5 + Math.cos(angle) * r);
        const y = Math.round(7.5 + Math.sin(angle) * r);
        px(ctx, x, y, shade(base, -20));
      }
    }
  };
}

tile('oak_log_side', barkTile(BARK));
tile('oak_log_top', logTopTile(BARK));
tile('birch_log_side', (ctx, rng) => {
  grain(ctx, rng, [222, 220, 208], 8);
  for (let i = 0; i < 8; i++) {
    const y = Math.floor(rng() * TILE);
    rect(ctx, Math.floor(rng() * 10), y, 3 + Math.floor(rng() * 4), 1, [60, 58, 52]);
  }
});
tile('birch_log_top', logTopTile([190, 186, 172]));
tile('spruce_log_side', barkTile([78, 56, 34]));
tile('spruce_log_top', logTopTile([120, 88, 56]));

function leafTile(base: Color): Draw {
  return (ctx, rng) => {
    ctx.clearRect(0, 0, TILE, TILE);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        // Small gaps make canopies read as foliage rather than solid blocks.
        if (rng() < 0.12) continue;
        px(ctx, x, y, shade(base, (rng() - 0.5) * 46));
      }
    }
  };
}

tile('oak_leaves', leafTile(LEAF));
tile('birch_leaves', leafTile(BIRCH_LEAF));
tile('spruce_leaves', leafTile(SPRUCE_LEAF));

tile('oak_planks', (ctx, rng) => {
  grain(ctx, rng, WOOD, 12);
  for (let y = 0; y < TILE; y += 4) {
    rect(ctx, 0, y, TILE, 1, shade(WOOD, -40));
    const knot = Math.floor(rng() * TILE);
    px(ctx, knot, y + 2, shade(WOOD, -26));
  }
});

// --- ores --------------------------------------------------------------------

function oreTile(color: Color, count = 5): Draw {
  return (ctx, rng) => {
    drawings.get('stone')!(ctx, rng);
    for (let i = 0; i < count; i++) {
      blob(ctx, rng, 2 + Math.floor(rng() * 12), 2 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 2), color);
    }
  };
}

tile('coal_ore', oreTile([38, 38, 38]));
tile('iron_ore', oreTile([196, 150, 110]));
tile('gold_ore', oreTile([236, 200, 70]));
tile('diamond_ore', oreTile([110, 226, 226], 4));
tile('emerald_ore', oreTile([70, 210, 110], 4));

// --- crafted blocks ----------------------------------------------------------

tile('glass', (ctx) => {
  ctx.clearRect(0, 0, TILE, TILE);
  rect(ctx, 0, 0, TILE, TILE, [210, 235, 245], 0.22);
  rect(ctx, 0, 0, TILE, 1, [235, 250, 255], 0.85);
  rect(ctx, 0, TILE - 1, TILE, 1, [235, 250, 255], 0.85);
  rect(ctx, 0, 0, 1, TILE, [235, 250, 255], 0.85);
  rect(ctx, TILE - 1, 0, 1, TILE, [235, 250, 255], 0.85);
  rect(ctx, 3, 3, 4, 1, [255, 255, 255], 0.5);
});

tile('crafting_table_top', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  rect(ctx, 0, 0, TILE, 2, shade(WOOD, -50));
  for (let i = 4; i < TILE; i += 5) {
    rect(ctx, i, 2, 1, TILE - 2, shade(WOOD, -46));
    rect(ctx, 2, i, TILE - 2, 1, shade(WOOD, -46));
  }
});

tile('crafting_table_side', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  rect(ctx, 2, 5, 5, 4, shade(WOOD, -40));
  rect(ctx, 9, 8, 5, 5, shade(WOOD, -30));
});

tile('furnace_top', (ctx, rng) => {
  drawings.get('stone')!(ctx, rng);
  rect(ctx, 3, 3, 10, 10, shade(STONE, -26));
});

tile('furnace_front', (ctx, rng) => {
  drawings.get('stone')!(ctx, rng);
  rect(ctx, 3, 6, 10, 8, [48, 44, 42]);
  rect(ctx, 4, 10, 8, 3, [186, 92, 32]);
  rect(ctx, 5, 12, 6, 1, [232, 174, 62]);
  rect(ctx, 2, 2, 12, 2, shade(STONE, -34));
});

tile('chest_top', (ctx, rng) => {
  grain(ctx, rng, [140, 100, 54], 12);
  rect(ctx, 0, 0, TILE, 1, [92, 62, 30]);
  rect(ctx, 0, TILE - 1, TILE, 1, [92, 62, 30]);
});

tile('chest_side', (ctx, rng) => {
  grain(ctx, rng, [140, 100, 54], 12);
  rect(ctx, 0, 6, TILE, 2, [92, 62, 30]);
  rect(ctx, 6, 6, 4, 4, [206, 178, 88]);
  rect(ctx, 7, 7, 2, 2, [70, 56, 24]);
});

tile('stone_bricks', (ctx, rng) => {
  grain(ctx, rng, shade(STONE, -8), 10);
  for (let y = 0; y < TILE; y += 4) {
    rect(ctx, 0, y, TILE, 1, shade(STONE, -40));
    const offset = (y / 4) % 2 === 0 ? 0 : 8;
    rect(ctx, offset, y, 1, 4, shade(STONE, -40));
    rect(ctx, (offset + 8) % TILE, y, 1, 4, shade(STONE, -40));
  }
});

tile('wool', (ctx, rng) => {
  grain(ctx, rng, [238, 238, 238], 10);
  speckle(ctx, rng, [210, 210, 210], 24);
});

tile('bookshelf', (ctx, rng) => {
  drawings.get('oak_planks')!(ctx, rng);
  const colors: Color[] = [[168, 62, 52], [62, 96, 168], [86, 150, 76], [190, 150, 60]];
  for (const row of [2, 9]) {
    let x = 1;
    while (x < TILE - 1) {
      const w = 1 + Math.floor(rng() * 2);
      rect(ctx, x, row, w, 5, colors[Math.floor(rng() * colors.length)]);
      x += w + 1;
    }
  }
});

tile('farmland', (ctx, rng) => {
  grain(ctx, rng, shade(DIRT, -6), 14);
  for (let y = 1; y < TILE; y += 5) rect(ctx, 0, y, TILE, 2, shade(DIRT, -30));
});

tile('farmland_wet', (ctx, rng) => {
  grain(ctx, rng, shade(DIRT, -34), 12);
  for (let y = 1; y < TILE; y += 5) rect(ctx, 0, y, TILE, 2, shade(DIRT, -56));
});

tile('dirt_path_top', (ctx, rng) => {
  grain(ctx, rng, shade(DIRT, 16), 12);
  rect(ctx, 0, 0, TILE, 1, shade(DIRT, -20));
  rect(ctx, 0, TILE - 1, TILE, 1, shade(DIRT, -20));
});

// A length of rail, as it looks in the hand: a crossing rather than a straight run, so
// that a stack of it reads as track from any angle in a hotbar slot.
const RAIL_STEEL: Color = [176, 180, 188];
const RAIL_TIE: Color = [96, 72, 46];

tile('rail_top', (ctx, rng) => {
  drawings.get('gravel')!(ctx, rng);
  // Sleepers first, both ways, and thin: at two pixels they cover half the tile and the
  // block reads as a boardwalk with the track lost somewhere in it.
  for (let i = 2; i < TILE; i += 4) {
    rect(ctx, i, 0, 1, TILE, shade(RAIL_TIE, (rng() - 0.5) * 20));
    rect(ctx, 0, i, TILE, 1, shade(RAIL_TIE, (rng() - 0.5) * 20));
  }
  // Then the steel over the top of them, wide enough and bright enough to be what the
  // eye lands on.
  for (const at of [3, TILE - 5]) {
    rect(ctx, at, 0, 2, TILE, RAIL_STEEL);
    rect(ctx, 0, at, TILE, 2, RAIL_STEEL);
    rect(ctx, at, 0, 1, TILE, shade(RAIL_STEEL, 34));
    rect(ctx, 0, at, TILE, 1, shade(RAIL_STEEL, 34));
  }
});

// The tool that lays the free-form track. It cannot borrow `rail_top`: a stack of rails
// and the thing that draws curves would then be the same picture in the hotbar, and they
// do entirely different jobs on the same mouse button.
tile('track_tool', (ctx) => {
  iconBase(ctx);
  // The same bottom-left to top-right handle every tool in the game has.
  for (let i = 0; i < 7; i++) rect(ctx, 2 + i, 13 - i, 2, 2, shade(BARK, 16));
  // A short length of track for a head, bending as it goes, because bending is the point.
  for (let j = 0; j < 7; j++) {
    const y = 2 + j;
    const x = 8 - Math.round((j * j) / 8);
    if (j % 2 === 0) rect(ctx, x, y, 7, 1, RAIL_TIE);
    rect(ctx, x, y, 1, 1, RAIL_STEEL);
    rect(ctx, x + 6, y, 1, 1, shade(RAIL_STEEL, 30));
  }
});

// The station, as it looks in the hand. A platform with a shelter over it and a crate
// standing on it: what it is for has to be readable in a hotbar slot, and "somewhere the
// goods wait" is the half of it a picture can carry.
tile('station', (ctx) => {
  iconBase(ctx);
  // the platform
  rect(ctx, 1, 11, 14, 3, shade(STONE, 8));
  rect(ctx, 1, 11, 14, 1, shade(STONE, 40));
  // posts and a roof over them
  rect(ctx, 3, 5, 1, 6, shade(BARK, 10));
  rect(ctx, 12, 5, 1, 6, shade(BARK, 10));
  rect(ctx, 2, 3, 12, 2, [168, 74, 58]);
  rect(ctx, 2, 3, 12, 1, [198, 96, 74]);
  // a crate waiting on it
  rect(ctx, 6, 7, 5, 4, [160, 122, 70]);
  rect(ctx, 6, 8, 5, 1, shade(RAIL_TIE, 10));
});

tile('cactus_top', (ctx, rng) => {
  grain(ctx, rng, [70, 132, 62], 12);
  blob(ctx, rng, 8, 8, 4, [92, 160, 78]);
});

tile('cactus_side', (ctx, rng) => {
  grain(ctx, rng, [70, 132, 62], 12);
  rect(ctx, 0, 0, 1, TILE, [50, 100, 46]);
  rect(ctx, TILE - 1, 0, 1, TILE, [50, 100, 46]);
  for (let y = 1; y < TILE; y += 4) {
    px(ctx, 3, y, [220, 220, 200]);
    px(ctx, 12, y + 2, [220, 220, 200]);
  }
});

// --- water works ---------------------------------------------------------------

tile('spring_top', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  blob(ctx, rng, 8, 8, 5, [70, 130, 210]);
  blob(ctx, rng, 8, 8, 2, [140, 200, 240]);
});

tile('spring_side', (ctx, rng) => {
  drawings.get('cobblestone')!(ctx, rng);
  for (let y = 4; y < TILE; y += 5) rect(ctx, 3, y, 10, 2, [70, 130, 210]);
});

tile('pump_top', (ctx, rng) => {
  grain(ctx, rng, [150, 150, 158], 10);
  blob(ctx, rng, 8, 8, 4, [96, 96, 104]);
  blob(ctx, rng, 8, 8, 2, [58, 110, 178]);
});

tile('pump_side', (ctx, rng) => {
  grain(ctx, rng, [150, 150, 158], 10);
  rect(ctx, 0, 3, TILE, 2, [104, 104, 112]);
  rect(ctx, 0, 11, TILE, 2, [104, 104, 112]);
  rect(ctx, 6, 5, 4, 6, [72, 72, 80]);
});

tile('drain_top', (ctx, rng) => {
  grain(ctx, rng, [122, 122, 130], 10);
  for (let i = 3; i < TILE - 2; i += 3) rect(ctx, i, 3, 2, TILE - 6, [40, 44, 52]);
});

tile('floodgate_closed', (ctx, rng) => {
  grain(ctx, rng, WOOD, 10);
  rect(ctx, 0, 0, TILE, 2, [120, 120, 128]);
  rect(ctx, 0, TILE - 2, TILE, 2, [120, 120, 128]);
  for (let y = 3; y < TILE - 2; y += 4) rect(ctx, 1, y, TILE - 2, 2, shade(WOOD, -34));
  rect(ctx, 6, 6, 4, 4, [150, 150, 158]);
});

tile('floodgate_open', (ctx) => {
  ctx.clearRect(0, 0, TILE, TILE);
  // Only the frame remains once the gate is raised.
  rect(ctx, 0, 0, TILE, 3, [120, 120, 128]);
  rect(ctx, 0, TILE - 3, TILE, 3, shade(WOOD, -20));
  rect(ctx, 0, 0, 2, TILE, [120, 120, 128]);
  rect(ctx, TILE - 2, 0, 2, TILE, [120, 120, 128]);
});

// --- cross-shaped plants -----------------------------------------------------

function plantTile(draw: Draw): Draw {
  return (ctx, rng) => {
    ctx.clearRect(0, 0, TILE, TILE);
    draw(ctx, rng);
  };
}

tile('tall_grass', plantTile((ctx, rng) => {
  for (let x = 2; x < TILE - 1; x += 2) {
    const height = 6 + Math.floor(rng() * 6);
    for (let y = 0; y < height; y++) {
      px(ctx, x + (y > height - 3 ? (rng() < 0.5 ? 1 : 0) : 0), TILE - 1 - y, shade(GRASS, (rng() - 0.5) * 40));
    }
  }
}));

tile('dead_bush', plantTile((ctx, rng) => {
  const base: Color = [122, 92, 46];
  for (let x = 3; x < TILE - 2; x += 3) {
    const height = 5 + Math.floor(rng() * 5);
    for (let y = 0; y < height; y++) px(ctx, x, TILE - 1 - y, shade(base, (rng() - 0.5) * 30));
    px(ctx, x - 1, TILE - height, shade(base, -10));
    px(ctx, x + 1, TILE - height + 1, shade(base, -10));
  }
}));

function flowerTile(petal: Color): Draw {
  return plantTile((ctx, rng) => {
    for (let y = 0; y < 9; y++) px(ctx, 7, TILE - 1 - y, shade(GRASS, -14));
    px(ctx, 6, TILE - 5, shade(GRASS, -6));
    px(ctx, 9, TILE - 7, shade(GRASS, -6));
    for (let y = 2; y < 6; y++) {
      for (let x = 5; x < 11; x++) {
        if ((x === 5 || x === 10) && (y === 2 || y === 5)) continue;
        px(ctx, x, y, shade(petal, (rng() - 0.5) * 30));
      }
    }
    px(ctx, 7, 3, [250, 226, 120]);
    px(ctx, 8, 4, [250, 226, 120]);
  });
}

tile('flower_red', flowerTile([196, 62, 54]));
tile('flower_yellow', flowerTile([232, 200, 62]));

tile('sugar_cane', plantTile((ctx, rng) => {
  for (let x = 5; x < 11; x++) {
    for (let y = 0; y < TILE; y++) px(ctx, x, y, shade([124, 186, 116], (rng() - 0.5) * 24));
  }
  for (let y = 3; y < TILE; y += 5) rect(ctx, 5, y, 6, 1, [96, 150, 90]);
}));

tile('torch', plantTile((ctx, rng) => {
  for (let y = 6; y < TILE; y++) rect(ctx, 7, y, 2, 1, shade(BARK, (rng() - 0.5) * 20));
  rect(ctx, 7, 4, 2, 2, [240, 190, 70]);
  rect(ctx, 6, 5, 4, 1, [250, 220, 120]);
  px(ctx, 7, 3, [255, 246, 200]);
}));

function cropTile(stage: number, color: Color, ripe: Color): Draw {
  return plantTile((ctx, rng) => {
    const height = 3 + stage * 4;
    for (let x = 2; x < TILE; x += 4) {
      for (let y = 0; y < height; y++) {
        px(ctx, x, TILE - 1 - y, shade(stage === 3 ? ripe : color, (rng() - 0.5) * 26));
      }
      if (stage >= 2) {
        px(ctx, x - 1, TILE - height, shade(stage === 3 ? ripe : color, -10));
        px(ctx, x + 1, TILE - height + 1, shade(stage === 3 ? ripe : color, -10));
      }
    }
  });
}

for (let stage = 0; stage < 4; stage++) {
  tile(`wheat_${stage}`, cropTile(stage, [110, 160, 70], [214, 188, 84]));
  tile(`carrots_${stage}`, cropTile(stage, [76, 150, 66], [232, 140, 50]));
  tile(`potatoes_${stage}`, cropTile(stage, [84, 148, 70], [198, 170, 96]));
}

// --- item icons ---------------------------------------------------------------

function iconBase(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, TILE, TILE);
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
  rect(ctx, 6, 4, 4, 1, c);
  rect(ctx, 5, 5, 6, 2, c);
  rect(ctx, 4, 7, 8, 2, shade(c, -20));
  rect(ctx, 6, 9, 4, 2, shade(c, -40));
  rect(ctx, 7, 11, 2, 1, shade(c, -60));
});
tile('emerald', (ctx) => {
  iconBase(ctx);
  const c: Color = [70, 214, 116];
  rect(ctx, 5, 4, 6, 8, c);
  rect(ctx, 4, 6, 8, 4, c);
  rect(ctx, 6, 5, 2, 3, shade(c, 40));
});

function ingot(color: Color): Draw {
  return (ctx) => {
    iconBase(ctx);
    rect(ctx, 4, 7, 8, 4, color);
    rect(ctx, 5, 6, 6, 1, shade(color, 30));
    rect(ctx, 4, 11, 8, 1, shade(color, -40));
  };
}

tile('iron_ingot', ingot([214, 214, 214]));
tile('gold_ingot', ingot([238, 202, 74]));

tile('bucket', (ctx) => {
  iconBase(ctx);
  const metal: Color = [186, 186, 194];
  rect(ctx, 4, 5, 8, 1, metal);
  rect(ctx, 4, 6, 8, 7, shade(metal, -18));
  rect(ctx, 5, 13, 6, 1, shade(metal, -40));
  rect(ctx, 4, 3, 1, 3, shade(metal, -30));
  rect(ctx, 11, 3, 1, 3, shade(metal, -30));
  rect(ctx, 5, 2, 6, 1, shade(metal, -30));
});

tile('water_bucket', (ctx, rng) => {
  drawings.get('bucket')!(ctx, rng);
  for (let y = 7; y < 12; y++) {
    for (let x = 5; x < 11; x++) px(ctx, x, y, shade(WATER, (rng() - 0.5) * 24));
  }
});

tile('stick', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 9; i++) rect(ctx, 4 + i, 11 - i, 2, 2, shade(BARK, 20));
});

tile('leather', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px(ctx, x, y, shade([168, 122, 78], (rng() - 0.5) * 22));
});

tile('feather', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 10; i++) rect(ctx, 5 + Math.floor(i / 2), 12 - i, 2, 1, [240, 240, 240]);
  rect(ctx, 6, 5, 4, 4, [225, 228, 235]);
});

tile('wheat_item', (ctx, rng) => {
  iconBase(ctx);
  for (const x of [5, 8, 11]) {
    for (let y = 3; y < 13; y++) px(ctx, x, y, shade([214, 188, 84], (rng() - 0.5) * 24));
    px(ctx, x - 1, 5, [196, 168, 70]);
    px(ctx, x + 1, 7, [196, 168, 70]);
  }
});

tile('wheat_seeds', (ctx, rng) => {
  iconBase(ctx);
  for (let i = 0; i < 6; i++) {
    px(ctx, 5 + Math.floor(rng() * 6), 6 + Math.floor(rng() * 5), [150, 170, 96]);
  }
});

tile('bread', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 5; y < 11; y++) {
    for (let x = 3; x < 13; x++) px(ctx, x, y, shade([196, 142, 72], (rng() - 0.5) * 24));
  }
  rect(ctx, 4, 5, 8, 1, [222, 176, 100]);
});

tile('apple', (ctx) => {
  iconBase(ctx);
  rect(ctx, 4, 5, 8, 7, [200, 52, 46]);
  rect(ctx, 5, 4, 6, 1, [200, 52, 46]);
  rect(ctx, 5, 6, 2, 2, [236, 130, 120]);
  rect(ctx, 8, 2, 1, 3, [96, 68, 36]);
  rect(ctx, 9, 2, 2, 1, [84, 152, 60]);
});

tile('carrot', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 8; i++) rect(ctx, 5 + Math.floor(i / 3), 12 - i, 4 - Math.floor(i / 3), 1, [232, 132, 44]);
  rect(ctx, 6, 3, 4, 2, [86, 160, 62]);
});

tile('potato', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) px(ctx, x, y, shade([196, 168, 96], (rng() - 0.5) * 26));
});

tile('baked_potato', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) px(ctx, x, y, shade([168, 126, 62], (rng() - 0.5) * 26));
  px(ctx, 7, 7, [230, 210, 150]);
});

function meatTile(raw: boolean, tint: Color): Draw {
  return (ctx, rng) => {
    iconBase(ctx);
    const base = raw ? tint : shade(tint, -34);
    for (let y = 4; y < 12; y++) {
      for (let x = 3; x < 13; x++) {
        if ((x === 3 || x === 12) && (y === 4 || y === 11)) continue;
        px(ctx, x, y, shade(base, (rng() - 0.5) * 26));
      }
    }
    rect(ctx, 5, 6, 3, 2, shade(base, raw ? 40 : 20));
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
    for (let i = 0; i < 9; i++) rect(ctx, 4 + i, 12 - i, 2, 2, shade(BARK, 16));
    switch (kind) {
      case 'pickaxe':
        rect(ctx, 5, 3, 8, 2, head);
        rect(ctx, 4, 4, 2, 2, head);
        rect(ctx, 12, 4, 2, 2, head);
        break;
      case 'axe':
        rect(ctx, 8, 2, 5, 5, head);
        rect(ctx, 7, 3, 1, 3, head);
        break;
      case 'shovel':
        rect(ctx, 9, 2, 4, 5, head);
        break;
      case 'hoe':
        rect(ctx, 8, 2, 6, 2, head);
        rect(ctx, 8, 4, 2, 2, head);
        break;
      default:
        rect(ctx, 5, 2, 3, 3, head);
        rect(ctx, 6, 4, 3, 3, head);
        rect(ctx, 7, 6, 3, 3, head);
        rect(ctx, 3, 10, 5, 2, shade(BARK, -20));
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
        rect(ctx, 3, 4, 10, 4, color);
        rect(ctx, 3, 8, 3, 3, color);
        rect(ctx, 10, 8, 3, 3, color);
        break;
      case 'chestplate':
        rect(ctx, 3, 3, 10, 9, color);
        rect(ctx, 6, 3, 4, 3, shade(color, -50));
        break;
      case 'leggings':
        rect(ctx, 4, 3, 8, 4, color);
        rect(ctx, 4, 7, 3, 6, color);
        rect(ctx, 9, 7, 3, 6, color);
        break;
      default:
        rect(ctx, 3, 7, 4, 5, color);
        rect(ctx, 9, 7, 4, 5, color);
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
    cellCtx.imageSmoothingEnabled = false;
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
