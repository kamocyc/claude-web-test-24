import * as THREE from 'three';
import { mulberry32, type Rng } from '../core/rng';

/** Every block and item texture is drawn procedurally into one atlas at start-up,
 *  which keeps the game a single self-contained bundle with no image assets. */

/** Texels across one block face. Materials are drawn at this resolution; the item and
 *  tool icons are pixel art laid out on a 16-unit grid and scaled up to fill a tile. */
export const TILE = 32;
/** The grid the pixel-art icons are drawn on. */
const ART = 16;
const ART_SCALE = TILE / ART;
export const ATLAS_COLS = 16;

export interface TileUv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

type Draw = (ctx: CanvasRenderingContext2D, rng: Rng) => void;

interface Drawing {
  draw: Draw;
  /** Drawn on the 16-unit icon grid and scaled up, rather than at full resolution. */
  pixelArt: boolean;
}

const drawings = new Map<string, Drawing>();

/** Registers a material drawn at the full texel resolution of a block face. The
 *  callback runs once, at start-up, so a material can build its noise and cell fields
 *  up front and hold on to them. */
function tile(name: string, make: () => Draw): void {
  drawings.set(name, { draw: make(), pixelArt: false });
}

/** Registers an icon drawn on the 16-unit grid, scaled up to fill the tile. */
function artTile(name: string, draw: Draw): void {
  drawings.set(name, { draw, pixelArt: true });
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

// --- material drawing ----------------------------------------------------------

/** Surface coordinate: 0..1 across the face, y measured from the top. */
type Sampler = (x: number, y: number, periodX: number, periodY?: number) => number;

function hashLattice(xi: number, yi: number, px: number, py: number, seed: number): number {
  const x = ((xi % px) + px) % px;
  const y = ((yi % py) + py) % py;
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seamless value noise. The lattice wraps at the edge of the tile, so two neighbouring
 *  blocks of the same material meet without a seam. That is the whole reason these
 *  textures can carry structure larger than a texel: repeating noise that did not tile
 *  would draw a grid over the landscape. Separate periods per axis let a material be
 *  stretched along one direction, which is what wood grain and grass blades need. */
function noiseField(seed: number): Sampler {
  return (x, y, periodX, periodY = periodX) => {
    const fx = x * periodX;
    const fy = y * periodY;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const a = hashLattice(x0, y0, periodX, periodY, seed);
    const b = hashLattice(x0 + 1, y0, periodX, periodY, seed);
    const c = hashLattice(x0, y0 + 1, periodX, periodY, seed);
    const d = hashLattice(x0 + 1, y0 + 1, periodX, periodY, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  };
}

/** Octaves of the same field, each at twice the frequency and half the weight. */
function fbm(field: Sampler, x: number, y: number, period: number, octaves = 3): number {
  let total = 0;
  let amplitude = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const step = period << octave;
    total += amplitude * field(x, y, step);
    norm += amplitude;
    amplitude *= 0.5;
  }
  return total / norm;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(a: Color, b: Color, t: number): Color {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** A pixel of a material: a colour, optionally with coverage, or nothing at all. */
type Texel = Color | [number, number, number, number] | null;

/** Fills the tile from a function of the surface coordinate. */
function paint(ctx: CanvasRenderingContext2D, sample: (x: number, y: number) => Texel): void {
  const image = ctx.createImageData(TILE, TILE);
  for (let row = 0; row < TILE; row++) {
    for (let column = 0; column < TILE; column++) {
      const texel = sample((column + 0.5) / TILE, (row + 0.5) / TILE);
      const i = (row * TILE + column) * 4;
      if (!texel) continue;
      image.data[i] = texel[0];
      image.data[i + 1] = texel[1];
      image.data[i + 2] = texel[2];
      image.data[i + 3] = texel.length > 3 ? (texel[3] as number) : 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Draws over whatever is already in the tile, leaving it alone where the sample
 *  returns nothing. Used by the materials that dress up another one. */
function overlay(ctx: CanvasRenderingContext2D, sample: (x: number, y: number) => Texel): void {
  const image = ctx.getImageData(0, 0, TILE, TILE);
  for (let row = 0; row < TILE; row++) {
    for (let column = 0; column < TILE; column++) {
      const texel = sample((column + 0.5) / TILE, (row + 0.5) / TILE);
      if (!texel) continue;
      const i = (row * TILE + column) * 4;
      const alpha = texel.length > 3 ? (texel[3] as number) / 255 : 1;
      image.data[i] = lerp(image.data[i], texel[0], alpha);
      image.data[i + 1] = lerp(image.data[i + 1], texel[1], alpha);
      image.data[i + 2] = lerp(image.data[i + 2], texel[2], alpha);
      image.data[i + 3] = Math.max(image.data[i + 3], alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
}

interface Cell {
  /** Which stone this pixel belongs to. */
  id: number;
  /** 0 deep inside a stone, 1 on the seam between two. */
  seam: number;
  /** Offset from the stone's centre, for shading it like a dome. */
  dx: number;
  dy: number;
}

/** A wrapping field of jittered cell centres — cobbles, gravel, wool tufts. Nearest
 *  centre wins, and the gap to the runner-up is how close the pixel is to a seam. */
function cellField(seed: number, count: number): (x: number, y: number) => Cell {
  const centres: [number, number][] = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const jx = hashLattice(i, j, count, count, seed);
      const jy = hashLattice(i, j, count, count, seed ^ 0x9e3779b9);
      centres.push([(i + 0.2 + jx * 0.6) / count, (j + 0.2 + jy * 0.6) / count]);
    }
  }
  return (x, y) => {
    let id = 0;
    let best = Infinity;
    let second = Infinity;
    let bdx = 0;
    let bdy = 0;
    for (let k = 0; k < centres.length; k++) {
      let dx = x - centres[k][0];
      let dy = y - centres[k][1];
      // The nearest copy across the wrap, so the pattern joins up at the tile edge.
      if (dx > 0.5) dx -= 1;
      else if (dx < -0.5) dx += 1;
      if (dy > 0.5) dy -= 1;
      else if (dy < -0.5) dy += 1;
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        second = best;
        best = distance;
        id = k;
        bdx = dx;
        bdy = dy;
      } else if (distance < second) {
        second = distance;
      }
    }
    const gap = Math.sqrt(second) - Math.sqrt(best);
    return { id, seam: 1 - Math.min(1, gap * count * 1.5), dx: bdx * count, dy: bdy * count };
  };
}

/** Per-cell variation from its index, in -1..1. */
function cellTone(id: number, seed: number): number {
  return hashLattice(id, seed, 4096, 4096, 0x2545f4) * 2 - 1;
}

// --- terrain -------------------------------------------------------------------

const STONE: Color = [166, 171, 186];
const DIRT: Color = [170, 128, 94];
const GRASS: Color = [124, 200, 108];
const GRASS_DEEP: Color = [92, 172, 92];
const SAND: Color = [243, 226, 174];
const WOOD: Color = [209, 174, 126];
const BARK: Color = [150, 116, 84];
const LEAF: Color = [112, 192, 102];
const SPRUCE_LEAF: Color = [92, 162, 118];
const BIRCH_LEAF: Color = [164, 214, 118];
const WATER: Color = [96, 172, 240];
const SNOW_C: Color = [234, 241, 252];

tile('stone', () => {
  const field = noiseField(0x51a2);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Broad tonal patches, fine grit, and a few thin darker seams running through.
      const patch = fbm(field, x, y, 3, 3);
      const grit = field(x, y, 16);
      const seam = Math.abs(fbm(field, x + 0.37, y, 2, 2) - 0.5);
      let color = shade(STONE, (patch - 0.5) * 30 + (grit - 0.5) * 12);
      if (seam < 0.035) color = shade(color, -20 * (1 - seam / 0.035));
      return color;
    });
  };
});

tile('dirt', () => {
  const field = noiseField(0x1d17);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Clods of earth with darker hollows between them, and grit over the top.
      const clod = fbm(field, x, y, 3, 3);
      const grit = field(x, y, 20);
      let color = shade(DIRT, (clod - 0.5) * 46 + (grit - 0.5) * 16);
      if (clod < 0.36) color = shade(color, -20 * (1 - clod / 0.36));
      // Small stones lodged in the soil, each with a lit top edge.
      const pebble = field(x + 0.5, y + 0.21, 9);
      if (pebble > 0.84) {
        const set = Math.min(1, (pebble - 0.84) * 8);
        color = mixColor(color, shade(STONE, -6), set);
        if (field(x + 0.5, y + 0.24, 9) > pebble) color = shade(color, 10 * set);
      }
      return color;
    });
  };
});

tile('grass_top', () => {
  const field = noiseField(0x9a5c);
  const tufts = cellField(0x9a5d, 8);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Turf seen from above is tufts, not noise: a field of cells gives each clump a
      // body that catches the light on top and falls into shadow where two meet.
      const tuft = tufts(x, y);
      const clump = fbm(field, x, y, 4, 3);
      let color = mixColor(GRASS_DEEP, GRASS, clump * 0.55 + (1 - tuft.seam) * 0.45);
      color = shade(color, -(tuft.dx * 0.3 + tuft.dy * 0.7) * 12);
      color = shade(color, cellTone(tuft.id, 11) * 9);
      // Individual blades, drawn as short strokes running with the tuft.
      const blade = field(x, y, 26, 13);
      if (blade > 0.74) color = shade(color, (blade - 0.74) * 90);
      else if (blade < 0.2) color = shade(color, -14);
      // Deep shadow down in the thatch between clumps.
      return shade(color, -Math.pow(tuft.seam, 3) * 18);
    });
  };
});

