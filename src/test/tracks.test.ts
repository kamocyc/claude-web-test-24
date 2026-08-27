import { describe, expect, it } from 'vitest';
import { movementDirection } from '../game/player';
import {
  MAX_GRADE,
  MAX_SPAN,
  MIN_RADIUS,
  MIN_SPAN,
  pointAt,
  sampleTrack,
  SNAP_RADIUS,
  solveTrack,
  tangentAt,
  summarise,
  TrackNetwork,
  TRACK_WIDTH,
  edgesOf,
  freePorts,
  type TrackAnchor,
  type TrackCurve,
  type TrackEdge,
} from '../game/tracks';

/** An end at (x, y, z) running along the unit heading (hx, hz). */
function end(x: number, y: number, z: number, hx: number, hz: number, grade = 0): TrackAnchor {
  const length = Math.hypot(hx, hz);
  return { x, y, z, hx: hx / length, hz: hz / length, grade };
}

function solved(from: TrackAnchor, to: TrackAnchor): TrackCurve {
  const result = solveTrack(from, to);
  if (!result.ok) throw new Error(`expected a curve, got ${result.fault} (${result.value})`);
  return result.curve;
}

function fault(from: TrackAnchor, to: TrackAnchor): string {
  const result = solveTrack(from, to);
  return result.ok ? 'ok' : result.fault;
}

