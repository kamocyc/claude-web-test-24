/** Where the map is looking, as arithmetic.
 *
 *  This was three lines inside `Minimap`, which is fine for as long as the map only ever
 *  points at the player: the only direction that mattered was world to pixel, and getting
 *  it wrong would have been visible in the first frame.
 *
 *  A map that can be dragged needs the other direction too — a mouse position has to
 *  become a place, so the bar can name it and the player can be sent there — and that one
 *  is not visible when it is wrong. It is off by half a block, or by the difference
 *  between the canvas's 512 pixels and the size CSS actually draws it at, and it looks
 *  exactly like a map that works.
 *
 *  So it lives here, where it is a pure function of four numbers and a test can hold it to
 *  its own inverse. Nothing in this file touches a canvas or the DOM. */

export interface MapOrigin {
  /** World coordinate of the top-left pixel of the map. */
  x: number;
  z: number;
}

/** The top-left corner of a map of `size` pixels at `scale` blocks per pixel, looking at
 *  `centre`.
 *
 *  The centre is floored, so the map moves in whole blocks: a fractional origin would
 *  resample every column half a block over as the player walks, which reads as the terrain
 *  shimmering rather than as the map scrolling. */
export function originOf(
  centreX: number,
  centreZ: number,
  size: number,
  scale: number,
): MapOrigin {
  return {
    x: Math.floor(centreX) - (size / 2) * scale,
    z: Math.floor(centreZ) - (size / 2) * scale,
  };
}

/** World coordinates to map pixels. Fractional and unclipped: a line with one end off the
 *  map is still drawn to the edge, and rounding it to a whole pixel would make a road
 *  crawl in steps as the map scrolls. */
export function placeOn(
  origin: MapOrigin,
  scale: number,
  x: number,
  z: number,
): { px: number; py: number } {
  return { px: (x - origin.x) / scale, py: (z - origin.z) / scale };
}

/** Map pixels back to world coordinates: the inverse of `placeOn`.
 *
 *  Half a pixel is added because a pixel is a square of `scale` blocks and what the player
 *  is pointing at is the middle of it, not its corner. At sixteen blocks to the pixel that
 *  is eight blocks of difference, which is the width of a house. */
export function worldAt(
  origin: MapOrigin,
  scale: number,
  px: number,
  py: number,
): { x: number; z: number } {
  return {
    x: Math.floor(origin.x + (px + 0.5) * scale),
    z: Math.floor(origin.z + (py + 0.5) * scale),
  };
}

/** Where a mouse event lands on a canvas that CSS has scaled.
 *
 *  The backing canvas is 512 pixels across and is drawn at `min(84vh, 84vw)`, so the two
 *  are the same number only by accident. Everything that turns a cursor into a place has
 *  to go through this; `clientX - rect.left` alone is right on one window size and wrong
 *  on every other.
 *
 *  Returns null for a rect with no area, which is what a hidden element measures. */
export function canvasPixel(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  size: number,
): { px: number; py: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    px: ((clientX - rect.left) / rect.width) * size,
    py: ((clientY - rect.top) / rect.height) * size,
  };
}

/** How far the world moves when the mouse moves, in blocks.
 *
 *  Dragging a map moves the *paper*: the ground follows the hand, so the point the map is
 *  looking at goes the other way. Same CSS scaling as `canvasPixel`, for the same reason. */
export function dragBlocks(
  rect: { width: number; height: number },
  dx: number,
  dy: number,
  size: number,
  scale: number,
): { x: number; z: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, z: 0 };
  return {
    x: -(dx / rect.width) * size * scale,
    z: -(dy / rect.height) * size * scale,
  };
}
