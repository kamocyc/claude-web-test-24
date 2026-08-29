import { describe, expect, it } from 'vitest';
import {
  CELL_STOCK,
  COMMUTE_SECONDS,
  HOME_PEOPLE,
  HOUSEHOLD_GOODS,
  HOUSEHOLD_SECONDS,
  JOURNEY_SECONDS,
  MAX_COMMUTERS,
  MAX_WAITING,
  SHOP_GOODS,
  SHOP_JOBS,
  TRADE_SECONDS,
  TownEconomy,
  goodsFor,
  peopleFor,
  type TownBuilding,
} from '../game/townEconomy';
import type { VillageRecord } from '../game/villages';
import type { BuildingUse } from '../world/generation/village';

const SEED = 21;

function village(over: Partial<VillageRecord> = {}): VillageRecord {
  return {
    id: '0,0', x: 0, z: 0, baseY: 60, variant: 'plains', name: '麦',
    kind: 'farm', produces: 'wheat', input: null, inputStock: 0,
    needs: [], stage: 0, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0,
    ...over,
  };
}

/** A town of the given uses, laid out from the centre outwards. */
function town(...uses: BuildingUse[]): TownBuilding[] {
  return uses.map((use, i) => ({ id: `${i * 10},0`, use, fromCentre: i * 10 }));
}

function economy(buildings: TownBuilding[]): TownEconomy {
  return new TownEconomy(SEED, { buildingsOf: () => buildings });
}

/** Runs the clock in steps a frame might actually be, so nothing passes only because it
 *  was handed one enormous `dt`. */
function run(town: TownEconomy, villages: VillageRecord[], seconds: number, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) town.update(step, villages);
}

/** Fills every building in a town. A town nobody has ever supplied runs at
 *  `HUNGRY_FACTOR` on purpose, so anything watching people move starts by feeding it. */
function supply(economy_: TownEconomy, record: VillageRecord): void {
  economy_.update(0.05, [record]);
  for (const cell of economy_.get(record.id)!.cells.values()) {
    for (const good of cell.wants.keys()) economy_.deliver(record.id, good, CELL_STOCK);
  }
}

describe('a town as its buildings', () => {
  it('gives every building people, and more of them as the town grows', () => {
    expect(peopleFor('residential', 0)).toBe(HOME_PEOPLE);
    expect(peopleFor('commercial', 0)).toBe(SHOP_JOBS);
    expect(peopleFor('civic', 4)).toBe(0);
    // A 都市 is a busier version of the same place, not a different one.
    expect(peopleFor('residential', 4)).toBeGreaterThan(peopleFor('residential', 0));
  });

  it('lays a cell out for each building, and counts the town', () => {
    const economy_ = economy(town('residential', 'commercial', 'residential'));
    const record = village();
    economy_.update(1, [record]);
    const t = economy_.get(record.id);
    expect(t?.cells.size).toBe(3);
    expect(economy_.populationOf(record.id)).toBe(HOME_PEOPLE * 2 + SHOP_JOBS);
  });

  it('runs no town the player has not found', () => {
    const economy_ = economy(town('residential'));
    economy_.update(10, [village({ discovered: false })]);
    expect(economy_.towns.size).toBe(0);
  });

  it('keeps a pantry when the building list is rebuilt', () => {
    // `game.ts` rebuilds its building list every time a road block moves. A town that
    // re-derived its cells from that would empty itself whenever somebody swung a shovel.
    const buildings = town('residential');
    const economy_ = economy(buildings);
    const record = village();
    economy_.update(1, [record]);
    const good = [...economy_.get(record.id)!.cells.values()][0].wants.keys().next().value!;
    economy_.deliver(record.id, good, 4);
    economy_.update(1, [record]);
    expect([...economy_.get(record.id)!.cells.values()][0].wants.get(good)).toBe(4);
  });

  it('drops a building that is no longer there, and the commutes to it', () => {
    let buildings = town('residential', 'commercial');
    const economy_ = new TownEconomy(SEED, { buildingsOf: () => buildings });
    const record = village();
    supply(economy_, record);
    run(economy_, [record], COMMUTE_SECONDS * 2);
    expect(economy_.get(record.id)!.commutes.length).toBeGreaterThan(0);
    const shop = buildings[1].id;
    buildings = [buildings[0]];
    // The stage has not moved, so the relayout has to notice the count changed.
    economy_.update(0.05, [record]);
    const t = economy_.get(record.id)!;
    expect(t.cells.has(shop)).toBe(false);
    expect(t.commutes.some((c) => c.to === shop || c.from === shop)).toBe(false);
  });
});

