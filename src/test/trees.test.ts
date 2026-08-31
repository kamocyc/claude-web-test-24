import { describe, expect, it } from 'vitest';
import { buildTreeModels } from '../render/treeModels';
import { buildTemplateSet } from '../render/roundedTemplates';
import { TerrainGenerator } from '../world/generation/terrain';
import { TreeStore, type TreeInstance } from '../world/trees';

function populated(seed = 424242): { store: TreeStore; first: TreeInstance } {
  const generator = new TerrainGenerator(seed);
  const store = new TreeStore(generator, buildTreeModels(seed));
  let first: TreeInstance | undefined;
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
    store.ensureChunk(x, z);
    if (!first) first = [...store.chunks].flat()[0];
  }
  if (!first) throw new Error('test seed did not produce a tree');
  return { store, first };
}

describe('object trees', () => {
  it('uses stable ids independent of chunk load order', () => {
    const seed = 99881;
    const a = new TreeStore(new TerrainGenerator(seed), buildTreeModels(seed));
    const b = new TreeStore(new TerrainGenerator(seed), buildTreeModels(seed));
    const chunks = [[-2, -1], [0, 0], [1, 2], [-1, 1]] as const;
    for (const [x, z] of chunks) a.ensureChunk(x, z);
    for (const [x, z] of [...chunks].reverse()) b.ensureChunk(x, z);
    const ids = (store: TreeStore): string[] => [...store.chunks].flat().map((tree) => tree.id).sort();
    expect(ids(a)).toEqual(ids(b));
  });

  it('collides only with the trunk and targets the canopy as one object', () => {
    const { store, first } = populated();
    expect(store.intersectsBox({ x: first.x, y: first.y, z: first.z, width: 0.5, height: 1.8 })).toBe(true);
    const model = store.model(first);
    expect(store.intersectsBox({ x: first.x + model.canopyRadius, y: first.y + model.canopyY, z: first.z, width: 0.2, height: 0.2 })).toBe(false);
    const hit = store.raycast(
      { x: first.x, y: first.y + model.canopyY * first.scale, z: first.z - 8 },
      { x: 0, y: 0, z: 1 },
      12,
    );
    expect(hit?.tree.id).toBe(first.id);
  });

  it('persists removal as soon as a tree starts falling', () => {
    const { store, first } = populated();
    expect(store.fell(first, 0)).toBe(true);
    expect(store.removedIds).toContain(first.id);
    expect(store.intersectsBox({ x: first.x, y: first.y, z: first.z, width: 0.5, height: 1.8 })).toBe(false);
    const drops = store.update(2);
    expect(drops).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id, logs: 4 })]));
  });
});

describe('rounded block templates', () => {
  it('builds finite near and far LODs for all neighbour masks', () => {
    const near = buildTemplateSet({ radius: 0.18, segments: 3 });
    const far = buildTemplateSet({ radius: 0.18, segments: 1 });
    expect(near).toHaveLength(64);
    expect(far).toHaveLength(64);
    expect(near[63].indices.length).toBe(0);
    expect(near[0].indices.length).toBeGreaterThan(far[0].indices.length);
    for (const template of [...near, ...far]) {
      expect([...template.positions, ...template.normals, ...template.sharp].every(Number.isFinite)).toBe(true);
      expect(template.indices.length % 3).toBe(0);
    }
  });
});
