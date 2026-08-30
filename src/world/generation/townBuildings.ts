/** What stands on a city block.
 *
 *  Three silhouettes, and they have to be told apart from across the town — that is the
 *  whole job of this file. The economy asks the player to know where the works are and
 *  which building is a shop before they have opened a panel, and a town where every
 *  building is a house with a different label is a town they have to survey.
 *
 *  So: a shop is glass and an awning under a flat roof. A works is rough stone with two
 *  chimneys and a yard of crates. A home is small, has a garden, and is the only one of
 *  the three with a pitched roof. Nothing else about them is decorative — the doorway is
 *  where goods and people go in and out, and it is recorded rather than computed twice.
 *
 *  Everything here writes through a `put` callback and touches nothing else, so it runs
 *  inside terrain generation, inside a growth pass, and inside a test alike. */

import { Block, type BlockId } from '../blocks';
import { hashInts, type Rng } from '../../core/rng';
import {
  FACING_STEP,
  type BuildingUse,
  type Footprint,
  type HouseRecord,
  type Profession,
  type VillageVariant,
} from './village';

export type PutFn = (x: number, y: number, z: number, b: BlockId) => void;

/** What a builder reports back: the buildings it raised, the people who live in them and
 *  the chests they keep. */
export interface BuildSink {
  buildings: HouseRecord[];
  villagers: { x: number; y: number; z: number; profession: Profession }[];
  chests: { x: number; y: number; z: number; loot: Profession }[];
}

export interface Palette {
  wall: BlockId;
  corner: BlockId;
  roof: BlockId;
  /** Lower wall course and visible beams; these are what make two similarly coloured
   *  villages read as different building traditions up close. */
  foundation: BlockId;
  trim: BlockId;
  floor: BlockId;
  path: BlockId;
  /** What the ground of this town is, for gardens and yards. */
  ground: BlockId;
}

export type RoofForm = 'gable' | 'hipped' | 'terrace';
export type ArchitectureId =
  | 'plains-timber'
  | 'plains-stone'
  | 'desert-courtyard'
  | 'desert-stepped'
  | 'snowy-alpine'
  | 'snowy-longhouse';

/** The visual grammar shared by every building in one village. A style is selected from
 *  the biome's two local traditions, so travelling between villages changes both the
 *  materials and the skyline without putting an alpine roof in the desert. */
export interface VillageArchitecture {
  id: ArchitectureId;
  label: string;
  homeRoof: RoofForm;
  shopRoof: RoofForm;
  /** Rise in blocks. Gables use the larger values; longhouses stay deliberately low. */
  homeRise: number;
  shopRise: number;
  /** Horizontal log/stone course around the upper wall. */
  wallBand: boolean;
}

const ARCHITECTURES: Record<ArchitectureId, VillageArchitecture> = {
  'plains-timber': {
    id: 'plains-timber', label: '木骨切妻式', homeRoof: 'gable', shopRoof: 'gable',
    homeRise: 3, shopRise: 4, wallBand: true,
  },
  'plains-stone': {
    id: 'plains-stone', label: '石造寄棟式', homeRoof: 'hipped', shopRoof: 'hipped',
    homeRise: 3, shopRise: 3, wallBand: false,
  },
  'desert-courtyard': {
    id: 'desert-courtyard', label: '砂岩中庭式', homeRoof: 'terrace', shopRoof: 'terrace',
    homeRise: 1, shopRise: 1, wallBand: false,
  },
  'desert-stepped': {
    id: 'desert-stepped', label: '砂漠段状式', homeRoof: 'hipped', shopRoof: 'terrace',
    homeRise: 3, shopRise: 2, wallBand: true,
  },
  'snowy-alpine': {
    id: 'snowy-alpine', label: 'アルプス切妻式', homeRoof: 'gable', shopRoof: 'gable',
    homeRise: 4, shopRise: 4, wallBand: true,
  },
  'snowy-longhouse': {
    id: 'snowy-longhouse', label: '北方長屋式', homeRoof: 'gable', shopRoof: 'hipped',
    homeRise: 2, shopRise: 2, wallBand: false,
  },
};

