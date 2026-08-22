import { sweepMove } from '../core/aabb';
import type { World } from '../world/world';
import type { ItemStack } from './inventory';

/** An item lying on the ground waiting to be picked up. */
export class ItemDrop {
  vx = 0;
  vy = 0;
  vz = 0;
  /** Seconds before the player can pick it up, so thrown items do not snap back. */
  pickupDelay = 0.4;
  age = 0;
  spin = Math.random() * Math.PI * 2;

  constructor(
    public x: number,
    public y: number,
    public z: number,
    readonly stack: ItemStack,
  ) {}
}

const GRAVITY = 20;
const PICKUP_RADIUS = 0.9;
const MAGNET_RADIUS = 3;
const DESPAWN_SECONDS = 300;

export interface DropTarget {
  x: number;
  y: number;
  z: number;
  /** Returns the amount that did not fit. */
  collect(stack: ItemStack): number;
}

/** Physics and pickup for dropped items. */
export class DropManager {
  readonly drops: ItemDrop[] = [];

  constructor(private readonly world: World) {}

  spawn(x: number, y: number, z: number, stack: ItemStack, scatter = true): ItemDrop {
    const drop = new ItemDrop(x, y, z, stack);
    if (scatter) {
      drop.vx = (Math.random() - 0.5) * 2;
      drop.vz = (Math.random() - 0.5) * 2;
      drop.vy = 2 + Math.random();
    }
    this.drops.push(drop);
    return drop;
  }

  update(dt: number, target: DropTarget): ItemStack[] {
    const collected: ItemStack[] = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += dt;
      drop.pickupDelay = Math.max(0, drop.pickupDelay - dt);
      drop.spin += dt * 2;

      const chestHeight = target.y + 0.7;
      const distance = Math.hypot(drop.x - target.x, drop.y - chestHeight, drop.z - target.z);
      const magnetised = drop.pickupDelay <= 0 && distance < MAGNET_RADIUS;

      if (drop.pickupDelay <= 0 && distance < PICKUP_RADIUS) {
        const leftover = target.collect(drop.stack);
        if (leftover === 0) {
          collected.push(drop.stack);
          this.drops.splice(i, 1);
          continue;
        }
        drop.stack.count = leftover;
      }

      if (magnetised) {
        // Fly straight to the player, ignoring gravity and terrain so items never
        // get stuck on a ledge just out of reach.
        const speed = 9;
        drop.x += ((target.x - drop.x) / distance) * speed * dt;
        drop.y += ((chestHeight - drop.y) / distance) * speed * dt;
        drop.z += ((target.z - drop.z) / distance) * speed * dt;
        drop.vx = 0;
        drop.vy = 0;
        drop.vz = 0;
      } else {
        drop.vy -= GRAVITY * dt;
        const box = { x: drop.x, y: drop.y, z: drop.z, width: 0.25, height: 0.25 };
        const result = sweepMove(this.world, box, drop.vx * dt, drop.vy * dt, drop.vz * dt);
        drop.x = box.x;
        drop.y = box.y;
        drop.z = box.z;
        if (result.collidedY) drop.vy = 0;
        if (result.onGround) {
          drop.vx *= 0.6;
          drop.vz *= 0.6;
        }
      }

      if (drop.age > DESPAWN_SECONDS || drop.y < -10) this.drops.splice(i, 1);
    }
    return collected;
  }

  clear(): void {
    this.drops.length = 0;
  }
}
