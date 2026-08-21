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
/** How far past the face the rounding is pushed on an edge whose surface carries on
 *  into the next block. Nothing there is a silhouette, so it should only crease. */
const CARRY_ON = 0.62;
/** How far the normal tips outwards at the very edge. 1.0 would lay it flat. */
const BEVEL_BEND = 0.62;
/** Contact darkening in the crease, on top of the directional lighting. */
const EDGE_SHADE = 0.8;
/** Height of the swell on open water, and how much its slope is exaggerated when the
 *  normal is rebuilt. The displacement stays tiny so the sheet cannot tear away from
 *  the cell it sits in; the exaggeration is what makes it read. */
const WAVE_HEIGHT = 0.03;
const WAVE_SLOPE = 7;

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

/** Three crossing swells. Shared verbatim by both stages: the vertex shader lifts the
 *  surface with it and the fragment shader differentiates it for the normal, and the
 *  two have to agree or the highlights slide off the crests. */
const WAVES = /* glsl */ `
  uniform float uTime;
  uniform float uWave;
  uniform float uSlope;

  float waveHeight( vec2 p ) {
    return (
      sin( p.x * 1.9 + uTime * 1.7 ) * 0.5 +
      sin( p.y * 2.6 - uTime * 1.2 ) * 0.35 +
      sin( ( p.x + p.y ) * 1.3 + uTime * 0.8 ) * 0.3
    ) * uWave;
  }

  vec3 waveNormal( vec2 p ) {
    float diagonal = cos( ( p.x + p.y ) * 1.3 + uTime * 0.8 ) * 1.3 * 0.3;
    float dx = cos( p.x * 1.9 + uTime * 1.7 ) * 1.9 * 0.5 + diagonal;
    float dz = cos( p.y * 2.6 - uTime * 1.2 ) * 2.6 * -0.35 + diagonal;
    return normalize( vec3( -dx * uWave * uSlope, 1.0, -dz * uWave * uSlope ) );
  }
`;

