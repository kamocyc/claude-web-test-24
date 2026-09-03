import {
  CAB_BACK,
  CAB_LONG,
  CAR_FLOOR,
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  LOCO_LENGTH,
  ROOF_TOP,
  WAGON_TOP,
  WHEEL_SPAN,
  type CarKind,
} from '../game/consist';
import type { MobKind } from '../game/mobs/types';
import { CREATURES, type CreatureKind } from './creatureModels';
import type { GaitName } from './mobAnimation';
import { MOB } from './palette';

/**
 * A frame that can turn, named after the body part it drives.
 *
 * A joint is what a part hangs off. The point of naming them is that the
 * animator works from the names alone — it never asks what kind of mob it is
 * driving — so a species gets its motion by growing the joint, not by growing a
 * special case in the renderer.
 */
export type JointName =
  | 'head' | 'neck' | 'jaw'
  | 'armLeft' | 'armRight'
  | 'legFrontLeft' | 'legFrontRight'
  | 'legMidFrontLeft' | 'legMidFrontRight'
  | 'legMidBackLeft' | 'legMidBackRight'
  | 'legBackLeft' | 'legBackRight'
  | 'earLeft' | 'earRight'
  | 'wingLeft' | 'wingRight'
  | 'tail' | 'tailTip';

/** Where a part hangs. `body` and `detail` ride the mob itself and never move. */
export type PartRole = JointName | 'body' | 'detail';

/**
 * What a part is made of.
 *
 * Everything used to be a box, which is most of why one animal read much like
 * the next. A muzzle that narrows, a barrel of a body and a fleece of round
 * puffs are three different shapes, and no arrangement of boxes says them.
 */
export type PartShape =
  /** A box with every edge bevelled to suit its own smallest dimension. */
  | 'box'
  /** A cylinder along Y, scaled to the part's box — a limb, a neck, a tail. */
  | 'cylinder'
  /** A cylinder whose top is `taper` times the bottom — a muzzle, a horn. */
  | 'taper'
  /** An ellipsoid — a fleece puff, an abdomen, a nose. */
  | 'sphere';

export interface ModelPart {
  /** Width (x), height (y), depth (z) in blocks. */
  size: [number, number, number];
  /** Centre of the part relative to the mob's feet. */
  offset: [number, number, number];
  color: number;
  role: PartRole;
  /** Default `box`. */
  shape?: PartShape;
  /** Rest rotation about the part's own centre, radians, applied Z then X then Y.
   *  This is what lets a leg splay, a horn angle out and an ear lie back without
   *  a joint of its own. */
  rotation?: [number, number, number];
  /** Bevel as a fraction of the part's smallest dimension. Default 0.2. */
  round?: number;
  /** `taper` only: the top's radius as a fraction of the bottom's. */
  taper?: number;
  /** Sides on the round shapes. Default 10; fewer for something tiny. */
  segments?: number;
  /** A second colour at the top of the part, blended down its height. Flat
   *  pastel boxes are what made these read as toys; a little shading is the
   *  cheapest thing that stops them. */
  tip?: number;
}

/**
 * Where a joint turns, and how it hangs at rest.
 *
 * `pivot` is in the same rest space as every `offset` — measured from the mob's
 * feet — so a model can be read and checked without composing any transforms.
 * The renderer converts to joint-local space once, when it builds the meshes.
 */
export interface Joint {
  name: JointName;
  pivot: [number, number, number];
  /** The joint this one hangs off. Absent means it hangs off the mob. */
  parent?: JointName;
  /** How the joint sits when nothing is driving it: a dog's ear hangs down. */
  rest?: [number, number, number];
  /** Scales whatever the gait asks of this joint. 0 pins it — which is how a
   *  zombie holds its arms out, rather than by a check on the kind. */
  gain?: number;
  /** Radians added to this joint's own clock. Eight spider legs ripple on it. */
  phase?: number;
}

/** A mob's shape and its rig. `gait` names a row of the animator's table. */
export interface MobModel {
  parts: ModelPart[];
  joints: Joint[];
  gait: GaitName;
}

/** Rolling stock, in the same soft palette as the rest of the world: a coral engine,
 *  honey wagons and teal carriages, all of it on plum-grey wheels. The names say what
 *  each colour is on rather than what it is made of, because none of it is black iron
 *  any more. */
const BOILER = 0xef8577;
const CAB = 0xd76d63;
/** Frames, wheels and the chimney — the parts that read as "underneath". */
const CHASSIS = 0x6f5f78;
const TIMBER = 0xd3a26a;
const TIMBER_DARK = 0xa8794b;
const CRATE = 0xe2c188;
const COACH_SIDE = 0x6fb9a8;
const COACH_TRIM = 0xa8dbcd;
const GLASS = 0xc6e6f4;
const ROOF = 0xf6ecdb;
const FIRE = 0xffb454;

/** The team and the coach they pull. A horse is not one of the game's creatures — there
 *  is no horse to ride — so it is drawn here, beside the vehicle it exists to pull, and
 *  in the same soft palette as everything else on the road. */
const HORSE = 0xb5825c;
const HORSE_DEEP = 0x8c6142;
const HORSE_MANE = 0x6b4a34;
const BUS_SIDE = 0x8fa9d8;
const BUS_TRIM = 0xf2e5c8;

/** The hull, the deck and what stands on it. A small steamer, which is what a world with
 *  a working locomotive in it would have on the water. */
const HULL = 0x7a5b46;
const HULL_DEEP = 0x59422f;
const DECK = 0xd8b782;
const CABIN = 0xf3ead6;
const FUNNEL = 0xd76d63;

/** How wide the way into a carriage is. A player is 0.6 across, so this is room to walk
 *  through without aiming. */
const DOORWAY = 1.3;

