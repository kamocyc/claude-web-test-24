import { smoothstep } from '../../core/noise';
import { SEA_LEVEL } from '../chunk';
import { Biome, biomeDef, classifyBiome, isSnowy } from './biome';
import { CIVIL_TILE, civilTileOf } from './infinite/constants';
import { bankReach } from './infinite/riverCarve';
import type { RiverSample } from './infinite/riverField';
import type { InfiniteSettlement, SettlementTier } from './infinite/settlements';
import { CELL_BLOCKS } from './scale';
import type { VillageSite, VillageVariant } from './village';
import type { WorldField } from './worldField';

/**
 * Where the villages are.
 *
 * The settlement lattice in `infinite/settlements.ts` answers that for the
 * reference generator's own world; this turns its answer into the four things
 * the rest of the game asks for — a centre, a floor to build at, which of the
 * three palettes to build in, and whether the site is usable at all.
 *
 * Nothing here may build a super-chunk. `villagesAround` is called from the
 * main thread whenever a village comes into range, and a super-chunk costs the
 * better part of a second. The settlement lattice is scored from the coarse
 * level, and everything below reads the bare height field, so the whole of this
 * file answers in microseconds.
 */

/** How far a town's plateau reaches, and how far inside that it is fully flat. */
const PLATEAU_FULL = 42, PLATEAU_EDGE = 56;

/**
 * The floor a town stands on has to be dry, and not up a mountain.
 *
 * The upper limit is measured rather than chosen: over 80 seats of two seeds the
 * ground a settlement was seated on stood 4 to 50 blocks above sea level, with a
 * median of 12 to 26. The old generator's ceiling of 24 came from a terrain
 * whose land barely reached that high; on this one it would refuse half the
 * world's towns.
 */
const FLOOR_MIN = SEA_LEVEL + 2, FLOOR_MAX = SEA_LEVEL + 45;

/**
 * How much the ground may rise and fall over the six probes around a centre.
 *
 * A safety net rather than a filter: `seatAt` has already nudged the anchor onto
 * the flattest ground within a few cells, and the measured spread at a seat is
 * one to three blocks. What this catches is a seat that had nothing flat to
 * move to.
 */
const MAX_SPREAD = 16;

/** How rugged ground has to be before the six probes call it a mountainside. */
const SPREAD_RUGGED = 12;


/** What a village is, before anything has happened to it. */
export interface VillageInfo {
  site: VillageSite;
  valid: boolean;
  /** The block level the town's streets and floors are laid at. */
  baseY: number;
  variant: VillageVariant;
  /** The lattice's own reading of how important the place is. */
  tier: SettlementTier;
}

/**
 * How strongly a town flattens the ground at a point: 1 at the centre, 0 past
 * the plateau. Unchanged from the generator this replaces — the town fabric was
 * laid out against these numbers and still is.
 */
export function plateauWeight(site: { x: number; z: number }, x: number, z: number): number {
  const distance = Math.hypot(x - site.x, z - site.z);
  return 1 - smoothstep(PLATEAU_FULL, PLATEAU_EDGE, distance);
}

/**
 * How far past its banks a river keeps the town's plateau off it.
 *
 * The plateau is a hard replacement — inside `PLATEAU_FULL` it discards whatever
 * the ground was — so a town standing on a river used to fill the channel in and
 * the river simply stopped at the town wall. The town still levels its streets;
 * it just stops short of the water and lets its floor come down to the bank over
 * this many blocks, which is what a riverside town looks like anyway.
 */
const FLOODPLAIN_REACH = 12;

/** 1 where the ground belongs to the river, 0 where it belongs to the town. */
export function channelHold(river: RiverSample): number {
  const bank = river.width * 0.5 + bankReach(river);
  return 1 - smoothstep(bank, bank + FLOODPLAIN_REACH, river.distance);
}

/** Cells whose village list is kept. One chunk is one cell, so this is a region. */
const NEARBY_CACHE = 4096;

export class VillageField {
  private readonly infos = new Map<string, VillageInfo>();
  private readonly nearby = new Map<number, VillageInfo[]>();

  constructor(
    private readonly field: WorldField,
    private readonly climate: (x: number, z: number) => { temperature: number; humidity: number },
  ) {}

  /**
   * Every village within `cellRadius` village cells. The unit is the old
   * generator's 320-block grid cell, which is what the five call sites in
   * `src/game/game.ts` pass their radius in; the lattice underneath no longer
   * has cells of any kind.
   */
  around(x: number, z: number, cellRadius: number): VillageInfo[] {
    // Half a cell of slack, because the old grid walk this replaces scanned the
    // *cells* around a point: a radius of zero meant "the cell this point is
    // in", which is 160 blocks in every direction, not nothing.
    const reach = (cellRadius + 0.5) * VILLAGE_CELL_BLOCKS;
    const cellX = Math.round(x / CELL_BLOCKS), cellZ = Math.round(z / CELL_BLOCKS);
    const out: VillageInfo[] = [];
    for (const settlement of this.field.settlements.near(cellX, cellZ, reach / CELL_BLOCKS)) {
      const info = this.infoOf(settlement);
      if (info.valid) out.push(info);
    }
    return out;
  }

