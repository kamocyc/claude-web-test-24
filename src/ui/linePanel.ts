/** 路線表 — where the player designs the service.
 *
 *  This is the screen the whole economy now hangs off. A road that joins two towns carries
 *  nothing; a stop is a place with a name and no purpose; only a *line* — an ordered list
 *  of calls — makes anything move. So this page has to make three things obvious at a
 *  glance: what lines exist, where each one calls, and which stops are standing about with
 *  no line on them.
 *
 *  Rendering only. Every button hands back to `LineActions`, which the game implements
 *  against its `LineNetwork`; nothing here knows what a road or a leg is. */

import { clear, el } from './dom';

/** A stop, as the page needs it. */
export interface LineStopView {
  id: string;
  name: string;
  /** What stands there — a town, an industry, or nothing. */
  place: string;
  /** How many lines already call there. Zero is the interesting one. */
  onLines: number;
  distance: number;
}

/** One leg of one line, as the page reports it. */
export interface LineLegView {
  from: string;
  to: string;
  connected: boolean;
  /** Metres of road, once joined; metres still missing when not. */
  length: number;
  missing: number;
  vehicle: string;
}

export interface LineRowView {
  id: string;
  name: string;
  /** The calls in order. The same stop may appear twice. */
  calls: { index: number; name: string; place: string }[];
  legs: LineLegView[];
  /** True when adding one more call would be refused. */
  full: boolean;
}

export interface LinePanelView {
  lines: LineRowView[];
  stops: LineStopView[];
  /** Which line the stop list adds to. Null when there is none yet. */
  selected: string | null;
}

export interface LineActions {
  create(): void;
  select(lineId: string): void;
  rename(lineId: string, name: string): void;
  remove(lineId: string): void;
  addCall(lineId: string, stopId: string): void;
  removeCall(lineId: string, index: number): void;
}

/** Builds the whole page into one node. Rebuilt whenever anything changes, which is only
 *  ever because the player pressed something on it. */
export function buildLinePanel(view: LinePanelView, actions: LineActions): HTMLElement {
  const root = el('div', 'lines');

  const bar = el('div', 'lines-bar');
  const add = el('button', 'lines-button', '路線を新しく作る');
  add.addEventListener('click', () => actions.create());
  bar.append(add, el('div', 'lines-hint', '停留所を順に加えると区間ができる。2 か所なら往復、3 か所以上なら循環する'));
  root.appendChild(bar);

  if (view.lines.length === 0) {
    root.appendChild(
      el('div', 'lines-empty', 'まだ路線が無い。停留所を 2 つ置いてから、ここで 1 本作る。'),
    );
  }

  for (const line of view.lines) {
    const selected = line.id === view.selected;
    const box = el('div', `lines-line${selected ? ' selected' : ''}`);

    const head = el('div', 'lines-head');
    const name = el('input', 'lines-name') as HTMLInputElement;
    name.value = line.name;
    // Committed on blur and on Enter rather than on every keystroke: renaming rebuilds the
    // page, and a page that rebuilds under the caret is a page nobody can type into.
    name.addEventListener('change', () => actions.rename(line.id, name.value.trim() || line.name));
    const pick = el('button', 'lines-button', selected ? '編集中' : 'これを編集');
    pick.addEventListener('click', () => actions.select(line.id));
    const drop = el('button', 'lines-button danger', '廃止');
    drop.addEventListener('click', () => actions.remove(line.id));
    head.append(name, pick, drop);
    box.appendChild(head);

    const calls = el('div', 'lines-calls');
    if (line.calls.length === 0) calls.appendChild(el('div', 'lines-empty', 'まだどこにも寄らない'));
    for (const call of line.calls) {
      const row = el('div', 'lines-call');
      row.append(
        el('div', 'lines-call-index', `${call.index + 1}`),
        el('div', 'lines-call-name', call.name),
        el('div', 'lines-call-place', call.place),
      );
      const off = el('button', 'lines-button small', '外す');
      off.addEventListener('click', () => actions.removeCall(line.id, call.index));
      row.appendChild(off);
      calls.appendChild(row);
    }
    box.appendChild(calls);

    if (line.legs.length > 0) {
      const legs = el('div', 'lines-legs');
      for (const leg of line.legs) {
        const state = leg.connected
          ? `${leg.vehicle} ${Math.round(leg.length)}m`
          : `未接続 あと ${Math.round(leg.missing)}m`;
        legs.appendChild(
          el('div', `lines-leg ${leg.connected ? 'linked' : 'broken'}`, `${leg.from} → ${leg.to} — ${state}`),
        );
      }
      box.appendChild(legs);
    }
    root.appendChild(box);
  }

  root.appendChild(el('div', 'lines-heading', '停留所'));
  const stops = el('div', 'lines-stops');
  if (view.stops.length === 0) {
    stops.appendChild(el('div', 'lines-empty', '停留所がまだ 1 つも無い。停留所を持って地面を右クリック。'));
  }
  for (const stop of view.stops) {
    // A stop no line calls at is the one thing on this page worth pointing out: it is
    // what the player almost certainly meant to do next.
    const row = el('div', `lines-stop${stop.onLines === 0 ? ' idle' : ''}`);
    row.append(
      el('div', 'lines-stop-name', stop.name),
      el('div', 'lines-stop-place', stop.place),
      el('div', 'lines-stop-lines', stop.onLines > 0 ? `路線 ${stop.onLines}` : '路線なし'),
      el('div', 'lines-stop-distance', `${Math.round(stop.distance)}m`),
    );
    const line = view.lines.find((entry) => entry.id === view.selected);
    const call = el('button', 'lines-button small', '加える');
    if (!line || line.full) call.setAttribute('disabled', 'true');
    call.addEventListener('click', () => {
      if (view.selected) actions.addCall(view.selected, stop.id);
    });
    row.appendChild(call);
    stops.appendChild(row);
  }
  root.appendChild(stops);
  return root;
}

/** Replaces the contents of an already mounted panel. */
export function refreshLinePanel(root: HTMLElement, view: LinePanelView, actions: LineActions): void {
  clear(root);
  root.appendChild(buildLinePanel(view, actions));
}
