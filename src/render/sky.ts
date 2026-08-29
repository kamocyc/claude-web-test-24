import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import type { DayCycle } from '../game/daycycle';

const DAY_SKY = new THREE.Color(0x7ec0ee);
const SUNSET_SKY = new THREE.Color(0xe8925a);
const NIGHT_SKY = new THREE.Color(0x05070f);
/** Overcast grey the sky is dragged towards in heavy rain. */
/** Dusty haze of a dry season. */

/** Sky colour, sun, moon, stars and the scene lights that mobs are lit by. */
export class Sky {
  readonly group = new THREE.Group();
  readonly fog: THREE.Fog;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly ambient: THREE.HemisphereLight;
  private readonly directional: THREE.DirectionalLight;
  private readonly color = new THREE.Color();
  /** How far the fog reaches. */
  private baseNear: number;
  private baseFar: number;

  constructor(scene: THREE.Scene, renderDistanceBlocks: number) {
    this.baseNear = renderDistanceBlocks * 0.45;
    this.baseFar = renderDistanceBlocks * 0.95;
    this.fog = new THREE.Fog(DAY_SKY.getHex(), this.baseNear, this.baseFar);
    scene.fog = this.fog;

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff4c4, fog: false, depthWrite: false });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), sunMaterial);
    const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xdfe6f5, fog: false, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), moonMaterial);

    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    const rng = mulberry32(0x57a2);
    for (let i = 0; i < starCount; i++) {
      // Uniform points on the upper half of a sphere.
      const theta = rng() * Math.PI * 2;
      const y = rng();
      const r = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(theta) * r * 380;
      positions[i * 3 + 1] = y * 380;
      positions[i * 3 + 2] = Math.sin(theta) * r * 380;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }),
    );

    this.ambient = new THREE.HemisphereLight(0xbfd8ff, 0x404030, 1.1);
    this.directional = new THREE.DirectionalLight(0xffffff, 1.1);

    this.group.add(this.sun, this.moon, this.stars);
    scene.add(this.group, this.ambient, this.directional);
  }

  /** Repositions everything around the camera and applies the current lighting. */
  update(day: DayCycle, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    const sun = day.sunLight;
    const angle = day.sunAngle;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.25).normalize();

    // Blend day -> sunset -> night by how high the sun sits.
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(angle)) * 2.6);
    this.color.copy(NIGHT_SKY).lerp(DAY_SKY, sun);
    this.color.lerp(SUNSET_SKY, dusk * sun * 0.85);
    renderer.setClearColor(this.color);
    this.fog.color.copy(this.color);
    this.fog.near = this.baseNear;
    this.fog.far = this.baseFar;

    const position = camera.position;
    this.group.position.copy(position);
    this.sun.position.copy(sunDir).multiplyScalar(340);
    this.sun.lookAt(position);
    this.moon.position.copy(sunDir).multiplyScalar(-340);
    this.moon.lookAt(position);
    this.stars.rotation.z = angle;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - sun * 2.2);

    this.ambient.intensity = 0.35 + sun * 0.85;
    this.directional.intensity = 0.25 + sun * 0.95;
    this.directional.position.copy(position).add(sunDir.clone().multiplyScalar(100));
    this.directional.target.position.copy(position);
    this.directional.target.updateMatrixWorld();
  }

  setRenderDistance(blocks: number): void {
    this.baseNear = blocks * 0.45;
    this.baseFar = blocks * 0.95;
    this.fog.near = this.baseNear;
    this.fog.far = this.baseFar;
  }
}