describe('the track curve', () => {
  it('is an exact straight line when both ends face along the chord', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(30, 64, 0, 1, 0));
    expect(curve.plan).toHaveLength(1);
    expect(curve.plan[0].kind).toBe('line');
    expect(curve.length).toBeCloseTo(30, 9);
    expect(curve.minRadius).toBe(Infinity);
    for (let i = 0; i <= 20; i++) {
      const p = pointAt(curve, (curve.length * i) / 20);
      expect(p.z).toBeCloseTo(0, 9);
      expect(p.y).toBeCloseTo(64, 9);
      expect(p.x).toBeCloseTo((30 * i) / 20, 9);
    }
  });

  it('folds a quarter turn into a single arc', () => {
    // Leaving +x at the origin and arriving +z at (10, 10) is one circle about (0, 10).
    const curve = solved(end(0, 64, 0, 1, 0), end(10, 64, 10, 0, 1));
    expect(curve.plan).toHaveLength(1);
    expect(curve.plan[0].kind).toBe('arc');
    expect(curve.minRadius).toBeCloseTo(10, 6);
    expect(curve.length).toBeCloseTo((10 * Math.PI) / 2, 6);
    const mid = pointAt(curve, curve.length / 2);
    expect(Math.hypot(mid.x - 0, mid.z - 10)).toBeCloseTo(10, 6);
  });

  it('makes an S out of two arcs that turn opposite ways', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(20, 64, 8, 1, 0));
    expect(curve.plan).toHaveLength(2);
    const [first, second] = curve.plan;
    if (first.kind !== 'arc' || second.kind !== 'arc') throw new Error('expected two arcs');
    expect(first.radius).toBeCloseTo(second.radius, 6);
    expect(Math.sign(first.sweep)).toBe(-Math.sign(second.sweep));
    // The joint of an equal-tangent biarc between parallel ends is the midpoint.
    const joint = pointAt(curve, first.length);
    expect(joint.x).toBeCloseTo(10, 6);
    expect(joint.z).toBeCloseTo(4, 6);
  });

  it('honours the tangent the player asked for at both ends', () => {
    const cases: [number, number, number, number, number, number][] = [
      [40, 0, 1, 0, 0, 1], [30, 20, 1, 0, -1, 0], [-25, 30, 0, 1, 1, 0],
      [50, -10, 1, 0, 1, 0], [18, 24, 0, 1, 0, 1], [-40, -12, -1, 0, 0, -1],
      [12, 44, 0, 1, -1, 0], [36, 36, 1, 1, 1, -1], [-30, 18, -1, 1, 0, 1],
      [22, -34, 1, 0, 0, -1],
    ];
    for (const [x, z, ax, az, bx, bz] of cases) {
      const from = end(0, 64, 0, ax, az);
      const to = end(x, 64, z, bx, bz);
      const result = solveTrack(from, to);
      if (!result.ok) continue; // a refused shape is a different test's business
      const start = tangentAt(result.curve, 0);
      const finish = tangentAt(result.curve, result.curve.length);
      expect(start.x).toBeCloseTo(from.hx, 9);
      expect(start.z).toBeCloseTo(from.hz, 9);
      expect(finish.x).toBeCloseTo(to.hx, 9);
      expect(finish.z).toBeCloseTo(to.hz, 9);
    }
  });

  it('has no kink where the two arcs meet', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(20, 64, 8, 1, 0));
    const joint = curve.plan[0].length;
    const before = tangentAt(curve, joint - 1e-4);
    const after = tangentAt(curve, joint + 1e-4);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it('is parameterised by arc length, so sleepers come out evenly spaced', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(35, 64, 20, 0, 1));
    const steps = 400;
    let total = 0;
    let shortest = Infinity;
    let longest = 0;
    let previous = pointAt(curve, 0);
    for (let i = 1; i <= steps; i++) {
      const p = pointAt(curve, (curve.length * i) / steps);
      const gap = Math.hypot(p.x - previous.x, p.z - previous.z);
      total += gap;
      shortest = Math.min(shortest, gap);
      longest = Math.max(longest, gap);
      previous = p;
    }
    expect(total).toBeCloseTo(curve.length, 2);
    expect(longest / shortest).toBeLessThan(1.01);
  });

  it('spaces its own samples evenly too', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(35, 64, 20, 0, 1));
    const samples = sampleTrack(curve, 0.5);
    expect(samples.length).toBeGreaterThan(50);
    for (let i = 1; i < samples.length; i++) {
      const gap = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      expect(gap).toBeLessThanOrEqual(0.51);
    }
    const last = samples[samples.length - 1];
    const finish = pointAt(curve, curve.length);
    expect(last.x).toBeCloseTo(finish.x, 9);
    expect(last.z).toBeCloseTo(finish.z, 9);
  });

  it('refuses an end behind the start, a turn too tight, and a slope too steep', () => {
    expect(fault(end(0, 64, 0, 1, 0), end(-8, 64, 0, 1, 0))).toBe('behind');
    expect(fault(end(0, 64, 0, 1, 0), end(4, 64, 4, 0, 1))).toBe('radius');
    expect(fault(end(0, 64, 0, 1, 0), end(20, 76, 0, 1, 0))).toBe('grade');
    expect(fault(end(0, 64, 0, 1, 0), end(2, 64, 0, 1, 0))).toBe('short');
    expect(fault(end(0, 64, 0, 1, 0), end(MAX_SPAN + 10, 64, 0, 1, 0))).toBe('long');
  });

  it('reports why, in numbers the toast can quote', () => {
    const tight = solveTrack(end(0, 64, 0, 1, 0), end(4, 64, 4, 0, 1));
    if (tight.ok) throw new Error('expected a refusal');
    expect(tight.fault).toBe('radius');
    expect(tight.value).toBeLessThan(MIN_RADIUS);
    const steep = solveTrack(end(0, 64, 0, 1, 0), end(20, 76, 0, 1, 0));
    if (steep.ok) throw new Error('expected a refusal');
    expect(steep.value).toBeGreaterThan(MAX_GRADE);
  });

  it('climbs smoothly, leaving and arriving level', () => {
    const curve = solved(end(0, 64, 0, 1, 0), end(40, 68, 0, 1, 0));
    expect(pointAt(curve, 0).y).toBeCloseTo(64, 9);
    expect(pointAt(curve, curve.length).y).toBeCloseTo(68, 9);
    expect(tangentAt(curve, 0).y).toBeCloseTo(0, 9);
    expect(tangentAt(curve, curve.length).y).toBeCloseTo(0, 9);
    // 1.5 · Δy / L is where a Hermite with level ends peaks.
    // Positive because it climbs: the sign is the whole point of the field.
    expect(curve.steepest).toBeCloseTo((1.5 * 4) / curve.length, 6);
    let previous = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const y = pointAt(curve, (curve.length * i) / 40).y;
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
    }
  });

  it('carries a grade through from a snapped end', () => {
    const curve = solved(end(0, 64, 0, 1, 0, 0.1), end(40, 68, 0, 1, 0));
    expect(tangentAt(curve, 0).y).toBeCloseTo(0.1 / Math.hypot(1, 0.1), 9);
  });

  it('survives parallel ends with the chord square across them', () => {
    const result = solveTrack(end(0, 64, 0, 1, 0), end(0, 64, 8, 1, 0));
    if (result.ok) {
      for (const value of [result.curve.length, result.curve.minRadius, result.curve.steepest]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    } else {
      expect(result.fault).toBe('radius');
    }
  });

  it('solves the same shape every time, which is what lets a save store only the ends', () => {
    const from = end(3, 64, -7, 1, 0.3);
    const to = end(41, 66, 22, 0.2, 1);
    const once = solveTrack(from, to);
    const twice = solveTrack(from, to);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('keeps MIN_SPAN below MAX_SPAN, so some span is layable at all', () => {
    expect(MIN_SPAN).toBeLessThan(MAX_SPAN);
  });
});

// --- the network --------------------------------------------------------------

/** Lays a straight run east from (0, 64, 0) and hands back the network and the edge. */
function eastward(length = 30): { net: TrackNetwork; edge: TrackEdge } {
  const net = new TrackNetwork();
  const result = net.lay(end(0, 64, 0, 1, 0), end(length, 64, 0, 1, 0));
  if (!result.ok) throw new Error(`could not lay the first run: ${result.fault}`);
  return { net, edge: result.edge };
}

describe('snapping onto track that is already there', () => {
  it('offers an end just inside the radius and not one just outside it', () => {
    const { net } = eastward();
    expect(net.snapNode({ x: 30, y: 64, z: SNAP_RADIUS - 0.1 })).not.toBeNull();
    expect(net.snapNode({ x: 30, y: 64, z: SNAP_RADIUS + 0.1 })).toBeNull();
  });

  it('answers with the position of the end, not the point that was aimed at', () => {
    const { net } = eastward();
    const snap = net.snapNode({ x: 30.6, y: 63.4, z: 0.5 });
    expect(snap?.node.x).toBe(30);
    expect(snap?.node.y).toBe(64);
    expect(snap?.node.z).toBe(0);
  });

  it('carries the existing tangent on rather than reversing it', () => {
    const { net, edge } = eastward();
    const far = net.snapNode({ x: 30, y: 64, z: 0 });
    const near = net.snapNode({ x: 0, y: 64, z: 0 });
    const arriving = tangentAt(edge.curve, edge.curve.length);
    expect(far!.hx * arriving.x + far!.hz * arriving.z).toBeGreaterThan(0.999);
    // Backwards out of the start is the other way round, and by exactly as much.
    const leaving = tangentAt(edge.curve, 0);
    expect(near!.hx * leaving.x + near!.hz * leaving.z).toBeLessThan(-0.999);
  });

  it('never offers an end that already has track on both sides', () => {
    const { net } = eastward();
    const second = net.lay(end(30, 64, 0, 1, 0), end(70, 64, 14, 1, 0));
    expect(second.ok).toBe(true);
    expect(net.snapNode({ x: 30, y: 64, z: 0 })).toBeNull();
    expect(net.freeEnds()).toHaveLength(2);
  });

  it('takes the nearer of two candidates', () => {
    const { net } = eastward();
    const other = net.lay(end(0, 64, 20, 1, 0), end(30, 64, 20, 1, 0));
    expect(other.ok).toBe(true);
    expect(net.snapNode({ x: 30, y: 64, z: 19.2 }, 4)?.node.z).toBe(20);
    expect(net.snapNode({ x: 30, y: 64, z: 0.9 }, 4)?.node.z).toBe(0);
  });

  it('finds nothing in a cell nowhere near, which is the index doing its job', () => {
    const { net } = eastward();
    expect(net.nodesNear(900, -900, 8)).toHaveLength(0);
    expect(net.edgesNear(900, -900, 8)).toHaveLength(0);
  });
});

describe('the track network', () => {
  it('shares the end between two runs instead of stacking two ends on it', () => {
    const { net, edge } = eastward();
    const second = net.lay(end(30, 64, 0, 1, 0), end(70, 64, 18, 0, 1));
    if (!second.ok) throw new Error(`could not join on: ${second.fault}`);
    expect(net.nodes.size).toBe(3);
    expect(net.edges.size).toBe(2);
    expect(second.edge.a).toBe(edge.b);
  });

  it('leaves the joint tangent-continuous, which is the whole point of snapping', () => {
    const { net, edge } = eastward();
    const second = net.lay(end(30, 64, 0, 0, 1), end(70, 64, 18, 0, 1));
    if (!second.ok) throw new Error(`could not join on: ${second.fault}`);
    const arriving = tangentAt(edge.curve, edge.curve.length);
    const leaving = tangentAt(second.edge.curve, 0);
    expect(leaving.x).toBeCloseTo(arriving.x, 9);
    expect(leaving.y).toBeCloseTo(arriving.y, 9);
    expect(leaving.z).toBeCloseTo(arriving.z, 9);
    // The click asked for +z and got +x: an existing end overrules the player's yaw.
    expect(leaving.x).toBeCloseTo(1, 9);
  });

  it('joins backwards out of a start end too', () => {
    const { net, edge } = eastward();
    const back = net.lay(end(0, 64, 0, 1, 0), end(-40, 64, 12, -1, 0));
    if (!back.ok) throw new Error(`could not join on: ${back.fault}`);
    expect(net.nodes.size).toBe(3);
    const leaving = tangentAt(back.edge.curve, 0);
    const forward = tangentAt(edge.curve, 0);
    expect(leaving.x).toBeCloseTo(-forward.x, 9);
    expect(leaving.z).toBeCloseTo(-forward.z, 9);
  });

  it('refuses a third run into an end that is already full', () => {
    const { net } = eastward();
    const second = net.lay(end(30, 64, 0, 1, 0), end(70, 64, 14, 1, 0));
    if (!second.ok) throw new Error(`could not join on: ${second.fault}`);
    // Naming the end outright is the path the placement code takes once it has snapped.
    const third = net.lay(end(70, 64, 14, 1, 0), end(110, 64, 26, 1, 0), { fromNode: second.edge.b });
    expect(third.ok).toBe(true);
    const crowded = net.lay(end(30, 64, 0, 1, 0), end(30, 64, 40, 0, 1));
    expect(crowded.ok).toBe(false);
    if (!crowded.ok) expect(crowded.fault).toBe('occupied');
  });

  it('refuses to join an end to itself', () => {
    const { net } = eastward();
    const loop = net.lay(end(30, 64, 0, 1, 0), end(30, 64, 0, 1, 0));
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.fault).toBe('degenerate');
  });

  it('collects the ends a removal orphans and keeps the ones it does not', () => {
    const { net, edge } = eastward();
    expect(net.lay(end(30, 64, 0, 1, 0), end(70, 64, 18, 0, 1)).ok).toBe(true);
    expect(net.nodes.size).toBe(3);
    expect(net.remove(edge.id)).toBe(true);
    expect(net.edges.size).toBe(1);
    // The shared end is still an end of the run that is left; the far one has gone.
    expect(net.nodes.size).toBe(2);
    expect([...net.nodes.values()].some((node) => node.x === 30)).toBe(true);
    expect([...net.nodes.values()].some((node) => node.x === 0)).toBe(false);
  });

  it('bumps its revision when the track changes and not when it is merely read', () => {
    const { net, edge } = eastward();
    const after = net.revision;
    net.nodesNear(0, 0, 50);
    net.edgesNear(0, 0, 50);
    net.snapNode({ x: 30, y: 64, z: 0 });
    net.freeEnds();
    expect(net.revision).toBe(after);
    net.remove(edge.id);
    expect(net.revision).toBe(after + 1);
  });

  it('picks the run the line of sight passes, not the block behind it', () => {
    const { net, edge } = eastward();
    // Standing off to one side of a run that floats, looking across at it.
    const eye = { x: 15, y: 68, z: -10 };
    const at = (p: { x: number; y: number; z: number }) => {
      const d = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      return { x: (p.x - eye.x) / d, y: (p.y - eye.y) / d, z: (p.z - eye.z) / d };
    };
    expect(net.edgeAlongRay(eye, at({ x: 15, y: 64, z: 0 }), 48, 1)?.id).toBe(edge.id);
    // Aimed well past the end of it.
    expect(net.edgeAlongRay(eye, at({ x: 60, y: 64, z: 0 }), 48, 1)).toBeNull();
    // Behind the eye is not looked at.
    expect(net.edgeAlongRay(eye, at({ x: 15, y: 72, z: -20 }), 48, 1)).toBeNull();
  });

  it('finds an end the line of sight passes, so track in the air can be built on', () => {
    const { net } = eastward();
    const eye = { x: 30, y: 74, z: 0 };
    // Straight down at the far end, from ten blocks above it.
    expect(net.nodeAlongRay(eye, { x: 0, y: -1, z: 0 }, 48)?.x).toBe(30);
    expect(net.nodeAlongRay(eye, { x: 0, y: 1, z: 0 }, 48)).toBeNull();
    expect(net.nodeAlongRay(eye, { x: 1, y: 0, z: 0 }, 48)).toBeNull();
  });

  it('comes back off a save as the same shape, not one like it', () => {
    const { net } = eastward();
    expect(net.lay(end(30, 64, 0, 1, 0), end(70, 66, 18, 0, 1)).ok).toBe(true);
    const before = [...net.edges.values()].map((e) => ({
      length: e.curve.length,
      mid: pointAt(e.curve, e.curve.length / 2),
    }));
    const reloaded = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    expect(reloaded.nodes.size).toBe(net.nodes.size);
    expect(reloaded.edges.size).toBe(net.edges.size);
    const after = [...reloaded.edges.values()].map((e) => ({
      length: e.curve.length,
      mid: pointAt(e.curve, e.curve.length / 2),
    }));
    expect(after).toEqual(before);
    // And the reloaded network is still joined up, not two runs that merely touch.
    expect(reloaded.freeEnds()).toHaveLength(2);
  });

  it('samples a laid run finely enough to draw', () => {
    const { net, edge } = eastward();
    expect(net.totalLength()).toBeCloseTo(30, 9);
    expect(sampleTrack(edge.curve, 0.5).length).toBeGreaterThan(55);
  });
});

