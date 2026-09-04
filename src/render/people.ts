/** People, as one recipe with dials on it.
 *
 *  Everybody in this world used to be the same person: one villager model, drawn once,
 *  reused for every villager, every commuter and every porter. A town of forty identical
 *  people is not a town, it is a pattern — and it is the one thing that makes a place look
 *  generated rather than lived in.
 *
 *  So a person is a spec here, and the parts are built from it. What varies is what
 *  varies about people at this scale and this distance: how tall they are, how big their
 *  head is for their height (a child's is much bigger), what their hair does, what they
 *  are wearing, and what they are carrying. Nothing here is a special case for one
 *  villager: `VILLAGERS` is a list of specs, and every one of them goes through the same
 *  function.
 *
 *  **The same recipe sits down.** A passenger in a carriage is the same person with their
 *  knees bent, so `seatedParts` takes the same spec and poses it — which is why a
 *  trainload of people looks like the people standing on the platform rather than like a
 *  row of anonymous blocks. Standing parts carry the animator's joint roles; seated ones
 *  are scenery inside a vehicle and carry none. */

import type { ModelPart } from './models';
import { PEOPLE } from './palette';

export type HairStyle = 'crop' | 'long' | 'bun' | 'braid' | 'bald';
export type Hat = 'none' | 'cap' | 'straw' | 'hood' | 'scarf';
export type Carried = 'none' | 'apron' | 'satchel' | 'stick' | 'basket';

export interface PersonSpec {
  /** What to call them, in a test and in a screenshot filename. */
  id: string;
  /** Height as a fraction of a grown adult's. A child is a little over half. */
  build: number;
  /** Head size relative to that. Children are famously top-heavy, and getting this
   *  wrong is the difference between a child and a person who has been shrunk. */
  headScale: number;
  /** How broad across the shoulders, relative to the standard body. */
  girth: number;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  hat: Hat;
  coat: number;
  trim: number;
  legs: number;
  /** A hem over the legs. The legs stay: they are what the walk swings. */
  skirt: boolean;
  carry: Carried;
}

/** The adult the seated figures are written for. The standing ones are built in
 *  `creatureModels.ts`, from the same spec and to the same proportions. */
const BODY = {
  legSpan: 0.12,
  bodyHeight: 0.6,
  bodyWidth: 0.5,
  bodyDeep: 0.28,
  head: 0.44,
};

/** Sitting height: hips to the top of the head, for a person of `build` 1. What a bench
 *  has to leave clear over it, and what tells a carriage how tall its windows must be. */
export const SEATED_HEIGHT = 1.28;

/**
 * The same person, sitting.
 *
 * Posed rather than rigged: a passenger is scenery inside a vehicle, and a seated figure
 * whose legs swung with a walk cycle would be worse than one that does not move at all.
 * The origin is the front middle of the seat cushion, and `facing` is which way along z
 * they look — so one bench of them faces the other across the aisle without any of the
 * numbers being written twice.
 */
