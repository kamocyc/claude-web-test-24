import { describe, expect, it } from 'vitest';
import {
  BASE_LOAD,
  CART_LOAD,
  MAX_WAGONS,
  WAGON_LOAD,
  carsFor,
  PORTER_SPEED,
  RAIL_QUALITY,
  TRAIN_LOAD,
  TransportNetwork,
  loadFor,
  payFor,
  portersFor,
  STALL_WAIT,
  type Porter,
  type PorterHost,
  type RailSource,
  type Route,
  type RailWay,
  type TransportEvents,
  type Vehicle,
} from '../game/transport';
import { STREET_REACH, RoadNetwork, roadGrade, type RoadPoint, type RoadWorld } from '../game/roads';
import { LineNetwork, type Stop } from '../game/lines';
import { IndustryRegistry } from '../game/industry';
import { networkSites, type DepotSource } from '../game/sites';
import {
  MAX_STAGE,
  PASSENGER,
  STAGE_POINTS,
  VillageRegistry,
  villageId,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';
import { Block, type BlockId } from '../world/blocks';
import { blockIndex, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';

/** The two ends every road in this file runs between: one column past each town's
 *  outermost street, so a finished road touches the grid at both ends. Derived rather than
 *  written down, because the town that decides it is generated geometry. */
const FROM = STREET_REACH + 1;
const TO = 240 - STREET_REACH - 1;


const GROUND = 60;
/** The same pair `villages.test.ts` pins: A bakes bread out of wheat, B blows glass out of
 *  sand and coal, and each of them wants what the other makes. Both are starved until
 *  something feeds them, because every town in this game is — so `build` stocks their works
 *  unless a test is about what happens when it does not. */
const SEED = 263;
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

/** A railway between the two villages, as transport sees one.
 *
 *  A straight line on piers three blocks over everything, because the point of the real
 *  thing is that it does not care what is underneath it — and because none of what this
 *  module does with a way depends on the shape of it. `laid` is how much of it exists:
 *  under 1 the two villages are not joined and only a railhead is reported. */
class FakeRails implements RailSource {
  private built = 1;
  private moved = 1;
  /** Whether somebody has built the stations. Rails on their own are a line that runs
   *  past the two villages rather than one that serves them. */
  private manned = true;

  /** Deck height. Well clear of the ground, so nothing here can be confused with a road. */
  static readonly DECK = GROUND + 3;

  lay(fraction: number): void {
    this.built = fraction;
    this.moved++;
  }

  /** Builds or takes down the stations at both ends at once. */
  station(built: boolean): void {
    this.manned = built;
    this.moved++;
  }

  revision(): number {
    return this.moved;
  }

  wayBetween(from: RoadPoint, to: RoadPoint): RailWay | null {
    if (this.built < 1 || !this.manned) return null;
    const points = this.line(from, to, 1);
    return { points, climb: 0, sections: this.blocks(points.length) };
  }

  /** Signals every `gap` points along the line, or none at all. Zero is what every
   *  railway in the world is until somebody builds one, and it is the case that has to
   *  keep behaving exactly as it always did. */
  signalEvery(gap: number): void {
    this.gap = gap;
    this.moved++;
  }

  private gap = 0;

  /** The blocks the signals cut the line into, numbered from 101 so that nothing in a
   *  test can be confused with the unwatched zero. */
  private blocks(points: number): { at: number; id: number }[] {
    if (this.gap <= 0) return [];
    const out: { at: number; id: number }[] = [];
    for (let at = 0; at < points; at += this.gap) out.push({ at, id: 101 + out.length });
    return out;
  }

  /** An end near a place with nothing to load freight at it. The rails here run from the
   *  first village towards the second, so which end is which cannot be told apart by
   *  coordinates alone — the fake answers for whatever it is asked about, and transport
   *  asks about the origin first. */
  stationGapAt(place: RoadPoint): RoadPoint | null {
    if (this.built <= 0 || this.manned) return null;
    return { x: place.x, y: FakeRails.DECK, z: place.z };
  }

  railheadTowards(from: RoadPoint, to: RoadPoint): RoadPoint | null {
    if (this.built <= 0) return null;
    const line = this.line(from, to, this.built);
    return line[line.length - 1];
  }

  private line(from: RoadPoint, to: RoadPoint, fraction: number): RoadPoint[] {
    const out: RoadPoint[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * fraction;
      out.push({
        x: from.x + (to.x - from.x) * t,
        y: FakeRails.DECK,
        z: from.z + (to.z - from.z) * t,
      });
    }
    return out;
  }
}

interface BuildOptions {
  /** What the road is paved with, or null for no road at all. */
  surface?: BlockId | null;
  /** Somewhere to draw porters, when the test cares about the visible ones. */
  host?: PorterHost;
  /** Columns across. Three is what a cart needs. */
  width?: number;
  /** A railway between the two villages, when the test is about one. */
  rails?: FakeRails;
  /** Doorways for the two villages, when the test cares that goods start and finish at a
   *  building rather than at a point on the map. */
  depots?: DepotSource | null;
  /** The buildings inside the two villages, when the test is about people rather than
   *  crates. Null everywhere else, which is a village with no town in it — exactly what
   *  every test here was before people existed. */
  town?: FakeTown | null;
  /** Whether the two towns' works start with raw material in them. True everywhere except
   *  the tests that are about a starved works, which is the state a town is in until the
   *  player has built an industry and a line to it. */
  stocked?: boolean;
}

/** The villages' streets end at x=30 and x=(TO + 1), and a road connects by touching one, so
 *  an unbroken run from FROM to TO is the finished road. */
/** A town that always has somebody wanting to leave, and remembers what arrived.
 *
 *  Stands in for `TownEconomy`, which is a whole simulation and not the thing under test
 *  here: what these tests are about is whether a route picks people up and puts them
 *  down, which is a question about `transport.ts`. */
class FakeTown {
  readonly waiting = new Map<string, number>();
  readonly delivered: { id: string; good: string; count: number }[] = [];

  constructor(waiting: Record<string, number> = {}) {
    for (const [id, count] of Object.entries(waiting)) this.waiting.set(id, count);
  }

  waitingAt(id: string): number {
    return this.waiting.get(id) ?? 0;
  }

  takeWaiting(id: string, count: number): number {
    const taken = Math.min(count, this.waitingAt(id));
    this.waiting.set(id, this.waitingAt(id) - taken);
    return taken;
  }

  returnWaiting(id: string, count: number): void {
    this.waiting.set(id, this.waitingAt(id) + count);
  }

  deliver(id: string, good: string, count: number): number {
    this.delivered.push({ id, good, count });
    return count;
  }
}

/** Fills a town's works, without paying it for the delivery.
 *
 *  `deliver` would do it and would also bank the points, which raises the stage, which
 *  changes both how fast the works runs and what the town asks for — none of which any
 *  test here is about. */
function stock(registry: VillageRegistry, id: string): void {
  const record = registry.get(id);
  if (!record) return;
  for (const good of record.inputs) record.inputStock.set(good, 64);
}

function build({
  surface = Block.DIRT_PATH, host, width = 1, rails, depots, town, stocked = true,
}: BuildOptions = {}) {
  const world = new FakeWorld();
  const span = Math.floor((width - 1) / 2);
  if (surface !== null) {
    for (let x = FROM; x <= TO; x++) {
      for (let z = -span; z <= span; z++) world.lay(x, GROUND, z, surface);
    }
  }
  const roads = new RoadNetwork(world);
  roads.seedFromEdits();
  const registry = new VillageRegistry(SEED, SOURCE, town ?? null);
  registry.ensureNear(0, 0);
  registry.discover(ID_A);
  registry.discover(ID_B);
  const events: {
    arrivals: { good: string; count: number; needed: boolean; pay: number; to: string }[];
    stages: { id: string; stage: number }[];
    connected: number;
    disconnected: number;
  } = { arrivals: [], stages: [], connected: 0, disconnected: 0 };
  const handlers: TransportEvents = {
    onArrival: (arrival) =>
      events.arrivals.push({
        good: arrival.good, count: arrival.count, needed: arrival.needed,
        pay: arrival.pay, to: arrival.to.town ?? '',
      }),
    onStageUp: (at, stage) => events.stages.push({ id: at.town ?? '', stage }),
    onConnected: () => events.connected++,
    onDisconnected: () => events.disconnected++,
  };
  if (stocked) {
    stock(registry, ID_A);
    stock(registry, ID_B);
  }
  const industries = new IndustryRegistry();
  const network = new LineNetwork();
  const placedA = network.addStop({ x: A.x, y: GROUND, z: A.z }, ID_A, 'A');
  const placedB = network.addStop({ x: B.x, y: GROUND, z: B.z }, ID_B, 'B');
  if (!placedA.ok || !placedB.ok) throw new Error('the fixture could not put its stops down');
  const stopA: Stop = placedA.stop;
  const stopB: Stop = placedB.stop;
  const transport = new TransportNetwork(
    roads,
    networkSites(registry, industries, depots ?? null),
    handlers,
    host ?? null,
    rails ?? null,
  );
  /** Draws the line the rest of the test runs on, and hands back its one leg.
   *
   *  Every test in this file used to start by naming a pair of villages, because a road
   *  between two of them *was* a route. Now it starts by drawing a service, which is the
   *  whole change: the road can be finished and perfect and nothing moves over it until
   *  this has been called. */
  const link = (...stops: Stop[]): Route => {
    const line = network.createLine();
    for (const stop of stops.length > 0 ? stops : [stopA, stopB]) network.addCall(line.id, stop.id);
    transport.syncLines(network);
    return transport.routes[transport.routes.length - 1];
  };
  return { world, roads, registry, industries, network, transport, events, link, stopA, stopB };
}

/** A transport network over a road somebody else laid, with doors of the test's choosing.
 *
 *  `build` lays its own road and is what most of this file wants; this is for the handful
 *  of tests that lay a peculiar one first and then need a service over it. */
function wire(
  roads: RoadNetwork,
  depots: DepotSource | null = null,
  registry = new VillageRegistry(SEED, SOURCE),
) {
  registry.ensureNear(0, 0);
  registry.discover(ID_A);
  registry.discover(ID_B);
  const network = new LineNetwork();
  const placedA = network.addStop({ x: A.x, y: GROUND, z: A.z }, ID_A, 'A');
  const placedB = network.addStop({ x: B.x, y: GROUND, z: B.z }, ID_B, 'B');
  if (!placedA.ok || !placedB.ok) throw new Error('the fixture could not put its stops down');
  const transport = new TransportNetwork(
    roads, networkSites(registry, new IndustryRegistry(), depots), {}, null, null,
  );
  const link = (): Route => {
    const line = network.createLine();
    network.addCall(line.id, placedA.stop.id);
    network.addCall(line.id, placedB.stop.id);
    transport.syncLines(network);
    return transport.routes[transport.routes.length - 1];
  };
  return { registry, network, transport, link };
}

/** Depots a little way off the line, so that the walk between a doorway and the platform
 *  is a real part of the trip rather than nothing at all. Both sit twenty blocks south of
 *  their village's middle, which is where the railway runs. */
const DOORS: DepotSource = {
  doorOf: (village) => (village === ID_A
    ? { x: 0, y: GROUND, z: -20 }
    : { x: 240, y: GROUND, z: -20 }),
  plotsOf: () => [],
};

/** Runs the simulation in small steps, the way the game loop does. */
function run(transport: TransportNetwork, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) transport.update(step, 10_000, 10_000);
}

describe('transport routes', () => {
  it('surveys a paved route as connected', () => {
    const { transport, events, link } = build();
    link();
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    expect(events.connected).toBe(1);
  });

  it('reports the gap when the road is unfinished', () => {
    const { transport, link } = build({ surface: null });
    link();
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.connected).toBe(false);
    expect(route.missing).toBeGreaterThan(0);
    expect(route.gapFrom).not.toBeNull();
    expect(route.gapTo).not.toBeNull();
  });

  it('runs one leg per line, even when two lines cover the same ground', () => {
    const { transport, link, stopA, stopB } = build();
    link();
    // Two services over one road is two services. That is not a duplicate — it is what a
    // player builds when one line is the through working and the other is the local.
    link(stopB, stopA);
    expect(transport.routes).toHaveLength(2);
    expect(new Set(transport.routes.map((route) => route.lineId)).size).toBe(2);
  });

  it('delivers goods after the walk takes as long as the road is long', () => {
    const { transport, registry, events, link } = build();
    link();
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
    expect(events.arrivals[0].good).toBe('bread');
    expect(registry.get(ID_B)?.points).toBeGreaterThan(0);
  });

  it('is worth more to the far town when it asked for the goods', () => {
    const { transport, registry, events, link } = build();
    link();
    run(transport, 3);
    registry.produce(600);
    run(transport, 200);
    // B's homes are the ones asking for bread, which is what makes the haul worth more.
    expect(events.arrivals[0].needed).toBe(true);
    expect(events.arrivals[0].pay).toBeGreaterThan(0);
    expect(registry.get(ID_B)?.received).toBeGreaterThan(0);
  });

  it('brings back what the origin wants instead of walking home empty', () => {
    const { transport, registry, events, link } = build();
    link();
    run(transport, 3);
    registry.produce(600);
    // Long enough for B to have blown some of the glass A is asking for.
    for (let t = 0; t < 600; t += 0.5) {
      registry.produce(0.5);
      transport.update(0.5, 10_000, 10_000);
    }
    const home = events.arrivals.filter((a) => a.to === ID_A);
    expect(home.length).toBeGreaterThan(0);
    expect(home[0].good).toBe('glass');
  });

  it('raises the destination one stage once enough has arrived', () => {
    const { transport, registry, events, link } = build();
    link();
    run(transport, 3);
    registry.produce(6000);
    run(transport, 400);
    // Both ends grow, because each is buying what the other makes — so the ranks are
    // counted per town rather than in one heap.
    const grown = events.stages.filter((entry) => entry.id === ID_B).map((entry) => entry.stage);
    expect(grown[0]).toBe(1);
    // Ranks arrive in order and never repeat.
    expect(grown).toEqual([...grown].sort((a, b) => a - b));
    expect(new Set(grown).size).toBe(grown.length);
  });

  it('needs stock before it dispatches anything', () => {
    const { transport, events, link } = build();
    link();
    run(transport, 200);
    expect(events.arrivals).toHaveLength(0);
  });

  it('keeps a porter between the two ends and sends it home again', () => {
    const { transport, registry, link } = build();
    link();
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
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const { transport, link } = wire(roads, doors);
    link();
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
    for (let x = FROM; x <= TO; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    const { transport, link } = wire(roads, doors);
    link();
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
    const { transport, link } = build();
    link();
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    expect(transport.routes[0].fromDoor).toBeNull();
  });

  it('delivers on time with somebody watching a porter that cannot move', () => {
    const stuck = new StuckHost();
    const { transport, registry, events, link } = build({ host: stuck });
    link();
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
    const { world, roads, transport, registry, events, link } = build();
    link();
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
    const { world, roads, transport, registry, events, link } = build();
    link();
    run(transport, 3);
    world.lay(110, GROUND, 0, Block.AIR);
    roads.onBlockChanged(110, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    registry.produce(6000);
    run(transport, 2000);
    expect(events.arrivals).toHaveLength(0);
  });

  it('stops banking stages at the cap', () => {
    const { transport, registry, link } = build();
    link();
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
    dirt.link();
    paved.link();
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

  it('keeps a leg that is still the same leg when the line is edited', () => {
    const { transport, network, link, stopA } = build();
    const route = link();
    run(transport, 3);
    route.delivered = 7;
    // Adding a call at the end of a line leaves the leg before it exactly where it was.
    // Throwing that away would mean editing the far end of a line stopped the near end.
    const line = [...network.lines.values()][0];
    network.addCall(line.id, stopA.id);
    transport.syncLines(network);
    expect(transport.routes[0]).toBe(route);
    expect(transport.routes[0].delivered).toBe(7);
  });

  it('hands the cargo back when a leg stops existing', () => {
    const { transport, registry, network, link } = build();
    link();
    run(transport, 3);
    registry.produce(600);
    run(transport, 20);
    const carried = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carried).toBeGreaterThan(0);
    const before = (registry.get(ID_A)?.stock ?? 0) + (registry.get(ID_B)?.stock ?? 0);

    for (const line of [...network.lines.keys()]) network.deleteLine(line);
    transport.syncLines(network);
    expect(transport.routes).toHaveLength(0);
    // Editing a line should cost time, not cargo.
    expect((registry.get(ID_A)?.stock ?? 0) + (registry.get(ID_B)?.stock ?? 0))
      .toBe(before + carried);
  });

  it('surveys a leg the moment it is drawn, wherever its towns are', () => {
    const world = new FakeWorld();
    // Right up to both stops, because a stop with no town behind it has no streets of its
    // own for a road to arrive at: it owns the few columns beside it and nothing more.
    for (let x = 0; x <= 240; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world);
    roads.seedFromEdits();
    // A stop carries its own position, so a leg is walkable even in a session where
    // nobody has been near either town yet. That used to need two sweeps and a special
    // case; now it needs neither.
    const registry = new VillageRegistry(1, { villagesAround: () => [] });
    const { transport, link } = wire(roads, null, registry);
    link();
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
  });

  it('runs nothing at all until a line says so', () => {
    const { transport } = build();
    // The road is finished and perfect. Nothing has been drawn on it, so nothing moves —
    // which is the whole of the change this file exists to describe.
    run(transport, 6);
    expect(transport.routes).toHaveLength(0);
  });
});


describe('a cart on a wide road', () => {
  it('runs where the road is three columns across', () => {
    const { transport, link } = build({ width: 3 });
    link();
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('cart');
  });

  it('walks where it is not', () => {
    const { transport, link } = build({ width: 1 });
    link();
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('porter');
    expect(transport.routes[0].cartPinch).not.toBeNull();
  });

  it('carries three times as much', () => {
    const wide = build({ width: 3 });
    wide.link();
    run(wide.transport, 3);
    const narrow = build({ width: 1 });
    narrow.link();
    run(narrow.transport, 3);
    expect(wide.transport.loadOf(wide.transport.routes[0])).toBe(
      narrow.transport.loadOf(narrow.transport.routes[0]) * CART_LOAD,
    );
  });

  it('goes back to walking when one block of the width is dug up, without losing cargo', () => {
    const { world, roads, transport, registry, events, link } = build({ width: 3 });
    link();
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
    straight.link();
    run(straight.transport, 3);
    const direct = straight.transport.routes[0].direct;

    const winding = build({ surface: null });
    // Out to z=60 and back: a road half again as long between the same two villages.
    for (let z = 0; z <= 60; z++) winding.world.lay(FROM, GROUND, z, Block.DIRT_PATH);
    for (let x = FROM; x <= TO; x++) winding.world.lay(x, GROUND, 60, Block.DIRT_PATH);
    for (let z = 0; z <= 60; z++) winding.world.lay(TO, GROUND, z, Block.DIRT_PATH);
    winding.roads.seedFromEdits();
    winding.link();
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
  it('starts at the far end when the near one has nothing to work with', () => {
    // B's works is empty and A bakes what B's homes want. Recording the leg the other way
    // round used to deadlock it for good: the outbound trip wanted stock B could not have
    // until the trip home brought it.
    const { transport, registry, events, link, stopA, stopB } = build({ stocked: false });
    stock(registry, ID_A);
    const route = link(stopB, stopA);
    expect(route?.from.town).toBe(ID_B);
    expect(registry.starvedOf(registry.get(ID_B)!)).toBe('sand');
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
    expect(first.good).toBe('bread');

    run(transport, 400);
    expect(events.arrivals.some((a) => a.to === ID_B && a.good === 'bread')).toBe(true);
    expect(registry.get(ID_B)?.received).toBeGreaterThan(0);
  });

  it('and the far end keeps shipping once its own works is fed', () => {
    const { transport, registry, events, link, stopA, stopB } = build();
    link(stopB, stopA);
    registry.produce(600);
    // Both clocks, the way the game runs them: a workshop only converts while time is
    // passing for it as well as for the road.
    for (let t = 0; t < 900; t += 0.5) {
      registry.produce(0.5);
      transport.update(0.5, 10_000, 10_000);
    }
    // Both directions ran: each town wants what the other makes.
    expect(events.arrivals.some((a) => a.to === ID_B && a.good === 'bread')).toBe(true);
    expect(events.arrivals.some((a) => a.to === ID_A && a.good === 'glass')).toBe(true);
  });

  it('sets out with a single unit rather than waiting for a full load', () => {
    const { transport, registry, link } = build();
    link();
    run(transport, 3);
    // Just enough time for one unit and no more.
    registry.produce(6.5);
    expect(registry.get(ID_A)?.stock).toBe(1);
    run(transport, 1);
    expect(transport.routes[0].porters).toHaveLength(1);
    expect(transport.routes[0].porters[0].cargo).toBe(1);
  });

  it('shares one town between the legs that leave it', () => {
    // Every leg on a town calls takeStock in the same frame and takeStock hands over
    // whatever is there. In array order the first leg drained it every frame and the rest
    // never moved a thing.
    const { transport, registry, link, stopA, stopB } = build();
    link();
    link(stopA, stopB);
    expect(transport.routes).toHaveLength(2);
    registry.produce(6000);
    const before = registry.get(ID_A)?.stock ?? 0;
    run(transport, 60);
    expect(registry.get(ID_A)?.stock).toBeLessThan(before);
    expect(transport.routes[0].porters.length).toBeGreaterThan(0);
  });
});

describe('a train on a railway', () => {
  it('runs where the rails join the two villages, with no road at all', () => {
    // The whole of what replacing the block railway bought: a railway is its own way
    // between two places, laid over whatever is in between, and nothing about it asks
    // whether anybody ever paved anything.
    const rails = new FakeRails();
    const { transport, link } = build({ surface: null, rails });
    link();
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.connected).toBe(true);
    expect(route.vehicle).toBe('train');
    expect(route.railPinch).toBeNull();
    // And the goods really are up on the deck rather than down on the ground.
    expect(transport.pointAt(route, 0.5)?.y).toBe(FakeRails.DECK);
  });

  it('is quoted one quality for its whole length, whatever the road beside it is', () => {
    // A road is worth what it is paved with, stretch by stretch. A railway is not paved:
    // it is the same thing all the way along, and a line over a gorge is exactly as good
    // as one over a meadow.
    const rails = new FakeRails();
    const { transport, link } = build({ surface: Block.DIRT_PATH, rails });
    link();
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.quality).toBe(RAIL_QUALITY);
    expect(route.grade).toBe(roadGrade(RAIL_QUALITY));
    expect(route.grade).toBe('鉄路');
  });

  it('carries more than the best cart, and gets there faster', () => {
    // A railway is the one upgrade that moves both numbers, which is what makes it worth
    // paying iron for once there is nothing left to widen.
    const rail = build({ surface: null, rails: new FakeRails() });
    rail.link();
    run(rail.transport, 3);
    const cart = build({ surface: Block.STONE_BRICKS, width: 3 });
    cart.link();
    run(cart.transport, 3);

    const byRail = rail.transport.routes[0];
    const byCart = cart.transport.routes[0];
    expect(byCart.vehicle).toBe('cart');
    expect(rail.transport.loadOf(byRail)).toBeGreaterThan(cart.transport.loadOf(byCart));
    expect(rail.transport.speedOf(byRail)).toBeGreaterThan(cart.transport.speedOf(byCart));
    expect(rail.transport.loadOf(byRail)).toBe(loadFor(RAIL_QUALITY) * TRAIN_LOAD);
  });

  it('beats the road when the line is both railed and wide', () => {
    const { transport, link } = build({ surface: Block.STONE_BRICKS, width: 3, rails: new FakeRails() });
    link();
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('train');
  });

  it('notices a railway that is laid without a road block being touched', () => {
    // The survey is skipped entirely while nothing it has looked at has moved, and the
    // road index does not move when a curve is laid a hundred blocks off it.
    const rails = new FakeRails();
    rails.lay(0);
    const { transport, link } = build({ surface: Block.DIRT_PATH, width: 3, rails });
    link();
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('cart');
    rails.lay(1);
    run(transport, 3);
    expect(transport.routes[0].vehicle).toBe('train');
  });

  it('goes back to a cart when the rails come up, without losing cargo', () => {
    const rails = new FakeRails();
    const { transport, registry, events, link } = build({ surface: Block.STONE_BRICKS, width: 3, rails });
    link();
    registry.produce(600);
    // Eight seconds, not thirty: a train covers seven blocks a second, so by thirty it
    // has been there and back and there is nothing in flight to protect.
    run(transport, 8);
    expect(transport.routes[0].vehicle).toBe('train');
    const carrying = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carrying).toBeGreaterThan(0);

    rails.lay(0.5);
    run(transport, 3);
    // The road is still three across, so the line demotes to the cart it had already
    // earned rather than breaking.
    expect(transport.routes[0].vehicle).toBe('cart');
    expect(transport.routes[0].connected).toBe(true);
    expect(events.disconnected).toBe(0);
    expect(transport.routes[0].railPinch).not.toBeNull();
    expect(transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0)).toBe(carrying);
  });

  it('sends the cargo home when the railway is dug up and there is no road', () => {
    const rails = new FakeRails();
    const { transport, registry, events, link } = build({ surface: null, rails });
    link();
    registry.produce(600);
    run(transport, 8);
    expect(transport.routes[0].vehicle).toBe('train');
    const carrying = transport.routes[0].porters.reduce((sum, p) => sum + p.cargo, 0);
    expect(carrying).toBeGreaterThan(0);
    const stock = registry.get(ID_A)!.stock;

    rails.lay(0);
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(false);
    expect(events.disconnected).toBe(1);
    expect(registry.get(ID_A)!.stock).toBe(stock + carrying);
    expect(transport.routes[0].railPinch).toBeNull();
  });

  it('says where a half built line stops, and nothing at all where there is none', () => {
    // A beacon over every village in the world, pointing at a gate, would be an answer to
    // a question nobody asked; the railhead is for a player who has started laying.
    const half = new FakeRails();
    half.lay(0.5);
    const { transport, link } = build({ surface: Block.DIRT_PATH, rails: half });
    link();
    run(transport, 3);
    const pinch = transport.routes[0].railPinch;
    expect(pinch).not.toBeNull();
    expect(pinch!.x).toBeCloseTo(120, 0);

    const none = build({ surface: Block.DIRT_PATH });
    none.link();
    run(none.transport, 3);
    expect(none.transport.routes[0].railPinch).toBeNull();
  });

  it('carries nothing until both ends have a station, and says where to build one', () => {
    // The rule the whole feature is: a line that reaches both villages and has nothing to
    // load freight at is a line that carries nothing. And it has to say so — finished
    // track that carries nothing looks exactly like finished track that does.
    const rails = new FakeRails();
    rails.station(false);
    const { transport, link } = build({ surface: null, rails });
    link();
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.connected, 'rails with no stations carried the goods').toBe(false);
    expect(route.stationGap, 'nothing said where to build the station').not.toBeNull();

    rails.station(true);
    run(transport, 3);
    expect(transport.routes[0].connected).toBe(true);
    expect(transport.routes[0].vehicle).toBe('train');
    expect(transport.routes[0].stationGap, 'still asking for a station it has').toBeNull();
  });

  it('does not ask for a station where there is no track to build one on', () => {
    const { transport, link } = build({ surface: Block.DIRT_PATH });
    link();
    run(transport, 3);
    expect(transport.routes[0].stationGap).toBeNull();
  });

  it('walks the goods out to the platform and hauls them from there', () => {
    // What loading looks like from the outside: somebody carries the crates out of the
    // village, the train takes them down the line, and somebody carries them in at the
    // far end. The clock never changes hands — only the picture of it does.
    const rails = new FakeRails();
    const { transport, registry, link } = build({ surface: null, rails, depots: DOORS });
    link();
    registry.produce(600);
    run(transport, 3);
    const route = transport.routes[0];
    expect(route.vehicle, 'the line is not railed').toBe('train');
    expect(route.railSpan, 'a railed route has no rail span').not.toBeNull();
    // The walk out of the village is a real part of the trip, so the rails are the middle
    // of it and not the whole of it.
    expect(route.railSpan!.from).toBeGreaterThan(0);
    expect(route.railSpan!.to).toBeLessThan(1);
    // At the door it is a porter, in the middle it is a train, at the far door a porter.
    expect(transport.vehicleAt(route, 0)).toBe('porter');
    expect(transport.vehicleAt(route, 0.5)).toBe('train');
    expect(transport.vehicleAt(route, 1)).toBe('porter');
  });

  it('draws the porter out to the platform and a train from there', () => {
    const drawn: { vehicle: Vehicle; cargo: number }[] = [];
    const host: PorterHost = {
      spawnPorter: (_point, vehicle, cargo) => {
        drawn.push({ vehicle, cargo });
        return drawn.length;
      },
      porterPosition: () => ({ x: 0, z: 0 }),
      movePorter: () => {},
      removePorter: () => {},
    };
    const { transport, registry, link } = build({
      surface: null, rails: new FakeRails(), host, depots: DOORS,
    });
    link();
    registry.produce(600);
    // Standing at the origin, where the walk out of the village happens.
    for (let t = 0; t < 3; t += 0.25) transport.update(0.25, 0, -20);
    expect(drawn[0]?.vehicle, 'the goods left the depot on a train').toBe('porter');
    expect(drawn.map((one) => one.vehicle)).toContain('train');
    // And the train is told what it is pulling, so it can couple up that many wagons.
    const train = drawn.find((one) => one.vehicle === 'train');
    expect(train!.cargo).toBeGreaterThan(0);
  });

  it('couples up a wagon for every sack the train is carrying', () => {
    // A full train is exactly the load multiplier it was promised, drawn: four wagons.
    // Anything less is a village that had less than a full load ready, and none at all is
    // a train going home empty — which is what a line that only pays one way looks like.
    expect(carsFor(0)).toBe(0);
    expect(carsFor(1)).toBe(1);
    expect(carsFor(WAGON_LOAD)).toBe(1);
    expect(carsFor(WAGON_LOAD + 1)).toBe(2);
    expect(carsFor(WAGON_LOAD * TRAIN_LOAD)).toBe(TRAIN_LOAD);
    expect(carsFor(WAGON_LOAD * 40), 'a load nobody can carry drew a train to the horizon')
      .toBe(MAX_WAGONS);
  });

  it('draws a train while a train is running it, and a walker afterwards', () => {
    // The mob is only ever a picture of the shipment, so when the line stops deserving a
    // train the picture has to change with it — otherwise a locomotive keeps rolling
    // along rails that are no longer under it.
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
    const rails = new FakeRails();
    const { transport, registry, link } = build({ surface: Block.DIRT_PATH, host, rails });
    link();
    registry.produce(600);
    // Standing at the origin, so the mob is actually drawn: `run` puts the player ten
    // thousand blocks away, where a shipment is a number and nothing is spawned.
    for (let t = 0; t < 2; t += 0.5) transport.update(0.5, 0, 0);
    expect(drawn).toContain('train');

    rails.lay(0);
    for (let t = 0; t < 4; t += 0.5) transport.update(0.5, 0, 0);
    expect(transport.routes[0].vehicle).toBe('porter');
    expect(drawn[drawn.length - 1]).toBe('porter');
  });
});

