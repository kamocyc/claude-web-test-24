/** Free-form railway track: curves laid in world coordinates, with no voxel grid under them.
 *
 *  This is a second, separate railway. The one in `roads.ts` is a *road surface* — a rail
 *  block is an ordinary cube in an ordinary column, so a line can only ever turn ninety
 *  degrees at a time and the mesher, which has no notion of orientation, draws every rail
 *  as a crossing. That railway stays exactly as it is. This one answers a different
 *  question: what a player gets when they click a start, click an end, and expect the game
 *  to work out the shape in between.
 *
 *  The shape is a **biarc in plan plus a cubic profile in section**, which is how real
 *  alignments are designed and, more to the point, how the four things this file has to do
 *  become cheap:
 *
 *  - the curvature limit is two numbers to compare rather than a sampled derivative;
 *  - arc length is closed form (`s = rθ`), so sleepers come out evenly spaced for free;
 *  - collinear ends degenerate into an exact straight line instead of nearly one;
 *  - an end point behind the start's tangent falls out of the solver as a negative root,
 *    so it can be refused rather than silently drawn as a cusp.
 *
 *  What it costs is a step in curvature at the joint between the two arcs — there are no
 *  transition spirals here. Track laid without easements is what almost every game and a
 *  good deal of light rail does, and at 1.2 blocks of gauge nobody is going to see it.
 *
 *  Nothing in this file imports three.js: the geometry is data, the renderer is elsewhere,
 *  and the solver is therefore testable under Node. */

import { clamp } from '../core/noise';
import type { SavedTracks } from './save';

// --- the shape of the track ---------------------------------------------------

/** Sleeper length, so "2 blocks wide including the sleepers" is one number here. */
export const TRACK_WIDTH = 2.0;
/** Rail centre to rail centre. */
export const GAUGE = 1.2;

/** Shorter than this and the two clicks are really one. */
export const MIN_SPAN = 3;
/** One gesture's worth of track. Longer runs are several segments, which is also what
 *  makes them follow the ground instead of ignoring it. */
export const MAX_SPAN = 96;
/** Tighter than this and the curve stops reading as track. */
export const MIN_RADIUS = 6;
/** Steepest the deck may climb, as a rise over horizontal run. */
export const MAX_GRADE = 0.2;
/** How near an existing free end has to be for a click to mean "join onto that". */
export const SNAP_RADIUS = 2.0;

/** How far off the through line a branch may leave a switch — and, because it is the same
 *  fact read the other way, how sharply freight may turn at one.
 *
 *  Which direction a train may take a branch in falls out of that single number rather
 *  than being a rule anybody had to write: arriving at a node is travelling *against* the
 *  port you came in by, so the turn onto a branch is wide from one side of the switch and
 *  a reversal from the other. That is a trailing point, and the geometry says so. */
export const MAX_SWITCH_ANGLE = 0.55;

/** How near a place a station has to be to serve it.
 *
 *  A railway is not a road: it does not have to reach the door, and it should not have to,
 *  because the last thirty blocks of a village are houses. A village is 38 blocks across
 *  from its middle, so this is anywhere on its own ground and a little way outside it.
 *  The walk from there to the depot's door is charged to every trip exactly the way the
 *  walk from a road is - see `doorGap` in `transport.ts`. */
export const STATION_REACH = 48;

/** The station's platform, as the numbers both the renderer and the player's feet need.
 *
 *  Here rather than in the renderer because a platform is something to stand on before it
 *  is something to look at, and two copies of "how long is a platform" would come apart the
 *  first time either was changed. The length is a short train's, so a train that stops
 *  here looks like it fits; the height is a carriage floor's, so stepping aboard is a step
 *  across rather than a climb — see `CAR_FLOOR` in `consist.ts`, which takes it from here. */
export const PLATFORM_LONG = 7;
export const PLATFORM_WIDE = 2.4;
/** Gap between the edge of the track and the edge of the platform. */
export const PLATFORM_GAP = 0.15;
/** Height of the platform surface over the railhead. */
export const PLATFORM_TOP = 0.85;

/** Rails consumed per block of track. One rail buys two blocks: this track carries
 *  nothing, so it cannot cost what the freight-carrying kind does — but free track would
 *  be the only thing in the game a player never has to fetch iron for. */
export function railsFor(length: number): number {
  return Math.max(1, Math.ceil(length / 2));
}

const EPS = 1e-9;
/** No sample may span more than this much of an arc, however coarse the caller asks for. */
const MAX_STEP_ANGLE = 0.12;

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
}

/** One end of a curve: where it is, which way the track runs through it, and how steeply.
 *
 *  `hx`/`hz` is a unit vector in the XZ plane and nothing else — deliberately not the
 *  player's full look vector. A player clicking the ground is looking thirty to sixty
 *  degrees down, and a track that left the ground at the angle they were looking would
 *  ramp into the sky every single time. The requirement's "the angle comes from the
 *  player's direction" means their yaw. */
export interface TrackAnchor {
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  /** dy/ds through this end, in the +(hx, hz) direction. Zero for a free end; inherited
   *  from the node for one that snapped, which is what keeps a chain smooth vertically. */
  grade: number;
}

export type PlanSegment =
  | { kind: 'line'; x0: number; z0: number; dx: number; dz: number; length: number }
  | { kind: 'arc'; cx: number; cz: number; radius: number; a0: number; sweep: number; length: number };

export interface TrackCurve {
  /** One segment when the two arcs collapse into a single arc or line, two otherwise. */
  plan: PlanSegment[];
  /** Horizontal arc length. See `sampleTrack` for why the vertical is not folded in. */
  length: number;
  y0: number;
  y1: number;
  m0: number;
  m1: number;
  /** Infinity for a curve that is entirely straight. */
  minRadius: number;
  /** The steepest slope anywhere on the profile, **signed**: positive climbs.
   *
   *  Signed because the limit is on the magnitude but the player needs the direction:
   *  "too steep" is not an answer they can act on until they know which way. */
  steepest: number;
}

export interface TrackSample extends TrackPoint {
  /** Unit tangent in three dimensions. */
  tx: number;
  ty: number;
  tz: number;
}

export type TrackFault =
  | 'short'
  | 'long'
  | 'behind'
  | 'radius'
  | 'grade'
  | 'degenerate'
  | 'occupied';

/** Why a shape was refused, and - when there was a shape at all - the shape itself, so
 *  that the readout and the toast can still describe what the player was pointing at.
 *  `behind` and `degenerate` have no curve: the solver stopped before there was one. */
export interface TrackRefusal {
  ok: false;
  fault: TrackFault;
  value: number;
  curve?: TrackCurve;
}

export type TrackSolve = { ok: true; curve: TrackCurve } | TrackRefusal;

/** Where a curve's two arcs meet, in plan. Only a curve made by cutting another one needs
 *  to say: everything else meets where the equal-tangent solve puts it. */
export interface TrackJoint {
  x: number;
  z: number;
}

// --- the solver ---------------------------------------------------------------

interface ArcResult {
  /** Null when the two points coincide: a zero length piece, dropped rather than drawn. */
  segment: PlanSegment | null;
  /** Tangent leaving the far end, which is the next piece's entry tangent. */
  ex: number;
  ez: number;
}

/** The unique circular arc (or straight line) that starts at A heading along T and ends
 *  at B. Null when B lies exactly behind A, which is a reversal no arc can make. */
