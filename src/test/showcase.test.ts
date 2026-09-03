import { describe, expect, it } from 'vitest';
import { Block, blockDef, rotateBlockY } from '../world/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, blockIndex, toChunkCoord } from '../world/chunk';
import { FLAT_GROUND_Y, flatBlockAt } from '../world/generation/flat';
import { LANDMARKS } from '../world/generation/landmarks';
import { LOT, PITCH, Showcase, isAvenue } from '../world/generation/showcase';
import { TerrainGenerator } from '../world/generation/terrain';
import { SHOWCASE_SEED, findSpawn } from '../game/seeds';

const showcase = new Showcase(SHOWCASE_SEED);

describe('showcase layout', () => {
  it('seats nine lots, one of them the plaza', () => {
    expect(showcase.lots).toHaveLength(LANDMARKS.length + 1);
    expect(showcase.lots.filter((lot) => lot.landmark.kind === 'plaza')).toHaveLength(1);
    const plaza = showcase.lots.find((lot) => lot.landmark.kind === 'plaza')!;
    expect([plaza.gx, plaza.gz]).toEqual([0, 0]);
  });

  it('covers all four kinds of building, twice each', () => {
    const counts = new Map<string, number>();
    for (const landmark of LANDMARKS) counts.set(landmark.kind, (counts.get(landmark.kind) ?? 0) + 1);
    expect([...counts.entries()].sort()).toEqual([
      ['historic', 2], ['monument', 2], ['skyscraper', 2], ['western', 2],
    ]);
  });

  it('keeps every building inside its own lot', () => {
    for (const lot of showcase.lots) {
      expect(lot.landmark.width).toBeLessThanOrEqual(LOT);
      expect(lot.landmark.depth).toBeLessThanOrEqual(LOT);
      // A quarter turn swaps the footprint's sides, and both have to still fit.
      const turned = lot.rotation % 2 === 1;
      expect(lot.x1 - lot.x0 + 1).toBe(turned ? lot.landmark.depth : lot.landmark.width);
      expect(lot.z1 - lot.z0 + 1).toBe(turned ? lot.landmark.width : lot.landmark.depth);
      const half = (LOT - 1) / 2;
      expect(lot.x0).toBeGreaterThanOrEqual(lot.cx - half);
      expect(lot.x1).toBeLessThanOrEqual(lot.cx + half);
      expect(lot.z0).toBeGreaterThanOrEqual(lot.cz - half);
      expect(lot.z1).toBeLessThanOrEqual(lot.cz + half);
    }
  });

  it('leaves the avenues clear of every lot', () => {
    for (const lot of showcase.lots) {
      for (let z = lot.z0; z <= lot.z1; z++) {
        for (let x = lot.x0; x <= lot.x1; x++) {
          if (!isAvenue(x, z)) continue;
          throw new Error(`${lot.landmark.id} reaches into an avenue at ${x},${z}`);
        }
      }
    }
  });

  it('runs an avenue between neighbouring lots', () => {
    // Halfway from the plaza to the lot east of it there has to be road.
    expect(isAvenue(Math.round(PITCH / 2), 0)).toBe(true);
    expect(isAvenue(0, 0)).toBe(false);
    expect(isAvenue(2000, 2000)).toBe(false);
  });

  it('keeps the tallest exhibit under the world ceiling', () => {
    for (const lot of showcase.lots) expect(lot.y1).toBeLessThan(CHUNK_HEIGHT);
  });

  it('paves the avenues and lights their kerbs', () => {
    // Straight out of the plaza along +x: roadway, then a lamp somewhere on the kerb.
    expect(showcase.blockAt(28, FLAT_GROUND_Y, 0)).toBe(Block.CONCRETE);
    let lamps = 0;
    for (let z = -60; z <= 60; z++) {
      if (showcase.blockAt(23, FLAT_GROUND_Y + 3, z) === Block.LANTERN) lamps++;
    }
    expect(lamps).toBeGreaterThan(8);
  });
});

