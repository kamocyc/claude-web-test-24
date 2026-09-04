import { hashInts, mulberry32 } from '../../core/rng';
import { Block, isSolid, rotateBlockY, type BlockId } from '../blocks';
import { CHUNK_SIZE } from '../chunk';
import { FLAT_GROUND_Y, flatBlockAt } from './flat';
import { LANDMARKS, createPlaza, type Brush, type Landmark } from './landmarks';

/**
 * The exhibition the superflat world exists to hold.
 *
 * Nine lots on a three-by-three grid, avenues between them, the plaza in the
 * middle and one building on each of the other eight. The layout is fixed rather
 * than seeded: this is a test world, and a test whose subject moves is not a test.
 *
 * ## Why the buildings are planned into an array
 *
 * A landmark is authored as a sequence of overlapping drawing operations — a wall
 * goes up, a window is cut out of it, a roof is laid over the top — so it cannot
 * be evaluated one block at a time the way terrain can. It has to be built whole.
 * Each lot is therefore rasterised once into a dense `Uint16Array` covering
 * exactly the building's declared box, and the chunk generator, the map survey and
 * the spawn search all read out of that. The largest exhibit is 29 x 74 x 29,
 * which is 130 KB; all nine together are under half a megabyte, so they are simply
 * kept rather than evicted and rebuilt.
 *
 * The array stores `blockId + 1`, so 0 means "this cell is not the building's" —
 * which is a different thing from air, and has to be, because a fountain basin and
 * a cellar are cut *out* of ground the flat world already laid.
 */

/** The side of one lot. Odd, so a lot has an exact middle block for the plaza's
 *  fountain and every tower's mast to stand on. */
export const LOT = 45;
/** Blocks of avenue between one lot and the next. */
export const AVENUE = 12;
export const PITCH = LOT + AVENUE;
/** How many lots out from the plaza the exhibition reaches. Two: the ring round the
 *  square, and the modern quarter one lot further out along each avenue. */
export const RINGS = 2;
/** How far the grid reaches from the origin, lots and avenues together. */
export const SHOWCASE_REACH = RINGS * PITCH + (LOT - 1) / 2;
/** Blocks between one street lamp and the next along a kerb. Sixteen rather than
 *  eight: a lamp is a lit block and stands out in daylight, and at eight the
 *  avenues had more lamp in them than they had avenue. */
const LAMP_PITCH = 16;
/** How far past a lot's edge nothing may self-seed. */
const CLAIM_MARGIN = 3;
/** How far above the ground a person may be put down: a doorstep or a plaza step,
 *  not a roof. Everything a landmark has above this is scenery to look at. */
const STEP_UP = 2;
/** How far the avenues run past the outermost lots, so they read as roads out. */
const AVENUE_OVERRUN = 12;

/** The eight lots around the plaza, clockwise from north. */
const INNER_SEATS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/** And the modern quarter, one lot further out at the end of each avenue.
 *
 *  Out there rather than in the ring for two reasons. The ring is full, and it is a ring
 *  *of one period*: eight buildings all from the same few centuries of Europe. Walking
 *  out of it along an avenue and arriving at a tower block is the comparison the whole
 *  world exists to make. */
const OUTER_SEATS: ReadonlyArray<readonly [number, number]> = [
  [0, -2], [2, 0], [0, 2], [-2, 0],
];

/** Where an exhibit sits — the order `LANDMARKS` is in. */
const SEATS: ReadonlyArray<readonly [number, number]> = [...INNER_SEATS, ...OUTER_SEATS];

/** The material each exhibit is known by, for the plaza's marker pillars. */
const MARKER_BLOCKS: Record<string, BlockId> = {
  greek_temple: Block.MARBLE,
  cathedral: Block.STAINED_GLASS,
  glass_tower: Block.TINTED_GLASS,
  deco_tower: Block.BRICKS,
  clock_tower: Block.COPPER_PANEL,
  lattice_tower: Block.STEEL,
  manor_house: Block.TIMBER_FRAME,
  townhouse_row: Block.ROOF_TILE,
  tower_block: Block.TINTED_GLASS,
  tenant_block: Block.SIGN_RED,
  apartment: Block.WHITE_TILE,
  jp_house: Block.SLATE,
};

