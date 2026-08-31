import * as THREE from 'three';

/** Chunk shader. Skylight and block light are baked into vertex attributes, so the
 *  day/night cycle only has to change one uniform instead of rebuilding meshes. */

const VERTEX = /* glsl */ `
  attribute vec2 aLight;
  attribute float aShade;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  uniform float uTime;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vLight = aLight;
    vShade = aShade;
    vUvTile = uv;
    vNormal = normalize( normalMatrix * normal );
    vec3 transformed = position;
    #ifdef WATER
      if ( normal.y > 0.5 ) transformed.y += sin( ( position.x + position.z ) * 1.65 + uTime * 1.8 ) * 0.025;
    #endif
    vWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSun;
  uniform float uOpacity;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  uniform float uTime;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 texel = texture2D( uMap, vUvTile );
    #ifdef CUTOUT
      if ( texel.a < 0.5 ) discard;
    #endif
    // Sunlight fades with the time of day; torch light never does.
    float level = max( vLight.x * uSun, vLight.y );
    float lit = mix( 0.085, 1.0, pow( clamp( level, 0.0, 1.0 ), 1.35 ) );
    float wrap = 0.82 + max( dot( normalize( vNormal ), normalize( vec3( -0.45, 0.82, 0.35 ) ) ), -0.2 ) * 0.18;
    #ifdef WATER
      float glint = sin( ( vWorldPosition.x + vWorldPosition.z ) * 0.72 + uTime * 2.2 ) * 0.5 + 0.5;
      texel.rgb = mix( texel.rgb, vec3( 0.50, 0.84, 0.95 ), 0.42 + glint * 0.08 );
      wrap = 1.0;
    #endif
    gl_FragColor = vec4( texel.rgb * lit * vShade * wrap, texel.a * uOpacity );
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  transparent: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
  /** Updates the sunlight level shared by all three passes. */
  setSun(value: number): void;
  setTime(value: number): void;
  all(): THREE.ShaderMaterial[];
}

function make(
  map: THREE.Texture,
  options: { cutout?: boolean; transparent?: boolean; opacity?: number; doubleSided?: boolean; water?: boolean },
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: null }, uSun: { value: 1 }, uOpacity: { value: options.opacity ?? 1 }, uTime: { value: 0 } },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    transparent: options.transparent ?? false,
    depthWrite: !(options.transparent ?? false),
    side: options.cutout || options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    defines: { ...(options.cutout ? { CUTOUT: '' } : {}), ...(options.water ? { WATER: '' } : {}) },
  });
  material.uniforms.uMap.value = map;
  return material;
}

export function createChunkMaterials(map: THREE.Texture): ChunkMaterials {
  const opaque = make(map, {});
  const cutout = make(map, { cutout: true });
  const transparent = make(map, { transparent: true, opacity: 0.82 });
  // Water is drawn from both sides so a submerged camera still sees the surface.
  const water = make(map, { transparent: true, opacity: 0.76, doubleSided: true, water: true });
  const all = (): THREE.ShaderMaterial[] => [opaque, cutout, transparent, water];
  return {
    opaque,
    cutout,
    transparent,
    water,
    all,
    setSun(value: number) {
      for (const material of all()) material.uniforms.uSun.value = value;
    },
    setTime(value: number) {
      for (const material of all()) material.uniforms.uTime.value = value;
    },
  };
}
