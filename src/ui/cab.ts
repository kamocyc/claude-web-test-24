import { el, show } from './dom';

/** The cab: what a player driving a train can see without looking out of the window.
 *
 *  Four things, and they are the four things the driving is *about*. What the train is
 *  doing, what the rails allow where it is, why they allow that — the bank and the bend —
 *  and how far it is to the next stop. A speedometer alone would make manual driving a
 *  game of holding W; the limit next to it, moving as the line does, is what makes a
 *  gradient and a curve something the player feels rather than reads about on a panel.
 *
 *  Rendering only. Everything here comes off `DriveView` in `transport.ts`, which is the
 *  shipment being driven; nothing in this file knows what a rail is. */

/** What the panel needs to draw itself. The same numbers the simulation has, in the same
 *  units: blocks per second, a slope as a fraction, a radius in blocks. */
export interface CabView {
  /** Blocks per second. */
  speed: number;
  limit: number;
  /** What the rails would allow straight and level, which is what the bar is scaled to. */
  lineSpeed: number;
  /** Signed, positive climbing. */
  grade: number;
  /** `Infinity` on a straight. */
  radius: number;
  line: string;
  next: string;
  toGo: number;
  cargo: string;
  /** Standing at a signal somebody else is holding. */
  held: boolean;
  /** Over the limit now, and how long that has been going on. */
  over: number;
  emergency: boolean;
  note: string | null;
}

/** Blocks per second is the game's unit and nobody thinks in it. The readout is scaled so
 *  that a train at line speed reads as a train — about 50 on the dial — which makes the
 *  needle mean something without inventing a kilometre. */
export const SPEED_SCALE = 7;

export function speedText(blocksPerSecond: number): string {
  return `${Math.round(blocksPerSecond * SPEED_SCALE)}`;
}

/** What the rails are doing here, in one line. Empty when they are doing nothing, so the
 *  panel says nothing rather than saying "level, straight" at a player who can see that. */
export function railText(grade: number, radius: number): string {
  const parts: string[] = [];
  if (Math.abs(grade) >= 0.005) parts.push(`勾配 ${grade > 0 ? '+' : '−'}${Math.abs(grade * 100).toFixed(1)}%`);
  if (Number.isFinite(radius)) parts.push(`曲線 R${Math.round(radius)}`);
  return parts.join(' / ');
}

export class CabPanel {
  readonly root = el('div', 'cab');
  private readonly speed = el('div', 'cab-speed');
  private readonly bar = el('div', 'cab-bar');
  private readonly fill = el('div', 'cab-fill');
  private readonly limitMark = el('div', 'cab-limit');
  private readonly rails = el('div', 'cab-rails');
  private readonly ahead = el('div', 'cab-ahead');
  private readonly cargo = el('div', 'cab-cargo');
  private readonly warn = el('div', 'cab-warn');
  private readonly keys = el('div', 'cab-keys', 'W 力行 / S 制動 / X 降車');

  constructor() {
    this.bar.append(this.fill, this.limitMark);
    this.root.append(this.speed, this.bar, this.rails, this.ahead, this.cargo, this.warn, this.keys);
    show(this.root, false);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  update(view: CabView): void {
    // The bar runs to what a driver can actually reach rather than to the limit, so that
    // being over the limit is a place on the dial and not a number that has run off it.
    const full = Math.max(view.lineSpeed * 1.8, view.limit, 1);
    const over = view.speed > view.limit * 1.05;
    this.speed.textContent = `${speedText(view.speed)}  制限 ${speedText(view.limit)}`;
    this.speed.classList.toggle('over', over);
    this.fill.style.width = `${Math.min(100, (view.speed / full) * 100)}%`;
    this.fill.classList.toggle('over', over);
    this.limitMark.style.left = `${Math.min(100, (view.limit / full) * 100)}%`;
    this.rails.textContent = railText(view.grade, view.radius) || '直線・水平';
    this.ahead.textContent = `${view.line} — 次 ${view.next} まで ${Math.round(view.toGo)}m`;
    this.cargo.textContent = view.cargo;
    const warning = view.emergency
      ? '非常ブレーキ — 停止するまで戻らない'
      : view.held
        ? '信号待ち'
        : over
          ? `速度超過 ${Math.max(0, 3 - view.over).toFixed(1)}s`
          : view.note ?? '';
    this.warn.textContent = warning;
    this.warn.classList.toggle('bad', view.emergency || over);
    show(this.warn, warning.length > 0);
  }
}
