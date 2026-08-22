import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SPEEDS, nearestSpeed } from '../game/settings';

describe('game speed', () => {
  it('offers powers of two up to sixteen', () => {
    expect([...SPEEDS]).toEqual([1, 2, 4, 8, 16]);
    expect(DEFAULT_SETTINGS.speed).toBe(1);
  });

  it('snaps whatever came out of storage onto one of them', () => {
    for (const speed of SPEEDS) expect(nearestSpeed(speed)).toBe(speed);
    expect(nearestSpeed(3)).toBe(2);
    expect(nearestSpeed(7)).toBe(8);
    expect(nearestSpeed(1000)).toBe(16);
    expect(nearestSpeed(0)).toBe(1);
    expect(nearestSpeed(-4)).toBe(1);
  });

  it('falls back to real time when the stored value is nonsense', () => {
    expect(nearestSpeed(Number.NaN)).toBe(1);
    expect(nearestSpeed(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
