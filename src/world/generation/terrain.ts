import { Noise, clamp } from '../../core/noise';
import { hashFloat, mulberry32, hashInts } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, blockIndex, chunkKey } from '../chunk';
import { WATER_FULL } from '../water';
import { type BiomeId, biomeDef, classifyBiome, isSnowy } from './biome';
import { ORES, outcropDepth, outcropIn, placeCactus, placeSugarCane } from './features';
import type { FieldParcel } from './fields';
import { bankReach } from './infinite/riverCarve';
import { MAX_HEIGHT, MIN_HEIGHT, ruggedFromSlope } from './scale';
import { VillageField, type VillageInfo } from './villageSites';
import { WorldField } from './worldField';
import type { WorldConstants } from './infinite/world';
import {
  type ChestMarker,
  type HouseRecord,
  type Footprint,
  type VillagePlan,
  type VillageVariant,
  type VillagerMarker,
  VILLAGE_RADIUS,
  planVillage,
} from './village';

/**
 * The world, as blocks.
 *
 * The ground itself comes from `WorldField`, which is the reference generator's
 * terrain and hydrology ported into `./infinite`. What is left here is
 * everything that has to know what a block is: which material a column is made
 * of, where the caves and the ore are, what grows on top, and where a town's
 * walls go. Those parts are this game's own and are unchanged.
 *
 * ## Which questions cost what
 *
 * `generateChunk` runs in a worker and may build super-chunks; that is what it
 * is for. Everything else on this class runs on the main thread and must not,
 * so `height()` and `biomeAt()` answer from two cheaper sources:
 *
 *  - the heightmap the worker sent back with a chunk, when the column is in one
 *    (`acceptHeights`). That is the common case: `TreeStore` asks about sixty
 *    columns of a chunk that has just arrived.
 *  - otherwise the bare height field, which is noise and costs microseconds.
 *    It differs from the finished ground by the hydrology's own edit — measured
 *    at two blocks or less nine times out of ten on the flat ground a village
 *    or a hamlet is sited on, more in a valley floor it flattened.
 */

export interface ChunkGenResult {
  blocks: Uint16Array;
  /** Fill level per voxel, matching the WATER blocks in `blocks`. */
  water: Uint8Array;
  /** Positions of generated spring blocks. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /** Surface Y per column, so the main thread does not have to work it out again. */
  heights: Int16Array;
}

/** What the village registry needs to know about a village, before anything has happened
 *  to it. Matches `VillageSeed` in `src/game/villages.ts`. */
export interface VillageSeed {
  x: number;
  z: number;
  baseY: number;
  variant: VillageVariant;
}

/**
 * Temperature and humidity, which the reference generator has no notion of.
 *
 * Biomes are this game's own layer: they choose the surface material, what
 * grows on it and which of the three village palettes a town is built in. The
 * two fields are kept exactly as they were, at wavelengths of a few thousand
 * blocks, so a desert is a region rather than a patch.
 */
const CLIMATE_SCALE = 3;

export class TerrainGenerator {
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly cave1: Noise;
  private readonly cave2: Noise;
  private readonly cavern: Noise;

  readonly field: WorldField;
  readonly villages: VillageField;

  private readonly villagePlanCache = new Map<string, VillagePlan>();
  private readonly growthPlotCache = new Map<string, boolean>();
  private readonly farmParcelCache = new Map<string, boolean>();
  /** Surface heights of the chunks that have been generated, by chunk key. */
  private readonly chunkHeights = new Map<string, Int16Array>();

  constructor(readonly seed: number, known?: WorldConstants) {
    this.temperature = new Noise(seed ^ 0x5005);
    this.humidity = new Noise(seed ^ 0x6006);
    this.cave1 = new Noise(seed ^ 0x7007);
    this.cave2 = new Noise(seed ^ 0x8008);
    this.cavern = new Noise(seed ^ 0x9009);
    this.field = new WorldField(seed, known);
    this.villages = new VillageField(this.field, (x, z) => this.climate(x, z));
  }

