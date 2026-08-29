/**
 * Browser smoke test: boots the game, plays through the core loop and writes
 * screenshots. Run the dev server first, then:
 *   node scripts/smoke.mjs [url] [outputDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const outDir = process.argv[3] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });

/** `--economy` stops the run once the economy has been driven end to end.
 *
 *  The whole sweep is eight minutes, and most of it is the parts of the game that have not
 *  changed in months — water, combat, farming, riding a train, drowning. When the thing
 *  being worked on is the network, sitting through those to find out whether a stop went
 *  down is eight minutes to answer a two minute question. This runs the boot, the village,
 *  the tutorial, the stops and the line, the road, and the industry, reports page errors,
 *  and stops.
 *
 *  It is not a substitute for the full run — it is what to use twenty times an afternoon,
 *  with the full one before committing. */
const economyOnly = process.argv.includes('--economy');

const launchOptions = {
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
};
if (process.env.PW_CHROMIUM) launchOptions.executablePath = process.env.PW_CHROMIUM;

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const started = Date.now();
{
  const write = console.log;
  let last = started;
  console.log = (...args) => {
    const now = Date.now();
    write(`[${((now - started) / 1000).toFixed(1)}s +${((now - last) / 1000).toFixed(1)}]`, ...args);
    last = now;
  };
}

const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    errors.push(`[console] ${message.text()}`);
  }
});

const shot = async (name) => page.screenshot({ path: `${outDir}/${name}.png` });
/** Escape only when a screen is actually open, otherwise it would pause the game. */
const closeScreen = async () => {
  if (await page.evaluate(() => window.voxelcraft?.game?.screens.isOpen === true)) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.voxelcraft.game.screens.isOpen === false, null, { timeout: 10000 });
  }
};
const debugText = () => page.locator('.debug').textContent();
/** The tutorial's own leg, looked up by the two towns its stops serve. `routes()` is
 *  ordered by line, so a second service is enough to shuffle the indices. */
const QUEST_ROUTE = `(() => {
  const q = window.voxelcraft.quest();
  return window.voxelcraft.routes().find((r) =>
    (r.fromTown === q.origin && r.toTown === q.target)
    || (r.fromTown === q.target && r.toTown === q.origin)) ?? null;
})()`;
/** Stands the player on flat, open, loaded ground and drops a villager in front of them.
 *  Spawning where a teleport landed risks a roof, a wall, or an unloaded chunk, and a
 *  villager that falls out of the world cannot be talked to. */
const villagerInFront = async () => {
  await settled(60000);
  const spot = await page.evaluate(() => {
    const g = window.voxelcraft.game;
    window.voxelcraft.heal();
    for (let r = 4; r < 80; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = Math.round(g.player.x + Math.cos(a) * r);
        const z = Math.round(g.player.z + Math.sin(a) * r);
        const here = g.world.heightAt(x, z);
        const ahead = g.world.heightAt(x, z + 3);
        if (here > 0 && here === ahead && g.world.getBlock(x, here + 1, z) === 0
            && g.world.getBlock(x, here + 1, z + 3) === 0) {
          g.player.teleportTo(x + 0.5, here + 1, z + 0.5);
          g.player.yaw = Math.PI;
          g.player.pitch = 0;
          return { x, z, ground: here };
        }
      }
    }
    return null;
  });
  await frame();
  await page.evaluate(() => window.voxelcraft.spawnMob('villager', 2.5));
  await until(() => window.voxelcraft.mobs().at(-1)?.onGround === true, null, 10000).catch(() => {});
  return spot;
};
const evaluate = (fn, arg) => page.evaluate(fn, arg);
/** Waits for something the page can actually observe, rather than guessing at a duration.
 *  Throws on timeout, deliberately: a wait that quietly gives up turns a broken feature
 *  into a run that still says it passed. */
const until = (condition, arg = null, timeout = 30000) =>
  page.waitForFunction(condition, arg, { timeout });
/** Waits for a number to stop moving. The simulation runs well below real time under
 *  software rendering, so "has the water finished flowing" cannot be a fixed sleep — but
 *  it can be readings that agree.
 *
 *  `dwell` is why this is not just "two samples match": for the first moment after a gate
 *  opens the far end still reads what it read before, and a pair of samples taken in that
 *  window would call it settled and log the old value as the result. Nothing may be
 *  reported stable until the simulation has had that long to react. */
const stable = (expression, { tolerance = 0.001, dwell = 900, timeout = 60000 } = {}) =>
  page.waitForFunction(
    `(() => {
      const value = ${expression};
      const state = window.__smokeStable ?? (window.__smokeStable = { since: Date.now() });
      const previous = state.value;
      state.value = value;
      if (Date.now() - state.since < ${dwell}) return false;
      return previous !== undefined && Math.abs(previous - value) <= ${tolerance};
    })()`,
    null,
    { timeout, polling: 300 },
  ).finally(() => page.evaluate(() => { delete window.__smokeStable; }));
/** Nothing left to generate or re-mesh. */
const settled = (timeout = 90000) => until(() => window.voxelcraft.backlog() === 0, null, timeout);
/** Turns the world's clock until something is true, rather than sitting through it.
 *
 *  Almost everything this file waits for is the world's own clock: a road being re-walked
 *  (every two seconds), a porter covering a hundred metres, a works converting, an industry
 *  digging. Under software rendering the game runs well below real time, so waiting those
 *  out honestly is most of a ten minute run — for seconds that are simulated identically
 *  whether or not anybody sat through them.
 *
 *  So this runs them by hand. `voxelcraft.fastForward` is `stepWorld` in a loop with no
 *  frame budget, which is exactly what game speed does; the assertion is the same one
 *  `until` makes and it throws the same way, saying how much world it spent. What it will
 *  not do is skip chunk generation, which happens on workers — anything waiting for the
 *  world to *exist* still wants `settled()`. */
const advance = async (condition, { seconds = 240, chunk = 4, arg = null } = {}) => {
  for (let spent = 0; spent <= seconds; spent += chunk) {
    if (await page.evaluate(condition, arg)) return spent;
    await page.evaluate((n) => window.voxelcraft.fastForward(n), chunk);
  }
  if (await page.evaluate(condition, arg)) return seconds;
  throw new Error(`nothing came of ${seconds}s of world: ${String(condition).slice(0, 160)}`);
};
/** One painted frame, for a screenshot taken straight after a change. */
const frame = () =>
  page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
/** Right-clicks at the crosshair until the world reacts. A single dropped frame on the
 *  software renderer can swallow the press, and a retry is cheaper than a flaky run. */
const useUntil = async (predicate, arg = null, attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.mouse.move(640, 360);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    // Poll for the outcome rather than sleeping through it: most presses land on the
    // first frame, and the ones that do not are why the loop is here.
    try {
      await page.waitForFunction(predicate, arg, { timeout: 900 });
      return true;
    } catch {
      // Dropped frame, or the press landed on nothing. Try again.
    }
  }
  return false;
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('.menu-button:has-text("検証用ワールド")').waitFor({ timeout: 30000 });
await frame();
await shot('01-title');

// The fixed verification seed is one click on the title screen.
await page.click('.menu-button:has-text("検証用ワールド")');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
// The minimap paints from loaded chunks, so "it has something on it" is the same thing
// as "the world around the player is really there" — and it is what the next check reads.
await until(() => {
  const canvas = document.querySelector('.minimap-canvas');
  if (!canvas) return false;
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 90) return true;
  }
  return false;
}, null, 60000);
await page.keyboard.press('F3');
await until(() => (document.querySelector('.debug')?.textContent ?? '').length > 0);
await shot('02-spawn');
// A new world hands the player the two blocks everything else is built out of.
console.log('starting kit:', JSON.stringify(await evaluate(() => ({
  planks: window.voxelcraft.player.inventory.count('oak_planks'),
  dirt: window.voxelcraft.player.inventory.count('dirt'),
}))));
const kit = await evaluate(() => ({
  planks: window.voxelcraft.player.inventory.count('oak_planks'),
  dirt: window.voxelcraft.player.inventory.count('dirt'),
}));
if (kit.planks !== 32 || kit.dirt !== 32) {
  throw new Error(`a new world should start with 32 of each: ${JSON.stringify(kit)}`);
}

console.log('spawn:', JSON.stringify(await debugText()));
console.log('verification seed:', await evaluate(() => window.voxelcraft.game.world.seed));

// --- navigation aids ---------------------------------------------------------
const navigation = await evaluate(() => ({
  compass: document.querySelector('.compass')?.style.display !== 'none',
  cardinals: [...document.querySelectorAll('.compass-tick.major')]
    .filter((n) => n.style.display !== 'none')
    .map((n) => n.textContent),
  spawnMarker: document.querySelector('.compass-marker.spawn')?.style.display !== 'none',
  minimapPainted: (() => {
    const canvas = document.querySelector('.minimap-canvas');
    if (!canvas) return 0;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 90) painted++;
    }
    return painted;
  })(),
}));
console.log('compass and minimap:', JSON.stringify(navigation));

// --- mining: look down and hold the left mouse button ------------------------
await evaluate(() => {
  window.voxelcraft.player.pitch = -1.2;
});
await page.mouse.move(640, 360);
await page.mouse.down();
// Software rendering makes the simulation run well below real time, so hold the
// button until something is actually collected rather than for a fixed duration.
await page.waitForFunction(() => window.voxelcraft?.player.inventory.slots.some(Boolean) === true, null, { timeout: 60000 });
await page.mouse.up();
const mined = await evaluate(() => window.voxelcraft.player.inventory.slots.filter(Boolean));
console.log('after mining:', JSON.stringify(mined));
await shot('03-mining');

// --- crafting: click recipes out of the list, no grid to lay out -------------
await evaluate(() => {
  window.voxelcraft.give('oak_log', 8);
  window.voxelcraft.give('cobblestone', 8);
});
await page.keyboard.press('KeyE');
await page.locator('.recipe-row').first().waitFor({ timeout: 15000 });
await shot('04-inventory');

const plankRow = page.locator('.recipe-row', { hasText: '木材' }).first();
// Each click is followed by the thing it was supposed to produce, which is both the
// wait and the assertion.
await plankRow.click({ modifiers: ['Shift'] });
await until(() => window.voxelcraft.player.inventory.count('oak_planks') > 0);
const stickRow = page.locator('.recipe-row', { hasText: '棒' }).first();
await stickRow.click();
await until(() => window.voxelcraft.player.inventory.count('stick') > 0);
const tableRow = page.locator('.recipe-row', { hasText: '作業台' }).first();
await tableRow.click();
await until(() => window.voxelcraft.player.inventory.count('crafting_table') > 0);
const handCrafted = await evaluate(() => {
  const inv = window.voxelcraft.player.inventory;
  return { planks: inv.count('oak_planks'), sticks: inv.count('stick'), tables: inv.count('crafting_table') };
});
console.log('hand crafted from the recipe list:', JSON.stringify(handCrafted));
// A crafting table is needed before any tool shows up in the list.
const toolBeforeTable = await page.locator('.recipe-row', { hasText: '石のツルハシ' }).count();
await page.keyboard.press('Escape');

await evaluate(() => window.voxelcraft.openScreen('crafting'));
await until(() => window.voxelcraft.game.screens.kind === 'crafting');
await page.fill('.recipe-search', 'ツルハシ');
const pickaxeRow = page.locator('.recipe-row', { hasText: '石のツルハシ' }).first();
await pickaxeRow.waitFor({ timeout: 15000 });
await shot('04b-recipes');
await pickaxeRow.click();
await until(() => window.voxelcraft.player.inventory.count('stone_pickaxe') > 0);
const tableCrafted = await evaluate(() => {
  const inv = window.voxelcraft.player.inventory;
  return { pickaxe: inv.count('stone_pickaxe'), cobble: inv.count('cobblestone'), sticks: inv.count('stick') };
});
console.log('tool recipes hidden without a table:', toolBeforeTable, '/ crafted at the table:', JSON.stringify(tableCrafted));
await closeScreen();

// --- night and hostile mobs --------------------------------------------------
await evaluate(() => {
  window.voxelcraft.setTime(0.68);
  window.voxelcraft.player.pitch = -0.1;
  window.voxelcraft.spawnMob('zombie', 4);
  window.voxelcraft.spawnMob('skeleton', 6);
  window.voxelcraft.spawnMob('cow', 8);
});
// The clock moves the moment it is set; what takes time is the three mobs falling the
// last tenth of a block onto the ground they were dropped above.
await until(() => window.voxelcraft.mobs().at(-3)?.onGround === true, null, 10000).catch(() => {});
await frame();
await shot('05-night');
console.log('night:', JSON.stringify(await debugText()));

// --- village -----------------------------------------------------------------
const village = await evaluate(() => window.voxelcraft.gotoVillage());
console.log('village:', JSON.stringify(village));
await settled();
await evaluate(() => {
  window.voxelcraft.setTime(0.2);
  window.voxelcraft.player.pitch = -0.25;
});
await frame();
await shot('06-village');
console.log('at village:', JSON.stringify(await debugText()));
const villagers = await evaluate(() => window.voxelcraft.mobs().filter((m) => m.kind === 'villager').length);
console.log('villagers nearby:', villagers);

// Buildings are addressable: each has a name, a doorway, and one of them is where the
// village's goods come and go from.
const stock = await evaluate(() => window.voxelcraft.buildings());
console.log('buildings:', JSON.stringify({
  village: stock.village,
  depot: stock.list.find((b) => b.depot)?.label ?? null,
  labels: stock.list.map((b) => b.label),
}));
if (!stock.list.some((b) => b.depot)) throw new Error('no village building takes the goods');

// Stand outside a different building, look at it, and claim it with the key a player has.
// Two blocks out, not four: a town's streets are three wide, so four steps back from a
// doorway is across the road and standing on somebody else's roof.
const claimed = await evaluate(() => {
  const g = window.voxelcraft.game;
  const list = window.voxelcraft.buildings().list;
  const target = list.find((b) => !b.depot) ?? list[0];
  const dx = target.outside.x - target.door.x;
  const dz = target.outside.z - target.door.z;
  const x = target.door.x + dx * 2 + 0.5;
  const z = target.door.z + dz * 2 + 0.5;
  g.player.teleportTo(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1, z);
  g.player.yaw = Math.atan2(-(target.door.x + 0.5 - x), -(target.door.z + 0.5 - z));
  g.player.pitch = 0.05;
  return target.label;
});
await settled();
await frame();
await frame();
console.log('looking at:', JSON.stringify(await evaluate(() => window.voxelcraft.lookingAt())));
await shot('06b-building');
await page.keyboard.press('KeyF');
await until((label) => window.voxelcraft.buildings().list.some((b) => b.depot && b.label === label),
  claimed, 10000);
console.log('depot moved to:', claimed);

// Every house has to have a way in, and a doorway is only a doorway if somebody can walk
// through it: two clear cells at the level the street outside is on.
const doorways = await evaluate(() => {
  const g = window.voxelcraft.game;
  const here = window.voxelcraft.village();
  const out = [];
  for (const b of g.generator.villageBuildings(here.x, here.z)) {
    const record = g.villages.get(here.id);
    const stand = record.baseY + 1;
    const x1 = b.x0 + b.w - 1;
    const z1 = b.z0 + b.d - 1;
    let walkable = 0;
    let loaded = true;
    for (let x = b.x0; x <= x1; x++) {
      for (let z = b.z0; z <= z1; z++) {
        if (x !== b.x0 && x !== x1 && z !== b.z0 && z !== z1) continue;
        if (g.world.heightAt(x, z) < 0) loaded = false;
        if (g.world.getBlock(x, stand, z) === 0 && g.world.getBlock(x, stand + 1, z) === 0) walkable++;
      }
    }
    if (loaded) out.push({ at: `${b.x0},${b.z0}`, walkable });
  }
  return out;
});
console.log('house doorways:', JSON.stringify(doorways));
if (doorways.some((house) => house.walkable === 0)) {
  throw new Error('a village house has no way in');
}

// --- trading with a villager -------------------------------------------------
const traded = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.heal();
  // Stand on flat open ground so the villager cannot fall off a roof.
  for (let r = 6; r < 80; r += 2) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const z = Math.round(g.player.z + Math.sin(a) * r);
      const here = g.world.heightAt(x, z);
      const ahead = g.world.heightAt(x, z + 3);
      if (here > 0 && here === ahead && g.world.getBlock(x, here + 1, z) === 0) {
        g.player.teleportTo(x + 0.5, here + 1, z + 0.5);
        g.player.yaw = Math.PI;
        g.player.pitch = 0;
        break;
      }
    }
    if (g.player.yaw === Math.PI) break;
  }
  const villager = window.voxelcraft.spawnMob('villager', 2.5);
  const first = villager.trades[0];
  for (const side of first.give) window.voxelcraft.give(side.id, side.count * 2);
  return { profession: villager.profession, offers: villager.trades.length, want: first.give, get: first.get };
});
console.log('villager:', JSON.stringify(traded));
// The villager is spawned in mid-air in front of the player and has to land before the
// crosshair can be on it.
await until(() => window.voxelcraft.mobs().at(-1)?.onGround === true, null, 10000).catch(() => {});
console.log('crosshair pick:', JSON.stringify(await evaluate(() => {
  const g = window.voxelcraft.game;
  const mob = window.voxelcraft.pick();
  const villager = mob;
  return {
    picked: mob ? mob.kind : null,
    player: [+g.player.x.toFixed(2), +g.player.y.toFixed(2), +g.player.z.toFixed(2)],
    yaw: +g.player.yaw.toFixed(2),
    villager: villager ? [+villager.x.toFixed(2), +villager.y.toFixed(2), +villager.z.toFixed(2)] : null,
  };
})));
const tradeOpen = await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
await shot('07-trade');
if (tradeOpen) {
  // Skip the tutorial row: this section is about buying, and the quest row sits above it.
  await page.locator('.trade-row:not(.quest-row) .trade-button:not([disabled])').first().click();
  await until(() => {
    const villager = [...window.voxelcraft.game.mobs.mobs].reverse().find((m) => m.kind === 'villager');
    return (villager?.trades ?? []).some((trade) => trade.uses > 0);
  });
}
const tradeResult = await evaluate(() => {
  const g = window.voxelcraft.game;
  // The villager spawned for this test is the newest one.
  const villager = [...g.mobs.mobs].reverse().find((m) => m.kind === 'villager');
  // Across every offer, not just the first: which one the player can afford depends on
  // the profession this villager rolled.
  return { screen: g.screens.kind, uses: villager ? villager.trades.reduce((n, t) => n + t.uses, 0) : -1 };
});
console.log('trade screen open:', tradeOpen, JSON.stringify(tradeResult));
await closeScreen();

