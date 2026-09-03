import './style.css';
import { Game } from './game/game';
import { seedFromString } from './core/rng';
import { Input } from './ui/input';
import { Menus } from './ui/menus';
import { hasSave, readSave, readSaveFile } from './game/save';
import { loadSettings, saveSettings } from './game/settings';
import { SHOWCASE_SEED, VERIFICATION_SEED, seedFromUrl, worldKindFromUrl } from './game/seeds';
import { DEFAULT_WORLD_KIND, type WorldKind } from './world/generation/kind';

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

function startGame(
  seed: number,
  save: ReturnType<typeof readSave>,
  sample = false,
  kind: WorldKind = DEFAULT_WORLD_KIND,
): void {
  menus.showTitle(false);
  menus.showPause(false);
  menus.showDeath(false);
  game = new Game({ canvas, input, menus, seed, save, settings, sample, kind, onQuit: quitToTitle });
  menus.setSeed(seed);
  menus.bindSettings(settings, (next) => {
    input.sensitivity = next.sensitivity;
    game?.setRenderDistance(next.renderDistance);
    game?.setRoundedBlocks(next.roundedBlocks);
    game?.setDifficulty(next.difficulty);
    saveSettings(next);
  });
  menus.bindPause({
    onResume: () => game?.togglePause(),
    onHelp: () => game?.openHelp(),
    onSave: () => game?.save(),
    onExport: () => game?.exportSave(),
    onOpenFile: (file) => void openFile(file),
    onRevealMap: () => game?.revealMap(),
    onForgetRevealed: () => game?.forgetRevealed(),
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
  startGame(save.seed, save, false, save.kind);
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
    startGame(save.seed, save, false, save.kind);
  },
  onSampleWorld(): void {
    startGame(VERIFICATION_SEED, null, true);
  },
  onShowcaseWorld(): void {
    startGame(SHOWCASE_SEED, null, false, 'showcase');
  },
};

menus.bindTitle(titleActions, hasSave());

// `?seed=...` opens that exact world straight away and `?world=showcase` picks the
// generator, so either can be shared as a link and both are how the browser smoke
// test pins what it is looking at.
const requestedKind = worldKindFromUrl(window.location.search);
const requested = seedFromUrl(window.location.search);
if (requested || requestedKind) {
  const kind = requestedKind ?? DEFAULT_WORLD_KIND;
  const fallback = kind === 'showcase' ? SHOWCASE_SEED : seedFromString('');
  startGame(requested ? requested.seed : fallback, null, false, kind);
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
