/** Goods moving between villages.
 *
 *  The abstract clock is the truth: a shipment is a number between 0 and 1 that advances
 *  at a fixed rate, and it keeps advancing whether or not anybody is watching. The porter
 *  walking the road is the *view* of that number — it is walked towards where the shipment
 *  has got to and put back on the road when it falls behind, and it is dropped entirely
 *  once the player is too far away to see it. Nothing a mob does can hold a delivery up:
 *  letting one drive the clock meant a porter caught on a doorway stopped the line for as
 *  long as somebody stood watching it.
 *
 *  What the road is paved with sets both how fast that number moves and how much one trip
 *  carries, so a line the player comes back to and improves keeps paying more. And a
 *  porter only walks home empty when there is nothing at the far end worth bringing
 *  back — a pair of villages that each want what the other makes is worth twice the
 *  road. */

import { pathAroundPlots } from './buildings';
import { roadGrade, toWaypoints, type RoadNetwork, type RoadPoint, type SurveyResult } from './roads';
import type { GoodId, VillageId, VillageRegistry } from './villages';

/** What is doing the hauling. A cart only runs where the road is three columns wide the
 *  whole way, which is the one thing widening a road buys — and the reason widening one
 *  is worth an afternoon. */
export type Vehicle = 'porter' | 'cart';

/** Blocks per second on a plain dirt path. Road quality multiplies it. */
export const PORTER_SPEED = 3.2;
/** Goods one trip carries on a dirt path. Better pavement means a cart, not a sack. */
export const BASE_LOAD = 2;
/** How close the player must be for a porter to be worth drawing. The mob manager's own
 *  96 block despawn then cleans it up, which is why nothing here has to fight it. */
export const PORTER_VISIBLE = 64;
/** A long line needs more than one porter or its throughput collapses with distance —
 *  the same reason a transport game lets you put a second vehicle on a route. */
export const BLOCKS_PER_PORTER = 320;
export const MAX_PORTERS = 3;
/** Fraction of the road a porter must have covered before the next one sets out, so a
 *  route sends a stream rather than a clump. */
export const PORTER_SPACING = 0.15;
/** Seconds between attempts to survey a road that is not connected yet. */
export const RESURVEY_INTERVAL = 2;
/** Emeralds paid for hauling one good over this many blocks. Deliberately modest: the
 *  network should fund the shopping, not end it. A well paved line pays a few emeralds a
 *  trip, so an afternoon of hauling buys a villager's table rather than all of them. */
export const PAY_DISTANCE = 800;
/** What a cart multiplies a trip by. Speed is left alone deliberately: pavement is what
 *  makes a road fast and width is what makes it carry, so the two jobs stay legible. */
export const CART_LOAD = 3;
/** Detour past which the panel starts saying so. Under it a road is merely following the
 *  ground; over it, it is going somewhere else first. */
export const DETOUR_NOTICE = 1.15;
/** Blocks between a depot's door and the nearest road worth telling the player about.
 *  The walk to the door counts towards every trip, so an unpaved one is a real cost. */
export const DOOR_GAP_NOTICE = 8;

/** Goods one trip carries on a road of the given quality. */
export function loadFor(quality: number): number {
  return Math.max(1, Math.round(BASE_LOAD + (quality - 1) * 6));
}

/** Porters a route is worth running. */
export function portersFor(length: number): number {
  return Math.max(1, Math.min(MAX_PORTERS, 1 + Math.floor(length / BLOCKS_PER_PORTER)));
}

/** The player's cut of a delivery: paid by the load, the distance, and by whether the
 *  goods were actually wanted where they went.
 *
 *  `direct` is the straight line between the two depots, not the length of the road. It
 *  used to be the road, which paid *more* for a road that wandered — the freight was
 *  worth what the hauling cost rather than what it was worth to the villages. Now a
 *  detour is what it should be: the same fare, a longer trip, fewer of them. */
export function payFor(direct: number, count: number, needed: boolean): number {
  return Math.max(1, Math.round((count * direct * (needed ? 1.5 : 1)) / PAY_DISTANCE));
}

export interface Porter {
  /** 0 at the origin, 1 at the destination. */
  t: number;
  dir: 1 | -1;
  /** Which end this one set out from, and so which end it walks back to and finishes at.
   *  A route is a line between two villages rather than a one way pipe: whichever end has
   *  goods is the end a trip starts from. */
  home: 0 | 1;
  good: GoodId;
  cargo: number;
  mobId: number | null;
}

