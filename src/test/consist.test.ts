import { describe, expect, it } from 'vitest';
import {
  CAR_FLOOR,
  CAR_LENGTH,
  COUPLING,
  LOCO_LENGTH,
  ROOF_TOP,
  RideDecks,
  TRAIL_STEP,
  WAGON_TOP,
  alongTrail,
  consistLength,
  consistOf,
  decksOf,
  offDeck,
  offsetsOf,
  onDeck,
  overDeck,
  posesAlong,
  pushTrail,
  seedTrail,
  type CarPose,
  type TrailPoint,
} from '../game/consist';
import { PLATFORM_TOP } from '../game/tracks';

/** A trail running east, newest first, as `pushTrail` leaves one. */
function eastward(from: number, back: number): TrailPoint[] {
  const trail: TrailPoint[] = [];
  for (let d = 0; d <= back; d += TRAIL_STEP) trail.push({ x: from - d, y: 64, z: 0 });
  return trail;
}

/** The shortest distance from a point to a polyline, which is what "on the line the engine
 *  drove" means when the line is a row of breadcrumbs. */
function offTrail(trail: readonly TrailPoint[], at: { x: number; z: number }): number {
  let best = Infinity;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = dx * dx + dz * dz;
    const t = span < 1e-12 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.z - a.z) * dz) / span));
    best = Math.min(best, Math.hypot(at.x - (a.x + dx * t), at.z - (a.z + dz * t)));
  }
  return best;
}

describe('what a train is made of', () => {
  it('always runs a coach, whatever the freight is doing', () => {
    // The one car that earns nothing. A train that only sometimes had somewhere to sit
    // would make riding it a thing to wait for rather than a thing to do.
    expect(consistOf(0)).toEqual(['loco', 'coach']);
    expect(consistOf(3)).toEqual(['loco', 'coach', 'wagon', 'wagon', 'wagon']);
    // A trainload of people is coaches all the way back, which is the one place the
    // difference between freight and passengers is visible from outside the train.
    expect(consistOf(3, true)).toEqual(['loco', 'coach', 'coach', 'coach', 'coach']);
  });

  it('spaces the cars a coupling apart, measured from the engine', () => {
    const offsets = offsetsOf(consistOf(2));
    expect(offsets[0], 'the engine is not at the head of its own train').toBe(0);
    expect(offsets[1]).toBeCloseTo(LOCO_LENGTH / 2 + COUPLING + CAR_LENGTH / 2, 6);
    expect(offsets[2] - offsets[1]).toBeCloseTo(CAR_LENGTH + COUPLING, 6);
  });

  it('measures itself from the engine to the back of the last car', () => {
    const kinds = consistOf(1);
    const offsets = offsetsOf(kinds);
    expect(consistLength(kinds)).toBeCloseTo(offsets[offsets.length - 1] + CAR_LENGTH / 2, 6);
  });
});

