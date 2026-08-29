import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type Rng } from '../core/rng';
import { PASTEL } from './palette';

export const TREE_SPECIES = ['oak', 'birch', 'spruce'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export interface TreeModel {
  readonly geometry: THREE.BufferGeometry;
  readonly height: number;
  readonly trunkRadius: number;
  readonly canopyY: number;
  readonly canopyRadius: number;
  readonly logs: number;
}

function range(rng: Rng, low: number, high: number): number {
  return low + (high - low) * rng();
}

function paint(geometry: THREE.BufferGeometry, bottom: string, top = bottom): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color(bottom);
  const high = new THREE.Color(top);
  const color = new THREE.Color();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) - box.min.y) / Math.max(0.001, box.max.y - box.min.y), 0, 1);
    color.copy(low).lerp(high, 0.25 + t * 0.75);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function translated(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const compatible = parts.map((part) => part.index ? part.toNonIndexed() : part);
  for (const part of compatible) {
    part.deleteAttribute('uv');
    part.deleteAttribute('uv1');
  }
  const geometry = BufferGeometryUtils.mergeGeometries(compatible, false);
  if (!geometry) throw new Error('tree geometry could not be merged');
  geometry.computeBoundingSphere();
  return geometry;
}

function roundTree(rng: Rng, birch: boolean): TreeModel {
  const trunkHeight = range(rng, 2.35, 3.15);
  const trunkRadius = range(rng, 0.24, 0.34);
  const canopyY = trunkHeight + range(rng, 0.3, 0.6);
  const canopyRadius = range(rng, 1.25, 1.65);
  const trunk = paint(
    translated(new THREE.CylinderGeometry(trunkRadius * 0.75, trunkRadius, trunkHeight, 7, 3), 0, trunkHeight / 2, 0),
    birch ? PASTEL.birchDeep : PASTEL.barkDeep,
    birch ? PASTEL.birch : PASTEL.barkLight,
  );
  const leafLow = birch ? '#73c96a' : PASTEL.leafDeep;
  const leafHigh = birch ? '#b5ed8b' : PASTEL.leafLight;
  const parts: THREE.BufferGeometry[] = [trunk];
  const count = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng() * 0.5;
    const radius = canopyRadius * range(rng, 0.64, 0.9);
    const puff = new THREE.IcosahedronGeometry(radius, 1);
    puff.scale(1, range(rng, 0.72, 0.94), 1);
    translated(puff, Math.cos(angle) * canopyRadius * 0.32, canopyY + range(rng, -0.25, 0.28), Math.sin(angle) * canopyRadius * 0.32);
    parts.push(paint(puff, leafLow, leafHigh));
  }
  return {
    geometry: merge(parts),
    height: canopyY + canopyRadius,
    trunkRadius,
    canopyY,
    canopyRadius: canopyRadius * 1.3,
    logs: 4,
  };
}

function spruceTree(rng: Rng): TreeModel {
  const height = range(rng, 4.2, 5.6);
  const trunkRadius = range(rng, 0.22, 0.29);
  const trunk = paint(
    translated(new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, height, 7, 3), 0, height / 2, 0),
    PASTEL.barkDeep,
    PASTEL.bark,
  );
  const parts: THREE.BufferGeometry[] = [trunk];
  const tiers = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const t = i / Math.max(1, tiers - 1);
    const radius = range(rng, 1.6, 2.05) * (1 - t * 0.48);
    const skirt = new THREE.ConeGeometry(radius, range(rng, 1.65, 2.0), 8, 2);
    skirt.rotateY(rng() * Math.PI * 2);
    translated(skirt, 0, height * (0.3 + t * 0.2), 0);
    parts.push(paint(skirt, PASTEL.pineDeep, PASTEL.pineLight));
  }
  return {
    geometry: merge(parts),
    height: height * 1.08,
    trunkRadius,
    canopyY: height * 0.58,
    canopyRadius: 2.15,
    logs: 4,
  };
}

export function buildTreeModels(seed: number): Record<TreeSpecies, TreeModel[]> {
  const result = {} as Record<TreeSpecies, TreeModel[]>;
  for (let speciesIndex = 0; speciesIndex < TREE_SPECIES.length; speciesIndex++) {
    const species = TREE_SPECIES[speciesIndex];
    result[species] = Array.from({ length: 4 }, (_, variant) => {
      const rng = mulberry32(seed + speciesIndex * 977 + variant * 131);
      return species === 'spruce' ? spruceTree(rng) : roundTree(rng, species === 'birch');
    });
  }
  return result;
}
