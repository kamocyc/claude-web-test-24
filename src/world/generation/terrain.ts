import { Noise, clamp, lerp, smoothstep } from '../../core/noise';
import { hashFloat, mulberry32, hashInts } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, blockIndex, chunkKey } from '../chunk';
import { WATER_FULL } from '../water';
import { Biome, type BiomeId, biomeDef, classifyBiome, isSnowy } from './biome';
import { ORES, placeCactus, placeSugarCane, placeTree, treeCandidates } from './features';
import {
  CHANNEL_CORE,
  RIVER_CLIMB,
  RiverField,
  type RiverSample,
  inlandOfSurface,
  inlandness,
  riverCovers,
  seasonalSurface,
} from './rivers';
import { localWetness } from '../weather';
import {
  type ChestMarker,
  type VillagePlan,
  type VillageSite,
  type VillageVariant,
  type VillagerMarker,
  VILLAGE_CELL,
  VILLAGE_RADIUS,
  nearbyVillageSites,
  planVillage,
  plateauWeight,
  villageInCell,
} from './village';

export interface ChunkGenResult {
  blocks: Uint16Array;
  /** Fill level per voxel, matching the WATER blocks in `blocks`. */
  water: Uint8Array;
  /** Per column, the height of the river's water in a normal season, or 0 where there
   *  is no river. The weather moves the water up and down from here without the
   *  terrain having to be worked out all over again. */
  riverSurface: Float32Array;
  /** World clock the water in `water` was filled for. */
  weatherSeconds: number;
  /** Positions of generated spring blocks. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

interface VillageInfo {
  site: VillageSite;
  valid: boolean;
  baseY: number;
  variant: VillageVariant;
}

const MIN_HEIGHT = 4;
/** Thinnest film the generator will lay as a river's topmost cell. Anything shallower
 *  is invisible, so the surface is left flush with the block boundary instead. */
const MIN_FILM = 10;

/** How full one cell of a river column is, for a surface given as a fraction of a
 *  block. The topmost cell is only part filled, which is what turns the water into a
 *  smooth ramp instead of a staircase of whole blocks. Shared with the code that follows
 *  the weather, so a generated river and a river whose level has moved agree exactly. */
export function riverCellLevel(surface: number, ground: number, y: number): number {
  const top = Math.floor(surface);
  if (y <= ground || y > top) return 0;
  if (y < top) return WATER_FULL;
  const film = Math.round((surface - top) * WATER_FULL);
  // A film thinner than this is invisible, so the surface is left flush with the block
  // boundary rather than costing a draw call for nothing.
  return film >= MIN_FILM ? film : 0;
}

/** Lays a river column's water, from the ground up to the surface. */
export function fillRiverColumn(
  surface: number,
  ground: number,
  put: (y: number, level: number) => void,
): void {
  for (let y = ground + 1; y <= Math.floor(surface); y++) {
    const level = riverCellLevel(surface, ground, y);
    if (level > 0) put(y, level);
  }
}
const MAX_HEIGHT = CHUNK_HEIGHT - 12;

/** Turns a seed into terrain. Every method is a pure function of the seed plus the
 *  requested coordinates, so chunks can be generated in any order, on any thread. */
export class TerrainGenerator {
  private readonly continent: Noise;
  private readonly erosion: Noise;
  private readonly ridge: Noise;
  private readonly detail: Noise;
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly cave1: Noise;
  private readonly cave2: Noise;
  private readonly cavern: Noise;
  private readonly rivers: RiverField;

  private readonly villageInfoCache = new Map<string, VillageInfo>();
  private readonly villagePlanCache = new Map<string, VillagePlan>();

  constructor(readonly seed: number) {
    this.continent = new Noise(seed ^ 0x1001);
    this.erosion = new Noise(seed ^ 0x2002);
    this.ridge = new Noise(seed ^ 0x3003);
    this.detail = new Noise(seed ^ 0x4004);
    this.temperature = new Noise(seed ^ 0x5005);
    this.humidity = new Noise(seed ^ 0x6006);
    this.cave1 = new Noise(seed ^ 0x7007);
    this.cave2 = new Noise(seed ^ 0x8008);
    this.cavern = new Noise(seed ^ 0x9009);
    this.rivers = new RiverField(seed, (x, z) => this.inlandAt(x, z));
  }

