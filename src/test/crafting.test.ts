import { describe, expect, it } from 'vitest';
import {
  RECIPES,
  canCraft,
  craft,
  craftAll,
  craftableCount,
  recipesFor,
} from '../game/crafting';
import { Inventory } from '../game/inventory';
import { itemDef } from '../game/items';

function inventoryWith(...stacks: [string, number][]): Inventory {
  const inv = new Inventory(36);
  for (const [id, count] of stacks) inv.add({ id, count });
  return inv;
}

describe('crafting', () => {
  it('every recipe produces and consumes real items', () => {
    for (const recipe of RECIPES) {
      expect(itemDef(recipe.result.id), recipe.id).toBeDefined();
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      for (const ingredient of recipe.ingredients) {
        expect(itemDef(ingredient.id), `${recipe.id} needs ${ingredient.id}`).toBeDefined();
        expect(ingredient.count).toBeGreaterThan(0);
      }
    }
  });

  it('has no duplicate recipe ids', () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only offers the hand recipes without a crafting table', () => {
    const hand = recipesFor('hand');
    const table = recipesFor('table');
    expect(hand.length).toBeGreaterThan(0);
    expect(table.length).toBe(RECIPES.length);
    expect(hand.every((r) => r.station === 'hand')).toBe(true);
    // The table itself must be reachable bare handed or the game deadlocks.
    expect(hand.some((r) => r.result.id === 'crafting_table')).toBe(true);
    expect(hand.some((r) => r.result.id === 'oak_planks')).toBe(true);
  });

  it('pulls ingredients out of the inventory wherever they are', () => {
    const inv = inventoryWith(['oak_log', 1]);
    const planks = RECIPES.find((r) => r.result.id === 'oak_planks');
    expect(planks).toBeDefined();
    if (!planks) return;
    expect(craft(inv, planks)).toBe(true);
    expect(inv.count('oak_log')).toBe(0);
    expect(inv.count('oak_planks')).toBe(4);
  });

  it('refuses to craft without the materials and changes nothing', () => {
    const inv = inventoryWith(['cobblestone', 2], ['stick', 2]);
    const pickaxe = RECIPES.find((r) => r.result.id === 'stone_pickaxe');
    expect(pickaxe).toBeDefined();
    if (!pickaxe) return;
    expect(canCraft(inv, pickaxe)).toBe(false);
    expect(craft(inv, pickaxe)).toBe(false);
    expect(inv.count('cobblestone')).toBe(2);
    expect(inv.count('stick')).toBe(2);
  });

  it('crafts a stone pickaxe from loose materials', () => {
    const inv = inventoryWith(['cobblestone', 3], ['stick', 2]);
    const pickaxe = RECIPES.find((r) => r.result.id === 'stone_pickaxe');
    expect(pickaxe).toBeDefined();
    if (!pickaxe) return;
    expect(craft(inv, pickaxe)).toBe(true);
    expect(inv.count('stone_pickaxe')).toBe(1);
    expect(inv.count('cobblestone')).toBe(0);
    expect(inv.count('stick')).toBe(0);
  });

  it('reports and crafts the maximum a shift-click would make', () => {
    const inv = inventoryWith(['oak_log', 7]);
    const planks = RECIPES.find((r) => r.result.id === 'oak_planks');
    expect(planks).toBeDefined();
    if (!planks) return;
    expect(craftableCount(inv, planks)).toBe(7);
    expect(craftAll(inv, planks)).toBe(7);
    expect(inv.count('oak_planks')).toBe(28);
    expect(inv.count('oak_log')).toBe(0);
  });

  it('will not consume materials when the result has nowhere to go', () => {
    const inv = new Inventory(1);
    inv.add({ id: 'oak_log', count: 1 });
    const planks = RECIPES.find((r) => r.result.id === 'oak_planks');
    expect(planks).toBeDefined();
    if (!planks) return;
    expect(canCraft(inv, planks)).toBe(false);
    expect(craft(inv, planks)).toBe(false);
    expect(inv.count('oak_log')).toBe(1);
  });

  it('keeps every tier of tool and both armour sets craftable', () => {
    for (const tier of ['wooden', 'stone', 'iron', 'diamond']) {
      for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
        expect(RECIPES.some((r) => r.result.id === `${tier}_${kind}`), `${tier}_${kind}`).toBe(true);
      }
    }
    for (const set of ['leather', 'iron']) {
      for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) {
        expect(RECIPES.some((r) => r.result.id === `${set}_${piece}`), `${set}_${piece}`).toBe(true);
      }
    }
  });
});
