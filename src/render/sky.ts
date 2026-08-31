import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import type { DayCycle } from '../game/daycycle';

const DAY_HORIZON = new THREE.Color('#bfe9ff');
const DAY_ZENITH = new THREE.Color('#7fc6f5');
const DUSK_HORIZON = new THREE.Color('#ffc7dd');
const DUSK_ZENITH = new THREE.Color('#8f9fe8');
const NIGHT_HORIZON = new THREE.Color('#4a4f91');
const NIGHT_ZENITH = new THREE.Color('#2b2f5c');
const WHITE = new THREE.Color('#ffffff');

/** Pastel gradient sky, soft celestial glow, stars, clouds and the shared light rig. */
export class Sky {
  readonly group = new THREE.Group();
  readonly fog: THREE.Fog;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.InstancedMesh;
  private readonly ambient: THREE.HemisphereLight;
  private readonly directional: THREE.DirectionalLight;
  private readonly horizon = new THREE.Color();
  private readonly zenith = new THREE.Color();
  private readonly sunDirection = new THREE.Vector3();
  private baseNear: number;
  private baseFar: number;

  constructor(scene: THREE.Scene, renderDistanceBlocks: number) {
    this.baseNear = renderDistanceBlocks * 0.5;
    this.baseFar = renderDistanceBlocks * 1.02;
    this.fog = new THREE.Fog(DAY_HORIZON, this.baseNear, this.baseFar);
    scene.fog = this.fog;

    this.domeMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uHorizon: { value: DAY_HORIZON.clone() },
        uZenith: { value: DAY_ZENITH.clone() },
        uSunDirection: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
        uSunColor: { value: new THREE.Color('#fff3d6') },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uNight;
        varying vec3 vDirection;
        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        void main() {
          vec3 direction = normalize(vDirection);
          vec3 color = mix(uHorizon, uZenith, smoothstep(-0.08, 0.72, direction.y));
          float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
          color += uSunColor * pow(sun, 700.0) * 1.15;
          color += uSunColor * pow(sun, 12.0) * 0.13;
          float stars = step(0.9975, hash13(floor(direction * 260.0)));
          color += vec3(stars) * uNight * smoothstep(0.0, 0.3, direction.y) * 0.72;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(850, 3), this.domeMaterial);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.group.add(dome);

    this.sun = new THREE.Mesh(
      new THREE.CircleGeometry(16, 32),
      new THREE.MeshBasicMaterial({ color: '#fff2bd', transparent: true, opacity: 0.92, fog: false, depthWrite: false }),
    );
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(11, 32),
      new THREE.MeshBasicMaterial({ color: '#edf2ff', transparent: true, opacity: 0.86, fog: false, depthWrite: false }),
    );
    this.group.add(this.sun, this.moon);

    const starCount = 480;
    const positions = new Float32Array(starCount * 3);
    const rng = mulberry32(0x57a2);
    for (let i = 0; i < starCount; i++) {
      const angle = rng() * Math.PI * 2;
      const y = rng();
      const radius = Math.sqrt(1 - y * y) * 380;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y * 380;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: '#fffaf0', size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false,
    }));
    this.group.add(this.stars);

    this.clouds = new THREE.InstancedMesh(
      buildCloud(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false, depthWrite: false }),
      42,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.clouds.count; i++) {
      const angle = (i / this.clouds.count) * Math.PI * 2 + Math.sin(i * 12.9898);
      const distance = 95 + ((i * 79) % 290);
      const scale = 6 + ((i * 53) % 9);
      dummy.position.set(Math.cos(angle) * distance, 88 + ((i * 37) % 30), Math.sin(angle) * distance);
      dummy.scale.set(scale * (1.15 + ((i * 17) % 5) / 10), scale * 0.72, scale);
      dummy.rotation.y = i * 0.71;
      dummy.updateMatrix();
      this.clouds.setMatrixAt(i, dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -900;
    this.group.add(this.clouds);

    this.ambient = new THREE.HemisphereLight('#dff2ff', '#8c846c', 1.15);
    this.directional = new THREE.DirectionalLight('#fff5dc', 1.25);
    this.directional.castShadow = false;
    this.directional.shadow.mapSize.set(1024, 1024);
    this.directional.shadow.camera.left = -64;
    this.directional.shadow.camera.right = 64;
    this.directional.shadow.camera.top = 64;
    this.directional.shadow.camera.bottom = -64;
    this.directional.shadow.camera.near = 1;
    this.directional.shadow.camera.far = 190;
    this.directional.shadow.normalBias = 0.035;
    this.directional.shadow.bias = -0.0002;
    scene.add(this.group, this.ambient, this.directional, this.directional.target);
  }

  update(day: DayCycle, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    const sun = day.sunLight;
    const angle = day.sunAngle;
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(angle)) * 2.8) * Math.max(0.25, sun);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, sun).lerp(DUSK_HORIZON, dusk * 0.76);
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, sun).lerp(DUSK_ZENITH, dusk * 0.5);
    this.sunDirection.set(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    (this.domeMaterial.uniforms.uHorizon.value as THREE.Color).copy(this.horizon);
    (this.domeMaterial.uniforms.uZenith.value as THREE.Color).copy(this.zenith);
    (this.domeMaterial.uniforms.uSunDirection.value as THREE.Vector3).copy(this.sunDirection);
    this.domeMaterial.uniforms.uNight.value = Math.max(0, 1 - sun * 2.1);
    renderer.setClearColor(this.horizon);
    this.fog.color.copy(this.horizon);

    this.group.position.copy(camera.position);
    this.sun.position.copy(this.sunDirection).multiplyScalar(330);
    this.moon.position.copy(this.sunDirection).multiplyScalar(-330);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.stars.rotation.z = angle;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - sun * 2.1);
    this.clouds.rotation.y = day.time * Math.PI * 0.22;
    (this.clouds.material as THREE.MeshBasicMaterial).color.copy(this.horizon).lerp(WHITE, 0.88);
    this.ambient.intensity = 0.42 + sun * 0.88;
    this.directional.intensity = 0.28 + sun * 1.02;
    this.directional.position.copy(camera.position).addScaledVector(this.sunDirection, 105);
    this.directional.target.position.copy(camera.position);
    this.directional.target.updateMatrixWorld();
  }

  setRenderDistance(blocks: number): void {
    this.baseNear = blocks * 0.5;
    this.baseFar = blocks * 1.02;
    this.fog.near = this.baseNear;
    this.fog.far = this.baseFar;
  }
}

function buildCloud(): THREE.BufferGeometry {
  const layout: readonly [number, number, number, number][] = [
    [0, 0, 0, 1], [0.95, -0.12, 0.15, 0.72], [-0.9, -0.16, -0.1, 0.66],
    [0.35, 0.3, -0.5, 0.6], [-0.35, 0.24, 0.45, 0.56], [1.55, -0.28, -0.2, 0.42],
  ];
  const puffs = layout.map(([x, y, z, radius]) => {
    const geometry = new THREE.IcosahedronGeometry(radius, 1);
    geometry.scale(1.15, 0.72, 1.15);
    geometry.translate(x, y, z);
    return geometry;
  });
  const merged = BufferGeometryUtils.mergeGeometries(puffs, false);
  if (!merged) throw new Error('cloud geometry could not be merged');
  const position = merged.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color('#cbd8f2');
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) + 0.8) / 2, 0, 1);
    color.copy(low).lerp(WHITE, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}
