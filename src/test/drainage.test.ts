import { describe, expect, it } from 'vitest';
import { SEA_LEVEL, WORLD_MAX, WORLD_MIN } from '../world/chunk';
import {
  CHANNEL_FLOW,
  Drainage,
  channelDepth,
  channelWidth,
  insideWorldColumn,
} from '../world/generation/drainage';

/** A lumpy island: a cone falling to the sea, with enough bumps on it to make hollows
 *  the flood has to fill and enough valleys for the flow to find. */
function island(x: number, z: number): number {
  const away = Math.hypot(x, z) / 170;
  const bumps =
    Math.sin(x * 0.05) * Math.cos(z * 0.043) * 3 +
    Math.sin((x + z) * 0.017) * 5 +
    Math.cos(x * 0.011 - z * 0.013) * 6;
  return SEA_LEVEL + 34 * (1 - away * away) + bumps;
}

const NEIGHBOURS = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
] as const;

describe('Drainage', () => {
  const drainage = new Drainage(island);

  it('leaves every hollow with a way out', () => {
    // Filling a hollow to exactly its rim makes it dead flat, and a flat has no downhill
    // neighbour to send water to: the flow routing stalls and the largest catchment on
    // the island comes out two orders of magnitude too small. Every filled cell is lifted
    // a hair above its outlet instead, so there is always somewhere to go.
    let stuck = 0;
    let land = 0;
    for (let z = WORLD_MIN + 1; z < WORLD_MAX; z++) {
      for (let x = WORLD_MIN + 1; x < WORLD_MAX; x++) {
        if (island(x, z) < SEA_LEVEL) continue;
        land++;
        const here = drainage.filledAt(x, z);
        const escapes = NEIGHBOURS.some(([dx, dz]) => drainage.filledAt(x + dx, z + dz) < here);
        if (!escapes) stuck++;
      }
    }
    expect(land).toBeGreaterThan(10000);
    expect(stuck).toBe(0);
  });

  it('never lets the filled land dip below the ground it covers', () => {
    for (let z = WORLD_MIN; z <= WORLD_MAX; z += 7) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x += 7) {
        expect(drainage.filledAt(x, z)).toBeGreaterThanOrEqual(island(x, z) - 1e-4);
      }
    }
  });

  it('gathers more water the further downstream it goes', () => {
    // Each cell hands its catchment to its steepest downhill neighbour, so a cell can
    // never carry more than the one it drains into.
    let checked = 0;
    for (let z = WORLD_MIN + 1; z < WORLD_MAX; z++) {
      for (let x = WORLD_MIN + 1; x < WORLD_MAX; x++) {
        if (island(x, z) < SEA_LEVEL) continue;
        const here = drainage.filledAt(x, z);
        let best: [number, number] | null = null;
        let steepest = 0;
        for (const [dx, dz] of NEIGHBOURS) {
          if (!insideWorldColumn(x + dx, z + dz)) continue;
          const slope = (here - drainage.filledAt(x + dx, z + dz)) / Math.hypot(dx, dz);
          if (slope > steepest) {
            steepest = slope;
            best = [x + dx, z + dz];
          }
        }
        if (!best) continue;
        checked++;
        expect(drainage.flowAt(best[0], best[1])).toBeGreaterThan(drainage.flowAt(x, z));
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('grows a channel as its tributaries join it', () => {
    let biggest = 0;
    let cells = 0;
    for (let z = WORLD_MIN; z <= WORLD_MAX; z++) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x++) {
        const flow = drainage.flowAt(x, z);
        if (island(x, z) < SEA_LEVEL || flow < CHANNEL_FLOW) continue;
        cells++;
        biggest = Math.max(biggest, flow);
      }
    }
    expect(cells).toBeGreaterThan(200);
    // This island is a cone, so its rivers run radially and none of them ever gathers
    // more than a wedge of it; a real seed's trunk drains far more than this. Even so
    // the trunk is several times the width of the streams that feed it, which is the
    // thing a level set of noise could never do.
    expect(biggest).toBeGreaterThan(CHANNEL_FLOW * 4);
    expect(channelWidth(biggest, 0)).toBeGreaterThan(channelWidth(CHANNEL_FLOW, 0) * 1.4);
    expect(channelDepth(biggest, 0)).toBeGreaterThan(channelDepth(CHANNEL_FLOW, 0) * 1.4);
  });

  it('puts a spring at the head of a stream and nowhere else', () => {
    expect(drainage.springs.length).toBeGreaterThan(4);
    for (const spring of drainage.springs) {
      const flow = drainage.flowAt(spring.x, spring.z);
      expect(flow).toBeGreaterThanOrEqual(CHANNEL_FLOW);
      // Nothing upstream of it is a channel: this is where the water starts.
      for (const [dx, dz] of NEIGHBOURS) {
        const upstream = drainage.flowAt(spring.x + dx, spring.z + dz);
        if (upstream < flow) expect(upstream).toBeLessThan(CHANNEL_FLOW);
      }
    }
  });

  it('sizes a channel from what drains through it, not from where it is', () => {
    expect(channelWidth(CHANNEL_FLOW, 0)).toBeLessThan(channelWidth(CHANNEL_FLOW * 9, 0));
    // A steep reach runs narrow and deep rather than lying across the hillside.
    expect(channelWidth(CHANNEL_FLOW * 9, 1)).toBeLessThan(channelWidth(CHANNEL_FLOW * 9, 0));
    expect(channelDepth(CHANNEL_FLOW * 9, 1)).toBeGreaterThan(channelDepth(CHANNEL_FLOW * 9, 0));
  });
});