const HALF_WIDE = CAR_WIDTH / 2;
/** Axle centre height. The wheels are half of this across, so they stand on the rails. */
const AXLE = 0.42;
const WHEEL = 0.84;

/** A pair of wheels on an axle, drawn as one box across the gauge: at this scale the gap
 *  between two discs would be a stripe of daylight nobody asked about. */
function axle(z: number): ModelPart {
  return { size: [WHEEL_SPAN + 0.3, WHEEL, WHEEL * 0.4], offset: [0, AXLE, z], color: CHASSIS, role: 'body' };
}

/** A pair of horses and the coach behind them.
 *
 *  It has to read as "people, not crates" from the side of the road — that is the entire
 *  reason it exists rather than another cart — so the body is a proper coach with windows
 *  along it and a roof over them, and it is the horses in front that say why it is
 *  quicker. The legs carry the trot roles; everything else rides along.
 *
 *  The wheels are cylinders lying on their axles rather than the thin boxes the cart uses.
 *  At a cart's scale a bevelled slab reads as a wheel; at this one, four of them read as
 *  table legs, and the whole thing stops being a carriage. */
function omnibus(): ModelPart[] {
  /** A wheel: a disc in the plane of travel, turned onto an axle along x. */
  const wheel = (x: number, z: number, size: number): ModelPart => ({
    size: [size, 0.16, size],
    offset: [x, size / 2, z],
    color: CHASSIS,
    role: 'body',
    shape: 'cylinder',
    rotation: [Math.PI / 2, 0, 0],
    segments: 12,
  });
  const horse = (side: -1 | 1): ModelPart[] => {
    const x = side * 0.42;
    return [
      { size: [0.56, 0.72, 1.5], offset: [x, 1.36, -1.65], color: HORSE, role: 'body', tip: HORSE_DEEP },
      // Neck and head, carried high: a team at a trot is the whole reason a bus is quick.
      { size: [0.34, 0.8, 0.42], offset: [x, 1.82, -2.28], color: HORSE, role: 'head', rotation: [0, 0.5, 0] },
      { size: [0.3, 0.34, 0.62], offset: [x, 2.06, -2.62], color: HORSE_DEEP, role: 'head' },
      { size: [0.1, 0.16, 0.1], offset: [x - 0.1, 2.24, -2.44], color: HORSE_DEEP, role: 'head' },
      { size: [0.1, 0.16, 0.1], offset: [x + 0.1, 2.24, -2.44], color: HORSE_DEEP, role: 'head' },
      { size: [0.18, 0.5, 0.44], offset: [x, 1.94, -2.02], color: HORSE_MANE, role: 'detail' },
      { size: [0.16, 0.56, 0.16], offset: [x, 1.32, -0.86], color: HORSE_MANE, role: 'tail' },
      { size: [0.2, 1.0, 0.2], offset: [x - 0.14, 0.5, -2.16], color: HORSE_DEEP, role: 'legFrontLeft', shape: 'cylinder' },
      { size: [0.2, 1.0, 0.2], offset: [x + 0.14, 0.5, -2.16], color: HORSE_DEEP, role: 'legFrontRight', shape: 'cylinder' },
      { size: [0.2, 1.0, 0.2], offset: [x - 0.14, 0.5, -1.12], color: HORSE_DEEP, role: 'legBackLeft', shape: 'cylinder' },
      { size: [0.2, 1.0, 0.2], offset: [x + 0.14, 0.5, -1.12], color: HORSE_DEEP, role: 'legBackRight', shape: 'cylinder' },
    ];
  };
  return [
    ...horse(-1),
    ...horse(1),
    // The pole between the two horses and the shafts back to the coach.
    { size: [0.1, 0.1, 1.8], offset: [0, 1.24, -1.6], color: TIMBER_DARK, role: 'body' },
    { size: [0.09, 0.09, 1.3], offset: [-0.5, 1.16, -0.7], color: TIMBER_DARK, role: 'body' },
    { size: [0.09, 0.09, 1.3], offset: [0.5, 1.16, -0.7], color: TIMBER_DARK, role: 'body' },
    // The coach: a sprung body with a window band down each side, a driver's bench out in
    // front of the passengers, and a rail round the roof for what will not fit inside.
    { size: [1.36, 0.26, 2.5], offset: [0, 1.0, 0.55], color: CHASSIS, role: 'body' },
    { size: [1.3, 1.16, 2.42], offset: [0, 1.72, 0.5], color: BUS_SIDE, role: 'body' },
    { size: [1.34, 0.42, 1.86], offset: [0, 1.94, 0.5], color: GLASS, role: 'body' },
    { size: [1.34, 0.16, 0.5], offset: [0, 1.42, -0.72], color: BUS_TRIM, role: 'body' },
    { size: [1.42, 0.14, 2.56], offset: [0, 2.36, 0.5], color: BUS_TRIM, role: 'body' },
    { size: [1.44, 0.12, 0.1], offset: [0, 2.48, 1.72], color: TIMBER_DARK, role: 'detail' },
    { size: [0.1, 0.12, 2.5], offset: [-0.66, 2.48, 0.5], color: TIMBER_DARK, role: 'detail' },
    { size: [0.1, 0.12, 2.5], offset: [0.66, 2.48, 0.5], color: TIMBER_DARK, role: 'detail' },
    // The driver's bench, ahead of the body and over the shafts.
    { size: [1.16, 0.3, 0.56], offset: [0, 1.9, -0.86], color: TIMBER, role: 'body' },
    { size: [1.16, 0.42, 0.12], offset: [0, 2.16, -0.62], color: TIMBER_DARK, role: 'body' },
    wheel(-0.7, -0.3, 0.7),
    wheel(0.7, -0.3, 0.7),
    wheel(-0.72, 1.3, 1.0),
    wheel(0.72, 1.3, 1.0),
  ];
}

