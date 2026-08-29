/** Primary industries: the one part of the economy the player sites themselves.
 *
 *  Towns convert. Nothing in one comes out of the ground, which leaves the whole first
 *  stage of the chain vacant — and that vacancy is the point. Raw material comes from a
 *  colliery, a quarry, a forestry or a farm, and every one of them is somewhere the player
 *  chose to build, on ground they found by looking at it.
 *
 *  A place qualifies by what is actually in it. The survey counts the resource blocks
 *  around and under a point and asks two questions of the answer: is there *enough* of it,
 *  and is it *concentrated* — a scatter of coal across half a valley is not a coalfield.
 *  Both the seam under the ground and the outcrop breaking the surface count towards it,
 *  which is what makes an outcrop worth walking over to: it is the visible sign of the
 *  invisible half.
 *
 *  Nothing depletes. An industry is a place on the map, not a stock of ore — a game where
 *  the network you built stops being worth anything is a game that punishes you for
 *  finishing. What limits output is how rich the ground under it was, and that is fixed
 *  the day it is built.
 *
 *  Nothing here imports three.js, so it all runs under Vitest in Node. It does not import
 *  the world either: the survey reads blocks through a two-method port, so a test can lay
 *  out a deposit in a literal. */

import { Block, type BlockId } from '../world/blocks';
import type { GoodId } from './villages';

export type IndustryId = string;
export type IndustryKind = 'farm' | 'forestry' | 'quarry' | 'colliery' | 'ironworks';

/** One kind of industry, and the ground it needs.
 *
 *  One kind per resource, deliberately: the player points at a place and is told what can
 *  be built there, rather than being asked to choose between two things the same ground
 *  supports. Ordered richest-ask first, so a coal seam under a meadow reads as a coalfield
 *  and not as a pasture. */
export interface IndustryType {
  kind: IndustryKind;
  label: string;
  good: GoodId;
  /** What the deposit is made of. */
  blocks: readonly BlockId[];
  /** Blocks of it the survey has to find, and the share of the columns it looks at that
   *  have to hold some. A field of grass clears a low bar because grass is everywhere; a
   *  coalfield has to actually be one. */
  count: number;
  density: number;
}

export const INDUSTRY_TYPES: readonly IndustryType[] = [
  {
    kind: 'ironworks',
    label: '鉄鉱山',
    good: 'iron_ore',
    blocks: [Block.IRON_ORE],
    count: 24,
    density: 0.04,
  },
  {
    kind: 'colliery',
    label: '炭鉱',
    good: 'coal',
    blocks: [Block.COAL_ORE],
    count: 32,
    density: 0.05,
  },
  {
    kind: 'quarry',
    label: '砂採取場',
    good: 'sand',
    blocks: [Block.SAND, Block.SANDSTONE],
    count: 140,
    density: 0.35,
  },
  {
    kind: 'forestry',
    label: '林業所',
    good: 'oak_log',
    blocks: [Block.OAK_LOG, Block.OAK_LEAVES],
    count: 120,
    density: 0.2,
  },
  {
    kind: 'farm',
    label: '農場',
    good: 'wheat',
    blocks: [Block.GRASS, Block.FARMLAND, Block.FARMLAND_WET],
    count: 200,
    density: 0.6,
  },
];

/** Everything an industry can put on a line. Every craft in `villages.ts` takes one of
 *  these, and nothing else is raw material — so the two lists are each other's shape. */
export const INDUSTRY_GOODS: readonly GoodId[] = INDUSTRY_TYPES.map((type) => type.good);

export function industryType(kind: IndustryKind): IndustryType | undefined {
  return INDUSTRY_TYPES.find((type) => type.kind === kind);
}

/** How far around the site the survey looks, and how far up and down. Deep enough to find
 *  a seam under a hillside, shallow enough that a mine is on top of its ore rather than
 *  claiming something a hundred blocks below it. */
export const DEPOSIT_RADIUS = 10;
export const DEPOSIT_DOWN = 12;
export const DEPOSIT_UP = 8;
/** How near two industries may stand. Closer than this and the second is on the first
 *  one's deposit, which would be one deposit paying twice. */
