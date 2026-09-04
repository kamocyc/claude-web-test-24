import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GoodId } from '../game/villages';
import { cargoStyle } from './cargoStyle';

export { cargoStyle, type CargoForm } from './cargoStyle';

interface CargoView {
  group: THREE.Group;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
  signature: string;
}

const WOOD = 0xc7955b;
const WOOD_DARK = 0x765238;
const ROPE = 0xe7d39a;
const CLOTH = 0xe8d4a5;
const SKIN = 0xd8a47f;

export type CargoDisplayKind = 'waiting' | 'porter' | 'cart' | 'bus' | 'ship' | 'train';

/** One physical readout of goods or travellers in the world. The economy remains the
 *  authority; this is deliberately only a view of its counts. */
export interface CargoDisplay {
  key: string;
  good: GoodId;
  label: string;
  count: number;
  kind: CargoDisplayKind;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  /** Extra vertical separation for several placards sharing one depot. */
  labelLift?: number;
}

export function cargoCaption(cargo: Pick<CargoDisplay, 'kind' | 'label' | 'count'>): string {
  const state = cargo.kind === 'waiting' ? '待機' : '輸送';
  return `${state}  ${cargo.label} ×${Math.max(0, Math.floor(cargo.count))}`;
}

/** Lightweight world-space cargo models and billboard labels. Models are intentionally
 *  procedural: they share the game's rounded-block language and remain cheap enough to
 *  appear at every busy depot. */
export class CargoRenderer {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, CargoView>();
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  private readonly box = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  private readonly cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private readonly chunk = new THREE.DodecahedronGeometry(0.5, 0);
  private readonly sphere = new THREE.SphereGeometry(0.5, 8, 6);

  constructor() {
    this.group.name = 'cargo-readouts';
  }

  sync(cargoes: readonly CargoDisplay[]): void {
    const alive = new Set<string>();
    for (const cargo of cargoes) {
      if (cargo.count <= 0) continue;
      alive.add(cargo.key);
      const signature = `${cargo.good}:${cargo.kind}`;
      let view = this.views.get(cargo.key);
      if (!view || view.signature !== signature) {
        if (view) this.drop(cargo.key, view);
        view = this.create(cargo, signature);
        this.views.set(cargo.key, view);
        this.group.add(view.group);
      }
      const caption = cargoCaption(cargo);
      if (view.label.userData.caption !== caption) this.updateLabel(view, caption, cargo.kind);
      view.group.position.set(cargo.x, cargo.y, cargo.z);
      view.group.rotation.y = cargo.yaw ?? 0;
      view.label.position.y = labelHeight(cargo.kind) + (cargo.labelLift ?? 0);
    }
    for (const [key, view] of this.views) {
      if (!alive.has(key)) this.drop(key, view);
    }
  }

