import { Noise, clamp, smoothstep } from '../../core/noise';
import { hashFloat } from '../../core/rng';
import { SEA_LEVEL } from '../chunk';

/** Rivers are carved from a noise field rather than traced downstream, so every chunk
 *  can be generated on its own. The trick that keeps a river running downhill is to
 *  take its surface height from the same continentalness noise that decides land from
 *  sea: that value falls off towards the ocean, so the river surface does too. */

/** How far the water surface climbs between the coast and the deep inland. */
const RIVER_CLIMB = 16;
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

  /** Samples the river at a column. `continentalness` comes from the terrain generator
   *  and is what makes the surface fall monotonically towards the sea; `landHeight` is
   *  the surrounding terrain, which the surface is kept below so the banks hold. */
  sample(x: number, z: number, continentalness: number, landHeight: number): RiverSample {
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

    // The water surface has to stay under the land it runs through, otherwise the
    // river would simply flood the plain instead of sitting in its channel.
    const surface = Math.min(this.surfaceLevel(continentalness), Math.floor(landHeight) - 2);
    return {
      strength,
      surface,
      floor: surface - 1 - Math.round(strength * RIVER_DEPTH),
    };
  }

  /** Water surface of the river, from just above the sea at the coast to well inland. */
  surfaceLevel(continentalness: number): number {
    const inland = clamp((continentalness + 0.11) / 0.34, 0, 1);
    return SEA_LEVEL + 1 + Math.round(inland * RIVER_CLIMB);
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
