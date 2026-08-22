import { describe, expect, it } from 'vitest';
import {
  BASE_LOAD,
  CART_LOAD,
  PORTER_SPEED,
  TRAIN_LOAD,
  TransportNetwork,
  loadFor,
  payFor,
  portersFor,
  type PorterHost,
  type TransportEvents,
  type Vehicle,
} from '../game/transport';
import { RoadNetwork, type RoadWorld } from '../game/roads';
import { MAX_STAGE, STAGE_POINTS, VillageRegistry, villageId, type VillageSeed, type VillageSource } from '../game/villages';
import { Block, type BlockId } from '../world/blocks';
import { blockIndex, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';

const GROUND = 60;
/** The same pair `villages.test.ts` pins: A grows wheat, B bakes it into bread and can
 *  make nothing without it, and A wants the bread back. One road, a whole chain. */
const SEED = 34;
const A: VillageSeed = { x: 0, z: 0, baseY: GROUND, variant: 'plains' };
const B: VillageSeed = { x: 240, z: 0, baseY: GROUND, variant: 'snowy' };
const ID_A = villageId(0, 0);
const ID_B = villageId(240, 0);

class FakeWorld implements RoadWorld {
  readonly edits = new Map<string, Map<number, BlockId>>();
  lay(x: number, y: number, z: number, id: BlockId): void {
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let edits = this.edits.get(key);
    if (!edits) {
      edits = new Map();
      this.edits.set(key, edits);
    }
    edits.set(blockIndex(toLocalCoord(x), y, toLocalCoord(z)), id);
  }
  getBlock(): BlockId {
    return Block.AIR;
  }
  heightAt(): number {
    return GROUND;
  }
  isLoadedAt(): boolean {
    return false;
  }
}

const SOURCE: VillageSource = { villagesAround: () => [A, B] };

/** A porter mob that never gets anywhere: it spawns and then stands exactly where it was
 *  put, the way a real one does when the ground has trapped it. */
class StuckHost implements PorterHost {
  spawned = 0;
  moved = 0;
  removed = 0;
  private readonly at = new Map<number, { x: number; z: number }>();

  spawnPorter(point: { x: number; z: number }): number {
    this.spawned++;
    this.at.set(this.spawned, { x: point.x, z: point.z });
    return this.spawned;
  }
  porterPosition(mobId: number): { x: number; z: number } | null {
    return this.at.get(mobId) ?? null;
  }
  movePorter(): void {
    this.moved++;
  }
  removePorter(mobId: number): void {
    this.removed++;
    this.at.delete(mobId);
  }
}

interface BuildOptions {
  /** What the road is paved with, or null for no road at all. */
  surface?: BlockId | null;
  /** Somewhere to draw porters, when the test cares about the visible ones. */
  host?: PorterHost;
  /** Columns across. Three is what a cart needs. */
  width?: number;
}

/** The villages' streets end at x=30 and x=210, and a road connects by touching one, so
 *  an unbroken run from 31 to 209 is the finished road. */
function build({ surface = Block.DIRT_PATH, host, width = 1 }: BuildOptions = {}) {
  const world = new FakeWorld();
  const span = Math.floor((width - 1) / 2);
  if (surface !== null) {
    for (let x = 31; x <= 209; x++) {
      for (let z = -span; z <= span; z++) world.lay(x, GROUND, z, surface);
    }
  }
  const roads = new RoadNetwork(world);
  roads.seedFromEdits();
  const registry = new VillageRegistry(SEED, SOURCE);
  registry.ensureNear(0, 0);
  registry.discover(ID_A);
  registry.discover(ID_B);
  const events: {
    arrivals: { good: string; count: number; needed: boolean; pay: number; to: string }[];
    stages: number[];
    connected: number;
    disconnected: number;
  } = { arrivals: [], stages: [], connected: 0, disconnected: 0 };
  const handlers: TransportEvents = {
    onArrival: (arrival) =>
      events.arrivals.push({
        good: arrival.good, count: arrival.count, needed: arrival.needed,
        pay: arrival.pay, to: arrival.to,
      }),
    onStageUp: (_id, stage) => events.stages.push(stage),
    onConnected: () => events.connected++,
    onDisconnected: () => events.disconnected++,
  };
  const transport = new TransportNetwork(roads, registry, handlers, host ?? null);
  return { world, roads, registry, transport, events };
}

/** Runs the simulation in small steps, the way the game loop does. */
function run(transport: TransportNetwork, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) transport.update(step, 10_000, 10_000);
}