describe('what a building asks for', () => {
  it('asks a works for the raw material its village converts', () => {
    const record = village({ kind: 'workshop', produces: 'bread', input: 'wheat' });
    expect(goodsFor(SEED, { id: '0,0', use: 'industrial' }, record)).toEqual(['wheat']);
    // A village that converts nothing has nothing to feed a works with.
    expect(goodsFor(SEED, { id: '0,0', use: 'industrial' }, village())).toEqual([]);
  });

  it('gives homes household goods and shops shop goods', () => {
    const record = village();
    const home = goodsFor(SEED, { id: '10,20', use: 'residential' }, record);
    expect(home.length).toBeGreaterThan(0);
    for (const good of home) expect(HOUSEHOLD_GOODS).toContain(good);
    const shop = goodsFor(SEED, { id: '10,20', use: 'commercial' }, record);
    for (const good of shop) expect(SHOP_GOODS).toContain(good);
  });

  it('never asks a town for what it already makes', () => {
    const record = village({ produces: 'bread' });
    expect(goodsFor(SEED, { id: '4,4', use: 'residential' }, record)).not.toContain('bread');
  });

  it('gives the same building the same answer every time', () => {
    const record = village();
    const once = goodsFor(SEED, { id: '31,-7', use: 'residential' }, record);
    const twice = goodsFor(SEED, { id: '31,-7', use: 'residential' }, record);
    expect(twice).toEqual(once);
  });

  it('asks nothing of a well', () => {
    expect(goodsFor(SEED, { id: '0,0', use: 'civic' }, village())).toEqual([]);
  });
});

describe('deliveries into a town', () => {
  it('fills the buildings nearest the centre first', () => {
    const buildings = town('residential', 'residential');
    const economy_ = economy(buildings);
    const record = village();
    economy_.update(1, [record]);
    const cells = [...economy_.get(record.id)!.cells.values()];
    const good = [...cells[0].wants.keys()][0];
    // Only fill the near one: the far one gets what is left, and there is nothing left.
    expect(economy_.deliver(record.id, good, CELL_STOCK)).toBe(CELL_STOCK);
    expect(cells[0].wants.get(good)).toBe(CELL_STOCK);
  });

  it('reports how much of a delivery nobody here wanted', () => {
    const economy_ = economy(town('residential'));
    const record = village();
    economy_.update(1, [record]);
    // Emeralds are not on anybody's shopping list.
    expect(economy_.deliver(record.id, 'emerald', 5)).toBe(0);
  });

  it('takes nothing for a town that does not exist', () => {
    expect(economy(town('residential')).deliver('nowhere', 'bread', 5)).toBe(0);
  });
});

describe('people moving', () => {
  it('walks somebody from a home to a job and back again', () => {
    const buildings = town('residential', 'commercial');
    const economy_ = economy(buildings);
    const record = village();
    supply(economy_, record);
    run(economy_, [record], COMMUTE_SECONDS + 1);
    const t = economy_.get(record.id)!;
    const commute = t.commutes[0];
    expect(commute.from).toBe(buildings[0].id);
    expect(commute.to).toBe(buildings[1].id);
    // Out to work first, and the job it walked to is filled while it is there.
    run(economy_, [record], COMMUTE_SECONDS);
    expect(t.cells.get(buildings[1].id)!.staff).toBeGreaterThan(0);
    expect(t.commutes.some((c) => c.dir === -1)).toBe(true);
  });

  it('sends nobody out of a town with nowhere to work', () => {
    const economy_ = economy(town('residential', 'residential'));
    const record = village();
    run(economy_, [record], COMMUTE_SECONDS * 5);
    expect(economy_.get(record.id)!.commutes).toHaveLength(0);
  });

  it('does not put the whole town on one street', () => {
    const economy_ = economy(town(
      'residential', 'residential', 'residential', 'commercial', 'industrial',
    ));
    const record = village({ stage: 4 });
    supply(economy_, record);
    run(economy_, [record], COMMUTE_SECONDS * 40);
    expect(economy_.get(record.id)!.commutes.length).toBeLessThanOrEqual(MAX_COMMUTERS);
  });

  it('keeps walking whether or not anybody is watching', () => {
    // The clock is the truth: no mob is ever spawned here, and the commute still finishes.
    const economy_ = economy(town('residential', 'commercial'));
    const record = village();
    supply(economy_, record);
    run(economy_, [record], COMMUTE_SECONDS * 3);
    const t = economy_.get(record.id)!;
    expect(t.commutes.every((c) => c.mobId === null)).toBe(true);
    expect(t.cells.get('10,0')!.staff).toBeGreaterThan(0);
  });
});

