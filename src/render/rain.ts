import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

/** Rain, as a box of falling points that travels with the camera and wraps around when
 *  a drop reaches the bottom. It never collides with anything: a wet season is meant to
 *  be read at a glance, not simulated. */

const DROPS = 900;
/** Half the width and depth of the box the drops live in. */
const SPREAD = 22;
/** Height of the box. Drops that fall out of the bottom reappear at the top. */
const HEIGHT = 26;
const FALL_SPEED = 34;
/** Below this the season is not wet enough to show anything. */
const MIN_WETNESS = 0.25;

export class Rain {
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly material: THREE.PointsMaterial;
  /** Eased so a shower fades in and out rather than switching on. */
  private strength = 0;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(DROPS * 3);
    const rng = mulberry32(0x2a17);
    for (let i = 0; i < DROPS; i++) {
      this.positions[i * 3] = (rng() * 2 - 1) * SPREAD;
      this.positions[i * 3 + 1] = rng() * HEIGHT;
      this.positions[i * 3 + 2] = (rng() * 2 - 1) * SPREAD;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xbdd4e8,
      size: 2.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(dt: number, camera: THREE.Camera, wetness: number, daylight: number): void {
    const target = Math.max(0, (wetness - MIN_WETNESS) / (1 - MIN_WETNESS));
    this.strength += (target - this.strength) * Math.min(1, dt * 1.5);
    this.points.visible = this.strength > 0.01;
    if (!this.points.visible) return;

    this.material.opacity = this.strength * (0.25 + daylight * 0.45);
    // The box is anchored to the camera, so the player is always in the middle of it.
    const base = camera.position;
    this.points.position.set(base.x, base.y - HEIGHT * 0.5, base.z);
    const fall = FALL_SPEED * dt * (0.6 + this.strength * 0.6);
    for (let i = 1; i < this.positions.length; i += 3) {
      this.positions[i] -= fall;
      if (this.positions[i] < 0) this.positions[i] += HEIGHT;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