/** A small coasting steamer.
 *
 *  Half of it is under the origin on purpose: the mob's feet are the waterline — see the
 *  surface it is given in `Game.spawnPorter` — so a hull drawn from -0.5 upwards is a hull
 *  sitting *in* the water rather than a boat-shaped thing balanced on top of it. */
function steamer(): ModelPart[] {
  return [
    { size: [2.2, 1.0, 4.6], offset: [0, 0.0, 0.3], color: HULL, role: 'body', tip: HULL_DEEP },
    // the bow, narrower and a little higher, which is the whole of what makes it point
    { size: [1.3, 1.0, 1.6], offset: [0, 0.08, -2.5], color: HULL, role: 'body', tip: HULL_DEEP },
    { size: [0.6, 0.9, 0.7], offset: [0, 0.2, -3.3], color: HULL_DEEP, role: 'body' },
    // the deck, and the low bulwark round it
    { size: [2.3, 0.14, 4.8], offset: [0, 0.5, 0.2], color: DECK, role: 'body' },
    { size: [2.36, 0.34, 0.16], offset: [0, 0.66, 2.6], color: HULL_DEEP, role: 'body' },
    { size: [0.16, 0.34, 5.0], offset: [-1.1, 0.66, 0.2], color: HULL_DEEP, role: 'body' },
    { size: [0.16, 0.34, 5.0], offset: [1.1, 0.66, 0.2], color: HULL_DEEP, role: 'body' },
    // the wheelhouse aft, with its windows facing forward
    { size: [1.5, 1.0, 1.5], offset: [0, 1.07, 1.5], color: CABIN, role: 'body' },
    { size: [1.2, 0.34, 1.54], offset: [0, 1.3, 1.5], color: GLASS, role: 'body' },
    { size: [1.66, 0.14, 1.7], offset: [0, 1.64, 1.5], color: BUS_TRIM, role: 'body' },
    // funnel and mast
    { size: [0.5, 1.1, 0.5], offset: [0, 1.62, 0.45], color: FUNNEL, role: 'body', shape: 'cylinder' },
    { size: [0.56, 0.18, 0.56], offset: [0, 2.2, 0.45], color: CHASSIS, role: 'detail', shape: 'cylinder' },
    { size: [0.16, 2.6, 0.16], offset: [0, 1.85, -1.9], color: TIMBER_DARK, role: 'body', shape: 'cylinder' },
    { size: [1.5, 0.1, 0.1], offset: [0, 2.7, -1.9], color: TIMBER_DARK, role: 'detail' },
    // deck cargo, so a ship reads as a ship and not as a ferry
    { size: [0.8, 0.7, 0.8], offset: [-0.5, 0.92, -0.9], color: CRATE, role: 'detail' },
    { size: [0.8, 0.7, 0.8], offset: [0.5, 0.92, -0.9], color: CRATE, role: 'detail' },
    { size: [0.8, 0.7, 0.8], offset: [0, 0.92, -0.1], color: TIMBER, role: 'detail' },
  ];
}

function locomotive(): ModelPart[] {
  const backOfCab = CAB_BACK + CAB_LONG / 2;
  return [
    axle(-LOCO_LENGTH / 2 + 0.9),
    axle(0.1),
    axle(backOfCab - 0.4),
    // the frame the whole thing sits on
    { size: [CAR_WIDTH, 0.3, LOCO_LENGTH], offset: [0, CAR_FLOOR - 0.15, 0], color: CHASSIS, role: 'body' },
    // boiler, and the flat smokebox front that gives it a face
    { size: [CAR_WIDTH - 0.35, 1.25, LOCO_LENGTH - 2.0], offset: [0, CAR_FLOOR + 0.65, -1.1], color: BOILER, role: 'body' },
    { size: [CAR_WIDTH - 0.2, 1.35, 0.3], offset: [0, CAR_FLOOR + 0.65, -LOCO_LENGTH / 2 + 0.15], color: CAB, role: 'body' },
    { size: [0.5, 0.85, 0.5], offset: [0, CAR_FLOOR + 1.6, -LOCO_LENGTH / 2 + 0.7], color: CHASSIS, role: 'body' },
    // the cab, built up to the same height as the carriages behind it
    { size: [CAR_WIDTH, CAR_HEIGHT, CAB_LONG], offset: [0, CAR_FLOOR + CAR_HEIGHT / 2, CAB_BACK], color: CAB, role: 'body' },
    { size: [CAR_WIDTH + 0.14, 0.16, CAB_LONG + 0.3], offset: [0, ROOF_TOP - 0.08, CAB_BACK], color: ROOF, role: 'body' },
    { size: [0.9, 0.7, 0.06], offset: [0, CAR_FLOOR + 1.5, CAB_BACK - CAB_LONG / 2 - 0.02], color: GLASS, role: 'body' },
    // the open firebox, which is what makes it read as a train and not a black box
    { size: [0.75, 0.5, 0.1], offset: [0, CAR_FLOOR + 0.5, CAB_BACK + CAB_LONG / 2], color: FIRE, role: 'body' },
  ];
}

/** An open wagon with its load standing proud of the sides. The load's top is `WAGON_TOP`,
 *  which is also what somebody standing on the wagon is standing on. */
