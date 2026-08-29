import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_RADIUS,
  INDUSTRY_GOODS,
  INDUSTRY_SECONDS,
  INDUSTRY_SPACING,
  INDUSTRY_TYPES,
  IndustryRegistry,
  MAX_INDUSTRY_STOCK,
  MAX_RICHNESS,
  richnessOf,
  surveyDeposits,
  type BlockReader,
  type Deposit,
} from '../game/industry';
import { CRAFTS } from '../game/villages';
import { itemDef } from '../game/items';
import { Block, type BlockId } from '../world/blocks';

const GROUND = 64;

/** A world made of one block, with a blob of something else buried in it.
 *
 *  Deliberately not a real chunk: what the survey does is count what is in a cylinder, and
 *  a literal says what is in one far more plainly than a generated world could. */
function world(seam: { block: BlockId; radius: number; top: number; bottom: number }): BlockReader {
  return {
    getBlock(x: number, y: number, z: number): BlockId {
      const inside = Math.hypot(x, z) <= seam.radius && y <= seam.top && y >= seam.bottom;
      if (inside) return seam.block;
      return y <= GROUND ? Block.STONE : Block.AIR;
    },
  };
}

function coal(radius: number, thickness = 3): BlockReader {
  return world({ block: Block.COAL_ORE, radius, top: GROUND, bottom: GROUND - thickness + 1 });
}

function found(reader: BlockReader): Deposit[] {
  return surveyDeposits(reader, 0, GROUND, 0);
}

describe('what the ground supports', () => {
  it('finds a seam that is big enough and packed enough', () => {
    const deposits = found(coal(6));
    expect(deposits.map((d) => d.kind)).toEqual(['colliery']);
    expect(deposits[0].good).toBe('coal');
    expect(deposits[0].count).toBeGreaterThan(0);
  });

  it('refuses a scatter, however wide it is spread', () => {
    // One course of coal over the whole disc: plenty of blocks by area, one deep. The
    // count clears easily and the seam is still not a seam.
    const thin = world({ block: Block.COAL_ORE, radius: 2, top: GROUND, bottom: GROUND });
    expect(found(thin)).toEqual([]);
  });

  it('counts the buried half and the part that breaks the surface alike', () => {
    // The same quantity of rock, once under the ground and once standing above it. An
    // outcrop is the visible part of a seam and nothing else, so the two have to weigh the
    // same — otherwise finding one by looking would be worth less than digging for it.
    const buried = world({ block: Block.COAL_ORE, radius: 6, top: GROUND - 4, bottom: GROUND - 8 });
    const exposed = world({ block: Block.COAL_ORE, radius: 6, top: GROUND + 4, bottom: GROUND });
    expect(found(buried)[0].count).toBe(found(exposed)[0].count);
  });

  it('looks no further than its own radius', () => {
    // A seam that fills the survey's disc, and the same seam forty blocks wider. The
    // survey counts the same rock either way, because it only ever looks at its own disc —
    // which is what stops one coalfield qualifying half a valley.
    expect(found(coal(DEPOSIT_RADIUS))[0].count).toBe(found(coal(DEPOSIT_RADIUS + 40))[0].count);
  });

  it('finds nothing in plain stone', () => {
    expect(found(world({ block: Block.STONE, radius: 0, top: 0, bottom: 0 }))).toEqual([]);
  });

  it('pays richer ground more, up to a ceiling', () => {
    expect(found(coal(DEPOSIT_RADIUS))[0].count).toBeGreaterThan(found(coal(6))[0].count);
    // Exactly enough is exactly the baseline, so a deposit that scrapes in is not slow —
    // it is ordinary. Above that it climbs, and stops climbing.
    expect(richnessOf(10, 10)).toBe(1);
    expect(richnessOf(40, 10)).toBeGreaterThan(richnessOf(20, 10));
    expect(richnessOf(1_000_000, 10)).toBe(MAX_RICHNESS);
    // Square rooted: twice the ore is not twice the output, or the best seam on the map
    // would make every other one pointless.
    expect(richnessOf(40, 10)).toBeLessThan(4);
  });
});

describe('the goods an industry can put on a line', () => {
  it('are all real items, and are exactly what the crafts take', () => {
    for (const good of INDUSTRY_GOODS) expect(itemDef(good), good).toBeDefined();
    const inputs = new Set(CRAFTS.flatMap((craft) => craft.inputs));
    // Neither list may grow a member the other has not heard of: an industry nobody's
    // works can use is a mine with nowhere to send its ore, and a works waiting on
    // something no industry digs is a town that can never start.
    expect([...inputs].sort()).toEqual([...INDUSTRY_GOODS].sort());
  });

  it('gives every kind a distinct good', () => {
    expect(new Set(INDUSTRY_TYPES.map((t) => t.good)).size).toBe(INDUSTRY_TYPES.length);
  });
});

