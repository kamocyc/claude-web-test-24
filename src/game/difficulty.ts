/** How hard the world pushes back. Kept free of rendering so the numbers can be tested,
 *  and expressed as one table so "what does 難しい actually change?" has a single answer.
 *
 *  Everything here scales what the world does to the player, never what the player can do
 *  to the world: the same pickaxe mines the same stone at every setting. */

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface DifficultyRules {
  id: Difficulty;
  label: string;
  /** One line for the settings row, so the choice can be made without guessing. */
  note: string;
  /** Whether hostile mobs exist at all. False also clears the ones already wandering. */
  hostiles: boolean;
  /** Multiplier on every point of damage a mob deals, in melee or by arrow. 0 means a
   *  zombie can stand on the player's toes and do nothing. */
  damage: number;
  /** Ceiling on hostiles alive at once. */
  cap: number;
  /** Health regained per second regardless of food. Only 平和 gives any. */
  regen: number;
  /** Whether an empty stomach can take the last heart. */
  starve: boolean;
}

/** The cap 'ふつう' uses, which is what the game had before difficulty was a choice. */
export const NORMAL_HOSTILE_CAP = 28;

export const DIFFICULTIES: readonly DifficultyRules[] = [
  {
    id: 'peaceful',
    label: '平和',
    note: '敵が出ない。飢えでも死なず、体力は少しずつ戻る',
    hostiles: false,
    damage: 0,
    cap: 0,
    regen: 0.5,
    starve: false,
  },
  {
    id: 'easy',
    label: 'やさしい',
    note: '敵の攻撃は半分、数も控えめ',
    hostiles: true,
    damage: 0.5,
    cap: 14,
    regen: 0,
    starve: true,
  },
  {
    id: 'normal',
    label: 'ふつう',
    note: '素の強さ',
    hostiles: true,
    damage: 1,
    cap: NORMAL_HOSTILE_CAP,
    regen: 0,
    starve: true,
  },
  {
    id: 'hard',
    label: '難しい',
    note: '敵の攻撃は 1.5 倍、数も 1.5 倍。夜は休ませてくれない',
    hostiles: true,
    damage: 1.5,
    cap: 42,
    regen: 0,
    starve: true,
  },
];

export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export function difficultyRules(id: Difficulty | string | undefined): DifficultyRules {
  return (
    DIFFICULTIES.find((rules) => rules.id === id) ??
    DIFFICULTIES.find((rules) => rules.id === DEFAULT_DIFFICULTY)!
  );
}

/** True when `id` is one of the four. Used when reading back stored settings. */
export function isDifficulty(id: unknown): id is Difficulty {
  return typeof id === 'string' && DIFFICULTIES.some((rules) => rules.id === id);
}
