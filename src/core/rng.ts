/** Deterministic pseudo-random utilities. Everything in the world is derived from
 *  the world seed plus a coordinate, so generation never depends on visit order. */

export type Rng = () => number;

/** Fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes an arbitrary number of integers into a single uint32. */
export function hashInts(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    let x = v | 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x ^= x >>> 16;
    h = Math.imul(h ^ x, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  return h >>> 0;
}

/** A PRNG bound to a specific coordinate; identical inputs always give the same stream. */
export function rngAt(seed: number, ...coords: number[]): Rng {
  return mulberry32(hashInts(seed, ...coords));
}

/** Deterministic float in [0,1) without allocating a generator. */
export function hashFloat(seed: number, ...coords: number[]): number {
  return hashInts(seed, ...coords) / 4294967296;
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Turns a user supplied seed string into a numeric seed. */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return (Math.random() * 0xffffffff) >>> 0;
  if (/^-?\d+$/.test(trimmed)) return Math.abs(Number(trimmed)) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h = Math.imul(h ^ trimmed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}
