import { buildBeveledBox } from './roundedTemplates';
import type { ModelPart } from './models';

/**
 * The geometry a mob is made of, built without three.js so it can be checked in
 * Node like the block templates are.
 *
 * Two things it fixes about the way mobs were drawn. Every part used to be one
 * shared unit rounded box, scaled — so the bevel was scaled with it, and a leg
 * eight hundredths of a block thick got the same 0.16 radius stretched into a
 * slab. Here each part is built at its own size, with a bevel proportional to
 * its own smallest dimension. And parts had one flat colour each; here the
 * colour is baked per vertex with a gentle vertical gradient, which costs
 * nothing at draw time and is most of the difference between a toy and a model.
 */

export interface PartMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Vertex colours, 0..1 RGB. */
  colors: Float32Array;
  indices: Uint16Array;
}

/** Bevel as a fraction of a part's smallest dimension, when it says nothing. */
const ROUND = 0.2;
/** Sides on a round shape by default. */
const SEGMENTS = 10;
/** How much lighter the top of a part is than the bottom when it names no tip.
 *  Enough to see the form, far short of looking painted. */
const SHADE = 0.09;

interface Raw {
  positions: number[];
  normals: number[];
  indices: number[];
}

function quad(raw: Raw, a: number, b: number, c: number, d: number): void {
  raw.indices.push(a, b, c, a, c, d);
}

function push(raw: Raw, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  raw.positions.push(x, y, z);
  raw.normals.push(nx, ny, nz);
  return raw.positions.length / 3 - 1;
}

/** A unit cylinder along Y: radius 0.5, height 1, centred on the origin. */
function cylinder(segments: number, topScale: number): Raw {
  const raw: Raw = { positions: [], normals: [], indices: [] };
  const ring = (y: number, r: number, ny: number, sideways: boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      out.push(sideways
        ? push(raw, cos * r, y, sin * r, cos, 0, sin)
        : push(raw, cos * r, y, sin * r, 0, ny, 0));
    }
    return out;
  };
  const top = Math.max(1e-4, 0.5 * topScale);
  const sideTop = ring(0.5, top, 0, true);
  const sideBottom = ring(-0.5, 0.5, 0, true);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    quad(raw, sideBottom[i], sideBottom[j], sideTop[j], sideTop[i]);
  }
  // Caps as fans around a centre vertex, so the normals stay flat.
  const capTop = ring(0.5, top, 1, false);
  const middleTop = push(raw, 0, 0.5, 0, 0, 1, 0);
  for (let i = 0; i < segments; i++) raw.indices.push(middleTop, capTop[i], capTop[(i + 1) % segments]);
  const capBottom = ring(-0.5, 0.5, -1, false);
  const middleBottom = push(raw, 0, -0.5, 0, 0, -1, 0);
  for (let i = 0; i < segments; i++) raw.indices.push(middleBottom, capBottom[(i + 1) % segments], capBottom[i]);
  return raw;
}

/** A unit sphere: radius 0.5, centred on the origin. */
function sphere(segments: number): Raw {
  const raw: Raw = { positions: [], normals: [], indices: [] };
  const rows = Math.max(3, Math.round(segments * 0.7));
  const grid: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    const phi = (r / rows) * Math.PI;
    const y = Math.cos(phi) * 0.5, radius = Math.sin(phi) * 0.5;
    const line: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      const length = Math.hypot(x, y, z) || 1;
      line.push(push(raw, x, y, z, x / length, y / length, z / length));
    }
    grid.push(line);
  }
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < segments; i++) {
      quad(raw, grid[r][i], grid[r][i + 1], grid[r + 1][i + 1], grid[r + 1][i]);
    }
  }
  return raw;
}

/**
 * The bare shape of a part.
 *
 * A box comes back at its true size, because that is the whole point: the bevel
 * has to be a real distance in the world, and scaling a unit box to a leg's
 * proportions is what used to stretch it into a slab. The round shapes come back
 * as unit shapes for the caller to scale, which turns a cylinder into an
 * elliptic one and a sphere into an ellipsoid — both of which are shapes worth
 * having.
 */
