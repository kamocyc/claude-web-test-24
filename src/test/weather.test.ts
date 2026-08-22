import { describe, expect, it } from 'vitest';
import {
  CYCLE_LENGTH_SECONDS,
  MAX_TRAVEL_SECONDS,
  SEASON_LENGTH_SECONDS,
  forecastAt,
  localWetness,
  seasonAt,
  travelDelay,
  wetnessAt,
} from '../world/weather';
import { DAY_LENGTH_SECONDS } from '../game/daycycle';
import { RIVER_DROUGHT, RIVER_FLOOD, levelOffset, riverCovers } from '../world/generation/rivers';
import { TerrainGenerator } from '../world/generation/terrain';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk } from '../world/chunk';
import { World } from '../world/world';
import { blocksWater } from '../world/blocks';

const SEED = 2061350291;

describe('weather', () => {
  it('runs a season every half day', () => {
    expect(SEASON_LENGTH_SECONDS * 2).toBe(DAY_LENGTH_SECONDS);
    expect(CYCLE_LENGTH_SECONDS).toBe(SEASON_LENGTH_SECONDS * 4);
  });

  it('always brings the seasons round in the same order', () => {
    const kinds = [0, 1, 2, 3, 4, 5].map(
      (i) => seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).kind,
    );
    expect(kinds).toEqual(['normal', 'rain', 'normal', 'drought', 'normal', 'rain']);
    // A drought is never a surprise: the season before one is always calm.
    for (let i = 0; i < 12; i++) {
      const here = seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).kind;
      const next = seasonAt(SEED, (i + 1.5) * SEASON_LENGTH_SECONDS).kind;
      if (next !== 'normal') expect(here).toBe('normal');
    }
  });

  it('varies how hard a season bites, but not for a given seed', () => {
    const at = (i: number) => seasonAt(SEED, (i + 0.5) * SEASON_LENGTH_SECONDS).intensity;
    expect(at(3)).toBe(at(3));
    expect(at(3)).not.toBe(at(7));
    for (let i = 0; i < 20; i++) {
      expect(at(i)).toBeGreaterThanOrEqual(0.55);
      expect(at(i)).toBeLessThanOrEqual(1);
    }
  });

  it('starts calm and moves the water gradually', () => {
    expect(wetnessAt(SEED, 0)).toBe(0);
    expect(wetnessAt(SEED, -500)).toBe(0);
    let previous = 0;
    let biggestJump = 0;
    let driest = 0;
    let wettest = 0;
    for (let t = 0; t <= CYCLE_LENGTH_SECONDS * 2; t += 1) {
      const wetness = wetnessAt(SEED, t);
      expect(wetness).toBeGreaterThanOrEqual(-1);
      expect(wetness).toBeLessThanOrEqual(1);
      biggestJump = Math.max(biggestJump, Math.abs(wetness - previous));
      driest = Math.min(driest, wetness);
      wettest = Math.max(wettest, wetness);
      previous = wetness;
    }
    // No step change anywhere: the level has to creep, not jump.
    expect(biggestJump).toBeLessThan(0.01);
    expect(driest).toBeLessThan(-0.5);
    expect(wettest).toBeGreaterThan(0.5);
    // Every season boundary passes through calm water.
    for (let i = 0; i <= 8; i++) {
      expect(wetnessAt(SEED, i * SEASON_LENGTH_SECONDS)).toBeCloseTo(0, 6);
    }
  });

  it('takes minutes for the headwaters to reach the sea', () => {
    expect(travelDelay(1)).toBe(0);
    expect(travelDelay(0)).toBe(MAX_TRAVEL_SECONDS);
    expect(travelDelay(0.5)).toBe(MAX_TRAVEL_SECONDS / 2);

    const t = SEASON_LENGTH_SECONDS * 3.5;
    // The mouth of the river is still living in the past.
    expect(localWetness(SEED, t, 1)).toBe(wetnessAt(SEED, t));
    expect(localWetness(SEED, t, 0)).toBe(wetnessAt(SEED, t - MAX_TRAVEL_SECONDS));
    expect(localWetness(SEED, t, 0)).not.toBe(localWetness(SEED, t, 1));
    // And it catches up exactly when the water arrives.
    expect(localWetness(SEED, t + MAX_TRAVEL_SECONDS, 0)).toBe(localWetness(SEED, t, 1));
  });

  it('tells the player what is coming and how long they have', () => {
    // A drought is in full swing upstream; downstream is still in the calm season
    // before it, which is the whole point of the mechanic.
    const t = SEASON_LENGTH_SECONDS * 3.1;
    const head = forecastAt(SEED, t, 1);
    const mouth = forecastAt(SEED, t, 0);
    expect(head.here.kind).toBe('drought');
    expect(head.delay).toBe(0);
    expect(mouth.here.kind).toBe('normal');
    expect(mouth.next).toBe('drought');
    expect(mouth.upstream).toBe('drought');
    expect(mouth.delay).toBe(MAX_TRAVEL_SECONDS);
    expect(mouth.here.endsIn).toBeGreaterThan(0);
    expect(mouth.here.endsIn).toBeLessThanOrEqual(SEASON_LENGTH_SECONDS);
  });

  it('drops the water further than it lifts it', () => {
    expect(levelOffset(0)).toBe(0);
    expect(levelOffset(1)).toBe(RIVER_FLOOD);
    expect(levelOffset(-1)).toBe(-RIVER_DROUGHT);
    // Rain has to stay inside the block of clearance the bank is carved to leave.
    expect(RIVER_FLOOD).toBeLessThan(1);
    let previous = -Infinity;
    for (let w = -1; w <= 1; w += 0.05) {
      const offset = levelOffset(w);
      expect(offset).toBeGreaterThan(previous);
      previous = offset;
    }
  });
});

