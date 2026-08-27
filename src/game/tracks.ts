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
  maxGrade: number;
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

export type TrackSolve =
  | { ok: true; curve: TrackCurve }
  | { ok: false; fault: TrackFault; value: number };

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

/** Steepest |dy/ds| anywhere on the profile. The derivative of a cubic Hermite is a
 *  quadratic, so three evaluations settle it exactly rather than by sampling. */
function profileMaxGrade(curve: Omit<TrackCurve, 'maxGrade' | 'minRadius'>): number {
  const { y0, y1, m0, m1, length } = curve;
  if (length < EPS) return 0;
  const delta = (y0 - y1) / length;
  const a = 6 * delta + 3 * m0 + 3 * m1;
  const b = -6 * delta - 4 * m0 - 2 * m1;
  const c = m0;
  const at = (t: number): number => a * t * t + b * t + c;
  let worst = Math.max(Math.abs(at(0)), Math.abs(at(1)));
  if (Math.abs(a) > EPS) {
    const t = clamp(-b / (2 * a), 0, 1);
    worst = Math.max(worst, Math.abs(at(t)));
  }
  return worst;
}

/** The curve joining two ends, or the reason there is not one. */
export function solveTrack(from: TrackAnchor, to: TrackAnchor): TrackSolve {
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
  if (!Number.isFinite(d) || d <= 1e-6) return { ok: false, fault: 'behind', value: d };

  const jx = (from.x + to.x) / 2 + (d / 2) * (t0x - t1x);
  const jz = (from.z + to.z) / 2 + (d / 2) * (t0z - t1z);

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
  const maxGrade = profileMaxGrade(partial);
  const curve: TrackCurve = { ...partial, minRadius, maxGrade };

  // Ordered so the first complaint is the most useful one: length before shape, shape
  // before slope.
  if (length < MIN_SPAN) return { ok: false, fault: 'short', value: length };
  if (length > MAX_SPAN) return { ok: false, fault: 'long', value: length };
  if (minRadius < MIN_RADIUS) return { ok: false, fault: 'radius', value: minRadius };
  if (maxGrade > MAX_GRADE) return { ok: false, fault: 'grade', value: maxGrade };
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

// --- the network --------------------------------------------------------------

/** Which way round a node an edge runs: +1 along the node's stored heading, -1 against. */
export type TrackDir = 1 | -1;

export interface TrackNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Undirected through-heading, unit in XZ. Which way a new track may leave is decided
   *  by the edge already attached, not by this sign. */
  hx: number;
  hz: number;
  /** dy/ds through the node in the +(hx, hz) direction. */
  grade: number;
  /** Edge ids. At most two: a third would be a switch, and there are no switches here. */
  edges: number[];
}

export interface TrackEdge {
  id: number;
  a: number;
  b: number;
  dirA: TrackDir;
  dirB: TrackDir;
  /** Solved from the two nodes; never stored, always reproducible. */
  curve: TrackCurve;
}

/** An open end a click landed near, and the direction a new track has to leave it in. */
export interface TrackSnap {
  node: TrackNode;
  hx: number;
  hz: number;
  grade: number;
}

export type TrackLay =
  | { ok: true; edge: TrackEdge }
  | { ok: false; fault: TrackFault; value: number };

/** How wide a cell of the node index is. Sixteen matches a chunk, which is the size
 *  everything else in the game already thinks in. */
const CELL = 16;

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}

/** The end of a curve as an anchor again: position from the node, heading and grade
 *  turned round to match the way this edge runs through it. */
export function anchorOf(node: TrackNode, dir: TrackDir): TrackAnchor {
  return {
    x: node.x,
    y: node.y,
    z: node.z,
    hx: node.hx * dir,
    hz: node.hz * dir,
    grade: node.grade * dir,
  };
}

export class TrackNetwork {
  readonly nodes = new Map<number, TrackNode>();
  readonly edges = new Map<number, TrackEdge>();
  /** Bumped by `lay` and `remove` and by nothing else, so the renderer can decide whether
   *  to rebuild by comparing one number. */
  revision = 0;
  private nextId = 1;
  private readonly cells = new Map<string, number[]>();

