import type { Season } from '../world/weather';
import { el, show } from './dom';

/** The weather panel. The seasons only turn the springs up and down; what the rivers do
 *  about it is the water's business and takes as long as it takes. So the panel says
 *  what the springs are doing, how long for, what comes next — and how deep the water is
 *  where the player is standing, which is the part that actually answers "am I in
 *  trouble". */

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
  season: Season;
  /** Seconds until the season changes. */
  endsIn: number;
  next: Season;
  /** How hard the springs are running, 0 to 2. */
  flow: number;
  /** Water depth under the player, in blocks. */
  depth: number;
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
    if (this.season !== view.season) {
      this.season = view.season;
      this.icon.textContent = ICON[view.season];
      this.title.textContent = LABEL[view.season];
      this.root.className = `forecast ${view.season}`;
    }
    this.timer.textContent = `あと ${clock(view.endsIn)}`;
    const text = `次: ${LABEL[view.next]}`;
    if (this.next.textContent !== text) this.next.textContent = text;
    this.next.classList.toggle('urgent', view.next !== 'normal');

    // The bar is the springs, not the river: the river answers in its own time.
    const width = Math.min(50, Math.abs(view.flow - 1) * 50);
    this.fill.style.width = `${width}%`;
    this.fill.style.left = view.flow >= 1 ? '50%' : `${50 - width}%`;
    this.level.textContent = `水源 ${Math.round(view.flow * 100)}%・水深 ${view.depth.toFixed(1)}`;
  }
}
