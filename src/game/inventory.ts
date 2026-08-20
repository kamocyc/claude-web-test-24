import { itemDef } from './items';

export interface ItemStack {
  id: string;
  count: number;
}

export function stack(id: string, count = 1): ItemStack {
  return { id, count };
}

export function maxStackOf(id: string): number {
  return itemDef(id)?.maxStack ?? 64;
}

export function sameItem(a: ItemStack | null, b: ItemStack | null): boolean {
  return a !== null && b !== null && a.id === b.id;
}

/** A fixed array of slots. Used for the player inventory, chests, furnaces and
 *  crafting grids alike so the UI can drive all of them with the same code. */
export class Inventory {
  readonly slots: (ItemStack | null)[];

  constructor(readonly size: number) {
    this.slots = new Array<ItemStack | null>(size).fill(null);
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, value: ItemStack | null): void {
    if (index < 0 || index >= this.size) return;
    this.slots[index] = value && value.count > 0 ? value : null;
  }

  clear(): void {
    this.slots.fill(null);
  }

  isEmpty(): boolean {
    return this.slots.every((s) => s === null);
  }

  /** Total number of a given item across every slot. */
  count(id: string): number {
    let total = 0;
    for (const slot of this.slots) if (slot?.id === id) total += slot.count;
    return total;
  }

  has(id: string, amount = 1): boolean {
    return this.count(id) >= amount;
  }

  /** Adds a stack, filling partial stacks first. Returns the amount that did not fit. */
  add(input: ItemStack): number {
    let remaining = input.count;
    const max = maxStackOf(input.id);
    for (let i = 0; i < this.size && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== input.id || slot.count >= max) continue;
      const room = max - slot.count;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    for (let i = 0; i < this.size && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(max, remaining);
      this.slots[i] = { id: input.id, count: moved };
      remaining -= moved;
    }
    return remaining;
  }

  /** Like `add`, but restricted to a slot range. Used for shift-clicking between the
   *  hotbar and the backpack rows. */
  addWithin(input: ItemStack, from: number, count: number): number {
    let remaining = input.count;
    const max = maxStackOf(input.id);
    const end = Math.min(this.size, from + count);
    for (let i = from; i < end && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== input.id || slot.count >= max) continue;
      const moved = Math.min(max - slot.count, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    for (let i = from; i < end && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(max, remaining);
      this.slots[i] = { id: input.id, count: moved };
      remaining -= moved;
    }
    return remaining;
  }

  /** Removes up to `amount` of an item. Returns how many were actually removed. */
  remove(id: string, amount = 1): number {
    let remaining = amount;
    for (let i = 0; i < this.size && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== id) continue;
      const taken = Math.min(slot.count, remaining);
      slot.count -= taken;
      remaining -= taken;
      if (slot.count <= 0) this.slots[i] = null;
    }
    return amount - remaining;
  }

  /** Decrements one slot by one, used when placing a block or eating. */
  consumeAt(index: number, amount = 1): void {
    const slot = this.slots[index];
    if (!slot) return;
    slot.count -= amount;
    if (slot.count <= 0) this.slots[index] = null;
  }

  /** Index of the first slot holding the item, or -1. */
  find(id: string): number {
    return this.slots.findIndex((s) => s?.id === id);
  }

  firstEmpty(): number {
    return this.slots.findIndex((s) => s === null);
  }

  toJSON(): ([string, number] | null)[] {
    return this.slots.map((s) => (s ? [s.id, s.count] : null));
  }

  loadJSON(data: ([string, number] | null)[] | undefined): void {
    if (!data) return;
    for (let i = 0; i < this.size; i++) {
      const entry = data[i];
      this.slots[i] = entry && itemDef(entry[0]) ? { id: entry[0], count: entry[1] } : null;
    }
  }
}

export const HOTBAR_SIZE = 9;
export const MAIN_ROWS = 3;
export const MAIN_SIZE = HOTBAR_SIZE * MAIN_ROWS;

/** Player storage: hotbar first (so slot index matches the on-screen bar), then the
 *  three backpack rows, plus four armour slots kept separately. */
export class PlayerInventory extends Inventory {
  readonly armor = new Inventory(4);
  selected = 0;

  constructor() {
    super(HOTBAR_SIZE + MAIN_SIZE);
  }

  get held(): ItemStack | null {
    return this.get(this.selected);
  }

  consumeHeld(amount = 1): void {
    this.consumeAt(this.selected, amount);
  }

  /** Sum of the defense points of everything worn. */
  get defense(): number {
    let total = 0;
    for (const slot of this.armor.slots) {
      if (!slot) continue;
      total += itemDef(slot.id)?.armor?.defense ?? 0;
    }
    return total;
  }
}

/** Moves a stack between two slots, merging when the items match. Returns the stack
 *  that is left on the cursor. */
export function mergeStacks(cursor: ItemStack | null, target: ItemStack | null): {
  cursor: ItemStack | null;
  target: ItemStack | null;
} {
  if (!cursor) return { cursor: target, target: null };
  if (!target) return { cursor: null, target: cursor };
  if (cursor.id !== target.id) return { cursor: target, target: cursor };
  const max = maxStackOf(cursor.id);
  const moved = Math.min(max - target.count, cursor.count);
  if (moved <= 0) return { cursor: target, target: cursor };
  return {
    cursor: cursor.count - moved > 0 ? { id: cursor.id, count: cursor.count - moved } : null,
    target: { id: target.id, count: target.count + moved },
  };
}

/** Right-click behaviour: drop one item, or pick up half a stack. */
export function splitStacks(cursor: ItemStack | null, target: ItemStack | null): {
  cursor: ItemStack | null;
  target: ItemStack | null;
} {
  if (cursor) {
    if (target && target.id !== cursor.id) return { cursor, target };
    const max = maxStackOf(cursor.id);
    if (target && target.count >= max) return { cursor, target };
    return {
      cursor: cursor.count - 1 > 0 ? { id: cursor.id, count: cursor.count - 1 } : null,
      target: target ? { id: target.id, count: target.count + 1 } : { id: cursor.id, count: 1 },
    };
  }
  if (!target) return { cursor: null, target: null };
  const half = Math.ceil(target.count / 2);
  return {
    cursor: { id: target.id, count: half },
    target: target.count - half > 0 ? { id: target.id, count: target.count - half } : null,
  };
}
