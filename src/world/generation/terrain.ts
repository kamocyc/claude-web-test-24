import { Noise, clamp, lerp, smoothstep, spline } from '../../core/noise';
import { hashFloat, mulberry32, hashInts } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, blockIndex, chunkKey } from '../chunk';
import { WATER_FULL } from '../water';
import { Biome, type BiomeId, biomeDef, classifyBiome, isSnowy } from './biome';
import { ORES, outcropDepth, outcropIn, placeCactus, placeSugarCane } from './features';
import {
  type ChestMarker,
  type HouseRecord,
  type VillagePlan,
  type VillageSite,
  type VillageVariant,
  type VillagerMarker,
  VILLAGE_CELL,
  planVillage,
  plateauWeight,
  villageCandidates,
} from './village';

export interface ChunkGenResult {
  blocks: Uint16Array;
  /** Fill level per voxel, matching the WATER blocks in `blocks`. */
  water: Uint8Array;
  /** Positions of generated spring blocks. */
  springs: { x: number; y: number; z: number }[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

/** What the village registry needs to know about a village, before anything has happened
 *  to it. Matches `VillageSeed` in `src/game/villages.ts`. */
export interface VillageSeed {
  x: number;
  z: number;
  baseY: number;
  variant: VillageVariant;
}

interface VillageInfo {
  site: VillageSite;
  valid: boolean;
  /** How far the ground rises and falls around the centre, from the same six probes that
   *  decide whether the site is usable at all. The score a cell picks its centre by:
   *  a lower one is a town that sits on its plateau instead of being cut into a slope. */
  spread: number;
  baseY: number;
  variant: VillageVariant;
}

const MIN_HEIGHT = 4;
const MAX_HEIGHT = CHUNK_HEIGHT - 12;

/** How wide the world's features are, as a multiple of what they used to be.
 *
 *  Only the fields that decide *where* things are get divided by this — continentalness,
 *  erosion and climate. The fields that decide how *steep* the ground is keep something
 *  close to their old frequency, because a mountain stretched to three times its width at
 *  the same height is a hill. Separating the two is the whole trick: ranges and biomes are
 *  three times the walk across, and the slopes inside them are as sharp as they ever were. */
const FEATURE_SCALE = 3;

/** Where the land sits relative to the sea, read off continentalness alone.
 *
 *  A sum of noise gives every part of the range the same gradient, which is why the old
 *  terrain was one long ramp from the beach to the peaks with nothing that read as a
 *  *place*. These knots give each band its own: a short, steep run across the shoreline so
 *  a coast is a coast, then a very long, nearly level run from +6 to +14 over the whole
 *  interior — which is what makes a plain flat enough to put a town on.
 *
 *  The crossing at -0.206 is not chosen, it is measured: it is where this noise field puts
 *  23.8% of the world under water, which is the share the old generator put there.
 *  Lowering the sea was supposed to buy height, not drain the oceans. */
const CONTINENT_SPLINE: readonly (readonly [number, number])[] = [
  [-1.00, -16],
  [-0.45, -12],
  [-0.30, -7],
  [-0.206, 0],
  [-0.16, 4],
  [-0.05, 7],
  [0.15, 9],
  [0.45, 12],
  [1.00, 16],
];

/** Tallest a crest may stand above the plain it rises from. Sized to the budget: the
 *  interior sits at about +12, so this plus the hill and roughness terms lands a peak just
 *  under `MAX_HEIGHT` instead of shearing off against it. */
const RIDGE_AMP = 54;

/** What the ground is doing at a column, before any village flattens it. */
interface Shape {
  height: number;
  /** 0 at sea, 1 well inland. Relief is masked by this so mountains stay off the beach. */
  land: number;
  /** 0 where the ground is flat enough to build on, 1 where it is mountain. Every relief
   *  term is multiplied by it, so a lowland column gets no relief at all rather than a
   *  scaled-down share of it — which is what puts a hard edge between plain and range. */
  rugged: number;
}

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

  private readonly villageInfoCache = new Map<string, VillageInfo>();
  private readonly villagePlanCache = new Map<string, VillagePlan>();
  private readonly cellSiteCache = new Map<string, VillageSite | null>();
  /** The last column `shape` was asked about.
   *
   *  Every caller wants two things out of the same column and asks for them separately:
   *  `generateChunk` takes the height and then the biome, and `height()` itself is called
   *  again a moment later by whatever wanted the ground under a road. One slot is all that
   *  needs, and it halves the noise sampling of the column loop. */
  private lastShape: (Shape & { x: number; z: number }) | null = null;

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

  /** The ground at a column: how high it is, and what kind of ground it is.
   *
   *  Height is not a sum of noise terms. Continentalness alone decides the base level
   *  through `CONTINENT_SPLINE`, and erosion decides — separately, and before any relief
   *  is computed — how much relief this part of the world is allowed to have at all.
   *  Below the `rugged` threshold every relief term is multiplied by zero, so the ground
   *  is exactly the spline: flat, buildable, and the same for hundreds of blocks. Above
   *  it the ridge term gets the whole height budget. There is deliberately very little in
   *  between, because the ground that is neither is the rolling-hills mush that made the
   *  old terrain read the same everywhere.
   *
   *  Both the height and the `rugged` reading come out of here together, so classifying a
   *  biome costs no extra noise: `MOUNTAINS` can mean "steep" rather than merely "high"
   *  without sampling the neighbours of every column. */
  private shape(x: number, z: number): Shape {
    const cached = this.lastShape;
    if (cached && cached.x === x && cached.z === z) return cached;

    // Where things are. Three times the old wavelength, so a continent, a mountain belt
    // and a climate band are all three times the walk across.
    const cont = this.continent.fbm2(
      (x * 0.0011) / FEATURE_SCALE,
      (z * 0.0011) / FEATURE_SCALE,
      4,
    );
    const ero = this.erosion.fbm2((x * 0.0027) / FEATURE_SCALE, (z * 0.0027) / FEATURE_SCALE, 3);

    // How steep things are. The ridge frequency is unchanged from the old generator, and
    // deliberately so: what got three times wider is the *belt* the ranges sit in, which
    // `ero` decides, and widening the crests inside it as well would have traded every
    // mountain for a long shallow ramp. The domain warp bends a range instead of letting
    // it run in a straight line, and is free — both fields have been sampled anyway.
    const ridge = this.ridge.ridged2((x + cont * 90) * 0.0042, (z + ero * 90) * 0.0042, 4);
    const hill = this.detail.fbm2(x * 0.006, z * 0.006, 2);
    const detail = this.detail.fbm2(x * 0.02, z * 0.02, 3);

    const land = smoothstep(-0.19, 0.05, cont);
    // The band is narrow on purpose: below it the world is dead flat, above it the world
    // is mountain, and only about a fifth of the map is in transit between the two.
    const rugged = smoothstep(0.05, 0.26, ero);
    // Squared, so even the transition band leans towards the flat end. A half-rugged
    // column gets a quarter of the range, not half of one.
    const upland = rugged * rugged;
    // The raw ridged field clusters around 0.42, which would spend the whole budget on
    // making every mountain the same middling height. Stretching it puts the valleys on
    // the floor and lets the crests actually reach the top of the world.
    const crest = smoothstep(0.2, 0.8, ridge);

    // The roughness rides on `upland` rather than `rugged`, so it is a property of rock
    // faces and not of the ground in general — a plain has none of it at all.
    const relief = upland * RIDGE_AMP * crest + rugged * hill * 7 + upland * detail * 5;

    // The last term is the only relief a plain gets, and it is deliberately under one
    // block of swing: enough that a field is not a single stamped-out terrace, small
    // enough that every step on it is inside a walker's stride (`MAX_STEP`).
    const height =
      SEA_LEVEL + spline(CONTINENT_SPLINE, cont) + land * relief + detail * 0.8;

    const shaped = { x, z, height: clamp(Math.round(height), MIN_HEIGHT, MAX_HEIGHT), land, rugged };
    this.lastShape = shaped;
    return shaped;
  }

  /** Terrain height before villages flatten anything. */
  rawHeight(x: number, z: number): number {
    return this.shape(x, z).height;
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
      temperature: clamp(
        this.temperature.fbm2((x * 0.0009) / FEATURE_SCALE, (z * 0.0009) / FEATURE_SCALE, 3) * 2.2,
        -1,
        1,
      ),
      humidity: clamp(
        this.humidity.fbm2((x * 0.0013) / FEATURE_SCALE, (z * 0.0013) / FEATURE_SCALE, 3) * 2.2,
        -1,
        1,
      ),
    };
  }