function arcThrough(
  ax: number, az: number,
  tx: number, tz: number,
  bx: number, bz: number,
): ArcResult | null {
  const cx = bx - ax;
  const cz = bz - az;
  const chord = Math.hypot(cx, cz);
  if (chord < EPS) return { segment: null, ex: tx, ez: tz };

  const cross = tx * cz - tz * cx;
  const dot = tx * cx + tz * cz;

  if (Math.abs(cross) < EPS) {
    if (dot < 0) return null;
    return {
      segment: { kind: 'line', x0: ax, z0: az, dx: tx, dz: tz, length: chord },
      ex: tx,
      ez: tz,
    };
  }

  const sweep = 2 * Math.atan2(cross, dot);
  // |C|² / 2|cross| rather than |C| / 2|sin(sweep/2)|: the same number, without a sine
  // that goes to zero exactly where the radius goes to infinity.
  const radius = (chord * chord) / (2 * Math.abs(cross));
  const side = cross > 0 ? 1 : -1;
  // perp(T) is (-T.z, T.x), and the centre lies that way from A on the side the turn goes.
  const ccx = ax + side * radius * -tz;
  const ccz = az + side * radius * tx;
  const a0 = Math.atan2(az - ccz, ax - ccx);
  const cos = Math.cos(sweep);
  const sin = Math.sin(sweep);
  return {
    segment: { kind: 'arc', cx: ccx, cz: ccz, radius, a0, sweep, length: radius * Math.abs(sweep) },
    ex: tx * cos - tz * sin,
    ez: tx * sin + tz * cos,
  };
}

/** Folds the two pieces into one where they are really one: two lines in a row, or two
 *  arcs that turn the same way about the same centre. Straight track is the common case
 *  and this is what keeps it at one segment and half the vertices. */
function collapse(first: PlanSegment, second: PlanSegment): PlanSegment[] {
  if (first.kind === 'line' && second.kind === 'line') {
    return [{ ...first, length: first.length + second.length }];
  }
  if (first.kind === 'arc' && second.kind === 'arc') {
    const sameCentre = Math.abs(first.cx - second.cx) < 1e-6 && Math.abs(first.cz - second.cz) < 1e-6;
    const sameRadius = Math.abs(first.radius - second.radius) < 1e-6;
    const sameWay = first.sweep * second.sweep > 0;
    if (sameCentre && sameRadius && sameWay) {
      return [{
        ...first,
        sweep: first.sweep + second.sweep,
        length: first.length + second.length,
      }];
    }
  }
  return [first, second];
}

/** The steepest dy/ds anywhere on the profile, keeping its sign. The derivative of a
 *  cubic Hermite is a quadratic, so three evaluations settle it exactly rather than by
 *  sampling: the two ends and the one turning point. */
function profileSteepest(curve: Omit<TrackCurve, 'steepest' | 'minRadius'>): number {
  const { y0, y1, m0, m1, length } = curve;
  if (length < EPS) return 0;
  const delta = (y0 - y1) / length;
  const a = 6 * delta + 3 * m0 + 3 * m1;
  const b = -6 * delta - 4 * m0 - 2 * m1;
  const c = m0;
  const at = (t: number): number => a * t * t + b * t + c;
  const candidates = [at(0), at(1)];
  if (Math.abs(a) > EPS) candidates.push(at(clamp(-b / (2 * a), 0, 1)));
  let worst = 0;
  for (const value of candidates) if (Math.abs(value) > Math.abs(worst)) worst = value;
  return worst;
}

/** The curve joining two ends, or the reason there is not one.
 *
 *  `joint` overrules where the two arcs meet. Left off — which is every curve a player
 *  lays — the equal-tangent biarc is used, and that is the whole of the shape. It is
 *  passed only by `splitEdge`, because **half of an equal-tangent biarc is not itself
 *  one**: cut one past its joint and re-solving the piece moves it by over a blockile, which
 *  is the player's track visibly walking away from where they built it. Given the joint
 *  it was cut at, the same two arcs come back exactly. */
export function solveTrack(from: TrackAnchor, to: TrackAnchor, joint?: TrackJoint): TrackSolve {
  const vx = to.x - from.x;
  const vz = to.z - from.z;
  const t0x = from.hx;
  const t0z = from.hz;
  const t1x = to.hx;
  const t1z = to.hz;

  // The equal-tangent biarc: both arcs are given the same tangent length `d`, which makes
  // the joint a closed form instead of a search.
  const denom = 2 * (1 - (t0x * t1x + t0z * t1z));
  const b = 2 * (vx * (t0x + t1x) + vz * (t0z + t1z));
  const c = -(vx * vx + vz * vz);

  let d: number;
  if (Math.abs(denom) > EPS) {
    // c is negative for any real span, so the discriminant is positive and exactly one
    // root is positive.
    d = (-b + Math.sqrt(b * b - 4 * denom * c)) / (2 * denom);
  } else if (Math.abs(b) > EPS) {
    // Tangents parallel and pointing the same way: the quadratic degenerates to a linear.
    d = -c / b;
  } else {
    // Parallel tangents with the chord square across them. There is no equal-tangent
    // solution, so take the midpoint: two half circles of radius |V|/4. That normally
    // fails the radius check below, which is the honest answer rather than a fudged one.
    d = Math.hypot(vx, vz) / 2;
  }
  // With a joint given, `d` is not what decides the shape and a degenerate one is not a
  // refusal — the two ends of a split half can sit anywhere relative to each other.
  if (!joint && (!Number.isFinite(d) || d <= 1e-6)) return { ok: false, fault: 'behind', value: d };

  const jx = joint ? joint.x : (from.x + to.x) / 2 + (d / 2) * (t0x - t1x);
  const jz = joint ? joint.z : (from.z + to.z) / 2 + (d / 2) * (t0z - t1z);

  const first = arcThrough(from.x, from.z, t0x, t0z, jx, jz);
  if (!first) return { ok: false, fault: 'degenerate', value: 0 };
  const second = arcThrough(jx, jz, first.ex, first.ez, to.x, to.z);
  if (!second) return { ok: false, fault: 'degenerate', value: 0 };

  const pieces: PlanSegment[] = [];
  if (first.segment) pieces.push(first.segment);
  if (second.segment) pieces.push(second.segment);
  if (pieces.length === 0) return { ok: false, fault: 'short', value: 0 };
  const plan = pieces.length === 2 ? collapse(pieces[0], pieces[1]) : pieces;

  let length = 0;
  let minRadius = Infinity;
  for (const piece of plan) {
    length += piece.length;
    if (piece.kind === 'arc') minRadius = Math.min(minRadius, piece.radius);
  }

  const partial = { plan, length, y0: from.y, y1: to.y, m0: from.grade, m1: to.grade };
  const curve: TrackCurve = { ...partial, minRadius, steepest: profileSteepest(partial) };

  // Ordered so the first complaint is the most useful one: length before shape, shape
  // before slope. The curve rides along on every one of them: a shape that will not be
  // built is still a shape the player is owed a description of.
  if (length < MIN_SPAN) return { ok: false, fault: 'short', value: length, curve };
  if (length > MAX_SPAN) return { ok: false, fault: 'long', value: length, curve };
  if (minRadius < MIN_RADIUS) return { ok: false, fault: 'radius', value: minRadius, curve };
  if (Math.abs(curve.steepest) > MAX_GRADE) {
    // Signed, so the toast can say which way. The limit is on the magnitude.
    return { ok: false, fault: 'grade', value: curve.steepest, curve };
  }
  return { ok: true, curve };
}

// --- reading points off a curve -----------------------------------------------

