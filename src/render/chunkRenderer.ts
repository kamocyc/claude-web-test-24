import * as THREE from 'three';
import { CHUNK_HEIGHT, CHUNK_SIZE, type Chunk, parseChunkKey } from '../world/chunk';
import type { World } from '../world/world';
import type { ChunkMaterials } from './materials';
import {
  PASS_CUTOUT,
  PASS_OPAQUE,
  PASS_TRANSPARENT,
  PASS_WATER,
  type GeometryArrays,
  buildChunkMesh,
} from './mesher';
import type { Atlas } from './textures';

function toGeometry(data: GeometryArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(data.light, 2));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(data.shade, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  // The bounds are known up front, so skip the full vertex scan. They are in the
  // mesh's own space: the mesh itself is positioned at the chunk origin.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(CHUNK_SIZE / 2, CHUNK_HEIGHT / 2, CHUNK_SIZE / 2),
    Math.hypot(CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_SIZE) / 2,
  );
  return geometry;
}

/** Owns the three.js meshes for loaded chunks and rebuilds them when blocks change. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh[]>();
  /** Water is tracked separately so it can be rebuilt without touching the terrain. */
  private readonly waterMeshes = new Map<string, THREE.Mesh>();

  constructor(
    private readonly world: World,
    private readonly atlas: Atlas,
    private readonly materials: ChunkMaterials,
  ) {
    this.group.name = 'chunks';
    this.group.matrixAutoUpdate = false;
  }

  get meshCount(): number {
    return this.meshes.size;
  }

  build(chunk: Chunk): void {
    this.remove(chunk.key);
    const data = buildChunkMesh(this.world, chunk, this.atlas);
    const created: THREE.Mesh[] = [];
    const passes = [
      { data: data[PASS_OPAQUE], material: this.materials.opaque, order: 0 },
      { data: data[PASS_CUTOUT], material: this.materials.cutout, order: 0 },
      { data: data[PASS_TRANSPARENT], material: this.materials.transparent, order: 1 },
    ];
    for (const pass of passes) {
      if (!pass.data) continue;
      created.push(this.addMesh(chunk, pass.data, pass.material, pass.order));
    }
    this.meshes.set(chunk.key, created);
    this.setWaterMesh(chunk, data[PASS_WATER]);
    chunk.dirty = false;
    chunk.waterDirty = false;
  }

  /** Rebuilds only the water surface of a chunk. */
  buildWater(chunk: Chunk): void {
    const data = buildChunkMesh(this.world, chunk, this.atlas, { waterOnly: true });
    this.setWaterMesh(chunk, data[PASS_WATER]);
    chunk.waterDirty = false;
  }

  private setWaterMesh(chunk: Chunk, data: GeometryArrays | null): void {
    const existing = this.waterMeshes.get(chunk.key);
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
      this.waterMeshes.delete(chunk.key);
    }
    if (!data) return;
    this.waterMeshes.set(chunk.key, this.addMesh(chunk, data, this.materials.water, 2));
  }

  private addMesh(
    chunk: Chunk,
    data: GeometryArrays,
    material: THREE.Material,
    renderOrder: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(toGeometry(data), material);
    mesh.position.set(chunk.originX, 0, chunk.originZ);
    mesh.renderOrder = renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  remove(key: string): void {
    const existing = this.meshes.get(key);
    if (existing) {
      for (const mesh of existing) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
      this.meshes.delete(key);
    }
    const water = this.waterMeshes.get(key);
    if (water) {
      this.group.remove(water);
      water.geometry.dispose();
      this.waterMeshes.delete(key);
    }
  }

  has(key: string): boolean {
    return this.meshes.has(key);
  }

  /** Rebuilds up to `budget` dirty chunks, nearest to the camera first. */
  processDirty(budget: number, cameraX: number, cameraZ: number): number {
    if (this.world.dirtyChunks.size === 0) return 0;
    const keys = [...this.world.dirtyChunks];
    keys.sort((a, b) => distanceOf(a, cameraX, cameraZ) - distanceOf(b, cameraX, cameraZ));
    let built = 0;
    for (const key of keys) {
      if (built >= budget) break;
      const chunk = this.world.chunks.get(key);
      this.world.dirtyChunks.delete(key);
      if (!chunk || !chunk.generated) continue;
      this.build(chunk);
      built++;
    }
    return built;
  }

  /** Rebuilds chunks where only the water level changed. */
  processWaterDirty(budget: number): number {
    if (this.world.dirtyWaterChunks.size === 0) return 0;
    let built = 0;
    for (const key of [...this.world.dirtyWaterChunks]) {
      if (built >= budget) break;
      this.world.dirtyWaterChunks.delete(key);
      const chunk = this.world.chunks.get(key);
      // A chunk queued for a full rebuild does not need the water-only pass as well.
      if (!chunk || !chunk.generated || chunk.dirty) continue;
      this.buildWater(chunk);
      built++;
    }
    return built;
  }

  dispose(): void {
    for (const key of [...this.meshes.keys()]) this.remove(key);
  }
}

function distanceOf(key: string, x: number, z: number): number {
  const [cx, cz] = parseChunkKey(key);
  const dx = cx * CHUNK_SIZE + CHUNK_SIZE / 2 - x;
  const dz = cz * CHUNK_SIZE + CHUNK_SIZE / 2 - z;
  return dx * dx + dz * dz;
}
