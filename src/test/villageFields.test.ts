import { describe, expect, it } from 'vitest';
import { applyFields, fieldChunks } from '../game/villageFields';
import { fieldsAt, isChannel, townFields } from '../world/generation/fields';
import { Block, cropAt, isFarmland } from '../world/blocks';
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME, toChunkCoord } from '../world/chunk';
import { World } from '../world/world';
import type { VillageRecord } from '../game/villages';

const SEED = 7;
const SITE = { x: 0, z: 0 };
const BASE_Y = 60;

function record(stage: number, outpost = false): VillageRecord {
  return {
    id: '0,0', x: SITE.x, z: SITE.z, baseY: BASE_Y, variant: 'plains',
    name: '麦', produces: 'bread', inputs: ['wheat'], inputStock: new Map(), needs: [],
    stage, points: 0, stock: 0, received: 0,
    discovered: true, spawnedStage: 0, progress: 0, harvest: 0, harvestProgress: 0,
    ...(outpost ? { outpost: true } : {}),
  } as VillageRecord;
}

/** Flat grass over every chunk a town's fields could touch. `height` lets one column or
 *  one region be raised or sunk, which is the only interesting thing about the ground as
 *  far as ploughing is concerned. */
function grassWorld(height: (x: number, z: number) => number = () => BASE_Y): World {
  const world = new World(1);
  for (let cx = -5; cx <= 4; cx++) {
    for (let cz = -5; cz <= 4; cz++) {
      const blocks = new Uint16Array(CHUNK_VOLUME);
      const chunk = new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME));
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const top = height(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz);
          for (let y = 0; y < top; y++) chunk.set(lx, y, lz, Block.DIRT);
          chunk.set(lx, top, lz, Block.GRASS);
        }
      }
      chunk.generated = true;
      world.addChunk(chunk);
    }
  }
  return world;
}

function tilledColumns(world: World, stage: number): number {
  let count = 0;
  for (const parcel of fieldsAt(SEED, SITE, stage)) {
    for (let z = parcel.z0; z < parcel.z0 + parcel.d; z++) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
        if (isFarmland(world.getBlock(x, BASE_Y, z))) count++;
      }
    }
  }
  return count;
}

