import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { WATER_FULL } from '../world/water';
import { AUTO_STEP_BLOCKS, MAX_AIR, NO_INPUT, Player, movementDirection } from '../game/player';
import { TrackNetwork, type TrackAnchor } from '../game/tracks';

/** Blocks for one flat chunk per ground height. All twenty-five chunks of a flat world
 *  are identical, so they are filled once and copied rather than written cell by cell. */
const flatColumns = new Map<number, Uint16Array>();

function flatWorld(groundY = 20): World {
  let template = flatColumns.get(groundY);
  if (!template) {
    const filled = new Chunk(0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = 0; y <= groundY; y++) filled.set(x, y, z, Block.STONE);
      }
    }
    template = filled.blocks;
    flatColumns.set(groundY, template);
  }
  const world = new World(1);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new Chunk(cx, cz);
      chunk.blocks.set(template);
      world.addChunk(chunk);
    }
  }
  return world;
}

/** A pool three blocks deep with a bank standing one block clear of the water, which
 *  is the shape a dug out pool leaves behind. */
function poolWithBank(): World {
  const world = flatWorld(20);
  for (let z = -12; z < 12; z++) {
    for (let x = 6; x < 40; x++) {
      for (let y = 21; y <= 23; y++) world.setBlock(x, y, z, Block.STONE);
    }
    for (let x = -12; x < 6; x++) {
      for (let y = 21; y <= 23; y++) world.setWater(x, y, z, WATER_FULL);
    }
  }
  return world;
}

/** Flat ground that steps up by `height` blocks at x = 3 and stays up: a second of
 *  walking covers a dozen blocks, so the raised half has to be wider than that. */
function worldWithStep(groundY = 20, height = 1): World {
  const world = flatWorld(groundY);
  for (let z = -20; z < 20; z++) {
    for (let x = 3; x < 40; x++) {
      for (let y = groundY + 1; y <= groundY + height; y++) world.setBlock(x, y, z, Block.STONE);
    }
  }
  return world;
}

/** Walks east for a second and reports where the player ended up. */
function walkEast(world: World, autoStep: boolean, groundY = 20): Player {
  const player = new Player();
  player.autoStep = autoStep;
  player.x = 0.5;
  player.y = groundY + 1;
  player.z = 0.5;
  // Yaw -PI/2 looks towards +X.
  player.yaw = -Math.PI / 2;
  for (let i = 0; i < 90; i++) player.update(1 / 60, world, { ...NO_INPUT, forward: true });
  return player;
}

/** The ground `walk` runs on. The player never writes to the world, so one flat world
 *  serves every yaw instead of laying 25 chunks again for each one. */
let walkGround: World | null = null;

/** Runs the player for a second and reports how far, and in which direction, it moved. */
function walk(yaw: number, keys: Partial<typeof NO_INPUT>): { x: number; z: number } {
  const world = (walkGround ??= flatWorld());
  const player = new Player();
  player.x = 0.5;
  player.y = 21;
  player.z = 0.5;
  player.yaw = yaw;
  const startX = player.x;
  const startZ = player.z;
  for (let i = 0; i < 60; i++) player.update(1 / 60, world, { ...NO_INPUT, ...keys });
  const dx = player.x - startX;
  const dz = player.z - startZ;
  const length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
}

const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.4];

describe('movement direction', () => {
  it('walks forward towards wherever the camera is pointing', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const moved = walk(yaw, { forward: true });
      // The direction walked must line up with the camera's horizontal facing.
      const dot = moved.x * (look.x / flatLength) + moved.z * (look.z / flatLength);
      expect(dot).toBeGreaterThan(0.999);
    }
  });

  it('walks backwards away from the camera direction', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const moved = walk(yaw, { back: true });
      const dot = moved.x * (look.x / flatLength) + moved.z * (look.z / flatLength);
      expect(dot).toBeLessThan(-0.999);
    }
  });

  it('strafes right to the right hand side of the camera', () => {
    for (const yaw of YAWS) {
      const player = new Player();
      player.yaw = yaw;
      const look = player.lookVector();
      const flatLength = Math.hypot(look.x, look.z);
      const forwardX = look.x / flatLength;
      const forwardZ = look.z / flatLength;
      // Right of a heading (fx, fz) on the XZ plane is (-fz, fx).
      const rightX = -forwardZ;
      const rightZ = forwardX;
      const moved = walk(yaw, { right: true });
      expect(moved.x * rightX + moved.z * rightZ).toBeGreaterThan(0.999);
      const strafedLeft = walk(yaw, { left: true });
      expect(strafedLeft.x * rightX + strafedLeft.z * rightZ).toBeLessThan(-0.999);
    }
  });

  it('keeps diagonal input at the same speed as a straight line', () => {
    const straight = walk(0.4, { forward: true });
    const diagonal = walk(0.4, { forward: true, right: true });
    expect(Math.hypot(straight.x, straight.z)).toBeCloseTo(1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
  });

  it('is a pure rotation of the input vector', () => {
    expect(movementDirection(0, 0, -1)).toEqual({ x: 0, z: -1 });
    const turned = movementDirection(Math.PI / 2, 0, -1);
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);
  });
});

