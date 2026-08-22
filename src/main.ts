import './style.css';
import { Game } from './game/game';
import { seedFromString } from './core/rng';
import { Input } from './ui/input';
import { Menus } from './ui/menus';
import { hasSave, readSave } from './game/save';
import { loadSettings, saveSettings } from './game/settings';
import { VERIFICATION_SEED, seedFromUrl } from './game/seeds';

const canvas = document.createElement('canvas');
canvas.id = 'viewport';
document.body.appendChild(canvas);

const settings = loadSettings();
const input = new Input(canvas);
input.sensitivity = settings.sensitivity;
const menus = new Menus();
document.body.appendChild(menus.root);

let game: Game | null = null;

function quitToTitle(): void {
  game?.dispose();
  game = null;
  document.body.classList.remove('screen-open');
  input.releaseLock();
  menus.showTitle(true);
  menus.showPause(false);
  menus.showDeath(false);
  menus.bindTitle(titleActions, hasSave());
}

function startGame(seed: number, save: ReturnType<typeof readSave>, sample = false): void {
  menus.showTitle(false);
  menus.showPause(false);
  menus.showDeath(false);
  game = new Game({ canvas, input, menus, seed, save, settings, sample, onQuit: quitToTitle });
  menus.setSeed(seed);
  menus.bindSettings(settings, (next) => {
    input.sensitivity = next.sensitivity;
    game?.setRenderDistance(next.renderDistance);
    game?.setDifficulty(next.difficulty);
    saveSettings(next);
  });
  menus.bindPause({
    onResume: () => game?.togglePause(),
    onSave: () => game?.save(),
    onQuit: () => {
      game?.save(false);
      quitToTitle();
    },
  });
  menus.bindDeath(() => game?.respawn());
  game.start();
}

const titleActions = {
  onNewWorld(seedText: string): void {
    startGame(seedFromString(seedText), null);
  },
  onContinue(): void {
    const save = readSave();
    if (!save) {
      startGame(seedFromString(''), null);
      return;
    }
    startGame(save.seed, save);
  },
  onSampleWorld(): void {
    startGame(VERIFICATION_SEED, null, true);
  },
};

menus.bindTitle(titleActions, hasSave());

// `?seed=...` opens that exact world straight away, which is how a specific world
// gets shared as a link and how the browser smoke test pins its terrain.
const requested = seedFromUrl(window.location.search);
if (requested) {
  startGame(requested.seed, null);
} else {
  menus.showTitle(true);
}

window.addEventListener('beforeunload', () => {
  game?.save(false);
});

// Console helper: `voxelcraft.give('diamond_pickaxe')`, `voxelcraft.gotoVillage()`, ...
Object.defineProperty(window, 'voxelcraft', {
  get: () => game?.debug ?? null,
});
