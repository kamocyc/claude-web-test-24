import type { Joint, JointName } from './models';

/**
 * How a mob moves, as data.
 *
 * Everything here is a pure function of the mob's state, so it is tested in Node
 * and never touches three.js. The renderer's whole job afterwards is to assign
 * the euler angles this returns.
 *
 * Two things were wrong with the animation this replaces, and both are the same
 * mistake in different places. It swung the legs about their own middles, which
 * is why a walk read as boxes rocking rather than as a stride — that is fixed in
 * the rig, by giving every joint a pivot. And it drove everything from
 * `walkPhase`, which only advances with distance travelled, so a mob that
 * stopped froze mid-scissor and a mob standing still was completely inert. Here
 * the walk is blended in by *velocity* and everything else runs off a clock, so
 * a standing animal breathes, looks about and swings its tail.
 */

export type GaitName = 'biped' | 'trot' | 'bound' | 'wave' | 'strut' | 'plod';

export interface GaitSpec {
  /** Radians a leg swings at full speed. */
  legSwing: number;
  /** Steps per unit of `walkPhase`. A chicken takes twice a camel's. */
  cadence: number;
  armSwing: number;
  /** Blocks the body rises and falls per step. */
  bodyBob: number;
  /** Extra lift once per stride: what makes a bound a bound. */
  hop: number;
  /** Head nod with the walk, and the fore-and-aft pump a bird's head does. */
  headBob: number;
  headPump: number;
  /** Idle: how far the head wanders, and how deep and slow the breathing is. */
  headSway: number;
  breath: number;
  breathRate: number;
  /** Tail sway, and which axis it swings on. A dog wags sideways. */
  tailSwing: number;
  tailAxis: 'x' | 'y';
  tailRate: number;
  /** How far an ear flicks, and how hard a wing beats. */
  earFlick: number;
  wingFlap: number;
  /** Radians added to each leg's own clock. This is the gait. */
  legPhase: Partial<Record<JointName, number>>;
}

/** Two legs, half a cycle apart, arms counter-swinging. */
const BIPED_LEGS: Partial<Record<JointName, number>> = {
  legFrontLeft: 0, legFrontRight: Math.PI,
};

/** Diagonal pairs together — the gait of every four-legged animal here. */
const TROT_LEGS: Partial<Record<JointName, number>> = {
  legFrontLeft: 0, legBackRight: 0,
  legFrontRight: Math.PI, legBackLeft: Math.PI,
};

/** Front pair together, back pair together and behind: a hop, not a walk. */
const BOUND_LEGS: Partial<Record<JointName, number>> = {
  legFrontLeft: 0, legFrontRight: 0,
  legBackLeft: Math.PI * 0.35, legBackRight: Math.PI * 0.35,
};

/**
 * Eight legs rippling front to back, the two sides half a cycle apart.
 *
 * The ripple is the whole thing: eight legs on one clock are eight windscreen
 * wipers, and eight legs a quarter-turn apart down each side is a spider.
 */
const WAVE_LEGS: Partial<Record<JointName, number>> = {
  legFrontLeft: 0, legMidFrontLeft: Math.PI * 0.5, legMidBackLeft: Math.PI, legBackLeft: Math.PI * 1.5,
  legFrontRight: Math.PI, legMidFrontRight: Math.PI * 1.5, legMidBackRight: 0, legBackRight: Math.PI * 0.5,
};

export const GAITS: Record<GaitName, GaitSpec> = {
  biped: {
    legSwing: 0.7, cadence: 1, armSwing: 0.5, bodyBob: 0.02, hop: 0,
    headBob: 0.05, headPump: 0, headSway: 0.28, breath: 0.012, breathRate: 1.1,
    tailSwing: 0, tailAxis: 'x', tailRate: 1, earFlick: 0, wingFlap: 0,
    legPhase: BIPED_LEGS,
  },
  trot: {
    legSwing: 0.62, cadence: 1, armSwing: 0, bodyBob: 0.025, hop: 0,
    headBob: 0.07, headPump: 0, headSway: 0.3, breath: 0.016, breathRate: 0.9,
    tailSwing: 0.24, tailAxis: 'x', tailRate: 1.4, earFlick: 0.5, wingFlap: 0,
    legPhase: TROT_LEGS,
  },
  bound: {
    legSwing: 0.85, cadence: 0.8, armSwing: 0, bodyBob: 0.01, hop: 0.11,
    headBob: 0.12, headPump: 0, headSway: 0.36, breath: 0.02, breathRate: 2.2,
    tailSwing: 0.2, tailAxis: 'x', tailRate: 2, earFlick: 0.75, wingFlap: 0,
    legPhase: BOUND_LEGS,
  },
  wave: {
    legSwing: 0.34, cadence: 1.6, armSwing: 0, bodyBob: 0.02, hop: 0,
    headBob: 0.05, headPump: 0, headSway: 0.2, breath: 0.01, breathRate: 1.6,
    tailSwing: 0, tailAxis: 'x', tailRate: 1, earFlick: 0, wingFlap: 0,
    legPhase: WAVE_LEGS,
  },
  strut: {
    legSwing: 0.8, cadence: 1.6, armSwing: 0, bodyBob: 0.03, hop: 0,
    headBob: 0.06, headPump: 0.1, headSway: 0.5, breath: 0.014, breathRate: 2.6,
    tailSwing: 0.16, tailAxis: 'x', tailRate: 1.8, earFlick: 0, wingFlap: 0.5,
    legPhase: BIPED_LEGS,
  },
  plod: {
    legSwing: 0.5, cadence: 0.55, armSwing: 0, bodyBob: 0.05, hop: 0,
    headBob: 0.1, headPump: 0, headSway: 0.24, breath: 0.018, breathRate: 0.7,
    tailSwing: 0.18, tailAxis: 'x', tailRate: 1, earFlick: 0.35, wingFlap: 0,
    legPhase: TROT_LEGS,
  },
};

