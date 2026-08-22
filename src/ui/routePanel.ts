import type { QuestObjective } from '../game/questline';
import { clear, el, show } from './dom';

export interface RouteView {
  from: string;
  to: string;
  surveyed: boolean;
  connected: boolean;
  /** Blocks of road, once it is connected. */
  length: number;
  /** Straight line distance still to be paved, when it is not. */
  missing: number;
  porters: number;
  /** Where the nearest shipment on this line is, relative to the player. Null when the
   *  line is running nothing. */
  nearest: { distance: number; bearing: number } | null;
  /** What the origin has piled up, and what it takes to fill one trip. A connected road
   *  with nothing on it is nearly always this: the answer to "it is joined up, so why is
   *  nobody carrying anything?" is usually "there is not a load ready yet". */
  stock: number;
  /** What the pavement is called, and what one trip carries on it. */
  grade: string;
  load: number;
  /** True when the far end has asked for what this route carries. */
  wanted: boolean;
}

export interface RoutePanelView {
  quest: QuestObjective | null;
  /** Where the objective is, relative to the player. `bearing` is compass degrees. */
  aim: { distance: number; bearing: number } | null;
  routes: RouteView[];
}

const POINTS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/** Compass degrees as a word. Eight points is as fine as anyone steers on foot. */
function heading(bearing: number): string {
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % POINTS.length;
  return POINTS[index];
}

/** The objective, and whether each route is actually joined up.
 *
 *  A road is allowed to be dashed, so "is it connected?" stops being obvious from looking
 *  at it — which is exactly why it is spelled out here, along with how much is left. */
export class RoutePanel {
  readonly root = el('div', 'route-panel');
  private readonly questBox = el('div', 'route-quest');
  private readonly questTitle = el('div', 'route-quest-title');
  private readonly questDetail = el('div', 'route-quest-detail');
  private readonly questAim = el('div', 'route-quest-aim');
  private readonly list = el('div', 'route-list');
  private signature = '';

  constructor() {
    this.questBox.append(this.questTitle, this.questDetail, this.questAim);
    this.root.append(this.questBox, this.list);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  update(view: RoutePanelView): void {
    const quest = view.quest;
    show(this.questBox, quest !== null);
    if (quest) {
      if (this.questTitle.textContent !== quest.title) this.questTitle.textContent = quest.title;
      if (this.questDetail.textContent !== quest.detail) this.questDetail.textContent = quest.detail;
    }
    // The destination is usually a village the player has never walked into, so naming it
    // is not enough — say which way and how far.
    show(this.questAim, quest !== null && view.aim !== null);
    if (quest && view.aim) {
      const aim = `${heading(view.aim.bearing)}へ ${Math.round(view.aim.distance)}m`;
      if (this.questAim.textContent !== aim) this.questAim.textContent = aim;
    }

    // Rebuilding the rows every frame would fight the browser; they only change when a
    // road does.
    const signature = view.routes
      .map((r) => [
        r.from, r.to, r.surveyed, r.connected, Math.round(r.length),
        Math.round(r.missing), r.porters, r.grade, r.load, r.wanted, r.stock,
        r.nearest ? `${Math.round(r.nearest.distance)},${Math.round(r.nearest.bearing / 45)}` : '',
      ].join(':'))
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    clear(this.list);
    for (const route of view.routes) {
      const row = el('div', `route-row ${route.connected ? 'linked' : 'broken'}`);
      // A tick on the pair itself: at a glance, is this line carrying something the far
      // end actually wants?
      row.appendChild(el('div', 'route-pair', `${route.from} ⇄ ${route.to}${route.wanted ? ' ✓' : ''}`));
      let status: string;
      if (!route.surveyed) status = '調べています...';
      else if (route.connected) {
        status = `接続済み ${Math.round(route.length)}m / ${route.grade} / 荷 ${route.load}`;
      } else status = `未接続 / あと ${Math.round(route.missing)}m`;
      row.appendChild(el('div', 'route-status', status));
      // A connected road that is carrying nothing looks broken and is not. Say which of
      // the two it is, and where to look to see it happening.
      if (route.connected) {
        const cargo = route.nearest
          ? `荷運び ${route.porters} · ${heading(route.nearest.bearing)}へ ${Math.round(route.nearest.distance)}m`
          : `荷運び 0 · 出荷待ち 在庫 ${route.stock}/${route.load}`;
        row.appendChild(el('div', `route-cargo ${route.nearest ? 'moving' : 'waiting'}`, cargo));
      }
      this.list.appendChild(row);
    }
  }
}
