/** The tutorial, as a state machine.
 *
 *  It teaches the loop in the order the player can actually do it: find a village, carry
 *  its goods to a neighbour by hand (which is what puts that neighbour on the map), then
 *  learn that a road does the carrying for you, build one, and watch the first delivery
 *  arrive. Pure data — the game drives it with events and reads back an objective. */

import { itemLabel } from './items';
import type { Route } from './transport';
import {
  MAX_STAGE,
  RANKS,
  STAGE_POINTS,
  displayName,
  type GoodId,
  type VillageId,
  type VillageRecord,
  type VillageRegistry,
} from './villages';

export type QuestStep =
  | 'find_village'
  | 'accept_haul'
  | 'deliver_by_hand'
  | 'learn_roads'
  | 'build_road'
  | 'watch_porter'
  | 'done';

/** Hand-carried load. Deliberately just short of a stage, so the first automatic
 *  delivery is what tips the village over and the point lands. */
export const HAUL_COUNT = STAGE_POINTS[0] - 2;

/** The tutorial written out, in order, without a world to read it against.
 *
 *  `objective()` says what to do *now* and needs the registry to do it. This says what
 *  the whole thing is, which is what somebody opening the manual is asking — and keeping
 *  the two in one file is what stops them drifting apart. */
export const QUEST_STEPS: readonly { step: QuestStep; label: string; detail: string }[] = [
  { step: 'find_village', label: '村を見つける', detail: 'コンパスの ⌗ を目指して歩く。台地に踏み込むと村名・生産品・欲しがっている物が分かる' },
  { step: 'accept_haul', label: '運搬を引き受ける', detail: '村人に話しかけると、取引画面の一番上に頼み事が出る。積み荷はその場で持たせてくれる' },
  { step: 'deliver_by_hand', label: '人力で運ぶ', detail: `${HAUL_COUNT} 個を担いで分村まで歩き、向こうの村人に納める。分村も地図に載る` },
  { step: 'learn_roads', label: '道の話を聞く', detail: 'もう一度話しかけると「道さえあれば我々が自分で運ぶ」と言う' },
  { step: 'build_road', label: '道でつなぐ', detail: 'シャベルを持って右クリックを押したまま歩く。1 マスも空けずにつながると路線になる' },
  { step: 'watch_porter', label: '荷運びを見送る', detail: '在庫が 1 便ぶんたまると荷運びが出発する。近くにいれば実際に道を歩く姿が見える' },
  { step: 'done', label: 'あとは網を広げる', detail: '以降は下の目標が順に出る。村を見つけ、道でつなぎ、舗装し、広げる' },
];

export interface QuestObjective {
  step: QuestStep;
  title: string;
  detail: string;
  marker: { x: number; z: number; kind: 'village' | 'gap' } | null;
}

export interface QuestInteraction {
  kind: 'accept' | 'deliver' | 'learn';
  label: string;
  detail: string;
  good: GoodId | null;
  count: number;
}

export interface SavedQuest {
  step: string;
  originId?: string;
  targetId?: string;
  good?: string;
  count?: number;
  /** Absent in saves written before the milestones existed, where the player simply
   *  starts the list from the top. */
  milestone?: number;
}

/** Everything a milestone is allowed to look at: the villages the player has found and
 *  the routes between them. */
export interface NetworkState {
  villages: readonly VillageRecord[];
  routes: readonly Route[];
  /** Where the player is, so "the nearest" can mean it. */
  player: { x: number; z: number };
  /** The nearest village nobody has walked into yet, when the grid knows of one. A goal
   *  that needs another village has to be able to point at one, or "open a second route"
   *  is an instruction with no address. */
  unfound: { x: number; z: number } | null;
}

const EMPTY_STATE: NetworkState = {
  villages: [], routes: [], player: { x: 0, z: 0 }, unfound: null,
};

/** A standing goal for the network, once the tutorial has run out of things to teach.
 *
 *  These are what stop the game ending the moment the first porter arrives: each one
 *  points at a different part of the system — a second line, a workshop that needs
 *  feeding, pavement, a town — so following the list is also a tour of the mechanics. */