export function seatedParts(spec: PersonSpec, facing: 1 | -1 = -1): ModelPart[] {
  const s = spec.build;
  const f = facing;
  const head = BODY.head * s * spec.headScale;
  const hip = 0.06 * s;
  const bodyY = hip + (BODY.bodyHeight * s) / 2 + 0.02;
  const headY = bodyY + (BODY.bodyHeight * s) / 2 + head / 2 - 0.02;
  const width = BODY.bodyWidth * s * spec.girth;
  const parts: ModelPart[] = [
    // Thighs forward off the seat, shins down from the knee.
    { size: [0.2 * s, 0.2 * s, 0.46 * s], offset: [-BODY.legSpan * s, hip, f * 0.2 * s], color: spec.legs, role: 'detail' },
    { size: [0.2 * s, 0.2 * s, 0.46 * s], offset: [BODY.legSpan * s, hip, f * 0.2 * s], color: spec.legs, role: 'detail' },
    { size: [0.2 * s, 0.44 * s, 0.2 * s], offset: [-BODY.legSpan * s, hip - 0.24 * s, f * 0.38 * s], color: spec.legs, role: 'detail' },
    { size: [0.2 * s, 0.44 * s, 0.2 * s], offset: [BODY.legSpan * s, hip - 0.24 * s, f * 0.38 * s], color: spec.legs, role: 'detail' },
    { size: [width, BODY.bodyHeight * s, BODY.bodyDeep * s], offset: [0, bodyY, 0], color: spec.coat, role: 'detail' },
    { size: [width * 0.9, 0.3 * s, BODY.bodyDeep * s + 0.04], offset: [0, bodyY + 0.14 * s, 0], color: spec.trim, role: 'detail' },
    // Hands in the lap.
    { size: [0.15 * s, 0.4 * s, 0.15 * s], offset: [-width / 2 - 0.02, bodyY - 0.02, f * 0.12 * s], color: spec.skin, role: 'detail', rotation: [0, 0, f * -0.5] },
    { size: [0.15 * s, 0.4 * s, 0.15 * s], offset: [width / 2 + 0.02, bodyY - 0.02, f * 0.12 * s], color: spec.skin, role: 'detail', rotation: [0, 0, f * 0.5] },
    { size: [head, head, head], offset: [0, headY, 0], color: spec.skin, role: 'detail' },
    { size: [head * 0.24, head * 0.3, head * 0.3], offset: [0, headY - head * 0.12, f * head * 0.62], color: PEOPLE.nose, role: 'detail' },
  ];
  // Hair, flattened onto the seated head by hand: the standing version hangs off the head
  // joint, and there is no head joint here to hang anything off.
  const top = headY + head / 2;
  if (spec.hairStyle !== 'bald') {
    parts.push({ size: [head + 0.02, head * 0.3, head + 0.02], offset: [0, top - head * 0.15, 0], color: spec.hair, role: 'detail' });
  }
  if (spec.hairStyle === 'long' || spec.hairStyle === 'braid') {
    parts.push({ size: [head * 0.8, head * 0.8, head * 0.26], offset: [0, headY - head * 0.2, -f * head * 0.44], color: spec.hair, role: 'detail' });
  }
  if (spec.hat === 'cap' || spec.hat === 'straw') {
    parts.push({ size: [head + 0.06, head * 0.28, head + 0.06], offset: [0, top + head * 0.05, 0], color: spec.hat === 'cap' ? PEOPLE.cap : PEOPLE.straw, role: 'detail' });
  }
  return parts;
}

/** The people the world is made of.
 *
 *  Twelve of them, and the list is the whole of the variety: no code anywhere asks what
 *  kind of person it is drawing. They differ in the four things that read at a distance —
 *  height, head, hair and dress — because those are what tell one person from another
 *  across a field, and the ones that do not read at all are not worth modelling. */
