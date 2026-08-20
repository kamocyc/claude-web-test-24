/** Player preferences, kept separately from the world save. */

export interface Settings {
  /** Chunks loaded around the player in each direction. */
  renderDistance: number;
  /** Radians of camera rotation per pixel of mouse movement. */
  sensitivity: number;
  /** Heading strip with markers for spawn, the last death and the nearest village. */
  compass: boolean;
  /** Overhead map in the top right corner. */
  minimap: boolean;
  /** Panel showing the season, and how long before the weather upstream arrives. */
  forecast: boolean;
  /** Swap to the best tool in the hotbar for whatever is being mined. */
  autoTool: boolean;
  /** Walk up single block steps without jumping. */
  autoStep: boolean;
}

export const SETTINGS_KEY = 'voxelcraft.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8,
  sensitivity: 0.0022,
  compass: true,
  minimap: true,
  forecast: true,
  autoTool: true,
  autoStep: true,
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
      compass: parsed.compass ?? DEFAULT_SETTINGS.compass,
      minimap: parsed.minimap ?? DEFAULT_SETTINGS.minimap,
      forecast: parsed.forecast ?? DEFAULT_SETTINGS.forecast,
      autoTool: parsed.autoTool ?? DEFAULT_SETTINGS.autoTool,
      autoStep: parsed.autoStep ?? DEFAULT_SETTINGS.autoStep,
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
