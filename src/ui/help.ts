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
import { USE_LABELS } from '../game/buildings';
import {
  CELL_STOCK,
  COMMUTE_EVERY,
  HOME_PEOPLE,
  HOUSEHOLD_GOODS,
  JOURNEY_SECONDS,
  SHOP_GOODS,
  SHOP_JOBS,
  WORKS_JOBS,
} from '../game/townEconomy';
import { MILESTONES, QUEST_STEPS, type QuestStep } from '../game/questline';
import { CHANNEL_EVERY, FIELD_SIZE } from '../world/generation/fields';
import {
  EASY_RADIUS,
  GAUGE,
  MAX_GRADE,
  MAX_SWITCH_ANGLE,
  MAX_SPAN,
  MIN_RADIUS,
  STATION_REACH,
  TRACK_WIDTH,
  curvePace,
  gradePace,
} from '../game/tracks';
import {
  CLIMB_COST,
  HEADROOM,
  MAX_STEP,
  ROAD_SPEED,
  roadGrade,
} from '../game/roads';
import {
  BLOCKS_PER_PORTER,
  BUS_LOAD,
  BUS_PACE,
  CART_LOAD,
  MAX_PORTERS,
  RAIL_QUALITY,
  SHIP_LOAD,
  OVERSPEED_GRACE,
  PLATFORM_STOP,
  SHIP_QUALITY,
  TRAIN_LOAD,
  WAGON_LOAD,
  loadFor,
} from '../game/transport';
import { HARBOUR_REACH, MIN_DEPTH } from '../game/sea';
import {
  CRAFTS,
  MAX_STAGE,
  MAX_STOCK,
  NEEDED_POINTS,
  PRODUCE_SECONDS,
  RANKS,
  STAGE_POINTS,
} from '../game/villages';
import { MAX_LINE_STOPS, STOP_SPACING, STOP_TOWN_REACH } from '../game/lines';
import {
  DEPOSIT_DOWN,
  DEPOSIT_RADIUS,
  DEPOSIT_UP,
  INDUSTRY_SPACING,
  INDUSTRY_TYPES,
  MAX_INDUSTRY_STOCK,
  MAX_RICHNESS,
} from '../game/industry';
import { blockDef, type BlockId } from '../world/blocks';
import { clear, el } from './dom';

/** Every key the game binds, in one place. The title screen prints the same list, so a
 *  new key is added once and appears in both. */
