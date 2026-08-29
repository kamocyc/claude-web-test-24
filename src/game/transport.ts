/** Goods moving along the legs of a line.
 *
 *  Nothing moves because a road exists. A road is a road; a *service* is a line the player
 *  drew between stops they put down, and until they draw one the finest paved highway in
 *  the world carries nothing. Every leg here is one hop of one such line, and this module
 *  runs it: it surveys what actually joins the two stops, decides what that supports —
 *  somebody on foot, a cart, a train — and moves goods and people over it.
 *
 *  What it does *not* know is what a stop is attached to. A town, an industry, or nothing
 *  at all: `SiteLink` answers all of that in six methods, so this file has never heard of a
 *  village and is not going to start.
 *
 *  The abstract clock is the truth: a shipment is a number between 0 and 1 that advances
 *  at a fixed rate, and it keeps advancing whether or not anybody is watching. The porter
 *  walking the road is the *view* of that number — it is walked towards where the shipment
 *  has got to and put back on the road when it falls behind, and it is dropped entirely
 *  once the player is too far away to see it. Nothing a mob does can hold a delivery up:
 *  letting one drive the clock meant a porter caught on a doorway stopped the line for as
 *  long as somebody stood watching it.
 *
 *  The clock *can* be stopped, and by exactly one thing: another shipment holding the
 *  block of railway ahead. That is what a signal is. It is worth saying out loud which
 *  half of the old rule that leaves standing — a shipment may wait for another shipment,
 *  and a shipment may never wait for a mob. Blur the two and the porter on the doorstep
 *  stops the line again.
 *
 *  What the road is paved with sets both how fast that number moves and how much one trip
 *  carries, so a line the player comes back to and improves keeps paying more. And a
 *  porter only walks home empty when there is nothing at the far end worth bringing
 *  back — a leg whose two ends each want what the other has is worth twice the road. */

import { pathAroundPlots } from './buildings';
import type { LineId, LineNetwork, Stop } from './lines';
import { roadGrade, toWaypoints, type RoadNetwork, type RoadPoint, type SurveyPlace, type SurveyResult } from './roads';
import { PASSENGER, type GoodId } from './villages';

/** What is doing the hauling. A cart only runs where the road is three columns wide the
 *  whole way, which is the one thing widening a road buys — and the reason widening one
 *  is worth an afternoon. */
export type Vehicle = 'porter' | 'cart' | 'train';

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
/** The block id of a stretch of railway no signal bounds, which is every stretch of one
 *  nobody has signalled. Kept in step with the railway's own by hand rather than imported,
 *  because this module does not know what a railway is made of and is not going to start
 *  now — what it needs is a number that no real block ever takes, and zero is that. */
export const UNWATCHED = 0;
/** How long a shipment stands at a signal before the line is called blocked rather than
 *  busy. Long enough that a train waiting its turn at a passing loop is just traffic;
 *  short enough that somebody who has jammed a single line finds out in the same visit. */
export const STALL_WAIT = 10;
/** Emeralds paid for hauling one good over this many blocks. Deliberately modest: the
 *  network should fund the shopping, not end it. A well paved line pays a few emeralds a
 *  trip, so an afternoon of hauling buys a villager's table rather than all of them. */
export const PAY_DISTANCE = 800;
/** What a cart multiplies a trip by. Speed is left alone deliberately: pavement is what
 *  makes a road fast and width is what makes it carry, so the two jobs stay legible. */
export const CART_LOAD = 3;

/** What a train multiplies a trip by. More than a cart, and unlike a cart it comes with
 *  the speed as well — a railway is the one way the player builds out of nothing but
 *  iron, so it is the one upgrade that moves both numbers. Widening a road is still what
 *  a cart is for; this is what comes after there is nothing left to widen. */
export const TRAIN_LOAD = 4;
/** How fast a railway is, as the road quality it stands in for.
 *
 *  A railway is not a road and has no pavement to weigh: it is laid as curves in the
 *  open, and what it is worth is the same wherever it runs. So a railed route is quoted
 *  one number for the whole line, and `roadGrade` already has a word for it — 鉄路. It
 *  is the old rail block's speed, kept to the digit, because what a finished railway pays
 *  should not have changed underneath a player who had already built one. */
export const RAIL_QUALITY = 2.2;
/** Goods one wagon holds, and the most a train will ever be drawn with.
 *
 *  A railway is quoted one quality along its whole length, so a wagon is exactly what one
 *  porter's sack would have been on it — and a full train is therefore `TRAIN_LOAD`
 *  wagons, which is the multiplier the player was promised, drawn rather than written.
 *  The cap is one over that: a guard against some future load, not a rule anybody meets. */
