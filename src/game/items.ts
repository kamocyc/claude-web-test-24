import { Block, type BlockId, blockDef } from '../world/blocks';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';
export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots';

export interface ToolStats {
  kind: ToolKind;
  /** 1 wood, 2 stone, 3 iron, 4 diamond. Blocks require a minimum tier to drop. */
  tier: number;
  /** Multiplier applied to mining speed for matching blocks. */
  speed: number;
}

export interface FoodStats {
  /** Hunger points restored, out of 20. */
  hunger: number;
  saturation: number;
}

export interface ItemDef {
  id: string;
  label: string;
  maxStack: number;
  /** Texture tile name in the atlas. */
  tex: string;
  /** Block placed when used on a surface. */
  placesBlock?: BlockId;
  /** Crop planted on farmland. */
  plantsCrop?: BlockId;
  tool?: ToolStats;
  /** Damage dealt when hitting an entity. */
  attack?: number;
  food?: FoodStats;
  armor?: { slot: ArmorSlot; defense: number };
  /** Seconds of furnace burn time. */
  fuel?: number;
  /** Item produced by smelting this one. */
  smeltsTo?: string;
}

const ITEMS = new Map<string, ItemDef>();

function item(def: Omit<ItemDef, 'maxStack'> & { maxStack?: number }): ItemDef {
  const full: ItemDef = { maxStack: 64, ...def };
  ITEMS.set(full.id, full);
  return full;
}

/** Creates the item form of a block, reusing the block's own texture for the icon. */
function blockItem(id: string, block: BlockId, extra: Partial<ItemDef> = {}): ItemDef {
  const def = blockDef(block);
  const tex = def.tex.side ?? def.tex.all ?? def.tex.top ?? 'stone';
  return item({ id, label: def.label, tex, placesBlock: block, ...extra });
}

// --- placeable blocks --------------------------------------------------------
blockItem('stone', Block.STONE);
blockItem('dirt', Block.DIRT);
blockItem('grass', Block.GRASS);
blockItem('cobblestone', Block.COBBLESTONE);
blockItem('sand', Block.SAND, { smeltsTo: 'glass' });
blockItem('sandstone', Block.SANDSTONE);
blockItem('gravel', Block.GRAVEL);
blockItem('oak_log', Block.OAK_LOG, { fuel: 15 });
blockItem('oak_planks', Block.OAK_PLANKS, { fuel: 15 });
blockItem('oak_leaves', Block.OAK_LEAVES);
blockItem('glass', Block.GLASS);
blockItem('crafting_table', Block.CRAFTING_TABLE, { fuel: 15 });
blockItem('furnace', Block.FURNACE);
blockItem('chest', Block.CHEST, { fuel: 15 });
blockItem('torch', Block.TORCH);
blockItem('snow', Block.SNOW);
blockItem('ice', Block.ICE);
blockItem('cactus', Block.CACTUS);
blockItem('wool', Block.WOOL);
blockItem('stone_bricks', Block.STONE_BRICKS);
blockItem('bookshelf', Block.BOOKSHELF, { fuel: 15 });
blockItem('mossy_cobblestone', Block.MOSSY_COBBLESTONE);
blockItem('sugar_cane', Block.SUGAR_CANE);
blockItem('flower_red', Block.FLOWER_RED);
blockItem('flower_yellow', Block.FLOWER_YELLOW);
blockItem('iron_ore', Block.IRON_ORE, { smeltsTo: 'iron_ingot' });
blockItem('spring', Block.SPRING);
blockItem('pump', Block.PUMP);
blockItem('drain', Block.DRAIN);
// One item for both states of the gate; it is placed closed and toggled in place.
blockItem('floodgate', Block.FLOODGATE_CLOSED);
blockItem('gold_ore', Block.GOLD_ORE, { smeltsTo: 'gold_ingot' });

// Cobblestone smelts back into smooth stone.
ITEMS.get('cobblestone')!.smeltsTo = 'stone';

