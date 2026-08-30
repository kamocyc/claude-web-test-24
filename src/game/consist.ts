/** A train as several vehicles rather than one shape.
 *
 *  The freight itself is still a number between 0 and 1 — see `transport.ts` — and the
 *  locomotive is still only a picture of it. What this file adds is the rest of the
 *  picture: the cars behind the engine, where each of them is, and the flat tops somebody
 *  can stand on while they move.
 *
 *  **The cars follow where the engine went, not where it is.** A train long enough to be
 *  worth looking at is longer than the tightest curve the track solver allows, so a rigid
 *  row of boxes drawn behind the engine would swing clear of the rails on every bend. The
 *  engine therefore drops a breadcrumb every `TRAIL_STEP` and each car sits at its own
 *  distance back along that trail. It is the oldest trick there is and it is the right one
 *  here: the cars are literally on the line the engine drove, whatever shape it was, and
 *  nothing in this file has to know what a biarc is.
 *
 *  **Every dimension comes off the track.** The wheels sit on the gauge and the body is
 *  as wide as the sleepers minus a hand's breadth, so a train and the rails under it
 *  cannot drift apart when somebody changes one of them. That is also why the platform
 *  height lives in `tracks.ts` and is imported here rather than written down twice: a
 *  platform is level with a car floor because that is what a platform is. */

import { GAUGE, PLATFORM_TOP, TRACK_WIDTH } from './tracks';

export type CarKind = 'loco' | 'coach' | 'wagon';

/** Rail centre to rail centre, which is where the wheels go. */
export const WHEEL_SPAN = GAUGE;
/** Body width. A hand's breadth inside the sleepers, so the sleeper ends show. */
export const CAR_WIDTH = TRACK_WIDTH - 0.3;
/** Floor height over the railhead. The same number as the platform, and for the same
 *  reason: stepping between a platform and a carriage should be a step across, not up. */
export const CAR_FLOOR = PLATFORM_TOP;
/** Floor to the underside of the roof. Room to stand up in, which the coach needs and
 *  the wagons then inherit for free. */
export const CAR_HEIGHT = 2.1;
export const LOCO_LENGTH = 4.2;
export const CAR_LENGTH = 3.4;
/** Gap between one car's back and the next one's front. */
export const COUPLING = 0.5;

/** How often the engine drops a breadcrumb.
 *
 *  Small enough that the tightest curve the solver allows (radius 6) is cut into arcs of
 *  under four degrees, so a car sitting on a chord between two of them is at most
 *  0.01 blocks off the true line — invisible. Large enough that a train crossing a
 *  hundred blocks keeps a few hundred points and not a few thousand. */
export const TRAIL_STEP = 0.4;

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

export interface CarPose extends TrailPoint {
  kind: CarKind;
  /** The mob convention: `atan2(-forwardX, -forwardZ)`, so a model's own -z is the way it
   *  is going. See `Mob.yaw`. */
  yaw: number;
}

/** The cars a train carrying this many loads runs with.
 *
 *  Always a coach behind the engine, whatever the freight is doing. It is the one car on
 *  the train that is not there to earn anything: it is there so that a player who built the
 *  railway can get on it, and a train that only sometimes had somewhere to sit would make
 *  that a thing to wait for rather than a thing to do.
 *
 *  `people` swaps the rest of the train for coaches too. A town's passengers ride a line
 *  the player built for crates, and the one place that is visible is out of the window: a
 *  trainload of people that looked like a goods train would say nothing at all. */
export function consistOf(cars: number, people = false): CarKind[] {
  const kinds: CarKind[] = ['loco', 'coach'];
  const rest: CarKind = people ? 'coach' : 'wagon';
  for (let i = 0; i < Math.max(0, Math.floor(cars)); i++) kinds.push(rest);
  return kinds;
}

export function lengthOf(kind: CarKind): number {
  return kind === 'loco' ? LOCO_LENGTH : CAR_LENGTH;
}

