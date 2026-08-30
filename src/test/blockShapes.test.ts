import { describe, expect, it } from 'vitest';
import {
  FACE_NY,
  FACE_PX,
  FACE_PY,
  buildCylinderTemplate,
  buildSlopeTemplate,
} from '../render/roundedTemplates';

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
});
