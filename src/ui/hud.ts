import { MAX_AIR, type Player } from '../game/player';
import { itemDef, itemLabel } from '../game/items';
import type { Atlas } from '../render/textures';
import { HOTBAR_SIZE } from '../game/inventory';
import { clear, el } from './dom';
import { Compass, type CompassMarker } from './compass';
import { Minimap, type MinimapOverlay } from './minimap';
import { RoutePanel, type RoutePanelView } from './routePanel';
import { CabPanel } from './cab';
import { CoordPanel } from './coords';
import type { MapSurface } from '../game/cartography';
import { renderSlot } from './containers';

export interface DebugInfo {
  fps: number;
  chunks: number;
  pending: number;
  biome: string;
  clock: string;
  mobs: number;
  waterDepth: number;
  seed: number;
  /** The world's clock speed, and how much of it the frame actually managed. */
  speed: number;
  effectiveSpeed: number;
  /** Debug: nothing is used up and every item is on tap. */
  creative: boolean;
}

/** Everything the navigation aids need, gathered once per frame by the game. */
export interface NavigationInfo {
  /** The ground the maps draw: loaded world, survey, and nothing where neither. */
  surface: MapSurface;
  markers: CompassMarker[];
  showCompass: boolean;
  showMinimap: boolean;
  showRoutes: boolean;
  routes: RoutePanelView;
  showCoords: boolean;
  overlay: MinimapOverlay;
  /** The building under the crosshair, when there is one worth naming. */
  building: { title: string; hint: string } | null;
  /** The shape the track tool is about to build, while a start is down. */
  track: { lines: string[]; fault: string | null } | null;
}

/** Health, hunger, hotbar, crosshair and the debug overlay. */
export class Hud {
  readonly root = el('div', 'hud');
  private readonly hearts = el('div', 'stat-row hearts');
  private readonly food = el('div', 'stat-row food');
  private readonly air = el('div', 'stat-row air');
  private readonly hotbar = el('div', 'hotbar');
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly heldLabel = el('div', 'held-label');
  private readonly debug = el('pre', 'debug');
  private readonly toasts = el('div', 'toasts');
  private readonly flash = el('div', 'damage-flash');
  private readonly clickPrompt = el('div', 'click-prompt', 'クリックしてプレイ');
  /** What the player is looking at, when it is a building. Sits just under the crosshair
   *  because it is about the thing in the middle of the screen. */
  private readonly building = el('div', 'building-prompt');
  /** Shares the building prompt's class, and its place under the crosshair: only one of
   *  the two can be the thing the player is doing. */
  private readonly track = el('div', 'building-prompt track-readout');
  private readonly trackLines = el('div', 'track-lines');
  private readonly trackFault = el('div', 'track-fault');
  private readonly buildingTitle = el('div', 'building-title');
  private readonly buildingHint = el('div', 'building-hint');
  private readonly underwater = el('div', 'underwater');
  /** Shown only while the world is running fast, because a game that is quietly sixteen
   *  times faster than the player expects is a game that has lied to them. */
  private readonly speedBadge = el('div', 'speed-badge');
  /** A mode that makes everything free has to be visible, or a world it was left on in
   *  looks like one where the rules simply stopped applying. */
  private readonly creativeBadge = el('div', 'creative-badge', 'デバッグ: 全アイテム無限（C）');
  readonly compass = new Compass();
  readonly minimap: Minimap;
  readonly routes = new RoutePanel();
  /** The driving readout. Empty and hidden unless somebody is in a cab. */
  readonly cab = new CabPanel();
  readonly coords = new CoordPanel();
  private debugVisible = false;
  private clickPromptUp = false;
  private heldLabelTimer = 0;