export interface PoseInput {
  /** Distance walked, from the mob. Advances only while it is moving. */
  walkPhase: number;
  /** 0 standing, 1 at its own top speed. From velocity, not from `walkPhase`. */
  moving: number;
  /** Seconds, shared by every mob. */
  clock: number;
  /** This mob's own offset into that clock, so a herd is not in lockstep. */
  offset: number;
  /** This mob's own clock rate, near 1. */
  rate: number;
  onGround: boolean;
  /** 1 just after being hit, falling to 0. */
  hurt: number;
}

export interface Pose {
  /** Final angles, rest and gain already applied. */
  rotation: Map<JointName, [number, number, number]>;
  /** Blocks to raise the whole body. */
  lift: number;
  /** Vertical scale of the whole body: breathing. */
  breath: number;
  /** Radians to pitch the whole body back: a flinch. */
  lean: number;
}

const LEG = /^leg/;

/** A rare, sharp spike — an ear flick, with no state to remember it by. */
function flick(clock: number, offset: number): number {
  const s = Math.sin(clock * 0.7 + offset * 7);
  return s > 0 ? Math.pow(s, 14) : 0;
}

/**
 * The angles every joint of one mob should be at.
 *
 * `joints` is the model's rig; anything not in it is simply not posed. Rest and
 * gain are applied here so the renderer has nothing left to decide.
 */
export function poseMob(gait: GaitSpec, joints: readonly Joint[], input: PoseInput): Pose {
  const moving = Math.max(0, Math.min(1, input.moving));
  const idle = 1 - moving;
  const step = input.walkPhase * gait.cadence + input.offset;
  const slow = input.clock * input.rate + input.offset;
  const rotation = new Map<JointName, [number, number, number]>();

  for (const joint of joints) {
    const gain = joint.gain ?? 1;
    const phase = step + (joint.phase ?? 0);
    let x = 0, y = 0, z = 0;
    const name = joint.name;

    if (LEG.test(name)) {
      const own = gait.legPhase[name];
      // A leg the gait says nothing about stays still rather than swinging on
      // somebody else's clock; `mobModels.test.ts` refuses that combination.
      if (own !== undefined) {
        x = Math.sin(phase + own) * gait.legSwing * moving;
        // The knee lift that stops eight legs reading as wipers: a quarter of a
        // cycle after the swing, on the axis that opens the leg outwards.
        if (gait.legPhase === WAVE_LEGS) {
          z = Math.sin(phase + own + Math.PI * 0.5) * gait.legSwing * 0.5 * moving
            * (name.endsWith('Left') ? -1 : 1);
        }
      }
    } else if (name === 'armLeft' || name === 'armRight') {
      x = Math.sin(step + (name === 'armLeft' ? Math.PI : 0)) * gait.armSwing * moving;
    } else if (name === 'head' || name === 'neck') {
      const scale = name === 'neck' ? 0.5 : 1;
      // Two frequencies that do not divide each other read as looking around,
      // and cost no state at all.
      // `headPump` is the once-a-step nod a bird makes; `headBob` is the twice-a-step
      // jog every walk has. A chicken is the only thing here that does both.
      x = (Math.sin(phase * 2) * gait.headBob * moving
        + Math.sin(phase) * gait.headPump * moving
        + Math.sin(slow * 0.41 + input.offset * 1.7) * gait.headSway * 0.4 * idle) * scale;
      y = Math.sin(slow * 0.6) * gait.headSway * idle * scale;
    } else if (name === 'jaw') {
      x = 0.06 + Math.sin(slow * 0.9) * 0.05 * idle;
    } else if (name === 'earLeft' || name === 'earRight') {
      x = -flick(input.clock * input.rate, input.offset + (name === 'earLeft' ? 0 : 1.3)) * gait.earFlick;
    } else if (name === 'wingLeft' || name === 'wingRight') {
      // A real beat while falling, a flutter while walking, a shiver at rest.
      const beat = input.onGround ? Math.sin(step * 2) * moving * 0.5 + Math.sin(slow * 3) * 0.08 * idle
        : Math.sin(input.clock * 26);
      z = beat * gait.wingFlap * (name === 'wingLeft' ? -1 : 1);
    } else if (name === 'tail' || name === 'tailTip') {
      // The tip lags the root, which is what makes a tail read as one thing
      // rather than as two boxes agreeing with each other.
      const lag = name === 'tailTip' ? 0.7 : 0;
      const swing = Math.sin(slow * gait.tailRate * 2 - lag) * gait.tailSwing * (0.5 + moving * 0.8);
      if (gait.tailAxis === 'y') y = swing; else z = swing;
    }

    const rest = joint.rest ?? [0, 0, 0];
    rotation.set(name, [rest[0] + x * gain, rest[1] + y * gain, rest[2] + z * gain]);
  }

  const lift = (Math.sin(step * 2) * gait.bodyBob + Math.max(0, Math.sin(step)) * gait.hop) * moving;
  const breath = 1 + Math.sin(slow * gait.breathRate) * gait.breath * (1 - moving * 0.5);
  return { rotation, lift, breath, lean: -input.hurt * 0.22 };
}

/**
 * A mob's own offset into the idle clock and its own rate, from its id.
 *
 * Cosmetic and deterministic. Without it a field of cows breathes in unison,
 * which is more unsettling than no breathing at all.
 */
export function jitterFor(id: number): { offset: number; rate: number } {
  let h = (id * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return { offset: (h % 1024) / 1024 * Math.PI * 2, rate: 0.9 + ((h >>> 10) % 256) / 256 * 0.2 };
}
