/** Hash noise, fbm and the small heap the hydrology runs on.
 *
 *  Ported verbatim from the reference generator's `src/generator/grid.ts`
 *  (kamocyc/ctest105_city_terrain_generator, branch
 *  `claude/infinite-terrain-river-sim-fgq43a`). Every number in here is load
 *  bearing: the terrain *is* this fbm, so an "improvement" to the constants is a
 *  different world. `src/test/infiniteGrid.test.ts` pins values taken from the
 *  reference so a well-meaning edit fails loudly.
 *
 *  The finite-map globals (`N`, `LEN`, `at`, `normalizeLand`) are not ported —
 *  nothing here has a map to be the size of. `GRID_SIZE` survives because the
 *  infinite terrain uses it as the *noise span* (see `NOISE_SPAN` in
 *  `terrain.ts`), not as a width. */

/** Cells per noise unit. Not a map size: the wavelength of the lowest octave. */
export const GRID_SIZE = 128;

export const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
export const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = smooth(x - x0), ty = smooth(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty) * 2 - 1;
}

export function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0, amplitude = 0.56, frequency = 1, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

export const ridged = (x: number, y: number, seed: number) => 1 - Math.abs(fbm(x, y, seed, 4));

export function quantile(values: Float32Array | number[], q: number, mask?: Uint8Array): number {
  const list: number[] = [];
  for (let i = 0; i < values.length; i++) if (!mask || mask[i]) list.push(values[i]);
  list.sort((a, b) => a - b);
  return list[Math.max(0, Math.min(list.length - 1, Math.floor(q * (list.length - 1))))];
}

/** A pairing heap would be faster; this one is the reference's, and the flood
 *  order it produces is part of the world. */
export class MinHeap {
  private heap: Array<[number, number]> = [];
  get length() { return this.heap.length; }
  push(node: [number, number]) {
    const a = this.heap;
    a.push(node);
    let i = a.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= node[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = node;
  }
  pop(): [number, number] {
    const a = this.heap;
    const root = a[0];
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const child = r < a.length && a[r][0] < a[l][0] ? r : l;
        if (a[child][0] >= last[0]) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return root;
  }
}