export const KEYS: readonly { key: string; what: string }[] = [
  { key: 'WASD', what: '移動' },
  { key: 'Space', what: 'ジャンプ' },
  { key: 'Shift', what: 'ダッシュ（歩行の 2 倍）' },
  { key: 'Ctrl', what: 'ゆっくり歩く（設置対象のブロックを開かずに置く）' },
  { key: '左クリック', what: '採掘・攻撃' },
  { key: '右クリック', what: '設置・使用・交易' },
  { key: 'シャベル＋右クリック長押し', what: '歩きながら道を敷く（周囲 3×3）' },
  { key: 'R', what: '見ている所（20 マス先まで）から足もとまで道を敷く' },
  { key: '線路敷設ツール＋右クリック', what: '始点→終点をクリックして、その間をなめらかな線路でつなぐ' },
  { key: '線路敷設ツール＋左クリック', what: '敷設をやめる／狙っている線路を撤去する' },
  { key: '駅＋右クリック', what: '狙っている線路の端に駅を建てる。駅を狙えば撤去して持ち帰る' },
  { key: '信号機＋右クリック', what: '狙っている線路に信号を建てる。途中を狙えばそこで割ってから建つ' },
  { key: '（敷いた線路）', what: '軌道の上は歩ける。支柱は素通り' },
  { key: '（駅と列車）', what: 'ホームと車両の上・客車の中に乗れる。走り出せば一緒に運ばれる' },
  { key: '停留所＋右クリック', what: '地面に停留所を置く。停留所を狙えば撤去して持ち帰る' },
  { key: '産業設置具＋右クリック', what: '足もとの資源を調べ、足りていれば一次産業を建てる（建たない時は理由が出る）' },
  { key: '（産業に向けて）産業設置具＋右クリック', what: '建てた一次産業を撤去して設置具を返す' },
  { key: 'N', what: '路線表 — 停留所を路線に並べる（並べるまで荷は 1 個も動かない）。線路の路線は「運転する」で自分で走らせられる' },
  { key: 'W / S（運転中）', what: '力行 — ブレーキ。W と S は運転台では歩く足ではなく操作端になる' },
  { key: 'X', what: '運転をやめて降りる' },
  { key: 'F', what: '見ている建物をその村の集荷所にする' },
  { key: '1-9 / ホイール', what: 'ホットバー' },
  { key: 'E', what: '持ち物' },
  { key: 'L', what: '交易台帳' },
  { key: 'H', what: 'この画面' },
  { key: 'M', what: '全画面の地図（＋ / − とホイールで拡大縮小。探索済みの所だけ）' },
  { key: '（地図を）ドラッグ', what: '地図を動かす。クリックでその場所を選ぶ' },
  { key: 'Home', what: '地図を自分の位置に戻す' },
  { key: 'C', what: 'デバッグ: 全アイテムの棚（ポーズ画面で入にしているときだけ）' },
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
      `${loadFor(speed)}（荷車 ${loadFor(speed) * CART_LOAD}）`,
    ]);
}

function stageRows(): string[][] {
  return RANKS.map((rank, stage) => [
    rank,
    stage === 0 ? '最初から' : `発展度 ${STAGE_POINTS[stage - 1]}`,
    stage === MAX_STAGE
      ? '以後も外側へ建物と畑が増える（土地が尽きるまで）'
      : '家が増え、生産が速くなり、欲しがる物が増える',
  ]);
}

