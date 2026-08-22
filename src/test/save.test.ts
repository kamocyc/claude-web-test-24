import { describe, expect, it } from 'vitest';
import { decodeEdits, encodeEdits } from '../game/save';

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
