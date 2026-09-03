import { describe, expect, it } from 'vitest';
import {
  FACE_NY,
  FACE_PX,
  FACE_PY,
  buildCylinderTemplate,
  buildSlabTemplate,
  buildSlopeTemplate,
} from '../render/roundedTemplates';
import { BLOCKS, Block, blockDef } from '../world/blocks';
import { itemDef } from '../game/items';

describe('architectural block shapes', () => {
  it('builds a triangular roof prism with a true diagonal normal', () => {
    const slope = buildSlopeTemplate('east');
    expect(slope.triangleCount).toBe(8);
    expect(Math.min(...slope.positions)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...slope.positions)).toBeLessThanOrEqual(0.5);

    let diagonal = false;
    for (let i = 0; i < slope.normals.length; i += 3) {
      const nx = slope.normals[i];
      const ny = slope.normals[i + 1];
      if (nx < -0.7 && ny > 0.7) diagonal = true;
    }
    expect(diagonal).toBe(true);
  });

  it('rotates the high edge into each roof direction', () => {
    const highestAt = (direction: 'east' | 'west' | 'south' | 'north') => {
      const slope = buildSlopeTemplate(direction);
      const out: [number, number][] = [];
      for (let i = 0; i < slope.positions.length; i += 3) {
        if (slope.positions[i + 1] > 0.49) out.push([slope.positions[i], slope.positions[i + 2]]);
      }
      return out;
    };
    expect(highestAt('east').every(([x]) => x > 0.49)).toBe(true);
    expect(highestAt('west').every(([x]) => x < -0.49)).toBe(true);
    expect(highestAt('south').every(([, z]) => z > 0.49)).toBe(true);
    expect(highestAt('north').every(([, z]) => z < -0.49)).toBe(true);
  });

  it('omits roof faces hidden by complete neighbours', () => {
    expect(buildSlopeTemplate('east', 1 << FACE_PX).triangleCount).toBe(6);
    expect(buildSlopeTemplate('east', 1 << FACE_NY).triangleCount).toBe(6);
  });

  it('builds a twelve-sided cylinder and removes covered caps', () => {
    const open = buildCylinderTemplate(12);
    const cappedOff = buildCylinderTemplate(12, 0.34, (1 << FACE_PY) | (1 << FACE_NY));
    expect(open.triangleCount).toBe(48);
    expect(cappedOff.triangleCount).toBe(24);
    for (let i = 0; i < open.positions.length; i += 3) {
      expect(Math.hypot(open.positions[i], open.positions[i + 2])).toBeLessThanOrEqual(0.341);
    }
  });

  it('builds a slab that fills the bottom half of its cell', () => {
    const slab = buildSlabTemplate();
    expect(slab.triangleCount).toBe(12);
    for (let i = 1; i < slab.positions.length; i += 3) {
      expect(slab.positions[i]).toBeGreaterThanOrEqual(-0.5);
      expect(slab.positions[i]).toBeLessThanOrEqual(0);
    }
  });

  it('keeps a slab\'s top face even when the cell above it is filled', () => {
    // The neighbour above covers the cell, not the slab. Culling that face would
    // leave a hole to see the world through from any lower angle.
    expect(buildSlabTemplate(1 << FACE_PY).triangleCount).toBe(12);
    expect(buildSlabTemplate(1 << FACE_NY).triangleCount).toBe(10);
  });

  it('maps a slab onto the lower half of its own texture', () => {
    // `sharp` is what the mesher turns into UVs, and it is normalised to the unit
    // cell — so a course of slabs lines up with the wall it runs along instead of
    // stretching the whole tile over half a block.
    const slab = buildSlabTemplate(1 << FACE_PY);
    for (let i = 0; i < slab.sharp.length; i += 3) {
      const sideFace = Math.abs(slab.normals[i + 1]) < 0.5;
      if (!sideFace) continue;
      expect(slab.sharp[i + 1] + 0.5).toBeGreaterThanOrEqual(0);
      expect(slab.sharp[i + 1] + 0.5).toBeLessThanOrEqual(0.5001);
    }
  });
});

describe('the architecture palette', () => {
  it('gives every block a definition, a texture and a drop that exists', () => {
    for (const def of BLOCKS) {
      expect(def.tex.all ?? def.tex.side ?? def.tex.top ?? (def.id === Block.AIR ? 'air' : ''))
        .not.toBe('');
    }
  });

  it('leaves the wedges, columns and slabs see-through so their cells light correctly', () => {
    for (const def of BLOCKS) {
      if (def.shape === 'cube') continue;
      expect(`${def.name}: ${def.opaque}`).toBe(`${def.name}: false`);
    }
  });

  it('drops something that exists, for everything that drops at all', () => {
    // `mining` falls back to the block's own name when no drop is named, so a new
    // block without an item quietly drops nothing at all when it is broken.
    for (const def of BLOCKS) {
      if (def.drop === null) continue;
      const dropped = def.drop ?? def.name;
      expect(`${def.name} -> ${dropped}: ${itemDef(dropped) !== undefined}`)
        .toBe(`${def.name} -> ${dropped}: true`);
    }
  });

  it('keeps the new glazing transparent rather than solid colour', () => {
    for (const id of [Block.TINTED_GLASS, Block.STAINED_GLASS]) {
      expect(blockDef(id).opaque).toBe(false);
    }
    expect(blockDef(Block.LANTERN).light).toBeGreaterThan(10);
  });
});
