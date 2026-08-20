/** Time of day, expressed as a 0..1 fraction of a full day. */

export const DAY_LENGTH_SECONDS = 20 * 60;
/** Fractions of the day at which each phase starts. */
const SUNRISE = 0.0;
const DAY = 0.05;
const SUNSET = 0.45;
const NIGHT = 0.55;
const DAWN = 0.95;

export class DayCycle {
  /** 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight. */
  time = 0.1;
  /** Set to false to freeze the clock (used by the debug time controls). */
  running = true;

  update(dt: number): void {
    if (!this.running) return;
    this.time = (this.time + dt / DAY_LENGTH_SECONDS) % 1;
  }

  /** Sun strength, 0 at night and 1 during the day. */
  get sunLight(): number {
    const t = this.time;
    if (t < SUNRISE || t >= DAWN) return smooth((t >= DAWN ? t - DAWN : t + (1 - DAWN)) / (1 - DAWN + SUNRISE));
    if (t < DAY) return smooth((t - SUNRISE) / (DAY - SUNRISE));
    if (t < SUNSET) return 1;
    if (t < NIGHT) return 1 - smooth((t - SUNSET) / (NIGHT - SUNSET));
    return 0;
  }

  get isNight(): boolean {
    return this.sunLight < 0.25;
  }

  /** Angle of the sun above the horizon, in radians. */
  get sunAngle(): number {
    return (this.time - 0.25) * Math.PI * 2;
  }

  /** Human readable clock, where 0.25 of the day is noon. */
  get clock(): string {
    const totalMinutes = Math.floor(((this.time + 0.25) % 1) * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  setToMorning(): void {
    this.time = 0.05;
  }

  setToNight(): void {
    this.time = 0.6;
  }
}

function smooth(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
