import type { BlockEntity } from '../world/world';
import { Inventory } from './inventory';
import { type FurnaceEntity, createFurnace } from './smelting';

export const CHEST_SIZE = 27;

export interface ChestEntity extends BlockEntity {
  type: 'chest';
  slots: Inventory;
}

export function createChest(slots?: Inventory): ChestEntity {
  return { type: 'chest', slots: slots ?? new Inventory(CHEST_SIZE) };
}

export function isChest(entity: BlockEntity | undefined): entity is ChestEntity {
  return entity?.type === 'chest';
}

export function isFurnace(entity: BlockEntity | undefined): entity is FurnaceEntity {
  return entity?.type === 'furnace';
}

export { createFurnace };
