/** 遊びかた — the manual, assembled from the systems it describes.
 *
 *  Every number on this page is imported rather than written down. A manual that is
 *  typed out separately is a manual that is wrong by the second patch, and the things
 *  worth explaining here are exactly the things that get tuned: what counts as a road,
 *  what a stage costs, what pavement is worth, what a cart needs.
 *
 *  What the player is being told is one loop with four levers on it — find, join, pave,
 *  widen — so the page is ordered that way rather than by which module owns what. */

import { itemLabel } from '../game/items';
import { MILESTONES, QUEST_STEPS, type QuestStep } from '../game/questline';
import {
  CLIMB_COST,
  HEADROOM,
  MAX_STEP,
  ROAD_SPEED,
  roadGrade,
} from '../game/roads';
import {
  BLOCKS_PER_PORTER,
  CART_LOAD,
  MAX_PORTERS,
  loadFor,
} from '../game/transport';
import {
  CRAFTS,
  MAX_STAGE,
  MAX_STOCK,
  NEEDED_POINTS,
  PRODUCE_SECONDS,
  RANKS,
  STAGE_POINTS,
  kindLabel,
} from '../game/villages';
import { blockDef, type BlockId } from '../world/blocks';
import { clear, el } from './dom';

/** Every key the game binds, in one place. The title screen prints the same list, so a
 *  new key is added once and appears in both. */
export const KEYS: readonly { key: string; what: string }[] = [
  { key: 'WASD', what: '移動' },
  { key: 'Space', what: 'ジャンプ' },
  { key: 'Shift', what: '忍び足' },
  { key: 'Ctrl', what: 'ダッシュ' },
  { key: '左クリック', what: '採掘・攻撃' },
  { key: '右クリック', what: '設置・使用・交易' },
  { key: 'シャベル＋右クリック長押し', what: '歩きながら道を敷く（周囲 3×3）' },
  { key: 'R', what: '見ている所（20 マス先まで）から足もとまで道を敷く' },
  { key: 'F', what: '見ている建物をその村の集荷所にする' },
  { key: '1-9 / ホイール', what: 'ホットバー' },
  { key: 'E', what: '持ち物' },
  { key: 'L', what: '交易台帳' },
  { key: 'H', what: 'この画面' },
  { key: '[ ]', what: 'ゲーム速度を下げる／上げる（世界の時計だけ、×1〜×16）' },
  { key: 'G', what: '座標へワープ' },
  { key: 'F3', what: 'デバッグ表示' },
  { key: 'Esc', what: 'ポーズ' },
];

export type StepState = 'done' | 'current' | 'todo';

export interface HelpStep {
  label: string;
  detail: string;
  state: StepState;
  /** Emeralds paid on completion, for the goals that pay. */
  reward?: number;
}

export interface HelpSection {
  heading: string;
  notes: string[];
  steps?: HelpStep[];
  table?: { head: string[]; rows: string[][] };
}

export interface HelpView {
  /** What the player is being asked to do right now, repeated at the top so the manual
   *  answers "and what was I doing?" as well as "how does this work?". */
  objective: { title: string; detail: string } | null;
  sections: HelpSection[];
}

/** The live bits: everything else on the page is a constant. */
export interface HelpState {
  step: QuestStep;
  /** How far down `MILESTONES` the player has got. */
  milestone: number;
  objective: { title: string; detail: string } | null;
}

function blockLabel(id: BlockId): string {
  return blockDef(id).label;
}

/** Surfaces grouped by what they are worth, so the table is five rows rather than seven
 *  with duplicates — the player is choosing a speed, not a block. */
function surfaceRows(): string[][] {
  const bySpeed = new Map<number, BlockId[]>();
  for (const [block, speed] of ROAD_SPEED) {
    const list = bySpeed.get(speed);
    if (list) list.push(block);
    else bySpeed.set(speed, [block]);
  }
  return [...bySpeed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([speed, blocks]) => [
      blocks.map(blockLabel).join(' / '),
      roadGrade(speed),
      `${speed.toFixed(2)} 倍`,
      `${loadFor(speed)}（荷車なら ${loadFor(speed) * CART_LOAD}）`,
    ]);
}

function stageRows(): string[][] {
  return RANKS.map((rank, stage) => [
    rank,
    stage === 0 ? '最初から' : `発展度 ${STAGE_POINTS[stage - 1]}`,
    stage === MAX_STAGE ? 'ここまで' : '家が増え、生産が速くなり、欲しがる物が増える',
  ]);
}