  biomeAt(x: number, z: number): BiomeId {
    const height = this.height(x, z);
    const { temperature, humidity } = this.climate(x, z);
    return classifyBiome({
      height,
      temperature,
      humidity,
      seaLevel: SEA_LEVEL,
      rugged: this.shape(x, z).rugged,
    });
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

  /** Villages whose plateau may influence this column. */
  private villagesNear(x: number, z: number): VillageInfo[] {
    const cellX = Math.floor(x / VILLAGE_CELL);
    const cellZ = Math.floor(z / VILLAGE_CELL);
    const out: VillageInfo[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const info = this.siteInCell(cellX + dx, cellZ + dz);
        if (info) out.push(info);
      }
    }
    return out;
  }

  /** Where the town in a grid cell stands, or null when that cell has none.
   *
   *  The cell offers a handful of candidate centres and this picks the one on the best
   *  ground: valid first, then flattest. That matters far more now than it used to. With
   *  features three times as wide, a cell can fall entirely inside a mountain belt, and
   *  the old one-hashed-point rule would answer by leaving a quarter of the world without
   *  towns while the plains next door had one in every cell. Searching keeps towns where
   *  the flat ground is, which is where somebody would have built one.
   *
   *  Cached per cell, and every candidate's own survey is cached too, because this sits
   *  under `height()` — the hottest call in the generator. */
  private siteInCell(cellX: number, cellZ: number): VillageInfo | null {
    const key = `${cellX},${cellZ}`;
    const cached = this.cellSiteCache.get(key);
    if (cached !== undefined) return cached ? this.villageInfo(cached) : null;

    let best: VillageInfo | null = null;
    for (const candidate of villageCandidates(this.seed, cellX, cellZ)) {
      const info = this.villageInfo(candidate);
      if (!info.valid) continue;
      if (!best || info.spread < best.spread) best = info;
      // Nothing beats ground that is already level, so stop rather than survey the rest.
      if (best.spread === 0) break;
    }
    this.cellSiteCache.set(key, best ? best.site : null);
    return best;
  }

