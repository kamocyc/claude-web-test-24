/** The tutorial, as a state machine.
 *
 *  It teaches the loop in the order the player can actually do it: find a village, carry
 *  its goods to a neighbour by hand (which is what puts that neighbour on the map), then
 *  learn that a road does the carrying for you, build one, and watch the first delivery
 *  arrive. Pure data — the game drives it with events and reads back an objective. */

import { itemLabel } from './items';
import type { Route } from './transport';
import { STAGE_POINTS, type GoodId, type VillageId, type VillageRecord, type VillageRegistry } from './villages';

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
export const HAUL_COUNT = STAGE_POINTS - 2;

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
}

const STEPS: readonly QuestStep[] = [
  'find_village', 'accept_haul', 'deliver_by_hand',
  'learn_roads', 'build_road', 'watch_porter', 'done',
];

export class Questline {
  step: QuestStep = 'find_village';
  originId: VillageId | null = null;
  targetId: VillageId | null = null;
  cargo: { good: GoodId; count: number } | null = null;

  /** The first village the player walks into becomes the one that gives them work. */
  onVillageDiscovered(village: VillageRecord): string | null {
    if (this.step !== 'find_village') return null;
    this.originId = village.id;
    this.step = 'accept_haul';
    return `${village.name}を見つけた。ここは${labelOf(village)}を作っている。村人に話しかけよう`;
  }

  /** What this villager has to say, if anything. Returns null when the step has nothing
   *  to do with the village the player is standing in. */
  interactionFor(village: VillageRecord, registry: VillageRegistry): QuestInteraction | null {
    if (this.step === 'accept_haul' && village.id === this.originId) {
      const target = this.pickTarget(village, registry);
      if (!target) return null;
      return {
        kind: 'accept',
        label: `${labelOf(village)}を${target.name}へ運ぶ`,
        detail: `${target.name}は${labelOf(village)}を作れない。${HAUL_COUNT} 個ぶん運んでほしい`,
        good: village.produces,
        count: HAUL_COUNT,
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
      const target = this.targetId ? registry.get(this.targetId) : undefined;
      if (!origin || !target) return null;
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
   *  told where to go is exactly what makes the hand delivery reveal it. */
  private pickTarget(origin: VillageRecord, registry: VillageRegistry): VillageRecord | null {
    if (this.targetId) {
      const existing = registry.get(this.targetId);
      if (existing) return existing;
    }
    let best: VillageRecord | null = null;
    let bestDistance = Infinity;
    for (const candidate of registry.byId.values()) {
      if (candidate.id === origin.id) continue;
      const distance = Math.hypot(candidate.x - origin.x, candidate.z - origin.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (best) this.targetId = best.id;
    return best;
  }

  objective(registry: VillageRegistry, route: Route | undefined): QuestObjective | null {
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
            detail: `とぎれている所まで あと ${Math.round(route.missing)}m`,
            marker: { x: route.gapFrom.x, z: route.gapFrom.z, kind: 'gap' },
          };
        }
        return {
          step: this.step,
          title: `${origin.name}と${target.name}を道でつなぐ`,
          detail: '歩ける道を敷く。20 マスまでのとぎれなら許される',
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
    };
  }

  loadJSON(data: SavedQuest | undefined): void {
    if (!data || typeof data.step !== 'string') return;
    if (!STEPS.includes(data.step as QuestStep)) return;
    this.step = data.step as QuestStep;
    this.originId = data.originId ?? null;
    this.targetId = data.targetId ?? null;
    this.cargo = data.good ? { good: data.good, count: data.count ?? HAUL_COUNT } : null;
  }
}

function labelOf(village: VillageRecord): string {
  return labelOfGood(village.produces);
}

function labelOfGood(good: GoodId): string {
  return itemLabel(good);
}
