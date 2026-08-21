import * as THREE from 'three';

/** Chunk shader. Skylight and block light are baked into vertex attributes, so the
 *  day/night cycle only has to change one uniform instead of rebuilding meshes.
 *
 *  The shader also rounds the blocks off. Every face carries its own 0..1 coordinate,
 *  so the fragment stage can measure how far a pixel sits from the outline of a
 *  rounded square and shade the border like the roll-off of a bevelled edge. That
 *  costs nothing in geometry, and it stops a field of cubes reading as a grid of
 *  sharp corners. */

/** How much of the face the roll-off eats into, and how far the corners are rounded. */
const BEVEL_WIDTH = 0.3;
const CORNER_RADIUS = 0.42;
/** Brightness at the very edge of a face, relative to its middle. */
const EDGE_SHADE = 0.76;

const VERTEX = /* glsl */ `
  attribute vec2 aLight;
  attribute float aShade;
  attribute vec2 aFace;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec2 vFace;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vLight = aLight;
    vShade = aShade;
    vUvTile = uv;
    vFace = aFace;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSun;
  uniform float uOpacity;
  uniform float uBevel;
  uniform float uRadius;
  uniform float uEdgeShade;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec2 vFace;
  #include <common>
  #include <fog_pars_fragment>

  /** Signed distance to the outline of a rounded square filling the face: negative in
   *  the middle, zero on the outline, positive out in the four corners the rounding
   *  cuts away. */
  float faceDistance( vec2 face, float radius ) {
    vec2 q = abs( face - 0.5 ) - ( 0.5 - radius );
    return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - radius;
  }

  void main() {
    vec4 texel = texture2D( uMap, vUvTile );
    #ifdef CUTOUT
      if ( texel.a < 0.5 ) discard;
    #endif
    // Sunlight fades with the time of day; torch light never does.
    float level = max( vLight.x * uSun, vLight.y );
    float lit = mix( 0.14, 1.0, pow( clamp( level, 0.0, 1.0 ), 1.2 ) );
    // Darken towards the outline of the rounded square. The corners lie outside it
    // altogether, so they take the full roll-off and stop reading as corners.
    float edge = smoothstep( -uBevel, 0.0, faceDistance( vFace, uRadius ) );
    float bevel = mix( 1.0, uEdgeShade, edge );
    gl_FragColor = vec4( texel.rgb * lit * vShade * bevel, texel.a * uOpacity );
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
      {
        uMap: { value: null },
        uSun: { value: 1 },
        uOpacity: { value: options.opacity ?? 1 },
        uBevel: { value: BEVEL_WIDTH },
        uRadius: { value: CORNER_RADIUS },
        uEdgeShade: { value: EDGE_SHADE },
      },
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