tile('grass_side', () => {
  const field = noiseField(0x77b1);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // The turf hangs over the soil, deeper in some columns than others, with single
      // blades straggling well below the main fringe.
      const fringe = 0.26 + fbm(field, x, 0.5, 5, 2) * 0.18;
      const strand = field(x, 0.5, 26, 1);
      const reach = fringe + (strand > 0.66 ? (strand - 0.66) * 0.75 : 0);
      if (y < reach) {
        const depth = y / Math.max(reach, 1e-4);
        // Lit along the top, darkening down into the roots.
        let color = mixColor(GRASS, GRASS_DEEP, Math.pow(depth, 0.7));
        color = shade(color, (field(x, y, 26, 10) - 0.5) * 22);
        if (y < 0.06) color = shade(color, 16);
        return color;
      }
      const clump = fbm(field, x, y, 4, 3);
      let soil = shade(DIRT, (clump - 0.5) * 36 + (field(x, y, 20) - 0.5) * 14);
      // The soil is in the turf's shadow just under the fringe.
      if (y < reach + 0.1) soil = shade(soil, -26 * (1 - (y - reach) / 0.1));
      const pebble = field(x + 0.5, y + 0.21, 11);
      if (pebble > 0.88) soil = mixColor(soil, shade(STONE, -14), (pebble - 0.88) * 6);
      return soil;
    });
  };
});

/** Rounded stones packed against each other, each shaded like a little dome and set
 *  into darker mortar. The dome shading is what separates cobble from grey noise. */
function cobbleTile(base: Color, count: number, roughness: number): () => Draw {
  return () => {
    const cells = cellField(0xc0b1 + count, count);
    const field = noiseField(0x3f21);
    return (ctx: CanvasRenderingContext2D) => {
      paint(ctx, (x, y) => {
        const cell = cells(x, y);
        const tone = cellTone(cell.id, 7) * roughness;
        let color = shade(base, tone);
        // Lit from above and to the left, so each stone reads as raised.
        const lift = -(cell.dx * 0.45 + cell.dy * 0.75);
        color = shade(color, lift * 26);
        color = shade(color, (field(x, y, 24) - 0.5) * 12);
        // Mortar in the gaps.
        return mixColor(color, shade(base, -46), Math.pow(cell.seam, 2.2) * 0.9);
      });
    };
  };
}

