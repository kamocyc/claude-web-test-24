import * as THREE from 'three';
import type { ItemDrop } from '../game/drops';
import type { CarKind } from '../game/consist';
import type { Mob } from '../game/mobs/ai';
import type { Arrow } from '../game/mobs/spawner';
import { itemDef } from '../game/items';
import { blockDef } from '../world/blocks';
import { mobDef } from '../game/mobs/types';
import { carModel, modelFor, type Joint, type JointName } from './models';
import { GAITS, jitterFor, poseMob, type GaitSpec } from './mobAnimation';
import { buildPart, mergeParts, type PartMesh } from './mobGeometry';
import type { Atlas } from './textures';

interface MobView {
  group: THREE.Group;
  /** Everything the animation moves hangs off this: the body's own bob, breath and
   *  flinch are applied here so the group above stays exactly where the game put it. */
  body: THREE.Group;
  joints: { name: JointName; object: THREE.Object3D }[];
  rig: readonly Joint[];
  gait: GaitSpec;
  material: THREE.MeshLambertMaterial;
  /** This mob's own place in the idle clock, so a herd is not in lockstep. */
  offset: number;
  rate: number;
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
  material: THREE.MeshLambertMaterial;
}

/** What a mob kind's meshes are made of, built once and shared by every one of them. */
interface BuiltModel {
  /** Everything that never moves, as one geometry. */
  root: THREE.BufferGeometry | null;
  joints: { name: JointName; local: [number, number, number]; parent?: JointName; geometry: THREE.BufferGeometry | null }[];
  rig: Joint[];
  gait: GaitSpec;
}

/** Colour comes from the vertices, so one material serves a whole mob — which is
 *  what lets the hurt flash stay a single assignment as the part count doubles. */
const MOB_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

