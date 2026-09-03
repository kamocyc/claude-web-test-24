import { describe, expect, it } from 'vitest';
import { VERTEX } from '../render/chunkShader';

/**
 * The one thing about the water surface that can only be got wrong in a shader.
 *
 * The water sheet is meshed per chunk, and every vertex on a chunk border belongs to two
 * meshes at once. The swell in the vertex shader moves those vertices, so it has to move
 * both copies by the same amount — which means phasing it off the world position, since
 * the position attribute itself is chunk-local and starts again at every border. Phasing
 * off the attribute tore a hairline slot down every chunk boundary in the water, dashed
 * along its length as the two phases drifted in and out of step, with the river bed
 * showing through it.
 *
 * Nothing else in the suite can see this: it is not in the mesh, not in the block data,
 * and nothing runs a shader. So the shader source is read as text — a poor test of a
 * shader, and a much better one than none. It is why the shader lives in a module of
 * its own: reading it here must not drag three.js into the suite.
 */

/** The body of the vertex shader's `#ifdef WATER` block, comments stripped. */
function waterVertexBlock(): string {
  const start = VERTEX.indexOf('#ifdef WATER');
  const end = VERTEX.indexOf('#endif', start);
  expect(start, 'the vertex shader has no WATER block').toBeGreaterThan(0);
  return VERTEX.slice(start, end).replace(/\/\/[^\n]*/g, '');
}

describe('the water swell', () => {
  it('is phased off the world position, so it agrees across a chunk border', () => {
    const block = waterVertexBlock();
    expect(block).toContain('modelMatrix');
    // `position` is the chunk-local attribute. Anything derived from it directly is
    // measured from the corner of whichever chunk the vertex was meshed into.
    expect(/sin\([^)]*\bposition\./.test(block), 'the swell is phased off a chunk-local position')
      .toBe(false);
  });
});