// --- villages, roads and transport -------------------------------------------
// The village the player is standing in is found the moment they walk onto its plateau.
const home = await evaluate(() => window.voxelcraft.village());
console.log('village economy:', JSON.stringify({ name: home?.name, produces: home?.produces, discovered: home?.discovered }));
console.log('quest:', JSON.stringify(await evaluate(() => window.voxelcraft.quest())));
// The tutorial is sent to a hamlet built beside the first village, not to the next village
// three hundred blocks away: a crate can be carried there, and the road joined by hand.
console.log('tutorial pair:', JSON.stringify(await evaluate(() => {
  const q = window.voxelcraft.quest();
  const all = window.voxelcraft.villages();
  const origin = all.find((v) => v.id === q.origin);
  const hamlet = all.find((v) => v.outpost && v.parent === q.origin);
  if (!origin || !hamlet) return { hamlet: null };
  return {
    from: origin.name,
    to: hamlet.name,
    makes: hamlet.produces,
    apart: Math.round(Math.hypot(hamlet.x - origin.x, hamlet.z - origin.z)),
  };
})));
await shot('07v-village-quest');
console.log('objective panel:', JSON.stringify(await page.locator('.route-panel').innerText()));

// Take the haul, hand it over, and hear about roads. Walking it is the player's job.
console.log('found nearby:', await evaluate(() => window.voxelcraft.discoverNearby(2)));

// Accept it through the button the player actually clicks, not the debug hook: the row
// is the only place the tutorial can be taken, so a disabled button is a dead tutorial.
await villagerInFront();
const questOpen = await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
const questRow = page.locator('.quest-row');
console.log('quest row:', JSON.stringify({
  open: questOpen,
  text: await questRow.innerText(),
  clickable: await page.locator('.quest-button:not([disabled])').count() === 1,
}));
await shot('07v2-quest-row');
const carriedBefore = await evaluate(() => window.voxelcraft.game.player.inventory.count(
  window.voxelcraft.village().produces,
));
await page.locator('.quest-button').click();
await until(() => window.voxelcraft.quest().step === 'deliver_by_hand');
console.log('accepted:', JSON.stringify({
  step: (await evaluate(() => window.voxelcraft.quest())).step,
  carriedBefore,
  carriedAfter: await evaluate(() => window.voxelcraft.game.player.inventory.count(
    window.voxelcraft.quest().cargo?.good ?? '',
  )),
}));
await closeScreen();

// --- the service ------------------------------------------------------------
// The change this whole build is about: a finished road carries nothing until the player
// has put stops down and named them on a line. So before anything else, check that a
// perfectly good pair of towns with no service between them runs nothing at all.
console.log('legs before any line:', JSON.stringify(await evaluate(() => window.voxelcraft.routes())));
const stopsPlaced = await evaluate(() => {
  const q = window.voxelcraft.quest();
  const g = window.voxelcraft.game;
  const origin = g.villages.get(q.origin);
  const target = g.villages.get(q.target);
  return [
    window.voxelcraft.placeStop(origin.x, origin.z),
    window.voxelcraft.placeStop(target.x, target.z),
  ];
});
console.log('stops placed:', JSON.stringify(stopsPlaced));
if (!stopsPlaced.every((stop) => stop.ok)) throw new Error('the stops would not go down');
// Two stops and still no service: a stop is a place, not a line.
const beforeLine = await evaluate(() => window.voxelcraft.routes());
console.log('legs with stops and no line:', JSON.stringify(beforeLine));
if (beforeLine.length !== 0) throw new Error('something ran without a line saying it should');
console.log('line drawn:', JSON.stringify(await evaluate(() => {
  const stops = window.voxelcraft.stops();
  return window.voxelcraft.makeLine(stops.map((stop) => stop.id), '本線');
})));
console.log('lines:', JSON.stringify(await evaluate(() => window.voxelcraft.lines())));

// The panel the player actually designs in.
await page.keyboard.press('KeyN');
await until(() => window.voxelcraft.game.screens.kind === 'lines');
console.log('line panel:', JSON.stringify(await page.locator('.lines').innerText()));
await shot('07w0-line-panel');
await closeScreen();

// The pair is watched from the village timer, and surveyed once it is.
await advance(`${QUEST_ROUTE}?.missing > 0`);
const unpaved = await evaluate(() => window.voxelcraft.routes());
console.log('route before any road:', JSON.stringify(unpaved));
// The whole point of allowing a dashed road is that the player is told where the gap is.
console.log('unfinished panel:', JSON.stringify(await page.locator('.route-row').innerText()));
await shot('07w-route-gap');

// ...and told it in the world, not only on a panel: a dashed amber line lies along the
// stretch that is still missing, with a beacon standing at each end of it.
const overlook = async () => {
  await evaluate(() => {
    const g = window.voxelcraft.game;
    const q = window.voxelcraft.quest();
    const a = g.villages.get(q.origin);
    const b = g.villages.get(q.target);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    g.player.flying = true;
    g.player.teleportTo(
      mx - ((b.x - a.x) / span) * 24,
      g.world.heightAt(Math.round(mx), Math.round(mz)) + 14,
      mz - ((b.z - a.z) / span) * 24,
    );
    g.player.yaw = Math.atan2(-(b.x - g.player.x), -(b.z - g.player.z));
    g.player.pitch = -0.45;
  });
  await settled();
  await frame();
};
await overlook();
console.log('guide with a gap:', JSON.stringify(await evaluate(() => window.voxelcraft.guide())));
await advance(() => window.voxelcraft.guide().dashed > 0 && window.voxelcraft.guide().beams >= 2);
await shot('07w2-guide-gap');

// The hand-over and the road talk happen at the far village, through the same row. The
// crate has to arrive in the player's pack for the button to be live, so this proves the
// carry as well as the click.
// The village being carried to has not been walked into yet, so it is not one of the
// discovered villages on the strip. Without its own marker the player is told a name and
// nothing else.
// Face it first: the strip only covers what is in front of the player, which is the
// point of a compass, so a marker behind them proves nothing either way.
await evaluate(() => {
  const g = window.voxelcraft.game;
  const aim = g.questline.objective(g.villages, undefined);
  g.player.yaw = Math.atan2(-(aim.marker.x - g.player.x), -(aim.marker.z - g.player.z));
});
await frame();
console.log('way to the target:', JSON.stringify({
  panel: await page.locator('.route-panel').innerText(),
  marker: await page.locator('.compass-marker.target').isVisible()
    ? (await page.locator('.compass-marker.target').innerText()).replace('\n', ' ')
    : null,
}));
await shot('07v2b-heading');

console.log('walked to the target:', JSON.stringify(await evaluate(() => window.voxelcraft.gotoQuestTarget())));
console.log('stood at the target:', JSON.stringify(await villagerInFront()));
await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
if (await page.locator('.quest-button').count() === 1) {
  console.log('delivery row:', JSON.stringify({
    text: await page.locator('.quest-row').innerText(),
    clickable: await page.locator('.quest-button:not([disabled])').count() === 1,
  }));
  await shot('07v3-deliver-row');
  await page.locator('.quest-button').click();
  await until(() => window.voxelcraft.quest().step === 'learn_roads');
  // Next thing this village has to say: the road talk. A fresh villager, because the
  // one just spoken to has had a few seconds to wander out of the crosshair.
  await villagerInFront();
  await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
  if (await page.locator('.quest-button').count() === 1) {
    console.log('road talk:', JSON.stringify(await page.locator('.quest-row').innerText()));
    await page.locator('.quest-button').click();
    await until(() => window.voxelcraft.quest().step === 'build_road');
  }
} else {
  console.log('delivery row: NOT SHOWN — falling back to the debug hook');
}
await closeScreen();
console.log('delivered and learned:', JSON.stringify(await evaluate(() => ({
  step: window.voxelcraft.quest().step,
  fallback: window.voxelcraft.quest().step === 'deliver_by_hand'
    ? [window.voxelcraft.questStep('deliver'), window.voxelcraft.questStep('learn')]
    : window.voxelcraft.quest().step === 'learn_roads'
      ? [window.voxelcraft.questStep('learn')]
      : null,
}))));

// The stops and the line are already down, so the two steps that watch for them fall
// straight through — but they still have to be *seen* to fall through, because neither is
// an event anybody fires.
await advance(() => window.voxelcraft.quest().step === 'build_road');
console.log('tutorial reached:', await evaluate(() => window.voxelcraft.quest().step));

// Lay the road. By hand this is a few hundred blocks, which is a walk, not a smoke test.
console.log('road blocks laid:', await evaluate(() => window.voxelcraft.buildRoad()));
await advance(`${QUEST_ROUTE}?.connected === true`);
console.log('route once paved:', JSON.stringify(await evaluate(() => window.voxelcraft.routes())));
console.log('linked panel:', JSON.stringify(await page.locator('.route-row').innerText()));
await shot('07x-route-linked');

// The last leg of every trip is the walk between the road and the depot's doorway, and
// the porter mob steers straight at wherever its shipment has got to. So every step of
// the line the shipment slides along has to be somewhere a walker could stand: a
// shipment that slides into a wall is a porter standing against one.
const throughWalls = await evaluate(() => {
  const g = window.voxelcraft.game;
  const here = window.voxelcraft.village();
  const route = g.transport.routes.find((r) => r.from.town === here.id || r.to.town === here.id);
  if (!route || route.waypoints.length === 0) return null;
  const solid = (x, y, z) => g.world.getBlock(x, y, z) !== 0 && g.world.getBlock(x, y, z) !== 9;
  /** Somewhere near `y` to stand, with two clear cells over it. The line's height is
   *  interpolated between its corners, so it drifts from the ground over a long straight;
   *  a wall is four blocks of solid over the floor it stands on, which is further than
   *  any drift. */
  const standable = (x, y, z) => {
    for (let h = y - 3; h <= y + 3; h++) {
      if (solid(x, h, z) && !solid(x, h + 1, z) && !solid(x, h + 2, z)) return true;
    }
    return false;
  };
  const walled = [];
  for (let i = 1; i < route.waypoints.length; i++) {
    const a = route.waypoints[i - 1];
    const b = route.waypoints[i];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) || 1;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = Math.round(a.x + (b.x - a.x) * f);
      const z = Math.round(a.z + (b.z - a.z) * f);
      const y = Math.round(a.y + (b.y - a.y) * f);
      if (g.world.heightAt(x, z) < 0) continue;
      if (!standable(x, y, z)) walled.push(`${x},${y},${z}`);
    }
  }
  return { waypoints: route.waypoints.length, doorGap: Math.round(route.doorGap), walled: walled.slice(0, 8), blocked: walled.length };
});
console.log('the walk through the village:', JSON.stringify(throughWalls));
if (throughWalls && throughWalls.blocked > 0) {
  throw new Error(`the shipment's line runs through ${throughWalls.blocked} cells nobody can stand in`);
}

// Every town wants particular goods, and its works cannot work without every one of its
// raw materials. Which places are worth joining follows from that, so it is worth showing.
console.log('demand:', JSON.stringify(await evaluate(() =>
  window.voxelcraft.villages().filter((v) => v.discovered).map((v) => ({
    name: v.name, rank: v.rank, makes: v.produces, from: v.inputs,
    held: v.inputStock, needs: v.needs,
  })))));

// --- a primary industry ------------------------------------------------------
// The other half of the change. A town makes nothing out of nothing, so every raw material
// on the map comes from somewhere the player chose to dig — and the tool that chooses is
// the survey, which counts what is actually in the ground rather than taking the player's
// word for it.
await evaluate(() => {
  const here = window.voxelcraft.village();
  window.voxelcraft.teleport(here.x, here.z);
});
await settled();
const site = await evaluate(() => {
  const g = window.voxelcraft.game;
  const here = window.voxelcraft.village();
  // Outside every town — a stop within 72 of one is that town's stop, and what is wanted
  // here is a stop that serves the works and nothing else — and near enough that a road to
  // it is a road rather than an expedition.
  const towns = window.voxelcraft.villages();
  const clear = (x, z) => towns.every((v) => Math.hypot(v.x - x, v.z - z) > 90);
  for (let radius = 90; radius <= 150; radius += 10) {
    for (let step = 0; step < 16; step++) {
      const angle = (step * Math.PI) / 8;
      const x = Math.round(here.x + Math.cos(angle) * radius);
      const z = Math.round(here.z + Math.sin(angle) * radius);
      if (g.world.heightAt(x, z) <= 0 || !clear(x, z)) continue;
      const ground = window.voxelcraft.survey(x, z);
      if (ground.found.length > 0) return { x, z, found: ground.found, why: ground.why };
    }
  }
  return null;
});
console.log('deposit found:', JSON.stringify(site));
if (!site) throw new Error('nowhere within reach of the town supports an industry');
// The survey is a real judgement, not a formality: a place has to hold enough of the
// resource *and* hold it densely enough.
if (site.found.some((d) => d.count <= 0 || d.density <= 0)) {
  throw new Error(`a deposit reported nothing in it: ${JSON.stringify(site.found)}`);
}
// And a refusal names what came nearest and which of the two bars it missed, which is the
// difference between "walk further" and "walk to the middle of what you are standing on".
const barren = await evaluate(([x, z]) => {
  const g = window.voxelcraft.game;
  for (let radius = 30; radius <= 200; radius += 10) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      const bx = Math.round(x + Math.cos(angle) * radius);
      const bz = Math.round(z + Math.sin(angle) * radius);
      if (g.world.heightAt(bx, bz) <= 0) continue;
      const ground = window.voxelcraft.survey(bx, bz);
      if (ground.found.length === 0) return { x: bx, z: bz, why: ground.why, all: ground.all };
    }
  }
  return null;
}, [site.x, site.z]);
console.log('a refusal with a reason:', JSON.stringify(barren && { x: barren.x, z: barren.z, why: barren.why }));
if (!barren) throw new Error('every place around the deposit supported an industry');
if (!barren.why) throw new Error('ground that supports nothing gave no reason');
// Every kind is reported on, qualifying or not: that is what makes the reason a number
// rather than an apology.
if (barren.all.length === 0 || barren.all.every((r) => r.short.length === 0)) {
  throw new Error(`the refusal reported no shortfalls: ${JSON.stringify(barren.all)}`);
}

const works = await evaluate(([x, z]) => window.voxelcraft.placeIndustry(x, z), [site.x, site.z]);
console.log('industry built:', JSON.stringify(works));
if (!works.ok) throw new Error(`the industry would not go up: ${JSON.stringify(works)}`);
// And no second one on the same deposit: one seam pays once.
const twice = await evaluate(([x, z]) => window.voxelcraft.placeIndustry(x + 6, z), [site.x, site.z]);
console.log('a second one on the same deposit:', JSON.stringify(twice));
if (twice.ok || twice.why !== 'too-close') {
  throw new Error('two industries were allowed to share one deposit');
}
// Taking one back down and putting it up again: the ground is free the moment it goes, and
// the shed goes with it.
const undone = await evaluate(() => {
  const works = window.voxelcraft.industries()[0];
  // Halfway up the chimney, which is the tallest thing the site built and the one that
  // makes a works findable from a ridge.
  const at = { x: works.x - 1, y: works.y + 5, z: works.z - 1 };
  const before = window.voxelcraft.game.world.getBlock(at.x, at.y, at.z);
  const gone = window.voxelcraft.removeIndustry(works.id);
  return {
    gone,
    left: window.voxelcraft.industries().length,
    before,
    after: window.voxelcraft.game.world.getBlock(at.x, at.y, at.z),
  };
});
console.log('taken back down:', JSON.stringify(undone));
if (!undone.gone.ok || undone.left !== 0) throw new Error('the industry would not come back down');
if (undone.before === 0) throw new Error('the site never built a chimney to take down');
if (undone.after !== 0) throw new Error(`the chimney outlived the industry: ${JSON.stringify(undone)}`);
const rebuilt = await evaluate(([x, z]) => window.voxelcraft.placeIndustry(x, z), [site.x, site.z]);
console.log('and put back up:', JSON.stringify(rebuilt));
if (!rebuilt.ok) throw new Error(`the ground did not come free: ${JSON.stringify(rebuilt)}`);

await evaluate(([x, z]) => window.voxelcraft.teleport(x, z + 12), [site.x, site.z]);
await settled();
await evaluate(() => {
  window.voxelcraft.game.player.pitch = -0.1;
});
await frame();
await shot('07z-industry');

// It digs whether or not anybody has come to collect, and says so by filling up.
await advance(() => window.voxelcraft.industries()[0].stock > 0);
console.log('digging:', JSON.stringify(await evaluate(() => window.voxelcraft.industries())));
// Nothing can leave it until a stop stands there — the ledger says exactly that.
const unserved = await evaluate(() => window.voxelcraft.ledger().industries);
console.log('industry before a stop:', JSON.stringify(unserved));
if (unserved[0].served) throw new Error('an industry with no stop near it claims to be served');

