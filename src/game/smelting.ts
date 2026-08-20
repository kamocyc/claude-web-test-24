import type { BlockEntity } from '../world/world';
import { Inventory, type ItemStack } from './inventory';
import { itemDef } from './items';

/** Seconds a single item takes to smelt. */
export const SMELT_SECONDS = 8;

export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

export interface FurnaceEntity extends BlockEntity {
  type: 'furnace';
  slots: Inventory;
  /** Seconds of burn left from the current piece of fuel. */
  burnLeft: number;
  /** Burn time of the fuel currently being consumed, for the flame gauge. */
  burnTotal: number;
  /** Seconds the current item has been cooking. */
  cookProgress: number;
}

export function createFurnace(): FurnaceEntity {
  return { type: 'furnace', slots: new Inventory(3), burnLeft: 0, burnTotal: 0, cookProgress: 0 };
}

export function smeltResultOf(input: ItemStack | null): ItemStack | null {
  if (!input) return null;
  const to = itemDef(input.id)?.smeltsTo;
  return to ? { id: to, count: 1 } : null;
}

export function fuelValue(item: ItemStack | null): number {
  if (!item) return 0;
  return itemDef(item.id)?.fuel ?? 0;
}

/** Returns true when the furnace state changed, so the UI can refresh. */
export function tickFurnace(furnace: FurnaceEntity, dt: number): boolean {
  const slots = furnace.slots;
  const input = slots.get(FURNACE_INPUT);
  const output = slots.get(FURNACE_OUTPUT);
  const result = smeltResultOf(input);
  const canOutput =
    result !== null && (output === null || (output.id === result.id && output.count < 64));

  let changed = false;

  if (furnace.burnLeft > 0) {
    furnace.burnLeft = Math.max(0, furnace.burnLeft - dt);
    changed = true;
  }

  if (furnace.burnLeft <= 0 && canOutput) {
    const fuel = slots.get(FURNACE_FUEL);
    const value = fuelValue(fuel);
    if (value > 0) {
      furnace.burnLeft = value;
      furnace.burnTotal = value;
      slots.consumeAt(FURNACE_FUEL);
      changed = true;
    }
  }

  if (furnace.burnLeft > 0 && canOutput) {
    furnace.cookProgress += dt;
    changed = true;
    if (furnace.cookProgress >= SMELT_SECONDS) {
      furnace.cookProgress = 0;
      slots.consumeAt(FURNACE_INPUT);
      if (output) output.count += 1;
      else slots.set(FURNACE_OUTPUT, { ...result! });
    }
  } else if (furnace.cookProgress > 0) {
    furnace.cookProgress = Math.max(0, furnace.cookProgress - dt * 2);
    changed = true;
  }

  return changed;
}

export function isBurning(furnace: FurnaceEntity): boolean {
  return furnace.burnLeft > 0;
}