/** A three.js geometry from the raw buffers the mob geometry builder returns. */
function toGeometry(mesh: PartMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function shadowed(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Draws mobs, dropped items and arrows. Meshes are created lazily and reused. */
export class EntityRenderer {
  readonly group = new THREE.Group();
  private readonly mobViews = new Map<number, MobView>();
  /** Geometry per kind, shared by every mob of it and never disposed with one. */
  private readonly models = new Map<Mob['kind'], BuiltModel>();
  private readonly cars = new Map<CarKind, THREE.BufferGeometry>();
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

      // Every joint at once, from a pure function of the mob's own state. The
      // walk is blended in by speed rather than by `walkPhase`, which only
      // advances with distance: driven from the phase alone a mob that stopped
      // froze mid-stride and one standing still never moved at all.
      const pose = poseMob(view.gait, view.rig, {
        walkPhase: mob.walkPhase,
        moving: Math.min(1, Math.hypot(mob.vx, mob.vz) / Math.max(0.1, mobDef(mob.kind).speed)),
        clock: time,
        offset: view.offset,
        rate: view.rate,
        onGround: mob.onGround,
        hurt: Math.min(1, mob.hurtCooldown * 3),
      });
      for (const joint of view.joints) {
        const angles = pose.rotation.get(joint.name);
        if (angles) joint.object.rotation.set(angles[0], angles[1], angles[2]);
      }
      view.body.position.y = pose.lift;
      view.body.scale.y = pose.breath;
      view.body.rotation.x = pose.lean;

      // Flash red just after taking damage, and orange while burning.
      const hurt = mob.hurtCooldown > 0;
      const burning = mob.burning > 0;
      const emissive = hurt ? 0x881111 : burning ? 0x883300 : 0x000000;
      view.material.emissive.setHex(emissive);
      view.material.emissiveIntensity = burning ? 0.6 + Math.sin(time * 20) * 0.2 : 1;
    }
    for (const [id, view] of this.mobViews) {
      if (alive.has(id)) continue;
      this.disposeMobView(view);
      this.mobViews.delete(id);
    }
  }

  /**
   * The geometry for one kind of mob, built once.
   *
   * Parts are grouped by the joint they hang on and each group merged into a
   * single buffer, which is what pays for the extra parts: a mob with twice the
   * boxes is drawn in fewer calls than it used to be, because the two dozen that
   * never move are one mesh instead of two dozen.
   */
  private modelFor(kind: Mob['kind']): BuiltModel {
    const cached = this.models.get(kind);
    if (cached) return cached;
    const model = modelFor(kind);
    const byJoint = new Map<JointName, PartMesh[]>();
    const still: PartMesh[] = [];
    const pivots = new Map<JointName, [number, number, number]>();
    for (const joint of model.joints) pivots.set(joint.name, joint.pivot);
    for (const part of model.parts) {
      const role = part.role;
      const pivot = role === 'body' || role === 'detail' ? undefined : pivots.get(role);
      if (pivot === undefined || role === 'body' || role === 'detail') {
        still.push(buildPart(part, [0, 0, 0]));
        continue;
      }
      const list = byJoint.get(role) ?? [];
      list.push(buildPart(part, pivot));
      byJoint.set(role, list);
    }
    const built: BuiltModel = {
      root: still.length > 0 ? toGeometry(mergeParts(still)) : null,
      joints: model.joints.map((joint) => {
        const parent = joint.parent ? pivots.get(joint.parent) : undefined;
        const meshes = byJoint.get(joint.name);
        return {
          name: joint.name,
          // A joint's own frame sits at its pivot, measured from its parent's.
          local: [
            joint.pivot[0] - (parent?.[0] ?? 0),
            joint.pivot[1] - (parent?.[1] ?? 0),
            joint.pivot[2] - (parent?.[2] ?? 0),
          ] as [number, number, number],
          parent: joint.parent,
          geometry: meshes ? toGeometry(mergeParts(meshes)) : null,
        };
      }),
      rig: model.joints,
      gait: GAITS[model.gait],
    };
    this.models.set(kind, built);
    return built;
  }

  private createMobView(mob: Mob): MobView {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const built = this.modelFor(mob.kind);
    const material = MOB_MATERIAL.clone();
    const joints: MobView['joints'] = [];
    const frames = new Map<JointName, THREE.Object3D>();
    if (built.root) body.add(shadowed(new THREE.Mesh(built.root, material)));
    for (const joint of built.joints) {
      const frame = new THREE.Group();
      frame.position.set(joint.local[0], joint.local[1], joint.local[2]);
      if (joint.geometry) frame.add(shadowed(new THREE.Mesh(joint.geometry, material)));
      frames.set(joint.name, frame);
      joints.push({ name: joint.name, object: frame });
    }
    // Children after every frame exists, so a rig may list them in any order.
    for (const joint of built.joints) {
      const frame = frames.get(joint.name)!;
      (joint.parent ? frames.get(joint.parent) ?? body : body).add(frame);
    }
    const { offset, rate } = jitterFor(mob.id);
    return { group, body, joints, rig: built.rig, gait: built.gait, material, offset, rate, cars: [] };
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

  /** A car's parts never move, so the whole thing is one mesh. */
  private createCarView(kind: CarKind): CarView {
    let geometry = this.cars.get(kind);
    if (!geometry) {
      geometry = toGeometry(mergeParts(carModel(kind).map((part) => buildPart(part, [0, 0, 0]))));
      this.cars.set(kind, geometry);
    }
    const group = new THREE.Group();
    const material = MOB_MATERIAL.clone();
    group.add(shadowed(new THREE.Mesh(geometry, material)));
    return { kind, group, material };
  }

  private dropCar(car: CarView): void {
    this.group.remove(car.group);
    car.material.dispose();
  }

  /** Only the material: the geometry is the kind's, and the next one wants it. */
  private disposeMobView(view: MobView): void {
    this.group.remove(view.group);
    view.material.dispose();
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
