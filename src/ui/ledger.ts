/** The trade ledger: every town the player has found, every industry they have built, and
 *  every leg of every line they have drawn.
 *
 *  A network is something you plan, and you cannot plan from a compass needle. This is
 *  the one place the whole thing is legible at once — who makes what, who is short of
 *  what, and which roads are actually paying. */

import { clear, el } from './dom';

export interface LedgerVillage {
  name: string;
  produces: string;
  /** What the works has to be fed, and how much of each is waiting. A craft that takes two
   *  things is why this is a list: one of them arriving is not the works running. */
  inputs: { label: string; held: number }[];
  needs: string[];
  stock: number;
  stage: number;
  points: number;
  /** Points still wanted for the next rank, or 0 when it can grow no further. */
  toNext: number;
  /** The numeric stages are unlimited; this is true only when the land search failed. */
  growthStopped: boolean;
  received: number;
  distance: number;
  /** True when the works has run out of one of its inputs, which is the interesting
   *  failure. */
  starved: boolean;
  /** People living and working in the town, and how many of them are waiting for a way
   *  out of it. A queue with nowhere to go is a route worth opening. */
  people: number;
  waiting: number;
  /** What the buildings themselves are short of, most wanted first. Different from
   *  `needs`, which is what the village as a whole asks for: this is the shopping list of
   *  the homes and shops inside it, and it is what makes a town quiet when it is unmet. */
  wants: string[];
}

/** One building of the town the player is standing in. */
export interface LedgerBuilding {
  label: string;
  use: string;
  /** People who live here, or jobs here. */
  people: number;
  /** Jobs currently filled by somebody who walked in. A shop with nobody in it sells
   *  nothing, which is the whole reason the walking is simulated. */
  staff: number;
  /** Customers in a shop right now. Nothing else has any: this is the number that says
   *  where the delivered stock is actually going. */
  customers: number;
  /** True for a building whose people are staff rather than residents. */
  staffed: boolean;
  /** What it is waiting for, and how much of it is in. */
  wants: { good: string; held: number; of: number }[];
}

/** The town the player is standing in, when they are standing in one. */
export interface LedgerTown {
  name: string;
  people: number;
  waiting: number;
  /** The town's own fields: what it works, and what is at the depot waiting to be carried
   *  in. Nothing the player has to act on — which is the point of showing it. */
  fields: { parcels: number; area: number; harvest: number };
  buildings: LedgerBuilding[];
}

/** One primary industry, as the ledger reports it. */
export interface LedgerIndustry {
  name: string;
  /** Which kind of industry it is. The name is built from this, but a works loaded out of
   *  an old save may not carry it, and the table has room to be explicit. */
  kind: string;
  good: string;
  /** How much faster than the baseline the ground it stands on works out at. Fixed the day
   *  it was built, so it is a property of the place and worth reading. */
  richness: number;
  stock: number;
  /** True when it has filled up with nowhere to send anything, which is the one thing an
   *  industry can be wrong about and the player can fix. */
  full: boolean;
  shipped: number;
  /** Whether any stop stands near enough to collect from it. */
  served: boolean;
  distance: number;
}

export interface LedgerRoute {
  /** The line this leg belongs to. Legs of one line read as one service. */
  line: string;
  from: string;
  to: string;
  /** What stands at each end — a town, an industry, or nothing yet. */
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
  /** 荷運び・荷車・馬車・列車・船 — what the way between the two stops turned out to be. */
  vehicle: string;
  /** Blocks of up and down, and the road divided by the straight line. Both are charged:
   *  climb as time, detour as a fare that does not grow with it. */
  climb: number;
  detour: number;
}

