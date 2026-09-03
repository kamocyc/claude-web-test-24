/**
 * The drainage solution: flood the depressions, work out where every cell's
 * water goes, open the ones that should not have been lakes, let the channels
 * meander, then cut them in and flatten the floodplain around them.
 *
 * Ported from the reference generator's `src/generator/hydrology.ts`
 * (kamocyc/ctest105_city_terrain_generator, branch
 * `claude/infinite-terrain-river-sim-fgq43a`), keeping only what the infinite
 * pipeline calls. Two changes from the original:
 *
 *  - the whole-map helpers are gone (`makeTerrain`, `makeSea`, `oceanAtLevel`,
 *    `steepenHighGround`, `buildSuitability`, `findLakes`). There is no map here
 *    to take a quantile of; `calibrate.ts` answers those questions instead.
 *  - the `GridSpec` parameters lost their whole-map default. Every array here
 *    belongs to a tile at some world origin, so forgetting to say which one is
 *    a type error rather than a silently wrong world.
 */
import { DX, DY, MinHeap, clamp, fbm, lerp } from './grid';
import type { GridSpec } from './gridspec';
import type { GeneratorParams } from './params';

/**
 * Above this fraction of the land relief the mountain stops behaving like a
 * rolling hill: the upper slopes gain extra height and a crag field, so the
 * gradient grows with altitude instead of staying uniform from shore to summit.
 * Roads and rail price a step by the height they climb, so this is what makes a
 * ridge genuinely expensive to cross while valleys and plains are untouched.
 */
const ALPINE_START = 0.52;
/** Extra summit height, as a fraction of the land relief before steepening. */
const ALPINE_LIFT = 0.62;
/** Crags cut and stack on the upper slopes; the amplitude is relief-relative. */
const CRAG_AMPLITUDE = 0.15;
/**
 * Roughly a 500 m wavelength: coarse enough to read as spurs and gullies on a
 * simulation grid, fine enough that the ridge is not one smooth dome. Going
 * finer than this only produces single-cell spikes the interpolated surface
 * overshoots.
 */
const CRAG_FREQUENCY = 9.5;

/**
 * The extra height the upper slopes gain, for one cell. Shared with the infinite
 * mode, which cannot take `shore` and `relief` from a whole-map reduction and
 * calibrates them against a fixed world-wide sample instead.
 */
export function alpineLift(height: number, u: number, v: number, shore: number, relief: number, p: GeneratorParams): number {
  const alpine = clamp(((height - shore) / relief - ALPINE_START) / (1 - ALPINE_START));
  if (alpine <= 0) return 0;
  // Squared, so the added height climbs faster than the altitude it is added
  // to: that is the whole point, a gradient that stiffens towards the summit.
  const shape = alpine * alpine;
  const lift = ALPINE_LIFT * (0.3 + 0.7 * p.rugged), crag = CRAG_AMPLITUDE * (0.25 + 0.75 * p.rugged);
  const rock = 1 - Math.abs(fbm(u * CRAG_FREQUENCY, v * CRAG_FREQUENCY, p.seed + 2711, 4));
  return relief * (lift * shape + crag * shape * (rock - 0.52));
}

export function priorityFlood(terrain: Float32Array, sea: Uint8Array, g: GridSpec) {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const filled = new Float32Array(terrain);
  const parent = new Int32Array(len); parent.fill(-2);
  const visited = new Uint8Array(len), heap = new MinHeap(), order: number[] = [];
  const add = (i: number) => {
    if (visited[i]) return;
    visited[i] = 1; parent[i] = -1; heap.push([filled[i], i]);
  };
  for (let i = 0; i < len; i++) if (sea[i]) add(i);
  for (let x = 0; x < n; x++) { add(at(x, 0)); add(at(x, n - 1)); }
  for (let y = 0; y < n; y++) { add(at(0, y)); add(at(n - 1, y)); }
  while (heap.length) {
    const [z, i] = heap.pop(); order.push(i);
    const x = i % n, y = Math.floor(i / n);
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = at(nx, ny);
      if (visited[j]) continue;
      visited[j] = 1; parent[j] = i;
      if (!sea[j] && filled[j] <= z) filled[j] = z + 0.00001;
      heap.push([filled[j], j]);
    }
  }
  return { filled, parent, order };
}