export interface Milestone {
  id: string;
  title: string;
  /** Written per state so a goal can show how far along it is. */
  detail(state: NetworkState): string;
  /** Emeralds paid on completion. */
  reward: number;
  done(state: NetworkState): boolean;
  marker?(state: NetworkState): { x: number; z: number; kind: 'village' | 'gap' } | null;
  /** The two villages this goal is actually about, when it is about a particular pair.
   *  Everything that draws the tutorial's own road — the panel row, the compass, the line
   *  and beacons in the world — follows this once the tutorial is over, so a goal that
   *  says "join two villages" can show which two and how far off it is. */
  pair?(state: NetworkState): Route | null;
}

/** Blocks of road still to lay across a gap.
 *
 *  A road goes up, down, left and right, so one block covers one metre and no more — an
 *  angled stretch is a staircase, and a staircase is longer than the line it follows.
 *  This is therefore the floor rather than the answer: the true count is anywhere from
 *  here to half again, depending on how square the gap is. Saying the floor and the
 *  metres together is honest; dividing by √2, as this did while corners counted, was
 *  telling the player the job was smaller than it is. */
export function roadBlocksFor(missing: number): number {
  return Math.max(1, Math.round(missing));
}

/** "あと 368m・道 260 個ぶん". Used wherever a gap is reported. */
export function gapText(missing: number): string {
  return `あと ${Math.round(missing)}m・道 ${roadBlocksFor(missing)} 個ぶん`;
}

/** The unfinished route with the least left to do, which is the one worth naming. */
function closestGap(state: NetworkState): Route | null {
  let best: Route | null = null;
  for (const route of state.routes) {
    if (route.connected || !route.surveyed) continue;
    if (!best || route.missing < best.missing) best = route;
  }
  return best;
}

function nameOf(state: NetworkState, id: VillageId): string {
  return state.villages.find((v) => v.id === id)?.name ?? '?';
}

function linked(state: NetworkState): Route[] {
  return state.routes.filter((r) => r.connected);
}

/** Villages standing at either end of a working route. */
function servedVillages(state: NetworkState): Set<VillageId> {
  const ids = new Set<VillageId>();
  for (const route of linked(state)) {
    ids.add(route.from);
    ids.add(route.to);
  }
  return ids;
}

/** The matching village closest to the player. It used to be whichever came first in the
 *  registry, which is nothing anybody can walk towards. */
