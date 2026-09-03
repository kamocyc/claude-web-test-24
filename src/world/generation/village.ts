import { mulberry32, hashInts, type Rng } from '../../core/rng';
import { Block, type BlockId } from '../blocks';
import { chunkKey, toChunkCoord } from '../chunk';
import {
  townBlocks,
  townGrowthBlocks,
  townStreets,
  type TownBlock,
  type TownPlotSurvey,
} from './districts';
import {
  architectureFor,
  buildHome,
  buildPlaza,
  buildShop,
  buildWorks,
  HOME_HEIGHT,
  paletteFor,
  type BuildSink,
  type Palette,
  type PutFn,
  type VillageArchitecture,
} from './townBuildings';

/** Radius of the flattened plateau a town sits on.
 *
 *  Set by the street grid rather than chosen: the corners of the outermost streets land 41
 *  blocks out (see `townExtent`), and the flattening only reaches full strength 14 blocks
 *  inside this radius. A town on a smaller plateau builds its outer blocks down the side
 *  of its own hill. */
export const VILLAGE_RADIUS = 56;

export type VillageVariant = 'plains' | 'desert' | 'snowy';

export interface VillageSite {
  /**
   * The settlement lattice's tile this site belongs to. Nothing in the town
   * fabric reads it; it is here because `VillageSite` is passed around by value
   * and a site without any provenance is hard to debug.
   */
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

/** What kind of building this is, which is also what it looks like. One of three
 *  silhouettes, plus the square, which has no building on it at all. */
export type BuildingRole = 'house' | 'shop' | 'works' | 'plaza';

/** What a building is *for*, which is what the town economy trades on.
 *
 *  A village used to be one producer with one stock, so a house was scenery with a door on
 *  it. A town is a handful of places that each want something: somebody lives in one, buys
 *  in another and works in the third, and the goods and the people moving between them are
 *  the game. So every building says which of those it is.
 *
 *  `civic` is the well and anything else that is neither home, shop nor works — it is here
 *  so the type is total, not because anything trades with one.
 *
 *  Deliberately *not* drawn from `planVillage`'s random stream. Stage 0's use follows from
 *  the profession the village already rolled, and a growth stage's follows from the stage
 *  and the order the houses went up (`GROWTH_USES`). Drawing even one extra number here
 *  would shift every profession after it, and the fixed verification seed pins those. */
export type BuildingUse = 'residential' | 'commercial' | 'industrial' | 'civic';

/** A building as something the rest of the game can address rather than merely avoid.
 *
 *  `Footprint` was only ever "ground that is taken"; a transport network needs to name a
 *  building, stand somebody outside it, and walk them in. The doorway was computed inside
 *  `buildHouse` and thrown away, so it is recorded here instead — by the builder that
 *  knocks it out of the wall, which is the only thing that can be wrong about it. */
export interface HouseRecord extends Footprint {
  facing: 0 | 1 | 2 | 3;
  role: BuildingRole;
  /** What the town economy does with this building. */
  use: BuildingUse;
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
  /** The village-wide building tradition, visible in every roof and facade. */
  architecture: VillageArchitecture;
  byChunk: Map<string, Placement[]>;
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /** The houses themselves. Growth adds to a village without landing on them, and
   *  transport addresses them by name. */
  buildings: HouseRecord[];
}

/** The professions a town's people have. Kept from the village that came before: what a
 *  villager trades is a separate system from what their building does, and a shopkeeper
 *  who is also a librarian is a person with a job and a house. */
const PROFESSIONS: readonly Profession[] = ['farmer', 'blacksmith', 'librarian', 'butcher'];

/** Which way the buildings on a block face: towards the middle of the town, because that
 *  is where its streets lead and where a doorway wants to open. */
function facingFor(block: { i: number; j: number }): 0 | 1 | 2 | 3 {
  const dx = block.i + 0.5;
  const dz = block.j + 0.5;
  // `FACING_STEP` is the way a door faces, so a block on the +x side of the middle wants
  // the facing that points at -x. Getting this backwards puts every door on the town's
  // outer wall, opening onto the field behind it.
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 2 : 0;
  return dz > 0 ? 1 : 3;
}

/** The two houses on a residential block, and the garden behind them.
 *
 *  Both stand along the street the block faces, side by side with a gap between them, so
 *  both doors open onto that street. Stacking them across the block instead put the back
 *  one's door in the front one's garden — a house you cannot walk into, which is not a
 *  house the economy can deliver to.
 *
 *  The garden is what is left over behind them. */
function homePlots(block: Footprint, facing: 0 | 1 | 2 | 3): { homes: Footprint[] } {
  const alongX = facing === 1 || facing === 3;
  const span = alongX ? block.w : block.d;
  const half = (span - HOME_GAP) >> 1;
  // The strip against the street, and the strip behind it.
  const frontDepth = HOME_DEPTH;
  const backDepth = (alongX ? block.d : block.w) - frontDepth;
  const front = (offset: number, size: number): Footprint => {
    if (alongX) {
      const z0 = facing === 3 ? block.z0 + backDepth : block.z0;
      return { x0: block.x0 + offset, z0, w: size, d: frontDepth };
    }
    const x0 = facing === 0 ? block.x0 + backDepth : block.x0;
    return { x0, z0: block.z0 + offset, w: frontDepth, d: size };
  };
  return { homes: [front(0, half), front(half + HOME_GAP, span - half - HOME_GAP)] };
}

/** Blocks of garden between the two houses on a block, and how deep a house is from the
 *  street it faces. */
const HOME_GAP = 1;
const HOME_DEPTH = 6;

/** Raises whatever a block is zoned for. The one place the zone becomes a building. */
function buildBlock(
  put: PutFn,
  sink: BuildSink,
  block: TownBlock,
  baseY: number,
  palette: Palette,
  architecture: VillageArchitecture,
  rng: Rng,
): Footprint[] {
  const facing = facingFor(block);
  const plot: Footprint = { x0: block.x0, z0: block.z0, w: block.w, d: block.d };
  if (block.zone === 'civic') {
    buildPlaza(put, plot, baseY, palette);
    return [plot];
  }
  if (block.zone === 'commercial') {
    buildShop(put, sink, plot, facing, baseY, palette, architecture, pick(rng));
    return [plot];
  }
  if (block.zone === 'industrial') {
    buildWorks(put, sink, plot, facing, baseY, 'blacksmith');
    return [plot];
  }
  const { homes } = homePlots(plot, facing);
  // The garden first, over the whole block, and the houses on top of it. That way every
  // column of the block is ground the town laid — including the seam between the two
  // houses, which is a strip nothing else covers and which the road index would otherwise
  // read as somebody else's paving running through the plot.
  for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
    for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
      put(x, baseY - 1, z, palette.ground);
      for (let y = baseY; y < baseY + 4; y++) put(x, y, z, Block.AIR);
      if (rng() < 0.2) put(x, baseY, z, rng() < 0.5 ? Block.FLOWER_RED : Block.FLOWER_YELLOW);
    }
  }
  for (const home of homes) buildHome(put, sink, home, facing, baseY, palette, architecture, pick(rng), rng);
  return [plot];
}