describe('signals and the block ahead', () => {
  /** A railway between the two villages, signalled or not, with the route surveyed and
   *  whatever `dispatch` sent on it cleared away — every test here places its own
   *  shipments, because where they are is the entire subject. */
  function railway(gap: number) {
    const rails = new FakeRails();
    rails.signalEvery(gap);
    const { transport, link } = build({ surface: null, rails });
    link();
    run(transport, 3);
    const route = transport.routes[0];
    route.porters.length = 0;
    return { transport, route };
  }

  /** Puts a shipment on the line at `t`, heading the way `dir` says. */
  function ship(route: Route, t: number, dir: 1 | -1): Porter {
    const porter: Porter = {
      t, dir, home: dir === 1 ? 0 : 1, good: 'wheat', cargo: 1,
      mobId: null, mobVehicle: null, held: 0,
    };
    route.porters.push(porter);
    return porter;
  }

  it('cuts the trip up where the railway says the blocks are', () => {
    const { route } = railway(3);
    // Nine points from village to village, a signal every third: three blocks, and the
    // first one starts at the very beginning of the trip rather than at the platform.
    expect(route.sections.map((mark) => mark.id)).toEqual([101, 102, 103]);
    expect(route.sections[0].at).toBe(0);
    expect(route.sections[1].at).toBeCloseTo(0.375, 3);
    expect(route.sections[2].at).toBeCloseTo(0.75, 3);
  });

  it('lets two shipments share an unsignalled line, exactly as it always did', () => {
    // The rule the whole feature stands on: every railway built before signals existed
    // has none on it, and must go on running as if none of this were here.
    const { transport, route } = railway(0);
    expect(route.sections).toEqual([]);
    const front = ship(route, 0.5, 1);
    const behind = ship(route, 0.4, 1);
    run(transport, 1);
    expect(behind.t, 'the second shipment was held up on a line with no signals')
      .toBeGreaterThan(0.4);
    expect(behind.held).toBe(0);
    expect(front.t).toBeGreaterThan(0.5);
  });

  it('stops a shipment at the signal rather than letting it into an occupied block', () => {
    const { transport, route } = railway(3);
    // One in the middle block, one coming up behind it in the first.
    ship(route, 0.5, 1);
    const behind = ship(route, 0.3, 1);
    run(transport, 4);
    expect(behind.t, 'the second shipment ran into the back of the first')
      .toBeLessThan(route.sections[1].at);
    expect(behind.held, 'it was not recorded as waiting').toBeGreaterThan(0);
  });

  it('lets it go the moment the block ahead is empty', () => {
    const { transport, route } = railway(3);
    const front = ship(route, 0.5, 1);
    const behind = ship(route, 0.3, 1);
    run(transport, 4);
    const waited = behind.t;
    expect(waited, 'nothing was ever held up, so nothing is being let go').toBeLessThan(
      route.sections[1].at,
    );
    route.porters.splice(route.porters.indexOf(front), 1);
    run(transport, 4);
    expect(behind.t, 'the block stayed shut after the train in it had gone')
      .toBeGreaterThan(route.sections[1].at);
    expect(behind.t).toBeGreaterThan(waited);
    expect(behind.held).toBe(0);
  });

  it('does not hold up a shipment already inside the block it is in', () => {
    // A signal built under a train halfway past it leaves two shipments in one block.
    // Neither is asked to leave: whichever is not recorded as holding it is still free to
    // carry on out of the far end, which is the only way that ever untangles itself.
    const { transport, route } = railway(3);
    const first = ship(route, 0.5, 1);
    const second = ship(route, 0.55, 1);
    run(transport, 1);
    expect(first.t).toBeGreaterThan(0.5);
    expect(second.t).toBeGreaterThan(0.55);
  });

  it('jams when two shipments meet head on, and says so rather than going quiet', () => {
    // Left to happen on purpose. The railway is the player's, and untangling it for them
    // would teach them nothing about the passing loop they did not build — but a line
    // that stopped in silence would teach them nothing either.
    const { transport, route } = railway(3);
    // Nose to nose either side of the signal at 0.375: each is in the block the other
    // wants, so neither can be let through and neither will ever give way.
    const east = ship(route, 0.3, 1);
    const west = ship(route, 0.4, -1);
    run(transport, 4);
    expect(route.stall, 'a jam was called before anybody had waited long enough').toBeNull();
    run(transport, STALL_WAIT);
    expect(east.held).toBeGreaterThan(STALL_WAIT);
    expect(west.held).toBeGreaterThan(STALL_WAIT);
    expect(route.stall, 'the line jammed and nothing said so').not.toBeNull();
    // And it stays jammed: nothing here quietly picks a winner.
    const held = { east: east.t, west: west.t };
    run(transport, 10);
    expect(east.t).toBeCloseTo(held.east, 6);
    expect(west.t).toBeCloseTo(held.west, 6);
  });

  it('forgets the jam once the line is running again', () => {
    const { transport, route } = railway(3);
    ship(route, 0.3, 1);
    const west = ship(route, 0.4, -1);
    run(transport, STALL_WAIT + 4);
    expect(route.stall).not.toBeNull();
    route.porters.splice(route.porters.indexOf(west), 1);
    run(transport, 2);
    expect(route.stall).toBeNull();
  });
});