function nearest(
  state: NetworkState,
  match: (v: VillageRecord) => boolean,
): { x: number; z: number; kind: 'village' } | null {
  let found: VillageRecord | null = null;
  let bestDistance = Infinity;
  for (const village of state.villages) {
    if (!match(village)) continue;
    const distance = Math.hypot(village.x - state.player.x, village.z - state.player.z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    found = village;
  }
  return found ? { x: found.x, z: found.z, kind: 'village' } : null;
}

function best(state: NetworkState, of: (v: VillageRecord) => number): number {
  let top = 0;
  for (const village of state.villages) top = Math.max(top, of(village));
  return top;
}

export const MILESTONES: readonly Milestone[] = [
  {
    id: 'second_route',
    title: '輸送路をもう 1 本ひらく',
    detail: (s) => {
      // Two different situations wear the same title, and only one of them is "lay road".
      // Saying which one it is now is the whole difference between a goal and a number
      // that does not move: a second route needs a second pair, and until the player has
      // walked into another village there is no pair to work on at all.
      const gap = closestGap(s);
      if (gap) return `${nameOf(s, gap.from)}と${nameOf(s, gap.to)}を道でつなぐ — ${gapText(gap.missing)}`;
      if (s.unfound) return 'つなぐ相手がいない。まずもう 1 つ村を見つける — コンパスの ⚑ へ';
      return `つながっている輸送路 ${linked(s).length} / 2`;
    },
    reward: 6,
    done: (s) => linked(s).length >= 2,
    marker: (s) => {
      const gap = closestGap(s);
      // The stretch that needs fixing, not the destination: the same rule the tutorial's
      // own `build_road` step follows.
      if (gap?.gapFrom) return { x: gap.gapFrom.x, z: gap.gapFrom.z, kind: 'gap' };
      if (s.unfound) return { x: s.unfound.x, z: s.unfound.z, kind: 'village' };
      return nearest(s, (v) => !servedVillages(s).has(v.id));
    },
    pair: (s) => closestGap(s),
  },
  {
    id: 'feed_workshop',
    title: '工房の村に材料を届ける',
    detail: (s) => {
      const shop = s.villages.find((v) => v.kind === 'workshop');
      if (!shop) return '工房の村をまだ見つけていない。探しに行こう';
      return `${displayName(shop)}は${itemLabel(shop.input ?? '')}がないと何も作れない`;
    },
    reward: 8,
    done: (s) => s.villages.some((v) => v.kind === 'workshop' && (v.inputStock > 0 || v.stock > 0)),
    marker: (s) => nearest(s, (v) => v.kind === 'workshop' && v.inputStock <= 0 && v.stock <= 0),
  },
  {
    id: 'pave',
    title: '路線を砂利以上に舗装する',
    detail: () => '砂利・丸石・木材・石レンガを道に敷くと荷運びが速くなり、一度に運ぶ量も増える',
    reward: 10,
    done: (s) => linked(s).some((r) => r.quality >= 1.2),
  },
  {
    id: 'grow_big',
    title: `村を「${RANKS[2]}」に育てる`,
    detail: (s) => `一番育っている村は今 ${RANKS[Math.min(best(s, (v) => v.stage), RANKS.length - 1)]}`,
    reward: 10,
    done: (s) => s.villages.some((v) => v.stage >= 2),
    marker: (s) => nearest(s, (v) => v.stage === best(s, (w) => w.stage)),
  },
  {
    id: 'three_served',
    title: '3 つの村を輸送路でつなぐ',
    detail: (s) => `輸送路につながっている村 ${servedVillages(s).size} / 3`,
    reward: 12,
    done: (s) => servedVillages(s).size >= 3,
  },
  {
    id: 'town',
    title: `${RANKS[3]}をつくる`,
    detail: (s) => `一番育っている村は今 ${RANKS[Math.min(best(s, (v) => v.stage), RANKS.length - 1)]}`,
    reward: 16,
    done: (s) => s.villages.some((v) => v.stage >= 3),
    marker: (s) => nearest(s, (v) => v.stage === best(s, (w) => w.stage)),
  },
  {
    id: 'highway',
    title: '街道を敷く（石レンガで舗装した路線）',
    detail: () => '路線ぜんぶを石レンガにすると、荷運びは土の道の 1.7 倍で歩く',
    reward: 18,
    done: (s) => linked(s).some((r) => r.quality >= 1.58),
  },
  {
    id: 'capital',
    title: `${RANKS[MAX_STAGE]}をつくる`,
    detail: (s) => `${RANKS[MAX_STAGE]}になるには何本もの輸送路が要る。今 ${linked(s).length} 本`,
    reward: 24,
    done: (s) => s.villages.some((v) => v.stage >= MAX_STAGE),
    marker: (s) => nearest(s, (v) => v.stage === best(s, (w) => w.stage)),
  },
];

const STEPS: readonly QuestStep[] = [
  'find_village', 'accept_haul', 'deliver_by_hand',
  'learn_roads', 'build_road', 'watch_porter', 'done',
];

export class Questline {
  step: QuestStep = 'find_village';
  originId: VillageId | null = null;
  targetId: VillageId | null = null;
  cargo: { good: GoodId; count: number } | null = null;
  /** How far down the milestone list the player has got. Only consulted once the tutorial
   *  itself is over. */
  milestone = 0;

  /** Awards every milestone the network now satisfies, in order. Returns them so the game
   *  can announce each one and pay for it.
   *
   *  They are checked in order rather than independently, so the list reads as a campaign
   *  and a player who happens to satisfy a later one first still gets told about the
   *  earlier one on the way past. */
  claimMilestones(state: NetworkState): Milestone[] {
    if (this.step !== 'done') return [];
    const earned: Milestone[] = [];
    while (this.milestone < MILESTONES.length && MILESTONES[this.milestone].done(state)) {
      earned.push(MILESTONES[this.milestone]);
      this.milestone++;
    }
    return earned;
  }

  currentMilestone(): Milestone | null {
    return this.step === 'done' ? MILESTONES[this.milestone] ?? null : null;
  }

  /** The first village the player walks into becomes the one that gives them work. */
  onVillageDiscovered(village: VillageRecord): string | null {
    if (this.step !== 'find_village') return null;
    this.originId = village.id;
    this.step = 'accept_haul';
    return `${village.name}を見つけた。ここは${labelOf(village)}を作っている。村人に話しかけよう`;
  }

  /** What this villager has to say, if anything. Returns null when the step has nothing
   *  to do with the village the player is standing in.
   *
   *  `held` says how much of a good the player is already carrying. It only decides
   *  whether the origin village offers to make up a lost crate, so a caller that has no
   *  inventory to consult may leave it out and be told nothing is missing. */
  interactionFor(
    village: VillageRecord,
    registry: VillageRegistry,
    held: (good: GoodId) => number = () => Infinity,
  ): QuestInteraction | null {
    if (this.step === 'accept_haul' && village.id === this.originId) {
      const target = this.pickTarget(village, registry);
      if (!target) return null;
      return {
        kind: 'accept',
        label: `${labelOf(village)}を${target.name}へ運ぶ`,
        detail: `${target.name}は${labelOf(village)}を作れない。${HAUL_COUNT} 個ぶん持たせてくれる`,
        good: village.produces,
        count: HAUL_COUNT,
      };
    }
    // A player who dropped or ate the crate can ask for the shortfall — only the
    // shortfall, so this is a way out of a dead end and not a free supply of goods.
    if (this.step === 'deliver_by_hand' && village.id === this.originId && this.cargo) {
      const short = this.cargo.count - held(this.cargo.good);
      if (short <= 0) return null;
      return {
        kind: 'accept',
        label: '積み荷を受け取り直す',
        detail: `${labelOfGood(this.cargo.good)}を あと ${short} 個渡してくれる`,
        good: this.cargo.good,
        count: short,
      };
    }
    if (this.step === 'deliver_by_hand' && village.id === this.targetId && this.cargo) {
      return {
        kind: 'deliver',
        label: `${labelOfGood(this.cargo.good)}を納める`,
        detail: `${this.cargo.count} 個を納めるとこの村が潤う`,
        good: this.cargo.good,
        count: this.cargo.count,
      };
    }
    if (this.step === 'learn_roads' && (village.id === this.originId || village.id === this.targetId)) {
      return {
        kind: 'learn',
        label: '道の話を聞く',
        detail: '毎回歩いて運ぶのは大変だ、と言いたげにしている',
        good: null,
        count: 0,
      };
    }
    return null;
  }

  /** Applies whatever the player just clicked in the trade screen. */
  complete(kind: QuestInteraction['kind'], registry: VillageRegistry): string | null {
    if (kind === 'accept' && this.step === 'accept_haul') {
      const origin = this.originId ? registry.get(this.originId) : undefined;
      if (!origin) return null;
      // Pick the neighbour here rather than relying on `interactionFor` having been
      // called first: the step should not depend on the screen having been opened.
      const target = this.pickTarget(origin, registry);
      if (!target) return null;
      this.cargo = { good: origin.produces, count: HAUL_COUNT };
      this.step = 'deliver_by_hand';
      return `${target.name}へ${labelOf(origin)}を運ぼう`;
    }
    if (kind === 'deliver' && this.step === 'deliver_by_hand') {
      this.cargo = null;
      this.step = 'learn_roads';
      return '納品した。村人がまだ何か言いたそうにしている';
    }
    if (kind === 'learn' && this.step === 'learn_roads') {
      this.step = 'build_road';
      return '「道さえあれば、我々が自分で運ぶ」— 2 つの村を歩ける道でつなごう';
    }
    return null;
  }

  onRouteEstablished(route: Route): string | null {
    if (this.step !== 'build_road') return null;
    if (!this.involves(route)) return null;
    this.step = 'watch_porter';
    return '道がつながった。荷運びが来るのを待とう';
  }

  onArrival(route: Route): string | null {
    if (this.step !== 'watch_porter') return null;
    if (!this.involves(route)) return null;
    this.step = 'done';
    return '荷が届いた。あとは道を伸ばすほど村は育つ';
  }

  private involves(route: Route): boolean {
    const pair = [route.from, route.to];
    return (
      this.originId !== null && this.targetId !== null &&
      pair.includes(this.originId) && pair.includes(this.targetId)
    );
  }

  /** Nearest other village the registry knows about. It need not be discovered — being
   *  told where to go is exactly what makes the hand delivery reveal it.
   *
   *  A hamlet belonging to this village wins outright. That is what it is for: two
   *  villages are hundreds of blocks apart, which makes the first errand a hike and the
   *  road it teaches an afternoon's digging. */
  private pickTarget(origin: VillageRecord, registry: VillageRegistry): VillageRecord | null {
    if (this.targetId) {
      const existing = registry.get(this.targetId);
      if (existing) return existing;
    }
    let best: VillageRecord | null = null;
    let bestDistance = Infinity;
    for (const candidate of registry.byId.values()) {
      if (candidate.id === origin.id) continue;
      const own = candidate.outpost && candidate.parent === origin.id;
      const distance = Math.hypot(candidate.x - origin.x, candidate.z - origin.z);
      if (own) {
        this.targetId = candidate.id;
        return candidate;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (best) this.targetId = best.id;
    return best;
  }

  objective(
    registry: VillageRegistry,
    route: Route | undefined,
    state?: NetworkState,
  ): QuestObjective | null {
    const origin = this.originId ? registry.get(this.originId) : undefined;
    const target = this.targetId ? registry.get(this.targetId) : undefined;
    switch (this.step) {
      case 'find_village':
        return {
          step: this.step,
          title: '村を探す',
          detail: 'コンパスの村マーカーを目指して歩く',
          marker: null,
        };
      case 'accept_haul':
        return origin
          ? {
              step: this.step,
              title: `${origin.name}の村人に話しかける`,
              detail: '運んでほしい物があるらしい',
              marker: { x: origin.x, z: origin.z, kind: 'village' },
            }
          : null;
      case 'deliver_by_hand':
        return target && this.cargo
          ? {
              step: this.step,
              title: `${target.name}へ${labelOfGood(this.cargo.good)}を運ぶ`,
              detail: `${this.cargo.count} 個を持って歩いていく`,
              marker: { x: target.x, z: target.z, kind: 'village' },
            }
          : null;
      case 'learn_roads':
        return target
          ? {
              step: this.step,
              title: 'もう一度村人に話しかける',
              detail: '納品のあと、何か言いたそうにしている',
              marker: { x: target.x, z: target.z, kind: 'village' },
            }
          : null;
      case 'build_road': {
        if (!origin || !target) return null;
        if (route && !route.connected && route.gapFrom) {
          return {
            step: this.step,
            title: `${origin.name}と${target.name}を道でつなぐ`,
            detail: `とぎれている所まで ${gapText(route.missing)}`,
            marker: { x: route.gapFrom.x, z: route.gapFrom.z, kind: 'gap' },
          };
        }
        return {
          step: this.step,
          title: `${origin.name}と${target.name}を道でつなぐ`,
          detail: 'シャベルを持って押しっぱなしで歩けば、足もとが道になる（[R] で 20 マス先から手もとまで一気に）',
          marker: { x: target.x, z: target.z, kind: 'village' },
        };
      }
      case 'watch_porter':
        return target
          ? {
              step: this.step,
              title: '荷運びが荷を届けるのを待つ',
              detail: `${target.name}へ最初の荷が向かっている`,
              marker: { x: target.x, z: target.z, kind: 'village' },
            }
          : null;
      case 'done': {
        const milestone = MILESTONES[this.milestone];
        if (!milestone) return null;
        return {
          step: this.step,
          title: milestone.title,
          detail: state ? milestone.detail(state) : milestone.detail(EMPTY_STATE),
          marker: state ? milestone.marker?.(state) ?? null : null,
        };
      }
      default:
        return null;
    }
  }

  toJSON(): SavedQuest {
    return {
      step: this.step,
      originId: this.originId ?? undefined,
      targetId: this.targetId ?? undefined,
      good: this.cargo?.good,
      count: this.cargo?.count,
      milestone: this.milestone,
    };
  }

  loadJSON(data: SavedQuest | undefined): void {
    if (!data || typeof data.step !== 'string') return;
    if (!STEPS.includes(data.step as QuestStep)) return;
    this.step = data.step as QuestStep;
    this.originId = data.originId ?? null;
    this.targetId = data.targetId ?? null;
    this.cargo = data.good ? { good: data.good, count: data.count ?? HAUL_COUNT } : null;
    this.milestone = Math.max(0, Math.min(MILESTONES.length, Math.round(data.milestone ?? 0)));
  }
}

function labelOf(village: VillageRecord): string {
  return labelOfGood(village.produces);
}

function labelOfGood(good: GoodId): string {
  return itemLabel(good);
}