/**
 * Catchment area in cells, by walking the flood order backwards. `inflow` is how
 * a tile learns about the water arriving from outside it: the coarse pass writes
 * the discharge entering at each halo cell there, so a river crossing a
 * super-chunk boundary keeps the width its real catchment gives it.
 */
export function accumulate(parent: Int32Array, order: number[], sea: Uint8Array,
  g: GridSpec, inflow?: Float64Array): Float64Array {
  const len = g.size * g.size;
  const acc = new Float64Array(len);
  for (let i = 0; i < len; i++) acc[i] = sea[i] ? 0 : 1 + (inflow ? inflow[i] : 0);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k], p = parent[i];
    if (p >= 0) acc[p] += acc[i];
  }
  return acc;
}

export function slopeAt(h: Float32Array, x: number, y: number, g: GridSpec): number {
  const n = g.size, at = (px: number, py: number) => py * n + px;
  const xm = Math.max(0, x - 1), xp = Math.min(n - 1, x + 1);
  const ym = Math.max(0, y - 1), yp = Math.min(n - 1, y + 1);
  return Math.hypot(h[at(xp, y)] - h[at(xm, y)], h[at(x, yp)] - h[at(x, ym)]) * 0.5;
}

export function riverThresholdFor(acc: Float64Array, sea: Uint8Array, density: number, g: GridSpec): number {
  if (density <= 0.005) return Infinity;
  const len = g.size * g.size;
  const values: number[] = [];
  for (let i = 0; i < len; i++) if (!sea[i] && acc[i] > 1) values.push(Math.log1p(acc[i]));
  values.sort((a, b) => a - b);
  const q = lerp(0.992, 0.94, density);
  return Math.expm1(values[Math.floor((values.length - 1) * q)] ?? Math.log(80));
}

/** Open significant depressions through their spill rim before the final flood pass. */
/**
 * `maxSpan` bounds how wide a depression may be and still be opened. The
 * spillway is traced down a drainage path of unbounded length, which a tile with
 * a finite halo cannot follow; a depression too wide to have been resolved
 * inside the tile is left alone and becomes a lake instead, which is the same
 * answer both neighbours reach.
 */