export function helpView(state: HelpState): HelpView {
  const reached = QUEST_STEPS.findIndex((s) => s.step === state.step);
  const sections: HelpSection[] = [
    {
      heading: 'この遊びの全体',
      notes: [
        '**道があるだけでは荷は 1 個も動かない。** 停留所を置き、路線に並べて初めて便が出る。徒歩の便も同じ。',
        `供給は 2 段。原料は自分で建てた一次産業から出て、町の工場が加工品に変える。` +
          `その加工品を別の町の住宅と商店が消費する — ${CRAFTS.map((c) => `${c.inputs.map(itemLabel).join('+')}→${itemLabel(c.output)}`).join('、')}。`,
        '町は何も掘らない。原料の出どころは資源のそばに建てた産業だけで、そこをどうつなぐかが遊びのほとんど。',
        '荷が届いた町は発展して建物が増え、もっと多くの物を欲しがるようになる。届けるたびに運賃がエメラルドで入る。',
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
      heading: '馬車 — 同じ道で、荷ではなく人を運ぶ',
      notes: [
        '**車両が積荷で変わる唯一の場所。** 荷車が通れる道（幅 3 マス）で人を運ぶ便が出ると、荷車ではなく馬車になる。同じ道の同じ区間でも、木箱なら荷車、人なら馬車。',
        `馬車は一度に ${BUS_LOAD} 倍運び、しかも ${BUS_PACE.toFixed(2)} 倍だけ速い。舗装だけでは速くならないこの世界で、道の上を速く走る唯一のもの。`,
        '人は荷より後回しなので、まず在庫を出し切った区間に出る。町に出発待ちの人がいて、向こうの町が受け取れるなら走る。',
        '幅が足りない道では人も歩く。馬車を見たければ、まず道を 3 マスに広げること。',
      ],
    },
    {
      heading: '船 — 何も作らずに海を渡る',
      notes: [
        '**海はもうそこにある。** 両端の停留所が海のそばに立っていて、その間が水でつながっているなら、何も建てなくても船の便が出る。道も線路もいらない。',
        `停留所から ${HARBOUR_REACH} マス以内に、深さ ${MIN_DEPTH} マス以上の水があれば港になる。浅瀬は港にならない — 砂浜に停留所を置くのではなく、水際に置く。`,
        `船は ${SHIP_LOAD} 倍運ぶ（この世界で最も多い）。速さは ${SHIP_QUALITY.toFixed(2)} 倍で、列車より遅い。安くて遅くて大量、が船。`,
        '陸路と海路の両方があるときは、**速いほうを勝手に選ぶ**。湾をぐるりと回る道より横断する船が速ければ船になり、地峡に道を通せば道に戻る。',
        '航路は世界の地形から決まる。自分で掘った運河は航路にならない — 船が通るのは、はじめからそこにある海。',
        '荷は集荷所の戸口から岸まで荷運びが運び、そこから先が船になる。向こう岸でまた荷運びに変わる。駅と列車とまったく同じ仕組み。',
      ],
    },
    {
      heading: '鉄道 — 線路敷設ツールで敷く曲線',
      notes: [
        'ブロックを置くのではなく、始点と終点をクリックすると、その間が一本のなめらかな曲線としてつながる。道とは別の物で、道の上に敷くわけではない。',
        '端の向きはクリックしたときのプレイヤーの向き（見上げ／見下ろしは関係ない）。既にそこに線路の端があれば、位置も向きも勾配もその端に合わせるので、継ぎ目に折れができない。',
        `枕木を含めた幅は ${TRACK_WIDTH} マス、軌間は ${GAUGE} マス。地形には一切触らないので、谷の上を渡れば自動で支柱が立つ。`,
        `断られる形もある — 半径 ${MIN_RADIUS} マスより急な曲がり、${Math.round(MAX_GRADE * 100)}% より急な勾配、一度に ${MAX_SPAN} マスを超える長さ。断られる形は下書きが赤い線になるので、首を振っているあいだに分かる。`,
        'レールを使う。1 マスにつき 0.5 本、撤去すると半分だけ返る。ツール自体は作業台で鉄インゴットと棒から作る。',
        '敷いた線路は上を歩ける。曲線も勾配もそのまま踏めて、谷に渡した高架の上も渡れる。支柱は見た目だけで素通りする。',
        '始点を置いているあいだ、十字の下に 長さ・勾配（上り／下りと高低差）・曲がり（左右と半径）が出る。首を振ると中身が変わるので、曲がり方はそれを見て決める。断られる形のときは赤い理由が同じ場所に出る。',
        '材料を集めずに試したいときは、ポーズ画面（Esc）の「デバッグ: 全アイテム無限」を入にする。C で全アイテムの棚が開き、持ち物は減らなくなる。',
      ],
      table: {
        head: ['操作', 'すること'],
        rows: [
          ['右クリック（1 回目）', '始点を置く。線路の端を狙えばそこにつなぐ'],
          ['右クリック（2 回目）', '終点を置いて敷く。断られたら理由が出て、始点はそのまま残る'],
          ['左クリック', '敷設中ならやめる。敷設中でなければ狙っている線路を撤去する'],
        ],
      },
    },
    {
      heading: '駅 — 線路の両端に建てないと荷は動かない',
      notes: [
        '線路をつないだだけでは荷は動かない。線路の端に駅を建てて、はじめてそこが積み下ろしの場所になる。村のそばを線路が通っているだけの状態は、村のそばを道が通っているだけなのと同じで、その村には何もしていない。',
        '駅は作業台で 木材 6 ＋ 鉄インゴット 1。持って線路の端を狙い、右クリックで建てる。建った駅をもう一度右クリックすると撤去して持ち帰る。',
        `駅が村に届いているのは、村の中心から ${STATION_REACH} マス以内にあるとき。建てたときにどの村の駅になったかが出るので、届いていなければその場で分かる。`,
        '線路の端が村まで来ているのに駅が無い路線には、その端に桃色の光の柱が立ち、パネルが「線路の端に駅が無い」と言う。線路が途切れているのとは別の話なので、光の柱の色も文も分けてある。',
        '駅にはホームがあり、その村が出荷を待っている荷が木箱として積まれる。木箱が増えているのに列車が来ないなら、向こう側の駅がまだ無い。',
        '駅は線路の端ならどこにでも建つ。曲線の継ぎ目も端なので、長い線路の途中の村に駅を作りたければ、そこで一度切って敷けばよい。',
      ],
    },
    {
      heading: '列車 — 線路が村と村をつないだとき',
      notes: [
        '両方の村に駅があって、その 2 つが線路でつながっていれば、荷運びの代わりに列車が走る。道は関係ない — 道がまったく無い 2 村でも、線路と駅がそろっていれば荷は動く。',
        `村に「届いている」のは、駅が村の中心から ${STATION_REACH} マス以内にあるとき。そこから集荷所までの徒歩はパネルの「戸口まで」に入る。`,
        '荷は集荷所の戸口から駅まで荷運びが運び、そこから先が列車になる。向こうの駅で降ろされて、また荷運びが戸口まで運ぶ。ホームで人から列車に持ち替わるのが、この世界での積み込みである。',
        `列車は積んでいる量ぶんの貨車をつないで走る。1 両あたり ${WAGON_LOAD} 個で、満載は ${TRAIN_LOAD} 両。機関車だけで走っているのは空荷で帰る便で、片道しか稼いでいない路線はそう見える。`,
        `線路の路線は舗装も幅も関係せず、平坦な直線なら ${RAIL_QUALITY.toFixed(2)} 倍（呼び名は「${roadGrade(RAIL_QUALITY)}」）。列車は一度に ${TRAIN_LOAD} 倍運ぶ。`,
        '**ただし勾配と曲線は速さに効く。** 急な上りは遅く、下りは少しだけ速い。急な曲線は半径の平方根に比例して遅い — 実際の鉄道と同じ理由で、横向きの加速度は速度の 2 乗を半径で割った値だから。',
        `半径 ${EASY_RADIUS} マス以上の曲線は無料。いちばん急な半径 ${MIN_RADIUS} マスの曲線でおよそ ${Math.round(curvePace(MIN_RADIUS) * 100)}%、いちばん急な ${Math.round(MAX_GRADE * 100)}% の上りでおよそ ${Math.round(gradePace(MAX_GRADE) * 100)}% まで落ちる。`,
        '登りと下りは別の値なので、**同じ区間でも往きと復りで所要時間が違う**。上りが遅いぶんを下りが取り返すことはない。',
        'パネルは区間ごとに「線形 ◯%」と、最も急な勾配・最小半径を出す。100% なら平坦な直線ということ。谷沿いに回すか、山を越えて短くするかは、この数字を見て決める。',
        '線路を敷きかけて届いていない路線には、線路が途切れている場所に紫の光の柱が立つ。パネルもその方角と距離を言う。',
        '線路がつながっていない間は、道があれば荷運びか荷車が走る。線路を外せば次の測量で道に戻るだけで、荷は消えない。',
      ],
    },
    {
      heading: '手動運転 — 自分で列車を走らせる',
      notes: [
        '[N] の路線表で、線路の区間を持つ路線に「運転する」が出る。押すと、いちばん近い駅で列車の運転台に乗る。',
        '**W が力行、S がブレーキ、X で降りる。** 運転中の W と S は歩く足ではない。マウスで見回すのは自由で、窓から身を乗り出して前も後ろも見られる。',
        '運転台の表示は 4 つ — 速度と制限速度、その場の勾配と曲線半径、次の停留所までの距離、積荷。バーの縦線が制限速度で、針がそこを越えていれば出しすぎ。',
        `制限速度は勾配と曲線から決まるので、走りながら変わる。出しすぎのまま ${OVERSPEED_GRACE} 秒たつと非常ブレーキがかかり、止まるまで力行が効かない。壊れるものは無いが、時間は返ってこない。`,
        `**駅では止まる。** 停留所まで ${PLATFORM_STOP} マス以内で止まれば停車になり、荷を降ろして次の区間ぶんを積み、そのまま次の停留所へ向かう。止まりきれずに突っ込んでも停車は停車で、「行き過ぎ」と出るだけ。`,
        '運転している列車も、自動の便とまったく同じ荷である。信号は同じように守り、着けば同じように運賃が入る。違うのは時計を握っているのが誰か、それだけ。',
        '途中で降りると、積んでいた荷は積んだ駅に戻る。運転をやめて損をすることはない。',
      ],
    },
    {
      heading: '分岐 — 途中から割って枝を出す',
      notes: [
        '線路の途中を狙って敷きはじめると、そこで線路が 2 本に割れて、割れ目から新しい枝が出る。線路の端まで戻る必要はない。割れ目は元の曲線とまったく同じ形のまま分かれるので、分岐を作っても線路の形は変わらない。',
        '狙っているところで割れると分かるときは、十字の先に桃色の目印が出る。線路の端に出る目印（つなげる場所）とは色が違う。',
        `枝を出せる向きには限りがある。本線の向きから ${Math.round(MAX_SWITCH_ANGLE * 180 / Math.PI)}° より大きく振れた向きは、分岐ではなく別の線路が横切っているだけなので断られる。1 つの節点に枝は 1 本まで。`,
        '枝は本線の勾配を受け継ぐ。分岐は列車が進路を選ぶ場所であって、登りはじめる場所ではない。',
        '実物の分岐器と同じで、入ってきた向きによっては枝に入れない。本線を東から来た列車は西向きに出た枝には入れない（後退することになるため）。経路が見つからないときは、枝の向きを敷き直す。',
        '線路の端の目印は、その端で空いている向きごとに 1 つ出る。分岐は「端」でも「途中」でもあるので、まだ空いている向きがどれかは目印の数で分かる。',
      ],
    },
    {
      heading: '信号 — 閉塞と、詰まったとき',
      notes: [
        '信号機は作業台で 鉄インゴット 2 ＋ 木材 2 で 2 個できる。持って線路を狙い右クリックで建てる。線路の途中を狙えばそこで割ってから建つので、どこにでも置ける。建った信号をもう一度右クリックすると撤去して持ち帰る。',
        '信号と信号のあいだが「閉塞区間」で、1 つの区間に列車は 1 本しか入れない。前の区間が空くまで、次の列車は信号の手前で止まって待つ。',
        '信号を 1 つも置いていない線路は、今までとまったく同じに動く。区間の境目が無いので、誰も誰も待たない。1 つ置いた瞬間に、その両側が意味のある閉塞になる。',
        '信号の灯は緑・赤・黄。緑は隣の区間が空いている、赤は列車が入っている、黄は詰まっている。',
        '単線で列車が向かい合うと、互いに相手の欲しい区間を持ち合って本当に止まる。これは自動では解かない。両方の信号が黄色くなり、そこに黄色い光の柱が立ち、パネルが「信号待ちで詰まっている — 待避線が要る」と言う。',
        '解き方は 2 つ。信号を 1 つ抜いて区間をつなげてしまうか、分岐で待避線を作って片方が逃げられるようにするか。後者が本来のやり方である。',
      ],
    },
    {
      heading: '列車に乗る',
      notes: [
        '列車には貨車のほかに客車が必ず 1 両つながっている。荷が 0 でも付いてくるので、乗れないことはない。',
        '駅のホームは客車の床と同じ高さである。停まっている列車の横に立って、開いている戸口へ歩いて入れる。',
        '客車の床・貨車の荷・機関車の屋根・客車の屋根には当たり判定があり、乗ると列車と一緒に運ばれる。曲線でも振り落とされない。',
        '壁と柱は見た目だけで、当たり判定は「上に乗れる面」だけである（高架の支柱と同じ扱い）。だから戸口を狙わなくても横から入れるし、車内で壁に引っかかることもない。',
        'ジャンプすれば降りられる。トンネルや切り通しで壁にぶつかる位置に運ばれそうなときは、列車のほうが置いていく。',
      ],
    },
    {
      heading: 'ボート — 川と海を行く',
      notes: [
        '板 5 枚でボートが作れる（手持ちのクラフトでよい）。水面を見て右クリックすると乗る。',
        '**ボートはダッシュと同じ速さで進む。** 泳ぐより 6 倍以上速く、歩くよりも速い。川は最初から通っている道だと思ってよい。',
        '乗っているあいだは沈まないし、息も減らない。水面の高さに合わせて浮き、堰の段差はそのまま下って行く。',
        'ジャンプで降りる。少し跳ねるので、水面より 1 段高い岸にもそのまま上がれる。水がなくなった所では自動的に降りる。',
        'ボートは持ち物から減らない。降りたあとに拾い直す必要もない。',
      ],
    },
    {
      heading: '地図 — M で全画面',
      notes: [
        '右上の小さい地図と同じものを、画面いっぱいに開く。＋ と − かマウスホイールで 1 ドット 1 マスから 16 マスまで拡大縮小できる。1 ドット 1 マスなら村の家が数えられ、16 マスなら 4000 マス四方が一度に見える。',
        '**地図はドラッグで動かせる。** 遠くまで引いても迷わないように、離れた瞬間に「自分の位置へ」ボタンが光る。`Home` でも戻れるし、地図を閉じて開き直すと必ず自分の位置に戻る。',
        '**地図をクリックするとその場所が選べる。** 座標が下のバーに出て、印が地図に残る。「ここへワープ」で飛べるが、これはデバッグモード（Esc のポーズ画面）が入のときだけ — 地図で見つけた所まで歩くのがこの遊びの大半だからである。',
        '見えるのは読み込まれている範囲だけである。歩いていない所は暗いままで、これは小さい地図と同じ挙動。',
        '**歩いていない一帯も、まとめて写せる。** `Esc` の設定にある「地図の広域表示」で一辺を決め、「いま地図に写す」を押すと、その範囲の地形を生成器から直接調べて地図に書く。裏で少しずつ進むので、待つあいだも遊べる。広く取るほど時間がかかり、一辺 2000 マスで 7 秒ほど、1 万マスで 1 分ほどである。',
        '写したぶんに家や自分で敷いた道は出ない（地形だけである）し、セーブにも残らない。「写したぶんを消す」で元に戻る。',
        '道・線路・目印・荷の位置は小さい地図と同じものが同じ色で乗る。縮尺が変わっても意味が変わらないように、描いているのは同じ仕組みである。',
      ],
    },
    {
      heading: '停留所と路線',
      notes: [
        '停留所は地面のどこにでも置ける。町の中に置けばその町の停留所になり、産業のそばに置けばそこから積む。',
        `町から ${STOP_TOWN_REACH} マス以内なら町の停留所になる。停留所どうしは ${STOP_SPACING} マス以上離すこと。`,
        `[N] の路線表で、新しい路線に停留所を順に加える。1 路線につき ${MAX_LINE_STOPS} か所まで。`,
        '停留所が 2 つの路線は往復する。3 つ以上なら循環する — 端で折り返すと真ん中だけ 2 倍来てしまうため。',
        '**車両は選ばない。** 区間ごとに、実際に何がつないでいるかで決まる — 線路なら列車、海がつないでいれば船、幅 3 マスの道なら荷車（人なら馬車）、それ以外は徒歩。',
        '線路が最優先。線路が無ければ、道と海路のうち**速いほう**を使う。',
        '路線を編集しても、区間が同じままなら走っている荷はそのまま。消えた区間の荷は積み地に戻る。',
        `**どこにつながっているかは世界に線で出る。** 停留所・駅から接続先の町や産業へ水色の線が伸びる。何にもつながっていない停留所は灰色の柱だけになる。`,
        '**置く前にも出る。** 停留所や駅を持って狙うと、そこに置いた場合の接続先へ破線が伸び、届かない時は「一番近い町まであと何マスか」が画面に出る。',
      ],
    },
    {
      heading: '一次産業 — 原料の出どころ',
      notes: [
        `産業設置具を持って地面を右クリックすると、周囲 ${DEPOSIT_RADIUS} マス・上 ${DEPOSIT_UP} / 下 ${DEPOSIT_DOWN} マスを調べる。個数と密度が足りていれば建つ。`,
        '**地中の鉱脈も、地表に出ている露頭も、どちらも同じように数える。** 露頭は「ここを掘れば出る」という目印。',
        `枯渇しない。 掘り出す速さは建てた時の資源の多さで決まり（最大 ${MAX_RICHNESS} 倍）、あとから変わらない。`,
        `1 か所の在庫は ${MAX_INDUSTRY_STOCK} 個まで。満杯なら路線が来ていないということ。`,
        `産業どうしは ${INDUSTRY_SPACING} マス以上離すこと — 同じ資源で二重取りはできない。`,
        '**食料は建てられない。** 畑は町が自分で作る（下の「畑と食料」）。プレイヤーが建てるのは掘る・切る産業だけ。',
        '**建たない時は理由が出る。** 「量が足りない」なら大きい鉱脈を、「散らばりすぎ」なら濃く固まっている所の真上を探す。数字は実際に数えた個数と密度そのもの。',
        '**建てた産業に向けて産業設置具を右クリックすると撤去できる**（設置具は返ってくる）。小屋と煙突は消え、均した土地は残る。',
        '**産業を見ると、種類・掘る物・在庫・産出倍率・出荷数が画面に出る。** どの小屋も見た目は同じなので、種類はそこで読む。',
      ],
      table: {
        head: ['産業', '掘り出す物', '要る資源', '個数', '密度'],
        rows: INDUSTRY_TYPES.map((type) => [
          type.label,
          itemLabel(type.good),
          type.blocks.map(blockLabel).join(' / '),
          `${type.count}`,
          `${Math.round(type.density * 100)}%`,
        ]),
      },
    },
    {
      heading: '畑と食料 — 町が自分で作るもの',
      notes: [
        '**食料はプレイヤーの仕事ではない。** 町は自分の郊外に畑を作り、村人が耕す。産業設置具では農場は建てられない。',
        `畑は町の外周に区画で並ぶ。1 区画 ${FIELD_SIZE}×${FIELD_SIZE} マスで、**町の街区のおよそ 2 倍の面積**になるまで置かれる。`,
        '**町が発展すると畑も増える。** 村ごとに決まった一方向へ、まとまった農業帯として外へ延びる。',
        '取れた作物はまず**町の集荷所の在庫**になり、そこから**商店**へ運ばれる。パンを焼く町なら、その工場にも回る。',
        `畑には ${CHANNEL_EVERY} マスおきに水路が通る。乾いた耕地では作物が枯れるため。斜面では水が溜まらないので、そこだけ畑にならない。`,
        '**だから小麦は路線で運ばない。** 町が求める物の一覧にも出ない — 供給できない物を頼まれても困るだけなので。',
      ],
    },
    {
      heading: '荷が出る条件（動かないときはここ）',
      notes: [
        `工場が動くのは発見済みの町だけ。1 個あたり ${PRODUCE_SECONDS} 秒 ÷（1 + 0.35 × 発展度）、在庫の上限は ${MAX_STOCK} 個。`,
        '町の工場は原料が **全種類** そろうまで 1 個も作らない。 何も作れない間は時間も溜め込まないので、原料が着いてから数え始める。',
        '在庫が 1 個でもあれば荷は出発する。 満載は待たない（満載なら一度に運ぶ量まで積むだけ）。',
        '荷は在庫のあるほうの端から出る。 区間は一方通行の管ではないので、向こうに物があれば向こうから来る。',
        '**行き先が町でない区間には荷を積まない。** 産業どうしをつないでも降ろす先が無いので、何も動かない。',
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
      heading: '町',
      notes: [
        `町はどこも工場の町。原料を加工品に変えるので、原料が届くまで何も作らない — ${CRAFTS.filter((c) => c.inputs.length > 1).map((c) => `${c.inputs.map(itemLabel).join('と')}`).join('、')}のように 2 種類要る町もある。`,
        `加工: ${CRAFTS.map((c) => `${c.inputs.map(itemLabel).join('+')}→${itemLabel(c.output)}`).join('、')}`,
        `町は自分が作れない加工品を欲しがる。求めている品を届けると発展度は ${NEEDED_POINTS} 倍。`,
        '荷運びは帰り道も空ではない。出発した側が到着した側の生産品を欲しがっていれば、それを積んで帰る。',
        '発展した町は外周の空いた区画に建物を建てる。崖・水・隣町を避けて探し、建物と畑の両方を作れる土地が尽きると発展は止まる。敷いた道はそのまま残る。',
      ],
      table: { head: ['段階', '必要な発展度', '変わること'], rows: stageRows() },
    },
    {
      heading: '町の中 — 住宅・商店・工場',
      notes: [
        `村の建物には用途がある: ${USE_LABELS.residential} / ${USE_LABELS.commercial} / ${USE_LABELS.industrial}。村が育つと商店と工場が建つ（工場は煙突で分かる）。`,
        `${USE_LABELS.residential}には人が住み、${USE_LABELS.commercial}や${USE_LABELS.industrial}へ働きに出る。住宅 1 軒あたり ${COMMUTE_EVERY} 秒に 1 人なので、育った町ほど通りがにぎやかになる。近くに立っていれば実際に歩いているのが見える。`,
        `**人が来た建物だけが品物を使う。** 誰も通ってきていない商店は何も欲しがらないし、何も売らない。`,
        `${USE_LABELS.residential}が欲しがる物: ${HOUSEHOLD_GOODS.map(itemLabel).join('・')}。${USE_LABELS.commercial}が欲しがる物: ${SHOP_GOODS.map(itemLabel).join('・')}。${USE_LABELS.industrial}はその村の原料を待つ。`,
        `1 つの建物が持てるのは 1 品目につき ${CELL_STOCK} 個まで。倉庫ではないので、届けた物はいずれ切れてまた欲しがる。`,
        `品物が届かない町は止まらない — 遅くなる。人の出入りも旅立ちも鈍るだけで、育った村が縮むことはない。`,
        `${JOURNEY_SECONDS} 秒に 1 人ほど、隣の町へ行きたい人が出る。**その人たちは荷の無い便に乗る** — 荷が優先で、空で帰るはずだった便に乗るので、運ぶ物を減らさない。`,
        '台帳（L）に、立っている町の建物が一覧で出る。建物を見れば、何を待っているかがその場に出る。',
      ],
      table: {
        head: ['用途', '中にいる人（集落）', 'すること'],
        rows: [
          [USE_LABELS.residential, `${HOME_PEOPLE}`, '人が住む。働きに出る。旅に出たい人が生まれる'],
          [USE_LABELS.commercial, `${SHOP_JOBS}`, '人が来ると品物が売れる'],
          [USE_LABELS.industrial, `${WORKS_JOBS}`, '人が来ると原料を使う'],
        ],
      },
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
