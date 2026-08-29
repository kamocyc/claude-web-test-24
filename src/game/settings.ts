/** Player preferences, kept separately from the world save. */
import { DEFAULT_DIFFICULTY, type Difficulty, isDifficulty } from './difficulty';

export interface Settings {
  /** How hard the world pushes back: 平和 / やさしい / ふつう / 難しい. */
  difficulty: Difficulty;
  /** Chunks loaded around the player in each direction. */
  renderDistance: number;
  /** Radians of camera rotation per pixel of mouse movement. */
  sensitivity: number;
  /** Heading strip with markers for spawn, the last death and the nearest village. */
  compass: boolean;
  /** Overhead map in the top right corner. */
  minimap: boolean;
  /** Panel showing the current objective and whether each transport route is joined up. */
  routes: boolean;
  /** The road network drawn in the world itself: a line along what carries goods, dashes
   *  and beacons across what is still missing, and where each shipment has got to. */
  guide: boolean;
  /** Position readout in the bottom left corner. */
  coords: boolean;
  /** Swap to the best tool in the hotbar for whatever is being mined. */
  autoTool: boolean;
  /** Walk up single block steps without jumping. */
  autoStep: boolean;
  /** Debug: nothing in the player's hands is ever used up, and `C` opens a shelf with
   *  one of everything on it. Kept with the other preferences rather than in the save so
   *  that turning it on cannot quietly change what a world contains. */
  creative: boolean;
  /** How many times faster the world runs than real time. The player is never sped up —
   *  only the clock everything else lives on. */
  speed: number;
}

/** The speeds the pause menu offers. Powers of two so the jumps read as jumps, and
 *  sixteen at the top because that is where an afternoon of hauling becomes a minute. */
export const SPEEDS: readonly number[] = [1, 2, 4, 8, 16];

/** Snaps whatever came out of storage onto the nearest offered speed. */
export function nearestSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  let best = SPEEDS[0];
  for (const speed of SPEEDS) {
    if (Math.abs(speed - value) < Math.abs(best - value)) best = speed;
  }
  return best;
}

export const SETTINGS_KEY = 'voxelcraft.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  difficulty: DEFAULT_DIFFICULTY,
  renderDistance: 8,
  sensitivity: 0.0022,
  compass: true,
  minimap: true,
  routes: true,
  guide: true,
  coords: true,
  autoTool: true,
  autoStep: true,
  creative: false,
  speed: 1,
};

export const RENDER_DISTANCE_RANGE = { min: 4, max: 12 };
export const SENSITIVITY_RANGE = { min: 0.0006, max: 0.006 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      renderDistance: clamp(
        Math.round(parsed.renderDistance ?? DEFAULT_SETTINGS.renderDistance),
        RENDER_DISTANCE_RANGE.min,
        RENDER_DISTANCE_RANGE.max,
      ),
      sensitivity: clamp(
        parsed.sensitivity ?? DEFAULT_SETTINGS.sensitivity,
        SENSITIVITY_RANGE.min,
        SENSITIVITY_RANGE.max,
      ),
      difficulty: isDifficulty(parsed.difficulty) ? parsed.difficulty : DEFAULT_SETTINGS.difficulty,
      compass: parsed.compass ?? DEFAULT_SETTINGS.compass,
      minimap: parsed.minimap ?? DEFAULT_SETTINGS.minimap,
      routes: parsed.routes ?? DEFAULT_SETTINGS.routes,
      guide: parsed.guide ?? DEFAULT_SETTINGS.guide,
      coords: parsed.coords ?? DEFAULT_SETTINGS.coords,
      autoTool: parsed.autoTool ?? DEFAULT_SETTINGS.autoTool,
      autoStep: parsed.autoStep ?? DEFAULT_SETTINGS.autoStep,
      creative: parsed.creative ?? DEFAULT_SETTINGS.creative,
      speed: nearestSpeed(parsed.speed ?? DEFAULT_SETTINGS.speed),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled: the settings just will not persist.
  }
}
