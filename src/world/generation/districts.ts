/** A town as a grid of city blocks.
 *
 *  The old village was a crossroads with houses lined up along both arms of it. That is a
 *  village, and it is the wrong shape for what the game now asks of a settlement: the
 *  economy trades building by building, and a row of identical houses gives the player
 *  nothing to read. A town wants *districts* — somewhere to live, somewhere to buy,
 *  somewhere that makes things — because "the works are on the far side of town from the
 *  station" is the sort of fact a transport game is made of.
 *
 *  So the ground is cut into blocks by a street grid, and each block is zoned. What stands
 *  on a block follows from its zone and nothing else, which is what makes a town readable
 *  from the air: shopfronts and glass in the middle, houses and gardens around them,
 *  sheds and chimneys at the edge.
 *
 *  Everything here is pure geometry and a hash. No blocks are written, no canvas is
 *  touched, and the whole layout is a function of the seed and the site — so a test can
 *  hold it to its shape, and a town is the same town however and whenever it is asked for. */

import { hashInts, mulberry32 } from '../../core/rng';
import type { BuildingUse } from './village';

/** Streets are three wide because that is what a cart needs; the game's own road rule is
 *  the reason the number is not two. */
export const STREET_WIDTH = 3;
/** The buildable interior of one block. */
export const BLOCK_SIZE = 11;
/** Street to street. One street plus one block. */
export const BLOCK_PITCH = BLOCK_SIZE + STREET_WIDTH;

/** The grid indices a town covers, low to high. Four by four fits inside the plateau at
 *  this pitch: the outermost block corner lands about 34 blocks out, and the flattened
 *  ground runs to 38. A fifth ring would hang off the edge of its own hill. */
export const GRID_LOW = -2;
export const GRID_HIGH = 1;

/** Where the town square goes. Not the crossing itself — a three wide street crossing is
 *  a junction, not a square — but the block beside it, which is nine by eleven of paved
 *  ground and can hold a well and a place to stand. */
export const PLAZA_I = -1;
export const PLAZA_J = -1;

export interface TownBlock {
  /** Grid indices. Stable names: the same block of the same town is always `i,j`. */
  i: number;
  j: number;
  /** The buildable interior, inside the four streets around it. */
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** 0 for the four blocks at the middle, 1 for the ring outside them. */
  ring: number;
  zone: BuildingUse;
  /** Which stage of the town's growth raises this one. 0 is there from the start. */
  stage: number;
}

/** The interior of one grid block, in world coordinates.
 *
 *  Streets run along `site + i * BLOCK_PITCH`, three wide and centred on that line, so a
 *  block starts two past the line and ends two short of the next one. */
export function blockRect(
  site: { x: number; z: number },
  i: number,
  j: number,
): { x0: number; z0: number; w: number; d: number } {
  const edge = (STREET_WIDTH - 1) / 2 + 1;
  return {
    x0: site.x + i * BLOCK_PITCH + edge,
    z0: site.z + j * BLOCK_PITCH + edge,
    w: BLOCK_SIZE,
    d: BLOCK_SIZE,
  };
}

/** How far out a block sits, counted in rings from the middle four. */
export function ringOf(i: number, j: number): number {
  return Math.max(Math.abs(i + 0.5), Math.abs(j + 0.5)) - 0.5;
}

/** Every block of a town, zoned, with the stage that builds it.
 *
 *  The zoning is a rule and not a roll, so it reads the same in every town: the square in
 *  the middle, shops around the square, and homes beyond them — with the works pushed to
 *  the far edge, on a side the seed picks. That last one is the only randomness, and it is
 *  what stops every town being the same picture.
 *
 *  Order matters: this is the order blocks are built in, so it decides what a town looks
 *  like half grown. */
export function townBlocks(seed: number, site: { x: number; z: number }): TownBlock[] {
  const rng = mulberry32(hashInts(seed ^ 0x70b7, site.x, site.z));
  // Which way the works face. A quarter of the compass, so the industry of a town is
  // always together rather than scattered a block at a time.
  const worksSide = Math.floor(rng() * 4);
  const out: TownBlock[] = [];
  for (let j = GRID_LOW; j <= GRID_HIGH; j++) {
    for (let i = GRID_LOW; i <= GRID_HIGH; i++) {
      const ring = ringOf(i, j);
      out.push({
        i,
        j,
        ...blockRect(site, i, j),
        ring,
        zone: zoneFor(i, j, ring, worksSide),
        stage: 0,
      });
    }
  }
  // Middle first, then outwards, so a town that has only just started is a square with
  // shops on it rather than a scatter of houses with a hole in the middle.
  out.sort((a, b) => a.ring - b.ring || order(a) - order(b));
  out.forEach((block, index) => {
    block.stage = stageFor(index);
  });
  return out;
}

