import { describe, expect, it } from 'vitest';
import {
  HAUL_COUNT,
  MILESTONES,
  Questline,
  gapText,
  roadBlocksFor,
  type NetworkState,
} from '../game/questline';
import {
  MAX_STAGE,
  VillageRegistry,
  villageId,
  type VillageRecord,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';
import { RAIL_QUALITY } from '../game/transport';
import type { Route } from '../game/transport';
import type { Stop } from '../game/lines';
import type { Industry } from '../game/industry';

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

/** A stop serving a town, as the milestones and the tutorial see one. */
function stop(id: string, town: string | null, x = 0): Stop {
  return { id, x, y: 60, z: 0, town, name: `停留所${id}` };
}

const STOP_A = stop('s1', ID_A, 0);
const STOP_B = stop('s2', ID_B, 400);

function route(connected: boolean, missing = 0, quality = 1): Route {
  return {
    id: 'l1#0', lineId: 'l1', index: 0,
    from: STOP_A, to: STOP_B, good: 'bread', surveyed: true, connected,
    everConnected: connected, waypoints: [], cumulative: [], length: 100, missing,
    quality, grade: 'x',
    climb: 0, direct: 100, detour: 1, vehicle: 'porter', cartPinch: null, railPinch: null,
    stationGap: null, carrySpan: null, profile: [], pace: 1, steepest: 0,
    tightest: Infinity, sections: [], stall: null, doorGap: 0,
    gapFrom: missing > 0 ? { x: 60, z: 0, y: 60 } : null,
    gapTo: missing > 0 ? { x: 200, z: 0, y: 60 } : null,
    nearMiss: null,
    fromDoor: null, toDoor: null,
    porters: [], delivered: 0, trips: 0,
  };
}

/** A network the milestones can be pointed at. */
function state(
  villages: VillageRecord[],
  routes: Route[],
  extra: Partial<NetworkState> = {},
): NetworkState {
  return {
    villages,
    routes,
    industries: [],
    stops: [STOP_A, STOP_B],
    lines: routes.length > 0 ? [{ id: 'l1', name: '1 号線', stops: ['s1', 's2'] }] : [],
    player: { x: 0, z: 0 },
    unfound: null,
    ...extra,
  };
}

/** One industry, for the goals that are about having built any. */
function works(): Industry {
  return {
    id: 'i1', kind: 'forestry', good: 'wheat', x: 40, y: 60, z: 0,
    name: '林業所 1', richness: 1, stock: 0, progress: 0, shipped: 0,
  };
}

describe('the goal after the tutorial', () => {
  const second = MILESTONES[0];

  it('names the pair it means, and how much road is left', () => {
    const { registry } = setup();
    const a = registry.get(ID_A)!;
    const b = registry.get(ID_B)!;
    const gap = route(false, 368);
    const view = state([a, b], [gap]);

    expect(second.pair?.(view)).toBe(gap);
    // Naming the two villages is the point: "open a second route" on its own left the
    // player with nowhere to put a shovel.
    expect(second.detail(view)).toContain('道 368 個ぶん');
    expect(second.detail(view)).toContain(STOP_A.name);
    expect(second.detail(view)).toContain(STOP_B.name);
    expect([a.name, b.name].every((name) => typeof name === 'string')).toBe(true);
    expect(second.marker?.(view)).toEqual({ x: 60, z: 0, kind: 'gap' });
  });

  it('says to draw another line when there is no second one yet', () => {
    const { registry } = setup();
    const view = {
      ...state([registry.get(ID_A)!], []),
      unfound: { x: 900, z: -200 },
    };
    expect(second.pair?.(view)).toBeNull();
    // The second service is the goal, and the thing that opens one is the line table —
    // not a shovel, which is what this used to point at.
    expect(second.detail(view)).toContain('路線');
    expect(second.marker?.(view)).toEqual({ x: 900, z: -200, kind: 'village' });
  });

  it('counts blocks, not metres', () => {
    expect(roadBlocksFor(0)).toBe(1);
    // A road goes up, down, left and right, so one block is one metre — and an angled
    // stretch, being a staircase, takes more than this rather than fewer.
    expect(roadBlocksFor(20)).toBe(20);
    expect(roadBlocksFor(200)).toBe(200);
    expect(gapText(368)).toBe('あと 368m・道 368 個ぶん');
  });
});

describe('a road laid before the road talk', () => {
  it('still finishes the road step', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.complete('accept', registry);
    quest.complete('deliver', registry);
    // The route joins up here, one step early — which is what happens to anybody who
    // paves the fifty blocks between the two villages before walking back to talk.
    const joined = route(true);
    expect(quest.onRouteEstablished(joined)).toBeNull();
    expect(quest.step).toBe('learn_roads');

    quest.complete('learn', registry);
    expect(quest.step).toBe('place_stops');
    // The stops and the line come next, and both are noticed by looking rather than by
    // being told: neither is an event that happens anywhere in particular.
    expect(quest.observe(state([], []))).not.toBeNull();
    expect(quest.step).toBe('draw_line');
    expect(quest.observe(state([], [joined]))).not.toBeNull();
    expect(quest.step).toBe('build_road');
    // Nothing about the world has changed, so the step has to be able to notice on its
    // own that the road it is waiting for is already there.
    expect(quest.onRouteEstablished(joined)).not.toBeNull();
    expect(quest.step).toBe('watch_porter');
  });
});

/** Walks the whole arc, returning the questline at the end. */
function playThrough() {
  const { registry, quest } = setup();
  quest.onVillageDiscovered(registry.get(ID_A)!);
  quest.interactionFor(registry.get(ID_A)!, registry);
  quest.complete('accept', registry);
  quest.complete('deliver', registry);
  quest.complete('learn', registry);
  quest.observe(state([], []));
  quest.observe(state([], [route(true)]));
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

  it('ignores a leg between other towns', () => {
    const { registry, quest } = setup();
    quest.onVillageDiscovered(registry.get(ID_A)!);
    quest.interactionFor(registry.get(ID_A)!, registry);
    quest.complete('accept', registry);
    quest.complete('deliver', registry);
    quest.complete('learn', registry);
    quest.observe(state([], []));
    const elsewhere = { ...route(true), from: stop('s9', 'x'), to: stop('s8', 'y') };
    expect(quest.observe(state([], [elsewhere]))).toBeNull();
    quest.observe(state([], [route(true)]));
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
    quest.observe(state([], []));
    quest.observe(state([], [route(false, 128)]));
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
    quest.observe(state([], []));
    expect(quest.objective(registry, undefined)).not.toBeNull();
    quest.observe(state([], [route(true)]));
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

  it('awards the first goal when two legs are working', () => {
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
    village.inputs = ['sand', 'coal'];
    village.inputStock = new Map([['sand', 4], ['coal', 4]]);
    village.stock = 3;
    // A player who did everything at once is still told what they did, one at a time.
    // Railed rather than merely paved, so the railway goal is met as well.
    const paved: Route = { ...route(true, 0, RAIL_QUALITY), vehicle: 'train' };
    const third = stop('s3', 'c', 800);
    const fourth = stop('s4', 'd', 1200);
    const earned = quest.claimMilestones(
      state(
        [village],
        [paved, { ...paved, to: third }, { ...paved, from: third, to: fourth }],
        { industries: [works()], lines: [{ id: 'l1', name: '1 号線', stops: ['s1', 's2'] }] },
      ),
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
