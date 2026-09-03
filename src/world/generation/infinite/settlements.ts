import type { GeneratorParams } from './params';
import { clamp, fbm, hash2 } from './grid';
import { COARSE_FACTOR, COARSE_SIZE, CIVIL_TILE, civilTileOf } from './constants';
import type { TerrainCalibration } from './calibrate';
import { terrainSampler } from './terrain';
import { createCoarseReader, ringOffsets, type CoarseTile } from './coarse';

/**
 * Where the settlements are.
 *
 * The finite generator picks them by looking at the whole map: it counts the
 * land, divides by how many settlements it wants, and thins a scored candidate
 * list greedily at the radius that falls out (`chooseSettlements`). Neither half
 * of that survives here. There is no land count, and greedy thinning cannot be
 * decided in a bounded window — whether a candidate is dropped depends on
 * whether a better one was dropped, which depends on one better still, and the
 * chain has no reason to stop inside any window you choose.
 *
 * Two replacements:
 *
 * **Thinning is a strict local maximum.** A candidate is kept when no better
 * candidate lies within `R`. That decision needs nothing outside `R`, and it
 * does not depend on the order candidates are visited in — which is what lets a
 * tile and its neighbour reach the same answer about the ground between them.
 *
 * **Rank becomes nested rings.** The finite mode calls its best-scoring
 * settlement a city because it is first in the list; there is no list here. A
 * candidate that is the best within `R` is a village, the best within `2.2R` a
 * town, the best within `4.5R` a city. Bounded, order-free, and it produces a
 * proper central-place hierarchy rather than one seeded off an arbitrary rank.
 *
 * Everything is scored from the coarse level and the raw height field, never
 * from a super-chunk. Not for purity's sake: a super-chunk costs over a second
 * to build, and asking "is there a village here" must not be able to trigger
 * one — the main thread asks that on the frame a village comes into range.
 *
 * Ported from `src/infinite/civil-lattice.ts` of the reference generator. Names
 * are dropped: this game already names its villages, in `src/game/villages.ts`,
 * and does it in Japanese.
 */

export type SettlementTier = 'village' | 'town' | 'city';

export interface InfiniteSettlement {
  id: string;
  /**
   * The coarse sample point this site was scored at, a multiple of
   * `COARSE_FACTOR`. Everything that has to agree between tiles — the spacing,
   * the graph, the ends of a route — is measured here. Where the place is
   * actually *drawn* is `seat()`, which costs a few hundred noise evaluations
   * and is only worth paying for the settlements something is being built on.
   */
  x: number; y: number;
  score: number;
  /**
   * How far away the nearest better site is, in cells — the radius this one is
   * the best place to live within. It is what the tier is read off, and the
   * network layer uses it to decide which settlements deserve a trunk road.
   */
  dominance: number;
  tier: SettlementTier;
  port: boolean;
}

/**
 * How dense the candidate scatter is, as the expected number of candidates in a
 * disc of radius `R`. Local-max thinning keeps `(1 - e^-L) / L` of the density a
 * perfect packing would reach, so L = 3 buys 95% of it; past that the extra
 * candidates are all scored and all rejected.
 */
const CANDIDATE_LOAD = 3;
const MIN_CANDIDATES = 8, MAX_CANDIDATES = 900;

/**
 * How far a settlement's fabric reaches, in cells.
 *
 * The reference shares this between its density field and its land-use raster.
 * This game builds its towns with its own street grid, so only the land-use
 * side is left: it is what keeps the fields off the ground the town stands on.
 */
export const settlementExtent = (tier: SettlementTier, development: number) =>
  tier === 'city' ? 7 + development * 3 : tier === 'town' ? 4.5 + development * 2 : 2.6;

