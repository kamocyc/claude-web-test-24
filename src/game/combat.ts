/** Damage, armour and knockback maths shared by the player and every mob. */

export const HURT_COOLDOWN = 0.5;

export interface Damageable {
  health: number;
  maxHealth: number;
  /** Seconds of invulnerability left. */
  hurtCooldown: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Each armour point removes 4% of incoming damage, capped at 80%. */
export function armorReduction(defense: number): number {
  return Math.min(0.8, Math.max(0, defense) * 0.04);
}

export interface DamageResult {
  applied: boolean;
  amount: number;
  dead: boolean;
}

/** Applies damage honouring the invulnerability window. Returns what actually happened. */
export function applyDamage(target: Damageable, amount: number, defense = 0): DamageResult {
  if (target.hurtCooldown > 0 || target.health <= 0 || amount <= 0) {
    return { applied: false, amount: 0, dead: target.health <= 0 };
  }
  const reduced = amount * (1 - armorReduction(defense));
  target.health = Math.max(0, target.health - reduced);
  target.hurtCooldown = HURT_COOLDOWN;
  return { applied: true, amount: reduced, dead: target.health <= 0 };
}

/** Pushes the target away from the attacker and gives it a small upward hop. */
export function applyKnockback(
  target: Damageable,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  strength = 6,
): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) {
    target.vy = Math.max(target.vy, 4);
    return;
  }
  target.vx += (dx / length) * strength;
  target.vz += (dz / length) * strength;
  target.vy = Math.max(target.vy, 4.5);
}

/** Fall damage: one heart per block beyond a three block drop. */
export function fallDamage(distance: number): number {
  return Math.max(0, Math.floor(distance - 3));
}