tile('cobblestone', cobbleTile(shade(STONE, -12), 4, 26));

tile('mossy_cobblestone', () => {
  const draw = cobbleTile(shade(STONE, -12), 4, 26)();
  const field = noiseField(0x5a13);
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    draw(ctx, rng);
    overlay(ctx, (x, y) => {
      const moss = fbm(field, x, y, 3, 3);
      if (moss < 0.44) return null;
      // Darker in the mortar where damp collects, brighter on the exposed stone.
      const green = shade(mixColor([64, 118, 62], GRASS_DEEP, moss), (field(x, y, 20) - 0.5) * 22);
      return [green[0], green[1], green[2], Math.min(255, (moss - 0.44) * 460)];
    });
  };
});

tile('sand', () => {
  const field = noiseField(0x5a4d);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Wind ripples: an integer number of them across the tile so they still join up.
      const drift = fbm(field, x, y, 3, 2) - 0.5;
      const ripple = Math.sin((y * 4 + drift * 1.6) * Math.PI * 2);
      let color = shade(SAND, ripple * 7 + (field(x, y, 28) - 0.5) * 10);
      // The occasional glint of a coarser grain.
      if (field(x + 0.13, y, 26) > 0.93) color = shade(color, 18);
      return color;
    });
  };
});

tile('sandstone_top', () => {
  const field = noiseField(0x5a4e);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => shade(SAND, -8 + (fbm(field, x, y, 4, 3) - 0.5) * 18));
  };
});

tile('sandstone_side', () => {
  const field = noiseField(0x5a4f);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Bedding planes, sagging slightly as they cross the block.
      const wobble = (fbm(field, x, 0.5, 4, 2) - 0.5) * 0.03;
      const band = (y + wobble) * 4;
      const edge = Math.abs(band - Math.round(band));
      let color = shade(SAND, -8 + (fbm(field, x, y, 4, 3) - 0.5) * 14);
      if (edge < 0.09) color = shade(color, -26 * (1 - edge / 0.09));
      return color;
    });
  };
});

tile('gravel', cobbleTile(shade(STONE, -18), 7, 34));

tile('bedrock', () => {
  const cells = cellField(0xbedb, 5);
  const field = noiseField(0xbed0);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Jagged, unbreakable-looking facets rather than rounded stones.
      const cell = cells(x, y);
      const tone = cellTone(cell.id, 3) * 30;
      let color = shade([96, 96, 110], tone + (field(x, y, 18) - 0.5) * 22);
      // Hard facets rather than domes: the shading steps rather than rolling off.
      color = shade(color, Math.sign(-(cell.dx * 0.5 + cell.dy * 0.8)) * 20);
      return mixColor(color, [40, 40, 52], Math.pow(cell.seam, 2) * 0.9);
    });
  };
});

tile('water', () => {
  const field = noiseField(0x2233);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // A gentle swell. The surface shader animates on top of this, so it only has to
      // give the water some body rather than any particular pattern.
      const swell = fbm(field, x, y, 2, 3);
      const ripple = fbm(field, x + 0.4, y + 0.2, 4, 2);
      let color = shade(WATER, (swell - 0.5) * 22);
      // Broad, soft crests rather than sparkle: the surface shader supplies the glint.
      color = mixColor(color, [178, 218, 252], Math.max(0, ripple - 0.62) * 0.9);
      return mixColor(color, shade(WATER, -26), Math.max(0, 0.4 - ripple) * 0.7);
    });
  };
});

tile('snow', () => {
  const field = noiseField(0x50f0);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Snow has no colour of its own, so every bit of its form has to come from cool
      // shadow in the hollows. Left at paper white it blows out into a flat sheet.
      const drift = fbm(field, x, y, 3, 3);
      let color = mixColor([176, 196, 226], SNOW_C, Math.pow(drift, 0.7));
      // Wind-scoured ridges catch the light.
      if (drift > 0.72) color = mixColor(color, [255, 255, 255], (drift - 0.72) * 2.2);
      if (field(x, y, 30) > 0.95) color = [255, 255, 255];
      return color;
    });
  };
});

tile('ice', () => {
  const field = noiseField(0x1ce0);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const body = fbm(field, x, y, 3, 3);
      let color = mixColor([176, 216, 246], [214, 238, 255], body);
      // Fractures: the ridges of a noise field, thin and bright.
      const crack = Math.abs(fbm(field, x + 0.6, y + 0.2, 3, 3) - 0.5);
      if (crack < 0.045) color = mixColor(color, [246, 253, 255], 1 - crack / 0.045);
      return color;
    });
  };
});

// --- wood ----------------------------------------------------------------------

/** Bark: fibres running the length of the trunk, split by deeper grooves. */
function barkTile(base: Color): () => Draw {
  return () => {
    const field = noiseField(base[0] * 131 + 7);
    return (ctx: CanvasRenderingContext2D) => {
      paint(ctx, (x, y) => {
        const fibre = fbm(field, x, y, 8, 2);
        const stretched = field(x, y, 10, 3);
        let color = shade(base, (fibre - 0.5) * 26 + (stretched - 0.5) * 16);
        const groove = Math.abs(field(x, y, 6, 2) - 0.5);
        if (groove < 0.07) color = shade(color, -30 * (1 - groove / 0.07));
        return color;
      });
    };
  };
}

/** The cut end of a log: rings around an off-centre heart. */
function logTopTile(base: Color): () => Draw {
  return () => {
    const field = noiseField(base[1] * 977 + 3);
    return (ctx: CanvasRenderingContext2D) => {
      paint(ctx, (x, y) => {
        const dx = x - 0.5;
        const dy = y - 0.5;
        const radius = Math.hypot(dx, dy) + (fbm(field, x, y, 4, 2) - 0.5) * 0.05;
        const ring = Math.abs(Math.sin(radius * Math.PI * 11));
        let color = shade(WOOD, (ring - 0.5) * 22 + (field(x, y, 24) - 0.5) * 10);
        // Bark still wrapped around the outside.
        const rim = Math.max(Math.abs(dx), Math.abs(dy));
        if (rim > 0.41) color = mixColor(color, base, Math.min(1, (rim - 0.41) * 14));
        return color;
      });
    };
  };
}

