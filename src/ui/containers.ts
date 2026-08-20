import { itemDef, itemLabel } from '../game/items';
import {
  HOTBAR_SIZE,
  Inventory,
  type ItemStack,
  mergeStacks,
  splitStacks,
} from '../game/inventory';
import type { Atlas } from '../render/textures';
import { clear, el } from './dom';

/** Anything that can back a grid of slots. */
export interface SlotSource {
  readonly size: number;
  get(index: number): ItemStack | null;
  set(index: number, value: ItemStack | null): void;
}

/** Adapter so a plain array (a crafting grid) can be used like an Inventory. */
export class ArraySlots implements SlotSource {
  constructor(readonly cells: (ItemStack | null)[]) {}

  get size(): number {
    return this.cells.length;
  }

  get(index: number): ItemStack | null {
    return this.cells[index] ?? null;
  }

  set(index: number, value: ItemStack | null): void {
    this.cells[index] = value && value.count > 0 ? value : null;
  }
}

interface SlotBinding {
  element: HTMLElement;
  source: SlotSource;
  index: number;
  /** Result slots can only be taken from, and taking consumes the recipe. */
  result: boolean;
  /** Slots that only accept a matching armour piece. */
  armorSlot?: string;
}

export interface ContainerOptions {
  title: string;
  atlas: Atlas;
  /** Where shift-clicked items go, and where the crafting grid is emptied to. */
  playerInventory: Inventory;
  /** The other container on screen (chest, furnace); shift-click moves between the two. */
  storage?: Inventory;
  onResultTaken?: () => void;
  onChanged?: () => void;
}

/** A screen made of slot grids, with pick-up/put-down handling shared by the
 *  inventory, crafting table, furnace, chest and trading UIs. */
export class Container {
  readonly root = el('div', 'panel');
  readonly body = el('div', 'panel-body');
  private cursor: ItemStack | null = null;
  private readonly cursorEl = el('div', 'cursor-stack');
  private readonly bindings: SlotBinding[] = [];
  private readonly options: ContainerOptions;
  private resultProvider: (() => ItemStack | null) | null = null;

  constructor(options: ContainerOptions) {
    this.options = options;
    const header = el('div', 'panel-title', options.title);
    this.root.append(header, this.body);
    this.cursorEl.style.display = 'none';
    document.body.appendChild(this.cursorEl);
    window.addEventListener('mousemove', (event) => {
      this.cursorEl.style.left = `${event.clientX}px`;
      this.cursorEl.style.top = `${event.clientY}px`;
    });
  }

  /** Builds a labelled grid of slots. */
  addGrid(
    source: SlotSource,
    from: number,
    count: number,
    columns: number,
    options: { label?: string; className?: string; result?: boolean; armorSlots?: string[] } = {},
  ): HTMLElement {
    const wrapper = el('div', `slot-grid ${options.className ?? ''}`);
    if (options.label) wrapper.appendChild(el('div', 'slot-label', options.label));
    const grid = el('div', 'slots');
    grid.style.gridTemplateColumns = `repeat(${columns}, var(--slot))`;
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const slot = el('div', 'slot');
      grid.appendChild(slot);
      const binding: SlotBinding = {
        element: slot,
        source,
        index,
        result: options.result ?? false,
        armorSlot: options.armorSlots?.[i],
      };
      this.bindings.push(binding);
      slot.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.handleClick(binding, event);
      });
    }
    wrapper.appendChild(grid);
    this.body.appendChild(wrapper);
    return wrapper;
  }

  addSection(node: HTMLElement): void {
    this.body.appendChild(node);
  }

  /** Registers the recipe output slot; the provider is polled on every refresh. */
  setResultProvider(provider: () => ItemStack | null): void {
    this.resultProvider = provider;
  }

  private handleClick(binding: SlotBinding, event: MouseEvent): void {
    const right = event.button === 2;
    const shift = event.shiftKey;

    if (binding.result) {
      const result = this.resultProvider?.() ?? null;
      if (!result) return;
      if (shift) {
        // Craft straight into the inventory, repeatedly while the recipe holds.
        let guard = 0;
        while (guard++ < 64) {
          const next = this.resultProvider?.();
          if (!next) break;
          if (this.options.playerInventory.add({ ...next }) !== 0) break;
          this.options.onResultTaken?.();
        }
      } else if (!this.cursor) {
        this.cursor = { ...result };
        this.options.onResultTaken?.();
      } else if (this.cursor.id === result.id) {
        this.cursor.count += result.count;
        this.options.onResultTaken?.();
      }
      this.refresh();
      this.options.onChanged?.();
      return;
    }

    if (shift) {
      const current = binding.source.get(binding.index);
      if (current) {
        const leftover = this.quickMove(binding, current);
        binding.source.set(binding.index, leftover > 0 ? { id: current.id, count: leftover } : null);
      }
      this.refresh();
      this.options.onChanged?.();
      return;
    }

    const target = binding.source.get(binding.index);
    if (binding.armorSlot && this.cursor && itemDef(this.cursor.id)?.armor?.slot !== binding.armorSlot) return;

    const result = right ? splitStacks(this.cursor, target) : mergeStacks(this.cursor, target);
    this.cursor = result.cursor;
    binding.source.set(binding.index, result.target);
    this.refresh();
    this.options.onChanged?.();
  }

  /** Shift-click destination: the other container when one is open, otherwise the
   *  opposite half of the player's own inventory. Returns what did not fit. */
  private quickMove(binding: SlotBinding, stack: ItemStack): number {
    const player = this.options.playerInventory;
    const storage = this.options.storage;
    if (binding.source !== player) {
      return player.add({ ...stack });
    }
    if (storage) return storage.add({ ...stack });
    return binding.index < HOTBAR_SIZE
      ? player.addWithin({ ...stack }, HOTBAR_SIZE, player.size - HOTBAR_SIZE)
      : player.addWithin({ ...stack }, 0, HOTBAR_SIZE);
  }

  refresh(): void {
    for (const binding of this.bindings) {
      const stack = binding.result ? this.resultProvider?.() ?? null : binding.source.get(binding.index);
      renderSlot(binding.element, stack, this.options.atlas);
    }
    if (this.cursor) {
      this.cursorEl.style.display = '';
      renderSlot(this.cursorEl, this.cursor, this.options.atlas);
    } else {
      this.cursorEl.style.display = 'none';
    }
  }

  /** Returns whatever was left on the cursor so the caller can give it back. */
  takeCursor(): ItemStack | null {
    const held = this.cursor;
    this.cursor = null;
    this.cursorEl.style.display = 'none';
    return held;
  }

  dispose(): void {
    this.cursorEl.remove();
    this.root.remove();
  }
}

/** Draws one slot: icon, stack count and tooltip. Skips the work when nothing changed,
 *  because the open screen is refreshed every frame. */
export function renderSlot(element: HTMLElement, stack: ItemStack | null, atlas: Atlas): void {
  const key = stack ? `${stack.id}:${stack.count}` : '';
  if (element.dataset.slot === key) return;
  element.dataset.slot = key;
  clear(element);
  element.title = '';
  if (!stack) return;
  const def = itemDef(stack.id);
  const img = el('img', 'slot-icon');
  img.src = atlas.icon(def?.tex ?? 'stone');
  img.alt = stack.id;
  element.appendChild(img);
  if (stack.count > 1) element.appendChild(el('span', 'slot-count', String(stack.count)));
  element.title = `${itemLabel(stack.id)} x${stack.count}`;
}
