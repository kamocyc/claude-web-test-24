import * as THREE from 'three';
import type { ItemDrop } from '../game/drops';
import type { CarKind } from '../game/consist';
import type { Mob } from '../game/mobs/ai';
import type { Arrow } from '../game/mobs/spawner';
import { itemDef } from '../game/items';
import { blockDef } from '../world/blocks';
import { carModel, modelFor, type ModelPart } from './models';
import type { Atlas } from './textures';

interface MobView {
  group: THREE.Group;
  parts: { mesh: THREE.Mesh; part: ModelPart }[];
  material: THREE.MeshLambertMaterial[];
  /** The cars behind the engine, each in its own group.
   *
   *  Their own groups and not children of the engine's, because they are not attached to
   *  it: the game places every car in world coordinates from where the engine has been,
   *  which is the only way a train longer than the tightest curve stays on the rails. */
  cars: CarView[];
}

interface CarView {
  kind: CarKind;
  group: THREE.Group;
  material: THREE.MeshLambertMaterial[];
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Draws mobs, dropped items and arrows. Meshes are created lazily and reused. */
export class EntityRenderer {
  readonly group = new THREE.Group();
  private readonly mobViews = new Map<number, MobView>();
  private readonly dropViews = new Map<ItemDrop, THREE.Mesh>();
  private readonly arrowViews: THREE.Mesh[] = [];
  private readonly itemGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly dropMaterial: THREE.MeshLambertMaterial;
  private readonly arrowMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  private readonly arrowGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.7);

