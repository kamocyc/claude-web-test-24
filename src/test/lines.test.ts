import { describe, expect, it } from 'vitest';
import { LineNetwork, MAX_LINE_STOPS, STOP_SPACING } from '../game/lines';

function net(): LineNetwork {
  return new LineNetwork();
}

/** Puts a stop down and hands back the stop itself, for the many tests that only care
 *  that it worked. */
function stop(n: LineNetwork, x: number, z: number, town: string | null = null) {
  const result = n.addStop({ x, y: 64, z }, town, town ?? undefined);
  if (!result.ok) throw new Error(`refused: ${result.why}`);
  return result.stop;
}

describe('putting stops down', () => {
  it('names one after the town it serves', () => {
    const n = net();
    const a = stop(n, 0, 0, '町A');
    expect(a.town).toBe('町A');
    expect(a.name).toContain('町A');
    // One out in the country is numbered instead: there is nothing to name it after.
    expect(stop(n, 100, 0).name).not.toContain('町A');
  });

  it('refuses one on top of another', () => {
    const n = net();
    stop(n, 0, 0);
    const close = n.addStop({ x: STOP_SPACING - 1, y: 64, z: 0 }, null);
    expect(close.ok).toBe(false);
    if (!close.ok) expect(close.why).toBe('too-close');
    // Far enough apart is fine.
    expect(n.addStop({ x: STOP_SPACING, y: 64, z: 0 }, null).ok).toBe(true);
  });

  it('rounds to a block, because a stop is a place and not a position', () => {
    const n = net();
    const s = stop(n, 10.7, -3.2);
    expect(s.x).toBe(11);
    expect(s.z).toBe(-3);
  });

  it('finds the nearest one to a point, and nothing when they are all too far', () => {
    const n = net();
    const near = stop(n, 0, 0);
    stop(n, 60, 0);
    expect(n.stopNear(4, 0, 10)?.id).toBe(near.id);
    expect(n.stopNear(500, 0, 10)).toBeNull();
  });

  it('lists the stops that serve a town', () => {
    const n = net();
    stop(n, 0, 0, '町A');
    stop(n, 30, 0, '町A');
    stop(n, 60, 0, '町B');
    expect(n.stopsOf('町A')).toHaveLength(2);
    expect(n.stopsOf('町C')).toHaveLength(0);
  });
});

describe('stringing stops into a line', () => {
  it('runs a two stop line out and back, and no further', () => {
    const n = net();
    const a = stop(n, 0, 0);
    const b = stop(n, 100, 0);
    const line = n.createLine();
    n.addCall(line.id, a.id);
    n.addCall(line.id, b.id);
    const legs = n.legsOf(line.id);
    // One leg. A vehicle runs it both ways; a second leg back would be the same ground
    // counted twice.
    expect(legs).toHaveLength(1);
    expect(legs[0].from.id).toBe(a.id);
    expect(legs[0].to.id).toBe(b.id);
  });

  it('closes the loop once there are three', () => {
    const n = net();
    const ids = [stop(n, 0, 0), stop(n, 100, 0), stop(n, 100, 100)].map((s) => s.id);
    const line = n.createLine();
    for (const id of ids) n.addCall(line.id, id);
    const legs = n.legsOf(line.id);
    expect(legs).toHaveLength(3);
    // Round trip: the last leg comes back to where the line started, so the middle of a
    // line is not served twice as often as its ends.
    expect(legs[2].from.id).toBe(ids[2]);
    expect(legs[2].to.id).toBe(ids[0]);
  });

  it('runs nothing on a line nobody has finished', () => {
    const n = net();
    const line = n.createLine();
    expect(n.legsOf(line.id)).toHaveLength(0);
    n.addCall(line.id, stop(n, 0, 0).id);
    expect(n.legsOf(line.id)).toHaveLength(0);
  });

  it('refuses to call at the same stop twice running', () => {
    const n = net();
    const a = stop(n, 0, 0);
    const b = stop(n, 100, 0);
    const line = n.createLine();
    expect(n.addCall(line.id, a.id)).toBe(true);
    // A leg from a stop to itself is a vehicle going nowhere.
    expect(n.addCall(line.id, a.id)).toBe(false);
    expect(n.addCall(line.id, b.id)).toBe(true);
    // But calling there again later is how a line out and back through a junction reads.
    expect(n.addCall(line.id, a.id)).toBe(true);
  });

  it('caps how long a line may get', () => {
    const n = net();
    const line = n.createLine();
    for (let i = 0; i <= MAX_LINE_STOPS; i++) {
      const s = stop(n, i * 20, 0);
      const added = n.addCall(line.id, s.id);
      expect(added).toBe(i < MAX_LINE_STOPS);
    }
    expect(n.lines.get(line.id)!.stops).toHaveLength(MAX_LINE_STOPS);
  });

  it('drops a call without disturbing the rest', () => {
    const n = net();
    const ids = [stop(n, 0, 0), stop(n, 100, 0), stop(n, 200, 0)].map((s) => s.id);
    const line = n.createLine();
    for (const id of ids) n.addCall(line.id, id);
    expect(n.removeCall(line.id, 1)).toBe(true);
    expect(n.lines.get(line.id)!.stops).toEqual([ids[0], ids[2]]);
    expect(n.removeCall(line.id, 9)).toBe(false);
  });
});