describe('ploughing the fields of a town', () => {
  it('turns over the parcels the stage owns, and no more', () => {
    const world = grassWorld();
    const work = applyFields(world, SEED, record(0));
    expect(work.parcels).toBe(fieldsAt(SEED, SITE, 0).length);
    expect(work.tilled).toBeGreaterThan(1000);
    // Ground the next stage's parcel stands on is still grass.
    const later = townFields(SEED, SITE).find((parcel) => parcel.stage > 0);
    expect(later).toBeDefined();
    expect(world.getBlock(later!.x0 + 11, BASE_Y, later!.z0 + 11)).toBe(Block.GRASS);
  });

  it('plants wheat on what it ploughs', () => {
    const world = grassWorld();
    applyFields(world, SEED, record(0));
    const parcel = fieldsAt(SEED, SITE, 0)[0];
    let crops = 0;
    for (let z = parcel.z0; z < parcel.z0 + parcel.d; z++) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
        if (cropAt(world.getBlock(x, BASE_Y + 1, z))) crops++;
      }
    }
    expect(crops).toBeGreaterThan(parcel.w * parcel.d * 0.6);
  });

  it('digs watercourses that reach every row, and keeps the water in them', () => {
    const world = grassWorld();
    const work = applyFields(world, SEED, record(0));
    expect(work.watered).toBeGreaterThan(0);
    const parcel = fieldsAt(SEED, SITE, 0)[0];
    for (let z = parcel.z0; z < parcel.z0 + parcel.d; z++) {
      for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
        const at = world.getBlock(x, BASE_Y, z);
        expect(at === Block.WATER).toBe(isChannel(parcel, x, z));
      }
    }
    // Nothing outside the parcel got wet.
    for (let x = parcel.x0 - 1; x < parcel.x0 + parcel.w + 1; x++) {
      expect(world.getBlock(x, BASE_Y, parcel.z0 - 1)).not.toBe(Block.WATER);
    }
  });

  it('leaves the water out where the ground would not hold it', () => {
    const parcel = townFields(SEED, SITE)[0];
    // A trench cut across the middle of the parcel: the channel cells beside it have a
    // neighbour lower than they are, and water put there would run into it.
    const gully = parcel.z0 + 11;
    const world = grassWorld((_x, z) => (z === gully ? BASE_Y - 3 : BASE_Y));
    applyFields(world, SEED, record(0));
    for (let x = parcel.x0; x < parcel.x0 + parcel.w; x++) {
      if (!isChannel(parcel, x, gully - 1)) continue;
      expect(world.getBlock(x, BASE_Y, gully - 1)).not.toBe(Block.WATER);
    }
  });

  it('follows the ground instead of levelling it', () => {
    const parcel = townFields(SEED, SITE)[0];
    const step = parcel.x0 + 11;
    const world = grassWorld((x) => (x >= step ? BASE_Y + 4 : BASE_Y));
    applyFields(world, SEED, record(0));
    expect(isFarmland(world.getBlock(parcel.x0 + 1, BASE_Y, parcel.z0 + 5))).toBe(true);
    // The high half is tilled at its own level, not filled up to the low half's.
    expect(isFarmland(world.getBlock(step + 2, BASE_Y + 4, parcel.z0 + 5))).toBe(true);
    expect(world.getBlock(step + 2, BASE_Y, parcel.z0 + 5)).toBe(Block.DIRT);
  });

  it('leaves alone what it cannot plough', () => {
    const world = grassWorld();
    const parcel = fieldsAt(SEED, SITE, 0)[0];
    // A road the player laid, and a wall they built.
    world.setBlock(parcel.x0 + 6, BASE_Y, parcel.z0 + 6, Block.COBBLESTONE);
    const road = new Set([`${parcel.x0 + 4},${parcel.z0 + 4}`]);
    applyFields(world, SEED, record(0), (x, z) => (road.has(`${x},${z}`) ? BASE_Y : undefined));
    expect(world.getBlock(parcel.x0 + 6, BASE_Y, parcel.z0 + 6)).toBe(Block.COBBLESTONE);
    expect(world.getBlock(parcel.x0 + 4, BASE_Y, parcel.z0 + 4)).toBe(Block.GRASS);
  });

  it('ploughs once, however often it is asked', () => {
    const world = grassWorld();
    const first = applyFields(world, SEED, record(0));
    const again = applyFields(world, SEED, record(0));
    expect(first.parcels).toBeGreaterThan(0);
    expect(again.parcels).toBe(0);
    expect(tilledColumns(world, 0)).toBeGreaterThan(1000);
  });

  it('ploughs the new parcels when the town grows, and keeps the old ones', () => {
    const world = grassWorld();
    applyFields(world, SEED, record(0));
    const before = tilledColumns(world, 0);
    const grown = applyFields(world, SEED, record(2));
    expect(grown.parcels).toBe(fieldsAt(SEED, SITE, 2).length - fieldsAt(SEED, SITE, 0).length);
    expect(tilledColumns(world, 0)).toBe(before);
    expect(tilledColumns(world, 2)).toBeGreaterThan(before);
  });

  it('waits for the chunks rather than half writing a parcel', () => {
    const world = new World(1);
    expect(applyFields(world, SEED, record(0)).parcels).toBe(0);
  });

  it('gives a hamlet no fields at all', () => {
    const world = grassWorld();
    expect(applyFields(world, SEED, record(4, true)).parcels).toBe(0);
  });

  it('names every chunk its fields touch', () => {
    const chunks = fieldChunks(SEED, record(0));
    for (const parcel of fieldsAt(SEED, SITE, 0)) {
      for (const [x, z] of [[parcel.x0, parcel.z0], [parcel.x0 + parcel.w - 1, parcel.z0 + parcel.d - 1]]) {
        const cx = toChunkCoord(x);
        const cz = toChunkCoord(z);
        expect(chunks.some((c) => c.cx === cx && c.cz === cz)).toBe(true);
      }
    }
  });
});
