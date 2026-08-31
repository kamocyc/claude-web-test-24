import { CHUNK_VOLUME } from '../world/chunk';
import type { World } from '../world/world';
import type { TreeMapSurface } from './cartography';
import { createChest, createFurnace, isChest, isFurnace } from './blockEntities';
import type { MapMemory } from './cartography';
import type { DayCycle } from './daycycle';
import { Inventory } from './inventory';
import type { Mob } from './mobs/ai';
import type { MobManager } from './mobs/spawner';
import type { Player } from './player';
import {
  SAVE_VERSION,
  decodeEdits,
  decodeWater,
  encodeEdits,
  encodeWater,
  type SaveData,
} from './save';
import { tradesFromJSON, tradesToJSON } from './trading';

export interface SnapshotSource {
  seed: number;
  time: number;
  world: World;
  mapMemory: MapMemory;
  player: Player;
  mobs: readonly Mob[];
  isCommuter(id: number): boolean;
  populatedChunks: Iterable<string>;
  villages: SaveData['villages'];
  freight: number;
  network: SaveData['network'];
  industries: SaveData['industries'];
  quest: SaveData['quest'];
  pendingVillagers: NonNullable<SaveData['pendingVillagers']>;
  tracks: SaveData['tracks'];
  removedTrees: readonly string[];
  trees: TreeMapSurface;
}

/** Builds the portable representation of a running game without owning its lifecycle. */
export function createGameSnapshot(source: SnapshotSource): SaveData {
  for (const chunk of source.world.chunks.values()) source.mapMemory.record(chunk, source.trees);

  const edits: Record<string, string> = {};
  const water: Record<string, string> = {};
  for (const [key, map] of source.world.edits) {
    if (map.size === 0) continue;
    edits[key] = encodeEdits(map);
    const levels = source.world.waterOf(key);
    if (levels) water[key] = encodeWater(levels);
  }

  const chests: SaveData['chests'] = [];
  const furnaces: SaveData['furnaces'] = [];
  for (const [key, entity] of source.world.blockEntities) {
    const [x, y, z] = key.split(',').map(Number);
    if (isChest(entity)) chests.push({ pos: [x, y, z], slots: entity.slots.toJSON() });
    else if (isFurnace(entity)) {
      furnaces.push({
        pos: [x, y, z],
        slots: entity.slots.toJSON(),
        burnLeft: entity.burnLeft,
        burnTotal: entity.burnTotal,
        cookProgress: entity.cookProgress,
      });
    }
  }

  return {
    version: SAVE_VERSION,
    seed: source.seed,
    time: source.time,
    savedAt: Date.now(),
    player: {
      x: source.player.x,
      y: source.player.y,
      z: source.player.z,
      yaw: source.player.yaw,
      pitch: source.player.pitch,
      health: source.player.health,
      food: source.player.hunger.food,
      saturation: source.player.hunger.saturation,
      selected: source.player.inventory.selected,
      inventory: source.player.inventory.toJSON(),
      armor: source.player.inventory.armor.toJSON(),
    },
    edits,
    water,
    chests,
    furnaces,
    villagers: source.mobs
      .filter((mob) => mob.kind === 'villager' && !source.isCommuter(mob.id))
      .map((mob) => ({
        x: mob.x,
        y: mob.y,
        z: mob.z,
        profession: mob.profession ?? 'farmer',
        trades: tradesToJSON(mob.trades),
        villageStage: mob.villageStage,
      })),
    populatedChunks: [...source.populatedChunks],
    villages: source.villages,
    freight: source.freight,
    network: source.network,
    industries: source.industries,
    quest: source.quest,
    pendingVillagers: [...source.pendingVillagers],
    tracks: source.tracks,
    explored: source.mapMemory.toJSON(),
    removedTrees: [...source.removedTrees],
  };
}

export interface SaveFoundationTarget {
  day: DayCycle;
  mapMemory: MapMemory;
  player: Player;
  world: World;
}

/** Restores state that has no cross-system ordering requirements. */
export function restoreSaveFoundation(data: SaveData, target: SaveFoundationTarget): void {
  target.day.time = data.time;
  target.mapMemory.load(data.explored);

  const player = data.player;
  target.player.x = player.x;
  target.player.y = player.y;
  target.player.z = player.z;
  target.player.yaw = player.yaw;
  target.player.pitch = player.pitch;
  target.player.health = player.health;
  target.player.hunger.loadJSON({ food: player.food, saturation: player.saturation });
  target.player.inventory.loadJSON(player.inventory);
  target.player.inventory.armor.loadJSON(player.armor);
  target.player.inventory.selected = player.selected;

  for (const [key, encoded] of Object.entries(data.edits)) {
    target.world.edits.set(key, decodeEdits(encoded));
  }
  for (const [key, encoded] of Object.entries(data.water ?? {})) {
    target.world.waterSnapshots.set(key, decodeWater(encoded, CHUNK_VOLUME));
  }
  for (const chest of data.chests) {
    const slots = new Inventory(27);
    slots.loadJSON(chest.slots);
    target.world.setBlockEntity(chest.pos[0], chest.pos[1], chest.pos[2], createChest(slots));
  }
  for (const furnace of data.furnaces) {
    const entity = createFurnace();
    entity.slots.loadJSON(furnace.slots);
    entity.burnLeft = furnace.burnLeft;
    entity.burnTotal = furnace.burnTotal;
    entity.cookProgress = furnace.cookProgress;
    target.world.setBlockEntity(furnace.pos[0], furnace.pos[1], furnace.pos[2], entity);
  }
}

/** Restores persistent villagers after the world and registries are ready. */
export function restoreSavedVillagers(data: SaveData, mobs: MobManager): void {
  for (const villager of data.villagers) {
    const mob = mobs.addVillager(villager.x, villager.y, villager.z, villager.profession);
    const trades = tradesFromJSON(villager.trades);
    if (trades.length > 0) mob.trades = trades;
    mob.villageStage = villager.villageStage ?? -1;
  }
}