export function breachDepressions(height: Float32Array, sea: Uint8Array, hydro: ReturnType<typeof priorityFlood>,
  basinAmount: number, g: GridSpec, maxSpan = Infinity) {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const out = new Float32Array(height), depression = new Uint8Array(len), seen = new Uint8Array(len);
  const queue = new Int32Array(len); let breaches = 0;
  for (let i = 0; i < len; i++) if (!sea[i] && hydro.filled[i] - height[i] > 0.003) depression[i] = 1;
  for (let root = 0; root < len; root++) {
    if (!depression[root] || seen[root]) continue;
    let head = 0, tail = 0, deepest = root, maxDepth = hydro.filled[root] - height[root];
    let minX = root % n, maxX = minX, minY = Math.floor(root / n), maxY = minY;
    queue[tail++] = root; seen[root] = 1;
    while (head < tail) {
      const i = queue[head++], depth = hydro.filled[i] - height[i];
      if (height[i] < height[deepest]) deepest = i;
      maxDepth = Math.max(maxDepth, depth);
      const x = i % n, y = Math.floor(i / n);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = at(nx, ny);
        if (depression[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    if (tail < Math.round(18 - 10 * basinAmount) || maxDepth < 0.008) continue;
    if (maxX - minX > maxSpan || maxY - minY > maxSpan) continue;
    const path: number[] = []; let current = deepest, guard = 0;
    while (current >= 0 && guard++ < len) {
      path.push(current);
      const next = hydro.parent[current];
      if (next < 0) break;
      current = next;
      if (!depression[current]) { path.push(current); break; }
    }
    if (path.length < 2) continue;
    let z = out[path[0]];
    for (let k = 1; k < path.length; k++) {
      z -= 0.00012;
      const i = path[k];
      if (!sea[i] && out[i] > z) out[i] = z;
    }
    breaches++;
  }
  return { height: out, breaches };
}

export function meanderChannels(height: Float32Array, sea: Uint8Array, hydro: ReturnType<typeof priorityFlood>,
  acc: Float64Array, p: GeneratorParams, g: GridSpec, thresholdOverride?: number): Float32Array {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const out = new Float32Array(height);
  if (p.meander <= 0.001 || p.river <= 0.005) return out;
  const threshold = thresholdOverride ?? riverThresholdFor(acc, sea, p.river, g);
  if (!Number.isFinite(threshold)) return out;
  const major = threshold * 1.25;
  const displacedPoint = (i: number): [number, number, number, number] => {
    const x = i % n, y = Math.floor(i / n); let downstream = i, steps = 0;
    while (steps++ < 5 && hydro.parent[downstream] >= 0) downstream = hydro.parent[downstream];
    const dx = downstream % n - x, dy = Math.floor(downstream / n) - y, length = Math.hypot(dx, dy) || 1;
    const plainness = clamp((0.026 - slopeAt(height, x, y, g)) / 0.022);
    const discharge = clamp(Math.log1p(acc[i] / major) / 3.2);
    const wx = g.originX + x, wy = g.originY + y;
    const bend = clamp(fbm(wx / 22, wy / 22, p.seed + 7717, 3) * 0.78 + fbm(wx / 47, wy / 47, p.seed + 17713, 2) * 0.38, -1, 1);
    const amplitude = p.meander * plainness * (1.8 + 10.5 * discharge);
    return [clamp(Math.round(x - dy / length * bend * amplitude), 1, n - 2), clamp(Math.round(y + dx / length * bend * amplitude), 1, n - 2), plainness, discharge];
  };
  const carveSegment = (a: [number, number], b: [number, number], za: number, zb: number, depth: number) => {
    let [x0, y0] = a; const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let error = dx - dy, step = 0; const total = Math.max(dx, dy) || 1;
    while (true) {
      const i = at(x0, y0), z = lerp(za, zb, step / total) - depth;
      if (!sea[i]) {
        out[i] = Math.min(out[i], z);
        for (let k = 0; k < 8; k++) {
          const nx = x0 + DX[k], ny = y0 + DY[k];
          if (nx <= 0 || ny <= 0 || nx >= n - 1 || ny >= n - 1) continue;
          const j = at(nx, ny); if (!sea[j]) out[j] = Math.min(out[j], z + depth * 0.42);
        }
      }
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice > -dy) { error -= dy; x0 += sx; }
      if (twice < dx) { error += dx; y0 += sy; }
      step++;
    }
  };
  for (let i = 0; i < len; i++) {
    const next = hydro.parent[i];
    if (next < 0 || sea[i] || sea[next] || acc[i] < major) continue;
    const a = displacedPoint(i), b = displacedPoint(next), influence = Math.min(a[2], b[2]);
    if (influence <= 0.03) continue;
    const depth = (0.006 + 0.04 * p.erosion) * influence * (0.5 + 0.5 * Math.max(a[3], b[3]));
    carveSegment([a[0], a[1]], [b[0], b[1]], hydro.filled[i], Math.min(hydro.filled[i] - 0.00004, hydro.filled[next]), depth);
  }
  return out;
}

export function carveAndFlatten(height: Float32Array, sea: Uint8Array, acc: Float64Array, p: GeneratorParams,
  g: GridSpec, thresholdOverride?: number): Float32Array {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const out = new Float32Array(height), threshold = thresholdOverride ?? riverThresholdFor(acc, sea, p.river, g);
  if (!Number.isFinite(threshold)) return out;
  for (let i = 0; i < len; i++) if (!sea[i] && acc[i] >= threshold) {
    out[i] -= (0.006 + 0.045 * p.erosion) * clamp(Math.log1p(acc[i] / threshold) / 5);
  }
  const major = threshold * 5;
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = at(x, y); if (sea[i] || acc[i] < major) continue;
    const strength = clamp(Math.log1p(acc[i] / major) / 4) * (0.25 + 0.55 * p.flat) * p.erosion;
    const radius = 2 + Math.floor(clamp(Math.log1p(acc[i] / major)) * 3);
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      const nx = x + ox, ny = y + oy, distance = Math.hypot(ox, oy);
      if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1 || distance > radius) continue;
      const j = at(nx, ny); if (!sea[j]) out[j] = lerp(out[j], out[i] + distance * 0.00005, (1 - distance / radius) * strength * 0.45);
    }
  }
  return out;
}