function pick(rng: Rng): Profession {
  return PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)];
}

/** Paves the street grid, and clears the headroom a road needs.
 *
 *  `floor` is the level somebody standing on the street occupies — the same number every
 *  builder takes, so the paving lands one below it and a doorway opens onto the street
 *  rather than a block above it. */
function paveStreets(put: PutFn, site: VillageSite, floor: number, palette: Palette): void {
  for (const strip of townStreets(site)) {
    for (let z = strip.z0; z < strip.z0 + strip.d; z++) {
      for (let x = strip.x0; x < strip.x0 + strip.w; x++) {
        put(x, floor - 1, z, palette.path);
        for (let h = 0; h < 5; h++) put(x, floor + h, z, Block.AIR);
      }
    }
  }
}

/** Builds the complete block list for a town, grouped by chunk so terrain generation can
 *  splice in only the parts that fall inside the chunk it is working on.
 *
 *  What is built is the street grid and the blocks zoned for stage 0. Everything further
 *  out is earned, and is written later as recorded edits by `planGrowth`. */
export function planVillage(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
): VillagePlan {
  const rng = mulberry32(hashInts(seed ^ 0x1111a9e, site.x, site.z));
  const architecture = architectureFor(seed, site, variant);
  const plan: VillagePlan = {
    site,
    baseY,
    variant,
    architecture,
    byChunk: new Map(),
    villagers: [],
    chests: [],
    buildings: [],
  };
  const palette = paletteFor(variant, architecture);
  const put: PutFn = (x, y, z, b) => {
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let list = plan.byChunk.get(key);
    if (!list) {
      list = [];
      plan.byChunk.set(key, list);
    }
    list.push({ x, y, z, b });
  };

  paveStreets(put, site, baseY + 1, palette);
  const sink: BuildSink = {
    buildings: plan.buildings,
    villagers: plan.villagers,
    chests: plan.chests,
  };
  // `baseY` is the plateau's top solid block and every builder wants the floor level: the
  // first clear cell above it. Handing it the plateau sinks a building a block into the
  // ground and leaves its doorway too low to walk through.
  for (const block of townBlocks(seed, site)) {
    if (block.stage !== 0) continue;
    buildBlock(put, sink, block, baseY + 1, palette, architecture, rng);
  }
  return plan;
}

/** What a town gains at one stage of its growth: the next few blocks of its own grid.
 *
 *  Its own random stream, on purpose. Drawing even one number from `planVillage`'s would
 *  shift everything after it, and growth has to be a pure addition to the town the seed
 *  generated rather than a reshuffle of it. */
