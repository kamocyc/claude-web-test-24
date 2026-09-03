import { DECO_TOWER, GLASS_TOWER } from './towers';
import { CATHEDRAL, GREEK_TEMPLE } from './historic';
import { CLOCK_TOWER, LATTICE_TOWER } from './monuments';
import { MANOR_HOUSE, TOWNHOUSE_ROW } from './western';
import type { Landmark } from './types';

export { createPlaza } from './plaza';
export type { Landmark, LandmarkContext, LandmarkKind } from './types';
export type { Brush } from './brush';

/**
 * The exhibits, in the order the showcase seats them: clockwise from north, two
 * of each kind so that every side of the square answers a different question
 * about the block palette.
 */
export const LANDMARKS: readonly Landmark[] = [
  GREEK_TEMPLE,
  CATHEDRAL,
  GLASS_TOWER,
  DECO_TOWER,
  CLOCK_TOWER,
  LATTICE_TOWER,
  MANOR_HOUSE,
  TOWNHOUSE_ROW,
];

export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((landmark) => landmark.id === id);
}