export const INDUSTRY_SPACING = 40;
/** Seconds per unit at exactly the qualifying quantity. Richer ground is faster, up to
 *  `MAX_RICHNESS` times. */
export const INDUSTRY_SECONDS = 9;
export const MAX_RICHNESS = 2.5;
/** What one industry piles up while nothing comes to collect it. */
export const MAX_INDUSTRY_STOCK = 48;

/** What the survey found at a place. */
export interface Deposit {
  kind: IndustryKind;
  label: string;
  good: GoodId;
  /** Blocks of the resource counted. */
  count: number;
  /** Share of the columns looked at that held any. */
  density: number;
  /** How much faster than the baseline this ground works out at. */
  richness: number;
}

/** The world, as the one question a survey has of it. `World` satisfies it; a test hands
 *  over a function. */
export interface BlockReader {
  getBlock(x: number, y: number, z: number): BlockId;
}

/** Every industry that could stand at a point, best first.
 *
 *  The columns of a disc around the point are scanned from `DEPOSIT_DOWN` below it to
 *  `DEPOSIT_UP` above. Both halves of a deposit are counted the same way: an outcrop is
 *  simply the part of the seam that happens to be above ground. */
export function surveyDeposits(world: BlockReader, x: number, y: number, z: number): Deposit[] {
  const counts = new Map<BlockId, number>();
  const columns = new Map<BlockId, Set<number>>();
  let scanned = 0;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const cz = Math.round(z);
  for (let dz = -DEPOSIT_RADIUS; dz <= DEPOSIT_RADIUS; dz++) {
    for (let dx = -DEPOSIT_RADIUS; dx <= DEPOSIT_RADIUS; dx++) {
      if (dx * dx + dz * dz > DEPOSIT_RADIUS * DEPOSIT_RADIUS) continue;
      scanned++;
      const column = dz * 1000 + dx;
      for (let dy = -DEPOSIT_DOWN; dy <= DEPOSIT_UP; dy++) {
        const block = world.getBlock(cx + dx, cy + dy, cz + dz);
        counts.set(block, (counts.get(block) ?? 0) + 1);
        let seen = columns.get(block);
        if (!seen) {
          seen = new Set();
          columns.set(block, seen);
        }
        seen.add(column);
      }
    }
  }
  const out: Deposit[] = [];
  for (const type of INDUSTRY_TYPES) {
    let count = 0;
    const held = new Set<number>();
    for (const block of type.blocks) {
      count += counts.get(block) ?? 0;
      for (const column of columns.get(block) ?? []) held.add(column);
    }
    const density = scanned > 0 ? held.size / scanned : 0;
    if (count < type.count || density < type.density) continue;
    out.push({
      kind: type.kind,
      label: type.label,
      good: type.good,
      count,
      density,
      richness: richnessOf(count, type.count),
    });
  }
  return out;
}

/** How much faster rich ground works. Square rooted, so twice the ore is not twice the
 *  output: a deposit worth finding should be worth finding, not worth finding twice. */
export function richnessOf(count: number, needed: number): number {
  return Math.min(MAX_RICHNESS, Math.sqrt(count / Math.max(1, needed)));
}

/** One industry the player built. */
export interface Industry {
  id: IndustryId;
  kind: IndustryKind;
  good: GoodId;
  x: number;
  y: number;
  z: number;
  name: string;
  richness: number;
  /** Raw material waiting for something to come and collect it. */
  stock: number;
  progress: number;
  /** Everything it has ever shipped, for the ledger. */
  shipped: number;
}

export interface SavedIndustry {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  name?: string;
  richness?: number;
  stock?: number;
  shipped?: number;
}

export type IndustryRefusal = 'nothing-here' | 'too-close';

export type PlaceResult =
  | { ok: true; industry: Industry }
  | { ok: false; why: IndustryRefusal; near?: Industry };

/** Every industry the player has built. */
export class IndustryRegistry {
  readonly byId = new Map<IndustryId, Industry>();
  /** Bumped whenever one appears or goes, so the survey knows to walk the roads again. */
  revision = 0;
  private next = 1;

