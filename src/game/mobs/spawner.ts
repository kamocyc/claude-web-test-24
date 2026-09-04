import { type Rng, hashInts, mulberry32 } from '../../core/rng';
import { Block, blockDef } from '../../world/blocks';
import { CHUNK_HEIGHT } from '../../world/chunk';
import type { World } from '../../world/world';
import { applyDamage, applyKnockback } from '../combat';
import { Biome } from '../../world/generation/biome';
import type { DayCycle } from '../daycycle';
import { type DifficultyRules, difficultyRules } from '../difficulty';
import type { ItemStack } from '../inventory';
import type { Player } from '../player';
import { generateTrades } from '../trading';
import { Mob } from './ai';
import { HOSTILE_KINDS, PASSIVE_KINDS, type MobKind, mobDef } from './types';

export interface Arrow {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  life: number;
}

export interface MobUpdateContext {
  player: Player;
  day: DayCycle;
  /** How many hostiles may exist and how hard they hit. Defaults to ふつう so a caller
   *  that does not care — a test, a tool — gets the plain game. */
  difficulty?: DifficultyRules;
  /** Current in a cell, so mobs drift with moving water. */
  currentAt?(x: number, y: number, z: number): { x: number; z: number };
  /** Biome at a surface position, used for biome-specific passive mobs. */
  biomeAt?(x: number, z: number): number;
  /** Called when the player takes damage from a mob. */
  onPlayerHit(damage: number, fromX: number, fromZ: number): void;
  /** Called for every item a dying mob leaves behind. */
  onDrop(x: number, y: number, z: number, stack: ItemStack): void;
}

const PASSIVE_CAP = 22;
const DESPAWN_DISTANCE = 96;
const SPAWN_INTERVAL = 2;

/** Spawning, updating and despawning of every mob, plus skeleton arrows. */
export class MobManager {
  readonly mobs: Mob[] = [];
  readonly arrows: Arrow[] = [];
  private readonly rng: Rng;
  private spawnTimer = 0;

  constructor(
    private readonly world: World,
    private readonly seed: number,
  ) {
    this.rng = mulberry32(seed ^ 0x30b5);
  }

  get hostileCount(): number {
    return this.mobs.reduce((total, mob) => total + (mob.def.hostile ? 1 : 0), 0);
  }

  add(mob: Mob): Mob {
    this.mobs.push(mob);
    return mob;
  }

  addVillager(x: number, y: number, z: number, profession: string, stage = 0): Mob {
    const mob = new Mob('villager', x, y, z);
    mob.profession = profession;
    // Which person they are, from where they live. Stable for as long as the village is:
    // the smith at this door is the same person every time the player walks back into
    // town, which is the whole difference between a village and a spawn table.
    mob.variant = hashInts(this.seed ^ 0x7e0b1e, Math.round(x), Math.round(z));
    mob.trades = generateTrades(this.seed, profession, x, z, stage);
    return this.add(mob);
  }

  update(dt: number, ctx: MobUpdateContext): void {
    const rules = ctx.difficulty ?? difficultyRules('normal');
    // Turning the hostiles off empties the world of the ones already in it, rather than
    // leaving the player to outrun a zombie that can no longer be replaced.
    if (!rules.hostiles) {
      for (let i = this.mobs.length - 1; i >= 0; i--) {
        if (this.mobs[i].def.hostile) this.mobs.splice(i, 1);
      }
      this.arrows.length = 0;
    }

    const shoot = (mob: Mob, damage: number): void => {
      const player = ctx.player;
      const dx = player.x - mob.x;
      const dy = player.y + 1.2 - (mob.y + mob.def.height * 0.8);
      const dz = player.z - mob.z;
      const distance = Math.hypot(dx, dy, dz) || 1;
      const speed = 26;
      this.arrows.push({
        x: mob.x,
        y: mob.y + mob.def.height * 0.8,
        z: mob.z,
        vx: (dx / distance) * speed,
        // Aim slightly high to compensate for the drop over the flight.
        vy: (dy / distance) * speed + distance * 0.28,
        vz: (dz / distance) * speed,
        damage,
        life: 4,
      });
    };

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      const events = mob.update(dt, {
        world: this.world,
        player: ctx.player,
        day: ctx.day,
        rng: this.rng,
        shoot,
        currentAt: ctx.currentAt,
      });
      if (events.meleeDamage > 0) ctx.onPlayerHit(events.meleeDamage, mob.x, mob.z);
      if (events.died) {
        this.dropLoot(mob, ctx);
        this.mobs.splice(i, 1);
        continue;
      }
      // Porters are owned by the transport network, which notices when one disappears
      // and carries the shipment on abstractly, so the ordinary distance rule applies.
      if (mob.distanceTo(ctx.player.x, ctx.player.y, ctx.player.z) > DESPAWN_DISTANCE && mob.kind !== 'villager') {
        this.mobs.splice(i, 1);
      }
    }

