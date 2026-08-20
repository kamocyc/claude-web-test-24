import { Noise, clamp, smoothstep } from '../../core/noise';
import { hashFloat } from '../../core/rng';
import { SEA_LEVEL } from '../chunk';

/** Rivers are carved from a noise field rather than traced downstream, so every chunk
 *  can be generated on its own. The trick that keeps a river running downhill is to
 *  take its surface height from the same continentalness noise that decides land from
 *  sea: that value falls off towards the ocean, so the river surface does too. */

/** How far the land, and with it the river surface, climbs from coast to interior. */
export const RIVER_CLIMB = 15;

/** How far inland a column is, from 0 at the coast to 1 deep in the interior. This is
 *  a monotone function of continentalness, which is what guarantees that a river never
 *  has to run uphill: the terrain is lifted by the same amount, so the channel keeps
 *  descending all the way to the sea. */
export function inlandness(continentalness: number): number {
  return clamp((continentalness + 0.02) / 0.34, 0, 1);
}
/** Half width of the carved channel, in blocks of noise band. */
const RIVER_WIDTH = 0.055;
/** Deepest part of the channel below its surface. */
const RIVER_DEPTH = 3;

export interface RiverSample {
  /** 0 outside the river, 1 in the middle of the channel. */
  strength: number;
  /** Y of the water surface in this column. */
  surface: number;
  /** Y the channel floor is cut down to. */
  floor: number;
}

export class RiverField {
  private readonly path: Noise;
  private readonly warp: Noise;

  constructor(seed: number) {
    this.path = new Noise(seed ^ 0x21e7);
    this.warp = new Noise(seed ^ 0x33a2b);
  }

  /** Samples the river at a column. The surface comes from continentalness alone, and
   *  the terrain generator lifts the land by exactly the same amount, so the channel is
   *  always sunk into its banks and always slopes towards the sea. */
  sample(x: number, z: number, continentalness: number): RiverSample {
    // No rivers out at sea, and they fade out as they meet it.
    const land = smoothstep(-0.12, 0.06, continentalness + 0.16);
    if (land <= 0) return DRY;

    // Warping the lookup makes the channel wind instead of running straight.
    const warpX = this.warp.noise2(x * 0.0007, z * 0.0007) * 0.9;
    const warpZ = this.warp.noise2(x * 0.0007 + 71.3, z * 0.0007 - 19.7) * 0.9;
    const value = this.path.noise2(x * 0.0013 + warpX, z * 0.0013 + warpZ);
    const band = 1 - smoothstep(0, RIVER_WIDTH, Math.abs(value));
    const strength = band * land;
    if (strength <= 0.02) return DRY;

    const surface = this.surfaceLevel(continentalness);
    return {
      strength,
      surface,
      floor: surface - 1 - Math.round(strength * RIVER_DEPTH),
    };
  }

  /** Water surface of the river: three blocks below the base height of the land, which
   *  leaves room for banks even where the terrain detail dips. */
  surfaceLevel(continentalness: number): number {
    return SEA_LEVEL + Math.round(inlandness(continentalness) * RIVER_CLIMB);
  }

  /** True where a spring should bubble up: the far upstream end of a channel. */
  isSpringSite(seed: number, x: number, z: number, sample: RiverSample, continentalness: number): boolean {
    if (sample.strength < 0.75) return false;
    // Only near the head of the river, where it is highest above the sea.
    if (continentalness < 0.32) return false;
    return hashFloat(seed ^ 0x5210, x, z) < 0.008;
  }
}

const DRY: RiverSample = { strength: 0, surface: 0, floor: 0 };