/**
 * The rings, as multiples of the village radius.
 *
 * Not the values the ideal-Poisson arithmetic gives (1.26 and 4.35 for the
 * finite map's tier mix): the suitability field is smooth, so two candidates a
 * few hundred metres apart score almost the same and a site that is the best
 * within R is nearly always the best within 1.26R as well. At those numbers the
 * village tier came out empty. Measured instead: the dominance radius of an
 * accepted settlement, over 160 km2 of land at three settings, has a stable
 * distribution with p32 near 1.4 R and p95 near 6.5 R — which is where the
 * finite map's 32% villages / 63% towns / 5% cities falls.
 */
const TOWN_RING = 1.4, CITY_RING = 6.5;

/**
 * The finite map's own gate on `suitability`, kept at the same number so the two
 * modes call the same ground good enough to build on.
 */
const SETTLE_FLOOR = 0.4;

/** Below this the slider means "none", as `chooseSettlements` rounds to zero. */
const MIN_DENSITY = 0.015;

/**
 * How far the anchor may be nudged when it is seated, in 40 m cells. The
 * spacing guarantee is on anchors, so seating two neighbours toward each other
 * eats into it from both sides: capped at a third of the village radius, which
 * leaves the closest pair no nearer than R/3.
 */
const SEAT_REACH = 4;
/** Cost of walking away from the scored anchor, per cell, in terrain units. */
const SEAT_DRIFT = 0.0008;

/** Coarse cells searched for a river and for the coast when scoring a site. */
const RIVER_REACH = 4, COAST_REACH = 3;
/**
 * A harbour is closer than that. `findPorts` wants the water within 20 cells and
 * a landing with two wet neighbours; measured over a coastal tile, "sea within
 * three coarse cells" made every single settlement a port town.
 */
const PORT_REACH = 1;
const RIVER_RING = ringOffsets(RIVER_REACH), COAST_RING = ringOffsets(COAST_REACH);
const PORT_RING = ringOffsets(PORT_REACH);

/**
 * Local-max thinning never reaches the packing its radius allows: it drops a
 * candidate whenever a better one is anywhere inside `R`, so the realised
 * density comes out around 58% of `1 / (pi R^2)` even before the suitability
 * floor rejects anything. Measured against the finite map over 160 km2 of land
 * at three settings, 0.72 brings the two within a few per cent — the same
 * number, arrived at independently, that `chooseSettlements` uses for its own
 * fill factor.
 */
const SPACING_FILL = 0.72;

/**
 * The village radius, in 40 m cells.
 *
 * The finite map puts `round(p.settlement * 34)` settlements on its 128 x 128
 * box, so its areal density is `34 p / 16384`. A local-max thinning saturates at
 * one point per `pi R^2`, so matching that density means `R = sqrt(16384 / (pi *
 * 34 p))`. Capped so the city ring still fits inside a 3 x 3 civil
 * neighbourhood at the sparsest setting the slider reaches.
 */
export function villageRadius(p: GeneratorParams): number {
  const density = Math.max(MIN_DENSITY, p.settlement) * 34 / (128 * 128);
  return Math.min(CIVIL_TILE / CITY_RING, SPACING_FILL * Math.sqrt(1 / (Math.PI * density)));
}

interface Candidate {
  cellX: number; cellY: number;
  score: number;
  k: number;
}

/** Coarse cells, read through whichever tile owns them, with the last one kept. */
export interface CoarseReader {
  (coarseX: number, coarseY: number): { tile: CoarseTile; index: number };
}

export interface SettlementFieldContext {
  params: GeneratorParams;
  constants: TerrainCalibration;
  riverThreshold: number;
  coarseIndex: CoarseReader;
}

export interface SettlementField {
  radius: number;
  /** The settlements a civil tile owns. Cached; building one is the unit of work. */
  tile(tileX: number, tileY: number): InfiniteSettlement[];
  /** Everything within `radiusCells` of a world cell, building tiles as needed. */
  near(cellX: number, cellY: number, radiusCells: number): InfiniteSettlement[];
  /** Where the place actually stands, off the anchor and onto flat ground. */
  seat(s: InfiniteSettlement): { x: number; y: number };
  /** Without building anything: the streaming loop decides when to pay. */
  peek(tileX: number, tileY: number): InfiniteSettlement[] | undefined;
  stats(): { tiles: number; lastScanMs: number };
  clear(): void;
}