/** A flat world with a pool of water on top of the ground. */
function flooded(depth: number): { world: World; player: Player } {
  const world = flatWorld();
  for (let z = -8; z < 24; z++) {
    for (let x = -8; x < 24; x++) {
      for (let y = 21; y < 21 + depth; y++) world.setBlock(x, y, z, Block.WATER);
    }
  }
  const player = new Player();
  player.x = 0.5;
  player.y = 21;
  player.z = 0.5;
  return { world, player };
}

describe('water', () => {
  it('swims in deep water but only wades through a puddle', () => {
    const deep = flooded(3);
    deep.player.update(1 / 60, deep.world, NO_INPUT);
    expect(deep.player.inWater).toBe(true);

    const puddle = flooded(1);
    // A shallow film is not enough to swim in.
    for (let z = -8; z < 24; z++) {
      for (let x = -8; x < 24; x++) puddle.world.setWater(x, 21, z, WATER_FULL * 0.2);
    }
    puddle.player.update(1 / 60, puddle.world, NO_INPUT);
    expect(puddle.player.inWater).toBe(false);
    expect(puddle.player.waterLevel).toBeGreaterThan(0);
  });

  it('runs out of air under water and drowns, then recovers at the surface', () => {
    const { world, player } = flooded(5);
    for (let i = 0; i < 200; i++) player.update(0.1, world, NO_INPUT);
    expect(player.submerged).toBe(true);
    expect(player.air).toBe(0);
    expect(player.health).toBeLessThan(player.maxHealth);

    // Lift the player clear of the water and the breath comes back.
    const hurt = player.health;
    for (let y = 21; y < 26; y++) {
      for (let z = -8; z < 24; z++) for (let x = -8; x < 24; x++) world.setBlock(x, y, z, Block.AIR);
    }
    for (let i = 0; i < 60; i++) player.update(0.1, world, NO_INPUT);
    expect(player.air).toBe(MAX_AIR);
    expect(player.health).toBeGreaterThanOrEqual(hurt);
  });

  it('is swept along by a current', () => {
    const { world, player } = flooded(3);
    const startX = player.x;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT, { x: 0.5, z: 0 });
    expect(player.x).toBeGreaterThan(startX + 0.5);
  });

  it('is not pushed around on dry land', () => {
    const world = flatWorld();
    const player = new Player();
    player.x = 0.5;
    player.y = 21;
    player.z = 0.5;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT, { x: 0.5, z: 0 });
    expect(Math.abs(player.x - 0.5)).toBeLessThan(0.05);
  });

  it('walks up a single block step without jumping', () => {
    const climbed = walkEast(worldWithStep(), true);
    expect(climbed.x).toBeGreaterThan(4);
    expect(climbed.y).toBeCloseTo(22, 1);
    expect(climbed.onGround).toBe(true);
  });

  it('is stopped by the same step when auto stepping is off', () => {
    const blocked = walkEast(worldWithStep(), false);
    expect(blocked.x).toBeLessThan(3);
    expect(blocked.y).toBeCloseTo(21, 1);
  });

  it('walks up a three block ledge, which is as high as auto stepping goes', () => {
    const climbed = walkEast(worldWithStep(20, AUTO_STEP_BLOCKS), true);
    expect(climbed.x).toBeGreaterThan(4);
    expect(climbed.y).toBeCloseTo(20 + AUTO_STEP_BLOCKS + 1, 1);
    expect(climbed.onGround).toBe(true);
  });

  it('does not climb a wall one block taller than that', () => {
    const player = walkEast(worldWithStep(20, AUTO_STEP_BLOCKS + 1), true);
    expect(player.x).toBeLessThan(3);
    expect(player.y).toBeCloseTo(21, 1);
  });

  it('still crosses a kerb tucked under a low ceiling', () => {
    // Raising the whole player three blocks needs headroom, so the climb has to fall
    // back to the shortest step that fits rather than give up.
    const world = worldWithStep();
    for (let z = -20; z < 20; z++) {
      for (let x = -20; x < 40; x++) world.setBlock(x, 24, z, Block.STONE);
    }
    const climbed = walkEast(world, true);
    expect(climbed.x).toBeGreaterThan(4);
    expect(climbed.y).toBeCloseTo(22, 1);
  });

  it('climbs out of the water onto the bank', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 24;
    player.z = 0.5;
    // Yaw -PI/2 looks towards +X, which is where the bank is.
    player.yaw = -Math.PI / 2;
    for (let i = 0; i < 180; i++) {
      // Swim forwards while holding jump, then stand still once out on the bank.
      const ashore = !player.inWater && player.y > 23.5;
      player.update(1 / 60, world, { ...NO_INPUT, forward: !ashore, jump: !ashore });
    }
    // Out of the water, standing on top of the bank rather than bobbing against it.
    expect(player.x).toBeGreaterThan(6.5);
    expect(player.y).toBeGreaterThan(23.5);
    expect(player.onGround).toBe(true);
    expect(player.inWater).toBe(false);
  });

  it('sinks slowly instead of dropping through the water', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 23.5;
    player.z = 0.5;
    for (let i = 0; i < 30; i++) player.update(1 / 60, world, NO_INPUT);
    const startY = player.y;
    for (let i = 0; i < 60; i++) player.update(1 / 60, world, NO_INPUT);
    const sank = startY - player.y;
    // Roughly a block a second, where air would be more than ten times that.
    expect(sank).toBeGreaterThan(0.4);
    expect(sank).toBeLessThan(2);
  });

  it('slows a dive rather than stopping it dead at the surface', () => {
    const world = poolWithBank();
    const player = new Player();
    player.x = 1.5;
    player.y = 30;
    player.z = 0.5;
    let deepest = player.y;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, world, NO_INPUT);
      deepest = Math.min(deepest, player.y);
    }
    // The fall carries on past the surface and then settles on the bottom.
    expect(deepest).toBeLessThan(22);
    expect(player.y).toBeCloseTo(21, 1);
  });
});

