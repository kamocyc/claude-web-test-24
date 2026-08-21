/** Goods moving between villages.
 *
 *  The abstract clock is the truth: a shipment is a number between 0 and 1 that advances
 *  at a fixed rate, and it keeps advancing whether or not anybody is watching. The porter
 *  walking the road is the *view* of that number. When the player is close enough the mob
 *  drives the number (so a porter never teleports past you); when they walk away the mob
 *  is dropped and the number carries on by itself.
 *
 *  What the road is paved with sets both how fast that number moves and how much one trip
 *  carries, so a line the player comes back to and improves keeps paying more. And a
 *  porter only walks home empty when there is nothing at the far end worth bringing
 *  back — a pair of villages that each want what the other makes is worth twice the
 *  road. */

import { roadGrade, toWaypoints, type RoadNetwork, type RoadPoint, type SurveyResult } from './roads';
import type { GoodId, VillageId, VillageRegistry } from './villages';

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

/** Goods one trip carries on a road of the given quality. */
export function loadFor(quality: number): number {
  return Math.max(1, Math.round(BASE_LOAD + (quality - 1) * 6));
}

/** Porters a route is worth running. */
export function portersFor(length: number): number {
  return Math.max(1, Math.min(MAX_PORTERS, 1 + Math.floor(length / BLOCKS_PER_PORTER)));
}

/** The player's cut of a delivery: paid by the load, the distance, and by whether the
 *  goods were actually wanted where they went. */
export function payFor(length: number, count: number, needed: boolean): number {
  return Math.max(1, Math.round((count * length * (needed ? 1.5 : 1)) / PAY_DISTANCE));
}

export interface Porter {
  /** 0 at the origin, 1 at the destination. */
  t: number;
  dir: 1 | -1;
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
  /** Trimmed to the corners, so a porter is not handed a point per block. */
  waypoints: RoadPoint[];
  /** Cumulative distance along `waypoints`, same length. */
  cumulative: number[];
  length: number;
  /** Weighted speed factor of the pavement, and what to call it. */
  quality: number;
  grade: string;
  /** Straight-line distance still to be paved, when not connected. */
  missing: number;
  gapFrom: RoadPoint | null;
  gapTo: RoadPoint | null;
  porters: Porter[];
  /** Running totals, for the ledger. */
  delivered: number;
  trips: number;
}

export interface SavedRoute {
  from: string;
  to: string;
}

/** What the game hands transport so it can show a porter. Kept narrow so the simulation
 *  itself has no idea mobs exist. */
export interface PorterHost {
  spawnPorter(point: RoadPoint, waypoints: RoadPoint[], startIndex: number): number | null;
  porterPosition(mobId: number): { x: number; z: number } | null;
  removePorter(mobId: number): void;
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

