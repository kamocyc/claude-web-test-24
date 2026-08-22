import { clamp, smoothstep } from '../core/noise';
import { hashFloat } from '../core/rng';

/** The weather happens in the headwaters, far off the map, and reaches the player only
 *  once the water has run down to them. Everything here is a pure function of the world
 *  seed and the elapsed time, so two machines running the same world always agree and a
 *  save only has to store one number. */

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

/** How long the water takes to run from the headwaters down to the sea. This is the
 *  whole point of the system: a drought that starts now reaches the river mouth four
 *  minutes later, and the player has that long to fill their reservoir. */
export const MAX_TRAVEL_SECONDS = 4 * 60;

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

/** How long news from the headwaters takes to reach a column. */
export function travelDelay(inland: number): number {
  return (1 - clamp(inland, 0, 1)) * MAX_TRAVEL_SECONDS;
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

/** How wet the headwaters are: -1 in the worst of a drought, 0 in a normal season, +1
 *  in the heaviest rain. A season swells to its full strength and recedes again, so the
 *  value is always continuous and always passes through 0 at a season boundary. */
export function wetnessAt(seed: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const season = seasonAt(seed, seconds);
  if (season.kind === 'normal') return 0;
  const t = season.progress;
  const swell = smoothstep(0, RAMP, t) * (1 - smoothstep(1 - RAMP, 1, t));
  return (season.kind === 'rain' ? 1 : -1) * season.intensity * swell;
}

/** The wetness that has actually arrived at a column, which is what the headwaters were
 *  doing a while ago. */
export function localWetness(seed: number, seconds: number, inland: number): number {
  return wetnessAt(seed, seconds - travelDelay(inland));
}

export interface Forecast {
  /** What the water at this column is doing now. */
  here: SeasonInfo;
  /** What follows it here. */
  next: Season;
  /** What the headwaters are doing, which is what will arrive here later. */
  upstream: Season;
  /** How far behind the headwaters this column runs. */
  delay: number;
  /** Local wetness, -1 to +1. */
  wetness: number;
}

export function forecastAt(seed: number, seconds: number, inland: number): Forecast {
  const delay = travelDelay(inland);
  const here = seasonAt(seed, seconds - delay);
  return {
    here,
    next: kindOf(here.index + 1),
    upstream: seasonAt(seed, seconds).kind,
    delay,
    wetness: localWetness(seed, seconds, inland),
  };
}
