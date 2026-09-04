/** A town as the buildings in it, rather than as one number.
 *
 *  `villages.ts` models a village as a single producer with a single stock, which is the
 *  right shape for "this place makes wheat" and the wrong shape for a town. A town is
 *  somewhere people live, shop and work, and the interesting thing about it is that those
 *  three want different things from each other: a home eats, a shop wants stock because
 *  customers walked in, a works wants raw material because somebody is standing at it.
 *
 *  So this module gives every building its own appetite, and a town its own people. The
 *  loop it is here to close is:
 *
 *      住宅に人が住む → 通勤で商店・工場・事務所へ行く → 買い物に来た客が品物を買う
 *      → 品切れの商店が品物を欲しがる → プレイヤーが運ぶ → 町が育つ
 *      → ビルが建って店と事務所が入居する → 働き口が増え、人が増える
 *
 *  Demand is *created by people moving*, which is the only reason the moving is worth
 *  simulating. Nothing here hands out development points by itself: a town that nobody
 *  serves gets hungrier, not bigger. What the player builds is still the only thing that
 *  makes a village grow.
 *
 *  Two rules are load-bearing, both inherited from the rest of the game:
 *
 *  Nothing here is saved. People are derived from the use of a building and the stage of
 *  its village; a pantry and a queue of commuters are worth exactly as much as the minute
 *  it takes to fill them again. `SavedVillage` therefore does not change, and a save from
 *  before towns existed opens into a town that is merely hungry.
 *
 *  The clock is the truth and the mob is the view. A commute is a number between 0 and 1
 *  that advances whether or not anybody is watching; the villager walking between the two
 *  doors is drawn from it and dropped when the player leaves. See the same rule stated at
 *  length at the top of `transport.ts`.
 *
 *  Nothing here imports three.js, so the whole thing runs under Vitest in Node. */

import { hashInts, mulberry32 } from '../core/rng';
import type { BuildingId } from './buildings';
import { FARMED, type GoodId, type VillageId, type VillageRecord } from './villages';
import type { BuildingUse } from '../world/generation/village';

/** As much of a building as the economy needs. The game hands over its `VillageBuilding`s;
 *  a test hands over three literals. Narrow on purpose, exactly like `DepotSource` in
 *  `transport.ts`: this module has never known what a doorway or a footprint is. */
export interface TownBuilding {
  id: BuildingId;
  use: BuildingUse;
  /** Blocks from the village centre. Nearer buildings are served first, because that is
   *  where the 集荷所 is and a cart does not walk to the edge of town for one crate. */
  fromCentre: number;
}

export interface TownSource {
  buildingsOf(village: VillageId): readonly TownBuilding[];
}

/** People living in one home, and jobs in one shop or works, at stage 0.
 *
 *  A stage adds one to each, so a 都市 is roughly twice the town a 集落 was per building —
 *  and it has more buildings, which is where most of the difference comes from. */
export const HOME_PEOPLE = 4;
export const SHOP_JOBS = 2;
export const WORKS_JOBS = 3;
/** Jobs on one floor of offices.
 *
 *  The largest of the four, because that is the point of an office: a floor of a building
 *  holds more people than the shop under it, and a town that has stacked five of them
 *  over one shopfront has found somewhere to put its people other than further out along
 *  the road. */
export const OFFICE_JOBS = 5;

/** Seconds one person takes to eat one unit of something, and seconds one filled job
 *  takes to use up one unit of what its building was stocked with.
 *
 *  Both are per person, so a busy building empties faster than a quiet one. The scale is
 *  set against what a route actually delivers rather than against what reads well on its
 *  own: a home of four gets through a unit a minute or so, a 都市 of six homes through
 *  five a minute, and one well paved cart route carries more than that. A town is
 *  therefore *keepable*, which is the whole point — a demand nobody could ever meet is a
 *  demand nobody bothers to read. */
export const HOUSEHOLD_SECONDS = 300;
export const TRADE_SECONDS = 240;
/** Seconds one leg of a commute takes.
 *
 *  A fixed walk rather than anything measured: a town's streets are short, and how far the
 *  villager actually covers is the view's problem — the view is allowed to hurry to catch
 *  its commute up exactly as a porter does. */
