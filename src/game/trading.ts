import { mulberry32, hashInts, randInt } from '../core/rng';
import type { Inventory } from './inventory';

export interface TradeSide {
  id: string;
  count: number;
}

export interface Trade {
  /** What the player hands over (one or two stacks). */
  give: TradeSide[];
  /** What the villager gives back. */
  get: TradeSide;
  maxUses: number;
  uses: number;
}

interface TradeTemplate {
  give: TradeSide[];
  get: TradeSide;
  /** Random variation applied to the first give amount. */
  jitter?: number;
}

/** Villagers buy raw goods for emeralds and sell finished goods for emeralds. */
const TABLES: Record<string, TradeTemplate[]> = {
  farmer: [
    { give: [{ id: 'wheat', count: 18 }], get: { id: 'emerald', count: 1 }, jitter: 4 },
    { give: [{ id: 'carrot', count: 20 }], get: { id: 'emerald', count: 1 }, jitter: 4 },
    { give: [{ id: 'potato', count: 22 }], get: { id: 'emerald', count: 1 }, jitter: 4 },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'bread', count: 5 } },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'apple', count: 4 } },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'wheat_seeds', count: 8 } },
  ],
  blacksmith: [
    { give: [{ id: 'coal', count: 14 }], get: { id: 'emerald', count: 1 }, jitter: 3 },
    { give: [{ id: 'iron_ingot', count: 4 }], get: { id: 'emerald', count: 1 }, jitter: 1 },
    { give: [{ id: 'emerald', count: 7 }], get: { id: 'iron_pickaxe', count: 1 } },
    { give: [{ id: 'emerald', count: 8 }], get: { id: 'iron_sword', count: 1 } },
    { give: [{ id: 'emerald', count: 12 }], get: { id: 'iron_chestplate', count: 1 } },
    { give: [{ id: 'emerald', count: 6 }], get: { id: 'iron_ingot', count: 4 } },
  ],
  librarian: [
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'torch', count: 8 } },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'glass', count: 4 } },
    { give: [{ id: 'emerald', count: 9 }], get: { id: 'bookshelf', count: 1 } },
    { give: [{ id: 'diamond', count: 1 }], get: { id: 'emerald', count: 6 }, jitter: 0 },
  ],
  butcher: [
    { give: [{ id: 'raw_porkchop', count: 7 }], get: { id: 'emerald', count: 1 }, jitter: 2 },
    { give: [{ id: 'raw_beef', count: 9 }], get: { id: 'emerald', count: 1 }, jitter: 2 },
    { give: [{ id: 'raw_chicken', count: 12 }], get: { id: 'emerald', count: 1 }, jitter: 3 },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'cooked_porkchop', count: 5 } },
    { give: [{ id: 'emerald', count: 1 }], get: { id: 'cooked_beef', count: 4 } },
  ],
};

export function professionLabel(profession: string): string {
  switch (profession) {
    case 'farmer': return '農民';
    case 'blacksmith': return '鍛冶屋';
    case 'librarian': return '司書';
    case 'butcher': return '肉屋';
    default: return '村人';
  }
}

/** Deterministic per villager, so reloading the world keeps the same offers.
 *
 *  `stage` is the development of the village the villager lives in: a village that goods
 *  actually reach stocks more, asks for less, and puts more on the table. Defaulting it
 *  to 0 keeps every existing caller — and the offers in every existing save — unchanged. */
export function generateTrades(
  seed: number,
  profession: string,
  x: number,
  z: number,
  stage = 0,
): Trade[] {
  const table = TABLES[profession] ?? TABLES.farmer;
  const rng = mulberry32(hashInts(seed ^ 0x74ade, Math.round(x), Math.round(z)));
  const pool = [...table];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const count = Math.min(pool.length, 3 + Math.floor(rng() * 3) + stage);
  const discount = 1 - 0.08 * stage;
  return pool.slice(0, count).map((template) => {
    const jitter = template.jitter ?? 0;
    const give = template.give.map((side, index) => ({
      id: side.id,
      count: Math.max(
        1,
        Math.round(
          (side.count + (index === 0 && jitter > 0 ? randInt(rng, -jitter, jitter) : 0)) * discount,
        ),
      ),
    }));
    return {
      give,
      get: { ...template.get },
      maxUses: 4 + Math.floor(rng() * 5) + stage * 2,
      uses: 0,
    };
  });
}

export function tradeAvailable(trade: Trade): boolean {
  return trade.uses < trade.maxUses;
}

export function canAfford(inventory: Inventory, trade: Trade): boolean {
  if (!tradeAvailable(trade)) return false;
  return trade.give.every((side) => inventory.count(side.id) >= side.count);
}

/** Executes a trade. Returns false when the player cannot pay or has no room. */
export function performTrade(inventory: Inventory, trade: Trade): boolean {
  if (!canAfford(inventory, trade)) return false;
  for (const side of trade.give) inventory.remove(side.id, side.count);
  const leftover = inventory.add({ ...trade.get });
  trade.uses += 1;
  return leftover === 0;
}

/** Villagers restock over time so a village stays useful. */
export function restockTrades(trades: Trade[]): void {
  for (const trade of trades) trade.uses = 0;
}

export function tradesToJSON(trades: Trade[]): unknown {
  return trades.map((t) => ({ give: t.give, get: t.get, maxUses: t.maxUses, uses: t.uses }));
}

export function tradesFromJSON(data: unknown): Trade[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is Trade => typeof entry === 'object' && entry !== null && 'give' in entry)
    .map((entry) => ({
      give: entry.give.map((s) => ({ id: s.id, count: s.count })),
      get: { id: entry.get.id, count: entry.get.count },
      maxUses: entry.maxUses,
      uses: entry.uses,
    }));
}
