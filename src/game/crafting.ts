import { Inventory, type ItemStack } from './inventory';
import { itemLabel, TIERS } from './items';

/** Where a recipe can be made. Everything basic enough to need in the field is
 *  available bare handed; the rest is unlocked by standing at a crafting table. */
export type Station = 'hand' | 'table';

export type RecipeCategory = 'basics' | 'blocks' | 'tools' | 'armor' | 'water' | 'food';

export interface Ingredient {
  id: string;
  count: number;
}

export interface Recipe {
  /** Stable identifier, used as the DOM key of a row and in saves of nothing else. */
  id: string;
  result: ItemStack;
  ingredients: Ingredient[];
  station: Station;
  category: RecipeCategory;
}

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  basics: '基本',
  blocks: '建材',
  tools: '道具',
  armor: '防具',
  water: '水利',
  food: '食料',
};

export const RECIPES: Recipe[] = [];

function recipe(
  category: RecipeCategory,
  station: Station,
  result: ItemStack,
  ingredients: Ingredient[],
): void {
  // Two recipes can share a result (there is only one per result today, but tools
  // repeat per tier), so the id carries the ingredients as well.
  const id = `${result.id}:${ingredients.map((i) => `${i.id}x${i.count}`).join('+')}`;
  RECIPES.push({ id, result, ingredients, station, category });
}

// --- basics ------------------------------------------------------------------
recipe('basics', 'hand', { id: 'oak_planks', count: 4 }, [{ id: 'oak_log', count: 1 }]);
recipe('basics', 'hand', { id: 'stick', count: 4 }, [{ id: 'oak_planks', count: 2 }]);
recipe('basics', 'hand', { id: 'crafting_table', count: 1 }, [{ id: 'oak_planks', count: 4 }]);
recipe('basics', 'hand', { id: 'torch', count: 4 }, [
  { id: 'coal', count: 1 },
  { id: 'stick', count: 1 },
]);
recipe('basics', 'table', { id: 'furnace', count: 1 }, [{ id: 'cobblestone', count: 8 }]);
recipe('basics', 'table', { id: 'chest', count: 1 }, [{ id: 'oak_planks', count: 8 }]);

// --- building blocks ----------------------------------------------------------
recipe('blocks', 'table', { id: 'stone_bricks', count: 4 }, [{ id: 'stone', count: 4 }]);
recipe('blocks', 'table', { id: 'sandstone', count: 1 }, [{ id: 'sand', count: 4 }]);
// Sixteen at a time, because a line worth running a train down is hundreds of blocks long
// and a recipe that made rail a per-click decision would make it a chore rather than a
// project. Sixteen is thirty-two blocks of curve — see `railsFor`. The iron is the point:
// laying a railway is a reason to freight iron.
recipe('basics', 'table', { id: 'rail', count: 16 }, [
  { id: 'iron_ingot', count: 6 },
  { id: 'oak_planks', count: 2 },
]);

// A stop is the cheapest thing on this list on purpose. Nothing moves at all until the
// player has put two down, so pricing it as an achievement would be pricing the tutorial:
// a post, a sign and something to pave under it, out of what anybody has in the first
// minute. Two at a time, because two is the fewest that does anything.
recipe('basics', 'table', { id: 'stop', count: 2 }, [
  { id: 'oak_planks', count: 4 },
  { id: 'cobblestone', count: 2 },
]);

// The industry kit costs iron, which is the whole point of where it sits: siting a
// colliery is the thing that makes iron freightable, and the first one therefore has to be
// paid for out of ore the player dug themselves. One at a time - a pocketful would make
// siting one a habit rather than a decision.
recipe('basics', 'table', { id: 'industry_kit', count: 1 }, [
  { id: 'iron_ingot', count: 2 },
  { id: 'oak_planks', count: 4 },
]);

// A station is two of them - one for each end of the line - so it is priced as half of
// what a player will actually pay. Timber for the platform and its roof, iron for the
// fittings: a cost, but nothing beside the rail a line of any length eats, because the
// thing that should be expensive about a railway is the railway.
recipe('basics', 'table', { id: 'station', count: 1 }, [
  { id: 'oak_planks', count: 6 },
  { id: 'iron_ingot', count: 1 },
]);

// Cheaper than a station, because a line wants more of them than it wants stations and
// the answer to a jam is usually one more. Iron for the lamp and its arm, timber for the
// post: the same two materials the rest of the railway is made of, so a player who can
// build track can build a signal without going looking for anything new.
recipe('basics', 'table', { id: 'signal', count: 2 }, [
  { id: 'iron_ingot', count: 2 },
  { id: 'oak_planks', count: 2 },
]);

