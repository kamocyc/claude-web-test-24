import { DECO_TOWER, GLASS_TOWER } from './towers';
import { CATHEDRAL, GREEK_TEMPLE } from './historic';
import { CLOCK_TOWER, LATTICE_TOWER } from './monuments';
import { MANOR_HOUSE, TOWNHOUSE_ROW } from './western';
import { APARTMENT, TENANT_BLOCK, TOWER_BLOCK, TOWN_HOUSE } from './japan';
import type { Landmark } from './types';

export { createPlaza } from './plaza';
export type { Landmark, LandmarkContext, LandmarkKind } from './types';
export type { Brush } from './brush';

/**
 * The exhibits, in the order the showcase seats them.
 *
 * The first eight ring the plaza, clockwise from north, two of each kind so that every
 * side of the square answers a different question about the block palette. The four after
 * them are the modern quarter, one lot further out along each avenue: the buildings a
 * street is made of now, which the stone and the brick of the inner ring cannot show.
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
  TOWER_BLOCK,
  TENANT_BLOCK,
  APARTMENT,
  TOWN_HOUSE,
];

export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((landmark) => landmark.id === id);
}
