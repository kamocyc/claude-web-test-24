import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemDrop } from '../game/drops';
import type { Mob } from '../game/mobs/ai';
import type { Arrow } from '../game/mobs/spawner';
import { itemDef } from '../game/items';
import { blockDef } from '../world/blocks';
import { modelFor, type ModelPart } from './models';
import type { World } from '../world/world';
import type { Atlas } from './textures';

interface MobView {
  group: THREE.Group;
  parts: { mesh: THREE.Mesh; part: ModelPart }[];
  material: THREE.MeshLambertMaterial[];
  shadow: THREE.Mesh;
}

/** How far below an entity a shadow is still looked for, in blocks. */
const SHADOW_REACH = 6;

/** A soft round blot, used as the contact shadow under everything that moves.
 *  Without one, a mob at the top of its jump reads as pasted onto the scene. */
function shadowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Adds a light along the silhouette, where a surface turns away from the eye. It is
 *  what separates a mob from the terrain behind it without outlining anything. */
function withRimLight(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float rim = pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 3.0 );
       gl_FragColor.rgb += vec3( 0.5, 0.56, 0.68 ) * rim * 0.4;`,
    );
  };
  return material;
}

/** How far a mob's limb is rounded, as a fraction of its shortest side. Rounding a
 *  geometry that is then scaled would squash the radius along the long axis, so each
 *  part gets its own geometry at its true size and is cached by that size. */
const MOB_ROUND = 0.34;

const mobGeometries = new Map<string, THREE.BufferGeometry>();

function roundedPart(size: readonly [number, number, number]): THREE.BufferGeometry {
  const key = size.join(',');
  const cached = mobGeometries.get(key);
  if (cached) return cached;
  const radius = Math.min(...size) * MOB_ROUND;
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius);
  mobGeometries.set(key, geometry);
  return geometry;
}

/** Draws mobs, dropped items and arrows. Meshes are created lazily and reused. */
export class EntityRenderer {
  readonly group = new THREE.Group();
  private readonly mobViews = new Map<number, MobView>();
  private readonly dropViews = new Map<ItemDrop, THREE.Mesh>();
  private readonly arrowViews: THREE.Mesh[] = [];
  private readonly itemGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly dropMaterial: THREE.MeshLambertMaterial;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly dropShadows = new Map<ItemDrop, THREE.Mesh>();
  private readonly shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly arrowMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  private readonly arrowGeometry = new RoundedBoxGeometry(0.08, 0.08, 0.7, 2, 0.03);

  constructor(
    private readonly atlas: Atlas,
    private readonly world: World,
  ) {
    this.group.name = 'entities';
    this.dropMaterial = withRimLight(
      new THREE.MeshLambertMaterial({ map: atlas.texture, transparent: true, alphaTest: 0.5 }),
    );
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
  }

  /** Lays a shadow on the first solid surface under an entity, fading it out with the
   *  drop so a jumping mob's shadow shrinks away beneath it. */
  private placeShadow(mesh: THREE.Mesh, x: number, y: number, z: number, width: number): void {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const start = Math.floor(y + 0.001);
    for (let step = 0; step <= SHADOW_REACH; step++) {
      const by = start - step;
      if (!blockDef(this.world.getBlock(bx, by, bz)).opaque) continue;
      const drop = y - (by + 1);
      const fade = Math.max(0, 1 - drop / SHADOW_REACH);
      mesh.visible = true;
      mesh.position.set(x, by + 1.02, z);
      const spread = width * (1 + drop * 0.25);
      mesh.scale.set(spread, spread, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = fade * fade;
      return;
    }
    mesh.visible = false;
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
      this.placeShadow(view.shadow, mob.x, mob.y, mob.z, mob.kind === 'spider' ? 1.3 : 0.9);

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
      this.group.remove(view.group);
      for (const material of view.material) material.dispose();
      this.group.remove(view.shadow);
      (view.shadow.material as THREE.MeshBasicMaterial).dispose();
      this.mobViews.delete(id);
    }
  }

  private createMobView(mob: Mob): MobView {
    const group = new THREE.Group();
    const parts: MobView['parts'] = [];
    const materials: THREE.MeshLambertMaterial[] = [];
    for (const part of modelFor(mob.kind)) {
      const material = withRimLight(new THREE.MeshLambertMaterial({ color: part.color }));
      const mesh = new THREE.Mesh(roundedPart(part.size), material);
      mesh.position.set(part.offset[0], part.offset[1], part.offset[2]);
      group.add(mesh);
      parts.push({ mesh, part });
      materials.push(material);
    }
    // The shadow is not parented to the mob: it must not turn or bob with it.
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial.clone());
    shadow.renderOrder = -1;
    this.group.add(shadow);
    return { group, parts, material: materials, shadow };
  }

  private syncDrops(drops: ItemDrop[], time: number): void {
    const alive = new Set<ItemDrop>(drops);
    for (const drop of drops) {
      let mesh = this.dropViews.get(drop);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometryForItem(drop.stack.id), this.dropMaterial);
        this.dropViews.set(drop, mesh);
        this.group.add(mesh);
        const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial.clone());
        shadow.renderOrder = -1;
        this.dropShadows.set(drop, shadow);
        this.group.add(shadow);
      }
      mesh.position.set(drop.x, drop.y + 0.2 + Math.sin(time * 2 + drop.spin) * 0.06, drop.z);
      mesh.rotation.y = drop.spin;
      const shadow = this.dropShadows.get(drop);
      if (shadow) this.placeShadow(shadow, drop.x, drop.y, drop.z, 0.42);
    }
    for (const [drop, mesh] of this.dropViews) {
      if (alive.has(drop)) continue;
      this.group.remove(mesh);
      this.dropViews.delete(drop);
      const shadow = this.dropShadows.get(drop);
      if (shadow) {
        this.group.remove(shadow);
        (shadow.material as THREE.MeshBasicMaterial).dispose();
        this.dropShadows.delete(drop);
      }
    }
  }

  /** A small rounded cube UV-mapped to the item's atlas tile. RoundedBoxGeometry
   *  projects each face into the same 0..1 square a plain box does, so the atlas
   *  remap below is unchanged. */
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
    const geometry = new RoundedBoxGeometry(0.3, 0.3, 0.3, 2, 0.075);
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