  private create(cargo: CargoDisplay, signature: string): CargoView {
    const group = new THREE.Group();
    const model = this.makeModel(cargo.good);
    const moving = cargo.kind !== 'waiting';
    const scale = cargo.kind === 'train' || cargo.kind === 'ship' ? 0.72 : moving ? 0.62 : 1;
    model.scale.setScalar(scale);

    // On foot it sits over the existing backpack; on a cart it identifies the load in the
    // bed; on a train it is a readable emblem over the relevant car. Waiting piles rest on
    // the ground beside the depot door.
    if (cargo.kind === 'porter') model.position.set(0, 1.65, 0.34);
    else if (cargo.kind === 'cart') model.position.set(0, 1.42, 0.95);
    // On a coach it rides on the luggage rail, which is where a bus puts what it is not
    // carrying inside; on a ship it stands on the deck between the hatches.
    else if (cargo.kind === 'bus') model.position.set(0, 2.5, 0.5);
    else if (cargo.kind === 'ship') model.position.set(0, 1.6, -0.9);
    else if (cargo.kind === 'train') model.position.set(0, 3.35, 0);
    group.add(model);

    const texture = this.labelTexture(cargoCaption(cargo), cargo.kind);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }));
    label.userData.caption = cargoCaption(cargo);
    label.scale.set(cargo.kind === 'train' ? 2.65 : 2.35, cargo.kind === 'train' ? 0.66 : 0.59, 1);
    label.position.y = labelHeight(cargo.kind) + (cargo.labelLift ?? 0);
    label.renderOrder = 2;
    group.add(label);
    return { group, label, labelTexture: texture, signature };
  }

  private makeModel(good: GoodId): THREE.Group {
    const style = cargoStyle(good);
    const group = new THREE.Group();
    if (style.form === 'people') {
      this.person(group, -0.28, 0, style.colour);
      this.person(group, 0.28, 0.08, 0xd57d68);
      this.boxPart(group, [0.22, 0.28, 0.18], [0.53, 0.25, 0.12], WOOD_DARK);
      return group;
    }
    if (style.form === 'logs') {
      for (const [y, z] of [[0.24, -0.23], [0.24, 0.23], [0.67, 0]] as const) {
        const log = this.mesh(this.cylinder, style.colour);
        log.scale.set(0.28, 1.05, 0.28);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, y, z);
        group.add(log);
      }
      this.boxPart(group, [0.08, 0.9, 0.08], [-0.3, 0.43, 0], ROPE, [0, 0, Math.PI / 2]);
      this.boxPart(group, [0.08, 0.9, 0.08], [0.3, 0.43, 0], ROPE, [0, 0, Math.PI / 2]);
      return group;
    }
    if (style.form === 'sacks') {
      for (const [x, y] of [[-0.25, 0.3], [0.25, 0.3], [0, 0.72]] as const) {
        const sack = this.mesh(this.sphere, style.colour || CLOTH);
        sack.scale.set(0.38, 0.48, 0.32);
        sack.position.set(x, y, 0);
        group.add(sack);
        this.boxPart(group, [0.2, 0.07, 0.2], [x, y + 0.43, 0], ROPE);
      }
      return group;
    }
    if (style.form === 'mineral') {
      this.crate(group);
      for (const [x, y, z, s] of [
        [-0.28, 0.66, -0.12, 0.34], [0.18, 0.72, -0.18, 0.4],
        [-0.05, 0.78, 0.22, 0.32], [0.34, 0.58, 0.2, 0.27],
      ] as const) {
        const rock = this.mesh(this.chunk, style.colour);
        rock.scale.setScalar(s);
        rock.position.set(x, y, z);
        group.add(rock);
      }
      return group;
    }
    if (style.form === 'ingots') {
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 3 - row; i++) {
          this.boxPart(group, [0.42, 0.16, 0.24], [(i - (2 - row) / 2) * 0.38, 0.12 + row * 0.17, 0], style.colour);
        }
      }
      return group;
    }
    if (style.form === 'planks') {
      for (let i = 0; i < 4; i++) {
        this.boxPart(group, [1.05, 0.15, 0.28], [0, 0.1 + i * 0.16, (i % 2 ? 0.12 : -0.12)], style.colour);
      }
      this.boxPart(group, [0.08, 0.72, 0.65], [-0.3, 0.34, 0], ROPE);
      this.boxPart(group, [0.08, 0.72, 0.65], [0.3, 0.34, 0], ROPE);
      return group;
    }
    if (style.form === 'torches') {
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.19;
        this.boxPart(group, [0.1, 0.82, 0.1], [x, 0.42, (i % 2) * 0.1], WOOD_DARK, [0, 0, (i - 2) * 0.08]);
        this.boxPart(group, [0.18, 0.2, 0.18], [x - (i - 2) * 0.035, 0.86, (i % 2) * 0.1], style.colour);
      }
      return group;
    }
    if (style.form === 'blocks') {
      for (const [x, y, z] of [[-0.28, 0.27, 0], [0.28, 0.27, 0], [0, 0.78, 0]] as const) {
        this.boxPart(group, [0.5, 0.5, 0.5], [x, y, z], style.colour);
      }
      return group;
    }
    this.crate(group, style.colour);
    return group;
  }

  private person(group: THREE.Group, x: number, z: number, coat: number): void {
    this.boxPart(group, [0.3, 0.42, 0.22], [x, 0.66, z], coat);
    this.boxPart(group, [0.31, 0.31, 0.31], [x, 1.03, z], SKIN);
    this.boxPart(group, [0.11, 0.46, 0.11], [x - 0.09, 0.25, z], WOOD_DARK);
    this.boxPart(group, [0.11, 0.46, 0.11], [x + 0.09, 0.25, z], WOOD_DARK);
  }

  private crate(group: THREE.Group, fill = WOOD): void {
    this.boxPart(group, [1, 0.7, 0.8], [0, 0.38, 0], fill);
    this.boxPart(group, [1.06, 0.1, 0.86], [0, 0.75, 0], WOOD_DARK);
    this.boxPart(group, [0.12, 0.76, 0.86], [-0.38, 0.38, 0], WOOD_DARK);
    this.boxPart(group, [0.12, 0.76, 0.86], [0.38, 0.38, 0], WOOD_DARK);
  }

  private boxPart(
    group: THREE.Group,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    colour: number,
    rotation?: readonly [number, number, number],
  ): void {
    const mesh = this.mesh(this.box, colour);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    group.add(mesh);
  }

  private mesh(geometry: THREE.BufferGeometry, colour: number): THREE.Mesh {
    let material = this.materials.get(colour);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color: colour });
      this.materials.set(colour, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  private updateLabel(view: CargoView, caption: string, kind: CargoDisplayKind): void {
    const material = view.label.material as THREE.SpriteMaterial;
    view.labelTexture.dispose();
    view.labelTexture = this.labelTexture(caption, kind);
    material.map = view.labelTexture;
    material.needsUpdate = true;
    view.label.userData.caption = caption;
  }

  private labelTexture(text: string, kind: CargoDisplayKind): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(28, 31, 38, 0.9)';
      roundedRect(ctx, 4, 4, 504, 120, 28);
      ctx.fill();
      ctx.strokeStyle = kind === 'waiting' ? '#f0c86b' : '#79d2c3';
      ctx.lineWidth = 7;
      roundedRect(ctx, 8, 8, 496, 112, 24);
      ctx.stroke();
      ctx.fillStyle = '#fffaf0';
      ctx.font = '700 48px system-ui, "Yu Gothic", "Meiryo", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Keep even long item labels on one placard.
      if (ctx.measureText(text).width > 450) {
        ctx.font = '700 39px system-ui, "Yu Gothic", "Meiryo", sans-serif';
      }
      ctx.fillText(text, 256, 67, 460);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private drop(key: string, view: CargoView): void {
    this.group.remove(view.group);
    view.labelTexture.dispose();
    (view.label.material as THREE.SpriteMaterial).dispose();
    this.views.delete(key);
  }

  dispose(): void {
    for (const [key, view] of [...this.views]) this.drop(key, view);
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.box.dispose();
    this.cylinder.dispose();
    this.chunk.dispose();
    this.sphere.dispose();
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function labelHeight(kind: CargoDisplayKind): number {
  if (kind === 'train') return 4.45;
  if (kind === 'ship') return 3.6;
  if (kind === 'bus') return 3.2;
  if (kind !== 'waiting') return 2.7;
  return 1.9;
}
