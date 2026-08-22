import { gapText, type QuestObjective } from '../game/questline';
import { faultSummary, type RoadFault } from '../game/roads';
import { DETOUR_NOTICE, DOOR_GAP_NOTICE } from '../game/transport';
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
  /** The buildings goods leave from and arrive at. A route is between two doors, not two
   *  map pins, and saying which door is what makes choosing one mean anything. */
  fromDepot: string | null;
  toDepot: string | null;
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
  /** What hauls it, and — when a cart cannot — how far away the place to widen is. */
  vehicle: 'porter' | 'cart';
  cartPinch: { distance: number; bearing: number } | null;
  /** Blocks of up and down, and how much longer the road is than the straight line. */
  climb: number;
  detour: number;
  /** The walk between a depot's door and the road proper, at whichever end is worse. */
  doorGap: number;
  /** Road the player laid near the break that the index will not have. */
  faults: RoadFault[];
  /** True when the road ends beside what it should join and only at the wrong height —
   *  the one break "あと 0m" cannot describe. */
  nearMiss: boolean;
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
 *  Four hundred blocks of road with one column missing looks exactly like four hundred
 *  blocks of road, so "is it connected?" is never obvious from standing on it. This says
 *  so, and — when it is not — says what is in the way rather than only how far. */
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
        r.fromDepot, r.toDepot, r.vehicle, r.climb, Math.round(r.detour * 20),
        Math.round(r.doorGap), r.nearMiss, r.faults.length,
        r.cartPinch ? Math.round(r.cartPinch.distance) : '',
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
        const cart = route.vehicle === 'cart' ? ' / 荷車' : '';
        status = `接続済み ${Math.round(route.length)}m / ${route.grade}${cart} / 荷 ${route.load}`;
      } else status = `未接続 / ${gapText(route.missing)}`;
      row.appendChild(el('div', 'route-status', status));
      for (const note of notes(route)) {
        row.appendChild(el('div', `route-note ${note.tone}`, note.text));
      }
      // A connected road that is carrying nothing looks broken and is not. Say which of
      // the two it is, and where to look to see it happening.
      if (route.connected) {
        const between =
          route.fromDepot && route.toDepot ? `${route.fromDepot} → ${route.toDepot} · ` : '';
        const cargo = route.nearest
          ? `${between}荷運び ${route.porters} · ${heading(route.nearest.bearing)}へ ${Math.round(route.nearest.distance)}m`
          : `${between}出荷待ち 在庫 ${route.stock}/${route.load}`;
        row.appendChild(el('div', `route-cargo ${route.nearest ? 'moving' : 'waiting'}`, cargo));
      }
      this.list.appendChild(row);
    }
  }
}

interface Note {
  text: string;
  tone: 'fault' | 'narrow' | 'cost';
}

/** Everything about a route that is not "how long is it": what is stopping it, what is
 *  slowing it down, and what it would take to run a cart. A road is never merely broken —
 *  it is broken somewhere, for a reason the player can walk to. */
function notes(route: RouteView): Note[] {
  const out: Note[] = [];
  if (!route.connected) {
    if (route.nearMiss) out.push({ text: '道の高さが合っていない — 段差 2 マス以上', tone: 'fault' });
    const faults = faultSummary(route.faults);
    if (faults) out.push({ text: `敷いたのに数えられていない: ${faults}`, tone: 'fault' });
    return out;
  }
  if (route.vehicle !== 'cart') {
    const where = route.cartPinch
      ? `（${heading(route.cartPinch.bearing)}へ ${Math.round(route.cartPinch.distance)}m）`
      : '';
    out.push({ text: `荷車: 幅が足りない${where}`, tone: 'narrow' });
  }
  if (route.detour > DETOUR_NOTICE) {
    out.push({ text: `遠回り ×${route.detour.toFixed(2)} — 運賃は直線距離ぶん`, tone: 'cost' });
  }
  if (route.climb > 0) out.push({ text: `登り ${route.climb} 段`, tone: 'cost' });
  if (route.doorGap > DOOR_GAP_NOTICE) {
    out.push({ text: `集荷所の戸口から道まで ${Math.round(route.doorGap)}m`, tone: 'cost' });
  }
  return out;
}
