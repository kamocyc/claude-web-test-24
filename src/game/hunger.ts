/** Food/saturation model. Kept free of any rendering so the numbers can be tested. */

export const MAX_FOOD = 20;
/** Exhaustion needed to burn one saturation (or food) point. */
const EXHAUSTION_PER_POINT = 4;
/** Seconds between natural regeneration ticks while well fed. */
const REGEN_INTERVAL = 3.5;
/** Seconds between starvation damage ticks. */
const STARVE_INTERVAL = 4;

export interface HungerTickResult {
  heal: number;
  damage: number;
}

export class Hunger {
  food = MAX_FOOD;
  saturation = 5;
  exhaustion = 0;
  private regenTimer = 0;
  private starveTimer = 0;

  /** Movement, jumping, mining and attacking all feed into this. */
  addExhaustion(amount: number): void {
    this.exhaustion += amount;
    while (this.exhaustion >= EXHAUSTION_PER_POINT) {
      this.exhaustion -= EXHAUSTION_PER_POINT;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  }

  canEat(): boolean {
    return this.food < MAX_FOOD;
  }

  eat(hunger: number, saturation: number): void {
    this.food = Math.min(MAX_FOOD, this.food + hunger);
    // Saturation can never exceed the food level, which is what makes good food last.
    this.saturation = Math.min(this.food, this.saturation + saturation);
  }

  /** Advances timers and reports how much health to add or remove this frame. */
  update(dt: number, health: number, maxHealth: number): HungerTickResult {
    const result: HungerTickResult = { heal: 0, damage: 0 };

    if (this.food >= 18 && health < maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= REGEN_INTERVAL) {
        this.regenTimer = 0;
        result.heal = 1;
        this.addExhaustion(2);
      }
    } else {
      this.regenTimer = 0;
    }

    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= STARVE_INTERVAL) {
        this.starveTimer = 0;
        result.damage = 1;
      }
    } else {
      this.starveTimer = 0;
    }

    return result;
  }

  reset(): void {
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
  }

  toJSON(): { food: number; saturation: number } {
    return { food: this.food, saturation: this.saturation };
  }

  loadJSON(data: { food?: number; saturation?: number } | undefined): void {
    if (!data) return;
    this.food = data.food ?? MAX_FOOD;
    this.saturation = data.saturation ?? 5;
  }
}

/** Exhaustion costs, roughly following the vanilla numbers. */
export const EXHAUSTION = {
  walkPerBlock: 0.01,
  sprintPerBlock: 0.1,
  jump: 0.05,
  sprintJump: 0.2,
  attack: 0.1,
  mineBlock: 0.005,
  damageTaken: 0.1,
} as const;
