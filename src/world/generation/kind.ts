/** Which generator a world is made by.
 *
 *  Part of a world's identity rather than a setting: the same seed means a
 *  different place under a different generator, so a save records which one it
 *  was opened with and the chunk workers are told before they build anything. */
export type WorldKind = 'terrain' | 'showcase';

export const DEFAULT_WORLD_KIND: WorldKind = 'terrain';

export function isWorldKind(value: unknown): value is WorldKind {
  return value === 'terrain' || value === 'showcase';
}

/**
 * Whether a world of this kind is worth keeping between sessions.
 *
 * There is one save slot in local storage. A player with a hundred hours in a
 * terrain world who opens the showcase to look at the buildings must not lose
 * that world to an autosave thirty seconds later — and the showcase has nothing
 * to lose in return, being the same nine buildings every time. So it is never
 * written. Exporting one to a file still works: that is a file the player asked
 * for and put somewhere themselves.
 */
export function isPersistent(kind: WorldKind): boolean {
  return kind === 'terrain';
}

/** Whether a world of this kind has towns in it to find, supply and trade with.
 *  The showcase has none, so nothing may set the player an objective that needs
 *  one — an errand that cannot be run is worse than no errand. */
export function hasSettlements(kind: WorldKind): boolean {
  return kind === 'terrain';
}
