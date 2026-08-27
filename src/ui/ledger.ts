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
  /** The buildings at each end, when the villages are known. */
  fromDepot: string | null;
  toDepot: string | null;
  good: string;
  connected: boolean;
  length: number;
  missing: number;
  /** How much is left, in metres and in blocks of road — a dashed road may be laid every
   *  twenty, so the two numbers are very different jobs. */
  gap: string;
  grade: string;
  load: number;
  porters: number;
  delivered: number;
  /** 荷運び or 荷車 — what the width of the road buys. */
  vehicle: string;
  /** Blocks of up and down, and the road divided by the straight line. Both are charged:
   *  climb as time, detour as a fare that does not grow with it. */
  climb: number;
  detour: number;
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
  routes.appendChild(
    row('ledger-row head', ['区間', '品', '状態', '路面', '運ぶ手段', '一度に運ぶ量', '勾配・遠回り', '荷運び', '運んだ量']),
  );
  if (view.routes.length === 0) {
    routes.appendChild(el('div', 'ledger-empty', '2 つの村を歩ける道でつなぐと、ここに輸送路が並ぶ。'));
  }
  for (const route of view.routes) {
    routes.appendChild(
      row(`ledger-row ${route.connected ? 'linked' : 'broken'}`, [
        route.fromDepot && route.toDepot
          ? `${route.from}・${route.fromDepot} ⇄ ${route.to}・${route.toDepot}`
          : `${route.from} ⇄ ${route.to}`,
        route.good,
        route.connected ? `接続済み ${Math.round(route.length)}m` : `未接続 ${route.gap}`,
        route.connected ? route.grade : '—',
        route.connected ? route.vehicle : '—',
        route.connected ? `${route.load}` : '—',
        route.connected ? `登り ${route.climb} / ×${route.detour.toFixed(2)}` : '—',
        `${route.porters}`,
        `${route.delivered}`,
      ]),
    );
  }
  root.appendChild(routes);

  root.appendChild(
    el(
      'div',
      'ledger-note',
      '舗装は速さ、幅は運ぶ手段を決める — 全区間が幅 3 マスなら荷車が走り、一度に 3 倍運ぶ。' +
        '全区間がレールなら列車が走り、速さも積む量も上がる（幅は問わない）。' +
        '登りは時間を食い、遠回りしても運賃は増えない（運賃は直線距離ぶん）。' +
        '荷は在庫のあるほうの村から出る（在庫 1 個から出発する）。工房は原料が届くまで何も作らない。' +
        '荷は村の「集荷所」の戸口から出て戸口へ入る — 建物を見て F キーで変えられる。',
    ),
  );
  return root;
}

/** Replaces the contents of an already mounted ledger. */
export function refreshLedger(root: HTMLElement, view: LedgerView): void {
  clear(root);
  root.appendChild(buildLedger(view));
}
