import { craftingResult, consumeGrid } from '../game/crafting';
import { Inventory, type ItemStack } from '../game/inventory';
import { ARMOR_SLOTS, itemDef, itemLabel } from '../game/items';
import type { Player } from '../game/player';
import {
  FURNACE_FUEL,
  FURNACE_INPUT,
  FURNACE_OUTPUT,
  SMELT_SECONDS,
  type FurnaceEntity,
} from '../game/smelting';
import { canAfford, performTrade, professionLabel, tradeAvailable, type Trade } from '../game/trading';
import type { Mob } from '../game/mobs/ai';
import type { Atlas } from '../render/textures';
import { ArraySlots, Container, renderSlot } from './containers';
import { clear, el } from './dom';

export type ScreenKind = 'inventory' | 'crafting' | 'furnace' | 'chest' | 'trade';

interface OpenScreen {
  kind: ScreenKind;
  container: Container;
  /** Items that must go back to the player when the screen closes. */
  spillGrid: (ItemStack | null)[] | null;
  refresh(): void;
}

/** Creates and tears down the container screens. Only one can be open at a time. */
export class ScreenManager {
  readonly layer = el('div', 'screen-layer');
  private open: OpenScreen | null = null;

  constructor(
    private readonly player: Player,
    private readonly atlas: Atlas,
    private readonly onDrop: (stack: ItemStack) => void,
  ) {
    this.layer.style.display = 'none';
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  get kind(): ScreenKind | null {
    return this.open?.kind ?? null;
  }

  refresh(): void {
    this.open?.refresh();
  }

  close(): void {
    if (!this.open) return;
    const leftover = this.open.container.takeCursor();
    if (leftover) this.give(leftover);
    if (this.open.spillGrid) {
      for (const cell of this.open.spillGrid) if (cell) this.give(cell);
    }
    this.open.container.dispose();
    clear(this.layer);
    this.layer.style.display = 'none';
    this.open = null;
  }

  private give(stack: ItemStack): void {
    const leftover = this.player.inventory.add(stack);
    if (leftover > 0) this.onDrop({ id: stack.id, count: leftover });
  }

  private mount(screen: OpenScreen): void {
    this.close();
    this.open = screen;
    clear(this.layer);
    this.layer.appendChild(screen.container.root);
    this.layer.style.display = '';
    screen.refresh();
  }

  /** Adds the standard 3 rows + hotbar player inventory at the bottom of a screen. */
  private addPlayerInventory(container: Container): void {
    container.addGrid(this.player.inventory, 9, 27, 9, { label: '持ち物' });
    container.addGrid(this.player.inventory, 0, 9, 9, { className: 'hotbar-grid' });
  }

  openInventory(): void {
    const grid: (ItemStack | null)[] = new Array(4).fill(null);
    const slots = new ArraySlots(grid);
    const container = new Container({
      title: '持ち物',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onResultTaken: () => consumeGrid(grid),
      onChanged: () => container.refresh(),
    });
    container.setResultProvider(() => craftingResult(grid, 2));

    const top = el('div', 'panel-row');
    const armor = el('div', 'sub-panel');
    const craft = el('div', 'sub-panel');
    top.append(armor, craft);
    container.addSection(top);
    const armorGrid = container.addGrid(this.player.inventory.armor, 0, 4, 1, {
      label: '防具',
      armorSlots: [...ARMOR_SLOTS],
    });
    armor.appendChild(armorGrid);
    const craftGrid = container.addGrid(slots, 0, 4, 2, { label: 'クラフト 2x2' });
    const resultGrid = container.addGrid(slots, 0, 1, 1, { label: '完成品', result: true, className: 'result' });
    craft.append(craftGrid, resultGrid);
    this.addPlayerInventory(container);

    this.mount({ kind: 'inventory', container, spillGrid: grid, refresh: () => container.refresh() });
  }

  openCraftingTable(): void {
    const grid: (ItemStack | null)[] = new Array(9).fill(null);
    const slots = new ArraySlots(grid);
    const container = new Container({
      title: '作業台',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onResultTaken: () => consumeGrid(grid),
      onChanged: () => container.refresh(),
    });
    container.setResultProvider(() => craftingResult(grid, 3));

    const row = el('div', 'panel-row');
    container.addSection(row);
    row.append(
      container.addGrid(slots, 0, 9, 3, { label: 'クラフト 3x3' }),
      container.addGrid(slots, 0, 1, 1, { label: '完成品', result: true, className: 'result' }),
    );
    this.addPlayerInventory(container);

    this.mount({ kind: 'crafting', container, spillGrid: grid, refresh: () => container.refresh() });
  }

  openFurnace(furnace: FurnaceEntity): void {
    const container = new Container({
      title: 'かまど',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onChanged: () => container.refresh(),
    });
    const row = el('div', 'panel-row furnace');
    container.addSection(row);
    const inputs = el('div', 'sub-panel');
    inputs.append(
      container.addGrid(furnace.slots, FURNACE_INPUT, 1, 1, { label: '素材' }),
      container.addGrid(furnace.slots, FURNACE_FUEL, 1, 1, { label: '燃料' }),
    );
    const gauges = el('div', 'gauges');
    const flame = el('div', 'gauge flame');
    const arrow = el('div', 'gauge progress');
    const flameFill = el('div', 'gauge-fill');
    const arrowFill = el('div', 'gauge-fill');
    flame.appendChild(flameFill);
    arrow.appendChild(arrowFill);
    gauges.append(flame, arrow);
    row.append(inputs, gauges, container.addGrid(furnace.slots, FURNACE_OUTPUT, 1, 1, { label: '完成品' }));
    this.addPlayerInventory(container);

    this.mount({
      kind: 'furnace',
      container,
      spillGrid: null,
      refresh: () => {
        container.refresh();
        const burn = furnace.burnTotal > 0 ? furnace.burnLeft / furnace.burnTotal : 0;
        flameFill.style.height = `${Math.max(0, Math.min(1, burn)) * 100}%`;
        arrowFill.style.width = `${Math.max(0, Math.min(1, furnace.cookProgress / SMELT_SECONDS)) * 100}%`;
      },
    });
  }

  openChest(chest: Inventory): void {
    const container = new Container({
      title: 'チェスト',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onChanged: () => container.refresh(),
    });
    container.addGrid(chest, 0, chest.size, 9, { label: '収納' });
    this.addPlayerInventory(container);
    this.mount({ kind: 'chest', container, spillGrid: null, refresh: () => container.refresh() });
  }

  openTrade(villager: Mob, onTraded: () => void): void {
    const container = new Container({
      title: `${professionLabel(villager.profession ?? 'villager')}との取引`,
      atlas: this.atlas,
      playerInventory: this.player.inventory,
    });
    const list = el('div', 'trade-list');
    container.addSection(list);
    this.addPlayerInventory(container);

    const rows: { node: HTMLElement; trade: Trade; button: HTMLButtonElement }[] = [];
    for (const trade of villager.trades) {
      const row = el('div', 'trade-row');
      const give = el('div', 'trade-side');
      for (const side of trade.give) give.appendChild(this.tradeIcon(side.id, side.count));
      const arrow = el('div', 'trade-arrow', '→');
      const get = el('div', 'trade-side');
      get.appendChild(this.tradeIcon(trade.get.id, trade.get.count));
      const button = el('button', 'trade-button', '取引');
      button.addEventListener('click', () => {
        if (performTrade(this.player.inventory, trade)) onTraded();
        this.refresh();
      });
      row.append(give, arrow, get, button);
      list.appendChild(row);
      rows.push({ node: row, trade, button });
    }
    if (villager.trades.length === 0) list.appendChild(el('div', 'trade-empty', 'この村人は今は取引できません。'));

    this.mount({
      kind: 'trade',
      container,
      spillGrid: null,
      refresh: () => {
        container.refresh();
        for (const row of rows) {
          const affordable = canAfford(this.player.inventory, row.trade);
          row.button.disabled = !affordable;
          row.node.classList.toggle('sold-out', !tradeAvailable(row.trade));
        }
      },
    });
  }

  private tradeIcon(id: string, count: number): HTMLElement {
    const slot = el('div', 'slot small');
    renderSlot(slot, { id, count }, this.atlas);
    slot.title = `${itemLabel(id)} x${count}`;
    if (!itemDef(id)) slot.textContent = id;
    return slot;
  }
}
