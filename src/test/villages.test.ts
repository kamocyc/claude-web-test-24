import { describe, expect, it } from 'vitest';
import {
  DISCOVER_RADIUS,
  MAX_STAGE,
  STAGE_POINTS,
  VillageRegistry,
  villageId,
  villageName,
  villageProduct,
  type VillageSeed,
  type VillageSource,
} from '../game/villages';

function source(...seeds: VillageSeed[]): VillageSource {
  return { villagesAround: () => seeds };
}

const A: VillageSeed = { x: 0, z: 0, baseY: 62, variant: 'plains' };
const B: VillageSeed = { x: 400, z: 0, baseY: 60, variant: 'snowy' };

describe('village products', () => {
  it('gives the same village the same product and name for the same seed', () => {
    expect(villageProduct(77, 320, -640, 'plains')).toBe(villageProduct(77, 320, -640, 'plains'));
    expect(villageName(77, 320, -640, 'wheat')).toBe(villageName(77, 320, -640, 'wheat'));
  });

  it('gives different seeds different products somewhere', () => {
    const differs = Array.from({ length: 24 }, (_, i) =>
      villageProduct(1, i * 320, 0, 'plains') !== villageProduct(2, i * 320, 0, 'plains'),
    );
    expect(differs.some(Boolean)).toBe(true);
  });

  it('only makes goods that exist as items', () => {
    for (const variant of ['plains', 'desert', 'snowy'] as const) {
      for (let i = 0; i < 40; i++) {
        const good = villageProduct(5, i * 320, i * 320, variant);
        expect(good).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it('names the village after what it makes', () => {
    expect(villageName(77, 0, 0, 'wheat')).toContain('麦');
  });
});

describe('village registry', () => {
  it('registers villages without duplicating them', () => {
    const registry = new VillageRegistry(1, source(A, B));
    registry.ensureNear(0, 0);
    const first = registry.get(villageId(0, 0));
    registry.ensureNear(0, 0);
    expect(registry.byId.size).toBe(2);
    expect(registry.get(villageId(0, 0))).toBe(first);
  });

  it('keeps progress when the same village is registered again', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    registry.discover(villageId(0, 0));
    registry.addPoints(villageId(0, 0), 3);
    registry.ensureNear(0, 0);
    expect(registry.get(villageId(0, 0))?.points).toBe(3);
    expect(registry.get(villageId(0, 0))?.discovered).toBe(true);
  });

  it('finds the village a point stands in, and only inside the plateau', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    expect(registry.at(DISCOVER_RADIUS - 1, 0)?.id).toBe(villageId(0, 0));
    expect(registry.at(DISCOVER_RADIUS + 5, 0)).toBeUndefined();
  });

  it('reports a discovery exactly once', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    expect(registry.discover(villageId(0, 0))).toBe(true);
    expect(registry.discover(villageId(0, 0))).toBe(false);
    expect(registry.discovered()).toHaveLength(1);
  });

  it('only produces for villages the player has found', () => {
    const registry = new VillageRegistry(1, source(A, B));
    registry.ensureNear(0, 0);
    registry.discover(villageId(0, 0));
    registry.produce(60);
    expect(registry.get(villageId(0, 0))?.stock).toBeGreaterThan(0);
    expect(registry.get(villageId(400, 0))?.stock).toBe(0);
  });

  it('never hands out more stock than it has', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    registry.discover(villageId(0, 0));
    registry.produce(18);
    expect(registry.takeStock(villageId(0, 0), 10)).toBe(3);
    expect(registry.get(villageId(0, 0))?.stock).toBe(0);
  });

  it('raises the stage exactly once at the threshold', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    const id = villageId(0, 0);
    for (let i = 1; i < STAGE_POINTS; i++) expect(registry.addPoints(id, 1)).toBeNull();
    expect(registry.addPoints(id, 1)).toBe(1);
    expect(registry.addPoints(id, 1)).toBeNull();
  });

  it('stops raising the stage at the cap', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.ensureNear(0, 0);
    const id = villageId(0, 0);
    for (let i = 0; i < STAGE_POINTS * (MAX_STAGE + 3); i++) registry.addPoints(id, 1);
    expect(registry.get(id)?.stage).toBe(MAX_STAGE);
  });

  it('restores saved progress when the village is re-derived from the seed', () => {
    const before = new VillageRegistry(1, source(A));
    before.ensureNear(0, 0);
    before.discover(villageId(0, 0));
    before.addPoints(villageId(0, 0), 5);
    before.produce(60);

    // A fresh session knows nothing until the player walks near the village again.
    const after = new VillageRegistry(1, source(A));
    after.loadJSON(before.toJSON());
    expect(after.byId.size).toBe(0);
    after.ensureNear(0, 0);
    expect(after.toJSON()).toEqual(before.toJSON());
  });

  it('keeps the progress of villages the player has not been back to', () => {
    const before = new VillageRegistry(1, source(A, B));
    before.ensureNear(0, 0);
    before.discover(villageId(0, 0));
    before.discover(villageId(400, 0));
    before.addPoints(villageId(400, 0), 4);

    // A session that only ever goes near A must not drop what B earned.
    const away = new VillageRegistry(1, source(A));
    away.loadJSON(before.toJSON());
    away.ensureNear(0, 0);
    expect(away.byId.has(villageId(400, 0))).toBe(false);

    const saved = away.toJSON();
    expect(saved.find((v) => v.id === villageId(400, 0))?.points).toBe(4);

    const back = new VillageRegistry(1, source(A, B));
    back.loadJSON(saved);
    back.ensureNear(0, 0);
    expect(back.get(villageId(400, 0))?.points).toBe(4);
    expect(back.get(villageId(400, 0))?.discovered).toBe(true);
  });

  it('ignores a missing or malformed save', () => {
    const registry = new VillageRegistry(1, source(A));
    registry.loadJSON(undefined);
    registry.ensureNear(0, 0);
    expect(registry.get(villageId(0, 0))?.stage).toBe(0);
  });
});