    this.updateArrows(dt, ctx);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.trySpawn(ctx, rules);
    }
  }

  private updateArrows(dt: number, ctx: MobUpdateContext): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      arrow.life -= dt;
      arrow.vy -= 14 * dt;
      arrow.x += arrow.vx * dt;
      arrow.y += arrow.vy * dt;
      arrow.z += arrow.vz * dt;
      const hitBlock = blockDef(
        this.world.getBlock(Math.floor(arrow.x), Math.floor(arrow.y), Math.floor(arrow.z)),
      ).solid;
      const player = ctx.player;
      const hitPlayer =
        Math.abs(arrow.x - player.x) < 0.5 &&
        Math.abs(arrow.z - player.z) < 0.5 &&
        arrow.y > player.y &&
        arrow.y < player.y + 1.9;
      if (hitPlayer) ctx.onPlayerHit(arrow.damage, arrow.x, arrow.z);
      if (hitBlock || hitPlayer || arrow.life <= 0) this.arrows.splice(i, 1);
    }
  }

  /** Applies damage from the player and returns true when the mob died. */
  hurt(mob: Mob, damage: number, fromX: number, fromZ: number, ctx: MobUpdateContext): boolean {
    const result = applyDamage(mob, damage);
    if (!result.applied) return false;
    applyKnockback(mob, fromX, fromZ, mob.x, mob.z, 5);
    mob.onHurt();
    if (result.dead) {
      this.dropLoot(mob, ctx);
      const index = this.mobs.indexOf(mob);
      if (index >= 0) this.mobs.splice(index, 1);
      return true;
    }
    return false;
  }

  private dropLoot(mob: Mob, ctx: MobUpdateContext): void {
    for (const drop of mob.def.drops) {
      if (this.rng() > drop.chance) continue;
      const count = drop.min + Math.floor(this.rng() * (drop.max - drop.min + 1));
      if (count > 0) ctx.onDrop(mob.x, mob.y + 0.4, mob.z, { id: drop.id, count });
    }
  }

  private trySpawn(ctx: MobUpdateContext, rules: DifficultyRules): void {
    const player = ctx.player;
    const night = ctx.day.isNight;
    const hostiles = this.hostileCount;
    const passives = this.mobs.length - hostiles;

    if (night && rules.hostiles && hostiles < rules.cap) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const spot = this.findSpawnSpot(player, 22, 46);
        if (!spot) continue;
        // Hostile mobs only appear in the dark, so torches keep a base safe. Skylight
        // does not matter here: it is already night when this runs.
        if (this.world.getBlockLight(spot.x, spot.y, spot.z) > 7) continue;
        const kind = HOSTILE_KINDS[Math.floor(this.rng() * HOSTILE_KINDS.length)];
        if (!this.fits(kind, spot.x, spot.y, spot.z)) continue;
        this.add(new Mob(kind, spot.x + 0.5, spot.y, spot.z + 0.5));
        break;
      }
    }

    if (!night && passives < PASSIVE_CAP) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const spot = this.findSpawnSpot(player, 16, 44);
        if (!spot) continue;
        const biome = ctx.biomeAt?.(spot.x, spot.z);
        const ground = this.world.getBlock(spot.x, spot.y - 1, spot.z);
        const validGround = ground === Block.GRASS ||
          (biome === Biome.DESERT && ground === Block.SAND) ||
          (biome === Biome.SNOWY_PLAINS && ground === Block.SNOW) ||
          (biome === Biome.TAIGA && (ground === Block.SNOW || ground === Block.GRASS));
        if (!validGround) continue;
        if (this.world.getSkyLight(spot.x, spot.y, spot.z) < 9) continue;
        const kind = this.passiveKindAt(biome);
        if (!this.fits(kind, spot.x, spot.y, spot.z)) continue;
        const groupSize = 1 + Math.floor(this.rng() * 3);
        for (let i = 0; i < groupSize; i++) {
          this.add(new Mob(kind, spot.x + 0.5 + (this.rng() - 0.5) * 3, spot.y, spot.z + 0.5 + (this.rng() - 0.5) * 3));
        }
        break;
      }
    }
  }

  private passiveKindAt(biome: number | undefined): MobKind {
    // Cats and dogs are common near temperate grasslands and woodland. The remaining
    // entries are deliberately biome-gated so discovering a new climate also means
    // discovering a new animal.
    const choices = biome === Biome.DESERT
      ? ['camel', 'rabbit'] as const
      : biome === Biome.SNOWY_PLAINS
        ? ['rabbit', 'dog'] as const
        : biome === Biome.TAIGA
          ? ['fox', 'dog', 'sheep'] as const
          : biome === Biome.FOREST || biome === Biome.SWAMP
            ? ['cat', 'dog', 'fox', 'cow'] as const
            : PASSIVE_KINDS;
    return choices[Math.floor(this.rng() * choices.length)];
  }

  /** Picks a random loaded surface position in a ring around the player. */
  private findSpawnSpot(player: Player, min: number, max: number): { x: number; y: number; z: number } | null {
    const angle = this.rng() * Math.PI * 2;
    const distance = min + this.rng() * (max - min);
    const x = Math.floor(player.x + Math.cos(angle) * distance);
    const z = Math.floor(player.z + Math.sin(angle) * distance);
    if (!this.world.isLoadedAt(x, z)) return null;
    const top = this.world.heightAt(x, z);
    if (top < 1 || top >= CHUNK_HEIGHT - 3) return null;
    const ground = this.world.getBlock(x, top, z);
    if (!blockDef(ground).solid) return null;
    return { x, y: top + 1, z };
  }

  private fits(kind: MobKind, x: number, y: number, z: number): boolean {
    const def = mobDef(kind);
    const height = Math.ceil(def.height);
    for (let dy = 0; dy < height; dy++) {
      if (blockDef(this.world.getBlock(x, y + dy, z)).solid) return false;
    }
    return true;
  }

  clear(): void {
    this.mobs.length = 0;
    this.arrows.length = 0;
  }
}
