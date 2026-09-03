import { SEA_LEVEL } from '../chunk';
import { landUseAt, landUseReach, type LandUse } from './infinite/landuse';
import { buildRiverField, type RiverField, type RiverSample } from './infinite/riverField';
import { buildChunkRivers, quantiseLevels, stitchStems } from './infinite/riverTiles';
import { channelHeight, leveeHeight } from './infinite/riverCarve';
import { sampleGround } from './infinite/ground';
import { SUPER_INTERIOR, superTileOf } from './infinite/constants';
import { terrainSampler } from './infinite/terrain';
import { paramsFor, type GeneratorParams } from './infinite/params';
import { FineRelief } from './relief';
import { createInfiniteWorld, type InfiniteWorld, type WorldConstants } from './infinite/world';
import type { SettlementField } from './infinite/settlements';
import type { RiverStem } from './infinite/riverNetwork';
import { CELL_BLOCKS, MAX_HEIGHT, MIN_HEIGHT, unitsToHeight } from './scale';

/**
 * The ported generator, asked block by block.
 *
 * ## Base and delta
 *
 * The height a column ends up at is the sum of two things that behave nothing
 * alike. `terrainSampler.height` is a pure function of a *fractional* cell
 * coordinate — noise, evaluated anywhere, in a couple of microseconds — and it
 * carries all the detail there is below the cell lattice. The hydrology's edit
 * on top of it (the depression fill, the breach, the meander, the incision, the
 * floodplain flattening) exists only on the lattice, and it is smooth and
 * bounded.
 *
 * So the lattice is used for the *difference* and nothing else. Every block
 * evaluates the base itself and interpolates only the delta. That is why the
 * ground does not come out terraced at sixteen blocks to the cell, and it is
 * also why the main thread can answer `height()` for ground nowhere near a
 * loaded chunk without building a super-chunk: drop the delta and the answer is
 * still right to within the hydrology's own edit.
 *
 * The two formulations agree exactly. The base is bit-identical in every
 * super-chunk that computes it, so blending the absolute heights and blending
 * the deltas differ by a constant that is the base.
 */

/** What the lattice says about a column, before the rivers are cut into it. */
export interface FieldSample {
  /** Ground height in blocks, sub-cell relief included, as a real number. */
  ground: number;
  /** Terrain units. */
  units: number;
  /** Rise per cell in terrain units, from the hydrology's own slope map. */
  slope: number;
  /** 0 none, 1 levee, 2 terrace, 3 backswamp, 4 floodplain. */
  landform: number;
  /** Cells to the nearest channel, and to the coast. */
  riverDistance: number;
  coastDistance: number;
}

/** Everything about a column that is not a block. */
export interface ColumnSample extends FieldSample {
  /** Ground height in blocks, carved and levelled, rounded and clamped. */
  y: number;
  /** The same ground with the channel not yet cut into it.
   *
   *  A town levels the land it stands on, and it has to do that to the ground the
   *  river found rather than to the ground the river has already carved — level a
   *  carved column and the channel is filled in. So the carve is handed out
   *  separately from the field it was cut into, and `terrain.ts` puts it back
   *  after the plateau. */
  bare: number;
  sea: boolean;
  /** The channel here, when there is one within its banks' reach. */
  river: RiverSample | null;
}

/**
 * Super-chunks whose rivers can reach into this one. A stem stops at its own
 * tile's interior, and the stitch that joins two pieces fades over eight
 * samples, so a tile's river field is only settled once its neighbours have had
 * their say. Fixed at the full ring rather than "the neighbours we happen to
 * have": which tiles are consulted must not depend on what has been built.
 */
const RIVER_NEIGHBOURS: Array<[number, number]> = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) RIVER_NEIGHBOURS.push([dx, dy]);

/** Stems are small; the super-chunks they came from are not, and are dropped. */
const STEM_CACHE = 25;
/**
 * River fields, of which a query near a corner touches one and a sweep across a
 * region touches them row by row. Nine, so a 3 x 3 neighbourhood stays resident:
 * assembling one stitches nine tiles' worth of loose ends together, which is
 * quadratic in the number of ends, and at four a raster sweep re-stitched the
 * same three fields for every row of chunks it crossed.
 */
const FIELD_CACHE = 9;
/** Cell deltas and slopes for the chunk in hand and its neighbours. */
const DELTA_CACHE = 4096;

export class WorldField {
  readonly params: GeneratorParams;
  readonly world: InfiniteWorld;
  readonly settlements: SettlementField;
  private readonly sampler: ReturnType<typeof terrainSampler>;
  private readonly relief: FineRelief;
  private readonly seaLevel: number;
  private readonly deltas = new Map<number, number>();
  private readonly slopes = new Map<number, number>();
  private readonly stems = new Map<number, RiverStem[]>();
  private readonly fields = new Map<number, RiverField>();