describe('a shop that has customers', () => {
  it('uses up its stock only once somebody has walked in', () => {
    const economy_ = economy(town('residential', 'commercial'));
    const record = village();
    supply(economy_, record);
    const shop = economy_.get(record.id)!.cells.get('10,0')!;
    const good = [...shop.wants.keys()][0];
    // Nobody has arrived yet, so nothing is sold however long it stands there.
    expect(shop.staff).toBe(0);
    run(economy_, [record], COMMUTE_SECONDS - 1);
    expect(shop.wants.get(good)).toBe(CELL_STOCK);
    // Once the walk finishes, the shop starts selling.
    run(economy_, [record], COMMUTE_SECONDS + TRADE_SECONDS + 1);
    expect(shop.staff).toBeGreaterThan(0);
    expect(shop.wants.get(good)!).toBeLessThan(CELL_STOCK);
  });

  it('lets a home eat with nobody arriving at all', () => {
    // A home is lived in rather than staffed, so it never waits for anybody to walk in.
    const economy_ = economy(town('residential'));
    const record = village();
    economy_.update(1, [record]);
    const home = economy_.get(record.id)!.cells.get('0,0')!;
    const good = [...home.wants.keys()][0];
    economy_.deliver(record.id, good, CELL_STOCK);
    run(economy_, [record], HOUSEHOLD_SECONDS);
    expect(home.wants.get(good)!).toBeLessThan(CELL_STOCK);
  });

  it('names what the town is short of, most wanted first', () => {
    const economy_ = economy(town('residential', 'residential'));
    const record = village();
    economy_.update(1, [record]);
    const cells = [...economy_.get(record.id)!.cells.values()];
    const good = [...cells[0].wants.keys()][0];
    const before = economy_.shortOf(record.id).find((e) => e.good === good)!.short;
    economy_.deliver(record.id, good, CELL_STOCK);
    const short = economy_.shortOf(record.id);
    expect(short.length).toBeGreaterThan(0);
    // Delivering does not take a good off the list — the other home may want it too — but
    // it does make the town less short of it.
    expect(short.find((e) => e.good === good)!.short).toBeLessThan(before);
    for (let i = 1; i < short.length; i++) {
      expect(short[i - 1].short).toBeGreaterThanOrEqual(short[i].short);
    }
  });
});

describe('people who want to leave', () => {
  it('fills a queue of travellers, and caps it', () => {
    const economy_ = economy(town('residential'));
    const record = village();
    run(economy_, [record], JOURNEY_SECONDS);
    expect(economy_.get(record.id)!.waiting).toBeGreaterThan(0);
    run(economy_, [record], JOURNEY_SECONDS * 40);
    expect(economy_.get(record.id)!.waiting).toBe(MAX_WAITING);
  });

  it('hands travellers over and takes them back when the trip falls through', () => {
    const economy_ = economy(town('residential'));
    const record = village();
    run(economy_, [record], JOURNEY_SECONDS * 4);
    const had = economy_.get(record.id)!.waiting;
    expect(economy_.takeWaiting(record.id, 2)).toBe(2);
    expect(economy_.get(record.id)!.waiting).toBe(had - 2);
    economy_.returnWaiting(record.id, 2);
    expect(economy_.get(record.id)!.waiting).toBe(had);
    // Nothing to take from a town nobody has found.
    expect(economy_.takeWaiting('nowhere', 2)).toBe(0);
  });

  it('sends nobody anywhere from a town with no homes', () => {
    const economy_ = economy(town('commercial', 'industrial'));
    const record = village();
    run(economy_, [record], JOURNEY_SECONDS * 4);
    expect(economy_.get(record.id)!.waiting).toBe(0);
  });

  it('slows down when nobody is feeding the town', () => {
    const fed = economy(town('residential'));
    const hungry = economy(town('residential'));
    const record = village();
    fed.update(1, [record]);
    const home = fed.get(record.id)!.cells.get('0,0')!;
    for (const good of home.wants.keys()) fed.deliver(record.id, good, CELL_STOCK);
    run(fed, [record], JOURNEY_SECONDS * 3);
    run(hungry, [record], JOURNEY_SECONDS * 3);
    expect(hungry.get(record.id)!.waiting).toBeLessThan(fed.get(record.id)!.waiting);
  });
});
