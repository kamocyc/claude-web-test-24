import './style.css';
import { Game } from './game/game';
import { seedFromString } from './core/rng';
import { Input } from './ui/input';
import { Menus } from './ui/menus';
import { hasSave, readSave, readSaveFile } from './game/save';
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
    onHelp: () => game?.openHelp(),
    onSave: () => game?.save(),
    onExport: () => game?.exportSave(),
    onOpenFile: (file) => void openFile(file),
    onQuit: () => {
      game?.save(false);
      quitToTitle();
    },
  });
  menus.bindDeath(() => game?.respawn());
  game.start();
}

/** Opens a world the player picked out of their own files. The world that is up is put
 *  away first — quitting to the title saves it — so the file replaces it rather than
 *  landing on top of a running game. */
async function openFile(file: File): Promise<void> {
  const save = await readSaveFile(file);
  if (!save) {
    menus.setFileNote(`${file.name} は読み込めませんでした（セーブファイルではないか、形式が古い）`);
    return;
  }
  if (game) {
    game.save(false);
    game.dispose();
    game = null;
    document.body.classList.remove('screen-open');
  }
  // Nothing to say on success: the world it opens says it. And nothing written to local
  // storage here either — the world is not finished being built, and a save taken now
  // would be one without its villagers in it. From the first autosave on, it is the
  // world 「続きから」 opens, like any other.
  startGame(save.seed, save);
}

const titleActions = {
  onNewWorld(seedText: string): void {
    startGame(seedFromString(seedText), null);
  },
  onOpenFile(file: File): void {
    void openFile(file);
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