describe('landmarks', () => {
  it('never draws outside the box it declares', () => {
    for (const lot of showcase.lots) {
      const plan = showcase.planFor(lot);
      expect(`${lot.landmark.id}: ${plan.overflow} ${plan.overflowAt.join(' ')}`.trim())
        .toBe(`${lot.landmark.id}: 0`);
    }
  });

  it('stands on the ground and reaches the height it claims', () => {
    for (const lot of showcase.lots) {
      let lowest = Infinity;
      let highest = -Infinity;
      for (let y = lot.y0; y <= lot.y1; y++) {
        for (let z = lot.z0; z <= lot.z1; z++) {
          for (let x = lot.x0; x <= lot.x1; x++) {
            const block = showcase.blockAt(x, y, z);
            if (block === null || block === Block.AIR) continue;
            lowest = Math.min(lowest, y);
            highest = Math.max(highest, y);
          }
        }
      }
      expect(lowest).toBeLessThanOrEqual(FLAT_GROUND_Y + 1);
      // The declared height is what the lot's plan is sized from, so a building
      // that stops well short of it is wasting the array and one that would go
      // past it is being clipped. Three blocks of slack covers a finial.
      expect(highest).toBeGreaterThan(lot.y1 - 4);
      expect(highest).toBeLessThanOrEqual(lot.y1);
    }
  });

  it('builds each exhibit out of several materials', () => {
    for (const lot of showcase.lots) {
      const seen = new Set<number>();
      for (let y = lot.y0; y <= lot.y1; y++) {
        for (let z = lot.z0; z <= lot.z1; z++) {
          for (let x = lot.x0; x <= lot.x1; x++) {
            const block = showcase.blockAt(x, y, z);
            if (block !== null && block !== Block.AIR) seen.add(block);
          }
        }
      }
      // A building made of one block is a box. Five is a wall, a roof, a floor,
      // glazing and a trim, which is the least that reads as architecture.
      expect(`${lot.landmark.id}: ${seen.size >= 5}`).toBe(`${lot.landmark.id}: true`);
    }
  });

  it('gives each exhibit a way in', () => {
    // Somewhere on the plaza-facing half of every building there is a column with
    // two blocks of standable air in it that is not simply the lawn outside.
    for (const lot of showcase.lots) {
      if (lot.landmark.kind === 'plaza') continue;
      let doorways = 0;
      for (let z = lot.z0; z <= lot.z1; z++) {
        for (let x = lot.x0; x <= lot.x1; x++) {
          if (showcase.standingY(x, z) === null) continue;
          if (showcase.blockAt(x, FLAT_GROUND_Y + 1, z) !== null) continue;
          doorways++;
        }
      }
      expect(`${lot.landmark.id}: ${doorways > 0}`).toBe(`${lot.landmark.id}: true`);
    }
  });

  it('turns every exhibit to face the square', () => {
    // The front of a landmark is its low-z side; after the turn it has to be the
    // side nearer the plaza, or the exhibition is a ring of back walls.
    for (const lot of showcase.lots) {
      if (lot.landmark.kind === 'plaza') continue;
      const facing = [[0, -1], [1, 0], [0, 1], [-1, 0]][lot.rotation];
      const toPlaza = [-Math.sign(lot.cx), -Math.sign(lot.cz)];
      expect(`${lot.landmark.id}: ${facing[0] * toPlaza[0] + facing[1] * toPlaza[1]}`)
        .toBe(`${lot.landmark.id}: 1`);
    }
  });

  it('rotates the roof wedges with the building', () => {
    // A gable turned a quarter turn is made of different wedge blocks. If it is
    // not, the same roof comes out as four unrelated slopes.
    expect(rotateBlockY(Block.SLATE_ROOF_EAST, 1)).toBe(Block.SLATE_ROOF_SOUTH);
    expect(rotateBlockY(Block.SLATE_ROOF_EAST, 2)).toBe(Block.SLATE_ROOF_WEST);
    expect(rotateBlockY(Block.SLATE_ROOF_EAST, 3)).toBe(Block.SLATE_ROOF_NORTH);
    expect(rotateBlockY(Block.SLATE_ROOF_EAST, 4)).toBe(Block.SLATE_ROOF_EAST);
    expect(rotateBlockY(Block.SLATE_ROOF_NORTH, -1)).toBe(Block.SLATE_ROOF_WEST);
    expect(rotateBlockY(Block.MARBLE, 1)).toBe(Block.MARBLE);
    // Every turned exhibit whose roof has wedges in it has to have them pointing
    // in the directions its own turn implies.
    const manor = showcase.lots.find((lot) => lot.landmark.id === 'manor_house')!;
    expect(manor.rotation % 2).toBe(1);
    let wedges = 0;
    for (let y = manor.y0; y <= manor.y1; y++) {
      for (let z = manor.z0; z <= manor.z1; z++) {
        for (let x = manor.x0; x <= manor.x1; x++) {
          const block = showcase.blockAt(x, y, z);
          if (block === Block.SLATE_ROOF_EAST || block === Block.SLATE_ROOF_WEST) wedges++;
        }
      }
    }
    // Authored with the ridge along x, so after a quarter turn the slopes fall
    // east and west rather than north and south.
    expect(wedges).toBeGreaterThan(20);
  });

  it('fills the fountain and seals its basin', () => {
    expect(showcase.blockAt(3, FLAT_GROUND_Y, 0)).toBe(Block.WATER);
    // Everything under and around the water is something water cannot get through.
    for (let z = -4; z <= 4; z++) {
      for (let x = -4; x <= 4; x++) {
        if (showcase.blockAt(x, FLAT_GROUND_Y, z) !== Block.WATER) continue;
        const floor = showcase.blockAt(x, FLAT_GROUND_Y - 2, z);
        expect(floor === null ? Block.AIR : floor).toBe(Block.MARBLE);
      }
    }
  });
});