  constructor(private readonly atlas: Atlas) {
    this.group.name = 'entities';
    this.dropMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture, transparent: true, alphaTest: 0.5 });
  }

  sync(mobs: Mob[], drops: ItemDrop[], arrows: Arrow[], time: number): void {
    this.syncMobs(mobs, time);
    this.syncDrops(drops, time);
    this.syncArrows(arrows);
  }

  private syncMobs(mobs: Mob[], time: number): void {
    const alive = new Set<number>();
    for (const mob of mobs) {
      alive.add(mob.id);
      let view = this.mobViews.get(mob.id);
      if (!view) {
        view = this.createMobView(mob);
        this.mobViews.set(mob.id, view);
        this.group.add(view.group);
      }
      view.group.position.set(mob.x, mob.y, mob.z);
      view.group.rotation.y = mob.yaw;
      this.syncCars(view, mob);

      // Legs and arms swing with how far the mob has walked.
      const swing = Math.sin(mob.walkPhase) * 0.6;
      for (const { mesh, part } of view.parts) {
        switch (part.role) {
          case 'legFrontLeft':
          case 'legBackRight':
            mesh.rotation.x = swing;
            break;
          case 'legFrontRight':
          case 'legBackLeft':
            mesh.rotation.x = -swing;
            break;
          case 'armLeft':
            mesh.rotation.x = mob.kind === 'zombie' ? -1.5 : -swing * 0.7;
            break;
          case 'armRight':
            mesh.rotation.x = mob.kind === 'zombie' ? -1.5 : swing * 0.7;
            break;
          default:
            break;
        }
      }

      // Flash red just after taking damage, and orange while burning.
      const hurt = mob.hurtCooldown > 0;
      const burning = mob.burning > 0;
      for (const material of view.material) {
        const emissive = hurt ? 0x881111 : burning ? 0x883300 : 0x000000;
        material.emissive.setHex(emissive);
        material.emissiveIntensity = burning ? 0.6 + Math.sin(time * 20) * 0.2 : 1;
      }
    }
    for (const [id, view] of this.mobViews) {
      if (alive.has(id)) continue;
      this.disposeMobView(view);
      this.mobViews.delete(id);
    }
  }

  private createMobView(mob: Mob): MobView {
    const group = new THREE.Group();
    const parts: MobView['parts'] = [];
    const materials: THREE.MeshLambertMaterial[] = [];
    for (const part of modelFor(mob.kind)) {
      const material = new THREE.MeshLambertMaterial({ color: part.color });
      const mesh = new THREE.Mesh(BOX, material);
      mesh.scale.set(part.size[0], part.size[1], part.size[2]);
      mesh.position.set(part.offset[0], part.offset[1], part.offset[2]);
      group.add(mesh);
      parts.push({ mesh, part });
      materials.push(material);
    }
    return { group, parts, material: materials, cars: [] };
  }

  /** Puts the cars where the game says they are, building or dropping them when the train
   *  picks up a different load. */
  private syncCars(view: MobView, mob: Mob): void {
    while (view.cars.length > mob.consist.length) this.dropCar(view.cars.pop()!);
    for (let i = 0; i < mob.consist.length; i++) {
      const pose = mob.consist[i];
      const built = view.cars[i];
      // The coach is always the first car and the wagons follow it, so a train that picks
      // up a different load only ever grows or loses cars off the back — but a kind that
      // has changed under an index is built again rather than repainted, because a wagon
      // and a carriage are not the same boxes in different colours.
      if (built && built.kind !== pose.kind) this.dropCar(built);
      const car = built && built.kind === pose.kind ? built : this.createCarView(pose.kind);
      if (car !== built) {
        view.cars[i] = car;
        this.group.add(car.group);
      }
      car.group.position.set(pose.x, pose.y, pose.z);
      car.group.rotation.y = pose.yaw;
    }
  }

  private createCarView(kind: CarKind): CarView {
    const group = new THREE.Group();
    const materials: THREE.MeshLambertMaterial[] = [];
    for (const part of carModel(kind)) {
      const material = new THREE.MeshLambertMaterial({ color: part.color });
      const mesh = new THREE.Mesh(BOX, material);
      mesh.scale.set(part.size[0], part.size[1], part.size[2]);
      mesh.position.set(part.offset[0], part.offset[1], part.offset[2]);
      group.add(mesh);
      materials.push(material);
    }
    return { kind, group, material: materials };
  }

  private dropCar(car: CarView): void {
    this.group.remove(car.group);
    for (const material of car.material) material.dispose();
  }

  private disposeMobView(view: MobView): void {
    this.group.remove(view.group);
    for (const material of view.material) material.dispose();
    for (const car of view.cars) this.dropCar(car);
  }

  private syncDrops(drops: ItemDrop[], time: number): void {
    const alive = new Set<ItemDrop>(drops);
    for (const drop of drops) {
      let mesh = this.dropViews.get(drop);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometryForItem(drop.stack.id), this.dropMaterial);
        this.dropViews.set(drop, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(drop.x, drop.y + 0.2 + Math.sin(time * 2 + drop.spin) * 0.06, drop.z);
      mesh.rotation.y = drop.spin;
    }
    for (const [drop, mesh] of this.dropViews) {
      if (alive.has(drop)) continue;
      this.group.remove(mesh);
      this.dropViews.delete(drop);
    }
  }

  /** A small cube UV-mapped to the item's atlas tile. */
  private geometryForItem(id: string): THREE.BufferGeometry {
    const cached = this.itemGeometries.get(id);
    if (cached) return cached;
    const def = itemDef(id);
    let texName = def?.tex ?? 'stone';
    if (def?.placesBlock !== undefined) {
      const block = blockDef(def.placesBlock);
      texName = block.tex.side ?? block.tex.all ?? block.tex.top ?? texName;
    }
    const uv = this.atlas.uv(texName);
    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const attribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) {
      const u = attribute.getX(i);
      const v = attribute.getY(i);
      attribute.setXY(i, uv.u0 + u * (uv.u1 - uv.u0), uv.v1 - v * (uv.v1 - uv.v0));
    }
    attribute.needsUpdate = true;
    this.itemGeometries.set(id, geometry);
    return geometry;
  }

  private syncArrows(arrows: Arrow[]): void {
    while (this.arrowViews.length < arrows.length) {
      const mesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
      this.arrowViews.push(mesh);
      this.group.add(mesh);
    }
    for (let i = 0; i < this.arrowViews.length; i++) {
      const mesh = this.arrowViews[i];
      const arrow = arrows[i];
      if (!arrow) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(arrow.x, arrow.y, arrow.z);
      mesh.lookAt(arrow.x + arrow.vx, arrow.y + arrow.vy, arrow.z + arrow.vz);
    }
  }

  clear(): void {
    for (const view of this.mobViews.values()) this.group.remove(view.group);
    this.mobViews.clear();
    for (const mesh of this.dropViews.values()) this.group.remove(mesh);
    this.dropViews.clear();
  }
}