tile('oak_log_side', barkTile(BARK));
tile('oak_log_top', logTopTile(BARK));
tile('birch_log_side', () => {
  const field = noiseField(0xb12c);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      let color = shade([232, 228, 214], (fbm(field, x, y, 6, 2) - 0.5) * 14);
      // Birch's dark lenticel dashes.
      const dash = field(x, y, 3, 7);
      if (dash > 0.86) color = mixColor(color, [70, 66, 62], Math.min(1, (dash - 0.86) * 8));
      return color;
    });
  };
});
tile('birch_log_top', logTopTile([206, 200, 186]));
tile('spruce_log_side', barkTile([104, 76, 52]));
tile('spruce_log_top', logTopTile([138, 102, 66]));

/** Leaves: overlapping clusters with real gaps punched through them, so the canopy
 *  has depth instead of being a solid green cube with speckles. */
function leafTile(base: Color): () => Draw {
  return () => {
    const field = noiseField(base[1] * 613 + 11);
    return (ctx: CanvasRenderingContext2D) => {
      paint(ctx, (x, y) => {
        const canopy = fbm(field, x, y, 5, 3);
        if (canopy < 0.34) return null;
        const cluster = fbm(field, x + 0.3, y + 0.7, 7, 2);
        let color = mixColor(shade(base, -34), shade(base, 16), cluster);
        // A darker line where one leaf laps over the next.
        if (canopy < 0.42) color = shade(color, -26);
        color = shade(color, (field(x, y, 28) - 0.5) * 14);
        return color;
      });
    };
  };
}

tile('oak_leaves', leafTile(LEAF));
tile('birch_leaves', leafTile(BIRCH_LEAF));
tile('spruce_leaves', leafTile(SPRUCE_LEAF));

tile('oak_planks', () => {
  const field = noiseField(0x91a4);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const board = Math.floor(y * 4);
      const withinBoard = y * 4 - board;
      // Each board is sawn from a different part of the tree.
      const tone = hashLattice(board, 0, 4, 1, 0x4d1) * 2 - 1;
      // Grain runs along the board, stretched hard across it.
      const grain = fbm(field, x + board * 0.37, y, 5, 1) * 0.6 + field(x, y, 14, 2) * 0.4;
      let color = shade(WOOD, tone * 20 + (grain - 0.5) * 34);
      // The shadowed gap between boards, and the lit top edge of the next one down.
      if (withinBoard > 0.88) color = shade(color, -46 * (withinBoard - 0.88) * 8.3);
      else if (withinBoard < 0.1) color = shade(color, 20);
      // Staggered end joints.
      const joint = (x + board * 0.31) * 2;
      if (Math.abs(joint - Math.round(joint)) < 0.03) color = shade(color, -26);
      return color;
    });
  };
});

// --- ores ----------------------------------------------------------------------

/** Stone with a scatter of mineral, each nugget faceted and rimmed so it reads as
 *  something set into the rock rather than painted on it. */
function oreTile(color: Color, count = 6): () => Draw {
  return () => {
    const stone = drawings.get('stone')!.draw;
    const cells = cellField(color[0] * 31 + count, 3);
    const field = noiseField(color[2] * 17 + 5);
    return (ctx: CanvasRenderingContext2D, rng: Rng) => {
      stone(ctx, rng);
      overlay(ctx, (x, y) => {
        const cell = cells(x, y);
        if (hashLattice(cell.id, 1, 4096, 4096, 0x77) > count / 9) return null;
        const distance = Math.hypot(cell.dx, cell.dy) + (fbm(field, x, y, 6, 2) - 0.5) * 0.5;
        if (distance > 0.62) return null;
        // A bright facet up and left, a dark rim down and right.
        const facet = -(cell.dx * 0.6 + cell.dy * 0.8);
        let out = shade(color, facet * 40);
        if (distance > 0.48) out = shade(out, -46);
        return out;
      });
    };
  };
}

tile('coal_ore', oreTile([58, 58, 62]));
tile('iron_ore', oreTile([206, 158, 116]));
tile('gold_ore', oreTile([244, 208, 78]));
tile('diamond_ore', oreTile([120, 234, 234], 4));
tile('emerald_ore', oreTile([78, 216, 118], 4));

// --- crafted blocks ------------------------------------------------------------

tile('glass', () => (ctx: CanvasRenderingContext2D) => {
  paint(ctx, (x, y) => {
    const edge = Math.min(x, y, 1 - x, 1 - y);
    // A pane: a bright frame, a diagonal catch of light, and nothing in between.
    if (edge < 0.055) return [226, 244, 252, 210];
    const streak = x + y * 0.55;
    if (streak > 0.62 && streak < 0.74) return [255, 255, 255, 54];
    if (streak > 0.82 && streak < 0.87) return [255, 255, 255, 34];
    return [214, 238, 248, 16];
  });
});

tile('crafting_table_top', () => {
  const planks = drawings.get('oak_planks')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      const edge = Math.min(x, y, 1 - x, 1 - y);
      if (edge < 0.07) return shade(BARK, -14);
      // The grid the recipe sits in.
      const cell = Math.abs(x * 3 - Math.round(x * 3)) < 0.035 || Math.abs(y * 3 - Math.round(y * 3)) < 0.035;
      return cell && edge > 0.09 ? shade(WOOD, -40) : null;
    });
  };
});

tile('crafting_table_side', () => {
  const planks = drawings.get('oak_planks')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      if (y < 0.2) return shade(BARK, -6);
      // Tools hung on the side.
      if (y > 0.34 && y < 0.68 && Math.abs(x - 0.32) < 0.05) return shade(BARK, -22);
      if (y > 0.3 && y < 0.42 && Math.abs(x - 0.32) < 0.13) return [176, 178, 190];
      if (y > 0.42 && y < 0.78 && Math.abs(x - 0.68) < 0.045) return shade(BARK, -22);
      return null;
    });
  };
});

