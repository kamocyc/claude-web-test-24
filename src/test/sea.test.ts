import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../world/chunk';
import { HARBOUR_REACH, MIN_DEPTH, MIN_MARGIN, SEA_STEP, SeaLanes, WATERLINE, type SeaWorld } from '../game/sea';

/** A world made of a rule rather than of blocks. Everything here is deep water unless the
 *  rule says otherwise, which is the shape of coast each test wants. */
function world(land: (x: number, z: number) => boolean): SeaWorld {
  return { heightAt: (x, z) => (land(x, z) ? SEA_LEVEL + 6 : SEA_LEVEL - 8) };
}

const OPEN = world(() => false);

/** Every cell the lane passes through, at the lattice it was searched on. A lane is a
 *  polyline with the straight bits taken out, so this is what checks the water is there
 *  between the corners as well as at them. */
function cellsAlong(points: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / SEA_STEP));
    for (let s = 0; s <= steps; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    }
  }
  return out;
}

describe('sea lanes', () => {
  it('crosses open water in something close to a straight line', () => {
    const sea = new SeaLanes(OPEN);
    const lane = sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 });
    expect(lane).not.toBeNull();
    expect(lane!.length).toBeGreaterThan(380);
    // A detour of a few percent is the lattice, not a route round anything.
    expect(lane!.length).toBeLessThan(400 * 1.1);
    for (const point of lane!.points) expect(point.y).toBe(WATERLINE);
  });

  it('will not sail through land', () => {
    // A wall from horizon to horizon. There is no way round it, and no lane.
    const sea = new SeaLanes(world((x) => Math.abs(x - 200) < 12));
    expect(sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 })).toBeNull();
  });

  it('goes round a headland rather than through it', () => {
    // The same wall with a gap in it well to the north.
    const gap = { from: 120, to: 180 };
    const sea = new SeaLanes(
      world((x, z) => Math.abs(x - 200) < 12 && !(z > gap.from && z < gap.to)),
    );
    const lane = sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 });
    expect(lane).not.toBeNull();
    // It has to have gone up to the gap and back, so it is a good deal longer than the
    // straight line — and every point of it is still water.
    expect(lane!.length).toBeGreaterThan(500);
    const wet = cellsAlong(lane!.points).every(
      (at) => !(Math.abs(at.x - 200) < 12 && !(at.z > gap.from && at.z < gap.to)),
    );
    expect(wet, 'the lane crossed the headland').toBe(true);
  });

  it('does not put a port inland', () => {
    // Land everywhere within reach of the stop, water beyond it.
    const sea = new SeaLanes(world((x, z) => Math.hypot(x, z) < HARBOUR_REACH * 2));
    expect(sea.harbourAt({ x: 0, y: 40, z: 0 })).toBeNull();
    expect(sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 })).toBeNull();
  });

  it('will not sail the shallows', () => {
    // A shelf one block under the surface: water, and not water a ship can use.
    const shallow: SeaWorld = { heightAt: () => SEA_LEVEL - (MIN_DEPTH - 1) };
    const sea = new SeaLanes(shallow);
    expect(sea.harbourAt({ x: 0, y: 40, z: 0 })).toBeNull();
  });

  it('threads a channel whose edges are shallower than its middle', () => {
    // What a real coast looks like: draught down the middle of the channel and a foot of
    // water either side of it. Demanding the full depth at every sample refuses this, and
    // a boat can plainly sail it.
    const sea = new SeaLanes({
      heightAt: (_x, z) =>
        Math.abs(z) <= SEA_STEP ? SEA_LEVEL - MIN_DEPTH : SEA_LEVEL - MIN_MARGIN,
    });
    const lane = sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 200, y: 40, z: 0 });
    expect(lane).not.toBeNull();
    expect(lane!.points.every((at) => Math.abs(at.z) <= SEA_STEP)).toBe(true);
  });

  it('finds the water beside a stop that stands on the shore', () => {
    // Land to the west, sea to the east, the stop a few blocks inland of the line.
    const sea = new SeaLanes(world((x) => x < 0));
    const port = sea.harbourAt({ x: -10, y: 40, z: 0 });
    expect(port).not.toBeNull();
    expect(port!.cx * SEA_STEP).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(port!.cx * SEA_STEP + 10, port!.cz * SEA_STEP)).toBeLessThanOrEqual(HARBOUR_REACH);
  });

  it('answers the same thing twice, and does not care which way round it is asked', () => {
    const sea = new SeaLanes(world((x, z) => Math.abs(x - 200) < 12 && z < 120));
    const first = sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 });
    const again = sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 400, y: 40, z: 0 });
    const back = sea.laneBetween({ x: 400, y: 40, z: 0 }, { x: 0, y: 40, z: 0 });
    expect(first).not.toBeNull();
    // The cached answer is the same object and the same lane; the reverse is the same
    // water, so it had better be the same length.
    expect(again).toBe(first);
    expect(back!.length).toBeCloseTo(first!.length, 6);
  });

  it('gives up rather than searching an ocean for a crossing that is not there', () => {
    // A pocket of water round the first stop and nothing joining it to the second.
    const sea = new SeaLanes(world((x, z) => Math.hypot(x, z) > 60 && Math.hypot(x - 900, z) > 60));
    const started = Date.now();
    expect(sea.laneBetween({ x: 0, y: 40, z: 0 }, { x: 900, y: 40, z: 0 })).toBeNull();
    expect(Date.now() - started, 'the search ran away').toBeLessThan(2000);
  });
});
