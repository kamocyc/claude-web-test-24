import { describe, expect, it } from 'vitest';
import { spline } from '../core/noise';

/** The terrain shaper is written as a table of knots rather than nested smoothsteps so
 *  the shape of the land can be read off the numbers. That only works if the curve does
 *  what the table says. */
describe('spline', () => {
  const knots = [
    [-1, -16],
    [-0.2, 0],
    [0, 4],
    [1, 16],
  ] as const;

  it('passes exactly through its knots', () => {
    for (const [x, y] of knots) expect(spline(knots, x)).toBeCloseTo(y, 6);
  });

  it('clamps outside the table rather than extrapolating', () => {
    // Continentalness is bounded but the bound is not exact, and a curve that kept
    // climbing past the last knot would put an ocean floor or a peak outside the world.
    expect(spline(knots, -5)).toBe(-16);
    expect(spline(knots, 5)).toBe(16);
  });

  it('stays inside the segment it is interpolating', () => {
    for (let i = 0; i < 200; i++) {
      const x = -0.2 + (i / 200) * 0.2;
      const y = spline(knots, x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(4);
    }
  });

  it('rises without going backwards over a rising table', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const y = spline(knots, -1 + (i / 400) * 2);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
    }
  });
});
