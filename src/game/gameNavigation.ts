export interface MapPoint {
  x: number;
  z: number;
}

export interface Bearing {
  distance: number;
  bearing: number;
}

/** Distance and compass bearing from one world point to another. */
export function bearingBetween(origin: MapPoint, target: MapPoint): Bearing {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  return {
    distance: Math.hypot(dx, dz),
    bearing: (Math.atan2(dx, -dz) * 180) / Math.PI,
  };
}

export function isWithin(origin: MapPoint, target: MapPoint, distance: number): boolean {
  return Math.hypot(target.x - origin.x, target.z - origin.z) <= distance;
}
