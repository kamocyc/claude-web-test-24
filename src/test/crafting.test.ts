import { describe, expect, it } from 'vitest';
import { consumeGrid, craftingResult } from '../game/crafting';
import type { ItemStack } from '../game/inventory';

function grid(size: number, cells: Record<number, string>): (ItemStack | null)[] {
  const out = new Array<ItemStack | null>(size * size).fill(null);
  for (const [index, id] of Object.entries(cells)) out[Number(index)] = { id, count: 1 };
  return out;
}

describe('crafting', () => {
  it('matches a shapeless recipe regardless of slot', () => {
    expect(craftingResult(grid(2, { 3: 'oak_log' }), 2)).toEqual({ id: 'oak_planks', count: 4 });
  });

  it('matches a shaped recipe anywhere in the grid', () => {
    // Two planks stacked vertically make sticks, wherever they sit.
    expect(craftingResult(grid(3, { 0: 'oak_planks', 3: 'oak_planks' }), 3)).toEqual({ id: 'stick', count: 4 });
    expect(craftingResult(grid(3, { 5: 'oak_planks', 8: 'oak_planks' }), 3)).toEqual({ id: 'stick', count: 4 });
  });

  it('rejects a shape that does not line up', () => {
    expect(craftingResult(grid(3, { 0: 'oak_planks', 4: 'oak_planks' }), 3)).toBeNull();
  });

  it('crafts a wooden pickaxe only on a 3x3 grid', () => {
    const cells = { 0: 'oak_planks', 1: 'oak_planks', 2: 'oak_planks', 4: 'stick', 7: 'stick' };
    expect(craftingResult(grid(3, cells), 3)).toEqual({ id: 'wooden_pickaxe', count: 1 });
    expect(craftingResult(grid(2, { 0: 'oak_planks', 1: 'oak_planks', 2: 'stick' }), 2)).toBeNull();
  });

  it('crafts a crafting table from four planks in the 2x2 grid', () => {
    const cells = { 0: 'oak_planks', 1: 'oak_planks', 2: 'oak_planks', 3: 'oak_planks' };
    expect(craftingResult(grid(2, cells), 2)).toEqual({ id: 'crafting_table', count: 1 });
  });

  it('accepts both mirrored axe layouts', () => {
    const right = { 0: 'oak_planks', 1: 'oak_planks', 3: 'oak_planks', 4: 'stick', 7: 'stick' };
    const left = { 0: 'oak_planks', 1: 'oak_planks', 3: 'stick', 4: 'oak_planks', 6: 'stick' };
    expect(craftingResult(grid(3, right), 3)).toEqual({ id: 'wooden_axe', count: 1 });
    expect(craftingResult(grid(3, left), 3)).toEqual({ id: 'wooden_axe', count: 1 });
  });

  it('crafts food and armour', () => {
    expect(craftingResult(grid(3, { 0: 'wheat', 1: 'wheat', 2: 'wheat' }), 3)).toEqual({ id: 'bread', count: 1 });
    const helmet = { 0: 'iron_ingot', 1: 'iron_ingot', 2: 'iron_ingot', 3: 'iron_ingot', 5: 'iron_ingot' };
    expect(craftingResult(grid(3, helmet), 3)).toEqual({ id: 'iron_helmet', count: 1 });
  });

  it('consumes one of every ingredient', () => {
    const cells = grid(2, { 0: 'oak_planks', 1: 'oak_planks', 2: 'oak_planks', 3: 'oak_planks' });
    cells[0]!.count = 3;
    consumeGrid(cells);
    expect(cells[0]).toEqual({ id: 'oak_planks', count: 2 });
    expect(cells[1]).toBeNull();
  });

  it('returns nothing for an empty grid', () => {
    expect(craftingResult(grid(3, {}), 3)).toBeNull();
  });
});
