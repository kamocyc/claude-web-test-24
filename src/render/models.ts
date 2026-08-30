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
import { MOB } from './palette';

export type PartRole = 'head' | 'armLeft' | 'armRight' | 'legFrontLeft' | 'legFrontRight' | 'legBackLeft' | 'legBackRight' | 'body';

export interface ModelPart {
  /** Width (x), height (y), depth (z) in blocks. */
  size: [number, number, number];
  /** Centre of the part relative to the mob's feet. */
  offset: [number, number, number];
  color: number;
  role: PartRole;
}

const STEEL = 0x2f3438;
const STEEL_DARK = 0x1c2023;
const IRONWORK = 0x39424a;
const TIMBER = 0x8a6a3a;
const TIMBER_DARK = 0x5f4826;
const CRATE = 0xb99a5e;
const COACH_SIDE = 0x7a4a3c;
const COACH_TRIM = 0x9c6a52;
const GLASS = 0x9fc4d8;
const ROOF = 0xbfb6a6;
const FIRE = 0xd4762a;

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
  return { size: [WHEEL_SPAN + 0.3, WHEEL, WHEEL * 0.4], offset: [0, AXLE, z], color: STEEL_DARK, role: 'body' };
}

function locomotive(): ModelPart[] {
  const backOfCab = CAB_BACK + CAB_LONG / 2;
  return [
    axle(-LOCO_LENGTH / 2 + 0.9),
    axle(0.1),
    axle(backOfCab - 0.4),
    // the frame the whole thing sits on
    { size: [CAR_WIDTH, 0.3, LOCO_LENGTH], offset: [0, CAR_FLOOR - 0.15, 0], color: STEEL_DARK, role: 'body' },
    // boiler, and the flat smokebox front that gives it a face
    { size: [CAR_WIDTH - 0.35, 1.25, LOCO_LENGTH - 2.0], offset: [0, CAR_FLOOR + 0.65, -1.1], color: STEEL, role: 'body' },
    { size: [CAR_WIDTH - 0.2, 1.35, 0.3], offset: [0, CAR_FLOOR + 0.65, -LOCO_LENGTH / 2 + 0.15], color: IRONWORK, role: 'body' },
    { size: [0.5, 0.85, 0.5], offset: [0, CAR_FLOOR + 1.6, -LOCO_LENGTH / 2 + 0.7], color: STEEL_DARK, role: 'body' },
    // the cab, built up to the same height as the carriages behind it
    { size: [CAR_WIDTH, CAR_HEIGHT, CAB_LONG], offset: [0, CAR_FLOOR + CAR_HEIGHT / 2, CAB_BACK], color: IRONWORK, role: 'body' },
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
    { size: [0.55, 0.72, 0.28], offset: [0, 1.05, 0], color: MOB.zombieShirt, role: 'body' },
    { size: [0.18, 0.7, 0.18], offset: [-0.37, 1.05, -0.15], color: MOB.zombie, role: 'armLeft' },
    { size: [0.18, 0.7, 0.18], offset: [0.37, 1.05, -0.15], color: MOB.zombie, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.15, 0.35, 0], color: MOB.zombieLegs, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.15, 0.35, 0], color: MOB.zombieLegs, role: 'legFrontRight' },
  ],
  skeleton: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.7, 0], color: MOB.bone, role: 'head' },
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
  ],
  pig: [
    { size: [0.62, 0.55, 0.95], offset: [0, 0.62, 0], color: MOB.pig, role: 'body' },
    { size: [0.45, 0.42, 0.4], offset: [0, 0.72, -0.62], color: MOB.pig, role: 'head' },
    { size: [0.22, 0.16, 0.1], offset: [0, 0.66, -0.85], color: MOB.pigSnout, role: 'head' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, -0.3], color: MOB.pigDeep, role: 'legFrontLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, -0.3], color: MOB.pigDeep, role: 'legFrontRight' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, 0.32], color: MOB.pigDeep, role: 'legBackLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, 0.32], color: MOB.pigDeep, role: 'legBackRight' },
  ],
  cow: [
    { size: [0.7, 0.7, 1.1], offset: [0, 0.95, 0], color: MOB.cow, role: 'body' },
    { size: [0.5, 0.5, 0.45], offset: [0, 1.15, -0.75], color: MOB.cowDeep, role: 'head' },
    { size: [0.62, 0.16, 0.46], offset: [0, 1.27, 0.06], color: MOB.cowPatch, role: 'body' },
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
    { size: [0.08, 0.25, 0.08], offset: [-0.1, 0.12, 0], color: MOB.beak, role: 'legFrontLeft' },
    { size: [0.08, 0.25, 0.08], offset: [0.1, 0.12, 0], color: MOB.beak, role: 'legFrontRight' },
  ],
  sheep: [
    { size: [0.75, 0.7, 1.0], offset: [0, 0.9, 0], color: MOB.sheep, role: 'body' },
    { size: [0.42, 0.42, 0.42], offset: [0, 1.05, -0.68], color: MOB.sheepDeep, role: 'head' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, -0.3], color: MOB.sheepDeep, role: 'legFrontLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, -0.3], color: MOB.sheepDeep, role: 'legFrontRight' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, 0.34], color: MOB.sheepDeep, role: 'legBackLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, 0.34], color: MOB.sheepDeep, role: 'legBackRight' },
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
    { size: [0.52, 0.52, 0.34], offset: [0, 1.32, 0.3], color: 0x8a6a3a, role: 'body' },
    { size: [0.56, 0.1, 0.05], offset: [0, 1.32, 0.48], color: 0x5f4826, role: 'body' },
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
    { size: [0.06, 0.06, 0.7], offset: [-0.3, 1.05, 0.45], color: 0x6b5330, role: 'body' },
    { size: [0.06, 0.06, 0.7], offset: [0.3, 1.05, 0.45], color: 0x6b5330, role: 'body' },
    // the bed, its load, and the wheels
    { size: [1.2, 0.34, 0.8], offset: [0, 0.75, 0.95], color: 0x8a6a3a, role: 'body' },
    { size: [1.24, 0.08, 0.84], offset: [0, 0.94, 0.95], color: 0x5f4826, role: 'body' },
    { size: [0.86, 0.3, 0.56], offset: [0, 1.06, 0.95], color: 0xb99a5e, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [-0.65, 0.62, 0.95], color: 0x4a3423, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [0.65, 0.62, 0.95], color: 0x4a3423, role: 'body' },
  ],
  // The locomotive. Built to the track's own numbers rather than to numbers that happened
  // to look right — see `consist.ts` — because a train the player can stand on and walk
  // into has to be the size the rails say it is. Nothing here has a leg or an arm role:
  // the renderer swings those from the walk phase, and a train that walked would be
  // telling the player the wrong thing about what is moving the goods.
  train: locomotive(),
};

const CARS: Record<CarKind, ModelPart[]> = {
  loco: MODELS.train,
  wagon: wagonCar(),
  coach: coachCar(),
};

export function modelFor(kind: MobKind): ModelPart[] {
  return MODELS[kind];
}

/** One car of a train, drawn in its own frame. The cars behind the engine are placed by
 *  the game from where the engine has been, so each of them is its own group in the scene
 *  rather than another box hanging off the engine's. */
export function carModel(kind: CarKind): ModelPart[] {
  return CARS[kind];
}