/** How far behind the engine's middle each car's middle sits.
 *
 *  Measured from the engine and not from the nose, because the engine is where the mob is
 *  and the mob is where the shipment is. The first offset is therefore zero. */
export function offsetsOf(kinds: readonly CarKind[]): number[] {
  const out: number[] = [];
  let back = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i > 0) back += lengthOf(kinds[i - 1]) / 2 + COUPLING + lengthOf(kinds[i]) / 2;
    out.push(back);
  }
  return out;
}

/** From the engine's middle to the back of the last car. What the trail has to cover. */
export function consistLength(kinds: readonly CarKind[]): number {
  const offsets = offsetsOf(kinds);
  if (offsets.length === 0) return 0;
  return offsets[offsets.length - 1] + lengthOf(kinds[kinds.length - 1]) / 2;
}

/** Records where the head of the train is now, keeping enough of where it has been.
 *
 *  `trail[0]` is always the head exactly; everything after it is a breadcrumb. Keeping the
 *  head separate is what stops a train that has stopped moving from slowly eating the
 *  trail behind it — the cars have to stay where they are while it stands at a platform,
 *  and they only do that if the points under them are left alone. */
export function pushTrail(trail: TrailPoint[], head: TrailPoint, keep: number): void {
  if (trail.length === 0) {
    trail.push({ ...head }, { ...head });
    return;
  }
  trail[0] = { ...head };
  const last = trail[1];
  if (!last || Math.hypot(head.x - last.x, head.z - last.z) >= TRAIL_STEP) {
    trail.splice(1, 0, { ...head });
  }
  let run = 0;
  for (let i = 1; i < trail.length; i++) {
    run += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
    if (run > keep) {
      trail.length = i + 1;
      return;
    }
  }
}

/** Lays a straight trail out behind a head that has not moved yet.
 *
 *  A train drawn on the frame it appeared would otherwise pile its whole consist on top of
 *  the engine, which is a stack of boxes rather than a train — and it happens every time
 *  the player walks back into range of a line they left running. */
export function seedTrail(head: TrailPoint, forwardX: number, forwardZ: number, keep: number): TrailPoint[] {
  const flat = Math.hypot(forwardX, forwardZ) || 1;
  const fx = forwardX / flat;
  const fz = forwardZ / flat;
  const trail: TrailPoint[] = [];
  for (let back = 0; back <= keep + TRAIL_STEP; back += TRAIL_STEP) {
    trail.push({ x: head.x - fx * back, y: head.y, z: head.z - fz * back });
  }
  return trail;
}

/** The point `distance` back along the trail, and which way the track ran there.
 *
 *  Past the end of the trail it answers with the tail rather than with nothing: a train
 *  that has only just set off is shorter than its own consist, and the alternative to
 *  bunching the last cars up at the end of what it has driven is not drawing them at all. */
export function alongTrail(trail: readonly TrailPoint[], distance: number): TrailPoint & { fx: number; fz: number } | null {
  if (trail.length === 0) return null;
  if (trail.length === 1) return { ...trail[0], fx: 0, fz: -1 };
  let run = 0;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    if (span < 1e-9) continue;
    // Forward is from the older point towards the newer one, which is b towards a.
    const fx = (a.x - b.x) / span;
    const fz = (a.z - b.z) / span;
    if (run + span >= distance) {
      const t = (distance - run) / span;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        fx,
        fz,
      };
    }
    run += span;
  }
  const tail = trail[trail.length - 1];
  const before = trail[trail.length - 2];
  const span = Math.hypot(before.x - tail.x, before.z - tail.z) || 1;
  return { ...tail, fx: (before.x - tail.x) / span, fz: (before.z - tail.z) / span };
}

/** Where every car of a train is, given where its engine has been. */
export function posesAlong(trail: readonly TrailPoint[], kinds: readonly CarKind[]): CarPose[] {
  const offsets = offsetsOf(kinds);
  const out: CarPose[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const at = alongTrail(trail, offsets[i]);
    if (!at) continue;
    out.push({
      kind: kinds[i],
      x: at.x,
      y: at.y,
      z: at.z,
      yaw: Math.atan2(-at.fx, -at.fz),
    });
  }
  return out;
}