  private villageInfo(site: VillageSite): VillageInfo {
    const key = `${site.x},${site.z}`;
    const cached = this.villageInfoCache.get(key);
    if (cached) return cached;

    const { height: baseY, rugged } = this.shape(site.x, site.z);
    const { temperature, humidity } = this.climate(site.x, site.z);
    const biome = classifyBiome({
      height: baseY,
      temperature,
      humidity,
      seaLevel: SEA_LEVEL,
      rugged,
    });
    const def = biomeDef(biome);
    // Villages need reasonably flat, dry, buildable ground.
    let valid = def.allowsVillage && baseY > SEA_LEVEL + 2 && baseY < SEA_LEVEL + 24;
    let spread = Infinity;
    if (valid) {
      // Reject sites where the surrounding land is too steep to plausibly flatten.
      let min = baseY;
      let max = baseY;
      for (const [dx, dz] of [[-20, 0], [20, 0], [0, -20], [0, 20], [14, 14], [-14, -14]] as const) {
        const h = this.rawHeight(site.x + dx, site.z + dz);
        if (h < min) min = h;
        if (h > max) max = h;
      }
      spread = max - min;
      if (spread > 16) valid = false;
    }
    const variant: VillageVariant =
      biome === Biome.DESERT ? 'desert' : isSnowy(biome) ? 'snowy' : 'plains';
    const info: VillageInfo = { site, valid, spread, baseY: baseY + 1, variant };
    this.villageInfoCache.set(key, info);
    return info;
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

  /** Every valid village within `cellRadius` cells. Cheap: which cells have a town is a
   *  hash, and siting one is cached per cell, so this is a grid walk. */
  villagesAround(x: number, z: number, cellRadius = 2): VillageSeed[] {
    const cellX = Math.floor(x / VILLAGE_CELL);
    const cellZ = Math.floor(z / VILLAGE_CELL);
    const out: VillageSeed[] = [];
    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const info = this.siteInCell(cellX + dx, cellZ + dz);
        if (!info) continue;
        out.push({ x: info.site.x, z: info.site.z, baseY: info.baseY, variant: info.variant });
      }
    }
    return out;
  }

  /** A village's original houses — where they stand, which way they face and where their
   *  doors are. Cheap and independent of what is loaded: a village plan is a pure function
   *  of the seed and is cached, so this can be asked about a village nobody has visited. */
  villageBuildings(x: number, z: number): HouseRecord[] {
    const site = { cellX: Math.floor(x / VILLAGE_CELL), cellZ: Math.floor(z / VILLAGE_CELL), x, z };
    const info = this.villageInfo(site);
    if (!info.valid) return [];
    return this.villagePlan(info).buildings;
  }

  /** Nearest valid village centre, searched over the village grid around a position. */
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
        const biome = classifyBiome({
          height: h,
          temperature,
          humidity,
          seaLevel: SEA_LEVEL,
          rugged: this.shape(x, z).rugged,
        });
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
    this.expose(cx, cz, blocks, heights, water);

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

    return { blocks, water, springs, villagers, chests };
  }

  /** Villages whose block list can reach into this chunk (plateau radius plus slack). */
  private villagesForChunk(cx: number, cz: number): VillageInfo[] {
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    return this.villagesNear(centerX, centerZ);
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
            // Nothing under water: a seam on a lake bed is invisible, which defeats the
            // whole purpose of putting one at the surface.
            if (h <= SEA_LEVEL) continue;
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
        if (this.insideVillage(x, z)) continue;
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

  /** Public vegetation exclusion used by deterministic object-tree generation. */
  isInsideVillage(x: number, z: number): boolean {
    return this.insideVillage(x, z);
  }
}

function containsColumn(cx: number, cz: number, x: number, z: number): boolean {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  return x >= originX && x < originX + CHUNK_SIZE && z >= originZ && z < originZ + CHUNK_SIZE;
}