export function helpView(state: HelpState): HelpView {
  const reached = QUEST_STEPS.findIndex((s) => s.step === state.step);
  const sections: HelpSection[] = [
    {
      heading: 'この遊びの全体',
      notes: [
        '村を見つけ、村と村を歩ける道でつなぐ。つながった道はそのまま輸送路になり、荷運びが自分で歩いて品物を運ぶ。',
        '荷が届いた村は発展して建物が増え、取引が広がり、もっと多くの物を欲しがるようになる。届けるたびに運賃がエメラルドで入る。',
        '道に手を入れる所は 4 つ。つなぐ（1 マスも空けない）、舗装する（速さ）、広げる（荷車）、平らにする（勾配）。',
      ],
    },
    {
      heading: 'チュートリアル',
      notes: [],
      steps: QUEST_STEPS.map((step, index) => ({
        label: step.label,
        detail: step.detail,
        state: reached < 0 ? 'todo' : index < reached ? 'done' : index === reached ? 'current' : 'todo',
      })),
    },
    {
      heading: '目標（チュートリアルのあと）',
      notes: ['順に出る。達成するとエメラルドが入り、左のパネルと台帳に次の目標が出る。'],
      steps: MILESTONES.map((milestone, index) => ({
        label: milestone.title,
        detail: '',
        reward: milestone.reward,
        state:
          state.step !== 'done'
            ? 'todo'
            : index < state.milestone
              ? 'done'
              : index === state.milestone
                ? 'current'
                : 'todo',
      })),
    },
    {
      heading: '道 — 「つながっている」の条件',
      notes: [
        '次の 4 つを全部満たすマスだけが「道の列」になる。見た目ではなく、この判定がすべて。',
        '1. 自分（か村の増築）が置いたブロックであること — 生成されただけの地面は道ではない',
        `2. 道の材質であること — ${[...ROAD_SPEED.keys()].map(blockLabel).join(' / ')}`,
        `3. 頭上が ${HEADROOM} マス空いていること — 木の枝が張り出していたら道にならない`,
        `4. 上下左右のとなりに道の列があり、高低差が ${MAX_STEP} マス以内であること（斜めはつながらない）`,
        '1 マスでも抜けたら、そこで路線は切れる。斜めに置いた列どうしもつながらない — 角は必ず埋める。',
        '切れている所は世界に赤い光の柱、ミニマップに赤い点、左のパネルに理由が出る。',
        '村の側は、村の十字の通りの腕に隣接すれば到着。中心まで来る必要はない。',
      ],
    },
    {
      heading: '道の敷き方',
      notes: [
        '材料は要らない。草・土・砂・雪・天然の砂利が「踏み固めた土」になる。誰かが舗装した石畳などはそのまま残る。',
        '2 マス以上の段差は掃き敷きでは越えられない。そこは R で削る／埋める。',
      ],
      table: {
        head: ['操作', 'すること'],
        rows: [
          ['シャベルを持って右クリック長押し', 'カーソルのマスとその周囲 8 マスを道にし続ける（歩きながら使える）'],
          ['R', '見ている所から足もとまでを一気に道にする。坂は削り、窪みは橋で渡し、角は階段状に折る'],
        ],
      },
    },
    {
      heading: '路面 — 速さと積む量',
      notes: ['速度は「敷いた区間の距離 ÷ 所要時間」の加重平均。長い土の道に石レンガを 10 マス足しても大して変わらない。'],
      table: { head: ['路面', '呼び名', '速さ', '一度に運ぶ量'], rows: surfaceRows() },
    },
    {
      heading: '荷車 — 幅 3 マスの道だけを通る',
      notes: [
        '路線の全区間で「道の列が 3 つ一直線に並んでいる」なら、荷運びの代わりに荷車が出る。',
        `荷車は一度に ${CART_LOAD} 倍運ぶ。速さは変わらない — 速さは舗装、量は幅。`,
        '村の通りは最初から幅 3 なので、広げるのは村と村の間だけ。掃き敷きは 3×3 なので、できた道の上をもう一度歩けば広がる。',
        '1 か所でも狭いと荷車は出ない。その場所には琥珀色の光の柱が立ち、パネルが方角と距離を言う。',
      ],
    },
    {
      heading: '荷が出る条件（動かないときはここ）',
      notes: [
        `生産するのは発見済みの村だけ。1 個あたり ${PRODUCE_SECONDS} 秒 ÷（1 + 0.35 × 発展度）、在庫の上限は ${MAX_STOCK} 個。`,
        '工房の村は原料が届くまで 1 個も作らない。 何も作れない間は時間も溜め込まないので、原料が着いてから数え始める。',
        '在庫が 1 個でもあれば荷は出発する。 満載は待たない（満載なら一度に運ぶ量まで積むだけ）。',
        '荷は在庫のあるほうの村から出る。 工房どうしをつないでも、相手が原料を持っていれば向こうから荷運びが来る。',
        `1 本の路線に出る荷運びは ${BLOCKS_PER_PORTER} ブロックごとに 1 人、最大 ${MAX_PORTERS} 人。前の 1 人が 15% 進むまで次は出ない。`,
        '同じ村から出ている路線は在庫を分け合う。 取る順番は毎回ずれるので、片方だけが永久に空になることはない。',
        'つながっているのに何も動かないときは、左のパネルがどれに当たっているかを言う。',
      ],
    },
    {
      heading: '勾配と遠回り',
      notes: [
        `登り 1 マスは平地 ${CLIMB_COST} マスぶんの時間として数える。段差だらけの道は「けもの道」まで質が落ちる。`,
        '経路探索も時間の最短で選ぶので、平らな回り道は階段状の近道に勝つ。',
        '運賃は道の長さではなく、集荷所どうしの直線距離で払う。遠回りしても運賃は増えず、時間だけ増える。',
      ],
    },
    {
      heading: '村',
      notes: [
        `種類は 3 つ: ${(['farm', 'mine', 'workshop'] as const).map(kindLabel).join(' / ')}。工房は原料 1 個を加工品 1 個に変えるので、原料が届くまで何も作らない。`,
        `加工: ${CRAFTS.map((c) => `${itemLabel(c.input)}→${itemLabel(c.output)}`).join('、')}`,
        `村は自分が作れない物を欲しがる。求めている品を届けると発展度は ${NEEDED_POINTS} 倍。`,
        '荷運びは帰り道も空ではない。出発村が到着村の生産品を欲しがっていれば、それを積んで帰る。',
      ],
      table: { head: ['段階', '必要な発展度', '変わること'], rows: stageRows() },
    },
    {
      heading: '操作',
      notes: [],
      table: { head: ['キー', 'すること'], rows: KEYS.map((k) => [k.key, k.what]) },
    },
  ];
  return { objective: state.objective, sections };
}

