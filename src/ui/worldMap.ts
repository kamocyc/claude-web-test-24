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
 *  It stays centred on the player and does not pan. Panning would need a way to get back,
 *  and "where am I" is the one question a map must never be able to lose the answer to;
 *  zooming out to sixteen blocks a pixel already puts four thousand blocks on screen,
 *  which is further than anybody walks in a session. */

import type { Atlas } from '../render/textures';
import type { MapSurface } from '../game/cartography';
import { el } from './dom';
import { Minimap, ZOOM_STEPS, type MinimapOverlay } from './minimap';

/** Pixels across. Square, because the terrain pass walks a square and a rectangle would
 *  mean two spans to think about; large enough that at the closest zoom a village fills a
 *  useful part of it, and it is scaled to fit the window by CSS. */
const SIZE = 512;
/** Where the zoom starts: the corner map's own, so opening this reads as the same map. */
const DEFAULT_ZOOM = 2;

export class WorldMap {
  readonly root = el('div', 'worldmap');
  private readonly map: Minimap;
  private readonly readout = el('div', 'worldmap-readout');
  private readonly closeButton = el('button', 'worldmap-close', '閉じる (M)');
  private open = false;
  private step = ZOOM_STEPS.indexOf(DEFAULT_ZOOM);

  constructor(atlas: Atlas, private readonly onClose: () => void) {
    this.map = new Minimap(atlas, { size: SIZE, scale: DEFAULT_ZOOM, className: 'worldmap-canvas-wrap' });
    const bar = el('div', 'worldmap-bar');
    const out = el('button', 'worldmap-zoom', '−');
    const into = el('button', 'worldmap-zoom', '＋');
    out.addEventListener('click', () => this.zoom(1));
    into.addEventListener('click', () => this.zoom(-1));
    this.closeButton.addEventListener('click', () => this.onClose());
    bar.append(into, out, this.readout, this.closeButton);
    // The wheel zooms, which is what every map anybody has used does. Passive false so
    // the page does not scroll behind it.
    this.root.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom(event.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    this.root.append(this.map.root, bar);
    this.root.style.display = 'none';
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
    // A map somebody has just opened has to be a map. It is painted a slice at a time
    // afterwards, which is enough to keep up with a walking player.
    if (open) this.map.redrawNow();
  }

  /** Steps the zoom, coarser for a positive `by`. Clamped rather than wrapped: a map that
   *  jumps from the whole coast to one street because somebody scrolled once too far is a
   *  map that has lost them. */
  zoom(by: number): void {
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.step + by));
    if (next === this.step) return;
    this.step = next;
    this.map.setZoom(ZOOM_STEPS[next]);
  }

  update(surface: MapSurface, x: number, z: number, yaw: number, overlay: MinimapOverlay): void {
    if (!this.open) return;
    this.map.update(surface, x, z, yaw, overlay);
    this.readout.textContent =
      `${Math.round(x)}, ${Math.round(z)} · 1 ドット ${this.map.zoom} マス · 一辺 ${this.map.span} マス`;
  }
}