  /** Open ends, which are the only places a new track may join. */
  freeEnds(): TrackNode[] {
    return [...this.nodes.values()].filter((node) => node.edges.length < 2);
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
      for (const id of node.edges) {
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
   *  snapped onto an existing end doubles back along the one already there. */
  continuationAt(node: TrackNode): TrackSnap {
    if (node.edges.length === 0) {
      return { node, hx: node.hx, hz: node.hz, grade: node.grade };
    }
    const edge = this.edges.get(node.edges[0]);
    if (!edge) return { node, hx: node.hx, hz: node.hz, grade: node.grade };
    // An edge leaving `a` occupies the side it leaves towards, so the free side is the
    // other one; an edge arriving at `b` leaves the side it was heading for free.
    const sign: TrackDir = edge.a === node.id ? (edge.dirA === 1 ? -1 : 1) : edge.dirB;
    return { node, hx: node.hx * sign, hz: node.hz * sign, grade: node.grade * sign };
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
    return node && node.edges.length < 2 ? this.continuationAt(node) : null;
  }

  /** How far along a ray a point sits, and how far off it, or null when it is behind the
   *  eye or beyond the reach. */
  private static onRay(
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
   *  which is what makes the joint exactly continuous instead of nearly so. */
  lay(
    from: TrackAnchor,
    to: TrackAnchor,
    options: { fromNode?: number; toNode?: number } = {},
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
    for (const node of [startNode, endNode]) {
      if (node && node.edges.length >= 2) return { ok: false, fault: 'occupied', value: node.id };
    }

    let startAnchor = from;
    let dirA: TrackDir = 1;
    if (startNode) {
      const cont = this.continuationAt(startNode);
      startAnchor = { x: startNode.x, y: startNode.y, z: startNode.z, hx: cont.hx, hz: cont.hz, grade: cont.grade };
      dirA = cont.hx * startNode.hx + cont.hz * startNode.hz > 0 ? 1 : -1;
    }

    let endAnchor = to;
    let dirB: TrackDir = 1;
    if (endNode) {
      // The curve *arrives* here, so it comes in against the continuation.
      const cont = this.continuationAt(endNode);
      endAnchor = { x: endNode.x, y: endNode.y, z: endNode.z, hx: -cont.hx, hz: -cont.hz, grade: -cont.grade };
      dirB = -cont.hx * endNode.hx - cont.hz * endNode.hz > 0 ? 1 : -1;
    }

    const solved = solveTrack(startAnchor, endAnchor);
    if (!solved.ok) return solved;

    const a = startNode ?? this.addNode(startAnchor);
    const b = endNode ?? this.addNode(endAnchor);
    const edge: TrackEdge = { id: this.nextId++, a: a.id, b: b.id, dirA, dirB, curve: solved.curve };
    this.edges.set(edge.id, edge);
    a.edges.push(edge.id);
    b.edges.push(edge.id);
    this.revision++;
    return { ok: true, edge };
  }

  /** Drops an edge, and any end left holding nothing. */
  remove(edgeId: number): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    this.edges.delete(edgeId);
    for (const id of [edge.a, edge.b]) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const at = node.edges.indexOf(edgeId);
      if (at >= 0) node.edges.splice(at, 1);
      if (node.edges.length === 0) this.dropNode(node);
    }
    this.revision++;
    return true;
  }

  clear(): number {
    const removed = this.edges.size;
    this.edges.clear();
    this.nodes.clear();
    this.cells.clear();
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
      hx: anchor.hx,
      hz: anchor.hz,
      grade: anchor.grade,
      edges: [],
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

  toJSON(): SavedTracks {
    return {
      nodes: [...this.nodes.values()].map((node) => ({
        id: node.id, x: node.x, y: node.y, z: node.z, hx: node.hx, hz: node.hz, grade: node.grade,
      })),
      edges: [...this.edges.values()].map((edge) => ({
        a: edge.a, b: edge.b, dirA: edge.dirA, dirB: edge.dirB,
      })),
      nextId: this.nextId,
    };
  }

  /** Rebuilds a network from its ends, solving every curve again. The solver is closed
   *  form and deterministic, so what comes back is the shape that was saved, not one
   *  like it. An edge whose ends have gone is dropped rather than fabricated. */
  static fromJSON(data: SavedTracks): TrackNetwork {
    const net = new TrackNetwork();
    for (const saved of data.nodes) {
      const node: TrackNode = { ...saved, edges: [] };
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
      const dirA: TrackDir = saved.dirA < 0 ? -1 : 1;
      const dirB: TrackDir = saved.dirB < 0 ? -1 : 1;
      const solved = solveTrack(anchorOf(a, dirA), anchorOf(b, dirB));
      if (!solved.ok) continue;
      const edge: TrackEdge = { id: net.nextId++, a: a.id, b: b.id, dirA, dirB, curve: solved.curve };
      net.edges.set(edge.id, edge);
      a.edges.push(edge.id);
      b.edges.push(edge.id);
    }
    // Orphaned by a dropped edge, and no longer an end of anything.
    for (const node of [...net.nodes.values()]) {
      if (node.edges.length === 0) net.dropNode(node);
    }
    return net;
  }
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
