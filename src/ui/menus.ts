import { el, show } from './dom';

export interface TitleActions {
  onNewWorld(seed: string): void;
  onContinue(): void;
}

/** Title, pause and death overlays. */
export class Menus {
  readonly root = el('div', 'menu-layer');
  private readonly title = el('div', 'menu');
  private readonly pause = el('div', 'menu');
  private readonly death = el('div', 'menu death');
  private readonly loading = el('div', 'menu loading');
  private readonly loadingText = el('div', 'menu-note', 'ワールドを生成しています...');
  private readonly seedInput = el('input', 'seed-input');
  private readonly continueButton = el('button', 'menu-button', '続きから');
  private newButton!: HTMLButtonElement;
  private resumeButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private quitButton!: HTMLButtonElement;
  private respawnButton!: HTMLButtonElement;

  constructor() {
    this.buildTitle();
    this.buildPause();
    this.buildDeath();
    this.loading.append(el('h1', 'menu-title', 'VoxelCraft'), this.loadingText);
    this.root.append(this.title, this.pause, this.death, this.loading);
    show(this.pause, false);
    show(this.death, false);
    show(this.loading, false);
  }

  private buildTitle(): void {
    const heading = el('h1', 'menu-title', 'VoxelCraft');
    const subtitle = el('p', 'menu-note', 'ボクセルの世界を掘って、作って、生き延びる。');
    this.seedInput.placeholder = 'シード値（空欄でランダム）';
    this.seedInput.type = 'text';
    const newButton = el('button', 'menu-button primary', '新しいワールド');
    const help = el('div', 'controls');
    help.innerHTML = [
      '<b>WASD</b> 移動 / <b>Space</b> ジャンプ / <b>Shift</b> 忍び足 / <b>Ctrl</b> ダッシュ',
      '<b>左クリック</b> 採掘・攻撃 / <b>右クリック</b> 設置・使用・交易',
      '<b>1-9</b> ホットバー / <b>E</b> 持ち物 / <b>F3</b> デバッグ / <b>Esc</b> ポーズ',
    ].join('<br>');
    this.title.append(heading, subtitle, this.seedInput, newButton, this.continueButton, help);
    this.newButton = newButton;
  }

  private buildPause(): void {
    const heading = el('h1', 'menu-title', 'ポーズ');
    this.resumeButton = el('button', 'menu-button primary', 'ゲームに戻る');
    this.saveButton = el('button', 'menu-button', 'セーブ');
    this.quitButton = el('button', 'menu-button', 'タイトルへ戻る');
    this.pause.append(heading, this.resumeButton, this.saveButton, this.quitButton);
  }

  private buildDeath(): void {
    const heading = el('h1', 'menu-title', 'あなたは死んでしまった');
    this.respawnButton = el('button', 'menu-button primary', 'リスポーン');
    this.death.append(heading, this.respawnButton);
  }

  bindTitle(actions: TitleActions, canContinue: boolean): void {
    show(this.continueButton, canContinue);
    this.newButton.onclick = () => actions.onNewWorld(this.seedInput.value);
    this.continueButton.onclick = () => actions.onContinue();
  }

  bindPause(actions: { onResume(): void; onSave(): void; onQuit(): void }): void {
    this.resumeButton.onclick = () => actions.onResume();
    this.saveButton.onclick = () => actions.onSave();
    this.quitButton.onclick = () => actions.onQuit();
  }

  bindDeath(onRespawn: () => void): void {
    this.respawnButton.onclick = () => onRespawn();
  }

  showTitle(visible: boolean): void {
    show(this.title, visible);
    this.refreshRoot();
  }

  showPause(visible: boolean): void {
    show(this.pause, visible);
    this.refreshRoot();
  }

  showDeath(visible: boolean): void {
    show(this.death, visible);
    this.refreshRoot();
  }

  showLoading(visible: boolean, message?: string): void {
    if (message) this.loadingText.textContent = message;
    show(this.loading, visible);
    this.refreshRoot();
  }

  /** The overlay is only in the DOM flow while one of the menus is up, and only
   *  paints an opaque background outside of gameplay. */
  private refreshRoot(): void {
    const visible = [this.title, this.pause, this.death, this.loading];
    const anyVisible = visible.some((node) => node.style.display !== 'none');
    show(this.root, anyVisible);
    const opaque = this.title.style.display !== 'none' || this.loading.style.display !== 'none';
    this.root.classList.toggle('opaque', opaque);
  }

  setSaveLabel(text: string): void {
    this.saveButton.textContent = text;
  }

  hideAll(): void {
    show(this.title, false);
    show(this.pause, false);
    show(this.death, false);
    show(this.loading, false);
    this.refreshRoot();
  }
}