export const COMMUTE_WALK = 20;
/** Seconds between people setting out, per home in the town.
 *
 *  Divided by the number of homes, so a 都市 with six of them puts somebody on the street
 *  every four seconds and a 集落 with one manages it every twenty-four. That is the point:
 *  a town that has grown should *look* like it, and the population numbers alone are a
 *  thing you have to open the ledger to read. Shorter than `COMMUTE_WALK` at any size, so
 *  there is always more than one person out. */
export const COMMUTE_EVERY = 24;
/** Seconds between people setting out to *buy* something, per home in the town.
 *
 *  Shorter than a commute, because a town's people go to work once and to the shops
 *  rather more often than that — and because this is the errand the player's deliveries
 *  are actually for. Divided by the homes exactly as the commute is. */
export const SHOP_EVERY = 15;
/** How long somebody stays where they walked to.
 *
 *  A working day, and a visit to the shops. Both matter more than they look: a job that
 *  emptied the moment its walk finished meant a shop was open for the twenty seconds
 *  somebody happened to be standing in it, and nobody could ever have gone shopping
 *  there. With a day in it, a town that has staffed its shops keeps them open. */
export const WORK_DWELL = 90;
export const SHOP_DWELL = 8;
/** What one customer buys. A shop's whole stock is `CELL_STOCK`, so this is a visit
 *  emptying an eighth of a shelf: a delivery lasts a while, and not forever. */
export const SHOP_BASKET = 1;
/** How much longer a hungry home takes over all of that. A town nobody supplies does not
 *  stop — it slows down, which reads as somewhere going quiet rather than somewhere
 *  broken. */
export const HUNGRY_FACTOR = 2.5;
/** Seconds one person takes to decide they want to travel to another town. Much slower
 *  than a commute: a commute is every day, a journey is not. A 都市 of thirty people fills
 *  its platform in about ten minutes, which is a queue a line can be built for rather than
 *  a number pinned at its ceiling. */
export const JOURNEY_SECONDS = 600;

/** The most of one good a building keeps in. Small, because a building is not a warehouse
 *  — the point of the number is that a delivery runs out and the place wants another. */
export const CELL_STOCK = 8;
/** The most people waiting for a train out of one town. */
export const MAX_WAITING = 32;
/** How many people may be out on one errand at once. Beyond this the town is busy and
 *  the rest wait their turn.
 *
 *  A drawing limit rather than an economic one: every commute inside the town the player
 *  is standing in is a villager mob, and a 都市 that sent everybody out at once would be
 *  sixty of them on one street.
 *
 *  Counted per errand, because the two do not compete for the same thing: what actually
 *  limits the walk to work is the number of jobs there are to fill, and a town whose
 *  offices were full would otherwise never manage to send anybody shopping. */
export const MAX_COMMUTERS = 8;

/** What a home eats, burns and mends itself with. Every one of these comes out of some
 *  town's works, so a demand always has a supplier somewhere on the map — and that
 *  supplier is itself waiting on an industry, which is the whole shape of the game. */
export const HOUSEHOLD_GOODS: readonly GoodId[] = ['bread', 'torch', 'oak_planks'];
/** What a shop sells. Same rule. */
export const SHOP_GOODS: readonly GoodId[] = ['glass', 'sandstone', 'iron_ingot'];
/** What a floor of offices gets through. Paper and light and the fittings of the place —
 *  which in this game's vocabulary is planks, glass and something to burn. Same rule
 *  again: every one of them is some other town's works. */
export const OFFICE_GOODS: readonly GoodId[] = ['oak_planks', 'torch', 'glass'];
/** And what every shop sells whatever else it sells: the food off the town's own fields.
 *
 *  Guaranteed rather than shuffled in with the rest, because it is the only good with
 *  nowhere else to go. The harvest lands at the depot and is carried to the shops; a shop
 *  that happened not to stock it would be a shop the town's own crop could not reach. */
export const SHOP_STAPLE: GoodId = 'wheat';

/** Goods one building of each use asks for. Two apiece: one is a single point of failure,
 *  and four is a shopping list nobody reads. */
export const GOODS_PER_CELL = 2;