tile('furnace_top', () => {
  const stone = drawings.get('stone')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    stone(ctx, rng);
    overlay(ctx, (x, y) => {
      const inset = Math.min(x, y, 1 - x, 1 - y);
      if (inset < 0.09) return null;
      // The open top of the firebox.
      return inset < 0.13 ? shade(STONE, -48) : shade(STONE, -22);
    });
  };
});

tile('furnace_front', () => {
  const stone = drawings.get('stone')!.draw;
  const field = noiseField(0xf1e0);
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    stone(ctx, rng);
    overlay(ctx, (x, y) => {
      if (y < 0.34 || y > 0.84 || x < 0.2 || x > 0.8) return null;
      const mouth = Math.min(x - 0.2, 0.8 - x, y - 0.34, 0.84 - y);
      if (mouth < 0.045) return shade(STONE, -52);
      // Embers, hottest at the base.
      const heat = fbm(field, x, y, 5, 2) * 0.5 + (y - 0.34) / 0.5;
      return mixColor([92, 44, 24], [255, 196, 90], Math.min(1, heat));
    });
  };
});

tile('chest_top', () => {
  const planks = drawings.get('oak_planks')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      const edge = Math.min(x, y, 1 - x, 1 - y);
      if (edge < 0.06) return shade([118, 82, 44], edge * 120 - 8);
      return Math.abs(x - 0.5) < 0.09 && y > 0.72 ? [206, 178, 88] : null;
    });
  };
});

tile('chest_side', () => {
  const planks = drawings.get('oak_planks')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      const edge = Math.min(x, y, 1 - x, 1 - y);
      if (edge < 0.06) return shade([118, 82, 44], edge * 120 - 8);
      // The band where the lid meets the body, and the lock plate.
      if (Math.abs(y - 0.42) < 0.045) return shade([118, 82, 44], -10);
      if (Math.abs(x - 0.5) < 0.1 && y > 0.36 && y < 0.56) {
        return Math.abs(x - 0.5) < 0.035 && y > 0.44 ? [74, 58, 26] : [206, 178, 88];
      }
      return null;
    });
  };
});

tile('stone_bricks', () => {
  const field = noiseField(0x8b1c);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const course = Math.floor(y * 4);
      // Every other course is offset by half a brick.
      const shifted = x + (course % 2 === 0 ? 0 : 0.25);
      const brick = Math.floor(shifted * 2);
      const withinY = y * 4 - course;
      const withinX = shifted * 2 - brick;
      const tone = hashLattice(brick, course, 2, 4, 0x51) * 2 - 1;
      let color = shade(STONE, tone * 16 + (fbm(field, x, y, 6, 2) - 0.5) * 16);
      // Lit on the top-left of each brick, shadowed into the mortar.
      color = shade(color, (0.5 - withinY) * 14 + (0.5 - withinX) * 6);
      const mortar = Math.min(withinX, 1 - withinX, withinY * 2, (1 - withinY) * 2);
      if (mortar < 0.07) color = shade(color, -42 * (1 - mortar / 0.07));
      return color;
    });
  };
});

tile('wool', () => {
  const cells = cellField(0x0011, 8);
  const field = noiseField(0x0012);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Soft tufts: cells with almost no seam, just gentle doming.
      const cell = cells(x, y);
      let color = shade([238, 236, 230], cellTone(cell.id, 5) * 8);
      color = shade(color, -(cell.dx * 0.4 + cell.dy * 0.7) * 12);
      return shade(color, (field(x, y, 24) - 0.5) * 8);
    });
  };
});

tile('bookshelf', () => {
  const planks = drawings.get('oak_planks')!.draw;
  const spines: Color[] = [
    [168, 62, 58], [64, 96, 168], [72, 140, 92], [186, 142, 54], [120, 74, 148], [186, 96, 56],
  ];
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      // Two shelves, with the plank showing above, between and below.
      if (y < 0.12 || y > 0.88 || (y > 0.46 && y < 0.56)) return null;
      const shelf = y < 0.5 ? 0 : 1;
      const slot = Math.floor(x * 7);
      const within = x * 7 - slot;
      const pick = Math.floor(hashLattice(slot, shelf, 7, 2, 0x33) * spines.length);
      const height = 0.02 + hashLattice(slot, shelf + 9, 7, 4, 0x39) * 0.05;
      const top = shelf === 0 ? 0.12 + height : 0.56 + height;
      const bottom = shelf === 0 ? 0.46 : 0.88;
      if (y < top || y > bottom) return shade(WOOD, -34);
      if (within < 0.09 || within > 0.91) return [46, 34, 26];
      const color = spines[pick];
      // A lighter band across each spine, like a title.
      const band = shelf === 0 ? 0.24 : 0.68;
      return Math.abs(y - band) < 0.02 ? shade(color, 40) : shade(color, (within - 0.5) * 26);
    });
  };
});

tile('farmland', () => {
  const field = noiseField(0xfa11);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Furrows drawn across the plot, raked into the soil.
      const furrow = Math.sin(y * Math.PI * 6 + (fbm(field, x, y, 3, 2) - 0.5) * 1.2);
      // Raked ridges: lit along the crest, shadowed in the trough.
      return shade(shade(DIRT, -6), furrow * 28 + (fbm(field, x, y, 6, 2) - 0.5) * 18);
    });
  };
});

tile('farmland_wet', () => {
  const field = noiseField(0xfa12);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const furrow = Math.sin(y * Math.PI * 6 + (fbm(field, x, y, 3, 2) - 0.5) * 1.2);
      const soaked = mixColor(shade(DIRT, -40), [86, 62, 44], fbm(field, x, y, 4, 2));
      let color = shade(soaked, furrow * 12);
      // Water standing in the low points.
      if (furrow < -0.6) color = mixColor(color, [70, 92, 108], 0.45);
      return color;
    });
  };
});