  /**
   * Villages whose plateau or buildings can reach a column.
   *
   * Answered per cell rather than per block, and cached, because every column of
   * every chunk asks it and the answer costs a walk over the settlement lattice.
   * Asking from the middle of the cell instead of from the block is safe by a
   * wide margin: the list reaches 480 blocks, the two questions asked of it —
   * how much a town flattens this ground, and whether its buildings land here —
   * both answer "not at all" past 56, and a cell is 16 blocks across.
   */
  near(x: number, z: number): VillageInfo[] {
    const cellX = Math.floor(x / CELL_BLOCKS), cellZ = Math.floor(z / CELL_BLOCKS);
    const key = cellZ * 8388608 + cellX;
    const cached = this.nearby.get(key);
    if (cached) return cached;
    const half = CELL_BLOCKS / 2;
    const list = this.around(cellX * CELL_BLOCKS + half, cellZ * CELL_BLOCKS + half, 1);
    this.nearby.set(key, list);
    while (this.nearby.size > NEARBY_CACHE) this.nearby.delete(this.nearby.keys().next().value as number);
    return list;
  }

  /**
   * The village whose centre is exactly here, valid or not.
   *
   * For callers holding a centre something else recorded — a saved village, a
   * debug command — rather than a settlement out of the lattice.
   */
  at(x: number, z: number): VillageInfo {
    const cached = this.infos.get(`@${x},${z}`);
    if (cached) return cached;
    const info = this.survey(`@${x},${z}`, x, z, 'village');
    return info;
  }

  /** True where the town's plateau has taken the ground over. */
  inside(x: number, z: number): boolean {
    for (const info of this.near(x, z)) if (plateauWeight(info.site, x, z) > 0.35) return true;
    return false;
  }

  /**
   * The height a column ends up at once every nearby town has levelled it.
   *
   * `river` is the channel at this column, when the caller has one. Where a river
   * runs through a town the plateau is held off it — see `channelHold` — so the
   * water keeps its bed and its banks and the streets come down to meet them.
   * A caller without a channel to hand (the cheap `height()` estimate, which has
   * no hydrology in it at all) passes nothing and gets the plain plateau.
   */
  flatten(x: number, z: number, height: number, river: RiverSample | null = null): number {
    const hold = river ? channelHold(river) : 0;
    if (hold >= 1) return height;
    let out = height;
    for (const info of this.near(x, z)) {
      const weight = plateauWeight(info.site, x, z) * (1 - hold);
      if (weight > 0) out = out + (info.baseY - out) * weight;
    }
    return out;
  }

  clear() {
    this.infos.clear();
    this.nearby.clear();
  }

  /** Cached on the lattice's own id, so two lookups of one place agree. */
  private infoOf(settlement: InfiniteSettlement): VillageInfo {
    const cached = this.infos.get(settlement.id);
    if (cached) return cached;
    const seat = this.field.settlements.seat(settlement);
    return this.survey(settlement.id, seat.x * CELL_BLOCKS, seat.y * CELL_BLOCKS, settlement.tier);
  }

  private survey(id: string, x: number, z: number, tier: SettlementTier): VillageInfo {
    // The bare height field, never a tile: at a settlement seat it is within
    // two blocks of the finished ground nine times out of ten (measured p90 of
    // 2, worst of 7 over 80 seats), because a seat is chosen for being flat and
    // away from the channels, which is exactly where the hydrology does least.
    const baseY = this.field.estimate(x, z);
    let min = baseY, max = baseY;
    for (const [dx, dz] of [[-20, 0], [20, 0], [0, -20], [0, 20], [14, 14], [-14, -14]] as const) {
      const h = this.field.estimate(x + dx, z + dz);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    const spread = max - min;

    const { temperature, humidity } = this.climate(x, z);
    const biome = classifyBiome({
      height: baseY,
      temperature,
      humidity,
      seaLevel: SEA_LEVEL,
      // The six probes stand in for the slope map here: reading the real one
      // means building a super-chunk, and this runs on the main thread.
      rugged: Math.min(1, spread / SPREAD_RUGGED),
    });
    const valid = biomeDef(biome).allowsVillage
      && baseY >= FLOOR_MIN && baseY <= FLOOR_MAX
      && spread <= MAX_SPREAD;
    const variant: VillageVariant =
      biome === Biome.DESERT ? 'desert' : isSnowy(biome) ? 'snowy' : 'plains';

    const info: VillageInfo = {
      site: { cellX: civilTileOf(x / CELL_BLOCKS), cellZ: civilTileOf(z / CELL_BLOCKS), x, z },
      valid,
      baseY: baseY + 1,
      variant,
      tier,
    };
    this.infos.set(id, info);
    return info;
  }
}

/**
 * The unit `cellRadius` is counted in, kept at the old grid's 320 blocks.
 *
 * There is no grid any more — the lattice thins a scattered candidate set — but
 * `game.ts` asks for villages "within two cells" in five places and the answers
 * have to keep meaning the same distance.
 */
export const VILLAGE_CELL_BLOCKS = 320;

/** Blocks between the settlement lattice's own tiles, for callers that care. */
export const CIVIL_TILE_BLOCKS = CIVIL_TILE * CELL_BLOCKS;