/** One building's economy. */
export interface BuildingCell {
  id: BuildingId;
  use: BuildingUse;
  /** People living here, or jobs to be filled here. Derived from the use and the stage. */
  people: number;
  /** What this building is asking for, and how much of it has arrived. */
  wants: Map<GoodId, number>;
  /** Fractional carry, so consumption does not depend on the frame rate. */
  progress: number;
  /** Jobs currently filled by somebody who walked here. Only shops, works and offices
   *  have these, and it is what turns "a building exists" into "a building wants
   *  something". */
  staff: number;
  /** Customers inside right now. Only a shop has any: this is the other half of what a
   *  shop is for, and the number the stock actually comes off for. */
  customers: number;
}

/** Why somebody is out on the street.
 *
 *  The two errands are the same walk and different consequences: going to work fills a
 *  job, which is what makes a building want anything at all, and going shopping empties
 *  a shelf, which is what makes the player's last delivery run out. */
export type Errand = 'work' | 'shopping';

/** Somebody walking from their home to their job or their shop. `t` is the truth; the
 *  villager the player sees is drawn from it. */
export interface Commute {
  villageId: VillageId;
  from: BuildingId;
  to: BuildingId;
  purpose: Errand;
  /** 0 at `from`, 1 at `to`. */
  t: number;
  dir: 1 | -1;
  /** Seconds left of the stop at the far end: a working day, or a visit to the shops.
   *  While it runs the person is *there* — filling a job, or standing in the shop — and
   *  the walk home starts when it is up. */
  dwell: number;
  /** The mob currently drawing this one, when the player is near enough to see it. */
  mobId: number | null;
}

/** A town, as everything about it that is not in `VillageRecord`. */
export interface Town {
  id: VillageId;
  cells: Map<BuildingId, BuildingCell>;
  commutes: Commute[];
  /** People who want to travel to another town, waiting at the 集荷所. */
  waiting: number;
  /** Fractional carries for the things a town does as a whole. */
  commuteProgress: number;
  shopProgress: number;
  journeyProgress: number;
  /** The stage the cells were last laid out for, so people are recounted when a village
   *  grows and not on every frame. */
  laidOutAt: number;
}

/** People in a building of this use, in a village at this stage. Pure, so it is never
 *  stored — the same building in the same town always holds the same number. */
export function peopleFor(use: BuildingUse, stage: number): number {
  // Open-ended growth adds more addresses, not infinitely crowded rooms. The authored
  // density curve reaches its intended maximum at the 都市 milestone.
  const density = Math.min(4, Math.max(0, stage));
  if (use === 'residential') return HOME_PEOPLE + density;
  if (use === 'commercial') return SHOP_JOBS + density;
  if (use === 'office') return OFFICE_JOBS + density;
  if (use === 'industrial') return WORKS_JOBS + density;
  return 0;
}

/** The goods one building asks for.
 *
 *  A works asks for its town's own raw material — all of it, since a craft that takes two
 *  things needs both — because that is what it converts and the town already decided what
 *  that is. Everything else draws a stable handful from
 *  the list for its use — stable because it is hashed off the building's own id, so a shop
 *  does not change its mind about what it sells when the town grows around it. */
export function goodsFor(
  seed: number,
  cell: { id: BuildingId; use: BuildingUse },
  village: Pick<VillageRecord, 'inputs' | 'produces'>,
): GoodId[] {
  // The works asks for exactly what the town's own craft takes, all of it: a glassworks
  // short of coal is a glassworks standing still, so half a shopping list is no use.
  if (cell.use === 'industrial') return [...village.inputs];
  if (cell.use === 'civic') return [];
  const pool = (cell.use === 'residential'
    ? HOUSEHOLD_GOODS
    : cell.use === 'office' ? OFFICE_GOODS : SHOP_GOODS)
    .filter((good) => good !== village.produces);
  const staple = cell.use === 'commercial' ? [SHOP_STAPLE] : [];
  if (pool.length === 0) return staple;
  const rng = mulberry32(hashInts(seed ^ 0x70b1, ...idNumbers(cell.id)));
  // Shuffle a copy and take a prefix, the same way `villageNeeds` does, so a building
  // asked for more later would keep asking for what it already asked for.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return [...staple, ...shuffled.slice(0, Math.min(GOODS_PER_CELL, shuffled.length))];
}

/** A building id is its own corner — `"x0,z0"` — so this is the two numbers back out of
 *  it. Anything that is not a pair of numbers hashes as zeroes, which is stable and is all
 *  this needs. */
