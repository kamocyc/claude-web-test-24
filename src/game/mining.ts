import { Block, type BlockId, blockDef, cropAt } from '../world/blocks';
import type { ItemStack } from './inventory';
import { type ItemDef, itemDef } from './items';

/** Base seconds to break a block with a bare hand, scaled by hardness. */
const HARDNESS_TO_SECONDS = 1.5;
/** Extra penalty for breaking a block without the tool it requires. */
const WRONG_TOOL_PENALTY = 3.33;
/** The longest any one block may take, whatever it is and whatever is in hand.
 *
 *  Digging is not what this game is about — the network is — and the worst case used to be
 *  a seventeen-second stare at a furnace with your bare hands. That is seventeen seconds
 *  not spent building a line, and it taught the player nothing they did not already know
 *  from the first second of it. */
export const MAX_MINING_SECONDS = 1;
/** The floor, so a block never breaks on the same frame the button goes down. */
export const MIN_MINING_SECONDS = 0.05;

export function heldTool(item: ItemStack | null): ItemDef | undefined {
  if (!item) return undefined;
  const def = itemDef(item.id);
  return def?.tool ? def : undefined;
}

/** True when the held tool is good enough for the block to drop anything. */
export function canHarvest(block: BlockId, tool: ItemDef | undefined): boolean {
  const def = blockDef(block);
  if (def.tier === 0) return true;
  const stats = tool?.tool;
  if (!stats) return false;
  return stats.kind === def.tool && stats.tier >= def.tier;
}

/** Seconds needed to break a block with the given tool. */
export function miningTime(block: BlockId, tool: ItemDef | undefined): number {
  const def = blockDef(block);
  if (def.hardness < 0) return Infinity;
  let seconds = def.hardness * HARDNESS_TO_SECONDS;
  const stats = tool?.tool;
  if (stats && stats.kind === def.tool) seconds /= stats.speed;
  if (!canHarvest(block, tool)) seconds *= WRONG_TOOL_PENALTY;
  return Math.max(MIN_MINING_SECONDS, softCap(seconds));
}

/** Bends the long times down under `MAX_MINING_SECONDS` without flattening them.
 *
 *  A plain `Math.min` would make every slow block exactly as slow as every other one, and
 *  a pickaxe would stop being worth picking up for anything harder than stone. This is the
 *  raw time as a share of itself plus a second: strictly increasing, so every tool that
 *  used to be faster than another still is; asymptotic, so nothing ever reaches the cap.
 *  A furnace goes from 17.5 seconds bare-handed to 0.95, and a wooden pickaxe still takes
 *  a quarter of a second off that. */
function softCap(seconds: number): number {
  return (MAX_MINING_SECONDS * seconds) / (seconds + MAX_MINING_SECONDS);
}

/** Hotbar slot holding the best tool for a block: the one that harvests it, and among
 *  those the fastest. Ties keep whatever is already in hand so the bar stops flapping
 *  when nothing in it makes a difference. */
export function bestToolSlot(
  slots: readonly (ItemStack | null)[],
  block: BlockId,
  current: number,
): number {
  if (slots.length === 0) return current;
  const start = Math.max(0, Math.min(slots.length - 1, current));
  const rate = (index: number): { time: number; harvest: boolean } => {
    const tool = heldTool(slots[index] ?? null);
    return { time: miningTime(block, tool), harvest: canHarvest(block, tool) };
  };
  let best = start;
  let bestRate = rate(start);
  for (let i = 0; i < slots.length; i++) {
    if (i === start) continue;
    const candidate = rate(i);
    const better =
      candidate.harvest !== bestRate.harvest
        ? candidate.harvest
        : candidate.time < bestRate.time - 1e-6;
    if (better) {
      best = i;
      bestRate = candidate;
    }
  }
  return best;
}

export interface DropContext {
  /** 0..1 random source, injected so drops stay testable. */
  random: () => number;
}

/** Items produced by breaking a block. */
export function blockDrops(block: BlockId, tool: ItemDef | undefined, ctx: DropContext): ItemStack[] {
  const def = blockDef(block);
  if (def.hardness < 0) return [];

  const crop = cropAt(block);
  if (crop) {
    if (crop.stage < crop.stages - 1) {
      // Immature crops only give the seed back.
      return crop.harvest === 'wheat' ? [{ id: 'wheat_seeds', count: 1 }] : [{ id: crop.harvest, count: 1 }];
    }
    const drops: ItemStack[] = [{ id: crop.harvest, count: 1 + Math.floor(ctx.random() * 2) }];
    if (crop.bonus) drops.push({ id: crop.bonus, count: 1 + Math.floor(ctx.random() * 2) });
    return drops;
  }

  if (block === Block.TALL_GRASS) {
    return ctx.random() < 0.2 ? [{ id: 'wheat_seeds', count: 1 }] : [];
  }
  if (def.render === 'cube' && (block === Block.OAK_LEAVES || block === Block.BIRCH_LEAVES || block === Block.SPRUCE_LEAVES)) {
    const drops: ItemStack[] = [];
    if (ctx.random() < 0.04) drops.push({ id: 'apple', count: 1 });
    if (ctx.random() < 0.08) drops.push({ id: 'stick', count: 1 });
    return drops;
  }

  if (!canHarvest(block, tool)) return [];

  const dropId = def.drop === undefined ? def.name : def.drop;
  if (!dropId) return [];
  if (!itemDef(dropId)) return [];
  const min = def.dropMin ?? 1;
  const max = def.dropMax ?? min;
  const count = min + Math.floor(ctx.random() * (max - min + 1));
  return count > 0 ? [{ id: dropId, count }] : [];
}
