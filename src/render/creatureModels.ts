import type { GaitName } from './mobAnimation';
import type { Joint, JointName, MobModel, ModelPart, PartRole } from './models';
import { MOB, PEOPLE } from './palette';
import { VILLAGERS, type PersonSpec } from './people';

/**
 * The animals and the people, one model each.
 *
 * They used to be a box for a body, a box for a head and four boxes for legs,
 * which is why they all read the same from ten paces: the only thing that
 * differed between a sheep and a pig was the proportions and two flat colours.
 * What is here instead gives each species the two or three shapes it is actually
 * known by — a fox's brush, a cow's dewlap, a spider's eight legs — and hangs
 * them on joints so they move.
 *
 * Everything is authored in rest space, measured from the mob's feet, in blocks.
 * `mobDef(kind).width/height` is the box the game collides with and the models
 * are built to fit it; `mobModels.test.ts` holds them to it.
 */

/** Colours a species needs that the shared palette does not carry. */
const HOOF = 0x6b5647;
const TONGUE = 0xe98ba0;
const UDDER = 0xf3bfc4;
const DARK = 0x4a3d4c;

/**
 * A part and the mirror of it across the centreline.
 *
 * Written once because it is one thing — a pair of ears is not two decisions —
 * and because a hand-written mirror is the likeliest mistake in a table of this
 * many numbers. Mirroring negates X, and with it the Y and Z rotations.
 */
function pair(part: Omit<ModelPart, 'role'>, left: PartRole, right: PartRole): ModelPart[] {
  const rot = part.rotation;
  return [
    { ...part, role: left },
    {
      ...part,
      offset: [-part.offset[0], part.offset[1], part.offset[2]],
      rotation: rot ? [rot[0], -rot[1], -rot[2]] : undefined,
      role: right,
    },
  ];
}

interface Segment {
  /** Along the limb. */
  length: number;
  thick: number;
  /** Radians from straight down, opening away from the body. */
  pitch: number;
  color: number;
  shape?: 'cylinder' | 'taper' | 'box';
  taper?: number;
  tip?: number;
}

/**
 * A jointed limb, walked out from where it attaches.
 *
 * Each segment starts where the last one ended, so a leg that bends at the knee
 * or a neck that rises and then turns down is written as the two angles it
 * actually has rather than as two boxes whose positions have to be solved by
 * hand. `yaw` swings the whole limb about the body, which is how eight spider
 * legs fan out instead of all pointing sideways.
 */
function limb(
  from: readonly [number, number, number],
  yaw: number,
  segments: readonly Segment[],
  role: PartRole,
): ModelPart[] {
  const parts: ModelPart[] = [];
  let [x, y, z] = from;
  for (const segment of segments) {
    const dx = Math.sin(segment.pitch) * Math.cos(yaw);
    const dy = -Math.cos(segment.pitch);
    const dz = -Math.sin(segment.pitch) * Math.sin(yaw);
    parts.push({
      size: [segment.thick, segment.length, segment.thick],
      offset: [x + dx * segment.length / 2, y + dy * segment.length / 2, z + dz * segment.length / 2],
      // A part's own +Y is its length; turning it by π plus the pitch points it
      // down and outwards, which also puts a taper's narrow end at the far end.
      rotation: [0, yaw, Math.PI + segment.pitch],
      color: segment.color,
      shape: segment.shape ?? 'cylinder',
      taper: segment.taper,
      tip: segment.tip,
      role,
    });
    x += dx * segment.length;
    y += dy * segment.length;
    z += dz * segment.length;
  }
  return parts;
}

/** Straight back and level: the yaw that makes `limb`'s pitch open towards +Z. */
const BACKWARD = -Math.PI / 2;
/** Outwards, for a left-hand appendage. `pair` mirrors it for the right. */
const OUTWARD = Math.PI;

/** A four-legged animal's legs, from the same description four times. */
function fourLegs(
  half: number, frontZ: number, backZ: number, hip: number, segments: readonly Segment[],
): ModelPart[] {
  return [
    ...limb([-half, hip, frontZ], Math.PI, segments, 'legFrontLeft'),
    ...limb([half, hip, frontZ], 0, segments, 'legFrontRight'),
    ...limb([-half, hip, backZ], Math.PI, segments, 'legBackLeft'),
    ...limb([half, hip, backZ], 0, segments, 'legBackRight'),
  ];
}

function joint(name: JointName, pivot: [number, number, number], extra: Partial<Joint> = {}): Joint {
  return { name, pivot, ...extra };
}

/** The four hips of a quadruped, in the same places `fourLegs` put them. */
function legJoints(half: number, frontZ: number, backZ: number, hip: number): Joint[] {
  return [
    joint('legFrontLeft', [-half, hip, frontZ]),
    joint('legFrontRight', [half, hip, frontZ]),
    joint('legBackLeft', [-half, hip, backZ]),
    joint('legBackRight', [half, hip, backZ]),
  ];
}

function model(parts: ModelPart[], joints: Joint[], gait: GaitName): MobModel {
  return { parts, joints, gait };
}

// --- the hostiles ------------------------------------------------------------

/** Slumped, lopsided and reaching. The silhouette does the work at night. */
function zombie(): MobModel {
  const parts: ModelPart[] = [
    // Head, cocked forward and to one side.
    { size: [0.46, 0.46, 0.44], offset: [0, 1.68, -0.02], color: MOB.zombie, tip: 0x9fd996, role: 'head' },
    { size: [0.34, 0.1, 0.05], offset: [0, 1.7, -0.24], color: DARK, role: 'head' },
    ...pair({ size: [0.09, 0.09, 0.04], offset: [-0.12, 1.71, -0.24], color: MOB.eyeRed }, 'head', 'head'),
    { size: [0.16, 0.09, 0.1], offset: [0, 1.61, -0.22], color: MOB.zombie, role: 'jaw' },
    // A torso that narrows to the hips, with a torn hem below it.
    { size: [0.54, 0.62, 0.28], offset: [0, 1.12, 0], color: MOB.zombieShirt, tip: 0x86d3d0, role: 'body' },
    { size: [0.46, 0.16, 0.3], offset: [0, 0.78, 0], color: MOB.zombieShirt, role: 'body' },
    { size: [0.2, 0.14, 0.26], offset: [-0.1, 0.7, 0.02], color: MOB.zombieShirt, role: 'body' },
    // Shoulders at different heights: the lopsidedness is the shamble.
    ...limb([-0.29, 1.36, 0], Math.PI, [
      { length: 0.34, thick: 0.16, pitch: 0.2, color: MOB.zombieShirt },
      { length: 0.38, thick: 0.14, pitch: 0.1, color: MOB.zombie, tip: 0x9fd996 },
    ], 'armLeft'),
    ...limb([0.29, 1.31, 0], 0, [
      { length: 0.34, thick: 0.16, pitch: 0.2, color: MOB.zombieShirt },
      { length: 0.38, thick: 0.14, pitch: 0.1, color: MOB.zombie, tip: 0x9fd996 },
    ], 'armRight'),
    ...limb([-0.14, 0.72, 0], Math.PI, [
      { length: 0.4, thick: 0.19, pitch: 0.03, color: MOB.zombieLegs },
      { length: 0.32, thick: 0.17, pitch: 0.03, color: MOB.zombieLegs },
    ], 'legFrontLeft'),
    ...limb([0.14, 0.72, 0], 0, [
      { length: 0.4, thick: 0.19, pitch: 0.03, color: MOB.zombieLegs },
      { length: 0.32, thick: 0.17, pitch: 0.03, color: MOB.zombieLegs },
    ], 'legFrontRight'),
    ...pair({ size: [0.2, 0.08, 0.28], offset: [-0.14, 0.04, -0.04], color: DARK }, 'legFrontLeft', 'legFrontRight'),
  ];
  return model(parts, [
    joint('head', [0, 1.45, 0], { rest: [0.2, 0.16, 0.08] }),
    joint('jaw', [0, 1.63, -0.18], { parent: 'head' }),
    // Held out in front and dead to the walk. This was a check on the mob's kind
    // inside the renderer; how a zombie carries itself is a fact about zombies.
    joint('armLeft', [-0.29, 1.36, 0], { rest: [-1.45, 0, 0.12], gain: 0 }),
    joint('armRight', [0.29, 1.31, 0], { rest: [-1.55, 0, -0.12], gain: 0 }),
    joint('legFrontLeft', [-0.14, 0.72, 0]),
    joint('legFrontRight', [0.14, 0.72, 0]),
  ], 'biped');
}