/** Stable and independent of the layout RNG. Adding a style must never reshuffle villagers,
 *  professions or districts in an existing world. */
export function architectureFor(
  seed: number,
  site: { x: number; z: number },
  variant: VillageVariant,
): VillageArchitecture {
  const choice = (hashInts(seed ^ 0x6a09e667, site.x, site.z) >>> 0) & 1;
  const ids: Record<VillageVariant, readonly [ArchitectureId, ArchitectureId]> = {
    plains: ['plains-timber', 'plains-stone'],
    desert: ['desert-courtyard', 'desert-stepped'],
    snowy: ['snowy-alpine', 'snowy-longhouse'],
  };
  return ARCHITECTURES[ids[variant][choice]];
}

/** A town is built out of what its country is built out of, so a desert town does not read
 *  as an oak village that happens to be somewhere hot. */
export function paletteFor(variant: VillageVariant, architecture?: VillageArchitecture): Palette {
  const style = architecture?.id;
  if (style === 'plains-stone') {
    return {
      wall: Block.SANDSTONE,
      corner: Block.COBBLESTONE,
      roof: Block.OAK_PLANKS,
      foundation: Block.STONE_BRICKS,
      trim: Block.COBBLESTONE,
      floor: Block.OAK_PLANKS,
      path: Block.DIRT_PATH,
      ground: Block.GRASS,
    };
  }
  if (style === 'desert-stepped') {
    return {
      wall: Block.SANDSTONE,
      corner: Block.OAK_LOG,
      roof: Block.STONE_BRICKS,
      foundation: Block.SANDSTONE,
      trim: Block.OAK_LOG,
      floor: Block.SANDSTONE,
      path: Block.GRAVEL,
      ground: Block.SAND,
    };
  }
  if (style === 'snowy-alpine') {
    return {
      wall: Block.OAK_PLANKS,
      corner: Block.SPRUCE_LOG,
      roof: Block.STONE_BRICKS,
      foundation: Block.COBBLESTONE,
      trim: Block.SPRUCE_LOG,
      floor: Block.OAK_PLANKS,
      path: Block.COBBLESTONE,
      ground: Block.SNOW,
    };
  }
  if (style === 'snowy-longhouse') {
    return {
      wall: Block.SPRUCE_LOG,
      corner: Block.COBBLESTONE,
      roof: Block.OAK_PLANKS,
      foundation: Block.STONE_BRICKS,
      trim: Block.SPRUCE_LOG,
      floor: Block.OAK_PLANKS,
      path: Block.COBBLESTONE,
      ground: Block.SNOW,
    };
  }
  if (variant === 'desert') {
    return {
      wall: Block.SANDSTONE,
      corner: Block.STONE_BRICKS,
      roof: Block.SANDSTONE,
      foundation: Block.SANDSTONE,
      trim: Block.STONE_BRICKS,
      floor: Block.SANDSTONE,
      path: Block.GRAVEL,
      ground: Block.SAND,
    };
  }
  if (variant === 'snowy') {
    return {
      wall: Block.SPRUCE_LOG,
      corner: Block.SPRUCE_LOG,
      roof: Block.STONE_BRICKS,
      foundation: Block.COBBLESTONE,
      trim: Block.SPRUCE_LOG,
      floor: Block.OAK_PLANKS,
      path: Block.COBBLESTONE,
      ground: Block.SNOW,
    };
  }
  return {
    wall: Block.OAK_PLANKS,
    corner: Block.OAK_LOG,
    roof: Block.STONE_BRICKS,
    foundation: Block.COBBLESTONE,
    trim: Block.OAK_LOG,
    floor: Block.OAK_PLANKS,
    path: Block.DIRT_PATH,
    ground: Block.GRASS,
  };
}

