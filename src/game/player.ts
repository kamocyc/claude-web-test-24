import { boxIntersectsWorld, type EntityBox, type StandingSurface, STEP_HEIGHT, stepUpMove, sweepMove } from '../core/aabb';
import { blockDef } from '../world/blocks';
import { WATER_FULL, waterFraction } from '../world/water';
import type { World } from '../world/world';
import { type Damageable, applyDamage, fallDamage } from './combat';
import { type DifficultyRules, difficultyRules } from './difficulty';
import { EXHAUSTION, Hunger } from './hunger';
import { PlayerInventory } from './inventory';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const JUMP_SPEED = 8.4;
/** Twice a Minecraft walk. The world is large and the villages are hundreds of blocks
 *  apart, so travel is deliberately brisk; sneaking stays slow, which is the point of it. */
const WALK_SPEED = 8.6;
/** A dash is exactly twice the walk. Not a nudge of a few blocks a second: the key is
 *  held down for whole minutes at a time on the way to the next village, and a difference
 *  that small would not be worth holding it for. */
const SPRINT_SPEED = WALK_SPEED * 2;
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

/** A boat travels at the speed of a dash. That is the whole point of building one: a
 *  river is a road, and rowing down it has to beat walking the bank, or nobody would. */
const BOAT_SPEED = SPRINT_SPEED;
/** Slippier than the ground, so a boat carries its way instead of stopping dead. */
const BOAT_FRICTION = 2.5;
/** How far above and below its feet a hull looks for the water it is riding on. Two
 *  blocks, so a boat carried over a weir by its own speed finds the pool below rather
 *  than being tipped out into it. */
const BOAT_REACH = 2;
/** How deep the hull sits: the deck the player stands on is a little below the
 *  waterline, which is what makes a boat read as sitting *in* the water. */
const BOAT_DRAUGHT = 0.35;
/** Upward push on stepping out, so the bank is within reach of the hop. */
const BOAT_STEP_OUT = 5.5;

/** Tallest ledge the player walks up without jumping, in blocks. */
export const AUTO_STEP_BLOCKS = 3;

/** How far a standing surface reaches from the feet, up or down, on a frame that began
 *  on the ground.
 *
 *  It only has to cover one frame of a deck. The steepest track the solver allows is
 *  MAX_GRADE (0.2), the fastest the player travels is SPRINT_SPEED, and the longest frame
 *  the game hands out is a twentieth of a second, so the deck moves at most 0.18 under
 *  the player in one step. This is twice that, with room for the same frame's gravity,
 *  and still a third of STEP_HEIGHT - so it can never reach a surface the voxel world
 *  would have resolved itself, and never competes with the step logic. Anything taller
 *  is boarded by jumping, which carries over a block of rise. */