// --- describing a curve --------------------------------------------------------

describe('saying what a curve is', () => {
  it('calls a bend left or right the way the player would, not the way the maths does', () => {
    // Leaving +x is yaw -PI/2, so the player's own strafe-right vector is what the curve
    // has to agree with. Asserting against `movementDirection` rather than against a
    // hand-written (0, 1) is the point: if either convention ever moves, this fails.
    const yaw = -Math.PI / 2;
    const right = movementDirection(yaw, 1, 0);
    const rightward = solved(end(0, 64, 0, 1, 0), end(10, 64, 10, 0, 1));
    const mid = pointAt(rightward, rightward.length / 2);
    expect(mid.x * right.x + mid.z * right.z).toBeGreaterThan(0);
    expect(summarise(rightward).bend).toBe('right');
    expect(summarise(rightward).turn).toBe('right');

    const leftward = solved(end(0, 64, 0, 1, 0), end(10, 64, -10, 0, -1));
    const otherMid = pointAt(leftward, leftward.length / 2);
    expect(otherMid.x * right.x + otherMid.z * right.z).toBeLessThan(0);
    expect(summarise(leftward).bend).toBe('left');
  });

  it('calls a straight straight and an S an S', () => {
    const straight = summarise(solved(end(0, 64, 0, 1, 0), end(30, 64, 0, 1, 0)));
    expect(straight.bend).toBe('straight');
    expect(straight.radius).toBe(Infinity);
    expect(straight.turn).toBeNull();
    expect(straight.rise).toBe(0);
    expect(straight.steepest).toBe(0);
    expect(summarise(solved(end(0, 64, 0, 1, 0), end(20, 64, 8, 1, 0))).bend).toBe('s');
  });

  it('keeps the direction of a bend too tight to be built, which is when it matters most', () => {
    const refused = solveTrack(end(0, 64, 0, 1, 0), end(4, 64, 4, 0, 1));
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.fault).toBe('radius');
    expect(refused.curve).toBeDefined();
    expect(summarise(refused.curve!).turn).toBe('right');
  });

  it('says which way a slope goes, and how far it actually gets', () => {
    const up = summarise(solved(end(0, 64, 0, 1, 0), end(40, 68, 0, 1, 0)));
    expect(up.steepest).toBeGreaterThan(0);
    expect(up.rise).toBeCloseTo(4, 9);
    const down = summarise(solved(end(0, 68, 0, 1, 0), end(40, 64, 0, 1, 0)));
    expect(down.steepest).toBeCloseTo(-up.steepest, 9);
    expect(down.rise).toBeCloseTo(-4, 9);
  });

  it('hands the curve back with a refusal so a slope that will not be built can still be described', () => {
    const refused = solveTrack(end(0, 64, 0, 1, 0), end(20, 52, 0, 1, 0));
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.fault).toBe('grade');
    expect(refused.value).toBeLessThan(0);
    expect(summarise(refused.curve!).rise).toBeCloseTo(-12, 9);
  });
});

