import type { Input } from '../ui/input';
import type { Menus } from '../ui/menus';
import type { Industry } from './industry';
import type { SaveData } from './save';
import type { Settings } from './settings';
import type { VillageRecord } from './villages';
import type { WorldKind } from '../world/generation/kind';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  input: Input;
  menus: Menus;
  seed: number;
  save: SaveData | null;
  settings: Settings;
  /** Which generator builds this world. Defaults to the ordinary terrain. */
  kind?: WorldKind;
  /** Start with a road already built between two villages. */
  sample?: boolean;
  onQuit(): void;
}

/** What a stop at a point is attached to, plus the nearest out-of-range candidates. */
export interface StopLink {
  town: VillageRecord | null;
  works: Industry | null;
  nearTown: { village: VillageRecord; distance: number } | null;
  nearWorks: { works: Industry; distance: number } | null;
}