export interface Route {
  from: VillageId;
  to: VillageId;
  /** What travels out from `from`. The return leg carries whatever `from` wants, so this
   *  is the headline good rather than the only one. */
  good: GoodId;
  /** False until the road has been walked once, so nothing reports a distance it has not
   *  measured yet. */
  surveyed: boolean;
  connected: boolean;
  /** True once this pair has ever been joined, so a road dug up stays on the panel
   *  instead of quietly vanishing. */
  everConnected: boolean;
  /** Trimmed to the corners, so a porter is not handed a point per block. Both ends are
   *  the doorway of a village's 集荷所, so a shipment is seen leaving a building rather
   *  than appearing at the edge of a street. */
  waypoints: RoadPoint[];
  /** The two doorways, when the villages are known. Null before the first survey. */
  fromDoor: RoadPoint | null;
  toDoor: RoadPoint | null;
  /** Cumulative distance along `waypoints`, same length. */
  cumulative: number[];
  length: number;
  /** Weighted speed factor of the pavement, and what to call it. */
  quality: number;
  grade: string;
  /** Blocks of up and down along the whole road. Climb is charged as time, so this is
   *  why an otherwise well paved line reports itself slow. */
  climb: number;
  /** Straight line between the two depots. The fare is paid on this. */
  direct: number;
  /** `length / direct`. One means the road goes straight there. */
  detour: number;
  /** What hauls this route, and where the road is too narrow for a cart when it is not. */
  vehicle: Vehicle;
  cartPinch: RoadPoint | null;
  /** The longest stretch at either end between a depot's door and the road proper. */
  doorGap: number;
  /** Straight-line distance still to be paved, when not connected. */
  missing: number;
  gapFrom: RoadPoint | null;
  gapTo: RoadPoint | null;
  /** A column standing beside what it should join and only too high or too low for it.
   *  The one break a distance cannot describe. */
  nearMiss: RoadPoint | null;
  porters: Porter[];
  /** Running totals, for the ledger. */
  delivered: number;
  trips: number;
}

export interface SavedRoute {
  from: string;
  to: string;
}

/** How far a porter mob may lag behind its shipment before it starts hurrying. Big enough
 *  to hop a fence or go round a tree; past it the mob runs, up to `CATCH_UP` times its
 *  usual pace, rather than being picked up and put down. */
export const PORTER_LEASH = 7;
/** Fastest a mob will run to catch its shipment up. */
export const CATCH_UP = 3;
/** How far behind is too far to recover. At this distance the mob is dropped and the next
 *  frame draws a new one where the goods actually are — twenty-four blocks apart, nobody
 *  is watching both ends, so nothing is seen to move that should not. */
export const PORTER_LOST = 24;

/** Where a village loads and unloads. The game answers this from its building registry;
 *  transport only needs the point, so it never learns what a building is. */
export interface DepotSource {
  doorOf(village: VillageId): RoadPoint | null;
  /** The village's building plots, so the walk from a doorway to the road can go round
   *  them instead of through them. */
  plotsOf(village: VillageId): readonly { x0: number; z0: number; w: number; d: number }[];
}

/** What the game hands transport so it can show a porter. Kept narrow so the simulation
 *  itself has no idea mobs exist. */
export interface PorterHost {
  spawnPorter(point: RoadPoint, vehicle: Vehicle): number | null;
  porterPosition(mobId: number): { x: number; z: number } | null;
  /** Walks the mob towards where its shipment has got to, at the route's speed, and puts
   *  it back on the road if it has fallen more than `PORTER_LEASH` behind. */
  movePorter(mobId: number, point: RoadPoint, speed: number): void;
  removePorter(mobId: number): void;
}

/** A shipment as somewhere on the map, rather than as a number. */
export interface PorterView {
  route: Route;
  x: number;
  y: number;
  z: number;
  dir: 1 | -1;
  good: GoodId;
  /** 0 on the walk home with nothing worth carrying. */
  cargo: number;
  vehicle: Vehicle;
  /** Whether a mob is currently drawing this one. */
  visible: boolean;
}

