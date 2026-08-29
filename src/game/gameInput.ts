import type { Input } from '../ui/input';
import type { PlayerInput } from './player';

export type PunctuationCommand = 'slower' | 'faster' | 'zoom-in' | 'zoom-out';

/** Maps punctuation by the character produced, so JIS and US layouts behave alike. */
export function punctuationCommand(key: string): PunctuationCommand | null {
  switch (key) {
    case '[':
      return 'slower';
    case ']':
      return 'faster';
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
      return 'zoom-out';
    default:
      return null;
  }
}

/** Converts held keys into the movement value consumed by Player. */
export function movementFromInput(input: Pick<Input, 'isDown'>): PlayerInput {
  return {
    forward: input.isDown('KeyW'),
    back: input.isDown('KeyS'),
    left: input.isDown('KeyA'),
    right: input.isDown('KeyD'),
    jump: input.isDown('Space'),
    // Shift is the common travel modifier; Ctrl is the less frequent slow movement.
    sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
    sneak: input.isDown('ControlLeft') || input.isDown('ControlRight'),
  };
}