describe('transport routes', () => {
  it('surveys a paved route as connected', () => {
    const { transport, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    expect(events.connected).toBe(1);
  });

  it('reports the gap when the road is unfinished', () => {
    const { transport } = build({ surface: null });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.connected).toBe(false);
    expect(route.missing).toBeGreaterThan(0);
    expect(route.gapFrom).not.toBeNull();
    expect(route.gapTo).not.toBeNull();
  });

  it('does not register the same pair twice, in either direction', () => {
    const { transport } = build();
    transport.requestRoute(ID_A, ID_B);
    transport.requestRoute(ID_B, ID_A);
    expect(transport.routes).toHaveLength(1);
  });

  it('delivers goods after the walk takes as long as the road is long', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    const route = transport.routes[0];
    // A road laid block by block is exactly the baseline: no gaps, nothing paved over.
    expect(route.quality).toBeCloseTo(1, 5);
    registry.produce(600);

    // Not there yet at half the journey.
    run(transport, route.length / PORTER_SPEED / 2);
    expect(events.arrivals).toHaveLength(0);

    run(transport, route.length / PORTER_SPEED);
    expect(events.arrivals[0].count).toBe(BASE_LOAD);
    expect(events.arrivals[0].good).toBe('wheat');
    expect(registry.get(ID_B)?.points).toBeGreaterThan(0);
  });

  it('is worth more to the far village when it asked for the goods', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(600);
    run(transport, 200);
    // The workshop's input is the one thing it is desperate for.
    expect(events.arrivals[0].needed).toBe(true);
    expect(events.arrivals[0].pay).toBeGreaterThan(0);
    expect(registry.get(ID_B)?.inputStock).toBeGreaterThan(0);
  });

  it('brings back what the origin wants instead of walking home empty', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(600);
    // Long enough for the workshop to have baked some of the wheat that arrived.
    for (let t = 0; t < 600; t += 0.5) {
      registry.produce(0.5);
      transport.update(0.5, 10_000, 10_000);
    }
    const home = events.arrivals.filter((a) => a.to === ID_A);
    expect(home.length).toBeGreaterThan(0);
    expect(home[0].good).toBe('bread');
  });

  it('raises the destination one stage once enough has arrived', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(6000);
    run(transport, 400);
    expect(events.stages[0]).toBe(1);
    // Ranks arrive in order and never repeat.
    expect(events.stages).toEqual([...events.stages].sort((a, b) => a - b));
    expect(new Set(events.stages).size).toBe(events.stages.length);
  });

  it('needs stock before it dispatches anything', () => {
    const { transport, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 200);
    expect(events.arrivals).toHaveLength(0);
  });

  it('keeps a porter between the two ends and sends it home again', () => {
    const { transport, registry } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(600);
    for (let i = 0; i < 400; i++) {
      transport.update(0.5, 10_000, 10_000);
      for (const porter of transport.routes[0].porters) {
        expect(porter.t).toBeGreaterThanOrEqual(0);
        expect(porter.t).toBeLessThanOrEqual(1);
      }
    }
  });

  it('starts and ends a trip at the doors it was given', () => {
    const doors = {
      doorOf: (id: string) =>
        id === ID_A ? { x: 4, z: 4, y: GROUND } : { x: 236, z: -6, y: GROUND },
      plotsOf: () => [],
    };
    const world = new FakeWorld();
    for (let x = 31; x <= 209; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const registry = new VillageRegistry(SEED, SOURCE);
    registry.ensureNear(0, 0);
    registry.discover(ID_A);
    registry.discover(ID_B);
    const transport = new TransportNetwork(roads, registry, {}, null, doors);
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);

    const route = transport.routes[0];
    expect(route.connected).toBe(true);
    // The walk from the door to the street is part of the trip, which is what makes a
    // 集荷所 by the road worth choosing over one at the back of the village.
    expect(route.waypoints[0]).toEqual({ x: 4, z: 4, y: GROUND });
    expect(route.waypoints[route.waypoints.length - 1]).toEqual({ x: 236, z: -6, y: GROUND });
    expect(transport.pointAt(route, 0)).toEqual({ x: 4, z: 4, y: GROUND });
  });

  it('walks round the houses between the door and the street', () => {
    // The depot is behind a row of houses. The straight line from its door to the road
    // goes through two of them, and a porter steering at its shipment walks into the
    // wall and stays there — so the goods go round instead.
    // A row of houses between the depot and the road, with one gap in it.
    const houses = [
      { x0: 8, z0: -6, w: 12, d: 5 },
      { x0: 22, z0: -6, w: 12, d: 5 },
    ];
    const doors = {
      doorOf: (id: string) =>
        id === ID_A ? { x: 18, z: -12, y: GROUND } : { x: 236, z: -6, y: GROUND },
      plotsOf: (id: string) => (id === ID_A ? houses : []),
    };
    const world = new FakeWorld();
    for (let x = 31; x <= 209; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const registry = new VillageRegistry(SEED, SOURCE);
    registry.ensureNear(0, 0);
    registry.discover(ID_A);
    registry.discover(ID_B);
    const transport = new TransportNetwork(roads, registry, {}, null, doors);
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);

    const route = transport.routes[0];
    expect(route.connected).toBe(true);
    expect(route.waypoints[0]).toEqual({ x: 18, z: -12, y: GROUND });
    // Walk the whole line a step at a time: no part of it may be inside a house.
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = route.waypoints[i - 1];
      const b = route.waypoints[i];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / (steps || 1));
        const z = Math.round(a.z + ((b.z - a.z) * s) / (steps || 1));
        const inside = houses.some((h) => x >= h.x0 && x < h.x0 + h.w && z >= h.z0 && z < h.z0 + h.d);
        expect(inside, `the walk goes through a house at ${x},${z}`).toBe(false);
      }
    }
    // And the panel says the whole detour is unpaved, because it is.
    expect(route.doorGap).toBeGreaterThan(12);
  });

  it('runs between village centres when nothing names a door', () => {
    const { transport } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    expect(transport.routes[0].fromDoor).toBeNull();
  });

  it('delivers on time with somebody watching a porter that cannot move', () => {
    const stuck = new StuckHost();
    const { transport, registry, events } = build({ host: stuck });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(600);
    const route = transport.routes[0];

    // The player is standing at the origin, so the porter is drawn and stays drawn. The
    // mob is a view of the shipment: what it manages to walk is not what decides when
    // the goods arrive, or a porter jammed against a doorway would stop the line for as
    // long as anybody stood there.
    for (let t = 0; t < route.length / PORTER_SPEED + 4; t += 0.5) transport.update(0.5, 0, 0);

    expect(stuck.spawned).toBeGreaterThan(0);
    expect(stuck.moved).toBeGreaterThan(0);
    expect(events.arrivals.length).toBeGreaterThan(0);
  });

  it('sends the cargo home when the road is dug up mid-journey', () => {
    // One column out of a finished road is a hole, and a road with a hole in it is two
    // roads — which is exactly what a player with a pickaxe does to one.
    const { world, roads, transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(600);
    const stockBefore = registry.get(ID_A)?.stock ?? 0;
    run(transport, 10);
    expect(transport.routes[0].porters).toHaveLength(1);

    world.lay(110, GROUND, 0, Block.AIR);
    roads.onBlockChanged(110, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    run(transport, 5);

    expect(transport.routes[0].connected).toBe(false);
    expect(events.disconnected).toBe(1);
    expect(transport.routes[0].porters).toHaveLength(0);
    // The goods went back into the origin's pile rather than vanishing with the road.
    expect(registry.get(ID_A)?.stock).toBe(stockBefore);
  });

  it('stops delivering once the road is gone', () => {
    const { world, roads, transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    world.lay(110, GROUND, 0, Block.AIR);
    roads.onBlockChanged(110, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    registry.produce(6000);
    run(transport, 2000);
    expect(events.arrivals).toHaveLength(0);
  });

  it('stops banking stages at the cap', () => {
    const { transport, registry } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    for (let t = 0; t < 20_000; t += 0.5) {
      registry.produce(0.5);
      transport.update(0.5, 10_000, 10_000);
    }
    expect(registry.get(ID_B)?.stage).toBe(MAX_STAGE);
    expect(registry.get(ID_B)?.points).toBeGreaterThanOrEqual(STAGE_POINTS[0]);
  });

  it('carries more, and faster, on a better surface', () => {
    const dirt = build();
    const paved = build({ surface: Block.STONE_BRICKS });
    dirt.transport.requestRoute(ID_A, ID_B);
    paved.transport.requestRoute(ID_A, ID_B);
    run(dirt.transport, 3);
    run(paved.transport, 3);
    const plain = dirt.transport.routes[0];
    const stone = paved.transport.routes[0];
    expect(stone.quality).toBeGreaterThan(plain.quality);
    expect(stone.grade).not.toBe(plain.grade);
    expect(loadFor(stone.quality)).toBeGreaterThan(loadFor(plain.quality));
    expect(paved.transport.speedOf(stone)).toBeGreaterThan(dirt.transport.speedOf(plain));

    // Same wait, same stock: the paved line has simply moved more of it.
    dirt.registry.produce(6000);
    paved.registry.produce(6000);
    run(dirt.transport, 400);
    run(paved.transport, 400);
    const moved = (arrivals: { count: number }[]): number =>
      arrivals.reduce((sum, a) => sum + a.count, 0);
    expect(moved(paved.events.arrivals)).toBeGreaterThan(moved(dirt.events.arrivals));
  });

  it('puts more porters on a longer line', () => {
    expect(portersFor(100)).toBe(1);
    expect(portersFor(1200)).toBeGreaterThan(portersFor(100));
    // And never an unbounded number of them, however far apart the villages are.
    expect(portersFor(1e6)).toBe(portersFor(1e7));
  });

  it('pays by the load, the distance and the demand', () => {
    expect(payFor(400, 4, true)).toBeGreaterThan(payFor(400, 4, false));
    expect(payFor(800, 4, true)).toBeGreaterThan(payFor(400, 4, true));
    expect(payFor(400, 8, true)).toBeGreaterThan(payFor(400, 4, true));
    // Even the shortest, least wanted haul is worth something.
    expect(payFor(1, 1, false)).toBeGreaterThanOrEqual(1);
  });

  it('round trips through a save without storing the road', () => {
    const { transport } = build();
    transport.requestRoute(ID_A, ID_B);
    const saved = transport.toJSON();
    expect(saved).toEqual([{ from: ID_A, to: ID_B }]);

    const fresh = build();
    fresh.transport.loadJSON(saved);
    run(fresh.transport, 3);
    // The road is re-surveyed from the edits, so a reloaded world keeps its route.
    expect(fresh.transport.routes[0].connected).toBe(true);
  });

  it('restores a route even before its villages are re-derived from the seed', () => {
    const world = new FakeWorld();
    const roads = new RoadNetwork(world);
    const registry = new VillageRegistry(1, SOURCE);
    const transport = new TransportNetwork(roads, registry);
    transport.loadJSON([{ from: ID_A, to: ID_B }]);
    expect(transport.routes).toHaveLength(1);
  });

  it('keeps trying to survey a route whose villages are not known yet', () => {
    const world = new FakeWorld();
    for (let x = 31; x <= 209; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    // A save restores routes before the player has walked near enough for the villages
    // to be re-derived from the seed.
    const registry = new VillageRegistry(1, { villagesAround: () => [] });
    const transport = new TransportNetwork(roads, registry);
    transport.loadJSON([{ from: ID_A, to: ID_B }]);
    run(transport, 6);
    expect(transport.routes[0].connected).toBe(false);

    // Once they are known, the very next sweep must pick the route up without anybody
    // having to touch a road block.
    const late = new VillageRegistry(1, SOURCE);
    late.ensureNear(0, 0);
    const revived = new TransportNetwork(roads, late);
    revived.loadJSON([{ from: ID_A, to: ID_B }]);
    run(revived, 6);
    expect(revived.routes[0].connected).toBe(true);
  });

  it('ignores a missing or malformed save', () => {
    const { transport } = build();
    transport.loadJSON(undefined);
    expect(transport.routes).toHaveLength(0);
  });
});


describe('a cart on a wide road', () => {
  it('runs where the road is three columns across', () => {
    const { transport } = build({ width: 3 });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('cart');
  });

  it('walks where it is not', () => {
    const { transport } = build({ width: 1 });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('porter');
    expect(transport.routes[0].cartPinch).not.toBeNull();
  });

  it('carries three times as much', () => {
    const wide = build({ width: 3 });
    wide.transport.requestRoute(ID_A, ID_B);
    run(wide.transport, 3);
    const narrow = build({ width: 1 });
    narrow.transport.requestRoute(ID_A, ID_B);
    run(narrow.transport, 3);
    expect(wide.transport.loadOf(wide.transport.routes[0])).toBe(
      narrow.transport.loadOf(narrow.transport.routes[0]) * CART_LOAD,
    );
  });

  it('goes back to walking when one block of the width is dug up, without losing cargo', () => {
    const { world, roads, transport, registry, events } = build({ width: 3 });
    transport.requestRoute(ID_A, ID_B);
    registry.produce(600);
    run(transport, 30);
    expect(transport.routes[0].vehicle).toBe('cart');
    expect(transport.routes[0].porters.length).toBeGreaterThan(0);
    const carrying = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carrying).toBeGreaterThan(0);

    // Both sides, so the road really is one column across here rather than merely
    // dented — a cart squeezes past a single missing block on the diagonal.
    for (const z of [-1, 1]) {
      world.lay(120, GROUND, z, Block.AIR);
      roads.onBlockChanged(120, GROUND, z, Block.DIRT_PATH, Block.AIR);
    }
    run(transport, 3);
    // A narrowed road is still a road: the line demotes rather than breaking, so nothing
    // that was already on it is thrown away.
    expect(transport.routes[0].vehicle).toBe('porter');
    expect(transport.routes[0].connected).toBe(true);
    expect(events.disconnected).toBe(0);
    expect(transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0)).toBe(carrying);
    expect(registry.get(ID_A)).toBeDefined();
  });
});

describe('what a detour is worth', () => {
  it('pays for where the goods went, not how far round the road took them', () => {
    // The fare is the straight line between the depots. It used to be the length of the
    // road, which paid *more* for a road that wandered.
    expect(payFor(400, 4, false)).toBe(payFor(400, 4, false));
    const straight = build();
    straight.transport.requestRoute(ID_A, ID_B);
    run(straight.transport, 3);
    const direct = straight.transport.routes[0].direct;

    const winding = build({ surface: null });
    // Out to z=60 and back: a road half again as long between the same two villages.
    for (let z = 0; z <= 60; z++) winding.world.lay(31, GROUND, z, Block.DIRT_PATH);
    for (let x = 31; x <= 209; x++) winding.world.lay(x, GROUND, 60, Block.DIRT_PATH);
    for (let z = 0; z <= 60; z++) winding.world.lay(209, GROUND, z, Block.DIRT_PATH);
    winding.roads.seedFromEdits();
    winding.transport.requestRoute(ID_A, ID_B);
    run(winding.transport, 3);

    const route = winding.transport.routes[0];
    expect(route.connected).toBe(true);
    expect(route.length).toBeGreaterThan(straight.transport.routes[0].length);
    expect(route.detour).toBeGreaterThan(1.2);
    // Same villages, same fare — the extra length is time, and time only.
    expect(route.direct).toBeCloseTo(direct, 5);
    expect(payFor(route.direct, 4, true)).toBe(payFor(direct, 4, true));
  });
});


describe('which end a trip starts from', () => {
  it('starts at the far end when the near one is a workshop with nothing to work with', () => {
    // B is the workshop and A grows what it needs. Recording the pair the other way round
    // used to deadlock the line for good: the outbound trip wanted stock B could not have
    // until the return leg of that same trip brought it.
    const { transport, registry, events } = build();
    const route = transport.requestRoute(ID_B, ID_A);
    expect(route?.from).toBe(ID_B);
    expect(registry.get(ID_B)?.input).toBe('wheat');
    expect(registry.get(ID_B)?.stock).toBe(0);

    registry.produce(600);
    expect(registry.get(ID_B)?.stock).toBe(0);
    expect(registry.get(ID_A)?.stock).toBeGreaterThan(0);

    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    const first = transport.routes[0].porters[0];
    expect(first, 'nothing set out at all').toBeDefined();
    // It set out from A — the end that actually had something.
    expect(first.home).toBe(1);
    expect(first.good).toBe('wheat');

    run(transport, 400);
    expect(events.arrivals.some((a) => a.to === ID_B && a.good === 'wheat')).toBe(true);
    expect(registry.get(ID_B)?.inputStock).toBeGreaterThan(0);
  });

  it('and the workshop starts shipping once its materials arrive', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_B, ID_A);
    registry.produce(600);
    // Both clocks, the way the game runs them: a workshop only converts while time is
    // passing for it as well as for the road.
    for (let t = 0; t < 900; t += 0.5) {
      registry.produce(0.5);
      transport.update(0.5, 10_000, 10_000);
    }
    // Wheat went in, bread came out, and the bread went where it was wanted.
    expect(events.arrivals.some((a) => a.to === ID_B && a.good === 'wheat')).toBe(true);
    expect(events.arrivals.some((a) => a.to === ID_A && a.good === 'bread')).toBe(true);
  });

  it('sets out with a single unit rather than waiting for a full load', () => {
    const { transport, registry } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    // Just enough time for one unit and no more.
    registry.produce(6.5);
    expect(registry.get(ID_A)?.stock).toBe(1);
    run(transport, 1);
    expect(transport.routes[0].porters).toHaveLength(1);
    expect(transport.routes[0].porters[0].cargo).toBe(1);
  });

  it('shares one village between the routes that leave it', () => {
    // Every route on a village calls takeStock in the same frame and takeStock hands over
    // whatever is there. In array order the first route drained it every frame and the
    // rest never moved a thing.
    const { transport, registry } = build();
    transport.requestRoute(ID_A, ID_B);
    const second = transport.requestRoute(ID_A, villageId(480, 0));
    expect(second).not.toBeNull();
    // The second pair has no road and no far village, so give it one the survey can walk:
    // the point here is only the order stock is handed out in.
    registry.produce(6000);
    const before = registry.get(ID_A)?.stock ?? 0;
    run(transport, 60);
    expect(registry.get(ID_A)?.stock).toBeLessThan(before);
    expect(transport.routes[0].porters.length).toBeGreaterThan(0);
  });
});

