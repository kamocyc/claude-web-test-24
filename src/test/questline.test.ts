import { describe, expect, it } from 'vitest';
import { HAUL_COUNT, MILESTONES, Questline, type NetworkState } from '../game/questline';
import {
  MAX_STAGE,
  VillageRegistry,
  villageId,
  type VillageRecord,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';
import type { Route } from '../game/transport';

const A: VillageSeed = { x: 0, z: 0, baseY: 60, variant: 'plains' };
const B: VillageSeed = { x: 400, z: 0, baseY: 60, variant: 'snowy' };
const ID_A = villageId(0, 0);
const ID_B = villageId(400, 0);
const SOURCE: VillageSource = { villagesAround: () => [A, B] };

function setup() {
  const registry = new VillageRegistry(1, SOURCE);
  registry.ensureNear(0, 0);
  return { registry, quest: new Questline() };
}

function route(connected: boolean, missing = 0, quality = 1): Route {
  return {
    from: ID_A, to: ID_B, good: 'wheat', surveyed: true, connected,
    everConnected: connected, waypoints: [], cumulative: [], length: 100, missing,
    quality, grade: 'x',
    gapFrom: missing > 0 ? { x: 60, z: 0, y: 60 } : null,
    gapTo: missing > 0 ? { x: 200, z: 0, y: 60 } : null,
    porters: [], delivered: 0, trips: 0,
  };
}

/** A network the milestones can be pointed at. */
function state(villages: VillageRecord[], routes: Route[]): NetworkState {
  return { villages, routes };
}

/** Walks the whole arc, returning the questline at the end. */
function playThrough() {
  const { registry, quest } = setup();
  quest.onVillageDiscovered(registry.get(ID_A)!);
  quest.interactionFor(registry.get(ID_A)!, registry);
  quest.complete('accept', registry);
  quest.complete('deliver', registry);
  quest.complete('learn', registry);
  quest.onRouteEstablished(route(true));
  quest.onArrival(route(true));
  return { registry, quest };
}

describe('questline', () => {
  it('starts by asking the player to find a village', () => {
    const { registry, quest } = setup();
    expect(quest.step).toBe('find_village');
    expect(quest.objective(registry, undefined)?.title).toContain('村を探す');
  });

  it('adopts the first village the player walks into', () => {
    const { registry, quest } = setup();
    const toast = quest.onVillageDiscovered(registry.get(ID_A)!);
    expect(quest.step).toBe('accept_haul');
    expect(quest.originId).toBe(ID_A);
    expect(toast).toContain('見つけた');
  });

  it('ignores later discoveries once it has an origin', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    expect(quest.onVillageDiscovered(registry.get(ID_B)!)).toBeNull();
    expect(quest.originId).toBe(ID_A);
  });

  it('picks a target even when the trade screen was never opened', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    expect(quest.complete('accept', registry)).not.toBeNull();
    expect(quest.targetId).toBe(ID_B);
    expect(quest.step).toBe('deliver_by_hand');
  });

  it('offers the haul at the origin and picks the nearest neighbour as the target', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    const offer = quest.interactionFor(registry.get(ID_A)!, registry);
    expect(offer?.kind).toBe('accept');
    expect(offer?.count).toBe(HAUL_COUNT);
    expect(quest.targetId).toBe(ID_B);
  });

  it('has nothing to say at a village the step is not about', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    expect(quest.interactionFor(registry.get(ID_B)!, registry)).toBeNull();
  });

  it('asks for the delivery only at the target village', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);
    expect(quest.step).toBe('deliver_by_hand');
    expect(quest.interactionFor(registry.get(ID_A)!, registry)).toBeNull();
    expect(quest.interactionFor(registry.get(ID_B)!, registry)?.kind).toBe('deliver');
  });

  it('makes up a lost crate at the origin, but only the missing part of it', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);
    const carrying = quest.interactionFor(registry.get(ID_A)!, registry, () => HAUL_COUNT);
    expect(carrying).toBeNull();
    const lost = quest.interactionFor(registry.get(ID_A)!, registry, () => HAUL_COUNT - 2);
    expect(lost?.kind).toBe('accept');
    expect(lost?.count).toBe(2);
    // Taking the shortfall does not restart or advance the tutorial.
    expect(quest.complete('accept', registry)).toBeNull();
    expect(quest.step).toBe('deliver_by_hand');
  });

  it('does not skip ahead when the wrong event arrives', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    expect(quest.complete('deliver', registry)).toBeNull();
    expect(quest.onRouteEstablished(route(true))).toBeNull();
    expect(quest.onArrival(route(true))).toBeNull();
    expect(quest.step).toBe('accept_haul');
  });

  it('runs the whole arc to done', () => {
    const { quest } = playThrough();
    expect(quest.step).toBe('done');
  });

  it('ignores a route between other villages', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);
    quest.complete('deliver', registry);
    quest.complete('learn', registry);
    const elsewhere = { ...route(true), from: 'x', to: 'y' };
    expect(quest.onRouteEstablished(elsewhere)).toBeNull();
    expect(quest.step).toBe('build_road');
  });

  it('points at the gap while the road is unfinished', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);
    quest.complete('deliver', registry);
    quest.complete('learn', registry);
    const objective = quest.objective(registry, route(false, 128));
    expect(objective?.marker?.kind).toBe('gap');
    expect(objective?.detail).toContain('128');
  });

  it('gives every unfinished step something to aim at', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    for (const kind of ['accept', 'deliver', 'learn'] as const) {
      expect(quest.objective(registry, undefined)).not.toBeNull();
      quest.complete(kind, registry);
    }
    expect(quest.objective(registry, undefined)).not.toBeNull();
    quest.onRouteEstablished(route(true));
    expect(quest.objective(registry, undefined)).not.toBeNull();
  });

  it('stops talking to villagers once the tutorial is done, and points at the network', () => {
    const { registry, quest } = playThrough();
    expect(quest.interactionFor(registry.get(ID_A)!, registry)).toBeNull();
    // The tutorial ends; the game does not. What follows is the milestone list.
    const objective = quest.objective(registry, undefined, state([], []));
    expect(objective?.title).toBe(MILESTONES[0].title);
  });

  it('round trips through a save', () => {
    const { quest } = setup();
    const { registry } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);

    const restored = new Questline();
    restored.loadJSON(quest.toJSON());
    expect(restored.step).toBe('deliver_by_hand');
    expect(restored.originId).toBe(ID_A);
    expect(restored.targetId).toBe(ID_B);
    expect(restored.cargo?.count).toBe(HAUL_COUNT);
  });

  it('ignores a missing or nonsense save', () => {
    const quest = new Questline();
    quest.loadJSON(undefined);
    quest.loadJSON({ step: 'not_a_step' });
    expect(quest.step).toBe('find_village');
  });
});

