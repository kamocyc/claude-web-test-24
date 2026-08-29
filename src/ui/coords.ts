import { el, show } from './dom';

/** Always-on position readout in the bottom left corner, with the frame rate on the end
 *  of it. The F3 overlay has carried the same numbers for a while, but a coordinate you
 *  have to hold a key to see is no use while you are walking a road out to a village,
 *  which is what this is for. */

const COMPASS_POINTS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/** Compass point the camera is facing. Yaw 0 looks towards -Z, which is north. */
export function facingLabel(yaw: number): string {
  const degrees = ((-yaw * 180) / Math.PI + 360 + 22.5) % 360;
  return COMPASS_POINTS[Math.floor(degrees / 45) % 8];
}

export class CoordPanel {
  readonly root = el('div', 'coords');
  private readonly position = el('div', 'coords-position');
  private readonly detail = el('div', 'coords-detail');
  private last = '';

  constructor() {
    this.root.append(this.position, this.detail);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  update(x: number, y: number, z: number, yaw: number, fps: number): void {
    const position = `X ${x.toFixed(1)} / Y ${y.toFixed(1)} / Z ${z.toFixed(1)}`;
    // The frame rate belongs next to the coordinates rather than only behind F3: it is
    // the other number that answers "is it me or the game?", and it is asked in the
    // same breath as "where am I?" — while walking, with nothing else on screen.
    const detail =
      `チャンク ${Math.floor(x / 16)}, ${Math.floor(z / 16)} / 向き ${facingLabel(yaw)}` +
      ` / ${fps.toFixed(0)} FPS`;
    // Two writes a frame into the DOM for numbers that mostly repeat is wasteful, and
    // it also stops the text flickering while the player stands still.
    const signature = `${position}|${detail}`;
    if (signature === this.last) return;
    this.last = signature;
    this.position.textContent = position;
    this.detail.textContent = detail;
  }
}
