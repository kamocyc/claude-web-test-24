import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { DayCycle } from '../game/daycycle';
import { DIFFICULTIES, NORMAL_HOSTILE_CAP, difficultyRules, isDifficulty } from '../game/difficulty';
import { Mob } from '../game/mobs/ai';
import { MobManager, type MobUpdateContext } from '../game/mobs/spawner';
import { NO_INPUT, Player } from '../game/player';
import { DEFAULT_SETTINGS } from '../game/settings';

/** Flat stone with sky above it, so hostile spawning has somewhere to land. */
function ground(): World {
  const world = new World(1);
  for (let cz = -3; cz <= 3; cz++) {
    for (let cx = -3; cx <= 3; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let y = 0; y <= 20; y++) chunk.set(x, y, z, Block.STONE);
        }
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

function night(): DayCycle {
  const day = new DayCycle();
  day.time = 0.8;
  return day;
}

function context(player: Player, id: string): MobUpdateContext {
  return {
    player,
    day: night(),
    difficulty: difficultyRules(id),
    onPlayerHit: () => {},
    onDrop: () => {},
  };
}

describe('difficulty', () => {
  it('names four settings and falls back to ふつう for anything else', () => {
    expect(DIFFICULTIES.map((rules) => rules.id)).toEqual(['peaceful', 'easy', 'normal', 'hard']);
    expect(difficultyRules('nonsense').id).toBe('normal');
    expect(difficultyRules(undefined).id).toBe('normal');
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('lethal')).toBe(false);
  });

  it('leaves ふつう exactly as the game was before it was a choice', () => {
    const normal = difficultyRules('normal');
    expect(normal.damage).toBe(1);
    expect(normal.cap).toBe(NORMAL_HOSTILE_CAP);
    expect(normal.starve).toBe(true);
    expect(normal.regen).toBe(0);
    expect(DEFAULT_SETTINGS.difficulty).toBe('normal');
  });

  it('scales what a blow costs without touching what the player can hit back with', () => {
    const damage = DIFFICULTIES.map((rules) => rules.damage);
    expect(damage).toEqual([0, 0.5, 1, 1.5]);
    // Every step up is a step up: no two settings are secretly the same.
    const caps = DIFFICULTIES.map((rules) => rules.cap);
    expect([...caps].sort((a, b) => a - b)).toEqual(caps);
  });
});

describe('peaceful', () => {
  it('spawns no hostiles however long the night runs', () => {
    const mobs = new MobManager(ground(), 7);
    const player = new Player();
    player.y = 21;
    for (let i = 0; i < 400; i++) mobs.update(0.5, context(player, 'peaceful'));
    expect(mobs.hostileCount).toBe(0);
  });

  it('clears the hostiles already wandering, and their arrows', () => {
    const mobs = new MobManager(ground(), 7);
    const player = new Player();
    player.y = 21;
    mobs.add(new Mob('zombie', 4, 21, 4));
    mobs.add(new Mob('skeleton', -4, 21, -4));
    mobs.add(new Mob('cow', 2, 21, 2));
    mobs.arrows.push({ x: 0, y: 21, z: 0, vx: 0, vy: 0, vz: 0, damage: 3, life: 4 });

    mobs.update(0.1, context(player, 'peaceful'));

    expect(mobs.hostileCount).toBe(0);
    expect(mobs.arrows).toHaveLength(0);
    // The animals are not what the player switched away from.
    expect(mobs.mobs.map((mob) => mob.kind)).toEqual(['cow']);
  });

  it('mends the player instead of starving them', () => {
    const world = ground();
    const player = new Player();
    player.y = 21;
    player.rules = difficultyRules('peaceful');
    player.health = 6;
    player.hunger.food = 0;

    for (let i = 0; i < 600; i++) player.update(1 / 60, world, NO_INPUT);

    expect(player.health).toBeGreaterThan(6);
    expect(player.isDead).toBe(false);
  });

  it('still lets an empty stomach kill on ふつう', () => {
    const world = ground();
    const player = new Player();
    player.y = 21;
    player.health = 2;
    player.hunger.food = 0;

    for (let i = 0; i < 600; i++) player.update(1 / 60, world, NO_INPUT);

    expect(player.health).toBeLessThan(2);
  });
});

describe('the hostile ceiling', () => {
  it('spawns hostiles at night when they are allowed', () => {
    const mobs = new MobManager(ground(), 3);
    const player = new Player();
    player.y = 21;
    for (let i = 0; i < 40; i++) mobs.update(0.5, context(player, 'normal'));
    expect(mobs.hostileCount).toBeGreaterThan(0);
  });

  it('stops spawning once the setting says it has enough', () => {
    const mobs = new MobManager(ground(), 3);
    const player = new Player();
    player.y = 21;
    const cap = difficultyRules('easy').cap;
    // Standing them at the ceiling is the whole test: waiting for a night to fill up on
    // its own would say the same thing and take a hundred times as long.
    for (let i = 0; i < cap; i++) mobs.add(new Mob('zombie', 40 + i, 21, 40));
    for (let i = 0; i < 40; i++) mobs.update(0.5, context(player, 'easy'));
    expect(mobs.hostileCount).toBe(cap);
  });
});