describe('the trail a train leaves', () => {
  it('keeps the head exactly and drops a breadcrumb no oftener than the step', () => {
    const trail: TrailPoint[] = [];
    pushTrail(trail, { x: 0, y: 64, z: 0 }, 20);
    for (let i = 1; i <= 20; i++) pushTrail(trail, { x: i * 0.1, y: 64, z: 0 }, 20);
    expect(trail[0].x, 'the head is not where the engine is').toBeCloseTo(2, 6);
    for (let i = 2; i < trail.length; i++) {
      const gap = Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
      expect(gap, `breadcrumbs ${i - 1} and ${i} are closer than a step`)
        .toBeGreaterThanOrEqual(TRAIL_STEP - 1e-9);
    }
  });

  it('leaves the cars where they are while the train stands at a platform', () => {
    // The head moves onto the breadcrumb behind it every frame a train is stopped. If that
    // ate the trail, a standing train's cars would slide forwards into the engine.
    const trail = eastward(0, 20);
    const before = trail.length;
    const tail = { ...trail[trail.length - 1] };
    for (let i = 0; i < 60; i++) pushTrail(trail, { x: 0, y: 64, z: 0 }, 20);
    // One breadcrumb may be dropped where the engine came to rest, and then no more:
    // sixty frames of standing still must not eat sixty blocks of trail.
    expect(trail.length).toBeLessThanOrEqual(before + 1);
    expect(trail[trail.length - 1]).toEqual(tail);
  });

  it('throws away the trail it no longer needs', () => {
    const trail: TrailPoint[] = [];
    for (let i = 0; i <= 400; i++) pushTrail(trail, { x: i * 0.25, y: 64, z: 0 }, 12);
    let run = 0;
    for (let i = 1; i < trail.length; i++) run += Math.hypot(trail[i].x - trail[i - 1].x, 0);
    expect(run).toBeLessThan(12 + TRAIL_STEP * 2);
    expect(run, 'trimmed away trail the train still stands on').toBeGreaterThan(12);
  });

  it('lays a straight one out behind a train that has only just set off', () => {
    const trail = seedTrail({ x: 0, y: 64, z: 0 }, 1, 0, 20);
    expect(trail[0]).toEqual({ x: 0, y: 64, z: 0 });
    const back = alongTrail(trail, 15);
    expect(back!.x).toBeCloseTo(-15, 6);
    expect(back!.fx, 'the seeded trail runs the wrong way').toBeCloseTo(1, 6);
  });
});