/** Bones with daylight between them, and a bow to say it shoots. */
function skeleton(): MobModel {
  const rib = (y: number, w: number): ModelPart =>
    ({ size: [w, 0.06, 0.2], offset: [0, y, -0.01], color: MOB.bone, role: 'body' });
  const parts: ModelPart[] = [
    { size: [0.42, 0.4, 0.42], offset: [0, 1.74, 0], color: MOB.bone, tip: 0xfffcf4, role: 'head' },
    { size: [0.3, 0.14, 0.16], offset: [0, 1.6, -0.2], color: MOB.boneDeep, role: 'jaw' },
    ...pair({ size: [0.1, 0.11, 0.06], offset: [-0.11, 1.77, -0.2], color: DARK }, 'head', 'head'),
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.11, 1.77, -0.22], color: MOB.eyeBlue }, 'head', 'head'),
    { size: [0.09, 0.14, 0.09], offset: [0, 1.47, 0], color: MOB.boneDeep, role: 'neck' },
    // A rib cage with gaps in it, over a wider pelvis: the shape of a skeleton
    // is as much the daylight through it as the bone.
    { size: [0.08, 0.62, 0.08], offset: [0, 1.12, 0.08], color: MOB.boneDeep, role: 'body' },
    rib(1.35, 0.34), rib(1.24, 0.36), rib(1.13, 0.34), rib(1.02, 0.3),
    { size: [0.34, 0.12, 0.22], offset: [0, 0.84, 0], color: MOB.boneDeep, role: 'body' },
    ...limb([-0.22, 1.4, 0], Math.PI, [
      { length: 0.36, thick: 0.1, pitch: 0.12, color: MOB.bone },
      { length: 0.36, thick: 0.09, pitch: 0.12, color: MOB.boneDeep },
    ], 'armLeft'),
    ...limb([0.22, 1.4, 0], 0, [
      { length: 0.36, thick: 0.1, pitch: 0.12, color: MOB.bone },
      { length: 0.36, thick: 0.09, pitch: 0.12, color: MOB.boneDeep },
    ], 'armRight'),
    // The bow, in the left hand, as three staves and a string.
    { size: [0.05, 0.34, 0.05], offset: [-0.34, 0.85, -0.2], color: 0xb98a5a, rotation: [0, 0, 0.12], role: 'armLeft' },
    { size: [0.05, 0.2, 0.05], offset: [-0.31, 1.05, -0.24], color: 0xb98a5a, rotation: [0, 0, 0.6], role: 'armLeft' },
    { size: [0.05, 0.2, 0.05], offset: [-0.31, 0.65, -0.24], color: 0xb98a5a, rotation: [0, 0, -0.6], role: 'armLeft' },
    { size: [0.02, 0.56, 0.02], offset: [-0.29, 0.85, -0.28], color: 0xf0eadf, role: 'armLeft' },
    ...limb([-0.1, 0.82, 0], Math.PI, [
      { length: 0.44, thick: 0.1, pitch: 0.04, color: MOB.boneDeep },
      { length: 0.38, thick: 0.09, pitch: 0.04, color: MOB.bone },
    ], 'legFrontLeft'),
    ...limb([0.1, 0.82, 0], 0, [
      { length: 0.44, thick: 0.1, pitch: 0.04, color: MOB.boneDeep },
      { length: 0.38, thick: 0.09, pitch: 0.04, color: MOB.bone },
    ], 'legFrontRight'),
    ...pair({ size: [0.14, 0.06, 0.22], offset: [-0.11, 0.03, -0.05], color: MOB.bone }, 'legFrontLeft', 'legFrontRight'),
  ];
  return model(parts, [
    joint('neck', [0, 1.4, 0]),
    joint('head', [0, 1.52, 0]),
    joint('jaw', [0, 1.62, -0.12], { parent: 'head' }),
    joint('armLeft', [-0.22, 1.4, 0], { rest: [-0.55, 0, 0.1], gain: 0.35 }),
    joint('armRight', [0.22, 1.4, 0], { rest: [-0.3, 0, -0.1], gain: 0.6 }),
    joint('legFrontLeft', [-0.1, 0.82, 0]),
    joint('legFrontRight', [0.1, 0.82, 0]),
  ], 'biped');
}

/**
 * Eight legs, arched over a round abdomen.
 *
 * It had three: single bars run right through the body, no back right leg at
 * all. Eight real ones on four joints a side, fanned and bent at the knee, is
 * the single biggest change in this file.
 */
