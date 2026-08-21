import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import type { DayCycle } from '../game/daycycle';

/** The sky is a shaded dome rather than a flat clear colour: a zenith-to-horizon
 *  gradient, the sun's own glow scattered into the air around it, and a drifting
 *  cloud deck projected onto a plane overhead so it parallaxes and crowds together
 *  towards the horizon the way real cloud cover does.
 *
 *  The whole shell is scaled every frame to sit just inside the camera's far plane,
 *  which at these render distances is only a couple of hundred blocks out. The old sky
 *  hung its sun, moon and stars at a fixed few hundred units, past that plane, so none
 *  of them were ever actually drawn. */

/** Radius the shell is modelled at. It is scaled every frame to sit just inside the
 *  camera's far plane, which is only a few chunks out — the old sky hung its sun and
 *  stars hundreds of units away, well past that plane, so none of them ever appeared. */
const SHELL = 1;
/** How much of the way to the far plane the shell sits. Fog has swallowed the terrain
 *  long before this, so nothing can poke through it. */
const SHELL_REACH = 0.98;

/** Reused so the per-frame light tinting allocates nothing. */
const WHITE = new THREE.Color(0xffffff);

const DAY_ZENITH = new THREE.Color(0x4ba3f5);
const DAY_HORIZON = new THREE.Color(0xd6efff);
const NIGHT_ZENITH = new THREE.Color(0x090e2a);
const NIGHT_HORIZON = new THREE.Color(0x222c58);
/** The band the sun lays along the horizon as it goes down. */
const DUSK_HORIZON = new THREE.Color(0xff9c62);
const DUSK_ZENITH = new THREE.Color(0x6a6ec0);
/** Overcast grey the sky is dragged towards in heavy rain. */
const RAIN_SKY = new THREE.Color(0x8e9ab0);
/** Dusty haze of a dry season. */
const DROUGHT_SKY = new THREE.Color(0xe8dcb4);

/** Warm low sun, near-white at noon. */
const SUN_LOW = new THREE.Color(0xffb277);
const SUN_HIGH = new THREE.Color(0xfff6e8);
/** Once the sun is down the world is lit by the moon, which is cold. Without this the
 *  key light stays the low sun's orange and midnight comes out the colour of dusk. */
