import type { MobKind } from '../game/mobs/types';

export type PartRole = 'head' | 'armLeft' | 'armRight' | 'legFrontLeft' | 'legFrontRight' | 'legBackLeft' | 'legBackRight' | 'body';

export interface ModelPart {
  /** Width (x), height (y), depth (z) in blocks. */
  size: [number, number, number];
  /** Centre of the part relative to the mob's feet. */
  offset: [number, number, number];
  color: number;
  role: PartRole;
}

/** Blocky mob models, built from axis-aligned boxes in the spirit of the original. */
const MODELS: Record<MobKind, ModelPart[]> = {
  zombie: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: 0x4e7a3c, role: 'head' },
    { size: [0.55, 0.72, 0.28], offset: [0, 1.05, 0], color: 0x2e7f7f, role: 'body' },
    { size: [0.18, 0.7, 0.18], offset: [-0.37, 1.05, -0.15], color: 0x4e7a3c, role: 'armLeft' },
    { size: [0.18, 0.7, 0.18], offset: [0.37, 1.05, -0.15], color: 0x4e7a3c, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.15, 0.35, 0], color: 0x2b3a6b, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.15, 0.35, 0], color: 0x2b3a6b, role: 'legFrontRight' },
  ],
  skeleton: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.7, 0], color: 0xd9d9d1, role: 'head' },
    { size: [0.4, 0.75, 0.22], offset: [0, 1.07, 0], color: 0xc8c8c0, role: 'body' },
    { size: [0.13, 0.72, 0.13], offset: [-0.3, 1.07, -0.2], color: 0xd9d9d1, role: 'armLeft' },
    { size: [0.13, 0.72, 0.13], offset: [0.3, 1.07, -0.2], color: 0xd9d9d1, role: 'armRight' },
    { size: [0.14, 0.7, 0.14], offset: [-0.12, 0.35, 0], color: 0xc8c8c0, role: 'legFrontLeft' },
    { size: [0.14, 0.7, 0.14], offset: [0.12, 0.35, 0], color: 0xc8c8c0, role: 'legFrontRight' },
  ],
  spider: [
    { size: [0.9, 0.5, 0.7], offset: [0, 0.45, 0.25], color: 0x2b1a18, role: 'body' },
    { size: [0.5, 0.4, 0.45], offset: [0, 0.5, -0.45], color: 0x3a221f, role: 'head' },
    { size: [1.5, 0.12, 0.12], offset: [0, 0.3, -0.1], color: 0x241412, role: 'legFrontLeft' },
    { size: [1.5, 0.12, 0.12], offset: [0, 0.3, 0.25], color: 0x241412, role: 'legFrontRight' },
    { size: [1.4, 0.12, 0.12], offset: [0, 0.3, 0.6], color: 0x241412, role: 'legBackLeft' },
    { size: [0.12, 0.12, 0.12], offset: [-0.14, 0.62, -0.62], color: 0xcc2222, role: 'body' },
    { size: [0.12, 0.12, 0.12], offset: [0.14, 0.62, -0.62], color: 0xcc2222, role: 'body' },
  ],
  pig: [
    { size: [0.62, 0.55, 0.95], offset: [0, 0.62, 0], color: 0xeaa2a2, role: 'body' },
    { size: [0.45, 0.42, 0.4], offset: [0, 0.72, -0.62], color: 0xeaa2a2, role: 'head' },
    { size: [0.22, 0.16, 0.1], offset: [0, 0.66, -0.85], color: 0xd07f84, role: 'head' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, -0.3], color: 0xd98f8f, role: 'legFrontLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, -0.3], color: 0xd98f8f, role: 'legFrontRight' },
    { size: [0.16, 0.35, 0.16], offset: [-0.2, 0.17, 0.32], color: 0xd98f8f, role: 'legBackLeft' },
    { size: [0.16, 0.35, 0.16], offset: [0.2, 0.17, 0.32], color: 0xd98f8f, role: 'legBackRight' },
  ],
  cow: [
    { size: [0.7, 0.7, 1.1], offset: [0, 0.95, 0], color: 0x59402c, role: 'body' },
    { size: [0.5, 0.5, 0.45], offset: [0, 1.15, -0.75], color: 0x3f2d1f, role: 'head' },
    { size: [0.7, 0.12, 0.4], offset: [0, 1.2, 0.1], color: 0xe8e2d8, role: 'body' },
    { size: [0.18, 0.6, 0.18], offset: [-0.24, 0.3, -0.35], color: 0x59402c, role: 'legFrontLeft' },
    { size: [0.18, 0.6, 0.18], offset: [0.24, 0.3, -0.35], color: 0x59402c, role: 'legFrontRight' },
    { size: [0.18, 0.6, 0.18], offset: [-0.24, 0.3, 0.38], color: 0x59402c, role: 'legBackLeft' },
    { size: [0.18, 0.6, 0.18], offset: [0.24, 0.3, 0.38], color: 0x59402c, role: 'legBackRight' },
  ],
  chicken: [
    { size: [0.32, 0.3, 0.42], offset: [0, 0.4, 0], color: 0xf2f2ee, role: 'body' },
    { size: [0.24, 0.26, 0.24], offset: [0, 0.6, -0.24], color: 0xf2f2ee, role: 'head' },
    { size: [0.1, 0.08, 0.14], offset: [0, 0.57, -0.4], color: 0xe8a53a, role: 'head' },
    { size: [0.12, 0.1, 0.1], offset: [0, 0.72, -0.2], color: 0xc0392b, role: 'head' },
    { size: [0.08, 0.25, 0.08], offset: [-0.1, 0.12, 0], color: 0xe8a53a, role: 'legFrontLeft' },
    { size: [0.08, 0.25, 0.08], offset: [0.1, 0.12, 0], color: 0xe8a53a, role: 'legFrontRight' },
  ],
  sheep: [
    { size: [0.75, 0.7, 1.0], offset: [0, 0.9, 0], color: 0xf0efe9, role: 'body' },
    { size: [0.42, 0.42, 0.42], offset: [0, 1.05, -0.68], color: 0xd8d0c4, role: 'head' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, -0.3], color: 0xd8d0c4, role: 'legFrontLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, -0.3], color: 0xd8d0c4, role: 'legFrontRight' },
    { size: [0.16, 0.55, 0.16], offset: [-0.24, 0.28, 0.34], color: 0xd8d0c4, role: 'legBackLeft' },
    { size: [0.16, 0.55, 0.16], offset: [0.24, 0.28, 0.34], color: 0xd8d0c4, role: 'legBackRight' },
  ],
  villager: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: 0xc9a882, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: 0xb08d68, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: 0x6b4a34, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: 0x8d6a4a, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: 0xc9a882, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: 0xc9a882, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: 0x4a3423, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: 0x4a3423, role: 'legFrontRight' },
  ],
};

export function modelFor(kind: MobKind): ModelPart[] {
  return MODELS[kind];
}