  constructor(seed: number, known?: WorldConstants) {
    this.params = paramsFor(seed);
    this.world = createInfiniteWorld(this.params, known);
    this.settlements = this.world.settlements;
    this.sampler = terrainSampler(this.params, this.world.constants);
    this.relief = new FineRelief(seed);
    this.seaLevel = this.world.constants.seaLevel;
  }

  /** What a worker hands the next one so nothing measures the world twice. */
  constants(): WorldConstants {
    return { calibration: this.world.constants, riverThreshold: this.world.riverThreshold };
  }

  /**
   * The bare height field, in blocks: no hydrology, no rivers, no tiles, and no
   * waiting. Wrong by the hydrology's own edit — a few blocks on open ground,
   * more in a valley floor it flattened — and right about where the mountains
   * and the coasts are, which is what a caller with nowhere to stand needs.
   */
  estimate(x: number, z: number): number {
    const base = unitsToHeight(this.sampler.height(x / CELL_BLOCKS, z / CELL_BLOCKS), this.seaLevel);
    const y = Math.round(base + this.relief.at(x, z, this.baseSlope(x, z)));
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, y));
  }

  /**
   * How steep the bare height field is at a block, in terrain units per cell —
   * the same measurement `slopeMap` makes, one stage earlier, and needing no
   * tile, which is what lets `biomeAt` be asked about ground nobody has
   * generated.
   *
   * Measured on the cell lattice and interpolated, like the delta. Done per
   * block it is four more evaluations of the whole noise stack on top of the
   * one the height already costs, which made it five sixths of the price of a
   * column; on the lattice the four are shared by the 256 blocks of a cell. The
   * slope is a derivative of a field whose finest octave is seventeen blocks
   * wide, so there is nothing below the cell for the per-block version to have
   * been telling anyone.
   */
  baseSlope(x: number, z: number): number {
    const fx = x / CELL_BLOCKS, fz = z / CELL_BLOCKS;
    const cx = Math.floor(fx), cz = Math.floor(fz);
    const tx = fx - cx, tz = fz - cz;
    const s00 = this.slopeAt(cx, cz), s10 = this.slopeAt(cx + 1, cz);
    const s01 = this.slopeAt(cx, cz + 1), s11 = this.slopeAt(cx + 1, cz + 1);
    return (s00 * (1 - tx) + s10 * tx) * (1 - tz) + (s01 * (1 - tx) + s11 * tx) * tz;
  }

  private slopeAt(cellX: number, cellY: number): number {
    const key = cellY * 8388608 + cellX;
    const cached = this.slopes.get(key);
    if (cached !== undefined) return cached;
    const slope = Math.hypot(
      this.sampler.height(cellX + 1, cellY) - this.sampler.height(cellX - 1, cellY),
      this.sampler.height(cellX, cellY + 1) - this.sampler.height(cellX, cellY - 1)) * 0.5;
    this.slopes.set(key, slope);
    while (this.slopes.size > DELTA_CACHE) this.slopes.delete(this.slopes.keys().next().value as number);
    return slope;
  }

  /**
   * The lattice's answer for a column, without the rivers.
   *
   * Kept apart from `columnAt` because the two cost very different things: this
   * needs the one super-chunk that owns the cell, and the river curves need
   * that tile's whole neighbourhood. A caller that only wants to know how
   * steep and how well-watered the ground is — the land-use survey a growing
   * village runs — should not pay for nine tiles to find out.
   */
  fieldAt(x: number, z: number): FieldSample {
    const fx = x / CELL_BLOCKS, fz = z / CELL_BLOCKS;
    const cx = Math.floor(fx), cz = Math.floor(fz);
    const tx = fx - cx, tz = fz - cz;
    const d00 = this.deltaAt(cx, cz), d10 = this.deltaAt(cx + 1, cz);
    const d01 = this.deltaAt(cx, cz + 1), d11 = this.deltaAt(cx + 1, cz + 1);
    const delta = (d00 * (1 - tx) + d10 * tx) * (1 - tz) + (d01 * (1 - tx) + d11 * tx) * tz;
    const units = this.sampler.height(fx, fz) + delta;

    // The categorical fields have no meaningful average, so they come whole
    // from the tile with the loudest say about the nearest cell.
    const near = sampleGround((a, b) => this.world.superChunk(a, b), Math.round(fx), Math.round(fz));
    const chunk = near.chunk, i = near.index;
    return {
      ground: unitsToHeight(units, this.seaLevel) + this.relief.at(x, z, this.baseSlope(x, z)),
      units,
      slope: chunk.slope[i],
      landform: chunk.landform[i],
      riverDistance: chunk.riverDistance[i],
      coastDistance: chunk.coastDistance[i],
    };
  }

  /** The full answer, rivers included, building whatever tiles it takes. */
  columnAt(x: number, z: number): ColumnSample {
    // `fieldAt` has already put the sub-cell relief on, which is before the
    // channel is cut: `channelHeight` still gets a clean bed out of it and
    // `leveeHeight` still gets a bank it can guarantee is above the water.
    const field = this.fieldAt(x, z);
    let ground = field.ground;
    const river = this.riverAt(x, z);
    if (river) ground = leveeHeight(river, channelHeight(river, ground));
    const y = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(ground)));
    // The sea is `units <= seaLevel` by construction, and `unitsToHeight` maps
    // that boundary exactly onto `SEA_LEVEL`, so the block answer and the
    // tile's own mask cannot disagree about where the coast is.
    return { ...field, ground, bare: field.ground, y, sea: y < SEA_LEVEL, river };
  }

  /** The channel at a block, or null where there is none within its banks. */
  riverAt(x: number, z: number): RiverSample | null {
    const tx = superTileOf(Math.floor(x / CELL_BLOCKS)), ty = superTileOf(Math.floor(z / CELL_BLOCKS));
    return this.riverField(tx, ty).sample(x, z);
  }

  /**
   * Where a village's fields may go: 1 paddy, 2 dry field, 0 neither. Slope,
   * micro-landform and distance to water decide it, so a town's fields end up
   * on its floodplain rather than on whichever side of it a hash chose.
   */
  landUse(x: number, z: number): LandUse {
    const cellX = Math.round(x / CELL_BLOCKS), cellZ = Math.round(z / CELL_BLOCKS);
    const sample = this.fieldAt(x, z);
    const places = this.settlements.near(cellX, cellZ, landUseReach(this.params) + 2);
    return landUseAt(this.params, places, cellX, cellZ, {
      slope: sample.slope,
      landform: sample.landform,
      riverDistance: sample.riverDistance,
      // The cell-level mask rather than the curve: asking the curve would drag
      // in the eight neighbouring tiles for a question a cell can answer.
      onRiver: sample.riverDistance === 0,
    });
  }

  clear() {
    this.world.clear();
    this.deltas.clear();
    this.slopes.clear();
    this.stems.clear();
    this.fields.clear();
  }

  /** How far the hydrology moved the ground at one cell of the lattice. */
  private deltaAt(cellX: number, cellY: number): number {
    const key = cellY * 8388608 + cellX;
    const cached = this.deltas.get(key);
    if (cached !== undefined) return cached;
    const blended = sampleGround((tx, ty) => this.world.superChunk(tx, ty), cellX, cellY).height;
    const delta = blended - this.sampler.height(cellX, cellY);
    this.deltas.set(key, delta);
    while (this.deltas.size > DELTA_CACHE) this.deltas.delete(this.deltas.keys().next().value as number);
    return delta;
  }

  private stemsOf(tx: number, ty: number): RiverStem[] {
    const key = ty * 8388608 + tx;
    const cached = this.stems.get(key);
    if (cached) return cached;
    // The super-chunk is built for this and then left to the LRU: what is worth
    // keeping is the handful of polylines, not the two megabytes they came from.
    const built = buildChunkRivers(this.world.uncachedSuperChunk(tx, ty));
    this.stems.set(key, built);
    while (this.stems.size > STEM_CACHE) this.stems.delete(this.stems.keys().next().value as number);
    return built;
  }

  private riverField(tx: number, ty: number): RiverField {
    const key = ty * 8388608 + tx;
    const cached = this.fields.get(key);
    if (cached) return cached;
    // Copied, because `stitchStems` edits the runs it is given and the same
    // runs are cached and handed to every neighbouring tile's field in turn.
    // Stitching an already-stitched stem would make a tile's rivers depend on
    // which of its neighbours was asked about first.
    const stems: RiverStem[] = [];
    for (const [dx, dy] of RIVER_NEIGHBOURS) {
      for (const stem of this.stemsOf(tx + dx, ty + dy)) {
        stems.push({ order: stem.order, points: stem.points.map(point => ({ ...point })) });
      }
    }
    const joined = quantiseLevels(stitchStems(stems));
    let maxWidth = 0;
    for (const stem of joined) for (const point of stem.points) maxWidth = Math.max(maxWidth, point.width);
    const field = buildRiverField({ stems: joined, maxWidth });
    this.fields.set(key, field);
    while (this.fields.size > FIELD_CACHE) this.fields.delete(this.fields.keys().next().value as number);
    return field;
  }
}

/** Blocks from a super-chunk seam, for callers that want to warn about a wait. */
export const superChunkSpan = SUPER_INTERIOR * CELL_BLOCKS;
