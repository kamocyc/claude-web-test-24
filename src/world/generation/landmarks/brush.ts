import { Block, type BlockId } from '../../blocks';

/**
 * Drawing a building.
 *
 * Every landmark is written through one of these rather than straight into a
 * chunk, for the same reason `townBuildings.ts` writes through a `put`: a
 * building has to be buildable inside terrain generation, inside a test and
 * inside a screenshot script alike, and none of those three agree about what a
 * chunk is.
 *
 * Coordinates are the lot's own. `x` runs east across the lot, `z` south, and
 * `y` is measured from the ground: `y = 0` is the topmost ground block, so a
 * floor is laid at 1 and a foundation is cut at -1. Every landmark is authored
 * against that origin, which is what lets the same building be placed on a
 * different lot — or a different world — without editing a single number in it.
 */
export interface Brush {
  set(x: number, y: number, z: number, block: BlockId): void;
  get(x: number, y: number, z: number): BlockId;
}

/** An inclusive box in lot coordinates. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return {
    x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
    x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
  };
}

/** Every cell of a box. */
export function fill(brush: Brush, b: Box, block: BlockId): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let z = b.z0; z <= b.z1; z++) {
      for (let x = b.x0; x <= b.x1; x++) brush.set(x, y, z, block);
    }
  }
}

/** A box emptied out. Separate from `fill(AIR)` only so the intent reads. */
export function hollowOut(brush: Brush, b: Box): void {
  fill(brush, b, Block.AIR);
}

/** The four walls of a box, leaving its interior, floor and ceiling alone. */
export function walls(brush: Brush, b: Box, block: BlockId): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let z = b.z0; z <= b.z1; z++) {
      for (let x = b.x0; x <= b.x1; x++) {
        if (x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1) brush.set(x, y, z, block);
      }
    }
  }
}

/** One horizontal ring: the outline of a rectangle at a single level. Cornices,
 *  string courses and parapet caps are all this. */
export function ring(brush: Brush, y: number, x0: number, z0: number, x1: number, z1: number, block: BlockId): void {
  for (let x = x0; x <= x1; x++) {
    brush.set(x, y, z0, block);
    brush.set(x, y, z1, block);
  }
  for (let z = z0; z <= z1; z++) {
    brush.set(x0, y, z, block);
    brush.set(x1, y, z, block);
  }
}

/** A solid horizontal slab across a rectangle: a floor, a deck, a lid. */
export function slabAt(brush: Brush, y: number, x0: number, z0: number, x1: number, z1: number, block: BlockId): void {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) brush.set(x, y, z, block);
  }
}

/** A vertical post: the column at (x, z), from `y0` up to and including `y1`.
 *  The horizontal pair comes first, like every other function here. */
export function post(brush: Brush, x: number, z: number, y0: number, y1: number, block: BlockId): void {
  for (let y = y0; y <= y1; y++) brush.set(x, y, z, block);
}

/** The four corner posts of a rectangle, which is what gives a facade its bays. */
export function corners(brush: Brush, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: BlockId): void {
  post(brush, x0, z0, y0, y1, block);
  post(brush, x1, z0, y0, y1, block);
  post(brush, x0, z1, y0, y1, block);
  post(brush, x1, z1, y0, y1, block);
}

/**
 * Walks the rim of a rectangle at one level, once per cell and once only.
 *
 * Every facade in this directory is the same loop — go round the outside,
 * decide whether each cell is a corner, a pier or infill — and writing it out
 * three times produced three chances to get the bay rhythm wrong at a corner.
 * `along` is the distance travelled around the rim, so a rhythm carries round
 * the corner instead of restarting on each face, which is the whole reason the
 * rim is walked rather than four walls drawn.
 */
export function perimeter(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  visit: (x: number, z: number, along: number, corner: boolean) => void,
): void {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      const along = x === x0 || x === x1 ? z - z0 : x - x0;
      visit(x, z, along, corner);
    }
  }
}

/**
 * Closing one stage of a tower onto the narrower one above it.
 *
 * A setback is a *terrace*, not a hoop: the stage below has to be lidded, or the
 * stage above stands over a one-block void and the moulding round it touches
 * nothing. Both towers hand-rolled this and both got it wrong, in the same way.
 * `y` is the level of the lid; the stage above starts at `y + 1`.
 */
export function setback(
  brush: Brush,
  cx: number,
  cz: number,
  half: number,
  y: number,
  lid: BlockId,
  moulding: BlockId,
): void {
  slabAt(brush, y, cx - half, cz - half, cx + half, cz + half, lid);
  ring(brush, y, cx - half - 1, cz - half - 1, cx + half + 1, cz + half + 1, moulding);
}

