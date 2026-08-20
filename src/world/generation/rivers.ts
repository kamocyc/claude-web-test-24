import { clamp, lerp, smoothstep } from '../../core/noise';
import { SEA_LEVEL } from '../chunk';
import { Drainage, PLAIN_FLOW } from './drainage';

/** The shape of a river, read off the island's drainage network.
 *
 *  Everything here is geometry: given how far a column is from the middle of its channel
 *  and how much land drains through it, what is the bed, where is the water's top face,
 *  and how far out does the floodplain reach. The network in `drainage.ts` decides where
 *  the channels are and how big; this decides what they look like.
 *
 *  The generator only fills the channel once, as an opening position. From then on the
 *  water is the simulation's, and where it stands is whatever the springs and the ground
 *  between them make of it. */

/** How far the land climbs from coast to interior. Rivers no longer take their height
 *  from this — they take it from the ground they run over — but it is still what gives
 *  the island an inland to run down from. */
export const RIVER_CLIMB = 15;

/** Turns the continentalness field into a 0 to 1 fraction, flat at the coast and flat
 *  again deep inland. */
export function inlandness(continentalness: number): number {
  return clamp((continentalness + 0.02) / 0.34, 0, 1);
}

/** Strength at which a column counts as the channel itself rather than its bank, which
 *  is exactly the half width of the channel. Only the channel holds water. */
export const CHANNEL_CORE = 0.25;

/** How far past the water's edge the bank slopes back up to the surrounding land,
 *  measured in half channel widths. The old generator went straight up in a single
 *  block, which is what made every river read as a crack in the ground. */
const BANK_SPAN = 1;
/** How far past the crest an ordinary channel takes to blend back into the hillside. */
const TAPER_SPAN = 1;
/** How far the floodplain reaches, in half channel widths, on rivers big enough to have
 *  laid one down. Roughly two and a half times the width of the water to either side. */
const PLAIN_SPAN = 5;
/** How much of the outer floodplain is spent easing back into the hillside. */
const PLAIN_FADE = 2;

export interface RiverSample {
  /** 1 in the middle of the channel, `CHANNEL_CORE` at the water's edge, 0 past the top
   *  of the bank. */
  strength: number;
  /** World height of the water's top face, as a fraction rather than a whole block.
   *  Quantising it to whole blocks turned every river into a flight of one block
   *  terraces, because the surface crosses a block boundary every few metres; the
   *  generator instead part fills the topmost cell so the sheet slopes smoothly. */
  surface: number;
  /** Y the middle of the channel floor is cut down to. */
  floor: number;
  /** 0 at the river mouth, 1 at the headwaters. */
  inland: number;
  /** Blocks from the middle of the channel. */
  distance: number;
  /** Cells of land draining through the channel. */
  flow: number;
  /** How steeply the channel falls there, in blocks per block. A reach steeper than
   *  about half a block per block is a fall, and the water surface steps down it. */
  slope: number;
}

const DRY: RiverSample = {
  strength: 0,
  surface: 0,
  floor: 0,
  inland: 0,
  distance: Infinity,
  flow: 0,
  slope: 0,
};

/** True when the river covers a column of ground `height` blocks high. A column is
 *  covered only inside the channel itself: the banks slope up out of the water. */
export function riverCovers(sample: RiverSample, height: number, offset = 0): boolean {
  return sample.strength >= CHANNEL_CORE && sample.surface + offset > height + 1;
}

export class RiverField {
  private readonly drainage: Drainage;

  private readonly springKeys: Set<string>;

  /** @param naturalHeight land height at a column before any channel is cut into it. */
  constructor(naturalHeight: (x: number, z: number) => number) {
    this.drainage = new Drainage(naturalHeight);
    this.springKeys = new Set(this.drainage.springs.map((s) => `${s.x},${s.z}`));
  }

  /** Heads of streams, one per branch of the network. Every river now lives or dies by
   *  its springs, so a valley without one dries out for good. */
  get springs(): readonly { x: number; z: number }[] {
    return this.drainage.springs;
  }

  /** True where a spring should bubble up. */
  isSpringSite(x: number, z: number): boolean {
    return this.springKeys.has(`${x},${z}`);
  }

  sample(x: number, z: number): RiverSample {
    const found = this.drainage.sample(x, z);
    if (found.flow <= 0) return DRY;
    const half = found.width / 2;
    const t = found.distance / half;
    return {
      strength:
        t <= 1
          ? 1 - t * (1 - CHANNEL_CORE)
          : Math.max(0, (CHANNEL_CORE * (1 + BANK_SPAN - t)) / BANK_SPAN),
      surface: found.surface,
      floor: Math.floor(found.surface - found.depth),
      inland: clamp((found.surface - (SEA_LEVEL + 1)) / RIVER_CLIMB, 0, 1),
      distance: found.distance,
      flow: found.flow,
      slope: found.slope,
    };
  }

  /** The height the land is cut or filled to at a column, given whatever the untouched
   *  terrain was doing there. Returns `height` unchanged where no river reaches.
   *
   *  Working outwards: the bed is a rounded trough, deepest in the middle and rising to
   *  the water line at the edge; then a crest, which is the bank, at or above the water's
   *  top face — this is what holds the river in, and the old generator's vertical block
   *  of it is exactly what made every channel read as a crack in the ground; then the
   *  ground eases back down to the hillside. On a river big enough to have built one the
   *  crest is a floodplain instead, running out a block clear of the water: flat enough
   *  to walk and to farm, low enough to go under when the rains come. */
  carve(height: number, x: number, z: number): number {
    const found = this.drainage.sample(x, z);
    if (found.flow <= 0) return height;
    const t = found.distance / (found.width / 2);
    // Top face the banks have to reach for the water to stay in the channel.
    const lip = Math.ceil(found.surface);

    if (t <= 1) {
      const bed = Math.floor(found.surface - found.depth * Math.sqrt(Math.max(0, 1 - t * t)));
      return Math.min(height, bed);
    }

    const plain = found.flow >= PLAIN_FLOW;
    // Where the ground settles just past the water's edge. Never below the lip: a bank
    // that dips even one block under the surface lets the river out sideways, which used
    // to leave a film of water lying on every terrace of the slope below.
    const shelf = Math.max(lip, plain ? Math.min(height, lip + 1) : height);
    if (t <= 1 + BANK_SPAN) return lerp(lip, shelf, smoothstep(0, 1, (t - 1) / BANK_SPAN));

    // Past the crest the ground comes back to whatever the land was doing. Anything low
    // out here is safe: the crest stands between it and the water.
    const edge = plain ? PLAIN_SPAN : 1 + BANK_SPAN + TAPER_SPAN;
    if (t >= edge) return height;
    return lerp(shelf, height, smoothstep(plain ? PLAIN_SPAN - PLAIN_FADE : 1 + BANK_SPAN, edge, t));
  }

  /** True when the nearest channel, banks and all, keeps this far clear of a column.
   *  A village asks before flattening its plateau: laid over a channel it would dam the
   *  river, and on a finite island a dammed river is a river gone. */
  clearOfChannel(x: number, z: number, radius: number): boolean {
    const found = this.drainage.sample(x, z);
    if (found.flow <= 0) return true;
    return found.distance - found.width / 2 > radius;
  }
}
