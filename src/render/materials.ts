import * as THREE from 'three';
import { FRAGMENT, VERTEX } from './chunkShader';

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
