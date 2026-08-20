import { levelOffset } from '../world/generation/rivers';
import type { Season } from '../world/weather';
import { el, show } from './dom';

/** The weather panel. The whole point of the cycle is that the player can see a drought
 *  coming before it arrives, so this has to say three things plainly: what the water is
 *  doing here, how long that lasts, and what the headwaters have already started. */

const LABEL: Record<Season, string> = {
  normal: '平常',
  rain: '大雨',
  drought: '渇水',
};

const ICON: Record<Season, string> = {
  normal: '≡',
  rain: '☂',
  drought: '☀',
};

export interface ForecastView {
  here: Season;
  /** Seconds until the season here changes. */
  endsIn: number;
  next: Season;
  /** What the headwaters are doing, which may already be the next season. */
  upstream: Season;
  /** -1 to +1. */
  wetness: number;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export class ForecastPanel {
  readonly root = el('div', 'forecast');
  private readonly icon = el('span', 'forecast-icon');
  private readonly title = el('span', 'forecast-season');
  private readonly timer = el('span', 'forecast-timer');
  private readonly next = el('div', 'forecast-next');
  private readonly bar = el('div', 'forecast-bar');
  private readonly fill = el('div', 'forecast-fill');
  private readonly level = el('div', 'forecast-level');
  private season: Season | null = null;

  constructor() {
    const head = el('div', 'forecast-head');
    head.append(this.icon, this.title, this.timer);
    this.bar.appendChild(this.fill);
    this.root.append(head, this.next, this.bar, this.level);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  update(view: ForecastView): void {
    if (this.season !== view.here) {
      this.season = view.here;
      this.icon.textContent = ICON[view.here];
      this.title.textContent = LABEL[view.here];
      this.root.className = `forecast ${view.here}`;
    }
    this.timer.textContent = `あと ${clock(view.endsIn)}`;
    // Once the headwaters have turned, the countdown above is how long the old water
    // has left to reach here, which is the number worth acting on.
    const ahead = view.upstream !== view.here;
    const text = ahead ? `上流はすでに ${LABEL[view.upstream]}` : `次: ${LABEL[view.next]}`;
    if (this.next.textContent !== text) this.next.textContent = text;
    this.next.classList.toggle('urgent', ahead);

    const offset = levelOffset(view.wetness);
    const width = Math.min(50, Math.abs(offset) * 25);
    this.fill.style.width = `${width}%`;
    this.fill.style.left = offset >= 0 ? '50%' : `${50 - width}%`;
    const sign = offset > 0.05 ? '+' : offset < -0.05 ? '−' : '±';
    this.level.textContent = `水位 ${sign}${Math.abs(offset).toFixed(1)}`;
  }
}
