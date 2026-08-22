export type MobKind =
  | 'zombie'
  | 'skeleton'
  | 'spider'
  | 'pig'
  | 'cow'
  | 'chicken'
  | 'sheep'
  | 'villager'
  | 'porter'
  | 'cart'
  | 'train';

export interface MobDrop {
  id: string;
  min: number;
  max: number;
  chance: number;
}

export interface MobDef {
  kind: MobKind;
  label: string;
  hostile: boolean;
  maxHealth: number;
  width: number;
  height: number;
  /** Blocks per second while chasing or wandering. */
  speed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  /** How far it notices the player. */
  sightRange: number;
  /** Hostile mobs that catch fire in direct sunlight. */
  burnsInDaylight: boolean;
  /** Shoots arrows instead of hitting in melee. */
  ranged: boolean;
  drops: MobDrop[];
}

const DEFS: Record<MobKind, MobDef> = {
  zombie: {
    kind: 'zombie', label: 'ゾンビ', hostile: true, maxHealth: 20,
    width: 0.6, height: 1.95, speed: 2.6, attackDamage: 3, attackRange: 1.6,
    attackCooldown: 1, sightRange: 20, burnsInDaylight: true, ranged: false,
    drops: [{ id: 'leather', min: 0, max: 1, chance: 0.35 }],
  },
  skeleton: {
    kind: 'skeleton', label: 'スケルトン', hostile: true, maxHealth: 20,
    width: 0.6, height: 1.99, speed: 2.4, attackDamage: 3, attackRange: 12,
    attackCooldown: 1.8, sightRange: 22, burnsInDaylight: true, ranged: true,
    drops: [{ id: 'feather', min: 0, max: 2, chance: 0.5 }],
  },
  spider: {
    kind: 'spider', label: 'クモ', hostile: true, maxHealth: 16,
    width: 1.2, height: 0.9, speed: 3.6, attackDamage: 2, attackRange: 1.6,
    attackCooldown: 0.9, sightRange: 18, burnsInDaylight: false, ranged: false,
    drops: [{ id: 'stick', min: 0, max: 2, chance: 0.4 }],
  },
  pig: {
    kind: 'pig', label: 'ブタ', hostile: false, maxHealth: 10,
    width: 0.9, height: 0.9, speed: 1.5, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 10, burnsInDaylight: false, ranged: false,
    drops: [{ id: 'raw_porkchop', min: 1, max: 3, chance: 1 }],
  },
  cow: {
    kind: 'cow', label: 'ウシ', hostile: false, maxHealth: 10,
    width: 0.9, height: 1.4, speed: 1.4, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 10, burnsInDaylight: false, ranged: false,
    drops: [
      { id: 'raw_beef', min: 1, max: 3, chance: 1 },
      { id: 'leather', min: 0, max: 2, chance: 0.8 },
    ],
  },
  chicken: {
    kind: 'chicken', label: 'ニワトリ', hostile: false, maxHealth: 4,
    width: 0.4, height: 0.7, speed: 1.6, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 8, burnsInDaylight: false, ranged: false,
    drops: [
      { id: 'raw_chicken', min: 1, max: 1, chance: 1 },
      { id: 'feather', min: 0, max: 2, chance: 0.9 },
    ],
  },
  sheep: {
    kind: 'sheep', label: 'ヒツジ', hostile: false, maxHealth: 8,
    width: 0.9, height: 1.3, speed: 1.5, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 10, burnsInDaylight: false, ranged: false,
    drops: [
      { id: 'raw_mutton', min: 1, max: 2, chance: 1 },
      { id: 'wool', min: 1, max: 1, chance: 1 },
    ],
  },
  villager: {
    kind: 'villager', label: '村人', hostile: false, maxHealth: 20,
    width: 0.6, height: 1.95, speed: 1.4, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  porter: {
    kind: 'porter', label: '荷運び', hostile: false, maxHealth: 20,
    width: 0.6, height: 1.95, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  // Wider than a walker, which is the whole idea: a cart only runs where the road is
  // three columns across, and it should not fit anywhere a porter would have squeezed.
  cart: {
    kind: 'cart', label: '荷車', hostile: false, maxHealth: 20,
    width: 1.4, height: 1.95, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  // Narrow again, and on purpose: what puts a train on a line is the surface, not the
  // width, so it has to fit down the single track that earned it.
  train: {
    kind: 'train', label: '列車', hostile: false, maxHealth: 20,
    width: 0.9, height: 1.95, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
};

/** Mobs the transport network owns and drives along a route. They never spawn by
 *  themselves, they never wander, and they never run away from anything. */
export const HAULING_KINDS: readonly MobKind[] = ['porter', 'cart', 'train'];

export function mobDef(kind: MobKind): MobDef {
  return DEFS[kind];
}

export const HOSTILE_KINDS: readonly MobKind[] = ['zombie', 'skeleton', 'spider'];
export const PASSIVE_KINDS: readonly MobKind[] = ['pig', 'cow', 'chicken', 'sheep'];