/** A stepped roof whose final course closes to a one- or two-block ridge. `facing` makes
 *  the triangular gable sit over the front wall, while the ridge runs into the building. */
function buildGableRoof(
  put: PutFn,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  top: number,
  block: BlockId,
  rise: number,
): void {
  // A doorway in an X wall has a front that runs along Z, and vice versa. Sloping along
  // that front-wall axis leaves the ridge pointing back into the building.
  const slopeAlongX = facing === 1 || facing === 3;
  const x0 = plot.x0 - 1;
  const x1 = plot.x0 + plot.w;
  const z0 = plot.z0 - 1;
  const z1 = plot.z0 + plot.d;
  const span = slopeAlongX ? x1 - x0 + 1 : z1 - z0 + 1;
  const maxInset = Math.floor((span - 1) / 2);
  for (let layer = 0; layer <= rise; layer++) {
    const inset = Math.floor((layer * maxInset) / Math.max(1, rise));
    const ax0 = slopeAlongX ? x0 + inset : x0;
    const ax1 = slopeAlongX ? x1 - inset : x1;
    const az0 = slopeAlongX ? z0 : z0 + inset;
    const az1 = slopeAlongX ? z1 : z1 - inset;
    for (let z = az0; z <= az1; z++) {
      for (let x = ax0; x <= ax1; x++) {
        let roofBlock = block;
        // Only stone-brick roofs have authored wedge blocks. The two outside courses
        // slope up towards the ridge; the final narrow course stays a solid ridge cap.
        if (block === Block.STONE_BRICKS && layer < rise) {
          if (slopeAlongX && ax0 < ax1) {
            if (x === ax0) roofBlock = Block.STONE_ROOF_EAST;
            else if (x === ax1) roofBlock = Block.STONE_ROOF_WEST;
          } else if (!slopeAlongX && az0 < az1) {
            if (z === az0) roofBlock = Block.STONE_ROOF_SOUTH;
            else if (z === az1) roofBlock = Block.STONE_ROOF_NORTH;
          }
        }
        put(x, top + layer, z, roofBlock);
      }
    }
  }
}

/** A roof that slopes in from all four sides, used by the stone villages. */
function buildHippedRoof(put: PutFn, plot: Footprint, top: number, block: BlockId, rise: number): void {
  const x0 = plot.x0 - 1;
  const x1 = plot.x0 + plot.w;
  const z0 = plot.z0 - 1;
  const z1 = plot.z0 + plot.d;
  const maxInsetX = Math.floor((x1 - x0) / 2);
  const maxInsetZ = Math.floor((z1 - z0) / 2);
  for (let layer = 0; layer <= rise; layer++) {
    const insetX = Math.floor((layer * maxInsetX) / Math.max(1, rise));
    const insetZ = Math.floor((layer * maxInsetZ) / Math.max(1, rise));
    for (let z = z0 + insetZ; z <= z1 - insetZ; z++) {
      for (let x = x0 + insetX; x <= x1 - insetX; x++) put(x, top + layer, z, block);
    }
  }
}

/** Flat desert roof with a low parapet. The open centre distinguishes a usable roof
 *  terrace from the old featureless slab. */
function buildTerraceRoof(put: PutFn, plot: Footprint, top: number, block: BlockId, trim: BlockId): void {
  const x0 = plot.x0 - 1;
  const x1 = plot.x0 + plot.w;
  const z0 = plot.z0 - 1;
  const z1 = plot.z0 + plot.d;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      put(x, top, z, block);
      if (x === x0 || x === x1 || z === z0 || z === z1) put(x, top + 1, z, trim);
    }
  }
}

function buildRoof(
  put: PutFn,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  top: number,
  palette: Palette,
  form: RoofForm,
  rise: number,
): void {
  if (form === 'gable') buildGableRoof(put, plot, facing, top, palette.roof, rise);
  else if (form === 'hipped') buildHippedRoof(put, plot, top, palette.roof, rise);
  else buildTerraceRoof(put, plot, top, palette.roof, palette.trim);
}

