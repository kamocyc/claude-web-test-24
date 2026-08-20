/** Goods moving between villages.
 *
 *  The abstract clock is the truth: a shipment is a number between 0 and 1 that advances
 *  at a fixed rate, and it keeps advancing whether or not anybody is watching. The porter
 *  walking the road is the *view* of that number. When the player is close enough the mob
 *  drives the number (so a porter never teleports past you); when they walk away the mob
 *  is dropped and the number carries on by itself. */

import { toWaypoints, type RoadNetwork, type RoadPoint, type SurveyResult } from './roads';
import type { GoodId, VillageId, VillageRegistry } from './villages';

/** Blocks per second of abstract progress. */
export const PORTER_SPEED = 3.2;
/** Goods moved by one trip. */
export const SHIPMENT = 2;
/** How close the player must be for a porter to be worth drawing. The mob manager's own
 *  96 block despawn then cleans it up, which is why nothing here has to fight it. */
export const PORTER_VISIBLE = 64;
/** One porter per route keeps the mob count flat however much road exists. */
export const PORTERS_PER_ROUTE = 1;
/** Seconds between attempts to survey a road that is not connected yet. */
export const RESURVEY_INTERVAL = 2;

export interface Porter {
  /** 0 at the origin, 1 at the destination. */
  t: number;
  dir: 1 | -1;
  cargo: number;
  mobId: number | null;
}

export interface Route {
  from: VillageId;
  to: VillageId;
  good: GoodId;
  connected: boolean;
  /** Trimmed to the corners, so a porter is not handed a point per block. */
  waypoints: RoadPoint[];
  /** Cumulative distance along `waypoints`, same length. */
  cumulative: number[];
  length: number;
  /** Straight-line distance still to be paved, when not connected. */
  missing: number;
  gapFrom: RoadPoint | null;
  gapTo: RoadPoint | null;
  porters: Porter[];
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

export interface TransportEvents {
  onConnected?(route: Route): void;
  onDisconnected?(route: Route): void;
  onArrival?(route: Route, good: GoodId, count: number): void;
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
      connected: false,
      waypoints: [],
      cumulative: [],
      length: 0,
      missing: Infinity,
      gapFrom: null,
      gapTo: null,
      porters: [],
    };
    this.routes.push(route);
    // Survey straight away so the panel has something true to show this frame.
    this.surveyedRevision = -1;
    return route;
  }

  find(from: VillageId, to: VillageId): Route | undefined {
    return this.routes.find(
      (r) => (r.from === from && r.to === to) || (r.from === to && r.to === from),
    );
  }

  update(dt: number, playerX: number, playerZ: number): void {
    this.surveyTimer -= dt;
    if (this.surveyTimer <= 0) {
      this.surveyTimer = RESURVEY_INTERVAL;
      if (this.surveyedRevision !== this.roads.revision) {
        this.surveyedRevision = this.roads.revision;
        for (const route of this.routes) this.resurvey(route);
      }
    }
    for (const route of this.routes) this.advance(route, dt, playerX, playerZ);
  }

  /** Re-walks a route's road. Only called when the road actually changed. */
  private resurvey(route: Route): void {
    const from = this.registry.get(route.from);
    const to = this.registry.get(route.to);
    if (!from || !to) return;
    route.good = from.produces;
    const result: SurveyResult = this.roads.survey(from, to);
    const was = route.connected;
    if (result.connected) {
      route.connected = true;
      route.waypoints = toWaypoints(result.waypoints);
      const measured = measure(route.waypoints);
      route.cumulative = measured.cumulative;
      route.length = Math.max(1, measured.length);
      route.missing = 0;
      route.gapFrom = null;
      route.gapTo = null;
      if (!was) this.events.onConnected?.(route);
      return;
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
  }

  private advance(route: Route, dt: number, playerX: number, playerZ: number): void {
    if (!route.connected) return;

    if (route.porters.length < PORTERS_PER_ROUTE) {
      const loaded = this.registry.takeStock(route.from, SHIPMENT);
      if (loaded > 0) route.porters.push({ t: 0, dir: 1, cargo: loaded, mobId: null });
    }

    const step = (dt * PORTER_SPEED) / route.length;
    for (let i = route.porters.length - 1; i >= 0; i--) {
      const porter = route.porters[i];
      this.syncMob(route, porter, playerX, playerZ);
      // A visible porter walks itself; syncMob has already moved `t` to where it got to.
      if (porter.mobId === null) porter.t += step * porter.dir;

      if (porter.dir === 1 && porter.t >= 1) {
        porter.t = 1;
        this.deliver(route, porter);
        porter.dir = -1;
      } else if (porter.dir === -1 && porter.t <= 0) {
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
        route.porters.splice(i, 1);
      }
    }
  }

  private deliver(route: Route, porter: Porter): void {
    if (porter.cargo <= 0) return;
    const stage = this.registry.addPoints(route.to, porter.cargo);
    this.events.onArrival?.(route, route.good, porter.cargo);
    if (stage !== null) this.events.onStageUp?.(route.to, stage);
    porter.cargo = 0;
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

  /** Progress of a world position along the route, by nearest waypoint. */
  private progressOf(route: Route, x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < route.waypoints.length; i++) {
      const w = route.waypoints[i];
      const distance = Math.hypot(w.x - x, w.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return route.length === 0 ? 0 : route.cumulative[best] / route.length;
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