/** One delivery, as the game needs to report it. */
export interface Arrival {
  route: Route;
  to: VillageId;
  good: GoodId;
  count: number;
  /** Whether the destination had asked for this. */
  needed: boolean;
  /** Emeralds owed to the player for the haul. */
  pay: number;
}

export interface TransportEvents {
  onConnected?(route: Route): void;
  onDisconnected?(route: Route): void;
  onArrival?(arrival: Arrival): void;
  onStageUp?(id: VillageId, stage: number): void;
}

function measure(waypoints: RoadPoint[]): { cumulative: number[]; length: number } {
  const cumulative = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const step = Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
    cumulative.push(cumulative[i - 1] + step);
  }
  return { cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

export class TransportNetwork {
  readonly routes: Route[] = [];
  private surveyTimer = 0;
  private surveyedRevision = -1;
  /** Where the round robin over routes starts this update. */
  private dispatchCursor = 0;

  constructor(
    private readonly roads: RoadNetwork,
    private readonly registry: VillageRegistry,
    private readonly events: TransportEvents = {},
    private readonly host: PorterHost | null = null,
    private readonly depots: DepotSource | null = null,
  ) {}

  /** Registers a pair worth watching. Idempotent, and direction-insensitive. */
  requestRoute(from: VillageId, to: VillageId): Route | null {
    if (from === to) return null;
    const existing = this.find(from, to);
    if (existing) return existing;
    // The origin may not be registered yet: routes are restored from a save before the
    // player has walked near enough for the villages to be re-derived from the seed. The
    // good is resolved on the first survey instead.
    const route: Route = {
      from,
      to,
      good: this.registry.get(from)?.produces ?? '',
      surveyed: false,
      connected: false,
      everConnected: false,
      waypoints: [],
      fromDoor: null,
      toDoor: null,
      cumulative: [],
      length: 0,
      quality: 1,
      grade: roadGrade(1),
      climb: 0,
      direct: 0,
      detour: 1,
      vehicle: 'porter',
      cartPinch: null,
      doorGap: 0,
      missing: 0,
      gapFrom: null,
      gapTo: null,
      nearMiss: null,
      porters: [],
      delivered: 0,
      trips: 0,
    };
    this.routes.push(route);
    // Survey on the very next update, so the panel never shows a stale or invented
    // distance for a route the player just started caring about.
    this.surveyedRevision = -1;
    this.surveyTimer = 0;
    return route;
  }

  /** Forces the next update to walk every road again. The road index has not moved, so
   *  nothing else would notice — but where a route *ends* has, and that is the same thing
   *  as far as its waypoints are concerned. */
  invalidate(): void {
    this.surveyedRevision = -1;
    this.surveyTimer = 0;
  }

  find(from: VillageId, to: VillageId): Route | undefined {
    return this.routes.find(
      (r) => (r.from === from && r.to === to) || (r.from === to && r.to === from),
    );
  }

  /** Where every shipment on the network has got to, whether or not a mob is drawing it.
   *  This is what the compass and the map point at: "your goods are here" is the answer
   *  to "the road is joined up, so why can I not see anything happening?". */
  porterViews(): PorterView[] {
    const out: PorterView[] = [];
    for (const route of this.routes) {
      for (const porter of route.porters) {
        const point = this.pointAt(route, porter.t);
        if (!point) continue;
        out.push({
          route,
          x: point.x,
          y: point.y,
          z: point.z,
          dir: porter.dir,
          good: porter.good,
          cargo: porter.cargo,
          vehicle: route.vehicle,
          visible: porter.mobId !== null,
        });
      }
    }
    return out;
  }

  /** Porters currently walking anywhere on the network. */
  porterCount(): number {
    let total = 0;
    for (const route of this.routes) total += route.porters.length;
    return total;
  }

  update(dt: number, playerX: number, playerZ: number): void {
    this.surveyTimer -= dt;
    if (this.surveyTimer <= 0) {
      this.surveyTimer = RESURVEY_INTERVAL;
      if (this.surveyedRevision !== this.roads.revision) {
        let complete = true;
        for (const route of this.routes) {
          if (!this.resurvey(route)) complete = false;
        }
        // A route restored from a save is surveyed before the player has walked near
        // enough for its villages to be re-derived from the seed. Marking the revision
        // done there would leave the route stuck until somebody moved a road block, so
        // the attempt only counts once every route could actually be walked.
        if (complete) this.surveyedRevision = this.roads.revision;
      }
    }
    // Round robin rather than array order. Every route sharing a village calls
    // `takeStock` on it in the same frame and `takeStock` hands over whatever is there,
    // so a fixed order let whichever route happened to be first drain that village every
    // single frame and starve the rest of them for good.
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[(i + this.dispatchCursor) % this.routes.length];
      this.advance(route, dt, playerX, playerZ);
    }
    if (this.routes.length > 0) this.dispatchCursor = (this.dispatchCursor + 1) % this.routes.length;
  }

  /** Re-walks a route's road. Returns false when its villages are not known yet. */
  private resurvey(route: Route): boolean {
    const from = this.registry.get(route.from);
    const to = this.registry.get(route.to);
    if (!from || !to) return false;
    route.good = from.produces;
    const result: SurveyResult = this.roads.survey(from, to);
    const was = route.connected;
    route.surveyed = true;
    if (result.connected) {
      route.connected = true;
      route.everConnected = true;
      // The survey walks street to street; the last few blocks at each end are the walk
      // between that street and the door goods actually go through. Those count towards
      // the trip, which is what makes a 集荷所 by the road worth choosing.
      route.fromDoor = this.depots?.doorOf(route.from) ?? null;
      route.toDoor = this.depots?.doorOf(route.to) ?? null;
      const walked = toWaypoints(result.waypoints);
      // The survey walks street to street. Where the index knows a way from the doorway
      // onto that road, walk it: a spur somebody laid to their own depot is road, and
      // cutting the corner across it is how a porter ends up inside a wall.
      const head = result.waypoints[1];
      const tail = result.waypoints[result.waypoints.length - 2];
      let doorGap = 0;
      if (route.fromDoor) {
        doorGap = Math.max(doorGap, this.joinDoor(route.from, route.fromDoor, head, walked, 'head'));
      }
      if (route.toDoor) {
        doorGap = Math.max(doorGap, this.joinDoor(route.to, route.toDoor, tail, walked, 'tail'));
      }
      route.doorGap = doorGap;
      route.waypoints = walked;
      const measured = measure(route.waypoints);
      route.cumulative = measured.cumulative;
      route.length = Math.max(1, measured.length);
      route.quality = result.quality;
      route.grade = roadGrade(result.quality);
      route.climb = result.climb;
      const ends = route.fromDoor && route.toDoor
        ? Math.hypot(route.toDoor.x - route.fromDoor.x, route.toDoor.z - route.fromDoor.z)
        : result.direct;
      route.direct = Math.max(1, ends);
      route.detour = route.length / route.direct;
      const vehicle: Vehicle = result.cart.ok ? 'cart' : 'porter';
      if (vehicle !== route.vehicle) {
        // The mobs are the wrong shape now. Drop them; the next frame draws the right
        // ones where the shipments actually are, and no cargo moves.
        for (const porter of route.porters) {
          if (porter.mobId === null) continue;
          this.host?.removePorter(porter.mobId);
          porter.mobId = null;
        }
        route.vehicle = vehicle;
      }
      route.cartPinch = result.cart.ok ? null : result.cart.pinch;
      route.missing = 0;
      route.gapFrom = null;
      route.gapTo = null;
      route.nearMiss = null;
      if (!was) this.events.onConnected?.(route);
      return true;
    }
    route.connected = false;
    route.missing = result.missing;
    route.gapFrom = result.frontierFrom;
    route.gapTo = result.frontierTo;
    route.nearMiss = result.nearMiss;
    route.cartPinch = null;
    route.vehicle = 'porter';
    if (was) {
      // The road was broken while goods were on it. Send them home rather than losing
      // them; a road being dug up should cost time, not cargo.
      for (const porter of route.porters) {
        if (porter.cargo > 0) this.registry.returnStock(route.from, porter.cargo);
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
      }
      route.porters.length = 0;
      route.waypoints = [];
      route.cumulative = [];
      this.events.onDisconnected?.(route);
    }
    return true;
  }

  /** Puts a depot's doorway on the front or the back of the walk, and works out how the
   *  goods get from one to the other.
   *
   *  Three answers, best first. A spur somebody laid from their own depot to the road is
   *  road, so the index walks it. Failing that the goods walk across the village, going
   *  round the houses rather than through them — which is what the porter following them
   *  has to do, and what it could not do while this was a straight line drawn from the
   *  doorway to a street thirty blocks away. Failing even that, the straight line, which
   *  is at least somewhere to go.
   *
   *  Returns how far the unpaved part of that leg is, which is what the panel reports: the
   *  walk to the door counts towards every trip, so paving it is work that pays. */
  private joinDoor(
    village: VillageId,
    door: RoadPoint,
    onto: RoadPoint | undefined,
    walked: RoadPoint[],
    end: 'head' | 'tail',
  ): number {
    if (!onto) return 0;
    const spur = this.roads.pathBetween(door, onto, 32);
    // The walk round the houses joins the survey where the survey starts — the point on
    // the village's own street — rather than at the first road column past it, so the two
    // meet without a step sideways. Its last point is that same street point, which the
    // walk already holds, so it is dropped.
    const edge = end === 'head' ? walked[0] : walked[walked.length - 1];
    const round = spur || !edge
      ? null
      : pathAroundPlots(door, edge, this.depots?.plotsOf(village) ?? []);
    const link = spur ? toWaypoints(spur) : round ? toWaypoints(round.slice(0, -1)) : [];
    const parts = end === 'head' ? [door, ...link] : [...link.reverse(), door];
    if (end === 'head') walked.unshift(...parts);
    else walked.push(...parts);
    // A spur is road as far as the first column it reaches; a walk round the houses is
    // unpaved the whole way, and saying so is what keeps the notice worth reading.
    if (spur) {
      const first = link[end === 'head' ? 0 : link.length - 1] ?? onto;
      return Math.hypot(first.x - door.x, first.z - door.z);
    }
    if (!round) return Math.hypot(onto.x - door.x, onto.z - door.z);
    let walk = 0;
    for (let i = 1; i < round.length; i++) {
      walk += Math.hypot(round[i].x - round[i - 1].x, round[i].z - round[i - 1].z);
    }
    return walk;
  }

  /** Speed in blocks per second, and the load one trip carries. */
  speedOf(route: Route): number {
    return PORTER_SPEED * route.quality;
  }

  loadOf(route: Route): number {
    return loadFor(route.quality) * (route.vehicle === 'cart' ? CART_LOAD : 1);
  }

  private advance(route: Route, dt: number, playerX: number, playerZ: number): void {
    if (!route.connected) return;

    this.dispatch(route);

    const step = (dt * this.speedOf(route)) / route.length;
    for (let i = route.porters.length - 1; i >= 0; i--) {
      const porter = route.porters[i];
      // The clock is the truth, watched or not. Letting the mob drive it instead meant a
      // porter snagged on a doorway stopped the whole line for as long as the player
      // stood there — which is exactly when they were looking.
      porter.t += step * porter.dir;
      this.syncMob(route, porter, playerX, playerZ);

      const at = porter.t >= 1 ? 1 : porter.t <= 0 ? 0 : null;
      if (at === null) continue;
      porter.t = at;
      this.arrive(route, porter, this.villageAt(route, at));
      if (at === porter.home) {
        // Back where it started, with nothing left to carry.
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
        route.porters.splice(i, 1);
        continue;
      }
      this.loadReturn(route, porter, at);
      porter.dir = porter.home === 0 ? -1 : 1;
    }
  }

  private villageAt(route: Route, end: 0 | 1): VillageId {
    return end === 0 ? route.from : route.to;
  }

  /** Sends the next trip out, from whichever end actually has something to send.
   *
   *  Taking only from `route.from` deadlocked a third of the network. Which village a
   *  pair records as `from` is decided by the order the seed grid emits them, and about a
   *  third of villages are workshops that make nothing until their input arrives — so a
   *  route whose `from` was a workshop and whose `to` made exactly what it needed could
   *  never start: the outbound trip wanted stock the workshop could not have until the
   *  return leg of that same trip delivered it. A road is a line between two villages,
   *  not a pipe with a direction, and now it behaves like one. */
  private dispatch(route: Route): void {
    if (route.porters.length >= portersFor(route.length)) return;
    // Keep them strung out along the road instead of leaving in a bunch, whichever end
    // they set out from.
    if (route.porters.some((p) => Math.abs(p.t - p.home) < PORTER_SPACING)) return;
    for (const end of this.legsOf(route)) {
      const cargo = this.registry.takeStock(this.villageAt(route, end), this.loadOf(route));
      if (cargo <= 0) continue;
      const good = this.registry.get(this.villageAt(route, end))?.produces ?? route.good;
      route.porters.push({
        t: end,
        home: end,
        dir: end === 0 ? 1 : -1,
        good,
        cargo,
        mobId: null,
      });
      return;
    }
  }

  /** The two ends, the one worth loading first. A village whose goods the far end is
   *  actually asking for goes before one whose goods it merely tolerates; `from` breaks
   *  the tie, so a plain pair behaves exactly as it always did. */
  private legsOf(route: Route): (0 | 1)[] {
    const from = this.registry.get(route.from);
    const to = this.registry.get(route.to);
    const outWanted = from && to ? to.needs.includes(from.produces) : false;
    const backWanted = from && to ? from.needs.includes(to.produces) : false;
    if (backWanted && !outWanted) return [1, 0];
    return [0, 1];
  }

  /** Hands over whatever this porter is carrying. */
  private arrive(route: Route, porter: Porter, to: VillageId): void {
    if (porter.cargo <= 0) return;
    const result = this.registry.deliver(to, porter.good, porter.cargo);
    route.delivered += porter.cargo;
    route.trips += 1;
    this.events.onArrival?.({
      route,
      to,
      good: porter.good,
      count: porter.cargo,
      needed: result.needed,
      pay: payFor(route.direct, porter.cargo, result.needed),
    });
    if (result.stage !== null) this.events.onStageUp?.(to, result.stage);
    porter.cargo = 0;
  }

  /** Loads the trip home from the far end `at`. A porter only carries back what its own
   *  village actually wants, which is what makes a complementary pair worth joining. */
  private loadReturn(route: Route, porter: Porter, at: 0 | 1): void {
    const here = this.registry.get(this.villageAt(route, at));
    const home = this.registry.get(this.villageAt(route, porter.home));
    if (!here || !home || !home.needs.includes(here.produces)) return;
    const loaded = this.registry.takeStock(here.id, this.loadOf(route));
    if (loaded <= 0) return;
    porter.good = here.produces;
    porter.cargo = loaded;
  }

  /** World position at a point along the route. */
  pointAt(route: Route, t: number): RoadPoint | null {
    if (route.waypoints.length === 0) return null;
    const target = Math.max(0, Math.min(1, t)) * route.length;
    for (let i = 1; i < route.cumulative.length; i++) {
      if (route.cumulative[i] < target) continue;
      const span = route.cumulative[i] - route.cumulative[i - 1] || 1;
      const f = (target - route.cumulative[i - 1]) / span;
      const a = route.waypoints[i - 1];
      const b = route.waypoints[i];
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        y: Math.round(a.y + (b.y - a.y) * f),
      };
    }
    return route.waypoints[route.waypoints.length - 1];
  }

  /** Shows the porter when the player is close enough to see it, and stops bothering
   *  when they are not. The mob is a view of the shipment and never the other way round:
   *  it is walked towards where the shipment has got to, and put back on the road if it
   *  falls behind. */
  private syncMob(route: Route, porter: Porter, playerX: number, playerZ: number): void {
    if (!this.host) return;
    const here = this.pointAt(route, porter.t);
    if (!here) return;
    const near = Math.hypot(here.x - playerX, here.z - playerZ) <= PORTER_VISIBLE;

    if (porter.mobId !== null) {
      const position = this.host.porterPosition(porter.mobId);
      if (!position) {
        // Despawned by distance, or killed. The shipment carries on unseen.
        porter.mobId = null;
        return;
      }
      if (!near) {
        this.host.removePorter(porter.mobId);
        porter.mobId = null;
        return;
      }
      this.host.movePorter(porter.mobId, here, this.speedOf(route));
      return;
    }

    if (!near) return;
    porter.mobId = this.host.spawnPorter(here, route.vehicle);
  }

  /** Only the pair matters. The road itself lives in the edits, so a route re-surveys
   *  itself from the save with no geometry stored. */
  toJSON(): SavedRoute[] {
    return this.routes.map((r) => ({ from: r.from, to: r.to }));
  }

  loadJSON(data: SavedRoute[] | undefined): void {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (typeof entry?.from !== 'string' || typeof entry?.to !== 'string') continue;
      this.requestRoute(entry.from, entry.to);
    }
  }
}
