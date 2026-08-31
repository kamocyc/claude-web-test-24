/** The map, big.
 *
 *  The corner minimap answers "what is right here"; at two blocks to the pixel it covers
 *  224 blocks, which is less than half the distance between two villages. Everything the
 *  transport network is about happens outside that square — where the road actually runs,
 *  which pair of villages a railway would join, how far round the coast the line goes —
 *  and none of it could be looked at without walking there.
 *
 *  So this is the same map at any size the player wants. It is deliberately not a second
 *  renderer: it is a `Minimap` with different numbers in it, drawing the same terrain from
 *  the same block colours with the same overlay, so a road that reads one way in the
 *  corner cannot read another way here.
 *
 *  What it shows is what the player has seen. The ground is drawn from the chunks that
 *  are loaded and, beyond them, from the survey the game keeps of every chunk that ever
 *  was — so a coastline walked an hour ago is still on the map, and a valley nobody has
 *  been down is not there at all. A map that guessed would be worse than a small one.
 *
 *  It can be dragged. That was refused for a long time on the grounds that "where am I" is
 *  the one question a map must never be able to lose the answer to — which is a real risk
 *  and the wrong way to answer it. Zooming out to see two villages at once puts both of
 *  them a long way off the middle, and a map you cannot slide is one you have to walk
 *  across to read. So it pans, and the way back is made loud instead: the button in the bar
 *  lights up the moment the view leaves the player, `Home` does the same thing from the
 *  keyboard, and closing the map and opening it again always comes back to them. */

import type { Atlas } from '../render/textures';
import type { MapSurface } from '../game/cartography';
import { canvasPixel, dragBlocks, zoomStepFor } from './mapView';
import { el, show } from './dom';
import { Minimap, ZOOM_STEPS, type MinimapOverlay } from './minimap';

/** Pixels across. Square, because the terrain pass walks a square and a rectangle would
 *  mean two spans to think about; large enough that at the closest zoom a village fills a
 *  useful part of it, and it is scaled to fit the window by CSS. */
const SIZE = 512;
/** Where the zoom starts: the corner map's own, so opening this reads as the same map. */
const DEFAULT_ZOOM = 2;
/** Client pixels a press may wander and still count as a click rather than a drag. */
const CLICK_SLACK = 4;

/** What the map does when somebody asks to be sent to a place on it. */
export type WarpFromMap = (x: number, z: number) => void;

export interface WorldMapOptions {
  /** Blocks per pixel to open at. Snapped to the nearest offered step. */
  zoom?: number;
  /** Called with the new zoom whenever the player changes it, so it can be remembered. */
  onZoom?: (zoom: number) => void;
}

export class WorldMap {
  readonly root = el('div', 'worldmap');
  private readonly map: Minimap;
  private readonly readout = el('div', 'worldmap-readout');
  private readonly cursorOut = el('div', 'worldmap-cursor');
  private readonly homeButton = el('button', 'worldmap-home', '自分の位置へ (Home)');
  private readonly warpButton = el('button', 'worldmap-warp', 'ここへワープ');
  private readonly closeButton = el('button', 'worldmap-close', '閉じる (M)');
  private open = false;
  private readonly onZoom?: (zoom: number) => void;
  private step: number;
  /** How far the view has been dragged from the player, in blocks. Zero is the player,
   *  which is where every opening of the map starts from. */
  private panX = 0;
  private panZ = 0;
  /** The place under the pointer right now. Null whenever it is not over the map — a
   *  coordinate left behind by a cursor that has gone still looks like an answer. */
  private hover: { x: number; z: number } | null = null;
  /** The place somebody clicked, which stays put. The pointer has to leave the map to
   *  reach the warp button, so a live cursor position alone could never be warped to: the
   *  coordinate would be gone by the time the button was under the mouse. */
  private pick: { x: number; z: number } | null = null;
  /** The drag in progress: where the mouse was last event, in client pixels, and how far
   *  it has come since it went down. A press that never moved is a click. */
  private drag: { clientX: number; clientY: number; moved: number } | null = null;
  private onWarp: WarpFromMap | null = null;
  /** Kept so `dispose` can take them off again. `Game` replaces its whole world — and
   *  therefore this map — when the player opens another one, and window listeners from
   *  the world they closed would pile up for the life of the tab. */
  private readonly onWindowMove = (event: MouseEvent): void => this.dragTo(event);
  private readonly onWindowUp = (event: MouseEvent): void => this.endDrag(event);