const MOON_LIGHT = new THREE.Color(0x8ea6dc);

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // The shell is pinned to the camera, so only the rotation of the view matters.
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShadow;
  uniform float uSun;
  uniform float uTime;
  uniform float uCoverage;
  #include <common>

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
  }

  float valueNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float fbm( vec2 p ) {
    float total = 0.0;
    float amplitude = 0.5;
    for ( int octave = 0; octave < 4; octave++ ) {
      total += amplitude * valueNoise( p );
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec3 dir = normalize( vDir );

    // Compressing the gradient towards the horizon keeps the pale band thin, which is
    // what stops a plain lerp reading as a painted backdrop.
    float height = clamp( dir.y, 0.0, 1.0 );
    vec3 color = mix( uHorizon, uZenith, pow( height, 0.42 ) );
    // Below eye level the air just gets hazier, so fade towards the horizon colour.
    color = mix( uHorizon, color, smoothstep( -0.25, 0.02, dir.y ) );

    float towardsSun = max( dot( dir, uSunDir ), 0.0 );
    // Two lobes: a wide bloom of scattered light, and the tight glare by the disc.
    float glow = pow( towardsSun, 6.0 ) * 0.22 + pow( towardsSun, 96.0 ) * 0.5;
    color += uSunColor * glow * uSun;

    // Clouds live on a plane overhead. Dividing by dir.y is the projection onto it,
    // so they spread out above and pile up towards the horizon on their own.
    if ( dir.y > 0.015 ) {
      vec2 plane = dir.xz / dir.y;
      float density = fbm( plane * 0.6 + vec2( uTime * 0.004, uTime * 0.0015 ) );
      // Second, slower layer so the deck churns instead of sliding rigidly.
      density = mix( density, fbm( plane * 1.3 - vec2( uTime * 0.002, 0.0 ) ), 0.35 );
      float amount = smoothstep( 0.62 - uCoverage * 0.42, 0.86 - uCoverage * 0.2, density );
      // The projection stretches to infinity at the horizon; fade out before it does.
      amount *= smoothstep( 0.015, 0.2, dir.y );
      // Lit from the sun's side, shadowed away from it.
      vec3 cloud = mix( uCloudShadow, uCloudLit, 0.35 + 0.65 * pow( towardsSun, 2.0 ) );
      // After dark a cloud is a hole in the starfield, not a bright shape.
      cloud = mix( uCloudShadow * 0.1, cloud, uSun );
      // What little light there is at night comes from the moon, straight opposite.
      cloud += uCloudLit * 0.12 * pow( max( -dot( dir, uSunDir ), 0.0 ), 3.0 ) * ( 1.0 - uSun );
      color = mix( color, cloud, amount * 0.92 );
    }

    float towardsMoon = max( -dot( dir, uSunDir ), 0.0 );
    color += vec3( 0.62, 0.68, 0.86 ) * pow( towardsMoon, 24.0 ) * 0.35 * ( 1.0 - uSun );

    // The disc, drawn last so cloud can pass in front of it.
    float disc = smoothstep( 0.99915, 0.99945, towardsSun );
    color = mix( color, uSunColor * 2.6, disc * uSun );

    gl_FragColor = vec4( color, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  uniform float uTime;
  varying float vTwinkle;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    // Each star gets its own phase out of its size, so they do not blink in unison.
    vTwinkle = 0.68 + 0.32 * sin( uTime * 1.6 + aSize * 37.0 );
    gl_PointSize = aSize;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    // A round, soft-edged dot rather than the default square.
    float r = length( gl_PointCoord - 0.5 );
    float alpha = smoothstep( 0.5, 0.12, r ) * uOpacity * vTwinkle;
    if ( alpha <= 0.0 ) discard;
    gl_FragColor = vec4( 1.0, 0.98, 0.94, alpha );
  }
`;

/** Sky colour, sun, moon, stars and the scene lights that mobs are lit by. */
export class Sky {
  readonly group = new THREE.Group();
  readonly fog: THREE.Fog;
  /** Unit vector from the world towards the sun, and the colour it is casting.
   *  The terrain shader lights every face against these. */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color(1, 1, 1);
  /** The colour the sky shows at eye level. Fog takes it, and so does the water when
   *  it reflects at a grazing angle. */
  readonly horizon = new THREE.Color();
  /** Seconds of sky time, for the cloud drift and the swell on the water. */
  elapsed = 0;
  private readonly dome: THREE.Mesh;
  private readonly domeUniforms: Record<string, THREE.IUniform>;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starUniforms: Record<string, THREE.IUniform>;
  private readonly ambient: THREE.HemisphereLight;
  private readonly directional: THREE.DirectionalLight;
  private readonly zenith = new THREE.Color();
  /** Fog distances for clear weather, which rain and haze pull in from. */
  private baseNear: number;
  private baseFar: number;

  constructor(scene: THREE.Scene, renderDistanceBlocks: number) {
    this.baseNear = renderDistanceBlocks * 0.45;
    this.baseFar = renderDistanceBlocks * 0.95;
    this.fog = new THREE.Fog(DAY_HORIZON.getHex(), this.baseNear, this.baseFar);
    scene.fog = this.fog;

    this.domeUniforms = {
      uZenith: { value: new THREE.Color(DAY_ZENITH) },
      uHorizon: { value: new THREE.Color(DAY_HORIZON) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uCloudLit: { value: new THREE.Color(0xfffaf2) },
      uCloudShadow: { value: new THREE.Color(0xc3cede) },
      uSun: { value: 1 },
      uTime: { value: 0 },
      uCoverage: { value: 0.25 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SHELL, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        // The shell is drawn before anything else and writes no depth, so the world
        // simply paints over it.
        depthWrite: false,
        fog: false,
      }),
    );

    const moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3f7ff,
      fog: false,
      depthWrite: false,
      transparent: true,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(SHELL * 0.115, SHELL * 0.115), moonMaterial);

    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const rng = mulberry32(0x57a2);
    for (let i = 0; i < starCount; i++) {
      // Uniform points on the upper half of a sphere.
      const theta = rng() * Math.PI * 2;
      const y = rng();
      const r = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(theta) * r * SHELL * 0.98;
      positions[i * 3 + 1] = y * SHELL * 0.98;
      positions[i * 3 + 2] = Math.sin(theta) * r * SHELL * 0.98;
      sizes[i] = 1.1 + rng() * rng() * 3.2;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.starUniforms = { uOpacity: { value: 0 }, uTime: { value: 0 } };
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );

    this.ambient = new THREE.HemisphereLight(0xdcecff, 0x9c917f, 1.1);
    this.directional = new THREE.DirectionalLight(0xfff4e2, 1.1);

    // The dome goes down before the rest of the scene; the stars and the moon are
    // transparent, so they come after it and let the terrain occlude them.
    this.dome.renderOrder = -1000;
    this.stars.renderOrder = -999;
    this.moon.renderOrder = -998;
    for (const object of [this.dome, this.stars, this.moon]) object.frustumCulled = false;

    this.group.add(this.dome, this.stars, this.moon);
    scene.add(this.group, this.ambient, this.directional);
  }

  /** Repositions everything around the camera and applies the current lighting. */
  update(
    day: DayCycle,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    wetness = 0,
    dt = 0,
  ): void {
    this.elapsed += dt;
    const sun = day.sunLight;
    const angle = day.sunAngle;
    const sunDir = this.sunDirection.set(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    // The lower the sun, the longer its path through the air and the warmer it burns —
    // until it is gone altogether and the moon takes over.
    this.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, Math.min(1, Math.max(0, sunDir.y) * 2.4));
    this.sunColor.lerp(MOON_LIGHT, Math.min(1, Math.max(0, -sunDir.y) * 3));

    // How close the sun is to the horizon, which is when it paints the sky.
    const dusk = Math.max(0, 1 - Math.abs(sunDir.y) * 3.2);
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, sun);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, sun);
    this.zenith.lerp(DUSK_ZENITH, dusk * sun * 0.8);
    this.horizon.lerp(DUSK_HORIZON, dusk * sun * 0.9);
    // The season tints the sky, but only in daylight: a drought does not brighten the
    // night, it just leaves the air dusty by day.
    if (wetness > 0) {
      this.zenith.lerp(RAIN_SKY, Math.min(1, wetness) * 0.7 * sun);
      this.horizon.lerp(RAIN_SKY, Math.min(1, wetness) * 0.8 * sun);
    } else if (wetness < 0) {
      this.zenith.lerp(DROUGHT_SKY, Math.min(1, -wetness) * 0.25 * sun);
      this.horizon.lerp(DROUGHT_SKY, Math.min(1, -wetness) * 0.4 * sun);
    }

    (this.domeUniforms.uZenith.value as THREE.Color).copy(this.zenith);
    (this.domeUniforms.uHorizon.value as THREE.Color).copy(this.horizon);
    (this.domeUniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.domeUniforms.uSunColor.value as THREE.Color).copy(this.sunColor);
    this.domeUniforms.uSun.value = sun;
    this.domeUniforms.uTime.value = this.elapsed;
    // Rain arrives with an overcast deck; a drought burns it off.
    this.domeUniforms.uCoverage.value = 0.25 + Math.max(-0.2, Math.min(0.7, wetness * 0.7));

    // Fog belongs to the terrain, so it matches what the sky does at eye level.
    renderer.setClearColor(this.horizon);
    this.fog.color.copy(this.horizon);
    // Rain closes the view in; a dry haze does the same, more gently.
    const closeIn = wetness > 0 ? wetness * 0.45 : -wetness * 0.15;
    this.fog.near = this.baseNear * (1 - closeIn);
    this.fog.far = this.baseFar * (1 - closeIn * 0.75);

    const position = camera.position;
    this.group.position.copy(position);
    // Keep the shell just inside whatever far plane the render distance implies.
    const far = (camera as THREE.PerspectiveCamera).far ?? 1000;
    this.group.scale.setScalar((far * SHELL_REACH) / SHELL);
    this.moon.position.copy(sunDir).multiplyScalar(-SHELL * 0.95);
    this.moon.lookAt(position);
    this.stars.rotation.z = angle;
    const night = Math.max(0, 1 - sun * 2.2);
    this.starUniforms.uOpacity.value = night;
    this.starUniforms.uTime.value = this.elapsed;
    (this.moon.material as THREE.MeshBasicMaterial).opacity = night;

    this.ambient.intensity = 0.35 + sun * 0.85;
    this.ambient.color.copy(this.horizon).lerp(WHITE, 0.35);
    this.directional.intensity = 0.25 + sun * 0.95;
    this.directional.color.copy(this.sunColor);
    this.directional.position.copy(position).addScaledVector(sunDir, 100);
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
