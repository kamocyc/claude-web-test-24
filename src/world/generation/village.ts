import { hashFloat, mulberry32, hashInts, randInt, type Rng } from '../../core/rng';
import { clamp, smoothstep } from '../../core/noise';
import { Block, type BlockId } from '../blocks';
import { CHUNK_SIZE, chunkKey, toChunkCoord } from '../chunk';

/** Villages sit on a coarse grid so their existence can be decided from the seed alone,
 *  without generating any surrounding terrain first. */
export const VILLAGE_CELL_CHUNKS = 20;
export const VILLAGE_CELL = VILLAGE_CELL_CHUNKS * CHUNK_SIZE;
/** Radius of the flattened plateau a village sits on. */
export const VILLAGE_RADIUS = 38;
const VILLAGE_CHANCE = 0.62;

export type VillageVariant = 'plains' | 'desert' | 'snowy';

export interface VillageSite {
  cellX: number;
  cellZ: number;
  /** Block coordinates of the village centre. */
  x: number;
  z: number;
}

export type Profession = 'farmer' | 'blacksmith' | 'librarian' | 'butcher';

export interface Placement {
  x: number;
  y: number;
  z: number;
  b: BlockId;
}

export interface VillagerMarker {
  x: number;
  y: number;
  z: number;
  profession: Profession;
}

export interface ChestMarker {
  x: number;
  y: number;
  z: number;
  loot: Profession;
}

export interface VillagePlan {
  site: VillageSite;
  baseY: number;
  variant: VillageVariant;
  byChunk: Map<string, Placement[]>;
  villagers: VillagerMarker[];
  chests: ChestMarker[];
}

/** Returns the village centre inside a grid cell, or null when the cell has none. */
export function villageInCell(seed: number, cellX: number, cellZ: number): VillageSite | null {
  if (hashFloat(seed ^ 0x5eed1, cellX, cellZ, 17) > VILLAGE_CHANCE) return null;
  const jitter = mulberry32(hashInts(seed ^ 0x5eed2, cellX, cellZ));
  const margin = VILLAGE_RADIUS + 16;
  const span = VILLAGE_CELL - margin * 2;
  return {
    cellX,
    cellZ,
    x: cellX * VILLAGE_CELL + margin + Math.floor(jitter() * span),
    z: cellZ * VILLAGE_CELL + margin + Math.floor(jitter() * span),
  };
}

/** Every candidate village whose plateau could reach the given block column. */
export function nearbyVillageSites(seed: number, blockX: number, blockZ: number): VillageSite[] {
  const cellX = Math.floor(blockX / VILLAGE_CELL);
  const cellZ = Math.floor(blockZ / VILLAGE_CELL);
  const sites: VillageSite[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const site = villageInCell(seed, cellX + dx, cellZ + dz);
      if (site) sites.push(site);
    }
  }
  return sites;
}

/** 1 inside the flat core, falling to 0 at the plateau edge. */
export function plateauWeight(site: VillageSite, x: number, z: number): number {
  const dist = Math.hypot(x - site.x, z - site.z);
  return 1 - smoothstep(VILLAGE_RADIUS - 14, VILLAGE_RADIUS, dist);
}

interface Building {
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** Side the door faces. */
  facing: 0 | 1 | 2 | 3;
  profession: Profession;
  hasChest: boolean;
}

const PROFESSIONS: readonly Profession[] = ['farmer', 'blacksmith', 'librarian', 'butcher'];

/** Builds the complete block list for a village, grouped by chunk so terrain generation
 *  can splice in only the parts that fall inside the chunk it is working on. */
