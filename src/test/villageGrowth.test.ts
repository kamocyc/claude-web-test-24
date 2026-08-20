import { describe, expect, it } from 'vitest';
import { applyGrowth, clearGrowthCache, growthChunks, growthFor } from '../game/villageGrowth';
import { planGrowth, planVillage } from '../world/generation/village';
import { Block } from '../world/blocks';
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME } from '../world/chunk';
import { World } from '../world/world';
import type { VillageRecord } from '../game/villages';

const SITE = { cellX: 0, cellZ: 0, x: 100, z: 200 };
const BASE_Y = 60;

function record(stage: number): VillageRecord {
  return {
    id: '100,200', x: SITE.x, z: SITE.z, baseY: BASE_Y, variant: 'plains',
    name: '麦村', produces: 'wheat', stage, points: 0, stock: 0,
    discovered: true, spawnedStage: 0, progress: 0,
  };
}

/** A world of solid grass at ground level, so growth has natural ground to build on. */
function grassWorld(): World {
  const world = new World(1);
  for (let cx = 5; cx <= 8; cx++) {
    for (let cz = 11; cz <= 14; cz++) {
      const blocks = new Uint16Array(CHUNK_VOLUME);
      const chunk = new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME));
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          for (let y = 0; y < BASE_Y; y++) chunk.set(lx, y, lz, Block.DIRT);
          chunk.set(lx, BASE_Y - 1, lz, Block.GRASS);
        }
      }
      chunk.generated = true;
      world.addChunk(chunk);
    }
  }
  return world;
}

function chunksOf(world: World) {
  return [...world.chunks.values()];
}

describe('village growth planning', () => {
  it('adds nothing at stage zero', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 0, []);
    expect(plan.placements).toHaveLength(0);
    expect(plan.villagers).toHaveLength(0);
  });

  it('is deterministic for the same village and stage', () => {
    const a = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    const b = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    expect(a.placements).toEqual(b.placements);
    expect(a.villagers).toEqual(b.villagers);
  });

  it('grows differently at different stages', () => {
    const one = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    const two = planGrowth(1, SITE, BASE_Y, 'plains', 2, []);
    expect(one.placements).not.toEqual(two.placements);
  });

  it('builds houses with villagers and chests to fill them', () => {
    const plan = planGrowth(1, SITE, BASE_Y, 'plains', 1, []);
    expect(plan.placements.length).toBeGreaterThan(100);
    expect(plan.villagers.length).toBeGreaterThanOrEqual(1);
    expect(plan.chests.length).toBeGreaterThanOrEqual(1);
  });

  it('never lands a new house on one that is already there', () => {
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const growth = planGrowth(999, SITE, BASE_Y, 'plains', 1, village.buildings);
    for (const marker of growth.villagers) {
      for (const b of village.buildings) {
        const inside =
          marker.x >= b.x0 && marker.x < b.x0 + b.w && marker.z >= b.z0 && marker.z < b.z0 + b.d;
        expect(inside).toBe(false);
      }
    }
  });

  it('leaves the original village alone when it is told what is occupied', () => {
    const village = planVillage(999, SITE, BASE_Y, 'plains');
    const growth = planGrowth(999, SITE, BASE_Y, 'plains', 1, village.buildings);
    // No growth block may sit inside an existing house footprint.
    for (const p of growth.placements) {
      for (const b of village.buildings) {
        const inside = p.x >= b.x0 && p.x < b.x0 + b.w && p.z >= b.z0 && p.z < b.z0 + b.d;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('applying village growth', () => {
  it('writes its buildings into the world', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    let changed = 0;
    for (const chunk of chunksOf(world)) {
      changed += applyGrowth(world, 1, village, chunk, []).changed;
    }
    expect(changed).toBeGreaterThan(50);
  });

  it('changes nothing the second time it runs', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    const editCount = [...world.edits.values()].reduce((n, m) => n + m.size, 0);

    let again = 0;
    for (const chunk of chunksOf(world)) {
      again += applyGrowth(world, 1, village, chunk, []).changed;
    }
    expect(again).toBe(0);
    expect([...world.edits.values()].reduce((n, m) => n + m.size, 0)).toBe(editCount);
  });

  it('records its blocks so they survive a chunk being unloaded', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    const sample = [...world.edits.entries()].find(([, m]) => m.size > 0);
    expect(sample).toBeDefined();
  });

  it('refuses to build over anything the player put there', () => {
    clearGrowthCache();
    const world = grassWorld();
    const village = record(1);
    const plan = growthFor(1, village, 1, []);
    const wall = plan.placements.find((p) => p.b !== Block.AIR);
    expect(wall).toBeDefined();
    if (!wall) return;
    world.setBlock(wall.x, wall.y, wall.z, Block.CHEST);

    for (const chunk of chunksOf(world)) applyGrowth(world, 1, village, chunk, []);
    // The chest is still standing, and only that cell was skipped.
    expect(world.getBlock(wall.x, wall.y, wall.z)).toBe(Block.CHEST);
  });

  it('applies every stage up to the one the village has reached', () => {
    clearGrowthCache();
    const world = grassWorld();
    const one = record(1);
    let single = 0;
    for (const chunk of chunksOf(world)) single += applyGrowth(world, 1, one, chunk, []).changed;

    clearGrowthCache();
    const fresh = grassWorld();
    const two = record(2);
    let both = 0;
    for (const chunk of chunksOf(fresh)) both += applyGrowth(fresh, 1, two, chunk, []).changed;
    expect(both).toBeGreaterThan(single);
  });

  it('lists the chunks its buildings reach into', () => {
    clearGrowthCache();
    const chunks = growthChunks(1, record(1), []);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(Number.isInteger(c.cx)).toBe(true);
      expect(Number.isInteger(c.cz)).toBe(true);
    }
  });
});
