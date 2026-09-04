import { describe, expect, it } from 'vitest';
import { CREATURES, type CreatureKind } from '../render/creatureModels';
import { carLoadKey, carModel, modelFor, variantCount, type Joint, type JointName, type ModelPart } from '../render/models';
import { VILLAGERS } from '../render/people';
import { CAR_LENGTH, CAR_WIDTH, ROOF_TOP } from '../game/consist';
import { GAITS } from '../render/mobAnimation';
import { MOB_KINDS, mobDef } from '../game/mobs/types';

/**
 * The mob models, checked as data.
 *
 * None of this can be seen from a screenshot of one mob standing still, which is
 * how the old models kept a spider with three legs and a chicken whose wings
 * were tagged as scenery. A model is three hundred hand-written numbers and a
 * rig; what is checked here is that they agree with each other, with the box the
 * game collides with, and with the gait that is going to drive them.
 */

/** How far past its collision box an appendage may reach.
 *
 *  Not zero, and deliberately so: a cow's head is outside the box it walks with,
 *  and always was. What this catches is a part somewhere else entirely. */
const OVERHANG = 1.6;

interface Box {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

/** The renderer's own rotation order — twist, pitch, turn — applied to a vector. */
function turn(v: readonly [number, number, number], rot: readonly [number, number, number]) {
  const [x, y, z] = v;
  const [rx, ry, rz] = rot;
  const x1 = x * Math.cos(rz) - y * Math.sin(rz), y1 = x * Math.sin(rz) + y * Math.cos(rz);
  const y2 = y1 * Math.cos(rx) - z * Math.sin(rx), z2 = y1 * Math.sin(rx) + z * Math.cos(rx);
  return [x1 * Math.cos(ry) + z2 * Math.sin(ry), y2, -x1 * Math.sin(ry) + z2 * Math.cos(ry)];
}

/** The space a set of parts actually occupies, rotations included. */
function boxOf(parts: readonly ModelPart[]): Box {
  const box: Box = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
  };
  for (const part of parts) {
    const rot = part.rotation ?? [0, 0, 0];
    const axes = [turn([1, 0, 0], rot), turn([0, 1, 0], rot), turn([0, 0, 1], rot)];
    // The turned box's extent on each world axis is the sum of |axis component|
    // times the half-size it carries.
    const reach = [0, 1, 2].map((i) =>
      Math.abs(axes[0][i]) * part.size[0] / 2
      + Math.abs(axes[1][i]) * part.size[1] / 2
      + Math.abs(axes[2][i]) * part.size[2] / 2);
    box.minX = Math.min(box.minX, part.offset[0] - reach[0]);
    box.maxX = Math.max(box.maxX, part.offset[0] + reach[0]);
    box.minY = Math.min(box.minY, part.offset[1] - reach[1]);
    box.maxY = Math.max(box.maxY, part.offset[1] + reach[1]);
    box.minZ = Math.min(box.minZ, part.offset[2] - reach[2]);
    box.maxZ = Math.max(box.maxZ, part.offset[2] + reach[2]);
  }
  return box;
}

const KINDS = Object.keys(CREATURES) as CreatureKind[];

describe('every mob has a model', () => {
  it('covers every kind the game can spawn', () => {
    for (const kind of MOB_KINDS) {
      const model = modelFor(kind);
      expect(model.parts.length, `${kind} has no parts`).toBeGreaterThan(0);
      expect(GAITS[model.gait], `${kind} has no gait`).toBeDefined();
    }
    // The living ones are modelled by hand; the haulers and rolling stock reuse
    // the person and the train, which is why they are not in this list.
    expect(KINDS.length).toBe(13);
  });

  it('keeps its parts inside the box the game collides with', () => {
    // A raised tail and a pricked ear stand above the animal's own back — a cat
    // carrying its tail high is a third taller than the box it walks through —
    // so they are measured against a looser ceiling than the body is.
    const APPENDAGE = new Set(['tail', 'tailTip', 'earLeft', 'earRight']);
    for (const kind of KINDS) {
      const def = mobDef(kind);
      const parts = CREATURES[kind].parts;
      const box = boxOf(parts);
      const core = boxOf(parts.filter((part) => !APPENDAGE.has(part.role)));
      const half = def.width / 2 * OVERHANG;
      expect(box.maxX, `${kind} reaches too far right`).toBeLessThanOrEqual(half);
      expect(box.minX, `${kind} reaches too far left`).toBeGreaterThanOrEqual(-half);
      expect(core.maxY, `${kind} is taller than it collides`).toBeLessThanOrEqual(def.height * 1.06);
      expect(box.maxY, `${kind} carries something absurdly high`)
        .toBeLessThanOrEqual(def.height * 1.45);
      expect(box.maxZ - box.minZ, `${kind} is longer than it is allowed`)
        .toBeLessThanOrEqual(Math.max(def.width, def.height) * 2.2);
    }
  });

  it('stands on the ground rather than floating over it or sunk into it', () => {
    for (const kind of KINDS) {
      const box = boxOf(CREATURES[kind].parts);
      // Measured on the widest dimension of each part, so a hoof's bevel can sit
      // a little under; what this refuses is a whole animal in the air.
      expect(box.minY, `${kind} floats`).toBeLessThanOrEqual(0.12);
      expect(box.minY, `${kind} is buried`).toBeGreaterThanOrEqual(-0.16);
    }
  });
});