export interface ShowcaseLot {
  /** Grid cell, -1..1 on each axis. */
  gx: number;
  gz: number;
  landmark: Landmark;
  /** Quarter turns clockwise applied to the landmark so its front faces the
   *  plaza. Every landmark is authored facing north; nothing else would let a
   *  ring of them all address the same square. */
  rotation: 0 | 1 | 2 | 3;
  /** World coordinates of the lot's centre. */
  cx: number;
  cz: number;
  /** World coordinates of the building's own box: `[x0, x1]` and `[z0, z1]`
   *  inclusive, and `[y0, y1]` in world Y. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** One lot's building, rasterised. Cells hold `blockId + 1`; 0 is untouched. */
export interface LotPlan {
  lot: ShowcaseLot;
  cells: Uint16Array;
  /** Writes the landmark asked for outside its own declared box. Always zero for
   *  the built-in exhibits, and asserted to be by the tests — a landmark that
   *  overruns would otherwise silently lose a chimney. */
  overflow: number;
  /** Where the first few of those were, in the landmark's own coordinates. */
  overflowAt: string[];
}

/** What an avenue column is made of, from the ground up. */
interface AvenueColumn {
  /** Offsets from `FLAT_GROUND_Y` and the block at each. */
  parts: ReadonlyArray<readonly [number, BlockId]>;
}

const ROADWAY: AvenueColumn = { parts: [[0, Block.CONCRETE]] };
const KERB: AvenueColumn = { parts: [[0, Block.MARBLE_SLAB]] };
const LAMP: AvenueColumn = {
  parts: [[0, Block.MARBLE_SLAB], [1, Block.STONE_COLUMN], [2, Block.STONE_COLUMN], [3, Block.LANTERN]],
};

export class Showcase {
  readonly lots: readonly ShowcaseLot[];
  private readonly plans = new Map<string, LotPlan>();

  constructor(private readonly seed: number) {
    // One marker pillar per direction, and there are eight directions: the pillars name
    // the ring round the square. What is further out along an avenue is found by walking
    // down it, which is what an avenue is for.
    const markers = INNER_SEATS.map((_, index) => MARKER_BLOCKS[LANDMARKS[index].id] ?? Block.STONE_BRICKS);
    const plaza = createPlaza(markers);
    const lots: ShowcaseLot[] = [seatLot(0, 0, plaza)];
    SEATS.forEach(([gx, gz], index) => lots.push(seatLot(gx, gz, LANDMARKS[index])));
    this.lots = lots;
  }

  lotAt(x: number, z: number): ShowcaseLot | null {
    const gx = Math.round(x / PITCH);
    const gz = Math.round(z / PITCH);
    if (Math.abs(gx) > RINGS || Math.abs(gz) > RINGS) return null;
    const lot = this.lots.find((candidate) => candidate.gx === gx && candidate.gz === gz);
    if (!lot) return null;
    return x >= lot.x0 && x <= lot.x1 && z >= lot.z0 && z <= lot.z1 ? lot : null;
  }

  /** The block the showcase puts at a world position, or null where it puts none. */
  blockAt(x: number, y: number, z: number): BlockId | null {
    const lot = this.lotAt(x, z);
    if (lot) {
      const cell = readPlan(this.planFor(lot), x, y, z);
      if (cell !== null) return cell;
    }
    const avenue = avenueAt(x, z);
    if (!avenue) return null;
    for (const [dy, block] of avenue.parts) {
      if (FLAT_GROUND_Y + dy === y) return block;
    }
    return null;
  }

  /**
   * The Y of the topmost block a player could stand on in this column, or null
   * when there is nowhere in it to stand.
   *
   * Two rules, and the second one is the important one. There has to be room for
   * a person — two blocks of clear air — and the footing has to be at ground
   * level. Without the second, the spawn search would put the player on the
   * finial of the fountain, which is the topmost solid block in its column with
   * plenty of sky over it. `STEP_UP` is what a flight of steps and a kerb are
   * worth.
   *
   * This governs where a *person* is set down — `findSpawn` and the generator's
   * own answer. The mob spawner does not come through here: it reads the loaded
   * world's own surface, so hostiles still appear on the exhibits' roofs after
   * dark, as they do on a village's rooftops in an ordinary world.
   */
  standingY(x: number, z: number): number | null {
    const ceiling = FLAT_GROUND_Y + STEP_UP;
    for (let y = ceiling; y >= FLAT_GROUND_Y - 4; y--) {
      const here = this.blockAt(x, y, z) ?? flatBlockAt(y);
      if (!isStandable(here)) continue;
      const a = this.blockAt(x, y + 1, z) ?? flatBlockAt(y + 1);
      const b = this.blockAt(x, y + 2, z) ?? flatBlockAt(y + 2);
      return a === Block.AIR && b === Block.AIR ? y : null;
    }
    return null;
  }

  /** The surface a map should draw: the top of whatever stands here. */
  surfaceAt(x: number, z: number): { y: number; block: BlockId } {
    const lot = this.lotAt(x, z);
    const plan = lot ? this.planFor(lot) : null;
    const top = plan ? plan.lot.y1 : FLAT_GROUND_Y + 4;
    for (let y = top; y > FLAT_GROUND_Y; y--) {
      const here = this.blockAt(x, y, z);
      if (here !== null && here !== Block.AIR) return { y, block: here };
    }
    const ground = this.blockAt(x, FLAT_GROUND_Y, z);
    return { y: FLAT_GROUND_Y, block: ground ?? Block.GRASS };
  }

