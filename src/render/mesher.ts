import { Block, type BlockId, blockDef } from '../world/blocks';
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

export interface GeometryArrays {
  position: Float32Array;
  uv: Float32Array;
  /** Per vertex: skylight and block light, both 0..1. */
  light: Float32Array;
  /** Per vertex: ambient occlusion alone, 0..1. Directional shading is no longer
   *  baked in: the shader lights each face against the real sun direction. */
  shade: Float32Array;
  /** Per vertex: where the corner sits on its own face, 0..1 on both axes. The shader
   *  uses it to round off the block's edges. A vertex at (0.5, 0.5) is never bevelled. */
  face: Float32Array;
  /** Per vertex: which of the six cube faces this belongs to, as an index into
   *  FACE_BASIS. The shader rebuilds the surface frame from it. */
  faceId: Float32Array;
  /** Per vertex: which layer of the array texture to sample. Constant across a quad. */
  layer: Float32Array;
  /** Per vertex: which of the face's four edges end at a silhouette, as a bitmask of
   *  -u, +u, -v, +v. An edge whose surface carries on into the next block is only
   *  lightly creased; one that stops is rounded off in full. */
  edges: Float32Array;
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
  /** World direction in which the face's own u coordinate grows. */
  tangent: readonly [number, number, number];
  /** World direction in which the face's own v coordinate grows. */
  bitangent: readonly [number, number, number];
}

/** The surface frame of each cube face, read straight off the corner table so the
 *  shader's idea of "along the face" can never drift from the mesh's. Index into it
 *  with the faceId attribute. */
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
  return { normal: face.dir, tangent: along(at(1, 0)), bitangent: along(at(0, 1)) };
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

const AO_LEVELS = [0.54, 0.73, 0.89, 1];

/** Index of the +Y face in RAW_FACES. */
const UP_FACE = 3;
/** All four edges of a face free-standing. */
const ALL_EDGES = 15;

const TRANSPARENT_BLOCKS = new Set<BlockId>([Block.GLASS, Block.ICE]);

export function passOf(id: BlockId): Pass {
  if (id === Block.WATER) return PASS_WATER;
  if (TRANSPARENT_BLOCKS.has(id)) return PASS_TRANSPARENT;
  const def = blockDef(id);
  if (def.render === 'cross') return PASS_CUTOUT;
  return def.opaque ? PASS_OPAQUE : PASS_CUTOUT;
}

interface Builder {
  position: number[];
  uv: number[];
  light: number[];
  shade: number[];
  face: number[];
  faceId: number[];
  layer: number[];
  edges: number[];
  index: number[];
}

function newBuilder(): Builder {
  return {
    position: [], uv: [], light: [], shade: [], face: [], faceId: [], layer: [], edges: [], index: [],
  };
}

function finish(builder: Builder): GeometryArrays | null {
  if (builder.index.length === 0) return null;
  return {
    position: new Float32Array(builder.position),
    uv: new Float32Array(builder.uv),
    light: new Float32Array(builder.light),
    shade: new Float32Array(builder.shade),
    face: new Float32Array(builder.face),
    faceId: new Float32Array(builder.faceId),
    layer: new Float32Array(builder.layer),
    edges: new Float32Array(builder.edges),
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

  const occludes = (x: number, y: number, z: number): boolean => blockDef(blockAt(x, y, z)).opaque;

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

          // An edge only reads as an edge where the surface actually stops. Where the
          // next block along shows the same face, the two are one continuous plane and
          // rounding them apart would quilt a flat field into a grid of cushions.
          const frame = FACE_BASIS[faceIndex];
          const carriesOn = (ox: number, oy: number, oz: number): boolean =>
            occludes(x + ox, y + oy, z + oz) &&
            !occludes(x + ox + face.dir[0], y + oy + face.dir[1], z + oz + face.dir[2]);
          const [tx, ty, tz] = frame.tangent;
          const [bx, by, bz] = frame.bitangent;
          let edges = 0;
          if (!carriesOn(-tx, -ty, -tz)) edges |= 1;
          if (!carriesOn(tx, ty, tz)) edges |= 2;
          if (!carriesOn(-bx, -by, -bz)) edges |= 4;
          if (!carriesOn(bx, by, bz)) edges |= 8;

          const base = builder.position.length / 3;
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const cy =
              corner.pos[1] === 1 ? (heights ? heights[corner.pos[0]][corner.pos[2]] : 1) : 0;
            builder.position.push(x + corner.pos[0], y + cy, z + corner.pos[2]);
            // Tile-local, with v measured from the top because the array texture is
            // uploaded in image order.
            builder.uv.push(corner.uv[0], 1 - corner.uv[1]);
            builder.layer.push(layer);
            // A river is one continuous sheet, so its cells must not be bevelled into
            // a grid of separate pillows.
            if (id === Block.WATER) builder.face.push(0.5, 0.5);
            else builder.face.push(corner.uv[0], corner.uv[1]);
            builder.faceId.push(faceIndex);
            builder.edges.push(edges);

            // The four cells meeting this corner on the lit side of the face decide
            // both how occluded it is and how much light reaches it. Sampling all four
            // is what turns the old flat quads into a smooth gradient across a wall.
            const [o1, o2, o3] = face.ao[c];
            const side1 = occludes(x + o1[0], y + o1[1], z + o1[2]);
            const side2 = occludes(x + o2[0], y + o2[1], z + o2[2]);
            const corner3 = occludes(x + o3[0], y + o3[1], z + o3[2]);
            const level = side1 && side2 ? 0 : 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner3 ? 1 : 0));
            builder.shade.push(AO_LEVELS[level]);

            let skySum = skyAt(nx, ny, nz);
            let blockSum = blockLightAt(nx, ny, nz);
            let samples = 1;
            // A corner tucked between two solid neighbours sees nothing round the
            // bend, so the diagonal is only worth sampling when one side is open.
            const openDiagonal = !(side1 && side2);
            for (const [offset, blocked] of [
              [o1, side1],
              [o2, side2],
              [o3, !openDiagonal || corner3],
            ] as const) {
              if (blocked) continue;
              skySum += skyAt(x + offset[0], y + offset[1], z + offset[2]);
              blockSum += blockLightAt(x + offset[0], y + offset[1], z + offset[2]);
              samples++;
            }
            builder.light.push(skySum / samples / 15, blockSum / samples / 15);
          }
          builder.index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
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
      builder.face.push(0.5, 0.5);
      // Foliage is lit as though it faced the sky, which is roughly true of a leaf.
      builder.faceId.push(UP_FACE);
      builder.edges.push(ALL_EDGES);
    }
    builder.index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}