  /** Terrain height before villages flatten anything. */
  rawHeight(x: number, z: number): number {
    const cont = this.continent.fbm2(x * 0.0011, z * 0.0011, 4);
    const ero = this.erosion.fbm2(x * 0.0027, z * 0.0027, 3);
    const ridge = this.ridge.ridged2(x * 0.0042, z * 0.0042, 4);
    const detail = this.detail.fbm2(x * 0.02, z * 0.02, 3);

    // Thresholds are tuned so land covers roughly three quarters of the map and
    // mountains stay rare enough to feel like landmarks.
    // The bias pushes the sea/land boundary out so oceans stay a minority of the map.
    const land = smoothstep(-0.22, 0.05, cont + 0.16);
    const hilly = smoothstep(-0.15, 0.28, ero);
    const mountain = smoothstep(0.15, 0.42, ero) * smoothstep(0.3, 0.68, ridge);

    // Land rises steadily towards the interior. That slope is what every river runs
    // down, and it comes from a deliberately smooth field so a channel never meets a
    // hump on its way to the sea.
    const base =
      SEA_LEVEL -
      14 +
      land * 17 +
      this.liftFrom(cont, x, z) * RIVER_CLIMB +
      land * hilly * (6 + detail * 6) +
      land * mountain * (26 + ridge * 30);
    // The fine detail is left out of `base` so the river surface, which is derived
    // from it, does not jitter up and down along the channel.
    const h = this.carveRiver(base + detail * 2, base, x, z, cont);
    return clamp(Math.round(h), MIN_HEIGHT, MAX_HEIGHT);
  }

  /** Terrain height before the fine detail is added, which is the level rivers and
   *  villages are measured against. */
  private baseHeight(x: number, z: number, cont: number): number {
    const ero = this.erosion.fbm2(x * 0.0027, z * 0.0027, 3);
    const ridge = this.ridge.ridged2(x * 0.0042, z * 0.0042, 4);
    const detail = this.detail.fbm2(x * 0.02, z * 0.02, 3);
    const land = smoothstep(-0.22, 0.05, cont + 0.16);
    const hilly = smoothstep(-0.15, 0.28, ero);
    const mountain = smoothstep(0.15, 0.42, ero) * smoothstep(0.3, 0.68, ridge);
    return (
      SEA_LEVEL -
      14 +
      land * 17 +
      this.liftFrom(cont, x, z) * RIVER_CLIMB +
      land * hilly * (6 + detail * 6) +
      land * mountain * (26 + ridge * 30)
    );
  }

  /** How far a column is lifted towards the interior, 0 at the coast and 1 deep inland.
   *  Both the land and the water standing on it are raised by exactly this, which is
   *  what keeps a channel sunk into its banks all the way down to the sea.
   *
   *  The inland part is deliberately much smoother than the field that draws the
   *  coastline. A river's path is the level set of an unrelated noise, so it crosses
   *  these contours in whatever direction it likes: every wiggle here would become a
   *  stretch of river that runs uphill and back down, and no amount of water simulation
   *  can make that look like a river. */
  inlandAt(x: number, z: number): number {
    return this.liftFrom(this.continentalness(x, z), x, z);
  }

  /** The same thing for a caller that has already paid for the continentalness. */
  private liftFrom(cont: number, x: number, z: number): number {
    const land = smoothstep(-0.22, 0.05, cont + 0.16);
    return land * inlandness(this.continent.fbm2(x * 0.0006, z * 0.0006, 2));
  }

  /** Continentalness decides land from sea, and how the coastline winds. */
  private continentalness(x: number, z: number): number {
    return this.continent.fbm2(x * 0.0011, z * 0.0011, 4);
  }

  /** How far the world clock has run, in seconds. The weather upstream is a function of
   *  this, and so is the height of every river. Tests leave it at zero, where the cycle
   *  has not started and every river sits at its normal level. */
  weatherSeconds = 0;

