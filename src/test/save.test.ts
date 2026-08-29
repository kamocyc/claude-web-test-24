import { describe, expect, it } from 'vitest';
import {
  SAVE_VERSION,
  type SaveData,
  decodeEdits,
  encodeEdits,
  parseSave,
  saveFileName,
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
