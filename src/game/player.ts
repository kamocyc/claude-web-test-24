import { type EntityBox, stepUpMove, sweepMove } from '../core/aabb';
import { blockDef } from '../world/blocks';
import { WATER_FULL } from '../world/water';
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
/** Fill level at which water is deep enough to swim rather than wade through. */
const SWIM_DEPTH = 0.35;
/** Seconds of air before drowning starts. */
export const MAX_AIR = 10;
/** Seconds between drowning hits. */
const DROWN_INTERVAL = 1.5;
/** How hard a flowing current pushes, in blocks per second per unit of flow. */
const CURRENT_STRENGTH = 26;
/** Upward speed while holding jump under water. */
const SWIM_UP_SPEED = 4;
/** Acceleration towards those speeds, and the drag that bleeds off the speed of a
 *  fall so entering water slows the player instead of stopping them dead. */
const SINK_ACCEL = 6;
const SWIM_UP_ACCEL = 22;
const WATER_VERTICAL_DRAG = 5;
/** Vertical speed water allows at all: a dive carries some way past the surface. */
const MAX_WATER_FALL = 8;

export interface PlayerInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
}

const ZERO_CURRENT = { x: 0, z: 0 };

export const NO_INPUT: PlayerInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
};

/** Rotates a movement input given in camera space (x = strafe right, z = backwards)
 *  into world space. The camera looks along (-sin yaw, -cos yaw), and its right hand
 *  side is (cos yaw, -sin yaw), so the input must be rotated by -yaw about Y. */
export function movementDirection(yaw: number, inputX: number, inputZ: number): { x: number; z: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: inputX * cos + inputZ * sin,
    z: -inputX * sin + inputZ * cos,
  };
}

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
  /** Deep enough to swim. */
  inWater = false;
  /** 0..1 fill of the cell around the feet, so shallow water only slows the player. */
  waterLevel = 0;
  /** The camera is under water: this is what drains the air supply. */
  submerged = false;
  /** Seconds of breath left. */
  air = MAX_AIR;
  private drownTimer = 0;
  health = 20;
  maxHealth = 20;
  hurtCooldown = 0;
  /** Highest Y reached since leaving the ground, for fall damage. */
  private fallStartY = 0;
  readonly inventory = new PlayerInventory();
  readonly hunger = new Hunger();
  /** Set while the player is flying in creative-style free camera. */
  flying = false;
  /** Walk up single block steps instead of having to jump every kerb. */
  autoStep = true;

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

  update(
    dt: number,
    world: World,
    input: PlayerInput,
    current: { x: number; z: number } = ZERO_CURRENT,
  ): PlayerTickEvents {
    const events: PlayerTickEvents = { fellFrom: 0, tookDamage: 0, died: false };
    if (this.hurtCooldown > 0) this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (this.isDead) return events;

    this.waterLevel =
      world.getWater(Math.floor(this.x), Math.floor(this.y + 0.4), Math.floor(this.z)) / WATER_FULL;
    this.inWater = this.waterLevel > SWIM_DEPTH;
    this.submerged =
      world.getWater(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z)) / WATER_FULL > 0.5;

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

    const { x: wishX, z: wishZ } = movementDirection(this.yaw, inputX, inputZ);

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
    // The current carries the player along; it is applied after the speed clamp below
    // so that being swept away is not limited by the walking speed.

    const friction = this.inWater ? WATER_FRICTION : this.onGround ? GROUND_FRICTION : 1.5;
    const damping = Math.max(0, 1 - friction * dt);
    this.vx *= damping;
    this.vz *= damping;

    const speed = Math.hypot(this.vx, this.vz);
    if (speed > target) {
      this.vx = (this.vx / speed) * target;
      this.vz = (this.vz / speed) * target;
    }
    if (this.waterLevel > 0.1) {
      this.vx += current.x * CURRENT_STRENGTH * dt;
      this.vz += current.z * CURRENT_STRENGTH * dt;
    }

    // --- vertical movement ---------------------------------------------------
    if (this.flying) {
      this.vy = input.jump ? 8 : input.sneak ? -8 : 0;
    } else if (this.inWater) {
      // Water is thick. The player sinks slowly rather than dropping like a stone, and
      // a dive carries on past the surface before the drag brings it to a crawl.
      this.vy += (input.jump ? SWIM_UP_ACCEL : -SINK_ACCEL) * dt;
      this.vy *= Math.max(0, 1 - WATER_VERTICAL_DRAG * dt);
      // Drag alone settles the sink at SINK_ACCEL / WATER_VERTICAL_DRAG blocks a
      // second; the clamp only caps how fast a dive can still be travelling.
      this.vy = Math.max(-MAX_WATER_FALL, Math.min(SWIM_UP_SPEED, this.vy));
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
    const beforeY = this.y;
    const beforeZ = this.z;
    const wasOnGround = this.onGround;
    // Kept for the step-up retry below, which happens after the collision has zeroed
    // the velocity of whichever axis ran into the wall.
    const attemptedX = this.vx * dt;
    const attemptedZ = this.vz * dt;
    const move = sweepMove(world, box, this.vx * dt, this.vy * dt, this.vz * dt);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    if (move.collidedX) this.vx = 0;
    if (move.collidedZ) this.vz = 0;
    if (move.collidedY) this.vy = 0;
    this.onGround = move.onGround || this.flying;

    // --- walking up a step, and climbing out of the water --------------------
    // A wall one block high is a kerb, not an obstacle: retry the same move from a
    // block higher and drop back down. Swimming into the bank uses the same move,
    // which is the only way out of the water when the bank stands above it.
    const swimmingOut = this.inWater && !this.submerged;
    if (
      (move.collidedX || move.collidedZ) &&
      (this.autoStep ? wasOnGround || swimmingOut : swimmingOut) &&
      !this.flying &&
      inputLength > 0
    ) {
      const box: EntityBox = {
        x: beforeX,
        y: beforeY,
        z: beforeZ,
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
      };
      const achieved = Math.hypot(this.x - beforeX, this.z - beforeZ);
      if (stepUpMove(world, box, attemptedX, attemptedZ, wishX, wishZ, achieved)) {
        this.x = box.x;
        this.y = box.y;
        this.z = box.z;
        this.onGround = true;
        this.vy = Math.max(this.vy, 0);
      }
    }

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
    // --- breath --------------------------------------------------------------
    if (this.submerged) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= DROWN_INTERVAL) {
          this.drownTimer = 0;
          this.health = Math.max(0, this.health - 1);
          events.tookDamage += 1;
        }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this.drownTimer = 0;
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
    this.air = MAX_AIR;
    this.hunger.reset();
  }
}