  /** How far this column's water sits from its normal level right now. The weather
   *  happens in the headwaters and takes minutes to run down, so two points on the same
   *  river can be in different seasons. */
  riverOffset(sample: RiverSample): number {
    if (sample.strength <= 0) return 0;
    return this.riverSurfaceNow(sample) - sample.surface;
  }

  /** Where the water's top face actually is at a column, weather included. */
  riverSurfaceNow(sample: RiverSample): number {
    if (sample.strength <= 0) return sample.surface;
    return seasonalSurface(
      sample.surface,
      localWetness(this.seed, this.weatherSeconds, sample.inland),
    );
  }

  /** River channel at a column, or a dry sample outside one. Already clamped so the
   *  water surface always sits below the surrounding land. */
  riverAt(x: number, z: number): RiverSample {
    const cont = this.continentalness(x, z);
    return this.riverSample(x, z, cont, this.baseHeight(x, z, cont));
  }

  /** River sample with the mountain fade already applied, so callers and the carving
   *  code always agree on where a channel actually exists. */
  private riverSample(x: number, z: number, cont: number, base: number): RiverSample {
    const river = this.rivers.sample(x, z, cont);
    if (river.strength <= 0) return river;
    // Rivers fade out at the foot of a mountain rather than slicing a canyon through it.
    const reach = 1 - smoothstep(16, 30, base - river.surface);
    return reach >= 1 ? river : { ...river, strength: river.strength * reach };
  }

  /** Cuts the river channel into the land. Rivers fade out rather than slicing a
   *  canyon through a mountain range. */
  private carveRiver(height: number, base: number, x: number, z: number, cont: number): number {
    const river = this.riverSample(x, z, cont, base);
    if (river.strength <= 0.02) return height;
    const bed = Math.min(height, river.floor);
    // Inside the channel the bed is cut outright. Easing it in by strength, as this
    // used to, left the bed above the water line wherever the land around it rose
    // more than a block or two, which broke the river into disconnected pools.
    if (river.strength >= CHANNEL_CORE) return bed;
    // Outside the channel the land is only eased down to a lip one block clear of the
    // water. Letting the bank dip below the water line left a one block film of water
    // lying on every terrace of the slope, which read as the river climbing the hill.
    const lip = Math.max(Math.ceil(river.surface), bed);
    return lerp(height, Math.min(height, lip), river.strength / CHANNEL_CORE);
  }

  /** Terrain height including the flat plateau a village sits on. */
  height(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const info of this.villagesNear(x, z)) {
      if (!info.valid) continue;
      const w = plateauWeight(info.site, x, z);
      if (w <= 0) continue;
      h = Math.round(lerp(h, info.baseY, w));
    }
    return clamp(h, MIN_HEIGHT, MAX_HEIGHT);
  }

  climate(x: number, z: number): { temperature: number; humidity: number } {
    // fBm output clusters near zero, so it is stretched to make the whole
    // temperature/humidity range reachable and keep every biome represented.
    return {
      temperature: clamp(this.temperature.fbm2(x * 0.0009, z * 0.0009, 3) * 2.2, -1, 1),
      humidity: clamp(this.humidity.fbm2(x * 0.0013, z * 0.0013, 3) * 2.2, -1, 1),
    };
  }

  biomeAt(x: number, z: number): BiomeId {
    const height = this.height(x, z);
    const { temperature, humidity } = this.climate(x, z);
    return classifyBiome({ height, temperature, humidity, seaLevel: SEA_LEVEL });
  }

  /** True when the column is carved out by a cave system. */
  private isCave(x: number, y: number, z: number, surfaceY: number): boolean {
    if (y < 2 || y > surfaceY - 3) return false;
    const yScale = y * 0.035;
    const a = this.cave1.noise3(x * 0.019, yScale, z * 0.019);
    const b = this.cave2.noise3(x * 0.019, yScale, z * 0.019);
    if (Math.abs(a) < 0.062 && Math.abs(b) < 0.062) return true;
    if (y < 44) {
      const room = this.cavern.fbm3(x * 0.013, y * 0.024, z * 0.013, 3);
      if (room > 0.52) return true;
    }
    return false;
  }