function spider(): MobModel {
  const LEG_YAWS: [JointName, JointName, number, number][] = [
    ['legFrontLeft', 'legFrontRight', 0.42, -0.34],
    ['legMidFrontLeft', 'legMidFrontRight', 1.15, -0.14],
    ['legMidBackLeft', 'legMidBackRight', 1.99, 0.06],
    ['legBackLeft', 'legBackRight', 2.72, 0.24],
  ];
  const segments: Segment[] = [
    // Up and out to the knee, then down to the ground: the arch above the body
    // is what a spider is, and a straight bar cannot say it.
    { length: 0.42, thick: 0.075, pitch: -0.85, color: MOB.spiderLeg },
    { length: 0.5, thick: 0.06, pitch: 1.15, color: MOB.spiderLeg, shape: 'taper', taper: 0.5 },
  ];
  const parts: ModelPart[] = [
    { size: [0.62, 0.5, 0.6], offset: [0, 0.44, 0.26], color: MOB.spider, tip: 0xa886c4, shape: 'sphere', role: 'body' },
    { size: [0.38, 0.3, 0.36], offset: [0, 0.42, -0.2], color: MOB.spiderDeep, shape: 'sphere', role: 'head' },
    { size: [0.16, 0.16, 0.14], offset: [0, 0.43, 0.02], color: MOB.spiderDeep, role: 'body' },
    // Four big eyes in a row and four small above, which is how a spider looks
    // at you from a distance at which nothing else is legible.
    ...pair({ size: [0.08, 0.08, 0.05], offset: [-0.06, 0.45, -0.36], color: MOB.spiderEye }, 'head', 'head'),
    ...pair({ size: [0.06, 0.06, 0.05], offset: [-0.15, 0.44, -0.32], color: MOB.spiderEye }, 'head', 'head'),
    ...pair({ size: [0.04, 0.04, 0.04], offset: [-0.08, 0.52, -0.33], color: MOB.spiderEye }, 'head', 'head'),
    ...pair({ size: [0.035, 0.035, 0.04], offset: [-0.16, 0.51, -0.29], color: MOB.spiderEye }, 'head', 'head'),
    ...pair({
      size: [0.06, 0.16, 0.06], offset: [-0.08, 0.32, -0.34], rotation: [0.5, 0, 0],
      color: MOB.spiderDeep, shape: 'taper', taper: 0.2,
    }, 'jaw', 'jaw'),
  ];
  const joints: Joint[] = [
    joint('head', [0, 0.42, -0.04]),
    joint('jaw', [0, 0.4, -0.3], { parent: 'head' }),
  ];
  for (const [left, right, yaw, z] of LEG_YAWS) {
    parts.push(...limb([-0.16, 0.46, z], Math.PI - yaw, segments, left));
    parts.push(...limb([0.16, 0.46, z], yaw, segments, right));
    joints.push(joint(left, [-0.16, 0.46, z]), joint(right, [0.16, 0.46, z]));
  }
  return model(parts, joints, 'wave');
}

// --- the farm ----------------------------------------------------------------

/** A barrel on trotters, with a snout you can see from behind. */
function pig(): MobModel {
  const legs: Segment[] = [
    { length: 0.26, thick: 0.15, pitch: 0.05, color: MOB.pigDeep },
    { length: 0.1, thick: 0.13, pitch: 0.05, color: HOOF },
  ];
  return model([
    { size: [0.58, 0.56, 0.9], offset: [0, 0.6, 0.02], color: MOB.pig, tip: 0xfbc7ce, shape: 'sphere', role: 'body' },
    { size: [0.5, 0.48, 0.4], offset: [0, 0.6, -0.44], color: MOB.pig, shape: 'sphere', role: 'body' },
    { size: [0.36, 0.34, 0.3], offset: [0, 0.62, -0.6], color: MOB.pig, tip: 0xfbc7ce, role: 'head' },
    { size: [0.2, 0.16, 0.14], offset: [0, 0.57, -0.78], color: MOB.pigSnout, shape: 'cylinder', rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    ...pair({ size: [0.045, 0.045, 0.03], offset: [-0.05, 0.57, -0.845], color: DARK }, 'head', 'head'),
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.12, 0.7, -0.74], color: DARK }, 'head', 'head'),
    // Ears flopped forward, which is most of what tells a pig from a dog at range.
    ...limb([-0.13, 0.76, -0.62], OUTWARD + 0.0, [
      { length: 0.2, thick: 0.11, pitch: 0.75, color: MOB.pigDeep, shape: 'taper', taper: 0.4 },
    ], 'earLeft'),
    ...limb([0.13, 0.76, -0.62], -0.0, [
      { length: 0.2, thick: 0.11, pitch: 0.75, color: MOB.pigDeep, shape: 'taper', taper: 0.4 },
    ], 'earRight'),
    // A curly tail: three short pieces stepping round a spiral.
    // A curl: three short pieces stepping round, each starting where the last ended.
    ...limb([0, 0.72, 0.44], BACKWARD, [
      { length: 0.13, thick: 0.05, pitch: 2.6, color: MOB.pigDeep },
      { length: 0.12, thick: 0.045, pitch: 1.2, color: MOB.pigDeep },
      { length: 0.11, thick: 0.04, pitch: 0.1, color: MOB.pigDeep },
    ], 'tail'),
    ...fourLegs(0.2, -0.28, 0.3, 0.36, legs),
  ], [
    joint('head', [0, 0.62, -0.44]),
    joint('earLeft', [-0.13, 0.76, -0.62], { parent: 'head' }),
    joint('earRight', [0.13, 0.76, -0.62], { parent: 'head' }),
    joint('tail', [0, 0.68, 0.42]),
    ...legJoints(0.2, -0.28, 0.3, 0.36),
  ], 'trot');
}

/** The biggest thing in a field: deep chest, dewlap, horns, udder, tufted tail. */
function cow(): MobModel {
  const legs: Segment[] = [
    { length: 0.5, thick: 0.17, pitch: 0.04, color: MOB.cowDeep },
    { length: 0.16, thick: 0.15, pitch: 0.04, color: HOOF },
  ];
  return model([
    { size: [0.66, 0.66, 1.02], offset: [0, 0.98, 0.04], color: MOB.cow, tip: 0xd6ab88, role: 'body' },
    // The shoulder rise, and the patches on the flanks rather than only the spine.
    { size: [0.62, 0.28, 0.4], offset: [0, 1.22, -0.24], color: MOB.cow, role: 'body' },
    { size: [0.68, 0.3, 0.36], offset: [0, 1.06, 0.2], color: MOB.cowPatch, role: 'body' },
    { size: [0.36, 0.26, 0.3], offset: [0, 1.3, 0.3], color: MOB.cowPatch, role: 'body' },
    { size: [0.28, 0.2, 0.24], offset: [0, 0.72, 0.3], color: UDDER, shape: 'sphere', role: 'body' },
    ...pair({ size: [0.05, 0.09, 0.05], offset: [-0.08, 0.64, 0.26], color: UDDER }, 'body', 'body'),
    // Neck sloping down to the head, and a dewlap hanging under it.
    { size: [0.34, 0.34, 0.34], offset: [0, 1.16, -0.58], color: MOB.cowDeep, rotation: [0.35, 0, 0], role: 'neck' },
    { size: [0.16, 0.26, 0.3], offset: [0, 0.94, -0.6], color: MOB.cowDeep, shape: 'taper', taper: 0.4, rotation: [Math.PI, 0, 0], role: 'neck' },
    { size: [0.36, 0.36, 0.4], offset: [0, 1.14, -0.86], color: MOB.cowDeep, tip: 0xbd9070, role: 'head' },
    { size: [0.3, 0.2, 0.14], offset: [0, 1.04, -1.04], color: MOB.cowPatch, role: 'head' },
    ...pair({ size: [0.06, 0.06, 0.04], offset: [-0.09, 1.06, -1.09], color: DARK }, 'head', 'head'),
    ...pair({ size: [0.07, 0.07, 0.04], offset: [-0.13, 1.2, -1.04], color: DARK }, 'head', 'head'),
    // Horns out and up, not straight up out of the skull.
    ...pair({
      size: [0.07, 0.2, 0.07], offset: [-0.19, 1.32, -0.86], rotation: [0, 0, 0.75],
      color: MOB.cowHorn, shape: 'taper', taper: 0.25,
    }, 'head', 'head'),
    ...limb([-0.16, 1.18, -0.84], OUTWARD + 0.0, [
      { length: 0.17, thick: 0.09, pitch: 1.75, color: MOB.cowDeep, shape: 'taper', taper: 0.45 },
    ], 'earLeft'),
    ...limb([0.16, 1.18, -0.84], -0.0, [
      { length: 0.17, thick: 0.09, pitch: 1.75, color: MOB.cowDeep, shape: 'taper', taper: 0.45 },
    ], 'earRight'),
    ...limb([0, 1.3, 0.5], BACKWARD, [
      { length: 0.44, thick: 0.07, pitch: 0.35, color: MOB.cowDeep },
    ], 'tail'),
    { size: [0.11, 0.17, 0.11], offset: [0, 0.82, 0.66], color: MOB.cowDeep, shape: 'sphere', role: 'tailTip' },
    ...fourLegs(0.23, -0.34, 0.36, 0.66, legs),
  ], [
    joint('neck', [0, 1.24, -0.42]),
    joint('head', [0, 1.16, -0.66]),
    joint('earLeft', [-0.16, 1.18, -0.84], { parent: 'head' }),
    joint('earRight', [0.16, 1.18, -0.84], { parent: 'head' }),
    joint('tail', [0, 1.3, 0.5]),
    joint('tailTip', [0, 0.89, 0.65], { parent: 'tail' }),
    ...legJoints(0.23, -0.34, 0.36, 0.66),
  ], 'trot');
}

