import * as THREE from 'three';
import { TREE_SPECIES, type TreeModel, type TreeSpecies } from './treeModels';
import type { TreeInstance, TreeStore } from '../world/trees';

export class TreeRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.InstancedMesh>();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly dummy = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  private lastVersion = -1;

  constructor(
    private readonly store: TreeStore,
    private readonly models: Record<TreeSpecies, TreeModel[]>,
  ) {
    this.group.name = 'trees';
  }

  update(): void {
    if (this.store.version === this.lastVersion) return;
    this.lastVersion = this.store.version;
    const buckets = new Map<string, TreeInstance[]>();
    for (const chunk of this.store.chunks) for (const tree of chunk) {
      const key = `${tree.species}:${tree.variant}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(tree);
      buckets.set(key, bucket);
    }
    for (const species of TREE_SPECIES) this.models[species].forEach((model, variant) => {
      const key = `${species}:${variant}`;
      const instances = buckets.get(key) ?? [];
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.instanceMatrix.count < Math.max(1, instances.length)) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.dispose();
        }
        mesh = new THREE.InstancedMesh(model.geometry, this.material, Math.max(32, Math.ceil(instances.length * 1.5)));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.meshes.set(key, mesh);
        this.group.add(mesh);
      }
      mesh.count = instances.length;
      for (let i = 0; i < instances.length; i++) {
        const tree = instances[i];
        this.dummy.position.set(tree.x, tree.y, tree.z);
        this.dummy.rotation.set(0, tree.yaw, 0);
        this.dummy.scale.setScalar(tree.scale);
        if (tree.fall > 0) {
          const t = Math.min(1, tree.fall / 1.4);
          this.dummy.rotation.set(0, tree.fallYaw, 0);
          this.dummy.rotateX(t * t * (3 - 2 * t) * Math.PI * 0.48);
          this.dummy.rotation.y += tree.yaw;
        }
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        this.tint.setRGB(1 + tree.hue, 1 - Math.abs(tree.hue) * 0.4, 1 - tree.hue);
        mesh.setColorAt(i, this.tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.material.dispose();
    for (const species of TREE_SPECIES) for (const model of this.models[species]) model.geometry.dispose();
  }
}
