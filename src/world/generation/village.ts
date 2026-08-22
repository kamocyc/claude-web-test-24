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

/** Footprint of one house, so village growth can tell which street slots are taken. */
export interface Footprint {
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** A plot and the level its ground has to be at, so whoever writes the plan into a world
 *  can put ground under it and take the hillside off the top of it.
 *
 *  A village stands on a plateau the terrain generator flattened for it, but the
 *  flattening fades out over the outermost fourteen blocks — and the back row of plots a
 *  growing village fills reaches into exactly that band. Planning is world-blind, so it
 *  cannot know how far out of true a plot is; it can only say which ground it is counting
 *  on being flat. `y` is the level of the top solid block, one below the floor. */
export interface Pad extends Footprint {
  y: number;
}

/** A step outwards from a door, indexed by the side it faces. Matches `footprintFor`,
 *  which grows a house away from the street its slot belongs to — so the door always ends
 *  up on the wall nearest that street. */
export const FACING_STEP: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

export type BuildingRole = 'house' | 'market';

/** A building as something the rest of the game can address rather than merely avoid.
 *
 *  `Footprint` was only ever "ground that is taken"; a transport network needs to name a
 *  building, stand somebody outside it, and walk them in. The doorway was computed inside
 *  `buildHouse` and thrown away, so it is recorded here instead — by the builder that
 *  knocks it out of the wall, which is the only thing that can be wrong about it. */
export interface HouseRecord extends Footprint {
  facing: 0 | 1 | 2 | 3;
  role: BuildingRole;
  profession: Profession;
  /** The doorway cell itself, at floor level. */
  door: { x: number; y: number; z: number };
  /** The cell immediately outside the doorway: where a porter waits, and where a path to
   *  this building has to reach. */
  outside: { x: number; y: number; z: number };
}

export interface VillagePlan {
  site: VillageSite;
  baseY: number;
  variant: VillageVariant;
  byChunk: Map<string, Placement[]>;
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /** The houses themselves. Growth adds to a village without landing on them, and
   *  transport addresses them by name. */
  buildings: HouseRecord[];
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
  /** Plots already spoken for, so the path out of this door stops rather than running
   *  through the neighbour's wall. */
  taken?: readonly Footprint[];
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
    buildings: [],
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
  for (const b of buildings) {
    // `baseY` is the plateau's top solid block, and `buildHouse` wants the floor level:
    // the first clear cell above it. Handing it the plateau instead sinks the house one
    // block into the ground, which leaves the doorway a single block clear of the street
    // — too low to walk through.
    buildHouse(put, plan, { ...b, taken: buildings }, baseY + 1, palette);
  }

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

export interface Slot {
  x: number;
  z: number;
  facing: 0 | 1 | 2 | 3;
}

/** Every place a house could stand, on both sides of each street, spaced so houses never
 *  overlap. Pure geometry and no randomness, so village growth can ask for the same slots
 *  later without borrowing the plan's random stream. */
export function streetSlots(site: VillageSite): Slot[] {
  const slots: Slot[] = [];
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
  return slots;
}

/** Where growth may build. The street frontage first — a village fills its main road
 *  before it spreads — and then a row set back behind it, which is the only way four
 *  stages of houses fit inside one plateau. Only growth uses this; `planVillage` keeps
 *  taking `streetSlots` alone, so stage 0 is untouched. */
export function growthSlots(site: VillageSite): Slot[] {
  const slots = streetSlots(site);
  const back = 13;
  for (let t = 10; t <= VILLAGE_RADIUS - 14; t += 11) {
    slots.push({ x: site.x + t, z: site.z - back, facing: 3 });
    slots.push({ x: site.x + t, z: site.z + back, facing: 1 });
    slots.push({ x: site.x - t, z: site.z - back, facing: 3 });
    slots.push({ x: site.x - t, z: site.z + back, facing: 1 });
    slots.push({ x: site.x - back, z: site.z + t, facing: 0 });
    slots.push({ x: site.x + back, z: site.z + t, facing: 2 });
    slots.push({ x: site.x - back, z: site.z - t, facing: 0 });
    slots.push({ x: site.x + back, z: site.z - t, facing: 2 });
  }
  return slots;
}

/** Grows a footprint away from the street its slot belongs to. */
export function footprintFor(slot: Slot, w: number, d: number): Footprint {
  let x0 = slot.x - (w >> 1);
  let z0 = slot.z - (d >> 1);
  if (slot.facing === 1) z0 = slot.z;
  if (slot.facing === 3) z0 = slot.z - d + 1;
  if (slot.facing === 2) x0 = slot.x;
  if (slot.facing === 0) x0 = slot.x - w + 1;
  return { x0, z0, w, d };
}

export function overlaps(a: Footprint, b: Footprint): boolean {
  return a.x0 < b.x0 + b.w + 1 && a.x0 + a.w + 1 > b.x0 && a.z0 < b.z0 + b.d + 1 && a.z0 + a.d + 1 > b.z0;
}

function layoutBuildings(rng: Rng, site: VillageSite): Building[] {
  const buildings: Building[] = [];
  const slots = streetSlots(site);
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
    const { x0, z0 } = footprintFor(slot, w, d);
    if (buildings.some((b) => overlaps({ x0, z0, w, d }, b))) continue;
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

/** What a building reports about itself, so village growth can hand in its own lists. */
type HouseSink = Pick<VillagePlan, 'villagers' | 'chests' | 'buildings'>;

/** One house. `baseY` is the *floor level*: the first cell somebody standing inside would
 *  occupy. The floor itself is laid one below that, so a house whose floor level matches
 *  the ground outside is one the player can walk straight into. */
function buildHouse(put: PutFn, plan: HouseSink, b: Building, baseY: number, palette: Palette): void {
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
  const [outX, outZ] = FACING_STEP[b.facing];
  const record: HouseRecord = {
    x0, z0, w, d,
    facing: b.facing,
    role: 'house',
    profession: b.profession,
    door: { x: doorX, y: baseY, z: doorZ },
    outside: { x: doorX + outX, y: baseY, z: doorZ + outZ },
  };
  plan.buildings.push(record);
  doorPath(put, record, palette, baseY, b.taken);

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

/** A few blocks of path from a door towards the street it faces.
 *
 *  Every building the game can send goods from has to be reachable on foot from the road,
 *  and "the door opens onto grass" is the commonest way that fails. Short on purpose: the
 *  village's own streets are three or four blocks away, and a longer spur would start
 *  laying road across somebody else's plot. */
const DOOR_PATH = 4;

function doorPath(
  put: PutFn,
  house: HouseRecord,
  palette: Palette,
  baseY: number,
  taken: readonly Footprint[] = [],
): void {
  const [stepX, stepZ] = FACING_STEP[house.facing];
  const inside = (f: Footprint, x: number, z: number): boolean =>
    x >= f.x0 && x < f.x0 + f.w && z >= f.z0 && z < f.z0 + f.d;
  for (let i = 0; i < DOOR_PATH; i++) {
    const x = house.outside.x + stepX * i;
    const z = house.outside.z + stepZ * i;
    // The house's own plot is in `taken` — it is the list of every plot on the street —
    // so it has to be skipped, or the path would stop before it started.
    if (taken.some((f) => !inside(f, house.door.x, house.door.z) && inside(f, x, z))) break;
    putRoad(put, x, baseY - 1, z, palette.path);
  }
}

/** A field is always this size, so a plan can say which ground it needs before it lays
 *  a single block of it. */
export const FARM_WIDTH = 5;
export const FARM_DEPTH = 7;

function buildFarm(put: PutFn, rng: Rng, cx: number, cz: number, baseY: number): void {
  const w = FARM_WIDTH;
  const d = FARM_DEPTH;
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

/** Houses and farms a village gains at each development stage.
 *
 *  This deliberately uses its own random stream rather than `planVillage`'s. Drawing even
 *  one extra number from that one would shift everything after it — the professions of
 *  the villagers by the well, for a start — and the fixed verification seed pins the
 *  village layout exactly. Growth is therefore always a pure addition to stage 0, never a
 *  reshuffle of it. */
export const HOUSES_PER_STAGE = 2;
export const FARMS_PER_STAGE = 1;

export interface GrowthPlan {
  placements: Placement[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /** The buildings this plan raises, addressable the same way a village's own are. */
  buildings: HouseRecord[];
  /** What this stage built on. Stage n + 1 is handed these along with the original
   *  village's, or the two would try to stand in the same place. */
  footprints: Footprint[];
  /** The ground each of those plots needs, for a writer that can see the world. */
  pads: Pad[];
}

/** The landmark each stage adds on top of its houses. Houses alone make a village
 *  bigger; these are what make it read as a different kind of place. */
export const STAGE_LANDMARKS: readonly string[] = ['', '', 'market', 'lamps', 'gates'];

/** A hamlet: two small houses, a plot and a scrap of path, laid out inside sixteen blocks
 *  so it can stand fifty blocks from a village without reaching its plateau.
 *
 *  Its own layout rather than a growth stage, because a growth stage is arranged along
 *  streets a hamlet does not have — and because it must stay small: the whole point of it
 *  is to be somewhere the player can carry a crate to and lay a road to by hand. */
/** Radius of the ground a hamlet levels for itself, and how far it will fill downwards to
 *  reach it. Together they decide how uneven a spot can be and still be built on. */
export const OUTPOST_PAD = 12;
export const OUTPOST_FILL = 7;

export function planOutpost(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
): GrowthPlan {
  const plan: GrowthPlan = { placements: [], villagers: [], chests: [], buildings: [], footprints: [], pads: [] };
  const rng = mulberry32(hashInts(seed ^ 0x51d3, site.x, site.z));
  const palette = paletteFor(variant);
  const put = (x: number, y: number, z: number, b: BlockId): void => {
    plan.placements.push({ x, y, z, b });
  };
  const sink: HouseSink = { villagers: plan.villagers, chests: plan.chests, buildings: plan.buildings };

  // The pad. A village stands on a plateau the terrain generator flattened for it; a
  // hamlet is written into a world that has already been generated, so it levels its own
  // ground — filling up to `baseY` and clearing the air above. Filling rather than
  // cutting, because the writer only ever replaces soil, plants and air: it will build a
  // hillside up to meet a floor, and it will not carve into one.
  for (let dz = -OUTPOST_PAD; dz <= OUTPOST_PAD; dz++) {
    for (let dx = -OUTPOST_PAD; dx <= OUTPOST_PAD; dx++) {
      if (dx * dx + dz * dz > OUTPOST_PAD * OUTPOST_PAD) continue;
      const x = site.x + dx;
      const z = site.z + dz;
      put(x, baseY - 1, z, variant === 'desert' ? Block.SAND : Block.GRASS);
      for (let depth = 2; depth <= OUTPOST_FILL; depth++) put(x, baseY - depth, z, Block.DIRT);
      for (let y = baseY; y <= baseY + 5; y++) put(x, y, z, Block.AIR);
    }
  }

  // Two houses either side of a short path, doors facing each other across it.
  const houses: { slot: Slot; w: number; d: number }[] = [
    { slot: { x: site.x, z: site.z - 2, facing: 3 }, w: 6, d: 5 },
    { slot: { x: site.x + 2, z: site.z + 2, facing: 1 }, w: 5, d: 5 },
  ];
  const plots = houses.map((house) => footprintFor(house.slot, house.w, house.d));
  for (let i = 0; i < houses.length; i++) {
    plan.footprints.push(plots[i]);
    buildHouse(
      put,
      sink,
      {
        ...plots[i],
        facing: houses[i].slot.facing,
        profession: PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)],
        hasChest: true,
        taken: plots,
      },
      baseY,
      palette,
    );
  }

  // A scrap of street between the two doors, laid the way a village lays its own. The
  // player is about to be taught to join places up with road; the hamlet may as well
  // start with the little it has.
  // At `baseY - 1`, which is the pad's own surface: laying it at `baseY` would leave the
  // path standing a block proud of the ground it runs across, and the doors either side
  // of it a block below the thing they open onto.
  for (let x = site.x - 4; x <= site.x + 6; x++) putRoad(put, x, baseY - 1, site.z, palette.path);

  const fx = site.x - 8;
  const fz = site.z + 6;
  buildFarm(put, rng, fx, fz, baseY);
  plan.footprints.push({ x0: fx - 3, z0: fz - 4, w: 7, d: 9 });

  return plan;
}

export function planGrowth(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
  stage: number,
  occupied: readonly Footprint[],
): GrowthPlan {
  const plan: GrowthPlan = { placements: [], villagers: [], chests: [], buildings: [], footprints: [], pads: [] };
  if (stage <= 0) return plan;

  const rng = mulberry32(hashInts(seed ^ 0x9a0f, site.x, site.z, stage));
  const palette = paletteFor(variant);
  const put = (x: number, y: number, z: number, b: BlockId): void => {
    plan.placements.push({ x, y, z, b });
  };
  // `buildHouse` reports its villager and chest through the object it is handed; growth
  // collects them the same way a fresh village does.
  const sink: HouseSink = { villagers: plan.villagers, chests: plan.chests, buildings: plan.buildings };

  const slots = growthSlots(site);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i];
    slots[i] = slots[j];
    slots[j] = tmp;
  }

  const taken: Footprint[] = [...occupied];
  let built = 0;
  for (const slot of slots) {
    if (built >= HOUSES_PER_STAGE) break;
    const w = 5 + Math.floor(rng() * 3);
    const d = 5 + Math.floor(rng() * 3);
    const footprint = footprintFor(slot, w, d);
    if (taken.some((b) => overlaps(footprint, b))) continue;
    taken.push(footprint);
    plan.footprints.push(footprint);
    plan.pads.push({ ...footprint, y: baseY });
    built++;
    buildHouse(
      put,
      sink,
      {
        ...footprint,
        facing: slot.facing,
        profession: PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)],
        hasChest: true,
        taken,
      },
      // The floor level, not the plateau: see the same call in `planVillage`.
      baseY + 1,
      palette,
    );
  }