tile('dirt_path_top', () => {
  const field = noiseField(0xda11);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Trodden flat: lighter and smoother in the middle where feet fall.
      const worn = 1 - Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 1.7);
      let color = shade(DIRT, 10 + worn * 14 + (fbm(field, x, y, 5, 3) - 0.5) * 20);
      if (field(x, y, 14) > 0.9) color = shade(color, -18);
      return color;
    });
  };
});

tile('cactus_top', () => {
  const field = noiseField(0xcac0);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const radius = Math.hypot(x - 0.5, y - 0.5);
      const flesh = mixColor([104, 176, 100], [136, 206, 128], fbm(field, x, y, 5, 2));
      if (radius > 0.42) return shade(flesh, -34);
      // The pale growing crown in the middle.
      return radius < 0.16 ? mixColor(flesh, [176, 220, 150], 0.6) : flesh;
    });
  };
});

tile('cactus_side', () => {
  const field = noiseField(0xcac1);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      // Ribs down the stem, with spines picked out along the ridges.
      const rib = Math.cos(x * Math.PI * 6);
      let color = shade(mixColor([100, 172, 96], [138, 206, 130], fbm(field, x, y, 4, 2)), rib * 16);
      if (x < 0.05 || x > 0.95) color = shade(color, -30);
      const onRidge = Math.abs(rib) > 0.94;
      if (onRidge && (y * 8) % 1 < 0.18) color = [226, 226, 196];
      return color;
    });
  };
});

// --- water works ---------------------------------------------------------------

tile('spring_top', () => {
  const cobble = drawings.get('cobblestone')!.draw;
  const field = noiseField(0x59f0);
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    cobble(ctx, rng);
    overlay(ctx, (x, y) => {
      const radius = Math.hypot(x - 0.5, y - 0.5);
      if (radius > 0.3) return null;
      if (radius > 0.24) return shade(STONE, -40);
      // Water welling up, brighter in the middle.
      return mixColor(shade(WATER, -20), [180, 224, 255], fbm(field, x, y, 4, 2) * (1 - radius * 2));
    });
  };
});

tile('spring_side', () => {
  const cobble = drawings.get('cobblestone')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    cobble(ctx, rng);
    overlay(ctx, (x, y) => {
      if (y < 0.3 || y > 0.72 || Math.abs(x - 0.5) > 0.24) return null;
      return Math.abs(x - 0.5) > 0.19 ? shade(STONE, -40) : shade(WATER, -10);
    });
  };
});

tile('pump_top', () => {
  const field = noiseField(0x9711);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const metal = shade([186, 190, 202], (fbm(field, x, y, 5, 2) - 0.5) * 16);
      const radius = Math.hypot(x - 0.5, y - 0.5);
      if (radius < 0.13) return shade(WATER, -14);
      if (radius < 0.2) return shade(metal, -34);
      if (radius < 0.3) return shade(metal, 16);
      return metal;
    });
  };
});

tile('pump_side', () => {
  const field = noiseField(0x9712);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const metal = shade([186, 190, 202], (fbm(field, x, y, 5, 2) - 0.5) * 16);
      // Banded housing with a dark inspection plate.
      if (Math.abs(y - 0.16) < 0.05 || Math.abs(y - 0.78) < 0.05) return shade(metal, -26);
      if (y > 0.3 && y < 0.66 && Math.abs(x - 0.5) < 0.15) return shade(metal, -44);
      return metal;
    });
  };
});

tile('drain_top', () => {
  const field = noiseField(0x9713);
  return (ctx: CanvasRenderingContext2D) => {
    paint(ctx, (x, y) => {
      const metal = shade([164, 168, 180], (fbm(field, x, y, 5, 2) - 0.5) * 14);
      if (Math.min(x, y, 1 - x, 1 - y) < 0.1) return metal;
      // Slots, with a lit lip on the upper edge of each.
      const slot = (x * 5) % 1;
      if (slot < 0.45) return [46, 50, 58];
      return slot < 0.55 ? shade(metal, 22) : metal;
    });
  };
});

tile('floodgate_closed', () => {
  const planks = drawings.get('oak_planks')!.draw;
  return (ctx: CanvasRenderingContext2D, rng: Rng) => {
    planks(ctx, rng);
    overlay(ctx, (x, y) => {
      // Iron straps across a shut gate.
      if (Math.abs(y - 0.28) < 0.055 || Math.abs(y - 0.72) < 0.055) return [148, 152, 164];
      if (Math.abs(x - 0.5) < 0.05) return [128, 132, 144];
      return null;
    });
  };
});

tile('floodgate_open', () => (ctx: CanvasRenderingContext2D) => {
  paint(ctx, (x, y) => {
    // The gate lifted: a frame with daylight through the middle.
    const frame = Math.min(x, y, 1 - x, 1 - y);
    if (frame < 0.13) return shade(WOOD, (frame - 0.06) * 120);
    if (y < 0.28) return [148, 152, 164];
    return null;
  });
});

// --- cross-shaped plants -------------------------------------------------------

/** Plants are alpha cut-outs on two crossed quads, so everything outside the drawing
 *  has to stay clear. */
function plantTile(draw: Draw): Draw {
  return (ctx, rng) => {
    ctx.clearRect(0, 0, TILE, TILE);
    draw(ctx, rng);
  };
}

/** Draws a blade or stem: a run of pixels from the ground up, leaning as it rises. */
function stem(
  ctx: CanvasRenderingContext2D,
  x: number,
  height: number,
  width: number,
  lean: number,
  color: (t: number) => Color,
): void {
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(height - 1, 1);
    const offset = lean * t * t;
    const w = Math.max(1, Math.round(width * (1 - t * 0.55)));
    for (let i = 0; i < w; i++) {
      px(ctx, Math.round(x + offset) + i, TILE - 1 - y, color(t));
    }
  }
}

tile('tall_grass', () => plantTile((ctx, rng) => {
  for (let i = 0; i < 11; i++) {
    const x = 2 + i * 2.6 + rng() * 1.5;
    const height = TILE * (0.35 + rng() * 0.45);
    const lean = (rng() - 0.5) * 6;
    stem(ctx, x, height, 2, lean, (t) => shade(mixColor(GRASS_DEEP, GRASS, t), (rng() - 0.5) * 18));
  }
}));