  /** The two numbers every copy of this generator has to agree on. */
  constants(): WorldConstants {
    return this.field.constants();
  }

  /**
   * Take the surface heights a worker computed while generating a chunk.
   *
   * Without this every `height()` on the main thread would fall back to the
   * bare field, and `TreeStore` alone asks about sixty columns per chunk on the
   * frame the chunk arrives.
   */
  acceptHeights(cx: number, cz: number, heights: Int16Array): void {
    this.chunkHeights.set(chunkKey(cx, cz), heights);
    while (this.chunkHeights.size > 4096) {
      this.chunkHeights.delete(this.chunkHeights.keys().next().value as string);
    }
  }

  forgetHeights(cx: number, cz: number): void {
    this.chunkHeights.delete(chunkKey(cx, cz));
  }

  /** The ground before any town levelled it. */
  rawHeight(x: number, z: number): number {
    return this.exactHeight(x, z) ?? this.field.estimate(x, z);
  }

  /** The ground a player stands on, town plateaus included. */
  height(x: number, z: number): number {
    const h = this.villages.flatten(x, z, this.rawHeight(x, z));
    return clamp(Math.round(h), MIN_HEIGHT, MAX_HEIGHT);
  }

  climate(x: number, z: number): { temperature: number; humidity: number } {
    const t = this.temperature.fbm2(x * 0.0009 / CLIMATE_SCALE, z * 0.0009 / CLIMATE_SCALE, 3) * 2.2;
    const h = this.humidity.fbm2(x * 0.0013 / CLIMATE_SCALE, z * 0.0013 / CLIMATE_SCALE, 3) * 2.2;
    return { temperature: clamp(t, -1, 1), humidity: clamp(h, -1, 1) };
  }

  /**
   * How steep the ground is around a column, on the 0..1 scale `classifyBiome`
   * wants.
   *
   * Read off the bare height field rather than the hydrology's slope map, which
   * is the same measurement one stage earlier and, unlike the slope map, does
   * not need a tile. What that costs is that a valley floor the incision cut is
   * called as rugged as the hillside it was cut into; what it buys is that
   * `biomeAt` can be asked about ground nobody has generated.
   */
  private ruggedAt(x: number, z: number): number {
    return ruggedFromSlope(this.field.baseSlope(x, z));
  }

  biomeAt(x: number, z: number): BiomeId {
    const height = this.height(x, z);
    const { temperature, humidity } = this.climate(x, z);
    return classifyBiome({
      height,
      temperature,
      humidity,
      seaLevel: SEA_LEVEL,
      rugged: this.ruggedAt(x, z),
    });
  }

  /** The generated height of a column, when a generated chunk holds it. */
  private exactHeight(x: number, z: number): number | null {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const heights = this.chunkHeights.get(chunkKey(cx, cz));
    if (!heights) return null;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    return heights[lz * CHUNK_SIZE + lx];
  }

  /** True when the column is carved out by a cave system. */
  private isCave(x: number, y: number, z: number, surfaceY: number): boolean {
    if (y < 2 || y > surfaceY - 3) return false;
    const yScale = y * 0.035;
    const a = this.cave1.noise3(x * 0.019, yScale, z * 0.019);
    const b = this.cave2.noise3(x * 0.019, yScale, z * 0.019);
    if (Math.abs(a) < 0.062 && Math.abs(b) < 0.062) return true;
    if (y < SEA_LEVEL - 2) {
      const room = this.cavern.fbm3(x * 0.013, y * 0.024, z * 0.013, 3);
      if (room > 0.52) return true;
    }
    return false;
  }

  private villagePlan(info: VillageInfo): VillagePlan {
    const key = `${info.site.x},${info.site.z}`;
    let plan = this.villagePlanCache.get(key);
    if (!plan) {
      plan = planVillage(this.seed, info.site, info.baseY, info.variant);
      this.villagePlanCache.set(key, plan);
    }
    return plan;
  }