/** Clears the air above a column and lays the ground under it. Every builder starts here,
 *  because a plot is levelled before it is built on. */
function clearTo(put: PutFn, x: number, z: number, baseY: number, ground: BlockId, height: number): void {
  put(x, baseY - 1, z, ground);
  for (let y = baseY; y < baseY + height; y++) put(x, y, z, Block.AIR);
}

/** The doorway of a building on one of its walls, given which way it faces. */
function doorOf(plot: Footprint, facing: 0 | 1 | 2 | 3, baseY: number): {
  door: { x: number; y: number; z: number };
  outside: { x: number; y: number; z: number };
} {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  const doorX = facing === 1 || facing === 3 ? plot.x0 + (plot.w >> 1) : facing === 2 ? plot.x0 : x1;
  const doorZ = facing === 0 || facing === 2 ? plot.z0 + (plot.d >> 1) : facing === 1 ? plot.z0 : z1;
  const [stepX, stepZ] = FACING_STEP[facing];
  return {
    door: { x: doorX, y: baseY, z: doorZ },
    outside: { x: doorX + stepX, y: baseY, z: doorZ + stepZ },
  };
}

/** True for a cell on the outer ring of a rectangle. */
function onEdge(plot: Footprint, x: number, z: number): boolean {
  return x === plot.x0 || x === plot.x0 + plot.w - 1 || z === plot.z0 || z === plot.z0 + plot.d - 1;
}

function isCorner(plot: Footprint, x: number, z: number): boolean {
  return (x === plot.x0 || x === plot.x0 + plot.w - 1) && (z === plot.z0 || z === plot.z0 + plot.d - 1);
}

/** Records the building and the villager inside it. */
function record(
  sink: BuildSink,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  use: BuildingUse,
  role: HouseRecord['role'],
  profession: Profession,
  baseY: number,
): HouseRecord {
  const { door, outside } = doorOf(plot, facing, baseY);
  const house: HouseRecord = { ...plot, facing, role, use, profession, door, outside };
  sink.buildings.push(house);
  sink.villagers.push({
    x: plot.x0 + (plot.w >> 1),
    y: baseY + 1,
    z: plot.z0 + (plot.d >> 1),
    profession,
  });
  return house;
}

/** A shop: glass along the street, an awning over the door, a flat roof.
 *
 *  It fills its block, because a shop is the frontage of a whole block rather than a house
 *  with a sign on it — which is what makes the middle of a town read as the middle from
 *  the air. */
export function buildShop(
  put: PutFn,
  sink: BuildSink,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  baseY: number,
  palette: Palette,
  architecture: VillageArchitecture,
  profession: Profession,
): void {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  const top = baseY + SHOP_HEIGHT;
  for (let z = plot.z0; z <= z1; z++) {
    for (let x = plot.x0; x <= x1; x++) {
      clearTo(put, x, z, baseY, palette.floor, SHOP_HEIGHT + architecture.shopRise + 1);
    }
  }
  const front = frontWall(plot, facing);
  for (let y = baseY; y < top; y++) {
    for (let z = plot.z0; z <= z1; z++) {
      for (let x = plot.x0; x <= x1; x++) {
        if (!onEdge(plot, x, z)) continue;
        if (isCorner(plot, x, z)) {
          put(x, y, z, palette.corner);
          continue;
        }
        // The whole street-facing wall above the sill is glass. That single rule is what
        // makes a shop a shop from a hundred blocks away.
        const glazed = front(x, z) && y > baseY;
        put(x, y, z, glazed ? Block.GLASS : palette.wall);
      }
    }
  }
  // The whole village shares a roof grammar. A timber town gets a market hall with a
  // triangular gable; a desert town keeps a roof terrace rather than borrowing it.
  buildRoof(put, plot, facing, top, palette, architecture.shopRoof, architecture.shopRise);
  const [stepX, stepZ] = FACING_STEP[facing];
  for (let z = plot.z0; z <= z1; z++) {
    for (let x = plot.x0; x <= x1; x++) {
      if (!front(x, z)) continue;
      // One block of cloth, jutting into the street. Nothing else in a town has one, and
      // two blocks of it roofed over most of a three wide street.
      put(x + stepX, baseY + AWNING_HEIGHT, z + stepZ, Block.WOOL);
    }
  }
  const house = record(sink, plot, facing, 'commercial', 'shop', profession, baseY);
  knockDoor(put, house, baseY);
  // A counter of tables along the back, and lamps, so the inside reads as a shop too.
  const backZ = facing === 1 ? z1 - 1 : plot.z0 + 1;
  for (let x = plot.x0 + 2; x <= x1 - 2; x++) put(x, baseY, backZ, Block.CRAFTING_TABLE);
  put(plot.x0 + 1, baseY + 2, plot.z0 + 1, Block.TORCH);
  put(x1 - 1, baseY + 2, z1 - 1, Block.TORCH);
  const chestX = plot.x0 + 1;
  const chestZ = facing === 1 ? z1 - 2 : plot.z0 + 2;
  put(chestX, baseY, chestZ, Block.CHEST);
  sink.chests.push({ x: chestX, y: baseY, z: chestZ, loot: profession });
}

