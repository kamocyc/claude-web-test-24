import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SPEEDS,
  loadSettings,
  nearestSpeed,
  saveSettings,
} from '../game/settings';

afterEach(() => vi.unstubAllGlobals());

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

describe('graphics settings', () => {
  it('keeps rounded terrain enabled by default', () => {
    expect(DEFAULT_SETTINGS.roundedBlocks).toBe(true);
  });

  it('loads and saves the rounded terrain preference', () => {
    let stored = JSON.stringify({ roundedBlocks: false });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SETTINGS_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === SETTINGS_KEY) stored = value;
      },
    });

    const settings = loadSettings();
    expect(settings.roundedBlocks).toBe(false);
    settings.roundedBlocks = true;
    saveSettings(settings);
    expect(JSON.parse(stored).roundedBlocks).toBe(true);
  });

  it('enables rounded terrain when loading settings written before the option existed', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ renderDistance: 6 }),
    });
    expect(loadSettings().roundedBlocks).toBe(true);
  });
});
