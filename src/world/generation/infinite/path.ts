/**
 * Polyline helpers the river builder needs: even resampling, a centripetal
 * Catmull-Rom pass and a curvature limiter.
 *
 * Ported from the reference generator's `src/rendering/path-geometry.ts`. That
 * file builds three.js geometry; these three functions are the only ones the
 * river network touches and none of them knows what a mesh is, so they come
 * across as plain maths. Distances are in blocks here, not metres.
 */
import { lerp } from './grid';

export interface RibbonPoint { x: number; z: number; w: number; y?: number }

/** Redistribute a rounded path at an even interval, in blocks. */
export function resamplePath(points: RibbonPoint[], spacing = 2.4): RibbonPoint[] {
  if (points.length < 2) return points;
  const distance = new Float32Array(points.length);
  for (let i = 1; i < points.length; i++) {
    distance[i] = distance[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  const total = distance[distance.length - 1];
  if (total <= spacing) return [points[0], points[points.length - 1]];
  const segments = Math.max(1, Math.ceil(total / spacing)), sampled: RibbonPoint[] = [];
  let edge = 1;
  for (let k = 0; k <= segments; k++) {
    const target = total * k / segments;
    while (edge < distance.length - 1 && distance[edge] < target) edge++;
    const a = points[edge - 1], b = points[edge], span = distance[edge] - distance[edge - 1];
    const t = span > 1e-6 ? (target - distance[edge - 1]) / span : 0;
    sampled.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), w: lerp(a.w, b.w, t) });
  }
  return sampled;
}

/**
 * Centripetal Catmull-Rom (alpha = 0.5). Chaikin only cuts corners, which leaves
 * the curvature discontinuous at every original vertex; this interpolates the
 * points themselves and gives roads and rivers a continuous tangent. Endpoints
 * are pinned so junctions between paths stay put.
 */
export function catmullRom(points: RibbonPoint[], spacing = 2.4): RibbonPoint[] {
  if (points.length < 3) return points;
  const pointAt = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const out: RibbonPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = pointAt(i - 1), p1 = points[i], p2 = points[i + 1], p3 = pointAt(i + 2);
    const span = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(1, Math.round(span / spacing));
    // Knot spacing by sqrt of chord length: this is what stops the cusps and
    // self-intersections a uniform parameterisation produces on tight turns.
    const knot = (a: RibbonPoint, b: RibbonPoint) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let k = 0; k < steps; k++) {
      const t = t1 + (t2 - t1) * (k / steps);
      const a1 = blend(p0, p1, t0, t1, t), a2 = blend(p1, p2, t1, t2, t), a3 = blend(p2, p3, t2, t3, t);
      const b1 = blend(a1, a2, t0, t2, t), b2 = blend(a2, a3, t1, t3, t);
      out.push(blend(b1, b2, t1, t2, t));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function blend(a: RibbonPoint, b: RibbonPoint, ta: number, tb: number, t: number): RibbonPoint {
  const span = tb - ta;
  const u = Math.abs(span) < 1e-9 ? 0 : (t - ta) / span;
  return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), w: lerp(a.w, b.w, u) };
}

/**
 * Relax a polyline until no vertex turns tighter than `minRadius`, keeping it
 * within `maxDrift` of the routed corridor. Railways cannot take the 45-degree
 * kinks an 8-neighbour A* emits; roads only need a milder version of the same.
 */
export function limitCurvature(points: RibbonPoint[], minRadius: number, maxDrift: number, iterations = 48): RibbonPoint[] {
  if (points.length < 3) return points;
  const current = points.map(p => ({ ...p }));
  const origin = points.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1], b = current[i], c = current[i + 1];
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
      const ca = Math.hypot(a.x - c.x, a.z - c.z);
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) * 0.5;
      // Circumradius of the three points; a straight run gives Infinity.
      const radius = area < 1e-9 ? Infinity : (ab * bc * ca) / (4 * area);
      if (radius >= minRadius) continue;
      const pull = Math.min(0.5, 0.5 * (1 - radius / minRadius));
      let nx = b.x + ((a.x + c.x) * 0.5 - b.x) * pull;
      let nz = b.z + ((a.z + c.z) * 0.5 - b.z) * pull;
      const dx = nx - origin[i].x, dz = nz - origin[i].z, drift = Math.hypot(dx, dz);
      if (drift > maxDrift) { nx = origin[i].x + dx / drift * maxDrift; nz = origin[i].z + dz / drift * maxDrift; }
      b.x = nx; b.z = nz; moved = true;
    }
    if (!moved) break;
  }
  return current;
}