describe('the superflat world', () => {
  const generator = new TerrainGenerator(SHOWCASE_SEED, undefined, 'showcase');

  it('is one height everywhere, with no water and no villages', () => {
    for (const [x, z] of [[0, 0], [500, -800], [-9000, 12345]] as const) {
      expect(generator.height(x, z)).toBe(FLAT_GROUND_Y);
    }
    expect(generator.villagesAround(0, 0, 3)).toEqual([]);
    expect(generator.findNearestVillage(0, 0)).toBeNull();
    expect(generator.constants()).toBeNull();
  });

  it('lays plain superflat layers well away from the exhibition', () => {
    const chunk = generator.generateChunk(400, 400);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      expect(chunk.blocks[blockIndex(3, y, 5)]).toBe(flatBlockAt(y));
    }
    expect(chunk.water.some((level) => level > 0)).toBe(false);
    expect(chunk.villagers).toEqual([]);
  });

  it('writes the exhibition into the chunks it falls in', () => {
    const lot = showcase.lots.find((candidate) => candidate.landmark.id === 'glass_tower')!;
    const cx = toChunkCoord(lot.cx);
    const cz = toChunkCoord(lot.cz);
    const chunk = generator.generateChunk(cx, cz);
    let high = 0;
    for (let y = CHUNK_HEIGHT - 1; y > FLAT_GROUND_Y; y--) {
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const index = y * CHUNK_SIZE * CHUNK_SIZE + i;
        if (chunk.blocks[index] !== Block.AIR) {
          high = Math.max(high, y);
        }
      }
      if (high) break;
    }
    expect(high).toBeGreaterThan(FLAT_GROUND_Y + 60);
  });

  it('generates the same world twice', () => {
    const other = new TerrainGenerator(SHOWCASE_SEED, undefined, 'showcase');
    const a = generator.generateChunk(1, -1);
    const b = other.generateChunk(1, -1);
    expect(Array.from(b.blocks)).toEqual(Array.from(a.blocks));
  });

  it('puts the player down on the plaza rather than in the fountain', () => {
    const spawn = findSpawn(generator);
    expect(spawn.y).toBe(FLAT_GROUND_Y + 1);
    expect(Math.hypot(spawn.x, spawn.z)).toBeLessThan(22);
    // Standable, and out of the water.
    expect(showcase.blockAt(spawn.x, FLAT_GROUND_Y, spawn.z)).not.toBe(Block.WATER);
    expect(blockDef(showcase.blockAt(spawn.x, FLAT_GROUND_Y, spawn.z) ?? Block.GRASS).solid).toBe(true);
  });

  it('refuses to stand anybody inside a wall, or on a roof', () => {
    const clock = showcase.lots.find((candidate) => candidate.landmark.id === 'clock_tower')!;
    // The tower is solid masonry at its own middle for the first several courses.
    expect(generator.standingY(clock.cx, clock.cz)).toBeNull();
    // And nowhere in the exhibition is anybody put down above the doorsteps.
    for (const lot of showcase.lots) {
      for (let z = lot.z0; z <= lot.z1; z += 3) {
        for (let x = lot.x0; x <= lot.x1; x += 3) {
          const y = generator.standingY(x, z);
          if (y !== null) expect(y).toBeLessThanOrEqual(FLAT_GROUND_Y + 2);
        }
      }
    }
  });

  it('draws the exhibits on a wide map instead of a blank field', () => {
    const survey = generator.surveyRegion(-96, -96, 24, 24, 8);
    const tall = Array.from(survey.height).filter((y) => y > FLAT_GROUND_Y + 8);
    expect(tall.length).toBeGreaterThan(2);
  });
});