  const landmark = STAGE_LANDMARKS[Math.min(stage, STAGE_LANDMARKS.length - 1)];
  if (landmark === 'market') {
    const plot: Footprint = { x0: site.x + 5, z0: site.z + 5, w: 7, d: 7 };
    if (!taken.some((b) => overlaps(plot, b))) {
      taken.push(plot);
      plan.footprints.push(plot);
      plan.pads.push({ ...plot, y: baseY });
      buildMarket(put, sink, plot, baseY + 1, palette, PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)]);
    }
  } else if (landmark === 'lamps') {
    buildLamps(put, site, baseY);
  } else if (landmark === 'gates') {
    buildGates(put, site, baseY);
  }

  for (let i = 0; i < FARMS_PER_STAGE; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 20 + rng() * 10;
    const fx = site.x + Math.round(Math.cos(angle) * dist);
    const fz = site.z + Math.round(Math.sin(angle) * dist);
    if (taken.some((b) => overlaps({ x0: fx - 3, z0: fz - 4, w: 7, d: 9 }, b))) continue;
    // A field wants level ground as much as a house does: its channel is a block of
    // water, and water on a slope is a waterfall. `buildFarm` lays its soil one below the
    // level it is handed, so that is the level the pad has to reach.
    plan.pads.push({ x0: fx - 2, z0: fz - 3, w: FARM_WIDTH, d: FARM_DEPTH, y: baseY - 1 });
    buildFarm(put, rng, fx, fz, baseY);
  }

  return plan;
}

