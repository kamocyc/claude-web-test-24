import { Block, blockDef } from '../world/blocks';
import { ROAD_SPEED } from '../game/roads';
import { WATER_FULL } from '../world/water';
import type { World } from '../world/world';
import type { Atlas } from '../render/textures';
import { TILE } from '../render/textures';
import { el } from './dom';

/** Pixels across the corner map. */
const SIZE = 112;
/** Blocks per pixel: the map covers `size * scale` blocks in each direction. */
const SCALE = 2;
/** Pixels of terrain repainted per frame: the corner map's own rate, four frames to a
 *  full pass. A budget rather than a fraction, so a bigger map costs no more per frame and
 *  simply takes longer to come round. */
const PIXELS_PER_FRAME = SIZE * 28;

/** How far the big map may be zoomed, in blocks per pixel. One block to the pixel is a
 *  village you can count the houses of; sixteen is most of a day's walk on screen. */
export const ZOOM_STEPS = [1, 2, 4, 8, 16] as const;

export interface MinimapOptions {
  /** Pixels across. */
  size?: number;
  /** Blocks per pixel. */
  scale?: number;
  className?: string;
}

/** Places and roads drawn on top of the terrain. */
export interface MinimapOverlay {
  markers: { kind: string; x: number; z: number }[];
  roads: { x: number; z: number; b?: number }[];
  /** The railway near the player, one polyline per curve. Points rather than columns:
   *  none of it is in the block grid, and at two blocks to the pixel a deck drawn as the
   *  cells it happens to pass over would come out as a dotted line. */
  rails: { x: number; z: number }[][];
  /** The stretch of road that is still missing, if the player is building one. */
  gap: { from: { x: number; z: number }; to: { x: number; z: number } } | null;
  /** Road that is laid and does not count. Drawn on top of the road it is part of, so a
   *  line with a red bead on it reads as exactly what it is: nearly a road. */
  faults: { x: number; z: number }[];
}

const EMPTY_OVERLAY: MinimapOverlay = { markers: [], roads: [], rails: [], gap: null, faults: [] };

/** Road the index refuses, matching the beacon colour used in the world itself. */
const FAULT_COLOUR = '#ff5a5a';

const MARKER_COLORS: Record<string, string> = {
  spawn: '#8fd0ff',
  death: '#ff6b6b',
  village: '#ffd479',
  gap: '#ff9b53',
  target: '#7cc4ff',
  porter: '#8ef0b8',
};

/** Steel, and off the end of the road ramp on purpose: a railway is not a better road,
 *  it is the other thing, and on a map it should read as a different kind of line. */
const RAIL_COLOUR = 'rgba(150, 196, 236, 0.95)';

/** Trodden dirt through to stone brick, as a colour. */
function roadColour(block: number | undefined): string {
  const speed = block === undefined ? 1 : ROAD_SPEED.get(block) ?? 1;
  const paved = Math.max(0, Math.min(1, (speed - 1) / 0.7));
  const mix = (from: number, to: number): number => Math.round(from + (to - from) * paved);
  return `rgba(${mix(226, 236)}, ${mix(200, 236)}, ${mix(142, 238)}, 0.9)`;
}

/** Overhead map of the loaded world around the player. Redrawn a few rows at a time
 *  so a full refresh costs a fraction of a frame. */