// --- standing on it ------------------------------------------------------------

describe('the deck as something to stand on', () => {
  it('holds up a point over it and nothing beside it', () => {
    const { net } = eastward();
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBe(64);
    expect(net.surfaceTopAt(15, TRACK_WIDTH / 2 - 0.01, 60, 70)).toBe(64);
    expect(net.surfaceTopAt(15, TRACK_WIDTH / 2 + 0.01, 60, 70)).toBeNull();
  });

  it('stops at the end of the run rather than hanging a metre of floor past it', () => {
    const { net } = eastward();
    expect(net.surfaceTopAt(29.9, 0, 60, 70)).toBe(64);
    expect(net.surfaceTopAt(30.5, 0, 60, 70)).toBeNull();
    expect(net.surfaceTopAt(-0.5, 0, 60, 70)).toBeNull();
  });

  it('answers only within the band it was asked about', () => {
    const { net } = eastward();
    expect(net.surfaceTopAt(15, 0, 64.1, 70)).toBeNull();
    expect(net.surfaceTopAt(15, 0, 60, 63.9)).toBeNull();
  });

  it('follows the shape of a run that climbs and turns', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(35, 68, 20, 0, 1));
    if (!laid.ok) throw new Error(`could not lay the run: ${laid.fault}`);
    for (let i = 0; i <= 20; i++) {
      const p = pointAt(laid.edge.curve, (laid.edge.curve.length * i) / 20);
      const top = net.surfaceTopAt(p.x, p.z, p.y - 1, p.y + 1);
      expect(top).not.toBeNull();
      // Chords, not arcs - but chords whose height is read off their own line, so what
      // is left is second order and two centimetres covers it. The number that matters is
      // that it is far under SURFACE_REACH, which is what the player is stood on by.
      expect(Math.abs(top! - p.y)).toBeLessThan(0.02);
    }
  });

  it('appears when track is laid and goes when it is taken away', () => {
    const net = new TrackNetwork();
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBeNull();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(30, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBe(64);
    net.remove(laid.edge.id);
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBeNull();
  });

  it('holds nothing up far away from any of it', () => {
    const { net } = eastward();
    expect(net.surfaceTopAt(900, -900, 0, 200)).toBeNull();
  });

  it('is there straight off a save, which arrives holding track at revision zero', () => {
    const { net } = eastward();
    const reloaded = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    expect(reloaded.revision).toBe(0);
    expect(reloaded.surfaceTopAt(15, 0, 60, 70)).toBe(64);
  });

  it('clears away with the network', () => {
    const { net } = eastward();
    net.clear();
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBeNull();
  });

  it('is rebuilt where the new track is after a clear, not left where the old one was', () => {
    // `clear` is the one place edge ids go backwards, so the run laid next takes an id the
    // deck index still lists as built. Left alone it would skip the new track and go on
    // holding the player up over the old one.
    const { net } = eastward();
    net.clear();
    const again = net.lay(end(200, 80, 200, 1, 0), end(230, 80, 200, 1, 0));
    if (!again.ok) throw new Error(`could not lay the second run: ${again.fault}`);
    expect(net.surfaceTopAt(215, 200, 70, 90)).toBe(80);
    expect(net.surfaceTopAt(15, 0, 60, 70)).toBeNull();
  });
});

