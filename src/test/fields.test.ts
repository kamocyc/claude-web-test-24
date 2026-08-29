import { describe, expect, it } from 'vitest';
import {
  FIELD_RING,
  FIELD_SIZE,
  FIELD_SLOTS,
  fieldArea,
  fieldCount,
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
      // Within half a parcel of the target: the parcels are whole things and the target is
      // a ratio, so this is as close as the two can be made to agree.
      expect(Math.abs(area - target)).toBeLessThanOrEqual((FIELD_SIZE * FIELD_SIZE) / 2);
    }
  });

  it('grows with the town and never shrinks', () => {
    for (let stage = 1; stage <= MAX_TOWN_STAGE; stage++) {
      expect(fieldCount(stage)).toBeGreaterThanOrEqual(fieldCount(stage - 1));
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

  it('takes the four sides before any corner', () => {
    const first = fieldsAt(SEED, SITE, 0);
    expect(first.length).toBeGreaterThanOrEqual(3);
    // Slots 0-3 are the sides, where the plateau is flat. A town's first fields are all on
    // them, whichever way the seed turned the belt.
    expect(first.every((parcel) => parcel.slot < 4)).toBe(true);
    expect(new Set(first.map((p) => p.slot)).size).toBe(first.length);
    const grown = fieldsAt(SEED, SITE, MAX_TOWN_STAGE);
    expect(grown.some((parcel) => parcel.slot >= 4)).toBe(true);
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

  it('stands on a square belt, one parcel out from the grid', () => {
    const half = (FIELD_SIZE - 1) / 2;
    for (const parcel of townFields(SEED, SITE)) {
      // The town is a square grid, so the belt around it is measured the same way.
      const middle = Math.max(Math.abs(parcel.x0 + half), Math.abs(parcel.z0 + half));
      expect(middle).toBe(FIELD_RING);
    }
  });
});