/** Height at horizontal distance `s`, from the cubic Hermite profile. */
function heightAt(curve: TrackCurve, s: number): number {
  const l = curve.length;
  if (l < EPS) return curve.y0;
  const t = clamp(s / l, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * curve.y0 + h10 * (curve.m0 * l) + h01 * curve.y1 + h11 * (curve.m1 * l);
}

/** dy/ds at horizontal distance `s`. */
function gradeAt(curve: TrackCurve, s: number): number {
  const l = curve.length;
  if (l < EPS) return 0;
  const t = clamp(s / l, 0, 1);
  const delta = (curve.y0 - curve.y1) / l;
  return (6 * delta + 3 * curve.m0 + 3 * curve.m1) * t * t
    + (-6 * delta - 4 * curve.m0 - 2 * curve.m1) * t
    + curve.m0;
}

/** Which plan piece `s` falls in, and how far into it. */
function locate(curve: TrackCurve, s: number): { piece: PlanSegment; local: number } {
  const clamped = clamp(s, 0, curve.length);
  let remaining = clamped;
  for (let i = 0; i < curve.plan.length; i++) {
    const piece = curve.plan[i];
    if (remaining <= piece.length || i === curve.plan.length - 1) {
      return { piece, local: clamp(remaining, 0, piece.length) };
    }
    remaining -= piece.length;
  }
  return { piece: curve.plan[0], local: 0 };
}

function planPoint(piece: PlanSegment, local: number): { x: number; z: number } {
  if (piece.kind === 'line') {
    return { x: piece.x0 + piece.dx * local, z: piece.z0 + piece.dz * local };
  }
  const angle = piece.a0 + Math.sign(piece.sweep) * (local / piece.radius);
  return { x: piece.cx + piece.radius * Math.cos(angle), z: piece.cz + piece.radius * Math.sin(angle) };
}

function planTangent(piece: PlanSegment, local: number): { x: number; z: number } {
  if (piece.kind === 'line') return { x: piece.dx, z: piece.dz };
  const side = Math.sign(piece.sweep);
  const angle = piece.a0 + side * (local / piece.radius);
  return { x: -side * Math.sin(angle), z: side * Math.cos(angle) };
}

/** A point on the track, `s` blocks along it measured horizontally. */
export function pointAt(curve: TrackCurve, s: number): TrackPoint {
  const { piece, local } = locate(curve, s);
  const flat = planPoint(piece, local);
  return { x: flat.x, y: heightAt(curve, s), z: flat.z };
}

/** The unit tangent there, in three dimensions. */
export function tangentAt(curve: TrackCurve, s: number): TrackPoint {
  const { piece, local } = locate(curve, s);
  const flat = planTangent(piece, local);
  const dy = gradeAt(curve, s);
  const scale = 1 / Math.hypot(1, dy);
  return { x: flat.x * scale, y: dy * scale, z: flat.z * scale };
}

/** Evenly spaced samples along the track, boundaries and both ends included.
 *
 *  `s` is horizontal arc length, so the true three-dimensional spacing is
 *  `s·√(1 + (dy/ds)²)` — at the 20% grade cap that is a 2% stretch, and no sleeper is
 *  going to be caught out of place by it. Paying for a closed-form parameterisation with
 *  two percent is a good trade; paying for exactness with a distance table per curve,
 *  rebuilt every frame the ghost moves, is not. */
export function sampleTrack(curve: TrackCurve, spacing: number): TrackSample[] {
  const stops: number[] = [0];
  let base = 0;
  for (const piece of curve.plan) {
    const step = piece.kind === 'arc'
      ? Math.min(spacing, Math.max(0.05, piece.radius * MAX_STEP_ANGLE))
      : spacing;
    const count = Math.max(1, Math.ceil(piece.length / step));
    for (let i = 1; i <= count; i++) stops.push(base + (piece.length * i) / count);
    base += piece.length;
  }
  const samples: TrackSample[] = [];
  let previous = -1;
  for (const s of stops) {
    if (s - previous < 1e-6) continue;
    previous = s;
    const p = pointAt(curve, s);
    const t = tangentAt(curve, s);
    samples.push({ x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z });
  }
  return samples;
}

// --- describing a curve -------------------------------------------------------

/** Below this an arc is not something anyone would call a bend. A hundred blocks of track
 *  that wanders fifteen centimetres off its own chord is a straight, and an angle
 *  threshold cannot say so - it would call a gentle ninety-block sweep a bend and a tight
 *  six-block one straight. The sagitta is the number that matches the eye. */
const STRAIGHT_BOW = 0.15;

export type TrackBend = 'straight' | 'left' | 'right' | 's';

export interface TrackSummary {
  /** Horizontal, as everywhere else in this file. */
  length: number;
  /** End height less start height. A different question from `steepest`: a profile can
   *  climb in the middle and come back down, and a readout that showed only one of the
   *  two would be telling a player 12% about a run that ends where it started. */
  rise: number;
  /** Signed; positive climbs. */
  steepest: number;
  bend: TrackBend;
  /** The tightest arc, and which way it goes. Infinity and null with no arc at all.
   *  Deliberately *not* filtered by `STRAIGHT_BOW`: a tight little arc that reads as
   *  straight is exactly the shape the radius limit refuses, and the refusal has to be
   *  able to say which way it was turning. */
  radius: number;
  turn: 'left' | 'right' | null;
}

/** What a curve is, in the words the game says out loud.
 *
 *  Which way it bends comes from the sign of an arc's `sweep`, and **positive is right**.
 *  Three ways to see it, all agreeing: `arcThrough` puts the centre at
 *  `A + side * radius * (-tz, tx)`, and `(-tz, tx)` is what `movementDirection` returns
 *  for a strafe to the right; `sweep` carries the sign of `cross`, which is positive when
 *  the target lies to that side; and a circle bends towards its own centre. */
export function summarise(curve: TrackCurve): TrackSummary {
  let radius = Infinity;
  let turn: 'left' | 'right' | null = null;
  let left = false;
  let right = false;
  for (const piece of curve.plan) {
    if (piece.kind !== 'arc') continue;
    if (piece.radius < radius) {
      radius = piece.radius;
      turn = piece.sweep > 0 ? 'right' : 'left';
    }
    // The sagitta of a circular arc, near enough for the angles track uses.
    if ((piece.length * Math.abs(piece.sweep)) / 8 < STRAIGHT_BOW) continue;
    if (piece.sweep > 0) right = true;
    else left = true;
  }
  const bend: TrackBend = left && right ? 's' : right ? 'right' : left ? 'left' : 'straight';
  return { length: curve.length, rise: curve.y1 - curve.y0, steepest: curve.steepest, bend, radius, turn };
}

// --- the network --------------------------------------------------------------

/** Which port of a node an edge is attached to. Zero and one are the two sides of a plain
 *  joint; two is the branch of a switch.
 *
 *  It used to be `1 | -1` — the sign to multiply the node's one stored heading by, which
 *  is a slot index in disguise and could only ever name two slots. A number names as many
 *  as a node has. */
export type TrackDir = number;

/** One way out of a node: the direction a track leaves through it, and the slope it
 *  leaves at.
 *
 *  A node used to hold one heading and a sign, which made every track through it exactly
 *  collinear — the joint was continuous by construction rather than by tolerance. Ports
 *  keep that guarantee and stop it being a straitjacket: two ports that are exact
 *  negations of each other *are* a plain joint, and a third port pointing somewhere else
 *  is a switch. Nothing else in the file had to learn a new idea. */
export interface TrackPort {
  /** Unit in XZ, pointing the way a track leaves the node through this port. */
  hx: number;
  hz: number;
  /** dy/ds leaving through this port. */
  grade: number;
  /** The edge attached here, or null while the port is free. */
  edge: number | null;
}

export interface TrackNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /** The ways out. Two on a plain joint, three on a switch; never one, because a node with
   *  nothing attached is dropped. */
  ports: TrackPort[];
  /** Whether a station stands here. Freight only ever joins or leaves the railway at
   *  one of these — see `stationsFor`. */
  station: boolean;
  /** Whether a signal stands here, which makes this node a block boundary. */
  signal: boolean;
}

export interface TrackEdge {
  id: number;
  a: number;
  b: number;
  /** Which port of `a` and of `b` this edge is attached to. */
  dirA: TrackDir;
  dirB: TrackDir;
  /** Solved from the two nodes; never stored, always reproducible. */
  curve: TrackCurve;
  /** Where its arcs meet, for a curve that came from cutting another one. Absent on every
   *  curve a player laid, which is the equal-tangent biarc of its ends and needs no
   *  telling. Saved and handed back to `solveTrack`, or a split run would come back from
   *  a save a different shape from the one that went in. */
  joint?: TrackJoint;
}

/** An open end a click landed near, which port of it is free, and the direction a new
 *  track has to leave it in. */