describe('people as something a line carries', () => {
  it('sends nobody while there are crates to send', () => {
    // A route is worth more carrying goods, so a town with something to ship never has its
    // trip taken by the queue at its station.
    const town = new FakeTown({ [ID_A]: 20, [ID_B]: 20 });
    const { transport, registry, link } = build({ town });
    registry.get(ID_A)!.stock = 10;
    registry.get(ID_B)!.stock = 10;
    link();
    run(transport, 6);
    const route = transport.routes[0];
    expect(route.porters.length).toBeGreaterThan(0);
    expect(route.porters.every((p: Porter) => p.good !== PASSENGER)).toBe(true);
    // And the queue is untouched: nobody was picked up while there were crates.
    expect(town.waitingAt(ID_A)).toBe(20);
  });

  it('fills a leg that would otherwise have run empty', () => {
    const town = new FakeTown({ [ID_A]: 20 });
    const { transport, registry, link } = build({ town });
    link();
    run(transport, 4);
    // Neither village has anything to ship, so nothing about crates can start a trip.
    registry.get(ID_A)!.stock = 0;
    registry.get(ID_B)!.stock = 0;
    run(transport, 6);
    const route = transport.routes[0];
    expect(route.porters.length).toBeGreaterThan(0);
    expect(route.porters[0].good).toBe(PASSENGER);
    expect(town.waitingAt(ID_A)).toBeLessThan(20);
  });

  it('delivers people as a delivery, and pays for the trip', () => {
    const town = new FakeTown({ [ID_A]: 40 });
    const { transport, registry, events, link } = build({ town });
    link();
    run(transport, 4);
    registry.get(ID_A)!.stock = 0;
    registry.get(ID_B)!.stock = 0;
    run(transport, 400);
    const arrival = events.arrivals.find((a) => a.good === PASSENGER);
    expect(arrival).toBeDefined();
    expect(arrival!.to).toBe(ID_B);
    expect(arrival!.pay).toBeGreaterThan(0);
    // People are not stock: nothing is put on a shelf when they get off.
    expect(town.delivered.some((d) => d.good === PASSENGER)).toBe(false);
  });

  it('puts people back on the platform when the road is dug up under them', () => {
    const town = new FakeTown({ [ID_A]: 20 });
    const { transport, registry, world, roads, link } = build({ town });
    link();
    run(transport, 4);
    registry.get(ID_A)!.stock = 0;
    registry.get(ID_B)!.stock = 0;
    run(transport, 8);
    const route = transport.routes[0];
    expect(route.porters[0]?.good).toBe(PASSENGER);
    const riding = route.porters[0].cargo;
    const had = town.waitingAt(ID_A);
    world.lay(120, GROUND, 0, Block.AIR);
    roads.onBlockChanged(120, GROUND, 0, Block.DIRT_PATH, Block.AIR);
    run(transport, 5);
    expect(route.connected).toBe(false);
    // Somebody halfway to a town they wanted to reach goes back to waiting for the next
    // one, rather than ceasing to exist.
    expect(town.waitingAt(ID_A)).toBe(had + riding);
  });

  it('carries nobody at all where nothing is modelling the towns', () => {
    // Every other test in this file builds a registry with no town link, and this is why
    // they are all still honest: a village with no buildings has nobody waiting.
    const { transport, registry, link } = build();
    link();
    run(transport, 4);
    registry.get(ID_A)!.stock = 0;
    registry.get(ID_B)!.stock = 0;
    expect(registry.waiting(ID_A)).toBe(0);
    run(transport, 20);
    expect(transport.routes[0].porters).toHaveLength(0);
  });
});
