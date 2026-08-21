import * as THREE from 'three';
import { FACE_BASIS } from './mesher';

/** Chunk shader. Skylight and block light are baked into vertex attributes, so the
 *  day/night cycle only has to change a uniform instead of rebuilding meshes.
 *
 *  Two things happen here that a plain textured cube does not do. The blocks are
 *  rounded off: every vertex carries where it sits on its own face, and the fragment
 *  stage measures that against a rounded square, bending the surface normal outwards
 *  as it nears the outline. And that normal is then lit for real — against the sun's
 *  actual direction and colour, with a hemispheric ambient underneath and a soft
 *  specular sheen on top. So an edge is not painted darker, it is *shaped*: it
 *  catches the light at dawn from the east and loses it by dusk. */

/** How much of the face the rounding eats into, and how far the corners are cut. */
const BEVEL_WIDTH = 0.3;
const CORNER_RADIUS = 0.42;
/** How far the normal tips outwards at the very edge. 1.0 would lay it flat. */
const BEVEL_BEND = 0.62;
/** Contact darkening in the crease, on top of the directional lighting. */
const EDGE_SHADE = 0.88;
/** The sun's highlight: a broad, weak lobe. A tight one turns every rounded edge
 *  into a white pip, which reads as an artefact rather than a sheen. */
const SPECULAR = 0.13;
const SPECULAR_POWER = 10;

/** GLSL that rebuilds a face's surface frame from its id. Generated from the mesher's
 *  own corner table, so the shader's idea of "along the face" cannot drift from the
 *  geometry's, and generated as a branch chain because indexing an array with a
 *  varying is not portable. */
function faceFrameGlsl(): string {
  const vec = (v: readonly [number, number, number]): string =>
    `vec3( ${v.map((n) => n.toFixed(1)).join(', ')} )`;
  const branches = FACE_BASIS.map(
    (frame, index) =>
      `    ${index === 0 ? 'if' : 'else if'} ( id < ${(index + 0.5).toFixed(1)} ) { ` +
      `n = ${vec(frame.normal)}; t = ${vec(frame.tangent)}; b = ${vec(frame.bitangent)}; }`,
  );
  return `
  void faceFrame( float id, out vec3 n, out vec3 t, out vec3 b ) {
${branches.join('\n')}
    else { n = vec3( 0.0, 1.0, 0.0 ); t = vec3( 1.0, 0.0, 0.0 ); b = vec3( 0.0, 0.0, 1.0 ); }
  }
`;
}

const VERTEX = /* glsl */ `
  attribute vec2 aLight;
  attribute float aShade;
  attribute vec2 aFace;
  attribute float aFaceId;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec2 vFace;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying vec3 vBitangent;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_vertex>
${faceFrameGlsl()}
  void main() {
    vLight = aLight;
    vShade = aShade;
    vUvTile = uv;
    vFace = aFace;
    faceFrame( aFaceId, vNormal, vTangent, vBitangent );
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorld = worldPosition.xyz;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uSun;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uOpacity;
  uniform float uBevel;
  uniform float uRadius;
  uniform float uBend;
  uniform float uEdgeShade;
  uniform float uSpecular;
  uniform float uSpecularPower;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying vec2 vFace;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying vec3 vBitangent;
  varying vec3 vWorld;
  #include <common>
  // three.js already puts the tone mapping functions in the fragment prefix; only the
  // call site below has to be spelled out.
  #include <fog_pars_fragment>

  /** Torchlight is firelight: warm, and quite unlike the sun. */
  const vec3 TORCH_COLOR = vec3( 1.0, 0.76, 0.48 );

  void main() {
    vec4 texel = texture2D( uMap, vUvTile );
    #ifdef CUTOUT
      if ( texel.a < 0.5 ) discard;
    #endif

    // Distance to the outline of a rounded square filling the face: negative in the
    // middle, zero on the outline, positive out in the corners the rounding cuts away.
    vec2 p = vFace - 0.5;
    vec2 q = abs( p ) - ( 0.5 - uRadius );
    float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uRadius;
    float edge = smoothstep( -uBevel, 0.0, sd );

    // Which way "outwards along the surface" points here, so the normal can tip that
    // way as it approaches the outline.
    vec2 outer = max( q, 0.0 );
    vec2 grad = outer.x + outer.y > 0.0
      ? normalize( outer )
      : ( q.x > q.y ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) );
    grad *= sign( p );
    vec3 outward = grad.x * vTangent + grad.y * vBitangent;
    float reach = length( outward );
    // Flat surfaces — water sheets, foliage cut-outs — sit at the face centre, where
    // there is no outward direction to speak of and no rounding to apply.
    outward = reach > 1e-4 ? outward / reach : vNormal;
    vec3 normal = normalize( mix( vNormal, outward, edge * uBend ) );

    // Sky above, bounce below: the shape a surface has before any sun reaches it.
    float hemisphere = 0.55 + 0.45 * ( 0.5 + 0.5 * normal.y );
    float sunFacing = max( dot( normal, uSunDir ), 0.0 );
    float form = mix( hemisphere, mix( 0.5, 1.0, sunFacing ), uSun * 0.8 );

    // Sunlight fades with the time of day; torch light never does.
    float skyPart = vLight.x * uSun;
    float torchPart = vLight.y;
    float level = max( skyPart, torchPart );
    float lit = mix( 0.14, 1.0, pow( clamp( level, 0.0, 1.0 ), 1.2 ) );
    vec3 tint = mix( TORCH_COLOR, uSunColor, skyPart / max( skyPart + torchPart, 1e-4 ) );

    vec3 view = normalize( cameraPosition - vWorld );
    vec3 halfway = normalize( uSunDir + view );
    float specular = pow( max( dot( normal, halfway ), 0.0 ), uSpecularPower ) * uSpecular * uSun * skyPart;

    // A little extra darkening in the crease, so the rounding still reads when the
    // sun is square on the face and the normal alone would not show it.
    float cavity = mix( 1.0, uEdgeShade, edge );

    vec3 color = texel.rgb * lit * vShade * form * cavity * tint + specular * uSunColor;
    gl_FragColor = vec4( color, texel.a * uOpacity );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  transparent: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
  /** Updates the sunlight level shared by all passes. */
  setSun(value: number): void;
  /** Direction from the world towards the sun, and the colour it is shining. */
  setSunLight(direction: THREE.Vector3, color: THREE.Color): void;
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
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: options.opacity ?? 1 },
        uBevel: { value: BEVEL_WIDTH },
        uRadius: { value: CORNER_RADIUS },
        uBend: { value: BEVEL_BEND },
        uEdgeShade: { value: EDGE_SHADE },
        uSpecular: { value: SPECULAR },
        uSpecularPower: { value: SPECULAR_POWER },
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
    setSunLight(direction: THREE.Vector3, color: THREE.Color) {
      for (const material of all()) {
        (material.uniforms.uSunDir.value as THREE.Vector3).copy(direction);
        (material.uniforms.uSunColor.value as THREE.Color).copy(color);
      }
    },
  };
}
