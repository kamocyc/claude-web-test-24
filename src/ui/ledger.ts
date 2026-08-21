/** The trade ledger: every village the player has found and every route between them.
 *
 *  A network is something you plan, and you cannot plan from a compass needle. This is
 *  the one place the whole thing is legible at once — who makes what, who is short of
 *  what, and which roads are actually paying. */

import { clear, el } from './dom';

export interface LedgerVillage {
  name: string;
  kind: string;
  produces: string;
  /** A workshop's input, and how much of it is waiting. Null elsewhere. */
  input: string | null;
  inputStock: number;
  needs: string[];
  stock: number;
  stage: number;
  points: number;
  /** Points still wanted for the next rank, or 0 when it can grow no further. */
  toNext: number;
  received: number;
  distance: number;
  /** True when a workshop has nothing to work with, which is the interesting failure. */
  starved: boolean;
}

export interface LedgerRoute {
  from: string;
  to: string;
  good: string;
  connected: boolean;
  length: number;
  missing: number;
  grade: string;
  load: number;
  porters: number;
  delivered: number;
}

export interface LedgerView {
  villages: LedgerVillage[];
  routes: LedgerRoute[];
  /** Emeralds the network has paid the player so far. */
  earnings: number;
  objective: { title: string; detail: string } | null;
}

function row(className: string, cells: (string | HTMLElement)[]): HTMLElement {
  const node = el('div', className);
  for (const cell of cells) {
    node.appendChild(typeof cell === 'string' ? el('div', 'ledger-cell', cell) : cell);
  }
  return node;
}

/** Renders the whole ledger into one node. Rebuilt each time it is opened, which is
 *  rare enough that nothing here has to be incremental. */
export function buildLedger(view: LedgerView): HTMLElement {
  const root = el('div', 'ledger');

  const summary = el('div', 'ledger-summary');
  summary.append(
    el('div', 'ledger-stat', `村 ${view.villages.length}`),
    el('div', 'ledger-stat', `輸送路 ${view.routes.filter((r) => r.connected).length} / ${view.routes.length}`),
    el('div', 'ledger-stat', `運賃の総額 エメラルド ${view.earnings}`),
  );
  root.appendChild(summary);

  if (view.objective) {
    const goal = el('div', 'ledger-goal');
    goal.append(
      el('div', 'ledger-goal-title', view.objective.title),
      el('div', 'ledger-goal-detail', view.objective.detail),
    );
    root.appendChild(goal);
  }

  root.appendChild(el('div', 'ledger-heading', '村'));
  const villages = el('div', 'ledger-table');
  villages.appendChild(row('ledger-row head', ['村', '種類', '生産', '在庫', '求めている物', '発展', '距離']));
  if (view.villages.length === 0) {
    villages.appendChild(el('div', 'ledger-empty', 'まだ村を見つけていない。コンパスの村マーカーを目指そう。'));
  }
  for (const village of view.villages) {
    const produces = village.input
      ? `${village.input} → ${village.produces}`
      : village.produces;
    const grow = village.toNext > 0 ? `${village.points} / ${village.toNext}` : '最大';
    const node = row(`ledger-row${village.starved ? ' starved' : ''}`, [
      village.name,
      village.kind,
      produces,
      village.input ? `${village.stock}（材料 ${village.inputStock}）` : `${village.stock}`,
      village.needs.length > 0 ? village.needs.join('・') : '—',
      grow,
      `${Math.round(village.distance)}m`,
    ]);
    if (village.starved) node.title = '材料が届いていないので何も作れていない';
    villages.appendChild(node);
  }
  root.appendChild(villages);

  root.appendChild(el('div', 'ledger-heading', '輸送路'));
  const routes = el('div', 'ledger-table');
  routes.appendChild(row('ledger-row head', ['区間', '品', '状態', '路面', '一度に運ぶ量', '荷運び', '運んだ量']));
  if (view.routes.length === 0) {
    routes.appendChild(el('div', 'ledger-empty', '2 つの村を歩ける道でつなぐと、ここに輸送路が並ぶ。'));
  }
  for (const route of view.routes) {
    routes.appendChild(
      row(`ledger-row ${route.connected ? 'linked' : 'broken'}`, [
        `${route.from} ⇄ ${route.to}`,
        route.good,
        route.connected ? `接続済み ${Math.round(route.length)}m` : `未接続 あと ${Math.round(route.missing)}m`,
        route.connected ? route.grade : '—',
        route.connected ? `${route.load}` : '—',
        `${route.porters}`,
        `${route.delivered}`,
      ]),
    );
  }
  root.appendChild(routes);

  root.appendChild(
    el('div', 'ledger-note', '道を良い材質で舗装すると荷運びが速くなり、一度に運ぶ量も増える。'),
  );
  return root;
}

/** Replaces the contents of an already mounted ledger. */
export function refreshLedger(root: HTMLElement, view: LedgerView): void {
  clear(root);
  root.appendChild(buildLedger(view));
}