function wagonCar(): ModelPart[] {
  return [
    axle(-CAR_LENGTH / 2 + 0.8),
    axle(CAR_LENGTH / 2 - 0.8),
    { size: [CAR_WIDTH, 0.3, CAR_LENGTH], offset: [0, CAR_FLOOR - 0.15, 0], color: TIMBER_DARK, role: 'body' },
    { size: [0.16, 0.7, CAR_LENGTH], offset: [-HALF_WIDE + 0.08, CAR_FLOOR + 0.35, 0], color: TIMBER, role: 'body' },
    { size: [0.16, 0.7, CAR_LENGTH], offset: [HALF_WIDE - 0.08, CAR_FLOOR + 0.35, 0], color: TIMBER, role: 'body' },
    { size: [CAR_WIDTH, 0.7, 0.16], offset: [0, CAR_FLOOR + 0.35, -CAR_LENGTH / 2 + 0.08], color: TIMBER, role: 'body' },
    { size: [CAR_WIDTH, 0.7, 0.16], offset: [0, CAR_FLOOR + 0.35, CAR_LENGTH / 2 - 0.08], color: TIMBER, role: 'body' },
    // the freight, borrowing the porter's crate so the same goods look the same however
    // they are being carried
    { size: [CAR_WIDTH - 0.4, WAGON_TOP - CAR_FLOOR, CAR_LENGTH - 0.7], offset: [0, (CAR_FLOOR + WAGON_TOP) / 2, 0], color: CRATE, role: 'body' },
    { size: [CAR_WIDTH - 0.32, 0.1, CAR_LENGTH - 0.6], offset: [0, CAR_FLOOR + 0.5, 0], color: TIMBER_DARK, role: 'body' },
  ];
}

/** A carriage with a doorway in each side and nothing in the way of walking through it.
 *
 *  The walls are drawn and not solid, which is the same bargain the viaduct's piers made:
 *  the floor holds you up, everything vertical is scenery. What that buys is that getting
 *  in is walking in — off a platform, at the same height, through a gap you can see. */
function coachCar(): ModelPart[] {
  const panel = (CAR_LENGTH - DOORWAY) / 2;
  const panelZ = DOORWAY / 2 + panel / 2;
  const parts: ModelPart[] = [
    axle(-CAR_LENGTH / 2 + 0.8),
    axle(CAR_LENGTH / 2 - 0.8),
    { size: [CAR_WIDTH, 0.3, CAR_LENGTH], offset: [0, CAR_FLOOR - 0.15, 0], color: TIMBER_DARK, role: 'body' },
    // both ends, floor to roof
    { size: [CAR_WIDTH, CAR_HEIGHT, 0.16], offset: [0, CAR_FLOOR + CAR_HEIGHT / 2, -CAR_LENGTH / 2 + 0.08], color: COACH_SIDE, role: 'body' },
    { size: [CAR_WIDTH, CAR_HEIGHT, 0.16], offset: [0, CAR_FLOOR + CAR_HEIGHT / 2, CAR_LENGTH / 2 - 0.08], color: COACH_SIDE, role: 'body' },
    { size: [CAR_WIDTH + 0.16, 0.16, CAR_LENGTH + 0.2], offset: [0, ROOF_TOP - 0.08, 0], color: ROOF, role: 'body' },
  ];
  for (const side of [-1, 1]) {
    const x = side * (HALF_WIDE - 0.08);
    for (const z of [-panelZ, panelZ]) {
      parts.push(
        { size: [0.16, CAR_HEIGHT, panel], offset: [x, CAR_FLOOR + CAR_HEIGHT / 2, z], color: COACH_SIDE, role: 'body' },
        { size: [0.2, 0.7, panel - 0.4], offset: [x, CAR_FLOOR + 1.45, z], color: GLASS, role: 'body' },
        { size: [0.2, 0.1, panel], offset: [x, CAR_FLOOR + 0.95, z], color: COACH_TRIM, role: 'body' },
      );
    }
    // A lintel over the doorway, so the gap reads as a door rather than as a missing wall.
    parts.push({ size: [0.16, 0.4, DOORWAY], offset: [x, ROOF_TOP - 0.32, 0], color: COACH_TRIM, role: 'body' });
    // And a bench to sit on, which is what tells a player the inside is meant for them.
    parts.push({ size: [0.4, 0.45, CAR_LENGTH - 1.2], offset: [side * (HALF_WIDE - 0.36), CAR_FLOOR + 0.22, 0], color: TIMBER, role: 'body' });
  }
  return parts;
}

