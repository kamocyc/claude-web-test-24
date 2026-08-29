/** Lines: the thing the player actually builds.
 *
 *  Until now a road that joined two towns *was* a route. Lay the last block and goods
 *  started moving, with nothing to decide and nothing to name — which meant the network
 *  was a consequence of the terrain rather than a thing anybody designed. A transport game
 *  is about the design.
 *
 *  So now: the player puts down **stops**, and strings them into **lines**. Nothing moves
 *  along a road, a cart track or a railway unless a line says it should, and that is true
 *  of somebody walking a sack exactly as it is of a train. A road with no line on it is a
 *  road; it is not a service.
 *
 *  What the player does *not* choose is the vehicle. Each leg of a line looks at what
 *  actually joins its two stops — rails, a three wide road, a road — and runs whatever that
 *  supports. Choosing a road and then separately choosing "cart" would be asking the same
 *  question twice, and the answer that mattered was already given by what got built.
 *
 *  Nothing here imports three.js, so it all runs under Vitest in Node. Nothing here knows
 *  what a road or a rail is either: `transport.ts` surveys the legs and reports back. */

import type { VillageId } from './villages';

export type StopId = string;
export type LineId = string;

/** Somewhere a line can call at.
 *
 *  One kind of stop, whatever calls there. A platform for trains and a stand for carts
 *  would be two things the player has to know the difference between before they have seen
 *  either work; what a stop is for is naming a place on the map, and the rails or the road
 *  underneath it decide the rest. */
export interface Stop {
  id: StopId;
  x: number;
  y: number;
  z: number;
  /** The town this stop serves, when it stands near enough to one. Null for a stop out in
   *  the country — beside an industry, or at a junction on the way to somewhere. */
  town: VillageId | null;
  /** What to call it. Taken from the town when there is one, and numbered otherwise. */
  name: string;
}

/** An ordered list of stops. A line is run in both directions: there is no such thing as a
 *  one way service here, because a vehicle that arrived somewhere and stopped existing
 *  would be a vehicle the player had to think about, and they do not own vehicles. */
export interface Line {
  id: LineId;
  name: string;
  /** In calling order. Two or more to be worth running; fewer is a line somebody has
   *  started and not finished, which is a normal state to leave the game in. */
  stops: StopId[];
}

export interface SavedStop {
  id: string;
  x: number;
  y: number;
  z: number;
  town: string | null;
  name: string;
}

export interface SavedLine {
  id: string;
  name: string;
  stops: string[];
}

/** How near a stop has to be to a town to be that town's stop. Generous: a station is a
 *  place at the edge of a town in every world including this one, and asking the player to
 *  put it between the houses would be asking them to demolish some. */
export const STOP_TOWN_REACH = 72;
/** How near two stops may be. Closer than this and the pair is one place with two names,
 *  which makes a line that appears to work and carries nothing. */
export const STOP_SPACING = 8;
/** The most stops one line may call at. A cap so a line stays something a player can read
 *  in the panel, not a limit anybody meets. */
export const MAX_LINE_STOPS = 8;

/** Why a stop could not go somewhere. */
export type StopRefusal = 'too-close';

export type StopResult = { ok: true; stop: Stop } | { ok: false; why: StopRefusal };

/** Every stop the player has put down, and every line strung between them. */
export class LineNetwork {
  readonly stops = new Map<StopId, Stop>();
  readonly lines = new Map<LineId, Line>();
  /** Bumped whenever anything changes, so whoever runs the legs knows to survey again —
   *  the same trick `TrackNetwork.revision` plays, and for the same reason. */
  revision = 0;
  private nextStop = 1;
  private nextLine = 1;

  /** Puts a stop down. Refuses one on top of another: two stops in the same place is a
   *  line that looks joined and moves nothing. */
  addStop(
    at: { x: number; y: number; z: number },
    town: VillageId | null,
    townName?: string,
  ): StopResult {
    for (const stop of this.stops.values()) {
      if (Math.hypot(stop.x - at.x, stop.z - at.z) < STOP_SPACING) {
        return { ok: false, why: 'too-close' };
      }
    }
    const id = `s${this.nextStop++}`;
    const stop: Stop = {
      id,
      x: Math.round(at.x),
      y: Math.round(at.y),
      z: Math.round(at.z),
      town,
      name: townName ? `${townName}停留所` : `停留所 ${this.stops.size + 1}`,
    };
    this.stops.set(id, stop);
    this.revision++;
    return { ok: true, stop };
  }

  /** Takes a stop away, and takes it off every line that called there. A line left with
   *  one stop is kept: the player is mid-edit, not finished. */
  removeStop(id: StopId): boolean {
    if (!this.stops.delete(id)) return false;
    for (const line of this.lines.values()) {
      line.stops = line.stops.filter((stop) => stop !== id);
    }
    this.revision++;
    return true;
  }

