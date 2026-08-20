import { describe, expect, it } from 'vitest';
import { CHUNK_HEIGHT } from '../world/chunk';
import { clampWarpY, parseWarpTarget } from '../game/warp';

describe('warp input', () => {
  it('reads two numbers as a column and leaves the height open', () => {
    expect(parseWarpTarget('120 -340')).toEqual({ x: 120, z: -340, y: null });
  });

  it('reads three numbers as a full position', () => {
    expect(parseWarpTarget('120 72 -340')).toEqual({ x: 120, y: 72, z: -340 });
  });

  it('accepts the shapes a player is likely to paste', () => {
    const expected = { x: 12, y: 71, z: -45 };
    expect(parseWarpTarget('12, 71, -45')).toEqual(expected);
    expect(parseWarpTarget('12/71/-45')).toEqual(expected);
    expect(parseWarpTarget('  12   71  -45 ')).toEqual(expected);
    // Straight off the debug overlay.
    expect(parseWarpTarget('XYZ 12 / 71 / -45')).toEqual(expected);
    expect(parseWarpTarget('x=12 y=71 z=-45')).toEqual(expected);
  });

  it('keeps decimals', () => {
    expect(parseWarpTarget('12.5 -0.25')).toEqual({ x: 12.5, z: -0.25, y: null });
  });

  it('refuses anything that is not two or three numbers', () => {
    expect(parseWarpTarget('')).toBeNull();
    expect(parseWarpTarget('120')).toBeNull();
    expect(parseWarpTarget('1 2 3 4')).toBeNull();
    expect(parseWarpTarget('village square')).toBeNull();
    expect(parseWarpTarget('12 abc')).toBeNull();
  });

  it('keeps a typed height inside the world', () => {
    expect(clampWarpY(70)).toBe(70);
    expect(clampWarpY(-40)).toBe(1);
    expect(clampWarpY(9999)).toBe(CHUNK_HEIGHT - 3);
  });
});
