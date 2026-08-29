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

import type { BuildingUse, HouseRecord } from '../world/generation/village';
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

/** What each use is called. The economy is what the player is reading these for, so the
 *  word is the one the ledger and the panel use for that side of it. */
export const USE_LABELS: Record<BuildingUse, string> = {
  residential: '住宅',
  commercial: '商店',
  industrial: '工場',
  civic: '公共',
};

export function useLabel(use: BuildingUse): string {
  return USE_LABELS[use];
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
 *  apart by a number rather than by their coordinates, which nobody can read at a glance.
 *
 *  The use comes first, because that is what the town economy trades on and therefore what
 *  the player is reading the name for. A home keeps its trade in the name — a 農家 is still
 *  a 農家 — because those are homes with a job in them and calling every one of them 住宅
 *  would throw away the only thing that told them apart. */
function labelFor(house: HouseRecord, taken: Map<string, number>): string {
  const stem = stemFor(house);
  const seen = (taken.get(stem) ?? 0) + 1;
  taken.set(stem, seen);
  return seen === 1 ? stem : `${stem} ${seen}`;
}

function stemFor(house: HouseRecord): string {
  if (house.role === 'market') return '市場';
  if (house.use === 'industrial') return house.profession === 'blacksmith' ? '鍛冶屋' : '工場';
  if (house.use === 'commercial') return '商店';
  return PROFESSION_LABELS[house.profession] ?? '住宅';
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

/** One line naming a building and what its village does with it.
 *
 *  `note` is whatever the town economy has to say about this building right now — what it
 *  is waiting for, what it has ready. It is passed in rather than looked up because this
 *  module has never known what a village's economy is, and a name should not be the thing
 *  that teaches it. */
export function describeBuilding(
  building: VillageBuilding,
  village: VillageRecord,
  isDepot: boolean,
  note?: string,
): string {
  const role = isDepot
    ? `集荷所（${goodLabel(village.produces)}の積み下ろし）`
    : useLabel(building.use);
  const tail = note ? ` ／ ${note}` : '';
  return `${village.name}の${building.label} — ${role}${tail}`;
}

/** How far out of its way the walk from a doorway to the road may go. A village is 76
 *  blocks across and its houses stand in rows, so anything a door cannot reach in this
 *  many steps is not being blocked by a house. */
const AROUND_LIMIT = 48;

/** Where along a walked path a fraction lands, in world coordinates.
 *
 *  The same arithmetic `transport.ts` does along a route, and here for the same reason: a
 *  walk across town is a list of corners, and what is moving along it is a number. Kept
 *  next to `pathAroundPlots` because that is what produces the list. */
export function pointAlongPath(
  path: readonly { x: number; y: number; z: number }[],
  t: number,
): { x: number; y: number; z: number } | null {
  if (path.length === 0) return null;
  if (path.length === 1) return { ...path[0] };
  const at = Math.max(0, Math.min(1, t)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(at));
  const f = at - i;
  const a = path[i];
  const b = path[i + 1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: Math.round(a.y + (b.y - a.y) * f),
    z: a.z + (b.z - a.z) * f,
  };
}

/** A way from one point to another that does not go through a building.
 *
 *  A depot's doorway is never on the road: the last leg of every trip is a walk across the
 *  village, and it used to be drawn as a straight line to the nearest street. That line
 *  runs through the neighbours about as often as not — and a porter steers at its
 *  shipment, so when the shipment slid into a house the porter walked into the wall and
 *  stayed there.
 *
 *  So the leg goes round instead. Four-neighbour and on the flat, over the plots the
 *  village already knows about: the same information that names a building, so this needs
 *  no chunk to be loaded and answers the same way every time. Height is interpolated
 *  between the ends, which is right because a village street is level — and wrong by at
 *  most a block anywhere else, which the porter walks up.
 *
 *  Only buildings are dodged. A well, a lamp post or a tree in the way is still a tree in
 *  the way; those are one block, and one block is what the porter's step and hop are for.
 *  Returns null when there is no way round at all, which leaves the caller its old
 *  straight line. */
export function pathAroundPlots(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  plots: readonly { x0: number; z0: number; w: number; d: number }[],
  limit = AROUND_LIMIT,
): { x: number; y: number; z: number }[] | null {
  const start = `${from.x},${from.z}`;
  const goal = `${to.x},${to.z}`;
  if (start === goal) return [{ ...from }];
  // The box the walk may wander in: the two ends, and room to go round whatever is
  // between them.
  const pad = 12;
  const minX = Math.min(from.x, to.x) - pad;
  const maxX = Math.max(from.x, to.x) + pad;
  const minZ = Math.min(from.z, to.z) - pad;
  const maxZ = Math.max(from.z, to.z) + pad;
  const blocked = (x: number, z: number): boolean => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return true;
    if ((x === from.x && z === from.z) || (x === to.x && z === to.z)) return false;
    return plots.some((p) => x >= p.x0 && x < p.x0 + p.w && z >= p.z0 && z < p.z0 + p.d);
  };

  const seen = new Map<string, string | null>([[start, null]]);
  const queue: [number, number][] = [[from.x, from.z]];
  const steps: readonly [number, number][] = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head];
    if (`${x},${z}` === goal) break;
    if (Math.abs(x - from.x) + Math.abs(z - from.z) > limit) continue;
    for (const [dx, dz] of steps) {
      const nx = x + dx;
      const nz = z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k) || blocked(nx, nz)) continue;
      seen.set(k, `${x},${z}`);
      queue.push([nx, nz]);
    }
  }
  if (!seen.has(goal)) return null;

  const chain: string[] = [];
  for (let at: string | null = goal; at !== null; at = seen.get(at) ?? null) chain.push(at);
  chain.reverse();
  return chain.map((k, i) => {
    const comma = k.indexOf(',');
    const f = chain.length === 1 ? 0 : i / (chain.length - 1);
    return {
      x: Number(k.slice(0, comma)),
      z: Number(k.slice(comma + 1)),
      y: Math.round(from.y + (to.y - from.y) * f),
    };
  });
}