/** The fleece is the animal: overlapping puffs, with a thin face and thin legs. */
function sheep(): MobModel {
  const legs: Segment[] = [
    { length: 0.4, thick: 0.13, pitch: 0.04, color: MOB.sheepDeep },
    { length: 0.1, thick: 0.12, pitch: 0.04, color: HOOF },
  ];
  const puff = (x: number, y: number, z: number, r: number): ModelPart =>
    ({ size: [r, r * 0.92, r], offset: [x, y, z], color: MOB.sheep, tip: 0xffffff, shape: 'sphere', segments: 8, role: 'body' });
  return model([
    puff(0, 0.92, 0.06, 0.72), puff(-0.16, 0.95, -0.24, 0.56), puff(0.16, 0.95, -0.24, 0.56),
    puff(-0.14, 0.9, 0.36, 0.56), puff(0.14, 0.9, 0.36, 0.56), puff(0, 1.14, 0.06, 0.5),
    { size: [0.2, 0.24, 0.26], offset: [0, 1.0, -0.5], color: MOB.sheepDeep, role: 'neck' },
    { size: [0.26, 0.28, 0.3], offset: [0, 1.02, -0.68], color: MOB.sheepDeep, tip: 0xe4d6c9, role: 'head' },
    // The woolly cap is what stops the dark face reading as a hole in the fleece.
    { size: [0.3, 0.18, 0.22], offset: [0, 1.16, -0.62], color: MOB.sheep, shape: 'sphere', segments: 8, role: 'head' },
    { size: [0.16, 0.12, 0.1], offset: [0, 0.96, -0.84], color: MOB.sheepDeep, role: 'head' },
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.08, 1.05, -0.83], color: DARK }, 'head', 'head'),
    ...limb([-0.11, 1.06, -0.68], OUTWARD + 0.0, [
      { length: 0.16, thick: 0.08, pitch: 1.35, color: MOB.sheepDeep, shape: 'taper', taper: 0.45 },
    ], 'earLeft'),
    ...limb([0.11, 1.06, -0.68], -0.0, [
      { length: 0.16, thick: 0.08, pitch: 1.35, color: MOB.sheepDeep, shape: 'taper', taper: 0.45 },
    ], 'earRight'),
    { size: [0.12, 0.16, 0.12], offset: [0, 0.94, 0.6], color: MOB.sheep, shape: 'sphere', segments: 8, role: 'tail' },
    ...fourLegs(0.22, -0.3, 0.34, 0.5, legs),
  ], [
    joint('neck', [0, 1.06, -0.38]),
    joint('head', [0, 1.02, -0.54]),
    joint('earLeft', [-0.11, 1.06, -0.68], { parent: 'head' }),
    joint('earRight', [0.11, 1.06, -0.68], { parent: 'head' }),
    joint('tail', [0, 0.98, 0.52]),
    ...legJoints(0.22, -0.3, 0.34, 0.5),
  ], 'trot');
}

