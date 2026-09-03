import { Noise } from '../../core/noise';

/**
 * The roughness that lives below the simulation cell.
 *
 * The ported height field is smooth at block scale by construction: its finest
 * octave has a wavelength of about seventeen blocks, and the hydrology that
 * runs on top of it only knows about whole cells. Sampled per block that gives
 * ground with real shape at every scale from a hillside upwards and none at all
 * below one — measured over five seeds, the largest step between two
 * neighbouring columns anywhere in a 1800-block transect was one block. Ground
 * that never steps more than a block is ground with no scrambling, no ledges
 * and no rock faces, which is a poor thing to hand a game about walking around
 * and digging.
 *
 * So a little is added back, and only where it belongs. The amplitude is gated
 * on how steep the ground already is: a floodplain the hydrology levelled stays
 * levelled — a town has to be able to stand on it — and a mountainside breaks
 * up into spurs and ledges. This is the one piece of the terrain that is not
 * the reference generator's; it is the price of putting sixteen blocks in a
 * forty-metre cell, and it is deliberately small enough not to argue with the
 * shape underneath it.
 */

/** Roughly 60-block, 18-block and 8-block wavelengths, stacked. */
const BROAD = 0.017, FINE = 0.055, GRAIN = 0.125;

/**
 * Rise per cell, in terrain units, at which the roughness is at full strength.
 * The 95th percentile of land slope over the seeds measured in `./scale.ts`.
 */
const FULL_SLOPE = 0.028;
/** Blocks of swing on ground that steep. */
const GAIN = 3.5;

/**
 * Blocks of swing everywhere, steep or not.
 *
 * Gentle ground has a second problem the slope-gated part cannot fix. A height
 * field that changes by a fraction of a block over tens of blocks, rounded to
 * whole ones, comes out as contour bands: long clean terraces following the
 * lines of the hillside, which is a striking thing to look at once and a rice
 * paddy to look at for an hour. Half a block of high-frequency noise is enough
 * to dither the edge of each band without lifting anything a full block, and it
 * is the same job the old generator's unconditional `detail * 0.8` was doing.
 */
const WOBBLE = 0.55;

export class FineRelief {
  private readonly noise: Noise;

  constructor(seed: number) {
    this.noise = new Noise(seed ^ 0x4004);
  }

  /** Blocks to add to a column, given how steep the bare field is there. */
  at(x: number, z: number, slope: number): number {
    const wobble = this.noise.noise2(x * GRAIN, z * GRAIN) * WOBBLE;
    const gate = slope >= FULL_SLOPE ? 1 : slope / FULL_SLOPE;
    if (gate <= 0) return wobble;
    const shape = this.noise.fbm2(x * BROAD, z * BROAD, 2) * 1.4
      + this.noise.fbm2(x * FINE, z * FINE, 2) * 0.55;
    return wobble + shape * gate * GAIN;
  }
}