tile('dead_bush', () => plantTile((ctx, rng) => {
  const base: Color = [146, 112, 62];
  for (let i = 0; i < 7; i++) {
    const x = 4 + i * 3.5 + rng() * 2;
    const height = TILE * (0.3 + rng() * 0.4);
    stem(ctx, x, height, 1, (rng() - 0.5) * 10, (t) => shade(base, -18 + t * 26));
  }
}));

function flowerTile(petal: Color, heart: Color): () => Draw {
  return () => plantTile((ctx, rng) => {
    const cx = TILE / 2;
    stem(ctx, cx - 1, TILE * 0.62, 2, 1.5, () => shade(GRASS_DEEP, (rng() - 0.5) * 14));
    // A couple of leaves off the stem.
    for (const [ox, oy] of [[-3, 0.44], [3, 0.56]] as const) {
      for (let i = 0; i < 3; i++) {
        px(ctx, cx + ox + (ox < 0 ? i : -i), Math.round(TILE * oy) + i, shade(GRASS_DEEP, 8));
      }
    }
    // Six petals around a bright heart.
    const top = TILE * 0.24;
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2;
      const pxx = cx + Math.cos(angle) * 4.2;
      const pyy = top + Math.sin(angle) * 4.2;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          px(ctx, Math.round(pxx + dx), Math.round(pyy + dy), shade(petal, (rng() - 0.5) * 26));
        }
      }
    }
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 4) continue;
        px(ctx, Math.round(cx + dx), Math.round(top + dy), shade(heart, (rng() - 0.5) * 20));
      }
    }
  });
}

tile('flower_red', flowerTile([214, 78, 72], [250, 226, 120]));
tile('flower_yellow', flowerTile([244, 208, 74], [252, 244, 190]));

tile('sugar_cane', () => plantTile((ctx) => {
  const field = noiseField(0x5c1e);
  for (const [x0, width] of [[10, 5], [17, 4]] as const) {
    for (let y = 0; y < TILE; y++) {
      for (let i = 0; i < width; i++) {
        const t = i / (width - 1);
        let color = mixColor([108, 168, 104], [156, 208, 140], 1 - Math.abs(t - 0.35) * 1.6);
        color = shade(color, (field((x0 + i) / TILE, y / TILE, 8, 16) - 0.5) * 16);
        // Nodes along the cane.
        if ((y + x0) % 9 < 1.5) color = shade(color, -26);
        px(ctx, x0 + i, y, color);
      }
    }
  }
}));

tile('torch', () => plantTile((ctx) => {
  const cx = TILE / 2;
  for (let y = 0; y < TILE * 0.66; y++) {
    for (let i = -2; i < 2; i++) {
      const t = (i + 2) / 3;
      px(ctx, cx + i, TILE - 1 - y, shade(mixColor(shade(BARK, -18), shade(BARK, 14), 1 - t), 0));
    }
  }
  // The flame, hottest in its core.
  const top = TILE * 0.3;
  for (let dy = -4; dy <= 3; dy++) {
    for (let dx = -3; dx <= 2; dx++) {
      const radius = Math.hypot(dx + 0.5, (dy + 0.5) * 0.7);
      if (radius > 3.4) continue;
      const heat = 1 - radius / 3.4;
      px(ctx, cx + dx, Math.round(top + dy), mixColor([236, 132, 40], [255, 248, 206], heat * heat));
    }
  }
}));

/** A crop bed: rows that grow taller and change colour as the stage advances. */
function cropTile(stage: number, young: Color, ripe: Color): () => Draw {
  return () => plantTile((ctx, rng) => {
    const color = stage === 3 ? ripe : mixColor(young, ripe, stage / 4);
    const height = TILE * (0.22 + stage * 0.19);
    for (let i = 0; i < 5; i++) {
      const x = 3 + i * 6 + rng() * 1.5;
      stem(ctx, x, height, 2, (rng() - 0.5) * 3, (t) => shade(color, -14 + t * 24));
      if (stage >= 2) {
        // Heads of grain leaning off the top of each stalk.
        for (let k = 0; k < 3; k++) {
          px(ctx, Math.round(x) - 1, TILE - Math.round(height) + k * 2, shade(color, 18));
          px(ctx, Math.round(x) + 2, TILE - Math.round(height) + 1 + k * 2, shade(color, 18));
        }
      }
    }
  });
}

for (let stage = 0; stage < 4; stage++) {
  tile(`wheat_${stage}`, cropTile(stage, [128, 176, 84], [226, 200, 96]));
  tile(`carrots_${stage}`, cropTile(stage, [86, 162, 74], [238, 148, 56]));
  tile(`potatoes_${stage}`, cropTile(stage, [94, 158, 78], [206, 180, 104]));
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

artTile('coal', nugget([44, 44, 46], 3));
artTile('diamond', (ctx) => {
  iconBase(ctx);
  const c: Color = [120, 232, 232];
  rect(ctx, 6, 4, 4, 1, c);
  rect(ctx, 5, 5, 6, 2, c);
  rect(ctx, 4, 7, 8, 2, shade(c, -20));
  rect(ctx, 6, 9, 4, 2, shade(c, -40));
  rect(ctx, 7, 11, 2, 1, shade(c, -60));
});
artTile('emerald', (ctx) => {
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

artTile('iron_ingot', ingot([214, 214, 214]));
artTile('gold_ingot', ingot([238, 202, 74]));

artTile('bucket', (ctx) => {
  iconBase(ctx);
  const metal: Color = [186, 186, 194];
  rect(ctx, 4, 5, 8, 1, metal);
  rect(ctx, 4, 6, 8, 7, shade(metal, -18));
  rect(ctx, 5, 13, 6, 1, shade(metal, -40));
  rect(ctx, 4, 3, 1, 3, shade(metal, -30));
  rect(ctx, 11, 3, 1, 3, shade(metal, -30));
  rect(ctx, 5, 2, 6, 1, shade(metal, -30));
});

artTile('water_bucket', (ctx, rng) => {
  drawings.get('bucket')!.draw(ctx, rng);
  for (let y = 7; y < 12; y++) {
    for (let x = 5; x < 11; x++) px(ctx, x, y, shade(WATER, (rng() - 0.5) * 24));
  }
});

artTile('stick', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 9; i++) rect(ctx, 4 + i, 11 - i, 2, 2, shade(BARK, 20));
});

artTile('leather', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px(ctx, x, y, shade([168, 122, 78], (rng() - 0.5) * 22));
});

