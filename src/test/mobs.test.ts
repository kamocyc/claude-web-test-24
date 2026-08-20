import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { WATER_FULL } from '../world/water';
import { Mob, type MobContext } from '../game/mobs/ai';
import { Player } from '../game/player';
import { DayCycle } from '../game/daycycle';

function stoneFloor(): World {
  const world = new World(1);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
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

/** Water three blocks deep from x >= bankX, with a bank one block clear of it to the
 *  west. Mobs in these tests always wander west, so the bank is what they walk into. */
function pool(bankX: number | null): World {
  const world = stoneFloor();
  for (let z = -20; z < 20; z++) {
    for (let x = -30; x < 30; x++) {
      const solid = bankX !== null && x < bankX;
      for (let y = 21; y <= 23; y++) {
        if (solid) world.setBlock(x, y, z, Block.STONE);
        else world.setWater(x, y, z, WATER_FULL);
      }
    }
  }
  return world;
}

/** A steady random source makes the wander direction due west every time. */
function context(world: World): MobContext {
  const day = new DayCycle();
  day.time = 0.25;
  const player = new Player();
  // Far enough away that nothing chases or flees.
  player.x = 500;
  player.z = 500;
  return { world, player, day, rng: () => 0.5, shoot: () => {} };
}

describe('mobs in water', () => {
  it('climbs out onto the bank instead of bobbing against it', () => {
    const world = pool(-6);
    const ctx = context(world);
    const cow = new Mob('cow', 1.5, 23, 0.5);
    for (let i = 0; i < 600; i++) cow.update(1 / 60, ctx);
    expect(cow.x).toBeLessThan(-6.5);
    expect(cow.y).toBeGreaterThan(23.5);
    expect(cow.onGround).toBe(true);
  });

  it('floats at the surface rather than sinking to the bed', () => {
    const world = pool(null);
    const ctx = context(world);
    const cow = new Mob('cow', 1.5, 30, 0.5);
    for (let i = 0; i < 300; i++) cow.update(1 / 60, ctx);
    expect(cow.y).toBeGreaterThan(22.5);
  });
});
