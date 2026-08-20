import type { Player } from '../game/player';
import { itemDef, itemLabel } from '../game/items';
import type { Atlas } from '../render/textures';
import { HOTBAR_SIZE } from '../game/inventory';
import { clear, el } from './dom';
import { renderSlot } from './containers';

export interface DebugInfo {
  fps: number;
  chunks: number;
  pending: number;
  biome: string;
  clock: string;
  mobs: number;
}

/** Health, hunger, hotbar, crosshair and the debug overlay. */
export class Hud {
  readonly root = el('div', 'hud');
  private readonly hearts = el('div', 'stat-row hearts');
  private readonly food = el('div', 'stat-row food');
  private readonly hotbar = el('div', 'hotbar');
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly heldLabel = el('div', 'held-label');
  private readonly debug = el('pre', 'debug');
  private readonly toasts = el('div', 'toasts');
  private readonly flash = el('div', 'damage-flash');
  private readonly clickPrompt = el('div', 'click-prompt', 'クリックしてプレイ');
  private readonly underwater = el('div', 'underwater');
  private debugVisible = false;
  private heldLabelTimer = 0;

  constructor(private readonly atlas: Atlas) {
    const crosshair = el('div', 'crosshair');
    const stats = el('div', 'stats');
    stats.append(this.hearts, this.food);
    const bottom = el('div', 'bottom');
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = el('div', 'slot hotbar-slot');
      this.hotbarSlots.push(slot);
      this.hotbar.appendChild(slot);
    }
    bottom.append(this.heldLabel, stats, this.hotbar);
    this.root.append(this.underwater, this.flash, crosshair, bottom, this.debug, this.toasts, this.clickPrompt);
    this.underwater.style.display = 'none';
    this.clickPrompt.style.display = 'none';
    this.debug.style.display = 'none';
  }

  /** Blue tint while the camera is submerged. */
  setUnderwater(active: boolean): void {
    this.underwater.style.display = active ? '' : 'none';
  }

  /** Shown until the player clicks, because pointer lock needs a user gesture. */
  setClickPrompt(visible: boolean): void {
    this.clickPrompt.style.display = visible ? '' : 'none';
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debug.style.display = this.debugVisible ? '' : 'none';
  }

  /** Called when the selected hotbar slot changes, to show the item name briefly. */
  showHeldItem(id: string | null): void {
    this.heldLabel.textContent = id ? itemLabel(id) : '';
    this.heldLabel.style.opacity = id ? '1' : '0';
    this.heldLabelTimer = 2;
  }

  toast(message: string): void {
    const node = el('div', 'toast', message);
    this.toasts.appendChild(node);
    window.setTimeout(() => node.classList.add('fade'), 1600);
    window.setTimeout(() => node.remove(), 2400);
  }

  flashDamage(): void {
    this.flash.classList.remove('active');
    // Force a reflow so the animation restarts on consecutive hits.
    void this.flash.offsetWidth;
    this.flash.classList.add('active');
  }

  update(dt: number, player: Player, info: DebugInfo): void {
    this.renderBar(this.hearts, player.health, player.maxHealth, 'heart');
    this.renderBar(this.food, player.hunger.food, 20, 'drumstick');

    for (let i = 0; i < this.hotbarSlots.length; i++) {
      const slot = this.hotbarSlots[i];
      slot.classList.toggle('selected', i === player.inventory.selected);
      renderSlot(slot, player.inventory.get(i), this.atlas);
    }

    if (this.heldLabelTimer > 0) {
      this.heldLabelTimer -= dt;
      if (this.heldLabelTimer <= 0) this.heldLabel.style.opacity = '0';
    }

    if (this.debugVisible) {
      const held = player.inventory.held;
      this.debug.textContent = [
        `FPS ${info.fps.toFixed(0)}`,
        `XYZ ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}`,
        `バイオーム ${info.biome}`,
        `時刻 ${info.clock}`,
        `チャンク ${info.chunks} (生成待ち ${info.pending})`,
        `モブ ${info.mobs}`,
        `手持ち ${held ? `${itemDef(held.id)?.label ?? held.id} x${held.count}` : 'なし'}`,
      ].join('\n');
    }
  }

  /** Draws a row of half-step icons, the way hearts and hunger work. */
  private renderBar(row: HTMLElement, value: number, max: number, kind: string): void {
    const total = Math.ceil(max / 2);
    if (row.childElementCount !== total) {
      clear(row);
      for (let i = 0; i < total; i++) row.appendChild(el('div', `icon ${kind}`));
    }
    for (let i = 0; i < total; i++) {
      const icon = row.children[i] as HTMLElement;
      const filled = value >= (i + 1) * 2;
      const half = !filled && value > i * 2;
      icon.classList.toggle('full', filled);
      icon.classList.toggle('half', half);
      icon.classList.toggle('empty', !filled && !half);
    }
  }
}