  /** Every valid village within `cellRadius` village cells of a point. */
  villagesAround(x: number, z: number, cellRadius = 2): VillageSeed[] {
    return this.villages.around(x, z, cellRadius)
      .map(info => ({ x: info.site.x, z: info.site.z, baseY: info.baseY, variant: info.variant }));
  }

  /** A village's original houses — where they stand, which way they face and where their
   *  doors are. Cheap and independent of what is loaded: a village plan is a pure function
   *  of the seed and is cached, so this can be asked about a village nobody has visited. */
  villageBuildings(x: number, z: number): HouseRecord[] {
    const info = this.villages.at(x, z);
    if (!info.valid) return [];
    return this.villagePlan(info).buildings;
  }

  /** Nearest valid village centre, searched over the lattice around a position. */
  findNearestVillage(x: number, z: number, cellRadius = 3): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const village of this.villagesAround(x, z, cellRadius)) {
      const dist = Math.hypot(village.x - x, village.z - z);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: village.x, z: village.z };
      }
    }
    return best;
  }

  generateChunk(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const water = new Uint8Array(CHUNK_VOLUME);
    const springs: { x: number; y: number; z: number }[] = [];
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    /** Columns with water standing on them, so nothing is laid over a river. */
    const wet = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    const setLocal = (lx: number, y: number, lz: number, id: BlockId, level = WATER_FULL): void => {
      if (y < 0 || y >= CHUNK_HEIGHT || lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
      const index = blockIndex(lx, y, lz);
      blocks[index] = id;
      // Generated water starts out full; anything else placed over it dries the cell.
      water[index] = id === Block.WATER ? level : 0;
    };
    /** World-space setter that silently drops anything outside this chunk. */
    const put = (x: number, y: number, z: number, id: BlockId): void => {
      setLocal(x - originX, y, z - originZ, id);
    };

    // --- 1. columns: stone shell, surface material, sea and rivers ----------
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        const column = this.field.columnAt(x, z);
        const h = clamp(Math.round(this.villages.flatten(x, z, column.y)), MIN_HEIGHT, MAX_HEIGHT);
        const { temperature, humidity } = this.climate(x, z);
        const biome = classifyBiome({
          height: h,
          temperature,
          humidity,
          seaLevel: SEA_LEVEL,
          rugged: ruggedFromSlope(column.slope),
        });
        const def = biomeDef(biome);
        heights[lz * CHUNK_SIZE + lx] = h;
        biomes[lz * CHUNK_SIZE + lx] = biome;

        // A river's banks are its own material, not the biome's turf: grass
        // running to the water's edge is the one thing that makes a carved
        // channel read as a canal.
        const river = column.river;
        const inChannel = river !== null && river.distance <= river.width * 0.5;
        const onBank = river !== null && river.distance <= river.width * 0.5 + bankReach(river);
        const surface = onBank && h <= river.waterY + 1 ? def.bank : def.surface;
        const fillerTop = h - 1;
        const fillerBottom = h - def.fillerDepth;
        for (let y = 0; y <= h; y++) {
          let id: BlockId;
          if (y === 0) id = Block.BEDROCK;
          else if (y <= 2 && hashFloat(this.seed, x, y, z) < 0.5) id = Block.BEDROCK;
          else if (y === h) id = surface;
          else if (y >= fillerBottom && y <= fillerTop) id = def.filler;
          else if (def.underFiller && y >= fillerBottom - 3 && y < fillerBottom) id = def.underFiller;
          else id = Block.STONE;
          setLocal(lx, y, lz, id);
        }
        // Submerged surfaces stay sandy instead of grassy.
        if (h < SEA_LEVEL && def.surface === Block.GRASS) {
          setLocal(lx, h, lz, Block.SAND);
          setLocal(lx, h - 1, lz, Block.SAND);
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) setLocal(lx, y, lz, Block.WATER);
        if (h < SEA_LEVEL && isSnowy(biome)) setLocal(lx, SEA_LEVEL, lz, Block.ICE);

        // The river, above the sea. `waterY` is a whole block and steps only
        // downstream, so what goes in is a flat pool rather than a slope the
        // water simulator would pour down (see `quantiseLevels`).
        if (inChannel && river.waterY > SEA_LEVEL) {
          for (let y = Math.max(h + 1, SEA_LEVEL + 1); y <= river.waterY; y++) {
            setLocal(lx, y, lz, Block.WATER);
          }
          if (isSnowy(biome)) setLocal(lx, river.waterY, lz, Block.ICE);
          wet[lz * CHUNK_SIZE + lx] = 1;
        }
        if (h < SEA_LEVEL) wet[lz * CHUNK_SIZE + lx] = 1;
      }
    }

    // --- 2. caves -----------------------------------------------------------
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        const h = heights[lz * CHUNK_SIZE + lx];
        for (let y = 1; y < h; y++) {
          const index = blockIndex(lx, y, lz);
          const current = blocks[index];
          if (current === Block.BEDROCK || current === Block.WATER) continue;
          if (this.isCave(x, y, z, h)) {
            blocks[index] = Block.AIR;
            water[index] = 0;
          }
        }
      }
    }

    // --- 3. ore veins -------------------------------------------------------
    const oreRng = mulberry32(hashInts(this.seed ^ 0x0e5e, cx, cz));
    for (const ore of ORES) {
      for (let attempt = 0; attempt < ore.tries; attempt++) {
        let x = originX + Math.floor(oreRng() * CHUNK_SIZE);
        let z = originZ + Math.floor(oreRng() * CHUNK_SIZE);
        let y = ore.minY + Math.floor(oreRng() * (ore.maxY - ore.minY + 1));
        for (let step = 0; step < ore.size; step++) {
          const lx = x - originX;
          const lz = z - originZ;
          if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && y > 0 && y < CHUNK_HEIGHT) {
            const index = blockIndex(lx, y, lz);
            if (blocks[index] === Block.STONE) blocks[index] = ore.block;
          }
          x += Math.round(oreRng() * 2 - 1);
          z += Math.round(oreRng() * 2 - 1);
          y += Math.round(oreRng() * 2 - 1);
          y = clamp(y, ore.minY, ore.maxY);
        }
      }
    }

    // --- 4. vegetation ------------------------------------------------------
    this.decorate(cx, cz, blocks, heights, biomes, put);

    // --- 4b. outcrops (after the trees, so nothing grows out of bare rock) ---
    this.expose(cx, cz, blocks, heights, water, wet);

    // --- 5. villages (last, so they overwrite trees and grass) --------------
    const villagers: VillagerMarker[] = [];
    const chests: ChestMarker[] = [];
    const key = chunkKey(cx, cz);
    for (const info of this.villagesForChunk(cx, cz)) {
      const plan = this.villagePlan(info);
      const placements = plan.byChunk.get(key);
      if (placements) {
        for (const p of placements) put(p.x, p.y, p.z, p.b);
      }
      for (const v of plan.villagers) {
        if (containsColumn(cx, cz, v.x, v.z)) villagers.push(v);
      }
      for (const c of plan.chests) {
        if (containsColumn(cx, cz, c.x, c.z)) chests.push(c);
      }
    }

    return { blocks, water, springs, villagers, chests, heights };
  }

  /** Villages whose block list can reach into this chunk (plateau radius plus slack). */
  private villagesForChunk(cx: number, cz: number): VillageInfo[] {
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    return this.villages.near(centerX, centerZ);
  }

  /** Lays whatever ore breaks the surface around here.
   *
   *  The 3x3 of neighbouring chunks is replayed, not just this one, so a patch that
   *  straddles a chunk boundary is one patch rather than two halves that do not line up.
   *  Outcrops are laid over the vegetation because that is what they are: bare rock, with
   *  nothing growing on it. */
  private expose(
    cx: number,
    cz: number,
    blocks: Uint16Array,
    heights: Int16Array,
    water: Uint8Array,
    wet: Uint8Array,
  ): void {
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const patch = outcropIn(this.seed, cx + dx, cz + dz);
        if (!patch) continue;
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const x = originX + lx;
            const z = originZ + lz;
            const depth = outcropDepth(this.seed, patch, x, z);
            if (depth <= 0) continue;
            const h = heights[lz * CHUNK_SIZE + lx];
            // Nothing under water: a seam on a river bed is invisible, which defeats the
            // whole purpose of putting one at the surface.
            if (h <= SEA_LEVEL || wet[lz * CHUNK_SIZE + lx]) continue;
            for (let y = h - depth; y < h; y++) {
              if (y < 1 || y >= CHUNK_HEIGHT) continue;
              const index = blockIndex(lx, y, lz);
              const current = blocks[index];
              if (current === Block.AIR || current === Block.WATER || current === Block.BEDROCK) continue;
              blocks[index] = patch.block;
            }
            // Whatever was growing on top of it is not any more.
            const above = blockIndex(lx, h, lz);
            if (above < blocks.length && blocks[above] !== Block.AIR && water[above] === 0) {
              blocks[above] = Block.AIR;
            }
          }
        }
      }
    }
  }

  private decorate(
    cx: number,
    cz: number,
    blocks: Uint16Array,
    heights: Int16Array,
    biomes: Uint8Array,
    put: (x: number, y: number, z: number, id: BlockId) => void,
  ): void {
    // Natural trees are independent objects owned by TreeStore. Keeping them out of the
    // voxel payload means one tree can be selected, collided with and felled as a whole.

    // Ground cover only ever affects its own column, so no neighbour scan is needed.
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        const h = heights[lz * CHUNK_SIZE + lx];
        if (h <= SEA_LEVEL) continue;
        const index = blockIndex(lx, h, lz);
        const surface = blocks[index];
        if (blocks[blockIndex(lx, h + 1, lz)] !== Block.AIR) continue;
        const def = biomeDef(biomes[lz * CHUNK_SIZE + lx]);
        const rng = mulberry32(hashInts(this.seed ^ 0xc0ffee, x, z));
        if (this.villages.inside(x, z)) continue;
        const roll = rng();
        if (surface === Block.GRASS) {
          if (roll < def.flowerDensity) {
            put(x, h + 1, z, rng() < 0.5 ? Block.FLOWER_RED : Block.FLOWER_YELLOW);
          } else if (roll < def.flowerDensity + def.grassDensity) {
            put(x, h + 1, z, Block.TALL_GRASS);
          } else if (
            def.sugarCaneDensity > 0 &&
            roll < def.flowerDensity + def.grassDensity + def.sugarCaneDensity &&
            this.nextToWater(blocks, lx, h, lz)
          ) {
            placeSugarCane(put, rng, x, h, z);
          }
        } else if (surface === Block.SAND) {
          if (roll < def.cactusDensity) placeCactus(put, rng, x, h, z);
          else if (roll < def.cactusDensity + 0.01) put(x, h + 1, z, Block.DEAD_BUSH);
          else if (def.sugarCaneDensity > 0 && roll < 0.3 && this.nextToWater(blocks, lx, h, lz)) {
            placeSugarCane(put, rng, x, h, z);
          }
        }
      }
    }
  }

  private nextToWater(blocks: Uint16Array, lx: number, y: number, lz: number): boolean {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = lx + dx;
      const nz = lz + dz;
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;
      if (blocks[blockIndex(nx, y, nz)] === Block.WATER) return true;
      if (blocks[blockIndex(nx, y + 1, nz)] === Block.WATER) return true;
    }
    return false;
  }

  /** Whether an earned town block can be terraced at the village's floor level.
   *
   *  Growth deliberately keeps one shared street level: accepting a distant hill and
   *  then forcing a flat pad through it produces either a floating house or a quarry.
   *  The limits mirror village growth's eight blocks of fill and five blocks of cut.
   *  Nearby settlements also count as occupied land, so two endlessly growing towns do
   *  not eventually build through one another. */
  canBuildVillagePlot(
    village: { x: number; z: number; baseY: number },
    plot: Footprint,
  ): boolean {
    const key = `${village.x},${village.z},${village.baseY}:${plot.x0},${plot.z0},${plot.w},${plot.d}`;
    const cached = this.growthPlotCache.get(key);
    if (cached !== undefined) return cached;
    const cx = plot.x0 + (plot.w - 1) / 2;
    const cz = plot.z0 + (plot.d - 1) / 2;
    for (const other of this.villagesAround(cx, cz, 1)) {
      if (other.x === village.x && other.z === village.z) continue;
      if (Math.hypot(other.x - cx, other.z - cz) < VILLAGE_RADIUS * 0.72) {
        this.growthPlotCache.set(key, false);
        return false;
      }
    }
    for (let z = plot.z0; z < plot.z0 + plot.d; z += 3) {
      for (let x = plot.x0; x < plot.x0 + plot.w; x += 3) {
        const h = this.height(x, z);
        if (h < village.baseY - 7 || h > village.baseY + 5) {
          this.growthPlotCache.set(key, false);
          return false;
        }
        if (h <= SEA_LEVEL + 1 || !biomeDef(this.biomeAt(x, z)).allowsVillage) {
          this.growthPlotCache.set(key, false);
          return false;
        }
      }
    }
    this.growthPlotCache.set(key, true);
    return true;
  }

  /**
   * Whether enough of a parcel is land a village would actually farm.
   *
   * Two questions, both sampled every four blocks. The first is the old one:
   * is it dry, and is the biome one a town can work? The second is the land-use
   * layer's, and it is what decides *which side of the town* the fields end up
   * on: paddy on the levees and backswamp near a channel, dry field on the
   * terraces, nothing on ground too steep or too far from water. `fieldSideFor`
   * in `./fields` already compares the four sides through this survey, so a
   * town's agricultural side now faces its floodplain rather than whichever
   * direction a hash chose.
   *
   * Individual rocks and stream banks are still left alone by the plough; this
   * only rejects a parcel whose broad shape is wrong.
   */
  canFarmVillageParcel(
    village: { x: number; z: number },
    parcel: FieldParcel,
  ): boolean {
    const key = `${village.x},${village.z}:${parcel.x0},${parcel.z0},${parcel.w},${parcel.d}`;
    const cached = this.farmParcelCache.get(key);
    if (cached !== undefined) return cached;
    const cx = parcel.x0 + (parcel.w - 1) / 2;
    const cz = parcel.z0 + (parcel.d - 1) / 2;
    for (const other of this.villagesAround(cx, cz, 1)) {
      if (other.x === village.x && other.z === village.z) continue;
      if (Math.hypot(other.x - cx, other.z - cz) < VILLAGE_RADIUS * 0.82) {
        this.farmParcelCache.set(key, false);
        return false;
      }
    }
    let usable = 0;
    let arable = 0;
    let sampled = 0;
    for (let z = parcel.z0; z < parcel.z0 + parcel.d; z += 4) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x += 4) {
        sampled++;
        const h = this.height(x, z);
        if (h > SEA_LEVEL + 1 && biomeDef(this.biomeAt(x, z)).allowsVillage) usable++;
        if (this.field.landUse(x, z).farm !== 0) arable++;
      }
    }
    const suitable = usable >= sampled * 0.6 && arable >= sampled * 0.5;
    this.farmParcelCache.set(key, suitable);
    return suitable;
  }

  /** Public vegetation exclusion used by deterministic object-tree generation. */
  isInsideVillage(x: number, z: number): boolean {
    return this.villages.inside(x, z);
  }
}

function containsColumn(cx: number, cz: number, x: number, z: number): boolean {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  return x >= originX && x < originX + CHUNK_SIZE && z >= originZ && z < originZ + CHUNK_SIZE;
}
