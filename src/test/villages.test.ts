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
  townCraft,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';
import { itemDef } from '../game/items';

/** Chosen so the pair is the whole economy in miniature: a bakery that turns wheat into
 *  bread, and a glassworks that needs two raw materials rather than one — and each of them
 *  wants what the other bakes or blows. Both are starved until an industry feeds them,
 *  because every town in this game is. The first test below pins that, so a change to the
 *  tables cannot quietly turn these into two of the same thing and leave the rest of the
 *  file testing nothing. */
const SEED = 263;
const FARM: VillageSeed = { x: 0, z: 0, baseY: 62, variant: 'plains' };
const SHOP: VillageSeed = { x: 240, z: 0, baseY: 60, variant: 'snowy' };
const FARM_ID = villageId(0, 0);
const SHOP_ID = villageId(240, 0);

/** A town with its works stocked, which is what every test that is not about starvation
 *  has to do first: nothing in this world makes anything out of nothing. */
function feed(registry: VillageRegistry, id: string, count = MAX_STOCK): void {
  for (const good of registry.get(id)?.inputs ?? []) registry.deliver(id, good, count);
}

function source(...seeds: VillageSeed[]): VillageSource {
  return { villagesAround: () => seeds };
}

function registryOf(...seeds: VillageSeed[]): VillageRegistry {
  const registry = new VillageRegistry(SEED, source(...seeds));
  registry.ensureNear(0, 0);
  for (const seed of seeds) registry.discover(villageId(seed.x, seed.z));
  return registry;
}

