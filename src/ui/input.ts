/** Keyboard and mouse handling, including pointer lock. */

export type KeyHandler = (event: KeyboardEvent) => void;

export class Input {
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  readonly buttons = [false, false, false];
  private readonly buttonsJust = [false, false, false];
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  locked = false;
  /** Mouse sensitivity, radians per pixel. */
  sensitivity = 0.0022;
  private readonly keyListeners: KeyHandler[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) {
        this.notify(event);
        return;
      }
      this.pressed.add(event.code);
      this.justPressed.add(event.code);
      this.notify(event);
    });
    window.addEventListener('keyup', (event) => this.pressed.delete(event.code));
    window.addEventListener('blur', () => this.pressed.clear());

    canvas.addEventListener('mousedown', (event) => {
      if (event.button < 3) {
        this.buttons[event.button] = true;
        this.buttonsJust[event.button] = true;
      }
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button < 3) this.buttons[event.button] = false;
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.dx += event.movementX;
      this.dy += event.movementY;
    });
    window.addEventListener('wheel', (event) => {
      this.wheel += Math.sign(event.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.buttons.fill(false);
        this.pressed.clear();
      }
    });
  }

  onKey(handler: KeyHandler): void {
    this.keyListeners.push(handler);
  }

  private notify(event: KeyboardEvent): void {
    for (const handler of this.keyListeners) handler(event);
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  buttonJustPressed(button: number): boolean {
    return this.buttonsJust[button];
  }

  takeMouseDelta(): { x: number; y: number } {
    const result = { x: this.dx * this.sensitivity, y: this.dy * this.sensitivity };
    this.dx = 0;
    this.dy = 0;
    return result;
  }

  takeWheel(): number {
    const value = this.wheel;
    this.wheel = 0;
    return value;
  }

  /** Clears the one-frame flags; call at the end of every frame. */
  endFrame(): void {
    this.justPressed.clear();
    this.buttonsJust.fill(false);
  }

  requestLock(): void {
    void this.canvas.requestPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
