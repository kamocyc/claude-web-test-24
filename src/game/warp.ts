/** Parsing for the debug warp box. Kept apart from the widget so it can be tested
 *  without a DOM, the way the rest of `src/game` is. */

import { CHUNK_HEIGHT } from '../world/chunk';

export interface WarpTarget {
  x: number;
  z: number;
  /** null means "drop onto whatever the terrain is there". */
  y: number | null;
}

/** Reads "x z" or "x y z" out of whatever the player typed. Separators are free-form
 *  and the axis letters are ignored, so the F3 readout ("XYZ 12.3 / 71.0 / -45.6") can
 *  be pasted straight back in. Returns null when it is not two or three numbers. */
export function parseWarpTarget(text: string): WarpTarget | null {
  const numbers = text
    .replace(/[xyzXYZ=:]/g, ' ')
    .split(/[\s,/;]+/)
    .filter((token) => token.length > 0)
    .map(Number);
  if (numbers.length < 2 || numbers.length > 3) return null;
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  if (numbers.length === 2) return { x: numbers[0], z: numbers[1], y: null };
  return { x: numbers[0], y: numbers[1], z: numbers[2] };
}

/** Keeps a typed height inside the world so a warp cannot drop the player out of it. */
export function clampWarpY(y: number): number {
  return Math.max(1, Math.min(CHUNK_HEIGHT - 3, y));
}