describe('what a town converts', () => {
  it('gives the fixture a one-input works and a two-input one that want each other', () => {
    const farm = townCraft(SEED, FARM.x, FARM.z);
    const shop = townCraft(SEED, SHOP.x, SHOP.z);
    expect(farm).toEqual({ produces: 'bread', inputs: ['wheat'] });
    expect(shop).toEqual({ produces: 'glass', inputs: ['sand', 'coal'] });
    expect(villageNeeds(SEED, FARM.x, FARM.z, farm.produces, farm.inputs, 0)).toContain('glass');
    expect(villageNeeds(SEED, SHOP.x, SHOP.z, shop.produces, shop.inputs, 0)).toContain('bread');
  });

  it('gives the same town the same works and name for the same seed', () => {
    expect(townCraft(77, 320, -640)).toEqual(townCraft(77, 320, -640));
    expect(villageName(77, 320, -640, 'wheat')).toBe(villageName(77, 320, -640, 'wheat'));
  });

  it('gives different seeds different works somewhere', () => {
    const differs = Array.from({ length: 24 }, (_, i) =>
      townCraft(1, i * 320, 0).produces !== townCraft(2, i * 320, 0).produces,
    );
    expect(differs.some(Boolean)).toBe(true);
  });

  it('only deals in goods that exist as items', () => {
    for (let i = 0; i < 40; i++) {
      const craft = townCraft(5, i * 320, i * 320);
      expect(itemDef(craft.produces), craft.produces).toBeDefined();
      for (const input of craft.inputs) expect(itemDef(input), input).toBeDefined();
      for (const need of villageNeeds(5, i * 320, i * 320, craft.produces, craft.inputs, MAX_STAGE)) {
        expect(itemDef(need), need).toBeDefined();
      }
    }
  });

  it('names the village after what it makes, and its rank after how it has grown', () => {
    expect(villageName(77, 0, 0, 'wheat')).toContain('麦');
    expect(displayName({ name: '朝の麦', stage: 0 })).toBe(`朝の麦の${rankLabel(0)}`);
    expect(displayName({ name: '朝の麦', stage: MAX_STAGE })).toBe(`朝の麦の${rankLabel(MAX_STAGE)}`);
    expect(rankLabel(0)).not.toBe(rankLabel(MAX_STAGE));
  });

  it('asks for every raw material before anything else, and never for its own product', () => {
    const needs = villageNeeds(SEED, SHOP.x, SHOP.z, 'glass', ['sand', 'coal'], 0);
    expect(needs.slice(0, 2)).toEqual(['sand', 'coal']);
    expect(needs).not.toContain('glass');
  });

  it('wants more as it grows, and keeps wanting what it already wanted', () => {
    const small = villageNeeds(SEED, 0, 0, 'bread', ['wheat'], 0);
    const grown = villageNeeds(SEED, 0, 0, 'bread', ['wheat'], MAX_STAGE);
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

  it('only produces for towns the player has found', () => {
    const registry = new VillageRegistry(SEED, source(FARM, SHOP));
    registry.ensureNear(0, 0);
    registry.discover(FARM_ID);
    feed(registry, FARM_ID);
    feed(registry, SHOP_ID);
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
    // Two, deliberately: enough raw material for two loaves and not enough points to tip
    // the stage, so the rate cannot change underneath the count.
    feed(registry, FARM_ID, 2);
    registry.produce(PRODUCE_SECONDS * 3);
    expect(registry.takeStock(FARM_ID, 10)).toBe(2);
    expect(registry.get(FARM_ID)?.stock).toBe(0);
  });

  it('caps what a town piles up', () => {
    const registry = registryOf(FARM);
    feed(registry, FARM_ID);
    registry.produce(PRODUCE_SECONDS * (MAX_STOCK + 40));
    expect(registry.get(FARM_ID)?.stock).toBe(MAX_STOCK);
  });
});

describe('a town works', () => {
  it('makes nothing at all until somebody delivers the raw material', () => {
    const registry = registryOf(FARM);
    registry.produce(600);
    expect(registry.get(FARM_ID)?.stock).toBe(0);

    registry.deliver(FARM_ID, 'wheat', 4);
    expect(registry.get(FARM_ID)?.inputStock.get('wheat')).toBe(4);
    registry.produce(600);
    // One loaf per unit of wheat, and then it stops again.
    expect(registry.get(FARM_ID)?.stock).toBe(4);
    expect(registry.get(FARM_ID)?.inputStock.get('wheat')).toBe(0);
  });

  it('needs one of everything, not one of something', () => {
    const registry = registryOf(SHOP);
    // All the sand in the world and nothing to fire the furnace with.
    registry.deliver(SHOP_ID, 'sand', 20);
    registry.produce(600);
    expect(registry.get(SHOP_ID)?.stock).toBe(0);
    expect(registry.starvedOf(registry.get(SHOP_ID)!)).toBe('coal');

    registry.deliver(SHOP_ID, 'coal', 3);
    registry.produce(600);
    // Three of coal, so three of glass — and a unit of sand went with each one.
    expect(registry.get(SHOP_ID)?.stock).toBe(3);
    expect(registry.get(SHOP_ID)?.inputStock.get('sand')).toBe(17);
    expect(registry.get(SHOP_ID)?.inputStock.get('coal')).toBe(0);
  });

  it('does not bank starved time and then empty a delivery in one frame', () => {
    const registry = registryOf(FARM);
    registry.produce(600);
    // Two is deliberately under a stage's worth, so the rate cannot change underneath.
    registry.deliver(FARM_ID, 'wheat', 2);
    expect(registry.get(FARM_ID)?.stage).toBe(0);
    registry.produce(produceSeconds(0) * 1.5);
    expect(registry.get(FARM_ID)?.stock).toBe(1);
    expect(registry.get(FARM_ID)?.inputStock.get('wheat')).toBe(1);
  });

  it('ignores goods that are not its raw material', () => {
    const registry = registryOf(FARM);
    registry.deliver(FARM_ID, 'coal', 6);
    expect(registry.get(FARM_ID)?.inputStock.get('coal')).toBeUndefined();
    registry.produce(600);
    expect(registry.get(FARM_ID)?.stock).toBe(0);
  });
});

describe('deliveries', () => {
  it('is worth more when the village asked for it', () => {
    const registry = registryOf(FARM, SHOP);
    const wanted = registry.deliver(SHOP_ID, 'sand', 2);
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
    before.deliver(SHOP_ID, 'sand', 3);
    before.produce(60);

    // A fresh session knows nothing until the player walks near the village again.
    const after = new VillageRegistry(SEED, source(FARM, SHOP));
    after.loadJSON(before.toJSON());
    expect(after.byId.size).toBe(0);
    after.ensureNear(0, 0);
    expect(after.toJSON()).toEqual(before.toJSON());
    expect(after.get(SHOP_ID)?.inputStock.get('sand')).toBe(before.get(SHOP_ID)?.inputStock.get('sand'));
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

  it('opens an entry with no raw material recorded as a town that is merely empty', () => {
    const registry = new VillageRegistry(SEED, source(SHOP));
    registry.loadJSON([
      { id: SHOP_ID, produces: 'glass', stage: 1, points: 2, stock: 5, discovered: true, spawnedStage: 1 },
    ]);
    registry.ensureNear(0, 0);
    const village = registry.get(SHOP_ID)!;
    expect(village.stage).toBe(1);
    expect(village.inputStock.size).toBe(0);
    expect(village.needs).toContain('sand');
  });

  it('brings every raw material back, one by one', () => {
    const before = registryOf(SHOP);
    before.deliver(SHOP_ID, 'sand', 5);
    before.deliver(SHOP_ID, 'coal', 2);
    const after = new VillageRegistry(SEED, source(SHOP));
    after.loadJSON(before.toJSON());
    after.ensureNear(0, 0);
    expect(after.get(SHOP_ID)?.inputStock.get('sand')).toBe(5);
    expect(after.get(SHOP_ID)?.inputStock.get('coal')).toBe(2);
  });

  it('ignores a missing or malformed save', () => {
    const registry = new VillageRegistry(SEED, source(FARM));
    registry.loadJSON(undefined);
    registry.ensureNear(0, 0);
    expect(registry.get(FARM_ID)?.stage).toBe(0);
  });
});