// --- water handling ----------------------------------------------------------
item({ id: 'bucket', label: 'バケツ', tex: 'bucket', maxStack: 16 });
item({ id: 'water_bucket', label: '水入りバケツ', tex: 'water_bucket', maxStack: 1 });
item({ id: 'boat', label: 'ボート', tex: 'boat', maxStack: 1 });

// --- materials ---------------------------------------------------------------
item({ id: 'stick', label: '棒', tex: 'stick', fuel: 5 });
item({ id: 'coal', label: '石炭', tex: 'coal', fuel: 80 });
item({ id: 'iron_ingot', label: '鉄インゴット', tex: 'iron_ingot' });
// Track, by the length rather than by the block. It is not placed: it is what the track
// tool spends as it draws a curve, so it never had a right side up to be laid.
item({ id: 'rail', label: 'レール', tex: 'rail_top' });
item({ id: 'gold_ingot', label: '金インゴット', tex: 'gold_ingot' });
item({ id: 'diamond', label: 'ダイヤモンド', tex: 'diamond' });
item({ id: 'emerald', label: 'エメラルド', tex: 'emerald' });
item({ id: 'leather', label: '革', tex: 'leather' });
item({ id: 'feather', label: '羽', tex: 'feather' });

// --- food & farming ----------------------------------------------------------
item({ id: 'wheat_seeds', label: '種', tex: 'wheat_seeds', plantsCrop: Block.WHEAT_0 });
item({ id: 'wheat', label: '小麦', tex: 'wheat_item' });
item({ id: 'bread', label: 'パン', tex: 'bread', food: { hunger: 5, saturation: 6 } });
item({ id: 'apple', label: 'リンゴ', tex: 'apple', food: { hunger: 4, saturation: 2.4 } });
item({ id: 'carrot', label: 'ニンジン', tex: 'carrot', food: { hunger: 3, saturation: 3.6 }, plantsCrop: Block.CARROTS_0 });
item({ id: 'potato', label: 'ジャガイモ', tex: 'potato', food: { hunger: 1, saturation: 0.6 }, plantsCrop: Block.POTATOES_0, smeltsTo: 'baked_potato' });
item({ id: 'baked_potato', label: 'ベイクドポテト', tex: 'baked_potato', food: { hunger: 5, saturation: 6 } });
item({ id: 'raw_beef', label: '生の牛肉', tex: 'raw_beef', food: { hunger: 3, saturation: 1.8 }, smeltsTo: 'cooked_beef' });
item({ id: 'cooked_beef', label: 'ステーキ', tex: 'cooked_beef', food: { hunger: 8, saturation: 12.8 } });
item({ id: 'raw_porkchop', label: '生の豚肉', tex: 'raw_porkchop', food: { hunger: 3, saturation: 1.8 }, smeltsTo: 'cooked_porkchop' });
item({ id: 'cooked_porkchop', label: '焼き豚', tex: 'cooked_porkchop', food: { hunger: 8, saturation: 12.8 } });
item({ id: 'raw_chicken', label: '生の鶏肉', tex: 'raw_chicken', food: { hunger: 2, saturation: 1.2 }, smeltsTo: 'cooked_chicken' });
item({ id: 'cooked_chicken', label: '焼き鳥', tex: 'cooked_chicken', food: { hunger: 6, saturation: 7.2 } });
item({ id: 'raw_mutton', label: '生の羊肉', tex: 'raw_mutton', food: { hunger: 2, saturation: 1.2 }, smeltsTo: 'cooked_mutton' });
item({ id: 'cooked_mutton', label: '焼き羊肉', tex: 'cooked_mutton', food: { hunger: 6, saturation: 9.6 } });

// --- tools -------------------------------------------------------------------
export const TIERS = [
  { name: 'wooden', label: '木の', tier: 1, speed: 2, attack: 1, material: 'oak_planks' },
  { name: 'stone', label: '石の', tier: 2, speed: 4, attack: 2, material: 'cobblestone' },
  { name: 'iron', label: '鉄の', tier: 3, speed: 6, attack: 3, material: 'iron_ingot' },
  { name: 'diamond', label: 'ダイヤの', tier: 4, speed: 8, attack: 4, material: 'diamond' },
] as const;

