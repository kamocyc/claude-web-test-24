import {
  RENDER_DISTANCE_RANGE,
  SENSITIVITY_RANGE,
  type Settings,
} from '../game/settings';
import { VERIFICATION_SEED_TEXT } from '../game/seeds';
import { el, show } from './dom';

type ToggleKey = 'compass' | 'minimap' | 'forecast' | 'autoTool' | 'autoStep' | 'effects';

const TOGGLE_LABELS: [ToggleKey, string][] = [
  ['compass', '方角コンパス'],
  ['minimap', 'ミニマップ'],
  ['forecast', '天候の予報'],
  ['autoTool', '道具の自動切り替え'],
  ['autoStep', '段差を自動で登る'],
  ['effects', '光の演出（ブルーム）'],
];

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
  private readonly verifyButton = el('button', 'menu-button subtle', '検証用ワールド');
  private newButton!: HTMLButtonElement;
  private resumeButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private quitButton!: HTMLButtonElement;
  private respawnButton!: HTMLButtonElement;
  private distanceInput!: HTMLInputElement;
  private sensitivityInput!: HTMLInputElement;
  private distanceLabel!: HTMLElement;
  private sensitivityLabel!: HTMLElement;
  private readonly toggles = new Map<ToggleKey, HTMLInputElement>();
  private readonly seedLabel = el('div', 'menu-note seed-label');

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
    this.verifyButton.title = '毎回まったく同じ地形で始まる、確認用の固定シード';
    this.title.append(
      heading,
      subtitle,
      this.seedInput,
      newButton,
      this.continueButton,
      this.verifyButton,
      help,
    );
    this.newButton = newButton;
  }

  private buildPause(): void {
    const heading = el('h1', 'menu-title', 'ポーズ');
    this.resumeButton = el('button', 'menu-button primary', 'ゲームに戻る');
    this.saveButton = el('button', 'menu-button', 'セーブ');
    this.quitButton = el('button', 'menu-button', 'タイトルへ戻る');

    const settings = el('div', 'settings');
    this.distanceInput = el('input', 'slider');
    this.distanceInput.type = 'range';
    this.distanceInput.min = String(RENDER_DISTANCE_RANGE.min);
    this.distanceInput.max = String(RENDER_DISTANCE_RANGE.max);
    this.distanceInput.step = '1';
    this.distanceLabel = el('span', 'slider-value');

    this.sensitivityInput = el('input', 'slider');
    this.sensitivityInput.type = 'range';
    this.sensitivityInput.min = '1';
    this.sensitivityInput.max = '100';
    this.sensitivityInput.step = '1';
    this.sensitivityLabel = el('span', 'slider-value');

    settings.append(
      settingRow('描画距離', this.distanceInput, this.distanceLabel),
      settingRow('マウス感度', this.sensitivityInput, this.sensitivityLabel),
    );
    for (const [key, label] of TOGGLE_LABELS) {
      const input = el('input', 'toggle') as HTMLInputElement;
      input.type = 'checkbox';
      this.toggles.set(key, input);
      settings.appendChild(toggleRow(label, input));
    }
    this.pause.append(heading, this.resumeButton, this.seedLabel, settings, this.saveButton, this.quitButton);
  }

  /** Wires the sliders to the live settings object. */
  bindSettings(settings: Settings, onChange: (next: Settings) => void): void {
    const sensitivityToSlider = (value: number): number =>
      Math.round(
        ((value - SENSITIVITY_RANGE.min) / (SENSITIVITY_RANGE.max - SENSITIVITY_RANGE.min)) * 99 + 1,
      );
    const sliderToSensitivity = (value: number): number =>
      SENSITIVITY_RANGE.min + ((value - 1) / 99) * (SENSITIVITY_RANGE.max - SENSITIVITY_RANGE.min);

    const render = (): void => {
      this.distanceLabel.textContent = `${settings.renderDistance} チャンク`;
      this.sensitivityLabel.textContent = String(sensitivityToSlider(settings.sensitivity));
    };
    this.distanceInput.value = String(settings.renderDistance);
    this.sensitivityInput.value = String(sensitivityToSlider(settings.sensitivity));
    render();

    for (const [key, input] of this.toggles) {
      input.checked = settings[key];
      input.onchange = () => {
        settings[key] = input.checked;
        onChange(settings);
      };
    }

    this.distanceInput.oninput = () => {
      settings.renderDistance = Number(this.distanceInput.value);
      render();
      onChange(settings);
    };
    this.sensitivityInput.oninput = () => {
      settings.sensitivity = sliderToSensitivity(Number(this.sensitivityInput.value));
      render();
      onChange(settings);
    };
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
    this.verifyButton.onclick = () => {
      this.seedInput.value = VERIFICATION_SEED_TEXT;
      actions.onNewWorld(VERIFICATION_SEED_TEXT);
    };
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

  /** Shows the world seed on the pause screen, and lets the player copy it. */
  setSeed(seed: number): void {
    this.seedLabel.textContent = `シード ${seed}（クリックでコピー）`;
    this.seedLabel.onclick = () => {
      void navigator.clipboard?.writeText(String(seed));
      this.seedLabel.textContent = `シード ${seed}（コピーしました）`;
      window.setTimeout(() => this.setSeed(seed), 1600);
    };
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

function toggleRow(label: string, input: HTMLInputElement): HTMLElement {
  const row = el('label', 'setting-row toggle-row');
  row.append(el('span', 'setting-label', label), input);
  return row;
}

function settingRow(label: string, input: HTMLInputElement, value: HTMLElement): HTMLElement {
  const row = el('div', 'setting-row');
  row.append(el('span', 'setting-label', label), input, value);
  return row;
}
