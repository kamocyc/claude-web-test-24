import { describe, expect, it } from 'vitest';
import {
  DISCOVER_RADIUS,
  MAX_STAGE,
  MAX_STOCK,
  NEEDED_POINTS,
  PRODUCE_SECONDS,
  SPARE_POINTS,
  STAGE_POINTS,
  VillageRegistry,
  displayName,
  produceSeconds,
  rankLabel,
  villageId,
  villageName,
  villageNeeds,
  villageTrade,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';
import { itemDef } from '../game/items';

/** Chosen so the pair is the whole economy in miniature: a farm that grows wheat, and a
 *  workshop that turns wheat into bread and can make nothing without it. The first test
 *  below pins that, so a change to the tables cannot quietly turn these into two farms
 *  and leave the rest of the file testing nothing. */
const SEED = 34;
const FARM: VillageSeed = { x: 0, z: 0, baseY: 62, variant: 'plains' };
const SHOP: VillageSeed = { x: 240, z: 0, baseY: 60, variant: 'snowy' };
const FARM_ID = villageId(0, 0);
const SHOP_ID = villageId(240, 0);

function source(...seeds: VillageSeed[]): VillageSource {
  return { villagesAround: () => seeds };
}

function registryOf(...seeds: VillageSeed[]): VillageRegistry {
  const registry = new VillageRegistry(SEED, source(...seeds));
  registry.ensureNear(0, 0);
  for (const seed of seeds) registry.discover(villageId(seed.x, seed.z));
  return registry;
}

describe('village trades', () => {
  it('gives the fixture a farm and a workshop that wants what the farm grows', () => {
    const farm = villageTrade(SEED, FARM.x, FARM.z, FARM.variant);
    const shop = villageTrade(SEED, SHOP.x, SHOP.z, SHOP.variant);
    expect(farm).toEqual({ kind: 'farm', produces: 'wheat', input: null });
    expect(shop).toEqual({ kind: 'workshop', produces: 'bread', input: 'wheat' });
  });

  it('gives the same village the same trade and name for the same seed', () => {
    expect(villageTrade(77, 320, -640, 'plains')).toEqual(villageTrade(77, 320, -640, 'plains'));
    expect(villageName(77, 320, -640, 'wheat')).toBe(villageName(77, 320, -640, 'wheat'));
  });

  it('gives different seeds different trades somewhere', () => {
    const differs = Array.from({ length: 24 }, (_, i) =>
      villageTrade(1, i * 320, 0, 'plains').produces !== villageTrade(2, i * 320, 0, 'plains').produces,
    );
    expect(differs.some(Boolean)).toBe(true);
  });

  it('only deals in goods that exist as items', () => {
    for (const variant of ['plains', 'desert', 'snowy'] as const) {
      for (let i = 0; i < 40; i++) {
        const trade = villageTrade(5, i * 320, i * 320, variant);
        expect(itemDef(trade.produces), trade.produces).toBeDefined();
        if (trade.input) expect(itemDef(trade.input), trade.input).toBeDefined();
        for (const need of villageNeeds(5, i * 320, i * 320, trade.produces, trade.input, MAX_STAGE)) {
          expect(itemDef(need), need).toBeDefined();
        }
      }
    }
  });

  it('names the village after what it makes, and its rank after how it has grown', () => {
    expect(villageName(77, 0, 0, 'wheat')).toContain('麦');
    expect(displayName({ name: '朝の麦', stage: 0 })).toBe(`朝の麦の${rankLabel(0)}`);
    expect(displayName({ name: '朝の麦', stage: MAX_STAGE })).toBe(`朝の麦の${rankLabel(MAX_STAGE)}`);
    expect(rankLabel(0)).not.toBe(rankLabel(MAX_STAGE));
  });

  it('asks for a workshop input before anything else, and never for its own product', () => {
    const needs = villageNeeds(SEED, SHOP.x, SHOP.z, 'bread', 'wheat', 0);
    expect(needs[0]).toBe('wheat');
    expect(needs).not.toContain('bread');
  });

  it('wants more as it grows, and keeps wanting what it already wanted', () => {
    const small = villageNeeds(SEED, 0, 0, 'wheat', null, 0);
    const grown = villageNeeds(SEED, 0, 0, 'wheat', null, MAX_STAGE);
    expect(grown.length).toBeGreaterThan(small.length);
    expect(grown.slice(0, small.length)).toEqual(small);
  });
});

describe('village registry', () => {
  it('registers villages without duplicating them', () => {
    const registry = new VillageRegistry(SEED, source(FARM, SHOP));
    registry.ensureNear(0, 0);
    const first = registry.get(FARM_ID);
    registry.ensureNear(0, 0);
    expect(registry.byId.size).toBe(2);
    expect(registry.get(FARM_ID)).toBe(first);
  });

  it('keeps progress when the same village is registered again', () => {
    const registry = registryOf(FARM);
    registry.addPoints(FARM_ID, 3);
    registry.ensureNear(0, 0);
    expect(registry.get(FARM_ID)?.points).toBe(3);
    expect(registry.get(FARM_ID)?.discovered).toBe(true);
  });

  it('finds the village a point stands in, and only inside the plateau', () => {
    const registry = registryOf(FARM);
    expect(registry.at(DISCOVER_RADIUS - 1, 0)?.id).toBe(FARM_ID);
    expect(registry.at(DISCOVER_RADIUS + 5, 0)).toBeUndefined();
  });

  it('reports a discovery exactly once', () => {
    const registry = new VillageRegistry(SEED, source(FARM));
    registry.ensureNear(0, 0);
    expect(registry.discover(FARM_ID)).toBe(true);
    expect(registry.discover(FARM_ID)).toBe(false);
    expect(registry.discovered()).toHaveLength(1);
  });

  it('only produces for villages the player has found', () => {
    const registry = new VillageRegistry(SEED, source(FARM, SHOP));
    registry.ensureNear(0, 0);
    registry.discover(FARM_ID);
    registry.produce(60);
    expect(registry.get(FARM_ID)?.stock).toBeGreaterThan(0);
    expect(registry.get(SHOP_ID)?.stock).toBe(0);
  });

  it('produces faster the more the village has grown', () => {
    expect(produceSeconds(0)).toBe(PRODUCE_SECONDS);
    expect(produceSeconds(MAX_STAGE)).toBeLessThan(produceSeconds(0));
  });

  it('never hands out more stock than it has', () => {
    const registry = registryOf(FARM);
    registry.produce(PRODUCE_SECONDS * 3);
    expect(registry.takeStock(FARM_ID, 10)).toBe(3);
    expect(registry.get(FARM_ID)?.stock).toBe(0);
  });

  it('caps what a village piles up', () => {
    const registry = registryOf(FARM);
    registry.produce(PRODUCE_SECONDS * (MAX_STOCK + 40));
    expect(registry.get(FARM_ID)?.stock).toBe(MAX_STOCK);
  });
});

describe('workshop villages', () => {
  it('makes nothing at all until somebody delivers the input', () => {
    const registry = registryOf(SHOP);
    registry.produce(600);
    expect(registry.get(SHOP_ID)?.stock).toBe(0);

    registry.deliver(SHOP_ID, 'wheat', 4);
    expect(registry.get(SHOP_ID)?.inputStock).toBe(4);
    registry.produce(600);
    // One unit of bread per unit of wheat, and then it stops again.
    expect(registry.get(SHOP_ID)?.stock).toBe(4);
    expect(registry.get(SHOP_ID)?.inputStock).toBe(0);
  });

  it('does not bank starved time and then empty a delivery in one frame', () => {
    const registry = registryOf(SHOP);
    registry.produce(600);
    // Two is deliberately under a stage's worth, so the rate cannot change underneath.
    registry.deliver(SHOP_ID, 'wheat', 2);
    expect(registry.get(SHOP_ID)?.stage).toBe(0);
    registry.produce(produceSeconds(0) * 1.5);
    expect(registry.get(SHOP_ID)?.stock).toBe(1);
    expect(registry.get(SHOP_ID)?.inputStock).toBe(1);
  });

  it('ignores goods that are not its input', () => {
    const registry = registryOf(SHOP);
    registry.deliver(SHOP_ID, 'coal', 6);
    expect(registry.get(SHOP_ID)?.inputStock).toBe(0);
    registry.produce(600);
    expect(registry.get(SHOP_ID)?.stock).toBe(0);
  });
});

describe('deliveries', () => {
  it('is worth more when the village asked for it', () => {
    const registry = registryOf(FARM, SHOP);
    const wanted = registry.deliver(SHOP_ID, 'wheat', 2);
    expect(wanted.needed).toBe(true);
    expect(wanted.points).toBe(2 * NEEDED_POINTS);

    const spare = registry.deliver(SHOP_ID, 'gravel', 2);
    expect(spare.needed).toBe(false);
    expect(spare.points).toBe(2 * SPARE_POINTS);
    expect(NEEDED_POINTS).toBeGreaterThan(SPARE_POINTS);
  });

  it('raises the stage exactly once at each threshold, and asks more the next time', () => {
    const registry = registryOf(FARM);
    for (let i = 1; i < STAGE_POINTS[0]; i++) expect(registry.addPoints(FARM_ID, 1)).toBeNull();
    expect(registry.addPoints(FARM_ID, 1)).toBe(1);
    expect(registry.addPoints(FARM_ID, 1)).toBeNull();
    expect(STAGE_POINTS[1]).toBeGreaterThan(STAGE_POINTS[0]);
  });

  it('reports how far the next rank is', () => {
    const registry = registryOf(FARM);
    registry.addPoints(FARM_ID, 4);
    const village = registry.get(FARM_ID)!;
    expect(registry.progressToNext(village)).toEqual({
      points: 4,
      needed: STAGE_POINTS[0],
      fraction: 4 / STAGE_POINTS[0],
    });
  });

  it('stops raising the stage at the cap', () => {
    const registry = registryOf(FARM);
    const total = STAGE_POINTS.reduce((sum, n) => sum + n, 0);
    for (let i = 0; i < total * 3; i++) registry.addPoints(FARM_ID, 1);
    expect(registry.get(FARM_ID)?.stage).toBe(MAX_STAGE);
    expect(registry.progressToNext(registry.get(FARM_ID)!).needed).toBe(0);
  });
});

describe('village saves', () => {
  it('restores saved progress when the village is re-derived from the seed', () => {
    const before = registryOf(FARM, SHOP);
    before.addPoints(FARM_ID, 5);
    before.deliver(SHOP_ID, 'wheat', 3);
    before.produce(60);

    // A fresh session knows nothing until the player walks near the village again.
    const after = new VillageRegistry(SEED, source(FARM, SHOP));
    after.loadJSON(before.toJSON());
    expect(after.byId.size).toBe(0);
    after.ensureNear(0, 0);
    expect(after.toJSON()).toEqual(before.toJSON());
    expect(after.get(SHOP_ID)?.inputStock).toBe(before.get(SHOP_ID)?.inputStock);
  });

  it('keeps the progress of villages the player has not been back to', () => {
    const before = registryOf(FARM, SHOP);
    before.addPoints(SHOP_ID, 4);

    // A session that only ever goes near the farm must not drop what the shop earned.
    const away = new VillageRegistry(SEED, source(FARM));
    away.loadJSON(before.toJSON());
    away.ensureNear(0, 0);
    expect(away.byId.has(SHOP_ID)).toBe(false);

    const saved = away.toJSON();
    expect(saved.find((v) => v.id === SHOP_ID)?.points).toBe(4);

    const back = new VillageRegistry(SEED, source(FARM, SHOP));
    back.loadJSON(saved);
    back.ensureNear(0, 0);
    expect(back.get(SHOP_ID)?.points).toBe(4);
    expect(back.get(SHOP_ID)?.discovered).toBe(true);
  });

  it('opens a save written before workshops existed', () => {
    const registry = new VillageRegistry(SEED, source(SHOP));
    registry.loadJSON([
      { id: SHOP_ID, produces: 'bread', stage: 1, points: 2, stock: 5, discovered: true, spawnedStage: 1 },
    ]);
    registry.ensureNear(0, 0);
    const village = registry.get(SHOP_ID)!;
    expect(village.stage).toBe(1);
    expect(village.inputStock).toBe(0);
    expect(village.needs).toContain('wheat');
  });

  it('ignores a missing or malformed save', () => {
    const registry = new VillageRegistry(SEED, source(FARM));
    registry.loadJSON(undefined);
    registry.ensureNear(0, 0);
    expect(registry.get(FARM_ID)?.stage).toBe(0);
  });
});
