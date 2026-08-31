import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_KEY,
  SAVE_VERSION,
  type SaveData,
  decodeEdits,
  encodeEdits,
  parseSave,
  saveFileName,
  writeSave,
} from '../game/save';

/** The smallest thing `parseSave` is willing to call a world. */
function minimalSave(): SaveData {
  return {
    version: SAVE_VERSION,
    seed: 4242,
    time: 0,
    savedAt: Date.UTC(2026, 0, 2, 3, 4),
    player: {
      x: 0, y: 64, z: 0, yaw: 0, pitch: 0, health: 20, food: 20, saturation: 5,
      selected: 0, inventory: [], armor: [],
    },
    edits: {},
    water: {},
    chests: [],
    furnaces: [],
    villagers: [],
    populatedChunks: [],
    removedTrees: [],
  };
}

describe('save encoding', () => {
  it('round-trips chunk edits', () => {
    const edits = new Map<number, number>([
      [0, 1],
      [12345, 42],
      [32767, 9],
    ]);
    expect(decodeEdits(encodeEdits(edits))).toEqual(edits);
  });

  it('handles an empty edit set', () => {
    expect(decodeEdits(encodeEdits(new Map()))).toEqual(new Map());
  });

  it('stays compact for large edit sets', () => {
    const edits = new Map<number, number>();
    for (let i = 0; i < 5000; i++) edits.set(i * 3, (i % 40) + 1);
    const encoded = encodeEdits(edits);
    // 8 bytes per edit, base64 adds a third.
    expect(encoded.length).toBeLessThan(5000 * 8 * 1.4);
    expect(decodeEdits(encoded).size).toBe(5000);
  });
});

describe('save files', () => {
  it('reads back a world the player kept as a file', () => {
    const save = minimalSave();
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('refuses anything that is not this build\'s save', () => {
    expect(parseSave('not json at all')).toBeNull();
    expect(parseSave('null')).toBeNull();
    expect(parseSave(JSON.stringify({ ...minimalSave(), version: SAVE_VERSION + 1 }))).toBeNull();
    const { seed: _seed, ...seedless } = minimalSave();
    expect(parseSave(JSON.stringify(seedless))).toBeNull();
  });

  it('names a file after the world and the day it was put down', () => {
    const name = saveFileName(minimalSave());
    expect(name.startsWith('voxelcraft-4242-')).toBe(true);
    expect(name.endsWith('.json')).toBe(true);
  });
});

describe('a world that will not fit in local storage', () => {
  /** Local storage with a ceiling, as a browser hands it over. */
  function storageOf(limit: number): { store: Record<string, string>; api: object } {
    const store: Record<string, string> = {};
    return {
      store,
      api: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          if (value.length > limit) throw new Error('QuotaExceededError');
          store[key] = value;
        },
      },
    };
  }

  /** A save carrying a surveyed chunk at each of `count` places, spread out east. */
  function surveyed(count: number): SaveData {
    const explored: Record<string, string> = {};
    for (let i = 0; i < count; i++) explored[`${i},0`] = 'x'.repeat(600);
    return { ...minimalSave(), explored };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('writes the whole thing when it fits', () => {
    const { store, api } = storageOf(1_000_000);
    vi.stubGlobal('localStorage', api);
    expect(writeSave(surveyed(40), { x: 0, z: 0 })).toBe('saved');
    expect(Object.keys(JSON.parse(store[SAVE_KEY]).explored)).toHaveLength(40);
  });

  it('gives up the far edge of the map rather than the whole of it', () => {
    // Room for a fraction of the survey, and no more.
    const { store, api } = storageOf(12_000);
    vi.stubGlobal('localStorage', api);
    expect(writeSave(surveyed(100), { x: 0, z: 0 })).toBe('trimmed');
    const kept: string[] = Object.keys(JSON.parse(store[SAVE_KEY]).explored ?? {});
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(100);
    // What it kept is the ground around the player, not an arbitrary slice of the world.
    expect(kept).toContain('0,0');
    const furthest = Math.max(...kept.map((key) => Number(key.split(',')[0])));
    expect(furthest).toBe(kept.length - 1);
  });

  it('keeps the world itself even when no map fits at all', () => {
    // Room for the world and not one chunk of survey on top of it.
    const { store, api } = storageOf(JSON.stringify(minimalSave()).length + 100);
    vi.stubGlobal('localStorage', api);
    expect(writeSave(surveyed(100), { x: 0, z: 0 })).toBe('trimmed');
    const written = JSON.parse(store[SAVE_KEY]);
    expect(written.explored).toBeUndefined();
    expect(written.seed).toBe(4242);
  });

  it('says so when there is no room for the world either', () => {
    const { api } = storageOf(10);
    vi.stubGlobal('localStorage', api);
    expect(writeSave(surveyed(100), { x: 0, z: 0 })).toBe('failed');
  });
});
