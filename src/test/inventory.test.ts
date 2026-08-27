import { describe, expect, it } from 'vitest';
import { Inventory, PlayerInventory, mergeStacks, splitStacks } from '../game/inventory';

describe('Inventory', () => {
  it('fills partial stacks before using empty slots', () => {
    const inv = new Inventory(3);
    inv.set(0, { id: 'cobblestone', count: 60 });
    expect(inv.add({ id: 'cobblestone', count: 10 })).toBe(0);
    expect(inv.get(0)).toEqual({ id: 'cobblestone', count: 64 });
    expect(inv.get(1)).toEqual({ id: 'cobblestone', count: 6 });
  });

  it('reports what did not fit', () => {
    const inv = new Inventory(1);
    expect(inv.add({ id: 'dirt', count: 100 })).toBe(36);
    expect(inv.get(0)).toEqual({ id: 'dirt', count: 64 });
  });

  it('respects per-item stack limits', () => {
    const inv = new Inventory(4);
    inv.add({ id: 'iron_pickaxe', count: 3 });
    expect(inv.get(0)).toEqual({ id: 'iron_pickaxe', count: 1 });
    expect(inv.get(2)).toEqual({ id: 'iron_pickaxe', count: 1 });
  });

  it('removes across several stacks', () => {
    const inv = new Inventory(3);
    inv.add({ id: 'wheat', count: 70 });
    expect(inv.remove('wheat', 68)).toBe(68);
    expect(inv.count('wheat')).toBe(2);
    expect(inv.remove('wheat', 10)).toBe(2);
    expect(inv.isEmpty()).toBe(true);
  });

  it('round-trips through JSON', () => {
    const inv = new Inventory(5);
    inv.add({ id: 'diamond', count: 4 });
    const copy = new Inventory(5);
    copy.loadJSON(inv.toJSON());
    expect(copy.get(0)).toEqual({ id: 'diamond', count: 4 });
  });

  it('adds only within a slot range', () => {
    const inv = new Inventory(6);
    expect(inv.addWithin({ id: 'coal', count: 3 }, 3, 3)).toBe(0);
    expect(inv.get(0)).toBeNull();
    expect(inv.get(3)).toEqual({ id: 'coal', count: 3 });
    expect(inv.addWithin({ id: 'coal', count: 200 }, 3, 3)).toBe(200 - (61 + 64 + 64));
  });

  it('drops unknown items when loading', () => {
    const inv = new Inventory(2);
    inv.loadJSON([['not_a_real_item', 3], ['coal', 2]]);
    expect(inv.get(0)).toBeNull();
    expect(inv.get(1)).toEqual({ id: 'coal', count: 2 });
  });
});

describe('PlayerInventory', () => {
  it('sums armour defense', () => {
    const inv = new PlayerInventory();
    expect(inv.defense).toBe(0);
    inv.armor.set(0, { id: 'iron_helmet', count: 1 });
    inv.armor.set(1, { id: 'iron_chestplate', count: 1 });
    expect(inv.defense).toBe(8);
  });

  it('tracks the held item through the hotbar selection', () => {
    const inv = new PlayerInventory();
    inv.set(2, { id: 'torch', count: 5 });
    inv.selected = 2;
    expect(inv.held).toEqual({ id: 'torch', count: 5 });
    inv.consumeHeld();
    expect(inv.held).toEqual({ id: 'torch', count: 4 });
  });
});

describe('stack drag and drop', () => {
  it('merges matching stacks and swaps different ones', () => {
    expect(mergeStacks({ id: 'dirt', count: 10 }, { id: 'dirt', count: 5 })).toEqual({
      cursor: null,
      target: { id: 'dirt', count: 15 },
    });
    expect(mergeStacks({ id: 'dirt', count: 1 }, { id: 'stone', count: 1 })).toEqual({
      cursor: { id: 'stone', count: 1 },
      target: { id: 'dirt', count: 1 },
    });
  });

  it('leaves the overflow on the cursor', () => {
    const result = mergeStacks({ id: 'dirt', count: 10 }, { id: 'dirt', count: 60 });
    expect(result.target).toEqual({ id: 'dirt', count: 64 });
    expect(result.cursor).toEqual({ id: 'dirt', count: 6 });
  });

  it('splits a stack in half on right click and places one at a time', () => {
    expect(splitStacks(null, { id: 'coal', count: 7 })).toEqual({
      cursor: { id: 'coal', count: 4 },
      target: { id: 'coal', count: 3 },
    });
    expect(splitStacks({ id: 'coal', count: 4 }, null)).toEqual({
      cursor: { id: 'coal', count: 3 },
      target: { id: 'coal', count: 1 },
    });
  });
});

describe('the debug mode where nothing runs out', () => {
  it('leaves stacks alone when they are spent', () => {
    const inv = new PlayerInventory();
    inv.set(0, { id: 'rail', count: 4 });
    inv.unlimited = true;
    expect(inv.remove('rail', 3)).toBe(3);
    expect(inv.get(0)).toEqual({ id: 'rail', count: 4 });
    inv.consumeAt(0, 2);
    expect(inv.get(0)).toEqual({ id: 'rail', count: 4 });
    inv.selected = 0;
    inv.consumeHeld();
    expect(inv.get(0)).toEqual({ id: 'rail', count: 4 });
  });

  it('can supply what it is not even carrying, which is the point of it', () => {
    const inv = new PlayerInventory();
    expect(inv.has('rail', 40)).toBe(false);
    expect(inv.remove('rail', 40)).toBe(0);
    inv.unlimited = true;
    expect(inv.has('rail', 40)).toBe(true);
    expect(inv.remove('rail', 40)).toBe(40);
  });

  it('still says truthfully what is in the pockets', () => {
    const inv = new PlayerInventory();
    inv.unlimited = true;
    expect(inv.count('wool')).toBe(0);
    inv.add({ id: 'wool', count: 5 });
    // A count that answered Infinity would tick off "deliver five wool" for a player
    // carrying none, so the mode promises free, not omniscient.
    expect(inv.count('wool')).toBe(5);
  });

  it('goes back to spending things when it is turned off', () => {
    const inv = new PlayerInventory();
    inv.set(0, { id: 'rail', count: 4 });
    inv.unlimited = true;
    inv.remove('rail', 4);
    inv.unlimited = false;
    expect(inv.remove('rail', 4)).toBe(4);
    expect(inv.get(0)).toBeNull();
    expect(inv.has('rail')).toBe(false);
  });
});