/** Blocky mob models, built from axis-aligned boxes in the spirit of the original. */
const MODELS: Record<MobKind, ModelPart[]> = {
  zombie: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: MOB.zombie, role: 'head' },
    { size: [0.08, 0.08, 0.04], offset: [-0.12, 1.68, -0.27], color: MOB.eyeRed, role: 'detail' },
    { size: [0.08, 0.08, 0.04], offset: [0.12, 1.68, -0.27], color: MOB.eyeRed, role: 'detail' },
    { size: [0.55, 0.72, 0.28], offset: [0, 1.05, 0], color: MOB.zombieShirt, role: 'body' },
    { size: [0.18, 0.7, 0.18], offset: [-0.37, 1.05, -0.15], color: MOB.zombie, role: 'armLeft' },
    { size: [0.18, 0.7, 0.18], offset: [0.37, 1.05, -0.15], color: MOB.zombie, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.15, 0.35, 0], color: MOB.zombieLegs, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.15, 0.35, 0], color: MOB.zombieLegs, role: 'legFrontRight' },
  ],
  skeleton: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.7, 0], color: MOB.bone, role: 'head' },
    { size: [0.08, 0.08, 0.04], offset: [-0.12, 1.72, -0.27], color: MOB.eyeBlue, role: 'detail' },
    { size: [0.08, 0.08, 0.04], offset: [0.12, 1.72, -0.27], color: MOB.eyeBlue, role: 'detail' },
    { size: [0.4, 0.75, 0.22], offset: [0, 1.07, 0], color: MOB.boneDeep, role: 'body' },
    { size: [0.13, 0.72, 0.13], offset: [-0.3, 1.07, -0.2], color: MOB.bone, role: 'armLeft' },
    { size: [0.13, 0.72, 0.13], offset: [0.3, 1.07, -0.2], color: MOB.bone, role: 'armRight' },
    { size: [0.14, 0.7, 0.14], offset: [-0.12, 0.35, 0], color: MOB.boneDeep, role: 'legFrontLeft' },
    { size: [0.14, 0.7, 0.14], offset: [0.12, 0.35, 0], color: MOB.boneDeep, role: 'legFrontRight' },
  ],
  spider: [
    { size: [0.9, 0.5, 0.7], offset: [0, 0.45, 0.25], color: MOB.spider, role: 'body' },
    { size: [0.5, 0.4, 0.45], offset: [0, 0.5, -0.45], color: MOB.spiderDeep, role: 'head' },
    { size: [1.5, 0.12, 0.12], offset: [0, 0.3, -0.1], color: MOB.spiderLeg, role: 'legFrontLeft' },
    { size: [1.5, 0.12, 0.12], offset: [0, 0.3, 0.25], color: MOB.spiderLeg, role: 'legFrontRight' },
    { size: [1.4, 0.12, 0.12], offset: [0, 0.3, 0.6], color: MOB.spiderLeg, role: 'legBackLeft' },
    { size: [0.14, 0.14, 0.14], offset: [-0.14, 0.62, -0.62], color: MOB.spiderEye, role: 'body' },
    { size: [0.14, 0.14, 0.14], offset: [0.14, 0.62, -0.62], color: MOB.spiderEye, role: 'body' },
    { size: [0.16, 0.2, 0.08], offset: [-0.14, 0.18, -0.7], color: MOB.spiderEye, role: 'detail' },
    { size: [0.16, 0.2, 0.08], offset: [0.14, 0.18, -0.7], color: MOB.spiderEye, role: 'detail' },
  ],
  pig: [
    { size: [0.62, 0.55, 0.95], offset: [0, 0.62, 0], color: MOB.pig, role: 'body' },
    { size: [0.45, 0.42, 0.4], offset: [0, 0.72, -0.62], color: MOB.pig, role: 'head' },
    { size: [0.22, 0.16, 0.1], offset: [0, 0.66, -0.85], color: MOB.pigSnout, role: 'head' },
    { size: [0.12, 0.12, 0.08], offset: [-0.16, 0.98, -0.65], color: MOB.pigDeep, role: 'detail' },
    { size: [0.12, 0.12, 0.08], offset: [0.16, 0.98, -0.65], color: MOB.pigDeep, role: 'detail' },
    { size: [0.12, 0.12, 0.12], offset: [0, 0.72, 0.56], color: MOB.pigDeep, role: 'detail' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, -0.3], color: MOB.pigDeep, role: 'legFrontLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, -0.3], color: MOB.pigDeep, role: 'legFrontRight' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, 0.32], color: MOB.pigDeep, role: 'legBackLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, 0.32], color: MOB.pigDeep, role: 'legBackRight' },
  ],
  cow: [
    { size: [0.7, 0.7, 1.1], offset: [0, 0.95, 0], color: MOB.cow, role: 'body' },
    { size: [0.5, 0.5, 0.45], offset: [0, 1.15, -0.75], color: MOB.cowDeep, role: 'head' },
    { size: [0.62, 0.16, 0.46], offset: [0, 1.27, 0.06], color: MOB.cowPatch, role: 'body' },
    { size: [0.12, 0.2, 0.12], offset: [-0.28, 1.48, -0.72], color: MOB.cowHorn, role: 'detail' },
    { size: [0.12, 0.2, 0.12], offset: [0.28, 1.48, -0.72], color: MOB.cowHorn, role: 'detail' },
    { size: [0.07, 0.07, 0.04], offset: [-0.13, 1.2, -0.96], color: MOB.eyeDark, role: 'detail' },
    { size: [0.07, 0.07, 0.04], offset: [0.13, 1.2, -0.96], color: MOB.eyeDark, role: 'detail' },
    { size: [0.1, 0.1, 0.1], offset: [0, 0.86, 0.64], color: MOB.cowDeep, role: 'detail' },
    { size: [0.18, 0.6, 0.18], offset: [-0.24, 0.3, -0.35], color: MOB.cowDeep, role: 'legFrontLeft' },
    { size: [0.18, 0.6, 0.18], offset: [0.24, 0.3, -0.35], color: MOB.cowDeep, role: 'legFrontRight' },
    { size: [0.18, 0.6, 0.18], offset: [-0.24, 0.3, 0.38], color: MOB.cowDeep, role: 'legBackLeft' },
    { size: [0.18, 0.6, 0.18], offset: [0.24, 0.3, 0.38], color: MOB.cowDeep, role: 'legBackRight' },
  ],
  chicken: [
    { size: [0.32, 0.3, 0.42], offset: [0, 0.4, 0], color: MOB.chicken, role: 'body' },
    { size: [0.24, 0.26, 0.24], offset: [0, 0.6, -0.24], color: MOB.chicken, role: 'head' },
    { size: [0.1, 0.08, 0.14], offset: [0, 0.57, -0.4], color: MOB.beak, role: 'head' },
    { size: [0.12, 0.1, 0.1], offset: [0, 0.72, -0.2], color: MOB.comb, role: 'head' },
    { size: [0.3, 0.16, 0.32], offset: [-0.22, 0.43, 0.02], color: MOB.chickenWing, role: 'detail' },
    { size: [0.3, 0.16, 0.32], offset: [0.22, 0.43, 0.02], color: MOB.chickenWing, role: 'detail' },
    { size: [0.12, 0.16, 0.18], offset: [0, 0.5, 0.28], color: MOB.chickenWing, role: 'detail' },
    { size: [0.08, 0.25, 0.08], offset: [-0.1, 0.12, 0], color: MOB.beak, role: 'legFrontLeft' },
    { size: [0.08, 0.25, 0.08], offset: [0.1, 0.12, 0], color: MOB.beak, role: 'legFrontRight' },
  ],
  sheep: [
    { size: [0.75, 0.7, 1.0], offset: [0, 0.9, 0], color: MOB.sheep, role: 'body' },
    { size: [0.42, 0.42, 0.42], offset: [0, 1.05, -0.68], color: MOB.sheepDeep, role: 'head' },
    { size: [0.07, 0.07, 0.04], offset: [-0.11, 1.1, -0.89], color: MOB.eyeDark, role: 'detail' },
    { size: [0.07, 0.07, 0.04], offset: [0.11, 1.1, -0.89], color: MOB.eyeDark, role: 'detail' },
    { size: [0.1, 0.1, 0.1], offset: [0, 0.82, 0.58], color: MOB.sheepDeep, role: 'detail' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, -0.3], color: MOB.sheepDeep, role: 'legFrontLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, -0.3], color: MOB.sheepDeep, role: 'legFrontRight' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, 0.34], color: MOB.sheepDeep, role: 'legBackLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, 0.34], color: MOB.sheepDeep, role: 'legBackRight' },
  ],
  cat: [
    { size: [0.38, 0.32, 0.62], offset: [0, 0.43, 0], color: MOB.cat, role: 'body' },
    { size: [0.32, 0.32, 0.32], offset: [0, 0.58, -0.42], color: MOB.cat, role: 'head' },
    { size: [0.12, 0.18, 0.1], offset: [-0.1, 0.8, -0.46], color: MOB.catDeep, role: 'head' },
    { size: [0.12, 0.18, 0.1], offset: [0.1, 0.8, -0.46], color: MOB.catDeep, role: 'head' },
    { size: [0.05, 0.05, 0.03], offset: [-0.08, 0.61, -0.59], color: MOB.catEye, role: 'head' },
    { size: [0.05, 0.05, 0.03], offset: [0.08, 0.61, -0.59], color: MOB.catEye, role: 'head' },
    { size: [0.07, 0.22, 0.07], offset: [0, 0.42, 0.46], color: MOB.catDeep, role: 'detail' },
    { size: [0.1, 0.28, 0.1], offset: [-0.12, 0.16, -0.18], color: MOB.catDeep, role: 'legFrontLeft' },
    { size: [0.1, 0.28, 0.1], offset: [0.12, 0.16, -0.18], color: MOB.catDeep, role: 'legFrontRight' },
    { size: [0.1, 0.28, 0.1], offset: [-0.12, 0.16, 0.2], color: MOB.catDeep, role: 'legBackLeft' },
    { size: [0.1, 0.28, 0.1], offset: [0.12, 0.16, 0.2], color: MOB.catDeep, role: 'legBackRight' },
  ],
  dog: [
    { size: [0.48, 0.46, 0.72], offset: [0, 0.55, 0], color: MOB.dog, role: 'body' },
    { size: [0.38, 0.4, 0.38], offset: [0, 0.72, -0.48], color: MOB.dog, role: 'head' },
    { size: [0.18, 0.22, 0.12], offset: [-0.18, 0.82, -0.5], color: MOB.dogDeep, role: 'head' },
    { size: [0.18, 0.22, 0.12], offset: [0.18, 0.82, -0.5], color: MOB.dogDeep, role: 'head' },
    { size: [0.11, 0.3, 0.11], offset: [-0.16, 0.2, -0.22], color: MOB.dogDeep, role: 'legFrontLeft' },
    { size: [0.11, 0.3, 0.11], offset: [0.16, 0.2, -0.22], color: MOB.dogDeep, role: 'legFrontRight' },
    { size: [0.11, 0.3, 0.11], offset: [-0.16, 0.2, 0.22], color: MOB.dogDeep, role: 'legBackLeft' },
    { size: [0.11, 0.3, 0.11], offset: [0.16, 0.2, 0.22], color: MOB.dogDeep, role: 'legBackRight' },
    { size: [0.5, 0.09, 0.08], offset: [0, 0.67, -0.28], color: MOB.dogCollar, role: 'body' },
    { size: [0.1, 0.12, 0.1], offset: [0, 0.72, -0.73], color: MOB.dogDeep, role: 'detail' },
    { size: [0.1, 0.16, 0.1], offset: [0, 0.55, 0.48], color: MOB.dogDeep, role: 'detail' },
  ],
  fox: [
    { size: [0.5, 0.45, 0.8], offset: [0, 0.58, 0], color: MOB.fox, role: 'body' },
    { size: [0.38, 0.35, 0.5], offset: [0, 0.72, -0.55], color: MOB.fox, role: 'head' },
    { size: [0.32, 0.28, 0.22], offset: [0, 0.68, -0.86], color: MOB.foxDeep, role: 'head' },
    { size: [0.1, 0.16, 0.1], offset: [-0.14, 0.99, -0.55], color: MOB.fox, role: 'detail' },
    { size: [0.1, 0.16, 0.1], offset: [0.14, 0.99, -0.55], color: MOB.fox, role: 'detail' },
    { size: [0.34, 0.34, 0.55], offset: [0, 0.65, 0.65], color: MOB.foxDeep, role: 'detail' },
    { size: [0.12, 0.3, 0.12], offset: [-0.16, 0.18, -0.25], color: MOB.foxLeg, role: 'legFrontLeft' },
    { size: [0.12, 0.3, 0.12], offset: [0.16, 0.18, -0.25], color: MOB.foxLeg, role: 'legFrontRight' },
    { size: [0.12, 0.3, 0.12], offset: [-0.16, 0.18, 0.25], color: MOB.foxLeg, role: 'legBackLeft' },
    { size: [0.12, 0.3, 0.12], offset: [0.16, 0.18, 0.25], color: MOB.foxLeg, role: 'legBackRight' },
  ],
  rabbit: [
    { size: [0.3, 0.3, 0.42], offset: [0, 0.32, 0], color: MOB.rabbit, role: 'body' },
    { size: [0.25, 0.24, 0.25], offset: [0, 0.52, -0.28], color: MOB.rabbit, role: 'head' },
    { size: [0.08, 0.28, 0.08], offset: [-0.08, 0.78, -0.3], color: MOB.rabbitEar, role: 'head' },
    { size: [0.08, 0.28, 0.08], offset: [0.08, 0.78, -0.3], color: MOB.rabbitEar, role: 'head' },
    { size: [0.08, 0.2, 0.08], offset: [-0.1, 0.1, -0.12], color: MOB.rabbitDeep, role: 'legFrontLeft' },
    { size: [0.08, 0.2, 0.08], offset: [0.1, 0.1, -0.12], color: MOB.rabbitDeep, role: 'legFrontRight' },
    { size: [0.13, 0.13, 0.13], offset: [0, 0.38, 0.28], color: MOB.rabbitDeep, role: 'detail' },
  ],
  camel: [
    { size: [0.78, 1.0, 1.25], offset: [0, 1.05, 0], color: MOB.camel, role: 'body' },
    { size: [0.5, 0.4, 0.45], offset: [0, 1.72, 0.25], color: MOB.camelDeep, role: 'detail' },
    { size: [0.42, 1.15, 0.42], offset: [0, 1.6, -0.62], color: MOB.camel, role: 'head' },
    { size: [0.2, 0.18, 0.28], offset: [0, 1.38, -0.9], color: MOB.camelDeep, role: 'head' },
    { size: [0.16, 0.9, 0.16], offset: [-0.3, 0.45, -0.42], color: MOB.camelDeep, role: 'legFrontLeft' },
    { size: [0.16, 0.9, 0.16], offset: [0.3, 0.45, -0.42], color: MOB.camelDeep, role: 'legFrontRight' },
    { size: [0.16, 0.9, 0.16], offset: [-0.3, 0.45, 0.42], color: MOB.camelDeep, role: 'legBackLeft' },
    { size: [0.16, 0.9, 0.16], offset: [0.3, 0.45, 0.42], color: MOB.camelDeep, role: 'legBackRight' },
  ],
  villager: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: MOB.skin, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: MOB.skinDeep, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: MOB.villager, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: MOB.villagerTrim, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: MOB.skin, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: MOB.skin, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: MOB.villagerLegs, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: MOB.villagerLegs, role: 'legFrontRight' },
  ],
  // A villager in working clothes with a crate roped to their back. It has to read as
  // "carrying something somewhere" from across a field.
  porter: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: MOB.skin, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: MOB.skinDeep, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: MOB.porter, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: MOB.porterTrim, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: MOB.skin, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: MOB.skin, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: MOB.porterLegs, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: MOB.porterLegs, role: 'legFrontRight' },
    { size: [0.52, 0.52, 0.34], offset: [0, 1.32, 0.3], color: CRATE, role: 'body' },
    { size: [0.56, 0.1, 0.05], offset: [0, 1.32, 0.48], color: TIMBER_DARK, role: 'body' },
  ],
  // The same porter with a two wheeled cart behind them. It has to read as "this road is
  // wide enough for that" from the side of the road, so the cart is deliberately as broad
  // as the collision box and the wheels stand proud of it.
  cart: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: MOB.skin, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: MOB.skinDeep, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: MOB.porter, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: MOB.porterTrim, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: MOB.skin, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: MOB.skin, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: MOB.porterLegs, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: MOB.porterLegs, role: 'legFrontRight' },
    // shafts from the porter's hands back to the bed
    { size: [0.06, 0.06, 0.7], offset: [-0.3, 1.05, 0.45], color: TIMBER_DARK, role: 'body' },
    { size: [0.06, 0.06, 0.7], offset: [0.3, 1.05, 0.45], color: TIMBER_DARK, role: 'body' },
    // the bed, its load, and the wheels
    { size: [1.2, 0.34, 0.8], offset: [0, 0.75, 0.95], color: TIMBER, role: 'body' },
    { size: [1.24, 0.08, 0.84], offset: [0, 0.94, 0.95], color: TIMBER_DARK, role: 'body' },
    { size: [0.86, 0.3, 0.56], offset: [0, 1.06, 0.95], color: CRATE, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [-0.65, 0.62, 0.95], color: CHASSIS, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [0.65, 0.62, 0.95], color: CHASSIS, role: 'body' },
  ],
  // The locomotive. Built to the track's own numbers rather than to numbers that happened
  // to look right — see `consist.ts` — because a train the player can stand on and walk
  // into has to be the size the rails say it is. Nothing here has a leg or an arm role:
  // the renderer swings those from the walk phase, and a train that walked would be
  // telling the player the wrong thing about what is moving the goods.
  bus: omnibus(),
  ship: steamer(),
  train: locomotive(),
};