// A stop at the works, a road to the town, and the works on the town's line.
const spur = await evaluate(([x, z]) => {
  const q = window.voxelcraft.quest();
  const g = window.voxelcraft.game;
  const town = g.villages.get(q.origin);
  const stop = window.voxelcraft.placeStop(x, z);
  if (!stop.ok) return { stop };
  const blocks = window.voxelcraft.pave(x, z, town.x, town.z, 'gravel', 1);
  const line = window.voxelcraft.makeLine(
    [stop.id, window.voxelcraft.stops().find((s) => s.town === q.origin).id],
    '原料線',
  );
  return { stop, blocks, line };
}, [site.x, site.z]);
console.log('the raw material line:', JSON.stringify(spur));
if (!spur.stop.ok) throw new Error(`no stop would go down at the works: ${JSON.stringify(spur)}`);
// The stop out at the works serves the works and no town: that is the whole point of a
// stop being a place rather than a village.
if (spur.stop.town !== null) {
  throw new Error(`the works' stop was adopted by a town: ${JSON.stringify(spur.stop)}`);
}
await advance(`window.voxelcraft.lines().find((l) => l.name === '原料線')?.legs[0]?.connected === true`);
console.log('lines now:', JSON.stringify(await evaluate(() => window.voxelcraft.lines())));
// And the whole point of all of it: the raw material actually reaches the town.
await advance(`window.voxelcraft.industries()[0].shipped > 0`);
// What the light in the world draws: the works' stop tied to the works and to no town, the
// town's stop tied to its town.
const links = await evaluate(() => window.voxelcraft.links());
console.log('what each stop is tied to:', JSON.stringify(links));
const spurLink = links.stops.find((s) => s.id === spur.stop.id);
if (!spurLink || spurLink.works === null || spurLink.town !== null) {
  throw new Error(`the works' stop is not tied to the works alone: ${JSON.stringify(spurLink)}`);
}
if (!links.stops.some((s) => s.town !== null)) throw new Error('no stop is tied to a town');
// And the same question asked of a point nobody has built on yet.
const ahead = await evaluate(([x, z]) => window.voxelcraft.linkAt(x, z), [site.x, site.z]);
console.log('what a stop here would be tied to:', JSON.stringify(ahead));
if (ahead.works === null) throw new Error('a point beside the works would be tied to nothing');
console.log('the chain running:', JSON.stringify(await evaluate(() => ({
  industry: window.voxelcraft.industries()[0],
  town: window.voxelcraft.villages().find((v) => v.id === window.voxelcraft.quest().origin),
}))));
await shot('07z2-industry-line');

if (economyOnly) {
  console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
  console.log('--economy: stopped after the economy. Run without it for the whole sweep.');
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
}

// Repaving the same road: the route must actually get faster and carry more.
const dirtRoute = await evaluate(QUEST_ROUTE);
await evaluate(() => window.voxelcraft.buildRoad(undefined, undefined, 'stone_bricks'));
await advance(`(${QUEST_ROUTE}?.quality ?? 0) > ${dirtRoute.quality}`);
const pavedRoute = await evaluate(QUEST_ROUTE);
console.log('road upgraded:', JSON.stringify({
  before: { grade: dirtRoute.grade, quality: dirtRoute.quality, load: dirtRoute.load },
  after: { grade: pavedRoute.grade, quality: pavedRoute.quality, load: pavedRoute.load },
}));
console.log('paved panel:', JSON.stringify(await page.locator('.route-row').first().innerText()));
await shot('07x2-route-paved');

// The line the player just paved, drawn on the ground they paved it over.
await overlook();
console.log('guide once joined:', JSON.stringify(await evaluate(() => window.voxelcraft.guide())));
await advance(() => {
  const guide = window.voxelcraft.guide();
  return guide.lines > 0 && guide.dashed === 0;
});
await shot('07x3-guide-linked');

// --- one block is the whole difference ---------------------------------------
// A road may no longer skip, and the point of saying so is that it is checkable: take a
// single column out of a finished road and the route has to fall apart, then go back
// together when it is put back.
const bite = await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const a = g.villages.get(q.origin);
  const b = g.villages.get(q.target);
  const mx = Math.round((a.x + b.x) / 2);
  const mz = Math.round((a.z + b.z) / 2);
  const near = window.voxelcraft.roadColumnsNear(mx, mz, 6);
  if (!near.length) return null;
  let best = near[0];
  for (const c of near) {
    if (Math.hypot(c.x - mx, c.z - mz) < Math.hypot(best.x - mx, best.z - mz)) best = c;
  }
  const was = g.world.getBlock(best.x, best.y, best.z);
  g.world.setBlock(best.x, best.y, best.z, 0);
  return { x: best.x, y: best.y, z: best.z, was };
});
if (!bite) throw new Error('no road column to take a bite out of');
await advance(`${QUEST_ROUTE}?.connected === false`);
console.log('one block dug out:', JSON.stringify({
  at: bite,
  route: await evaluate(QUEST_ROUTE),
}));
await evaluate((c) => window.voxelcraft.game.world.setBlock(c.x, c.y, c.z, c.was), bite);
await advance(`${QUEST_ROUTE}?.connected === true`);
console.log('and put back:', JSON.stringify(await evaluate(QUEST_ROUTE)));

// --- the road has to be walkable, not merely continuous ----------------------
// Two blocks of rise and a branch at head height are both roads the index used to call
// connected and a porter could not use — which is what "the porter teleports" was. Both
// have to break the route, and both have to say where.

/** Puts a block where the test wants one, waits for the route to fall apart, and reports
 *  what the game says about it. */
const breakAt = async (place) => {
  const at = await evaluate(place, bite);
  await advance(`${QUEST_ROUTE}?.connected === false`);
  return {
    at,
    faults: await evaluate((c) => window.voxelcraft.roadFaults(24)
      .filter((f) => Math.hypot(f.x - c.x, f.z - c.z) < 24), bite),
    note: await page.locator('.route-note').first().innerText().catch(() => null),
  };
};

const stepped = await breakAt((c) => {
  const g = window.voxelcraft.game;
  // Lift one column two blocks clear of its neighbours: a riser a walker cannot climb.
  g.world.setBlock(c.x, c.y, c.z, 0);
  g.world.setBlock(c.x, c.y + 2, c.z, c.was);
  return { x: c.x, y: c.y + 2, z: c.z };
});
console.log('a two block step:', JSON.stringify(stepped));
if (!stepped.faults.some((f) => f.kind === 'step')) {
  throw new Error(`a two block riser was not reported as a step: ${JSON.stringify(stepped)}`);
}
await evaluate((c) => {
  const g = window.voxelcraft.game;
  g.world.setBlock(c.x, c.y + 2, c.z, 0);
  g.world.setBlock(c.x, c.y, c.z, c.was);
}, bite);
await advance(`${QUEST_ROUTE}?.connected === true`);

const overhead = await breakAt((c) => {
  const g = window.voxelcraft.game;
  // Whatever the road is bedded on, put a slab of it where a walker's head goes.
  const solid = g.world.getBlock(c.x, c.y - 1, c.z) || c.was;
  g.world.setBlock(c.x, c.y + 2, c.z, solid);
  return { x: c.x, y: c.y + 2, z: c.z, block: solid };
});
console.log('a branch at head height:', JSON.stringify(overhead));
if (!overhead.faults.some((f) => f.kind === 'headroom')) {
  throw new Error(`a blocked head height was not reported: ${JSON.stringify(overhead)}`);
}
await shot('07x5-road-fault');
await evaluate((c) => window.voxelcraft.game.world.setBlock(c.x, c.y + 2, c.z, 0), bite);
await advance(`${QUEST_ROUTE}?.connected === true`);
console.log('cleared again:', JSON.stringify(await evaluate(QUEST_ROUTE)));

// --- laying road by hand -----------------------------------------------------
// Which is the other half of the bargain: if a road may not skip, then laying one must
// not be four hundred clicks. A shovel held down while the player walks paves the ground
// under them; [R] paves the twenty blocks they are pointing at. Either of them leaving a
// dotted line would put the game back where it started.

/** The longest run of road the index would walk as one, around a point. Up, down, left
 *  and right only — the same four the index uses, so this counts what it counts. */
const runAround = async (x, z, radius = 40) =>
  evaluate(([px, pz, r]) => {
    const columns = window.voxelcraft.roadColumnsNear(px, pz, r);
    const at = new Map(columns.map((c) => [`${c.x},${c.z}`, c]));
    const seen = new Set();
    let biggest = 0;
    for (const start of columns) {
      if (seen.has(`${start.x},${start.z}`)) continue;
      seen.add(`${start.x},${start.z}`);
      const queue = [start];
      let size = 0;
      while (queue.length) {
        const here = queue.pop();
        size++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const key = `${here.x + dx},${here.z + dz}`;
          const next = at.get(key);
          if (!next || seen.has(key) || Math.abs(next.y - here.y) > 1) continue;
          seen.add(key);
          queue.push(next);
        }
      }
      biggest = Math.max(biggest, size);
    }
    return { columns: columns.length, biggest };
  }, [x, z, radius]);

/** Two stretches of open, level, dry ground well outside the village, each running due
 *  north so the player can be pointed straight down one of them. Paving is about the
 *  ground under the player, so the test has to pick ground rather than hope. */
const strips = await evaluate(() => {
  const gen = window.voxelcraft.game.generator;
  const v = window.voxelcraft.village();
  const found = [];
  for (let radius = 70; radius <= 150; radius += 10) {
    for (let step = 0; step < 24; step++) {
      const angle = (step * Math.PI) / 12;
      const x = Math.round(v.x + Math.cos(angle) * radius);
      const z = Math.round(v.z + Math.sin(angle) * radius);
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i <= 26; i++) {
        const h = gen.height(x, z - i);
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
      if (low <= 47) continue;
      found.push({ x, z, spread: high - low });
    }
  }
  found.sort((a, b) => a.spread - b.spread);
  const picked = [];
  for (const spot of found) {
    if (!picked.every((p) => Math.hypot(p.x - spot.x, p.z - spot.z) > 50)) continue;
    // Virgin ground, too. What the sweep is checked on is that it leaves *one* run, and a
    // strip with somebody's road already at the edge of it starts with two.
    if (window.voxelcraft.roadColumnsNear(spot.x, spot.z, 44).length > 0) continue;
    picked.push(spot);
    if (picked.length === 2) break;
  }
  return picked;
});
console.log('open ground:', JSON.stringify(strips));
if (strips.length < 2) throw new Error('nowhere flat enough to pave');

const standOn = async (spot, pitch) => {
  await evaluate(([x, z, look]) => {
    const g = window.voxelcraft.game;
    window.voxelcraft.teleport(x, z);
    g.player.flying = false;
    // Straight into the player's hand: the hotbar is full of whatever they have mined.
    g.player.inventory.slots[0] = { id: 'iron_shovel', count: 1 };
    g.player.inventory.selected = 0;
    g.player.yaw = 0;
    g.player.pitch = look;
  }, [spot.x, spot.z, pitch]);
  await settled();
  await frame();
};

await standOn(strips[0], -1.05);
const beforeSweep = await runAround(strips[0].x, strips[0].z);
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'right' });
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyW');
await page.mouse.up({ button: 'right' });
await frame();
const swept = await runAround(strips[0].x, strips[0].z);
console.log('shovel sweep:', JSON.stringify({
  before: beforeSweep,
  after: swept,
  walkedTo: await evaluate(() => window.voxelcraft.position()),
}));
// Continuity is the property under test: every column the sweep laid has to belong to
// one run the index would walk, not to a scatter of 3x3 patches with holes between them.
if (swept.columns < 24 || swept.biggest !== swept.columns) {
  throw new Error(`the sweep left a dotted line: ${JSON.stringify(swept)}`);
}
// Turn and look back down what was just paved: the road is behind the player, because
// they walked over it.
await evaluate(() => {
  const g = window.voxelcraft.game;
  g.player.yaw = Math.PI;
  g.player.pitch = -0.55;
});
await frame();
await shot('07y-shovel-sweep');

// [R]: point at something out of arm's reach and the ground between here and there is
// road, in one keystroke.
await standOn(strips[1], -0.12);
const beforeRanged = await runAround(strips[1].x, strips[1].z, 26);
await page.keyboard.press('KeyR');
await frame();
const ranged = await runAround(strips[1].x, strips[1].z, 26);
console.log('[R] road:', JSON.stringify({
  at: strips[1],
  before: beforeRanged,
  after: ranged,
  toast: await page.locator('.toast').last().innerText().catch(() => null),
}));
if (ranged.biggest < beforeRanged.biggest + 6) {
  throw new Error(`[R] laid no usable road: ${JSON.stringify({ beforeRanged, ranged })}`);
}
await shot('07y2-ranged-road');

// --- widening a road until a cart fits ---------------------------------------
// Pavement is what makes a road fast; width is what makes it carry. Three columns across
// the whole way and the porters become a cart with three times the load — and one pinch
// anywhere puts them back on foot, which is the thing the panel has to be able to point
// at.
const onFoot = await evaluate(QUEST_ROUTE);
console.log('before widening:', JSON.stringify({
  vehicle: onFoot.vehicle, load: onFoot.load, pinch: onFoot.cartPinch,
}));
if (onFoot.vehicle !== 'porter') throw new Error('a single track road already runs a cart');
console.log('widened:', await evaluate(() => window.voxelcraft.widenRoad()));
await advance(`${QUEST_ROUTE}?.vehicle === 'cart'`);
const byCart = await evaluate(QUEST_ROUTE);
console.log('after widening:', JSON.stringify({
  vehicle: byCart.vehicle, load: byCart.load, climb: byCart.climb, detour: byCart.detour,
}));
// Widening re-lays the road, so its climb and its surface move a little and the two
// loads are not the same road's. The exact three-times multiplier is pinned in
// `transport.test.ts`; what matters here is that widening it plainly bought a lot more.
if (byCart.load < onFoot.load * 2) {
  throw new Error(`a cart should carry far more: ${onFoot.load} -> ${byCart.load}`);
}
console.log('linked panel with a cart:', JSON.stringify(
  await page.locator('.route-row').first().innerText().catch(() => null)));

// One column of the width, taken out of the middle, and the carts stop.
const pinched = await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const a = g.villages.get(q.origin);
  const b = g.villages.get(q.target);
  const mx = Math.round((a.x + b.x) / 2);
  const mz = Math.round((a.z + b.z) / 2);
  const near = window.voxelcraft.roadColumnsNear(mx, mz, 10);
  const at = new Map(near.map((c) => [`${c.x},${c.z}`, c]));
  const look = (x, z) => at.get(`${x},${z}`);
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  near.sort((p, r) => Math.hypot(p.x - mx, p.z - mz) - Math.hypot(r.x - mx, r.z - mz));
  for (const c of near) {
    for (const [dx, dz] of axes) {
      // The line has to survive: keep the columns along the road, take the two across it.
      if (!look(c.x + dx, c.z + dz) || !look(c.x - dx, c.z - dz)) continue;
      const sides = [look(c.x - dz, c.z + dx), look(c.x + dz, c.z - dx)];
      if (!sides[0] || !sides[1]) continue;
      // One column, off one side. A cart used to come at a hole diagonally and squeeze
      // past two other columns; a hole in the road is where the cart stops.
      const hole = sides[0];
      const taken = [{ x: hole.x, y: hole.y, z: hole.z, was: g.world.getBlock(hole.x, hole.y, hole.z) }];
      g.world.setBlock(hole.x, hole.y, hole.z, 0);
      return { middle: { x: c.x, z: c.z }, taken };
    }
  }
  return null;
});
if (!pinched) console.log('one waist in the road: NO THREE WIDE SPOT FOUND');
if (pinched) {
  await advance(`${QUEST_ROUTE}?.vehicle === 'porter'`);
  const narrowed = await evaluate(QUEST_ROUTE);
  console.log('one block out of one side:', JSON.stringify({
    took: pinched.taken.length,
    vehicle: narrowed.vehicle,
    connected: narrowed.connected,
    pinch: narrowed.cartPinch,
    note: await page.locator('.route-note.narrow').first().innerText().catch(() => null),
  }));
  if (!narrowed.connected) throw new Error('a narrow road should still carry a porter');
  await evaluate((list) => {
    for (const c of list) window.voxelcraft.game.world.setBlock(c.x, c.y, c.z, c.was);
  }, pinched.taken);
  await advance(`${QUEST_ROUTE}?.vehicle === 'cart'`);
  console.log('widened back:', await evaluate(() => window.voxelcraft.routes()[0].vehicle));
}


// --- laying a railway until a train runs -------------------------------------
// Pavement is speed and width is load. A railway is neither of those: it is the *other*
// way between two villages, drawn as curves over whatever is in between, and it beats the
// best cart on both numbers at once. Pulling one curve out of the middle of it drops the
// line back onto the road it was laid beside, which is the demotion the panel has to be
// able to point at.
const byRoad = await evaluate(QUEST_ROUTE);
console.log('before the railway:', JSON.stringify({ vehicle: byRoad.vehicle, load: byRoad.load }));
if (byRoad.vehicle === 'train') throw new Error('a pair nobody has railed is already a railway');
console.log('railway laid:', await evaluate(() => window.voxelcraft.buildRailway()));

// Rails alone are a line that runs past the villages. Nothing should move until there is
// somewhere at each end to put freight on and take it off, and the panel should say where
// to build it — a finished railway that carries nothing is otherwise a silence.
await advance(`${QUEST_ROUTE}?.stationGap !== null`);
const unmanned = await evaluate(QUEST_ROUTE);
console.log('rails with no stations:', JSON.stringify({
  vehicle: unmanned.vehicle,
  stationGap: unmanned.stationGap,
  note: await page.locator('.route-note.rail').first().innerText().catch(() => null),
}));
if (unmanned.vehicle === 'train') {
  throw new Error('a railway with no station at either end is already running trains');
}
await shot('07y3-no-station');

