import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { blockDef, type BlockId } from '../world/blocks';
import { TILE, type Atlas } from './textures';

const MAX_PARTICLES = 400;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

/** Builds the progressive crack overlays shown while a block is being mined. */
function createCrackTextures(): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  const rng = mulberry32(0xc7ac);
  const strokes: [number, number, number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const x = rng() * TILE;
    const y = rng() * TILE;
    strokes.push([x, y, x + (rng() - 0.5) * 8, y + (rng() - 0.5) * 8]);
  }
  for (let stage = 0; stage < 8; stage++) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    // Tiles are drawn several pixels to the unit, so a one-pixel crack would be a hair.
    ctx.lineWidth = TILE / 16;
    ctx.lineCap = 'round';
    const count = Math.round(((stage + 1) / 8) * strokes.length);
    for (let i = 0; i < count; i++) {
      const [x0, y0, x1, y1] = strokes[i];
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.push(texture);
  }
  return textures;
}

/** Block outline, mining cracks and break particles. */
export class Effects {
  readonly group = new THREE.Group();
  private readonly outline: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackTextures: THREE.Texture[];
  private readonly particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly atlas: Atlas;
  private readonly colorCache = new Map<BlockId, THREE.Color>();

  constructor(atlas: Atlas) {
    this.atlas = atlas;
    this.group.name = 'effects';

    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.outline = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: true }),
    );
    this.outline.visible = false;

    this.crackTextures = createCrackTextures();
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({
        map: this.crackTextures[0],
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.crack.visible = false;

    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    particleGeometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({ size: 0.12, vertexColors: true, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;

    this.group.add(this.outline, this.crack, this.points);
  }

  setSelection(target: { x: number; y: number; z: number } | null): void {
    if (!target) {
      this.outline.visible = false;
      return;
    }
    this.outline.visible = true;
    this.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }

  /** progress is 0..1; anything at or below zero hides the overlay. */
  setBreakProgress(target: { x: number; y: number; z: number } | null, progress: number): void {
    if (!target || progress <= 0) {
      this.crack.visible = false;
      return;
    }
    const stage = Math.min(7, Math.floor(progress * 8));
    const material = this.crack.material as THREE.MeshBasicMaterial;
    material.map = this.crackTextures[stage];
    material.needsUpdate = true;
    this.crack.visible = true;
    this.crack.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }

  /** Average colour of a block's texture, used to tint its break particles. */
  private colorOf(block: BlockId): THREE.Color {
    const cached = this.colorCache.get(block);
    if (cached) return cached;
    const def = blockDef(block);
    const name = def.tex.side ?? def.tex.all ?? def.tex.top ?? 'stone';
    const uv = this.atlas.uv(name);
    const canvas = this.atlas.canvas;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(uv.u0 * canvas.width, uv.v0 * canvas.height, TILE, TILE).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 40) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    const color = new THREE.Color(
      count > 0 ? r / count / 255 : 0.5,
      count > 0 ? g / count / 255 : 0.5,
      count > 0 ? b / count / 255 : 0.5,
    );
    this.colorCache.set(block, color);
    return color;
  }

  spawnBlockParticles(x: number, y: number, z: number, block: BlockId, count = 16): void {
    const color = this.colorOf(block);
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const particle: Particle = {
        x: x + Math.random(),
        y: y + Math.random(),
        z: z + Math.random(),
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3.5,
        vz: (Math.random() - 0.5) * 3,
        life: 0.6 + Math.random() * 0.5,
        maxLife: 1,
      };
      particle.maxLife = particle.life;
      this.particles.push(particle);
      const index = this.particles.length - 1;
      this.colors[index * 3] = color.r;
      this.colors[index * 3 + 1] = color.g;
      this.colors[index * 3 + 2] = color.b;
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        // Keep the arrays packed by swapping the last particle into this slot.
        const last = this.particles.length - 1;
        this.particles[i] = this.particles[last];
        this.colors[i * 3] = this.colors[last * 3];
        this.colors[i * 3 + 1] = this.colors[last * 3 + 1];
        this.colors[i * 3 + 2] = this.colors[last * 3 + 2];
        this.particles.pop();
        continue;
      }
      particle.vy -= 14 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      this.positions[i * 3] = particle.x;
      this.positions[i * 3 + 1] = particle.y;
      this.positions[i * 3 + 2] = particle.z;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.particles.length);
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