const VERTEX = /* glsl */ `
  attribute vec2 aLight;
  attribute float aShade;
  attribute vec2 aFace;
  attribute float aFaceId;
  attribute float aLayer;
  attribute float aEdges;
  varying vec2 vLight;
  varying float vShade;
  varying vec2 vUvTile;
  varying float vLayer;
  varying vec2 vFace;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying vec3 vBitangent;
  varying vec3 vWorld;
  varying vec2 vLow;
  varying vec2 vHigh;
  uniform float uCarry;
  #include <common>
  #include <fog_pars_vertex>
${faceFrameGlsl()}
#ifdef WATER
${WAVES}
#endif
  void main() {
    vLight = aLight;
    vShade = aShade;
    vUvTile = uv;
    vLayer = aLayer;
    vFace = aFace;
    faceFrame( aFaceId, vNormal, vTangent, vBitangent );
    // The four edge flags say which sides of this face actually stop here. The ones
    // that carry on have their boundary pushed outside the face, so the rounding never
    // reaches them and a flat wall stays flat.
    vec4 open = vec4(
      mod( floor( aEdges ), 2.0 ),
      mod( floor( aEdges / 2.0 ), 2.0 ),
      mod( floor( aEdges / 4.0 ), 2.0 ),
      mod( floor( aEdges / 8.0 ), 2.0 )
    );
    vLow = vec2( mix( -uCarry, 0.0, open.x ), mix( -uCarry, 0.0, open.z ) );
    vHigh = vec2( mix( 1.0 + uCarry, 1.0, open.y ), mix( 1.0 + uCarry, 1.0, open.w ) );
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    #ifdef WATER
      // Only the surface rises and falls. The sides of a cell stay put, so the sheet
      // cannot tear away from the block it is sitting in.
      if ( vNormal.y > 0.5 ) worldPosition.y += waveHeight( worldPosition.xz );
    #endif
    vWorld = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  // three compiles every ShaderMaterial as GLSL ES 3.00, so the array sampler and the
  // texture() overload below are available without asking for a raw shader.
  uniform sampler2DArray uMap;
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
  varying float vLayer;
  varying vec2 vFace;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying vec3 vBitangent;
  varying vec3 vWorld;
  varying vec2 vLow;
  varying vec2 vHigh;
  uniform vec3 uSkyColor;
  #include <common>
  // three.js already puts the tone mapping functions in the fragment prefix; only the
  // call site below has to be spelled out.
  #include <fog_pars_fragment>
#ifdef WATER
${WAVES}
#endif

  /** Torchlight is firelight: warm, and quite unlike the sun. */
  const vec3 TORCH_COLOR = vec3( 1.0, 0.76, 0.48 );

  void main() {
    vec4 texel = texture( uMap, vec3( vUvTile, vLayer ) );
    #ifdef CUTOUT
      if ( texel.a < 0.5 ) discard;
    #endif

    // Distance to the outline of a rounded rectangle over the face: negative in the
    // middle, zero on the outline, positive out in the corners the rounding cuts away.
    // The rectangle is only the face itself where the face ends; where it carries on
    // into the next block the rectangle reaches past, and nothing is rounded there.
    vec2 centre = ( vLow + vHigh ) * 0.5;
    vec2 extent = ( vHigh - vLow ) * 0.5;
    vec2 p = vFace - centre;
    vec2 q = abs( p ) - ( extent - uRadius );
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
    #ifdef WATER
      if ( vNormal.y > 0.5 ) normal = waveNormal( vWorld.xz );
    #endif

    // Sky above, bounce below: the shape a surface has before any sun reaches it.
    float hemisphere = 0.48 + 0.52 * ( 0.5 + 0.5 * normal.y );
    float sunFacing = max( dot( normal, uSunDir ), 0.0 );
    float form = mix( hemisphere, mix( 0.42, 1.0, sunFacing ), uSun * 0.85 );

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
    float alpha = texel.a * uOpacity;

    #ifdef WATER
      // Water mirrors the sky at a grazing angle and lets you see the bottom when you
      // look straight down, which is the difference between a pond and blue glass.
      float facing = pow( 1.0 - max( dot( normal, view ), 0.0 ), 4.0 );
      color = mix( color, uSkyColor * ( 0.35 + 0.65 * uSun ), facing * 0.72 );
      alpha = mix( alpha, 0.97, facing );
      // Glitter where the sun lines up with a crest. The lobe is kept broad: a tight
      // one traces a contour of the wave function and reads as a drawn line.
      float glint = pow( max( dot( normal, halfway ), 0.0 ), 70.0 );
      color += uSunColor * glint * 0.9 * uSun * skyPart;
    #endif

    gl_FragColor = vec4( color, alpha );
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
  /** What the water reflects, and how far the swell has travelled. */
  setSky(color: THREE.Color, elapsed: number): void;
  all(): THREE.ShaderMaterial[];
}

function make(
  map: THREE.DataArrayTexture,
  options: {
    cutout?: boolean;
    transparent?: boolean;
    opacity?: number;
    doubleSided?: boolean;
    water?: boolean;
  },
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
        uCarry: { value: CARRY_ON },
        uSpecular: { value: SPECULAR },
        uSpecularPower: { value: SPECULAR_POWER },
        uSkyColor: { value: new THREE.Color(1, 1, 1) },
        uTime: { value: 0 },
        uWave: { value: WAVE_HEIGHT },
        uSlope: { value: WAVE_SLOPE },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    transparent: options.transparent ?? false,
    depthWrite: !(options.transparent ?? false),
    side: options.cutout || options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    defines: {
      ...(options.cutout ? { CUTOUT: '' } : {}),
      ...(options.water ? { WATER: '' } : {}),
    },
  });
  material.uniforms.uMap.value = map;
  return material;
}

export function createChunkMaterials(map: THREE.DataArrayTexture): ChunkMaterials {
  const opaque = make(map, {});
  const cutout = make(map, { cutout: true });
  const transparent = make(map, { transparent: true, opacity: 0.82 });
  // Water is drawn from both sides so a submerged camera still sees the surface.
  const water = make(map, { transparent: true, opacity: 0.66, doubleSided: true, water: true });
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
    setSky(color: THREE.Color, elapsed: number) {
      (water.uniforms.uSkyColor.value as THREE.Color).copy(color);
      water.uniforms.uTime.value = elapsed;
    },
  };
}