export function planVillage(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
): VillagePlan {
  const rng = mulberry32(hashInts(seed ^ 0x1111a9e, site.x, site.z));
  const plan: VillagePlan = {
    site,
    baseY,
    variant,
    byChunk: new Map(),
    villagers: [],
    chests: [],
  };

  const palette = paletteFor(variant);
  const put = (x: number, y: number, z: number, b: BlockId): void => {
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let list = plan.byChunk.get(key);
    if (!list) {
      list = [];
      plan.byChunk.set(key, list);
    }
    list.push({ x, y, z, b });
  };

  // --- roads: two crossing streets, cleared of anything above them -----------
  const roadHalf = 1;
  const roadLen = VILLAGE_RADIUS - 8;
  for (let t = -roadLen; t <= roadLen; t++) {
    for (let o = -roadHalf; o <= roadHalf; o++) {
      putRoad(put, site.x + t, baseY, site.z + o, palette.path);
      putRoad(put, site.x + o, baseY, site.z + t, palette.path);
    }
  }

  // --- well at the crossing -------------------------------------------------
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      put(site.x + dx, baseY, site.z + dz, Block.MOSSY_COBBLESTONE);
      put(site.x + dx, baseY - 1, site.z + dz, Block.MOSSY_COBBLESTONE);
    }
  }
  put(site.x, baseY, site.z, Block.WATER);
  put(site.x, baseY - 1, site.z, Block.WATER);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    for (let h = 1; h <= 3; h++) put(site.x + dx, baseY + h, site.z + dz, Block.COBBLESTONE);
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) put(site.x + dx, baseY + 4, site.z + dz, palette.roof);
  }

  // --- buildings along the streets ------------------------------------------
  const buildings = layoutBuildings(rng, site);
  for (const b of buildings) buildHouse(put, plan, b, baseY, palette);

  // --- farm plots -----------------------------------------------------------
  const farmCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < farmCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 16 + rng() * 12;
    const fx = site.x + Math.round(Math.cos(angle) * dist);
    const fz = site.z + Math.round(Math.sin(angle) * dist);
    buildFarm(put, rng, fx, fz, baseY);
  }

  // two villagers wander around the well
  for (let i = 0; i < 2; i++) {
    plan.villagers.push({
      x: site.x + (i === 0 ? 3 : -3),
      y: baseY + 1,
      z: site.z + (i === 0 ? -2 : 2),
      profession: PROFESSIONS[randInt(rng, 0, PROFESSIONS.length - 1)],
    });
  }

  return plan;
}

interface Palette {
  wall: BlockId;
  corner: BlockId;
  roof: BlockId;
  floor: BlockId;
  path: BlockId;
}

function paletteFor(variant: VillageVariant): Palette {
  if (variant === 'desert') {
    // Different roof and path blocks, otherwise a sandstone village reads as one lump.
    return {
      wall: Block.SANDSTONE,
      corner: Block.OAK_LOG,
      roof: Block.STONE_BRICKS,
      floor: Block.OAK_PLANKS,
      path: Block.GRAVEL,
    };
  }
  if (variant === 'snowy') {
    return {
      wall: Block.SPRUCE_LOG,
      corner: Block.SPRUCE_LOG,
      roof: Block.STONE_BRICKS,
      floor: Block.OAK_PLANKS,
      path: Block.COBBLESTONE,
    };
  }
  return {
    wall: Block.OAK_PLANKS,
    corner: Block.OAK_LOG,
    roof: Block.STONE_BRICKS,
    floor: Block.OAK_PLANKS,
    path: Block.DIRT_PATH,
  };
}

type PutFn = (x: number, y: number, z: number, b: BlockId) => void;

function putRoad(put: PutFn, x: number, baseY: number, z: number, path: BlockId): void {
  put(x, baseY, z, path);
  for (let h = 1; h <= 5; h++) put(x, baseY + h, z, Block.AIR);
}

function layoutBuildings(rng: Rng, site: VillageSite): Building[] {
  const buildings: Building[] = [];
  const slots: { x: number; z: number; facing: 0 | 1 | 2 | 3 }[] = [];
  // Slots sit on both sides of each street, spaced so houses never overlap.
  for (let t = 10; t <= VILLAGE_RADIUS - 14; t += 11) {
    slots.push({ x: site.x + t, z: site.z - 4, facing: 3 });
    slots.push({ x: site.x + t, z: site.z + 4, facing: 1 });
    slots.push({ x: site.x - t, z: site.z - 4, facing: 3 });
    slots.push({ x: site.x - t, z: site.z + 4, facing: 1 });
    slots.push({ x: site.x - 4, z: site.z + t, facing: 0 });
    slots.push({ x: site.x + 4, z: site.z + t, facing: 2 });
    slots.push({ x: site.x - 4, z: site.z - t, facing: 0 });
    slots.push({ x: site.x + 4, z: site.z - t, facing: 2 });
  }
  // Shuffle then take a handful, so villages differ from each other.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i];
    slots[i] = slots[j];
    slots[j] = tmp;
  }
  const count = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < count && i < slots.length; i++) {
    const slot = slots[i];
    const w = 5 + Math.floor(rng() * 3);
    const d = 5 + Math.floor(rng() * 3);
    const profession = PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)];
    // Grow the footprint away from the street the slot belongs to.
    let x0 = slot.x - (w >> 1);
    let z0 = slot.z - (d >> 1);
    if (slot.facing === 1) z0 = slot.z;
    if (slot.facing === 3) z0 = slot.z - d + 1;
    if (slot.facing === 2) x0 = slot.x;
    if (slot.facing === 0) x0 = slot.x - w + 1;
    const overlaps = buildings.some(
      (b) => x0 < b.x0 + b.w + 1 && x0 + w + 1 > b.x0 && z0 < b.z0 + b.d + 1 && z0 + d + 1 > b.z0,
    );
    if (overlaps) continue;
    buildings.push({
      x0,
      z0,
      w,
      d,
      facing: slot.facing,
      profession,
      hasChest: profession !== 'farmer' || rng() < 0.5,
    });
  }
  return buildings;
}