function idNumbers(id: BuildingId): [number, number] {
  const comma = id.indexOf(',');
  if (comma < 0) return [0, 0];
  const x = Number(id.slice(0, comma));
  const z = Number(id.slice(comma + 1));
  return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0];
}

/** True when a home has nothing left in it. A hungry town runs slow rather than stopping,
 *  so this is a multiplier and never a gate. */
function hungry(cell: BuildingCell): boolean {
  if (cell.wants.size === 0) return false;
  for (const held of cell.wants.values()) if (held > 0) return false;
  return true;
}

/** Every town the player has found, and what is going on inside it. */
export class TownEconomy {
  readonly towns = new Map<VillageId, Town>();

  constructor(
    private readonly seed: number,
    private readonly source: TownSource,
  ) {}

  /** The town for a village, laid out from its buildings. Idempotent: a town that already
   *  exists keeps everything in it, and only picks up buildings that have appeared and
   *  drops ones that have gone.
   *
   *  Relaying is keyed on the village's stage, because that is the only thing that changes
   *  how many people a building holds. The building *list* is rebuilt by `game.ts` every
   *  time a road block moves, so re-deriving the cells from it every frame would throw a
   *  town's pantry away every time somebody swung a shovel. */
  ensure(village: VillageRecord): Town {
    let town = this.towns.get(village.id);
    if (!town) {
      town = {
        id: village.id,
        cells: new Map(),
        commutes: [],
        waiting: 0,
        commuteProgress: 0,
        shopProgress: 0,
        journeyProgress: 0,
        laidOutAt: -1,
      };
      this.towns.set(village.id, town);
    }
    const buildings = this.source.buildingsOf(village.id);
    // Every id, not just the count: a road laid through one plot takes a building away and
    // can hand one back in the same breath, and a count that happened to match would leave
    // the town describing a house that is no longer standing.
    const same = town.laidOutAt === village.stage
      && town.cells.size === buildings.length
      && buildings.every((building) => town.cells.has(building.id));
    if (same) return town;
    town.laidOutAt = village.stage;
    const seen = new Set<BuildingId>();
    for (const building of buildings) {
      seen.add(building.id);
      let cell = town.cells.get(building.id);
      if (!cell) {
        cell = {
          id: building.id,
          use: building.use,
          people: 0,
          wants: new Map(),
          progress: 0,
          staff: 0,
          customers: 0,
        };
        town.cells.set(building.id, cell);
      }
      // A building that was rebuilt somewhere else may have changed what it is for.
      cell.use = building.use;
      cell.people = peopleFor(building.use, village.stage);
      const wanted = goodsFor(this.seed, cell, village);
      for (const good of wanted) {
        if (!cell.wants.has(good)) cell.wants.set(good, 0);
      }
      // A works whose village turned out to convert something else asks for the new thing.
      for (const good of [...cell.wants.keys()]) {
        if (!wanted.includes(good)) cell.wants.delete(good);
      }
    }
    for (const id of [...town.cells.keys()]) {
      if (seen.has(id)) continue;
      town.cells.delete(id);
      // A commute to or from a building that is no longer there has nowhere to go.
      town.commutes = town.commutes.filter((c) => c.from !== id && c.to !== id);
    }
    return town;
  }

  get(id: VillageId): Town | undefined {
    return this.towns.get(id);
  }

  /** Forgets a town. Only used when a village is rebuilt from scratch — loading a save
   *  replaces the registry wholesale, and a town left behind would describe the world the
   *  player just closed. */
  clear(): void {
    this.towns.clear();
  }

  /** Advances every town the player has found.
   *
   *  Only discovered villages cost anything, exactly as `VillageRegistry.produce` does: an
   *  unexplored world runs no towns at all. */
  update(dt: number, villages: Iterable<VillageRecord>): void {
    for (const village of villages) {
      if (!village.discovered) continue;
      const town = this.ensure(village);
      this.consume(town, dt);
      this.walk(town, dt);
      this.commute(town, village, dt);
      this.shopping(town, village, dt);
      this.journey(town, dt);
    }
  }

