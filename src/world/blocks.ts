/** Block registry. Pure data + lookup helpers: no rendering or three.js here so the
 *  whole module can be exercised from unit tests. */

export const Block = {
  AIR: 0,
  STONE: 1,
  GRASS: 2,
  DIRT: 3,
  COBBLESTONE: 4,
  SAND: 5,
  SANDSTONE: 6,
  GRAVEL: 7,
  BEDROCK: 8,
  WATER: 9,
  OAK_LOG: 10,
  OAK_LEAVES: 11,
  OAK_PLANKS: 12,
  BIRCH_LOG: 13,
  BIRCH_LEAVES: 14,
  SPRUCE_LOG: 15,
  SPRUCE_LEAVES: 16,
  COAL_ORE: 17,
  IRON_ORE: 18,
  GOLD_ORE: 19,
  DIAMOND_ORE: 20,
  EMERALD_ORE: 21,
  GLASS: 22,
  CRAFTING_TABLE: 23,
  FURNACE: 24,
  CHEST: 25,
  TORCH: 26,
  SNOW: 27,
  ICE: 28,
  CACTUS: 29,
  TALL_GRASS: 30,
  FLOWER_RED: 31,
  FLOWER_YELLOW: 32,
  DEAD_BUSH: 33,
  SUGAR_CANE: 34,
  FARMLAND: 35,
  FARMLAND_WET: 36,
  WHEAT_0: 37,
  WHEAT_1: 38,
  WHEAT_2: 39,
  WHEAT_3: 40,
  CARROTS_0: 41,
  CARROTS_1: 42,
  CARROTS_2: 43,
  CARROTS_3: 44,
  POTATOES_0: 45,
  POTATOES_1: 46,
  POTATOES_2: 47,
  POTATOES_3: 48,
  DIRT_PATH: 49,
  STONE_BRICKS: 50,
  WOOL: 51,
  BOOKSHELF: 52,
  MOSSY_COBBLESTONE: 53,
  SPRING: 54,
  PUMP: 55,
  DRAIN: 56,
  FLOODGATE_CLOSED: 57,
  FLOODGATE_OPEN: 58,
  STONE_ROOF_EAST: 59,
  STONE_ROOF_WEST: 60,
  STONE_ROOF_SOUTH: 61,
  STONE_ROOF_NORTH: 62,
  STONE_COLUMN: 63,
  WOOD_COLUMN: 64,
} as const;

export type BlockId = number;
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';
export type RenderKind = 'none' | 'cube' | 'cross' | 'liquid';
export type BlockShape = 'cube' | 'slope_east' | 'slope_west' | 'slope_south' | 'slope_north' | 'cylinder';

export interface BlockTextures {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
}

export interface BlockDef {
  id: BlockId;
  name: string;
  label: string;
  render: RenderKind;
  /** Geometry inside the voxel cell. Non-cube shapes still use the normal block atlas,
   *  storage, mining and placement pipeline. */
  shape: BlockShape;
  /** Whether the player and mobs collide with it. */
  solid: boolean;
  /** Fully blocks light and hides the faces of neighbouring blocks. */
  opaque: boolean;
  /** Can be overwritten by placing a block into its space (grass, water, ...). */
  replaceable: boolean;
  /** Light emitted, 0..15. */
  light: number;
  /** Light lost when travelling through this block (opaque blocks stop light entirely). */
  filter: number;
  /** Base break time in seconds with a bare hand and no tool bonus; -1 means unbreakable. */
  hardness: number;
  tool: ToolKind | null;
  /** Minimum tool tier that yields a drop (0 = drops with anything). */
  tier: number;
  tex: BlockTextures;
  /** Item id produced when broken; null means nothing. Defaults to the block's own item. */
  drop?: string | null;
  dropMin?: number;
  dropMax?: number;
  /** Falls when unsupported (sand, gravel). */
  gravity?: boolean;
  /** Damages entities standing against it. */
  contactDamage?: number;
}

type DefInput = Omit<BlockDef, 'solid' | 'opaque' | 'replaceable' | 'light' | 'filter' | 'render' | 'shape' | 'tier' | 'tool'> &
  Partial<Pick<BlockDef, 'solid' | 'opaque' | 'replaceable' | 'light' | 'filter' | 'render' | 'shape' | 'tier' | 'tool'>>;

const DEFS: BlockDef[] = [];

function def(input: DefInput): void {
  const render = input.render ?? 'cube';
  const full: BlockDef = {
    render,
    shape: input.shape ?? 'cube',
    solid: input.solid ?? (render === 'cube'),
    opaque: input.opaque ?? (render === 'cube'),
    replaceable: input.replaceable ?? (render === 'cross' || render === 'liquid' || render === 'none'),
    light: input.light ?? 0,
    filter: input.filter ?? 1,
    tool: input.tool ?? null,
    tier: input.tier ?? 0,
    ...input,
  } as BlockDef;
  DEFS[full.id] = full;
}

