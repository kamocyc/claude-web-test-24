import { boxIntersectsWorld, type EntityBox, type StandingSurface, stepUpMove, sweepMove } from '../../core/aabb';
import type { Rng } from '../../core/rng';
import { WATER_FULL } from '../../world/water';
import type { World } from '../../world/world';
import { type Damageable, applyDamage } from '../combat';
import type { CarPose, TrailPoint } from '../consist';
import type { DayCycle } from '../daycycle';
import type { Player } from '../player';
import type { Trade } from '../trading';
import { type MobDef, type MobKind, mobDef } from './types';

const GRAVITY = 26;
const JUMP_SPEED = 7.6;

/** How far a deck reaches from a hauler's feet, up or down.
 *
 *  The same idea as the player's, and the same third of a block: it only has to cover one
 *  frame of a graded deck moving under something walking along it. Unlike the player's it
 *  is not gated on having been on the ground, because a train is *put* on the rails - the
 *  shipment decides where it is and the mob is walked after it. */
const SURFACE_REACH = 0.35;
/** Water is thick: animals bob rather than sink, and never plummet through it. */
const SWIM_UP_ACCEL = 14;
const WATER_VERTICAL_DRAG = 5;
const SWIM_UP_SPEED = 2.5;
const MAX_WATER_FALL = 8;

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
  /** A point this mob walks towards for as long as it is set, in world coordinates.
   *
   *  This is how a porter follows its shipment: the transport network moves the point
   *  along the surveyed road at the route's own speed and the mob walks after it. There
   *  is no pathfinder — the swept move with its one block auto-hop does the rest — and
   *  crucially the mob is not what carries the goods, so a porter caught on a fence
   *  costs the player a sight of it and nothing else. */
  follow: { x: number; z: number } | null = null;
  /** Multiplier on this mob's walking speed. A porter on a paved road walks faster than
   *  one on a dirt track, because the shipment it is following does. */
  speedScale = 1;
  /** Something to stand on that is not made of blocks - the railway deck, and nothing
   *  else. Only the train is given one: it is the only creature with a reason to be up on
   *  a viaduct and the only one that could not get down off it by walking. See the same
   *  field on `Player` for why this cannot be done inside the sweep. */
  surface: StandingSurface | null = null;
  /** Villager data. */
  profession: string | null = null;
  trades: Trade[] = [];
  homeX = 0;
  homeZ = 0;
  /** Development of the village these offers were rolled for, or -1 when they are the
   *  generic table. The game re-rolls only when this falls behind the village. */
  villageStage = -1;
  /** Wagons coupled up behind, for the one kind that has any. Set from what the shipment
   *  is carrying when the mob is spawned, so a train the player sees pull out of a station
   *  is as long as the load actually is — and a locomotive on its own is a line that is
   *  only paying one way. */
  cars = 0;
  /** True when what those cars are carrying is people rather than crates, so they are
   *  drawn as coaches. Set from the shipment when the mob is spawned, for the same reason
   *  `cars` is: it is the one thing about a train that is visible from outside it. */
  carriesPeople = false;
  /** Where the head of the train has been, newest first, and where each car behind it
   *  therefore is. Both are filled by whoever drives the mob — see `Game.updateTrains` —
   *  because a car is a picture of a shipment exactly as the engine is, and the mob itself
   *  has no more business knowing what it is pulling than it has knowing what it is
   *  carrying. Empty for everything that is not a train. */
  trail: TrailPoint[] = [];
  consist: CarPose[] = [];
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

  /** How fast this mob walks right now. */
  get speed(): number {
    return this.def.speed * this.speedScale;
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
      this.steerTowards(player.x, player.z, this.speed, dt);
      if (this.def.ranged) {
        // Keep a comfortable shooting distance.
        if (distance < 5) this.steerTowards(player.x, player.z, -this.speed, dt);
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
      this.steerTowards(player.x, player.z, -this.speed * 1.4, dt);
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
    if (this.follow) {
      // Close enough is close enough: walking into the exact cell would have the mob
      // jitter around the point it is chasing.
      if (Math.hypot(this.x - this.follow.x, this.z - this.follow.z) > 0.8) {
        this.steerTowards(this.follow.x, this.follow.z, this.speed, dt);
      }
      return;
    }
    if (this.kind === 'villager') {
      const fromHome = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
      if (fromHome > 22) {
        this.steerTowards(this.homeX, this.homeZ, this.speed, dt);
        return;
      }
    }
    if (this.state === 'wander') {
      this.accelerate(this.wanderX, this.wanderZ, this.speed * 0.6, dt);
    }
  }

  /** Reacts to being hit: passive mobs run away, hostile ones lock on.
   *
   *  A mob following a route is neither. Fleeing is checked before `follow` is, so one
   *  punch used to send a porter running for five seconds — long enough to fall off the
   *  road and be dragged back onto it, which read as the porter teleporting. Somebody
   *  carrying a crate somewhere keeps walking. */
  onHurt(): void {
    if (!this.def.hostile && !this.follow) {
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
      this.vy += SWIM_UP_ACCEL * dt;
      this.vy *= Math.max(0, 1 - WATER_VERTICAL_DRAG * dt);
      this.vy = Math.max(-MAX_WATER_FALL, Math.min(SWIM_UP_SPEED, this.vy));
    } else {
      this.vy -= GRAVITY * dt;
    }
    if (this.vy < -50) this.vy = -50;

    const maxSpeed = this.speed * (this.state === 'flee' ? 1.4 : 1);
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vz = (this.vz / speed) * maxSpeed;
    }

    const box = this.box();
    const beforeX = this.x;
    const beforeY = this.y;
    const beforeZ = this.z;
    const attemptedX = this.vx * dt;
    const attemptedZ = this.vz * dt;
    const result = sweepMove(world, box, attemptedX, this.vy * dt, attemptedZ);
    this.x = box.x;
    this.y = box.y;
    this.z = box.z;
    this.onGround = result.onGround;
    if (result.collidedY) this.vy = 0;

    const blocked = result.collidedX || result.collidedZ;
    let stepped = false;
    // Swimming into the bank climbs out of the water, and a mob following a route walks
    // up a kerb the same way. Without the second case the only way over a one block step
    // was the ballistic hop below, which needs the whole 0.4s cooldown to clear 1.11
    // blocks and fails outright on a corner — so a porter met the one thing a road is
    // allowed to have and stopped dead against it.
    if (blocked && (inWater || this.follow)) {
      const from: EntityBox = {
        x: beforeX,
        y: beforeY,
        z: beforeZ,
        width: this.def.width,
        height: this.def.height,
      };
      const speed = Math.hypot(attemptedX, attemptedZ) || 1;
      const achieved = Math.hypot(this.x - beforeX, this.z - beforeZ);
      if (stepUpMove(world, from, attemptedX, attemptedZ, attemptedX / speed, attemptedZ / speed, achieved)) {
        this.x = from.x;
        this.y = from.y;
        this.z = from.z;
        this.onGround = true;
        this.vy = Math.max(this.vy, 0);
        stepped = true;
      }
    }
    // Hop over single block obstacles instead of getting stuck on them — but only when
    // walking up them did not work. Doing both means a porter that has just stepped
    // neatly onto a kerb launches itself off it as well.
    if (blocked && !stepped && this.onGround && this.jumpCooldown <= 0) {
      this.vy = JUMP_SPEED;
      this.jumpCooldown = 0.4;
    }
    if (result.collidedX) this.vx = 0;
    if (result.collidedZ) this.vz = 0;

    // Then the deck, if this is something that rides one. Settled after the sweep and not
    // inside it, because a contact is resolved onto the nearest whole block and a deck
    // stands wherever the curve put it - and because interpolating the height along the
    // line is what makes a graded run a ramp rather than a staircase of five centimetre
    // steps to be climbed one per frame. `wasOnGround` is deliberately not consulted: a
    // shipment is put down on the rails from above at the start of every trip.
    if (this.surface && !inWater && this.vy <= 0) {
      const top = this.surface.surfaceTopAt(
        this.x,
        this.z,
        Math.min(this.y, beforeY) - SURFACE_REACH,
        Math.max(this.y, beforeY) + SURFACE_REACH,
      );
      if (
        top !== null &&
        !boxIntersectsWorld(world, {
          x: this.x, y: top, z: this.z, width: this.def.width, height: this.def.height,
        })
      ) {
        this.y = top;
        this.vy = 0;
        this.onGround = true;
      }
    }

    const travelled = Math.hypot(this.x - beforeX, this.z - beforeZ);
    this.walkPhase += travelled * 4;

    const friction = this.onGround ? 10 : 2;
    const damping = Math.max(0, 1 - friction * dt);
    this.vx *= damping;
    this.vz *= damping;
  }
}