  /** Homes eat and staffed buildings sell. A building with nobody in it uses nothing,
   *  which is what makes a commute worth watching. */
  private consume(town: Town, dt: number): void {
    for (const cell of town.cells.values()) {
      if (cell.wants.size === 0) continue;
      // A shop is the one building that does not use its own stock up. Somebody walks in
      // and buys it — see `shopping` — which is the only reason the walking is worth
      // simulating: a shop nobody visits keeps its shelves and a shop on a busy street
      // does not, and both of those are things the player can stand in the road and see.
      if (cell.use === 'commercial') continue;
      const users = cell.use === 'residential' ? cell.people : cell.staff;
      // An empty shop sells nothing — but it does not forget the half sale it was partway
      // through either. The clock is held, not reset. Resetting it (which is what
      // `VillageRegistry.produce` does to a starved workshop, and where this was copied
      // from) meant a shop never sold anything at all: custom comes and goes as people
      // walk in and out, so the counter was wiped every time the last customer left and
      // never reached one sale.
      if (users <= 0) continue;
      const seconds = (cell.use === 'residential' ? HOUSEHOLD_SECONDS : TRADE_SECONDS) / users;
      cell.progress += dt;
      while (cell.progress >= seconds) {
        cell.progress -= seconds;
        if (!take(cell)) break;
      }
    }
  }

  /** Walks everybody who is already out, and settles what happens at each end.
   *
   *  One pass for both errands, because the walk is the same walk: what differs is what
   *  arriving means. Somebody who came to work fills a job for as long as they stay;
   *  somebody who came to shop stands in the shop for a while and buys something.
   *
   *  Note the order against `consume`: an arrival this frame is counted before the next
   *  frame's consumption, so a job filled and a job used are never the same tick twice. */
  private walk(town: Town, dt: number): void {
    for (let i = town.commutes.length - 1; i >= 0; i--) {
      const commute = town.commutes[i];
      // Standing in the shop. Nothing moves until the visit is over.
      if (commute.dwell > 0) {
        commute.dwell = Math.max(0, commute.dwell - dt);
        if (commute.dwell > 0) continue;
      }
      commute.t += (dt * commute.dir) / COMMUTE_WALK;
      if (commute.t < 1 && commute.t > 0) continue;
      const cell = town.cells.get(commute.to);
      if (commute.dir === 1) {
        commute.t = 1;
        commute.dir = -1;
        if (commute.purpose === 'work') {
          // Arrived at work. The job is filled for the day, and then they walk home.
          if (cell) cell.staff = Math.min(cell.people, cell.staff + 1);
          commute.dwell = WORK_DWELL;
        } else if (cell) {
          // Arrived at the shop, and bought what there was to buy. An empty shop is not
          // a failed errand — the customer is still standing in it, which is exactly what
          // makes the empty shelf worth looking at.
          cell.customers += 1;
          commute.dwell = SHOP_DWELL;
          for (let bought = 0; bought < SHOP_BASKET; bought++) {
            if (!take(cell)) break;
          }
        }
        continue;
      }
      // Home again. Whatever they were counted as, they are not that any more.
      commute.t = 0;
      if (cell) {
        if (commute.purpose === 'work') cell.staff = Math.max(0, cell.staff - 1);
        else cell.customers = Math.max(0, cell.customers - 1);
      }
      town.commutes.splice(i, 1);
    }
  }

  /** Sends people out of their homes to work. A commute that arrives fills a job, and a
   *  filled job is what makes a works or an office want anything — which is the whole
   *  reason any of this moves. */
  private commute(town: Town, village: VillageRecord, dt: number): void {
    const homes = this.homesOf(town);
    const jobs: BuildingCell[] = [];
    for (const cell of town.cells.values()) {
      if (cell.use === 'commercial' || cell.use === 'industrial' || cell.use === 'office') {
        jobs.push(cell);
      }
    }
    if (homes.length === 0 || jobs.length === 0) return;
    town.commuteProgress = this.setOut(
      town, village, dt, town.commuteProgress, COMMUTE_EVERY, homes, 0x0c0f,
      (heading) => leastStaffed(jobs, heading),
      'work',
    );
  }