export const WAGON_LOAD = loadFor(RAIL_QUALITY);
export const MAX_WAGONS = TRAIN_LOAD + 1;

/** Wagons a load couples up. Zero for a train running home empty, which is worth seeing:
 *  a pair of villages where only one makes what the other wants pays half of what a
 *  complementary pair does, and this is where that shows. */
export function carsFor(cargo: number): number {
  return Math.max(0, Math.min(MAX_WAGONS, Math.ceil(cargo / WAGON_LOAD)));
}

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
   *  A leg runs in both directions rather than being a one way pipe: whichever end has
   *  something to send is the end a trip starts from. */
  home: 0 | 1;
  good: GoodId;
  cargo: number;
  mobId: number | null;
  /** What the mob currently drawing this shipment was spawned as. A railed trip changes
   *  hands twice — a porter carries it out to the platform, the train takes it down the
   *  line, another porter walks it in at the far end — and this is how the view notices
   *  it has to swap one for the other. Null whenever nothing is drawing it. */
  mobVehicle: Vehicle | null;
  /** Seconds this shipment has been standing at a signal it may not pass. Zero whenever
   *  it moved, so it counts the wait it is in rather than the waits it has had. */
  held: number;
}

export interface Route {
  /** `${lineId}#${index}`. Stable while the line's calling order is, which is exactly as
   *  long as the leg itself is the same leg. */
  id: string;
  lineId: LineId;
  /** Which call of the line this leg leaves from, so the panel can list a line's legs in
   *  the order the player wrote them. */
  index: number;
  from: Stop;
  to: Stop;
  /** What travels out from `from`. The trip home carries whatever `from` wants, so this
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
  /** Where the line towards the far village runs out, on a pair somebody has started
   *  laying a railway between. Null when the rails already join the two, and null when
   *  neither village has a station at all: a beacon over every village in the world would
   *  answer a question nobody asked. */
  railPinch: RoadPoint | null;
  /** An end of the line at one of the two villages with no station on it, on a pair whose
   *  rails have arrived and are carrying nothing because of it. Null once both ends have
   *  one, and null where there is no track to build a station on. */
  stationGap: RoadPoint | null;
  /** The stretch of the trip that is on rails, as two fractions of the whole. Null on a
   *  route the railway does not carry. What it is for is the view: the goods are hauled
   *  out to the platform and in at the far end by somebody on foot, and only the middle
   *  of the journey is a train. */
  railSpan: { from: number; to: number } | null;
  /** Where along the trip the block of railway changes, as fractions of `length` — the
   *  same units `porter.t` is in, and for the same reason `railSpan` is. Empty on a route
   *  no signal watches, which is every route in a world where nobody has built one. */
  sections: { at: number; id: number }[];
  /** The signal a shipment on this route has been stuck at for longer than `STALL_WAIT`,
   *  and null the rest of the time.
   *
   *  Two trains nose to nose on a single line each hold the block the other is waiting
   *  for, and neither ever moves again. That is left to happen on purpose: the railway is
   *  the player's, and a game that quietly untangled it would be teaching them nothing
   *  about why the siding they did not build was worth building. What it must not be is
   *  silent, so this is what the yellow light and the note on the panel are made of. */
  stall: RoadPoint | null;
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

/** One load. */
export interface Cargo {
  good: GoodId;
  count: number;
}

/** What a stop is attached to, as the only questions a leg has of it.
 *
 *  Narrow and duck typed, exactly like `RailSource` below: the game answers these from its
 *  towns and its industries, a test answers them from two object literals, and this module
 *  never learns that either exists. A stop attached to nothing answers "nothing" to all six
 *  and is simply a place a line passes through — which is a real and useful thing to be:
 *  a junction where two lines meet. */
export interface SiteLink {
  /** What this place has to send. Empty for a stop that serves nothing. */
  offers(at: Stop): readonly GoodId[];
  /** What this place is asking for. */
  wants(at: Stop): readonly GoodId[];
  /** Whether anything unloaded here lands somewhere.
   *
   *  A town takes whatever arrives — what it did not ask for is worth less and is still
   *  worth something. An industry and a bare junction take nothing, and a trip that ended
   *  at one would be a trip whose cargo stopped existing, so no trip is ever sent to one
   *  carrying anything. */
  accepts(at: Stop): boolean;
  /** Loads up to `capacity`, preferring anything on `wanted`. Null when there is nothing
   *  worth loading. */
  load(at: Stop, capacity: number, wanted: readonly GoodId[]): Cargo | null;
  /** Loads people wanting to travel. A separate question because people are never the
   *  first answer: freight fills a trip and people take what is left. */
  loadPeople(at: Stop, capacity: number): number;
  /** Hands a load over, and says what it was worth. */
  unload(at: Stop, good: GoodId, count: number): { needed: boolean; stage: number | null };
  /** Puts a load back when the trip never happened. */
  restore(at: Stop, good: GoodId, count: number): void;
  /** The doorway goods actually go through, where the place has one. Null for a stop out
   *  in the country, whose doorway is the stop itself. */
  door(at: Stop): RoadPoint | null;
  /** Footprints to walk round rather than through, on the way to that doorway. */
  plots(at: Stop): readonly { x0: number; z0: number; w: number; d: number }[];
  /** Where the road survey runs from. */
  place(at: Stop): SurveyPlace;
}

/** A line of rails as something freight can travel. Whatever shape the curves are is the
 *  railway's business, not this module's; the length is measured off the points here, the
 *  same way a road's is, so that the walk to the door counts once and in one place. */
export interface RailWay {
  points: RoadPoint[];
  /** Blocks of up and down along it. Not derivable from the points to any accuracy worth
   *  having: they are samples of a curve, and the sag between two of them is real. */
  climb: number;
  /** Where along `points` the block of railway changes, and to which. Empty on a line no
   *  signal bounds, and absent entirely from a `RailSource` that has never heard of
   *  signals — a test that hands over four points and a length still works.
   *
   *  This is the whole of what this module learns about the graph. It never sees a node,
   *  a switch or a curve: a block is an opaque number, two shipments may not hold the
   *  same one, and that is the entire rule. */
  sections?: { at: number; id: number }[];
}

/** The railway, as the only two questions transport has to ask of it.
 *
 *  Narrow on purpose, and duck typed like `DepotSource`: this module has never known what
 *  a road block is, and it is not about to learn what a biarc is either. The game passes
 *  its `TrackNetwork`; a test passes four points and a length. */
export interface RailSource {
  /** The rails from one place to the other, when they join the two. */
  wayBetween(from: RoadPoint, to: RoadPoint): RailWay | null;
  /** Where a line setting out from one towards the other runs out, when one has been
   *  started. Null when there is no track near `from` at all. */
  railheadTowards(from: RoadPoint, to: RoadPoint): RoadPoint | null;
  /** An end of the line at a place that has no station, when the rails are there and the
   *  station is not. Null once one serves the place, and null where there is no track. */
  stationGapAt(place: RoadPoint): RoadPoint | null;
  /** Bumped whenever the rails move. Without it a railway laid or pulled up would not be
   *  noticed until somebody happened to touch a road block: the survey is skipped
   *  entirely while nothing it has looked at has changed. */
  revision(): number;
}

/** What the game hands transport so it can show a porter. Kept narrow so the simulation
 *  itself has no idea mobs exist. */
export interface PorterHost {
  /** `cargo` is how much this trip is carrying, which is how many wagons a train couples
   *  up. Zero is a real answer: a train running home with nothing is a locomotive on its
   *  own, and a line that only pays one way should look like one.
   *
   *  `good` is what it is carrying, and the only thing the view does with it is decide
   *  whether those cars are wagons or coaches. A train full of people that looked like a
   *  goods train would make the one visible difference between the two invisible. */
  spawnPorter(point: RoadPoint, vehicle: Vehicle, cargo: number, good: GoodId): number | null;
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
  /** What is carrying it *here*, which on a railed route is a train in the middle and
   *  somebody on foot at either end. See `vehicleAt`. */
  vehicle: Vehicle;
  /** Whether a mob is currently drawing this one. */
  visible: boolean;
}

/** One delivery, as the game needs to report it. */
export interface Arrival {
  route: Route;
  to: Stop;
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
  onStageUp?(at: Stop, stage: number): void;
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
  private readonly byId = new Map<string, Route>();
  private surveyTimer = 0;
  private surveyedRevision = -1;
  private surveyedRails = -1;
  /** Where the round robin over routes starts this update. */
  private dispatchCursor = 0;
  /** Which shipment is holding each watched block of railway.
   *
   *  One map for the whole network and not one per route, because that is the entire
   *  point of a junction: two lines that share a stretch of rail have to share the
   *  occupancy of it too, or a signal would only ever hold up the line it stands on.
   *
   *  Rebuilt from where the shipments actually are at the top of every update rather than
   *  kept in step by hand. There are half a dozen ways a shipment stops existing — it
   *  arrives, its road is dug up, its route stops being a railway — and a claim leaked by
   *  any one of them would wedge a block shut for the rest of the session with nothing on
   *  the line to show for it. */
  private readonly holding = new Map<number, Porter>();

