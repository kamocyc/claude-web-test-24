import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import type { DayCycle } from '../game/daycycle';

const DAY_SKY = new THREE.Color(0x7ec0ee);
const SUNSET_SKY = new THREE.Color(0xe8925a);
const NIGHT_SKY = new THREE.Color(0x05070f);
/** Overcast grey the sky is dragged towards in heavy rain. */
const RAIN_SKY = new THREE.Color(0x5c6470);
/** Dusty haze of a dry season. */
const DROUGHT_SKY = new THREE.Color(0xc9c2a4);

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
  /** Fog distances for clear weather, which rain and haze pull in from. */
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
  update(
    day: DayCycle,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    wetness = 0,
  ): void {
    const sun = day.sunLight;
    const angle = day.sunAngle;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.25).normalize();

    // Blend day -> sunset -> night by how high the sun sits.
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(angle)) * 2.6);
    this.color.copy(NIGHT_SKY).lerp(DAY_SKY, sun);
    this.color.lerp(SUNSET_SKY, dusk * sun * 0.85);
    // The season tints the sky, but only in daylight: a drought does not brighten the
    // night, it just leaves the air dusty by day.
    if (wetness > 0) this.color.lerp(RAIN_SKY, Math.min(1, wetness) * 0.75 * sun);
    else if (wetness < 0) this.color.lerp(DROUGHT_SKY, Math.min(1, -wetness) * 0.3 * sun);
    renderer.setClearColor(this.color);
    this.fog.color.copy(this.color);
    // Rain closes the view in; a dry haze does the same, more gently.
    const closeIn = wetness > 0 ? wetness * 0.45 : -wetness * 0.15;
    this.fog.near = this.baseNear * (1 - closeIn);
    this.fog.far = this.baseFar * (1 - closeIn * 0.75);

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