  /** Sends people out of their homes to buy something.
   *
   *  Only to a shop with somebody working in it: a shop nobody has come to open is shut,
   *  and walking a customer up to a locked door would be the wrong picture of a town that
   *  is short of people. That also chains the two errands, which is the point — nothing
   *  is sold anywhere until somebody has walked to work first. */
  private shopping(town: Town, village: VillageRecord, dt: number): void {
    const homes = this.homesOf(town);
    const open: BuildingCell[] = [];
    for (const cell of town.cells.values()) {
      if (cell.use === 'commercial' && cell.staff > 0) open.push(cell);
    }
    if (homes.length === 0 || open.length === 0) return;
    town.shopProgress = this.setOut(
      town, village, dt, town.shopProgress, SHOP_EVERY, homes, 0x5107,
      (heading) => quietest(open, heading),
      'shopping',
    );
  }

  private homesOf(town: Town): BuildingCell[] {
    const homes: BuildingCell[] = [];
    for (const cell of town.cells.values()) {
      if (cell.use === 'residential') homes.push(cell);
    }
    return homes;
  }

  /** Puts people on the street at a rate, and hands back the fractional carry.
   *
   *  Shared by both errands because the rate is the same shape for both: so many seconds
   *  per home, slower when the town is going hungry, and never past the drawing limit. */
  private setOut(
    town: Town,
    village: VillageRecord,
    dt: number,
    carried: number,
    every: number,
    homes: readonly BuildingCell[],
    salt: number,
    destination: (heading: ReadonlyMap<BuildingId, number>) => BuildingCell | null,
    purpose: Errand,
  ): number {
    // A hungry town is a slow town. Nothing stops, so a place nobody supplies keeps
    // ticking over quietly instead of falling off the map.
    const fed = homes.some((home) => !hungry(home));
    const interval = (every / homes.length) * (fed ? 1 : HUNGRY_FACTOR);
    let out = 0;
    // Who is already on their way where. A destination picked off the people who have
    // *arrived* sends the whole town to the same door: nobody arrives for twenty seconds,
    // so for twenty seconds every building still looks empty. Counting the walk as well
    // is what spreads a town's jobs across its buildings.
    const heading = new Map<BuildingId, number>();
    for (const commute of town.commutes) {
      if (commute.purpose !== purpose) continue;
      out++;
      if (commute.dir === 1) heading.set(commute.to, (heading.get(commute.to) ?? 0) + 1);
    }
    let progress = carried + dt;
    while (progress >= interval && out < MAX_COMMUTERS) {
      progress -= interval;
      const pick = mulberry32(hashInts(
        this.seed ^ salt, village.x, village.z, town.commutes.length,
      ));
      const home = homes[Math.floor(pick() * homes.length)];
      const to = destination(heading);
      if (!home || !to) break;
      out++;
      heading.set(to.id, (heading.get(to.id) ?? 0) + 1);
      town.commutes.push({
        villageId: town.id,
        from: home.id,
        to: to.id,
        purpose,
        t: 0,
        dir: 1,
        dwell: 0,
        mobId: null,
      });
    }
    // The carry is capped at one interval so a town that spent a while at its drawing
    // limit does not empty every home onto the street the moment a slot frees up.
    return Math.min(progress, interval);
  }

  /** Fills the queue of people who want to go somewhere else. A town that is fed produces
   *  travellers; one that is not produces them slowly. Nothing here moves them — that is
   *  `transport.ts`'s job, and only if the player has built it a way out. */
  private journey(town: Town, dt: number): void {
    let people = 0;
    let fed = 0;
    for (const cell of town.cells.values()) {
      if (cell.use !== 'residential') continue;
      people += cell.people;
      if (!hungry(cell)) fed += cell.people;
    }
    if (people <= 0 || town.waiting >= MAX_WAITING) return;
    const every = JOURNEY_SECONDS / people * (fed > 0 ? 1 : HUNGRY_FACTOR);
    town.journeyProgress += dt;
    while (town.journeyProgress >= every && town.waiting < MAX_WAITING) {
      town.journeyProgress -= every;
      town.waiting += 1;
    }
  }

  /** People waiting to travel out of a town. */
  waitingAt(id: VillageId): number {
    return this.towns.get(id)?.waiting ?? 0;
  }

  /** Takes people off the queue for a trip out of town. */
  takeWaiting(id: VillageId, count: number): number {
    const town = this.towns.get(id);
    if (!town || count <= 0) return 0;
    const taken = Math.min(count, town.waiting);
    town.waiting -= taken;
    return taken;
  }

  /** Puts people back, when the trip they were on never happened. */
  returnWaiting(id: VillageId, count: number): void {
    const town = this.towns.get(id);
    if (town) town.waiting = Math.min(MAX_WAITING, town.waiting + count);
  }

