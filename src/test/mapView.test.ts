import { describe, expect, it } from 'vitest';
import { ZOOM_STEPS } from '../ui/minimap';
import { canvasPixel, dragBlocks, originOf, placeOn, worldAt, zoomStepFor } from '../ui/mapView';

const SIZE = 512;

/** The big map as CSS actually draws it: a 512 pixel canvas shown at some other size. */
const RECT = { left: 40, top: 20, width: 640, height: 640 };

describe('where the map is looking', () => {
  it('puts the place it is looking at in the middle', () => {
    for (const scale of ZOOM_STEPS) {
      const origin = originOf(100, -200, SIZE, scale);
      const middle = placeOn(origin, scale, 100, -200);
      expect(middle.px).toBe(SIZE / 2);
      expect(middle.py).toBe(SIZE / 2);
    }
  });

  it('moves in whole blocks however fractional the player is', () => {
    // A fractional origin resamples every column half a block over as the player walks,
    // which reads as the terrain shimmering rather than as the map scrolling.
    expect(originOf(100.9, -200.1, SIZE, 4)).toEqual(originOf(100.0, -200.9, SIZE, 4));
  });

  it('covers exactly the span it claims to', () => {
    const scale = 4;
    const origin = originOf(0, 0, SIZE, scale);
    const topLeft = worldAt(origin, scale, 0, 0);
    const bottomRight = worldAt(origin, scale, SIZE - 1, SIZE - 1);
    expect(bottomRight.x - topLeft.x).toBe((SIZE - 1) * scale);
    expect(bottomRight.z - topLeft.z).toBe((SIZE - 1) * scale);
  });
});

describe('a pixel back into a place', () => {
  it('is the inverse of drawing one', () => {
    for (const scale of ZOOM_STEPS) {
      const origin = originOf(-1234, 5678, SIZE, scale);
      for (const [x, z] of [[-1234, 5678], [-1000, 5000], [0, 0], [-2000, 6000]]) {
        const at = placeOn(origin, scale, x, z);
        const back = worldAt(origin, scale, Math.floor(at.px), Math.floor(at.py));
        // Back to the same pixel's worth of world: at one block to the pixel that is the
        // same block, and at sixteen it is somewhere inside the same square.
        expect(Math.abs(back.x - x)).toBeLessThan(scale);
        expect(Math.abs(back.z - z)).toBeLessThan(scale);
      }
    }
  });

  it('names the middle of a pixel rather than its corner', () => {
    // At sixteen blocks to the pixel the corner is eight blocks out, which is a house.
    const scale = 16;
    const origin = originOf(0, 0, SIZE, scale);
    const corner = origin.x;
    expect(worldAt(origin, scale, 0, 0).x).toBe(corner + scale / 2);
  });

  it('reads the middle of the map back as the place it is looking at', () => {
    const scale = 2;
    const origin = originOf(320, -96, SIZE, scale);
    const middle = worldAt(origin, scale, SIZE / 2, SIZE / 2);
    expect(middle).toEqual({ x: 320 + scale / 2, z: -96 + scale / 2 });
  });
});

describe('a cursor on a canvas CSS has resized', () => {
  it('maps the corners onto the canvas corners', () => {
    expect(canvasPixel(RECT, RECT.left, RECT.top, SIZE)).toEqual({ px: 0, py: 0 });
    const far = canvasPixel(RECT, RECT.left + RECT.width, RECT.top + RECT.height, SIZE)!;
    expect(far.px).toBe(SIZE);
    expect(far.py).toBe(SIZE);
  });

  it('scales rather than assuming the backing size', () => {
    // Halfway across a 640 pixel box is pixel 256 of a 512 pixel canvas, not pixel 320.
    const middle = canvasPixel(RECT, RECT.left + RECT.width / 2, RECT.top, SIZE)!;
    expect(middle.px).toBe(SIZE / 2);
  });

  it('answers nothing for an element with no area', () => {
    // What a hidden element measures, which is what the map is until it is opened.
    expect(canvasPixel({ left: 0, top: 0, width: 0, height: 0 }, 10, 10, SIZE)).toBeNull();
  });
});

describe('dragging the map', () => {
  it('moves the ground with the hand', () => {
    // Drag right, and the place the map is looking at goes left — the paper follows the
    // hand, which is what every map anybody has dragged does.
    const moved = dragBlocks(RECT, 64, 0, SIZE, 2);
    expect(moved.x).toBeLessThan(0);
    // Negating zero gives -0, which is the same place and a different value.
    expect(moved.z).toBeCloseTo(0);
  });

  it('drags further per pixel the further out it is zoomed', () => {
    const close = dragBlocks(RECT, 64, 0, SIZE, 1);
    const wide = dragBlocks(RECT, 64, 0, SIZE, 16);
    expect(Math.abs(wide.x)).toBe(Math.abs(close.x) * 16);
  });

  it('keeps the ground under the cursor as the cursor moves', () => {
    // The whole feel of a drag: whatever was under the mouse when it went down is still
    // under it when it comes up.
    const scale = 4;
    let centre = { x: 0, z: 0 };
    const grabbed = worldAt(
      originOf(centre.x, centre.z, SIZE, scale),
      scale,
      ...cursorAt(RECT.left + 200, RECT.top + 300),
    );
    const moved = dragBlocks(RECT, 120, -80, SIZE, scale);
    centre = { x: centre.x + moved.x, z: centre.z + moved.z };
    const under = worldAt(
      originOf(centre.x, centre.z, SIZE, scale),
      scale,
      ...cursorAt(RECT.left + 320, RECT.top + 220),
    );
    expect(Math.abs(under.x - grabbed.x)).toBeLessThanOrEqual(scale);
    expect(Math.abs(under.z - grabbed.z)).toBeLessThanOrEqual(scale);
  });

  it('moves nothing for an element with no area', () => {
    expect(dragBlocks({ width: 0, height: 0 }, 50, 50, SIZE, 2)).toEqual({ x: 0, z: 0 });
  });
});

/** A client position as the pair of canvas pixels the rest of the map works in. */
function cursorAt(clientX: number, clientY: number): [number, number] {
  const at = canvasPixel(RECT, clientX, clientY, SIZE)!;
  return [at.px, at.py];
}

describe('the zoom the map opens at', () => {
  const STEPS = [1, 2, 4, 8, 16];

  it('comes back to the step it was left on', () => {
    for (let i = 0; i < STEPS.length; i++) expect(zoomStepFor(STEPS, STEPS[i])).toBe(i);
  });

  it('snaps a zoom that is no longer offered onto the nearest that is', () => {
    expect(zoomStepFor(STEPS, 3)).toBe(1);
    expect(zoomStepFor(STEPS, 12)).toBe(3);
    expect(zoomStepFor(STEPS, 1000)).toBe(4);
    expect(zoomStepFor(STEPS, 0)).toBe(0);
  });

  it('falls back to the closest rather than refusing a value it cannot read', () => {
    // A settings file somebody edited by hand, or one an older build wrote.
    expect(zoomStepFor(STEPS, Number.NaN)).toBe(0);
    expect(zoomStepFor(STEPS, -5)).toBe(0);
  });
});
