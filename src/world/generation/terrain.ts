import { Noise, clamp, lerp, smoothstep } from '../../core/noise';
import { hashFloat, mulberry32, hashInts } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  SEA_LEVEL,
  blockIndex,
  chunkKey,
  isInsideWorld,
  toChunkCoord,
} from '../chunk';
import { WATER_FULL } from '../water';
import { Biome, type BiomeId, biomeDef, classifyBiome, isSnowy } from './biome';
import { ORES, placeCactus, placeSugarCane, placeTree, treeCandidates } from './features';
import { RIVER_CLIMB, RiverField, type RiverSample, inlandness, riverCovers } from './rivers';
import {
  type ChestMarker,
  type VillagePlan,
  type VillageSite,
  type VillageVariant,
  type VillagerMarker,
  VILLAGE_CELL,
  nearbyVillageCells,
  planVillage,
  plateauWeight,
  villageCandidates,
} from './village';

export interface ChunkGenResult {
  blocks: Uint16Array;
  /** Fill level per voxel, matching the WATER blocks in `blocks`. */
  water: Uint8Array;
  /** Per column, 1 where the ground is below sea level. The ocean is bigger than the
   *  map, so whatever a river delivers into it drains away instead of raising it. */
  seaColumn: Uint8Array;
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
/** How far a village centre keeps from the water. Only wide enough that no building
 *  ends up standing in the river: the plateau itself may reach across a channel, because
 *  the channel is cut back in afterwards and so is never dammed. */
const VILLAGE_KEEP_CLEAR = 20;

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
  /** Built on first use, not in the constructor: it walks the whole island, which costs
   *  a fraction of a second and is wasted on a generator only asked about the climate. */
  private riverField: RiverField | null = null;

