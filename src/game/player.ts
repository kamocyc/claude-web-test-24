import { type EntityBox, sweepMove } from '../core/aabb';
import { Block, blockDef } from '../world/blocks';
import type { World } from '../world/world';
import { type Damageable, applyDamage, fallDamage } from './combat';
import { EXHAUSTION, Hunger } from './hunger';
import { PlayerInventory } from './inventory';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.8;
const SWIM_SPEED = 2.6;
const GROUND_ACCEL = 45;
const AIR_ACCEL = 8;
const GROUND_FRICTION = 12;
const WATER_FRICTION = 6;
const TERMINAL_VELOCITY = 60;

export interface PlayerInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
}

export const NO_INPUT: PlayerInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
};

export interface PlayerTickEvents {
  fellFrom: number;
  tookDamage: number;
  died: boolean;
}

export class Player implements Damageable {
  x = 0;
  y = 64;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Radians; 0 looks towards -Z. */
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  health = 20;
  maxHealth = 20;
  hurtCooldown = 0;
  /** Highest Y reached since leaving the ground, for fall damage. */
  private fallStartY = 0;
  readonly inventory = new PlayerInventory();
  readonly hunger = new Hunger();
  /** Set while the player is flying in creative-style free camera. */
  flying = false;

  get eyeY(): number {
    return this.y + EYE_HEIGHT;
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  box(): EntityBox {
    return { x: this.x, y: this.y, z: this.z, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
  }

  /** Unit vector the camera is looking along. */
  lookVector(): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  update(dt: number, world: World, input: PlayerInput): PlayerTickEvents {
    const events: PlayerTickEvents = { fellFrom: 0, tookDamage: 0, died: false };
    if (this.hurtCooldown > 0) this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (this.isDead) return events;

    this.inWater = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.6), Math.floor(this.z)) === Block.WATER;

    // --- horizontal movement -------------------------------------------------
    let inputX = 0;
    let inputZ = 0;
    if (input.forward) inputZ -= 1;
    if (input.back) inputZ += 1;
    if (input.left) inputX -= 1;
    if (input.right) inputX += 1;
    const inputLength = Math.hypot(inputX, inputZ);
    if (inputLength > 0) {
      inputX /= inputLength;
      inputZ /= inputLength;
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Rotate the input into world space (yaw 0 faces -Z).
    const wishX = inputX * cos - inputZ * sin;
    const wishZ = inputX * sin + inputZ * cos;

    const sprinting = input.sprint && !input.sneak && inputLength > 0 && !this.inWater;
    const target = this.inWater
      ? SWIM_SPEED
      : input.sneak
        ? SNEAK_SPEED
        : sprinting
          ? SPRINT_SPEED
          : WALK_SPEED;

    const accel = this.onGround || this.inWater ? GROUND_ACCEL : AIR_ACCEL;
    this.vx += wishX * target * accel * dt;
    this.vz += wishZ * target * accel * dt;

    const friction = this.inWater ? WATER_FRICTION : this.onGround ? GROUND_FRICTION : 1.5;
    const damping = Math.max(0, 1 - friction * dt);
    this.vx *= damping;
    this.vz *= damping;

    const speed = Math.hypot(this.vx, this.vz);
    if (speed > target) {
      this.vx = (this.vx / speed) * target;
      this.vz = (this.vz / speed) * target;
    }

    // --- vertical movement ---------------------------------------------------
    if (this.flying) {
      this.vy = input.jump ? 8 : input.sneak ? -8 : 0;
    } else if (this.inWater) {
      this.vy += (input.jump ? 14 : -6) * dt;
      this.vy = Math.max(-4, Math.min(4, this.vy));
    } else {
      if (input.jump && this.onGround) {
        this.vy = JUMP_SPEED;
        this.hunger.addExhaustion(sprinting ? EXHAUSTION.sprintJump : EXHAUSTION.jump);
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL_VELOCITY) this.vy = -TERMINAL_VELOCITY;
    }

    // --- collision -----------------------------------------------------------
    const box = this.box();
    const beforeX = this.x;
    const beforeZ = this.z;
    const wasOnGround = this.onGround;
    const move = sweepMove(world, box, this.vx * dt, this.vy * dt, this.vz * dt);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    if (move.collidedX) this.vx = 0;
    if (move.collidedZ) this.vz = 0;
    if (move.collidedY) this.vy = 0;
    this.onGround = move.onGround || this.flying;

    // --- fall damage ---------------------------------------------------------
    if (!wasOnGround && this.onGround) {
      const distance = this.fallStartY - this.y;
      if (distance > 3 && !this.inWater && !this.flying) {
        const damage = fallDamage(distance);
        if (damage > 0) {
          const result = applyDamage(this, damage, this.inventory.defense);
          if (result.applied) {
            events.tookDamage += result.amount;
            events.fellFrom = distance;
          }
        }
      }
      this.fallStartY = this.y;
    }
    if (this.onGround || this.inWater) this.fallStartY = this.y;
    else if (this.y > this.fallStartY) this.fallStartY = this.y;

    // --- hunger --------------------------------------------------------------
    const travelled = Math.hypot(this.x - beforeX, this.z - beforeZ);
    if (travelled > 0 && this.onGround) {
      this.hunger.addExhaustion(travelled * (sprinting ? EXHAUSTION.sprintPerBlock : EXHAUSTION.walkPerBlock));
    }
    const hungerTick = this.hunger.update(dt, this.health, this.maxHealth);
    if (hungerTick.heal > 0) this.health = Math.min(this.maxHealth, this.health + hungerTick.heal);
    if (hungerTick.damage > 0) {
      this.health = Math.max(0, this.health - hungerTick.damage);
      events.tookDamage += hungerTick.damage;
    }

    // --- environmental hazards ----------------------------------------------
    const contact = this.contactDamage(world);
    if (contact > 0) {
      const result = applyDamage(this, contact, this.inventory.defense);
      if (result.applied) events.tookDamage += result.amount;
    }
    if (this.y < -5) {
      const result = applyDamage(this, 4, 0);
      if (result.applied) events.tookDamage += result.amount;
    }

    events.died = this.isDead;
    return events;
  }

  /** Damage from blocks the player is touching, such as cactus. */
  private contactDamage(world: World): number {
    let worst = 0;
    const minX = Math.floor(this.x - PLAYER_WIDTH / 2 - 0.05);
    const maxX = Math.floor(this.x + PLAYER_WIDTH / 2 + 0.05);
    const minZ = Math.floor(this.z - PLAYER_WIDTH / 2 - 0.05);
    const maxZ = Math.floor(this.z + PLAYER_WIDTH / 2 + 0.05);
    const minY = Math.floor(this.y);
    const maxY = Math.floor(this.y + PLAYER_HEIGHT);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const damage = blockDef(world.getBlock(x, y, z)).contactDamage ?? 0;
          if (damage > worst) worst = damage;
        }
      }
    }
    return worst;
  }

  /** Moves the player without carrying over momentum or fall distance. */
  teleportTo(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.fallStartY = y;
  }

  respawn(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.health = this.maxHealth;
    this.hurtCooldown = 0;
    this.fallStartY = y;
    this.hunger.reset();
  }
}
