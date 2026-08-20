import { mulberry32, hashInts, randInt } from '../core/rng';
import { Inventory } from './inventory';

interface LootEntry {
  id: string;
  min: number;
  max: number;
  weight: number;
}

/** Village chest contents, tuned so a village is a real head start without
 *  replacing the mining progression. */
const TABLES: Record<string, LootEntry[]> = {
  farmer: [
    { id: 'wheat', min: 2, max: 6, weight: 5 },
    { id: 'wheat_seeds', min: 2, max: 5, weight: 5 },
    { id: 'carrot', min: 1, max: 4, weight: 4 },
    { id: 'potato', min: 1, max: 4, weight: 4 },
    { id: 'bread', min: 1, max: 3, weight: 3 },
    { id: 'emerald', min: 1, max: 2, weight: 1 },
  ],
  blacksmith: [
    { id: 'iron_ingot', min: 1, max: 4, weight: 4 },
    { id: 'coal', min: 2, max: 6, weight: 4 },
    { id: 'iron_pickaxe', min: 1, max: 1, weight: 1 },
    { id: 'iron_sword', min: 1, max: 1, weight: 1 },
    { id: 'iron_helmet', min: 1, max: 1, weight: 1 },
    { id: 'diamond', min: 1, max: 1, weight: 1 },
    { id: 'emerald', min: 1, max: 3, weight: 2 },
  ],
  librarian: [
    { id: 'bookshelf', min: 1, max: 2, weight: 3 },
    { id: 'torch', min: 3, max: 8, weight: 4 },
    { id: 'glass', min: 2, max: 5, weight: 3 },
    { id: 'emerald', min: 1, max: 3, weight: 2 },
  ],
  butcher: [
    { id: 'raw_beef', min: 1, max: 3, weight: 4 },
    { id: 'raw_porkchop', min: 1, max: 3, weight: 4 },
    { id: 'cooked_beef', min: 1, max: 2, weight: 2 },
    { id: 'coal', min: 1, max: 4, weight: 3 },
    { id: 'emerald', min: 1, max: 2, weight: 1 },
  ],
};

/** Deterministic per chest position, so the same world always has the same loot. */
export function fillVillageChest(seed: number, x: number, y: number, z: number, profession: string): Inventory {
  const inventory = new Inventory(27);
  const table = TABLES[profession] ?? TABLES.farmer;
  const rng = mulberry32(hashInts(seed ^ 0x100742, x, y, z));
  const rolls = 3 + Math.floor(rng() * 4);
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  for (let i = 0; i < rolls; i++) {
    let pick = rng() * totalWeight;
    for (const entry of table) {
      pick -= entry.weight;
      if (pick > 0) continue;
      inventory.add({ id: entry.id, count: randInt(rng, entry.min, entry.max) });
      break;
    }
  }
  return inventory;
}