/** A works: rough stone, two chimneys, and a yard of crates.
 *
 *  Taller than anything else in a town and the only thing with smoke stacks, so "the works
 *  are on the far side" is answerable from the station platform. */
export function buildWorks(
  put: PutFn,
  sink: BuildSink,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  baseY: number,
  profession: Profession,
): void {
  // The shed takes most of the block; the strip left over is its yard. It is built out of
  // stone whatever the town is built out of — a works is the one building that is the same
  // in a desert and in the snow, because what decides it is the heat inside.
  const shed: Footprint = facing === 1 || facing === 3
    ? { x0: plot.x0, z0: facing === 1 ? plot.z0 + YARD_DEPTH : plot.z0, w: plot.w, d: plot.d - YARD_DEPTH }
    : { x0: facing === 2 ? plot.x0 + YARD_DEPTH : plot.x0, z0: plot.z0, w: plot.w - YARD_DEPTH, d: plot.d };
  const x1 = shed.x0 + shed.w - 1;
  const z1 = shed.z0 + shed.d - 1;
  const top = baseY + WORKS_HEIGHT;
  for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
    for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
      clearTo(put, x, z, baseY, Block.GRAVEL, WORKS_HEIGHT + 6);
    }
  }
  for (let y = baseY; y < top; y++) {
    for (let z = shed.z0; z <= z1; z++) {
      for (let x = shed.x0; x <= x1; x++) {
        if (!onEdge(shed, x, z)) continue;
        put(x, y, z, isCorner(shed, x, z) ? Block.STONE_BRICKS : Block.COBBLESTONE);
      }
    }
  }
  // A high band of small windows, the way a factory is lit: daylight without a shopfront.
  for (let x = shed.x0 + 2; x <= x1 - 2; x += 3) {
    put(x, top - 2, shed.z0, Block.GLASS);
    put(x, top - 2, z1, Block.GLASS);
  }
  for (let z = shed.z0 + 2; z <= z1 - 2; z += 3) {
    put(shed.x0, top - 2, z, Block.GLASS);
    put(x1, top - 2, z, Block.GLASS);
  }
  for (let z = shed.z0 - 1; z <= z1 + 1; z++) {
    for (let x = shed.x0 - 1; x <= x1 + 1; x++) put(x, top, z, Block.STONE_BRICKS);
  }
  // The chimneys. Two, on opposite corners, tall enough to break the roof line from a
  // distance — this is the whole silhouette.
  for (const [cx, cz] of [[shed.x0 + 1, shed.z0 + 1], [x1 - 1, z1 - 1]] as const) {
    for (let h = 1; h <= CHIMNEY_HEIGHT; h++) put(cx, top + h, cz, Block.COBBLESTONE);
  }
  const house = record(sink, shed, facing, 'industrial', 'works', profession, baseY);
  knockDoor(put, house, baseY);
  // Furnaces inside, crates stacked in the yard.
  for (let x = shed.x0 + 2; x <= x1 - 2; x += 2) put(x, baseY, z1 - 1, Block.FURNACE);
  put(shed.x0 + 1, baseY + 2, shed.z0 + 1, Block.TORCH);
  const yard = yardOf(plot, shed, facing);
  for (let i = 0; i < yard.length; i++) {
    const cell = yard[i];
    if (i % 3 !== 0) continue;
    put(cell.x, baseY, cell.z, Block.OAK_LOG);
    if (i % 6 === 0) put(cell.x, baseY + 1, cell.z, Block.OAK_LOG);
  }
  const chest = yard[1];
  if (chest) {
    put(chest.x, baseY, chest.z, Block.CHEST);
    sink.chests.push({ x: chest.x, y: baseY, z: chest.z, loot: profession });
  }
}