// Iron for the head and sticks for the handle, priced like a tool rather than like track:
// what the player pays per block of curve is the rail it eats as they lay it.
recipe('tools', 'table', { id: 'track_tool', count: 1 }, [
  { id: 'iron_ingot', count: 3 },
  { id: 'stick', count: 2 },
]);

// --- food ---------------------------------------------------------------------
recipe('food', 'hand', { id: 'bread', count: 1 }, [{ id: 'wheat', count: 3 }]);

// --- water works --------------------------------------------------------------
recipe('water', 'table', { id: 'bucket', count: 1 }, [{ id: 'iron_ingot', count: 3 }]);
// Planks and nothing else: a boat has to be buildable on the shore of whatever river the
// player has walked to, with the wood that is standing behind them.
recipe('water', 'hand', { id: 'boat', count: 1 }, [{ id: 'oak_planks', count: 5 }]);
recipe('water', 'table', { id: 'floodgate', count: 2 }, [
  { id: 'oak_planks', count: 6 },
  { id: 'iron_ingot', count: 3 },
]);
recipe('water', 'table', { id: 'pump', count: 1 }, [
  { id: 'iron_ingot', count: 4 },
  { id: 'cobblestone', count: 1 },
]);
recipe('water', 'table', { id: 'drain', count: 1 }, [
  { id: 'cobblestone', count: 7 },
  { id: 'iron_ingot', count: 1 },
]);

// --- tools, one set per material ---------------------------------------------
for (const tier of TIERS) {
  const head = (count: number): Ingredient => ({ id: tier.material, count });
  const handle = (count: number): Ingredient => ({ id: 'stick', count });
  recipe('tools', 'table', { id: `${tier.name}_pickaxe`, count: 1 }, [head(3), handle(2)]);
  recipe('tools', 'table', { id: `${tier.name}_axe`, count: 1 }, [head(3), handle(2)]);
  recipe('tools', 'table', { id: `${tier.name}_shovel`, count: 1 }, [head(1), handle(2)]);
  recipe('tools', 'table', { id: `${tier.name}_hoe`, count: 1 }, [head(2), handle(2)]);
  recipe('tools', 'table', { id: `${tier.name}_sword`, count: 1 }, [head(2), handle(1)]);
}

// --- armour -------------------------------------------------------------------
for (const set of [
  { name: 'leather', material: 'leather' },
  { name: 'iron', material: 'iron_ingot' },
]) {
  const piece = (count: number): Ingredient[] => [{ id: set.material, count }];
  recipe('armor', 'table', { id: `${set.name}_helmet`, count: 1 }, piece(5));
  recipe('armor', 'table', { id: `${set.name}_chestplate`, count: 1 }, piece(8));
  recipe('armor', 'table', { id: `${set.name}_leggings`, count: 1 }, piece(7));
  recipe('armor', 'table', { id: `${set.name}_boots`, count: 1 }, piece(4));
}

/** Recipes a station can make. A crafting table can make everything, so the list a
 *  player sees only ever grows. */
export function recipesFor(station: Station): Recipe[] {
  return station === 'table' ? RECIPES : RECIPES.filter((r) => r.station === 'hand');
}

export function findRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** How many times a recipe could be made from what is in the inventory, ignoring
 *  whether the results would fit. */
export function craftableCount(inventory: Inventory, recipe: Recipe): number {
  let times = Infinity;
  for (const ingredient of recipe.ingredients) {
    times = Math.min(times, Math.floor(inventory.count(ingredient.id) / ingredient.count));
  }
  return Number.isFinite(times) ? times : 0;
}

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  return craftableCount(inventory, recipe) > 0 && inventory.roomFor(recipe.result.id) >= recipe.result.count;
}

/** Takes the ingredients out of the inventory and puts the result in. Returns false
 *  and changes nothing when the materials or the space are not there. */
export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) return false;
  for (const ingredient of recipe.ingredients) inventory.remove(ingredient.id, ingredient.count);
  inventory.add({ ...recipe.result });
  return true;
}

/** Crafts as many as the materials and the free space allow. Returns how many were
 *  made, which is what a shift-click reports back to the player. */
export function craftAll(inventory: Inventory, recipe: Recipe, limit = 512): number {
  let made = 0;
  while (made < limit && craft(inventory, recipe)) made++;
  return made;
}

/** Ingredients written out for the tooltip and the recipe row. */
export function ingredientSummary(inventory: Inventory, recipe: Recipe): string {
  return recipe.ingredients
    .map((i) => `${itemLabel(i.id)} ${inventory.count(i.id)}/${i.count}`)
    .join('、');
}
