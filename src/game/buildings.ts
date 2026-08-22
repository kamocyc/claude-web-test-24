/** Villages as a collection of addressable buildings.
 *
 *  Transport used to run between village *centres*, which meant a porter appeared at the
 *  edge of a street cross and vanished at the far one — goods went from a coordinate to a
 *  coordinate. A village is not a coordinate: it is a handful of houses, and a delivery
 *  that does not come out of one and go into another is not a delivery you can watch.
 *
 *  So every house reports itself — where it stands, which way it faces, where its door is
 *  — and one of them is the village's 集荷所: the building goods leave from and arrive at.
 *  Which one is the player's to choose, and it is a real choice, because the walk from the
 *  door to the road is part of every trip.
 *
 *  Nothing here imports three.js, and nothing here needs a chunk to be loaded: a village
 *  plan is a pure function of the seed, so a building can be named before anybody has
 *  stood in front of it. */

import type { HouseRecord } from '../world/generation/village';
import { goodLabel, type VillageId, type VillageRecord } from './villages';

/** A building's address. Stable across sessions because it is made of its own corner,
 *  which is a pure function of the seed (or, for a hamlet, of its stored centre). */
export type BuildingId = string;

export interface VillageBuilding extends HouseRecord {
  id: BuildingId;
  villageId: VillageId;
  /** What to call it in the world and on the panel. */
  label: string;
  /** Blocks from the village centre, for picking a sensible default. */
  fromCentre: number;
}

export function buildingId(house: { x0: number; z0: number }): BuildingId {
  return `${house.x0},${house.z0}`;
}

const PROFESSION_LABELS: Record<string, string> = {
  farmer: '農家',
  blacksmith: '鍛冶屋',
  librarian: '書庫',
  butcher: '肉屋',
};

/** Names a building after what goes on inside it. Two blacksmiths in one village are told
 *  apart by a number rather than by their coordinates, which nobody can read at a glance. */
function labelFor(house: HouseRecord, taken: Map<string, number>): string {
  const stem = house.role === 'market' ? '市場' : PROFESSION_LABELS[house.profession] ?? '家';
  const seen = (taken.get(stem) ?? 0) + 1;
  taken.set(stem, seen);
  return seen === 1 ? stem : `${stem} ${seen}`;
}

/** Turns a village's raw house records into addressable buildings, in a stable order:
 *  the generated village first, then each growth stage, then the hamlet's own pair. */
export function buildingsOf(
  village: VillageRecord,
  houses: readonly HouseRecord[],
): VillageBuilding[] {
  const taken = new Map<string, number>();
  const out: VillageBuilding[] = [];
  for (const house of houses) {
    const centreX = house.x0 + house.w / 2;
    const centreZ = house.z0 + house.d / 2;
    out.push({
      ...house,
      id: buildingId(house),
      villageId: village.id,
      label: labelFor(house, taken),
      fromCentre: Math.hypot(centreX - village.x, centreZ - village.z),
    });
  }
  return out;
}

/** The building a village uses until the player says otherwise.
 *
 *  The one nearest the centre, because that is the one whose door the village's own
 *  streets already reach — so a road laid to the village works without the player having
 *  had to think about buildings at all. */
export function defaultDepot(buildings: readonly VillageBuilding[]): VillageBuilding | null {
  let best: VillageBuilding | null = null;
  for (const building of buildings) {
    if (!best || building.fromCentre < best.fromCentre) best = building;
  }
  return best;
}

/** The building at an id, or the default when the stored one no longer exists — a village
 *  that has been rebuilt, or a save from before buildings were addressable. */
export function depotOf(
  village: VillageRecord,
  buildings: readonly VillageBuilding[],
): VillageBuilding | null {
  const chosen = village.depot ? buildings.find((b) => b.id === village.depot) : undefined;
  return chosen ?? defaultDepot(buildings);
}

/** The building whose walls contain a cell, if any. Used to name what the player is
 *  looking at, and to keep a house floor from being indexed as road. */
export function buildingAt(
  buildings: readonly VillageBuilding[],
  x: number,
  z: number,
): VillageBuilding | null {
  for (const building of buildings) {
    if (x < building.x0 || x >= building.x0 + building.w) continue;
    if (z < building.z0 || z >= building.z0 + building.d) continue;
    return building;
  }
  return null;
}

/** One line naming a building and what its village does with it. */
export function describeBuilding(
  building: VillageBuilding,
  village: VillageRecord,
  isDepot: boolean,
): string {
  const role = isDepot ? `集荷所（${goodLabel(village.produces)}の積み下ろし）` : '住居';
  return `${village.name}の${building.label} — ${role}`;
}