describe('siting one', () => {
  const deposit: Deposit = {
    kind: 'colliery', label: '炭鉱', good: 'coal', count: 100, density: 0.5, richness: 1,
  };

  it('refuses a place the survey found nothing at', () => {
    const registry = new IndustryRegistry();
    const result = registry.place({ x: 0, y: GROUND, z: 0 }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('nothing-here');
  });

  it('refuses a second one on the same deposit, and allows one further off', () => {
    const registry = new IndustryRegistry();
    expect(registry.place({ x: 0, y: GROUND, z: 0 }, deposit).ok).toBe(true);
    const close = registry.place({ x: INDUSTRY_SPACING - 1, y: GROUND, z: 0 }, deposit);
    expect(close.ok).toBe(false);
    if (!close.ok) {
      expect(close.why).toBe('too-close');
      // Named, because "too close to what?" is the only question the refusal raises.
      expect(close.near?.name).toBeDefined();
    }
    expect(registry.place({ x: INDUSTRY_SPACING, y: GROUND, z: 0 }, deposit).ok).toBe(true);
  });

  it('digs whether or not anybody comes, and stops when it is full', () => {
    const registry = new IndustryRegistry();
    const placed = registry.place({ x: 0, y: GROUND, z: 0 }, deposit);
    if (!placed.ok) throw new Error('the fixture could not site its industry');
    registry.produce(INDUSTRY_SECONDS * 3);
    expect(registry.get(placed.industry.id)?.stock).toBe(3);
    registry.produce(INDUSTRY_SECONDS * (MAX_INDUSTRY_STOCK + 20));
    // Full is a state worth being in: it is what a line nobody has built looks like.
    expect(registry.get(placed.industry.id)?.stock).toBe(MAX_INDUSTRY_STOCK);
  });

  it('never runs out', () => {
    const registry = new IndustryRegistry();
    const placed = registry.place({ x: 0, y: GROUND, z: 0 }, deposit);
    if (!placed.ok) throw new Error('the fixture could not site its industry');
    let shipped = 0;
    for (let trip = 0; trip < 200; trip++) {
      registry.produce(INDUSTRY_SECONDS * 4);
      shipped += registry.take(placed.industry.id, 4);
    }
    expect(shipped).toBe(800);
    expect(registry.get(placed.industry.id)?.shipped).toBe(800);
  });

  it('hands a load back when the trip never happened', () => {
    const registry = new IndustryRegistry();
    const placed = registry.place({ x: 0, y: GROUND, z: 0 }, deposit);
    if (!placed.ok) throw new Error('the fixture could not site its industry');
    registry.produce(INDUSTRY_SECONDS * 5);
    expect(registry.take(placed.industry.id, 3)).toBe(3);
    registry.restore(placed.industry.id, 3);
    expect(registry.get(placed.industry.id)?.stock).toBe(5);
    // And the running total is put back too, or a road dug up would flatter the ledger.
    expect(registry.get(placed.industry.id)?.shipped).toBe(0);
  });

  it('finds the one nearest a point, and nothing when they are all too far', () => {
    const registry = new IndustryRegistry();
    const placed = registry.place({ x: 0, y: GROUND, z: 0 }, deposit);
    if (!placed.ok) throw new Error('the fixture could not site its industry');
    expect(registry.near(10, 0, 24)?.id).toBe(placed.industry.id);
    expect(registry.near(400, 0, 24)).toBeNull();
  });
});

describe('an industry that has been saved and opened again', () => {
  const deposit: Deposit = {
    kind: 'quarry', label: '砂採取場', good: 'sand', count: 300, density: 0.8, richness: 1.4,
  };

  it('comes back with everything that cannot be worked out again', () => {
    const registry = new IndustryRegistry();
    const placed = registry.place({ x: 40, y: GROUND, z: -20 }, deposit);
    if (!placed.ok) throw new Error('the fixture could not site its industry');
    registry.produce(INDUSTRY_SECONDS * 4);
    registry.take(placed.industry.id, 2);

    const back = new IndustryRegistry();
    back.loadJSON(registry.toJSON());
    const industry = back.get(placed.industry.id);
    expect(industry?.x).toBe(40);
    expect(industry?.z).toBe(-20);
    expect(industry?.good).toBe('sand');
    // The richness is the ground it was built on, and the ground is not re-surveyed: a
    // player who levelled the hill afterwards keeps the mine they paid for.
    expect(industry?.richness).toBeCloseTo(1.4, 5);
    expect(industry?.stock).toBe(registry.get(placed.industry.id)?.stock);
    expect(industry?.shipped).toBe(2);
  });

  it('carries on numbering where the save left off', () => {
    const registry = new IndustryRegistry();
    registry.place({ x: 0, y: GROUND, z: 0 }, deposit);
    registry.place({ x: 200, y: GROUND, z: 0 }, deposit);
    const back = new IndustryRegistry();
    back.loadJSON(registry.toJSON());
    expect(back.place({ x: 400, y: GROUND, z: 0 }, deposit).ok).toBe(true);
    expect(back.byId.size).toBe(3);
  });

  it('drops an entry of a kind this build has never heard of', () => {
    const back = new IndustryRegistry();
    back.loadJSON([{ id: 'i1', kind: 'unobtainium_mine', x: 0, y: GROUND, z: 0 }]);
    expect(back.byId.size).toBe(0);
  });

  it('opens an empty save as an empty registry', () => {
    const back = new IndustryRegistry();
    back.loadJSON(undefined);
    expect(back.all()).toEqual([]);
  });
});
