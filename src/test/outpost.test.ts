import { describe, expect, it } from 'vitest';
import {
  OUTPOST_DISTANCE,
  OUTPOST_FAR,
  OUTPOST_NEAR,
  outpostRecord,
  outpostSite,
} from '../game/outpost';
import { OUTPOST_FILL, OUTPOST_PAD, planOutpost } from '../world/generation/village';
import { Block } from '../world/blocks';
import {
  VillageRegistry,
  villageTrade,
  type VillageRecord,
  type VillageSource,
} from '../game/villages';
import { Questline } from '../game/questline';

const PARENT = { id: '0,0', x: 0, z: 0 };

/** Ground that is level everywhere, which is the easy case. */
const flat = () => 60;

function village(id: string, x: number, z: number): VillageRecord {
  const trade = villageTrade(1, x, z, 'plains');
  return {
    id, x, z, baseY: 60, variant: 'plains', name: `村${id}`,
    kind: trade.kind, produces: trade.produces, input: trade.input, inputStock: 0,
    needs: [], stage: 0, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0,
  };
}

/** A registry with no grid behind it: everything in these tests is put there by hand. */
function registry(): VillageRegistry {
  const source: VillageSource = { villagesAround: () => [] };
  return new VillageRegistry(1, source);
}

describe('siting a hamlet', () => {
  it('puts it in the band around the intended distance', () => {
    const site = outpostSite(1, PARENT, flat)!;
    expect(site).not.toBeNull();
    const distance = Math.hypot(site.x - PARENT.x, site.z - PARENT.z);
    expect(distance).toBeGreaterThanOrEqual(OUTPOST_NEAR - 1);
    expect(distance).toBeLessThanOrEqual(OUTPOST_FAR + 1);
  });

  it('prefers the intended distance when the ground allows it', () => {
    const site = outpostSite(1, PARENT, flat)!;
    const distance = Math.hypot(site.x - PARENT.x, site.z - PARENT.z);
    expect(Math.abs(distance - OUTPOST_DISTANCE)).toBeLessThanOrEqual(2);
  });

  it('is the same place every time, and a different one in another world', () => {
    const a = outpostSite(1, PARENT, flat)!;
    expect(outpostSite(1, PARENT, flat)).toEqual(a);
    expect(outpostSite(2, PARENT, flat)).not.toEqual(a);
  });

  it('stands on the highest ground it covers, so the pad is all fill and no cut', () => {
    // A slope of one block every four, which the hamlet can fill its way out of.
    const slope = (x: number): number => 60 + Math.floor(x / 4);
    const site = outpostSite(1, PARENT, slope)!;
    let high = 0;
    for (let dz = -OUTPOST_PAD; dz <= OUTPOST_PAD; dz++) {
      for (let dx = -OUTPOST_PAD; dx <= OUTPOST_PAD; dx++) {
        if (dx * dx + dz * dz > OUTPOST_PAD * OUTPOST_PAD) continue;
        high = Math.max(high, slope(site.x + dx));
      }
    }
    expect(site.baseY).toBe(high + 1);
  });

  it('refuses ground it cannot level, rather than building on a cliff', () => {
    // A wall of a hillside: a block of rise per block travelled, so no pad anywhere in the
    // band comes within one floor level of itself.
    const cliff = (x: number): number => 60 + x;
    expect(outpostSite(1, PARENT, cliff)).toBeNull();
  });

  it('refuses ground that has not been generated', () => {
    expect(outpostSite(1, PARENT, () => -1)).toBeNull();
  });
});

