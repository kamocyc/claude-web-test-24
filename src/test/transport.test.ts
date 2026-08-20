import { describe, expect, it } from 'vitest';
import {
  PORTER_SPEED,
  SHIPMENT,
  TransportNetwork,
  type TransportEvents,
} from '../game/transport';
import { RoadNetwork, MAX_LINK, type RoadTerrain, type RoadWorld } from '../game/roads';
import { STAGE_POINTS, VillageRegistry, villageId, type VillageSeed, type VillageSource } from '../game/villages';
import { Block, type BlockId } from '../world/blocks';
import { blockIndex, chunkKey, toChunkCoord, toLocalCoord } from '../world/chunk';

const GROUND = 60;
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

function build(paved = true) {
  const world = new FakeWorld();
  if (paved) for (let x = 50; x <= 190; x += MAX_LINK) world.lay(x, GROUND, 0, Block.DIRT_PATH);
  const roads = new RoadNetwork(world, TERRAIN);
  roads.seedFromEdits();
  const registry = new VillageRegistry(1, SOURCE);
  registry.ensureNear(0, 0);
  registry.discover(ID_A);
  registry.discover(ID_B);
  const events: {
    arrivals: number[];
    stages: number[];
    connected: number;
    disconnected: number;
  } = { arrivals: [], stages: [], connected: 0, disconnected: 0 };
  const handlers: TransportEvents = {
    onArrival: (_route, _good, count) => events.arrivals.push(count),
    onStageUp: (_id, stage) => events.stages.push(stage),
    onConnected: () => events.connected++,
    onDisconnected: () => events.disconnected++,
  };
  const transport = new TransportNetwork(roads, registry, handlers);
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
    const { transport } = build(false);
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
    registry.produce(600);

    // Not there yet at half the journey.
    run(transport, route.length / PORTER_SPEED / 2);
    expect(events.arrivals).toHaveLength(0);

    run(transport, route.length / PORTER_SPEED);
    expect(events.arrivals[0]).toBe(SHIPMENT);
    expect(registry.get(ID_B)?.points).toBeGreaterThan(0);
  });

  it('raises the destination one stage once enough has arrived', () => {
    const { transport, registry, events } = build();
    transport.requestRoute(ID_A, ID_B);
    run(transport, 3);
    registry.produce(6000);
    run(transport, 2000);
    expect(events.stages).toEqual([1]);
    expect(registry.get(ID_B)?.stage).toBe(1);
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

  it('sends the cargo home when the road is dug up mid-journey', () => {
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
    registry.produce(60_000);
    run(transport, 20_000);
    expect(registry.get(ID_B)?.stage).toBe(1);
    expect(registry.get(ID_B)?.points).toBeGreaterThanOrEqual(STAGE_POINTS);
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

  it('ignores a missing or malformed save', () => {
    const { transport } = build();
    transport.loadJSON(undefined);
    expect(transport.routes).toHaveLength(0);
  });
});