export interface LedgerView {
  villages: LedgerVillage[];
  industries: LedgerIndustry[];
  routes: LedgerRoute[];
  /** The town underfoot, so the player can read the place they are in rather than only
   *  the network they are building. Null anywhere else. */
  town: LedgerTown | null;
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
    el('div', 'ledger-stat', `町 ${view.villages.length}`),
    el('div', 'ledger-stat', `産業 ${view.industries.length}`),
    el('div', 'ledger-stat', `つながった区間 ${view.routes.filter((r) => r.connected).length} / ${view.routes.length}`),
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

  root.appendChild(el('div', 'ledger-heading', '町'));
  const villages = el('div', 'ledger-table');
  villages.appendChild(
    row('ledger-row head',
      ['町', '工場', '在庫', '求めている物', '町が待っている物', '人口', '発展', '距離']),
  );
  if (view.villages.length === 0) {
    villages.appendChild(el('div', 'ledger-empty', 'まだ町を見つけていない。コンパスの村マーカーを目指そう。'));
  }
  for (const village of view.villages) {
    const produces = village.inputs.length > 0
      ? `${village.inputs.map((i) => i.label).join(' + ')} → ${village.produces}`
      : village.produces;
    const grow = village.growthStopped
      ? '土地なし'
      : `${village.points} / ${village.toNext}`;
    const node = row(`ledger-row${village.starved ? ' starved' : ''}`, [
      village.name,
      produces,
      village.inputs.length > 0
        ? `${village.stock}（材料 ${village.inputs.map((i) => `${i.label} ${i.held}`).join('・')}）`
        : `${village.stock}`,
      village.needs.length > 0 ? village.needs.join('・') : '—',
      // Only the two most wanted: the whole list is every good every building is short
      // of, which for a 都市 is a paragraph and not a column.
      village.wants.length > 0 ? village.wants.slice(0, 2).join('・') : '—',
      // The queue only shows where there is one: a village nobody can leave is the normal
      // case until somebody opens a route, and a column of zeroes would say nothing.
      village.waiting > 0 ? `${village.people}（待ち ${village.waiting}）` : `${village.people}`,
      grow,
      `${Math.round(village.distance)}m`,
    ]);
    if (village.starved) node.title = '材料が届いていないので何も作れていない';
    villages.appendChild(node);
  }
  root.appendChild(villages);

  if (view.town) {
    root.appendChild(el('div', 'ledger-heading', `${view.town.name}の建物`));
    const summary = el('div', 'ledger-summary');
    summary.append(
      el('div', 'ledger-stat', `人口 ${view.town.people}`),
      el('div', 'ledger-stat', `旅に出たい人 ${view.town.waiting}`),
      el(
        'div',
        'ledger-stat',
        `畑 ${view.town.fields.parcels} 区画・${view.town.fields.area} マス`,
      ),
      el('div', 'ledger-stat', `収穫の在庫 ${view.town.fields.harvest}`),
    );
    root.appendChild(summary);
    const table = el('div', 'ledger-table');
    table.appendChild(row('ledger-row head', ['建物', '用途', '人', '働いている人', '客', '待っている物']));
    for (const building of view.town.buildings) {
      const wants = building.wants.length > 0
        ? building.wants.map((w) => `${w.good} ${w.held}/${w.of}`).join('・')
        : '—';
      // A shop with nobody in it is not broken and it is not selling either, and the
      // difference between those two is the one thing this table is here to say.
      const idle = building.people > 0 && building.staff === 0 && building.staffed;
      const node = row(`ledger-row${idle ? ' starved' : ''}`, [
        building.label,
        building.use,
        `${building.people}`,
        building.staffed ? `${building.staff} / ${building.people}` : '—',
        // Only a shop has customers, and only a shop's stock leaves by the door.
        building.customers > 0 ? `${building.customers}` : building.use === '商店' ? '0' : '—',
        wants,
      ]);
      if (idle) node.title = 'まだ誰も来ていないので、何も売れていない';
      table.appendChild(node);
    }
    root.appendChild(table);
  }