/**
 * A disc standing up in a wall: the one round thing on a gothic front.
 *
 * `ellipse` is horizontal and cannot draw this — stacking it with `rz = 0` gives
 * a rectangle, which is what the rose window was until somebody looked at it.
 * `axis` is the axis the wall runs along and `at` its fixed coordinate.
 */
export function verticalDisc(
  brush: Brush,
  axis: 'x' | 'z',
  at: number,
  cAlong: number,
  cy: number,
  radius: number,
  block: BlockId,
  hollow = false,
): void {
  const r = Math.max(0.5, radius);
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    const inner = r * r - dy * dy;
    if (inner < 0) continue;
    const halfWidth = Math.round(Math.sqrt(inner));
    for (let d = -halfWidth; d <= halfWidth; d++) {
      if (hollow && Math.hypot(d, dy) < r - 1) continue;
      const x = axis === 'x' ? cAlong + d : at;
      const z = axis === 'x' ? at : cAlong + d;
      brush.set(x, cy + dy, z, block);
    }
  }
}

/**
 * A filled ellipse at one level, by the same half-axis test a circle of blocks
 * is usually drawn with. Domes, basins and round towers are all stacks of these.
 */
export function ellipse(
  brush: Brush,
  y: number,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  block: BlockId,
  hollow = false,
): void {
  const rxi = Math.max(0.5, rx);
  const rzi = Math.max(0.5, rz);
  for (let z = Math.floor(cz - rzi); z <= Math.ceil(cz + rzi); z++) {
    for (let x = Math.floor(cx - rxi); x <= Math.ceil(cx + rxi); x++) {
      const dx = (x - cx) / rxi;
      const dz = (z - cz) / rzi;
      const d = dx * dx + dz * dz;
      if (d > 1) continue;
      // The rim is whatever is within one block of the edge, measured in the same
      // normalised space, so a wide ellipse does not come out with a thick side
      // and a thin end.
      if (hollow && d < Math.pow(1 - 1 / Math.max(rxi, rzi), 2)) continue;
      brush.set(x, y, z, block);
    }
  }
}

/** Wedge ids for a covering, indexed the way `FACING_STEP` is: east, north, west, south. */
export interface RoofKit {
  /** The solid course a ridge and the eaves are made of. */
  solid: BlockId;
  east: BlockId;
  west: BlockId;
  south: BlockId;
  north: BlockId;
}

export const SLATE_ROOF: RoofKit = {
  solid: Block.SLATE,
  east: Block.SLATE_ROOF_EAST, west: Block.SLATE_ROOF_WEST,
  south: Block.SLATE_ROOF_SOUTH, north: Block.SLATE_ROOF_NORTH,
};

export const TILE_ROOF: RoofKit = {
  solid: Block.ROOF_TILE,
  east: Block.ROOF_TILE_EAST, west: Block.ROOF_TILE_WEST,
  south: Block.ROOF_TILE_SOUTH, north: Block.ROOF_TILE_NORTH,
};

export const COPPER_ROOF: RoofKit = {
  solid: Block.COPPER_PANEL,
  east: Block.COPPER_ROOF_EAST, west: Block.COPPER_ROOF_WEST,
  south: Block.COPPER_ROOF_SOUTH, north: Block.COPPER_ROOF_NORTH,
};

export const STONE_ROOF: RoofKit = {
  solid: Block.STONE_BRICKS,
  east: Block.STONE_ROOF_EAST, west: Block.STONE_ROOF_WEST,
  south: Block.STONE_ROOF_SOUTH, north: Block.STONE_ROOF_NORTH,
};

/**
 * A pitched roof over a rectangle, with the ridge running along one axis.
 *
 * `axis` is the direction the ridge points: 'x' gives gables on the east and
 * west walls, 'z' gables on the north and south. Each course steps in by one and
 * the two outermost cells of it are wedges, so the slope is a real diagonal
 * rather than a staircase — the same trick `buildGableRoof` plays for a village
 * house, generalised so a nave and a manor can both use it.
 *
 * Returns the ridge level, which is what a chimney, a dormer or a flèche has to
 * be told to reach.
 */
