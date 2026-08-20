import { describe, expect, it } from 'vitest';
import { Block } from '../world/blocks';
import { bestToolSlot, blockDrops, canHarvest, heldTool, miningTime } from '../game/mining';
import { itemDef } from '../game/items';

const wooden = itemDef('wooden_pickaxe');
const stone = itemDef('stone_pickaxe');
const iron = itemDef('iron_pickaxe');
const diamond = itemDef('diamond_pickaxe');
const shovel = itemDef('iron_shovel');
const fixedRandom = { random: () => 0 };

describe('mining', () => {
  it('gets faster with better pickaxes', () => {
    const hand = miningTime(Block.STONE, undefined);
    expect(miningTime(Block.STONE, wooden)).toBeLessThan(hand);
    expect(miningTime(Block.STONE, iron)).toBeLessThan(miningTime(Block.STONE, stone));
    expect(miningTime(Block.STONE, diamond)).toBeLessThan(miningTime(Block.STONE, iron));
  });

  it('never returns zero or negative time and refuses bedrock', () => {
    expect(miningTime(Block.STONE, diamond)).toBeGreaterThan(0);
    expect(miningTime(Block.BEDROCK, diamond)).toBe(Infinity);
  });

  it('enforces the tool tier for ore drops', () => {
    expect(canHarvest(Block.IRON_ORE, wooden)).toBe(false);
    expect(canHarvest(Block.IRON_ORE, stone)).toBe(true);
    expect(canHarvest(Block.DIAMOND_ORE, stone)).toBe(false);
    expect(canHarvest(Block.DIAMOND_ORE, iron)).toBe(true);
    expect(canHarvest(Block.DIRT, undefined)).toBe(true);
  });

  it('uses the wrong tool as a penalty rather than a block', () => {
    expect(miningTime(Block.STONE, shovel)).toBeGreaterThan(miningTime(Block.STONE, wooden));
  });

  it('drops nothing when the tool is too weak', () => {
    expect(blockDrops(Block.IRON_ORE, wooden, fixedRandom)).toEqual([]);
    expect(blockDrops(Block.IRON_ORE, stone, fixedRandom)).toEqual([{ id: 'iron_ore', count: 1 }]);
  });

  it('drops cobblestone from stone and dirt from grass', () => {
    expect(blockDrops(Block.STONE, wooden, fixedRandom)).toEqual([{ id: 'cobblestone', count: 1 }]);
    expect(blockDrops(Block.GRASS, undefined, fixedRandom)).toEqual([{ id: 'dirt', count: 1 }]);
  });

  it('gives crops back only when mature', () => {
    expect(blockDrops(Block.WHEAT_1, undefined, fixedRandom)).toEqual([{ id: 'wheat_seeds', count: 1 }]);
    const mature = blockDrops(Block.WHEAT_3, undefined, fixedRandom);
    expect(mature.find((d) => d.id === 'wheat')).toBeDefined();
    expect(mature.find((d) => d.id === 'wheat_seeds')).toBeDefined();
  });

  it('reads the tool out of the held stack', () => {
    expect(heldTool({ id: 'iron_pickaxe', count: 1 })?.id).toBe('iron_pickaxe');
    expect(heldTool({ id: 'dirt', count: 1 })).toBeUndefined();
    expect(heldTool(null)).toBeUndefined();
  });

  describe('automatic tool selection', () => {
    const hotbar = [
      { id: 'torch', count: 8 },
      { id: 'wooden_pickaxe', count: 1 },
      { id: 'iron_shovel', count: 1 },
      { id: 'iron_pickaxe', count: 1 },
      null,
      null,
      null,
      null,
      null,
    ];

    it('reaches for the fastest pickaxe on stone', () => {
      expect(bestToolSlot(hotbar, Block.STONE, 0)).toBe(3);
    });

    it('reaches for the shovel on dirt', () => {
      expect(bestToolSlot(hotbar, Block.DIRT, 0)).toBe(2);
    });

    it('prefers a tool that can harvest over one that is merely quick', () => {
      // Only iron and better drops diamond, so the wooden pickaxe must not win.
      expect(bestToolSlot(hotbar, Block.DIAMOND_ORE, 1)).toBe(3);
    });

    it('keeps the held item when nothing in the bar does better', () => {
      expect(bestToolSlot(hotbar, Block.TALL_GRASS, 0)).toBe(0);
      expect(bestToolSlot([null, null], Block.STONE, 1)).toBe(1);
    });
  });
});