  /** Villages whose plateau may influence this column. */
  private villagesNear(x: number, z: number): VillageInfo[] {
    const sites = nearbyVillageSites(this.seed, x, z);
    const out: VillageInfo[] = [];
    for (const site of sites) out.push(this.villageInfo(site));
    return out;
  }

  private villageInfo(site: VillageSite): VillageInfo {
    const key = `${site.x},${site.z}`;
    const cached = this.villageInfoCache.get(key);
    if (cached) return cached;

    const baseY = this.rawHeight(site.x, site.z);
    const { temperature, humidity } = this.climate(site.x, site.z);
    const biome = classifyBiome({ height: baseY, temperature, humidity, seaLevel: SEA_LEVEL });
    const def = biomeDef(biome);
    // Villages need reasonably flat, dry, buildable ground.
    let valid = def.allowsVillage && baseY > SEA_LEVEL + 2 && baseY < SEA_LEVEL + 24;
    // Never flatten a village over a river: the plateau would dam it. The whole
    // plateau has to be clear, not just the centre, because it reaches 38 blocks out.
    if (valid && this.riverNearVillage(site.x, site.z)) valid = false;
    if (valid) {
      // Reject sites where the surrounding land is too steep to plausibly flatten.
      let min = baseY;
      let max = baseY;
      for (const [dx, dz] of [[-20, 0], [20, 0], [0, -20], [0, 20], [14, 14], [-14, -14]] as const) {
        const h = this.rawHeight(site.x + dx, site.z + dz);
        if (h < min) min = h;
        if (h > max) max = h;
      }
      if (max - min > 16) valid = false;
    }
    const variant: VillageVariant =
      biome === Biome.DESERT ? 'desert' : isSnowy(biome) ? 'snowy' : 'plains';
    const info: VillageInfo = { site, valid, baseY: baseY + 1, variant };
    this.villageInfoCache.set(key, info);
    return info;
  }

