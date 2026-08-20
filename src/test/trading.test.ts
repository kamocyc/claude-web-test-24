import { describe, expect, it } from 'vitest';
import { Inventory } from '../game/inventory';
import { canAfford, generateTrades, performTrade, professionLabel, restockTrades, tradesFromJSON, tradesToJSON } from '../game/trading';

describe('trading', () => {
  it('generates the same offers for the same villager', () => {
    const a = generateTrades(11, 'farmer', 10, 20);
    const b = generateTrades(11, 'farmer', 10, 20);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
  });

  it('gives different professions different offers', () => {
    const farmer = generateTrades(11, 'farmer', 10, 20).map((t) => t.get.id);
    const smith = generateTrades(11, 'blacksmith', 10, 20).map((t) => t.get.id);
    expect(farmer).not.toEqual(smith);
  });

  it('refuses a trade the player cannot pay for', () => {
    const inventory = new Inventory(9);
    const trade = { give: [{ id: 'wheat', count: 5 }], get: { id: 'emerald', count: 1 }, maxUses: 3, uses: 0 };
    expect(canAfford(inventory, trade)).toBe(false);
    expect(performTrade(inventory, trade)).toBe(false);
    expect(trade.uses).toBe(0);
  });

  it('exchanges items and counts the use', () => {
    const inventory = new Inventory(9);
    inventory.add({ id: 'wheat', count: 12 });
    const trade = { give: [{ id: 'wheat', count: 5 }], get: { id: 'emerald', count: 1 }, maxUses: 3, uses: 0 };
    expect(performTrade(inventory, trade)).toBe(true);
    expect(inventory.count('wheat')).toBe(7);
    expect(inventory.count('emerald')).toBe(1);
    expect(trade.uses).toBe(1);
  });

  it('sells out and restocks', () => {
    const inventory = new Inventory(9);
    inventory.add({ id: 'wheat', count: 64 });
    const trade = { give: [{ id: 'wheat', count: 1 }], get: { id: 'emerald', count: 1 }, maxUses: 2, uses: 0 };
    expect(performTrade(inventory, trade)).toBe(true);
    expect(performTrade(inventory, trade)).toBe(true);
    expect(canAfford(inventory, trade)).toBe(false);
    restockTrades([trade]);
    expect(canAfford(inventory, trade)).toBe(true);
  });

  it('round-trips through JSON', () => {
    const trades = generateTrades(5, 'butcher', 1, 2);
    expect(tradesFromJSON(tradesToJSON(trades))).toEqual(trades);
    expect(tradesFromJSON(undefined)).toEqual([]);
  });

  it('labels professions in Japanese', () => {
    expect(professionLabel('librarian')).toBe('司書');
    expect(professionLabel('unknown')).toBe('村人');
  });
});