  constructor(private readonly atlas: Atlas) {
    this.minimap = new Minimap(atlas);
    const crosshair = el('div', 'crosshair');
    const stats = el('div', 'stats');
    stats.append(this.hearts, this.food);
    this.air.style.display = 'none';
    const bottom = el('div', 'bottom');
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = el('div', 'slot hotbar-slot');
      this.hotbarSlots.push(slot);
      this.hotbar.appendChild(slot);
    }
    bottom.append(this.heldLabel, this.air, stats, this.hotbar);
    // The debug readout and the objective share the top-left corner, so they stack in one
    // column instead of being positioned to land on top of each other.
    const left = el('div', 'hud-left');
    left.append(this.debug, this.routes.root);
    this.root.append(
      this.underwater,
      this.flash,
      crosshair,
      this.compass.root,
      this.minimap.root,
      left,
      this.coords.root,
      this.building,
      this.track,
      this.speedBadge,
      this.creativeBadge,
      this.cab.root,
      bottom,
      this.toasts,
      this.clickPrompt,
    );
    this.building.append(this.buildingTitle, this.buildingHint);
    this.building.style.display = 'none';
    this.track.append(this.trackLines, this.trackFault);
    this.track.style.display = 'none';
    this.speedBadge.style.display = 'none';
    this.creativeBadge.style.display = 'none';
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
    // The two sit in the same place under the crosshair, and nothing can be designated
    // before the game has the pointer anyway.
    this.clickPromptUp = visible;
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

  update(dt: number, player: Player, info: DebugInfo, navigation: NavigationInfo): void {
    this.compass.setVisible(navigation.showCompass);
    if (navigation.showCompass) this.compass.update(player.yaw, player.x, player.z, navigation.markers);
    this.minimap.setVisible(navigation.showMinimap);
    if (navigation.showMinimap) {
      this.minimap.update(navigation.surface, player.x, player.z, player.yaw, navigation.overlay);
    }
    this.routes.setVisible(navigation.showRoutes);
    if (navigation.showRoutes) this.routes.update(navigation.routes);
    this.coords.setVisible(navigation.showCoords);
    if (navigation.showCoords) this.coords.update(player.x, player.y, player.z, player.yaw, info.fps);
    // The readout wins the spot: while a start is down, what the player is doing is
    // laying track, not looking at a building.
    const readout = navigation.track;
    this.track.style.display = readout && !this.clickPromptUp ? '' : 'none';
    if (readout) {
      const lines = readout.lines.join('\n');
      if (this.trackLines.textContent !== lines) this.trackLines.textContent = lines;
      if (this.trackFault.textContent !== (readout.fault ?? '')) {
        this.trackFault.textContent = readout.fault ?? '';
      }
      this.trackFault.style.display = readout.fault ? '' : 'none';
    }
    const showBuilding = navigation.building !== null && readout === null && !this.clickPromptUp;
    this.building.style.display = showBuilding ? '' : 'none';
    if (navigation.building) {
      if (this.buildingTitle.textContent !== navigation.building.title) {
        this.buildingTitle.textContent = navigation.building.title;
      }
      if (this.buildingHint.textContent !== navigation.building.hint) {
        this.buildingHint.textContent = navigation.building.hint;
      }
    }

    // Fast forward is loud on purpose. It also says what the machine actually managed,
    // so a speed the frame rate could not hold is visible rather than merely felt.
    const fast = info.speed > 1;
    this.speedBadge.style.display = fast ? '' : 'none';
    if (fast) {
      const behind = info.effectiveSpeed < info.speed ? `（実効 ×${info.effectiveSpeed}）` : '';
      const text = `早送り ×${info.speed}${behind}`;
      if (this.speedBadge.textContent !== text) this.speedBadge.textContent = text;
    }

    this.creativeBadge.style.display = info.creative ? '' : 'none';

    this.renderBar(this.hearts, player.health, player.maxHealth, 'heart');
    this.renderBar(this.food, player.hunger.food, 20, 'drumstick');
    // The breath meter only appears once the player is actually holding their breath.
    const drowning = player.air < MAX_AIR;
    this.air.style.display = drowning ? '' : 'none';
    if (drowning) this.renderBar(this.air, player.air, MAX_AIR, 'bubble');

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
        `速度 ×${info.speed}（実効 ×${info.effectiveSpeed}）`,
        `水深 ${info.waterDepth.toFixed(2)}`,
        `シード ${info.seed}`,
        `手持ち ${held ? `${itemDef(held.id)?.label ?? held.id} x${held.count}` : 'なし'}`,
        `デバッグモード ${info.creative ? '入（消費なし）' : '切'}`,
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
