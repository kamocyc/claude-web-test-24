export type MobKind =
  | 'zombie'
  | 'skeleton'
  | 'spider'
  | 'pig'
  | 'cow'
  | 'chicken'
  | 'sheep'
  | 'cat'
  | 'dog'
  | 'fox'
  | 'rabbit'
  | 'camel'
  | 'villager'
  | 'porter'
  | 'cart'
  | 'bus'
  | 'ship'
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
  cat: {
    kind: 'cat', label: 'ネコ', hostile: false, maxHealth: 8,
    width: 0.45, height: 0.7, speed: 2.1, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  dog: {
    kind: 'dog', label: 'イヌ', hostile: false, maxHealth: 10,
    width: 0.55, height: 0.85, speed: 2.4, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 14, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  fox: {
    kind: 'fox', label: 'キツネ', hostile: false, maxHealth: 10,
    width: 0.55, height: 0.75, speed: 2.3, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 14, burnsInDaylight: false, ranged: false,
    drops: [{ id: 'leather', min: 0, max: 1, chance: 0.25 }],
  },
  rabbit: {
    kind: 'rabbit', label: 'ウサギ', hostile: false, maxHealth: 3,
    width: 0.35, height: 0.5, speed: 2.8, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 10, burnsInDaylight: false, ranged: false,
    drops: [{ id: 'raw_chicken', min: 1, max: 1, chance: 0.45 }],
  },
  camel: {
    kind: 'camel', label: 'ラクダ', hostile: false, maxHealth: 18,
    width: 1.1, height: 2.1, speed: 1.7, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [{ id: 'leather', min: 0, max: 2, chance: 0.8 }],
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
  // A team and a carriage: wider than a cart because it is a bigger thing on the same
  // three wide road, and no faster on its own — what makes a bus quick is the horses, and
  // that is `BUS_PACE` in `transport.ts`, where the rest of what a vehicle is worth lives.
  bus: {
    kind: 'bus', label: '馬車', hostile: false, maxHealth: 20,
    width: 1.5, height: 2.3, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  // A small steamer. As wide as the hull that is drawn, for the same reason the train is:
  // a player can walk up to one at a quay, and a hit box that did not match would be a
  // ship you could see through. It never touches the ground — it is given the waterline as
  // its surface the way a train is given the deck, which is what keeps it afloat.
  ship: {
    kind: 'ship', label: '船', hostile: false, maxHealth: 20,
    width: 2.4, height: 2.4, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
  // As wide and as tall as the carriages it pulls, because a player can now stand on
  // those: a hit box that did not match what is drawn would be a train you could see
  // through or one that shouldered you off a viaduct from a metre away. The width still
  // fits inside the track that earned it — see `CAR_WIDTH` in `consist.ts`, which takes
  // it from the sleepers.
  train: {
    kind: 'train', label: '列車', hostile: false, maxHealth: 20,
    width: 1.6, height: 3, speed: 1.9, attackDamage: 0, attackRange: 0,
    attackCooldown: 0, sightRange: 12, burnsInDaylight: false, ranged: false,
    drops: [],
  },
};

/** Mobs the transport network owns and drives along a route. They never spawn by
 *  themselves, they never wander, and they never run away from anything. */
/** Every kind there is, for anything that has to be total over them. */
export const MOB_KINDS = Object.keys(DEFS) as readonly MobKind[];

export const HAULING_KINDS: readonly MobKind[] = ['porter', 'cart', 'bus', 'ship', 'train'];

export function mobDef(kind: MobKind): MobDef {
  return DEFS[kind];
}

export const HOSTILE_KINDS: readonly MobKind[] = ['zombie', 'skeleton', 'spider'];
export const PASSIVE_KINDS: readonly MobKind[] = ['pig', 'cow', 'chicken', 'sheep', 'cat', 'dog'];