export interface TrackSnap {
  node: TrackNode;
  port: number;
  hx: number;
  hz: number;
  grade: number;
}

export type TrackLay = { ok: true; edge: TrackEdge } | TrackRefusal;

export type TrackSplit =
  | { ok: true; node: TrackNode; edges: [TrackEdge, TrackEdge] }
  | TrackRefusal;

/** How wide a cell of the node index is. Sixteen matches a chunk, which is the size
 *  everything else in the game already thinks in. */
const CELL = 16;

/** How finely the deck is cut up for standing on. One block is plenty: the height is
 *  interpolated along each piece, so the only error is the sag between a chord and its
 *  arc, and on the tightest curve the solver allows that is 1 / (8 * 6) = 0.02 blocks. */
const DECK_STEP = 1;
/** Cell width of the deck index. A query is a single point, so it touches exactly one
 *  cell; four blocks keeps a handful of pieces in each without duplicating them widely. */
const DECK_CELL = 4;

/** One short length of deck: a segment with a half width, not a box.
 *
 *  A box would have to be axis-aligned, and an axis-aligned box around a piece of track
 *  running at forty-five degrees is a third wider than the track. A segment is exact, and
 *  it lets the height be interpolated along its length. */
interface DeckPiece {
  edge: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** Whether each end abuts another piece. The projection is clamped, which gives every
   *  piece a round cap of half the track's width - right at an interior joint, where it
   *  fills the outside of a bend, and quite wrong at the end of a run, where it would
   *  hang a metre of invisible floor past the last sleeper. */
  capA: boolean;
  capB: boolean;
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}

/** The end of a curve as an anchor again: position from the node, heading and grade from
 *  the port the curve leaves through.
 *
 *  **A port points the way out.** An edge occupies the port it leaves the node by, whether
 *  it is the curve's start or its finish — so at a plain joint the two edges occupy the
 *  two opposite ports, which is what makes them one line. A curve that *arrives* is
 *  travelling the other way at that moment, so the solver wants `arrivalOf` there, not
 *  this. Getting those two round the wrong way is a track that doubles back on itself.
 *
 *  A lookup rather than a negation, and that is the whole of what ports bought. Every edge
 *  at a port reads the same three numbers, so a joint is exactly continuous by
 *  construction — which is what it always was — and a third direction is now something
 *  those numbers can say. */
export function anchorOf(node: TrackNode, dir: TrackDir): TrackAnchor {
  const port = node.ports[dir] ?? node.ports[0];
  return { x: node.x, y: node.y, z: node.z, hx: port.hx, hz: port.hz, grade: port.grade };
}

/** The same port read as the direction a curve is travelling when it arrives here. */
export function arrivalOf(node: TrackNode, dir: TrackDir): TrackAnchor {
  const port = node.ports[dir] ?? node.ports[0];
  return { x: node.x, y: node.y, z: node.z, hx: -port.hx, hz: -port.hz, grade: -port.grade };
}

/** An anchor turned round: the same line, travelled the other way. */
export function reversed(anchor: TrackAnchor): TrackAnchor {
  return { ...anchor, hx: -anchor.hx, hz: -anchor.hz, grade: -anchor.grade };
}

/** The two ports of a plain joint: a track leaving one way, and one leaving the other. */
export function throughPorts(anchor: TrackAnchor): TrackPort[] {
  return [
    { hx: anchor.hx, hz: anchor.hz, grade: anchor.grade, edge: null },
    { hx: -anchor.hx, hz: -anchor.hz, grade: -anchor.grade, edge: null },
  ];
}

/** Edge ids attached to a node, in port order. The old `node.edges` array, derived. */
export function edgesOf(node: TrackNode): number[] {
  const out: number[] = [];
  for (const port of node.ports) if (port.edge !== null) out.push(port.edge);
  return out;
}

/** The line a node lies on, as one heading: its first port's.
 *
 *  A plain joint has only one line to speak of, and a switch is drawn and stood on along
 *  its through line rather than its branch, so the first port is the right answer for
 *  both. It is what a platform is laid alongside. */
export function headingOf(node: TrackNode): { hx: number; hz: number } {
  const port = node.ports[0];
  return { hx: port.hx, hz: port.hz };
}

/** Ports with nothing attached yet — the places a new curve may join. */
export function freePorts(node: TrackNode): number[] {
  const out: number[] = [];
  for (let i = 0; i < node.ports.length; i++) if (node.ports[i].edge === null) out.push(i);
  return out;
}


/** A line of rails from one place to another: what the freight actually travels along.
 *
 *  Points rather than curves, because the thing that consumes this walks a polyline and
 *  has no business knowing what a biarc is. */
export interface TrackWay {
  /** From the end serving the origin to the end serving the destination. */
  points: TrackPoint[];
  /** Along the rails, horizontal, like every other length in this file. */
  length: number;
  /** Blocks of up and down along the way. */
  climb: number;
}

export class TrackNetwork {
  readonly nodes = new Map<number, TrackNode>();
  readonly edges = new Map<number, TrackEdge>();
  /** Bumped by `lay`, `remove`, `clear` and `setStation` and by nothing else, so the
   *  renderer and the route survey can each decide whether to do their work again by
   *  comparing one number. */
  revision = 0;
  private nextId = 1;
  private readonly cells = new Map<string, number[]>();
  /** The deck, indexed for the movement code to ask about sixty times a second. Kept
   *  apart from `cells` because that one indexes ends and widens its search by MAX_SPAN
   *  to find the curves between them - fine once a second, far too much per frame. */
  private readonly deckCells = new Map<string, DeckPiece[]>();
  private readonly deckIndexed = new Set<number>();
  private deckRevision = -1;

  /** Nodes with a port still free, which are the only places a new track may join.
   *
   *  No longer a property of the node alone: a switch is an end and a middle at the same
   *  time, so callers that want to draw or aim at one want `freePorts` as well. */
  freeEnds(): TrackNode[] {
    return [...this.nodes.values()].filter((node) => freePorts(node).length > 0);
  }

  /** Every station on the network. */
  stations(): TrackNode[] {
    return [...this.nodes.values()].filter((node) => node.station);
  }