function shapeOf(part: ModelPart): { raw: Raw; sized: boolean } {
  const segments = part.segments ?? SEGMENTS;
  switch (part.shape ?? 'box') {
    case 'cylinder': return { raw: cylinder(segments, 1), sized: false };
    case 'taper': return { raw: cylinder(segments, part.taper ?? 0.4), sized: false };
    case 'sphere': return { raw: sphere(segments), sized: false };
    default: {
      const [w, h, d] = part.size;
      const template = buildBeveledBox({
        halfExtent: [w / 2, h / 2, d / 2],
        radius: Math.min(w, h, d) * (part.round ?? ROUND),
        segments: 2,
        faceMask: 0,
      });
      return {
        raw: {
          positions: Array.from(template.positions),
          normals: Array.from(template.normals),
          indices: Array.from(template.indices),
        },
        sized: true,
      };
    }
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A hex colour as three linear values.
 *
 * The renderer works in linear light and converts on the way out, and it does
 * that conversion for a material's own colour — but a vertex colour attribute is
 * taken as linear already. Handing it sRGB makes every mob come out pale and
 * chalky, which is exactly how they looked the first time this was tried.
 */
function linear(color: number): number[] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

/** Blends a hex colour towards another, or towards a lighter version of itself. */
function shades(color: number, tip: number | undefined): [number[], number[]] {
  const rgb = linear(color);
  if (tip === undefined) {
    return [rgb.map((c) => c * (1 - SHADE * 0.6)), rgb.map((c) => Math.min(1, c * (1 + SHADE)))];
  }
  return [rgb, linear(tip)];
}

/**
 * One part, in the space of the joint it hangs on.
 *
 * `origin` is that joint's pivot in rest space; for a part that never moves it
 * is the mob's own origin. Everything — the part's own rotation, its size, its
 * place — is baked in here, once, so that a frame of animation is one euler
 * assignment per joint and nothing else.
 */
export function buildPart(part: ModelPart, origin: readonly [number, number, number]): PartMesh {
  const { raw, sized } = shapeOf(part);
  const [sx, sy, sz] = sized ? [1, 1, 1] : part.size;
  const height = part.size[1] || 1;
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  const cx = Math.cos(rx), sinX = Math.sin(rx);
  const cy = Math.cos(ry), sinY = Math.sin(ry);
  const cz = Math.cos(rz), sinZ = Math.sin(rz);
  const count = raw.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const [low, high] = shades(part.color, part.tip);

  // Z, then X, then Y — a twist, then a pitch, then a turn about the world's own
  // up. The order matters to whoever writes the numbers: it means the Y angle is
  // "which way is this limb pointing", measured in the world and not in whatever
  // frame the other two left behind.
  const turn = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * cz - y * sinZ, y1 = x * sinZ + y * cz;
    const y2 = y1 * cx - z * sinX, z2 = y1 * sinX + z * cx;
    return [x1 * cy + z2 * sinY, y2, -x1 * sinY + z2 * cy];
  };

  for (let i = 0; i < count; i++) {
    const px = raw.positions[i * 3] * sx;
    const py = raw.positions[i * 3 + 1] * sy;
    const pz = raw.positions[i * 3 + 2] * sz;
    const [tx, ty, tz] = turn(px, py, pz);
    positions[i * 3] = tx + part.offset[0] - origin[0];
    positions[i * 3 + 1] = ty + part.offset[1] - origin[1];
    positions[i * 3 + 2] = tz + part.offset[2] - origin[2];

    // Normals are turned but not scaled: a non-uniform scale would skew them,
    // and at these proportions the error is far less visible than the cost of
    // carrying an inverse-transpose around.
    const [nx, ny, nz] = turn(raw.normals[i * 3], raw.normals[i * 3 + 1], raw.normals[i * 3 + 2]);
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / length;
    normals[i * 3 + 1] = ny / length;
    normals[i * 3 + 2] = nz / length;

    // The gradient runs up the part's own height, before it was turned, so a
    // tail lying flat still shades from root to tip.
    const t = Math.max(0, Math.min(1, py / height + 0.5));
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = lerp(low[c], high[c], t);
  }

  return { positions, normals, colors, indices: Uint16Array.from(raw.indices) };
}

/** Several parts as one mesh. What keeps the draw calls down as the parts go up. */
export function mergeParts(meshes: readonly PartMesh[]): PartMesh {
  let vertices = 0, indices = 0;
  for (const mesh of meshes) {
    vertices += mesh.positions.length / 3;
    indices += mesh.indices.length;
  }
  if (vertices > 65535) throw new Error(`a mob part group needs ${vertices} vertices, over the 16 bit index limit`);
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const merged = new Uint16Array(indices);
  let vertex = 0, index = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertex * 3);
    normals.set(mesh.normals, vertex * 3);
    colors.set(mesh.colors, vertex * 3);
    for (let i = 0; i < mesh.indices.length; i++) merged[index + i] = mesh.indices[i] + vertex;
    vertex += mesh.positions.length / 3;
    index += mesh.indices.length;
  }
  return { positions, normals, colors, indices: merged };
}
