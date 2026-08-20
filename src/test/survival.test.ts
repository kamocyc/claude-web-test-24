import { describe, expect, it } from 'vitest';
import { Hunger, MAX_FOOD } from '../game/hunger';
import { applyDamage, applyKnockback, armorReduction, fallDamage } from '../game/combat';
import { tickFurnace, createFurnace, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, SMELT_SECONDS } from '../game/smelting';

function target(health = 20) {
  return { health, maxHealth: 20, hurtCooldown: 0, vx: 0, vy: 0, vz: 0 };
}

describe('hunger', () => {
  it('burns saturation before food', () => {
    const hunger = new Hunger();
    hunger.addExhaustion(4);
    expect(hunger.food).toBe(MAX_FOOD);
    expect(hunger.saturation).toBe(4);
  });

  it('drains food once saturation is gone', () => {
    const hunger = new Hunger();
    hunger.addExhaustion(4 * 10);
    expect(hunger.saturation).toBe(0);
    expect(hunger.food).toBe(MAX_FOOD - 5);
  });

  it('regenerates health while well fed', () => {
    const hunger = new Hunger();
    const result = hunger.update(4, 10, 20);
    expect(result.heal).toBe(1);
    expect(result.damage).toBe(0);
  });

  it('starves when food hits zero', () => {
    const hunger = new Hunger();
    hunger.food = 0;
    expect(hunger.update(5, 20, 20).damage).toBe(1);
  });

  it('caps saturation at the food level when eating', () => {
    const hunger = new Hunger();
    hunger.food = 10;
    hunger.saturation = 0;
    hunger.eat(4, 20);
    expect(hunger.food).toBe(14);
    expect(hunger.saturation).toBe(14);
  });
});

describe('combat', () => {
  it('reduces damage with armour, capped at 80%', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(5)).toBeCloseTo(0.2);
    expect(armorReduction(50)).toBe(0.8);
  });

  it('honours the invulnerability window', () => {
    const victim = target();
    expect(applyDamage(victim, 4).applied).toBe(true);
    expect(applyDamage(victim, 4).applied).toBe(false);
    victim.hurtCooldown = 0;
    expect(applyDamage(victim, 4).applied).toBe(true);
    expect(victim.health).toBe(12);
  });

  it('reports death', () => {
    const victim = target(3);
    expect(applyDamage(victim, 5).dead).toBe(true);
    expect(victim.health).toBe(0);
  });

  it('pushes the victim away from the attacker', () => {
    const victim = target();
    applyKnockback(victim, 0, 0, 3, 0);
    expect(victim.vx).toBeGreaterThan(0);
    expect(victim.vy).toBeGreaterThan(0);
  });

  it('only hurts on falls longer than three blocks', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(8)).toBe(5);
  });
});

describe('furnace', () => {
  it('burns fuel to smelt an item', () => {
    const furnace = createFurnace();
    furnace.slots.set(FURNACE_INPUT, { id: 'iron_ore', count: 2 });
    furnace.slots.set(FURNACE_FUEL, { id: 'coal', count: 1 });
    for (let i = 0; i < SMELT_SECONDS * 2; i++) tickFurnace(furnace, 0.5);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toEqual({ id: 'iron_ingot', count: 1 });
    expect(furnace.slots.get(FURNACE_INPUT)).toEqual({ id: 'iron_ore', count: 1 });
    expect(furnace.slots.get(FURNACE_FUEL)).toBeNull();
  });

  it('does nothing without fuel', () => {
    const furnace = createFurnace();
    furnace.slots.set(FURNACE_INPUT, { id: 'raw_beef', count: 1 });
    for (let i = 0; i < 40; i++) tickFurnace(furnace, 0.5);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toBeNull();
  });

  it('refuses items that cannot be smelted', () => {
    const furnace = createFurnace();
    furnace.slots.set(FURNACE_INPUT, { id: 'diamond', count: 1 });
    furnace.slots.set(FURNACE_FUEL, { id: 'coal', count: 1 });
    for (let i = 0; i < 40; i++) tickFurnace(furnace, 0.5);
    expect(furnace.slots.get(FURNACE_OUTPUT)).toBeNull();
    expect(furnace.slots.get(FURNACE_FUEL)).toEqual({ id: 'coal', count: 1 });
  });
});