export function planGrowth(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
  stage: number,
  occupied: readonly Footprint[],
  survey?: TownPlotSurvey,
): GrowthPlan {
  const plan: GrowthPlan = {
    placements: [],
    villagers: [],
    chests: [],
    buildings: [],
    footprints: [],
    pads: [],
  };
  if (stage <= 0) return plan;
  const rng = mulberry32(hashInts(seed ^ 0x9a0f, site.x, site.z, stage));
  const architecture = architectureFor(seed, site, variant);
  const palette = paletteFor(variant, architecture);
  const put: PutFn = (x, y, z, b) => {
    plan.placements.push({ x, y, z, b });
  };
  const sink: BuildSink = {
    buildings: plan.buildings,
    villagers: plan.villagers,
    chests: plan.chests,
  };
  for (const block of townGrowthBlocks(seed, site, stage, survey)) {
    const plot: Footprint = { x0: block.x0, z0: block.z0, w: block.w, d: block.d };
    if (occupied.some((taken) => overlaps(plot, taken))) continue;
    plan.footprints.push(plot);
    plan.pads.push({ ...plot, y: baseY });
    buildBlock(put, sink, block, baseY + 1, palette, architecture, rng);
  }
  return plan;
}

export function overlaps(a: Footprint, b: Footprint): boolean {
  return a.x0 < b.x0 + b.w + 1 && a.x0 + a.w + 1 > b.x0 && a.z0 < b.z0 + b.d + 1 && a.z0 + a.d + 1 > b.z0;
}

export interface GrowthPlan {
  placements: Placement[];
  villagers: VillagerMarker[];
  chests: ChestMarker[];
  /** The buildings this plan raises, addressable the same way a town's own are. */
  buildings: HouseRecord[];
  /** What this stage built on. Stage n + 1 is handed these along with the town's own, or
   *  the two would try to stand in the same place. */
  footprints: Footprint[];
  /** The ground each of those plots needs, for a writer that can see the world. */
  pads: Pad[];
}

/** Radius of the ground a hamlet levels for itself, and how far it will fill downwards to
 *  reach it. Together they decide how uneven a spot can be and still be built on. */
export const OUTPOST_PAD = 12;
export const OUTPOST_FILL = 7;

/** A hamlet: two homes either side of a scrap of street.
 *
 *  Not a town and deliberately not on the town grid — it is somewhere the game can send
 *  the player on their first errand, close enough to carry a crate to. It levels its own
 *  ground, because unlike a town it is written into a world that has already been
 *  generated: the writer only replaces soil, plants and air, so it builds a hillside up to
 *  meet a floor and will not carve into one. */
export function planOutpost(
  seed: number,
  site: VillageSite,
  baseY: number,
  variant: VillageVariant,
): GrowthPlan {
  const plan: GrowthPlan = {
    placements: [],
    villagers: [],
    chests: [],
    buildings: [],
    footprints: [],
    pads: [],
  };
  const rng = mulberry32(hashInts(seed ^ 0x51d3, site.x, site.z));
  const architecture = architectureFor(seed, site, variant);
  const palette = paletteFor(variant, architecture);
  const put: PutFn = (x, y, z, b) => {
    plan.placements.push({ x, y, z, b });
  };
  const sink: BuildSink = {
    buildings: plan.buildings,
    villagers: plan.villagers,
    chests: plan.chests,
  };

  for (let dz = -OUTPOST_PAD; dz <= OUTPOST_PAD; dz++) {
    for (let dx = -OUTPOST_PAD; dx <= OUTPOST_PAD; dx++) {
      if (dx * dx + dz * dz > OUTPOST_PAD * OUTPOST_PAD) continue;
      const x = site.x + dx;
      const z = site.z + dz;
      put(x, baseY - 1, z, palette.ground);
      for (let depth = 2; depth <= OUTPOST_FILL; depth++) put(x, baseY - depth, z, Block.DIRT);
      for (let y = baseY; y <= baseY + HOME_HEIGHT + architecture.homeRise + 1; y++) {
        put(x, y, z, Block.AIR);
      }
    }
  }

  const plots: Footprint[] = [
    { x0: site.x - 3, z0: site.z - 7, w: 6, d: 5 },
    { x0: site.x + 1, z0: site.z + 2, w: 6, d: 5 },
  ];
  const facings: (0 | 1 | 2 | 3)[] = [3, 1];
  for (let i = 0; i < plots.length; i++) {
    plan.footprints.push(plots[i]);
    buildHome(
      put,
      sink,
      plots[i],
      facings[i],
      baseY,
      palette,
      architecture,
      PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)],
      rng,
    );
  }

  // A scrap of street between the two doors, laid the way a town lays its own.
  for (let x = site.x - 4; x <= site.x + 6; x++) {
    put(x, baseY - 1, site.z, palette.path);
    for (let h = 0; h < 5; h++) put(x, baseY + h, site.z, Block.AIR);
  }
  return plan;
}