// --- standing on a moving train -----------------------------------------------

// --- cutting a way through ------------------------------------------------------

/** How wide a corridor a train needs, across the track.
 *
 *  Wider than the 1.7 a body is, and wider than the 2.0 the sleepers are: what the number
 *  has to cover is not the vehicle but the room around it a player would expect a railway
 *  to have. At the body's own width a train would arrive at a cutting with rock a
 *  finger's breadth from the windows and call it clear. */
export const CLEARANCE_WIDTH = 2.8;

/** Every block cell one car is standing in: its own rectangle on the ground, from just
 *  over the railhead up to the top of a roof.
 *
 *  From *over* the railhead because everything below it is what holds the track up. A
 *  train that cut the embankment out from under itself as it ran would be through the
 *  floor of its own line by the second lap.
 *
 *  The cell test is a separating-axis one over four axes — the car's two and the world's
 *  two — because the car is at whatever angle the track left it at and the cells are
 *  square. Testing the car's axes alone would claim a cell that only its corner is near. */
export function clearanceCells(pose: CarPose): TrailPoint[] {
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const rx = -fz;
  const rz = fx;
  const halfLong = lengthOf(pose.kind) / 2;
  const halfWide = CLEARANCE_WIDTH / 2;
  const bottom = Math.floor(pose.y + 0.05);
  const top = Math.floor(pose.y + ROOF_TOP - 0.05);
  const reach = Math.hypot(halfLong, halfWide) + 1;
  const cells: TrailPoint[] = [];
  for (let x = Math.floor(pose.x - reach); x <= Math.floor(pose.x + reach); x++) {
    for (let z = Math.floor(pose.z - reach); z <= Math.floor(pose.z + reach); z++) {
      const dx = x + 0.5 - pose.x;
      const dz = z + 0.5 - pose.z;
      if (Math.abs(dx * fx + dz * fz) > halfLong + (Math.abs(fx) + Math.abs(fz)) / 2) continue;
      if (Math.abs(dx * rx + dz * rz) > halfWide + (Math.abs(rx) + Math.abs(rz)) / 2) continue;
      if (Math.abs(dx) > halfLong * Math.abs(fx) + halfWide * Math.abs(rx) + 0.5) continue;
      if (Math.abs(dz) > halfLong * Math.abs(fz) + halfWide * Math.abs(rz) + 0.5) continue;
      for (let y = bottom; y <= top; y++) cells.push({ x, y, z });
    }
  }
  return cells;
}

/** A flat top on a vehicle: an oriented rectangle at a height, not a box.
 *
 *  Oriented because a train at forty-five degrees inside an axis-aligned box would be
 *  half as wide again as the track it is on, and a player would be held up by thin air
 *  beside it. Rectangles rather than boxes because nothing here is solid from the side —
 *  the same bargain the viaduct's piers already made. You can be held up by a carriage
 *  and you can walk through the wall of one, and of those two the first is the one worth
 *  having. */
export interface CarDeck {
  /** Stable for as long as the car exists, so whoever is standing on one is carried by the
   *  same one from frame to frame. */
  id: string;
  x: number;
  z: number;
  /** Unit forward in XZ. */
  fx: number;
  fz: number;
  halfLong: number;
  halfWide: number;
  top: number;
}

/** Height of a wagon's load over the rails: what standing on one means. */
export const WAGON_TOP = CAR_FLOOR + 1.0;
/** Top of a roof, so the outside of a carriage is something to climb on as well as the
 *  inside. The engine's cab is built up to the same height, which is what makes a train
 *  read as one thing rather than as a shed towing some boxes. */
export const ROOF_TOP = CAR_FLOOR + CAR_HEIGHT + 0.14;
/** How far behind the engine's middle the cab is, and how long it is. */
export const CAB_BACK = 1.2;
export const CAB_LONG = 1.6;

