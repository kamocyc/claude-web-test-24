import { describe, expect, it } from 'vitest';
import { movementFromInput, punctuationCommand } from '../game/gameInput';

describe('game input conversion', () => {
  it('maps punctuation by produced character', () => {
    expect(punctuationCommand('[')).toBe('slower');
    expect(punctuationCommand(']')).toBe('faster');
    expect(punctuationCommand('+')).toBe('zoom-in');
    expect(punctuationCommand('=')).toBe('zoom-in');
    expect(punctuationCommand('-')).toBe('zoom-out');
    expect(punctuationCommand('a')).toBeNull();
  });

  it('converts held keys into player movement', () => {
    const held = new Set(['KeyW', 'KeyD', 'Space', 'ShiftRight']);
    expect(movementFromInput({ isDown: (code) => held.has(code) })).toEqual({
      forward: true,
      back: false,
      left: false,
      right: true,
      jump: true,
      sprint: true,
      sneak: false,
    });
  });
});