// Two stations, one at each end of the line, the way pointing at that end and clicking
// with one in hand does.
console.log('stations built:', JSON.stringify(await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  return [q.origin, q.target].map((id) => {
    const village = g.villages.get(id);
    return window.voxelcraft.buildStation(village.x, village.z);
  });
})));
await advance(`${QUEST_ROUTE}?.vehicle === 'train'`);
const manned = await evaluate(QUEST_ROUTE);
if (manned.stationGap) throw new Error('a line with both stations is still asking for one');
console.log('stations on the line:', JSON.stringify(
  await evaluate(() => window.voxelcraft.stations())));
const byTrain = await evaluate(QUEST_ROUTE);
console.log('after the railway:', JSON.stringify({
  vehicle: byTrain.vehicle, load: byTrain.load, grade: byTrain.grade,
  length: Math.round(byTrain.length), climb: byTrain.climb,
}));
// The exact multiplier is pinned in `transport.test.ts`; what matters here is that the
// railway plainly bought a great deal more than the cart did, and that it is quoted as
// the one thing a road can never be.
if (byTrain.load <= byRoad.load) {
  throw new Error(`a train should carry more than a cart: ${byRoad.load} -> ${byTrain.load}`);
}
if (byTrain.grade !== '鉄路') {
  throw new Error(`a railed route should be quoted as 鉄路, not ${byTrain.grade}`);
}
console.log('linked panel with a train:', JSON.stringify(
  await page.locator('.route-row').first().innerText().catch(() => null)));
await shot('07y4-railway');

// One curve, out of the middle, and the train stops.
const pulled = await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const a = g.villages.get(q.origin);
  const b = g.villages.get(q.target);
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  let best = null;
  for (const edge of window.voxelcraft.trackEdges()) {
    const middle = window.voxelcraft.trackAt(edge.id, edge.length / 2);
    const gap = Math.hypot(middle.x - mx, middle.z - mz);
    if (!best || gap < best.gap) best = { id: edge.id, gap, middle };
  }
  return best && window.voxelcraft.removeTrack(best.id) ? best : null;
});
if (!pulled) console.log('one curve out of the line: NO EDGE FOUND');
if (pulled) {
  await advance(`${QUEST_ROUTE}?.vehicle !== 'train'`);
  const broken = await evaluate(QUEST_ROUTE);
  console.log('one curve pulled out of the line:', JSON.stringify({
    edge: pulled.id,
    vehicle: broken.vehicle,
    connected: broken.connected,
    pinch: broken.railPinch,
    note: await page.locator('.route-note.rail').first().innerText().catch(() => null),
  }));
  if (!broken.connected) throw new Error('the road under a broken railway should still carry goods');
  // A line with nothing left of it has no railhead to report, and should not invent one:
  // a beacon over every village in the world would answer a question nobody asked.
  const left = await evaluate(() => window.voxelcraft.tracks().edges);
  if (left > 0 && !broken.railPinch) {
    throw new Error('a half built railway should say where it stops');
  }
  if (left === 0 && broken.railPinch) {
    throw new Error('a pair with no rails anywhere near it should have nothing to point at');
  }
  console.log('railed back:', await evaluate(() => window.voxelcraft.buildRailway()));
  // The stations may have been left on a stub the new line does not touch, so they are
  // asked for again. `buildStation` is idempotent: one that is already there costs nothing.
  await evaluate(() => {
    const g = window.voxelcraft.game;
    const q = window.voxelcraft.quest();
    for (const id of [q.origin, q.target]) {
      const village = g.villages.get(id);
      window.voxelcraft.buildStation(village.x, village.z);
    }
  });
  await advance(`${QUEST_ROUTE}?.vehicle === 'train'`);
  console.log('running again:', await evaluate(QUEST_ROUTE).then((r) => r.vehicle));
}

// Both of the next two are drawn from where the player is standing — the platforms and the
// freight on them are only built within drawing distance — so stand at one first. The
// railway now runs the length of the walk to the hamlet, which is further than the view
// reaches from wherever the road work left the player.
await evaluate(() => {
  const station = window.voxelcraft.stations()[0];
  if (station) window.voxelcraft.teleport(station.x, station.z + 6);
});
await settled();
await frame();

// And the freight really is out on the rails rather than walking along under them: the
// mob is a picture of the shipment, and the shipment is where the deck is.
const riding = await evaluate(() => {
  const g = window.voxelcraft.game;
  const spots = window.voxelcraft.porterSpots();
  return spots.map((at) => ({
    at,
    deck: window.voxelcraft.trackDeckAt(at.x, at.z),
    ground: g.world.heightAt(at.x, at.z),
  }));
});
console.log('where the freight rides:', JSON.stringify(riding));

// The platform, the pile on it, and the train that is as long as the pile was. This is
// what "the goods are brought in, coupled up and hauled away" looks like from outside.
const platform = await evaluate(() => window.voxelcraft.trackView());
console.log('platforms drawn:', JSON.stringify({
  stations: platform?.stations ?? 0, waiting: platform?.waiting ?? 0,
}));
if (!platform || platform.stations < 1) {
  throw new Error('a railway with two stations on it drew no platform');
}
// Where the player was standing before the railway sections start walking them about, so
// that what comes after them begins where it always did.
const beforeBoarding = await evaluate(() => {
  const p = window.voxelcraft.game.player;
  return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
});

// Stand where the goods are and watch what is carrying them. A railed trip changes hands
// twice, so both a walker and a train should turn up over one trip.
const seen = new Set();
for (let i = 0; i < 40 && seen.size < 2; i++) {
  await evaluate(() => {
    const spot = window.voxelcraft.porterSpots()[0];
    if (spot) window.voxelcraft.teleport(spot.x, spot.z);
  });
  await frame();
  for (const hauler of await evaluate(() => window.voxelcraft.haulers())) {
    seen.add(`${hauler.kind}:${hauler.cars}`);
  }
}
console.log('what carried the freight:', JSON.stringify([...seen]));
await shot('07y5-station');

// And the train is something you can get on. The coach is always there — it is the one
// car that carries nothing — and its floor is the same height as the platform, so the way
// in is a step across rather than a climb.
const aboard = await evaluate(() => {
  const train = window.voxelcraft.trains()[0];
  const coach = train && train.cars.find((car) => car.kind === 'coach');
  if (!coach) return null;
  const game = window.voxelcraft.game;
  game.player.teleportTo(coach.x, coach.y + 1, coach.z);
  game.player.vy = 0;
  return { train: train.id, coach };
});
if (!aboard) {
  console.log('nothing to board: NO TRAIN DRAWN');
} else {
  const rode = [];
  let pictured = false;
  for (let i = 0; i < 40; i++) {
    await frame();
    rode.push(await evaluate(() => {
      const game = window.voxelcraft.game;
      return {
        on: window.voxelcraft.riding().on,
        x: Math.round(game.player.x),
        z: Math.round(game.player.z),
      };
    }));
    // While they are actually on it, not after the train has gone: a picture of the
    // ground beside a railway is not a picture of riding a train.
    if (!pictured && rode.filter((one) => one.on !== null).length >= 4) {
      pictured = true;
      await shot('07y6-aboard');
    }
  }
  const carried = rode.filter((one) => one.on !== null);
  const first = carried[0];
  const last = carried[carried.length - 1];
  console.log('rode the train:', JSON.stringify({
    frames: `${carried.length}/${rode.length}`,
    from: first ? `${first.x},${first.z}` : null,
    to: last ? `${last.x},${last.z}` : null,
  }));
  // Standing in a carriage that then leaves without you is the failure this is here for.
  if (carried.length < 8) {
    throw new Error(`the train left without its passenger after ${carried.length} frames`);
  }
  const travelled = first && last ? Math.hypot(last.x - first.x, last.z - first.z) : 0;
  if (travelled < 5) {
    throw new Error(`a passenger on a moving train went ${Math.round(travelled)} blocks`);
  }
}

// --- the map, big ------------------------------------------------------------
// The corner map covers 224 blocks, which is less than half the distance between two
// villages, so everything the network is about happens off the edge of it.
await page.keyboard.press('KeyM');
await until(() => document.querySelector('.worldmap')?.style.display !== 'none');
await frame();
const mapped = await evaluate(() => document.querySelector('.worldmap-readout')?.textContent ?? '');
console.log('map opened:', mapped);
if (!/1 ドット 2 マス/.test(mapped)) throw new Error(`the map opened at the wrong zoom: ${mapped}`);
await shot('07y7-map');
// Out to the coarsest zoom and back to the finest, so both ends of the range are known to
// work rather than only the one it opens at.
for (let i = 0; i < 6; i++) await page.keyboard.press('Minus');
await frame();
const widest = await evaluate(() => document.querySelector('.worldmap-readout')?.textContent ?? '');
console.log('zoomed out:', widest);
if (!/1 ドット 16 マス/.test(widest)) throw new Error(`the map would not zoom out: ${widest}`);
await shot('07y8-map-wide');
for (let i = 0; i < 6; i++) await page.keyboard.press('Equal');
await frame();
const closest = await evaluate(() => document.querySelector('.worldmap-readout')?.textContent ?? '');
if (!/1 ドット 1 マス/.test(closest)) throw new Error(`the map would not zoom in: ${closest}`);
console.log('zoomed in:', closest);

// --- dragging it, and picking a place on it ----------------------------------
// The map used to be pinned to the player. What has to be true now is that it moves, that
// it moves the right way, and above all that there is a way back — the reason panning was
// refused for so long is that a map which can lose you is worse than a small one.
const mapCentre = async () => {
  const text = await evaluate(() => document.querySelector('.worldmap-readout')?.textContent ?? '');
  const [x, z] = text.split('·')[0].split(',').map((n) => parseInt(n.trim(), 10));
  return { x, z };
};
const mapBox = () => evaluate(() => {
  const r = document.querySelector('.worldmap-canvas-wrap').getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const wasAt = await mapCentre();
const box = await mapBox();
await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.left + box.width / 2 - 180, box.top + box.height / 2 - 110, { steps: 12 });
await page.mouse.up();
await frame();
const dragged = await mapCentre();
console.log('map dragged:', JSON.stringify({ wasAt, dragged }));
// Dragged left and up, so the paper follows the hand and the view goes right and down.
if (!(dragged.x > wasAt.x && dragged.z > wasAt.z)) {
  throw new Error(`the map moved the wrong way: ${JSON.stringify({ wasAt, dragged })}`);
}
const wayBack = await evaluate(() => {
  const b = document.querySelector('.worldmap-home');
  return { lit: b.classList.contains('away'), disabled: b.disabled };
});
if (!wayBack.lit || wayBack.disabled) throw new Error('the map moved and offered no way back');
await shot('07y8b-map-dragged');

// A click pins a place and names it; the pin is what a warp would go to.
await page.mouse.click(box.left + box.width * 0.32, box.top + box.height * 0.68);
await frame();
const picked = await evaluate(() => document.querySelector('.worldmap-cursor')?.textContent ?? '');
console.log('map picked:', picked);
if (!/^選択 -?\d+, -?\d+$/.test(picked)) throw new Error(`clicking the map picked nothing: ${picked}`);
if (await evaluate(() => document.querySelector('.worldmap-warp').disabled)) {
  throw new Error('the warp button is still disabled with a place picked');
}

// Home puts the player back in the middle.
await page.keyboard.press('Home');
await frame();
const recentred = await mapCentre();
console.log('map home:', JSON.stringify(recentred));
if (Math.abs(recentred.x - wasAt.x) > 2 || Math.abs(recentred.z - wasAt.z) > 2) {
  throw new Error(`Home did not come back: ${JSON.stringify({ wasAt, recentred })}`);
}
await page.keyboard.press('KeyM');
await until(() => document.querySelector('.worldmap')?.style.display === 'none');
console.log('map closed');
// What the map is allowed to draw: the chunks that have been loaded at some point, and
// nothing else. The one under the player has been surveyed; one four hundred chunks away
// has not, and the map has to say so rather than draw the terrain the seed would give.
const surveyed = await evaluate(() => {
  const game = window.voxelcraft.game;
  const cx = Math.floor(game.player.x / 16);
  const cz = Math.floor(game.player.z / 16);
  return {
    chunks: game.mapMemory.size,
    loaded: game.world.chunks.size,
    here: game.mapMemory.has(cx, cz),
    // Far enough that no chunk out there has ever been near the player.
    away: game.mapMemory.has(cx + 400, cz + 400),
    remembered: game.mapMemory.heightAt(Math.floor(game.player.x), Math.floor(game.player.z)),
  };
});
console.log('surveyed:', JSON.stringify(surveyed));
if (!surveyed.here || surveyed.away) {
  throw new Error(`the survey covers the wrong ground: ${JSON.stringify(surveyed)}`);
}
// More surveyed than loaded, or the map is only remembering what it can already see.
if (surveyed.chunks <= surveyed.loaded) {
  throw new Error(`the survey forgot the chunks that were unloaded: ${JSON.stringify(surveyed)}`);
}
if (surveyed.remembered <= 0) {
  throw new Error(`the survey has no ground under the player: ${JSON.stringify(surveyed)}`);
}
// Exactly where they were, not merely near it. What follows lays track by mouse from
// wherever the player happens to be standing, and its shape is the ground's as much as the
// player's — putting them back a block and a half off would be changing that test.
await evaluate((at) => {
  const p = window.voxelcraft.game.player;
  p.flying = false;
  p.teleportTo(at.x, at.y, at.z);
  p.yaw = at.yaw;
  p.pitch = at.pitch;
}, beforeBoarding);
await settled(60000);

/** One right click, then two frames before looking.
 *
 *  `useUntil` is wrong for a gesture with more than one click in it: when a poll comes
 *  back late it clicks again, and a second click on the track tool does not repeat the
 *  first, it finishes the curve. Waiting a couple of frames makes the poll reliable, so
 *  the retry is only ever a retry of a press that genuinely went nowhere. Returns what
 *  the tool is doing afterwards, so a failure can say which. */
const rightClick = async () => {
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await frame();
  await frame();
  return evaluate(() => ({
    pending: window.voxelcraft.trackTool().pending !== null,
    ghost: window.voxelcraft.trackTool().ghost,
    edges: window.voxelcraft.tracks().edges,
  }));
};

// --- the same railway, laid by hand ------------------------------------------
// Above it was built from the console in one call. This is the tool a player actually
// holds: click a start, click an end, and the game works out a curve between them that
// owes nothing to the grid. What is checked here is the whole of the claim - that it
// curves, that a second run joins the first without a kink, that it refuses the shapes it
// says it refuses, that the mouse really drives it, and that track hanging over a drop
// grows legs.
await evaluate(() => {
  window.voxelcraft.clearTracks();
  window.voxelcraft.give('track_tool', 1);
  window.voxelcraft.give('rail', 200);
  const inv = window.voxelcraft.game.player.inventory;
  for (let i = 0; i < 9; i++) if (inv.slots[i]?.id === 'track_tool') inv.selected = i;
});
const curved = await evaluate(() => {
  const g = window.voxelcraft.game;
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  const y = g.world.heightAt(x, z) + 6;
  // Leaving north and arriving east: nothing on the voxel grid can do this in one piece.
  return window.voxelcraft.layTrack(
    { x, y, z, yaw: 0 },
    { x: x + 20, y, z: z - 20, yaw: -Math.PI / 2 },
  );
});
console.log('a curve laid in one gesture:', JSON.stringify(curved));
if (!curved.ok) throw new Error(`the track tool could not lay a quarter turn: ${curved.fault}`);
const shape = await evaluate((id) => {
  const start = window.voxelcraft.trackAt(id, 0);
  const end = window.voxelcraft.trackAt(id, window.voxelcraft.trackEdges()[0].length);
  const middle = window.voxelcraft.trackAt(id, window.voxelcraft.trackEdges()[0].length / 2);
  // How far the middle of the run sits from the straight line between its ends.
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const bow = Math.abs((middle.x - start.x) * dz - (middle.z - start.z) * dx) / length;
  return { start, end, middle, bow, edge: window.voxelcraft.trackEdges()[0] };
}, curved.edge);
console.log('the shape of it:', JSON.stringify(shape));
if (shape.bow < 1) throw new Error(`a quarter turn should bow away from its chord: ${shape.bow}`);
if (shape.edge.minRadius < 6) throw new Error('a curve tighter than the limit should not exist');

// Joining on: the second run takes its angle from the end of the first, not from the
// click. This one assertion is the whole of "match the track that is already there".
const joined = await evaluate((id) => {
  const first = window.voxelcraft.trackEdges().find((e) => e.id === id);
  const end = window.voxelcraft.trackAt(id, first.length);
  // Ask for a wildly different angle at the join and watch it be overruled.
  const second = window.voxelcraft.layTrack(
    { x: end.x, y: end.y, z: end.z, yaw: 2.5 },
    { x: end.x + 24, y: end.y, z: end.z - 6, yaw: -Math.PI / 2 },
  );
  return {
    second,
    nodes: window.voxelcraft.tracks().nodes,
    arriving: window.voxelcraft.trackTangentAt(id, first.length),
    leaving: second.ok ? window.voxelcraft.trackTangentAt(second.edge, 0) : null,
  };
}, curved.edge);
console.log('joining onto an end:', JSON.stringify(joined));
if (!joined.second.ok) throw new Error(`could not join onto a free end: ${joined.second.fault}`);
if (joined.nodes !== 3) throw new Error(`a shared end should be one node, not two: ${joined.nodes}`);
for (const axis of ['x', 'y', 'z']) {
  if (Math.abs(joined.arriving[axis] - joined.leaving[axis]) > 1e-3) {
    throw new Error(`the joint has a kink in it: ${JSON.stringify(joined)}`);
  }
}

// The refusals, by name. A curve that cannot be built has to say which rule it broke.
const refused = await evaluate(() => {
  const y = 90;
  return {
    behind: window.voxelcraft.layTrack({ x: 900, y, z: 900, yaw: 0 }, { x: 900, y, z: 912, yaw: 0 }).fault,
    radius: window.voxelcraft.layTrack({ x: 940, y, z: 900, yaw: 0 }, { x: 944, y, z: 896, yaw: -Math.PI / 2 }).fault,
    grade: window.voxelcraft.layTrack({ x: 980, y, z: 900, yaw: 0 }, { x: 980, y: y + 12, z: 880, yaw: 0 }).fault,
  };
});
console.log('shapes it will not build:', JSON.stringify(refused));
for (const [rule, fault] of Object.entries({ behind: 'behind', radius: 'radius', grade: 'grade' })) {
  if (refused[rule] !== fault) throw new Error(`${rule} should be refused as ${fault}: ${refused[rule]}`);
}

// The mouse, not the console. Everything above would pass with the placement code
// unplugged from the buttons.
await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.clearTracks();
  window.voxelcraft.heal();
  g.player.flying = false;
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  g.player.teleportTo(x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5);
  g.player.yaw = 0;
  // Steep, so the start goes down a few blocks out: the far end is chosen afterwards by
  // turning and looking further off, and it has to be able to land beyond the start.
  g.player.pitch = -0.6;
});
await settled(60000);
/** The tool, in hand, now. A dozen console steps stand between here and where it was
 *  selected, and a mouse test that quietly runs with a shovel out proves nothing.
 *
 *  Re-established before every attempt rather than once before the loop. The loop is here
 *  because a press can be swallowed, and this ran with a shovel out often enough to fail
 *  the run — whatever it was, one more selection costs nothing and a flaky suite costs a
 *  great deal. The slot is written straight into the hotbar: `give` puts a tool in the
 *  first free slot anywhere, and a tool in the backpack is a tool the mouse cannot use. */
