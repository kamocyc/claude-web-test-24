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