const SURFACE_REACH = 0.35;
/** Each climb height to try, shortest first. */
const AUTO_STEP_HEIGHTS = Array.from(
  { length: AUTO_STEP_BLOCKS },
  (_, i) => STEP_HEIGHT + i,
);
const SINGLE_STEP = [STEP_HEIGHT];

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
  /** What the difficulty lets the world do to this player. The game keeps it in step with
   *  the setting; anything constructing a player on its own gets ふつう. */
  rules: DifficultyRules = difficultyRules('normal');
  /** Highest Y reached since leaving the ground, for fall damage. */
  private fallStartY = 0;
  readonly inventory = new PlayerInventory();
  readonly hunger = new Hunger();
  /** Set while the player is flying in creative-style free camera. */
  flying = false;
  /** Riding a boat: the player sits on the surface of the water instead of swimming
   *  through it, and travels at the speed of a dash. Cleared by the player stepping
   *  out, and by the boat running out of water under it. */
  boating = false;
  /** Walk up single block steps instead of having to jump every kerb. */
  autoStep = true;
  /** Surfaces that are not in the block grid - the laid railway, and nothing else so far.
   *  Assigned by the game each frame, the way `autoStep` is, so that anything driving a
   *  player without one (the tests, a headless tick) simply does not have it. */
  surface: StandingSurface | null = null;

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

    // A boat rides on top of the water rather than through it, so none of the swimming
    // below applies to somebody in one. Jumping is how they get out: the bank is
    // usually a block up, and a boat that has run aground has to be leavable.
    if (this.boating) {
      if (input.jump || boatSurfaceY(world, this.x, this.y, this.z) === null) {
        this.boating = false;
        if (input.jump) this.vy = BOAT_STEP_OUT;
      } else {
        this.inWater = false;
        this.submerged = false;
      }
    }

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

    const sprinting = input.sprint && !input.sneak && inputLength > 0 && !this.inWater && !this.boating;
    const target = this.boating
      ? BOAT_SPEED
      : this.inWater
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

    const friction = this.boating
      ? BOAT_FRICTION
      : this.inWater ? WATER_FRICTION : this.onGround ? GROUND_FRICTION : 1.5;
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
    } else if (this.boating) {
      // The hull is put on the surface below, once the horizontal move has settled.
      this.vy = 0;
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
    let stepped = false;
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
    // A ledge up to AUTO_STEP_BLOCKS high is a kerb, not an obstacle: retry the same
    // move from that much higher and drop back down. Swimming into the bank uses the
    // same move, which is the only way out of the water when the bank stands above it.
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
      // Shortest climb first: raising the whole box needs headroom above it, so trying
      // three blocks straight away would refuse kerbs that fit under a low ceiling.
      const heights = this.autoStep ? AUTO_STEP_HEIGHTS : SINGLE_STEP;
      for (const height of heights) {
        if (!stepUpMove(world, box, attemptedX, attemptedZ, wishX, wishZ, achieved, height)) continue;
        this.x = box.x;
        this.y = box.y;
        this.z = box.z;
        this.onGround = true;
        this.vy = Math.max(this.vy, 0);
        stepped = true;
        break;
      }
    }

    // --- standing on something that is not made of blocks --------------------
    // The sweep cannot land anyone on a railway deck: it answers a collision by snapping
    // to `Math.floor(y) + 1`, and a deck sits at whatever height the curve put it. So the
    // blocks are left to the sweep and the deck is settled onto once, afterwards - which
    // is also what makes a graded run a ramp that is walked up, rather than a flight of
    // five-centimetre steps that would have to be climbed one per frame.
    const surface = this.surface;
    if (surface && !this.flying && !this.inWater && this.vy <= 0) {
      // The reach opens only for a player who was already standing on something: it is
      // there so a deck can be followed up and down its own gradient, not so it can grab
      // somebody falling past. `wasOnGround`, not `this.onGround` - a viaduct has nothing
      // solid beneath it, so the sweep has just reported no ground at all, and gating on
      // that would drop the player on the first frame of every descent.
      const reach = wasOnGround ? SURFACE_REACH : 0;
      // A climb up a ledge has already put the player on solid ground; the three blocks
      // it covered are not deck they fell past.
      const from = stepped ? this.y : beforeY;
      const top = surface.surfaceTopAt(
        this.x,
        this.z,
        Math.min(this.y, from) - reach,
        Math.max(this.y, from) + reach,
      );
      // The same question the sweep would have asked: a deck buried in a hillside, or one
      // with no room to stand up in, is not a floor.
      if (
        top !== null &&
        !boxIntersectsWorld(world, {
          x: this.x, y: top, z: this.z, width: PLAYER_WIDTH, height: PLAYER_HEIGHT,
        })
      ) {
        this.y = top;
        this.vy = 0;
        this.onGround = true;
      }
    }

    // --- floating ------------------------------------------------------------
    // Asked again after the move, not before it: the hull rides whatever water it has
    // arrived over, which is what carries a boat down a weir in one piece. A pin that
    // would bury the player in the ceiling is refused and tips them out instead.
    if (this.boating) {
      const surface = boatSurfaceY(world, this.x, this.y, this.z);
      const deck = surface === null ? 0 : surface - BOAT_DRAUGHT;
      if (
        surface === null ||
        boxIntersectsWorld(world, { x: this.x, y: deck, z: this.z, width: PLAYER_WIDTH, height: PLAYER_HEIGHT })
      ) {
        this.boating = false;
      } else {
        this.y = deck;
        this.vy = 0;
        this.onGround = true;
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
    // An empty stomach still empties on 平和 — it just cannot take the last heart, and
    // the body mends itself in the meantime whether or not there is anything to eat.
    if (hungerTick.damage > 0 && this.rules.starve) {
      this.health = Math.max(0, this.health - hungerTick.damage);
      events.tookDamage += hungerTick.damage;
    }
    if (this.rules.regen > 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + this.rules.regen * dt);
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

  /** Puts the player in a boat on the water under the given column, if there is any.
   *  Returns whether they got in — there is nothing to sit on over dry land. */
  boardBoat(world: World, x: number, z: number, y = this.y): boolean {
    const surface = boatSurfaceY(world, x, y, z);
    if (surface === null) return false;
    const deck = surface - BOAT_DRAUGHT;
    const box = { x, y: deck, z, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
    if (boxIntersectsWorld(world, box)) return false;
    this.x = x;
    this.z = z;
    this.y = deck;
    this.vy = 0;
    this.boating = true;
    return true;
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

/** Top of the water column a hull at this position would sit in, or null when there is
 *  none within reach — which is a boat run aground, and the one thing that ends a ride
 *  without the player asking. The *top* of the column, so a boat floats on a river and
 *  not along its bed. */
function boatSurfaceY(world: World, x: number, y: number, z: number): number | null {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const from = Math.floor(y) + BOAT_REACH;
  for (let cy = from; cy >= from - BOAT_REACH * 2; cy--) {
    const level = world.getWater(bx, cy, bz);
    if (level <= 0 || world.getWater(bx, cy + 1, bz) > 0) continue;
    return cy + waterFraction(level);
  }
  return null;
}
