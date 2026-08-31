import { Block, type BlockId } from '../blocks';

export const Biome = {
  OCEAN: 0,
  BEACH: 1,
  PLAINS: 2,
  FOREST: 3,
  DESERT: 4,
  MOUNTAINS: 5,
  SNOWY_PLAINS: 6,
  TAIGA: 7,
  SWAMP: 8,
} as const;

export type BiomeId = number;

export interface BiomeDef {
  id: BiomeId;
  name: string;
  label: string;
  /** Top block of the surface column. */
  surface: BlockId;
  /** Blocks directly beneath the surface. */
  filler: BlockId;
  fillerDepth: number;
  /** Which block replaces stone at the bottom of the filler layer (sandstone under sand). */
  underFiller: BlockId | null;
  /** Trees per chunk (fractional values act as probabilities). */
  treeDensity: number;
  treeLog: BlockId;
  treeLeaves: BlockId;
  /** 0..1 chance per column for grass/flowers. */
  grassDensity: number;
  flowerDensity: number;
  cactusDensity: number;
  sugarCaneDensity: number;
  /** Villages may generate here. */
  allowsVillage: boolean;
}

const DEFS: BiomeDef[] = [];

function def(d: BiomeDef): void {
  DEFS[d.id] = d;
}

def({
  id: Biome.OCEAN, name: 'ocean', label: '海',
  surface: Block.SAND, filler: Block.SAND, fillerDepth: 3, underFiller: null,
  treeDensity: 0, treeLog: Block.OAK_LOG, treeLeaves: Block.OAK_LEAVES,
  grassDensity: 0, flowerDensity: 0, cactusDensity: 0, sugarCaneDensity: 0, allowsVillage: false,
});
def({
  id: Biome.BEACH, name: 'beach', label: '砂浜',
  surface: Block.SAND, filler: Block.SAND, fillerDepth: 4, underFiller: Block.SANDSTONE,
  treeDensity: 0, treeLog: Block.OAK_LOG, treeLeaves: Block.OAK_LEAVES,
  grassDensity: 0, flowerDensity: 0, cactusDensity: 0, sugarCaneDensity: 0.03, allowsVillage: false,
});
def({
  id: Biome.PLAINS, name: 'plains', label: '平原',
  surface: Block.GRASS, filler: Block.DIRT, fillerDepth: 3, underFiller: null,
  treeDensity: 0.7, treeLog: Block.OAK_LOG, treeLeaves: Block.OAK_LEAVES,
  grassDensity: 0.22, flowerDensity: 0.03, cactusDensity: 0, sugarCaneDensity: 0.01, allowsVillage: true,
});
def({
  id: Biome.FOREST, name: 'forest', label: '森林',
  surface: Block.GRASS, filler: Block.DIRT, fillerDepth: 3, underFiller: null,
  treeDensity: 9, treeLog: Block.OAK_LOG, treeLeaves: Block.OAK_LEAVES,
  grassDensity: 0.3, flowerDensity: 0.05, cactusDensity: 0, sugarCaneDensity: 0.01, allowsVillage: false,
});
def({
  id: Biome.DESERT, name: 'desert', label: '砂漠',
  surface: Block.SAND, filler: Block.SAND, fillerDepth: 5, underFiller: Block.SANDSTONE,
  treeDensity: 0, treeLog: Block.OAK_LOG, treeLeaves: Block.OAK_LEAVES,
  grassDensity: 0, flowerDensity: 0, cactusDensity: 0.02, sugarCaneDensity: 0, allowsVillage: true,
});
def({
  id: Biome.MOUNTAINS, name: 'mountains', label: '山岳',
  surface: Block.STONE, filler: Block.STONE, fillerDepth: 2, underFiller: null,
  treeDensity: 0.3, treeLog: Block.SPRUCE_LOG, treeLeaves: Block.SPRUCE_LEAVES,
  grassDensity: 0.05, flowerDensity: 0, cactusDensity: 0, sugarCaneDensity: 0, allowsVillage: false,
});
def({
  id: Biome.SNOWY_PLAINS, name: 'snowy_plains', label: '雪原',
  surface: Block.SNOW, filler: Block.DIRT, fillerDepth: 3, underFiller: null,
  treeDensity: 0.2, treeLog: Block.SPRUCE_LOG, treeLeaves: Block.SPRUCE_LEAVES,
  grassDensity: 0, flowerDensity: 0, cactusDensity: 0, sugarCaneDensity: 0, allowsVillage: true,
});
def({
  id: Biome.TAIGA, name: 'taiga', label: 'タイガ',
  surface: Block.SNOW, filler: Block.DIRT, fillerDepth: 3, underFiller: null,
  treeDensity: 6, treeLog: Block.SPRUCE_LOG, treeLeaves: Block.SPRUCE_LEAVES,
  grassDensity: 0.04, flowerDensity: 0, cactusDensity: 0, sugarCaneDensity: 0, allowsVillage: false,
});
def({
  id: Biome.SWAMP, name: 'swamp', label: '湿地',
  surface: Block.GRASS, filler: Block.DIRT, fillerDepth: 3, underFiller: null,
  treeDensity: 2, treeLog: Block.BIRCH_LOG, treeLeaves: Block.BIRCH_LEAVES,
  grassDensity: 0.35, flowerDensity: 0.02, cactusDensity: 0, sugarCaneDensity: 0.12, allowsVillage: false,
});

for (let i = 0; i < DEFS.length; i++) {
  if (!DEFS[i]) throw new Error(`biome ${i} missing`);
}

export const BIOMES: readonly BiomeDef[] = DEFS;

export function biomeDef(id: BiomeId): BiomeDef {
  return DEFS[id] ?? DEFS[Biome.PLAINS];
}

export interface BiomeParams {
  height: number;
  temperature: number;
  humidity: number;
  seaLevel: number;
  /** How rugged the terrain generator decided this part of the world is, 0..1. The same
   *  number that gated the relief, so it is free to read here. */
  rugged: number;
}

/** Biome is derived from the already-computed height plus climate noise, which keeps
 *  the terrain surface continuous (height never depends on the biome choice). */
export function classifyBiome({
  height,
  temperature,
  humidity,
  seaLevel,
  rugged,
}: BiomeParams): BiomeId {
  if (height < seaLevel - 1) return Biome.OCEAN;
  if (height <= seaLevel + 1) return Biome.BEACH;
  // Mountain is what the ground is doing, not how far up it is. A height rule alone calls
  // a wide high plateau a mountain and paints it bare stone, and misses the rock face at
  // the bottom of the same range — which is the part that actually looks like one. The
  // height floor keeps the foot of a range in grass so a valley still reads as a valley.
  if (rugged > 0.55 && height > seaLevel + 14) return Biome.MOUNTAINS;
  if (height > seaLevel + 46) return Biome.MOUNTAINS;
  if (temperature < -0.58) return humidity > 0.0 ? Biome.TAIGA : Biome.SNOWY_PLAINS;
  if (temperature > 0.25 && humidity < 0.0) return Biome.DESERT;
  if (humidity > 0.35 && temperature > 0.05) return Biome.SWAMP;
  if (humidity > 0.1) return Biome.FOREST;
  return Biome.PLAINS;
}

export function isSnowy(id: BiomeId): boolean {
  return id === Biome.SNOWY_PLAINS || id === Biome.TAIGA;
}