const CARS: Record<CarKind, ModelPart[]> = {
  loco: MODELS.train,
  wagon: wagonCar(),
  coach: coachCar(),
};

/** Which row of the animator's table each kind walks on. */
const GAIT_OF: Record<MobKind, GaitName> = {
  zombie: 'biped', skeleton: 'biped', villager: 'biped', porter: 'biped', cart: 'biped',
  // The horses trot and the coach rides along behind them.
  bus: 'trot',
  // A hull has no legs either. What the biped row gives it is the gentle bob of `bodyBob`,
  // which on a boat reads as the swell — the one place that row was ever flattering.
  ship: 'biped',
  spider: 'wave', rabbit: 'bound', chicken: 'strut', camel: 'plod',
  pig: 'trot', cow: 'trot', sheep: 'trot', cat: 'trot', dog: 'trot', fox: 'trot',
  // Rolling stock has no legs to swing, and a train that walked would be telling
  // the player the wrong thing about what is moving the goods.
  train: 'biped',
};

/** Where on its own parts a joint turns. */
type Anchor = 'top' | 'bottom' | 'front' | 'back' | 'inner';

/**
 * A limb turns at the top, where it meets the body; a head at the base of its
 * neck, which for anything on four legs is the back of the skull and for
 * anything upright is under it; a tail at its root, which is its front.
 */