/** An open market hall: a floor, four posts, a roof and a trader under it. Villages get
 *  one when they outgrow being a village. */
function buildMarket(
  put: PutFn,
  sink: HouseSink,
  plot: Footprint,
  /** Floor level, as for `buildHouse`. */
  baseY: number,
  palette: Palette,
  profession: Profession,
): void {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  for (let z = plot.z0; z <= z1; z++) {
    for (let x = plot.x0; x <= x1; x++) {
      put(x, baseY - 1, z, palette.floor);
      for (let y = baseY; y <= baseY + 4; y++) put(x, y, z, Block.AIR);
    }
  }
  for (const [x, z] of [[plot.x0, plot.z0], [x1, plot.z0], [plot.x0, z1], [x1, z1]] as const) {
    for (let y = baseY; y <= baseY + 2; y++) put(x, y, z, palette.corner);
  }
  for (let z = plot.z0 - 1; z <= z1 + 1; z++) {
    for (let x = plot.x0 - 1; x <= x1 + 1; x++) put(x, baseY + 3, z, palette.roof);
  }
  // Stalls: a counter of crates along one side, and a torch so the hall is lit at night.
  const counterZ = z1 - 1;
  for (let x = plot.x0 + 1; x <= x1 - 1; x++) put(x, baseY, counterZ, Block.CRAFTING_TABLE);
  put(plot.x0 + 1, baseY, plot.z0 + 1, Block.TORCH);
  put(x1 - 1, baseY, plot.z0 + 1, Block.TORCH);
  const chestX = plot.x0 + 1;
  const chestZ = counterZ - 1;
  put(chestX, baseY, chestZ, Block.CHEST);
  sink.chests.push({ x: chestX, y: baseY, z: chestZ, loot: profession });
  sink.villagers.push({
    x: plot.x0 + (plot.w >> 1),
    y: baseY + 1,
    z: plot.z0 + (plot.d >> 1),
    profession,
  });
  // A market hall is open on all four sides, so its "door" is the middle of the side
  // facing the village centre — which is where a porter should be seen walking in.
  const door = { x: plot.x0 + (plot.w >> 1), y: baseY, z: plot.z0 };
  sink.buildings.push({
    x0: plot.x0, z0: plot.z0, w: plot.w, d: plot.d,
    facing: 1,
    role: 'market',
    profession,
    door,
    outside: { x: door.x, y: baseY, z: door.z - 1 },
  });
}

