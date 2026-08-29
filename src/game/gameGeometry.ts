import type { TrackPoint } from './tracks';

/** A rail end's floating-point position, on the block grid the guide draws on. */
export function roundPoint(point: TrackPoint): { x: number; y: number; z: number } {
  return { x: Math.round(point.x), y: Math.round(point.y), z: Math.round(point.z) };
}

/** Slab method: distance along the ray at which it enters the box, or null. */
export function rayBoxDistance(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let near = 0;
  let far = Infinity;
  const axes: [number, number, number, number][] = [
    [origin.x, direction.x, minX, maxX],
    [origin.y, direction.y, minY, maxY],
    [origin.z, direction.z, minZ, maxZ],
  ];
  for (const [start, delta, low, high] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (start < low || start > high) return null;
      continue;
    }
    const t1 = (low - start) / delta;
    const t2 = (high - start) / delta;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }
  return far < 0 ? null : near;
}