describe('the railway as a way between two places', () => {
  /** Puts a station on the end of the line nearest each place, which is what a player
   *  pointing at that end and clicking does. Every way between two places wants this: rails
   *  on their own are a line that runs past a village rather than one that serves it. */
  function stationsAt(net: TrackNetwork, ...places: { x: number; z: number }[]): void {
    for (const place of places) {
      const near = net.nodesNear(place.x, place.z, 8);
      if (near.length === 0) throw new Error(`no end near (${place.x}, ${place.z})`);
      near.sort(
        (a, b) =>
          Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z),
      );
      net.setStation(near[0].id, true);
    }
  }

  /** Three runs laid end to end, east from the origin: (0,0) to (180,0), through joints
   *  at 60 and 120. The middle one is deliberately laid from its far end backwards, so
   *  the walk has to turn a curve round to follow it. Both ends get a station, because a
   *  line without them carries nothing. */
  function line(): TrackNetwork {
    const net = new TrackNetwork();
    const first = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0));
    const last = net.lay(end(180, 64, 0, -1, 0), end(120, 64, 0, -1, 0));
    const middle = net.lay(end(60, 64, 0, 1, 0), end(120, 64, 0, 1, 0));
    if (!first.ok || !last.ok || !middle.ok) throw new Error('could not lay the line');
    stationsAt(net, { x: 0, z: 0 }, { x: 180, z: 0 });
    return net;
  }

  const west = { x: 0, y: 64, z: 0 };
  const east = { x: 180, y: 64, z: 0 };

  it('joins two places the rails reach, and runs from one to the other', () => {
    const way = line().wayBetween(west, east);
    expect(way).not.toBeNull();
    expect(way!.points[0].x).toBeCloseTo(0, 6);
    expect(way!.points[way!.points.length - 1].x).toBeCloseTo(180, 6);
    expect(way!.length).toBeCloseTo(180, 6);
  });

  it('hands the same line back the other way round when it is asked the other way', () => {
    // The freight sets out from the origin, so the first point has to be the end that
    // serves it. Get this backwards and every shipment appears at the wrong village.
    const way = line().wayBetween(east, west);
    expect(way!.points[0].x).toBeCloseTo(180, 6);
    expect(way!.points[way!.points.length - 1].x).toBeCloseTo(0, 6);
  });

  it('walks a run that was laid backwards without doubling back on itself', () => {
    // The middle run of the fixture was laid from 120 towards 60, so following it from
    // the west means reading its curve in reverse.
    const way = line().wayBetween(west, east);
    for (let i = 1; i < way!.points.length; i++) {
      expect(way!.points[i].x).toBeGreaterThan(way!.points[i - 1].x);
    }
  });

  it('carries nothing until both ends have a station on them', () => {
    // The whole of the rule. Rails that run past a village serve it exactly as much as a
    // road that runs past one: not at all.
    const net = new TrackNetwork();
    for (const run of [
      net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0)),
      net.lay(end(60, 64, 0, 1, 0), end(120, 64, 0, 1, 0)),
      net.lay(end(120, 64, 0, 1, 0), end(180, 64, 0, 1, 0)),
    ]) {
      if (!run.ok) throw new Error('could not lay the line');
    }
    expect(net.wayBetween(west, east), 'rails alone joined the two').toBeNull();
    stationsAt(net, { x: 0, z: 0 });
    expect(net.wayBetween(west, east), 'one station was enough').toBeNull();
    stationsAt(net, { x: 180, z: 0 });
    expect(net.wayBetween(west, east)).not.toBeNull();
  });

  it('forgets the way again when a station is taken down', () => {
    const net = line();
    const station = net.stations().find((node) => node.x < 1);
    expect(station, 'the fixture built no station at the west end').toBeDefined();
    expect(net.setStation(station!.id, false)).toBe(true);
    expect(net.wayBetween(west, east)).toBeNull();
    // And a second attempt changes nothing, so a caller can charge for the one that did.
    expect(net.setStation(station!.id, false)).toBe(false);
  });

  it('moves the revision when a station is built, so the survey notices', () => {
    // The route survey skips itself entirely while nothing it has looked at has moved. A
    // station that did not move this would not be seen until somebody laid a curve.
    const net = line();
    const before = net.revision;
    const spare = net.nodes.values().next().value!;
    net.setStation(spare.id, !spare.station);
    expect(net.revision).toBeGreaterThan(before);
  });

  it('points at the end to build the station on, and stops once one is there', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the line');
    const gap = net.stationGapNear(west);
    expect(gap?.x).toBeCloseTo(0, 6);
    stationsAt(net, { x: 0, z: 0 });
    expect(net.stationGapNear(west), 'still asked for a station it already has').toBeNull();
    // And nothing at all where there is no track: that one is a railway to lay, and
    // `railheadTowards` is what says so.
    expect(net.stationGapNear({ x: 900, y: 64, z: 0 })).toBeNull();
  });

  it('keeps its stations across a save, and opens an older one with none', () => {
    const net = line();
    const reloaded = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    expect(reloaded.stations()).toHaveLength(2);
    expect(reloaded.wayBetween(west, east)).not.toBeNull();

    // A railway saved before stations existed. It comes back as a built line with none of
    // them, which is true, and the panel says so rather than the line quietly carrying on.
    const older = net.toJSON();
    for (const node of older.nodes) delete node.station;
    const opened = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(older)));
    expect(opened.stations()).toHaveLength(0);
    expect(opened.wayBetween(west, east)).toBeNull();
    expect(opened.edges.size).toBe(net.edges.size);
  });

  it('says nothing when the rails do not reach one of the places', () => {
    const net = line();
    expect(net.wayBetween(west, { x: 600, y: 64, z: 0 })).toBeNull();
    expect(net.wayBetween({ x: 600, y: 64, z: 0 }, east)).toBeNull();
  });

  it('joins two places whose outskirts overlap', () => {
    // Both ends of this run are inside the reach of both places, which is what two
    // villages fifty blocks apart look like. The walk has to set out from beyond the ends
    // that serve the origin, or it arrives before it has left and the pair reads as
    // having no railway between them at all.
    const { net } = eastward();
    stationsAt(net, { x: 0, z: 0 }, { x: 30, z: 0 });
    const way = net.wayBetween({ x: 0, y: 64, z: 0 }, { x: 26, y: 64, z: 0 });
    expect(way).not.toBeNull();
    expect(way!.points[0].x).toBeCloseTo(0, 6);
    expect(way!.points[way!.points.length - 1].x).toBeCloseTo(30, 6);
  });

  it('sets out from the end of the line the origin has the shortest walk to', () => {
    // Two ends inside the reach of both places again, and this time the nearer one to the
    // origin is the far end of the run. The freight should still start where its own
    // village would put it on board.
    const { net } = eastward();
    stationsAt(net, { x: 0, z: 0 }, { x: 30, z: 0 });
    const way = net.wayBetween({ x: 28, y: 64, z: 0 }, { x: 2, y: 64, z: 0 });
    expect(way!.points[0].x).toBeCloseTo(30, 6);
    expect(way!.points[way!.points.length - 1].x).toBeCloseTo(0, 6);
  });

  it('counts the up and down along the way rather than the ends of it', () => {
    const net = new TrackNetwork();
    const up = net.lay(end(0, 64, 0, 1, 0), end(40, 68, 0, 1, 0));
    if (!up.ok) throw new Error('could not lay the climb');
    const down = net.lay(end(40, 68, 0, 1, 0), end(80, 64, 0, 1, 0));
    if (!down.ok) throw new Error('could not lay the descent');
    stationsAt(net, { x: 0, z: 0 }, { x: 80, z: 0 });
    // A reach of five, so that the summit forty blocks along is not itself close enough
    // to both ends to count as the station for either of them.
    const way = net.wayBetween({ x: 0, y: 64, z: 0 }, { x: 80, y: 64, z: 0 }, 5);
    // Four up and four back down: a profile that ends where it started still cost the
    // climb, and a route that read the two ends alone would call this line flat.
    expect(way!.climb).toBeGreaterThan(7.5);
    expect(way!.climb).toBeLessThan(8.5);
  });

  it('reports the end of a half built line, nearest the place it is heading for', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the line');
    const head = net.railheadTowards({ x: 0, y: 64, z: 0 }, { x: 400, y: 64, z: 0 });
    expect(head?.x).toBeCloseTo(60, 6);
  });

  it('reports nothing at all where nothing serves the place it sets out from', () => {
    // A beacon over every village in the world would answer a question nobody asked.
    const net = line();
    expect(net.railheadTowards({ x: 900, y: 64, z: 0 }, west)).toBeNull();
  });

  it('forgets a way once the rails under it are pulled up', () => {
    const net = line();
    const middle = [...net.edges.values()].find((edge) => edge.curve.length > 0
      && pointAt(edge.curve, edge.curve.length / 2).x > 80
      && pointAt(edge.curve, edge.curve.length / 2).x < 100);
    expect(middle).toBeDefined();
    net.remove(middle!.id);
    expect(net.wayBetween(west, east)).toBeNull();
    expect(net.railheadTowards(west, east)?.x).toBeCloseTo(60, 6);
  });
});