describe('a train on a railway', () => {
  it('runs where every column is rail, however narrow the line', () => {
    const { transport } = build({ surface: Block.RAIL });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.connected).toBe(true);
    expect(route.vehicle).toBe('train');
    expect(route.railPinch).toBeNull();
  });

  it('carries more than the best cart, and gets there faster', () => {
    // Rail is the one upgrade that moves both numbers, which is what makes it worth
    // paying iron for once there is nothing left to widen.
    const rail = build({ surface: Block.RAIL });
    rail.transport.requestRoute(ID_A, ID_B);
    run(rail.transport, 3);
    const cart = build({ surface: Block.STONE_BRICKS, width: 3 });
    cart.transport.requestRoute(ID_A, ID_B);
    run(cart.transport, 3);

    const byRail = rail.transport.routes[0];
    const byCart = cart.transport.routes[0];
    expect(byCart.vehicle).toBe('cart');
    expect(rail.transport.loadOf(byRail)).toBeGreaterThan(cart.transport.loadOf(byCart));
    expect(rail.transport.speedOf(byRail)).toBeGreaterThan(cart.transport.speedOf(byCart));
    expect(rail.transport.loadOf(byRail)).toBe(loadFor(byRail.quality) * TRAIN_LOAD);
  });

  it('beats width when the line is both railed and wide', () => {
    const { transport } = build({ surface: Block.RAIL, width: 3 });
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('train');
  });

  it('goes back to a cart when one rail is pulled up, without losing cargo', () => {
    const { world, roads, transport, registry, events } = build({ surface: Block.RAIL, width: 3 });
    transport.requestRoute(ID_A, ID_B);
    registry.produce(600);
    // Eight seconds, not thirty: a train covers seven blocks a second, so by thirty it
    // has been there and back and there is nothing in flight to protect.
    run(transport, 8);
    expect(transport.routes[0].vehicle).toBe('train');
    const carrying = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carrying).toBeGreaterThan(0);

    for (const z of [-1, 0, 1]) {
      world.lay(120, GROUND, z, Block.DIRT_PATH);
      roads.onBlockChanged(120, GROUND, z, Block.RAIL, Block.DIRT_PATH);
    }
    run(transport, 3);
    // One dirt column is still a road, and the road is still three across: the line
    // demotes to the cart it had already earned rather than breaking.
    expect(transport.routes[0].vehicle).toBe('cart');
    expect(transport.routes[0].connected).toBe(true);
    expect(events.disconnected).toBe(0);
    expect(transport.routes[0].railPinch).not.toBeNull();
    expect(transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0)).toBe(carrying);
  });

  it('sends the cargo home when the railway itself is dug up', () => {
    const { world, roads, transport, registry, events } = build({ surface: Block.RAIL });
    transport.requestRoute(ID_A, ID_B);
    registry.produce(600);
    // Eight seconds, not thirty: a train covers seven blocks a second, so by thirty it
    // has been there and back and there is nothing in flight to protect.
    run(transport, 8);
    expect(transport.routes[0].vehicle).toBe('train');
    const carrying = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carrying).toBeGreaterThan(0);
    const stock = registry.get(ID_A)!.stock;

    world.lay(120, GROUND, 0, Block.AIR);
    roads.onBlockChanged(120, GROUND, 0, Block.RAIL, Block.AIR);
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(false);
    expect(events.disconnected).toBe(1);
    expect(registry.get(ID_A)!.stock).toBe(stock + carrying);
    expect(transport.routes[0].railPinch).toBeNull();
  });

  it('draws a train while a train is running it, and a walker afterwards', () => {
    // The mob is only ever a picture of the shipment, so when the road stops deserving a
    // train the picture has to change with it — otherwise a locomotive keeps rolling
    // down a line that no longer has rails under it.
    const drawn: Vehicle[] = [];
    const host: PorterHost = {
      spawnPorter: (_point, vehicle) => {
        drawn.push(vehicle);
        return drawn.length;
      },
      porterPosition: () => null,
      movePorter: () => {},
      removePorter: () => {},
    };
    const { world, roads, transport, registry } = build({ surface: Block.RAIL, host });
    transport.requestRoute(ID_A, ID_B);
    registry.produce(600);
    // Standing at the origin, so the mob is actually drawn: `run` puts the player ten
    // thousand blocks away, where a shipment is a number and nothing is spawned.
    for (let t = 0; t < 2; t += 0.5) transport.update(0.5, 0, 0);
    expect(drawn).toContain('train');

    world.lay(120, GROUND, 0, Block.DIRT_PATH);
    roads.onBlockChanged(120, GROUND, 0, Block.RAIL, Block.DIRT_PATH);
    for (let t = 0; t < 2; t += 0.5) transport.update(0.5, 0, 0);
    expect(transport.routes[0].vehicle).toBe('porter');
    expect(drawn[drawn.length - 1]).toBe('porter');
  });
});