  constructor(
    private readonly roads: RoadNetwork,
    private readonly sites: SiteLink,
    private readonly events: TransportEvents = {},
    private readonly host: PorterHost | null = null,
    private readonly rails: RailSource | null = null,
  ) {}

  /** Rebuilds the legs from the lines the player has drawn.
   *
   *  Called whenever the network's revision moves, which is whenever a stop or a call
   *  changes. A leg that is still the same leg keeps everything it had — its shipments, its
   *  totals, the road it was surveyed onto — because inserting a call at the end of a line
   *  should not throw away the trips already running on the rest of it. A leg that has gone
   *  hands its cargo back before it does. */
  syncLines(network: LineNetwork): void {
    const kept = new Map<string, Route>();
    for (const line of network.lines.values()) {
      network.legsOf(line.id).forEach((leg, index) => {
        const id = `${line.id}#${index}`;
        const existing = this.byId.get(id);
        // Same id, same two stops: the same leg, carrying on where it was.
        if (existing && existing.from.id === leg.from.id && existing.to.id === leg.to.id) {
          existing.index = index;
          existing.from = leg.from;
          existing.to = leg.to;
          kept.set(id, existing);
          return;
        }
        kept.set(id, this.blankRoute(id, line.id, index, leg.from, leg.to));
      });
    }
    let changed = kept.size !== this.routes.length;
    for (const route of this.routes) {
      if (kept.get(route.id) === route) continue;
      changed = true;
      // A leg that has stopped existing was still carrying something. Put it back rather
      // than losing it: editing a line should cost time, not cargo.
      for (const porter of route.porters) {
        if (porter.cargo > 0) this.returnLoad(route, porter);
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
      }
    }
    if (!changed) return;
    this.routes.length = 0;
    this.byId.clear();
    for (const [id, route] of kept) {
      this.routes.push(route);
      this.byId.set(id, route);
    }
    // Survey on the very next update, so the panel never shows a stale or invented
    // distance for a leg the player has just drawn.
    this.invalidate();
  }

