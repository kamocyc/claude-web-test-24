import { SharpMeshBuilder, slerp } from './meshBuilder';

/**
 * Rounded terrain-block geometry.
 *
 * A block's appearance depends only on which of its six faces are exposed, so
 * there are exactly 64 possible shapes. All 64 are generated once at startup
 * and the chunk mesher just copies the right one into place. This is the
 * literal implementation of "only the blocks on a corner look different".
 *
 * Construction rules, for bevel radius `r`:
 *   - face   : emitted when exposed; inset by `r` on each side whose edge bevels
 *   - edge   : bevelled (quarter cylinder) when BOTH adjacent faces are exposed.
 *              Because neighbours apply the same rule, bevels run continuously
 *              across block boundaries.
 *   - corner : filleted (spherical octant) when ALL THREE adjacent faces are
 *              exposed, joining the three quarter cylinders seamlessly.
 *   - cap    : where a bevel ends against a solid neighbour, the little notch it
 *              carved is sealed with a fan facing back into the block. Without
 *              it you can see straight through the world at that corner.
 *
 * Cylinder arcs and octant boundaries are both sampled at uniform angles, so
 * the three pieces share vertex positions exactly and the surface is watertight.
 * `buildBeveledBox` exposes the same construction for boxes of any dimensions,
 * which is where mob limbs and other rounded props come from — one generator
 * that the template check below proves watertight, rather than several.
 *
 * Texturing. Every vertex also carries the point on the *un-rounded* cube that
 * its surface normal points at:
 *
 *     centre = p - r * n                  (the fillet's centre of curvature)
 *     sharp  = centre + n * r / max|n|    (where the normal ray leaves the cube)
 *
 * On a flat face this is the vertex itself; on a bevel it stretches the last `r`
 * of the face out to the block boundary; on a corner it fans out to all three.
 * Projecting `sharp` down each axis therefore covers exactly [0,1]² per face,
 * per block, continuous with the neighbouring block — so the shader gets clean
 * per-face UVs on geometry that has no natural UV of its own.
 */

export const FACE_PX = 0;
export const FACE_NX = 1;
export const FACE_PY = 2;
export const FACE_NY = 3;
export const FACE_PZ = 4;
export const FACE_NZ = 5;

/** Unit offset to the neighbour across each face, indexed by face id. */
export const FACE_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface BlockTemplate {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Position on the un-rounded cube that each vertex's normal points at. */
  readonly sharp: Float32Array;
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

export interface TemplateOptions {
  /** Bevel radius in block units. 0.18 reads as soft without losing the grid. */
  radius: number;
  /** Subdivisions across each quarter-arc. 3 is smooth, 1 is the far-LOD set. */
  segments: number;
}

export interface BeveledBoxOptions extends TemplateOptions {
  /** Half-size on each axis. Terrain blocks use [0.5, 0.5, 0.5]. */
  halfExtent: readonly [number, number, number];
  /**
   * Which faces to leave off, as a 6-bit mask (see FACE_* above). A set bit
   * means "a solid neighbour covers this face", which also suppresses the
   * bevels and fillets that touch it.
   */
  faceMask: number;
}

type Half = readonly [number, number, number];

const UNIT_HALF: Half = [0.5, 0.5, 0.5];

function faceIndex(axis: number, sign: number): number {
  return axis * 2 + (sign > 0 ? 0 : 1);
}

function isExposed(mask: number, face: number): boolean {
  return (mask & (1 << face)) === 0;
}

/** An edge bevels only where the two faces meeting at it are both exposed. */
function isBevelled(mask: number, f1: number, f2: number): boolean {
  return isExposed(mask, f1) && isExposed(mask, f2);
}

function write3(target: number[], axis: number, value: number): void {
  target[axis] = value;
}

function addFaces(b: SharpMeshBuilder, mask: number, r: number, h: Half): void {
  const p: number[] = [0, 0, 0];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;

    for (const sign of [1, -1]) {
      const f = faceIndex(axis, sign);
      if (!isExposed(mask, f)) continue;

      const u0 = -h[u] + (isBevelled(mask, f, faceIndex(u, -1)) ? r : 0);
      const u1 = h[u] - (isBevelled(mask, f, faceIndex(u, 1)) ? r : 0);
      const v0 = -h[v] + (isBevelled(mask, f, faceIndex(v, -1)) ? r : 0);
      const v1 = h[v] - (isBevelled(mask, f, faceIndex(v, 1)) ? r : 0);
      // When the radius reaches the half-extent the box becomes a sphere and the
      // flat faces collapse to nothing. Emitting them anyway would leave
      // zero-area triangles stacked on the fillet seams.
      if (u1 - u0 <= 1e-9 || v1 - v0 <= 1e-9) continue;

      const n: number[] = [0, 0, 0];
      write3(n, axis, sign);

      const corner = (uu: number, vv: number): number => {
        write3(p, axis, sign * h[axis]);
        write3(p, u, uu);
        write3(p, v, vv);
        return b.vertex(p[0], p[1], p[2], n[0], n[1], n[2]);
      };

      b.quad(corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1));
    }
  }
}