  /**
   * Ground the exhibition has spoken for, which is where nothing may self-seed.
   *
   * The whole of every lot, not merely the building on it. A lot's margin is
   * mown lawn, and the point of the world is to look at the exhibits: an oak
   * self-seeded four blocks from a portico is one more thing standing in front
   * of the thing being checked. The parkland outside the grid keeps its trees.
   */
  claims(x: number, z: number): boolean {
    if (avenueAt(x, z)) return true;
    // Past the lot's own edge. A building whose footprint fills its lot in one
    // axis — the cathedral is 44 deep in a 45 lot — otherwise leaves a single
    // unclaimed row against its own wall, and an oak's canopy is wider than its
    // trunk, so a tree seeded there grows straight through the nave.
    const half = (LOT - 1) / 2 + CLAIM_MARGIN;
    for (const lot of this.lots) {
      if (Math.abs(x - lot.cx) <= half && Math.abs(z - lot.cz) <= half) return true;
    }
    return false;
  }

  /** Everything the showcase puts inside one chunk, through the caller's setter. */
  writeChunk(cx: number, cz: number, put: (x: number, y: number, z: number, block: BlockId) => void): void {
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const avenue = avenueAt(originX + lx, originZ + lz);
        if (!avenue) continue;
        for (const [dy, block] of avenue.parts) put(originX + lx, FLAT_GROUND_Y + dy, originZ + lz, block);
      }
    }

    for (const lot of this.lots) {
      if (lot.x1 < originX || lot.x0 >= originX + CHUNK_SIZE) continue;
      if (lot.z1 < originZ || lot.z0 >= originZ + CHUNK_SIZE) continue;
      const plan = this.planFor(lot);
      const x0 = Math.max(lot.x0, originX);
      const x1 = Math.min(lot.x1, originX + CHUNK_SIZE - 1);
      const z0 = Math.max(lot.z0, originZ);
      const z1 = Math.min(lot.z1, originZ + CHUNK_SIZE - 1);
      for (let y = lot.y0; y <= lot.y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const cell = readPlan(plan, x, y, z);
            if (cell !== null) put(x, y, z, cell);
          }
        }
      }
    }
  }

  /** Rasterises a lot's building, once. */
  planFor(lot: ShowcaseLot): LotPlan {
    const key = `${lot.gx},${lot.gz}`;
    const cached = this.plans.get(key);
    if (cached) return cached;
    const w = lot.x1 - lot.x0 + 1;
    const d = lot.z1 - lot.z0 + 1;
    const h = lot.y1 - lot.y0 + 1;
    const plan: LotPlan = { lot, cells: new Uint16Array(w * d * h), overflow: 0, overflowAt: [] };
    // Local-to-world, once, for both halves of the brush. Everything the landmark
    // draws goes through here, block id included: a gable turned a quarter turn
    // is made of different wedges than the one it was authored as.
    const { width, depth } = lot.landmark;
    const place = (x: number, z: number): [number, number] => {
      switch (lot.rotation) {
        case 1: return [lot.x0 + (depth - 1 - z), lot.z0 + x];
        case 2: return [lot.x0 + (width - 1 - x), lot.z0 + (depth - 1 - z)];
        case 3: return [lot.x0 + z, lot.z0 + (width - 1 - x)];
        default: return [lot.x0 + x, lot.z0 + z];
      }
    };
    const brush: Brush = {
      set: (x, y, z, block) => {
        const [wx, wz] = place(x, z);
        const index = planIndex(plan, wx, FLAT_GROUND_Y + y, wz);
        if (index < 0) {
          plan.overflow++;
          // The first few, because "37 blocks went missing" is not a bug report
          // and "37, the first at (28, 21, -1)" is. In the landmark's own
          // coordinates, which is where the author has to go and look.
          if (plan.overflowAt.length < 8) plan.overflowAt.push(`${x},${y},${z}`);
          return;
        }
        plan.cells[index] = rotateBlockY(block, lot.rotation) + 1;
      },
      get: (x, y, z) => {
        const [wx, wz] = place(x, z);
        const index = planIndex(plan, wx, FLAT_GROUND_Y + y, wz);
        // Outside the box the building is looking at the world it stands in,
        // which on a superflat is either ground or sky.
        if (index < 0) return flatBlockAt(FLAT_GROUND_Y + y);
        const cell = plan.cells[index];
        // Turned back, so a landmark that reads what it has already drawn sees
        // what it drew rather than a wedge pointing somewhere else.
        return cell === 0 ? flatBlockAt(FLAT_GROUND_Y + y) : rotateBlockY(cell - 1, -lot.rotation);
      },
    };
    lot.landmark.build(brush, { rng: mulberry32(hashInts(this.seed ^ 0x5ca1e, lot.gx, lot.gz)) });
    this.plans.set(key, plan);
    return plan;
  }
}

