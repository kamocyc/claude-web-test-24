import { type EntityBox, sweepMove } from '../../core/aabb';
import type { Rng } from '../../core/rng';
import { WATER_FULL } from '../../world/water';
import type { World } from '../../world/world';
import { type Damageable, applyDamage } from '../combat';
import type { DayCycle } from '../daycycle';
import type { Player } from '../player';
import type { Trade } from '../trading';
import { type MobDef, type MobKind, mobDef } from './types';

const GRAVITY = 26;
const JUMP_SPEED = 7.6;

export type MobState = 'idle' | 'wander' | 'chase' | 'flee';

export interface MobContext {
  world: World;
  /** Current in a cell, so mobs are swept along like the player. */
  currentAt?(x: number, y: number, z: number): { x: number; z: number };
  player: Player;
  day: DayCycle;
  rng: Rng;
  /** Called when a ranged mob fires. */
  shoot(mob: Mob, damage: number): void;
}

export interface MobEvents {
  /** Damage this mob dealt to the player in melee this frame. */
  meleeDamage: number;
  died: boolean;
}

let nextId = 1;

export class Mob implements Damageable {
  readonly id = nextId++;
  readonly def: MobDef;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  health: number;
  maxHealth: number;
  hurtCooldown = 0;
  onGround = false;
  state: MobState = 'idle';
  private stateTimer = 0;
  private wanderX = 0;
  private wanderZ = 0;
  private attackTimer = 0;
  private jumpCooldown = 0;
  /** Seconds of burning left; hostile mobs catch fire in daylight. */
  burning = 0;
  /** Villager data. */
  profession: string | null = null;
  trades: Trade[] = [];
  homeX = 0;
  homeZ = 0;
  /** Animation phase, advanced by how far the mob has walked. */
  walkPhase = 0;

  constructor(
    readonly kind: MobKind,
    x: number,
    y: number,
    z: number,
  ) {
    this.def = mobDef(kind);
    this.x = x;
    this.y = y;
    this.z = z;
    this.health = this.def.maxHealth;
    this.maxHealth = this.def.maxHealth;
    this.homeX = x;
    this.homeZ = z;
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  box(): EntityBox {
    return { x: this.x, y: this.y, z: this.z, width: this.def.width, height: this.def.height };
  }

  distanceTo(x: number, y: number, z: number): number {
    return Math.hypot(this.x - x, this.y - y, this.z - z);
  }

  update(dt: number, ctx: MobContext): MobEvents {
    const events: MobEvents = { meleeDamage: 0, died: false };
    if (this.hurtCooldown > 0) this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (this.isDead) {
      events.died = true;
      return events;
    }

    this.updateBurning(dt, ctx);
    if (this.isDead) {
      events.died = true;
      return events;
    }

    this.think(dt, ctx, events);
    this.move(dt, ctx);

    if (this.y < -8) this.health = 0;
    events.died = this.isDead;
    return events;
  }

  /** Hostile mobs smoulder and die in direct sunlight, which makes torches matter. */
  private updateBurning(dt: number, ctx: MobContext): void {
    if (this.def.burnsInDaylight && ctx.day.sunLight > 0.5) {
      const headY = Math.floor(this.y + this.def.height - 0.2);
      const sky = ctx.world.getSkyLight(Math.floor(this.x), headY, Math.floor(this.z));
      const wet = ctx.world.getWater(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) > 0;
      if (sky >= 14 && !wet) this.burning = 2;
    }
    if (this.burning > 0) {
      this.burning -= dt;
      this.hurtCooldown = 0;
      applyDamage(this, dt * 2);
    }
  }

  private think(dt: number, ctx: MobContext, events: MobEvents): void {
    const player = ctx.player;
    const distance = this.distanceTo(player.x, player.y, player.z);
    this.stateTimer -= dt;

    if (this.def.hostile && !player.isDead && distance < this.def.sightRange) {
      this.state = 'chase';
    } else if (this.state === 'chase') {
      this.state = 'wander';
      this.stateTimer = 0;
    }

    if (this.state === 'flee' && this.stateTimer <= 0) this.state = 'wander';

    if (this.state === 'chase') {
      this.steerTowards(player.x, player.z, this.def.speed, dt);
      if (this.def.ranged) {
        // Keep a comfortable shooting distance.
        if (distance < 5) this.steerTowards(player.x, player.z, -this.def.speed, dt);
        if (distance < this.def.attackRange && this.attackTimer <= 0) {
          this.attackTimer = this.def.attackCooldown;
          ctx.shoot(this, this.def.attackDamage);
        }
      } else if (distance < this.def.attackRange && this.attackTimer <= 0) {
        this.attackTimer = this.def.attackCooldown;
        events.meleeDamage = this.def.attackDamage;
      }
      return;
    }

    if (this.state === 'flee') {
      this.steerTowards(player.x, player.z, -this.def.speed * 1.4, dt);
      return;
    }

    // Idle wandering, with villagers staying near their village.
    if (this.stateTimer <= 0) {
      this.stateTimer = 2 + ctx.rng() * 4;
      if (ctx.rng() < 0.35) {
        this.state = 'idle';
        this.wanderX = 0;
        this.wanderZ = 0;
      } else {
        this.state = 'wander';
        const angle = ctx.rng() * Math.PI * 2;
        this.wanderX = Math.cos(angle);
        this.wanderZ = Math.sin(angle);
      }
    }
    if (this.kind === 'villager') {
      const fromHome = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
      if (fromHome > 22) {
        this.steerTowards(this.homeX, this.homeZ, this.def.speed, dt);
        return;
      }
    }
    if (this.state === 'wander') {
      this.accelerate(this.wanderX, this.wanderZ, this.def.speed * 0.6, dt);
    }
  }

  /** Reacts to being hit: passive mobs run away, hostile ones lock on. */
  onHurt(): void {
    if (!this.def.hostile) {
      this.state = 'flee';
      this.stateTimer = 5;
    }
  }

  private steerTowards(targetX: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - this.x;
    const dz = targetZ - this.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) return;
    this.accelerate(dx / length, dz / length, speed, dt);
  }