function tableOf(spec: { head: string[]; rows: string[][] }): HTMLElement {
  const table = el('div', 'help-table');
  table.appendChild(rowOf('help-row head', spec.head));
  for (const row of spec.rows) table.appendChild(rowOf('help-row', row));
  return table;
}

function rowOf(className: string, cells: string[]): HTMLElement {
  const node = el('div', className);
  for (const cell of cells) node.appendChild(el('div', 'help-cell', cell));
  return node;
}

const MARK: Record<StepState, string> = { done: '✓', current: '▶', todo: '·' };

/** Renders the manual into `host`, replacing whatever was there. */
export function refreshHelp(host: HTMLElement, view: HelpView): void {
  clear(host);
  const root = el('div', 'help');
  if (view.objective) {
    const goal = el('div', 'help-goal');
    goal.appendChild(el('div', 'help-goal-title', `いまの目標: ${view.objective.title}`));
    goal.appendChild(el('div', 'help-goal-detail', view.objective.detail));
    root.appendChild(goal);
  }
  for (const section of view.sections) {
    root.appendChild(el('div', 'help-heading', section.heading));
    for (const note of section.notes) root.appendChild(el('div', 'help-note', note));
    if (section.steps) {
      const list = el('div', 'help-steps');
      for (const step of section.steps) {
        const node = el('div', `help-step ${step.state}`);
        node.appendChild(el('div', 'help-mark', MARK[step.state]));
        const text = el('div', 'help-step-text');
        const reward = step.reward === undefined ? '' : ` +${step.reward} エメラルド`;
        text.appendChild(el('div', 'help-step-label', `${step.label}${reward}`));
        if (step.detail) text.appendChild(el('div', 'help-step-detail', step.detail));
        node.appendChild(text);
        list.appendChild(node);
      }
      root.appendChild(list);
    }
    if (section.table) root.appendChild(tableOf(section.table));
  }
  host.appendChild(root);
}