const TOOL_LABELS: Record<ToolKind, string> = {
  pickaxe: 'ツルハシ',
  axe: '斧',
  shovel: 'シャベル',
  hoe: 'クワ',
  sword: '剣',
};

for (const tier of TIERS) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const) {
    const isSword = kind === 'sword';
    item({
      id: `${tier.name}_${kind}`,
      label: `${tier.label}${TOOL_LABELS[kind]}`,
      tex: `${kind}_${tier.name}`,
      maxStack: 1,
      tool: { kind, tier: tier.tier, speed: tier.speed },
      attack: isSword ? 3 + tier.attack : 1 + Math.floor(tier.attack / 2),
      ...(tier.name === 'wooden' ? { fuel: 10 } : {}),
    });
  }
}

// The free-form track tool. Deliberately not given `tool` stats: it has no tier and mines
// nothing, and a ToolStats here would put it in the running whenever auto-tool swaps the
// hotbar — which would take it out of the player's hand halfway through laying a curve.
item({ id: 'track_tool', label: '線路敷設ツール', tex: 'track_tool', maxStack: 1 });

// The station. Not a block either, for the same reason the rail is not one: it stands on
// the end of a curve, and a curve does not pass through the middle of anybody's block. It
// is put down by pointing at an end of the line and clicking - see `useStation` in
// `game.ts` - and taken back by pointing at the station and clicking again.
item({ id: 'station', label: '駅', tex: 'station', maxStack: 16 });

// The stop. Not a block: it marks a *place a line calls at*, which is a fact about the
// network and not about the ground. Put down by pointing at the ground and clicking, and
// taken back the same way - see `useStop` in `game.ts`. Every leg of every line runs
// between two of these, on foot exactly as by train.
item({ id: 'stop', label: '停留所', tex: 'stop', maxStack: 16 });

// The industry kit. Surveys what is under and around where the player is standing and
// builds whatever the ground supports - see `useIndustryKit` in `game.ts`. Not stacked
// deep: siting one is a decision, and a pocketful would make it a habit.
item({ id: 'industry_kit', label: '産業設置具', tex: 'industry_kit', maxStack: 4 });

// The signal. Aimed at the rails like the station, and put down anywhere along them: a
// signal that could only go where a curve happened to end would be a signal the player
// has to build their railway around. Pointing at the middle of a run cuts it there first
// - see `useSignal` in `game.ts`.
item({ id: 'signal', label: '信号機', tex: 'signal', maxStack: 16 });

// --- armour ------------------------------------------------------------------
const ARMOR_LABELS: Record<ArmorSlot, string> = {
  helmet: 'ヘルメット',
  chestplate: 'チェストプレート',
  leggings: 'レギンス',
  boots: 'ブーツ',
};

const ARMOR_SETS = [
  { name: 'leather', label: '革の', material: 'leather', defense: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 } },
  { name: 'iron', label: '鉄の', material: 'iron_ingot', defense: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 } },
] as const;

export const ARMOR_SLOTS: readonly ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots'];

for (const set of ARMOR_SETS) {
  for (const slot of ARMOR_SLOTS) {
    item({
      id: `${set.name}_${slot}`,
      label: `${set.label}${ARMOR_LABELS[slot]}`,
      tex: `${slot}_${set.name}`,
      maxStack: 1,
      armor: { slot, defense: set.defense[slot] },
    });
  }
}

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS.get(id);
}

export function requireItem(id: string): ItemDef {
  const def = ITEMS.get(id);
  if (!def) throw new Error(`unknown item: ${id}`);
  return def;
}

export function allItems(): ItemDef[] {
  return [...ITEMS.values()];
}

export function itemLabel(id: string): string {
  return ITEMS.get(id)?.label ?? id;
}

/** Item id that a given block should turn into when placed from the hotbar. */
export function itemForBlock(block: BlockId): string | undefined {
  for (const def of ITEMS.values()) {
    if (def.placesBlock === block) return def.id;
  }
  return undefined;
}

export const ARMOR_SET_NAMES = ARMOR_SETS.map((s) => s.name);