  constructor(atlas: Atlas, private readonly onClose: () => void, options: WorldMapOptions = {}) {
    this.step = zoomStepFor(ZOOM_STEPS, options.zoom ?? DEFAULT_ZOOM);
    this.onZoom = options.onZoom;
    this.map = new Minimap(atlas, { size: SIZE, scale: ZOOM_STEPS[this.step], className: 'worldmap-canvas-wrap' });
    const bar = el('div', 'worldmap-bar');
    const out = el('button', 'worldmap-zoom', '−');
    const into = el('button', 'worldmap-zoom', '＋');
    out.addEventListener('click', () => this.zoom(1));
    into.addEventListener('click', () => this.zoom(-1));
    this.homeButton.addEventListener('click', () => this.recentre());
    this.warpButton.addEventListener('click', () => this.warpToPick());
    this.closeButton.addEventListener('click', () => this.onClose());
    bar.append(into, out, this.readout, this.cursorOut, this.warpButton, this.homeButton, this.closeButton);
    // The wheel zooms, which is what every map anybody has used does. Passive false so
    // the page does not scroll behind it.
    this.root.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom(event.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    this.bindDrag();
    this.root.append(this.map.root, bar);
    this.root.style.display = 'none';
  }

  /** What "ここへワープ" does. Whether it is allowed at all is the game's business, not
   *  this map's: the button is always here and the callback is what says no. */
  bindWarp(onWarp: WarpFromMap): void {
    this.onWarp = onWarp;
  }

  /** Takes the window listeners off. Called when the world this map belongs to goes. */
  dispose(): void {
    window.removeEventListener('mousemove', this.onWindowMove);
    window.removeEventListener('mouseup', this.onWindowUp);
  }

  /** Dragging the canvas moves the paper: the ground follows the hand.
   *
   *  The move and the release are on `window` rather than on the canvas, because a hand
   *  that leaves the map mid-drag is still dragging — a listener on the canvas alone
   *  leaves the map stuck to a button that is no longer down. */
  private bindDrag(): void {
    const wrap = this.map.root;
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.drag = { clientX: event.clientX, clientY: event.clientY, moved: 0 };
      wrap.classList.add('dragging');
    });
    wrap.addEventListener('mousemove', (event) => {
      this.hover = this.placeUnder(event);
    });
    wrap.addEventListener('mouseleave', () => {
      this.hover = null;
    });
    window.addEventListener('mousemove', this.onWindowMove);
    window.addEventListener('mouseup', this.onWindowUp);
  }

  private dragTo(event: MouseEvent): void {
    if (!this.drag || !this.open) return;
    const dx = event.clientX - this.drag.clientX;
    const dy = event.clientY - this.drag.clientY;
    const rect = this.map.root.getBoundingClientRect();
    const moved = dragBlocks(rect, dx, dy, SIZE, this.map.zoom);
    this.drag = {
      clientX: event.clientX,
      clientY: event.clientY,
      moved: this.drag.moved + Math.abs(dx) + Math.abs(dy),
    };
    if (moved.x === 0 && moved.z === 0) return;
    this.panX += moved.x;
    this.panZ += moved.z;
    // The whole map is re-sampled, exactly as a zoom does it: painting a slice at a time
    // from here would leave half the picture at the old place and half at the new one.
    this.map.redrawNow();
  }

  private endDrag(event: MouseEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.map.root.classList.remove('dragging');
    // A press that went nowhere is a click, and a click picks the place under it. The
    // slack is for a hand that shifts a pixel on the way up, which is every hand.
    if (drag.moved > CLICK_SLACK) return;
    const at = this.placeUnder(event);
    if (at) this.pick = at;
  }

  /** The place a mouse event is over, or null when it is not over the canvas at all. */
  private placeUnder(event: MouseEvent): { x: number; z: number } | null {
    const rect = this.map.root.getBoundingClientRect();
    const at = canvasPixel(rect, event.clientX, event.clientY, SIZE);
    if (!at || at.px < 0 || at.py < 0 || at.px >= SIZE || at.py >= SIZE) return null;
    return this.map.at(at.px, at.py);
  }

  private warpToPick(): void {
    if (this.pick) this.onWarp?.(this.pick.x, this.pick.z);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Half the span on screen, so whoever fills the overlay in knows how far out to look. */
  get reach(): number {
    return this.map.span / 2;
  }

  show(open: boolean): void {
    this.open = open;
    this.root.style.display = open ? '' : 'none';
    this.drag = null;
    this.hover = null;
    this.pick = null;
    this.map.root.classList.remove('dragging');
    // Opening the map always comes back to the player. Somewhere the view was left three
    // thousand blocks away an hour ago is not what anybody means by "show me the map", and
    // it is the cheapest half of never losing them.
    if (open) {
      this.panX = 0;
      this.panZ = 0;
      // A map somebody has just opened has to be a map. It is painted a slice at a time
      // afterwards, which is enough to keep up with a walking player.
      this.map.redrawNow();
    }
  }

  /** True once the view has been dragged off the player. */
  get panned(): boolean {
    return this.panX !== 0 || this.panZ !== 0;
  }

  /** Puts the player back in the middle. */
  recentre(): void {
    if (!this.panned) return;
    this.panX = 0;
    this.panZ = 0;
    this.map.redrawNow();
  }

  /** The place the map is looking at, given where the player is. Read by whoever gathers
   *  the roads and rails to draw on it: a map dragged two villages over needs the roads
   *  from over there, not the ones around the player. */
  centreFrom(player: { x: number; z: number }): { x: number; z: number } {
    return { x: player.x + this.panX, z: player.z + this.panZ };
  }

  /** Steps the zoom, coarser for a positive `by`. Clamped rather than wrapped: a map that
   *  jumps from the whole coast to one street because somebody scrolled once too far is a
   *  map that has lost them. */
  zoom(by: number): void {
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.step + by));
    if (next === this.step) return;
    this.step = next;
    this.map.setZoom(ZOOM_STEPS[next]);
    this.onZoom?.(ZOOM_STEPS[next]);
  }

  update(
    surface: MapSurface,
    player: { x: number; z: number; yaw: number },
    overlay: MinimapOverlay,
  ): void {
    if (!this.open) return;
    const centre = this.centreFrom(player);
    // The pin, drawn with the villages and the shipments rather than by a second pass of
    // its own: it is a place on the map, which is exactly what a marker is.
    const marked = this.pick
      ? { ...overlay, markers: [...overlay.markers, { kind: 'pick', x: this.pick.x, z: this.pick.z }] }
      : overlay;
    this.map.update(surface, centre.x, centre.z, player.yaw, marked, player);
    this.readout.textContent =
      `${Math.round(centre.x)}, ${Math.round(centre.z)} · 1 ドット ${this.map.zoom} マス · 一辺 ${this.map.span} マス`;
    // The pinned place when there is one, and what the pointer is over while there is not.
    // A coordinate left behind by a cursor that has gone still looks like an answer, so
    // hovering says nothing once the pointer is off the map.
    const named = this.pick ?? this.hover;
    show(this.cursorOut, named !== null);
    if (named) {
      this.cursorOut.textContent = this.pick
        ? `選択 ${named.x}, ${named.z}`
        : `カーソル ${named.x}, ${named.z}`;
    }
    // Nothing picked is not a broken button, it is a button with nothing to do yet, and
    // the hint is what says which.
    this.warpButton.disabled = this.pick === null;
    this.warpButton.title = this.pick === null
      ? '地図をクリックして行き先を選ぶ'
      : `${this.pick.x}, ${this.pick.z} へ移動する`;
    // Loud once the view has left the player, and quiet while it has not: the way back
    // only needs to be visible when there is a way back to want.
    this.homeButton.classList.toggle('away', this.panned);
    this.homeButton.disabled = !this.panned;
  }
}