describe('a model and its rig', () => {
  it('hangs every part on something that exists', () => {
    for (const kind of KINDS) {
      const { parts, joints } = CREATURES[kind];
      const names = new Set(joints.map((j) => j.name));
      for (const part of parts) {
        if (part.role === 'body' || part.role === 'detail') continue;
        expect(names.has(part.role), `${kind} hangs a part on a missing joint ${part.role}`).toBe(true);
      }
    }
  });

  it('gives every joint a parent that exists, and no loops', () => {
    for (const kind of KINDS) {
      const { joints } = CREATURES[kind];
      const byName = new Map<JointName, Joint>();
      for (const joint of joints) {
        expect(byName.has(joint.name), `${kind} names ${joint.name} twice`).toBe(false);
        byName.set(joint.name, joint);
      }
      for (const joint of joints) {
        const seen = new Set<JointName>([joint.name]);
        let at: Joint | undefined = joint;
        while (at?.parent) {
          expect(byName.has(at.parent), `${kind}: ${at.name} hangs off a missing ${at.parent}`).toBe(true);
          expect(seen.has(at.parent), `${kind} has a loop at ${at.parent}`).toBe(false);
          seen.add(at.parent);
          at = byName.get(at.parent);
        }
      }
    }
  });

  /** The hip has to be on the leg. A pivot away from the parts it turns is the
   *  one mistake in a rig that looks fine standing still and tears the animal in
   *  half the moment it walks. */
  it('puts every pivot on the parts it turns', () => {
    for (const kind of KINDS) {
      const { parts, joints } = CREATURES[kind];
      for (const joint of joints) {
        const own = parts.filter((part) => part.role === joint.name);
        if (own.length === 0) continue;
        const box = boxOf(own);
        const slack = 0.06;
        expect(joint.pivot[0], `${kind}: ${joint.name} pivot is off its parts in x`)
          .toBeGreaterThanOrEqual(box.minX - slack);
        expect(joint.pivot[0], `${kind}: ${joint.name} pivot is off its parts in x`)
          .toBeLessThanOrEqual(box.maxX + slack);
        expect(joint.pivot[1], `${kind}: ${joint.name} pivot is off its parts in y`)
          .toBeGreaterThanOrEqual(box.minY - slack);
        expect(joint.pivot[1], `${kind}: ${joint.name} pivot is off its parts in y`)
          .toBeLessThanOrEqual(box.maxY + slack);
        expect(joint.pivot[2], `${kind}: ${joint.name} pivot is off its parts in z`)
          .toBeGreaterThanOrEqual(box.minZ - slack);
        expect(joint.pivot[2], `${kind}: ${joint.name} pivot is off its parts in z`)
          .toBeLessThanOrEqual(box.maxZ + slack);
      }
    }
  });

  /** A leg the gait has no phase for would stand still while the others walked;
   *  a phase for a leg the model does not have is a leg somebody forgot. */
  it('agrees with its gait about which legs it has', () => {
    for (const kind of KINDS) {
      const { joints, gait } = CREATURES[kind];
      const legs = joints.filter((joint) => joint.name.startsWith('leg')).map((joint) => joint.name);
      const phases = Object.keys(GAITS[gait].legPhase) as JointName[];
      expect(new Set(legs), `${kind} legs vs its ${gait} gait`).toEqual(new Set(phases));
    }
  });

  it('is symmetrical wherever it claims to be', () => {
    for (const kind of KINDS) {
      // The zombie is lopsided on purpose — one shoulder lower than the other is
      // what makes it shamble rather than march — so it is the one exception.
      if (kind === 'zombie') continue;
      const parts = CREATURES[kind].parts;
      const mirrored = (role: string) => role.replace(/Left$/, 'Right');
      for (const part of parts) {
        if (!part.role.endsWith('Left')) continue;
        // Arms are where deliberate asymmetry lives — the skeleton carries its
        // bow in one hand — so only the parts nobody has a reason to make
        // one-sided are held to this.
        if (part.role === 'armLeft') continue;
        const twin = parts.find((other) =>
          other.role === mirrored(part.role)
          && Math.abs(other.offset[0] + part.offset[0]) < 1e-6
          && Math.abs(other.offset[1] - part.offset[1]) < 1e-6
          && Math.abs(other.offset[2] - part.offset[2]) < 1e-6
          && other.size[1] === part.size[1]);
        expect(twin, `${kind}: ${part.role} at ${part.offset} has no mirror`).toBeDefined();
      }
    }
  });

  /** Parts cost geometry and joints cost draw calls. Neither is free, and the
   *  point of the merge is spent if a species quietly doubles. */
  it('stays inside its budget', () => {
    for (const kind of KINDS) {
      const { parts, joints } = CREATURES[kind];
      expect(parts.length, `${kind} has too many parts`).toBeLessThanOrEqual(40);
      expect(joints.length, `${kind} has too many joints`).toBeLessThanOrEqual(14);
    }
  });
});