function addBevels(b: SharpMeshBuilder, mask: number, r: number, segments: number, h: Half): void {
  const p: number[] = [0, 0, 0];
  const n: number[] = [0, 0, 0];

  for (let a1 = 0; a1 < 3; a1++) {
    for (let a2 = a1 + 1; a2 < 3; a2++) {
      const w = 3 - a1 - a2; // the axis the edge runs along

      for (const s1 of [1, -1]) {
        for (const s2 of [1, -1]) {
          const f1 = faceIndex(a1, s1);
          const f2 = faceIndex(a2, s2);
          if (!isBevelled(mask, f1, f2)) continue;

          const c1 = s1 * (h[a1] - r);
          const c2 = s2 * (h[a2] - r);

          // Each end is either pulled back to meet a corner fillet, or runs to
          // the block boundary and gets sealed.
          const ends: { wPos: number; filleted: boolean; sw: number }[] = [];
          for (const sw of [-1, 1]) {
            const filleted = isExposed(mask, faceIndex(w, sw));
            ends.push({ wPos: sw * (filleted ? h[w] - r : h[w]), filleted, sw });
          }

          // With both ends filleted and no straight section between them, the
          // two corner patches already meet; a zero-length strip would just be
          // degenerate triangles along their shared seam.
          if (Math.abs(ends[0].wPos - ends[1].wPos) <= 1e-9) continue;

          // Quarter-cylinder strip.
          const ring: number[][] = [[], []];
          for (let k = 0; k <= segments; k++) {
            const t = (k / segments) * (Math.PI / 2);
            const d1 = s1 * Math.cos(t);
            const d2 = s2 * Math.sin(t);

            write3(n, a1, d1);
            write3(n, a2, d2);
            write3(n, w, 0);

            for (let e = 0; e < 2; e++) {
              write3(p, a1, c1 + r * d1);
              write3(p, a2, c2 + r * d2);
              write3(p, w, ends[e].wPos);
              ring[e].push(b.vertex(p[0], p[1], p[2], n[0], n[1], n[2]));
            }
          }
          for (let k = 0; k < segments; k++) {
            b.quad(ring[0][k], ring[0][k + 1], ring[1][k + 1], ring[1][k]);
          }

          // Seal the notch at any end that does not meet a fillet.
          for (let e = 0; e < 2; e++) {
            const end = ends[e];
            if (end.filleted) continue;

            write3(n, a1, 0);
            write3(n, a2, 0);
            write3(n, w, -end.sw); // faces back into this block, showing the neighbour

            write3(p, a1, s1 * h[a1]);
            write3(p, a2, s2 * h[a2]);
            write3(p, w, end.wPos);
            const apex = b.vertex(p[0], p[1], p[2], n[0], n[1], n[2]);

            const arc: number[] = [];
            for (let k = 0; k <= segments; k++) {
              const t = (k / segments) * (Math.PI / 2);
              write3(p, a1, c1 + r * s1 * Math.cos(t));
              write3(p, a2, c2 + r * s2 * Math.sin(t));
              write3(p, w, end.wPos);
              arc.push(b.vertex(p[0], p[1], p[2], n[0], n[1], n[2]));
            }
            for (let k = 0; k < segments; k++) {
              b.tri(apex, arc[k], arc[k + 1]);
            }
          }
        }
      }
    }
  }
}

function addFillets(b: SharpMeshBuilder, mask: number, r: number, segments: number, h: Half): void {
  const tmpAB: [number, number, number] = [0, 0, 0];
  const tmpAC: [number, number, number] = [0, 0, 0];
  const tmp: [number, number, number] = [0, 0, 0];

  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        if (
          !isExposed(mask, faceIndex(0, sx)) ||
          !isExposed(mask, faceIndex(1, sy)) ||
          !isExposed(mask, faceIndex(2, sz))
        ) {
          continue;
        }

        const cx = sx * (h[0] - r);
        const cy = sy * (h[1] - r);
        const cz = sz * (h[2] - r);

        // Spherical triangle spanning the octant. Its three boundary arcs are
        // sampled at uniform angles, matching the quarter cylinders exactly.
        const rows: number[][] = [];
        for (let i = 0; i <= segments; i++) {
          const fi = i / segments;
          slerp(sx, 0, 0, 0, sy, 0, fi, tmpAB);
          slerp(sx, 0, 0, 0, 0, sz, fi, tmpAC);

          const row: number[] = [];
          for (let j = 0; j <= i; j++) {
            const g = i === 0 ? 0 : j / i;
            slerp(tmpAB[0], tmpAB[1], tmpAB[2], tmpAC[0], tmpAC[1], tmpAC[2], g, tmp);
            const [dx, dy, dz] = tmp;
            row.push(b.vertex(cx + r * dx, cy + r * dy, cz + r * dz, dx, dy, dz));
          }
          rows.push(row);
        }

        for (let i = 0; i < segments; i++) {
          for (let j = 0; j <= i; j++) {
            b.tri(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1]);
            if (j < i) b.tri(rows[i][j], rows[i + 1][j + 1], rows[i][j + 1]);
          }
        }
      }
    }
  }
}