const ANCHOR: Record<JointName, Anchor> = {
  head: 'bottom', neck: 'bottom', jaw: 'back',
  armLeft: 'top', armRight: 'top',
  legFrontLeft: 'top', legFrontRight: 'top',
  legMidFrontLeft: 'top', legMidFrontRight: 'top',
  legMidBackLeft: 'top', legMidBackRight: 'top',
  legBackLeft: 'top', legBackRight: 'top',
  earLeft: 'bottom', earRight: 'bottom',
  wingLeft: 'inner', wingRight: 'inner',
  tail: 'front', tailTip: 'front',
};

/** Joints that hang off another joint rather than off the mob. */
const HANGS_ON: Partial<Record<JointName, JointName>> = {
  earLeft: 'head', earRight: 'head', jaw: 'head', tailTip: 'tail',
};

function anchorOf(parts: ModelPart[], role: JointName, quadruped: boolean): [number, number, number] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const part of parts) {
    if (part.role !== role) continue;
    minX = Math.min(minX, part.offset[0] - part.size[0] / 2);
    maxX = Math.max(maxX, part.offset[0] + part.size[0] / 2);
    minY = Math.min(minY, part.offset[1] - part.size[1] / 2);
    maxY = Math.max(maxY, part.offset[1] + part.size[1] / 2);
    minZ = Math.min(minZ, part.offset[2] - part.size[2] / 2);
    maxZ = Math.max(maxZ, part.offset[2] + part.size[2] / 2);
  }
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2, midZ = (minZ + maxZ) / 2;
  // A four-legged animal's head is out in front of it and swings from the neck
  // behind it; an upright one's sits on its shoulders and swings from under it.
  const anchor = role === 'head' && quadruped ? 'back' : ANCHOR[role];
  switch (anchor) {
    case 'top': return [midX, maxY, midZ];
    case 'bottom': return [midX, minY, midZ];
    case 'front': return [midX, midY, minZ];
    case 'back': return [midX, midY, maxZ];
    case 'inner': return [midX > 0 ? minX : maxX, maxY, midZ];
  }
}