describe('taking a stop away', () => {
  it('takes it off every line that called there', () => {
    const n = net();
    const a = stop(n, 0, 0);
    const b = stop(n, 100, 0);
    const c = stop(n, 200, 0);
    const one = n.createLine();
    const two = n.createLine();
    for (const id of [a.id, b.id, c.id]) n.addCall(one.id, id);
    for (const id of [b.id, c.id]) n.addCall(two.id, id);
    expect(n.linesAt(b.id)).toHaveLength(2);

    expect(n.removeStop(b.id)).toBe(true);
    expect(n.lines.get(one.id)!.stops).toEqual([a.id, c.id]);
    // The second line is down to one call, which is a line somebody is still building
    // rather than one to throw away.
    expect(n.lines.get(two.id)!.stops).toEqual([c.id]);
    expect(n.legsOf(two.id)).toHaveLength(0);
  });

  it('says so when there was nothing there', () => {
    expect(net().removeStop('nope')).toBe(false);
  });
});

describe('what changed', () => {
  it('moves the revision for anything that changes a line', () => {
    const n = net();
    const before = n.revision;
    const a = stop(n, 0, 0);
    const line = n.createLine();
    n.addCall(line.id, a.id);
    expect(n.revision).toBeGreaterThan(before);
    // A refused stop changes nothing, so nothing is resurveyed for it.
    const at = n.revision;
    n.addStop({ x: 1, y: 64, z: 0 }, null);
    expect(n.revision).toBe(at);
  });
});

describe('a network that has been saved and opened again', () => {
  it('comes back with the same stops and the same calls', () => {
    const n = net();
    const a = stop(n, 0, 0, '町A');
    const b = stop(n, 120, 40, '町B');
    const line = n.createLine('貨物1');
    n.addCall(line.id, a.id);
    n.addCall(line.id, b.id);

    const back = net();
    back.loadJSON(n.toJSON());
    expect([...back.stops.keys()]).toEqual([a.id, b.id]);
    expect(back.lines.get(line.id)?.name).toBe('貨物1');
    expect(back.legsOf(line.id)).toHaveLength(1);
  });

  it('carries on numbering where the save left off', () => {
    const n = net();
    stop(n, 0, 0);
    stop(n, 40, 0);
    const back = net();
    back.loadJSON(n.toJSON());
    const fresh = back.addStop({ x: 200, y: 64, z: 0 }, null);
    expect(fresh.ok).toBe(true);
    // A third stop must not be handed an id one of the first two already has.
    if (fresh.ok) expect(back.stops.size).toBe(3);
  });

  it('drops a call at a stop that is no longer in the save', () => {
    const n = net();
    const a = stop(n, 0, 0);
    const b = stop(n, 100, 0);
    const line = n.createLine();
    n.addCall(line.id, a.id);
    n.addCall(line.id, b.id);
    const saved = n.toJSON();
    saved.stops = saved.stops.filter((s) => s.id !== b.id);

    const back = net();
    back.loadJSON(saved);
    // The leg either side of a missing call would be a leg to nowhere.
    expect(back.lines.get(line.id)!.stops).toEqual([a.id]);
    expect(back.legsOf(line.id)).toHaveLength(0);
  });

  it('opens an empty save as an empty network', () => {
    const back = net();
    back.loadJSON(undefined);
    expect(back.stops.size).toBe(0);
    expect(back.lines.size).toBe(0);
  });
});
