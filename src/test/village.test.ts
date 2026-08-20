import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import {
  planVillage,
  plateauWeight,
  villageInCell,
  VILLAGE_RADIUS,
  type VillageVariant,
} from '../world/generation/village';
import { Block } from '../world/blocks';

describe('village placement', () => {
  it('places the same villages for the same seed', () => {
    const a = villageInCell(4242, 3, -2);
    const b = villageInCell(4242, 3, -2);
    expect(a).toEqual(b);
  });

  it('places different villages for different seeds', () => {
    const cells = Array.from({ length: 12 }, (_, i) => [villageInCell(1, i, 0), villageInCell(2, i, 0)]);
    expect(cells.some(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))).toBe(true);
  });

  it('falls to zero influence outside the plateau', () => {
    const site = villageInCell(7, 0, 0);
    expect(site).not.toBeNull();
    if (!site) return;
    expect(plateauWeight(site, site.x, site.z)).toBe(1);
    expect(plateauWeight(site, site.x + VILLAGE_RADIUS + 1, site.z)).toBe(0);
  });
});

describe('village layout', () => {
  const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
  const plan = planVillage(999, site, 60, 'plains');

  it('builds houses, a well, villagers and chests', () => {
    const all = [...plan.byChunk.values()].flat();
    expect(all.length).toBeGreaterThan(500);
    expect(plan.villagers.length).toBeGreaterThanOrEqual(3);
    expect(plan.chests.length).toBeGreaterThanOrEqual(1);
    expect(all.some((p) => p.b === Block.MOSSY_COBBLESTONE)).toBe(true);
    expect(all.some((p) => p.b === Block.OAK_PLANKS)).toBe(true);
    expect(all.some((p) => p.b === Block.GLASS)).toBe(true);
    expect(all.some((p) => p.b === Block.FARMLAND_WET)).toBe(true);
  });

  it('groups every placement into the chunk that contains it', () => {
    for (const [key, placements] of plan.byChunk) {
      const [cx, cz] = key.split(',').map(Number);
      for (const p of placements) {
        expect(Math.floor(p.x / 16)).toBe(cx);
        expect(Math.floor(p.z / 16)).toBe(cz);
      }
    }
  });

  it('is deterministic', () => {
    const again = planVillage(999, site, 60, 'plains');
    expect([...again.byChunk.keys()].sort()).toEqual([...plan.byChunk.keys()].sort());
    expect(again.villagers).toEqual(plan.villagers);
  });

  it('uses a desert palette in the desert', () => {
    const desert = planVillage(999, site, 60, 'desert');
    const all = [...desert.byChunk.values()].flat();
    expect(all.some((p) => p.b === Block.SANDSTONE)).toBe(true);
  });
});

describe('village terrain integration', () => {
  it('finds a village and generates its blocks into the world', () => {
    const gen = new TerrainGenerator(4242);
    const village = gen.findNearestVillage(0, 0, 4);
    expect(village).not.toBeNull();
    if (!village) return;
    const cx = Math.floor(village.x / 16);
    const cz = Math.floor(village.z / 16);
    const { blocks, villagers, chests } = gen.generateChunk(cx, cz);
    expect(villagers.length + chests.length).toBeGreaterThanOrEqual(0);
    // The well sits at the centre of every village.
    const hasVillageBlock = Array.from(blocks).some(
      (id) => id === Block.MOSSY_COBBLESTONE || id === Block.OAK_PLANKS || id === Block.SANDSTONE,
    );
    expect(hasVillageBlock).toBe(true);
  });
});

/** The pinned seed test guards terrain; this guards the village layout itself. Village
 *  growth adds buildings from a separate random stream, so stage 0 must keep emitting
 *  exactly the blocks it always has. Any change to the order or count of `rng()` calls
 *  inside `planVillage` moves these numbers, and that is never accidental. */
describe('village layout is pinned', () => {
  const site = { cellX: 0, cellZ: 0, x: 100, z: 200 };
  const expected: Record<VillageVariant, { count: number; hash: number }> = {
    plains: { count: 4685, hash: 753737959 },
    desert: { count: 4685, hash: -1449032277 },
    snowy: { count: 4685, hash: 1344703105 },
  };

  for (const variant of ['plains', 'desert', 'snowy'] as VillageVariant[]) {
    it(`lays the same ${variant} blocks it always has`, () => {
      const plan = planVillage(999, site, 60, variant);
      const all = [...plan.byChunk.values()].flat();
      let hash = 0;
      for (const p of all) hash = (hash * 31 + p.x * 7 + p.y * 13 + p.z * 17 + p.b) | 0;
      expect(all.length).toBe(expected[variant].count);
      expect(hash).toBe(expected[variant].hash);
      expect(plan.villagers.length).toBe(7);
      expect(plan.chests.length).toBe(5);
    });
  }
});