const toolInHand = () => evaluate(() => {
  const inv = window.voxelcraft.game.player.inventory;
  if (inv.held?.id === 'track_tool') return true;
  const hotbar = inv.slots.slice(0, 9);
  let at = hotbar.findIndex((slot) => slot?.id === 'track_tool');
  if (at < 0) {
    const free = hotbar.findIndex((slot) => !slot);
    at = free < 0 ? 8 : free;
    inv.set(at, { id: 'track_tool', count: 1 });
  }
  inv.selected = at;
  return inv.held?.id === 'track_tool';
});
if (!(await toolInHand())) throw new Error('could not get the track tool into the hotbar');
let placed = await rightClick();
for (let attempt = 1; attempt < 5 && !placed.pending && placed.edges === 0; attempt++) {
  await toolInHand();
  placed = await rightClick();
}
if (!placed.pending) {
  const why = await evaluate(() => ({
    held: window.voxelcraft.game.player.inventory.held?.id ?? null,
    tool: window.voxelcraft.trackTool(),
    screen: window.voxelcraft.game.screens.isOpen,
    dead: window.voxelcraft.game.player.health <= 0,
  }));
  throw new Error(
    `right clicking with the track tool did not leave a start down: ${JSON.stringify(placed)} ${JSON.stringify(why)}`,
  );
}
console.log('start placed by hand:', JSON.stringify(placed));
// Turning on the spot is how the curve gets chosen: the far end follows the head.
await evaluate(() => {
  const p = window.voxelcraft.game.player;
  p.yaw = 0.5;
  p.pitch = -0.3;
});
await frame();
await frame();
const ghost = await evaluate(() => window.voxelcraft.trackView().ghost);
if (ghost === 'none') throw new Error('a start is down and nothing is being previewed');
// The far end is wherever the crosshair lands, and how far out that is depends on the
// ground ahead: too close and the curve doubles back behind its own start, too far and
// it is past the 96 blocks the tool lays in one go. Lift the head a little at a time
// until the shape being offered is one it will build — which is what a player does when
// the readout tells them the span is wrong.
for (let i = 0; i < 14 && await evaluate(() => window.voxelcraft.trackView().ghost) === 'invalid'; i++) {
  await evaluate(() => { window.voxelcraft.game.player.pitch += 0.02; });
  await frame();
  await frame();
}
console.log('the ghost while turning:', JSON.stringify(await evaluate(() => ({
  ghost: window.voxelcraft.trackView().ghost,
  pitch: +window.voxelcraft.game.player.pitch.toFixed(2),
  span: window.voxelcraft.trackTool().readout?.lines?.[0] ?? null,
}))));
const railsBefore = await evaluate(() => window.voxelcraft.game.player.inventory.count('rail'));
let finished = await rightClick();
for (let attempt = 1; attempt < 5 && finished.edges === 0; attempt++) finished = await rightClick();
if (finished.edges === 0) {
  const why = await evaluate(() => ({
    tool: window.voxelcraft.trackTool(),
    player: {
      x: window.voxelcraft.game.player.x, y: window.voxelcraft.game.player.y,
      z: window.voxelcraft.game.player.z, yaw: window.voxelcraft.game.player.yaw,
      pitch: window.voxelcraft.game.player.pitch,
    },
    rails: window.voxelcraft.game.player.inventory.count('rail'),
  }));
  throw new Error(`the second right click did not lay the curve: ${JSON.stringify(finished)} ${JSON.stringify(why)}`);
}
console.log('laid by hand:', JSON.stringify(await evaluate((before) => ({
  tracks: window.voxelcraft.tracks(),
  railsSpent: before - window.voxelcraft.game.player.inventory.count('rail'),
}), railsBefore)));
await shot('07y5-track-curve');

// Track over a drop grows legs, and only where the ground under it is actually loaded.
const piered = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.clearTracks();
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  const y = g.world.heightAt(x, z) + 1;
  const AIR = 0;
  const STONE = 1;
  // Level the strip the run crosses: whatever the ground was doing along it, the deck
  // has to be in the open, or a hillside a few blocks along would bury it and the
  // player would land on the hill instead of on the track.
  for (let d = 0; d <= 30; d++) {
    for (let w = -3; w <= 3; w++) {
      for (let h = 0; h < 8; h++) g.world.setBlock(x + w, y + h, z - d, AIR);
      g.world.setBlock(x + w, y - 1, z - d, STONE);
    }
  }
  // And then the drop the legs are here to stand in.
  for (let d = 8; d < 20; d++) {
    for (let w = -3; w <= 3; w++) {
      for (let h = 0; h < 5; h++) g.world.setBlock(x + w, y - 1 - h, z - d, AIR);
    }
  }
  const laid = window.voxelcraft.layTrack({ x, y, z, yaw: 0 }, { x, y, z: z - 28, yaw: 0 });
  return { laid, view: window.voxelcraft.trackView(), x, y, z };
});
console.log('carried over a trench:', JSON.stringify(piered));
if (!piered.laid.ok) throw new Error(`could not carry track over a trench: ${piered.laid.fault}`);
if (piered.view.piers === 0) throw new Error('floating track should stand on something');
await settled(60000);
// From above and to one side, looking down the trench, where the legs are the picture.
await evaluate((at) => {
  const g = window.voxelcraft.game;
  g.player.flying = true;
  const cx = at.x + 13;
  const cy = at.y + 15;
  const cz = at.z - 2;
  const tx = at.x;
  const ty = at.y - 2;
  const tz = at.z - 16;
  g.player.teleportTo(cx, cy, cz);
  const dx = tx - cx;
  const dy = ty - cy;
  const dz = tz - cz;
  // The camera looks along (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch).
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}, piered);
await settled(60000);
await frame();
await shot('07y6-track-piers');

// --- standing on the track ---------------------------------------------------
// None of this railway is in the block grid, so the sweep that moves the player cannot
// land anyone on it - it resolves every contact onto the nearest whole block, and a deck
// sits wherever the curve put it. The deck is settled onto afterwards instead, and this
// is the check that the wiring for that survived the trip into the real game: the unit
// tests can all pass with `Game` never handing the player the network at all.
const onDeck = await evaluate(() => {
  const g = window.voxelcraft.game;
  const edge = window.voxelcraft.trackEdges()[0];
  const middle = window.voxelcraft.trackAt(edge.id, edge.length / 2);
  const deck = window.voxelcraft.trackDeckAt(middle.x, middle.z);
  g.player.flying = false;
  // A little above it, so the fall is what puts them on it.
  g.player.teleportTo(middle.x, middle.y + 2, middle.z);
  return { deck, middle };
});
await until(() => window.voxelcraft.backlog() === 0, null, 60000);
// Let the fall land and settle.
await until(() => window.voxelcraft.game.player.onGround === true, null, 10000);
const landed = await evaluate(() => ({
  y: window.voxelcraft.game.player.y,
  onGround: window.voxelcraft.game.player.onGround,
}));
console.log('standing on a viaduct:', JSON.stringify({ ...onDeck, landed }));
if (onDeck.deck === null) throw new Error('the deck should hold a height over its own centreline');
if (Math.abs(landed.y - onDeck.deck) > 0.05) {
  throw new Error(`the player should be standing on the deck, not through it: ${JSON.stringify({ landed, deck: onDeck.deck })}`);
}
if (!landed.onGround) throw new Error('a player on a deck is standing on something');
// And it is the deck holding them up, not the ground: the trench under it is five deep.
if (landed.y < onDeck.middle.y - 0.5) throw new Error('the player fell through the deck to the floor of the trench');

// Walking along it stays on it, gradient and all.
await evaluate(() => {
  const g = window.voxelcraft.game;
  const edge = window.voxelcraft.trackEdges()[0];
  const a = window.voxelcraft.trackAt(edge.id, edge.length * 0.25);
  const b = window.voxelcraft.trackAt(edge.id, edge.length * 0.35);
  g.player.teleportTo(a.x, a.y + 0.2, a.z);
  g.player.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  g.player.pitch = 0;
});
await until(() => window.voxelcraft.game.player.onGround === true, null, 10000);
const startedAt = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.__smokeFrom = { x: g.player.x, z: g.player.z };
  return window.__smokeFrom;
});
await page.keyboard.down('KeyW');
await until(() => {
  const g = window.voxelcraft.game;
  return Math.hypot(g.player.x - window.__smokeFrom.x, g.player.z - window.__smokeFrom.z) > 6;
}, null, 15000).catch(() => {});
await page.keyboard.up('KeyW');
const walked = await evaluate((from) => {
  const g = window.voxelcraft.game;
  return {
    moved: Math.hypot(g.player.x - from.x, g.player.z - from.z),
    y: g.player.y,
    deck: window.voxelcraft.trackDeckAt(g.player.x, g.player.z),
    onGround: g.player.onGround,
  };
}, startedAt);
console.log('walking along it:', JSON.stringify(walked));
if (walked.moved < 4) throw new Error(`the player did not walk along the deck: ${walked.moved}`);
if (walked.deck === null || Math.abs(walked.y - walked.deck) > 0.05) {
  throw new Error(`the player left the deck while walking it: ${JSON.stringify(walked)}`);
}
await frame();
await shot('07y7-track-standing');

// --- a junction, and signals that hold a train back ---------------------------
// The two things a railway could not do until now. A branch means a run has to be cut
// where nobody stopped laying, and the halves have to come back with the same shape they
// had; a signal means a stretch of line belongs to one train at a time. Both are checked
// here from the console, because both are answers the world gives rather than pictures.
const stoodAt = await evaluate(() => {
  const g = window.voxelcraft.game;
  return { x: g.player.x, y: g.player.y, z: g.player.z, yaw: g.player.yaw, pitch: g.player.pitch };
});
const junction = await evaluate(() => {
  const v = window.voxelcraft;
  const g = window.voxelcraft.game;
  v.clearTracks();
  v.give('rail', 400);
  v.give('signal', 8);
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  const y = g.world.heightAt(x, z) + 5;
  // A curve, and one that climbs: half of an equal-tangent biarc is not itself one, so a
  // cut that re-solved each half from its ends would come back a different shape. On a
  // straight run nothing could go wrong and the check would prove nothing.
  const trunk = v.layTrack({ x, y, z, yaw: 0 }, { x: x + 30, y: y + 4, z: z - 70, yaw: -0.5 });
  if (!trunk.ok) return { trunk };
  // Where the trunk runs, before anybody cuts it. Whatever the halves are, they have to
  // still run through these — in height as well as on the map.
  const marks = [0.2, 0.4, 0.5, 0.6, 0.8];
  const before = marks.map((frac) => v.trackAt(trunk.edge, trunk.length * frac));
  const cut = v.splitTrack(trunk.edge, trunk.length / 2);
  if (!cut.ok) return { trunk, cut };
  const halves = cut.edges.map((id) => v.trackEdges().find((edge) => edge.id === id));
  const after = marks.map((frac) => {
    const along = trunk.length * frac;
    return along <= halves[0].length
      ? v.trackAt(cut.edges[0], along)
      : v.trackAt(cut.edges[1], along - halves[0].length);
  });
  // And a branch off the cut, angled well inside the limit for a turnout. The trunk's own
  // heading there is what the angle is measured from, so it is read rather than guessed.
  const tangent = v.trackTangentAt(cut.edges[1], 0);
  const along = Math.atan2(-tangent.x, -tangent.z);
  const yaw = along - 0.4;
  const branch = v.layTrack(
    { x: cut.x, y: cut.y, z: cut.z, yaw },
    { x: cut.x - Math.sin(yaw) * 50, y: cut.y, z: cut.z - Math.cos(yaw) * 50, yaw },
  );
  return { trunk, cut, halves, before, after, branch, switches: v.switches(), tracks: v.tracks() };
});
console.log('a run cut in two and branched:', JSON.stringify({
  cut: junction.cut, branch: junction.branch, switches: junction.switches,
}));
if (!junction.trunk?.ok) throw new Error(`could not lay the trunk: ${junction.trunk?.fault}`);
if (!junction.cut?.ok) throw new Error(`could not cut the trunk in two: ${junction.cut?.fault}`);
if (!junction.branch?.ok) throw new Error(`could not branch off the cut: ${junction.branch?.fault}`);
// The halves are the trunk. A cut that re-solved each half from its ends alone drifted up
// to 1.7 blocks from where the track had been, and a train would have ridden the
// difference; the joint is stored to stop that.
if (Math.abs(junction.halves[0].length + junction.halves[1].length - junction.trunk.length) > 0.05) {
  throw new Error(`the two halves do not add up to the run: ${JSON.stringify(junction.halves)}`);
}
for (let i = 0; i < junction.before.length; i++) {
  const was = junction.before[i];
  const now = junction.after[i];
  const off = Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z);
  if (off > 0.05) {
    throw new Error(`cutting the run moved it ${off.toFixed(3)} blocks at sample ${i}`);
  }
}
if (junction.switches.length !== 1) {
  throw new Error(`a Y should leave exactly one switch: ${JSON.stringify(junction.switches)}`);
}
if (junction.switches[0].ways !== 3 || junction.switches[0].taken !== 3) {
  throw new Error(`the switch has the wrong number of ways: ${JSON.stringify(junction.switches[0])}`);
}

// Signals. With none placed the whole network is one block that nobody watches, which is
// exactly how every railway laid before signals existed has to go on behaving.
const blocked = await evaluate(() => {
  const v = window.voxelcraft;
  const before = v.sections();
  const edges = v.trackEdges().sort((a, b) => b.length - a.length);
  const middle = v.trackAt(edges[0].id, edges[0].length / 2);
  const id = v.putSignal(middle.x, middle.z);
  return { before, id, after: v.sections(), signals: v.signals(), at: middle };
});
console.log('signals and the blocks they make:', JSON.stringify(blocked));
if (blocked.before.length !== 1 || blocked.before[0].watched) {
  throw new Error(`an unsignalled railway should be one unwatched block: ${JSON.stringify(blocked.before)}`);
}
if (blocked.id === null) throw new Error('a signal could not be built in the middle of a run');
if (blocked.after.length !== 2 || blocked.after.some((block) => !block.watched)) {
  throw new Error(`one signal should make two watched blocks: ${JSON.stringify(blocked.after)}`);
}
if (blocked.signals.length !== 1) {
  throw new Error(`the network should hold one signal: ${JSON.stringify(blocked.signals)}`);
}

// Standing on the line looking up it, which is where the lamp is read from. The picture
// is the check here: a signal the renderer never heard of would look like clear track.
await evaluate((at) => {
  const g = window.voxelcraft.game;
  g.player.flying = true;
  g.player.teleportTo(at.x, at.y + 1.2, at.z + 26);
  g.player.yaw = 0;
  g.player.pitch = 0.02;
}, blocked.at);
await frame();
await shot('07y7b-track-junction');

// Put it all back the way the next section expects to find it.
await evaluate((stood) => {
  const g = window.voxelcraft.game;
  window.voxelcraft.clearTracks();
  g.player.teleportTo(stood.x, stood.y, stood.z);
  g.player.yaw = stood.yaw;
  g.player.pitch = stood.pitch;
}, stoodAt);
await frame();

// --- what the readout says while laying --------------------------------------
// "Too steep" is not an answer a player can act on until they know it was going up.
const said = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.clearTracks();
  g.player.flying = false;
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  const y = g.world.heightAt(x, z) + 1;
  return {
    climb: window.voxelcraft.layTrack({ x, y, z, yaw: 0 }, { x, y: y + 12, z: z - 20, yaw: 0 }),
    drop: window.voxelcraft.layTrack({ x: x + 40, y, z, yaw: 0 }, { x: x + 40, y: y - 12, z: z - 20, yaw: 0 }),
    tight: window.voxelcraft.layTrack({ x: x + 80, y, z, yaw: 0 }, { x: x + 84, y, z: z - 4, yaw: -Math.PI / 2 }),
  };
});
console.log('shapes described as they are refused:', JSON.stringify(said));
if (said.climb.fault !== 'grade' || said.climb.value <= 0) {
  throw new Error(`a climb refused for its grade should say so with a positive slope: ${JSON.stringify(said.climb)}`);
}
if (said.drop.fault !== 'grade' || said.drop.value >= 0) {
  throw new Error(`a descent should be refused with a negative slope: ${JSON.stringify(said.drop)}`);
}
if (said.tight.fault !== 'radius') throw new Error('a four block quarter turn should be refused for its radius');