export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private image: ImageData;
  /** Average colour of a block's top face, read out of the texture atlas once. */
  private readonly colors = new Map<number, [number, number, number]>();
  private atlasPixels: ImageData | null = null;
  private row = 0;
  private originX = 0;
  private originZ = 0;
  /** Set when the whole map has to be painted again on the next pass rather than a slice
   *  at a time: it has been opened, or the zoom has changed under it. */
  private repaint = true;
  private readonly size: number;
  private scale: number;

  constructor(private readonly atlas: Atlas, options: MinimapOptions = {}) {
    this.size = options.size ?? SIZE;
    this.scale = options.scale ?? SCALE;
    this.root = el('div', options.className ?? 'minimap');
    this.canvas = el('canvas', 'minimap-canvas') as HTMLCanvasElement;
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.image = ctx.createImageData(this.size, this.size);
    this.root.append(this.canvas, el('div', 'minimap-north', 'N'));
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  /** Blocks per pixel, and the span that covers. */
  get zoom(): number {
    return this.scale;
  }

  get span(): number {
    return this.size * this.scale;
  }

  /** Changes how much world fits on the map. The pass in progress is thrown away rather
   *  than finished: half a map at one zoom and half at another is not a map. */
  setZoom(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.redrawNow();
  }

  /** Paints the lot on the next update instead of a slice of it. */
  redrawNow(): void {
    this.row = 0;
    this.repaint = true;
    this.image = this.ctx.createImageData(this.size, this.size);
  }

  /** Reads the atlas back once so map colours always match the textures. */
  private colorOf(block: number): [number, number, number] {
    const cached = this.colors.get(block);
    if (cached) return cached;
    if (!this.atlasPixels) {
      const source = this.atlas.canvas.getContext('2d');
      this.atlasPixels = source
        ? source.getImageData(0, 0, this.atlas.canvas.width, this.atlas.canvas.height)
        : new ImageData(1, 1);
    }
    const def = blockDef(block);
    const name = def.tex.top ?? def.tex.all ?? def.tex.side ?? 'stone';
    const uv = this.atlas.uv(name);
    const pixels = this.atlasPixels;
    const x0 = Math.round(uv.u0 * this.atlas.canvas.width);
    const y0 = Math.round(uv.v0 * this.atlas.canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = ((y0 + y) * pixels.width + (x0 + x)) * 4;
        if (pixels.data[i + 3] < 8) continue;
        r += pixels.data[i];
        g += pixels.data[i + 1];
        b += pixels.data[i + 2];
        count++;
      }
    }
    const color: [number, number, number] =
      count > 0 ? [r / count, g / count, b / count] : [120, 120, 120];
    this.colors.set(block, color);
    return color;
  }

  update(
    world: World,
    playerX: number,
    playerZ: number,
    yaw: number,
    overlay: MinimapOverlay = EMPTY_OVERLAY,
  ): void {
    if (this.row === 0) {
      this.originX = Math.floor(playerX) - (this.size / 2) * this.scale;
      this.originZ = Math.floor(playerZ) - (this.size / 2) * this.scale;
    }
    // Everything at once when the view has just changed, and a slice a frame after that.
    // A map somebody has just opened has to be a map, and one full pass is a single frame
    // of work spent where a modal has already interrupted them; keeping up with a walking
    // player afterwards is worth a quarter of it.
    const rows = this.repaint
      ? this.size
      : Math.max(1, Math.round(PIXELS_PER_FRAME / this.size));
    this.repaint = false;
    const end = Math.min(this.size, this.row + rows);
    for (let py = this.row; py < end; py++) {
      const z = this.originZ + py * this.scale;
      for (let px = 0; px < this.size; px++) {
        const x = this.originX + px * this.scale;
        this.paint(world, px, py, x, z);
      }
    }
    this.row = end >= this.size ? 0 : end;

    this.ctx.putImageData(this.image, 0, 0);
    this.drawRoads(overlay);
    this.drawRails(overlay);
    this.drawFaults(overlay);
    this.drawMarkers(overlay);
    this.drawPlayer(yaw);
  }

  /** World coordinates to canvas pixels, or null when they fall off the map. */
  private project(x: number, z: number): { px: number; py: number } | null {
    const at = this.place(x, z);
    if (at.px < 0 || at.px >= this.size || at.py < 0 || at.py >= this.size) return null;
    return at;
  }

  /** The same, unclipped. A line with one end off the map is still drawn to the edge;
   *  dropping its far point would bend it back on itself instead. */
  private place(x: number, z: number): { px: number; py: number } {
    return { px: (x - this.originX) / this.scale, py: (z - this.originZ) / this.scale };
  }

  /** The roads the player has laid, so it is visible at a glance where one stops. */
  private drawRoads(overlay: MinimapOverlay): void {
    const ctx = this.ctx;
    let painted = '';
    for (const point of overlay.roads) {
      const at = this.project(point.x, point.z);
      if (!at) continue;
      // Paved stretches read paler than trodden ones, so which part of a line has been
      // improved is visible from the map rather than only from the panel.
      const colour = roadColour(point.b);
      if (colour !== painted) {
        ctx.fillStyle = colour;
        painted = colour;
      }
      ctx.fillRect(at.px - 0.5, at.py - 0.5, 1.5, 1.5);
    }
    if (!overlay.gap) return;
    // The unfinished stretch, drawn as the dashed line it wants to become.
    const a = this.project(overlay.gap.from.x, overlay.gap.from.z);
    const b = this.project(overlay.gap.to.x, overlay.gap.to.z);
    if (!a || !b) return;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#ff9b53';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
    ctx.restore();
  }

  /** The railway, drawn as the lines it is. */
  private drawRails(overlay: MinimapOverlay): void {
    if (overlay.rails.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = RAIL_COLOUR;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (const line of overlay.rails) {
      if (line.length < 2) continue;
      ctx.beginPath();
      const first = this.place(line[0].x, line[0].z);
      ctx.moveTo(first.px, first.py);
      for (let i = 1; i < line.length; i++) {
        const at = this.place(line[i].x, line[i].z);
        ctx.lineTo(at.px, at.py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Where the road is laid and the index will not have it. */
  private drawFaults(overlay: MinimapOverlay): void {
    if (overlay.faults.length === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = FAULT_COLOUR;
    for (const fault of overlay.faults) {
      const at = this.project(fault.x, fault.z);
      if (!at) continue;
      ctx.fillRect(at.px - 1, at.py - 1, 2.5, 2.5);
    }
  }

  private drawMarkers(overlay: MinimapOverlay): void {
    const ctx = this.ctx;
    for (const marker of overlay.markers) {
      const at = this.project(marker.x, marker.z);
      if (!at) continue;
      ctx.fillStyle = MARKER_COLORS[marker.kind] ?? '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (marker.kind === 'porter') {
        // A diamond, so a shipment crawling along a road is not mistaken for a place.
        ctx.moveTo(at.px, at.py - 2.5);
        ctx.lineTo(at.px + 2.5, at.py);
        ctx.lineTo(at.px, at.py + 2.5);
        ctx.lineTo(at.px - 2.5, at.py);
        ctx.closePath();
      } else {
        ctx.rect(at.px - 2, at.py - 2, 4, 4);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  private paint(world: World, px: number, py: number, x: number, z: number): void {
    const index = (py * this.size + px) * 4;
    const top = world.heightAt(x, z);
    if (top < 0) {
      // Not loaded yet: leave it dark rather than pretending to know.
      this.image.data[index] = 22;
      this.image.data[index + 1] = 24;
      this.image.data[index + 2] = 28;
      this.image.data[index + 3] = 255;
      return;
    }
    const block = world.getBlock(x, top, z);
    let [r, g, b] = this.colorOf(block);

    // Shade by the slope towards the north west so ridges and valleys read at a glance.
    const west = world.heightAt(x - this.scale, z);
    const north = world.heightAt(x, z - this.scale);
    const slope = (west >= 0 ? top - west : 0) + (north >= 0 ? top - north : 0);
    const light = 1 + Math.max(-0.45, Math.min(0.45, slope * 0.12));
    r *= light;
    g *= light;
    b *= light;

    // Deep water reads darker than a shallow bank.
    const water = world.getWater(x, top, z);
    if (water > 0 || block === Block.WATER) {
      const depth = Math.min(1, water / WATER_FULL);
      r = r * 0.45 + 30 * depth;
      g = g * 0.5 + 60 * depth;
      b = b * 0.7 + 110 * depth;
    }

    this.image.data[index] = Math.max(0, Math.min(255, r));
    this.image.data[index + 1] = Math.max(0, Math.min(255, g));
    this.image.data[index + 2] = Math.max(0, Math.min(255, b));
    this.image.data[index + 3] = 255;
  }

  private drawPlayer(yaw: number): void {
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // Yaw 0 looks towards -Z, which is up on the map.
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