  /** The stop nearest a point, within a radius. What a click on the world resolves to. */
  stopNear(x: number, z: number, radius: number): Stop | null {
    let best: Stop | null = null;
    let bestDistance = radius;
    for (const stop of this.stops.values()) {
      const distance = Math.hypot(stop.x - x, stop.z - z);
      if (distance > bestDistance) continue;
      best = stop;
      bestDistance = distance;
    }
    return best;
  }

  /** Every stop that serves a town. A town with none is a town no line can reach, which is
   *  the thing the panel has to be able to say. */
  stopsOf(town: VillageId): Stop[] {
    return [...this.stops.values()].filter((stop) => stop.town === town);
  }

  createLine(name?: string): Line {
    const id = `l${this.nextLine++}`;
    const line: Line = { id, name: name ?? `${this.lines.size + 1} 号線`, stops: [] };
    this.lines.set(id, line);
    this.revision++;
    return line;
  }

  deleteLine(id: LineId): boolean {
    const gone = this.lines.delete(id);
    if (gone) this.revision++;
    return gone;
  }

  renameLine(id: LineId, name: string): boolean {
    const line = this.lines.get(id);
    if (!line || name.length === 0) return false;
    line.name = name;
    this.revision++;
    return true;
  }

  /** Adds a call at the end of a line.
   *
   *  Refuses to call at the same stop twice running — a leg from a stop to itself is a
   *  vehicle going nowhere — but the same stop may appear again later, which is how a line
   *  that runs out and back through a junction is written. */
  addCall(lineId: LineId, stopId: StopId): boolean {
    const line = this.lines.get(lineId);
    if (!line || !this.stops.has(stopId)) return false;
    if (line.stops.length >= MAX_LINE_STOPS) return false;
    if (line.stops[line.stops.length - 1] === stopId) return false;
    line.stops.push(stopId);
    this.revision++;
    return true;
  }

  /** Drops the call at an index. */
  removeCall(lineId: LineId, index: number): boolean {
    const line = this.lines.get(lineId);
    if (!line || index < 0 || index >= line.stops.length) return false;
    line.stops.splice(index, 1);
    this.revision++;
    return true;
  }

  /** The legs of a line: each consecutive pair of calls, and the pair that closes the
   *  loop when it has three or more.
   *
   *  Two stops make one leg, run in both directions. Three or more make a circuit, because
   *  a vehicle that reached the last stop and turned round would leave the middle of the
   *  line served twice as often as its ends. */
  legsOf(lineId: LineId): { from: Stop; to: Stop }[] {
    const line = this.lines.get(lineId);
    if (!line || line.stops.length < 2) return [];
    const stops = line.stops
      .map((id) => this.stops.get(id))
      .filter((stop): stop is Stop => stop !== undefined);
    if (stops.length < 2) return [];
    const out: { from: Stop; to: Stop }[] = [];
    for (let i = 1; i < stops.length; i++) out.push({ from: stops[i - 1], to: stops[i] });
    if (stops.length > 2) out.push({ from: stops[stops.length - 1], to: stops[0] });
    return out;
  }

  /** Every line that calls at a stop. What "delete this stop and what breaks?" reads. */
  linesAt(stopId: StopId): Line[] {
    return [...this.lines.values()].filter((line) => line.stops.includes(stopId));
  }

  toJSON(): { stops: SavedStop[]; lines: SavedLine[] } {
    return {
      stops: [...this.stops.values()].map((stop) => ({ ...stop })),
      lines: [...this.lines.values()].map((line) => ({ ...line, stops: [...line.stops] })),
    };
  }

  loadJSON(data: { stops?: SavedStop[]; lines?: SavedLine[] } | undefined): void {
    this.stops.clear();
    this.lines.clear();
    this.nextStop = 1;
    this.nextLine = 1;
    for (const entry of data?.stops ?? []) {
      if (typeof entry?.id !== 'string') continue;
      this.stops.set(entry.id, {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        town: entry.town ?? null,
        name: entry.name ?? entry.id,
      });
      this.nextStop = Math.max(this.nextStop, numberIn(entry.id) + 1);
    }
    for (const entry of data?.lines ?? []) {
      if (typeof entry?.id !== 'string') continue;
      this.lines.set(entry.id, {
        id: entry.id,
        name: entry.name ?? entry.id,
        // A call at a stop that is no longer there is dropped rather than kept as a hole:
        // the leg either side of it would be a leg to nowhere.
        stops: (entry.stops ?? []).filter((stop) => this.stops.has(stop)),
      });
      this.nextLine = Math.max(this.nextLine, numberIn(entry.id) + 1);
    }
    this.revision++;
  }
}

/** The number out of an id like `s12`, so ids carry on where the save left off rather than
 *  colliding with what is already there. */
function numberIn(id: string): number {
  const n = Number(id.slice(1));
  return Number.isFinite(n) ? n : 0;
}
