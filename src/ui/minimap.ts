import { Block, blockDef } from '../world/blocks';
import { WATER_FULL } from '../world/water';
import type { World } from '../world/world';
import type { Atlas } from '../render/textures';
import { TILE } from '../render/textures';
import { el } from './dom';

/** Pixels across the map. */
const SIZE = 112;
/** Blocks per pixel: the map covers SIZE * SCALE blocks in each direction. */
const SCALE = 2;
/** Rows redrawn per frame. A full pass takes SIZE / ROWS_PER_FRAME frames. */
const ROWS_PER_FRAME = 28;

/** Overhead map of the loaded world around the player. Redrawn a few rows at a time
 *  so a full refresh costs a fraction of a frame. */
export class Minimap {
  readonly root = el('div', 'minimap');
  private readonly canvas = el('canvas', 'minimap-canvas') as HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  /** Average colour of a block's top face, read out of the texture atlas once. */
  private readonly colors = new Map<number, [number, number, number]>();
  private atlasPixels: ImageData | null = null;
  private row = 0;
  private originX = 0;
  private originZ = 0;

  constructor(private readonly atlas: Atlas) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.image = ctx.createImageData(SIZE, SIZE);
    this.root.append(this.canvas, el('div', 'minimap-north', 'N'));
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
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

  update(world: World, playerX: number, playerZ: number, yaw: number): void {
    if (this.row === 0) {
      this.originX = Math.floor(playerX) - (SIZE / 2) * SCALE;
      this.originZ = Math.floor(playerZ) - (SIZE / 2) * SCALE;
    }
    const end = Math.min(SIZE, this.row + ROWS_PER_FRAME);
    for (let py = this.row; py < end; py++) {
      const z = this.originZ + py * SCALE;
      for (let px = 0; px < SIZE; px++) {
        const x = this.originX + px * SCALE;
        this.paint(world, px, py, x, z);
      }
    }
    this.row = end >= SIZE ? 0 : end;

    this.ctx.putImageData(this.image, 0, 0);
    this.drawPlayer(yaw);
  }

  private paint(world: World, px: number, py: number, x: number, z: number): void {
    const index = (py * SIZE + px) * 4;
    const top = world.heightAt(x, z);
    if (top < 0) {
      // Not loaded yet: a pale lavender says "unknown" without punching a dark hole
      // in the map.
      this.image.data[index] = 226;
      this.image.data[index + 1] = 219;
      this.image.data[index + 2] = 234;
      this.image.data[index + 3] = 255;
      return;
    }
    const block = world.getBlock(x, top, z);
    let [r, g, b] = this.colorOf(block);

    // Shade by the slope towards the north west so ridges and valleys read at a glance.
    const west = world.heightAt(x - SCALE, z);
    const north = world.heightAt(x, z - SCALE);
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
    const cx = SIZE / 2;
    const cy = SIZE / 2;
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
    ctx.strokeStyle = 'rgba(87,67,100,0.75)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