  private readonly villageInfoCache = new Map<string, VillageInfo>();
  /** The chosen village for a grid cell, or null when nowhere in it was buildable. */
  private readonly villageCellCache = new Map<string, VillageInfo | null>();
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
  }

  /** The island's drainage network: where every channel runs, how much land drains
   *  through it, and so how wide and deep it is. */
  private get rivers(): RiverField {
    if (!this.riverField) {
      this.riverField = new RiverField((x, z) => this.naturalHeight(x, z));
    }
    return this.riverField;
  }

  /** Works out the drainage network up front. It is built on demand anyway; calling
   *  this just moves the cost somewhere the caller has chosen. */
  prepare(): void {
    void this.rivers;
  }

  /** Terrain height before villages flatten anything. */
  rawHeight(x: number, z: number): number {
    const carved = this.rivers.carve(this.naturalHeight(x, z), x, z);
    return clamp(Math.round(carved), MIN_HEIGHT, MAX_HEIGHT);
  }

  /** The land as the noise left it, before any channel is cut into it. This is what the
   *  drainage network is computed from, so it must never ask the network anything. */
  naturalHeight(x: number, z: number): number {
    const cont = this.continentalness(x, z);
    const ero = this.erosion.fbm2(x * 0.0027, z * 0.0027, 3);
    const ridge = this.ridge.ridged2(x * 0.0042, z * 0.0042, 4);
    const detail = this.detail.fbm2(x * 0.02, z * 0.02, 3);

    // Thresholds are tuned so land covers roughly three quarters of the map and
    // mountains stay rare enough to feel like landmarks.
    // The bias pushes the sea/land boundary out so oceans stay a minority of the map.
    const land = smoothstep(-0.22, 0.05, cont + 0.16);
    const hilly = smoothstep(-0.15, 0.28, ero);
    const mountain = smoothstep(0.15, 0.42, ero) * smoothstep(0.3, 0.68, ridge);

    return (
      SEA_LEVEL -
      14 +
      land * 17 +
      land * inlandness(cont) * RIVER_CLIMB +
      land * hilly * (6 + detail * 6) +
      land * mountain * (26 + ridge * 30) +
      detail * 2
    );
  }

  /** Continentalness decides land from sea, and how the coastline winds. */
  private continentalness(x: number, z: number): number {
    return this.continent.fbm2(x * 0.0011, z * 0.0011, 4);
  }

  /** River channel at a column, or a dry sample outside one. */
  riverAt(x: number, z: number): RiverSample {
    return this.rivers.sample(x, z);
  }

  /** Terrain height including the flat plateau a village sits on. The channel is cut
   *  back in afterwards, so a village standing beside a river levels its own ground
   *  without damming the water running past it. */
  height(x: number, z: number): number {
    let h = this.naturalHeight(x, z);
    for (const info of this.villagesNear(x, z)) {
      const w = plateauWeight(info.site, x, z);
      if (w <= 0) continue;
      h = lerp(h, info.baseY, w);
    }
    return clamp(Math.round(this.rivers.carve(h, x, z)), MIN_HEIGHT, MAX_HEIGHT);
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
    const out: VillageInfo[] = [];
    for (const [cellX, cellZ] of nearbyVillageCells(x, z)) {
      const info = this.villageForCell(cellX, cellZ);
      if (info) out.push(info);
    }
    return out;
  }

  /** The village a grid cell ends up with: the first of its candidate spots that turns
   *  out to be buildable, or none at all. */
  private villageForCell(cellX: number, cellZ: number): VillageInfo | null {
    const key = `${cellX},${cellZ}`;
    const cached = this.villageCellCache.get(key);
    if (cached !== undefined) return cached;
    // Placed before the search, so a candidate that reads the terrain back does not
    // start the same search over again.
    this.villageCellCache.set(key, null);
    let chosen: VillageInfo | null = null;
    for (const site of villageCandidates(this.seed, cellX, cellZ)) {
      // A village off the edge of the island is not somewhere the player can go.
      if (!isInsideWorld(toChunkCoord(site.x), toChunkCoord(site.z))) continue;
      const info = this.villageInfo(site);
      if (info.valid) {
        chosen = info;
        break;
      }
    }
    this.villageCellCache.set(key, chosen);
    return chosen;
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
    // Never flatten a village over a river: the plateau would dam it, and on a finite
    // island a dammed river is a river gone. Only the flat middle of the plateau has to
    // be clear, though — further out it is a gentle slope the water can still cross.
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

  /** True when any part of a village plateau would sit on a river channel. The network
   *  already knows how far every column is from the nearest channel, so this is one
   *  lookup rather than a ring of samples, and exact rather than a guess. */
  private riverNearVillage(x: number, z: number): boolean {
    return !this.rivers.clearOfChannel(x, z, VILLAGE_KEEP_CLEAR);
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
        const info = this.villageForCell(cellX + dx, cellZ + dz);
        if (!info) continue;
        const dist = Math.hypot(info.site.x - x, info.site.z - z);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: info.site.x, z: info.site.z };
        }
      }
    }
    return best;
  }

  generateChunk(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const water = new Uint8Array(CHUNK_VOLUME);
    const seaColumn = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
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
        if (h < SEA_LEVEL) seaColumn[lz * CHUNK_SIZE + lx] = 1;
        if (h < SEA_LEVEL && isSnowy(biome)) setLocal(lx, SEA_LEVEL, lz, Block.ICE);

        // Rivers run above sea level, so they are filled from their own surface.
        const river = this.rivers.sample(x, z);
        // Only the channel itself holds water; its banks are carved to stay above the
        // water line, so the two thresholds have to be the same one.
        // The river is laid down once, as the level water would have found after a
        // thousand years of running. From then on the simulation owns it.
        if (riverCovers(river, h)) {
          fillRiverColumn(river.surface, h, (y, level) => setLocal(lx, y, lz, Block.WATER, level));
        }
        // A spring is placed for the channel itself, not for whatever the weather is
        // doing today, so a drought never moves one.
        if (riverCovers(river, h) && this.rivers.isSpringSite(x, z)) {
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

    return { blocks, water, seaColumn, springs, villagers, chests };
  }

  /** Villages whose block list can reach into this chunk (plateau radius plus slack). */
  private villagesForChunk(cx: number, cz: number): VillageInfo[] {
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    return this.villagesNear(centerX, centerZ);
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
