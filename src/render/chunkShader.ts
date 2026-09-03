/** The chunk shader, kept apart from the material that carries it so that the source
 *  can be read without pulling in three.js — which is what lets the water surface be
 *  checked in the test suite (see `waterSurface.test.ts`).
 *
 *  Skylight and block light are baked into vertex attributes, so the day/night cycle
 *  only has to change one uniform instead of rebuilding meshes. */

export const VERTEX = /* glsl */ `
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
      // The swell is phased off the WORLD position and applied to every water vertex
      // rather than only the ones facing up. The attribute is chunk-local, so phasing
      // off it restarts the wave at every chunk border and tears a hairline slot down
      // it; lifting only the upward faces tears the same slot along the top edge of
      // every side face. Two vertices in the same place now always move together,
      // whichever chunk or face they came from.
      vec3 swellAt = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      transformed.y += sin( ( swellAt.x + swellAt.z ) * 1.65 + uTime * 1.8 ) * 0.025;
    #endif
    vWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const FRAGMENT = /* glsl */ `
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