describe('a hamlet as a village', () => {
  it('makes something its parent does not', () => {
    const parent = village('0,0', 0, 0);
    const site = outpostSite(1, PARENT, flat)!;
    const record = outpostRecord(1, parent, site);
    expect(record.produces).not.toBe(parent.produces);
    expect(record.outpost).toBe(true);
    expect(record.parent).toBe(parent.id);
    // Nothing that needs feeding: it is the far end of the first road, not a workshop.
    expect(record.kind).toBe('farm');
    expect(record.input).toBeNull();
  });

  it('is the place the player is standing in, not its parent', () => {
    const store = registry();
    const parent = store.adopt(village('0,0', 0, 0));
    const site = outpostSite(1, PARENT, flat)!;
    const hamlet = store.adopt(outpostRecord(1, parent, site));

    expect(store.at(site.x, site.z)?.id).toBe(hamlet.id);
    expect(store.at(0, 0)?.id).toBe(parent.id);
    // Halfway between them both are in range of one another's radius; the nearer wins.
    const midX = Math.round(site.x / 2);
    const midZ = Math.round(site.z / 2);
    const here = store.at(midX, midZ);
    if (here) {
      const toParent = Math.hypot(midX - parent.x, midZ - parent.z);
      const toHamlet = Math.hypot(midX - hamlet.x, midZ - hamlet.z);
      expect(here.id).toBe(toParent <= toHamlet ? parent.id : hamlet.id);
    }
  });

  it('survives a save, which no other village needs to', () => {
    const store = registry();
    const parent = store.adopt(village('0,0', 0, 0));
    const site = outpostSite(1, PARENT, flat)!;
    const hamlet = store.adopt(outpostRecord(1, parent, site));
    hamlet.stage = 1;
    hamlet.points = 4;
    hamlet.discovered = true;

    // Nothing can re-derive a hamlet: the grid does not know about it, so a reload with an
    // empty registry has to rebuild it from the save alone.
    const reloaded = registry();
    reloaded.loadJSON(JSON.parse(JSON.stringify(store.toJSON())));

    const back = reloaded.get(hamlet.id)!;
    expect(back).toBeDefined();
    expect(back.x).toBe(hamlet.x);
    expect(back.z).toBe(hamlet.z);
    expect(back.baseY).toBe(hamlet.baseY);
    expect(back.name).toBe(hamlet.name);
    expect(back.produces).toBe(hamlet.produces);
    expect(back.stage).toBe(1);
    expect(back.points).toBe(4);
    expect(back.outpost).toBe(true);
    expect(back.parent).toBe(parent.id);
  });
});

describe('the tutorial', () => {
  it('sends the player to its own hamlet, not to a village hundreds of blocks away', () => {
    const store = registry();
    const parent = store.adopt(village('0,0', 0, 0));
    store.adopt(village('400,0', 400, 0));
    const site = outpostSite(1, PARENT, flat)!;
    const hamlet = store.adopt(outpostRecord(1, parent, site));

    const quest = new Questline();
    quest.onVillageDiscovered(parent);
    const offer = quest.interactionFor(parent, store);

    expect(offer?.kind).toBe('accept');
    expect(quest.targetId).toBe(hamlet.id);
    const walk = Math.hypot(hamlet.x - parent.x, hamlet.z - parent.z);
    expect(walk).toBeLessThan(OUTPOST_FAR + 1);
  });

  it('falls back to the nearest village when there is no hamlet', () => {
    const store = registry();
    const parent = store.adopt(village('0,0', 0, 0));
    store.adopt(village('400,0', 400, 0));
    const far = store.adopt(village('900,0', 900, 0));

    const quest = new Questline();
    quest.onVillageDiscovered(parent);
    quest.interactionFor(parent, store);

    expect(quest.targetId).toBe('400,0');
    expect(quest.targetId).not.toBe(far.id);
  });
});

describe('building a hamlet', () => {
  const site = { cellX: 0, cellZ: 0, x: 200, z: -300 };

  it('levels its own pad up to one floor level', () => {
    const plan = planOutpost(1, site, 64, 'plains');
    const surface = new Map<string, number>();
    for (const p of plan.placements) {
      if (p.y !== 63 || p.b === Block.AIR) continue;
      surface.set(`${p.x},${p.z}`, p.b);
    }
    // Every column of the pad gets a floor, and fill underneath it to stand on.
    expect(surface.get(`${site.x},${site.z}`)).toBeDefined();
    expect(surface.get(`${site.x + OUTPOST_PAD - 1},${site.z}`)).toBeDefined();
    expect(surface.get(`${site.x + OUTPOST_PAD + 4},${site.z}`)).toBeUndefined();
    const fill = plan.placements.filter(
      (p) => p.x === site.x && p.z === site.z && p.y < 63 && p.b === Block.DIRT,
    );
    expect(fill).toHaveLength(OUTPOST_FILL - 1);
  });

  it('builds two houses with somebody in each, a plot and a path between them', () => {
    const plan = planOutpost(1, site, 64, 'plains');
    expect(plan.villagers).toHaveLength(2);
    expect(plan.chests).toHaveLength(2);
    expect(plan.footprints).toHaveLength(3);
    const path = plan.placements.filter((p) => p.b === Block.DIRT_PATH && p.z === site.z);
    expect(path.length).toBeGreaterThanOrEqual(10);
  });

  it('is deterministic', () => {
    expect(planOutpost(1, site, 64, 'plains')).toEqual(planOutpost(1, site, 64, 'plains'));
    expect(planOutpost(2, site, 64, 'plains').villagers).not.toEqual(
      planOutpost(1, site, 64, 'plains').villagers,
    );
  });
});