/**
 * The streaming loop scans the lattice out past what the graphs will read —
 * about 27 km, or a 7 x 7 block of civil tiles — before it asks for a graph. At
 * 49 that block was exactly the cache, so every frame evicted a tile the same
 * frame was about to rebuild, the scan never finished, and nothing downstream of
 * it ever ran: the world had roads and no buildings. A tile is a few dozen small
 * objects, so the headroom is free.
 */
/**
 * The reference streams a 27 km view and needs 121 tiles resident. A player
 * asks about villages within a few hundred blocks, which is one tile and its
 * eight neighbours — but the scatter of all nine is read to build any one of
 * them, so the scatter cache has to be the larger of the two.
 */
const TILE_CACHE = 16;
const SCATTER_CACHE = 36;

/**
 * A candidate is better than another when it scores higher; ties are broken on
 * position and then on scatter index. The tiebreak is not decoration — the
 * scores come out of a hash and two candidates in one tile really can land on
 * the same float, and if the two sides of a seam broke that tie differently one
 * would keep a settlement the other dropped.
 */
const better = (a: Candidate, b: Candidate) =>
  a.score !== b.score ? a.score > b.score
    : a.cellY !== b.cellY ? a.cellY < b.cellY
      : a.cellX !== b.cellX ? a.cellX < b.cellX
        : a.k < b.k;

