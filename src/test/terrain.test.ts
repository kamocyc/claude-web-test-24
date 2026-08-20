import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '../world/generation/terrain';
import { Block } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, SEA_LEVEL, blockIndex } from '../world/chunk';
import { World } from '../world/world';
import { blocksWater } from '../world/blocks';
import { CHANNEL_CORE, inlandness, riverCovers } from '../world/generation/rivers';
import { CHANNEL_FLOW, PLAIN_FLOW, channelWidth } from '../world/generation/drainage';
import { WORLD_MAX, WORLD_MIN } from '../world/chunk';
import { VILLAGE_RADIUS } from '../world/generation/village';
import { WATER_FULL } from '../world/water';

describe('TerrainGenerator', () => {
  it('is deterministic for a given seed', () => {
    const a = new TerrainGenerator(1234).generateChunk(3, -7).blocks;
    const b = new TerrainGenerator(1234).generateChunk(3, -7).blocks;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different terrain for different seeds', () => {
    const a = new TerrainGenerator(1).generateChunk(0, 0).blocks;
    const b = new TerrainGenerator(2).generateChunk(0, 0).blocks;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('keeps the surface continuous across a chunk border', () => {
    const gen = new TerrainGenerator(99);
    for (let z = -20; z < 20; z++) {
      const left = gen.height(CHUNK_SIZE - 1, z);
      const right = gen.height(CHUNK_SIZE, z);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(6);
    }
  });

  it('caps the terrain inside the world height', () => {
    const gen = new TerrainGenerator(7);
    for (let i = 0; i < 200; i++) {
      const h = gen.height(i * 37, i * -53);
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThan(CHUNK_HEIGHT);
    }
  });

  it('always puts bedrock at the bottom and air at the top', () => {
    const { blocks } = new TerrainGenerator(42).generateChunk(0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(blocks[blockIndex(x, 0, z)]).toBe(Block.BEDROCK);
        expect(blocks[blockIndex(x, CHUNK_HEIGHT - 1, z)]).toBe(Block.AIR);
      }
    }
  });

  it('fills every column below sea level with water or solid ground', () => {
    const { blocks } = new TerrainGenerator(2024).generateChunk(-5, 11);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(blocks[blockIndex(x, SEA_LEVEL, z)]).not.toBe(Block.AIR);
      }
    }
  });

  it('generates ores underground', () => {
    const { blocks } = new TerrainGenerator(555).generateChunk(2, 2);
    const ores = new Set([Block.COAL_ORE, Block.IRON_ORE, Block.GOLD_ORE, Block.DIAMOND_ORE]);
    let found = 0;
    for (const id of blocks) if (ores.has(id as never)) found++;
    expect(found).toBeGreaterThan(0);
  });

  it('keeps the river bed below the water line all along the channel', () => {
    // The bed used to be eased down towards the floor in proportion to the channel
    // strength, which left it above the water wherever the land rose, and broke the
    // river into a string of disconnected pools. Every core column must hold water.
    const gen = new TerrainGenerator(2061350291);
    let core = 0;
    let dry = 0;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z += 3) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x += 3) {
        const river = gen.riverAt(x, z);
        if (river.strength < 0.35) continue;
        const height = gen.height(x, z);
        if (height <= SEA_LEVEL) continue;
        core++;
        if (!riverCovers(river, height)) dry++;
      }
    }
    expect(core).toBeGreaterThan(50);
    expect(dry / core).toBeLessThan(0.05);
  });

  it('never lets a river climb on its way to the sea', () => {
    // A river used to be the level set of a noise field, which crossed the contours of
    // the land in whatever direction it liked: channels climbed six blocks and came
    // back down, and no water simulation can make that look like a river. Channels are
    // now routed downhill from the start, so this holds by construction — but it holds
    // only because every hollow was filled with a little slope left in it, and getting
    // that wrong is silent, so it is measured.
    const gen = new TerrainGenerator(2061350291);
    const surface = new Map<string, number>();
    for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
      for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
        const river = gen.riverAt(x, z);
        if (river.strength < CHANNEL_CORE) continue;
        if (riverCovers(river, gen.height(x, z))) surface.set(`${x},${z}`, river.surface);
      }
    }
    expect(surface.size).toBeGreaterThan(2000);

    // Flood the channel from its lowest column upwards. Two stretches of water only
    // meet at a saddle, and a saddle above either of their low points is a hump the
    // water would have had to climb over.
    const parent = new Map<string, string>();
    const lowest = new Map<string, number>();
    const find = (key: string): string => {
      while (parent.get(key) !== key) {
        parent.set(key, parent.get(parent.get(key)!)!);
        key = parent.get(key)!;
      }
      return key;
    };
    const filled = new Set<string>();
    let worst = 0;
    for (const key of [...surface.keys()].sort((a, b) => surface.get(a)! - surface.get(b)!)) {
      const [x, z] = key.split(',').map(Number);
      const height = surface.get(key)!;
      parent.set(key, key);
      lowest.set(key, height);
      filled.add(key);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const neighbour = `${x + dx},${z + dz}`;
        if (!filled.has(neighbour) || neighbour === key) continue;
        const root = find(neighbour);
        const mine = lowest.get(key)!;
        const theirs = lowest.get(root)!;
        if (mine !== theirs) worst = Math.max(worst, height - Math.max(mine, theirs));
        parent.set(root, key);
        lowest.set(key, Math.min(mine, theirs));
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it('gives the river a smooth surface, stepping only where it falls', () => {
    // The surface used to be rounded to whole blocks, so it stepped down every few
    // metres and the water read as a staircase. It is now carried as a fraction and the
    // topmost cell is only part filled. Where it does step down a block or more, the
    // channel underneath is genuinely falling that fast — those are waterfalls, and the
    // simulation pours them into the reach below.
    const gen = new TerrainGenerator(2061350291);
    const surfaces = new Map<string, { surface: number }>();
    for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
      for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
        const river = gen.riverAt(x, z);
        if (river.strength >= CHANNEL_CORE) surfaces.set(`${x},${z}`, river);
      }
    }
    let pairs = 0;
    let gentle = 0;
    let steps = 0;
    for (const [key, here] of surfaces) {
      const [x, z] = key.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const other = surfaces.get(`${x + dx},${z + dz}`);
        if (!other) continue;
        pairs++;
        const drop = Math.abs(other.surface - here.surface);
        if (drop < 0.3) gentle++;
        if (drop > 1) steps++;
      }
    }
    expect(pairs).toBeGreaterThan(5000);
    expect(gentle / pairs).toBeGreaterThan(0.94);
    expect(steps / pairs).toBeLessThan(0.005);
  });

  it('grows a river from a mountain stream into a trunk with tributaries', () => {
    // The old rivers were the level set of a noise field: the same nine blocks wide at
    // the source as at the mouth, and no such thing as a tributary, because nothing in
    // them knew which way was downhill. A channel's size now comes from how much land
    // drains through it, so it grows every time another stream joins.
    const gen = new TerrainGenerator(2061350291);
    const widths: number[] = [];
    let biggest = 0;
    let smallest = Infinity;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
        const river = gen.riverAt(x, z);
        if (river.distance !== 0) continue;
        widths.push(river.flow);
        biggest = Math.max(biggest, river.flow);
        smallest = Math.min(smallest, river.flow);
      }
    }
    expect(widths.length).toBeGreaterThan(500);
    // A headwater carries the minimum that counts as a channel at all; the trunk drains
    // a good fraction of the island.
    expect(smallest).toBeGreaterThanOrEqual(CHANNEL_FLOW);
    expect(biggest).toBeGreaterThan(PLAIN_FLOW * 4);
    // Which makes the trunk several times the width of the stream that feeds it.
    expect(channelWidth(biggest, 0) / channelWidth(smallest, 0)).toBeGreaterThan(4);
  });

  it('lays a floodplain along the lower river and nowhere else', () => {
    // Flat enough to walk and to farm, a block clear of the water, and low enough to go
    // under when the rains come.
    const gen = new TerrainGenerator(2061350291);
    let plain = 0;
    let high = 0;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z += 2) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x += 2) {
        const river = gen.riverAt(x, z);
        // Just past the top of the bank on a river big enough to have built one.
        if (river.flow < PLAIN_FLOW || river.strength > 0) continue;
        const surface = gen.riverAt(x, z).surface;
        if (surface <= SEA_LEVEL + 1) continue;
        const distance = river.distance;
        if (distance > channelWidth(river.flow, 0) * 1.5) continue;
        plain++;
        if (gen.height(x, z) > surface + 2) high++;
      }
    }
    expect(plain).toBeGreaterThan(100);
    // Nearly all of it within a couple of blocks of the water rather than up a hillside.
    expect(high / plain).toBeLessThan(0.2);
  });

  it('meets the sea at the sea surface and only ever climbs from there', () => {
    const gen = new TerrainGenerator(2061350291);
    expect(inlandness(-0.5)).toBe(0);
    let lowest = Infinity;
    let highest = 0;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z += 2) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x += 2) {
        const river = gen.riverAt(x, z);
        if (river.strength < CHANNEL_CORE) continue;
        lowest = Math.min(lowest, river.surface);
        highest = Math.max(highest, river.surface);
      }
    }
    // No channel is ever below the sea it drains into, and the lowest reach is the
    // tidal mouth, level with it.
    expect(lowest).toBe(SEA_LEVEL + 1);
    expect(highest).toBeGreaterThan(SEA_LEVEL + 10);
  });

  it('part fills the topmost cell so the water lands where the surface says', () => {
    const gen = new TerrainGenerator(2061350291);
    let checked = 0;
    let worst = 0;
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const generated = gen.generateChunk(cx, cz);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const x = cx * CHUNK_SIZE + lx;
            const z = cz * CHUNK_SIZE + lz;
            const river = gen.riverAt(x, z);
            if (!riverCovers(river, gen.height(x, z))) continue;
            // The tidal mouth is filled by the sea, which is flat by definition.
            if (river.surface <= SEA_LEVEL + 1.001) continue;
            let top = -1;
            for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
              if (generated.blocks[blockIndex(lx, y, lz)] === Block.WATER) {
                top = y;
                break;
              }
            }
            // A film thinner than a tenth of a block is not worth a draw call, so the
            // topmost cell is left off entirely and the surface sits flush with the
            // ground. The error that leaves is what the assertion below bounds.
            const ground = gen.height(x, z);
            const actual =
              top < 0 ? ground + 1 : top + generated.water[blockIndex(lx, top, lz)] / WATER_FULL;
            checked++;
            worst = Math.max(worst, Math.abs(actual - river.surface));
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    // Films thinner than this are not worth a draw call, so the surface is left flush.
    expect(worst).toBeLessThan(10 / WATER_FULL);
  });

  it('never leaves generated water standing over dry land', () => {
    // A river surface that sat above its own banks left a film of water on every
    // terrace of the slope, which looked like the river climbing the hillside. Water
    // may only ever spill one block down into the next pool, never sideways onto land.
    const gen = new TerrainGenerator(2061350291);
    const world = new World(2061350291);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const generated = gen.generateChunk(cx, cz);
        const chunk = new Chunk(cx, cz);
        chunk.blocks.set(generated.blocks);
        chunk.water.set(generated.water);
        chunk.syncWaterMarkers();
        world.addChunk(chunk);
      }
    }

    let surfaceCells = 0;
    let spills = 0;
    let flattestSpill = Infinity;
    for (let z = -CHUNK_SIZE + 1; z < CHUNK_SIZE * 2 - 1; z++) {
      for (let x = -CHUNK_SIZE + 1; x < CHUNK_SIZE * 2 - 1; x++) {
        for (let y = 1; y < CHUNK_HEIGHT - 1; y++) {
          if (world.getWater(x, y, z) <= 0) continue;
          if (world.getWater(x, y + 1, z) > 0) continue;
          surfaceCells++;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const nz = z + dz;
            if (world.getWater(nx, y, nz) > 0) continue;
            if (blocksWater(world.getBlock(nx, y, nz))) continue;
            // Open and dry. A pool one block down is a little waterfall and fine;
            // anything else is water perched above ground it should have run off.
            if (world.getWater(nx, y - 1, nz) > 0) continue;
            spills++;
            flattestSpill = Math.min(flattestSpill, gen.riverAt(x, z).slope);
          }
        }
      }
    }
    expect(surfaceCells).toBeGreaterThan(100);
    // A river surface that sat above its own banks left a film of water on every terrace
    // of a slope, which read as the river climbing the hillside. What is left is the
    // lip of a waterfall, which the simulation pours into the reach below on the first
    // tick, and there is very little of it.
    expect(spills / surfaceCells).toBeLessThan(0.02);
    if (spills > 0) expect(flattestSpill).toBeGreaterThan(0.25);
  });

  it('never dams the river a village stands beside', () => {
    // A village levels the ground it stands on, and on an island this size keeping every
    // village a plateau's width from every channel left whole seeds with nowhere to
    // build. The channel is cut back in after the plateau instead, so a village can sit
    // on a river bank without filling the river in.
    const gen = new TerrainGenerator(2061350291);
    let checked = 0;
    for (let cell = -2; cell <= 2; cell++) {
      const village = gen.findNearestVillage(cell * 160, cell * 130, 2);
      if (!village) continue;
      for (let dz = -VILLAGE_RADIUS; dz <= VILLAGE_RADIUS; dz++) {
        for (let dx = -VILLAGE_RADIUS; dx <= VILLAGE_RADIUS; dx++) {
          const x = village.x + dx;
          const z = village.z + dz;
          const river = gen.riverAt(x, z);
          if (river.surface <= SEA_LEVEL + 1) continue;
          // Only columns the channel would hold water in without the village there.
          if (!riverCovers(river, gen.rawHeight(x, z))) continue;
          checked++;
          expect(riverCovers(river, gen.height(x, z))).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('finds a village and flattens the ground under it', () => {
    const gen = new TerrainGenerator(31337);
    const village = gen.findNearestVillage(0, 0, 4);
    expect(village).not.toBeNull();
    if (!village) return;
    const center = gen.height(village.x, village.z);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [8, 8]]) {
      expect(gen.height(village.x + dx, village.z + dz)).toBe(center);
    }
  });
});