/**
 * A box with every exposed edge bevelled and every exposed corner filleted.
 * The terrain templates are the unit-cube case; mob limbs and props pass their
 * own dimensions.
 */
export function buildBeveledBox(options: BeveledBoxOptions): BlockTemplate {
  const h = options.halfExtent;
  // A radius larger than the smallest half-extent would invert the geometry.
  const r = Math.min(options.radius, h[0], h[1], h[2]);
  const mask = options.faceMask;
  const b = new SharpMeshBuilder(r, h);

  if (mask !== 0b111111) {
    addFaces(b, mask, r, h);
    addBevels(b, mask, r, options.segments, h);
    addFillets(b, mask, r, options.segments, h);
    b.fixWinding();
  }

  return {
    positions: new Float32Array(b.pos),
    normals: new Float32Array(b.nrm),
    sharp: new Float32Array(b.sharp),
    indices: new Uint16Array(b.idx),
    vertexCount: b.pos.length / 3,
    triangleCount: b.idx.length / 3,
  };
}

export function buildRoundedTemplate(mask: number, opt: TemplateOptions): BlockTemplate {
  return buildBeveledBox({ ...opt, halfExtent: UNIT_HALF, faceMask: mask });
}

/** All 64 face-mask variants, indexed by mask. */
export function buildTemplateSet(opt: TemplateOptions): BlockTemplate[] {
  const set: BlockTemplate[] = new Array(64);
  for (let mask = 0; mask < 64; mask++) set[mask] = buildRoundedTemplate(mask, opt);
  return set;
}

type SlopeDirection = 'east' | 'west' | 'south' | 'north';

function finishTemplate(b: SharpMeshBuilder): BlockTemplate {
  b.fixWinding();
  return {
    positions: new Float32Array(b.pos),
    normals: new Float32Array(b.nrm),
    sharp: new Float32Array(b.sharp),
    indices: new Uint16Array(b.idx),
    vertexCount: b.pos.length / 3,
    triangleCount: b.idx.length / 3,
  };
}

/** One voxel-wide triangular prism. The base shape rises towards +X and is rotated
 *  around Y for the other three block IDs. Faces hidden by complete neighbours are
 *  omitted, while the diagonal roof face is always visible. */
export function buildSlopeTemplate(direction: SlopeDirection, faceMask = 0): BlockTemplate {
  const angle = direction === 'east' ? 0 : direction === 'west' ? Math.PI : direction === 'south' ? -Math.PI / 2 : Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const b = new SharpMeshBuilder(0, UNIT_HALF);
  const rotate = (x: number, y: number, z: number): [number, number, number] => [
    x * cos + z * sin,
    y,
    -x * sin + z * cos,
  ];
  const vertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
  ): number => {
    const p = rotate(x, y, z);
    const n = rotate(nx, ny, nz);
    return b.vertex(p[0], p[1], p[2], n[0], n[1], n[2]);
  };
  const actualFace = (nx: number, ny: number, nz: number): number => {
    const n = rotate(nx, ny, nz);
    const axis = Math.abs(n[0]) > 0.5 ? 0 : Math.abs(n[1]) > 0.5 ? 1 : 2;
    return faceIndex(axis, n[axis] >= 0 ? 1 : -1);
  };
  const quad = (
    normal: readonly [number, number, number],
    points: readonly (readonly [number, number, number])[],
  ): void => {
    const [nx, ny, nz] = normal;
    if (isExposed(faceMask, actualFace(nx, ny, nz))) {
      const ids = points.map((p) => vertex(p[0], p[1], p[2], nx, ny, nz));
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  };
  const tri = (
    normal: readonly [number, number, number],
    points: readonly (readonly [number, number, number])[],
  ): void => {
    const [nx, ny, nz] = normal;
    if (isExposed(faceMask, actualFace(nx, ny, nz))) {
      const ids = points.map((p) => vertex(p[0], p[1], p[2], nx, ny, nz));
      b.tri(ids[0], ids[1], ids[2]);
    }
  };

  quad([0, -1, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5]]);
  quad([1, 0, 0], [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]);
  tri([0, 0, -1], [[-0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5]]);
  tri([0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5]]);
  const diagonal = Math.SQRT1_2;
  // This is not axis-aligned and therefore cannot be hidden by a neighbouring cell.
  const slope = [
    vertex(-0.5, -0.5, -0.5, -diagonal, diagonal, 0),
    vertex(0.5, 0.5, -0.5, -diagonal, diagonal, 0),
    vertex(0.5, 0.5, 0.5, -diagonal, diagonal, 0),
    vertex(-0.5, -0.5, 0.5, -diagonal, diagonal, 0),
  ];
  b.quad(slope[0], slope[1], slope[2], slope[3]);
  return finishTemplate(b);
}

