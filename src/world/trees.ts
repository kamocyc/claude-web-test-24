import type * as THREE from 'three';
import type { EntityBox, ObjectCollider } from '../core/aabb';
import { hashFloat } from '../core/rng';
import type { TreeModel, TreeSpecies } from '../render/treeModels';
import { Block } from './blocks';
import { CHUNK_SIZE, chunkKey, toChunkCoord } from './chunk';
import { biomeDef } from './generation/biome';
import type { TerrainGenerator } from './generation/terrain';

export type TreeId = string;

export interface TreeInstance {
  id: TreeId;
  species: TreeSpecies;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  hue: number;
  fall: number;
  fallYaw: number;
}

export interface TreeRayHit {
  tree: TreeInstance;
  distance: number;
}

export interface FelledTree {
  id: TreeId;
  x: number;
  y: number;
  z: number;
  logs: number;
}

export interface TreeMapSample {
  height: number;
  block: typeof Block.OAK_LEAVES | typeof Block.BIRCH_LEAVES | typeof Block.SPRUCE_LEAVES;
}

const CELL = 4;
const FALL_SECONDS = 1.4;

export class TreeStore implements ObjectCollider {
  private readonly byChunk = new Map<string, TreeInstance[]>();
  private readonly removed = new Set<TreeId>();
  private falling = 0;
  version = 0;

  constructor(
    private readonly generator: TerrainGenerator,
    private readonly models: Record<TreeSpecies, TreeModel[]>,
    removed: Iterable<TreeId> = [],
  ) {
    for (const id of removed) this.removed.add(id);
  }

  get removedIds(): readonly TreeId[] {
    return [...this.removed].sort();
  }

  get chunks(): Iterable<TreeInstance[]> {
    return this.byChunk.values();
  }

  model(tree: TreeInstance): TreeModel {
    return this.models[tree.species][tree.variant];
  }

  ensureChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.byChunk.has(key)) return;
    const trees: TreeInstance[] = [];
    const u0 = Math.floor((cx * CHUNK_SIZE) / CELL);
    const u1 = Math.floor((cx * CHUNK_SIZE + CHUNK_SIZE - 1) / CELL);
    const v0 = Math.floor((cz * CHUNK_SIZE) / CELL);
    const v1 = Math.floor((cz * CHUNK_SIZE + CHUNK_SIZE - 1) / CELL);
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        const tree = this.candidate(u, v);
        if (!tree || this.removed.has(tree.id)) continue;
        if (toChunkCoord(tree.x) === cx && toChunkCoord(tree.z) === cz) trees.push(tree);
      }
    }
    this.byChunk.set(key, trees);
    this.version++;
  }

  unloadChunk(cx: number, cz: number): void {
    if (this.byChunk.delete(chunkKey(cx, cz))) this.version++;
  }

  private candidate(u: number, v: number): TreeInstance | null {
    const seed = this.generator.seed;
    const x = u * CELL + 1 + Math.floor(hashFloat(seed + 613, u, v) * (CELL - 1));
    const z = v * CELL + 1 + Math.floor(hashFloat(seed + 617, u, v) * (CELL - 1));
    const biome = biomeDef(this.generator.biomeAt(x, z));
    if (biome.treeDensity <= 0 || hashFloat(seed + 601, u, v) >= biome.treeDensity / 16) return null;
    if (this.generator.isInsideVillage(x, z)) return null;
    const heights = [
      this.generator.height(x - 1, z - 1), this.generator.height(x, z - 1),
      this.generator.height(x - 1, z), this.generator.height(x, z),
    ];
    if (heights.some((height) => height !== heights[0])) return null;
    const localDefs = [
      biomeDef(this.generator.biomeAt(x - 1, z - 1)), biomeDef(this.generator.biomeAt(x, z - 1)),
      biomeDef(this.generator.biomeAt(x - 1, z)), biomeDef(this.generator.biomeAt(x, z)),
    ];
    if (localDefs.some((def) => def.surface !== biome.surface)) return null;
    if (biome.surface !== Block.GRASS && biome.surface !== Block.SNOW) return null;
    const species: TreeSpecies = biome.treeLog === Block.SPRUCE_LOG
      ? 'spruce'
      : biome.treeLog === Block.BIRCH_LOG ? 'birch' : 'oak';
    return {
      id: `${u},${v}`,
      species,
      variant: Math.floor(hashFloat(seed + 631, u, v) * this.models[species].length),
      x,
      y: heights[0] + 1,
      z,
      yaw: hashFloat(seed + 641, u, v) * Math.PI * 2,
      scale: 0.86 + hashFloat(seed + 643, u, v) * 0.34,
      hue: (hashFloat(seed + 647, u, v) - 0.5) * 0.08,
      fall: 0,
      fallYaw: 0,
    };
  }

  intersectsBox(box: EntityBox): boolean {
    const half = box.width / 2;
    const minX = box.x - half;
    const maxX = box.x + half;
    const minZ = box.z - half;
    const maxZ = box.z + half;
    for (const tree of this.near(minX, minZ, maxX, maxZ)) {
      if (tree.fall > 0) continue;
      const model = this.model(tree);
      if (box.y + box.height <= tree.y || box.y >= tree.y + model.canopyY * tree.scale) continue;
      const radius = model.trunkRadius * tree.scale * 1.15;
      const nearestX = Math.max(minX, Math.min(tree.x, maxX));
      const nearestZ = Math.max(minZ, Math.min(tree.z, maxZ));
      const dx = tree.x - nearestX;
      const dz = tree.z - nearestZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  raycast(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): TreeRayHit | null {
    const endX = origin.x + direction.x * maxDistance;
    const endZ = origin.z + direction.z * maxDistance;
    let best: TreeRayHit | null = null;
    for (const tree of this.near(Math.min(origin.x, endX), Math.min(origin.z, endZ), Math.max(origin.x, endX), Math.max(origin.z, endZ))) {
      if (tree.fall > 0) continue;
      const model = this.model(tree);
      const trunk = intersectCylinder(origin, direction, tree.x, tree.z, tree.y, tree.y + model.canopyY * tree.scale, Math.max(0.3, model.trunkRadius * tree.scale * 1.5));
      const canopy = intersectSphere(origin, direction, tree.x, tree.y + model.canopyY * tree.scale, tree.z, model.canopyRadius * tree.scale);
      for (const distance of [trunk, canopy]) {
        if (distance === null || distance < 0 || distance > maxDistance) continue;
        if (!best || distance < best.distance) best = { tree, distance };
      }
    }
    return best;
  }

  fell(tree: TreeInstance, fallYaw: number): boolean {
    if (tree.fall > 0 || this.removed.has(tree.id)) return false;
    this.removed.add(tree.id);
    tree.fall = Number.EPSILON;
    tree.fallYaw = fallYaw;
    this.falling++;
    this.version++;
    return true;
  }

  update(dt: number): FelledTree[] {
    if (this.falling === 0) return [];
    const completed: FelledTree[] = [];
    let active = 0;
    for (const [key, trees] of this.byChunk) {
      for (const tree of trees) {
        if (tree.fall <= 0) continue;
        tree.fall += dt;
        if (tree.fall < FALL_SECONDS) {
          active++;
          continue;
        }
        completed.push({ id: tree.id, x: tree.x, y: tree.y, z: tree.z, logs: this.model(tree).logs });
      }
      const standing = trees.filter((tree) => tree.fall < FALL_SECONDS);
      if (standing.length !== trees.length) this.byChunk.set(key, standing);
    }
    this.falling = active;
    this.version++;
    return completed;
  }

  survey(x: number, z: number, radius: number): { wood: number; density: number } {
    let wood = 0;
    const columns = new Set<string>();
    for (const tree of this.near(x - radius, z - radius, x + radius, z + radius)) {
      if (tree.fall > 0 || (tree.x - x) ** 2 + (tree.z - z) ** 2 > radius * radius) continue;
      const model = this.model(tree);
      wood += model.logs;
      const r = Math.max(1, Math.round(model.canopyRadius * tree.scale));
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz <= r * r) columns.add(`${tree.x + dx},${tree.z + dz}`);
      }
    }
    const scanned = Math.PI * radius * radius;
    return { wood, density: scanned > 0 ? Math.min(1, columns.size / scanned) : 0 };
  }

  /** Highest canopy over a map column. Canopies are visual, not collision geometry. */
  canopyAt(x: number, z: number): TreeMapSample | null {
    let best: TreeMapSample | null = null;
    for (const tree of this.near(x, z, x, z)) {
      if (tree.fall > 0) continue;
      const model = this.model(tree);
      const radius = model.canopyRadius * tree.scale;
      if ((tree.x - x) ** 2 + (tree.z - z) ** 2 > radius * radius) continue;
      const block = tree.species === 'spruce'
        ? Block.SPRUCE_LEAVES
        : tree.species === 'birch' ? Block.BIRCH_LEAVES : Block.OAK_LEAVES;
      const sample = { height: Math.floor(tree.y + (model.canopyY + model.canopyRadius) * tree.scale), block };
      if (!best || sample.height > best.height) best = sample;
    }
    return best;
  }

  private *near(minX: number, minZ: number, maxX: number, maxZ: number): Iterable<TreeInstance> {
    const cx0 = toChunkCoord(minX) - 1;
    const cx1 = toChunkCoord(maxX) + 1;
    const cz0 = toChunkCoord(minZ) - 1;
    const cz1 = toChunkCoord(maxZ) + 1;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      for (const tree of this.byChunk.get(chunkKey(cx, cz)) ?? []) yield tree;
    }
  }
}

function intersectCylinder(origin: THREE.Vector3Like, direction: THREE.Vector3Like, cx: number, cz: number, minY: number, maxY: number, radius: number): number | null {
  const dx = origin.x - cx;
  const dz = origin.z - cz;
  const a = direction.x * direction.x + direction.z * direction.z;
  if (a < 1e-8) return null;
  const b = 2 * (dx * direction.x + dz * direction.z);
  const c = dx * dx + dz * dz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    const y = origin.y + direction.y * t;
    if (t >= 0 && y >= minY && y <= maxY) return t;
  }
  return null;
}

function intersectSphere(origin: THREE.Vector3Like, direction: THREE.Vector3Like, cx: number, cy: number, cz: number, radius: number): number | null {
  const dx = origin.x - cx;
  const dy = origin.y - cy;
  const dz = origin.z - cz;
  const b = 2 * (dx * direction.x + dy * direction.y + dz * direction.z);
  const c = dx * dx + dy * dy + dz * dz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const near = (-b - root) / 2;
  return near >= 0 ? near : (-b + root) / 2;
}