/** Street lamps down both roads. Cheap in blocks and the most visible thing a village
 *  ever gains: a supplied town is the one you can see from a hill at night. */
function buildLamps(put: PutFn, site: VillageSite, baseY: number): void {
  const off = 3;
  for (let t = 8; t <= VILLAGE_RADIUS - 14; t += 8) {
    for (const sign of [1, -1]) {
      for (const [x, z] of [
        [site.x + sign * t, site.z + off],
        [site.x + sign * t, site.z - off],
        [site.x + off, site.z + sign * t],
        [site.x - off, site.z + sign * t],
      ] as const) {
        for (let y = baseY; y <= baseY + 2; y++) put(x, y, z, Block.COBBLESTONE);
        put(x, baseY + 3, z, Block.TORCH);
      }
    }
  }
}

/** Gate towers where the streets leave town, with a lintel across the road. Only a place
 *  that has been supplied for a long time ever gets walls. */
function buildGates(put: PutFn, site: VillageSite, baseY: number): void {
  const reach = VILLAGE_RADIUS - 12;
  const off = 3;
  const height = 6;
  for (const sign of [1, -1]) {
    for (const axis of [0, 1]) {
      const along = sign * reach;
      for (const side of [off, -off]) {
        const x = axis === 0 ? site.x + along : site.x + side;
        const z = axis === 0 ? site.z + side : site.z + along;
        for (let y = baseY; y <= baseY + height; y++) put(x, y, z, Block.STONE_BRICKS);
        put(x, baseY + height + 1, z, Block.TORCH);
      }
      // The span over the road itself. Everything below it was cleared when the street
      // was laid, so this never buries anybody's path.
      for (let side = -off + 1; side <= off - 1; side++) {
        const x = axis === 0 ? site.x + along : site.x + side;
        const z = axis === 0 ? site.z + side : site.z + along;
        put(x, baseY + height, z, Block.STONE_BRICKS);
      }
    }
  }
}