export function createSettlementField(ctx: SettlementFieldContext): SettlementField {
  const p = ctx.params, c = ctx.constants;
  const coarse = createCoarseReader(ctx.coarseIndex);
  const radius = villageRadius(p);
  const enabled = p.settlement >= MIN_DENSITY;
  const field = terrainSampler(p, c);
  const cache = new Map<string, InfiniteSettlement[]>();
  const scatter = new Map<string, Candidate[]>();
  let lastScanMs = 0;

  const count = Math.round(clamp(
    CANDIDATE_LOAD * CIVIL_TILE * CIVIL_TILE / (Math.PI * radius * radius),
    MIN_CANDIDATES, MAX_CANDIDATES));

  /**
   * `buildSuitability`, with the coarse level standing in for the fields it
   * reads off the finished map. The weights are the finite ones, unchanged.
   *
   * Two of its terms are gone. The edge penalty has nothing to apply to. The
   * landform bonus cannot be had at 320 m — a natural levee is a 40 m feature
   * classified out of the incised channel, which the coarse pass deliberately
   * never computes — so the river-access curve, which already peaks four cells
   * off the water, carries what is left of that preference on its own.
   */
  function scoreAt(cellX: number, cellY: number): number {
    const coarseX = cellX / COARSE_FACTOR, coarseY = cellY / COARSE_FACTOR;
    const tile = coarse.tileAt(coarseX, coarseY), index = coarse.index;
    if (tile.sea[index]) return 0;
    const elevation = clamp((tile.terrain[index] - c.seaLevel) / (c.landHigh || 1));

    // The coarse cell spans eight simulation cells, so its rise is eight cells'
    // worth: divide it back down or the `115` below means something else here.
    const lx = index % COARSE_SIZE, ly = Math.floor(index / COARSE_SIZE);
    const gradient = Math.hypot(
      tile.terrain[ly * COARSE_SIZE + lx + 1] - tile.terrain[ly * COARSE_SIZE + lx - 1],
      tile.terrain[(ly + 1) * COARSE_SIZE + lx] - tile.terrain[(ly - 1) * COARSE_SIZE + lx]) * 0.5;
    const flat = Math.exp(-(gradient / COARSE_FACTOR) * 115);

    let riverCells = Infinity;
    if (Number.isFinite(ctx.riverThreshold)) {
      for (const o of RIVER_RING) {
        if (coarse.flow(coarseX + o.dx, coarseY + o.dy) < ctx.riverThreshold) continue;
        riverCells = o.d * COARSE_FACTOR; break;
      }
    }
    let coastCells = Infinity;
    for (const o of COAST_RING) {
      if (!coarse.sea(coarseX + o.dx, coarseY + o.dy)) continue;
      coastCells = o.d * COARSE_FACTOR; break;
    }

    const riverAccess = riverCells < 30 ? Math.exp(-(((riverCells - 4) / 6) ** 2)) : 0;
    const coastAccess = coastCells < 22 ? Math.exp(-(((coastCells - 4) / 9) ** 2)) : 0;
    const lowland = 1 - clamp(Math.abs(elevation - 0.24) / 0.55);
    const floodPenalty = riverCells <= 1 ? 0.72 : riverCells <= 2 ? 0.18 : 0;
    return clamp(0.39 * flat + 0.17 * riverAccess + 0.12 * coastAccess + 0.1 * lowland
      + 0.12 * (fbm(cellX / 26, cellY / 26, p.seed + 28411, 3) * 0.5 + 0.5) - floodPenalty);
  }

  /**
   * The candidates one civil tile scatters, scored and gated.
   *
   * Snapped onto coarse sample points, which is worth being deliberate about:
   * `buildCoarseTile` fills its array from `fillTerrain(..., COARSE_FACTOR)` at
   * an origin that is a multiple of eight, so a coarse cell holds the height of
   * the *exact* world cell a super-chunk would sample, and `seaMask` is the same
   * threshold on it in both. At these points the coarse level's answer about
   * land and sea is the fine level's answer, bit for bit — so a settlement
   * placed here can never turn out to be standing in the water.
   */
  function candidatesOf(tileX: number, tileY: number): Candidate[] {
    const id = `${tileX},${tileY}`;
    let list = scatter.get(id);
    if (list) return list;
    list = [];
    if (enabled) {
      const seed = (p.seed ^ Math.imul(tileX, 0x9e3779b9) ^ Math.imul(tileY, 0x85ebca6b)) | 0;
      const taken = new Set<number>();
      for (let k = 0; k < count; k++) {
        const ox = Math.floor(hash2(k, 31, seed) * CIVIL_TILE / COARSE_FACTOR) * COARSE_FACTOR;
        const oy = Math.floor(hash2(k, 57, seed) * CIVIL_TILE / COARSE_FACTOR) * COARSE_FACTOR;
        // Snapping collapses several draws onto the same point; the first wins,
        // which is a rule that does not depend on who is asking.
        const local = oy * CIVIL_TILE + ox;
        if (taken.has(local)) continue;
        taken.add(local);
        const cellX = tileX * CIVIL_TILE + ox, cellY = tileY * CIVIL_TILE + oy;
        const score = scoreAt(cellX, cellY);
        if (score >= SETTLE_FLOOR) list.push({ cellX, cellY, score, k });
      }
    }
    scatter.set(id, list);
    while (scatter.size > SCATTER_CACHE) scatter.delete(scatter.keys().next().value as string);
    return list;
  }

  /**
   * Nudge the anchor onto the flattest ground within a few cells, reading the
   * height field directly rather than a super-chunk. 320 m is fine for deciding
   * *that* a place is worth settling and too coarse for deciding exactly where
   * to stand; ±4 cells stays inside the coarse cell that was scored, so the
   * judgement is not revisited, only refined.
   */
  const seatReach = Math.max(1, Math.min(SEAT_REACH, Math.floor(radius / 3)));
  const seats = new Map<string, { x: number; y: number }>();

  function seatAt(anchorX: number, anchorY: number): { x: number; y: number } {
    const span = seatReach * 2 + 3;
    const heights = new Float64Array(span * span);
    for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
      heights[y * span + x] = field.height(anchorX + x - seatReach - 1, anchorY + y - seatReach - 1);
    }
    let bestX = anchorX, bestY = anchorY, best = Infinity;
    for (let dy = -seatReach; dy <= seatReach; dy++) for (let dx = -seatReach; dx <= seatReach; dx++) {
      const x = dx + seatReach + 1, y = dy + seatReach + 1, i = y * span + x;
      if (heights[i] <= c.seaLevel) continue;
      const gradient = Math.hypot(heights[i + 1] - heights[i - 1], heights[i + span] - heights[i - span]) * 0.5;
      const cost = gradient + SEAT_DRIFT * Math.hypot(dx, dy);
      if (cost < best) { best = cost; bestX = anchorX + dx; bestY = anchorY + dy; }
    }
    return { x: bestX, y: bestY };
  }

  function build(tileX: number, tileY: number): InfiniteSettlement[] {
    const started = Date.now();
    const mine = candidatesOf(tileX, tileY);
    const around: Candidate[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      around.push(...candidatesOf(tileX + dx, tileY + dy));
    }
    const cityRing = radius * CITY_RING;
    const out: InfiniteSettlement[] = [];
    for (const candidate of mine) {
      // The distance to the nearest better candidate is the whole answer: it
      // says whether this one survives at all, and which ring it survives to.
      let nearest = Infinity;
      for (const other of around) {
        if (other === candidate || !better(other, candidate)) continue;
        const d = Math.hypot(other.cellX - candidate.cellX, other.cellY - candidate.cellY);
        if (d < nearest) { nearest = d; if (nearest < radius) break; }
      }
      if (nearest < radius) continue;
      const tier: SettlementTier = nearest >= cityRing ? 'city'
        : nearest >= radius * TOWN_RING ? 'town' : 'village';
      let port = false;
      for (const o of PORT_RING) {
        if (coarse.sea(candidate.cellX / COARSE_FACTOR + o.dx, candidate.cellY / COARSE_FACTOR + o.dy)) { port = true; break; }
      }
      out.push({
        id: `${candidate.cellX}:${candidate.cellY}`,
        x: candidate.cellX, y: candidate.cellY,
        score: candidate.score, dominance: nearest, tier, port,
      });
    }
    lastScanMs = Date.now() - started;
    return out;
  }

  const tile = (tileX: number, tileY: number): InfiniteSettlement[] => {
    const id = `${tileX},${tileY}`;
    const cached = cache.get(id);
    if (cached) { cache.delete(id); cache.set(id, cached); return cached; }
    const built = build(tileX, tileY);
    cache.set(id, built);
    while (cache.size > TILE_CACHE) cache.delete(cache.keys().next().value as string);
    return built;
  };

  const seat = (s: InfiniteSettlement) => {
    let found = seats.get(s.id);
    if (!found) { found = seatAt(s.x, s.y); seats.set(s.id, found); }
    return found;
  };

  return {
    radius,
    tile,
    seat,
    peek: (tileX, tileY) => cache.get(`${tileX},${tileY}`),
    near(cellX, cellY, radiusCells) {
      const out: InfiniteSettlement[] = [];
      const lo = civilTileOf(cellX - radiusCells), hi = civilTileOf(cellX + radiusCells);
      const loY = civilTileOf(cellY - radiusCells), hiY = civilTileOf(cellY + radiusCells);
      for (let ty = loY; ty <= hiY; ty++) for (let tx = lo; tx <= hi; tx++) {
        for (const s of tile(tx, ty)) {
          if (Math.hypot(s.x - cellX, s.y - cellY) <= radiusCells) out.push(s);
        }
      }
      return out;
    },
    stats: () => ({ tiles: cache.size, lastScanMs }),
    clear() { cache.clear(); scatter.clear(); seats.clear(); },
  };
}