  /** True when any part of a village plateau would sit on a river channel. */
  private riverNearVillage(x: number, z: number): boolean {
    if (this.riverAt(x, z).strength > 0.02) return true;
    for (let ring = 10; ring <= VILLAGE_RADIUS; ring += 9) {
      for (let step = 0; step < 12; step++) {
        const angle = (step / 12) * Math.PI * 2;
        const sx = Math.round(x + Math.cos(angle) * ring);
        const sz = Math.round(z + Math.sin(angle) * ring);
        if (this.riverAt(sx, sz).strength > 0.02) return true;
      }
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

  /** Nearest valid village centre, searched over the village grid around a position. */
  findNearestVillage(x: number, z: number, cellRadius = 3): { x: number; z: number } | null {
    const cellX = Math.floor(x / VILLAGE_CELL);
    const cellZ = Math.floor(z / VILLAGE_CELL);
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const site = villageInCell(this.seed, cellX + dx, cellZ + dz);
        if (!site) continue;
        const info = this.villageInfo(site);
        if (!info.valid) continue;
        const dist = Math.hypot(site.x - x, site.z - z);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: site.x, z: site.z };
        }
      }
    }
    return best;
  }

  generateChunk(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const water = new Uint8Array(CHUNK_VOLUME);
    const riverSurface = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
    const springs: { x: number; y: number; z: number }[] = [];
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

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

    // --- 1. columns: stone shell, surface material, oceans -------------------
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        const h = this.height(x, z);
        const { temperature, humidity } = this.climate(x, z);
        const biome = classifyBiome({ height: h, temperature, humidity, seaLevel: SEA_LEVEL });
        const def = biomeDef(biome);
        heights[lz * CHUNK_SIZE + lx] = h;
        biomes[lz * CHUNK_SIZE + lx] = biome;

        const fillerTop = h - 1;
        const fillerBottom = h - def.fillerDepth;
        for (let y = 0; y <= h; y++) {
          let id: BlockId;
          if (y === 0) id = Block.BEDROCK;
          else if (y <= 2 && hashFloat(this.seed, x, y, z) < 0.5) id = Block.BEDROCK;
          else if (y === h) id = def.surface;
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

        // Rivers run above sea level, so they are filled from their own surface.
        const cont = this.continentalness(x, z);
        const river = this.riverSample(x, z, cont, this.baseHeight(x, z, cont));
        // Only the channel itself holds water; its banks are carved to stay above the
        // water line, so the two thresholds have to be the same one.
        if (river.strength >= CHANNEL_CORE) {
          // Stored at single precision and read straight back, so the code that later
          // follows the weather works from exactly the same number and can tell its own
          // water apart from anything the player has changed.
          riverSurface[lz * CHUNK_SIZE + lx] = river.surface;
          const base = riverSurface[lz * CHUNK_SIZE + lx];
          const surface = seasonalSurface(
            base,
            localWetness(this.seed, this.weatherSeconds, inlandOfSurface(base)),
          );
          if (surface > h + 1) {
            fillRiverColumn(surface, h, (y, level) => setLocal(lx, y, lz, Block.WATER, level));
          }
        }
        // A spring is placed for the channel itself, not for whatever the weather is
        // doing today, so a drought never moves one.
        if (riverCovers(river, h) && this.rivers.isSpringSite(this.seed, x, z, river, cont)) {
          setLocal(lx, h, lz, Block.SPRING);
          springs.push({ x, y: h, z });
        }
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

    // --- 5. villages (last, so they overwrite trees and grass) --------------
    const villagers: VillagerMarker[] = [];
    const chests: ChestMarker[] = [];
    const key = chunkKey(cx, cz);
    for (const info of this.villagesForChunk(cx, cz)) {
      if (!info.valid) continue;
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

    return { blocks, water, riverSurface, weatherSeconds: this.weatherSeconds, springs, villagers, chests };
  }

  /** Villages whose block list can reach into this chunk (plateau radius plus slack). */
  private villagesForChunk(cx: number, cz: number): VillageInfo[] {
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    const seen = new Set<string>();
    const out: VillageInfo[] = [];
    for (const site of nearbyVillageSites(this.seed, centerX, centerZ)) {
      const key = `${site.x},${site.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(this.villageInfo(site));
    }
    return out;
  }

  private decorate(
    cx: number,
    cz: number,
    blocks: Uint16Array,
    heights: Int16Array,
    biomes: Uint8Array,
    put: (x: number, y: number, z: number, id: BlockId) => void,
  ): void {
    // Trees are generated for this chunk and all eight neighbours, then clipped, so a
    // canopy that crosses a chunk border still appears whichever chunk loads first.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ncx = cx + dx;
        const ncz = cz + dz;
        const sampleX = ncx * CHUNK_SIZE + 8;
        const sampleZ = ncz * CHUNK_SIZE + 8;
        const biome = this.biomeAt(sampleX, sampleZ);
        const def = biomeDef(biome);
        if (def.treeDensity <= 0) continue;
        for (const candidate of treeCandidates(this.seed, ncx, ncz, def.treeDensity)) {
          const groundY = this.height(candidate.x, candidate.z);
          if (groundY <= SEA_LEVEL + 1) continue;
          const localBiome = this.biomeAt(candidate.x, candidate.z);
          const localDef = biomeDef(localBiome);
          if (localDef.treeDensity <= 0) continue;
          if (this.insideVillage(candidate.x, candidate.z)) continue;
          // Trees do not grow in the river bed.
          if (this.riverAt(candidate.x, candidate.z).strength > 0.2) continue;
          placeTree(put, candidate.rng, candidate.x, groundY, candidate.z, {
            log: localDef.treeLog,
            leaves: localDef.treeLeaves,
            conifer: localDef.treeLog === Block.SPRUCE_LOG,
          });
        }
      }
    }

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
        if (this.insideVillage(x, z)) continue;
        if (this.riverAt(x, z).strength > 0.2) continue;
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

  private insideVillage(x: number, z: number): boolean {
    for (const info of this.villagesNear(x, z)) {
      if (!info.valid) continue;
      if (plateauWeight(info.site, x, z) > 0.35) return true;
    }
    return false;
  }
}

function containsColumn(cx: number, cz: number, x: number, z: number): boolean {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  return x >= originX && x < originX + CHUNK_SIZE && z >= originZ && z < originZ + CHUNK_SIZE;
}
