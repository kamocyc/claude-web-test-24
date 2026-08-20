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
}

export interface RoutePanelView {
  quest: QuestObjective | null;
  routes: RouteView[];
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
  private readonly list = el('div', 'route-list');
  private signature = '';

  constructor() {
    this.questBox.append(this.questTitle, this.questDetail);
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

    // Rebuilding the rows every frame would fight the browser; they only change when a
    // road does.
    const signature = view.routes
      .map((r) => `${r.from}>${r.to}:${r.surveyed}:${r.connected}:${Math.round(r.length)}:${Math.round(r.missing)}:${r.porters}`)
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    clear(this.list);
    for (const route of view.routes) {
      const row = el('div', `route-row ${route.connected ? 'linked' : 'broken'}`);
      row.appendChild(el('div', 'route-pair', `${route.from} ⇄ ${route.to}`));
      let status: string;
      if (!route.surveyed) status = '調べています...';
      else if (route.connected) {
        status = `接続済み ${Math.round(route.length)}m${route.porters > 0 ? ` / 荷運び ${route.porters}` : ''}`;
      } else status = `未接続 / あと ${Math.round(route.missing)}m`;
      row.appendChild(el('div', 'route-status', status));
      this.list.appendChild(row);
    }
  }
}