describe('rivers through the seasons', () => {
  it('leaves water in the channel through the worst drought', () => {
    const gen = new TerrainGenerator(SEED);
    let core = 0;
    let dry = 0;
    for (let z = -450; z < 450; z += 6) {
      for (let x = -450; x < 450; x += 6) {
        const river = gen.riverAt(x, z);
        if (river.strength < 0.9) continue;
        const height = gen.height(x, z);
        if (height <= 46) continue;
        core++;
        if (!riverCovers(river, height, -RIVER_DROUGHT)) dry++;
      }
    }
    expect(core).toBeGreaterThan(20);
    // The middle of the channel keeps its water; only the margins dry out.
    expect(dry).toBe(0);
  });

  it('never spills over the bank, whatever the weather', () => {
    const gen = new TerrainGenerator(SEED);
    let checked = 0;
    for (let step = 0; step < 8; step++) {
      gen.weatherSeconds = (step / 8) * CYCLE_LENGTH_SECONDS;
      const world = new World(SEED);
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
      for (let z = -CHUNK_SIZE + 1; z < CHUNK_SIZE * 2 - 1; z++) {
        for (let x = -CHUNK_SIZE + 1; x < CHUNK_SIZE * 2 - 1; x++) {
          for (let y = 1; y < CHUNK_HEIGHT - 1; y++) {
            if (world.getWater(x, y, z) <= 0) continue;
            if (world.getWater(x, y + 1, z) > 0) continue;
            checked++;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              if (world.getWater(x + dx, y, z + dz) > 0) continue;
              if (blocksWater(world.getBlock(x + dx, y, z + dz))) continue;
              // Open and dry beside the water: only a drop into a lower pool is allowed.
              expect(world.getWater(x + dx, y - 1, z + dz)).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('moves the water level with the season', () => {
    const gen = new TerrainGenerator(SEED);
    const river = gen.riverAt(6, -10);
    expect(river.strength).toBeGreaterThan(0.5);

    gen.weatherSeconds = 0;
    const calm = gen.riverSurfaceNow(river);
    expect(calm).toBe(river.surface);

    // Peak drought, sampled late enough that it has reached this column.
    gen.weatherSeconds = SEASON_LENGTH_SECONDS * 3.5 + travelDelay(river.inland);
    const low = gen.riverSurfaceNow(river);
    gen.weatherSeconds = SEASON_LENGTH_SECONDS * 1.5 + travelDelay(river.inland);
    const high = gen.riverSurfaceNow(river);

    expect(low).toBeLessThan(calm - 0.9);
    expect(high).toBeGreaterThan(calm + 0.4);
    expect(low).toBeGreaterThan(calm - RIVER_DROUGHT - 0.001);
    expect(high).toBeLessThan(calm + RIVER_FLOOD + 0.001);
  });
});
