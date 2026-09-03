import { describe, expect, it } from 'vitest';
import { Block, type BlockId } from '../world/blocks';
import {
  SLATE_ROOF,
  box, corners, ellipse, fill, gableRoof, hipRoof, opening, post, pyramid, ring, slabAt, steps, walls,
  type Brush,
} from '../world/generation/landmarks/brush';

/** A brush that keeps what it is given, so a drawing can be asserted about. */
function sheet(): Brush & { cells: Map<string, BlockId>; at(x: number, y: number, z: number): BlockId } {
  const cells = new Map<string, BlockId>();
  return {
    cells,
    at: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
    set: (x, y, z, block) => { cells.set(`${x},${y},${z}`, block); },
    get: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
  };
}

describe('drawing a building', () => {
  it('puts the horizontal pair first, everywhere', () => {
    // The one convention every primitive keeps, because the alternative is what
    // happened the first time: a column drawn along the wrong axis, silently.
    const paper = sheet();
    post(paper, 2, 5, 10, 12, Block.MARBLE);
    expect(paper.at(2, 10, 5)).toBe(Block.MARBLE);
    expect(paper.at(2, 12, 5)).toBe(Block.MARBLE);
    expect(paper.at(2, 13, 5)).toBe(Block.AIR);
  });

  it('walls a box without filling it', () => {
    const paper = sheet();
    walls(paper, box(0, 0, 0, 4, 2, 4), Block.BRICKS);
    expect(paper.at(0, 1, 2)).toBe(Block.BRICKS);
    expect(paper.at(4, 1, 2)).toBe(Block.BRICKS);
    expect(paper.at(2, 1, 2)).toBe(Block.AIR);
    // Including the top and bottom courses: a wall is the whole height of the box.
    expect(paper.at(0, 0, 0)).toBe(Block.BRICKS);
    expect(paper.at(0, 2, 0)).toBe(Block.BRICKS);
  });

  it('draws a ring and a floor at one level only', () => {
    const paper = sheet();
    ring(paper, 3, 0, 0, 2, 2, Block.MARBLE_SLAB);
    slabAt(paper, 4, 0, 0, 2, 2, Block.CONCRETE);
    expect(paper.at(1, 3, 1)).toBe(Block.AIR);
    expect(paper.at(1, 3, 0)).toBe(Block.MARBLE_SLAB);
    expect(paper.at(1, 4, 1)).toBe(Block.CONCRETE);
  });

  it('closes a gable to a ridge and wedges only the slopes', () => {
    const paper = sheet();
    // Ridge along x over a span of 6 in z: three courses, ridge on the fourth.
    const ridge = gableRoof(paper, SLATE_ROOF, 0, 0, 5, 6, 10, 'x');
    expect(ridge).toBe(13);
    expect(paper.at(2, 10, 0)).toBe(Block.SLATE_ROOF_SOUTH);
    expect(paper.at(2, 10, 6)).toBe(Block.SLATE_ROOF_NORTH);
    expect(paper.at(2, 10, 3)).toBe(Block.SLATE);
    // Every course is a closed band, so there is no daylight through the roof.
    for (let y = 10; y <= ridge; y++) {
      const inset = y - 10;
      for (let z = inset; z <= 6 - inset; z++) expect(paper.at(2, y, z)).not.toBe(Block.AIR);
    }
  });

  it('falls a hip roof away on all four sides', () => {
    const paper = sheet();
    const apex = hipRoof(paper, SLATE_ROOF, 0, 0, 6, 6, 20);
    expect(apex).toBeGreaterThan(20);
    expect(paper.at(3, 20, 0)).toBe(Block.SLATE_ROOF_SOUTH);
    expect(paper.at(0, 20, 3)).toBe(Block.SLATE_ROOF_EAST);
    // Corners belong to two slopes at once and stay solid rather than notched.
    expect(paper.at(0, 20, 0)).toBe(Block.SLATE);
    expect(paper.at(3, apex, 3)).not.toBe(Block.AIR);
  });

  it('steps a pyramid in to a point', () => {
    const paper = sheet();
    const top = pyramid(paper, 0, 0, 4, 4, 0, Block.MARBLE);
    expect(top).toBe(2);
    expect(paper.at(0, 0, 0)).toBe(Block.MARBLE);
    expect(paper.at(0, 1, 0)).toBe(Block.AIR);
    expect(paper.at(2, 2, 2)).toBe(Block.MARBLE);
  });

  it('frames an opening only where there is a wall to frame', () => {
    const paper = sheet();
    walls(paper, box(0, 0, 0, 6, 6, 0), Block.BRICKS);
    fill(paper, box(0, 0, 0, 6, 6, 0), Block.BRICKS);
    opening(paper, box(2, 2, 0, 4, 4, 0), Block.GLASS, Block.MARBLE);
    expect(paper.at(3, 3, 0)).toBe(Block.GLASS);
    expect(paper.at(1, 3, 0)).toBe(Block.MARBLE);
    expect(paper.at(3, 1, 0)).toBe(Block.MARBLE);
    // Nothing is framed into thin air in front of the wall.
    expect(paper.at(3, 3, -1)).toBe(Block.AIR);
  });

  it('rounds an ellipse and can leave it hollow', () => {
    const solid = sheet();
    ellipse(solid, 0, 0, 0, 4, 4, Block.MARBLE);
    expect(solid.at(0, 0, 0)).toBe(Block.MARBLE);
    expect(solid.at(4, 0, 0)).toBe(Block.MARBLE);
    expect(solid.at(3, 0, 3)).toBe(Block.AIR);
    const rim = sheet();
    ellipse(rim, 0, 0, 0, 4, 4, Block.MARBLE, true);
    expect(rim.at(4, 0, 0)).toBe(Block.MARBLE);
    expect(rim.at(0, 0, 0)).toBe(Block.AIR);
  });

  it('climbs a flight of steps one tread at a time', () => {
    const paper = sheet();
    steps(paper, 'z', 0, 3, 0, 1, 0, Block.MARBLE_SLAB, Block.MARBLE);
    expect(paper.at(0, 0, 0)).toBe(Block.MARBLE_SLAB);
    expect(paper.at(0, 1, 1)).toBe(Block.MARBLE_SLAB);
    expect(paper.at(0, 0, 1)).toBe(Block.MARBLE);
    expect(paper.at(0, 2, 2)).toBe(Block.MARBLE_SLAB);
  });

  it('posts the four corners of a rectangle and nothing between them', () => {
    const paper = sheet();
    corners(paper, 0, 0, 3, 3, 0, 2, Block.STONE_BRICKS);
    expect(paper.at(0, 1, 0)).toBe(Block.STONE_BRICKS);
    expect(paper.at(3, 1, 3)).toBe(Block.STONE_BRICKS);
    expect(paper.at(1, 1, 0)).toBe(Block.AIR);
  });
});
