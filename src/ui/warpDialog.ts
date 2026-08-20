import { parseWarpTarget, type WarpTarget } from '../game/warp';
import { el, show } from './dom';

/** The debug jump box. Opening it releases the pointer so the field can be typed into;
 *  the game treats it exactly like an open container while it is up. */
export class WarpDialog {
  readonly root = el('div', 'warp-dialog');
  private readonly field = el('input', 'warp-input') as HTMLInputElement;
  private readonly error = el('div', 'warp-error');
  private onWarp: (target: WarpTarget) => void = () => {};
  private onClose: () => void = () => {};
  private open = false;

  constructor() {
    this.field.type = 'text';
    this.field.placeholder = '例: 120 -340';
    this.field.spellcheck = false;
    const go = el('button', 'menu-button primary warp-go', '移動');
    const cancel = el('button', 'menu-button subtle warp-cancel', '閉じる');
    const buttons = el('div', 'warp-buttons');
    buttons.append(go, cancel);
    this.root.append(
      el('div', 'warp-title', '座標へワープ'),
      el('div', 'warp-hint', 'X Z、または X Y Z。Y を省くと地面の上に降りる'),
      this.field,
      this.error,
      buttons,
    );
    show(this.root, false);
    show(this.error, false);

    go.onclick = () => this.submit();
    cancel.onclick = () => this.onClose();
    this.field.addEventListener('keydown', (event) => {
      // The field swallows its own keys so typing "wasd" into it cannot also walk.
      event.stopPropagation();
      if (event.key === 'Enter') this.submit();
      else if (event.key === 'Escape') this.onClose();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  bind(onWarp: (target: WarpTarget) => void, onClose: () => void): void {
    this.onWarp = onWarp;
    this.onClose = onClose;
  }

  /** `here` prefills the box, so the usual "nudge my own coordinates" edit is one keypress. */
  openAt(here: { x: number; y: number; z: number }): void {
    this.open = true;
    show(this.root, true);
    show(this.error, false);
    this.field.value = `${Math.round(here.x)} ${Math.round(here.y)} ${Math.round(here.z)}`;
    this.field.focus();
    this.field.select();
  }

  hide(): void {
    this.open = false;
    show(this.root, false);
    this.field.blur();
  }

  private submit(): void {
    const target = parseWarpTarget(this.field.value);
    if (!target) {
      this.error.textContent = '数字を 2 つ（X Z）か 3 つ（X Y Z）入れてください';
      show(this.error, true);
      return;
    }
    show(this.error, false);
    this.onWarp(target);
  }
}