export function gableRoof(
  brush: Brush,
  kit: RoofKit,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  base: number,
  axis: 'x' | 'z',
  step = 1,
): number {
  const span = axis === 'x' ? z1 - z0 : x1 - x0;
  const courses = Math.floor(span / 2) + 1;
  let y = base;
  for (let course = 0; course < courses; course++) {
    const inset = course;
    const ax0 = axis === 'x' ? x0 : x0 + inset;
    const ax1 = axis === 'x' ? x1 : x1 - inset;
    const az0 = axis === 'x' ? z0 + inset : z0;
    const az1 = axis === 'x' ? z1 - inset : z1;
    if (ax0 > ax1 || az0 > az1) break;
    for (let z = az0; z <= az1; z++) {
      for (let x = ax0; x <= ax1; x++) {
        let block = kit.solid;
        // Wedges only on the two sloping edges, and only while there is another
        // course above for them to point at. The last course is the ridge cap.
        if (course < courses - 1) {
          if (axis === 'x') {
            if (z === az0) block = kit.south;
            else if (z === az1) block = kit.north;
          } else {
            if (x === ax0) block = kit.east;
            else if (x === ax1) block = kit.west;
          }
        }
        brush.set(x, y, z, block);
      }
    }
    if (ax0 === ax1 || az0 === az1) break;
    y += step;
  }
  return y;
}

/**
 * A roof that falls away on all four sides, closing to a point or a short ridge.
 * What a tower cap, a pavilion and a spire base are.
 */
export function hipRoof(
  brush: Brush,
  kit: RoofKit,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  base: number,
  step = 1,
): number {
  let y = base;
  let ax0 = x0, az0 = z0, ax1 = x1, az1 = z1;
  while (ax0 <= ax1 && az0 <= az1) {
    for (let z = az0; z <= az1; z++) {
      for (let x = ax0; x <= ax1; x++) {
        const edgeX = x === ax0 || x === ax1;
        const edgeZ = z === az0 || z === az1;
        if (!edgeX && !edgeZ && (ax1 - ax0 > 1 && az1 - az0 > 1)) continue;
        let block = kit.solid;
        if (ax1 - ax0 > 1 && az1 - az0 > 1) {
          // A corner cell belongs to two slopes at once and cannot be a wedge of
          // either without cutting a notch out of the other, so it stays solid.
          if (x === ax0 && !edgeZ) block = kit.east;
          else if (x === ax1 && !edgeZ) block = kit.west;
          else if (z === az0 && !edgeX) block = kit.south;
          else if (z === az1 && !edgeX) block = kit.north;
        }
        brush.set(x, y, z, block);
      }
    }
    if (ax1 - ax0 <= 1 || az1 - az0 <= 1) break;
    ax0++; az0++; ax1--; az1--;
    y += step;
  }
  return y;
}

/**
 * A solid stepped pyramid, used where a hip roof would be too thin to read: a
 * spire base, a ziggurat crown, the cap of a clock tower.
 */
export function pyramid(
  brush: Brush,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  base: number,
  block: BlockId,
): number {
  let y = base;
  let ax0 = x0, az0 = z0, ax1 = x1, az1 = z1;
  while (ax0 <= ax1 && az0 <= az1) {
    slabAt(brush, y, ax0, az0, ax1, az1, block);
    ax0++; az0++; ax1--; az1--;
    y++;
  }
  return y - 1;
}

/**
 * A rectangular opening knocked out of a wall, with its own frame.
 *
 * Windows are the whole difference between a facade and a box, and they are the
 * one thing that is easy to get wrong twice: the glazing and the reveal around
 * it have to be cut in the same pass or the frame ends up inside the glass.
 */
export function opening(
  brush: Brush,
  b: Box,
  glazing: BlockId | null,
  frame: BlockId | null = null,
): void {
  if (frame !== null) {
    const outer = box(b.x0 - 1, b.y0 - 1, b.z0 - 1, b.x1 + 1, b.y1 + 1, b.z1 + 1);
    for (let y = outer.y0; y <= outer.y1; y++) {
      for (let z = outer.z0; z <= outer.z1; z++) {
        for (let x = outer.x0; x <= outer.x1; x++) {
          const inside = x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
          // Only the ring, and only where the wall it is cut into already stands.
          if (!inside && brush.get(x, y, z) !== Block.AIR) brush.set(x, y, z, frame);
        }
      }
    }
  }
  fill(brush, b, glazing ?? Block.AIR);
}

/** A flight of steps climbing towards +`dir` on one axis, each tread one block deep. */
export function steps(
  brush: Brush,
  axis: 'x' | 'z',
  from: number,
  count: number,
  across0: number,
  across1: number,
  baseY: number,
  tread: BlockId,
  riser: BlockId,
  dir: 1 | -1 = 1,
): void {
  for (let i = 0; i < count; i++) {
    const at = from + i * dir;
    const y = baseY + i;
    for (let a = across0; a <= across1; a++) {
      const x = axis === 'x' ? at : a;
      const z = axis === 'x' ? a : at;
      brush.set(x, y, z, tread);
      for (let below = baseY; below < y; below++) brush.set(x, below, z, riser);
    }
  }
}