  /** Builds or takes down the station on an end. False when there is no such end, or when
   *  it is already what it is being asked to become — so a caller can charge for the one
   *  that changed something and nothing for the one that did not.
   *
   *  This moves `revision` because it changes what `wayBetween` answers. Without that the
   *  route survey, which skips itself entirely while nothing it has looked at has moved,
   *  would not notice a station until somebody happened to lay a curve. */
  setStation(nodeId: number, built: boolean): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.station === built) return false;
    node.station = built;
    this.revision++;
    return true;
  }

  totalLength(): number {
    let total = 0;
    for (const edge of this.edges.values()) total += edge.curve.length;
    return total;
  }

  nodesNear(x: number, z: number, radius: number): TrackNode[] {
    const found: TrackNode[] = [];
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const id of this.cells.get(`${cx},${cz}`) ?? []) {
          const node = this.nodes.get(id);
          if (node && Math.hypot(node.x - x, node.z - z) <= radius) found.push(node);
        }
      }
    }
    return found;
  }

  /** Every edge with an end near enough that some part of it could be within `radius`.
   *  A curve reaches at most MAX_SPAN from either end, so widening the node search by
   *  that much cannot miss one. */
  edgesNear(x: number, z: number, radius: number): TrackEdge[] {
    const seen = new Set<number>();
    const found: TrackEdge[] = [];
    for (const node of this.nodesNear(x, z, radius + MAX_SPAN)) {
      for (const id of edgesOf(node)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const edge = this.edges.get(id);
        if (edge) found.push(edge);
      }
    }
    return found;
  }

  /** The direction a new track must leave this node in, and the slope it must leave at.
   *
   *  It is the *continuation* of whatever is already attached — the tangent that edge
   *  arrives with, carried straight on — not its reverse. Get this backwards and a track
   *  snapped onto an existing end doubles back along the one already there.
   *
   *  With ports it is a lookup: the free one. Where several are free it is the first, and
   *  a caller that means a particular one passes it to `snapTo` instead. */
  continuationAt(node: TrackNode): TrackSnap {
    const free = freePorts(node);
    return this.snapTo(node, free.length > 0 ? free[0] : 0);
  }

  /** A node and one of its ports, as somewhere a new curve can leave from. */
  snapTo(node: TrackNode, port: number): TrackSnap {
    const at = node.ports[port] ?? node.ports[0];
    return { node, port, hx: at.hx, hz: at.hz, grade: at.grade };
  }

  /** The end of a laid run nearest a point, whatever state it is in.
   *
   *  Full ends are included on purpose. A click on one has to be refused — a third curve
   *  into an end is a switch — and refusing it is only possible if the end is found. Skip
   *  them here and the click quietly starts a second, unconnected run sitting exactly on
   *  top of the joint, which is the worst of the three answers. */
  nodeAt(p: TrackPoint, radius = SNAP_RADIUS): TrackNode | null {
    let best: TrackNode | null = null;
    let bestDistance = radius;
    for (const node of this.nodesNear(p.x, p.z, radius)) {
      const distance = Math.hypot(node.x - p.x, node.y - p.y, node.z - p.z);
      if (distance <= bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The open end nearest a point and the direction a new run must leave it in, or null
   *  when there is no end there or the one there has no room left. */
  snapNode(p: TrackPoint, radius = SNAP_RADIUS): TrackSnap | null {
    const node = this.nodeAt(p, radius);
    return node && freePorts(node).length > 0 ? this.continuationAt(node) : null;
  }

  /** How far along a ray a point sits, and how far off it, or null when it is behind the
   *  eye or beyond the reach. */
  static onRay(
    origin: TrackPoint, direction: TrackPoint, maxDistance: number, p: TrackPoint,
  ): { along: number; off: number } | null {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dz = p.z - origin.z;
    const along = dx * direction.x + dy * direction.y + dz * direction.z;
    if (along <= 0.5 || along > maxDistance) return null;
    return {
      along,
      off: Math.hypot(dx - direction.x * along, dy - direction.y * along, dz - direction.z * along),
    };
  }

  /** The end the line of sight passes nearest.
   *
   *  Aiming has to work against the track itself and not against the block under it. None
   *  of this railway is in the block grid, so a ray fired at a viaduct forty blocks up
   *  goes clean through it and lands on the ground beyond — and without this, the one end
   *  a player most wants to build on from is the one they cannot point at. */
  nodeAlongRay(
    origin: TrackPoint, direction: TrackPoint, maxDistance: number, radius = SNAP_RADIUS,
  ): TrackNode | null {
    let best: TrackNode | null = null;
    let nearest = Infinity;
    for (const node of this.nodesNear(origin.x, origin.z, maxDistance)) {
      const on = TrackNetwork.onRay(origin, direction, maxDistance, node);
      if (!on || on.off > radius || on.along >= nearest) continue;
      nearest = on.along;
      best = node;
    }
    return best;
  }

  /** The laid run the line of sight passes nearest, for picking one to remove. The one
   *  in front is the one being looked at, so ties go to whatever is closest along the
   *  ray rather than to whatever is closest to it. */
  edgeAlongRay(
    origin: TrackPoint, direction: TrackPoint, maxDistance: number, radius: number,
  ): TrackEdge | null {
    let best: TrackEdge | null = null;
    let nearest = Infinity;
    for (const edge of this.edgesNear(origin.x, origin.z, maxDistance)) {
      for (const sample of sampleTrack(edge.curve, 0.5)) {
        const on = TrackNetwork.onRay(origin, direction, maxDistance, sample);
        if (!on || on.off > radius || on.along >= nearest) continue;
        nearest = on.along;
        best = edge;
      }
    }
    return best;
  }

  /** Joins two ends. When an end resolved to an existing node its stored position,
   *  heading and grade are used *verbatim* rather than whatever the click landed on —
   *  which is what makes the joint exactly continuous instead of nearly so.
   *
   *  `fromPort`/`toPort` name which way out of an existing node the curve takes. Left off,
   *  the first free port is used, which is the only one a plain joint has. */
  lay(
    from: TrackAnchor,
    to: TrackAnchor,
    options: { fromNode?: number; toNode?: number; fromPort?: number; toPort?: number } = {},
  ): TrackLay {
    // An end the caller did not resolve is resolved here. "Match the angle of the track
    // that is already there" then holds however the track was laid — by hand, by the
    // console, or by the sample builder — instead of holding only where somebody
    // remembered to look first.
    const startNode = options.fromNode === undefined
      ? this.nodeAt(from)
      : this.nodes.get(options.fromNode) ?? null;
    const endNode = options.toNode === undefined
      ? this.nodeAt(to)
      : this.nodes.get(options.toNode) ?? null;
    if (startNode && endNode && startNode.id === endNode.id) {
      return { ok: false, fault: 'degenerate', value: 0 };
    }

    let startAnchor = from;
    let dirA: TrackDir = 0;
    if (startNode) {
      const port = this.portFor(startNode, options.fromPort, from);
      if (port === null) return { ok: false, fault: 'occupied', value: startNode.id };
      const cont = this.snapTo(startNode, port);
      startAnchor = { x: startNode.x, y: startNode.y, z: startNode.z, hx: cont.hx, hz: cont.hz, grade: cont.grade };
      dirA = port;
    }

    let endAnchor = to;
    let dirB: TrackDir = 0;
    if (endNode) {
      const port = this.portFor(endNode, options.toPort, to, true);
      if (port === null) return { ok: false, fault: 'occupied', value: endNode.id };
      // The curve *arrives* here, so it comes in against the port it leaves by.
      endAnchor = { ...arrivalOf(endNode, port), x: endNode.x, y: endNode.y, z: endNode.z };
      dirB = port;
    }

    const solved = solveTrack(startAnchor, endAnchor);
    if (!solved.ok) return solved;

    const a = startNode ?? this.addNode(startAnchor);
    // A fresh end node is made from the way out, not the way in: the curve leaves it
    // backwards, and the port it does not occupy is the continuation past it.
    const b = endNode ?? this.addNode(reversed(endAnchor));
    const edge: TrackEdge = { id: this.nextId++, a: a.id, b: b.id, dirA, dirB, curve: solved.curve };
    this.edges.set(edge.id, edge);
    a.ports[dirA].edge = edge.id;
    b.ports[dirB].edge = edge.id;
    this.revision++;
    return { ok: true, edge };
  }

  /** Which port of a node a new curve should take, or null when there is none to take.
   *
   *  An asked-for port is honoured when it is free. Otherwise the free port that best
   *  matches the direction the caller wanted, so that clicking an end and turning your
   *  head picks the side you are looking at rather than the side that happens to be
   *  first — which is the whole of what a switch needs from this. */
  private portFor(
    node: TrackNode, asked: number | undefined, want: TrackAnchor, arriving = false,
  ): number | null {
    const free = freePorts(node);
    // The direction the new curve leaves this node by. A curve that arrives leaves
    // backwards, so what it wants is the reverse of the way it is travelling.
    const wx = arriving ? -want.hx : want.hx;
    const wz = arriving ? -want.hz : want.hz;
    // Nothing free: this is a line already through, and a track leaving it is a switch.
    if (free.length === 0) return this.addBranch(node, wx, wz);
    if (asked !== undefined) return free.includes(asked) ? asked : null;
    if (free.length === 1) return free[0];
    let best = free[0];
    let bestDot = -Infinity;
    for (const port of free) {
      const dot = node.ports[port].hx * wx + node.ports[port].hz * wz;
      if (dot <= bestDot) continue;
      bestDot = dot;
      best = port;
    }
    return best;
  }

  /** Cuts a run in two at `s` blocks along it, leaving a node where the cut was.
   *
   *  This is how a line gets a place to put a signal, and how a branch gets somewhere to
   *  leave from: a railway laid in long gestures has nodes only at the ends of them, and a
   *  switch you can only build where you happened to stop is not a switch you can plan.
   *
   *  **The shape does not move.** Each half is handed the joint it was cut at, so the two
   *  arcs that come back are the two the player already had — see `solveTrack`. The
   *  profile takes care of itself: it is a cubic in `s`, and a cubic restricted to part of
   *  its own interval is reproduced exactly by its value and slope at the two ends. */
  splitEdge(edgeId: number, s: number): TrackSplit {
    const edge = this.edges.get(edgeId);
    if (!edge) return { ok: false, fault: 'degenerate', value: 0 };
    const a = this.nodes.get(edge.a);
    const b = this.nodes.get(edge.b);
    if (!a || !b) return { ok: false, fault: 'degenerate', value: 0 };
    const length = edge.curve.length;
    const spare = Math.min(s, length - s);
    // Either half has to be a run in its own right. Under this the solver would refuse it
    // as too short, and refusing here says which end was too close.
    if (!(spare >= MIN_SPAN)) return { ok: false, fault: 'short', value: Math.max(0, spare) };

    const at = pointAt(edge.curve, s);
    const tangent = tangentAt(edge.curve, s);
    const flat = Math.hypot(tangent.x, tangent.z) || 1;
    // The way the run is travelling here, which is the way out of the new node towards
    // `b`. Its other port therefore faces `a`, exactly as a joint laid by hand.
    const ahead: TrackAnchor = {
      x: at.x, y: at.y, z: at.z,
      hx: tangent.x / flat, hz: tangent.z / flat,
      grade: tangent.y / flat,
    };
    // Where the original's arcs met. Clamped into each half: inside one, it is the joint
    // that half genuinely has; outside, it lands on that half's own end, which collapses
    // one arc to nothing and leaves the single arc the half actually is.
    const jointS = edge.curve.plan.length > 1 ? edge.curve.plan[0].length : length / 2;
    const nearJoint = pointAt(edge.curve, Math.min(jointS, s));
    const farJoint = pointAt(edge.curve, Math.max(jointS, s));

    const first = solveTrack(anchorOf(a, edge.dirA), ahead, nearJoint);
    if (!first.ok) return first;
    const second = solveTrack(ahead, arrivalOf(b, edge.dirB), farJoint);
    if (!second.ok) return second;

    // Nothing above touched the network, so a refusal leaves it exactly as it was.
    const node = this.addNode(ahead);
    this.edges.delete(edge.id);
    a.ports[edge.dirA].edge = null;
    b.ports[edge.dirB].edge = null;
    const near: TrackEdge = {
      id: this.nextId++, a: a.id, b: node.id, dirA: edge.dirA, dirB: 1,
      curve: first.curve, joint: nearJoint,
    };
    const far: TrackEdge = {
      id: this.nextId++, a: node.id, b: b.id, dirA: 0, dirB: edge.dirB,
      curve: second.curve, joint: farJoint,
    };
    for (const made of [near, far]) {
      this.edges.set(made.id, made);
      this.nodes.get(made.a)!.ports[made.dirA].edge = made.id;
      this.nodes.get(made.b)!.ports[made.dirB].edge = made.id;
    }
    this.revision++;
    return { ok: true, node, edges: [near, far] };
  }

  /** Opens a third way out of a node that is already a line through: the branch of a
   *  switch, pointing where the caller asked.
   *
   *  Refused when it is further than `MAX_SWITCH_ANGLE` off one of the two ways the line
   *  already runs — past that it is not a turnout, it is a track crossing another one —
   *  and refused outright on a node that already has a branch, because a second one is a
   *  double slip and there is no shape here for that.
   *
   *  The branch takes the *through line's* slope rather than the one it was asked for, so
   *  the point stays smooth in section. A switch is where a train chooses, not where it
   *  starts climbing. */
  private addBranch(node: TrackNode, wx: number, wz: number): number | null {
    if (node.ports.length !== 2) return null;
    const flat = Math.hypot(wx, wz);
    if (flat < 1e-9) return null;
    const hx = wx / flat;
    const hz = wz / flat;
    const limit = Math.cos(MAX_SWITCH_ANGLE);
    let along = -1;
    let best = -Infinity;
    for (let i = 0; i < node.ports.length; i++) {
      const dot = node.ports[i].hx * hx + node.ports[i].hz * hz;
      if (dot <= best) continue;
      best = dot;
      along = i;
    }
    if (best < limit) return null;
    node.ports.push({ hx, hz, grade: node.ports[along].grade, edge: null });
    return node.ports.length - 1;
  }

  /** Drops an edge, and any end left holding nothing.
   *
   *  A switch that loses its branch keeps its third port, free and empty — pulling up a
   *  branch leaves the point behind rather than silently un-making it, so the player can
   *  lay a different branch from the same place. `dropSpurPorts` tidies the ones nobody
   *  could use. */
  remove(edgeId: number): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    this.edges.delete(edgeId);
    for (const id of [edge.a, edge.b]) {
      const node = this.nodes.get(id);
      if (!node) continue;
      for (const port of node.ports) if (port.edge === edgeId) port.edge = null;
      if (edgesOf(node).length === 0) this.dropNode(node);
    }
    this.revision++;
    return true;
  }

  clear(): number {
    const removed = this.edges.size;
    this.edges.clear();
    this.nodes.clear();
    this.cells.clear();
    // The deck index too, and not by letting the diff in `refreshDeck` notice: this is the
    // one place ids go backwards, so the next run laid takes an id the index still lists
    // as already built, and would be skipped while its stale pieces held the player up
    // over wherever the old track used to be.
    this.deckCells.clear();
    this.deckIndexed.clear();
    this.deckRevision = -1;
    this.nextId = 1;
    this.revision++;
    return removed;
  }

  private addNode(anchor: TrackAnchor): TrackNode {
    const node: TrackNode = {
      id: this.nextId++,
      x: anchor.x,
      y: anchor.y,
      z: anchor.z,
      ports: throughPorts(anchor),
      station: false,
      signal: false,
    };
    this.nodes.set(node.id, node);
    const key = cellKey(node.x, node.z);
    const cell = this.cells.get(key);
    if (cell) cell.push(node.id);
    else this.cells.set(key, [node.id]);
    return node;
  }

  private dropNode(node: TrackNode): void {
    this.nodes.delete(node.id);
    const key = cellKey(node.x, node.z);
    const cell = this.cells.get(key);
    if (!cell) return;
    const at = cell.indexOf(node.id);
    if (at >= 0) cell.splice(at, 1);
    if (cell.length === 0) this.cells.delete(key);
  }


  // --- the deck, as something to stand on --------------------------------------

  /** Rebuilds whatever the last change to the network invalidated.
   *
   *  Only `lay`, `remove` and `clear` move `revision`, and an edge's curve never changes
   *  after it is made, so the diff against what is already indexed is exact. The sentinel
   *  starts below zero on purpose: `fromJSON` fills `edges` directly without touching
   *  `revision`, so a network read off a save arrives holding track at revision zero, and
   *  a sentinel of zero would leave every bit of it walk-through. */
  private refreshDeck(): void {
    if (this.deckRevision === this.revision) return;
    this.deckRevision = this.revision;
    for (const id of this.deckIndexed) {
      if (this.edges.has(id)) continue;
      this.deckIndexed.delete(id);
      for (const [key, pieces] of this.deckCells) {
        const kept = pieces.filter((piece) => piece.edge !== id);
        if (kept.length === 0) this.deckCells.delete(key);
        else if (kept.length !== pieces.length) this.deckCells.set(key, kept);
      }
    }
    for (const edge of this.edges.values()) {
      if (this.deckIndexed.has(edge.id)) continue;
      this.deckIndexed.add(edge.id);
      const samples = sampleTrack(edge.curve, DECK_STEP);
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        this.addDeckPiece({
          edge: edge.id,
          ax: a.x, ay: a.y, az: a.z,
          bx: b.x, by: b.y, bz: b.z,
          // Only the two ends of a run are ends. Everywhere else the round cap that
          // clamping the projection gives is what keeps the outside of a bend from
          // opening up between pieces.
          capA: i > 1,
          capB: i < samples.length - 1,
        });
      }
    }
    // A switch needs nothing extra here, which is worth saying because it looks as though
    // it should. Three runs meeting at an angle each stop uncapped at the node, and the
    // fear is a wedge between them that belongs to none — a hole through the middle of
    // every point. There is not one: a branch may leave at most `MAX_SWITCH_ANGLE`, and at
    // that angle the three decks are still overlapping well past where they part. Walking
    // every sample of every curve of a switch, a half width to either side, finds no gap
    // anywhere except off the open end of a run, which is where a gap belongs.
  }

  private addDeckPiece(piece: DeckPiece): void {
    // Inflated by the half width, or a query standing a metre off the centreline in the
    // next cell along would miss the piece holding them up - holes on a four-block lattice.
    const half = TRACK_WIDTH / 2;
    const x0 = Math.floor((Math.min(piece.ax, piece.bx) - half) / DECK_CELL);
    const x1 = Math.floor((Math.max(piece.ax, piece.bx) + half) / DECK_CELL);
    const z0 = Math.floor((Math.min(piece.az, piece.bz) - half) / DECK_CELL);
    const z1 = Math.floor((Math.max(piece.az, piece.bz) + half) / DECK_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        const cell = this.deckCells.get(key);
        if (cell) cell.push(piece);
        else this.deckCells.set(key, [piece]);
      }
    }
  }

  /** The deck's height over a point, when there is deck over it between `low` and `high`.
   *
   *  This is `StandingSurface`. The height is interpolated along the piece rather than
   *  read off a box, which is what makes a graded run a ramp the player walks up instead
   *  of a flight of five-centimetre steps. What is tested is the player's centre, not
   *  their whole footprint: you walk off when your middle passes the end of the sleepers,
   *  which is both the simplest rule and the one that looks right. */
  surfaceTopAt(x: number, z: number, low: number, high: number): number | null {
    const platform = this.platformTopAt(x, z, low, high);
    if (this.edges.size === 0) return platform;
    this.refreshDeck();
    const cell = this.deckCells.get(`${Math.floor(x / DECK_CELL)},${Math.floor(z / DECK_CELL)}`);
    // A platform stands beside the track rather than on it, so the point somebody is
    // standing on may well be in no deck cell at all. Losing it here would make the one
    // part of a station you have to be able to stand on the one part you fall through.
    if (!cell) return platform;
    const half = TRACK_WIDTH / 2;
    let best: number | null = null;
    for (const piece of cell) {
      const dx = piece.bx - piece.ax;
      const dz = piece.bz - piece.az;
      const span = dx * dx + dz * dz;
      const raw = span < 1e-12 ? 0 : ((x - piece.ax) * dx + (z - piece.az) * dz) / span;
      let t = raw;
      if (t < 0) {
        if (!piece.capA) continue;
        t = 0;
      } else if (t > 1) {
        if (!piece.capB) continue;
        t = 1;
      }
      const offX = x - (piece.ax + dx * t);
      const offZ = z - (piece.az + dz * t);
      if (offX * offX + offZ * offZ > half * half) continue;
      // Along the piece's own line rather than at the cap. A piece reaches past its end
      // to fill the outside of a bend, and if it reported its end's height while doing so
      // it would also lift the deck by a whole step of the gradient - the highest answer
      // wins here, so every piece would hand back the height of the one above it.
      const top = piece.ay + (piece.by - piece.ay) * raw;
      if (top < low || top > high) continue;
      if (best === null || top > best) best = top;
    }
    // A platform is deck too. It is the one part of a station a player has to be able to
    // stand on: the whole of what it is for is being level with a carriage floor, and
    // being level with something you fall through is being nothing at all.
    return platform !== null && (best === null || platform > best) ? platform : best;
  }

  /** The station platform under a point, when its surface is inside the window.
   *
   *  A rectangle down one side of the track, oriented with the line, exactly as the
   *  renderer draws it — both read the same four numbers, so what is drawn and what holds
   *  the player up cannot come apart. */
  private platformTopAt(x: number, z: number, low: number, high: number): number | null {
    let best: number | null = null;
    for (const node of this.nodesNear(x, z, PLATFORM_LONG)) {
      if (!node.station) continue;
      const top = node.y + PLATFORM_TOP;
      if (top < low || top > high) continue;
      if (best !== null && top <= best) continue;
      // Forward along the line, and across it to the side the platform is on. The renderer
      // takes the same side from the same heading.
      const line = headingOf(node);
      const flat = Math.hypot(line.hx, line.hz) || 1;
      const fx = line.hx / flat;
      const fz = line.hz / flat;
      const dx = x - node.x;
      const dz = z - node.z;
      const along = dx * fx + dz * fz;
      // `s` in the renderer's frame is (f.z, -f.x); the platform's middle sits one half
      // width plus the gap out along it.
      const across = dx * fz - dz * fx;
      const middle = TRACK_WIDTH / 2 + PLATFORM_GAP + PLATFORM_WIDE / 2;
      if (Math.abs(along) > PLATFORM_LONG / 2) continue;
      if (Math.abs(across - middle) > PLATFORM_WIDE / 2) continue;
      best = top;
    }
    return best;
  }


  // --- the railway as a way between two places ----------------------------------

  /** The ends of the line near enough to a place to be of any use to it, nearest first. */
  private endsNear(place: TrackPoint, reach: number): TrackNode[] {
    return this.nodesNear(place.x, place.z, reach).sort(
      (a, b) =>
        Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z),
    );
  }

  /** The stations near enough to a place to serve it, nearest first.
   *
   *  Rails alone are not a service. A line that runs past a village without stopping at
   *  it is a line that runs past it, and until somebody builds the place where freight
   *  is put on and taken off, that is all it is. This is the one rule the whole of the
   *  station is: everything else about it — what it looks like, what it costs, where the
   *  crates pile up — hangs off the answer to this question. */
  private stationsFor(place: TrackPoint, reach: number): TrackNode[] {
    return this.endsNear(place, reach).filter((node) => node.station);
  }

  /** The rails from one place to another, when there are rails the whole way.
   *
   *  An end holds at most two curves, so a network is a handful of chains rather than a
   *  graph with choices in it, and the walk can never arrive at a junction and pick the
   *  wrong way out of it. It is written as a search anyway: the cost of doing so is a
   *  queue and a map, and the cost of not doing so is a rewrite on the day this gets
   *  points and sidings.
   *
   *  The walk sets out from the *neighbours* of the ends that serve the origin rather
   *  than from those ends themselves, so that whatever it finds is at least one curve
   *  long. Two villages can sit fifty blocks apart with their outskirts overlapping, and
   *  then every end of every line near them is inside both their reaches; seeded with the
   *  ends, such a pair would arrive before it set off and read as having no railway at
   *  all. What they must not have is a railway of no length, and this is that rule stated
   *  exactly. */
  wayBetween(from: TrackPoint, to: TrackPoint, reach = STATION_REACH, spacing = 2): TrackWay | null {
    const goals = new Set(this.stationsFor(to, reach).map((node) => node.id));
    if (goals.size === 0) return null;
    const parents = new Map<number, { node: number; edge: number }>();
    const queue: number[] = [];
    const spread = (node: TrackNode): void => {
      for (const edgeId of edgesOf(node)) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const next = edge.a === node.id ? edge.b : edge.a;
        if (parents.has(next)) continue;
        parents.set(next, { node: node.id, edge: edgeId });
        queue.push(next);
      }
    };
    // Nearest first, so that where a village has several ends to choose from, the freight
    // sets out from the one it has the shortest walk to.
    const stations = this.stationsFor(from, reach);
    const seeds = new Set(stations.map((node) => node.id));
    for (const node of stations) spread(node);

    let arrived: number | null = null;
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      if (goals.has(id)) {
        arrived = id;
        break;
      }
      const node = this.nodes.get(id);
      if (node) spread(node);
    }
    if (arrived === null) return null;

    // Back down the parents to the first end that serves the origin, then forwards along
    // what that walked. Stopping at a seed rather than at a node with no parent matters:
    // a seed reached from another seed has one, and following it would walk in a circle.
    const chain: { edge: number; from: number }[] = [];
    for (let id = arrived; ; ) {
      const step = parents.get(id);
      if (!step) break;
      chain.unshift({ edge: step.edge, from: step.node });
      id = step.node;
      if (seeds.has(id)) break;
    }
    const points: TrackPoint[] = [];
    let length = 0;
    let climb = 0;
    for (const step of chain) {
      const edge = this.edges.get(step.edge);
      if (!edge) continue;
      // A curve runs from its `a` end to its `b` end; walked the other way it is the same
      // samples backwards.
      const samples = sampleTrack(edge.curve, spacing);
      if (edge.a !== step.from) samples.reverse();
      for (const sample of samples) {
        const last = points[points.length - 1];
        if (last && Math.hypot(sample.x - last.x, sample.z - last.z) < 1e-6) continue;
        if (last) climb += Math.abs(sample.y - last.y);
        points.push({ x: sample.x, y: sample.y, z: sample.z });
      }
      length += edge.curve.length;
    }
    return points.length < 2 ? null : { points, length, climb };
  }

  /** An end near a place that could be a station and is not.
   *
   *  The one thing a player cannot see for themselves. Rails that run to the village and
   *  carry nothing look exactly like rails that carry something, and "you have built the
   *  whole railway and forgotten the station" is otherwise a silence. Null once something
   *  near does serve the place, and null where there is no track near it at all — that
   *  one is a railway to lay, not a station to build, and `railheadTowards` says so. */
  stationGapNear(place: TrackPoint, reach = STATION_REACH): TrackNode | null {
    const near = this.endsNear(place, reach);
    if (near.length === 0 || near.some((node) => node.station)) return null;
    return near[0];
  }

  /** Where a line that sets out from one place towards another runs out.
   *
   *  Asked of the ends rather than of the stations, so that a player laying towards a
   *  village they have not built a station at yet is still shown where their own line
   *  has got to. Null when there is no track near `from` at all: a beacon over every
   *  village in the world would be answering a question nobody asked. Otherwise it is the
   *  end of the line nearest the far village - which is the place to stand and keep
   *  laying. */
  railheadTowards(from: TrackPoint, to: TrackPoint, reach = STATION_REACH): TrackPoint | null {
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const node of this.endsNear(from, reach)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      queue.push(node.id);
    }
    let best: TrackNode | null = null;
    let bestGap = Infinity;
    for (let head = 0; head < queue.length; head++) {
      const node = this.nodes.get(queue[head]);
      if (!node) continue;
      const gap = Math.hypot(node.x - to.x, node.z - to.z);
      if (gap < bestGap) {
        bestGap = gap;
        best = node;
      }
      for (const edgeId of edgesOf(node)) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const next = edge.a === node.id ? edge.b : edge.a;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  toJSON(): SavedTracks {
    return {
      nodes: [...this.nodes.values()].map((node) => ({
        id: node.id,
        x: node.x, y: node.y, z: node.z,
        // Port zero, under the names a save written before ports existed used. A plain
        // joint is fully described by them, so its bytes have not moved.
        hx: node.ports[0].hx, hz: node.ports[0].hz, grade: node.ports[0].grade,
        // Written only where there is one, so a save from before stations existed and a
        // save of a railway with none are the same bytes.
        ...(node.station ? { station: true } : {}),
        ...(node.signal ? { signal: true } : {}),
        // And only for a switch. Two ports are always exact opposites — that is what a
        // plain joint *is* — so writing them out would be writing down a negation.
        ...(node.ports.length > 2
          ? { ports: node.ports.map((port) => ({ hx: port.hx, hz: port.hz, grade: port.grade })) }
          : {}),
      })),
      edges: [...this.edges.values()].map((edge) => ({
        a: edge.a, b: edge.b, dirA: edge.dirA, dirB: edge.dirB,
        // Only a run that was cut out of a longer one has a joint worth writing down.
        ...(edge.joint ? { jx: edge.joint.x, jz: edge.joint.z } : {}),
      })),
      nextId: this.nextId,
      ports: true,
    };
  }

  /** Rebuilds a network from its ends, solving every curve again. The solver is closed
   *  form and deterministic, so what comes back is the shape that was saved, not one
   *  like it. An edge whose ends have gone is dropped rather than fabricated. */
  static fromJSON(data: SavedTracks): TrackNetwork {
    const net = new TrackNetwork();
    for (const saved of data.nodes) {
      // A railway saved before stations existed comes back with none, which reads as
      // "the line is built and the stations are not" — true, and the panel says so. The
      // same goes for signals, and for ports: a node without them is a plain joint, which
      // is exactly what every node in every save written before switches existed was.
      const node: TrackNode = {
        id: saved.id, x: saved.x, y: saved.y, z: saved.z,
        ports: (saved.ports ?? throughPorts(saved)).map((port) => ({ ...port, edge: null })),
        station: saved.station === true,
        signal: saved.signal === true,
      };
      net.nodes.set(node.id, node);
      const key = cellKey(node.x, node.z);
      const cell = net.cells.get(key);
      if (cell) cell.push(node.id);
      else net.cells.set(key, [node.id]);
    }
    net.nextId = Math.max(1, data.nextId);
    for (const saved of data.edges) {
      const a = net.nodes.get(saved.a);
      const b = net.nodes.get(saved.b);
      if (!a || !b) continue;
      const dirA = data.ports ? saved.dirA : legacyStartPort(saved.dirA);
      const dirB = data.ports ? saved.dirB : legacyEndPort(saved.dirB);
      if (!a.ports[dirA] || !b.ports[dirB]) continue;
      const joint = saved.jx === undefined || saved.jz === undefined
        ? undefined
        : { x: saved.jx, z: saved.jz };
      const solved = solveTrack(anchorOf(a, dirA), arrivalOf(b, dirB), joint);
      if (!solved.ok) continue;
      const edge: TrackEdge = {
        id: net.nextId++, a: a.id, b: b.id, dirA, dirB, curve: solved.curve,
        ...(joint ? { joint } : {}),
      };
      net.edges.set(edge.id, edge);
      a.ports[dirA].edge = edge.id;
      b.ports[dirB].edge = edge.id;
    }
    // Orphaned by a dropped edge, and no longer an end of anything.
    for (const node of [...net.nodes.values()]) {
      if (edgesOf(node).length === 0) net.dropNode(node);
    }
    return net;
  }
}

/** Reading a save written before ports existed.
 *
 *  Back then a node had one heading and an edge carried a sign per end, and the two signs
 *  did not mean the same thing: at the curve's *start* the sign was the side the edge
 *  occupied, and at its *finish* it was the side it left free. `SavedTracks.ports` marks
 *  the saves that mean port numbers instead; without it, these two undo that asymmetry.
 *
 *  Port zero is the node's stored `(hx, hz, grade)` and port one is its exact reverse, so
 *  a plain joint round-trips through the old fields exactly. */
function legacyStartPort(sign: number): number {
  return sign < 0 ? 1 : 0;
}

function legacyEndPort(sign: number): number {
  return sign < 0 ? 0 : 1;
}

/** A straight run of samples between two points, for showing a player where a curve the
 *  solver refused was going to go. It is deliberately not a curve: what the ghost has to
 *  say at that moment is that there is no curve. */
export function straightSamples(from: TrackPoint, to: TrackPoint, spacing = 1): TrackSample[] {
  const span = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.max(1, Math.ceil(span / spacing));
  const flat = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  const tx = (to.x - from.x) / flat;
  const tz = (to.z - from.z) / flat;
  const samples: TrackSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
      tx, ty: 0, tz,
    });
  }
  return samples;
}