describe('a railway saved before ports existed', () => {
  /** A network in the shape the old code wrote: one heading per node, and a sign per end
   *  of each curve — where the sign at a curve's *start* named the side it occupied and
   *  the sign at its *finish* named the side it left free. Two runs laid end to end, so
   *  the middle node holds one of each and the asymmetry is what is under test.
   *
   *  Written out by hand rather than produced by `toJSON`, because nothing writes this
   *  shape any more. If the reader ever stops understanding it, every railway anybody
   *  built before switches existed comes back as a heap of disconnected stubs. */
  const legacy = {
    nodes: [
      { id: 1, x: 0, y: 64, z: 0, hx: 1, hz: 0, grade: 0 },
      { id: 2, x: 30, y: 64, z: 0, hx: 1, hz: 0, grade: 0 },
      { id: 3, x: 60, y: 64, z: 0, hx: 1, hz: 0, grade: 0, station: true },
    ],
    edges: [
      { a: 1, b: 2, dirA: 1, dirB: 1 },
      { a: 2, b: 3, dirA: 1, dirB: 1 },
    ],
    nextId: 4,
  };

  it('comes back as one line rather than two stubs', () => {
    const net = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(legacy)));
    expect(net.nodes.size).toBe(3);
    expect(net.edges.size).toBe(2);
    // The middle node carries both runs, one per port, which is what makes it a joint.
    const middle = net.nodes.get(2)!;
    expect(edgesOf(middle)).toHaveLength(2);
    expect(freePorts(middle), 'the joint has a side left over').toHaveLength(0);
    // And the two outer nodes are ends with one side each still open.
    expect(freePorts(net.nodes.get(1)!)).toHaveLength(1);
    expect(freePorts(net.nodes.get(3)!)).toHaveLength(1);
  });

  it('keeps the shape the old numbers described', () => {
    const net = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(legacy)));
    for (const edge of net.edges.values()) {
      // Both runs are the straight line the old file said they were, not a loop back on
      // itself — which is what a port read the wrong way round would produce.
      expect(edge.curve.length).toBeCloseTo(30, 6);
      expect(edge.curve.minRadius).toBe(Infinity);
    }
    // The free end at the far side still carries on the way the line was going.
    const on = net.continuationAt(net.nodes.get(3)!);
    expect(on.hx).toBeCloseTo(1, 6);
  });

  it('keeps the station it was saved with', () => {
    const net = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(legacy)));
    expect(net.stations().map((node) => node.id)).toEqual([3]);
  });

  it('and a network saved now says which way its numbers should be read', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(30, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    expect(net.toJSON().ports, 'a new save did not mark itself').toBe(true);
  });
});