/** What a block is for.
 *
 *  Read off the grid rather than rolled, apart from which side the works are on. A town
 *  where the zoning was random would be a town the player has to survey rather than one
 *  they can read. */
function zoneFor(i: number, j: number, ring: number, worksSide: number): BuildingUse {
  if (i === PLAZA_I && j === PLAZA_J) return 'civic';
  if (ring < 1) return 'commercial';
  // The outer ring is homes, except on the quarter the works have taken.
  return onWorksSide(i, j, worksSide) ? 'industrial' : 'residential';
}

/** Whether an outer block falls on the quarter the works were given. The four quarters are
 *  north, east, south and west of the middle; a corner block counts for the side it leans
 *  towards, so a works district is a solid three blocks rather than a broken line. */
function onWorksSide(i: number, j: number, worksSide: number): boolean {
  const dx = i + 0.5;
  const dz = j + 0.5;
  const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
  return side === worksSide;
}

/** A stable order inside a ring: clockwise from the north west, so the sequence a town
 *  fills in is the same every time rather than whatever the loop happened to do. */
function order(block: TownBlock): number {
  return Math.atan2(block.j + 0.5, block.i + 0.5);
}

/** Which growth stage raises the `n`-th block.
 *
 *  The middle four and the first two beyond them stand from the start; everything after
 *  that is earned. Spread so each stage is a visible change — two or three buildings'
 *  worth of new street frontage — rather than one house nobody notices. */
export function stageFor(index: number): number {
  if (index < INITIAL_BLOCKS) return 0;
  return Math.min(MAX_TOWN_STAGE, 1 + Math.floor((index - INITIAL_BLOCKS) / BLOCKS_PER_STAGE));
}

/** Blocks a town is generated with, and how many each stage adds after that. */
export const INITIAL_BLOCKS = 6;
export const BLOCKS_PER_STAGE = 3;
/** The last stage that builds anything. Matches the ranks in `villages.ts`. */
export const MAX_TOWN_STAGE = 4;

/** How many new town blocks one development stage attempts to raise. */
export const GROWTH_BLOCKS_PER_STAGE = BLOCKS_PER_STAGE;
/** Extra rings searched when the expected frontier happens to be cliffs or water. */
export const GROWTH_SEARCH_RINGS = 3;

/** The side reserved for a compact belt of fields. Buildings grow around the other
 *  three sides, so farms remain recognisably farms instead of becoming isolated scraps
 *  between later houses. 0 north, then clockwise. */
export function farmSideFor(seed: number, site: { x: number; z: number }): number {
  return hashInts(seed ^ 0x4fa21, site.x, site.z) & 3;
}

export type TownPlotSurvey = (plot: { x0: number; z0: number; w: number; d: number }) => boolean;

/** Blocks raised by one arbitrary growth stage.
 *
 *  Unlike `townBlocks`, this has no outer grid boundary. It walks square rings forever,
 *  skips the agricultural side from the second ring onward, and takes the next three
 *  usable plots. A bounded three-ring detour makes a town search around a local cliff
 *  without letting one stage teleport a district across a mountain range. */
export function townGrowthBlocks(
  seed: number,
  site: { x: number; z: number },
  stage: number,
  survey?: TownPlotSurvey,
): TownBlock[] {
  if (stage <= 0) return [];
  // Keep the authored five-rank town byte-for-byte stable. Infinite expansion begins
  // outside that complete 4x4 core at stage five.
  if (stage <= MAX_TOWN_STAGE) {
    return townBlocks(seed, site).filter(
      (block) => block.stage === stage && (!survey || survey(block)),
    );
  }
  const worksSide = Math.floor(mulberry32(hashInts(seed ^ 0x70b7, site.x, site.z))() * 4);
  const farmSide = farmSideFor(seed, site);
  const core = new Set(townBlocks(seed, site).map((block) => `${block.i},${block.j}`));
  const wantedThrough = (stage - MAX_TOWN_STAGE) * GROWTH_BLOCKS_PER_STAGE;
  let expectedRing = 2;
  let eligible = 0;
  while (eligible < wantedThrough) {
    const low = -expectedRing - 1;
    const high = expectedRing;
    for (let j = low; j <= high; j++) {
      for (let i = low; i <= high; i++) {
        if (ringOf(i, j) !== expectedRing || sideOf(i, j) === farmSide) continue;
        eligible++;
      }
    }
    expectedRing++;
  }
  const candidates: TownBlock[] = [];
  for (let ring = 0; ring <= expectedRing - 1 + GROWTH_SEARCH_RINGS; ring++) {
    const low = -ring - 1;
    const high = ring;
    const around: TownBlock[] = [];
    for (let j = low; j <= high; j++) {
      for (let i = low; i <= high; i++) {
        if (ringOf(i, j) !== ring) continue;
        if (ring >= 2 && !survey && sideOf(i, j) === farmSide) continue;
        const plot = blockRect(site, i, j);
        if (!core.has(`${i},${j}`) && survey && !survey(plot)) continue;
        around.push({
          i,
          j,
          ...plot,
          ring,
          zone: zoneFor(i, j, ring, worksSide),
          stage: 0,
        });
      }
    }
    around.sort((a, b) => order(a) - order(b));
    candidates.push(...around);
  }
  // The complete authored 4x4 core belongs to stages zero through four. Expansion starts
  // beyond it, so none of those stable plots participates in the open-ended sequence.
  const growth = candidates.filter((block) => !core.has(`${block.i},${block.j}`));
  const start = (stage - MAX_TOWN_STAGE - 1) * GROWTH_BLOCKS_PER_STAGE;
  return growth.slice(start, start + GROWTH_BLOCKS_PER_STAGE).map((block) => ({ ...block, stage }));
}