/**
 * Which way to turn an exhibit so that it addresses the square.
 *
 * A landmark is authored facing north — its door, its portico, its west front is
 * on the low-z side — because it has to be authored facing *somewhere* and one
 * convention is easier to keep than eight. The lots on the axes turn to face
 * straight down their avenue; the four on the diagonals have no exact answer, so
 * they take the north-south one, which puts their fronts on the same avenue as
 * the lot between them.
 */
function rotationFor(gx: number, gz: number): 0 | 1 | 2 | 3 {
  if (gz === 0 && gx !== 0) return gx > 0 ? 3 : 1;
  return gz > 0 ? 0 : 2;
}

function seatLot(gx: number, gz: number, landmark: Landmark): ShowcaseLot {
  const cx = gx * PITCH;
  const cz = gz * PITCH;
  // The plaza is symmetrical and its marker pillars point at named directions, so
  // it is the one lot that is never turned.
  const rotation = landmark.kind === 'plaza' ? 0 : rotationFor(gx, gz);
  const turned = rotation % 2 === 1;
  const width = turned ? landmark.depth : landmark.width;
  const depth = turned ? landmark.width : landmark.depth;
  // Centred in its lot, and biased to whole blocks the same way for every
  // exhibit so that two lots side by side line up.
  const x0 = cx - Math.floor(LOT / 2) + Math.floor((LOT - width) / 2);
  const z0 = cz - Math.floor(LOT / 2) + Math.floor((LOT - depth) / 2);
  return {
    gx, gz, landmark, rotation, cx, cz,
    x0,
    x1: x0 + width - 1,
    z0,
    z1: z0 + depth - 1,
    y0: FLAT_GROUND_Y - landmark.depthBelow,
    y1: FLAT_GROUND_Y + landmark.height,
  };
}

function planIndex(plan: LotPlan, x: number, y: number, z: number): number {
  const { lot } = plan;
  if (x < lot.x0 || x > lot.x1 || z < lot.z0 || z > lot.z1 || y < lot.y0 || y > lot.y1) return -1;
  const w = lot.x1 - lot.x0 + 1;
  const d = lot.z1 - lot.z0 + 1;
  return ((y - lot.y0) * d + (z - lot.z0)) * w + (x - lot.x0);
}

function readPlan(plan: LotPlan, x: number, y: number, z: number): BlockId | null {
  const index = planIndex(plan, x, y, z);
  if (index < 0) return null;
  const cell = plan.cells[index];
  return cell === 0 ? null : cell - 1;
}

/** Half a lot, and the first coordinate past it. */
const LOT_HALF = (LOT - 1) / 2;
const GAP_NEAR = LOT_HALF + 1;

/** How deep into an avenue strip a coordinate lies, or null when it is not in one.
 *
 *  One rule for the whole grid rather than one per street: the lots repeat every `PITCH`
 *  blocks, so what matters is how far this column is from the nearest lot's middle. Under
 *  half a lot it is somebody's plot; past that it is the street, and how far past is which
 *  side of the carriageway it is on. */
function stripDepth(v: number): number | null {
  const from = ((v % PITCH) + PITCH) % PITCH;
  if (from <= LOT_HALF || from >= PITCH - LOT_HALF) return null;
  return from - GAP_NEAR;
}

/** Whether one of the exhibition's avenues runs through this column. */
export function isAvenue(x: number, z: number): boolean {
  return avenueAt(x, z) !== null;
}

/** Whether an avenue runs through this column, and what it is made of there. */
function avenueAt(x: number, z: number): AvenueColumn | null {
  const limit = SHOWCASE_REACH + AVENUE_OVERRUN;
  const acrossX = stripDepth(x);
  const acrossZ = stripDepth(z);
  const runsNorth = acrossX !== null && Math.abs(z) <= limit;
  const runsEast = acrossZ !== null && Math.abs(x) <= limit;
  if (!runsNorth && !runsEast) return null;
  // A crossing is all carriageway: kerbs and lamps through the middle of a
  // junction would be street furniture standing in the road.
  if (runsNorth && runsEast) return ROADWAY;
  const depth = runsNorth ? acrossX! : acrossZ!;
  const along = runsNorth ? z : x;
  const kerb = depth === 0 || depth === AVENUE - 1;
  if (!kerb) return ROADWAY;
  return along % LAMP_PITCH === 0 ? LAMP : KERB;
}

/** Ground a person can be put down on. */
function isStandable(block: BlockId): boolean {
  return block !== Block.WATER && isSolid(block);
}
