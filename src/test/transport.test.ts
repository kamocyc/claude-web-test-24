import { describe, expect, it } from 'vitest';
import {
  BASE_LOAD,
  PORTER_SPEED,
  TransportNetwork,
  loadFor,
  payFor,
  portersFor,
  type PorterHost,
  type TransportEvents,
} from '../game/transport';
import { RoadNetwork, MAX_LINK, type RoadTerrain, type RoadWorld } from '../game/roads';
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

const TERRAIN: RoadTerrain = { height: () => GROUND };
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
  /** Blocks between one laid column and the next. 1 is a road somebody finished. */
  step?: number;
  /** Somewhere to draw porters, when the test cares about the visible ones. */
  host?: PorterHost;
}

function build({ surface = Block.DIRT_PATH, step = 1, host }: BuildOptions = {}) {
  const world = new FakeWorld();
  if (surface !== null) for (let x = 50; x <= 190; x += step) world.lay(x, GROUND, 0, surface);
  const roads = new RoadNetwork(world, TERRAIN);
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
    };
    const world = new FakeWorld();
    for (let x = 50; x <= 190; x++) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world, TERRAIN);
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
    // A dashed road: pulling one column out of it opens a gap too wide to step over,
    // which is what a player digging up a road actually does to a finished one.
    const { world, roads, transport, registry, events } = build({ step: MAX_LINK });
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
    const { world, roads, transport, registry, events } = build({ step: MAX_LINK });
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

  it('walks a dashed road more slowly than one that was finished', () => {
    const finished = build();
    const dashed = build({ step: MAX_LINK });
    finished.transport.requestRoute(ID_A, ID_B);
    dashed.transport.requestRoute(ID_A, ID_B);
    run(finished.transport, 3);
    run(dashed.transport, 3);
    expect(dashed.transport.routes[0].connected).toBe(true);
    // Both work. Filling the gaps in is still worth doing.
    expect(dashed.transport.routes[0].quality).toBeLessThan(finished.transport.routes[0].quality);
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
    const roads = new RoadNetwork(world, TERRAIN);
    const registry = new VillageRegistry(1, SOURCE);
    const transport = new TransportNetwork(roads, registry);
    transport.loadJSON([{ from: ID_A, to: ID_B }]);
    expect(transport.routes).toHaveLength(1);
  });

  it('keeps trying to survey a route whose villages are not known yet', () => {
    const world = new FakeWorld();
    for (let x = 50; x <= 190; x += MAX_LINK) world.lay(x, GROUND, 0, Block.DIRT_PATH);
    const roads = new RoadNetwork(world, TERRAIN);
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
