/** What a stop is attached to.
 *
 *  `transport.ts` runs the legs of a line and has no idea what is at either end of one;
 *  `villages.ts` runs towns and has never heard of a stop; `industry.ts` runs the places
 *  the player dug and has heard of neither. This is the one file that knows all three, and
 *  its whole job is to answer the six questions a leg asks of an end.
 *
 *  Two ways a stop finds its site, and they are different on purpose. A town is *recorded*
 *  on the stop when it is put down, because which town a stop serves is a decision — the
 *  player chose to build it there, and a town growing outwards later should not quietly
 *  adopt somebody's junction. An industry is found by *proximity*, because the player
 *  routinely builds the stop first and the colliery afterwards, and a stop that had to be
 *  torn down and put back to notice would be a stop that taught them nothing.
 *
 *  Nothing here imports three.js. */

import type { IndustryRegistry } from './industry';
import type { Stop } from './lines';
import { townPlace, type RoadPoint, type SurveyPlace } from './roads';
import type { Cargo, SiteLink } from './transport';
import type { GoodId, VillageId, VillageRegistry } from './villages';

/** How near an industry has to be for a stop to serve it. About the length of a siding:
 *  near enough that the two read as one place, far enough that the stop can stand on the
 *  road rather than in the middle of the yard. */
export const STOP_SITE_REACH = 24;

/** Where a town loads and unloads. The game answers this from its building registry; this
 *  module only needs the point, so it never learns what a building is. */
export interface DepotSource {
  doorOf(village: VillageId): RoadPoint | null;
  /** The town's building plots, so the walk from a doorway to the road can go round them
   *  instead of through them. */
  plotsOf(village: VillageId): readonly { x0: number; z0: number; w: number; d: number }[];
}

/** The `SiteLink` a leg is run against. */
export function networkSites(
  villages: VillageRegistry,
  industries: IndustryRegistry,
  depots: DepotSource | null = null,
): SiteLink {
  const townAt = (stop: Stop) => (stop.town ? villages.get(stop.town) : undefined);
  const worksAt = (stop: Stop) => industries.near(stop.x, stop.z, STOP_SITE_REACH);

  return {
    offers(at: Stop): readonly GoodId[] {
      const town = townAt(at);
      if (town) return [town.produces];
      const works = worksAt(at);
      return works ? [works.good] : [];
    },

    wants(at: Stop): readonly GoodId[] {
      return townAt(at)?.needs ?? [];
    },

    accepts(at: Stop): boolean {
      return townAt(at) !== undefined;
    },

    load(at: Stop, capacity: number, _wanted: readonly GoodId[]): Cargo | null {
      const works = worksAt(at);
      // An industry first where a stop serves both. A stop between a town and its own
      // colliery is a stop the player built to move ore, and the town's own output has a
      // whole town's worth of street to leave by.
      if (works) {
        const count = industries.take(works.id, capacity);
        if (count > 0) return { good: works.good, count };
      }
      const town = townAt(at);
      if (!town) return null;
      // `wanted` is a preference and never a gate. A town banks whatever arrives — what it
      // did not ask for is worth less and is still worth something — and refusing to load
      // anything else leaves a pair of towns with no use for each other's goods reading
      // 「在庫 5 · まもなく出発」 for ever, which is the worst state a panel can be in: a
      // finished line, stock at both ends, and nothing to say about why nothing moves.
      const count = villages.takeStock(town.id, capacity);
      return count > 0 ? { good: town.produces, count } : null;
    },

    loadPeople(at: Stop, capacity: number): number {
      const town = townAt(at);
      return town ? villages.takePassengers(town.id, capacity) : 0;
    },

    unload(at: Stop, good: GoodId, count: number): { needed: boolean; stage: number | null } {
      const town = townAt(at);
      if (!town) return { needed: false, stage: null };
      const result = villages.deliver(town.id, good, count);
      return { needed: result.needed, stage: result.stage };
    },

    restore(at: Stop, good: GoodId, count: number): void {
      if (count <= 0) return;
      const town = townAt(at);
      if (town) {
        if (good === 'passenger') villages.returnPassengers(town.id, count);
        else if (good === town.produces) villages.returnStock(town.id, count);
        else villages.deliver(town.id, good, count);
        return;
      }
      const works = worksAt(at);
      if (works && works.good === good) industries.restore(works.id, count);
    },

    door(at: Stop): RoadPoint | null {
      const town = townAt(at);
      // A stop out in the country is its own doorway: there is no building to walk into,
      // and pretending there is puts the goods a few blocks off the road for no reason.
      return town ? depots?.doorOf(town.id) ?? null : null;
    },

    plots(at: Stop): readonly { x0: number; z0: number; w: number; d: number }[] {
      const town = townAt(at);
      return town ? depots?.plotsOf(town.id) ?? [] : [];
    },

    place(at: Stop): SurveyPlace {
      const town = townAt(at);
      if (town) return townPlace(town);
      return { id: at.id, x: at.x, z: at.z, baseY: at.y, town: null };
    },
  };
}
