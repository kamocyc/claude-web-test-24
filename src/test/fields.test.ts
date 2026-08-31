import { describe, expect, it } from 'vitest';
import {
  FIELD_RING,
  FIELD_PITCH,
  FIELD_SIZE,
  FIELD_SLOTS,
  fieldArea,
  fieldCount,
  fieldSideFor,
  fieldTarget,
  fieldsAt,
  isChannel,
  townFields,
} from '../world/generation/fields';
import { MAX_TOWN_STAGE, townExtent } from '../world/generation/districts';

const SEED = 2061350291;
const SITE = { x: 0, z: 0 };

describe('a town and its fields', () => {
  it('ploughs about twice the ground its blocks stand on, at every stage', () => {
    for (let stage = 0; stage <= MAX_TOWN_STAGE; stage++) {
      const target = fieldTarget(stage);
      const area = fieldArea(stage);
      // Rounded upward because every development stage must visibly add a whole parcel.
      expect(area).toBeGreaterThanOrEqual(target);
      expect(area - target).toBeLessThan(FIELD_SIZE * FIELD_SIZE);
    }
  });

  it('grows with the town and never shrinks', () => {
    for (let stage = 1; stage <= MAX_TOWN_STAGE; stage++) {
      expect(fieldCount(stage)).toBeGreaterThan(fieldCount(stage - 1));
    }
    expect(fieldCount(MAX_TOWN_STAGE)).toBeGreaterThan(fieldCount(0));
    expect(fieldCount(MAX_TOWN_STAGE)).toBeLessThanOrEqual(FIELD_SLOTS);
  });

  it('keeps every parcel it had when it grows', () => {
    const young = fieldsAt(SEED, SITE, 0);
    const old = fieldsAt(SEED, SITE, MAX_TOWN_STAGE);
    for (const parcel of young) {
      expect(old.find((p) => p.index === parcel.index && p.x0 === parcel.x0)).toBeDefined();
    }
    expect(old.length).toBeGreaterThan(young.length);
  });

  it('stands outside the streets and never on another parcel', () => {
    const parcels = townFields(SEED, SITE);
    const streets = townExtent();
    for (const parcel of parcels) {
      // Nearest corner of the parcel to the middle of the town, which is the one that would
      // land on a street if any of them did.
      const near = Math.min(
        ...[parcel.x0, parcel.x0 + parcel.w - 1].flatMap((x) =>
          [parcel.z0, parcel.z0 + parcel.d - 1].map((z) => Math.max(Math.abs(x), Math.abs(z))),
        ),
      );
      expect(near).toBeGreaterThan(streets);
    }
    for (const a of parcels) {
      for (const b of parcels) {
        if (a.index >= b.index) continue;
        const apart = a.x0 + a.w <= b.x0 || b.x0 + b.w <= a.x0 || a.z0 + a.d <= b.z0 || b.z0 + b.d <= a.z0;
        expect(apart, `parcels ${a.index} and ${b.index} overlap`).toBe(true);
      }
    }
  });

  it('keeps its first parcels together on one agricultural side', () => {
    const first = fieldsAt(SEED, SITE, 0);
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.every((parcel) => parcel.slot < 4)).toBe(true);
    expect(new Set(first.map((p) => p.slot)).size).toBe(1);
    const centres = first.map((p) => ({ x: p.x0 + 11, z: p.z0 + 11 }));
    for (let i = 1; i < centres.length; i++) {
      expect(Math.hypot(centres[i].x - centres[i - 1].x, centres[i].z - centres[i - 1].z))
        .toBe(FIELD_PITCH);
    }
    const grown = fieldsAt(SEED, SITE, MAX_TOWN_STAGE);
    expect(grown.every((parcel) => parcel.slot === first[0].slot)).toBe(true);
    expect(grown.some((parcel) => {
      const centre = { x: parcel.x0 + 11, z: parcel.z0 + 11 };
      return Math.max(Math.abs(centre.x), Math.abs(centre.z)) > FIELD_RING;
    })).toBe(true);
  });

  it('is the same fields however often a town is asked', () => {
    expect(townFields(SEED, SITE)).toEqual(townFields(SEED, SITE));
    // And a different town is a different picture.
    const elsewhere = townFields(SEED, { x: 320, z: -640 });
    expect(elsewhere[0].slot === townFields(SEED, SITE)[0].slot && elsewhere.length === 0).toBe(false);
  });

  it('waters every column of a parcel', () => {
    const parcel = townFields(SEED, SITE)[0];
    for (let z = parcel.z0 + 1; z < parcel.z0 + parcel.d - 1; z++) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
        let nearest = Infinity;
        for (let dx = -4; dx <= 4; dx++) {
          if (isChannel(parcel, x + dx, z)) nearest = Math.min(nearest, Math.abs(dx));
        }
        expect(nearest, `${x},${z} is dry`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('keeps the water inside the parcel, one short of each end', () => {
    const parcel = townFields(SEED, SITE)[0];
    for (let x = parcel.x0 - 2; x < parcel.x0 + parcel.w + 2; x++) {
      expect(isChannel(parcel, x, parcel.z0)).toBe(false);
      expect(isChannel(parcel, x, parcel.z0 + parcel.d - 1)).toBe(false);
    }
  });

  it('extends in rows away from town without changing agricultural side', () => {
    const half = (FIELD_SIZE - 1) / 2;
    for (const parcel of townFields(SEED, SITE)) {
      const x = parcel.x0 + half;
      const z = parcel.z0 + half;
      const outward = parcel.slot === 0 ? -z : parcel.slot === 1 ? x : parcel.slot === 2 ? z : -x;
      expect(outward).toBeGreaterThanOrEqual(FIELD_RING);
      expect((outward - FIELD_RING) % FIELD_PITCH).toBe(0);
    }
  });

  it('has no numeric parcel cap', () => {
    const distant = fieldsAt(SEED, SITE, 30);
    expect(distant.length).toBe(fieldCount(30));
    expect(distant.length).toBeGreaterThan(FIELD_SLOTS);
    expect(distant[distant.length - 1].stage).toBeLessThanOrEqual(30);
  });

  it('searches farther along the farm belt, then reports exhaustion', () => {
    const detoured = fieldsAt(SEED, SITE, 1, (parcel) => {
      const centre = { x: parcel.x0 + 11, z: parcel.z0 + 11 };
      return Math.max(Math.abs(centre.x), Math.abs(centre.z)) > FIELD_RING;
    });
    expect(detoured).toHaveLength(fieldCount(1));
    expect(detoured.every((parcel) => {
      const centre = { x: parcel.x0 + 11, z: parcel.z0 + 11 };
      return Math.max(Math.abs(centre.x), Math.abs(centre.z)) > FIELD_RING;
    })).toBe(true);
    expect(fieldsAt(SEED, SITE, 30, () => false)).toHaveLength(0);
  });

  it('chooses another single side when the seeded side has no workable land', () => {
    const preferred = fieldSideFor(SEED, SITE);
    const available = (preferred + 1) & 3;
    const parcels = fieldsAt(SEED, SITE, 8, (parcel) => parcel.slot === available);
    expect(parcels).toHaveLength(fieldCount(8));
    expect(new Set(parcels.map((parcel) => parcel.slot))).toEqual(new Set([available]));
  });
});