  root.appendChild(el('div', 'ledger-heading', '産業'));
  const industries = el('div', 'ledger-table');
  industries.appendChild(
    row('ledger-row head', ['産業', '種類', '掘り出す物', '産出', '在庫', '出荷済み', '停留所', '距離']),
  );
  if (view.industries.length === 0) {
    industries.appendChild(
      el('div', 'ledger-empty', 'まだ産業がない。産業設置具を持って鉱脈・砂地・森・草原を右クリック。'),
    );
  }
  for (const works of view.industries) {
    const node = row(`ledger-row${works.full || !works.served ? ' starved' : ''}`, [
      works.name,
      works.kind,
      works.good,
      `×${works.richness.toFixed(1)}`,
      works.full ? `${works.stock}（満杯）` : `${works.stock}`,
      `${works.shipped}`,
      works.served ? '有り' : 'まだ無い',
      `${Math.round(works.distance)}m`,
    ]);
    if (!works.served) node.title = '停留所が近くにない。ここから何も出ていかない';
    else if (works.full) node.title = '積み上がったまま。路線がここに来ていないか、行き先が要らない品';
    industries.appendChild(node);
  }
  root.appendChild(industries);

  root.appendChild(el('div', 'ledger-heading', '路線の区間'));
  const routes = el('div', 'ledger-table');
  routes.appendChild(
    row('ledger-row head', ['路線', '区間', '品', '状態', '路面', '運ぶ手段', '一度に運ぶ量', '勾配・遠回り', '荷運び', '運んだ量']),
  );
  if (view.routes.length === 0) {
    routes.appendChild(
      el('div', 'ledger-empty', '停留所を 2 つ置き、[N] の路線表で 1 本の路線に並べると、ここに区間が並ぶ。'),
    );
  }
  for (const route of view.routes) {
    routes.appendChild(
      row(`ledger-row ${route.connected ? 'linked' : 'broken'}`, [
        route.line,
        route.fromDepot && route.toDepot
          ? `${route.fromDepot} ⇄ ${route.toDepot}`
          : `${route.from} ⇄ ${route.to}`,
        route.good,
        route.connected ? `接続済み ${Math.round(route.length)}m` : `未接続 ${route.gap}`,
        route.connected ? route.grade : '—',
        route.connected ? route.vehicle : '—',
        route.connected ? `${route.load}` : '—',
        route.connected ? `登り ${Math.round(route.climb)} / ×${route.detour.toFixed(2)}` : '—',
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
      '道があるだけでは荷は動かない — 停留所を置き、路線に並べて初めて便が出る。' +
        '舗装は速さ、幅は運ぶ手段を決める — 全区間が幅 3 マスなら荷車が走り、一度に 3 倍運ぶ。' +
        '同じ道でも人を運ぶ便は馬車になり、荷車より多く速く運ぶ。' +
        '線路が両方の停留所に届いていれば列車が走り、速さも積む量も上がる（道は関係ない）。' +
        'ただし線路の勾配と曲線は速さに効く — パネルの「線形」がその区間の目減りぶん。' +
        '両端が海際なら、何も建てなくても船が渡る。陸路と海路があるときは速いほうを使う。' +
        '登りは時間を食い、遠回りしても運賃は増えない（運賃は直線距離ぶん）。' +
        '原料は産業から、加工品は町の工場から出る。工場は原料が全種類そろうまで何も作らない。' +
        '荷は町の「集荷所」の戸口から出て戸口へ入る — 建物を見て F キーで変えられる。' +
        '町の住宅からは人が働きに出る。人が来た商店・工場だけが品物を使うので、' +
        '通う人がいない建物は何も欲しがらない。旅に出たい人は、荷の無い便に乗って隣の町へ行く。',
    ),
  );
  return root;
}

/** Replaces the contents of an already mounted ledger. */
export function refreshLedger(root: HTMLElement, view: LedgerView): void {
  clear(root);
  root.appendChild(buildLedger(view));
}
