import { type BlockId, Block, CRAFTED, LEAVES, blockDef } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, type Chunk } from '../world/chunk';
import { waterFraction } from '../world/water';
import type { World } from '../world/world';
import type { Atlas } from './textures';

/** Which draw pass a block belongs to. */
export const PASS_OPAQUE = 0;
export const PASS_CUTOUT = 1;
export const PASS_TRANSPARENT = 2;
/** Water gets its own pass so a flowing river only rebuilds this small geometry. */
export const PASS_WATER = 3;
export type Pass = 0 | 1 | 2 | 3;

/** Everything but the position is packed into bytes on the way out. Rounding the
 *  blocks off multiplies the vertex count, and none of these carry anything like eight
 *  bits of meaning: light arrives in sixteen steps, a texture coordinate lands on one
 *  of four cut lines, and a normal that is wrong by 1/127 cannot be seen. */
export interface GeometryArrays {
  position: Float32Array;
  /** Per vertex, normalised: where the corner sits on its tile. */
  uv: Uint8Array;
  /** Per vertex, normalised: skylight and block light. */
  light: Uint8Array;
  /** Per vertex, normalised: ambient occlusion, with the contact shading of a rounded
   *  edge folded in. Directional shading is not baked: the shader lights the real
   *  normal. */
  shade: Uint8Array;
  /** Per vertex, normalised, four to a vertex so the stride stays aligned: the surface
   *  normal. On the flat of a face it is the face normal; over a rounded edge it turns
   *  outwards, and it turns to exactly the same direction on the face round the corner,
   *  so the two shade as one continuous surface. */
  normal: Int8Array;
  /** Per vertex: which layer of the array texture to sample. Constant across a face. */
  layer: Uint16Array;
  index: Uint32Array;
}

export type MeshData = Record<Pass, GeometryArrays | null>;

interface Corner {
  pos: readonly [number, number, number];
  uv: readonly [number, number];
}

interface Face {
  dir: readonly [number, number, number];
  corners: readonly Corner[];
  /** Per corner, the three neighbour offsets used for ambient occlusion. */
  ao: readonly (readonly [number, number, number])[][];
}