describe('milestones', () => {
  function done(): Questline {
    return playThrough().quest;
  }

  it('awards nothing while the tutorial is still running', () => {
    const { quest } = setup();
    expect(quest.claimMilestones(state([], [route(true), route(true)]))).toEqual([]);
  });

  it('awards the first goal when two routes are working', () => {
    const quest = done();
    expect(quest.claimMilestones(state([], [route(true)]))).toEqual([]);
    const earned = quest.claimMilestones(state([], [route(true), route(true)]));
    expect(earned.map((m) => m.id)).toEqual(['second_route']);
    expect(earned[0].reward).toBeGreaterThan(0);
  });

  it('never awards the same goal twice', () => {
    const quest = done();
    const network = state([], [route(true), route(true)]);
    expect(quest.claimMilestones(network)).toHaveLength(1);
    expect(quest.claimMilestones(network)).toHaveLength(0);
  });

  it('hands out the goals that were skipped past, in order', () => {
    const quest = done();
    const { registry } = setup();
    const village = registry.get(ID_A)!;
    village.stage = MAX_STAGE;
    village.kind = 'workshop';
    village.input = 'wheat';
    village.inputStock = 4;
    // A player who did everything at once is still told what they did, one at a time.
    const paved = route(true, 0, 1.7);
    const earned = quest.claimMilestones(
      state([village], [paved, { ...paved, to: 'c' }, { ...paved, from: 'c', to: 'd' }]),
    );
    expect(earned.map((m) => m.id)).toEqual(MILESTONES.map((m) => m.id));
    expect(quest.currentMilestone()).toBeNull();
  });

  it('describes every goal without a network to look at', () => {
    for (const milestone of MILESTONES) {
      expect(milestone.detail(state([], []))).not.toBe('');
      expect(milestone.done(state([], []))).toBe(false);
    }
  });

  it('remembers how far down the list it got', () => {
    const quest = done();
    quest.claimMilestones(state([], [route(true), route(true)]));
    const restored = new Questline();
    restored.loadJSON(quest.toJSON());
    expect(restored.milestone).toBe(quest.milestone);
    expect(restored.currentMilestone()?.id).toBe(MILESTONES[1].id);
  });
});