  constructor(
    private readonly roads: RoadNetwork,
    private readonly registry: VillageRegistry,
    private readonly events: TransportEvents = {},
    private readonly host: PorterHost | null = null,
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
      cumulative: [],
      length: 0,
      quality: 1,
      grade: roadGrade(1),
      missing: 0,
      gapFrom: null,
      gapTo: null,
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

  find(from: VillageId, to: VillageId): Route | undefined {
    return this.routes.find(
      (r) => (r.from === from && r.to === to) || (r.from === to && r.to === from),
    );
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
    for (const route of this.routes) this.advance(route, dt, playerX, playerZ);
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
      route.waypoints = toWaypoints(result.waypoints);
      const measured = measure(route.waypoints);
      route.cumulative = measured.cumulative;
      route.length = Math.max(1, measured.length);
      route.quality = result.quality;
      route.grade = roadGrade(result.quality);
      route.missing = 0;
      route.gapFrom = null;
      route.gapTo = null;
      if (!was) this.events.onConnected?.(route);
      return true;
    }
    route.connected = false;
    route.missing = result.missing;
    route.gapFrom = result.frontierFrom;
    route.gapTo = result.frontierTo;
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

  /** Speed in blocks per second, and the load one trip carries. */
  speedOf(route: Route): number {
    return PORTER_SPEED * route.quality;
  }

  loadOf(route: Route): number {
    return loadFor(route.quality);
  }

  private advance(route: Route, dt: number, playerX: number, playerZ: number): void {
    if (!route.connected) return;

    this.dispatch(route);

    const step = (dt * this.speedOf(route)) / route.length;
    for (let i = route.porters.length - 1; i >= 0; i--) {
      const porter = route.porters[i];
      this.syncMob(route, porter, playerX, playerZ);
      // A visible porter walks itself; syncMob has already moved `t` to where it got to.
      if (porter.mobId === null) porter.t += step * porter.dir;

      if (porter.dir === 1 && porter.t >= 1) {
        porter.t = 1;
        this.arrive(route, porter, route.to);
        this.loadReturn(route, porter);
        porter.dir = -1;
      } else if (porter.dir === -1 && porter.t <= 0) {
        porter.t = 0;
        this.arrive(route, porter, route.from);
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
        route.porters.splice(i, 1);
      }
    }
  }

  /** Sends the next porter out, if the line has room for one and there is anything to
   *  put on it. */
  private dispatch(route: Route): void {
    if (route.porters.length >= portersFor(route.length)) return;
    // Keep them strung out along the road instead of leaving in a bunch.
    if (route.porters.some((p) => p.dir === 1 && p.t < PORTER_SPACING)) return;
    const loaded = this.registry.takeStock(route.from, this.loadOf(route));
    if (loaded <= 0) return;
    route.porters.push({ t: 0, dir: 1, good: route.good, cargo: loaded, mobId: null });
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
      pay: payFor(route.length, porter.cargo, result.needed),
    });
    if (result.stage !== null) this.events.onStageUp?.(to, result.stage);
    porter.cargo = 0;
  }

  /** Loads the trip home. A porter only carries back what the origin actually wants,
   *  which is what makes a complementary pair of villages worth joining. */
  private loadReturn(route: Route, porter: Porter): void {
    const from = this.registry.get(route.from);
    const to = this.registry.get(route.to);
    if (!from || !to || !from.needs.includes(to.produces)) return;
    const loaded = this.registry.takeStock(route.to, this.loadOf(route));
    if (loaded <= 0) return;
    porter.good = to.produces;
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

  /** The waypoint a porter at `t` is heading for. */
  private indexAt(route: Route, t: number): number {
    const target = Math.max(0, Math.min(1, t)) * route.length;
    for (let i = 1; i < route.cumulative.length; i++) {
      if (route.cumulative[i] >= target) return i;
    }
    return route.waypoints.length - 1;
  }

  /** Progress of a world position along the route.
   *
   *  This projects onto the segments rather than snapping to the nearest waypoint: the
   *  waypoints are only the corners, so a porter walking a straight road would otherwise
   *  read as 0 until it passed the midpoint and then jump to 1. */
  private progressOf(route: Route, x: number, z: number): number {
    if (route.length === 0) return 0;
    let bestDistance = Infinity;
    let bestAlong = 0;
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = route.waypoints[i - 1];
      const b = route.waypoints[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const span = dx * dx + dz * dz;
      const f = span === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / span));
      const distance = Math.hypot(a.x + dx * f - x, a.z + dz * f - z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestAlong = route.cumulative[i - 1] + (route.cumulative[i] - route.cumulative[i - 1]) * f;
    }
    return Math.max(0, Math.min(1, bestAlong / route.length));
  }

  /** Brings the visible porter into existence near the player, and retires it when the
   *  mob manager has taken it away again. */
  private syncMob(route: Route, porter: Porter, playerX: number, playerZ: number): void {
    if (!this.host) return;
    const here = this.pointAt(route, porter.t);
    if (!here) return;
    const near = Math.hypot(here.x - playerX, here.z - playerZ) <= PORTER_VISIBLE;

    if (porter.mobId !== null) {
      const position = this.host.porterPosition(porter.mobId);
      if (!position) {
        // Despawned by distance, or killed. Carry on abstractly from where it stood.
        porter.mobId = null;
        return;
      }
      if (!near) {
        this.host.removePorter(porter.mobId);
        porter.mobId = null;
        return;
      }
      const seen = this.progressOf(route, position.x, position.z);
      // Snap back if it has wandered off the road, so terrain can never strand a route.
      if (Math.hypot(position.x - here.x, position.z - here.z) > 8) {
        this.host.removePorter(porter.mobId);
        porter.mobId = null;
        return;
      }
      porter.t = porter.dir === 1 ? Math.max(porter.t, seen) : Math.min(porter.t, seen);
      return;
    }

    if (!near) return;
    const startIndex = porter.dir === 1 ? this.indexAt(route, porter.t) : this.indexAt(route, porter.t) - 1;
    const waypoints = porter.dir === 1 ? route.waypoints : [...route.waypoints].reverse();
    const index = porter.dir === 1 ? startIndex : route.waypoints.length - 1 - Math.max(0, startIndex);
    porter.mobId = this.host.spawnPorter(here, waypoints, Math.max(0, index));
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