artTile('feather', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 10; i++) rect(ctx, 5 + Math.floor(i / 2), 12 - i, 2, 1, [240, 240, 240]);
  rect(ctx, 6, 5, 4, 4, [225, 228, 235]);
});

artTile('wheat_item', (ctx, rng) => {
  iconBase(ctx);
  for (const x of [5, 8, 11]) {
    for (let y = 3; y < 13; y++) px(ctx, x, y, shade([214, 188, 84], (rng() - 0.5) * 24));
    px(ctx, x - 1, 5, [196, 168, 70]);
    px(ctx, x + 1, 7, [196, 168, 70]);
  }
});

artTile('wheat_seeds', (ctx, rng) => {
  iconBase(ctx);
  for (let i = 0; i < 6; i++) {
    px(ctx, 5 + Math.floor(rng() * 6), 6 + Math.floor(rng() * 5), [150, 170, 96]);
  }
});

artTile('bread', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 5; y < 11; y++) {
    for (let x = 3; x < 13; x++) px(ctx, x, y, shade([196, 142, 72], (rng() - 0.5) * 24));
  }
  rect(ctx, 4, 5, 8, 1, [222, 176, 100]);
});

artTile('apple', (ctx) => {
  iconBase(ctx);
  rect(ctx, 4, 5, 8, 7, [200, 52, 46]);
  rect(ctx, 5, 4, 6, 1, [200, 52, 46]);
  rect(ctx, 5, 6, 2, 2, [236, 130, 120]);
  rect(ctx, 8, 2, 1, 3, [96, 68, 36]);
  rect(ctx, 9, 2, 2, 1, [84, 152, 60]);
});

artTile('carrot', (ctx) => {
  iconBase(ctx);
  for (let i = 0; i < 8; i++) rect(ctx, 5 + Math.floor(i / 3), 12 - i, 4 - Math.floor(i / 3), 1, [232, 132, 44]);
  rect(ctx, 6, 3, 4, 2, [86, 160, 62]);
});

artTile('potato', (ctx, rng) => {
  iconBase(ctx);
  for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) px(ctx, x, y, shade([196, 168, 96], (rng() - 0.5) * 26));
});

artTile('baked_potato', (ctx, rng) => {
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

artTile('raw_beef', meatTile(true, [204, 92, 88]));
artTile('cooked_beef', meatTile(false, [176, 108, 62]));
artTile('raw_porkchop', meatTile(true, [232, 152, 148]));
artTile('cooked_porkchop', meatTile(false, [196, 132, 78]));
artTile('raw_chicken', meatTile(true, [232, 186, 160]));
artTile('cooked_chicken', meatTile(false, [198, 150, 84]));
artTile('raw_mutton', meatTile(true, [214, 116, 104]));
artTile('cooked_mutton', meatTile(false, [170, 106, 60]));

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
    artTile(`${kind}_${tierName}`, toolTile(kind, tierName));
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
    artTile(`${slot}_${setName}`, armorTile(slot, setName));
  }
}

// --- atlas assembly ------------------------------------------------------------

export interface Atlas {
  /** The flat atlas, still used for item drops, break particles and DOM icons. */
  texture: THREE.Texture;
  /** One layer per tile. Terrain samples this: because layers cannot bleed into one
   *  another it can carry a full mipmap chain and anisotropic filtering, which is what
   *  stops distant ground boiling into noise as the camera moves. */
  array: THREE.DataArrayTexture;
  uv(name: string): TileUv;
  /** Index of a tile within the array texture. */
  layer(name: string): number;
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
  const layers = new Map<string, number>();
  const layerData = new Uint8Array(names.length * TILE * TILE * 4);

  names.forEach((name, index) => {
    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    const cell = document.createElement('canvas');
    cell.width = TILE;
    cell.height = TILE;
    const cellCtx = cell.getContext('2d');
    if (!cellCtx) throw new Error('2D canvas is not available');
    cellCtx.imageSmoothingEnabled = false;
    const drawing = drawings.get(name)!;
    if (drawing.pixelArt) cellCtx.scale(ART_SCALE, ART_SCALE);
    // A per-tile seed keeps textures stable between runs.
    drawing.draw(cellCtx, mulberry32(0x9e3779b9 ^ (index * 2654435761)));
    cellCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cell, col * TILE, row * TILE);
    icons.set(name, cell.toDataURL());
    layers.set(name, index);
    layerData.set(cellCtx.getImageData(0, 0, TILE, TILE).data, index * TILE * TILE * 4);
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

  const array = new THREE.DataArrayTexture(layerData, TILE, TILE, names.length);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.colorSpace = THREE.SRGBColorSpace;
  // Crisp texels up close, filtered chains further out. Anisotropy is clamped to
  // whatever the device actually supports.
  array.magFilter = THREE.NearestFilter;
  array.minFilter = THREE.LinearMipmapLinearFilter;
  array.generateMipmaps = true;
  array.anisotropy = 16;
  array.wrapS = THREE.ClampToEdgeWrapping;
  array.wrapT = THREE.ClampToEdgeWrapping;
  array.needsUpdate = true;

  const fallback: TileUv = { u0: 0, v0: 0, u1: TILE / canvas.width, v1: TILE / canvas.height };
  cached = {
    texture,
    array,
    canvas,
    uv: (name) => uvs.get(name) ?? fallback,
    layer: (name) => layers.get(name) ?? 0,
    icon: (name) => icons.get(name) ?? '',
  };
  return cached;
}

export function tileNames(): string[] {
  return [...drawings.keys()];
}