describe('the people of the world', () => {
  it('has a dozen of them, all different', () => {
    expect(VILLAGERS.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(VILLAGERS.map((spec) => spec.id));
    expect(ids.size, 'two people share an id').toBe(VILLAGERS.length);
    // Different in the four things that read at a distance. Two people who differ only
    // in the colour of their shoes are one person as far as a street is concerned.
    const looks = new Set(
      VILLAGERS.map((spec) => `${spec.build}|${spec.hairStyle}${spec.hat}|${spec.coat}|${spec.skirt}`),
    );
    expect(looks.size).toBe(VILLAGERS.length);
  });

  it('covers the range of people a town holds', () => {
    // Children, elders and grown adults, and both ways of dressing. Not a checklist for
    // its own sake: a crowd that is all one height and all one silhouette is the thing
    // this replaced.
    expect(VILLAGERS.some((spec) => spec.build < 0.7)).toBe(true);
    expect(VILLAGERS.some((spec) => spec.build > 1)).toBe(true);
    expect(VILLAGERS.some((spec) => spec.hairStyle === 'bald' || spec.hair === 0xd9d4cc)).toBe(true);
    expect(VILLAGERS.some((spec) => spec.skirt)).toBe(true);
    expect(VILLAGERS.some((spec) => !spec.skirt)).toBe(true);
    expect(new Set(VILLAGERS.map((spec) => spec.skin)).size).toBeGreaterThanOrEqual(3);
  });

  it('builds every one of them to fit the box the game collides with', () => {
    const def = mobDef('villager');
    for (let variant = 0; variant < VILLAGERS.length; variant++) {
      const model = modelFor('villager', variant);
      const box = boxOf(model.parts);
      const who = VILLAGERS[variant].id;
      expect(box.maxY, `${who} is taller than a villager collides`).toBeLessThanOrEqual(def.height * 1.06);
      expect(box.maxX, `${who} reaches too far right`).toBeLessThanOrEqual((def.width / 2) * OVERHANG);
      expect(box.minX, `${who} reaches too far left`).toBeGreaterThanOrEqual(-(def.width / 2) * OVERHANG);
      expect(box.minY, `${who} floats`).toBeLessThanOrEqual(0.12);
      expect(box.minY, `${who} is buried`).toBeGreaterThanOrEqual(-0.16);
    }
  });

  it('hangs every part of every one of them on a joint that exists', () => {
    for (const kind of ['villager', 'porter', 'cart'] as const) {
      for (let variant = 0; variant < VILLAGERS.length; variant++) {
        const { parts, joints } = modelFor(kind, variant);
        const names = new Set(joints.map((joint) => joint.name));
        for (const part of parts) {
          if (part.role === 'body' || part.role === 'detail') continue;
          expect(names.has(part.role), `${kind} ${variant} hangs a part on a missing ${part.role}`)
            .toBe(true);
        }
      }
    }
  });

  it('gives a porter and a carter the person their variant says', () => {
    // The same body under the crate, so the porter who walks out of a village is somebody
    // from it rather than a uniformed stranger.
    const person = modelFor('villager', 3).parts;
    const porter = modelFor('porter', 3).parts;
    expect(porter.length).toBeGreaterThan(person.length);
    for (let i = 0; i < person.length; i++) expect(porter[i]).toEqual(person[i]);
    expect(modelFor('porter', 3).parts).not.toEqual(modelFor('porter', 4).parts);
  });

  it('takes any number for a variant', () => {
    // Mob ids and hashes go in here; nothing is required to have taken a modulo first.
    expect(modelFor('villager', -1).parts).toEqual(modelFor('villager', VILLAGERS.length - 1).parts);
    expect(modelFor('villager', VILLAGERS.length * 3 + 2).parts).toEqual(modelFor('villager', 2).parts);
    expect(variantCount('villager')).toBe(VILLAGERS.length);
    expect(variantCount('cow')).toBe(1);
  });
});

describe('what a vehicle is carrying', () => {
  it('draws a different load for a different good', () => {
    const logs = carModel('wagon', { good: 'oak_log', riders: 0 });
    const coal = carModel('wagon', { good: 'coal', riders: 0 });
    const empty = carModel('wagon', { good: null, riders: 0 });
    expect(logs).not.toEqual(coal);
    // An empty wagon is the wagon and nothing else, which is how a train running home
    // light says so.
    expect(empty.length).toBeLessThan(logs.length);
    expect(empty.length).toBeLessThan(coal.length);
  });

  it('keeps the load inside the wagon', () => {
    for (const good of ['oak_log', 'coal', 'wheat', 'iron_ingot', 'oak_planks', 'glass', 'torch', 'emerald']) {
      const box = boxOf(carModel('wagon', { good, riders: 0 }));
      expect(box.maxX, `${good} hangs over the side`).toBeLessThanOrEqual(CAR_WIDTH / 2 + 0.2);
      expect(box.minX, `${good} hangs over the side`).toBeGreaterThanOrEqual(-CAR_WIDTH / 2 - 0.2);
      expect(box.maxZ, `${good} hangs over the end`).toBeLessThanOrEqual(CAR_LENGTH / 2 + 0.2);
      expect(box.maxY, `${good} is piled absurdly high`).toBeLessThanOrEqual(3);
    }
  });

  it('puts people in a carriage, and none in an empty one', () => {
    const empty = carModel('coach', { good: null, riders: 0 });
    const full = carModel('coach', { good: null, riders: 4 });
    expect(full.length).toBeGreaterThan(empty.length);
    // Sitting on the seats, under the roof, and inside the sides.
    const box = boxOf(full);
    expect(box.maxY).toBeLessThanOrEqual(ROOF_TOP);
    expect(box.maxX).toBeLessThanOrEqual(CAR_WIDTH / 2 + 0.1);
    expect(box.minX).toBeGreaterThanOrEqual(-CAR_WIDTH / 2 - 0.1);
  });

  it('keys a car\'s geometry by everything that changes it and nothing else', () => {
    expect(carLoadKey('wagon', { good: 'coal', riders: 0 }))
      .not.toBe(carLoadKey('wagon', { good: 'oak_log', riders: 0 }));
    expect(carLoadKey('coach', { good: null, riders: 2 }))
      .not.toBe(carLoadKey('coach', { good: null, riders: 4 }));
    // A coach does not care what the train is carrying and a wagon does not care who is
    // on it, so neither of those may split the cache.
    expect(carLoadKey('coach', { good: 'coal', riders: 2 }))
      .toBe(carLoadKey('coach', { good: null, riders: 2 }));
    expect(carLoadKey('wagon', { good: 'coal', riders: 4 }))
      .toBe(carLoadKey('wagon', { good: 'coal', riders: 0 }));
  });
});
