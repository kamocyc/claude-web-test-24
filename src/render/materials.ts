import * as THREE from 'three';

/** Chunk shader. Skylight and block light are baked into vertex attributes, so the
 *  day/night cycle only has to change one uniform instead of rebuilding meshes. */

const VERTEX = /* glsl */ `
  attribute vec2 aLight;
  attribute float aShade;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vLight = aLight;
    vShade = aShade;
    vUvTile = uv;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
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
    gl_FragColor = vec4( texel.rgb * lit * vShade, texel.a * uOpacity );
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
  all(): THREE.ShaderMaterial[];
}

function make(
  map: THREE.Texture,
  options: { cutout?: boolean; transparent?: boolean; opacity?: number; doubleSided?: boolean },
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: null }, uSun: { value: 1 }, uOpacity: { value: options.opacity ?? 1 } },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    transparent: options.transparent ?? false,
    depthWrite: !(options.transparent ?? false),
    side: options.cutout || options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    defines: options.cutout ? { CUTOUT: '' } : {},
  });
  material.uniforms.uMap.value = map;
  return material;
}

export function createChunkMaterials(map: THREE.Texture): ChunkMaterials {
  const opaque = make(map, {});
  const cutout = make(map, { cutout: true });
  const transparent = make(map, { transparent: true, opacity: 0.82 });
  // Water is drawn from both sides so a submerged camera still sees the surface.
  const water = make(map, { transparent: true, opacity: 0.72, doubleSided: true });
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
  };
}
