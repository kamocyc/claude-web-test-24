import { describe, expect, it } from 'vitest';
import { bearingBetween, isWithin } from '../game/gameNavigation';

describe('game navigation', () => {
  const origin = { x: 10, z: 20 };

  it('reports distance and compass bearing', () => {
    expect(bearingBetween(origin, { x: 10, z: 15 })).toEqual({ distance: 5, bearing: 0 });
    expect(bearingBetween(origin, { x: 15, z: 20 })).toEqual({ distance: 5, bearing: 90 });
    expect(bearingBetween(origin, { x: 5, z: 20 })).toEqual({ distance: 5, bearing: -90 });
  });

  it('includes points on the edge of the requested range', () => {
    expect(isWithin(origin, { x: 13, z: 24 }, 5)).toBe(true);
    expect(isWithin(origin, { x: 13, z: 24 }, 4.9)).toBe(false);
  });
});
