import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAP_ZOOM_RANGE,
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

describe('the span the big map opens at', () => {
  it('starts at the corner map\'s own zoom', () => {
    expect(DEFAULT_SETTINGS.mapZoom).toBe(2);
  });

  it('is remembered, so a map read at eight thousand blocks opens there again', () => {
    const stored: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => { stored[key] = value; },
    });
    saveSettings({ ...DEFAULT_SETTINGS, mapZoom: 16 });
    expect(loadSettings().mapZoom).toBe(16);
  });

  it('keeps a stored zoom inside the range the map offers', () => {
    const stored: Record<string, string> = { [SETTINGS_KEY]: JSON.stringify({ mapZoom: 4096 }) };
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null, setItem: () => {} });
    expect(loadSettings().mapZoom).toBe(MAP_ZOOM_RANGE.max);
    stored[SETTINGS_KEY] = JSON.stringify({ mapZoom: 0 });
    expect(loadSettings().mapZoom).toBe(MAP_ZOOM_RANGE.min);
  });

  it('falls back to the default for a settings file with nothing to say about it', () => {
    const stored: Record<string, string> = { [SETTINGS_KEY]: JSON.stringify({ speed: 4 }) };
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null, setItem: () => {} });
    expect(loadSettings().mapZoom).toBe(DEFAULT_SETTINGS.mapZoom);
  });
});