// --- standing on something that is not made of blocks --------------------------

/** One end of a run, at a heading in the XZ plane. */
function railEnd(x: number, y: number, z: number, hx: number, hz: number): TrackAnchor {
  const length = Math.hypot(hx, hz);
  return { x, y, z, hx: hx / length, hz: hz / length, grade: 0 };
}

/** A network holding one run, or a thrown error saying why not. */
function railway(from: TrackAnchor, to: TrackAnchor): TrackNetwork {
  const net = new TrackNetwork();
  const laid = net.lay(from, to);
  if (!laid.ok) throw new Error(`could not lay the run: ${laid.fault} (${laid.value})`);
  return net;
}

/** Yaw -PI/2 looks towards +X, the same convention the walking tests above use. */
function standing(x: number, y: number, z: number, yaw = -Math.PI / 2): Player {
  const player = new Player();
  player.x = x;
  player.y = y;
  player.z = z;
  player.yaw = yaw;
  return player;
}

function run(player: Player, world: World, frames: number, input = NO_INPUT): void {
  for (let i = 0; i < frames; i++) player.update(1 / 60, world, input);
}

describe('a surface that is not in the block grid', () => {
  it('stands the player at a height no block has', () => {
    const world = flatWorld(20);
    const player = standing(0.5, 24, 0.5);
    player.surface = { surfaceTopAt: () => 21.37 };
    run(player, world, 60);
    expect(player.y).toBeCloseTo(21.37, 6);
    expect(player.onGround).toBe(true);
  });

  it('is not there at all when nothing supplies one', () => {
    const world = flatWorld(20);
    const player = standing(0.5, 24, 0.5);
    run(player, world, 60);
    expect(player.y).toBeCloseTo(21, 2);
  });

  it('carries the player along a level viaduct instead of through it', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 26, 0, 1, 0), railEnd(40, 26, 0, 1, 0));
    const player = standing(0.5, 26, 0.5);
    player.surface = net;
    run(player, world, 120, { ...NO_INPUT, forward: true });
    expect(player.y).toBeCloseTo(26, 6);
    expect(player.onGround).toBe(true);
    expect(player.x).toBeGreaterThan(12);
  });

  it('walks up its gradient', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 21, 0, 1, 0), railEnd(40, 25, 0, 1, 0));
    const player = standing(0.5, 21, 0.5);
    player.surface = net;
    run(player, world, 240, { ...NO_INPUT, forward: true });
    expect(player.x).toBeGreaterThan(30);
    expect(player.y).toBeGreaterThan(24);
    expect(player.onGround).toBe(true);
  });

  it('walks up its gradient with auto stepping turned off', () => {
    // The reason the deck is settled after the sweep rather than swept against: as boxes
    // it would be a staircase of five-centimetre rises, and with this setting off the
    // step-up path is not even reached.
    const world = flatWorld(20);
    const net = railway(railEnd(0, 21, 0, 1, 0), railEnd(40, 25, 0, 1, 0));
    const player = standing(0.5, 21, 0.5);
    player.autoStep = false;
    player.surface = net;
    run(player, world, 240, { ...NO_INPUT, forward: true });
    expect(player.y).toBeGreaterThan(24);
  });

  it('walks down its gradient without falling off it', () => {
    // A viaduct has nothing solid under it, so the sweep reports no ground every frame.
    // Reaching for the deck on `onGround` rather than on where the frame started would
    // drop the player on the very first step of the descent.
    const world = flatWorld(20);
    const net = railway(railEnd(0, 30, 0, 1, 0), railEnd(40, 26, 0, 1, 0));
    const player = standing(0.5, 30, 0.5);
    player.surface = net;
    let lowest = 30;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, world, { ...NO_INPUT, forward: true });
      if (player.x < 39) {
        expect(player.onGround).toBe(true);
        lowest = Math.min(lowest, player.y);
      }
    }
    expect(player.x).toBeGreaterThan(30);
    expect(lowest).toBeGreaterThan(25.9);
  });

  it('falls off the end of a run rather than walking on air past it', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 26, 0, 1, 0), railEnd(30, 26, 0, 1, 0));
    const player = standing(0.5, 26, 0.5);
    player.surface = net;
    run(player, world, 300, { ...NO_INPUT, forward: true });
    expect(player.x).toBeGreaterThan(30);
    expect(player.y).toBeCloseTo(21, 1);
  });

  it('falls off the side of one', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 26, 0, 1, 0), railEnd(30, 26, 0, 1, 0));
    // Facing -Z, straight off the sleeper ends a metre away.
    const player = standing(15, 26, 0, 0);
    player.surface = net;
    run(player, world, 120, { ...NO_INPUT, forward: true });
    expect(player.y).toBeCloseTo(21, 1);
  });

  it('jumps onto a deck from underneath, and is not dragged onto one out of reach', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 22, 0, 1, 0), railEnd(30, 22, 0, 1, 0));
    const player = standing(15, 21, 0.5);
    player.surface = net;
    run(player, world, 30);
    // The sweep rests a thousandth of a block clear of the ground it landed on.
    expect(player.y).toBeCloseTo(21, 2);
    run(player, world, 60, { ...NO_INPUT, jump: true });
    expect(player.y).toBeCloseTo(22, 6);
    expect(player.onGround).toBe(true);
  });

  it('hurts to land on from a height, the same as any other floor', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 26, 0, 1, 0), railEnd(30, 26, 0, 1, 0));
    const player = standing(15, 45, 0.5);
    player.surface = net;
    run(player, world, 120);
    expect(player.y).toBeCloseTo(26, 6);
    expect(player.health).toBeLessThan(player.maxHealth);
  });

  it('does not glue a flying player to it', () => {
    const world = flatWorld(20);
    const net = railway(railEnd(0, 26, 0, 1, 0), railEnd(30, 26, 0, 1, 0));
    const player = standing(15, 26, 0.5);
    player.surface = net;
    player.flying = true;
    run(player, world, 60, { ...NO_INPUT, jump: true });
    expect(player.y).toBeGreaterThan(28);
  });
});