function sideOf(i: number, j: number): number {
  const dx = i + 0.5;
  const dz = j + 0.5;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
}

/** Every street column of a town, as the lines they run along.
 *
 *  Returned as spans rather than cells: a town has about a thousand street columns and the
 *  caller wants to pave them, not to hold them all in a list first. */
export function townStreets(site: { x: number; z: number }): {
  x0: number;
  z0: number;
  w: number;
  d: number;
}[] {
  const half = (STREET_WIDTH - 1) / 2;
  const first = GRID_LOW * BLOCK_PITCH;
  const last = (GRID_HIGH + 1) * BLOCK_PITCH;
  const length = last - first + STREET_WIDTH;
  const out: { x0: number; z0: number; w: number; d: number }[] = [];
  for (let i = GRID_LOW; i <= GRID_HIGH + 1; i++) {
    const line = i * BLOCK_PITCH;
    // North-south, then east-west. They overlap at the crossings, which is what a
    // crossing is; whoever writes them simply writes the same column twice.
    out.push({ x0: site.x + line - half, z0: site.z + first - half, w: STREET_WIDTH, d: length });
    out.push({ x0: site.x + first - half, z0: site.z + line - half, w: length, d: STREET_WIDTH });
  }
  return out;
}

/** How far a town's streets reach from its middle. What the plateau has to cover. */
export function townExtent(): number {
  return (GRID_HIGH + 1) * BLOCK_PITCH + (STREET_WIDTH - 1) / 2;
}

/** Whether a column is part of a town's street grid.
 *
 *  What "a road has arrived at the town" means. The old village had two streets and the
 *  answer could be synthesised from a pair of clamps; a grid has eight, and guessing at
 *  them from the outside is how a road ends up called connected while it stops in
 *  somebody's garden. */
export function onStreet(site: { x: number; z: number }, x: number, z: number): boolean {
  const half = (STREET_WIDTH - 1) / 2;
  const dx = x - site.x;
  const dz = z - site.z;
  const extent = townExtent();
  if (Math.abs(dx) > extent || Math.abs(dz) > extent) return false;
  return onLine(dx, half) || onLine(dz, half);
}

/** Whether an offset from the middle falls on one of the grid's street lines. */
function onLine(d: number, half: number): boolean {
  const nearest = Math.round(d / BLOCK_PITCH);
  if (nearest < GRID_LOW || nearest > GRID_HIGH + 1) return false;
  return Math.abs(d - nearest * BLOCK_PITCH) <= half;
}

/** The street cell of a town nearest a point: where a road has to arrive, and so where one
 *  worth building starts.
 *
 *  For a point outside the town this lands on the perimeter, which is the street a road
 *  from out there would meet first. For a point inside it is the nearest street line,
 *  which is never more than half a block away. */
export function nearestStreet(
  site: { x: number; z: number },
  x: number,
  z: number,
): { x: number; z: number } {
  const extent = townExtent();
  const clamp = (v: number): number => Math.max(-extent, Math.min(extent, v));
  const dx = clamp(x - site.x);
  const dz = clamp(z - site.z);
  // Snapping one axis onto a street line puts the point on a street; the nearer of the two
  // is the one a road would actually meet.
  const snapX = { x: snapToLine(dx), z: dz };
  const snapZ = { x: dx, z: snapToLine(dz) };
  const useX = Math.hypot(site.x + snapX.x - x, site.z + snapX.z - z)
    <= Math.hypot(site.x + snapZ.x - x, site.z + snapZ.z - z);
  const at = useX ? snapX : snapZ;
  return { x: site.x + at.x, z: site.z + at.z };
}

function snapToLine(d: number): number {
  const nearest = Math.max(GRID_LOW, Math.min(GRID_HIGH + 1, Math.round(d / BLOCK_PITCH)));
  return nearest * BLOCK_PITCH;
}