  private blankRoute(id: string, lineId: LineId, index: number, from: Stop, to: Stop): Route {
    return {
      id,
      lineId,
      index,
      from,
      to,
      good: '',
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
      railPinch: null,
      stationGap: null,
      railSpan: null,
      sections: [],
      stall: null,
      doorGap: 0,
      missing: 0,
      gapFrom: null,
      gapTo: null,
      nearMiss: null,
      porters: [],
      delivered: 0,
      trips: 0,
    };
  }

  /** Forces the next update to walk every road again. The road index has not moved, so
   *  nothing else would notice — but where a route *ends* has, and that is the same thing
   *  as far as its waypoints are concerned. */
  invalidate(): void {
    this.surveyedRevision = -1;
    this.surveyedRails = -1;
    this.surveyTimer = 0;
  }

  find(id: string): Route | undefined {
    return this.byId.get(id);
  }

  /** Every leg of one line, in calling order. What the line panel is drawn from. */
  legsOfLine(lineId: LineId): Route[] {
    return this.routes.filter((route) => route.lineId === lineId).sort((a, b) => a.index - b.index);
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
          vehicle: this.vehicleAt(route, porter.t),
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
      const roadsAt = this.roads.revision;
      const railsAt = this.rails?.revision() ?? 0;
      if (this.surveyedRevision !== roadsAt || this.surveyedRails !== railsAt) {
        let complete = true;
        for (const route of this.routes) {
          if (!this.resurvey(route)) complete = false;
        }
        // A route restored from a save is surveyed before the player has walked near
        // enough for its villages to be re-derived from the seed. Marking the revision
        // done there would leave the route stuck until somebody moved a road block, so
        // the attempt only counts once every route could actually be walked.
        if (complete) {
          this.surveyedRevision = roadsAt;
          this.surveyedRails = railsAt;
        }
      }
    }
    this.reblock();
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

