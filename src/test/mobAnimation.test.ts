import { describe, expect, it } from 'vitest';
import { GAITS, jitterFor, poseMob, type PoseInput } from '../render/mobAnimation';
import { CREATURES } from '../render/creatureModels';

/**
 * How the mobs move, checked without a renderer.
 *
 * The animation this replaces had two faults that no still picture could show.
 * It drove everything from `walkPhase`, which only advances with distance
 * travelled — so a mob that stopped froze wherever the phase left it, and a mob
 * standing still never moved at all. And every mob of a kind ran off the same
 * clock, so a herd breathed in unison. Both are checked here.
 */

const still: PoseInput = {
  walkPhase: 3.1, moving: 0, clock: 12.5, offset: 0.4, rate: 1, onGround: true, hurt: 0,
};
const walking: PoseInput = { ...still, moving: 1 };

describe('a mob standing still', () => {
  it('does not hold a half-finished stride', () => {
    for (const joint of poseMob(GAITS.trot, CREATURES.cow.joints, still).rotation) {
      const [name, angles] = joint;
      if (!name.startsWith('leg')) continue;
      for (const angle of angles) expect(Math.abs(angle), `${name} at rest`).toBeLessThan(1e-9);
    }
  });

  it('still breathes, and still looks around', () => {
    const a = poseMob(GAITS.trot, CREATURES.cow.joints, still);
    const b = poseMob(GAITS.trot, CREATURES.cow.joints, { ...still, clock: still.clock + 1.7 });
    expect(a.breath).not.toBe(1);
    expect(a.rotation.get('head')).not.toEqual(b.rotation.get('head'));
  });
});

describe('a mob walking', () => {
  it('moves its legs in the pattern its gait describes', () => {
    const pose = poseMob(GAITS.trot, CREATURES.cow.joints, walking);
    const front = pose.rotation.get('legFrontLeft')![0];
    // A trot: diagonal pairs together, the other diagonal opposite.
    expect(pose.rotation.get('legBackRight')![0]).toBeCloseTo(front, 10);
    expect(pose.rotation.get('legFrontRight')![0]).toBeCloseTo(-front, 10);
    expect(Math.abs(front)).toBeGreaterThan(0.01);
  });

  /** Eight legs on one clock are eight windscreen wipers. The ripple down each
   *  side is what makes them read as a spider walking. */
  it('ripples a spider rather than sweeping it', () => {
    const pose = poseMob(GAITS.wave, CREATURES.spider.joints, walking);
    const legs = [...pose.rotation]
      .filter(([name]) => name.startsWith('leg'))
      .map(([, angles]) => angles[0]);
    expect(legs.length).toBe(8);
    expect(legs.some((a) => a > 0.02), 'no leg forward').toBe(true);
    expect(legs.some((a) => a < -0.02), 'no leg back').toBe(true);
  });

  it('lifts a rabbit off the ground and does not lift a camel', () => {
    const hop = poseMob(GAITS.bound, CREATURES.rabbit.joints, { ...walking, walkPhase: 1.2 });
    expect(hop.lift).toBeGreaterThan(0.02);
    const plod = poseMob(GAITS.plod, CREATURES.camel.joints, walking);
    expect(Math.abs(plod.lift)).toBeLessThan(0.06);
  });
});

describe('a herd', () => {
  it('is not in lockstep', () => {
    const one = jitterFor(11);
    const two = jitterFor(12);
    expect(one.offset).not.toBeCloseTo(two.offset, 2);
    const a = poseMob(GAITS.trot, CREATURES.cow.joints, { ...still, ...one });
    const b = poseMob(GAITS.trot, CREATURES.cow.joints, { ...still, ...two });
    expect(a.breath).not.toBeCloseTo(b.breath, 6);
  });

  it('gives each of them the same answer every time', () => {
    expect(jitterFor(7)).toEqual(jitterFor(7));
    const first = poseMob(GAITS.trot, CREATURES.dog.joints, walking);
    const again = poseMob(GAITS.trot, CREATURES.dog.joints, walking);
    expect([...first.rotation]).toEqual([...again.rotation]);
  });
});

describe('a joint that is pinned', () => {
  /** A zombie holds its arms out in front and they do not swing. That used to be
   *  a check on the mob's kind inside the renderer; now it is `gain: 0` on the
   *  joint, and the renderer knows nothing about zombies. */
  it('keeps its rest pose however fast the mob is going', () => {
    const arms = poseMob(GAITS.biped, CREATURES.zombie.joints, walking).rotation.get('armLeft')!;
    const rest = CREATURES.zombie.joints.find((joint) => joint.name === 'armLeft')!.rest!;
    expect(arms).toEqual(rest);
  });
});