/** Round, and everything about it moves: wings, tail fan, and that head. */
function chicken(): MobModel {
  const legs: Segment[] = [
    { length: 0.16, thick: 0.05, pitch: 0.04, color: MOB.beak },
    { length: 0.08, thick: 0.045, pitch: 0.04, color: MOB.beak },
  ];
  return model([
    { size: [0.3, 0.32, 0.42], offset: [0, 0.4, 0.02], color: MOB.chicken, tip: 0xffffff, shape: 'sphere', role: 'body' },
    { size: [0.12, 0.14, 0.12], offset: [0, 0.54, -0.16], color: MOB.chicken, role: 'neck' },
    { size: [0.19, 0.19, 0.19], offset: [0, 0.6, -0.22], color: MOB.chicken, tip: 0xffffff, role: 'head' },
    { size: [0.08, 0.07, 0.13], offset: [0, 0.6, -0.36], color: MOB.beak, shape: 'taper', taper: 0.3, rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    ...pair({ size: [0.04, 0.04, 0.03], offset: [-0.07, 0.65, -0.31], color: DARK }, 'head', 'head'),
    // Comb along the crown and a wattle under the beak — a chicken is a bird
    // with two red flags on it.
    { size: [0.05, 0.06, 0.07], offset: [0, 0.69, -0.26], color: MOB.comb, role: 'head' },
    { size: [0.05, 0.055, 0.06], offset: [0, 0.7, -0.19], color: MOB.comb, role: 'head' },
    { size: [0.05, 0.08, 0.05], offset: [0, 0.54, -0.33], color: MOB.comb, role: 'head' },
    ...pair({ size: [0.07, 0.2, 0.3], offset: [-0.16, 0.42, 0.0], color: MOB.chickenWing, tip: 0xffffff }, 'wingLeft', 'wingRight'),
    // A fan of three feathers rather than one block of tail.
    ...limb([0, 0.46, 0.18], BACKWARD, [
      { length: 0.24, thick: 0.14, pitch: 2.25, color: MOB.chickenWing, shape: 'box', tip: 0xffffff },
    ], 'tail'),
    ...limb([-0.06, 0.46, 0.18], BACKWARD - 0.45, [
      { length: 0.2, thick: 0.11, pitch: 2.4, color: MOB.chickenWing, shape: 'box' },
    ], 'tail'),
    ...limb([0.06, 0.46, 0.18], BACKWARD + 0.45, [
      { length: 0.2, thick: 0.11, pitch: 2.4, color: MOB.chickenWing, shape: 'box' },
    ], 'tail'),
    ...limb([-0.08, 0.24, 0], Math.PI, legs, 'legFrontLeft'),
    ...limb([0.08, 0.24, 0], 0, legs, 'legFrontRight'),
    ...pair({ size: [0.1, 0.03, 0.13], offset: [-0.08, 0.015, -0.03], color: MOB.beak }, 'legFrontLeft', 'legFrontRight'),
  ], [
    joint('neck', [0, 0.48, -0.12]),
    joint('head', [0, 0.55, -0.18]),
    joint('wingLeft', [-0.14, 0.52, 0], { rest: [0, 0, -0.1] }),
    joint('wingRight', [0.14, 0.52, 0], { rest: [0, 0, 0.1] }),
    joint('tail', [0, 0.46, 0.18], { rest: [-0.2, 0, 0] }),
    joint('legFrontLeft', [-0.08, 0.24, 0]),
    joint('legFrontRight', [0.08, 0.24, 0]),
  ], 'strut');
}

// --- the small four-legged --------------------------------------------------

/** Low and long, with a tail that never stops moving. */
function cat(): MobModel {
  const legs: Segment[] = [
    { length: 0.24, thick: 0.09, pitch: 0.03, color: MOB.catDeep },
    { length: 0.08, thick: 0.085, pitch: 0.03, color: MOB.cat },
  ];
  return model([
    { size: [0.32, 0.28, 0.58], offset: [0, 0.44, 0.02], color: MOB.cat, tip: 0xdb9c7c, role: 'body' },
    { size: [0.3, 0.16, 0.24], offset: [0, 0.54, -0.16], color: MOB.cat, role: 'body' },
    { size: [0.3, 0.2, 0.26], offset: [0, 0.5, 0.24], color: MOB.cat, role: 'body' },
    { size: [0.14, 0.12, 0.16], offset: [0, 0.5, -0.36], color: MOB.cat, role: 'neck' },
    { size: [0.28, 0.26, 0.24], offset: [0, 0.55, -0.48], color: MOB.cat, tip: 0xdb9c7c, role: 'head' },
    { size: [0.14, 0.1, 0.1], offset: [0, 0.5, -0.62], color: MOB.catDeep, shape: 'taper', taper: 0.6, rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    { size: [0.05, 0.04, 0.04], offset: [0, 0.53, -0.66], color: TONGUE, shape: 'sphere', role: 'head' },
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.07, 0.58, -0.6], color: MOB.catEye }, 'head', 'head'),
    // Whiskers: three hairlines a side, which read at any distance the cat does.
    ...pair({ size: [0.11, 0.012, 0.012], offset: [-0.11, 0.52, -0.62], rotation: [0, 0, 0.25], color: 0xf6efe6 }, 'head', 'head'),
    ...pair({ size: [0.1, 0.012, 0.012], offset: [-0.11, 0.5, -0.63], color: 0xf6efe6 }, 'head', 'head'),
    ...limb([-0.08, 0.64, -0.48], OUTWARD + 0.0, [
      { length: 0.16, thick: 0.1, pitch: 2.85, color: MOB.catDeep, shape: 'taper', taper: 0.12 },
    ], 'earLeft'),
    ...limb([0.08, 0.64, -0.48], -0.0, [
      { length: 0.16, thick: 0.1, pitch: 2.85, color: MOB.catDeep, shape: 'taper', taper: 0.12 },
    ], 'earRight'),
    // Up and over: a cat carries its tail high, and the tip lags behind the root.
    ...limb([0, 0.5, 0.3], BACKWARD, [
      { length: 0.28, thick: 0.06, pitch: 2.75, color: MOB.catDeep },
    ], 'tail'),
    ...limb([0, 0.76, 0.39], BACKWARD, [
      { length: 0.26, thick: 0.055, pitch: 2.1, color: MOB.catDeep, shape: 'taper', taper: 0.7, tip: MOB.cat },
    ], 'tailTip'),
    ...fourLegs(0.12, -0.18, 0.2, 0.32, legs),
  ], [
    joint('neck', [0, 0.5, -0.28]),
    joint('head', [0, 0.53, -0.38]),
    joint('earLeft', [-0.08, 0.64, -0.48], { parent: 'head' }),
    joint('earRight', [0.08, 0.64, -0.48], { parent: 'head' }),
    joint('tail', [0, 0.5, 0.3]),
    joint('tailTip', [0, 0.76, 0.39], { parent: 'tail' }),
    ...legJoints(0.12, -0.18, 0.2, 0.32),
  ], 'trot');
}

/** Deep chest, blunt muzzle, ears that swing, and a tail that wags sideways. */
function dog(): MobModel {
  const legs: Segment[] = [
    { length: 0.28, thick: 0.1, pitch: 0.03, color: MOB.dogDeep },
    { length: 0.1, thick: 0.095, pitch: 0.03, color: MOB.dog },
  ];
  return model([
    { size: [0.4, 0.4, 0.6], offset: [0, 0.56, 0.04], color: MOB.dog, tip: 0xd6a781, role: 'body' },
    { size: [0.42, 0.34, 0.3], offset: [0, 0.6, -0.2], color: MOB.dog, role: 'body' },
    { size: [0.34, 0.3, 0.26], offset: [0, 0.58, 0.32], color: MOB.dog, role: 'body' },
    { size: [0.2, 0.22, 0.2], offset: [0, 0.68, -0.36], color: MOB.dog, rotation: [0.2, 0, 0], role: 'neck' },
    ...pair({ size: [0.06, 0.06, 0.24], offset: [-0.14, 0.7, -0.34], color: MOB.dogCollar }, 'neck', 'neck'),
    { size: [0.28, 0.26, 0.28], offset: [0, 0.76, -0.5], color: MOB.dog, tip: 0xd6a781, role: 'head' },
    { size: [0.16, 0.14, 0.2], offset: [0, 0.7, -0.68], color: MOB.dogDeep, shape: 'taper', taper: 0.7, rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    { size: [0.08, 0.07, 0.06], offset: [0, 0.72, -0.78], color: DARK, shape: 'sphere', role: 'head' },
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.08, 0.81, -0.63], color: DARK }, 'head', 'head'),
    // Ears hanging, which is what swings when it runs.
    ...limb([-0.13, 0.86, -0.5], OUTWARD + 0.0, [
      { length: 0.22, thick: 0.11, pitch: 0.35, color: MOB.dogDeep, shape: 'taper', taper: 0.75 },
    ], 'earLeft'),
    ...limb([0.13, 0.86, -0.5], -0.0, [
      { length: 0.22, thick: 0.11, pitch: 0.35, color: MOB.dogDeep, shape: 'taper', taper: 0.75 },
    ], 'earRight'),
    ...limb([0, 0.62, 0.34], BACKWARD, [
      { length: 0.34, thick: 0.08, pitch: 2.55, color: MOB.dog, shape: 'taper', taper: 0.6, tip: MOB.dogDeep },
    ], 'tail'),
    ...fourLegs(0.15, -0.2, 0.24, 0.38, legs),
  ], [
    joint('neck', [0, 0.6, -0.26]),
    joint('head', [0, 0.72, -0.4]),
    joint('earLeft', [-0.13, 0.86, -0.5], { parent: 'head' }),
    joint('earRight', [0.13, 0.86, -0.5], { parent: 'head' }),
    joint('tail', [0, 0.62, 0.34]),
    ...legJoints(0.15, -0.2, 0.24, 0.38),
  ], 'trot');
}