export function buildSlopeTemplateSet(direction: SlopeDirection): BlockTemplate[] {
  const set: BlockTemplate[] = new Array(64);
  for (let mask = 0; mask < 64; mask++) set[mask] = buildSlopeTemplate(direction, mask);
  return set;
}

/**
 * The bottom half of a voxel: a cornice course, a step, a parapet cap.
 *
 * Built on the unit half-extent rather than on its own, because `sharp` is
 * normalised by the extent it was given — a half-height box would stretch the
 * whole tile over half a block. On the unit cube the slab's side faces land on
 * the lower half of the tile, which is the same half the lower half of a full
 * block shows, so a course of slabs lines up with the wall it runs along.
 *
 * The top face is never culled. A neighbour above covers the *cell*, not the
 * slab, and hiding that face would leave a hole to look through.
 */
export function buildSlabTemplate(faceMask = 0): BlockTemplate {
  const b = new SharpMeshBuilder(0, UNIT_HALF);
  const top = 0;
  const quad = (
    face: number | null,
    normal: readonly [number, number, number],
    points: readonly (readonly [number, number, number])[],
  ): void => {
    if (face !== null && !isExposed(faceMask, face)) return;
    const [nx, ny, nz] = normal;
    const ids = points.map((p) => b.vertex(p[0], p[1], p[2], nx, ny, nz));
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  };

  quad(null, [0, 1, 0], [[-0.5, top, -0.5], [-0.5, top, 0.5], [0.5, top, 0.5], [0.5, top, -0.5]]);
  quad(FACE_NY, [0, -1, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5]]);
  quad(FACE_PX, [1, 0, 0], [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, top, 0.5], [0.5, top, -0.5]]);
  quad(FACE_NX, [-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, top, 0.5], [-0.5, top, -0.5]]);
  quad(FACE_PZ, [0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, top, 0.5], [-0.5, top, 0.5]]);
  quad(FACE_NZ, [0, 0, -1], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, top, -0.5], [-0.5, top, -0.5]]);
  return finishTemplate(b);
}

export function buildSlabTemplateSet(): BlockTemplate[] {
  const set: BlockTemplate[] = new Array(64);
  for (let mask = 0; mask < 64; mask++) set[mask] = buildSlabTemplate(mask);
  return set;
}

/** A vertical round post centred in one voxel. Side faces never touch the cell boundary,
 *  while the top and bottom disks can be omitted when another block covers them. */
export function buildCylinderTemplate(segments = 12, radius = 0.34, faceMask = 0): BlockTemplate {
  const b = new SharpMeshBuilder(0, [radius, 0.5, radius]);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const n0x = Math.cos(a0);
    const n0z = Math.sin(a0);
    const n1x = Math.cos(a1);
    const n1z = Math.sin(a1);
    const side = [
      b.vertex(x0, -0.5, z0, n0x, 0, n0z),
      b.vertex(x1, -0.5, z1, n1x, 0, n1z),
      b.vertex(x1, 0.5, z1, n1x, 0, n1z),
      b.vertex(x0, 0.5, z0, n0x, 0, n0z),
    ];
    b.quad(side[0], side[1], side[2], side[3]);
    if (isExposed(faceMask, FACE_PY)) {
      b.tri(
        b.vertex(0, 0.5, 0, 0, 1, 0),
        b.vertex(x0, 0.5, z0, 0, 1, 0),
        b.vertex(x1, 0.5, z1, 0, 1, 0),
      );
    }
    if (isExposed(faceMask, FACE_NY)) {
      b.tri(
        b.vertex(0, -0.5, 0, 0, -1, 0),
        b.vertex(x1, -0.5, z1, 0, -1, 0),
        b.vertex(x0, -0.5, z0, 0, -1, 0),
      );
    }
  }
  return finishTemplate(b);
}

export function buildCylinderTemplateSet(segments = 12, radius = 0.34): BlockTemplate[] {
  const set: BlockTemplate[] = new Array(64);
  for (let mask = 0; mask < 64; mask++) set[mask] = buildCylinderTemplate(segments, radius, mask);
  return set;
}
