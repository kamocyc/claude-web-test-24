import { describe, expect, it } from 'vitest';
import {
  CYCLE_LENGTH_SECONDS,
  SEASON_LENGTH_SECONDS,
  forecastAt,
  seasonAt,
  springFlow,
  wetnessAt,
} from '../world/weather';
import { DAY_LENGTH_SECONDS } from '../game/daycycle';

const SEED = 2061350291;

describe('weather', () => {
  it('runs a season every half day', () => {
    expect(SEASON_LENGTH_SECONDS * 2).toBe(DAY_LENGTH_SECONDS);
    expect(CYCLE_LENGTH_SECONDS).toBe(SEASON_LENGTH_SECONDS * 4);
  });

  it('always brings the seasons round in the same order', () => {
    const kinds = [0, 1, 2, 3, 4, 5].map(
      (i) => seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).kind,
    );
    expect(kinds).toEqual(['normal', 'rain', 'normal', 'drought', 'normal', 'rain']);
    // A drought is never a surprise: the season before one is always calm.
    for (let i = 0; i < 12; i++) {
      const here = seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).kind;
      const next = seasonAt(SEED, (i + 1.5) * SEASON_LENGTH_SECONDS).kind;
      if (next !== 'normal') expect(here).toBe('normal');
    }
  });

  it('varies how hard a season bites, but not for a given seed', () => {
    const at = (i: number) => seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).intensity;
    expect(at(3)).toBe(at(3));
    expect(at(3)).not.toBe(at(7));
    for (let i = 0; i < 20; i++) {
      expect(at(i)).toBeGreaterThanOrEqual(0.55);
      expect(at(i)).toBeLessThanOrEqual(1);
    }
  });

  it('starts calm and turns the springs gradually', () => {
    expect(wetnessAt(SEED, 0)).toBe(0);
    expect(wetnessAt(SEED, -500)).toBe(0);
    let previous = 0;
    let biggestJump = 0;
    let driest = 0;
    let wettest = 0;
    for (let t = 0; t <= CYCLE_LENGTH_SECONDS * 2; t += 1) {
      const wetness = wetnessAt(SEED, t);
      expect(wetness).toBeGreaterThanOrEqual(-1);
      expect(wetness).toBeLessThanOrEqual(1);
      biggestJump = Math.max(biggestJump, Math.abs(wetness - previous));
      driest = Math.min(driest, wetness);
      wettest = Math.max(wettest, wetness);
      previous = wetness;
    }
    // No step change anywhere: a spring is never switched off between one tick and the
    // next, it dries up.
    expect(biggestJump).toBeLessThan(0.01);
    expect(driest).toBeLessThan(-0.5);
    expect(wettest).toBeGreaterThan(0.5);
    // Every season boundary passes through a normal flow.
    for (let i = 0; i <= 8; i++) {
      expect(wetnessAt(SEED, i * SEASON_LENGTH_SECONDS)).toBeCloseTo(0, 6);
    }
  });

  it('shuts the springs off in a drought and doubles them in the rain', () => {
    expect(springFlow(0)).toBe(1);
    expect(springFlow(-1)).toBe(0);
    expect(springFlow(1)).toBe(2);
    let previous = -Infinity;
    for (let w = -1; w <= 1; w += 0.05) {
      const flow = springFlow(w);
      expect(flow).toBeGreaterThan(previous);
      previous = flow;
    }
  });

  it('reports the season the springs are in, and what follows it', () => {
    // Deep into the drought: the springs are off, and calm weather is next. What the
    // rivers do about it is the water simulation's business, not the forecast's.
    const forecast = forecastAt(SEED, SEASON_LENGTH_SECONDS * 3.5);
    expect(forecast.season.kind).toBe('drought');
    expect(forecast.next).toBe('normal');
    expect(forecast.flow).toBeLessThan(0.5);
    expect(forecast.season.endsIn).toBeCloseTo(SEASON_LENGTH_SECONDS / 2, 3);

    const calm = forecastAt(SEED, SEASON_LENGTH_SECONDS * 0.5);
    expect(calm.season.kind).toBe('normal');
    expect(calm.next).toBe('rain');
    expect(calm.flow).toBe(1);
  });
});