/**
 * A rig derived from the parts, for a model that has not been given one.
 *
 * Every animated role present becomes a joint at the sensible end of its own
 * parts. It is what lets a model be authored as a flat list of boxes and still
 * swing from its hips, and it is the fallback a species keeps until it is worth
 * hand-placing a pivot.
 */
export function rigFor(parts: ModelPart[], gait: GaitName): Joint[] {
  const quadruped = gait !== 'biped' && gait !== 'strut';
  const seen = new Set<JointName>();
  const joints: Joint[] = [];
  for (const part of parts) {
    if (part.role === 'body' || part.role === 'detail' || seen.has(part.role)) continue;
    seen.add(part.role);
    joints.push({ name: part.role, pivot: anchorOf(parts, part.role, quadruped) });
  }
  // A joint may only hang off one that exists, or it would be rooted twice.
  for (const joint of joints) {
    const parent = HANGS_ON[joint.name];
    if (parent && seen.has(parent)) joint.parent = parent;
  }
  return joints;
}

/** How a joint hangs, where the derived rig is not the whole story. */
type Tuning = Partial<Record<JointName, Pick<Joint, 'rest' | 'gain' | 'phase'>>>;

const TUNING: Partial<Record<MobKind, Tuning>> = {
  // Arms held out in front and dead to the walk. This used to be a check on the
  // mob's kind inside the renderer, which is the wrong place for it: how a
  // zombie holds itself is a fact about zombies.
  zombie: {
    armLeft: { rest: [-1.5, 0, 0.06], gain: 0 },
    armRight: { rest: [-1.5, 0, -0.06], gain: 0 },
  },
};

function tune(joints: Joint[], tuning: Tuning | undefined): Joint[] {
  if (!tuning) return joints;
  return joints.map((joint) => ({ ...joint, ...tuning[joint.name] }));
}

const RIGGED = new Map<MobKind, MobModel>();

export function modelFor(kind: MobKind): MobModel {
  // The living kinds are modelled and rigged by hand in `creatureModels.ts`. The
  // haulers and the rolling stock are the same boxes they always were, and take
  // the derived rig — which is what gives a porter hips without anyone having to
  // decide where a porter's hips are.
  const creature = CREATURES[kind as CreatureKind];
  if (creature) return creature;
  let model = RIGGED.get(kind);
  if (!model) {
    const parts = MODELS[kind];
    const gait = GAIT_OF[kind];
    model = { parts, joints: tune(rigFor(parts, gait), TUNING[kind]), gait };
    RIGGED.set(kind, model);
  }
  return model;
}

/** One car of a train, drawn in its own frame. The cars behind the engine are placed by
 *  the game from where the engine has been, so each of them is its own group in the scene
 *  rather than another box hanging off the engine's. */
export function carModel(kind: CarKind): ModelPart[] {
  return CARS[kind];
}