export function slopeMap(h: Float32Array, g: GridSpec): Float32Array {
  const n = g.size, at = (px: number, py: number) => py * n + px;
  const result = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    result[at(x, y)] = slopeAt(h, x, y, g);
  }
  return result;
}

export function distanceField(mask: Uint8Array, g: GridSpec): Int16Array {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const dist = new Int16Array(len); dist.fill(32767);
  const queue = new Int32Array(len); let head = 0, tail = 0;
  for (let i = 0; i < len; i++) if (mask[i]) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % n, y = Math.floor(i / n), d = dist[i] + 1;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = at(nx, ny); if (d < dist[j]) { dist[j] = d; queue[tail++] = j; }
    }
  }
  return dist;
}

export function distanceAndNearest(mask: Uint8Array, g: GridSpec) {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const dist = new Int16Array(len); dist.fill(32767);
  const nearest = new Int32Array(len); nearest.fill(-1);
  const queue = new Int32Array(len); let head = 0, tail = 0;
  for (let i = 0; i < len; i++) if (mask[i]) { dist[i] = 0; nearest[i] = i; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % n, y = Math.floor(i / n), distance = dist[i] + 1, source = nearest[i];
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = at(nx, ny);
      if (distance < dist[j]) { dist[j] = distance; nearest[j] = source; queue[tail++] = j; }
    }
  }
  return { dist, nearest };
}

export function classifyRiverLandforms(terrain: Float32Array, sea: Uint8Array, rivers: Uint8Array, acc: Float64Array,
  threshold: number, p: GeneratorParams, g: GridSpec) {
  const n = g.size, len = n * n, at = (px: number, py: number) => py * n + px;
  const proximity = distanceAndNearest(rivers, g), landform = new Uint8Array(len), riverRelief = new Float32Array(len);
  if (!Number.isFinite(threshold)) return { landform, riverDist: proximity.dist, nearestRiver: proximity.nearest, riverRelief };
  for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
    const i = at(x, y), source = proximity.nearest[i], distance = proximity.dist[i];
    if (sea[i] || rivers[i] || source < 0 || distance > 18) continue;
    const power = clamp(Math.log1p(acc[source] / Math.max(1, threshold)) / 4), reach = 4 + Math.round(power * 10);
    if (distance > reach) continue;
    const relief = terrain[i] - terrain[source], slope = slopeAt(terrain, x, y, g);
    riverRelief[i] = relief;
    // World coordinates, or the floodplain texture restarts at every tile edge.
    const broad = fbm((g.originX + x) / 19, (g.originY + y) / 19, p.seed + 84521, 2) * 0.5 + 0.5;
    if (distance <= Math.max(2, Math.round(2 + power * 2)) && relief >= -0.002 && relief < 0.014 + power * 0.01 && slope < 0.009) landform[i] = 1;
    if (distance >= 1 && distance <= Math.max(2, Math.round(2 + power * 2.4)) && relief >= 0.004 && relief < 0.025 + power * 0.012 && slope < 0.01) landform[i] = 2;
    if (distance >= 3 && distance <= Math.max(5, Math.round(6 + power * 5)) && relief < 0.021 + power * 0.01 && slope < 0.0055 && broad < 0.66) landform[i] = 3;
    if (distance >= 4 && distance <= Math.max(8, Math.round(10 + power * 5)) && relief >= 0.02 && relief < 0.085 && slope < 0.0115) landform[i] = 4;
  }
  return { landform, riverDist: proximity.dist, nearestRiver: proximity.nearest, riverRelief };
}