// And what it puts under the crosshair while a start is down.
await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.clearTracks();
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  g.player.teleportTo(x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5);
  g.player.yaw = 0;
  g.player.pitch = -0.13;
});
await settled(60000);
let forReadout = await rightClick();
for (let attempt = 1; attempt < 5 && !forReadout.pending && forReadout.edges === 0; attempt++) {
  forReadout = await rightClick();
}
if (!forReadout.pending) {
  throw new Error(`could not put a start down for the readout: ${JSON.stringify(forReadout)}`);
}
await evaluate(() => { window.voxelcraft.game.player.yaw = 0.35; });
await frame();
await frame();
const readout = await evaluate(() => ({
  tool: window.voxelcraft.trackTool().readout,
  shown: document.querySelector('.track-readout')?.style.display !== 'none',
  text: document.querySelector('.track-lines')?.textContent ?? null,
}));
console.log('the readout under the crosshair:', JSON.stringify(readout));
if (!readout.shown) throw new Error('a start is down and nothing is being described');
for (const word of ['長さ', '勾配', '曲がり']) {
  if (!readout.text?.includes(word)) throw new Error(`the readout should say ${word}: ${readout.text}`);
}
if (readout.tool.lines.length !== 3) throw new Error('the readout is three lines');
await shot('07y8-track-readout');
await evaluate(() => {
  window.voxelcraft.game.debug.game.player.inventory.selected = 0;
  window.voxelcraft.clearTracks();
});
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'left' });
await page.mouse.up({ button: 'left' });
await frame();

await evaluate(() => {
  window.voxelcraft.game.player.flying = false;
  window.voxelcraft.clearTracks();
});

// --- the debug mode where nothing runs out -----------------------------------
// Trying a curve out should not begin with an afternoon of smelting iron. The mode
// promises two things: a shelf with one of everything on it, and pockets that never
// empty. Checked here: that both hold, that the shelf cannot be emptied either, and -
// the part that matters most - that switching it off puts the cost straight back, so it
// cannot leak into the rest of this run.
await evaluate(() => {
  window.voxelcraft.clearTracks();
  // Empty of rails while the cost still applies, so "laid it carrying none" means it.
  window.voxelcraft.game.player.inventory.remove('rail', 9999);
  window.voxelcraft.creative(true);
});
await frame();
await page.keyboard.press('KeyC');
await until(() => window.voxelcraft.game.screens.kind === 'creative');
const shelf = await evaluate(() => ({
  slots: document.querySelectorAll('.creative-grid .slot').length,
  filled: document.querySelectorAll('.creative-grid .slot-icon').length,
  badge: document.querySelector('.creative-badge')?.style.display === '',
}));
console.log('the shelf:', JSON.stringify(shelf));
if (shelf.slots === 0 || shelf.slots !== shelf.filled) {
  throw new Error(`the shelf should hold one of everything: ${JSON.stringify(shelf)}`);
}
if (!shelf.badge) throw new Error('a mode that makes everything free has to be visible');

// Take the track tool off the shelf and watch the shelf not notice. Shift-click, because
// by this point in the run the hotbar is full and where it lands is not the point.
const moved = await evaluate(() => {
  const slots = [...document.querySelectorAll('.creative-grid .slot')];
  const at = slots.findIndex((slot) => slot.title.startsWith('線路敷設ツール'));
  if (at < 0) return null;
  slots[at].dispatchEvent(
    new MouseEvent('mousedown', { button: 0, shiftKey: true, bubbles: true, cancelable: true }),
  );
  const inv = window.voxelcraft.game.player.inventory;
  const landed = inv.find('track_tool');
  return {
    landed,
    held: landed >= 0 ? inv.get(landed) : null,
    stillFilled: document.querySelectorAll('.creative-grid .slot-icon').length,
  };
});
console.log('taking one off the shelf:', JSON.stringify(moved));
if (moved?.held?.id !== 'track_tool') throw new Error('could not take the track tool off the shelf');
if (moved.stillFilled !== shelf.filled) throw new Error('the endless shelf ran out');
await closeScreen();

// Lay a curve carrying no rails at all: this is the whole reason the mode exists.
const free = await evaluate(() => {
  const g = window.voxelcraft.game;
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  const y = g.world.heightAt(x, z) + 4;
  const laid = window.voxelcraft.layTrack({ x, y, z, yaw: 0 }, { x: x + 16, y, z: z - 20, yaw: -0.6 });
  return { laid, rails: g.player.inventory.count('rail'), edges: window.voxelcraft.tracks().edges };
});
console.log('a curve laid out of nothing:', JSON.stringify(free));
if (free.rails !== 0 || free.edges === 0) {
  throw new Error(`the debug mode should lay track for free: ${JSON.stringify(free)}`);
}

// Spending out of a slot does not empty it either. Straight at the choke point rather
// than through the hotbar, which by now has nothing free in it.
const spare = await evaluate(() => window.voxelcraft.game.player.inventory.firstEmpty());
if (spare < 0) throw new Error('no free slot to test spending with');
const kept = await evaluate((at) => {
  const inv = window.voxelcraft.game.player.inventory;
  inv.set(at, { id: 'stone', count: 3 });
  inv.consumeAt(at);
  return inv.get(at)?.count ?? 0;
}, spare);
if (kept !== 3) throw new Error(`a spent block should not leave the slot in the debug mode: ${kept}`);

// And off again.
await evaluate(() => {
  window.voxelcraft.creative(false);
  window.voxelcraft.clearTracks();
});
await frame();
const back = await evaluate((at) => {
  const inv = window.voxelcraft.game.player.inventory;
  inv.consumeAt(at);
  const left = inv.get(at)?.count ?? 0;
  inv.set(at, null);
  return {
    left,
    unlimited: inv.unlimited,
    badge: document.querySelector('.creative-badge')?.style.display,
  };
}, spare);
console.log('turned back off:', JSON.stringify(back));
if (back.left !== 2 || back.unlimited !== false || back.badge !== 'none') {
  throw new Error(`the debug mode did not switch off cleanly: ${JSON.stringify(back)}`);
}



// A route runs between two doorways, not two map pins: the shipment leaves the building
// the player picked and arrives at the other village's.
const ends = await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const route = g.transport.routes.find(
    (r) => (r.from.town === q.origin && r.to.town === q.target)
      || (r.from.town === q.target && r.to.town === q.origin),
  );
  if (!route) return null;
  return {
    fromDoor: route.fromDoor,
    toDoor: route.toDoor,
    startsAtDoor: JSON.stringify(route.waypoints[0]) === JSON.stringify(route.fromDoor),
    endsAtDoor:
      JSON.stringify(route.waypoints[route.waypoints.length - 1]) === JSON.stringify(route.toDoor),
  };
});
console.log('route ends:', JSON.stringify(ends));
if (!ends) throw new Error('the tutorial leg has gone');
if (!ends.startsAtDoor || !ends.endsAtDoor) throw new Error('a leg does not run door to door');

// Standing on the road while a shipment runs is the case that used to hang: a visible
// porter drove the clock, so a mob caught on the ground stopped the line for exactly as
// long as somebody was there to watch it not move.
const beforeWatching = (await evaluate(QUEST_ROUTE)).delivered;
await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const a = g.villages.get(q.origin);
  const b = g.villages.get(q.target);
  g.player.flying = false;
  window.voxelcraft.teleport(Math.round((a.x + b.x) / 2), Math.round((a.z + b.z) / 2));
});
await settled();
await advance(`(${QUEST_ROUTE}?.delivered ?? 0) > ${beforeWatching}`);
console.log('delivered with the player watching:', JSON.stringify({
  before: beforeWatching,
  after: (await evaluate(QUEST_ROUTE)).delivered,
  porterMobs: await evaluate(() => window.voxelcraft.porters()),
  panel: await page.locator('.route-cargo').first().innerText().catch(() => null),
}));
await shot('07x4-watched-delivery');

// The trade screen says what the village standing around the player is short of.
await evaluate(() => {
  const g = window.voxelcraft.game;
  const here = window.voxelcraft.village();
  if (here) {
    const top = g.world.heightAt(here.x + 6, here.z + 6);
    if (top > 0) g.player.teleportTo(here.x + 6.5, top + 1, here.z + 6.5);
  }
  g.player.pitch = 0;
  window.voxelcraft.spawnMob('villager', 2.5);
});
await until(() => window.voxelcraft.mobs().at(-1)?.onGround === true, null, 10000).catch(() => {});
const noteOpen = await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
if (noteOpen) {
  console.log('village note:', JSON.stringify(await page.locator('.trade-note').innerText()));
  console.log('offers include the local goods:', await page.locator('.trade-row').count());
  await shot('07x3-trade-note');
}
await closeScreen();

// The whole network on one page: who makes what, who is short of what, which lines pay.
await evaluate(() => window.voxelcraft.openScreen('ledger'));
await page.locator('.ledger').waitFor({ timeout: 15000 });
console.log('ledger:', JSON.stringify((await page.locator('.ledger').innerText()).split('\n').slice(0, 14)));
await shot('07x4-ledger');
await closeScreen();

// The manual: what the tutorial is, what the goals are, and every rule the road index
// applies — assembled from the systems rather than typed out beside them.
await page.keyboard.press('KeyH');
const openedByKey = await page.locator('.help').waitFor({ timeout: 8000 }).then(() => true, () => false);
if (!openedByKey) throw new Error('H did not open the manual');
const manual = await page.locator('.help').innerText();
console.log('help screen:', JSON.stringify({
  headings: await page.locator('.help-heading').allInnerTexts(),
  steps: await page.locator('.help-step').count(),
  currentGoal: await page.locator('.help-step.current .help-step-label').first().innerText()
    .catch(() => null),
}));
for (const needed of ['チュートリアル', '荷車', '頭上', '運賃']) {
  if (!manual.includes(needed)) throw new Error(`the manual does not mention ${needed}`);
}
const goals = await evaluate(() => window.voxelcraft.milestones().all.length);
if (await page.locator('.help-step').count() < goals) {
  throw new Error('the manual does not list every goal');
}
await shot('07x5-help');
await closeScreen();

// Run the goods through until the far village earns a building. The player is paid for
// the haulage, which is the only income the network itself produces.
const purseBefore = await evaluate(() => window.voxelcraft.player.inventory.count('emerald'));
// advanceTransport runs the clock synchronously, so the fee is already banked.
await evaluate(() => window.voxelcraft.advanceTransport(4000));
const purseAfter = await evaluate(() => window.voxelcraft.player.inventory.count('emerald'));
console.log('freight pay: emeralds', purseBefore, '->', purseAfter,
  '/ earned', await evaluate(() => window.voxelcraft.earnings()));
// The milestone list only opens once the tutorial closes, which the arrival above does.
// The list itself is the report: nothing in this run earns one.
await advance(() => window.voxelcraft.quest().step === 'done');
console.log('milestones:', JSON.stringify(await evaluate(() => window.voxelcraft.milestones())));
// The goal after the tutorial has to say what to do about it. Before, it said only
// "connected routes 1 / 2" and pointed at nothing at all.
const goal = await evaluate(() => ({
  title: document.querySelector('.route-quest-title')?.textContent ?? null,
  detail: document.querySelector('.route-quest-detail')?.textContent ?? null,
  aim: document.querySelector('.route-quest-aim')?.style.display === 'none'
    ? null
    : document.querySelector('.route-quest-aim')?.textContent ?? null,
}));
console.log('next goal:', JSON.stringify(goal));
if (!goal.aim) throw new Error('the goal after the tutorial points nowhere');
const grown = await evaluate(() =>
  window.voxelcraft.villages().slice().sort((a, b) => b.stage - a.stage)[0]);
