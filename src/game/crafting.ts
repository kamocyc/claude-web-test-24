import type { ItemStack } from './inventory';
import { TIERS } from './items';

export interface ShapedRecipe {
  type: 'shaped';
  /** Rows of single-character keys; a space means "must be empty". */
  pattern: string[];
  keys: Record<string, string>;
  result: ItemStack;
}

export interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: string[];
  result: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

export const RECIPES: Recipe[] = [];

function shaped(pattern: string[], keys: Record<string, string>, result: ItemStack): void {
  RECIPES.push({ type: 'shaped', pattern, keys, result });
}

function shapeless(ingredients: string[], result: ItemStack): void {
  RECIPES.push({ type: 'shapeless', ingredients, result });
}

// --- basics ------------------------------------------------------------------
shapeless(['oak_log'], { id: 'oak_planks', count: 4 });
shaped(['P', 'P'], { P: 'oak_planks' }, { id: 'stick', count: 4 });
shaped(['PP', 'PP'], { P: 'oak_planks' }, { id: 'crafting_table', count: 1 });
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, { id: 'furnace', count: 1 });
shaped(['PPP', 'P P', 'PPP'], { P: 'oak_planks' }, { id: 'chest', count: 1 });
shaped(['C', 'S'], { C: 'coal', S: 'stick' }, { id: 'torch', count: 4 });
shaped(['SS', 'SS'], { S: 'stone' }, { id: 'stone_bricks', count: 4 });
shaped(['SS', 'SS'], { S: 'sand' }, { id: 'sandstone', count: 1 });
shaped(['WWW'], { W: 'wheat' }, { id: 'bread', count: 1 });

// --- tools, one set per material ---------------------------------------------
for (const tier of TIERS) {
  const keys = { M: tier.material, S: 'stick' };
  shaped(['MMM', ' S ', ' S '], keys, { id: `${tier.name}_pickaxe`, count: 1 });
  shaped(['MM', 'MS', ' S'], keys, { id: `${tier.name}_axe`, count: 1 });
  shaped(['MM', 'SM', 'S '], keys, { id: `${tier.name}_axe`, count: 1 });
  shaped(['M', 'S', 'S'], keys, { id: `${tier.name}_shovel`, count: 1 });
  shaped(['MM', ' S', ' S'], keys, { id: `${tier.name}_hoe`, count: 1 });
  shaped(['MM', 'S ', 'S '], keys, { id: `${tier.name}_hoe`, count: 1 });
  shaped(['M', 'M', 'S'], keys, { id: `${tier.name}_sword`, count: 1 });
}

// --- armour -------------------------------------------------------------------
for (const set of [
  { name: 'leather', material: 'leather' },
  { name: 'iron', material: 'iron_ingot' },
]) {
  const keys = { M: set.material };
  shaped(['MMM', 'M M'], keys, { id: `${set.name}_helmet`, count: 1 });
  shaped(['M M', 'MMM', 'MMM'], keys, { id: `${set.name}_chestplate`, count: 1 });
  shaped(['MMM', 'M M', 'M M'], keys, { id: `${set.name}_leggings`, count: 1 });
  shaped(['M M', 'M M'], keys, { id: `${set.name}_boots`, count: 1 });
}

interface Bounds {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

/** Smallest rectangle containing every filled cell, or null when the grid is empty. */
function boundsOf(grid: (ItemStack | null)[], size: number): Bounds | null {
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!grid[y * size + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function matchesShaped(recipe: ShapedRecipe, grid: (ItemStack | null)[], size: number): boolean {
  const bounds = boundsOf(grid, size);
  if (!bounds) return false;
  const height = recipe.pattern.length;
  const width = Math.max(...recipe.pattern.map((row) => row.length));
  if (bounds.width !== width || bounds.height !== height) return false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = recipe.pattern[y][x] ?? ' ';
      const cell = grid[(bounds.y0 + y) * size + (bounds.x0 + x)];
      if (key === ' ') {
        if (cell) return false;
      } else {
        const expected = recipe.keys[key];
        if (!cell || cell.id !== expected) return false;
      }
    }
  }
  return true;
}

function matchesShapeless(recipe: ShapelessRecipe, grid: (ItemStack | null)[]): boolean {
  const present = grid.filter((c): c is ItemStack => c !== null).map((c) => c.id);
  if (present.length !== recipe.ingredients.length) return false;
  const pool = [...recipe.ingredients];
  for (const id of present) {
    const index = pool.indexOf(id);
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return pool.length === 0;
}

/** Finds what a crafting grid produces. `size` is 2 for the inventory grid and 3 for
 *  a crafting table; recipes larger than the grid simply never match. */
export function findRecipe(grid: (ItemStack | null)[], size: number): Recipe | null {
  for (const recipe of RECIPES) {
    if (recipe.type === 'shaped') {
      const height = recipe.pattern.length;
      const width = Math.max(...recipe.pattern.map((row) => row.length));
      if (width > size || height > size) continue;
      if (matchesShaped(recipe, grid, size)) return recipe;
    } else if (matchesShapeless(recipe, grid)) {
      return recipe;
    }
  }
  return null;
}

export function craftingResult(grid: (ItemStack | null)[], size: number): ItemStack | null {
  const recipe = findRecipe(grid, size);
  return recipe ? { ...recipe.result } : null;
}

/** Removes one of each ingredient after a craft. */
export function consumeGrid(grid: (ItemStack | null)[]): void {
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    if (!cell) continue;
    cell.count -= 1;
    if (cell.count <= 0) grid[i] = null;
  }
}
