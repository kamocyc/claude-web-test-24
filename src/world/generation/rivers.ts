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
/** Strength at which a column counts as the channel itself rather than its bank. The
 *  bed is cut straight down to the floor here, whatever the land above it is doing. */
export const CHANNEL_CORE = 0.25;
/** Deepest part of the channel below its surface. */
const RIVER_DEPTH = 3;
/** Furthest the centre line search may step, in blocks. */
const CENTER_REACH = 14;
/** How far heavy rain lifts the water. The bank is carved down to `ceil(surface)`, so
 *  its top face is a full block above the normal water line: anything under 1 fills the
 *  channel to the brim without spilling over it. */
export const RIVER_FLOOD = 0.8;
/** How far a drought drops it. The channel is three to five blocks deep, so the flow
 *  narrows to a thread between drying banks rather than disappearing altogether. */
export const RIVER_DROUGHT = 1.8;

/** Where the water sits relative to its normal level, for a wetness of -1 to +1.
 *  Droughts bite deeper than rain lifts, which is what makes them the interesting half
 *  of the cycle. */
export function levelOffset(wetness: number): number {
  return wetness >= 0 ? wetness * RIVER_FLOOD : wetness * RIVER_DROUGHT;
}

/** Where a river's water sits this season. Never below the sea, which does not have
 *  seasons: that also tapers the drop away to nothing as the river nears its mouth,
 *  instead of leaving a step where the two meet. */
export function seasonalSurface(base: number, wetness: number): number {
  return Math.max(SEA_LEVEL + 1, base + levelOffset(wetness));
}

/** Recovers how far inland a column is from the height of its river. The two are tied
 *  together by `surfaceLevel`, so a chunk only has to remember the one number. */
export function inlandOfSurface(surface: number): number {
  return clamp((surface - SEA_LEVEL - 1) / RIVER_CLIMB, 0, 1);
}

export interface RiverSample {
  /** 0 outside the river, 1 in the middle of the channel. */
  strength: number;
  /** World height of the water's top face, as a fraction rather than a whole block.
   *  Quantising it to whole blocks turned every river into a flight of one block
   *  terraces, because the surface crosses a block boundary every few metres; the
   *  generator instead part fills the topmost cell so the sheet slopes smoothly. */
  surface: number;
  /** Y the channel floor is cut down to. */
  floor: number;
  /** 0 at the river mouth, 1 at the headwaters. Decides how long the weather upstream
   *  takes to arrive, and so how far behind the headwaters this column runs. */
  inland: number;
}

/** True when the river covers a column of ground `height` blocks high. A column is
 *  covered only inside the channel itself: the banks are carved to stay clear of the
 *  water line. */
export function riverCovers(sample: RiverSample, height: number, offset = 0): boolean {
  return sample.strength >= CHANNEL_CORE && sample.surface + offset > height + 1;
}

export class RiverField {
  private readonly path: Noise;
  private readonly warp: Noise;

  /** @param contAt continentalness at a column, which is where the river's height
   *  comes from. The field samples it away from the column it was asked about, so it
   *  has to be able to ask for it anywhere. */
  constructor(seed: number, private readonly contAt: (x: number, z: number) => number) {
    this.path = new Noise(seed ^ 0x21e7);
    this.warp = new Noise(seed ^ 0x33a2b);
  }

  /** The winding field whose zero crossing is the middle of a channel. */
  private pathValue(x: number, z: number): number {
    // Warping the lookup makes the channel wind instead of running straight.
    const warpX = this.warp.noise2(x * 0.0007, z * 0.0007) * 0.9;
    const warpZ = this.warp.noise2(x * 0.0007 + 71.3, z * 0.0007 - 19.7) * 0.9;
    return this.path.noise2(x * 0.0013 + warpX, z * 0.0013 + warpZ);
  }

  /** Continentalness in the middle of the channel this column belongs to, found with a
   *  single Newton step down the path field. Taking the river's height at the column
   *  itself tilted the water by up to three blocks from one bank to the other, because
   *  continentalness changes across the stream as well as along it. */
  private centerCont(x: number, z: number, value: number): number {
    const step = 2;
    const gx = (this.pathValue(x + step, z) - value) / step;
    const gz = (this.pathValue(x, z + step) - value) / step;
    const grad = gx * gx + gz * gz;
    if (grad < 1e-12) return this.contAt(x, z);
    // Clamped because a flat spot in the field would otherwise throw the sample
    // clear across the map.
    const t = Math.max(-CENTER_REACH, Math.min(CENTER_REACH, -value / Math.sqrt(grad)));
    return this.contAt(x + (gx / Math.sqrt(grad)) * t, z + (gz / Math.sqrt(grad)) * t);
  }

  /** Samples the river at a column. The surface comes from continentalness alone, and
   *  the terrain generator lifts the land by exactly the same amount, so the channel is
   *  always sunk into its banks and always slopes towards the sea. */
  sample(x: number, z: number, continentalness: number): RiverSample {
    // No rivers out at sea, and they fade out as they meet it.
    const land = smoothstep(-0.12, 0.06, continentalness + 0.16);
    if (land <= 0) return DRY;

    const value = this.pathValue(x, z);
    const band = 1 - smoothstep(0, RIVER_WIDTH, Math.abs(value));
    const strength = band * land;
    if (strength <= 0.02) return DRY;

    const inland = inlandness(this.centerCont(x, z, value));
    const surface = SEA_LEVEL + 1 + inland * RIVER_CLIMB;
    return {
      strength,
      surface,
      floor: Math.floor(surface) - 2 - Math.round(strength * RIVER_DEPTH),
      inland,
    };
  }

  /** Top face of the river's water in a normal season. It climbs inland with
   *  continentalness and is left as a fraction, so the surface is a smooth ramp rather
   *  than a staircase. At the coast it meets the top face of the sea exactly. */
  surfaceLevel(continentalness: number): number {
    return SEA_LEVEL + 1 + inlandness(continentalness) * RIVER_CLIMB;
  }

  /** True where a spring should bubble up: the far upstream end of a channel. */
  isSpringSite(seed: number, x: number, z: number, sample: RiverSample, continentalness: number): boolean {
    if (sample.strength < 0.75) return false;
    // Only near the head of the river, where it is highest above the sea.
    if (continentalness < 0.32) return false;
    return hashFloat(seed ^ 0x5210, x, z) < 0.008;
  }
}

const DRY: RiverSample = { strength: 0, surface: 0, floor: 0, inland: 0 };