export const VILLAGERS: readonly PersonSpec[] = [
  {
    id: 'farmer', build: 1, headScale: 1, girth: 1,
    skin: PEOPLE.skin[1], hair: PEOPLE.hair[0], hairStyle: 'crop', hat: 'straw',
    coat: PEOPLE.coat[0], trim: PEOPLE.trim[0], legs: PEOPLE.legs[0], skirt: false, carry: 'apron',
  },
  {
    id: 'elder', build: 0.93, headScale: 1.02, girth: 0.97,
    skin: PEOPLE.skin[0], hair: PEOPLE.hair[4], hairStyle: 'bald', hat: 'none',
    coat: PEOPLE.coat[1], trim: PEOPLE.trim[1], legs: PEOPLE.legs[1], skirt: false, carry: 'stick',
  },
  {
    id: 'elder-shawl', build: 0.9, headScale: 1.02, girth: 1,
    skin: PEOPLE.skin[2], hair: PEOPLE.hair[5], hairStyle: 'bun', hat: 'scarf',
    coat: PEOPLE.coat[2], trim: PEOPLE.trim[2], legs: PEOPLE.legs[1], skirt: true, carry: 'basket',
  },
  {
    id: 'child', build: 0.62, headScale: 1.24, girth: 0.94,
    skin: PEOPLE.skin[1], hair: PEOPLE.hair[1], hairStyle: 'crop', hat: 'none',
    coat: PEOPLE.coat[3], trim: PEOPLE.trim[3], legs: PEOPLE.legs[2], skirt: false, carry: 'none',
  },
  {
    id: 'child-braid', build: 0.58, headScale: 1.26, girth: 0.92,
    skin: PEOPLE.skin[3], hair: PEOPLE.hair[2], hairStyle: 'braid', hat: 'none',
    coat: PEOPLE.coat[4], trim: PEOPLE.trim[4], legs: PEOPLE.legs[2], skirt: true, carry: 'none',
  },
  {
    id: 'young-long', build: 0.97, headScale: 1, girth: 0.95,
    skin: PEOPLE.skin[0], hair: PEOPLE.hair[3], hairStyle: 'long', hat: 'none',
    coat: PEOPLE.coat[5], trim: PEOPLE.trim[0], legs: PEOPLE.legs[3], skirt: true, carry: 'none',
  },
  {
    id: 'young-crop', build: 1.01, headScale: 0.98, girth: 1.02,
    skin: PEOPLE.skin[2], hair: PEOPLE.hair[1], hairStyle: 'crop', hat: 'none',
    coat: PEOPLE.coat[6], trim: PEOPLE.trim[1], legs: PEOPLE.legs[0], skirt: false, carry: 'satchel',
  },
  {
    id: 'porterly', build: 1.0, headScale: 0.96, girth: 1.08,
    skin: PEOPLE.skin[1], hair: PEOPLE.hair[0], hairStyle: 'crop', hat: 'cap',
    coat: PEOPLE.coat[7], trim: PEOPLE.trim[2], legs: PEOPLE.legs[1], skirt: false, carry: 'none',
  },
  {
    id: 'weaver', build: 0.95, headScale: 1, girth: 0.98,
    skin: PEOPLE.skin[3], hair: PEOPLE.hair[2], hairStyle: 'bun', hat: 'none',
    coat: PEOPLE.coat[8], trim: PEOPLE.trim[3], legs: PEOPLE.legs[3], skirt: true, carry: 'basket',
  },
  {
    id: 'traveller', build: 1, headScale: 1, girth: 1.04,
    skin: PEOPLE.skin[0], hair: PEOPLE.hair[3], hairStyle: 'crop', hat: 'hood',
    coat: PEOPLE.coat[9], trim: PEOPLE.trim[4], legs: PEOPLE.legs[1], skirt: false, carry: 'satchel',
  },
  {
    id: 'smith', build: 1.02, headScale: 0.98, girth: 1.12,
    skin: PEOPLE.skin[2], hair: PEOPLE.hair[4], hairStyle: 'crop', hat: 'none',
    coat: PEOPLE.coat[10], trim: PEOPLE.trim[1], legs: PEOPLE.legs[0], skirt: false, carry: 'apron',
  },
  {
    id: 'clerk', build: 0.99, headScale: 1, girth: 0.96,
    skin: PEOPLE.skin[1], hair: PEOPLE.hair[5], hairStyle: 'long', hat: 'none',
    coat: PEOPLE.coat[11], trim: PEOPLE.trim[2], legs: PEOPLE.legs[3], skirt: false, carry: 'satchel',
  },
];

/** Which of them a mob is, from a number it already has. Stable for as long as the mob
 *  is: a villager who changed clothes every time they walked out of view would be worse
 *  than a village of identical ones. */
export function villagerFor(variant: number): PersonSpec {
  const at = Math.abs(Math.floor(variant)) % VILLAGERS.length;
  return VILLAGERS[at];
}