console.log('grown village:', JSON.stringify(grown));
// A village that grew across its own road used to cut it — invisible while a road could
// skip twenty blocks, fatal now that it cannot.
const survived = await evaluate(QUEST_ROUTE);
console.log('route after the village grew:', JSON.stringify({
  connected: survived?.connected, missing: survived?.missing,
}));
if (!survived?.connected) {
  // Where it was cut, and what is standing there now: a house on the road reads very
  // differently from a step the levelling left behind.
  const cut = await evaluate(() => {
    const g = window.voxelcraft.game;
    const q = window.voxelcraft.quest();
    const route = g.transport.routes.find((r) =>
      (r.fromTown === q.origin && r.toTown === q.target)
      || (r.fromTown === q.target && r.toTown === q.origin));
    if (!route) return null;
    const at = route.gapFrom ?? route.gapTo;
    if (!at) return { gapFrom: route.gapFrom, gapTo: route.gapTo, missing: route.missing };
    const column = (x, z) => {
      const out = [];
      for (let y = Math.round(at.y) - 2; y <= Math.round(at.y) + 3; y++) out.push(g.world.getBlock(x, y, z));
      return `${x},${z}:${out.join(',')}`;
    };
    const around = [];
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const x = Math.round(at.x) + dx;
        const z = Math.round(at.z) + dz;
        const level = g.roads?.columns?.get?.(`${x},${z}`);
        around.push(`${column(x, z)}${level === undefined ? '' : `@${level}`}`);
      }
    }
    return {
      gapFrom: route.gapFrom,
      gapTo: route.gapTo,
      missing: route.missing,
      faults: window.voxelcraft.roadFaults(400).filter((f) => Math.hypot(f.x - at.x, f.z - at.z) < 14),
      around,
    };
  });
  console.log('where the road was cut:', JSON.stringify(cut));
  throw new Error('the village grew over its own road');
}
if (grown) {
  await evaluate((v) => window.voxelcraft.teleport(v.x, v.z), grown);
  await settled();
  await evaluate(() => {
    window.voxelcraft.setTime(0.25);
    window.voxelcraft.player.pitch = -0.12;
  });
  await frame();
  await shot('07y-village-grown');
}
// Walk out to where a shipment actually is: the abstract clock is the truth, but the
// porter on the road is the thing the player sees, and it has to follow the road it was
// surveyed onto rather than striking out across country.
const spot = await evaluate(() => window.voxelcraft.porterSpots()[0] ?? null);
if (spot) {
  await evaluate((s) => window.voxelcraft.teleport(s.x, s.z), spot);
  await settled();
  // Standing on a shipment is what makes its porter appear. If none does, the log below
  // says so — that is the report, not a reason to stop the run.
  await advance(() => window.voxelcraft.mobs().some((m) => m.kind === 'porter'), { seconds: 120 })
    .catch(() => {});
  const porter = await evaluate(() => {
    const mob = window.voxelcraft.mobs().find((m) => m.kind === 'porter');
    const g = window.voxelcraft.game;
    if (!mob) return null;
    return {
      away: +Math.hypot(mob.x - g.player.x, mob.z - g.player.z).toFixed(1),
      onRoad: window.voxelcraft.roadIndex().columns > 0
        && g.world.getBlock(Math.floor(mob.x), Math.floor(mob.y) - 1, Math.floor(mob.z)) !== 0,
      /** How far the mob is from the shipment it is drawing. */
      behind: mob.follow ? +Math.hypot(mob.x - mob.follow.x, mob.z - mob.follow.z).toFixed(1) : null,
    };
  });
  console.log('porter on the road:', JSON.stringify(porter));

  // Nothing that walks may ever be seen to jump. The shipment is the truth and the mob
  // follows it, and when the road was allowed a two block riser the mob could not climb,
  // it was picked up and put back down in front of the player. Sample the mob a few
  // times a second and watch for a step no walk could produce.
  const track = [];
  for (let i = 0; i < 80; i++) {
    const at = await evaluate(() => {
      const mob = window.voxelcraft.mobs().find((m) => m.kind === 'porter' || m.kind === 'cart');
      return mob ? { id: mob.id, x: +mob.x.toFixed(2), y: +mob.y.toFixed(2), z: +mob.z.toFixed(2) } : null;
    });
    if (at) track.push(at);
    await page.waitForTimeout(100);
  }
  let worst = 0;
  for (let i = 1; i < track.length; i++) {
    // Only within one mob's life: a porter finishing its trip and the next one setting
    // out is two walkers, not one that moved.
    if (track[i].id !== track[i - 1].id) continue;
    worst = Math.max(worst, Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
  }
  console.log('porter never jumps:', JSON.stringify({
    samples: track.length, biggestStep: +worst.toFixed(2),
  }));
  if (track.length > 20 && worst > 3) {
    throw new Error(`a porter moved ${worst.toFixed(1)} blocks between two frames`);
  }
  await shot('07z-porter');
}
console.log('porters walking:', await evaluate(() => window.voxelcraft.porters()));
console.log('quest at the end:', JSON.stringify(await evaluate(() => window.voxelcraft.quest())));
console.log('routes at the end:', JSON.stringify(await evaluate(() => window.voxelcraft.routes())));
await closeScreen();

// --- fast forward ------------------------------------------------------------
// The world's clock, not the player's. Sixteen ordinary steps a frame rather than one
// enormous one, so nothing that assumes a fixed step is handed a number it has never
// seen. What it buys is the thing the logistics layer is actually made of: time.
const clockAt = () => evaluate(() => ({
  // The day clock runs 0 to 1 and wraps; three seconds is nowhere near a day, so the
  // wrap only has to be undone, never counted.
  clock: window.voxelcraft.game.day.time,
  delivered: window.voxelcraft.routes().reduce((sum, r) => sum + r.delivered, 0),
}));
const advanced = (from, to) => +((((to.clock - from.clock) + 1) % 1) * 1000).toFixed(2);
await evaluate(() => window.voxelcraft.setSpeed(1));
const slowStart = await clockAt();
await page.waitForTimeout(3000);
const slowEnd = await clockAt();
console.log('game speed x16:', JSON.stringify(await evaluate(() => window.voxelcraft.setSpeed(16))));
const fastStart = await clockAt();
await page.waitForTimeout(3000);
const fastEnd = await clockAt();
const badge = await page.locator('.speed-badge').innerText().catch(() => null);
const rate = {
  slow: advanced(slowStart, slowEnd),
  fast: advanced(fastStart, fastEnd),
  badge,
  reported: await evaluate(() => window.voxelcraft.speed()),
};
console.log('world clock over three seconds:', JSON.stringify(rate));
if (rate.fast <= rate.slow * 2) {
  throw new Error(`fast forward did not move the world clock: ${JSON.stringify(rate)}`);
}
if (!badge || !badge.includes('×16')) throw new Error(`no fast forward badge: ${badge}`);
await shot('07x6-fast-forward');
// The keys step through the offered speeds, and the badge goes away at real time.
await page.keyboard.press('BracketLeft');
console.log('after [:', JSON.stringify(await evaluate(() => window.voxelcraft.speed())));
await evaluate(() => window.voxelcraft.setSpeed(1));
await frame();
if (await page.locator('.speed-badge').isVisible()) throw new Error('the badge outstayed x1');

// --- the sample road ---------------------------------------------------------
// What the title screen's 見本ワールド hands a new player: two villages a few hundred
// blocks apart with a finished road between them, laid exactly the way a player's would
// be. It has to survey as connected, or the sample is a lie.
const sample = await evaluate(() => window.voxelcraft.sampleRoad());
console.log('sample road:', JSON.stringify(sample));
if (!sample || sample.blocks < 250) {
  throw new Error(`the sample road is too short: ${JSON.stringify(sample)}`);
}
await settled();
await page.waitForFunction(
  () => window.voxelcraft.routes().some((r) => r.connected && r.length > 250),
  null,
  { timeout: 60000 },
);
const sampleRoutes = await evaluate(() => window.voxelcraft.routes().filter((r) => r.length > 250));
console.log('sample route:', JSON.stringify(sampleRoutes));
// The sample road is laid three columns across, so somebody opening 見本ワールド sees a
// cart on it rather than being told about one. A train, if the pair happened to be one
// this run already railed, is the better answer to the same question.
if (!sampleRoutes.some((r) => r.vehicle === 'cart' || r.vehicle === 'train')) {
  throw new Error(`the sample road is too narrow for a cart: ${JSON.stringify(sampleRoutes)}`);
}
// And a railway runs beside it, laid for all but the stretch the player is standing on,
// with the tool and the rails to close it handed over — the half-built railway is the
// sample's second lesson, and a player given neither the gap nor the means to close it is
// given only the first.
const sampleRail = await evaluate(() => {
  const g = window.voxelcraft.game;
  const inv = g.player.inventory;
  const pinch = window.voxelcraft.routes().find((r) => r.length > 250)?.railPinch ?? null;
  const under = pinch ? g.world.heightAt(Math.round(pinch.x), Math.round(pinch.z)) : -1;
  return {
    ...window.voxelcraft.tracks(),
    tool: inv.count('track_tool'),
    held: inv.count('rail'),
    pinch,
    // How far over the ground the open end stands. A railway held to a gradient has to fly
    // over the valleys between two villages in hill country, and the piers say so — but a
    // line hanging so high that nobody can see what it is for is a different matter.
    over: pinch && under > 0 ? Math.round((pinch.y - under) * 10) / 10 : null,
  };
});
console.log('sample railway:', JSON.stringify(sampleRail));
if (sampleRail.length < 200) {
  throw new Error(`the sample world laid no railway: ${JSON.stringify(sampleRail)}`);
}
// One line with two ends, not a row of stumps: a curve the builder could not solve would
// leave a hole in the middle, and a hole in the middle is a railway that never runs.
if (sampleRail.freeEnds !== 2) {
  throw new Error(`the sample railway is not one unbroken line: ${JSON.stringify(sampleRail)}`);
}
if (sampleRail.tool < 1 || sampleRail.held < 40) {
  throw new Error(`the sample world handed over no way to finish it: ${JSON.stringify(sampleRail)}`);
}
// Left open at the near end, and the panel says where: a finished railway would show the
// train and none of the lesson.
if (!sampleRail.pinch) {
  throw new Error(`the sample railway is not left open for the player: ${JSON.stringify(sampleRail)}`);
}
if (sampleRail.over !== null && sampleRail.over > 40) {
  throw new Error(`the sample railway hangs too high to make sense of: ${JSON.stringify(sampleRail)}`);
}
// The gap has to be reported, not merely left: a break nobody is pointed at is a bug the
// player gets blamed for. (Unless this pair is already a train, in which case there is
// no gap to report.)
const sampleGap = sampleRoutes.find((r) => r.vehicle !== 'train');
if (sampleGap && !sampleGap.railPinch) {
  throw new Error(`the sample railway's gap is not pointed at: ${JSON.stringify(sampleGap)}`);
}
await evaluate(() => {
  window.voxelcraft.game.player.pitch = -0.12;
});
await frame();
await shot('07y3-sample-road');

// --- farming and eating ------------------------------------------------------
const farm = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.give('wooden_hoe');
  window.voxelcraft.give('wheat_seeds', 4);
  window.voxelcraft.give('bread', 2);
  window.voxelcraft.heal();
  g.player.hunger.food = 8;
  // Stand on a grass block so there is soil to till.
  for (let r = 4; r < 60; r += 2) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const z = Math.round(g.player.z + Math.sin(a) * r);
      const top = g.world.heightAt(x, z);
      if (top > 0 && g.world.getBlock(x, top, z) === 2) {
        g.player.teleportTo(x + 0.5, top + 1, z + 0.5);
        g.player.pitch = -1.5;
        g.player.yaw = Math.PI / 2;
        return { x, z, top };
      }
    }
  }
  return null;
});
console.log('farm plot:', JSON.stringify(farm));
if (farm) {
  await until(() => window.voxelcraft.player.onGround === true);
  await evaluate(() => {
    const inv = window.voxelcraft.player.inventory;
    inv.selected = inv.find('wooden_hoe');
  });
  await useUntil(() => {
    const g = window.voxelcraft.game;
    return g.world.getBlock(Math.floor(g.player.x), Math.floor(g.player.y) - 1, Math.floor(g.player.z)) === 35;
  });
  const tilled = await evaluate(() => {
    const g = window.voxelcraft.game;
    const below = { x: Math.floor(g.player.x), y: Math.floor(g.player.y) - 1, z: Math.floor(g.player.z) };
    const inv = g.player.inventory;
    inv.selected = inv.find('wheat_seeds');
    return g.world.getBlock(below.x, below.y, below.z);
  });
  await useUntil(() => {
    const g = window.voxelcraft.game;
    return g.world.getBlock(Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)) !== 0;
  });
  const planted = await evaluate(() => {
    const g = window.voxelcraft.game;
    const x = Math.floor(g.player.x), z = Math.floor(g.player.z);
    const y = Math.floor(g.player.y);
    return { soil: g.world.getBlock(x, y - 1, z), crop: g.world.getBlock(x, y, z) };
  });
  console.log('tilled block:', tilled, 'after planting:', JSON.stringify(planted));
  await shot('07b-farm');
}

const eaten = await evaluate(() => {
  const g = window.voxelcraft.game;
  const inv = g.player.inventory;
  inv.selected = inv.find('bread');
  return g.player.hunger.food;
});
await useUntil((before) => window.voxelcraft.player.hunger.food > before, eaten);
console.log('hunger before/after eating:', eaten, await evaluate(() => window.voxelcraft.player.hunger.food));

// --- furnace and chest screens ----------------------------------------------
await evaluate(() => window.voxelcraft.openScreen('furnace'));
await until(() => window.voxelcraft.game.screens.kind === 'furnace');
await shot('07c-furnace');
await closeScreen();
await evaluate(() => window.voxelcraft.openScreen('chest'));
await until(() => window.voxelcraft.game.screens.kind === 'chest');
await shot('07d-chest');
await closeScreen();

// --- underground -------------------------------------------------------------
const cave = await evaluate(() => {
  window.voxelcraft.heal();
  window.voxelcraft.give('torch', 16);
  window.voxelcraft.player.pitch = 0;
  return window.voxelcraft.findCave();
});
console.log('cave:', JSON.stringify(cave));
await settled();
await frame();
await shot('07-underground');

// --- place a torch in the dark ----------------------------------------------
await evaluate(() => {
  const inv = window.voxelcraft.player.inventory;
  inv.selected = inv.find('torch');
  window.voxelcraft.player.pitch = -1.0;
});
await useUntil(() => {
  const g = window.voxelcraft.game;
  return g.world.getBlockLight(Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)) > 0;
});
await evaluate(() => {
  window.voxelcraft.player.pitch = -0.2;
});
await frame();
await shot('08-torch');
const torchLight = await evaluate(() => {
  const g = window.voxelcraft.game;
  return g.world.getBlockLight(Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z));
});
console.log('block light at player:', torchLight);

// --- a dug pool, channels and floodgates --------------------------------------
// There are no rivers: the water to work with is water the player put there. A basin
// cut into the ground with a spring in the floor of it is the source everything below
// is fed from — the channel, the gate, the pumps and the dive.
const pool = await evaluate(() => {
  const g = window.voxelcraft.game;
  const AIR = 0;
  const STONE = 1;
  const WATER = 9;
  const SPRING = 54;
  window.voxelcraft.heal();
  const x = Math.floor(g.player.x) + 8;
  const z = Math.floor(g.player.z) + 8;
  const ground = g.world.heightAt(x, z);
  if (ground < 0) return null;
  const floorY = ground - 4;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const rim = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
      // A walled basin, so what it holds stands level with the ground around it rather
      // than running off down the hill.
      for (let y = floorY - 1; y <= ground + 6; y++) {
        g.world.setBlock(x + dx, y, z + dz, rim && y <= ground ? STONE : AIR);
      }
      if (rim) continue;
      g.world.setBlock(x + dx, floorY - 1, z + dz, STONE);
      // Filled by hand, because a spring only ever keeps the one cell over it full: it
      // is what puts the water back as the channel below draws the pool down, not what
      // digs the pool in the first place.
      for (let y = floorY; y <= ground; y++) g.world.setBlock(x + dx, y, z + dz, WATER);
    }
  }
  g.world.setBlock(x, floorY, z, SPRING);
  return { x, z, surface: ground, floorY };
});
console.log('pool:', JSON.stringify(pool));
if (pool) {
  await settled();
  // Read it once the water has stopped moving rather than after a duration picked to be
  // long enough.
  await stable(`window.voxelcraft.waterSurface(${pool.x}, ${pool.z})`);
  await evaluate((r) => {
    const g = window.voxelcraft.game;
    g.player.teleportTo(r.x + 0.5 - 6, r.surface + 3, r.z + 0.5);
    g.player.yaw = -Math.PI / 2;
    g.player.pitch = -0.3;
  }, pool);
  await frame();
  await shot('15-pool');
  console.log('pool depth:', await evaluate((r) => window.voxelcraft.waterDepth(r.x, r.surface, r.z), pool));

  // Build a stone aqueduct out of the pool and check the water runs its length.
  const works = await evaluate((r) => {
    const g = window.voxelcraft.game;
    const AIR = 0;
    const STONE = 1;
    // Out of the basin, across whatever ground lies that way.
    const [dx, dz] = [1, 0];
    const LENGTH = 12;
    const floorY = r.surface - 2;

    for (let i = 1; i <= LENGTH + 1; i++) {
      const x = r.x + dx * i;
      const z = r.z + dz * i;
      // Clear the trough and everything above it.
      for (let y = floorY; y <= r.surface + 4; y++) g.world.setBlock(x, y, z, AIR);
      g.world.setBlock(x, floorY, z, STONE);
      // Walls on both sides, and a dam at the far end.
      for (const [sx, sz] of [[dz, dx], [-dz, -dx]]) {
        for (let y = floorY; y <= r.surface; y++) g.world.setBlock(x + sx, y, z + sz, STONE);
      }
      if (i === LENGTH + 1) {
        for (let y = floorY; y <= r.surface; y++) g.world.setBlock(x, y, z, STONE);
      }
    }
    return {
      dx,
      dz,
      gate: [r.x + dx * 6, r.z + dz * 6],
      far: [r.x + dx * LENGTH, r.z + dz * LENGTH],
      floorY,
      surface: r.surface,
    };
  }, pool);
  console.log('aqueduct:', JSON.stringify(works));

  if (works) {
    const farWater = () =>
      evaluate((w) => window.voxelcraft.waterAt(w.far[0], w.floorY + 1, w.far[1]), works);
    // Wait for the far end to stop changing rather than for a duration long enough to be
    // sure: the depth that gets logged is the settled one either way, and the run stops
    // waiting the moment the water is done.
    const farLevel = `window.voxelcraft.waterAt(${works.far[0]}, ${works.floorY + 1}, ${works.far[1]})`;
    await advance(`${farLevel} > 0`);
    console.log('water reached the far end:', await farWater());
    await evaluate((w) => {
      const g = window.voxelcraft.game;
      g.player.teleportTo(w.far[0] + 0.5 - w.dx * 3, w.surface + 3, w.far[1] + 0.5 - w.dz * 3);
      g.player.yaw = Math.atan2(-w.dx, -w.dz);
      g.player.pitch = -0.5;
    }, works);
    await frame();
    await shot('16-aqueduct');

    // Drop a gate across the aqueduct and empty the far half.
    await evaluate((w) => {
      const g = window.voxelcraft.game;
      for (let y = w.floorY; y <= w.surface; y++) g.world.setBlock(w.gate[0], y, w.gate[1], 57);
      for (let i = 7; i <= 12; i++) {
        const x = w.far[0] - w.dx * (12 - i);
        const z = w.far[1] - w.dz * (12 - i);
        for (let y = w.floorY + 1; y <= w.surface; y++) g.world.setBlock(x, y, z, 0);
      }
    }, works);
    await advance(`${farLevel} === 0`);
    console.log('with the gate shut:', await farWater());
    await shot('17-gate-closed');

    await evaluate((w) => {
      const g = window.voxelcraft.game;
      for (let y = w.floorY; y <= w.surface; y++) g.world.setBlock(w.gate[0], y, w.gate[1], 58);
    }, works);
    await advance(`${farLevel} > 0`);
    console.log('with the gate open:', await farWater());
    await shot('18-gate-open');

    // A stack of pumps lifts water out of the aqueduct.
    const pumped = await evaluate((w) => {
      const g = window.voxelcraft.game;
      const x = w.far[0] + w.dz;
      const z = w.far[1] + w.dx;
      for (let y = w.floorY; y < w.surface + 8; y++) g.world.setBlock(x, y, z, 0);
      g.world.setBlock(x, w.floorY, z, 9);
      g.world.setBlock(x, w.floorY + 1, z, 55);
      g.world.setBlock(x, w.floorY + 3, z, 55);
      return { x, z, base: w.floorY };
    }, works);
    // Water reaching the top of the stack is the claim: it cannot have got there without
    // coming through the stage below it.
    await advance(`window.voxelcraft.waterAt(${pumped.x}, ${pumped.base + 4}, ${pumped.z}) > 0`);
    console.log('pump lifted water to:', JSON.stringify(await evaluate((p) => ({
      firstStage: window.voxelcraft.waterAt(p.x, p.base + 2, p.z),
      secondStage: window.voxelcraft.waterAt(p.x, p.base + 4, p.z),
    }), pumped)));
  }

  // Dive in and watch the breath meter drop. The channel has been drawing on the basin
  // for a while by now, so fill it again rather than diving into what is left.
  await evaluate((r) => {
    const g = window.voxelcraft.game;
    window.voxelcraft.heal();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let y = r.floorY; y <= r.surface; y++) g.world.setBlock(r.x + dx, y, r.z + dz, 9);
      }
    }
    g.player.teleportTo(r.x + 0.5, r.surface - 3, r.z + 0.5);
  }, pool);
  // Under water the breath meter is the thing being watched, so watch it.
  await until(() => window.voxelcraft.player.air < 9, null, 30000);
  console.log('breath:', JSON.stringify(await evaluate(() => ({
    air: Math.round(window.voxelcraft.player.air * 10) / 10,
    submerged: window.voxelcraft.player.submerged,
  }))));
  await shot('19-underwater');
  await evaluate(() => window.voxelcraft.heal());
}

// --- crafting table UI -------------------------------------------------------
await evaluate(() => {
  window.voxelcraft.heal();
  window.voxelcraft.give('oak_planks', 12);
  window.voxelcraft.give('stick', 6);
  window.voxelcraft.give('iron_ingot', 5);
  window.voxelcraft.openScreen('crafting');
});
await until(() => window.voxelcraft.game.screens.kind === 'crafting');

// One click on the recipe row is the whole interaction now.
await page.fill('.recipe-search', 'ツルハシ');
const woodPickaxeRow = page.locator('.recipe-row', { hasText: '木のツルハシ' }).first();
await woodPickaxeRow.waitFor({ timeout: 15000 });
await shot('09-crafting');
const pickaxesBefore = await evaluate(() => window.voxelcraft.player.inventory.count('wooden_pickaxe'));
await woodPickaxeRow.click();
await until((n) => window.voxelcraft.player.inventory.count('wooden_pickaxe') > n, pickaxesBefore);
const crafted = await evaluate(() => window.voxelcraft.player.inventory.count('wooden_pickaxe'));
const stillLocked = await page.locator('.recipe-row.locked', { hasText: 'ダイヤのツルハシ' }).count();
console.log('crafted wooden pickaxes:', crafted, '/ diamond pickaxe row locked:', stillLocked);
await closeScreen();

// --- position readout, the warp box and the cursor ---------------------------
// The right mouse button is a game control, so the browser menu must stay away even
// when the click lands on a screen that opened under the cursor.
await evaluate(() => window.voxelcraft.openScreen('crafting'));
await until(() => window.voxelcraft.game.screens.kind === 'crafting');
const contextMenuBlocked = await evaluate(() => {
  const layer = document.querySelector('.screen-layer');
  const node = layer?.firstElementChild ?? layer ?? document.body;
  return !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
});
await page.keyboard.press('Escape');
await until(() => document.body.classList.contains('screen-open') === false);
console.log(
  'context menu blocked:', contextMenuBlocked,
  '/ screen closed:', await evaluate(() => document.body.classList.contains('screen-open') === false),
);

