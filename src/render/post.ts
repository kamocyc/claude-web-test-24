import * as THREE from 'three';

/** Post-processing: bloom, a vignette and a light grade, applied after the scene is
 *  drawn into a floating-point buffer.
 *
 *  This is deliberately not three's EffectComposer with UnrealBloomPass. That walks a
 *  mip pyramid and costs five blur pairs; here the whole chain is a bright pass and one
 *  separable blur at quarter resolution, then a single composite. Four extra draws, most
 *  of them over a sixteenth of the pixels.
 *
 *  While this is running the renderer's own tone mapping is off and the scene is kept in
 *  linear light all the way to the composite, which is the only place values are squeezed
 *  into display range. Bloom taken from an already tone-mapped image glows off midtones
 *  instead of off the highlights that are actually blowing out. */

const QUARTER = 4;

/** These are raw shaders — three prepends nothing but the version line — so the whole
 *  GLSL ES 3.00 preamble is spelled out here. */
const FULLSCREEN_VERTEX = /* glsl */ `
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

const FRAGMENT_HEAD = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
`;

/** Keeps only what is brighter than the threshold, with a soft shoulder so a surface
 *  drifting past it fades in rather than popping. */
const BRIGHT_FRAGMENT = /* glsl */ `
  uniform sampler2D uScene;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 color = texture( uScene, vUv ).rgb;
    float level = max( color.r, max( color.g, color.b ) );
    float weight = smoothstep( uThreshold, uThreshold + uKnee, level );
    fragColor = vec4( color * weight, 1.0 );
  }
`;

/** One half of a separable gaussian; uDirection picks the axis. */
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D uSource;
  uniform vec2 uTexel;
  uniform vec2 uDirection;
  void main() {
    vec2 step = uTexel * uDirection;
    vec3 total = texture( uSource, vUv ).rgb * 0.227027;
    total += ( texture( uSource, vUv + step * 1.3846 ).rgb
             + texture( uSource, vUv - step * 1.3846 ).rgb ) * 0.316216;
    total += ( texture( uSource, vUv + step * 3.2308 ).rgb
             + texture( uSource, vUv - step * 3.2308 ).rgb ) * 0.070270;
    fragColor = vec4( total, 1.0 );
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uBloomStrength;
  uniform float uVignette;
  uniform float uSaturation;
  uniform float uExposure;

  // The filmic curve three uses, applied here rather than per material so bloom is
  // gathered from linear light.
  vec3 aces( vec3 color ) {
    color *= 0.6;
    return clamp(
      ( color * ( 2.51 * color + 0.03 ) ) / ( color * ( 2.43 * color + 0.59 ) + 0.14 ),
      0.0, 1.0
    );
  }

  void main() {
    vec3 color = texture( uScene, vUv ).rgb;
    color += texture( uBloom, vUv ).rgb * uBloomStrength;
    color *= uExposure;

    color = aces( color );

    // A gentle pull away from grey, after tone mapping, where it reads as grade rather
    // than as brighter colour.
    float grey = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( grey ), color, uSaturation );

    // Corners fall off, which settles the eye in the middle of the frame.
    vec2 offset = vUv - 0.5;
    float falloff = 1.0 - dot( offset, offset ) * uVignette;
    color *= clamp( falloff, 0.0, 1.0 );

    // Nothing converts this for us on a raw shader, so encode for the display here.
    color = mix(
      color * 12.92,
      1.055 * pow( max( color, vec3( 0.0031308 ) ), vec3( 1.0 / 2.4 ) ) - 0.055,
      step( vec3( 0.0031308 ), color )
    );
    fragColor = vec4( color, 1.0 );
  }
`;

function fullscreenMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: FRAGMENT_HEAD + fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

export interface PostOptions {
  /** How much of the blurred highlight is added back. */
  bloom: number;
  /** Brightness a surface has to reach before it starts to glow. */
  threshold: number;
  vignette: number;
  saturation: number;
  exposure: number;
}

export const DEFAULT_POST: PostOptions = {
  bloom: 0.5,
  threshold: 1.05,
  vignette: 0.42,
  saturation: 1.06,
  exposure: 1.05,
};

export class Post {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly bright: THREE.RawShaderMaterial;
  private readonly blur: THREE.RawShaderMaterial;
  private readonly composite: THREE.RawShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer, options: PostOptions = DEFAULT_POST) {
    const target = (scale: number): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        depthBuffer: scale === 1,
        colorSpace: THREE.LinearSRGBColorSpace,
      });
    this.sceneTarget = target(1);
    this.bloomA = target(QUARTER);
    this.bloomB = target(QUARTER);

    this.bright = fullscreenMaterial(BRIGHT_FRAGMENT, {
      uScene: { value: this.sceneTarget.texture },
      uThreshold: { value: options.threshold },
      uKnee: { value: 0.6 },
    });
    this.blur = fullscreenMaterial(BLUR_FRAGMENT, {
      uSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2(1, 0) },
    });
    this.composite = fullscreenMaterial(COMPOSITE_FRAGMENT, {
      uScene: { value: this.sceneTarget.texture },
      uBloom: { value: this.bloomA.texture },
      uBloomStrength: { value: options.bloom },
      uVignette: { value: options.vignette },
      uSaturation: { value: options.saturation },
      uExposure: { value: options.exposure },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bright);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const pixelRatio = this.renderer.getPixelRatio();
    const full = [Math.round(this.width * pixelRatio), Math.round(this.height * pixelRatio)] as const;
    this.sceneTarget.setSize(full[0], full[1]);
    const small = [Math.max(1, Math.round(full[0] / QUARTER)), Math.max(1, Math.round(full[1] / QUARTER))] as const;
    this.bloomA.setSize(small[0], small[1]);
    this.bloomB.setSize(small[0], small[1]);
    (this.blur.uniforms.uTexel.value as THREE.Vector2).set(1 / small[0], 1 / small[1]);
  }

  private pass(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    this.pass(this.bright, this.bloomA);
    this.blur.uniforms.uSource.value = this.bloomA.texture;
    (this.blur.uniforms.uDirection.value as THREE.Vector2).set(1, 0);
    this.pass(this.blur, this.bloomB);
    this.blur.uniforms.uSource.value = this.bloomB.texture;
    (this.blur.uniforms.uDirection.value as THREE.Vector2).set(0, 1);
    this.pass(this.blur, this.bloomA);

    this.pass(this.composite, null);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