/** A home: small, pitched roof, a garden and a path to the street.
 *
 *  Two to a block, so a residential block reads as houses with space between them rather
 *  than one long building. */
export function buildHome(
  put: PutFn,
  sink: BuildSink,
  plot: Footprint,
  facing: 0 | 1 | 2 | 3,
  baseY: number,
  palette: Palette,
  architecture: VillageArchitecture,
  profession: Profession,
  rng: Rng,
): void {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  const top = baseY + HOME_HEIGHT;
  for (let z = plot.z0; z <= z1; z++) {
    for (let x = plot.x0; x <= x1; x++) {
      clearTo(put, x, z, baseY, palette.floor, HOME_HEIGHT + architecture.homeRise + 1);
    }
  }
  for (let y = baseY; y < top; y++) {
    for (let z = plot.z0; z <= z1; z++) {
      for (let x = plot.x0; x <= x1; x++) {
        if (!onEdge(plot, x, z)) continue;
        const material = isCorner(plot, x, z)
          ? palette.corner
          : y === baseY
            ? palette.foundation
            : architecture.wallBand && y === top - 1
              ? palette.trim
              : palette.wall;
        put(x, y, z, material);
      }
    }
  }
  // Windows on the middle course, one to a wall: small, which is the point. The doorway is
  // skipped rather than glazed over — on a house this narrow the middle of the front wall
  // is both, and whichever was written second used to win.
  const way = doorOf(plot, facing, baseY);
  const free = (x: number, z: number): boolean => x !== way.door.x || z !== way.door.z;
  for (let x = plot.x0 + 2; x <= x1 - 2; x += 2) {
    if (free(x, plot.z0)) put(x, baseY + 1, plot.z0, Block.GLASS);
    if (free(x, z1)) put(x, baseY + 1, z1, Block.GLASS);
  }
  for (let z = plot.z0 + 2; z <= z1 - 2; z += 2) {
    if (free(plot.x0, z)) put(plot.x0, baseY + 1, z, Block.GLASS);
    if (free(x1, z)) put(x1, baseY + 1, z, Block.GLASS);
  }
  buildRoof(put, plot, facing, top, palette, architecture.homeRoof, architecture.homeRise);
  const house = record(sink, plot, facing, 'residential', 'house', profession, baseY);
  knockDoor(put, house, baseY);
  put(plot.x0 + 1, baseY, plot.z0 + 1, Block.TORCH);
  const bench = profession === 'librarian' ? Block.BOOKSHELF : Block.CRAFTING_TABLE;
  put(x1 - 1, baseY, z1 - 1, bench);
  if (rng() < 0.6) {
    const chestX = plot.x0 + 1;
    const chestZ = z1 - 1;
    put(chestX, baseY, chestZ, Block.CHEST);
    sink.chests.push({ x: chestX, y: baseY, z: chestZ, loot: profession });
  }
}

