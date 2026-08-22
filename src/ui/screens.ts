import type { Recipe } from '../game/crafting';
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
import { Container, renderSlot } from './containers';
import { RecipePanel } from './recipePanel';
import { refreshLedger, type LedgerView } from './ledger';
import { refreshHelp, type HelpView } from './help';
import { clear, el } from './dom';

export type ScreenKind = 'inventory' | 'crafting' | 'furnace' | 'chest' | 'trade' | 'ledger' | 'help';

/** One tutorial step, rendered above a villager's offers. */
export interface QuestRow {
  kind: 'accept' | 'deliver' | 'learn';
  label: string;
  detail: string;
  ready: boolean;
  run(): void;
}

interface OpenScreen {
  kind: ScreenKind;
  container: Container;
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
    private readonly onCrafted: (recipe: Recipe, made: number) => void = () => {},
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
    const container = new Container({
      title: '持ち物',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onChanged: () => container.refresh(),
    });
    const panel = new RecipePanel(this.player.inventory, 'hand', this.atlas, this.onCrafted);

    const top = el('div', 'panel-row');
    const armor = el('div', 'sub-panel');
    top.append(armor, panel.root);
    container.addSection(top);
    armor.appendChild(
      container.addGrid(this.player.inventory.armor, 0, 4, 1, {
        label: '防具',
        armorSlots: [...ARMOR_SLOTS],
      }),
    );
    this.addPlayerInventory(container);

    this.mount({
      kind: 'inventory',
      container,
      refresh: () => {
        container.refresh();
        panel.refresh();
      },
    });
  }

  openCraftingTable(): void {
    const container = new Container({
      title: '作業台',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      onChanged: () => container.refresh(),
    });
    const panel = new RecipePanel(this.player.inventory, 'table', this.atlas, this.onCrafted);
    container.addSection(panel.root);
    this.addPlayerInventory(container);

    this.mount({
      kind: 'crafting',
      container,
      refresh: () => {
        container.refresh();
        panel.refresh();
      },
    });
  }

  openFurnace(furnace: FurnaceEntity): void {
    const container = new Container({
      title: 'かまど',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
      storage: furnace.slots,
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
      storage: chest,
      onChanged: () => container.refresh(),
    });
    container.addGrid(chest, 0, chest.size, 9, { label: '収納' });
    this.addPlayerInventory(container);
    this.mount({ kind: 'chest', container, refresh: () => container.refresh() });
  }

  /** The whole network on one page. The view is re-read on every refresh rather than
   *  captured, so stock and porters tick along while the player reads it. */
  openLedger(view: () => LedgerView): void {
    const container = new Container({
      title: '交易台帳',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
    });
    const host = el('div', 'ledger-host');
    container.addSection(host);
    // Every screen is refreshed once a frame. A page of rows is far too much DOM to
    // rebuild at that rate, and nothing on it moves fast enough to be worth it, so it is
    // re-read a couple of times a second and only redrawn when something actually said
    // something different.
    let checked = 0;
    let signature = '';
    this.mount({
      kind: 'ledger',
      container,
      refresh: () => {
        const now = performance.now();
        if (now - checked < 400) return;
        checked = now;
        const data = view();
        const next = JSON.stringify(data);
        if (next === signature) return;
        signature = next;
        refreshLedger(host, data);
      },
    });
  }

  /** The manual. Most of it never changes, but the tutorial step and the goals do, so it
   *  is re-read on the same throttle as the ledger rather than frozen at open. */
  openHelp(view: () => HelpView): void {
    const container = new Container({
      title: '遊びかた',
      atlas: this.atlas,
      playerInventory: this.player.inventory,
    });
    const host = el('div', 'help-host');
    container.addSection(host);
    let checked = 0;
    let signature = '';
    this.mount({
      kind: 'help',
      container,
      refresh: () => {
        const now = performance.now();
        if (now - checked < 400) return;
        checked = now;
        const data = view();
        const next = JSON.stringify(data);
        if (next === signature) return;
        signature = next;
        refreshHelp(host, data);
      },
    });
  }

  /** `quest` adds one row above the offers: the tutorial's "carry this there" and "hand
   *  it over" both happen through the same widget the player already knows. */
  openTrade(villager: Mob, onTraded: () => void, quest?: QuestRow, note?: string): void {
    const container = new Container({
      title: `${professionLabel(villager.profession ?? 'villager')}との取引`,
      atlas: this.atlas,
      playerInventory: this.player.inventory,
    });
    const list = el('div', 'trade-list');
    // What the village itself is short of. Said here because this is where the player is
    // standing when it becomes useful to know.
    if (note) container.addSection(el('div', 'trade-note', note));
    container.addSection(list);
    this.addPlayerInventory(container);

    let questButton: HTMLButtonElement | null = null;
    if (quest) {
      const row = el('div', 'trade-row quest-row');
      const text = el('div', 'quest-text');
      text.append(el('div', 'quest-label', quest.label), el('div', 'quest-detail', quest.detail));
      questButton = el('button', 'trade-button quest-button', quest.kind === 'learn' ? '聞く' : '引き受ける');
      if (quest.kind === 'deliver') questButton.textContent = '納める';
      questButton.addEventListener('click', () => {
        quest.run();
        this.close();
      });
      row.append(text, questButton);
      list.appendChild(row);
    }

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
      refresh: () => {
        container.refresh();
        if (questButton && quest) {
          questButton.disabled = !quest.ready;
          // A greyed-out button with no reason is a dead end; say what is missing.
          questButton.title = quest.ready ? '' : quest.detail;
        }
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