/** The brush is the fox. Everything else slinks along behind it. */
function fox(): MobModel {
  const legs: Segment[] = [
    { length: 0.24, thick: 0.09, pitch: 0.03, color: MOB.foxLeg },
    { length: 0.1, thick: 0.085, pitch: 0.03, color: 0x8a4632 },
  ];
  return model([
    { size: [0.34, 0.32, 0.62], offset: [0, 0.5, 0.02], color: MOB.fox, tip: 0xf09a63, rotation: [-0.06, 0, 0], role: 'body' },
    { size: [0.3, 0.2, 0.34], offset: [0, 0.42, -0.14], color: MOB.foxDeep, role: 'body' },
    { size: [0.2, 0.18, 0.18], offset: [0, 0.56, -0.32], color: MOB.fox, role: 'neck' },
    { size: [0.26, 0.24, 0.24], offset: [0, 0.6, -0.46], color: MOB.fox, tip: 0xf09a63, role: 'head' },
    // A muzzle that actually narrows: the one shape a box cannot make.
    { size: [0.16, 0.24, 0.16], offset: [0, 0.55, -0.66], color: MOB.foxDeep, shape: 'taper', taper: 0.25, rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    { size: [0.06, 0.05, 0.05], offset: [0, 0.55, -0.78], color: DARK, shape: 'sphere', role: 'head' },
    ...pair({ size: [0.045, 0.045, 0.03], offset: [-0.07, 0.64, -0.57], color: DARK }, 'head', 'head'),
    ...limb([-0.09, 0.68, -0.46], OUTWARD + 0.0, [
      { length: 0.19, thick: 0.1, pitch: 2.9, color: MOB.fox, shape: 'taper', taper: 0.12, tip: 0x6a3a2c },
    ], 'earLeft'),
    ...limb([0.09, 0.68, -0.46], -0.0, [
      { length: 0.19, thick: 0.1, pitch: 2.9, color: MOB.fox, shape: 'taper', taper: 0.12, tip: 0x6a3a2c },
    ], 'earRight'),
    // The brush: thick, held low and level, ending in a white tip.
    ...limb([0, 0.52, 0.3], BACKWARD, [
      { length: 0.4, thick: 0.24, pitch: 1.72, color: MOB.fox, shape: 'taper', taper: 0.8 },
    ], 'tail'),
    { size: [0.2, 0.22, 0.2], offset: [0, 0.58, 0.7], color: MOB.foxDeep, shape: 'sphere', role: 'tailTip' },
    ...fourLegs(0.13, -0.2, 0.24, 0.34, legs),
  ], [
    joint('neck', [0, 0.54, -0.24]),
    joint('head', [0, 0.58, -0.36]),
    joint('earLeft', [-0.09, 0.68, -0.46], { parent: 'head' }),
    joint('earRight', [0.09, 0.68, -0.46], { parent: 'head' }),
    joint('tail', [0, 0.52, 0.3]),
    joint('tailTip', [0, 0.58, 0.7], { parent: 'tail' }),
    ...legJoints(0.13, -0.2, 0.24, 0.34),
  ], 'trot');
}

/** Haunches and ears, and it hops rather than walks. */
function rabbit(): MobModel {
  return model([
    { size: [0.26, 0.26, 0.36], offset: [0, 0.28, 0.02], color: MOB.rabbit, tip: 0xf3ded4, shape: 'sphere', role: 'body' },
    { size: [0.22, 0.2, 0.2], offset: [0, 0.4, -0.16], color: MOB.rabbit, shape: 'sphere', role: 'head' },
    { size: [0.1, 0.08, 0.09], offset: [0, 0.36, -0.27], color: MOB.rabbit, role: 'head' },
    { size: [0.05, 0.04, 0.04], offset: [0, 0.37, -0.31], color: MOB.rabbitEar, shape: 'sphere', role: 'head' },
    ...pair({ size: [0.035, 0.035, 0.03], offset: [-0.07, 0.42, -0.25], color: DARK }, 'head', 'head'),
    // Long ears, splayed a little so they are two ears and not a fin.
    ...limb([-0.055, 0.46, -0.14], OUTWARD + 0.0, [
      { length: 0.26, thick: 0.065, pitch: 3.0, color: MOB.rabbit, shape: 'taper', taper: 0.75, tip: MOB.rabbitEar },
    ], 'earLeft'),
    ...limb([0.055, 0.46, -0.14], -0.0, [
      { length: 0.26, thick: 0.065, pitch: 3.0, color: MOB.rabbit, shape: 'taper', taper: 0.75, tip: MOB.rabbitEar },
    ], 'earRight'),
    { size: [0.1, 0.1, 0.1], offset: [0, 0.3, 0.2], color: 0xfdf6f0, shape: 'sphere', role: 'tail' },
    // Big hind haunches with a foot lying flat, and small front paws.
    ...pair({ size: [0.11, 0.16, 0.18], offset: [-0.09, 0.18, 0.1], color: MOB.rabbitDeep, shape: 'sphere' }, 'legBackLeft', 'legBackRight'),
    ...pair({ size: [0.08, 0.06, 0.22], offset: [-0.09, 0.03, 0.06], color: MOB.rabbitDeep }, 'legBackLeft', 'legBackRight'),
    ...pair({ size: [0.06, 0.16, 0.06], offset: [-0.07, 0.09, -0.1], color: MOB.rabbitDeep, shape: 'cylinder' }, 'legFrontLeft', 'legFrontRight'),
  ], [
    joint('head', [0, 0.34, -0.08]),
    joint('earLeft', [-0.055, 0.46, -0.14], { parent: 'head' }),
    joint('earRight', [0.055, 0.46, -0.14], { parent: 'head' }),
    joint('tail', [0, 0.3, 0.16]),
    joint('legFrontLeft', [-0.07, 0.18, -0.1]),
    joint('legFrontRight', [0.07, 0.18, -0.1]),
    joint('legBackLeft', [-0.09, 0.26, 0.1]),
    joint('legBackRight', [0.09, 0.26, 0.1]),
  ], 'bound');
}

/** Two humps and a neck that swings. Tall enough to see over a dune. */
function camel(): MobModel {
  const legs: Segment[] = [
    { length: 0.48, thick: 0.16, pitch: 0.04, color: MOB.camelDeep },
    { length: 0.46, thick: 0.13, pitch: 0.02, color: MOB.camelDeep },
    { length: 0.12, thick: 0.2, pitch: 0, color: HOOF, shape: 'box' },
  ];
  return model([
    { size: [0.7, 0.72, 1.16], offset: [0, 1.32, 0.02], color: MOB.camel, tip: 0xd8b183, role: 'body' },
    { size: [0.5, 0.42, 0.44], offset: [0, 1.78, -0.22], color: MOB.camel, shape: 'sphere', role: 'body' },
    { size: [0.44, 0.34, 0.38], offset: [0, 1.74, 0.24], color: MOB.camel, shape: 'sphere', role: 'body' },
    ...pair({ size: [0.16, 0.22, 0.3], offset: [-0.3, 1.42, -0.4], color: MOB.camelDeep, shape: 'sphere' }, 'body', 'body'),
    // The neck as three angled pieces instead of the single upright slab it was.
    ...limb([0, 1.52, -0.48], Math.PI / 2, [
      { length: 0.34, thick: 0.3, pitch: 2.9, color: MOB.camel, shape: 'taper', taper: 0.85 },
      { length: 0.28, thick: 0.26, pitch: 2.45, color: MOB.camel, shape: 'taper', taper: 0.9 },
    ], 'neck'),
    { size: [0.24, 0.22, 0.38], offset: [0, 1.94, -0.86], color: MOB.camelDeep, role: 'head' },
    { size: [0.18, 0.16, 0.16], offset: [0, 1.88, -1.06], color: MOB.camel, shape: 'taper', taper: 0.7, rotation: [-Math.PI / 2, 0, 0], role: 'head' },
    { size: [0.15, 0.09, 0.1], offset: [0, 1.8, -1.06], color: MOB.camelDeep, role: 'jaw' },
    ...pair({ size: [0.05, 0.05, 0.03], offset: [-0.09, 1.99, -0.98], color: DARK }, 'head', 'head'),
    ...limb([-0.11, 1.98, -0.8], OUTWARD + 0.0, [
      { length: 0.12, thick: 0.07, pitch: 2.5, color: MOB.camelDeep, shape: 'taper', taper: 0.35 },
    ], 'earLeft'),
    ...limb([0.11, 1.98, -0.8], -0.0, [
      { length: 0.12, thick: 0.07, pitch: 2.5, color: MOB.camelDeep, shape: 'taper', taper: 0.35 },
    ], 'earRight'),
    ...limb([0, 1.44, 0.56], BACKWARD, [
      { length: 0.38, thick: 0.06, pitch: 0.3, color: MOB.camelDeep },
    ], 'tail'),
    ...fourLegs(0.28, -0.4, 0.42, 1.06, legs),
  ], [
    joint('neck', [0, 1.52, -0.48]),
    joint('head', [0, 1.94, -0.7]),
    joint('jaw', [0, 1.84, -0.98], { parent: 'head' }),
    joint('earLeft', [-0.11, 1.98, -0.8], { parent: 'head' }),
    joint('earRight', [0.11, 1.98, -0.8], { parent: 'head' }),
    joint('tail', [0, 1.44, 0.56]),
    ...legJoints(0.28, -0.4, 0.42, 1.06),
  ], 'plod');
}

// --- the people --------------------------------------------------------------

/** Upright, robed, hands clasped: everything the zombie is not. */
/**
 * A person.
 *
 * One function for everybody in the world, because a town of forty identical people is
 * not a town, it is a pattern — and the pattern is the one thing that makes a place look
 * generated rather than lived in. What the spec turns is what actually reads at a
 * distance: how tall they are, how big their head is for that height (a child's is much
 * bigger), whether they wear a robe or trousers, what is on their head, and what they are
 * carrying. Everything else is the same villager it always was, down to the numbers.
 *
 * `PersonSpec` and the list of people live in `people.ts`; nothing here chooses who
 * anybody is.
 */
export function villagerModel(spec: PersonSpec): MobModel {
  const s = spec.build;
  const head = 0.44 * s * spec.headScale;
  // The head sits on the neck wherever the neck is, so a bigger head grows upwards rather
  // than sinking into the shoulders.
  const neckTop = 1.48 * s;
  const headY = neckTop + head / 2;
  const crown = headY + head / 2;
  const shoulder = 1.4 * s;
  const hip = 0.34 * s;
  const parts: ModelPart[] = [
    { size: [head, head, head * 0.96], offset: [0, headY, 0], color: spec.skin, tip: lighten(spec.skin), role: 'head' },
    {
      size: [head * 0.23, head * 0.3, head * 0.32],
      offset: [0, headY - head * 0.12, -head * 0.55],
      color: darken(spec.skin), shape: 'taper', taper: 0.6, rotation: [-Math.PI / 2, 0, 0], role: 'head',
    },
    ...pair({ size: [0.05 * s, 0.05 * s, 0.03], offset: [-head * 0.23, headY + head * 0.11, -head * 0.48], color: DARK }, 'head', 'head'),
    { size: [0.16 * s, 0.14 * s, 0.16 * s], offset: [0, 1.46 * s, 0], color: darken(spec.skin), role: 'neck' },
    { size: [0.5 * s * spec.girth, 0.6 * s, 0.28 * s], offset: [0, 1.16 * s, 0], color: spec.coat, tip: darken(spec.coat), role: 'body' },
    ...limb([-0.24 * s * spec.girth, shoulder, 0], OUTWARD, [
      { length: 0.3 * s, thick: 0.15 * s, pitch: 0.14, color: spec.coat },
      { length: 0.28 * s, thick: 0.13 * s, pitch: -0.5, color: spec.skin },
    ], 'armLeft'),
    ...limb([0.24 * s * spec.girth, shoulder, 0], 0, [
      { length: 0.3 * s, thick: 0.15 * s, pitch: 0.14, color: spec.coat },
      { length: 0.28 * s, thick: 0.13 * s, pitch: -0.5, color: spec.skin },
    ], 'armRight'),
  ];
  if (spec.skirt) {
    // A robe that flares to the ground, so the walk is a sway rather than a scissor, with
    // the legs showing under the hem.
    parts.push(
      { size: [0.44 * s, 0.62 * s, 0.3 * s], offset: [0, 0.54 * s, 0], color: spec.coat, shape: 'taper', taper: 0.62, rotation: [Math.PI, 0, 0], role: 'body' },
      ...pair({ size: [0.15 * s, 0.24 * s, 0.15 * s], offset: [-0.11 * s, 0.14 * s, 0], color: spec.legs, shape: 'cylinder' }, 'legFrontLeft', 'legFrontRight'),
    );
  } else {
    parts.push(
      ...pair({ size: [0.18 * s, 0.52 * s, 0.18 * s], offset: [-0.12 * s, 0.32 * s, 0], color: spec.legs, shape: 'cylinder' }, 'legFrontLeft', 'legFrontRight'),
    );
  }
  parts.push(...pair({ size: [0.17 * s, 0.07 * s, 0.24 * s], offset: [-0.115 * s, 0.035 * s, -0.04 * s], color: HOOF }, 'legFrontLeft', 'legFrontRight'));
  parts.push(...headwear(spec, headY, head, crown, s));
  parts.push(...carried(spec, s));
  return model(parts, [
    joint('neck', [0, 1.4 * s, 0]),
    joint('head', [0, neckTop, 0]),
    // Hands clasped in front and only a little swing: a robed walk stays robed.
    joint('armLeft', [-0.24 * s * spec.girth, shoulder, 0], { rest: [-0.35, 0, 0], gain: 0.4 }),
    joint('armRight', [0.24 * s * spec.girth, shoulder, 0], { rest: [-0.35, 0, 0], gain: 0.4 }),
    joint('legFrontLeft', [-0.11 * s, hip, 0], { gain: spec.skirt ? 0.35 : 0.7 }),
    joint('legFrontRight', [0.11 * s, hip, 0], { gain: spec.skirt ? 0.35 : 0.7 }),
  ], 'biped');
}

/** Hair and hat, hung off the head so they turn with it. */
function headwear(spec: PersonSpec, headY: number, head: number, crown: number, s: number): ModelPart[] {
  const parts: ModelPart[] = [];
  const capOfHair = { size: [head + 0.02, head * 0.26, head * 0.98] as [number, number, number], offset: [0, crown - head * 0.12, 0] as [number, number, number], color: spec.hair, role: 'head' as const };
  switch (spec.hairStyle) {
    case 'crop':
      parts.push(capOfHair);
      break;
    case 'long':
      parts.push(capOfHair, {
        size: [head + 0.02, head * 0.85, head * 0.3],
        offset: [0, headY - head * 0.16, head * 0.4],
        color: spec.hair, role: 'head',
      });
      break;
    case 'braid':
      parts.push(capOfHair, {
        size: [head * 0.28, head * 1.1, head * 0.28],
        offset: [0, headY - head * 0.42, head * 0.46],
        color: spec.hair, shape: 'taper', taper: 0.5, rotation: [Math.PI, 0, 0], role: 'head',
      });
      break;
    case 'bun':
      parts.push(capOfHair, {
        size: [head * 0.4, head * 0.4, head * 0.4],
        offset: [0, crown - head * 0.02, head * 0.46],
        color: spec.hair, shape: 'sphere', role: 'head',
      });
      break;
    case 'bald':
      // A rim round the back and sides, which is what a bald head looks like at this
      // scale and is the difference between elderly and wearing a helmet.
      parts.push({
        size: [head + 0.02, head * 0.16, head * 0.98],
        offset: [0, headY + head * 0.16, head * 0.04],
        color: spec.hair, role: 'head',
      });
      break;
  }
  switch (spec.hat) {
    case 'cap':
      parts.push(
        { size: [head + 0.04, head * 0.26, head + 0.02], offset: [0, crown + head * 0.04, 0], color: PEOPLE.cap, role: 'head' },
        { size: [head * 0.9, head * 0.08, head * 0.38], offset: [0, crown - head * 0.04, -head * 0.62], color: PEOPLE.cap, role: 'head' },
      );
      break;
    case 'straw':
      // The one piece of headgear that reads from fifty blocks away.
      parts.push({
        size: [head * 2.0, head * 0.3, head * 2.0],
        offset: [0, crown + head * 0.06, 0],
        color: PEOPLE.straw, shape: 'taper', taper: 0.4, segments: 10, role: 'head',
      });
      break;
    case 'hood':
      parts.push(
        { size: [head + 0.1 * s, head + 0.06 * s, head + 0.1 * s], offset: [0, headY + head * 0.05, head * 0.05], color: spec.trim, role: 'head' },
        { size: [head * 0.72, head * 0.72, head * 0.16], offset: [0, headY - head * 0.02, -head * 0.56], color: spec.skin, role: 'head' },
      );
      break;
    case 'scarf':
      parts.push({ size: [head * 0.94, head * 0.26, head * 0.94], offset: [0, 1.44 * s, 0], color: PEOPLE.scarf, role: 'body' });
      break;
    default:
      break;
  }
  return parts;
}

/** What they have with them. On an arm where it should swing, on the body where it
 *  should not. */
function carried(spec: PersonSpec, s: number): ModelPart[] {
  switch (spec.carry) {
    case 'apron':
      return [
        { size: [0.34 * s, 0.5 * s, 0.05], offset: [0, 0.82 * s, -0.16 * s], color: PEOPLE.apron, role: 'body' },
        { size: [0.42 * s, 0.07 * s, 0.06], offset: [0, 1.05 * s, -0.16 * s], color: PEOPLE.strap, role: 'body' },
      ];
    case 'satchel':
      return [
        { size: [0.5 * s, 0.06 * s, 0.06], offset: [0, 1.2 * s, 0], color: PEOPLE.strap, rotation: [0.55, 0, 0], role: 'body' },
        { size: [0.28 * s, 0.26 * s, 0.14 * s], offset: [0.26 * s, 0.9 * s, 0.06 * s], color: PEOPLE.satchel, role: 'body' },
      ];
    case 'stick':
      return [{ size: [0.06 * s, 1.15 * s, 0.06 * s], offset: [0.32 * s, 0.58 * s, -0.06 * s], color: PEOPLE.stick, shape: 'cylinder', role: 'armRight' }];
    case 'basket':
      return [
        { size: [0.3 * s, 0.2 * s, 0.24 * s], offset: [0, 0.94 * s, -0.28 * s], color: PEOPLE.basket, shape: 'taper', taper: 1.3, role: 'body' },
        { size: [0.32 * s, 0.04 * s, 0.26 * s], offset: [0, 1.05 * s, -0.28 * s], color: PEOPLE.stick, role: 'body' },
      ];
    default:
      return [];
  }
}

/** A shade of a colour, for the highlight and the fold. Written here rather than in the
 *  palette because what is wanted is "a little lighter than whatever this person is
 *  wearing", and the palette does not know who that is. */
function lighten(colour: number): number {
  return mix(colour, 0.22);
}

function darken(colour: number): number {
  return mix(colour, -0.16);
}

function mix(colour: number, by: number): number {
  const one = (c: number): number =>
    Math.max(0, Math.min(255, Math.round(by >= 0 ? c + (255 - c) * by : c * (1 + by))));
  return (one((colour >> 16) & 255) << 16) | (one((colour >> 8) & 255) << 8) | one(colour & 255);
}

/** Every living kind. The haulers and the rolling stock keep their own tables. */
export const CREATURES = {
  zombie: zombie(),
  skeleton: skeleton(),
  spider: spider(),
  pig: pig(),
  cow: cow(),
  sheep: sheep(),
  chicken: chicken(),
  cat: cat(),
  dog: dog(),
  fox: fox(),
  rabbit: rabbit(),
  camel: camel(),
  villager: villagerModel(VILLAGERS[0]),
} as const;

export type CreatureKind = keyof typeof CREATURES;
