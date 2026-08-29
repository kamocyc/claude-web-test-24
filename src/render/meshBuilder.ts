/**
 * Tiny indexed triangle-mesh accumulator used by every procedural geometry
 * generator in the project (block templates, posts, trees, mobs).
 *
 * Winding is not the caller's problem: `fixWinding()` flips any triangle whose
 * geometric normal disagrees with its vertex normals, so generators can emit
 * vertices in whatever order is convenient for the maths.
 */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
    const i = this.pos.length / 3;
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Flip triangles whose geometric normal points away from their vertex normals. */
  fixWinding(): void {
    const { pos, nrm, idx } = this;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;

      const e1x = pos[b] - pos[a];
      const e1y = pos[b + 1] - pos[a + 1];
      const e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a];
      const e2y = pos[c + 1] - pos[a + 1];
      const e2z = pos[c + 2] - pos[a + 2];

      const gx = e1y * e2z - e1z * e2y;
      const gy = e1z * e2x - e1x * e2z;
      const gz = e1x * e2y - e1y * e2x;

      const nx = nrm[a] + nrm[b] + nrm[c];
      const ny = nrm[a + 1] + nrm[b + 1] + nrm[c + 1];
      const nz = nrm[a + 2] + nrm[b + 2] + nrm[c + 2];

      if (gx * nx + gy * ny + gz * nz < 0) {
        const tmp = idx[t + 1];
        idx[t + 1] = idx[t + 2];
        idx[t + 2] = tmp;
      }
    }
  }
}

/**
 * A MeshBuilder that also records each vertex's "sharp progenitor": the point
 * where its surface normal, traced from the centre of curvature, leaves the
 * block's bounding box. That point is what the terrain shader uses for UVs,
 * because bevels and corner fillets have no natural UV of their own.
 *
 * `halfExtent` is the box the normals are traced to. Shapes narrower than a full
 * block (a post, say) pass their own half-width so the texture still spans the
 * whole face instead of showing a cropped strip.
 */
export class SharpMeshBuilder extends MeshBuilder {
  readonly sharp: number[] = [];

  constructor(
    private readonly radius: number,
    private readonly halfExtent: readonly [number, number, number] = [0.5, 0.5, 0.5],
  ) {
    super();
  }

  override vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
    const r = this.radius;
    const [hx, hy, hz] = this.halfExtent;
    const cx = px - r * nx;
    const cy = py - r * ny;
    const cz = pz - r * nz;

    // Ray-box intersection: the nearest face the normal would exit through.
    let t = Infinity;
    const axis = (c: number, n: number, h: number): void => {
      if (Math.abs(n) < 1e-9) return;
      const hit = ((n > 0 ? h : -h) - c) / n;
      if (hit >= 0 && hit < t) t = hit;
    };
    axis(cx, nx, hx);
    axis(cy, ny, hy);
    axis(cz, nz, hz);
    if (!Number.isFinite(t)) t = 0;

    // Normalised to [-0.5, 0.5] so the shader can just add 0.5 to get a UV.
    this.sharp.push(
      (cx + t * nx) / (hx * 2),
      (cy + t * ny) / (hy * 2),
      (cz + t * nz) / (hz * 2),
    );
    return super.vertex(px, py, pz, nx, ny, nz);
  }
}

/** Spherical linear interpolation between two unit vectors, written into `out`. */
export function slerp(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
  out: [number, number, number],
): [number, number, number] {
  let dot = ax * bx + ay * by + az * bz;
  dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
  const omega = Math.acos(dot);

  if (omega < 1e-6) {
    out[0] = ax; out[1] = ay; out[2] = az;
    return out;
  }

  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s;
  const wb = Math.sin(t * omega) / s;
  out[0] = ax * wa + bx * wb;
  out[1] = ay * wa + by * wb;
  out[2] = az * wa + bz * wb;
  return out;
}