  /** Builds one on a deposit. The caller has already surveyed; this decides whether the
   *  place is free and gives the thing a name. */
  place(at: { x: number; y: number; z: number }, deposit: Deposit | null): PlaceResult {
    if (!deposit) return { ok: false, why: 'nothing-here' };
    for (const industry of this.byId.values()) {
      if (Math.hypot(industry.x - at.x, industry.z - at.z) >= INDUSTRY_SPACING) continue;
      return { ok: false, why: 'too-close', near: industry };
    }
    const id = `i${this.next++}`;
    const industry: Industry = {
      id,
      kind: deposit.kind,
      good: deposit.good,
      x: Math.round(at.x),
      y: Math.round(at.y),
      z: Math.round(at.z),
      name: `${deposit.label} ${this.byId.size + 1}`,
      richness: deposit.richness,
      stock: 0,
      progress: 0,
      shipped: 0,
    };
    this.byId.set(id, industry);
    this.revision++;
    return { ok: true, industry };
  }

  get(id: IndustryId): Industry | undefined {
    return this.byId.get(id);
  }

  remove(id: IndustryId): boolean {
    const gone = this.byId.delete(id);
    if (gone) this.revision++;
    return gone;
  }

  /** The industry nearest a point, within a radius. */
  near(x: number, z: number, radius: number): Industry | null {
    let best: Industry | null = null;
    let bestDistance = radius;
    for (const industry of this.byId.values()) {
      const distance = Math.hypot(industry.x - x, industry.z - z);
      if (distance > bestDistance) continue;
      best = industry;
      bestDistance = distance;
    }
    return best;
  }

  all(): Industry[] {
    return [...this.byId.values()];
  }

  /** Digs. Every industry runs whether or not anybody is watching and whether or not
   *  anything ever comes to collect — it simply fills up and stops, which is a thing worth
   *  seeing on the panel: a full industry is a line somebody has not built yet. */
  produce(dt: number): void {
    for (const industry of this.byId.values()) {
      if (industry.stock >= MAX_INDUSTRY_STOCK) {
        industry.progress = 0;
        continue;
      }
      const seconds = INDUSTRY_SECONDS / Math.max(0.1, industry.richness);
      industry.progress += dt;
      while (industry.progress >= seconds && industry.stock < MAX_INDUSTRY_STOCK) {
        industry.progress -= seconds;
        industry.stock += 1;
      }
    }
  }

  take(id: IndustryId, count: number): number {
    const industry = this.byId.get(id);
    if (!industry || count <= 0) return 0;
    const taken = Math.min(count, industry.stock);
    industry.stock -= taken;
    industry.shipped += taken;
    return taken;
  }

  restore(id: IndustryId, count: number): void {
    const industry = this.byId.get(id);
    if (!industry) return;
    industry.stock = Math.min(MAX_INDUSTRY_STOCK, industry.stock + count);
    industry.shipped = Math.max(0, industry.shipped - count);
  }

  toJSON(): SavedIndustry[] {
    return [...this.byId.values()].map((industry) => ({
      id: industry.id,
      kind: industry.kind,
      x: industry.x,
      y: industry.y,
      z: industry.z,
      name: industry.name,
      richness: industry.richness,
      stock: industry.stock,
      shipped: industry.shipped,
    }));
  }

  loadJSON(data: SavedIndustry[] | undefined): void {
    this.byId.clear();
    this.next = 1;
    for (const entry of data ?? []) {
      if (typeof entry?.id !== 'string') continue;
      const type = INDUSTRY_TYPES.find((t) => t.kind === entry.kind);
      if (!type) continue;
      this.byId.set(entry.id, {
        id: entry.id,
        kind: type.kind,
        good: type.good,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        name: entry.name ?? type.label,
        richness: entry.richness ?? 1,
        stock: entry.stock ?? 0,
        progress: 0,
        shipped: entry.shipped ?? 0,
      });
      const n = Number(entry.id.slice(1));
      if (Number.isFinite(n)) this.next = Math.max(this.next, n + 1);
    }
    this.revision++;
  }
}