describe('cutting a run in two', () => {
  /** Shapes worth cutting: one that collapses to a single arc, and two real biarcs whose
   *  joint sits somewhere in the middle. The second kind is the whole difficulty — half of
   *  an equal-tangent biarc is not itself one. */
  function shapes(): { name: string; from: TrackAnchor; to: TrackAnchor }[] {
    return [
      { name: 'quarter turn', from: end(0, 64, 0, 1, 0), to: end(40, 64, 40, 0, 1) },
      { name: 'gentle bend', from: end(0, 64, 0, 1, 0), to: end(60, 64, 20, 1, 0) },
      { name: 'S bend', from: end(0, 64, 0, 1, 0), to: end(60, 64, 24, 1, 0) },
      { name: 'a climb', from: end(0, 64, 0, 1, 0, 0.05), to: end(60, 72, 18, 1, 0, 0.05) },
    ];
  }

  /** How far a point on the halves is from where the original run put it. */
  function drift(net: TrackNetwork, was: TrackCurve, ids: number[]): number {
    let worst = 0;
    let walked = 0;
    for (const id of ids) {
      const half = net.edges.get(id)!;
      for (let s = 0; s <= half.curve.length; s += 0.5) {
        const here = pointAt(half.curve, s);
        const there = pointAt(was, Math.min(walked + s, was.length));
        worst = Math.max(worst, Math.hypot(here.x - there.x, here.y - there.y, here.z - there.z));
      }
      walked += half.curve.length;
    }
    return worst;
  }

  it('leaves the track exactly where the player built it', () => {
    // The reason a curve remembers its joint. Without it, a cut past the joint re-solves
    // to a different biarc through the same ends and the run visibly walks sideways — by
    // over a block and a half on an S bend, which is not something a player would forgive.
    for (const shape of shapes()) {
      for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const net = new TrackNetwork();
        const laid = net.lay(shape.from, shape.to);
        if (!laid.ok) throw new Error(`could not lay the ${shape.name}: ${laid.fault}`);
        const was = laid.edge.curve;
        const cut = net.splitEdge(laid.edge.id, was.length * f);
        if (!cut.ok) throw new Error(`could not cut the ${shape.name} at ${f}: ${cut.fault}`);
        const moved = drift(net, was, cut.edges.map((edge) => edge.id));
        expect(moved, `the ${shape.name} moved when cut at ${f}`).toBeLessThan(0.01);
      }
    }
  });

  it('keeps the two halves adding up to the whole', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 24, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    const was = laid.edge.curve.length;
    const cut = net.splitEdge(laid.edge.id, was * 0.7);
    if (!cut.ok) throw new Error(`could not cut: ${cut.fault}`);
    const total = cut.edges[0].curve.length + cut.edges[1].curve.length;
    expect(total).toBeCloseTo(was, 4);
    expect(cut.edges[0].curve.length).toBeCloseTo(was * 0.7, 4);
  });

  it('leaves a joint with both sides taken and nothing free', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    const cut = net.splitEdge(laid.edge.id, 30);
    if (!cut.ok) throw new Error(`could not cut: ${cut.fault}`);
    expect(net.edges.size).toBe(2);
    expect(edgesOf(cut.node)).toHaveLength(2);
    expect(freePorts(cut.node), 'a cut left a side of the line open').toHaveLength(0);
    // And the line is still one line: the far end walks through the cut to the near one.
    expect(net.edgesNear(30, 0, 1)).toHaveLength(2);
  });

  it('refuses a cut too near either end to be a run', () => {
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 0, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    expect(net.splitEdge(laid.edge.id, MIN_SPAN - 0.1).ok).toBe(false);
    expect(net.splitEdge(laid.edge.id, 60 - MIN_SPAN + 0.1).ok).toBe(false);
    // And nothing was touched on the way to saying no.
    expect(net.edges.size).toBe(1);
    expect(net.nodes.size).toBe(2);
  });

  it('comes back the same shape from a save', () => {
    // The halves are not the equal-tangent biarcs of their own ends, so the joint has to
    // survive the round trip or a saved railway opens bent.
    const net = new TrackNetwork();
    const laid = net.lay(end(0, 64, 0, 1, 0), end(60, 64, 24, 1, 0));
    if (!laid.ok) throw new Error('could not lay the run');
    const was = laid.edge.curve;
    const cut = net.splitEdge(laid.edge.id, was.length * 0.75);
    if (!cut.ok) throw new Error(`could not cut: ${cut.fault}`);
    const back = TrackNetwork.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    expect(back.edges.size).toBe(2);
    const ids = [...back.edges.values()].sort((x, y) => x.a - y.a).map((edge) => edge.id);
    expect(drift(back, was, ids), 'the run bent on its way through a save').toBeLessThan(0.01);
  });
});