  /** Re-walks a leg's road. Returns false when the survey could not be attempted at all.
   *
   *  Which it never is now: a stop carries its own position, so a leg is walkable from the
   *  moment it is drawn — even one whose town the player has not walked back into. The
   *  return value is kept because the caller uses it to decide whether the survey it just
   *  did counts against the road revision. */
  private resurvey(route: Route): boolean {
    route.good = this.sites.offers(route.from)[0] ?? route.good;
    const was = route.connected;
    route.surveyed = true;
    // The doors first, whatever answers: the railway is surveyed door to door, and the
    // road survey wants them the moment it connects. The stop itself stands in for a door
    // that is not known yet, which is every town the player has not walked into.
    route.fromDoor = this.sites.door(route.from);
    route.toDoor = this.sites.door(route.to);
    const doors = {
      from: route.fromDoor ?? stopPoint(route.from),
      to: route.toDoor ?? stopPoint(route.to),
    };
    // The railway is asked about the stops themselves and not about their doors. A line
    // that reaches the stop has arrived; requiring it to reach the door would mean laying
    // track between the houses, and a station is a place at the edge of a town in every
    // world including this one.
    const places = { from: stopPoint(route.from), to: stopPoint(route.to) };

    // The railway is asked first, and it is not asked about the road. It is its own way
    // between the two stops — laid in the open, over whatever is in between — so a leg
    // with rails along it is joined whether or not anybody ever paved anything.
    const way = this.rails?.wayBetween(places.from, places.to) ?? null;
    if (way) {
      this.railed(route, way, doors, was);
      return true;
    }

    const result: SurveyResult = this.roads.survey(this.sites.place(route.from), this.sites.place(route.to));
    if (result.connected) {
      route.connected = true;
      route.everConnected = true;
      // The survey walks street to street; the last few blocks at each end are the walk
      // between that street and the door goods actually go through. Those count towards
      // the trip, which is what makes a 集荷所 by the road worth choosing.
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
      this.setVehicle(route, result.cart.ok ? 'cart' : 'porter');
      route.cartPinch = result.cart.ok ? null : result.cart.pinch;
      // A road that carries the goods today, and a railway somebody has started and not
      // finished. Saying where that one stops is the whole of what the old violet beacon
      // was for, and it is worth more now: the rails do not have to follow this road.
      route.railPinch = this.railhead(places);
      route.stationGap = this.stationGap(places);
      route.railSpan = null;
      route.sections = [];
      route.stall = null;
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
    route.railPinch = this.railhead(places);
    route.stationGap = this.stationGap(places);
    route.railSpan = null;
    route.sections = [];
    route.stall = null;
    this.setVehicle(route, 'porter');
    if (was) {
      // The road was broken while goods were on it. Send them home rather than losing
      // them; a road being dug up should cost time, not cargo.
      for (const porter of route.porters) {
        if (porter.cargo > 0) this.returnLoad(route, porter);
        if (porter.mobId !== null) this.host?.removePorter(porter.mobId);
      }
      route.porters.length = 0;
      route.waypoints = [];
      route.cumulative = [];
      this.events.onDisconnected?.(route);
    }
    return true;
  }


  /** Fills a route in from the rails.
   *
   *  Nothing about the road is read here, and that is the point: the length, the climb
   *  and the way the goods go are the railway's, and the quality is the one number a
   *  railway has. A line that crosses a gorge on piers is exactly as good as one on flat
   *  ground, which is the opposite of how a road works and the reason to build one. */
  private railed(route: Route, way: RailWay, doors: { from: RoadPoint; to: RoadPoint }, was: boolean): void {
    route.connected = true;
    route.everConnected = true;
    const lead = this.walkToStation(route.from, route.fromDoor, way.points[0]);
    const trail = this.walkToStation(route.to, route.toDoor, way.points[way.points.length - 1]);
    route.waypoints = [...lead.points, ...way.points, ...trail.points.reverse()];
    const railFirst = lead.points.length;
    const railLast = railFirst + way.points.length - 1;
    // The walk from the door to the station, exactly as a road route charges the walk
    // from the door to the road. A railway that stops at the edge of the village is a
    // railway with a walk on the end of it, and the panel should say so.
    route.doorGap = Math.max(lead.gap, trail.gap);
    const measured = measure(route.waypoints);
    route.cumulative = measured.cumulative;
    route.length = Math.max(1, measured.length);
    route.quality = RAIL_QUALITY;
    route.grade = roadGrade(RAIL_QUALITY);
    route.climb = way.climb;
    route.direct = Math.max(1, Math.hypot(doors.to.x - doors.from.x, doors.to.z - doors.from.z));
    route.detour = route.length / route.direct;
    this.setVehicle(route, 'train');
    // Which part of the trip the train does. The rest of it is somebody walking the goods
    // between the depot's door and the platform, which is what the walk charged above
    // actually looks like from the outside.
    route.railSpan = {
      from: (route.cumulative[railFirst] ?? 0) / route.length,
      to: (route.cumulative[railLast] ?? route.length) / route.length,
    };
    // The blocks, in the same units and by the same arithmetic. The walk at each end is
    // part of the trip but no part of any block: the first boundary is moved back to the
    // doorstep so that a shipment which has not reached the platform yet is already
    // holding the block it is about to enter, rather than claiming it at the last moment
    // with the train already rolling.
    route.sections = way.sections?.map((mark, i) => ({
      at: i === 0 ? 0 : (route.cumulative[railFirst + mark.at] ?? 0) / route.length,
      id: mark.id,
    })) ?? [];
    route.stall = null;
    route.cartPinch = null;
    route.railPinch = null;
    route.stationGap = null;
    route.missing = 0;
    route.gapFrom = null;
    route.gapTo = null;
    route.nearMiss = null;
    if (!was) this.events.onConnected?.(route);
  }

  /** The walk from a depot's door out to the end of the line, going round the houses
   *  rather than through them. Its points stop short of the station itself, which the
   *  rails already hold. */
  private walkToStation(
    stop: Stop,
    door: RoadPoint | null,
    station: RoadPoint,
  ): { points: RoadPoint[]; gap: number } {
    if (!door) return { points: [], gap: 0 };
    const near = { x: Math.round(station.x), y: Math.round(station.y), z: Math.round(station.z) };
    const round = pathAroundPlots(door, near, this.sites.plots(stop));
    if (!round) return { points: [door], gap: Math.hypot(near.x - door.x, near.z - door.z) };
    let walk = 0;
    for (let i = 1; i < round.length; i++) {
      walk += Math.hypot(round[i].x - round[i - 1].x, round[i].z - round[i - 1].z);
    }
    return { points: toWaypoints(round.slice(0, -1)), gap: walk };
  }

  /** Where the railway between two villages stops, when one has been started and does not
   *  reach. Either end may be the one somebody has been laying from. */
  private railhead(places: { from: RoadPoint; to: RoadPoint }): RoadPoint | null {
    if (!this.rails) return null;
    return this.rails.railheadTowards(places.from, places.to)
      ?? this.rails.railheadTowards(places.to, places.from);
  }

  /** The end of the line to build a station on, when the rails have arrived at one of the
   *  two villages and nothing there puts freight on them.
   *
   *  `from` first, and only one at a time: two beacons for one job would read as two jobs,
   *  and a player who builds the near one is told about the far one the moment they have. */
  private stationGap(places: { from: RoadPoint; to: RoadPoint }): RoadPoint | null {
    if (!this.rails) return null;
    return this.rails.stationGapAt(places.from) ?? this.rails.stationGapAt(places.to);
  }

  /** Changes what hauls a route, dropping any mob that is now the wrong shape. The next
   *  frame draws the right ones where the shipments actually are, and no cargo moves. */
  private setVehicle(route: Route, vehicle: Vehicle): void {
    if (vehicle === route.vehicle) return;
    for (const porter of route.porters) {
      if (porter.mobId === null) continue;
      this.host?.removePorter(porter.mobId);
      porter.mobId = null;
      porter.mobVehicle = null;
    }
    route.vehicle = vehicle;
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
    stop: Stop,
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
      : pathAroundPlots(door, edge, this.sites.plots(stop));
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
    const multiplier =
      route.vehicle === 'train' ? TRAIN_LOAD : route.vehicle === 'cart' ? CART_LOAD : 1;
    return loadFor(route.quality) * multiplier;
  }

  /** What is carrying the goods at a point along the trip.
   *
   *  Only the view differs from `route.vehicle`, never the economy: a railed line is worth
   *  a train's load at a train's speed for the whole of its length, including the walk at
   *  each end, exactly as it was before there was anything to see. What this decides is
   *  what the player watches — a porter carrying crates out of the village to the
   *  platform, a train taking them down the line, and a porter walking them in at the
   *  other end. The change of hands *is* the loading; there is no separate wait for it. */
  vehicleAt(route: Route, t: number): Vehicle {
    const span = route.railSpan;
    if (!span) return route.vehicle;
    return t >= span.from && t <= span.to ? 'train' : 'porter';
  }

  /** The blocks of railway that have a shipment in them, as of the last update.
   *
   *  What the lamps on the signals are lit from. A signal shows red when the block on the
   *  other side of it is in here — which is the same question a shipment asks before it
   *  crosses, so the light is never telling the player something different from what the
   *  railway is doing. */
  busySections(): ReadonlySet<number> {
    return new Set(this.holding.keys());
  }

  /** Which block of railway a point along a route is in, and `UNWATCHED` where no signal
   *  bounds it. The boundaries are in order, so this is the last one already passed. */
  sectionAt(route: Route, t: number): number {
    let id = UNWATCHED;
    for (const mark of route.sections) {
      if (mark.at > t) break;
      id = mark.id;
    }
    return id;
  }

  /** Re-reads which shipment holds which block, and reports whichever route has had one
   *  standing at a signal long enough to call it stuck.
   *
   *  Where two shipments are already inside one watched block — a signal built under a
   *  train that was halfway past it — one of them holds it and the other is simply not
   *  recorded. That is deliberate: neither is asked to leave, and the one not holding it
   *  is free to carry on to the far end, which is the only way out of a situation nobody
   *  could have avoided making. */
  private reblock(): void {
    this.holding.clear();
    for (const route of this.routes) {
      let stall: RoadPoint | null = null;
      for (const porter of route.porters) {
        const id = this.sectionAt(route, porter.t);
        if (id !== UNWATCHED && !this.holding.has(id)) this.holding.set(id, porter);
        if (porter.held < STALL_WAIT || stall) continue;
        stall = this.pointAt(route, porter.t);
      }
      route.stall = stall;
    }
  }

  /** Whether a shipment may move to where it is about to be.
   *
   *  Only the crossing matters. A shipment already inside a block stays free to move
   *  about in it however long somebody else has been recorded as holding it, and a
   *  shipment that is not crossing a boundary is never asked anything at all — which is
   *  what makes an unsignalled railway, where there are no boundaries, cost nothing. */
  private clearAhead(route: Route, porter: Porter, next: number): boolean {
    if (route.sections.length === 0) return true;
    const here = this.sectionAt(route, porter.t);
    const want = this.sectionAt(route, next);
    if (want === here || want === UNWATCHED) return true;
    const held = this.holding.get(want);
    if (held && held !== porter) return false;
    // Taken now rather than at the top of the next update, so two shipments a step apart
    // on the same line do not both walk into the block in the same frame.
    this.holding.set(want, porter);
    if (this.holding.get(here) === porter) this.holding.delete(here);
    return true;
  }

  private advance(route: Route, dt: number, playerX: number, playerZ: number): void {
    if (!route.connected) return;

    this.dispatch(route);

    const step = (dt * this.speedOf(route)) / route.length;
    for (let i = route.porters.length - 1; i >= 0; i--) {
      const porter = route.porters[i];
      // The clock is the truth, watched or not. Letting the mob drive it instead meant a
      // porter snagged on a doorway stopped the whole line for as long as the player
      // stood there — which is exactly when they were looking. The one thing that may
      // stop it is the block ahead being somebody else's.
      if (!this.clearAhead(route, porter, porter.t + step * porter.dir)) {
        porter.held += dt;
        this.syncMob(route, porter, playerX, playerZ);
        continue;
      }
      porter.held = 0;
      porter.t += step * porter.dir;
      this.syncMob(route, porter, playerX, playerZ);

      const at = porter.t >= 1 ? 1 : porter.t <= 0 ? 0 : null;
      if (at === null) continue;
      porter.t = at;
      this.arrive(route, porter, this.stopAt(route, at));
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

  private stopAt(route: Route, end: 0 | 1): Stop {
    return end === 0 ? route.from : route.to;
  }

  /** Sends a load that never arrived back where it set out from. A road being dug up
   *  should cost time, not cargo — and not people either: somebody halfway to a town they
   *  wanted to reach goes back to waiting at the station rather than ceasing to exist. */
  private returnLoad(route: Route, porter: Porter): void {
    const home = this.stopAt(route, porter.home);
    this.sites.restore(home, porter.good, porter.cargo);
  }

  /** Sends the next trip out, from whichever end actually has something to send.
   *
   *  Taking only from `route.from` would deadlock most of the network. Every town converts,
   *  so a town makes nothing at all until its raw material arrives — and a leg whose `from`
   *  was such a town and whose `to` had exactly what it needed could never start: the
   *  outbound trip would want stock the town could not have until the trip home delivered
   *  it. A leg runs in both directions, not as a pipe with a direction, and it behaves
   *  like one. */
  private dispatch(route: Route): void {
    if (route.porters.length >= portersFor(route.length)) return;
    // Keep them strung out along the road instead of leaving in a bunch, whichever end
    // they set out from.
    if (route.porters.some((p) => Math.abs(p.t - p.home) < PORTER_SPACING)) return;
    // Freight first, everywhere, and people only where a leg would otherwise not run at
    // all. A route is worth more carrying crates than carrying passengers, and a town with
    // something to ship should not have its trip taken by a queue at the station.
    for (const people of [false, true]) {
      for (const end of this.endsOf(route)) {
        const load = this.take(route, end, people);
        if (load === null) continue;
        route.porters.push({
          t: end,
          home: end,
          dir: end === 0 ? 1 : -1,
          good: load.good,
          cargo: load.cargo,
          mobId: null,
          mobVehicle: null,
          held: 0,
        });
        return;
      }
    }
  }

  /** Loads one end of a leg, with crates or with people. Null when there was nothing of
   *  that kind to load. */
  private take(route: Route, end: 0 | 1, people: boolean): { good: GoodId; cargo: number } | null {
    const here = this.stopAt(route, end);
    const there = this.stopAt(route, end === 0 ? 1 : 0);
    // Nothing is ever sent to somewhere that cannot take it.
    if (!this.sites.accepts(there)) return null;
    if (people) {
      const cargo = this.sites.loadPeople(here, this.loadOf(route));
      return cargo > 0 ? { good: PASSENGER, cargo } : null;
    }
    const load = this.sites.load(here, this.loadOf(route), this.sites.wants(there));
    if (!load || load.count <= 0) return null;
    return { good: load.good, cargo: load.count };
  }

  /** The two ends, the one worth loading first. An end whose goods the far end is actually
   *  asking for goes before one whose goods it merely tolerates; `from` breaks the tie, so
   *  a plain pair behaves exactly as it always did. */
  private endsOf(route: Route): (0 | 1)[] {
    const outWanted = shares(this.sites.offers(route.from), this.sites.wants(route.to));
    const backWanted = shares(this.sites.offers(route.to), this.sites.wants(route.from));
    if (backWanted && !outWanted) return [1, 0];
    return [0, 1];
  }

  /** Hands over whatever this porter is carrying. */
  private arrive(route: Route, porter: Porter, to: Stop): void {
    if (porter.cargo <= 0) return;
    const result = this.sites.unload(to, porter.good, porter.cargo);
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
   *  end actually wants, which is what makes a complementary pair worth joining. */
  private loadReturn(route: Route, porter: Porter, at: 0 | 1): void {
    const here = this.stopAt(route, at);
    const home = this.stopAt(route, porter.home);
    if (!this.sites.accepts(home)) return;
    const wanted = this.sites.wants(home);
    if (wanted.length > 0) {
      const load = this.sites.load(here, this.loadOf(route), wanted);
      // Only what home actually asked for. Bringing back whatever happened to be standing
      // there would make every leg pay both ways whether or not it was worth building.
      if (load && load.count > 0 && wanted.includes(load.good)) {
        porter.good = load.good;
        porter.cargo = load.count;
        return;
      }
      if (load && load.count > 0) this.sites.restore(here, load.good, load.count);
    }
    // Nothing here that home wants. Somebody who wants to go there is worth the trip:
    // this is a leg that would otherwise run empty, so people cost the network nothing.
    const riders = this.sites.loadPeople(here, this.loadOf(route));
    if (riders <= 0) return;
    porter.good = PASSENGER;
    porter.cargo = riders;
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
   *  falls behind.
   *
   *  It is also where the goods change hands. A shipment that has reached the platform is
   *  drawn by a train from there on rather than by the porter who brought it out, and the
   *  swap is done the only way a view of a number can do anything: the old mob goes and a
   *  new one appears where the goods are. That is the loading, and it happens at the one
   *  place the player is looking. */
  private syncMob(route: Route, porter: Porter, playerX: number, playerZ: number): void {
    if (!this.host) return;
    const here = this.pointAt(route, porter.t);
    if (!here) return;
    const near = Math.hypot(here.x - playerX, here.z - playerZ) <= PORTER_VISIBLE;
    const vehicle = this.vehicleAt(route, porter.t);

    if (porter.mobId !== null) {
      const position = this.host.porterPosition(porter.mobId);
      if (!position) {
        // Despawned by distance, or killed. The shipment carries on unseen.
        porter.mobId = null;
        porter.mobVehicle = null;
        return;
      }
      // Out of sight, or at the platform where what is carrying it changes. Either way the
      // one drawing it now is the wrong one.
      if (near && vehicle === porter.mobVehicle) {
        this.host.movePorter(porter.mobId, here, this.speedOf(route));
        return;
      }
      this.host.removePorter(porter.mobId);
      porter.mobId = null;
      porter.mobVehicle = null;
    }

    if (!near) return;
    porter.mobId = this.host.spawnPorter(here, vehicle, porter.cargo, porter.good);
    porter.mobVehicle = porter.mobId === null ? null : vehicle;
  }

}

/** A stop as a point. What the railway and the survey are asked about. */
function stopPoint(stop: Stop): RoadPoint {
  return { x: stop.x, y: stop.y, z: stop.z };
}

/** Whether anything one end has is anything the other end wants. */
function shares(offers: readonly GoodId[], wants: readonly GoodId[]): boolean {
  return offers.some((good) => wants.includes(good));
}
