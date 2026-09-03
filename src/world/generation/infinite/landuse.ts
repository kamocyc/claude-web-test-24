import type { GeneratorParams } from './params';
import { clamp, fbm, hash2 } from './grid';
import { settlementExtent, type InfiniteSettlement } from './settlements';

/**
 * Farmland and built-up land around a settlement.
 *
 * `buildLandUse` walks the whole map and, for every cell, every settlement on
 * it. Here the settlements come in as a list the caller gathered, which is the
 * only change of substance: every constant below is the finite map's.
 *
 * Its suitability gate is gone. Suitability is a product of the finished map and
 * has no counterpart here; the slope and landform tests it sat alongside carry
 * what it was saying, which is that fields go on gentle, well-watered ground.
 *
 * Ported from `src/infinite/landuse.ts` of the reference generator. Only `farm`
 * is used: it says where a village's fields are allowed to go as the village
 * grows, through `canFarmVillageParcel`. `urban` is kept because it is what
 * stops the fields being laid over the town itself, but nothing is built from
 * it — the streets and houses are this game's own.
 */

/** How far fields reach from a settlement, before the agriculture slider adds. */
const BASE_REACH = 20;

export const landUseReach = (p: GeneratorParams) => BASE_REACH + p.agriculture * 9;

export interface LandUseCell {
  slope: number;
  landform: number;
  riverDistance: number;
  onRiver: boolean;
}

export interface LandUse {
  /** 0 none, 1 village, 2 town, 3 city. */
  urban: number;
  /** 0 none, 1 paddy, 2 dry field. */
  farm: number;
}

const NONE: LandUse = { urban: 0, farm: 0 };

/**
 * `places` must hold every settlement within `landUseReach` of the cell — not
 * merely the ones near whoever is asking. Two drawn tiles share a band of cells,
 * and they only agree about them if both of them can see everything with a say.
 */
export function landUseAt(p: GeneratorParams, places: InfiniteSettlement[],
  worldX: number, worldY: number, cell: LandUseCell): LandUse {
  if (cell.onRiver || !places.length) return NONE;
  let nearest = Infinity, town: InfiniteSettlement | undefined;
  for (const place of places) {
    const d = Math.hypot(worldX - place.x, worldY - place.y);
    if (d < nearest) { nearest = d; town = place; }
  }
  if (!town) return NONE;

  const urbanRadius = settlementExtent(town.tier, p.development);
  const jitter = (hash2(worldX, worldY, p.seed + 1941) - 0.5) * 1.8;
  if (nearest + jitter < urbanRadius && cell.slope < 0.022) {
    return { urban: town.tier === 'city' ? 3 : town.tier === 'town' ? 2 : 1, farm: 0 };
  }
  const reach = landUseReach(p);
  if (nearest >= reach || nearest <= urbanRadius + 1 || cell.slope >= 0.012) return NONE;

  const patch = fbm(worldX / 9, worldY / 9, p.seed + 12371, 3) + hash2(worldX, worldY, p.seed + 2221) * 0.3;
  const lf = cell.landform;
  const wetBonus = lf === 3 ? 0.22 : lf === 1 ? 0.14 : lf === 2 ? -0.15 : 0;
  const density = p.agriculture * 0.6 + clamp(1 - nearest / 31) * 0.27 + (patch * 0.5 + 0.5) * 0.2;
  if ((lf === 3 || lf === 1 || cell.riverDistance <= 7) && cell.slope < 0.0068 && density + wetBonus > 0.58) {
    return { urban: 0, farm: 1 };
  }
  if (density + (lf === 2 ? 0.15 : lf === 4 ? 0.13 : lf === 3 ? -0.2 : 0) > 0.66) return { urban: 0, farm: 2 };
  return NONE;
}