const B = Block;

def({ id: B.AIR, name: 'air', label: 'Air', render: 'none', hardness: -1, tex: {}, drop: null });
def({ id: B.STONE, name: 'stone', label: '石', hardness: 1.5, tool: 'pickaxe', tier: 1, tex: { all: 'stone' }, drop: 'cobblestone' });
def({ id: B.GRASS, name: 'grass', label: '草ブロック', hardness: 0.6, tool: 'shovel', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, drop: 'dirt' });
def({ id: B.DIRT, name: 'dirt', label: '土', hardness: 0.5, tool: 'shovel', tex: { all: 'dirt' } });
def({ id: B.COBBLESTONE, name: 'cobblestone', label: '丸石', hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'cobblestone' } });
def({ id: B.SAND, name: 'sand', label: '砂', hardness: 0.5, tool: 'shovel', tex: { all: 'sand' }, gravity: true });
def({ id: B.SANDSTONE, name: 'sandstone', label: '砂岩', hardness: 0.8, tool: 'pickaxe', tier: 1, tex: { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_top' } });
def({ id: B.GRAVEL, name: 'gravel', label: '砂利', hardness: 0.6, tool: 'shovel', tex: { all: 'gravel' }, gravity: true });
def({ id: B.BEDROCK, name: 'bedrock', label: '岩盤', hardness: -1, tex: { all: 'bedrock' }, drop: null });
def({ id: B.WATER, name: 'water', label: '水', render: 'liquid', hardness: -1, filter: 3, tex: { all: 'water' }, drop: null });
def({ id: B.OAK_LOG, name: 'oak_log', label: 'オークの原木', hardness: 2, tool: 'axe', tex: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' } });
def({ id: B.OAK_LEAVES, name: 'oak_leaves', label: 'オークの葉', hardness: 0.2, opaque: false, tex: { all: 'oak_leaves' }, drop: null });
def({ id: B.OAK_PLANKS, name: 'oak_planks', label: '木材', hardness: 2, tool: 'axe', tex: { all: 'oak_planks' } });
def({ id: B.BIRCH_LOG, name: 'birch_log', label: 'シラカバの原木', hardness: 2, tool: 'axe', tex: { top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' }, drop: 'oak_log' });
def({ id: B.BIRCH_LEAVES, name: 'birch_leaves', label: 'シラカバの葉', hardness: 0.2, opaque: false, tex: { all: 'birch_leaves' }, drop: null });
def({ id: B.SPRUCE_LOG, name: 'spruce_log', label: 'トウヒの原木', hardness: 2, tool: 'axe', tex: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' }, drop: 'oak_log' });
def({ id: B.SPRUCE_LEAVES, name: 'spruce_leaves', label: 'トウヒの葉', hardness: 0.2, opaque: false, tex: { all: 'spruce_leaves' }, drop: null });
def({ id: B.COAL_ORE, name: 'coal_ore', label: '石炭鉱石', hardness: 3, tool: 'pickaxe', tier: 1, tex: { all: 'coal_ore' }, drop: 'coal' });
def({ id: B.IRON_ORE, name: 'iron_ore', label: '鉄鉱石', hardness: 3, tool: 'pickaxe', tier: 2, tex: { all: 'iron_ore' }, drop: 'iron_ore' });
def({ id: B.GOLD_ORE, name: 'gold_ore', label: '金鉱石', hardness: 3, tool: 'pickaxe', tier: 3, tex: { all: 'gold_ore' }, drop: 'gold_ore' });
def({ id: B.DIAMOND_ORE, name: 'diamond_ore', label: 'ダイヤモンド鉱石', hardness: 3, tool: 'pickaxe', tier: 3, tex: { all: 'diamond_ore' }, drop: 'diamond' });
def({ id: B.EMERALD_ORE, name: 'emerald_ore', label: 'エメラルド鉱石', hardness: 3, tool: 'pickaxe', tier: 3, tex: { all: 'emerald_ore' }, drop: 'emerald' });
def({ id: B.GLASS, name: 'glass', label: 'ガラス', hardness: 0.3, opaque: false, tex: { all: 'glass' }, drop: null });
def({ id: B.CRAFTING_TABLE, name: 'crafting_table', label: '作業台', hardness: 2.5, tool: 'axe', tex: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks' } });
def({ id: B.FURNACE, name: 'furnace', label: 'かまど', hardness: 3.5, tool: 'pickaxe', tier: 1, tex: { top: 'furnace_top', side: 'furnace_front', bottom: 'furnace_top' } });
def({ id: B.CHEST, name: 'chest', label: 'チェスト', hardness: 2.5, tool: 'axe', tex: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top' } });
def({ id: B.TORCH, name: 'torch', label: '松明', render: 'cross', hardness: 0.05, light: 14, tex: { all: 'torch' } });
def({ id: B.SNOW, name: 'snow', label: '雪', hardness: 0.4, tool: 'shovel', tex: { all: 'snow' } });
def({ id: B.ICE, name: 'ice', label: '氷', hardness: 0.5, tool: 'pickaxe', opaque: false, filter: 2, tex: { all: 'ice' }, drop: null });
def({ id: B.CACTUS, name: 'cactus', label: 'サボテン', hardness: 0.4, opaque: false, tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, contactDamage: 1 });
def({ id: B.TALL_GRASS, name: 'tall_grass', label: '草', render: 'cross', hardness: 0.05, tex: { all: 'tall_grass' }, drop: null });
def({ id: B.FLOWER_RED, name: 'flower_red', label: 'ポピー', render: 'cross', hardness: 0.05, tex: { all: 'flower_red' } });
def({ id: B.FLOWER_YELLOW, name: 'flower_yellow', label: 'タンポポ', render: 'cross', hardness: 0.05, tex: { all: 'flower_yellow' } });
def({ id: B.DEAD_BUSH, name: 'dead_bush', label: '枯れ木', render: 'cross', hardness: 0.05, tex: { all: 'dead_bush' }, drop: 'stick' });
def({ id: B.SUGAR_CANE, name: 'sugar_cane', label: 'サトウキビ', render: 'cross', hardness: 0.1, tex: { all: 'sugar_cane' } });
def({ id: B.FARMLAND, name: 'farmland', label: '耕地', hardness: 0.6, tool: 'shovel', opaque: true, tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' }, drop: 'dirt' });
def({ id: B.FARMLAND_WET, name: 'farmland_wet', label: '湿った耕地', hardness: 0.6, tool: 'shovel', opaque: true, tex: { top: 'farmland_wet', side: 'dirt', bottom: 'dirt' }, drop: 'dirt' });

for (let stage = 0; stage < 4; stage++) {
  def({ id: B.WHEAT_0 + stage, name: `wheat_${stage}`, label: '小麦', render: 'cross', hardness: 0.05, tex: { all: `wheat_${stage}` }, drop: null });
  def({ id: B.CARROTS_0 + stage, name: `carrots_${stage}`, label: 'ニンジン', render: 'cross', hardness: 0.05, tex: { all: `carrots_${stage}` }, drop: null });
  def({ id: B.POTATOES_0 + stage, name: `potatoes_${stage}`, label: 'ジャガイモ', render: 'cross', hardness: 0.05, tex: { all: `potatoes_${stage}` }, drop: null });
}

def({ id: B.DIRT_PATH, name: 'dirt_path', label: '土の道', hardness: 0.6, tool: 'shovel', tex: { top: 'dirt_path_top', side: 'dirt', bottom: 'dirt' }, drop: 'dirt' });
def({ id: B.STONE_BRICKS, name: 'stone_bricks', label: '石レンガ', hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' } });
def({ id: B.WOOL, name: 'wool', label: '羊毛', hardness: 0.8, tex: { all: 'wool' } });
def({ id: B.BOOKSHELF, name: 'bookshelf', label: '本棚', hardness: 1.5, tool: 'axe', tex: { top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks' } });
def({ id: B.MOSSY_COBBLESTONE, name: 'mossy_cobblestone', label: '苔石', hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'mossy_cobblestone' } });

// --- water works -------------------------------------------------------------
def({ id: B.SPRING, name: 'spring', label: '水源', hardness: 3, tool: 'pickaxe', tier: 1, tex: { top: 'spring_top', side: 'spring_side', bottom: 'stone' } });
def({ id: B.PUMP, name: 'pump', label: 'ポンプ', hardness: 3, tool: 'pickaxe', tier: 1, tex: { top: 'pump_top', side: 'pump_side', bottom: 'pump_top' } });
def({ id: B.DRAIN, name: 'drain', label: '排水口', hardness: 3, tool: 'pickaxe', tier: 1, tex: { top: 'drain_top', side: 'pump_side', bottom: 'pump_side' } });
def({ id: B.FLOODGATE_CLOSED, name: 'floodgate_closed', label: '水門', hardness: 3, tool: 'pickaxe', tier: 1, tex: { all: 'floodgate_closed' }, drop: 'floodgate' });
// The open gate lets water and entities straight through, so it is neither solid nor
// opaque; only its frame is drawn.
def({ id: B.FLOODGATE_OPEN, name: 'floodgate_open', label: '水門（開）', hardness: 3, tool: 'pickaxe', tier: 1, solid: false, opaque: false, replaceable: false, tex: { all: 'floodgate_open' }, drop: 'floodgate' });

// --- architectural shapes ---------------------------------------------------
// Direction names say where the high edge is. These cells are deliberately not opaque:
// a slope or a round post does not cover a complete voxel face, so light and adjacent
// cube faces must be allowed through the unused part of the cell.
def({ id: B.STONE_ROOF_EAST, name: 'stone_roof_east', label: '石レンガ屋根（東上がり）', shape: 'slope_east', opaque: false, hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' }, drop: 'stone_bricks' });
def({ id: B.STONE_ROOF_WEST, name: 'stone_roof_west', label: '石レンガ屋根（西上がり）', shape: 'slope_west', opaque: false, hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' }, drop: 'stone_bricks' });
def({ id: B.STONE_ROOF_SOUTH, name: 'stone_roof_south', label: '石レンガ屋根（南上がり）', shape: 'slope_south', opaque: false, hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' }, drop: 'stone_bricks' });
def({ id: B.STONE_ROOF_NORTH, name: 'stone_roof_north', label: '石レンガ屋根（北上がり）', shape: 'slope_north', opaque: false, hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' }, drop: 'stone_bricks' });
def({ id: B.STONE_COLUMN, name: 'stone_column', label: '石レンガの円柱', shape: 'cylinder', opaque: false, hardness: 2, tool: 'pickaxe', tier: 1, tex: { all: 'stone_bricks' }, drop: 'stone_bricks' });
def({ id: B.WOOD_COLUMN, name: 'wood_column', label: '木の円柱', shape: 'cylinder', opaque: false, hardness: 2, tool: 'axe', tex: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' }, drop: 'oak_log' });

for (let i = 0; i < DEFS.length; i++) {
  if (!DEFS[i]) throw new Error(`block id ${i} has no definition`);
}

export const BLOCKS: readonly BlockDef[] = DEFS;
export const AIR_DEF = DEFS[Block.AIR];

const BY_NAME = new Map<string, BlockDef>(DEFS.map((d) => [d.name, d]));

export function blockDef(id: BlockId): BlockDef {
  return DEFS[id] ?? AIR_DEF;
}

export function blockByName(name: string): BlockDef | undefined {
  return BY_NAME.get(name);
}

export function isSolid(id: BlockId): boolean {
  return blockDef(id).solid;
}

export function isOpaque(id: BlockId): boolean {
  return blockDef(id).opaque;
}

export function isAir(id: BlockId): boolean {
  return id === Block.AIR;
}

export function isReplaceable(id: BlockId): boolean {
  return blockDef(id).replaceable;
}

export function lightFilter(id: BlockId): number {
  const d = blockDef(id);
  return d.opaque ? 15 : d.filter;
}

/** Crop growth stages, keyed by the block id of stage 0. */
export const CROPS = [
  { base: Block.WHEAT_0, stages: 4, seed: 'wheat_seeds', harvest: 'wheat', bonus: 'wheat_seeds' },
  { base: Block.CARROTS_0, stages: 4, seed: 'carrot', harvest: 'carrot', bonus: null },
  { base: Block.POTATOES_0, stages: 4, seed: 'potato', harvest: 'potato', bonus: null },
] as const;

export function cropAt(id: BlockId): { base: BlockId; stage: number; stages: number; harvest: string; bonus: string | null } | null {
  for (const crop of CROPS) {
    if (id >= crop.base && id < crop.base + crop.stages) {
      return { base: crop.base, stage: id - crop.base, stages: crop.stages, harvest: crop.harvest, bonus: crop.bonus };
    }
  }
  return null;
}

/** Blocks that swallow any water flowing into them. */
export function isWaterSink(id: BlockId): boolean {
  return id === Block.DRAIN;
}

/** Blocks water cannot pass through, which is what makes dams and levees work. */
export function blocksWater(id: BlockId): boolean {
  const def = blockDef(id);
  if (id === Block.WATER || id === Block.AIR) return false;
  if (id === Block.FLOODGATE_OPEN) return false;
  if (id === Block.DRAIN) return false;
  // Plants and crops are washed through rather than holding water back.
  return def.render !== 'cross';
}

export function isFarmland(id: BlockId): boolean {
  return id === Block.FARMLAND || id === Block.FARMLAND_WET;
}

/** Blocks that a plant/crop can be planted on. */
export function supportsPlant(id: BlockId): boolean {
  return id === Block.GRASS || id === Block.DIRT || isFarmland(id);
}