console.log('coords panel:', JSON.stringify((await page.locator('.coords-position').textContent())?.trim()));
await page.keyboard.press('KeyG');
await page.locator('.warp-input').waitFor({ timeout: 10000 });
await shot('20-warp');
const warpTarget = await evaluate(() => {
  const here = window.voxelcraft.position();
  return { x: Math.round(here.x) + 60, z: Math.round(here.z) - 40 };
});
await page.fill('.warp-input', `${warpTarget.x} ${warpTarget.z}`);
await page.keyboard.press('Enter');
await until((t) => Math.abs(window.voxelcraft.position().x - t.x) < 2, warpTarget);
console.log(
  'asked for:', JSON.stringify(warpTarget),
  'landed on:', JSON.stringify(await evaluate(() => window.voxelcraft.position())),
  '/ box closed:', await evaluate(() => document.querySelector('.warp-dialog').style.display === 'none'),
);

// --- water ------------------------------------------------------------------
const shore = await evaluate(() => {
  const g = window.voxelcraft.game;
  for (let r = 20; r < 400; r += 8) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const z = Math.round(g.player.z + Math.sin(a) * r);
      if (g.generator.height(x, z) < 42) {
        window.voxelcraft.teleport(x, z);
        g.player.pitch = -0.2;
        return { x, z };
      }
    }
  }
  return null;
});
console.log('shore:', JSON.stringify(shore));
await settled();
// Landing in the sea is the point of this section, so wait for it rather than for a
// duration that is usually long enough for the player to sink into it.
await until(() => window.voxelcraft.player.inWater === true, null, 30000).catch(() => {});
await frame();
await shot('11-water');
console.log('in water:', await evaluate(() => window.voxelcraft.player.inWater));

// --- swimming back out ------------------------------------------------------
// Drop the player into the sea and swim towards the shore: they have to end up
// standing on dry land rather than bobbing against the bank forever.
const swim = await evaluate(() => {
  const g = window.voxelcraft.game;
  // Face the nearest dry ground.
  let best = null;
  for (let r = 3; r < 40 && !best; r += 1) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const z = Math.round(g.player.z + Math.sin(a) * r);
      const top = g.world.heightAt(x, z);
      if (top > 46 && g.world.getWater(x, top + 1, z) === 0) { best = { x, z, top, r }; break; }
    }
  }
  if (!best) return null;
  g.player.yaw = Math.atan2(-(best.x - g.player.x), -(best.z - g.player.z));
  g.player.pitch = 0;
  return { ...best, from: [Math.round(g.player.x), Math.round(g.player.y), Math.round(g.player.z)] };
});
if (swim) {
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await page.waitForFunction(
    () => {
      const p = window.voxelcraft?.player;
      return p ? p.onGround && !p.inWater && p.y > 47 : false;
    },
    null,
    { timeout: 40000 },
  ).catch(() => {});
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  await frame();
  const ashore = await evaluate(() => {
    const p = window.voxelcraft.player;
    return { y: +p.y.toFixed(1), onGround: p.onGround, inWater: p.inWater };
  });
  console.log('swam to shore:', JSON.stringify(swim), '->', JSON.stringify(ashore));
  await shot('11b-ashore');
}

// --- death and respawn -------------------------------------------------------
await evaluate(() => {
  window.voxelcraft.player.health = 0;
});
await page.locator('.menu.death').waitFor({ timeout: 15000 });
await frame();
await shot('12-death');
const deathVisible = await page.locator('.menu.death').isVisible();
await page.click('.menu.death .menu-button');
await until(() => window.voxelcraft.player.isDead === false);
// Respawning far from spawn lands on a chunk that has to be generated first. Give it a
// moment and check the player is standing on it with their health intact: being handed
// back your life and a six point fall is not a respawn.
await page.waitForFunction(() => window.voxelcraft.player.onGround === true, null, { timeout: 30000 })
  .catch(() => {});
const revived = await evaluate(() => {
  const p = window.voxelcraft.player;
  const g = window.voxelcraft.game;
  return {
    health: p.health, dead: p.isDead, onGround: p.onGround,
    // Standing on the surface, not hanging above where the generator guessed it was.
    aboveGround: +(p.y - (g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1)).toFixed(2),
  };
});
console.log('death screen:', deathVisible, 'after respawn:', JSON.stringify(revived));

// --- pause menu --------------------------------------------------------------
await page.keyboard.press('Escape');
await page.locator('.menu-button:has-text("ゲームに戻る")').waitFor({ timeout: 10000 });
const paused = await page.locator('.menu-button:has-text("ゲームに戻る")').isVisible();
await shot('13-pause');
// Drag the render distance slider down and check it takes effect.
await page.locator('.setting-row:has-text("描画距離") .slider').fill('5');
await until(() => window.voxelcraft.game.renderDistance === 5);
console.log('render distance:', await evaluate(() => window.voxelcraft.game.renderDistance));

// Difficulty is picked here, so it is clicked here rather than set from the console.
await page.click('.choice:has-text("平和")');
await until(() => window.voxelcraft.difficulty().current === 'peaceful');
// Read the toast first: it is gone 2.4 seconds after the click, which a screenshot on
// the software renderer is easily slow enough to outlast.
const difficultyToast = await page.locator('.toast').count()
  ? await page.locator('.toast').last().innerText()
  : null;
console.log('difficulty picked:', JSON.stringify({
  toast: difficultyToast,
  note: await page.locator('.setting-note.difficulty-note').innerText(),
  rules: await evaluate(() => window.voxelcraft.difficulty()),
}));
console.log('game speed row:', JSON.stringify({
  choices: await page.locator('.choice-row').last().locator('.choice').allInnerTexts(),
  selected: await page.locator('.choice-row').last().locator('.choice.selected').innerText(),
  note: await page.locator('.setting-note.speed-note').innerText(),
}));
await shot('13b-difficulty');
await page.click('.menu-button:has-text("ゲームに戻る")');
await until(() => window.voxelcraft.game.paused === false);

// 平和 empties the world of hostiles and takes their teeth out: a zombie standing on the
// player's toes costs nothing.
const peaceful = await evaluate(() => {
  const g = window.voxelcraft.game;
  window.voxelcraft.setTime(0.8);
  g.player.health = 8;
  for (let i = 0; i < 3; i++) window.voxelcraft.spawnMob('zombie', 1.2);
  return { spawned: window.voxelcraft.hostiles(), health: g.player.health };
});
// Both halves of the claim: the zombies go, and the player mends rather than merely
// failing to be hurt.
await until((h) => window.voxelcraft.hostiles() === 0 && window.voxelcraft.game.player.health > h,
  peaceful.health, 20000);
console.log('peaceful:', JSON.stringify({
  zombiesSpawned: peaceful.spawned,
  zombiesLeft: await evaluate(() => window.voxelcraft.hostiles()),
  healthBefore: peaceful.health,
  // Not merely undamaged: 平和 mends the player while they stand there.
  healthAfter: await evaluate(() => Math.round(window.voxelcraft.game.player.health * 10) / 10),
}));

// Hostiles come back when the setting does, which is the other half of the claim. Put it
// back through the menu rather than the console: the setting is stored, and the reload
// section further down would otherwise wake up on 平和 without saying so.
await page.keyboard.press('Escape');
await page.locator('.choice:has-text("ふつう")').waitFor({ timeout: 10000 });
await page.click('.choice:has-text("ふつう")');
await until(() => window.voxelcraft.difficulty().current === 'normal');
await page.click('.menu-button:has-text("ゲームに戻る")');
await until(() => window.voxelcraft.game.paused === false);
await evaluate(() => window.voxelcraft.spawnMob('zombie', 3));
await until(() => window.voxelcraft.mobs().at(-1)?.onGround === true, null, 10000).catch(() => {});
console.log('back to ふつう:', JSON.stringify({
  difficulty: (await evaluate(() => window.voxelcraft.difficulty())).current,
  hostiles: await evaluate(() => window.voxelcraft.hostiles()),
}));
await evaluate(() => window.voxelcraft.heal());
console.log('pause menu:', paused, 'resumed:', await evaluate(() => window.voxelcraft.game.paused === false));

// --- save, reload and continue ----------------------------------------------
const before = await evaluate(() => {
  const g = window.voxelcraft.game;
  g.save(false);
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch') };
});
const economyBefore = await evaluate(() => ({
  villages: window.voxelcraft.villages().filter((v) => v.discovered).length,
  stages: window.voxelcraft.villages().map((v) => v.stage).join(','),
  routes: window.voxelcraft.routes().length,
  quest: window.voxelcraft.quest().step,
  milestone: window.voxelcraft.milestones().index,
  earned: window.voxelcraft.earnings(),
}));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.menu-button:has-text("続きから")').waitFor({ timeout: 30000 });
await page.click('.menu-button:has-text("続きから")');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await settled();
const after = await evaluate(() => {
  const g = window.voxelcraft.game;
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch'), seed: g.world.seed };
});
console.log('saved:', JSON.stringify(before), 'loaded:', JSON.stringify(after));
// The road lives in the block edits and the villages in their own save block, so nothing
// here is waited for: what the save restored is restored by the time the world is ready.
// The routes come back unsurveyed on purpose — a village more than a few hundred blocks
// away is still only a saved record, and re-surveying it needs the player to walk back
// into range — which is what the `connected` and `grade` columns below report.
const economyAfter = await evaluate(() => ({
  villages: window.voxelcraft.villages().filter((v) => v.discovered).length,
  stages: window.voxelcraft.villages().map((v) => v.stage).join(','),
  routes: window.voxelcraft.routes().length,
  quest: window.voxelcraft.quest().step,
  milestone: window.voxelcraft.milestones().index,
  earned: window.voxelcraft.earnings(),
  connected: window.voxelcraft.routes().filter((r) => r.connected).length,
  grade: window.voxelcraft.routes().map((r) => r.grade).join(','),
}));
console.log('economy saved:', JSON.stringify(economyBefore), 'loaded:', JSON.stringify(economyAfter));
await shot('10-reloaded');

// --- the pause screen names the seed so a world can be found again ----------
await page.keyboard.press('Escape');
await page.locator('.seed-label').waitFor({ timeout: 10000 });
console.log('pause seed label:', (await page.locator('.seed-label').textContent())?.trim());
await page.click('.menu-button:has-text("タイトルへ戻る")');
await page.locator('.menu-button:has-text("検証用ワールド")').waitFor({ timeout: 20000 });

// --- a seed in the URL opens that exact world without touching the title ----
await page.goto(`${url}?seed=second`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.keyboard.press('F3');
await until(() => (document.querySelector('.debug')?.textContent ?? '').length > 0);
await frame();
await shot('14-second-world');
console.log('world from the URL:', JSON.stringify(await debugText()));

// A village develops here, in a world nothing else in this run is standing on: growing one
// raises houses, levels their plots and lays their doorsteps, and every one of those
// changes the ground a road would be laid across.
await settled(90000);
console.log('village to grow:', JSON.stringify(await evaluate(() => window.voxelcraft.gotoVillage())));
await settled(90000);
// --- the village develops ----------------------------------------------------
// Two things go wrong when a village builds itself out into the ring where its plateau
// stops being flat: a house stands over a hole on the downhill side, and a house raised
// over somebody's road ends up with a road-shaped gap through its walls and floor.
const developed = await evaluate(() => {
  const g = window.voxelcraft.game;
  const here = window.voxelcraft.village();
  // A road straight through the middle of a plot the village is about to fill, laid the
  // way a shovel lays one.
  const before = window.voxelcraft.growHere(1);
  // A plot the village has not built on yet, so the road is there first.
  const plot = before.next[0];
  const lane = plot.z0 + (plot.d >> 1);
  const road = [];
  for (let x = plot.x0 - 10; x < plot.x0 + plot.w + 10; x++) {
    const y = g.world.heightAt(x, lane);
    if (y < 0) continue;
    g.world.setBlock(x, y, lane, 7);
    for (let h = 1; h <= 2; h++) g.world.setBlock(x, y + h, lane, 0);
    road.push([x, y, lane]);
  }
  const after = window.voxelcraft.growHere(4);

  // A road twenty-odd blocks long crosses more than the one plot it was aimed at, so
  // every plot it touches is one the village should have left alone.
  const paved = new Set(road.map(([x, , z]) => `${x},${z}`));
  const crossed = [];
  const clear = [];
  for (const p of after.plots) {
    let hit = false;
    for (let x = p.x0; x < p.x0 + p.w && !hit; x++) {
      for (let z = p.z0; z < p.z0 + p.d; z++) if (paved.has(`${x},${z}`)) { hit = true; break; }
    }
    (hit ? crossed : clear).push(p);
  }

  // Nothing may stand on a plot the road runs through...
  let onTheRoadsPlots = 0;
  const floor = here.baseY + 1;
  for (const p of crossed) {
    for (let x = p.x0; x < p.x0 + p.w; x++) {
      for (let z = p.z0; z < p.z0 + p.d; z++) {
        for (let y = floor; y <= floor + 4; y++) if (g.world.getBlock(x, y, z) !== 0) onTheRoadsPlots++;
      }
    }
  }
  // ...and the road itself is untouched.
  let roadLost = 0;
  for (const [x, y, z] of road) if (g.world.getBlock(x, y, z) !== 7) roadLost++;

  // Every plot it built has a floor, ground under the floor, and something standing on
  // it: a check that only ever looks for holes would pass a village that built nothing.
  let floating = 0;
  let noFloor = 0;
  let checked = 0;
  let raised = 0;
  for (const p of clear) {
    for (let x = p.x0; x < p.x0 + p.w; x++) {
      for (let z = p.z0; z < p.z0 + p.d; z++) {
        for (let y = floor; y <= floor + 3; y++) if (g.world.getBlock(x, y, z) !== 0) raised++;
      }
    }
  }
  for (const p of clear) {
    for (let x = p.x0; x < p.x0 + p.w; x++) {
      for (let z = p.z0; z < p.z0 + p.d; z++) {
        if (g.world.heightAt(x, z) < 0) continue;
        checked++;
        if (g.world.getBlock(x, here.baseY, z) === 0) noFloor++;
        if (g.world.getBlock(x, here.baseY - 1, z) === 0) floating++;
      }
    }
  }
  return { village: after.name, stage: after.stage, plots: after.plots.length, crossed: crossed.length, road: road.length, roadLost, onTheRoadsPlots, checked, raised, noFloor, floating };
});
console.log('village grew:', JSON.stringify(developed));
if (developed.road === 0) throw new Error('no road was laid across the plot');
if (developed.roadLost > 0) throw new Error(`village growth took ${developed.roadLost} blocks of road away`);
if (developed.crossed === 0) throw new Error('the road crossed none of the plots the village wanted');
if (developed.onTheRoadsPlots > 0) throw new Error(`village growth built ${developed.onTheRoadsPlots} blocks on the road's plots`);
if (developed.checked === 0) throw new Error('no developed plot was loaded to check');
if (developed.raised < 50) throw new Error(`the village put up almost nothing: ${developed.raised} blocks`);
if (developed.noFloor > 0) throw new Error(`${developed.noFloor} cells of a developed house have no floor`);
if (developed.floating > 0) throw new Error(`${developed.floating} cells of a developed house stand over a hole`);
await shot('15-developed');

// --- the town inside the village ---------------------------------------------
// The village above is now a 都市, which is the only rank that has one of each use. What
// a Vitest run cannot check is the half of this that is a view: whether a villager is
// actually put on the street to walk the commute the town is simulating.
const town = await evaluate(() => window.voxelcraft.town());
console.log('town:', JSON.stringify({
  village: town?.village, people: town?.people, buildings: town?.buildings.length,
  uses: [...new Set((town?.buildings ?? []).map((b) => b.use))],
}));
if (!town) throw new Error('a grown village with no town in it');
const uses = new Set(town.buildings.map((b) => b.use));
for (const use of ['residential', 'commercial', 'industrial']) {
  if (!uses.has(use)) throw new Error(`a 都市 with no ${use} building`);
}
if (town.people <= 0) throw new Error('a town with nobody in it');
if (town.short.length === 0) throw new Error('a town that wants nothing');

// A town starts hungry and therefore slow, so the world clock is wound on rather than
// waited out. Speed multiplies steps, not dt, so this is the same simulation.
await evaluate(() => window.voxelcraft.setSpeed(16));
await advance(() => window.voxelcraft.commutes().length > 0);
// Moving, and drawn: the number advancing is the simulation, the villager is the view,
// and this is the one place both can be seen to be true at once.
await advance(() => window.voxelcraft.commutes().some((c) => c.t > 0.05 && c.t < 0.95), { chunk: 1 });
await advance(() => window.voxelcraft.commutes().some((c) => c.drawn), { chunk: 1 });
// Somebody arrives, and arriving is what makes a building want something. A shop nobody
// walks into is the failure this is here to catch: it looks exactly like a working one.
await advance(() => window.voxelcraft.town().buildings.some((b) => b.staff > 0));
const commuting = await evaluate(() => ({
  commutes: window.voxelcraft.commutes(),
  staffed: window.voxelcraft.town().buildings.filter((b) => b.staff > 0)
    .map((b) => ({ label: b.label, use: b.use, staff: b.staff })),
}));
console.log('commuting:', JSON.stringify(commuting));
await evaluate(() => window.voxelcraft.setSpeed(1));
await frame();
await shot('15b-town');

// And the town is legible: the ledger grows a section for the place underfoot.
await page.keyboard.press('KeyL');
await until(() => document.querySelector('.ledger') !== null, null, 10000);
await frame();
await shot('15c-town-ledger');
const ledgerText = await page.locator('.ledger').textContent();
for (const word of ['の建物', '人口', '働いている人']) {
  if (!ledgerText.includes(word)) throw new Error(`the ledger has no ${word} in it`);
}
await closeScreen();

console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
await browser.close();