/** The square: paved, a well in the middle, lamps at the corners. Somewhere for a town to
 *  have a middle that is not a road junction. */
export function buildPlaza(
  put: PutFn,
  plot: Footprint,
  baseY: number,
  palette: Palette,
): void {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  for (let z = plot.z0; z <= z1; z++) {
    for (let x = plot.x0; x <= x1; x++) {
      put(x, baseY - 1, z, Block.STONE_BRICKS);
      for (let y = baseY; y < baseY + 6; y++) put(x, y, z, Block.AIR);
    }
  }
  const cx = plot.x0 + (plot.w >> 1);
  const cz = plot.z0 + (plot.d >> 1);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      put(cx + dx, baseY, cz + dz, Block.MOSSY_COBBLESTONE);
      put(cx + dx, baseY - 1, cz + dz, Block.MOSSY_COBBLESTONE);
    }
  }
  put(cx, baseY, cz, Block.WATER);
  put(cx, baseY - 1, cz, Block.WATER);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    for (let h = 1; h <= 3; h++) put(cx + dx, baseY + h, cz + dz, Block.STONE_COLUMN);
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) put(cx + dx, baseY + 4, cz + dz, palette.roof);
  }
  // Lamps at the corners of the square, which is what makes a town visible after dark.
  const lampPost = palette.corner === Block.OAK_LOG || palette.corner === Block.SPRUCE_LOG
    ? Block.WOOD_COLUMN
    : Block.STONE_COLUMN;
  for (const [lx, lz] of [[plot.x0 + 1, plot.z0 + 1], [x1 - 1, plot.z0 + 1], [plot.x0 + 1, z1 - 1], [x1 - 1, z1 - 1]] as const) {
    for (let h = 0; h < 3; h++) put(lx, baseY + h, lz, lampPost);
    put(lx, baseY + 3, lz, Block.TORCH);
  }
}

/** Knocks the doorway out of a wall that has already been raised, and paves the step.
 *
 *  Last, deliberately: a builder raises walls and then cuts openings, which is the order a
 *  plan has to be written in for `villageGrowth` to collapse it correctly. */
function knockDoor(put: PutFn, house: HouseRecord, baseY: number): void {
  put(house.door.x, baseY, house.door.z, Block.AIR);
  put(house.door.x, baseY + 1, house.door.z, Block.AIR);
}

/** The strip of a block a works leaves for its yard. */
function yardOf(plot: Footprint, shed: Footprint, facing: 0 | 1 | 2 | 3): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = plot.z0; z < plot.z0 + plot.d; z++) {
    for (let x = plot.x0; x < plot.x0 + plot.w; x++) {
      const inShed = x >= shed.x0 && x < shed.x0 + shed.w && z >= shed.z0 && z < shed.z0 + shed.d;
      if (!inShed) out.push({ x, z });
    }
  }
  void facing;
  return out;
}

/** Whether a cell is on the street-facing wall of a plot. */
function frontWall(plot: Footprint, facing: 0 | 1 | 2 | 3): (x: number, z: number) => boolean {
  const x1 = plot.x0 + plot.w - 1;
  const z1 = plot.z0 + plot.d - 1;
  if (facing === 0) return (x) => x === plot.x0;
  if (facing === 2) return (x) => x === x1;
  if (facing === 1) return (_x, z) => z === plot.z0;
  return (_x, z) => z === z1;
}

/** How tall each kind of building stands. A works is the tallest thing in a town and a
 *  home the shortest, which is most of how they are told apart at a distance. */
export const HOME_HEIGHT = 4;
export const SHOP_HEIGHT = 5;
export const WORKS_HEIGHT = 7;
/** How far the chimneys carry above the works' roof. */
export const CHIMNEY_HEIGHT = 4;
/** Where the shop's awning sits, and how deep a works' yard is. */
export const AWNING_HEIGHT = 3;
export const YARD_DEPTH = 3;