/** The decks one car offers.
 *
 *  A coach has two — the floor inside it and the roof over that — and which of them
 *  somebody is standing on is decided by where they already are, because the window a
 *  surface is asked about is a third of a block tall. So a player walks in off the
 *  platform and stands on the floor; a player who jumps on from above stands on the roof;
 *  and neither of them has to be told which. */
export function decksOf(id: string, pose: CarPose): CarDeck[] {
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const base = { x: pose.x, z: pose.z, fx, fz, halfWide: CAR_WIDTH / 2 };
  const halfLong = lengthOf(pose.kind) / 2;
  if (pose.kind === 'coach') {
    return [
      { ...base, id: `${id}:floor`, halfLong: halfLong - 0.2, top: pose.y + CAR_FLOOR },
      { ...base, id: `${id}:roof`, halfLong, top: pose.y + ROOF_TOP },
    ];
  }
  if (pose.kind === 'wagon') {
    return [{ ...base, id: `${id}:load`, halfLong: halfLong - 0.2, top: pose.y + WAGON_TOP }];
  }
  // Only the cab of the engine: the boiler in front of it is round in spirit and sloped in
  // fact, and standing on one would be standing on nothing anybody drew.
  return [{
    ...base,
    id: `${id}:cab`,
    x: pose.x - fx * CAB_BACK,
    z: pose.z - fz * CAB_BACK,
    halfLong: CAB_LONG / 2,
    top: pose.y + ROOF_TOP,
  }];
}

/** Where a point in the world is on a deck: along the car, and across it. */
export function onDeck(deck: CarDeck, x: number, z: number): { along: number; across: number } {
  const dx = x - deck.x;
  const dz = z - deck.z;
  return { along: dx * deck.fx + dz * deck.fz, across: dx * deck.fz - dz * deck.fx };
}

/** And back again. The transform is its own inverse, which is what makes standing in a
 *  carriage cheap: a rider is remembered as two numbers in the car's own frame and put
 *  back at them every frame, so the car may turn as well as move and they turn with it. */
export function offDeck(deck: CarDeck, along: number, across: number): { x: number; z: number } {
  return {
    x: deck.x + along * deck.fx + across * deck.fz,
    z: deck.z + along * deck.fz - across * deck.fx,
  };
}

/** Whether a point in the world is over a deck. */
export function overDeck(deck: CarDeck, x: number, z: number): boolean {
  const at = onDeck(deck, x, z);
  return Math.abs(at.along) <= deck.halfLong && Math.abs(at.across) <= deck.halfWide;
}

/** Everything a player can stand on that is currently driving somewhere.
 *
 *  Rebuilt from the trains every frame, which is also how it knows how far each deck has
 *  moved: the answer to "carry whoever is on this" is the difference between the two most
 *  recent frames, and asking the deck itself for its velocity would mean the vehicles
 *  keeping one. */
export class RideDecks {
  private decks: CarDeck[] = [];
  private index = new Map<string, CarDeck>();

  update(decks: CarDeck[]): void {
    this.decks = decks;
    this.index = new Map(decks.map((deck) => [deck.id, deck]));
  }

  clear(): void {
    this.decks = [];
    this.index = new Map();
  }

  /** The deck a rider is standing on, wherever it has got to. Null once it is gone, which
   *  is how they find out the train has been despawned out from under them. */
  byId(id: string): CarDeck | null {
    return this.index.get(id) ?? null;
  }

  get count(): number {
    return this.decks.length;
  }

  /** The highest deck under a point whose top is in the window, and nothing outside it. */
  surfaceTopAt(x: number, z: number, low: number, high: number): number | null {
    return this.deckAt(x, z, low, high)?.top ?? null;
  }

  deckAt(x: number, z: number, low: number, high: number): CarDeck | null {
    let best: CarDeck | null = null;
    for (const deck of this.decks) {
      if (deck.top < low || deck.top > high) continue;
      if (!overDeck(deck, x, z)) continue;
      if (best === null || deck.top > best.top) best = deck;
    }
    return best;
  }

}
