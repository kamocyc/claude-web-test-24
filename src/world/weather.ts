import { clamp, smoothstep } from '../core/noise';
import { hashFloat } from '../core/rng';

/** The seasons. They do exactly one thing: decide how hard the springs are running.
 *  Everything the player sees — the river falling, the shallows appearing, the water
 *  taking minutes to arrive downstream — comes out of the water simulation reacting to
 *  that, not out of any formula here.
 *
 *  It is a pure function of the world seed and the elapsed time, so two machines running
 *  the same world always agree and a save only has to store one number. */

export type Season = 'normal' | 'rain' | 'drought';

/** The seasons always come round in this order, so a drought is never a surprise: the
 *  player can see it coming a full season ahead. */
const CYCLE: readonly Season[] = ['normal', 'rain', 'normal', 'drought'];

/** Half a game day (`DAY_LENGTH_SECONDS` is twice this), which is long enough to
 *  prepare for and short enough to meet several times in one sitting. */
export const SEASON_LENGTH_SECONDS = 10 * 60;
export const CYCLE_LENGTH_SECONDS = SEASON_LENGTH_SECONDS * CYCLE.length;

/** Fraction of a season spent building up, and the same again dying away. A season is
 *  at its full strength in between. */
const RAMP = 0.35;

export interface SeasonInfo {
  kind: Season;
  /** Season number since the world began. Negative before it started. */
  index: number;
  /** How hard this particular season bites, 0.55 to 1. */
  intensity: number;
  /** How far through the season, 0 to 1. */
  progress: number;
  /** Seconds until the next season begins. */
  endsIn: number;
}

/** Seasons are fixed in order but not in severity, so no two droughts feel the same. */
function intensityOf(seed: number, index: number): number {
  return 0.55 + hashFloat(seed ^ 0x5ea50, index) * 0.45;
}

function kindOf(index: number): Season {
  return CYCLE[((index % CYCLE.length) + CYCLE.length) % CYCLE.length];
}

export function seasonAt(seed: number, seconds: number): SeasonInfo {
  const clock = Math.max(0, seconds);
  const index = Math.floor(clock / SEASON_LENGTH_SECONDS);
  const progress = clock / SEASON_LENGTH_SECONDS - index;
  return {
    kind: kindOf(index),
    index,
    intensity: intensityOf(seed, index),
    progress,
    endsIn: (1 - progress) * SEASON_LENGTH_SECONDS,
  };
}

/** How wet the springs are: -1 in the worst of a drought, 0 in a normal season, +1 in
 *  the heaviest rain. A season swells to its full strength and recedes again, so the
 *  value is always continuous and always passes through 0 at a season boundary. */
export function wetnessAt(seed: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const season = seasonAt(seed, seconds);
  if (season.kind === 'normal') return 0;
  const t = season.progress;
  const swell = smoothstep(0, RAMP, t) * (1 - smoothstep(1 - RAMP, 1, t));
  return (season.kind === 'rain' ? 1 : -1) * season.intensity * swell;
}

/** How hard a spring runs at a given wetness, as a multiple of its normal output. A
 *  drought shuts them off altogether: what happens to the rivers after that is the
 *  simulation's business. */
export function springFlow(wetness: number): number {
  return clamp(1 + wetness, 0, 2);
}

export interface Forecast {
  season: SeasonInfo;
  /** What follows it. */
  next: Season;
  /** How hard the springs are running now, 0 to 2. */
  flow: number;
}

export function forecastAt(seed: number, seconds: number): Forecast {
  const season = seasonAt(seed, seconds);
  return {
    season,
    next: kindOf(season.index + 1),
    flow: springFlow(wetnessAt(seed, seconds)),
  };
}