const RAW_FACES: Omit<Face, 'ao'>[] = [
  {
    dir: [-1, 0, 0],
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  {
    dir: [1, 0, 0],
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] },
      { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] },
      { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  {
    dir: [0, 1, 0],
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

export interface FaceFrame {
  /** Outward normal of the face. */
  normal: readonly [number, number, number];
  /** The face's own (0, 0) corner, in block-local coordinates. */
  origin: readonly [number, number, number];
  /** World direction in which the face's own u coordinate grows. */
  tangent: readonly [number, number, number];
  /** World direction in which the face's own v coordinate grows. */
  bitangent: readonly [number, number, number];
  /** +1 when tangent x bitangent points along the normal, -1 when it points the other
   *  way. Half the faces are mirrored, and their triangles have to wind the other way. */
  handed: number;
}

/** The surface frame of each cube face, read straight off the corner table so nothing
 *  downstream can drift from the mesh's own idea of "along the face". */
export const FACE_BASIS: FaceFrame[] = RAW_FACES.map((face) => {
  const at = (u: number, v: number): readonly [number, number, number] => {
    const corner = face.corners.find((c) => c.uv[0] === u && c.uv[1] === v);
    if (!corner) throw new Error('face corner table is not a unit square');
    return corner.pos;
  };
  const origin = at(0, 0);
  const along = (to: readonly [number, number, number]): [number, number, number] => [
    to[0] - origin[0],
    to[1] - origin[1],
    to[2] - origin[2],
  ];
  const tangent = along(at(1, 0));
  const bitangent = along(at(0, 1));
  const cross: [number, number, number] = [
    tangent[1] * bitangent[2] - tangent[2] * bitangent[1],
    tangent[2] * bitangent[0] - tangent[0] * bitangent[2],
    tangent[0] * bitangent[1] - tangent[1] * bitangent[0],
  ];
  const handed =
    cross[0] * face.dir[0] + cross[1] * face.dir[1] + cross[2] * face.dir[2] > 0 ? 1 : -1;
  return { normal: face.dir, origin, tangent, bitangent, handed };
});

/** Precomputes, for every face corner, the three neighbours whose solidity decides
 *  how dark that corner gets. */
const FACES: Face[] = RAW_FACES.map((face) => {
  const normalAxis = face.dir.findIndex((v) => v !== 0);
  const axes = [0, 1, 2].filter((a) => a !== normalAxis);
  const ao = face.corners.map((corner) => {
    const [au, av] = axes;
    const su = corner.pos[au] * 2 - 1;
    const sv = corner.pos[av] * 2 - 1;
    const offset = (u: number, v: number): [number, number, number] => {
      const out: [number, number, number] = [face.dir[0], face.dir[1], face.dir[2]];
      out[au] += u;
      out[av] += v;
      return out;
    };
    return [offset(su, 0), offset(0, sv), offset(su, sv)];
  });
  return { ...face, ao };
});

/** Brightness against how much is crowding a corner, from nothing to three ways in. */
const AO_CURVE = [1, 0.89, 0.73, 0.54];

/** The curve read at a fractional amount, so a leaf can shade a corner by part of a
 *  block's worth. */
function ambient(amount: number): number {
  const crowding = Math.min(3, Math.max(0, amount));
  const step = Math.min(2, Math.floor(crowding));
  return AO_CURVE[step] + (AO_CURVE[step + 1] - AO_CURVE[step]) * (crowding - step);
}

/** How far a convex edge is cut back from the block's outline. This is the whole of
 *  the roundness: it is real geometry, so it shows in the silhouette against the sky
 *  and not only in the shading. */
export const BEVEL = 0.17;
/** Width of the chamfer measured across the face. Twice the cut puts the chamfer at
 *  forty-five degrees, which is what lets two faces meet on it exactly. */
const BAND = BEVEL * 2;
/** Contact shading along a rounded edge, per displaced axis. */
const EDGE_SHADE = 0.93;
/** How far a leaf vertex wanders off the lattice. Foliage is the one thing in a
 *  block world that should not look built, and a canopy that still meets at right
 *  angles reads as a stack of boxes however round its corners are. */
const ORGANIC = 0.13;

const EMPTY_CELL = 0;
const ROUND_CELL = 1;
const SHARP_CELL = 2;

/** Cached per block id: survey() asks this eight times a vertex, and walking through
 *  the block definition each time is measurable. Empty, filling and rounded off, or
 *  filling and left square.
 *
 *  There are two of these because foliage and everything else do not agree about what
 *  counts as filled. A canopy is one continuous mass to itself, so a leaf pressed
 *  against another leaf has nothing to round. But to the ground it is not scenery it
 *  is part of: FIRM_KIND leaves it out, so a hillside rounds its edge away from a
 *  canopy resting on it instead of running seamlessly into it. Each set of faces is
 *  consistent with itself, which is all watertightness ever asked for; the two are
 *  separate surfaces and were never going to meet. */
const CELL_KIND = new Uint8Array(512);
const FIRM_KIND = new Uint8Array(512);
for (let id = 0; id < CELL_KIND.length; id++) {
  if (blockDef(id).render !== 'cube') continue;
  CELL_KIND[id] = CRAFTED.has(id) ? SHARP_CELL : ROUND_CELL;
  FIRM_KIND[id] = LEAVES.has(id) ? EMPTY_CELL : CELL_KIND[id];
}

/** How much of a shadow a cell casts into the corner beside it. Leaves are not opaque
 *  and so cast none at all, which is what leaves a canopy sitting against a hillside
 *  looking welded to it. Rather less than a wall, though: light does get through. */
const SHADOW_CAST = new Float32Array(512);
/** Whether a cell stops light outright, which decides where the light either side of a
 *  corner may be sampled from. */
const OPAQUE_CELL: boolean[] = [];
for (let id = 0; id < SHADOW_CAST.length; id++) {
  const opaque = blockDef(id).opaque;
  OPAQUE_CELL[id] = opaque;
  SHADOW_CAST[id] = opaque ? 1 : LEAVES.has(id) ? 0.62 : 0;
}

const TRANSPARENT_BLOCKS = new Set<BlockId>([Block.GLASS, Block.ICE]);

export function passOf(id: BlockId): Pass {
  if (id === Block.WATER) return PASS_WATER;
  if (TRANSPARENT_BLOCKS.has(id)) return PASS_TRANSPARENT;
  const def = blockDef(id);
  if (def.render === 'cross') return PASS_CUTOUT;
  return def.opaque ? PASS_OPAQUE : PASS_CUTOUT;
}

/** Deterministic 0..1 from a lattice site. Both faces meeting on an edge hash the same
 *  undisplaced position, so a jittered surface still closes up. */
function hash3(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Bilinear read of something sampled at a face's four corners, indexed [u][v]. */
function between(grid: number[][], u: number, v: number): number {
  return (
    grid[0][0] * (1 - u) * (1 - v) +
    grid[1][0] * u * (1 - v) +
    grid[0][1] * (1 - u) * v +
    grid[1][1] * u * v
  );
}

interface Builder {
  position: number[];
  uv: number[];
  light: number[];
  shade: number[];
  normal: number[];
  layer: number[];
  index: number[];
}

function newBuilder(): Builder {
  return { position: [], uv: [], light: [], shade: [], normal: [], layer: [], index: [] };
}

/** 0..1 into a byte, and -1..1 into a signed byte. */
function unsigned(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(values[i] * 255)));
  return out;
}

function signed(values: number[]): Int8Array {
  const out = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(values[i] * 127)));
  return out;
}