function buildHouse(put: PutFn, plan: VillagePlan, b: Building, baseY: number, palette: Palette): void {
  const { x0, z0, w, d } = b;
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  const wallTop = baseY + 3;

  // Foundation + floor, and clear everything that used to stand here.
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      put(x, baseY - 1, z, palette.floor);
      for (let y = baseY; y <= wallTop + 2; y++) put(x, y, z, Block.AIR);
    }
  }

  const isCorner = (x: number, z: number): boolean =>
    (x === x0 || x === x1) && (z === z0 || z === z1);

  for (let y = baseY; y <= wallTop; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const onEdge = x === x0 || x === x1 || z === z0 || z === z1;
        if (!onEdge) continue;
        put(x, y, z, isCorner(x, z) ? palette.corner : palette.wall);
      }
    }
  }

  // Windows on the second row of every wall.
  for (let x = x0 + 1; x <= x1 - 1; x += 2) {
    put(x, baseY + 2, z0, Block.GLASS);
    put(x, baseY + 2, z1, Block.GLASS);
  }
  for (let z = z0 + 1; z <= z1 - 1; z += 2) {
    put(x0, baseY + 2, z, Block.GLASS);
    put(x1, baseY + 2, z, Block.GLASS);
  }

  // Doorway on the street-facing wall.
  const doorX = b.facing === 1 || b.facing === 3 ? x0 + (w >> 1) : b.facing === 2 ? x0 : x1;
  const doorZ = b.facing === 0 || b.facing === 2 ? z0 + (d >> 1) : b.facing === 1 ? z0 : z1;
  put(doorX, baseY, doorZ, Block.AIR);
  put(doorX, baseY + 1, doorZ, Block.AIR);

  // Roof with a one block overhang.
  for (let z = z0 - 1; z <= z1 + 1; z++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) put(x, wallTop + 1, z, palette.roof);
  }

  // Interior fittings.
  const insideX = x0 + 1;
  const insideZ = z0 + 1;
  put(insideX, baseY, insideZ, Block.TORCH);
  const jobX = x1 - 1;
  const jobZ = z1 - 1;
  switch (b.profession) {
    case 'blacksmith':
      put(jobX, baseY, jobZ, Block.FURNACE);
      put(jobX - 1, baseY, jobZ, Block.FURNACE);
      break;
    case 'librarian':
      put(jobX, baseY, jobZ, Block.BOOKSHELF);
      put(jobX, baseY + 1, jobZ, Block.BOOKSHELF);
      break;
    case 'butcher':
      put(jobX, baseY, jobZ, Block.FURNACE);
      break;
    default:
      put(jobX, baseY, jobZ, Block.CRAFTING_TABLE);
      break;
  }
  if (b.hasChest) {
    const chestX = x0 + 1;
    const chestZ = z1 - 1;
    put(chestX, baseY, chestZ, Block.CHEST);
    plan.chests.push({ x: chestX, y: baseY, z: chestZ, loot: b.profession });
  }
  plan.villagers.push({
    x: x0 + (w >> 1),
    y: baseY + 1,
    z: z0 + (d >> 1),
    profession: b.profession,
  });
}

function buildFarm(put: PutFn, rng: Rng, cx: number, cz: number, baseY: number): void {
  const w = 5;
  const d = 7;
  for (let dz = 0; dz < d; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const x = cx + dx - (w >> 1);
      const z = cz + dz - (d >> 1);
      const isChannel = dx === w >> 1;
      for (let y = baseY; y <= baseY + 4; y++) put(x, y, z, Block.AIR);
      if (isChannel) {
        put(x, baseY - 1, z, Block.WATER);
        continue;
      }
      put(x, baseY - 1, z, Block.FARMLAND_WET);
      if (rng() < 0.85) {
        const crop = [Block.WHEAT_0, Block.CARROTS_0, Block.POTATOES_0][Math.floor(rng() * 3)];
        put(x, baseY, z, crop + clamp(Math.floor(rng() * 4), 0, 3));
      }
    }
  }
}
