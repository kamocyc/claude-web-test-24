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
  // A villager in working clothes with a crate roped to their back. It has to read as
  // "carrying something somewhere" from across a field.
  porter: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: 0xc9a882, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: 0xb08d68, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: 0x3f5a74, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: 0x54748f, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: 0xc9a882, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: 0xc9a882, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: 0x33465c, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: 0x33465c, role: 'legFrontRight' },
    { size: [0.52, 0.52, 0.34], offset: [0, 1.32, 0.3], color: 0x8a6a3a, role: 'body' },
    { size: [0.56, 0.1, 0.05], offset: [0, 1.32, 0.48], color: 0x5f4826, role: 'body' },
  ],
  // The same porter with a two wheeled cart behind them. It has to read as "this road is
  // wide enough for that" from the side of the road, so the cart is deliberately as broad
  // as the collision box and the wheels stand proud of it.
  cart: [
    { size: [0.5, 0.5, 0.5], offset: [0, 1.66, 0], color: 0xc9a882, role: 'head' },
    { size: [0.12, 0.16, 0.16], offset: [0, 1.6, -0.31], color: 0xb08d68, role: 'head' },
    { size: [0.56, 0.75, 0.3], offset: [0, 1.03, 0], color: 0x3f5a74, role: 'body' },
    { size: [0.5, 0.35, 0.34], offset: [0, 1.2, 0], color: 0x54748f, role: 'body' },
    { size: [0.16, 0.5, 0.16], offset: [-0.35, 1.1, 0], color: 0xc9a882, role: 'armLeft' },
    { size: [0.16, 0.5, 0.16], offset: [0.35, 1.1, 0], color: 0xc9a882, role: 'armRight' },
    { size: [0.2, 0.7, 0.2], offset: [-0.14, 0.35, 0], color: 0x33465c, role: 'legFrontLeft' },
    { size: [0.2, 0.7, 0.2], offset: [0.14, 0.35, 0], color: 0x33465c, role: 'legFrontRight' },
    // shafts from the porter's hands back to the bed
    { size: [0.06, 0.06, 0.7], offset: [-0.3, 1.05, 0.45], color: 0x6b5330, role: 'body' },
    { size: [0.06, 0.06, 0.7], offset: [0.3, 1.05, 0.45], color: 0x6b5330, role: 'body' },
    // the bed, its load, and the wheels
    { size: [1.2, 0.34, 0.8], offset: [0, 0.75, 0.95], color: 0x8a6a3a, role: 'body' },
    { size: [1.24, 0.08, 0.84], offset: [0, 0.94, 0.95], color: 0x5f4826, role: 'body' },
    { size: [0.86, 0.3, 0.56], offset: [0, 1.06, 0.95], color: 0xb99a5e, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [-0.65, 0.62, 0.95], color: 0x4a3423, role: 'body' },
    { size: [0.14, 0.66, 0.66], offset: [0.65, 0.62, 0.95], color: 0x4a3423, role: 'body' },
  ],
  // The locomotive on its own. Nothing here has a leg or an arm role: the renderer swings
  // those from the walk phase, and a train that walked would be telling the player the
  // wrong thing about what is moving the goods. What it is pulling is not in this list —
  // see `trainModel`, because the answer changes with the load.
  train: [
    // boiler, cab and chimney
    { size: [0.72, 0.6, 1.3], offset: [0, 0.62, -0.42], color: 0x2f3438, role: 'body' },
    { size: [0.78, 0.66, 0.62], offset: [0, 0.92, 0.28], color: 0x39424a, role: 'body' },
    { size: [0.26, 0.4, 0.26], offset: [0, 1.12, -0.92], color: 0x22282c, role: 'body' },
    // the open firebox, which is what makes it read as a train and not a black box
    { size: [0.4, 0.26, 0.06], offset: [0, 0.66, 0.6], color: 0xd4762a, role: 'body' },
    // wheels
    { size: [0.86, 0.34, 0.34], offset: [0, 0.24, -0.72], color: 0x1c2023, role: 'body' },
    { size: [0.86, 0.34, 0.34], offset: [0, 0.24, 0.1], color: 0x1c2023, role: 'body' },
  ],
};

/** Where the first wagon's middle sits behind the locomotive's, and the pitch after it.
 *  The pitch is a little more than a wagon is long, which is what leaves a gap for the
 *  coupling to be visible in. */
const WAGON_LEAD = 1.15;
const WAGON_PITCH = 1.06;

export function modelFor(kind: MobKind): ModelPart[] {
  return MODELS[kind];
}

/** The locomotive with `cars` wagons coupled up behind it.
 *
 *  A separate function rather than another entry in `MODELS` because the shape depends on
 *  the load, and the load is the one thing about a shipment the player can read from a
 *  hillside: four wagons is a full train, one is a village that had almost nothing ready,
 *  none is a train going home empty. Each wagon borrows the cart's crate so that the same
 *  freight looks the same however it is being carried. */
export function trainModel(cars: number): ModelPart[] {
  const parts = [...MODELS.train];
  for (let i = 0; i < cars; i++) {
    const z = WAGON_LEAD + i * WAGON_PITCH;
    parts.push(
      // the coupling, drawn before the wagon it pulls so a gap never reads as a break
      { size: [0.14, 0.14, WAGON_PITCH - 0.86], offset: [0, 0.34, z - WAGON_PITCH / 2], color: 0x1c2023, role: 'body' },
      { size: [0.66, 0.34, 0.86], offset: [0, 0.5, z], color: 0x8a6a3a, role: 'body' },
      { size: [0.7, 0.08, 0.9], offset: [0, 0.69, z], color: 0x5f4826, role: 'body' },
      { size: [0.5, 0.3, 0.6], offset: [0, 0.81, z], color: 0xb99a5e, role: 'body' },
      { size: [0.74, 0.28, 0.28], offset: [0, 0.22, z], color: 0x1c2023, role: 'body' },
    );
  }
  return parts;
}