describe('where the cars end up', () => {
  it('puts them behind the engine, in order, at their own offsets', () => {
    const kinds = consistOf(2);
    const poses = posesAlong(eastward(0, 40), kinds);
    expect(poses.map((p) => p.kind)).toEqual(kinds);
    const offsets = offsetsOf(kinds);
    for (let i = 0; i < poses.length; i++) expect(poses[i].x).toBeCloseTo(-offsets[i], 4);
    // Facing the way the engine is going, which is east: the mob convention is
    // `atan2(-fx, -fz)`, so east is -90 degrees.
    expect(poses[0].yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('follows the line round a bend instead of cutting the corner', () => {
    // The whole reason the cars are placed off a trail. A train is longer than the
    // tightest curve the solver allows, so a rigid row of boxes drawn behind the engine
    // would swing clear of the rails on every bend.
    // Drove north up the z axis for thirty blocks, turned, and has run twelve east since:
    // the corner is nearer the head than the train is long, so the tail is still round it.
    const trail: TrailPoint[] = [];
    for (let d = 0; d <= 30; d += TRAIL_STEP) trail.push({ x: 0, y: 64, z: -d });
    for (let d = TRAIL_STEP; d <= 12; d += TRAIL_STEP) trail.unshift({ x: d, y: 64, z: 0 });
    const poses = posesAlong(trail, consistOf(4));
    expect(poses).toHaveLength(6);
    for (const pose of poses) {
      expect(offTrail(trail, pose), `a ${pose.kind} came off the line at (${pose.x}, ${pose.z})`)
        .toBeLessThan(0.05);
    }
    // And it really did go round the corner: the back of the train is up the other leg.
    const last = poses[poses.length - 1];
    expect(last.z, 'the tail cut the corner instead of following it').toBeLessThan(-1);
  });

  it('bunches the tail at the end of a trail shorter than the train', () => {
    // A train that has only just set off has driven less than its own length. Drawing the
    // cars it has no trail for is better than not drawing them.
    const poses = posesAlong(eastward(0, 4), consistOf(4));
    expect(poses).toHaveLength(6);
    for (const pose of poses) expect(pose.x).toBeGreaterThanOrEqual(-4.001);
  });
});

describe('standing on a train', () => {
  const east: CarPose = { kind: 'coach', x: 0, y: 64, z: 0, yaw: -Math.PI / 2 };

  it('gives a coach a floor to walk into and a roof to climb on', () => {
    const decks = decksOf('1:1', east);
    expect(decks.map((d) => d.id)).toEqual(['1:1:floor', '1:1:roof']);
    expect(decks[0].top).toBeCloseTo(64 + CAR_FLOOR, 6);
    expect(decks[1].top).toBeCloseTo(64 + ROOF_TOP, 6);
  });

  it('puts the carriage floor level with the platform, so boarding is a step across', () => {
    expect(CAR_FLOOR).toBe(PLATFORM_TOP);
  });

  it('stands somebody on the load of a wagon and the cab of an engine', () => {
    const wagon = decksOf('1:2', { ...east, kind: 'wagon' });
    expect(wagon).toHaveLength(1);
    expect(wagon[0].top).toBeCloseTo(64 + WAGON_TOP, 6);
    const loco = decksOf('1:0', { ...east, kind: 'loco' });
    expect(loco[0].top).toBeCloseTo(64 + ROOF_TOP, 6);
    // The cab is at the back of the engine, not in the middle of it: the boiler in front
    // of it is not something anybody drew a floor on.
    expect(loco[0].x, 'the cab is not behind the middle of the engine').toBeLessThan(0);
  });

  it('is a rectangle turned the way the car is, not a box round it', () => {
    // A carriage at forty-five degrees inside an axis-aligned box is half as wide again as
    // the track, and a player would be held up by thin air beside it.
    const [floor] = decksOf('1:1', { ...east, yaw: -Math.PI / 4 });
    // Along the car: well inside it. Across the car by the same distance: well outside.
    const reach = CAR_LENGTH / 2 - 0.5;
    const along = { x: reach * Math.SQRT1_2, z: -reach * Math.SQRT1_2 };
    const across = { x: reach * Math.SQRT1_2, z: reach * Math.SQRT1_2 };
    expect(overDeck(floor, along.x, along.z)).toBe(true);
    expect(overDeck(floor, across.x, across.z)).toBe(false);
  });

  it('answers with the deck the player is already near, so a coach is not a lid', () => {
    const decks = new RideDecks();
    decks.update(decksOf('1:1', east));
    // Standing inside on the floor.
    expect(decks.surfaceTopAt(0, 0, 64 + CAR_FLOOR - 0.3, 64 + CAR_FLOOR + 0.3))
      .toBeCloseTo(64 + CAR_FLOOR, 6);
    // Landing on the roof from above.
    expect(decks.surfaceTopAt(0, 0, 64 + ROOF_TOP - 0.3, 64 + ROOF_TOP + 0.3))
      .toBeCloseTo(64 + ROOF_TOP, 6);
    // And nothing at all beside the train.
    expect(decks.surfaceTopAt(9, 0, 0, 200)).toBeNull();
  });

  it('carries a rider round a bend, not just along a straight', () => {
    // The reason a ride is two numbers in the car's own frame rather than a world
    // position moved by however far the car moved: a train turns as well as travels, and
    // somebody held on by translation alone slides off the outside of every curve.
    const decks = new RideDecks();
    decks.update(decksOf('1:1', east));
    const floor = decks.byId('1:1:floor')!;
    // Standing a block back from the middle of the carriage. It faces east, so a block
    // back from the middle is a block west of it.
    const seat = onDeck(floor, -1.0, 0);
    expect(seat.along).toBeCloseTo(-1.0, 6);
    expect(seat.across).toBeCloseTo(0, 6);

    // The carriage has moved on and swung ninety degrees round.
    decks.update(decksOf('1:1', { ...east, x: 40, z: -40, yaw: Math.PI }));
    const turned = decks.byId('1:1:floor')!;
    const carried = offDeck(turned, seat.along, seat.across);
    // Still at the back of it, which is now the north end, and still on the deck.
    expect(overDeck(turned, carried.x, carried.z)).toBe(true);
    expect(carried.z, 'the rider did not turn with the carriage').toBeCloseTo(-41, 6);
  });

  it('loses the ride when the train it was on is gone', () => {
    const decks = new RideDecks();
    decks.update(decksOf('1:1', east));
    expect(decks.byId('1:1:floor')).not.toBeNull();
    decks.update([]);
    expect(decks.byId('1:1:floor')).toBeNull();
  });
});