  private accelerate(dirX: number, dirZ: number, speed: number, dt: number): void {
    this.vx += dirX * speed * 8 * dt;
    this.vz += dirZ * speed * 8 * dt;
    if (Math.abs(dirX) + Math.abs(dirZ) > 0) this.yaw = Math.atan2(-dirX, -dirZ);
  }

  private move(dt: number, ctx: MobContext): void {
    const world = ctx.world;
    const cellX = Math.floor(this.x);
    const cellY = Math.floor(this.y + 0.4);
    const cellZ = Math.floor(this.z);
    const waterLevel = world.getWater(cellX, cellY, cellZ) / WATER_FULL;
    const inWater = waterLevel > 0.35;
    if (waterLevel > 0.1) {
      const current = ctx.currentAt?.(cellX, cellY, cellZ);
      if (current) {
        this.vx += current.x * 26 * dt;
        this.vz += current.z * 26 * dt;
      }
    }
    if (inWater) {
      this.vy += 12 * dt;
      this.vy = Math.min(this.vy, 2.5);
    } else {
      this.vy -= GRAVITY * dt;
    }
    if (this.vy < -50) this.vy = -50;

    const maxSpeed = this.def.speed * (this.state === 'flee' ? 1.4 : 1);
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vz = (this.vz / speed) * maxSpeed;
    }

    const box = this.box();
    const beforeX = this.x;
    const beforeZ = this.z;
    const result = sweepMove(world, box, this.vx * dt, this.vy * dt, this.vz * dt);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    this.onGround = result.onGround;
    if (result.collidedY) this.vy = 0;

    // Hop over single block obstacles instead of getting stuck on them.
    if ((result.collidedX || result.collidedZ) && this.onGround && this.jumpCooldown <= 0) {
      this.vy = JUMP_SPEED;
      this.jumpCooldown = 0.4;
    }
    if (result.collidedX) this.vx = 0;
    if (result.collidedZ) this.vz = 0;

    const travelled = Math.hypot(this.x - beforeX, this.z - beforeZ);
    this.walkPhase += travelled * 4;

    const friction = this.onGround ? 10 : 2;
    const damping = Math.max(0, 1 - friction * dt);
    this.vx *= damping;
    this.vz *= damping;
  }
}
