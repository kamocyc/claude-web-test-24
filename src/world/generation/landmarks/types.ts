import type { Rng } from '../../../core/rng';
import type { Brush } from './brush';

/** What a landmark is an example of. The showcase groups its lots by this, so the
 *  four kinds stand on four sides of the square rather than in the order they
 *  happen to be declared in. */
export type LandmarkKind = 'skyscraper' | 'western' | 'monument' | 'historic' | 'plaza';

export interface LandmarkContext {
  /** Deterministic stream for this building on this lot: bond patterns, which
   *  windows are lit, where the shrubs go. Never for anything structural. */
  rng: Rng;
}

export interface Landmark {
  id: string;
  /** Shown on the exhibit's plaque and in the tests. */
  label: string;
  /** One line about what the building is demonstrating. */
  note: string;
  kind: LandmarkKind;
  /** Footprint in blocks, measured over everything the building writes at or above
   *  ground including steps, garden walls and terraces. The showcase centres this
   *  in its lot and refuses to lay one out that does not fit. */
  width: number;
  depth: number;
  /** Blocks above ground the tallest part reaches. The lot's plan is sized from it,
   *  so a building that overruns it is clipped rather than corrupting a neighbour. */
  height: number;
  /** Blocks below ground it digs, for foundations, basins and cellars. */
  depthBelow: number;
  /** Draws the building with its south-west corner at lot coordinate (0, 0) and its
   *  ground floor at y = 1. */
  build(brush: Brush, ctx: LandmarkContext): void;
}