  /** Hands a town a delivery, filling the buildings that asked for it. Returns how much
   *  actually landed somewhere: the rest is a delivery of something nobody here wanted,
   *  which is still worth points and is not this module's business.
   *
   *  Nearest the centre first, because that is where the 集荷所 is. */
  deliver(id: VillageId, good: GoodId, count: number): number {
    const town = this.towns.get(id);
    if (!town || count <= 0) return 0;
    let left = count;
    for (const cell of this.byDistance(town)) {
      if (left <= 0) break;
      const held = cell.wants.get(good);
      if (held === undefined || held >= CELL_STOCK) continue;
      const room = Math.min(left, CELL_STOCK - held);
      cell.wants.set(good, held + room);
      left -= room;
    }
    return count - left;
  }

  /** Every good any building in a town is short of, most wanted first. What the ledger
   *  and the panel read to say why a town is quiet. */
  shortOf(id: VillageId): { good: GoodId; short: number }[] {
    const town = this.towns.get(id);
    if (!town) return [];
    const totals = new Map<GoodId, number>();
    for (const cell of town.cells.values()) {
      if (cell.use !== 'residential' && cell.staff <= 0) continue;
      for (const [good, held] of cell.wants) {
        // What the town grows for itself never goes on this list. It is the town's own
        // business, carried in from its own depot, and putting it on the panel would ask
        // the player for a good nothing on the map sells.
        if (FARMED.includes(good)) continue;
        totals.set(good, (totals.get(good) ?? 0) + (CELL_STOCK - held));
      }
    }
    return [...totals]
      .map(([good, short]) => ({ good, short }))
      .filter((entry) => entry.short > 0)
      .sort((a, b) => b.short - a.short);
  }

  /** People a town holds, and how many of them are out walking. */
  populationOf(id: VillageId): number {
    const town = this.towns.get(id);
    if (!town) return 0;
    let people = 0;
    for (const cell of town.cells.values()) people += cell.people;
    return people;
  }

  /** Cells nearest the village centre first. Recomputed rather than kept because the
   *  building list itself is rebuilt whenever a road moves, and a stale order would serve
   *  a building that is no longer there. */
  private byDistance(town: Town): BuildingCell[] {
    const order = new Map<BuildingId, number>();
    for (const building of this.source.buildingsOf(town.id)) {
      order.set(building.id, building.fromCentre);
    }
    return [...town.cells.values()].sort(
      (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
    );
  }
}

/** Takes one unit out of whatever a building has most of, so a pantry empties evenly
 *  instead of running one shelf down to nothing. False when there was nothing to take. */
function take(cell: BuildingCell): boolean {
  let best: GoodId | null = null;
  let most = 0;
  for (const [good, held] of cell.wants) {
    if (held <= most) continue;
    best = good;
    most = held;
  }
  if (best === null) return false;
  cell.wants.set(best, most - 1);
  return true;
}

/** The open shop with the fewest people in it. Same idea as `leastStaffed`, and for the
 *  same reason: a town with three shops should be a town where all three have somebody in
 *  them, not one queue and two empty rooms. A shop is never full — there is no such thing
 *  as a shop that turns customers away — so this always answers. */
function quietest(
  shops: readonly BuildingCell[],
  heading: ReadonlyMap<BuildingId, number>,
): BuildingCell | null {
  let best: BuildingCell | null = null;
  let fewest = Infinity;
  for (const cell of shops) {
    const expected = cell.customers + (heading.get(cell.id) ?? 0);
    if (expected >= fewest) continue;
    best = cell;
    fewest = expected;
  }
  return best;
}

/** The job with the most room in it, so a town fills its buildings evenly rather than
 *  crowding everybody into whichever one the shuffle happened to pick first. */
function leastStaffed(
  jobs: readonly BuildingCell[],
  heading: ReadonlyMap<BuildingId, number>,
): BuildingCell | null {
  let best: BuildingCell | null = null;
  let fewest = Infinity;
  for (const cell of jobs) {
    const expected = cell.staff + (heading.get(cell.id) ?? 0);
    if (expected >= cell.people) continue;
    if (expected >= fewest) continue;
    best = cell;
    fewest = expected;
  }
  return best;
}