function finish(builder: Builder): GeometryArrays | null {
  if (builder.index.length === 0) return null;
  return {
    position: new Float32Array(builder.position),
    uv: unsigned(builder.uv),
    light: unsigned(builder.light),
    shade: unsigned(builder.shade),
    normal: signed(builder.normal),
    layer: new Uint16Array(builder.layer),
    index: new Uint32Array(builder.index),
  };
}

/** Texture name for a given face direction of a block. */
function textureFor(id: BlockId, dirY: number): string {
  const def = blockDef(id);
  if (dirY > 0) return def.tex.top ?? def.tex.all ?? def.tex.side ?? 'stone';
  if (dirY < 0) return def.tex.bottom ?? def.tex.all ?? def.tex.side ?? 'stone';
  return def.tex.side ?? def.tex.all ?? def.tex.top ?? 'stone';
}

export interface MeshOptions {
  /** Skip everything except water, for the cheap rebuild while a river flows. */
  waterOnly?: boolean;
}

/** Builds the geometry for one chunk, reading neighbouring chunks through the world so
 *  faces along a chunk seam are culled correctly. */
export function buildChunkMesh(
  world: World,
  chunk: Chunk,
  atlas: Atlas,
  options: MeshOptions = {},
): MeshData {
  const builders: Record<Pass, Builder> = {
    [PASS_OPAQUE]: newBuilder(),
    [PASS_CUTOUT]: newBuilder(),
    [PASS_TRANSPARENT]: newBuilder(),
    [PASS_WATER]: newBuilder(),
  };
  const originX = chunk.originX;
  const originZ = chunk.originZ;

  const blockAt = (x: number, y: number, z: number): BlockId => {
    if (y < 0) return Block.BEDROCK;
    if (y >= CHUNK_HEIGHT) return Block.AIR;
    // Inside this chunk we can read the array directly, which is the hot path.
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) return chunk.get(x, y, z);
    return world.getBlock(originX + x, y, originZ + z);
  };

  const loadedAt = (x: number, z: number): boolean => {
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) return true;
    return world.isLoadedAt(originX + x, originZ + z);
  };

  const skyAt = (x: number, y: number, z: number): number => {
    if (y >= CHUNK_HEIGHT) return 15;
    if (y < 0) return 0;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) return chunk.getSkyLight(x, y, z);
    return world.getSkyLight(originX + x, y, originZ + z);
  };

  const blockLightAt = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) return chunk.getBlockLight(x, y, z);
    return world.getBlockLight(originX + x, y, originZ + z);
  };


  /** What a cell is, to whoever is asking. Deliberately not the same test as
   *  occlusion: glass and leaves stop no light but they do fill their cell, and a
   *  surface that runs into one has not stopped. */
  const kindAt = (kinds: Uint8Array, x: number, y: number, z: number): number => kinds[blockAt(x, y, z)];

  const waterAt = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) return chunk.getWater(x, y, z);
    return world.getWater(originX + x, y, originZ + z);
  };

  /** Surface height at one corner of a water cell: the average fill of the cells that
   *  share the corner. Neighbouring cells compute this from the same set, so their
   *  surfaces always meet and the water reads as one continuous sheet. */
  const cornerHeight = (x: number, y: number, z: number, dx: number, dz: number): number => {
    let sum = 0;
    let count = 0;
    let covered = false;
    for (const [ox, oz] of [[0, 0], [dx, 0], [0, dz], [dx, dz]] as const) {
      if (waterAt(x + ox, y + 1, z + oz) > 0) {
        // Water carries on above this corner, so the face has to reach the ceiling.
        sum += 1;
        count++;
        covered = true;
        continue;
      }
      const level = waterAt(x + ox, y, z + oz);
      if (level > 0) {
        sum += waterFraction(level);
        count++;
      } else if (waterAt(x + ox, y - 1, z + oz) > 0) {
        // The sheet passes below this cell here: counting it as empty is what keeps a
        // gently sloping river smooth where its surface crosses a block boundary.
        count++;
      }
    }
    if (covered) return 1;
    // A film lying straight on the ground is nudged up so it does not z-fight with it,
    // but one lying on more water is left exactly where the average puts it.
    const lowest = waterAt(x, y - 1, z) > 0 ? 0 : 0.1;
    return count > 0 ? Math.max(lowest, sum / count) : waterFraction(waterAt(x, y, z));
  };

  // Scratch, reused by every face. A chunk emits these hundreds of thousands of times
  // and allocating a fresh pair of pairs each time costs more than the work does.
  const warpX = [[0, 0], [0, 0]];
  const warpY = [[0, 0], [0, 0]];
  const warpZ = [[0, 0], [0, 0]];
  const cornerShade = [[0, 0], [0, 0]];
  const cornerSky = [[0, 0], [0, 0]];
  const cornerBlock = [[0, 0], [0, 0]];
  const us = [0, 0, 0, 0];
  const vs = [0, 0, 0, 0];

  // Where survey() leaves its answer: the direction the solid world falls away from a
  // point, as a sum of unit axes, and how many ways it falls away at all.
  let siteX = 0;
  let siteY = 0;
  let siteZ = 0;
  let siteOpen = 0;

  // The six faces of a block ask about the same points over and over -- three of them
  // meet at every corner -- so each answer is kept until the next block. A point of a
  // block lands on one of four values per axis, which is what makes the slot a number
  // rather than a lookup.
  const cellStamp = new Int32Array(64);
  const cellSite = new Int8Array(64 * 4);
  let visiting = 0;
  const slotOf = (local: number): number => (local === 0 ? 0 : local === 1 ? 3 : local < 0.5 ? 1 : 2);

  /** Looks at the eight cells meeting at a point and reports how many of the six
   *  directions lead entirely away from anything solid.
   *
   *  Two or more means the surface turns the corner here and the point is pulled back
   *  along every one of them, which is what rounds the block off. Exactly one means the
   *  point is somewhere in the flat of a face, and nothing moves — otherwise a plain
   *  would quilt itself into a grid of cushions. None means an inside corner, where
   *  pulling back would tear the step open.
   *
   *  It reads the point and nothing else: not the face that asked, not the block that
   *  owns it. That is the whole trick. Every face arriving at a point is pulled to the
   *  same place, so a rounded rim can run out against a block that does not round at
   *  all and still leave no hole behind. */
  const survey = (kinds: Uint8Array, qx: number, qy: number, qz: number): number => {
    const xHi = Number.isInteger(qx) ? qx : Math.floor(qx);
    const yHi = Number.isInteger(qy) ? qy : Math.floor(qy);
    const zHi = Number.isInteger(qz) ? qz : Math.floor(qz);
    // A point part-way along an axis has the same cell on both sides of it, so that
    // axis can never be open and falls out of the count by itself.
    const xLo = Number.isInteger(qx) ? qx - 1 : xHi;
    const yLo = Number.isInteger(qy) ? qy - 1 : yHi;
    const zLo = Number.isInteger(qz) ? qz - 1 : zHi;
    const k000 = kinds[blockAt(xLo, yLo, zLo)];
    const k001 = kinds[blockAt(xLo, yLo, zHi)];
    const k010 = kinds[blockAt(xLo, yHi, zLo)];
    const k011 = kinds[blockAt(xLo, yHi, zHi)];
    const k100 = kinds[blockAt(xHi, yLo, zLo)];
    const k101 = kinds[blockAt(xHi, yLo, zHi)];
    const k110 = kinds[blockAt(xHi, yHi, zLo)];
    const k111 = kinds[blockAt(xHi, yHi, zHi)];
    siteX = 0;
    siteY = 0;
    siteZ = 0;
    siteOpen = 0;
    // One square-cornered block anywhere around a point holds the whole point still.
    // Asking the point rather than the face is again what keeps this consistent: the
    // wall beside a workbench flattens its rounding off as it reaches it, from both
    // sides at once, instead of tearing.
    if ((k000 | k001 | k010 | k011 | k100 | k101 | k110 | k111) & SHARP_CELL) return 0;
    const c000 = k000 !== EMPTY_CELL;
    const c001 = k001 !== EMPTY_CELL;
    const c010 = k010 !== EMPTY_CELL;
    const c011 = k011 !== EMPTY_CELL;
    const c100 = k100 !== EMPTY_CELL;
    const c101 = k101 !== EMPTY_CELL;
    const c110 = k110 !== EMPTY_CELL;
    const c111 = k111 !== EMPTY_CELL;
    const xUp = !(c100 || c101 || c110 || c111) ? 1 : 0;
    const xDown = !(c000 || c001 || c010 || c011) ? 1 : 0;
    const yUp = !(c010 || c011 || c110 || c111) ? 1 : 0;
    const yDown = !(c000 || c001 || c100 || c101) ? 1 : 0;
    const zUp = !(c001 || c011 || c101 || c111) ? 1 : 0;
    const zDown = !(c000 || c010 || c100 || c110) ? 1 : 0;
    siteX = xUp - xDown;
    siteY = yUp - yDown;
    siteZ = zUp - zDown;
    siteOpen = xUp + xDown + yUp + yDown + zUp + zDown;
    return siteOpen;
  };

  /** survey(), with this block's answers remembered. */
  const surveyed = (
    kinds: Uint8Array,
    qx: number,
    qy: number,
    qz: number,
    localX: number,
    localY: number,
    localZ: number,
  ): number => {
    const slot = slotOf(localX) * 16 + slotOf(localY) * 4 + slotOf(localZ);
    if (cellStamp[slot] === visiting) {
      siteX = cellSite[slot * 4];
      siteY = cellSite[slot * 4 + 1];
      siteZ = cellSite[slot * 4 + 2];
      siteOpen = cellSite[slot * 4 + 3];
      return siteOpen;
    }
    survey(kinds, qx, qy, qz);
    cellStamp[slot] = visiting;
    cellSite[slot * 4] = siteX;
    cellSite[slot * 4 + 1] = siteY;
    cellSite[slot * 4 + 2] = siteZ;
    cellSite[slot * 4 + 3] = siteOpen;
    return siteOpen;
  };

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.get(x, y, z);
        if (id === Block.AIR) continue;
        if (options.waterOnly && id !== Block.WATER) continue;
        const def = blockDef(id);
        const pass = passOf(id);
        const builder = builders[pass];

        // Water surfaces slope with the fill level, so its corners are precomputed.
        const heights =
          id === Block.WATER
            ? [
                [cornerHeight(x, y, z, -1, -1), cornerHeight(x, y, z, -1, 1)],
                [cornerHeight(x, y, z, 1, -1), cornerHeight(x, y, z, 1, 1)],
              ]
            : null;

        if (def.render === 'cross') {
          emitCross(builder, atlas.layer(def.tex.all ?? 'tall_grass'), x, y, z, skyAt(x, y, z), blockLightAt(x, y, z));
          continue;
        }
        if (def.render === 'none') continue;

        const rounded = CELL_KIND[id] === ROUND_CELL;
        const organic = LEAVES.has(id);
        // Foliage is a world to itself; everything else agrees to ignore it.
        const kinds = organic ? CELL_KIND : FIRM_KIND;
        visiting++;

        for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
          const face = FACES[faceIndex];
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          // Never draw into a chunk that has not loaded yet: it would flicker.
          if (!loadedAt(nx, nz)) continue;
          const neighbor = blockAt(nx, ny, nz);
          const neighborDef = blockDef(neighbor);
          if (neighborDef.opaque) continue;
          // Adjacent blocks of the same see-through type share a surface.
          if (neighbor === id && !def.opaque) continue;
          if (def.render === 'liquid' && neighborDef.render === 'liquid') continue;

          const layer = atlas.layer(textureFor(id, face.dir[1]));
          const frame = FACE_BASIS[faceIndex];
          const [ox, oy, oz] = frame.origin;
          const [tx, ty, tz] = frame.tangent;
          const [bx, by, bz] = frame.bitangent;
          const [dx, dy, dz] = frame.normal;

          // A cut line is inserted along any side with nothing next to it, which is
          // where the rounding will need somewhere to happen. Every face of this block
          // asks the same question of the same cell, so the sides they share are cut
          // in the same places and no face is left hanging off the end of another.
          const lowU = rounded && kindAt(kinds, x - tx, y - ty, z - tz) === EMPTY_CELL;
          const highU = rounded && kindAt(kinds, x + tx, y + ty, z + tz) === EMPTY_CELL;
          const lowV = rounded && kindAt(kinds, x - bx, y - by, z - bz) === EMPTY_CELL;
          const highV = rounded && kindAt(kinds, x + bx, y + by, z + bz) === EMPTY_CELL;
          let across = 0;
          us[across++] = 0;
          if (lowU) us[across++] = BAND;
          if (highU) us[across++] = 1 - BAND;
          us[across++] = 1;
          let down = 0;
          vs[down++] = 0;
          if (lowV) vs[down++] = BAND;
          if (highV) vs[down++] = 1 - BAND;
          vs[down++] = 1;

          // Occlusion and light are still measured at the block's own four corners;
          // everything in between is interpolated, which is what the hardware would
          // have done across the single quad this used to be.
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const [o1, o2, o3] = face.ao[c];
            const near1 = blockAt(x + o1[0], y + o1[1], z + o1[2]);
            const near2 = blockAt(x + o2[0], y + o2[1], z + o2[2]);
            const near3 = blockAt(x + o3[0], y + o3[1], z + o3[2]);
            const side1 = OPAQUE_CELL[near1];
            const side2 = OPAQUE_CELL[near2];
            const corner3 = OPAQUE_CELL[near3];
            // Two sides closing in on a corner bury it, which is what the product term
            // says; below that it is simply how much is in the way. Foliage counts for
            // part of a block, so a canopy lays a soft contact shadow on what it rests
            // against and a leaf tucked behind another one goes dark.
            const cast1 = SHADOW_CAST[near1];
            const cast2 = SHADOW_CAST[near2];
            const crowding = cast1 + cast2 + SHADOW_CAST[near3] + cast1 * cast2;

            let skySum = skyAt(nx, ny, nz);
            let blockSum = blockLightAt(nx, ny, nz);
            let samples = 1;
            if (!side1) {
              skySum += skyAt(x + o1[0], y + o1[1], z + o1[2]);
              blockSum += blockLightAt(x + o1[0], y + o1[1], z + o1[2]);
              samples++;
            }
            if (!side2) {
              skySum += skyAt(x + o2[0], y + o2[1], z + o2[2]);
              blockSum += blockLightAt(x + o2[0], y + o2[1], z + o2[2]);
              samples++;
            }
            // A corner tucked between two solid neighbours sees nothing round the
            // bend, so the diagonal is only worth sampling when one side is open.
            if (!(side1 && side2) && !corner3) {
              skySum += skyAt(x + o3[0], y + o3[1], z + o3[2]);
              blockSum += blockLightAt(x + o3[0], y + o3[1], z + o3[2]);
              samples++;
            }
            const [cu, cv] = corner.uv;
            cornerShade[cu][cv] = ambient(crowding);
            cornerSky[cu][cv] = skySum / samples / 15;
            cornerBlock[cu][cv] = blockSum / samples / 15;
          }

          // Foliage is warped off the lattice, but only ever by its corners: reading
          // the warp along an edge as a straight blend of the two ends means the face
          // round the corner traces exactly the same line, however either is cut up.
          if (organic) {
            for (let cu = 0; cu < 2; cu++) {
              for (let cv = 0; cv < 2; cv++) {
                const qx = x + ox + cu * tx + cv * bx;
                const qy = y + oy + cu * ty + cv * by;
                const qz = z + oz + cu * tz + cv * bz;
                warpX[cu][cv] = (hash3(qx, qy, qz, 0x1f) - 0.5) * 2 * ORGANIC;
                warpY[cu][cv] = (hash3(qx, qy, qz, 0x2b) - 0.5) * 2 * ORGANIC;
                warpZ[cu][cv] = (hash3(qx, qy, qz, 0x3d) - 0.5) * 2 * ORGANIC;
              }
            }
          }

          const base = builder.position.length / 3;
          for (let row = 0; row < down; row++) {
            const v = vs[row];
            for (let column = 0; column < across; column++) {
              const u = us[column];
              // Where this vertex started, before anything moved it. Everything below
              // is keyed on it, and both faces meeting on an edge arrive at the same
              // numbers for it, which is the whole reason the rounding closes up.
              const localX = ox + u * tx + v * bx;
              const localY = oy + u * ty + v * by;
              const localZ = oz + u * tz + v * bz;
              const flatX = x + localX;
              const flatY = y + localY;
              const flatZ = z + localZ;

              let px = flatX;
              let py = flatY;
              let pz = flatZ;
              let vnx = dx;
              let vny = dy;
              let vnz = dz;
              let leans = 0;
              // Only a vertex sitting against a side that has something to round can
              // round at all: with a block hard against every side of it, no direction
              // but the face's own is open and survey() could only ever say one. The
              // test is worth making because most of a landscape is flat.
              const mayRound =
                (u === 0 && lowU) || (u === 1 && highU) || (v === 0 && lowV) || (v === 1 && highV);
              if (mayRound && surveyed(kinds, flatX, flatY, flatZ, localX, localY, localZ) >= 2) {
                px -= BEVEL * siteX;
                py -= BEVEL * siteY;
                pz -= BEVEL * siteZ;
                // The face's own normal already points the way the world falls away
                // along it, so only the other directions tip the surface over.
                const alongFace = siteX * dx + siteY * dy + siteZ * dz;
                vnx += siteX - alongFace * dx;
                vny += siteY - alongFace * dy;
                vnz += siteZ - alongFace * dz;
                const scale = Math.hypot(vnx, vny, vnz) || 1;
                vnx /= scale;
                vny /= scale;
                vnz /= scale;
                leans = siteOpen - alongFace;
              }
              if (heights) {
                py = y + (localY === 1 ? heights[localX][localZ] : 0);
              }
              if (organic) {
                px += between(warpX, u, v);
                py += between(warpY, u, v);
                pz += between(warpZ, u, v);
              }
              builder.position.push(px, py, pz);
              builder.normal.push(vnx, vny, vnz, 0);
              // Tile-local, with v measured from the top because the array texture is
              // uploaded in image order. Read at the undisplaced position, so the
              // texture simply carries on over the rounding.
              builder.uv.push(u, 1 - v);
              builder.layer.push(layer);
              builder.shade.push(between(cornerShade, u, v) * EDGE_SHADE ** leans);
              builder.light.push(between(cornerSky, u, v), between(cornerBlock, u, v));
            }
          }

          const stride = across;
          for (let j = 0; j + 1 < down; j++) {
            for (let i = 0; i + 1 < across; i++) {
              const a = base + j * stride + i;
              const b = a + 1;
              const c = a + stride;
              const d = c + 1;
              if (frame.handed > 0) builder.index.push(a, b, d, a, d, c);
              else builder.index.push(a, d, b, a, c, d);
            }
          }
        }
      }
    }
  }

  return {
    [PASS_OPAQUE]: finish(builders[PASS_OPAQUE]),
    [PASS_CUTOUT]: finish(builders[PASS_CUTOUT]),
    [PASS_TRANSPARENT]: finish(builders[PASS_TRANSPARENT]),
    [PASS_WATER]: finish(builders[PASS_WATER]),
  };
}

/** Two crossed quads, used for grass, flowers, crops and torches. */
function emitCross(
  builder: Builder,
  layer: number,
  x: number,
  y: number,
  z: number,
  sky: number,
  blockLight: number,
): void {
  const inset = 0.1;
  const quads: [number, number, number, number][] = [
    [inset, inset, 1 - inset, 1 - inset],
    [1 - inset, inset, inset, 1 - inset],
  ];
  for (const [x0, z0, x1, z1] of quads) {
    const base = builder.position.length / 3;
    builder.position.push(
      x + x0, y, z + z0,
      x + x1, y, z + z1,
      x + x0, y + 1, z + z0,
      x + x1, y + 1, z + z1,
    );
    builder.uv.push(
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    );
    for (let i = 0; i < 4; i++) {
      builder.layer.push(layer);
      builder.light.push(sky / 15, blockLight / 15);
      builder.shade.push(1);
      // Foliage is lit as though it faced the sky, which is roughly true of a leaf.
      builder.normal.push(0, 1, 0, 0);
    }
    builder.index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}
