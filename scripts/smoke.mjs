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
/** The tutorial's own route, looked up by its two villages. `routes()` is ordered by
 *  discovery, so a third village joining the network is enough to shuffle the indices. */
const QUEST_ROUTE = `(() => {
  const q = window.voxelcraft.quest();
  return window.voxelcraft.routes().find((r) =>
    (r.from === q.origin && r.to === q.target) || (r.from === q.target && r.to === q.origin)) ?? null;
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
const claimed = await evaluate(() => {
  const g = window.voxelcraft.game;
  const list = window.voxelcraft.buildings().list;
  const target = list.find((b) => !b.depot) ?? list[0];
  const dx = target.outside.x - target.door.x;
  const dz = target.outside.z - target.door.z;
  const x = target.door.x + dx * 4 + 0.5;
  const z = target.door.z + dz * 4 + 0.5;
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
// The pair is watched from the village timer, and surveyed once it is.
await until(`${QUEST_ROUTE}?.missing > 0`, null, 30000);
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
await until(() => window.voxelcraft.guide().dashed > 0 && window.voxelcraft.guide().beams >= 2);
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

// Lay the road. By hand this is a few hundred blocks, which is a walk, not a smoke test.
console.log('road blocks laid:', await evaluate(() => window.voxelcraft.buildRoad()));
await page.waitForFunction(`${QUEST_ROUTE}?.connected === true`, null, { timeout: 30000 });
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
  const route = g.transport.routes.find((r) => r.from === here.id || r.to === here.id);
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

// Every village wants particular goods, and a workshop cannot work without its input.
// Which pair of villages is worth joining follows from that, so it is worth showing.
console.log('demand:', JSON.stringify(await evaluate(() =>
  window.voxelcraft.villages().filter((v) => v.discovered).map((v) => ({
    name: v.name, rank: v.rank, kind: v.kind, makes: v.produces, from: v.input, needs: v.needs,
  })))));

// Repaving the same road: the route must actually get faster and carry more.
const dirtRoute = await evaluate(QUEST_ROUTE);
await evaluate(() => window.voxelcraft.buildRoad(undefined, undefined, 'stone_bricks'));
await page.waitForFunction(
  `(${QUEST_ROUTE}?.quality ?? 0) > ${dirtRoute.quality}`,
  null,
  { timeout: 30000 },
);
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
await until(() => {
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
await page.waitForFunction(`${QUEST_ROUTE}?.connected === false`, null, { timeout: 30000 });
console.log('one block dug out:', JSON.stringify({
  at: bite,
  route: await evaluate(QUEST_ROUTE),
}));
await evaluate((c) => window.voxelcraft.game.world.setBlock(c.x, c.y, c.z, c.was), bite);
await page.waitForFunction(`${QUEST_ROUTE}?.connected === true`, null, { timeout: 30000 });
console.log('and put back:', JSON.stringify(await evaluate(QUEST_ROUTE)));

// --- the road has to be walkable, not merely continuous ----------------------
// Two blocks of rise and a branch at head height are both roads the index used to call
// connected and a porter could not use — which is what "the porter teleports" was. Both
// have to break the route, and both have to say where.

/** Puts a block where the test wants one, waits for the route to fall apart, and reports
 *  what the game says about it. */
const breakAt = async (place) => {
  const at = await evaluate(place, bite);
  await page.waitForFunction(`${QUEST_ROUTE}?.connected === false`, null, { timeout: 30000 });
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
await page.waitForFunction(`${QUEST_ROUTE}?.connected === true`, null, { timeout: 30000 });

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
await page.waitForFunction(`${QUEST_ROUTE}?.connected === true`, null, { timeout: 30000 });
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
    if (picked.every((p) => Math.hypot(p.x - spot.x, p.z - spot.z) > 50)) picked.push(spot);
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
await page.waitForFunction(`${QUEST_ROUTE}?.vehicle === 'cart'`, null, { timeout: 60000 });
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
  await page.waitForFunction(`${QUEST_ROUTE}?.vehicle === 'porter'`, null, { timeout: 60000 });
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
  await page.waitForFunction(`${QUEST_ROUTE}?.vehicle === 'cart'`, null, { timeout: 60000 });
  console.log('widened back:', await evaluate(() => window.voxelcraft.routes()[0].vehicle));
}


// --- railing a road until a train runs --------------------------------------
// Pavement is speed and width is load; rail is both, and the last thing a line can be
// given. Every column rail and the cart becomes a train — and one column of dirt anywhere
// puts it back to the cart it had already earned, which is the demotion the panel has to
// be able to point at.
const byRoad = await evaluate(QUEST_ROUTE);
console.log('before railing:', JSON.stringify({ vehicle: byRoad.vehicle, load: byRoad.load }));
if (byRoad.vehicle === 'train') throw new Error('a road nobody railed is already a railway');
console.log('railed:', await evaluate(() => window.voxelcraft.buildRailway()));
await page.waitForFunction(`${QUEST_ROUTE}?.vehicle === 'train'`, null, { timeout: 60000 });
const byTrain = await evaluate(QUEST_ROUTE);
console.log('after railing:', JSON.stringify({
  vehicle: byTrain.vehicle, load: byTrain.load, grade: byTrain.grade, climb: byTrain.climb,
}));
// Railing re-lays the line, so the two loads are not quite the same road's. The exact
// multiplier is pinned in `transport.test.ts`; what matters here is that it plainly
// bought a great deal more than the cart did.
if (byTrain.load <= byRoad.load) {
  throw new Error(`a train should carry more than a cart: ${byRoad.load} -> ${byTrain.load}`);
}
console.log('linked panel with a train:', JSON.stringify(
  await page.locator('.route-row').first().innerText().catch(() => null)));
await shot('07y4-railway');

// One rail, out of the middle, and the train stops.
const unrailed = await evaluate(() => {
  const g = window.voxelcraft.game;
  const q = window.voxelcraft.quest();
  const a = g.villages.get(q.origin);
  const b = g.villages.get(q.target);
  const mx = Math.round((a.x + b.x) / 2);
  const mz = Math.round((a.z + b.z) / 2);
  const near = window.voxelcraft.roadColumnsNear(mx, mz, 10);
  near.sort((p, r) => Math.hypot(p.x - mx, p.z - mz) - Math.hypot(r.x - mx, r.z - mz));
  // 49 is the dirt path: still a road, so the line stays joined and merely demotes.
  const taken = [];
  for (const c of near) {
    if (g.world.getBlock(c.x, c.y, c.z) !== 59) continue;
    taken.push({ x: c.x, y: c.y, z: c.z, was: 59 });
    g.world.setBlock(c.x, c.y, c.z, 49);
    if (taken.length >= 3) break;
  }
  return taken.length > 0 ? { taken } : null;
});
if (!unrailed) console.log('one rail out of the line: NO RAIL COLUMN FOUND');
if (unrailed) {
  await page.waitForFunction(`${QUEST_ROUTE}?.vehicle !== 'train'`, null, { timeout: 60000 });
  const broken = await evaluate(QUEST_ROUTE);
  console.log('one rail turned back to dirt:', JSON.stringify({
    took: unrailed.taken.length,
    vehicle: broken.vehicle,
    connected: broken.connected,
    pinch: broken.railPinch,
    note: await page.locator('.route-note.rail').first().innerText().catch(() => null),
  }));
  if (!broken.connected) throw new Error('a line short of one rail should still carry goods');
  if (!broken.railPinch) throw new Error('a line short of one rail should say where');
  await evaluate((list) => {
    for (const c of list) window.voxelcraft.game.world.setBlock(c.x, c.y, c.z, c.was);
  }, unrailed.taken);
  await page.waitForFunction(`${QUEST_ROUTE}?.vehicle === 'train'`, null, { timeout: 60000 });
  console.log('railed back:', await evaluate(QUEST_ROUTE).then((r) => r.vehicle));
}


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

// --- the other railway: curves, not blocks -----------------------------------
// A rail block is a road surface, so a line of them turns ninety degrees at a time. The
// track tool is the separate answer: click a start, click an end, and the game works out
// a curve between them that owes nothing to the grid. What is checked here is the whole
// of the claim - that it curves, that a second run joins the first without a kink, that
// it refuses the shapes it says it refuses, that the mouse really drives it, and that
// track hanging over a drop grows legs.
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
  g.player.flying = false;
  const x = Math.round(g.player.x);
  const z = Math.round(g.player.z);
  g.player.teleportTo(x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5);
  g.player.yaw = 0;
  // Shallow, so the crosshair lands a dozen blocks out rather than at their feet.
  g.player.pitch = -0.13;
});
await settled(60000);
let placed = await rightClick();
for (let attempt = 1; attempt < 5 && !placed.pending && placed.edges === 0; attempt++) placed = await rightClick();
if (!placed.pending) {
  throw new Error(`right clicking with the track tool did not leave a start down: ${JSON.stringify(placed)}`);
}
console.log('start placed by hand:', JSON.stringify(placed));
// Turning on the spot is how the curve gets chosen: the far end follows the head.
await evaluate(() => { window.voxelcraft.game.player.yaw = 0.5; });
await frame();
await frame();
const ghost = await evaluate(() => window.voxelcraft.trackView().ghost);
console.log('the ghost while turning:', JSON.stringify(ghost));
if (ghost === 'none') throw new Error('a start is down and nothing is being previewed');
const railsBefore = await evaluate(() => window.voxelcraft.game.player.inventory.count('rail'));
let finished = await rightClick();
for (let attempt = 1; attempt < 5 && finished.edges === 0; attempt++) finished = await rightClick();
if (finished.edges === 0) throw new Error(`the second right click did not lay the curve: ${JSON.stringify(finished)}`);
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
  for (let d = 8; d < 20; d++) {
    for (let w = -3; w <= 3; w++) {
      for (let h = 0; h < 5; h++) g.world.setBlock(x + w, y - 1 - h, z - d, 0);
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
  const route = g.transport.find(q.origin, q.target);
  return {
    fromDoor: route.fromDoor,
    toDoor: route.toDoor,
    startsAtDoor: JSON.stringify(route.waypoints[0]) === JSON.stringify(route.fromDoor),
    endsAtDoor:
      JSON.stringify(route.waypoints[route.waypoints.length - 1]) === JSON.stringify(route.toDoor),
  };
});
console.log('route ends:', JSON.stringify(ends));
if (!ends.startsAtDoor || !ends.endsAtDoor) throw new Error('a route does not run door to door');

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
await page.waitForFunction(
  `(${QUEST_ROUTE}?.delivered ?? 0) > ${beforeWatching}`,
  null,
  { timeout: 180000 },
);
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
await until(() => window.voxelcraft.quest().step === 'done', null, 30000);
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
if (!survived?.connected) throw new Error('the village grew over its own road');
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
  await until(() => window.voxelcraft.mobs().some((m) => m.kind === 'porter'), null, 20000)
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
  minutes: window.voxelcraft.game.weatherSeconds,
  delivered: window.voxelcraft.routes().reduce((sum, r) => sum + r.delivered, 0),
}));
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
  slow: +(slowEnd.minutes - slowStart.minutes).toFixed(1),
  fast: +(fastEnd.minutes - fastStart.minutes).toFixed(1),
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
// And it is railed down the middle of all but its first stretch, with the rails for the
// rest handed over — the half-built railway is the sample's second lesson, and a player
// who is given neither the gap nor the rails to close it is given only the first.
const sampleRail = await evaluate(() => {
  const surfaces = window.voxelcraft.game.roads.surfaces;
  let rail = 0;
  for (const block of surfaces.values()) if (block === 59) rail++;
  return { rail, columns: surfaces.size, held: window.voxelcraft.game.player.inventory.count('rail') };
});
console.log('sample railway:', JSON.stringify(sampleRail));
if (sampleRail.rail < 100) {
  throw new Error(`the sample road carries no railway: ${JSON.stringify(sampleRail)}`);
}
if (sampleRail.held < 60) {
  throw new Error(`the sample world handed over too few rails: ${JSON.stringify(sampleRail)}`);
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

// --- rivers, channels and floodgates -----------------------------------------
const river = await evaluate(() => {
  window.voxelcraft.heal();
  return window.voxelcraft.gotoRiver();
});
console.log('river:', JSON.stringify(river));
if (river) {
  // The water surface is a fraction of a block; the block building below wants whole
  // cells, so work from the topmost cell the water reaches.
  river.surface = Math.floor(river.surface);
  await settled();
  // The river is still filling the chunks that just appeared; read it once it stops
  // moving rather than after a duration picked to be long enough.
  await stable(`window.voxelcraft.waterSurface(${river.x}, ${river.z})`);
  await evaluate(() => {
    window.voxelcraft.game.player.pitch = -0.3;
  });
  await frame();
  await shot('15-river');
  console.log('river depth:', await evaluate((r) => window.voxelcraft.waterDepth(r.x, r.surface, r.z), river));

  // --- the weather upstream, and how late it gets here ------------------------
  const calmLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  // A drought begins in the headwaters. Downstream is still in the calm season, which
  // is the whole point: the player has that long to fill a reservoir.
  await evaluate(() => window.voxelcraft.setWeatherSeconds(30 * 60));
  await until(() => window.voxelcraft.weather().upstream !== window.voxelcraft.weather().here);
  const warning = await evaluate(() => window.voxelcraft.weather());
  console.log('drought announced:', JSON.stringify(warning));
  console.log('forecast panel:', (await page.locator('.forecast').textContent())?.trim());
  await shot('15b-forecast');

  // Once it arrives the river drops, and the bank it leaves behind is dry.
  await evaluate(() => window.voxelcraft.setWeather('drought'));
  await stable(`window.voxelcraft.waterSurface(${river.x}, ${river.z})`);
  const dryLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  await shot('15c-drought');

  // Heavy rain lifts it again, without ever spilling over the bank.
  await evaluate(() => window.voxelcraft.setWeather('rain'));
  await stable(`window.voxelcraft.waterSurface(${river.x}, ${river.z})`);
  const wetLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  const spilled = await evaluate((r) => {
    const g = window.voxelcraft.game;
    let onLand = 0;
    for (let dx = -14; dx <= 14; dx++) {
      for (let dz = -14; dz <= 14; dz++) {
        const x = r.x + dx;
        const z = r.z + dz;
        for (let y = 40; y < 70; y++) {
          if (g.world.getWater(x, y, z) <= 0) continue;
          if (g.world.getWater(x, y + 1, z) > 0) continue;
          // Water sitting on top of solid ground with nothing under it to drain into.
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const solid = g.world.getBlock(x + ox, y, z + oz);
            if (solid !== 0 && solid !== 9) continue;
            if (g.world.getWater(x + ox, y, z + oz) > 0) continue;
            if (g.world.getWater(x + ox, y - 1, z + oz) <= 0) onLand++;
          }
        }
      }
    }
    return onLand;
  }, river);
  await shot('15d-rain');

  // And the calm season puts it back exactly where the generator had it.
  await evaluate(() => window.voxelcraft.setWeather('normal'));
  await stable(`window.voxelcraft.waterSurface(${river.x}, ${river.z})`);
  const backLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  console.log(
    'river level  calm:', calmLevel,
    ' drought:', dryLevel,
    ' rain:', wetLevel,
    ' calm again:', backLevel,
    ' water on land:', spilled,
  );

  // Build a stone aqueduct out of the river and check the water runs its length.
  const works = await evaluate((r) => {
    const g = window.voxelcraft.game;
    const AIR = 0;
    const STONE = 1;
    // Head away from the river, towards dry ground.
    let dir = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (window.voxelcraft.riverAt(r.x + dx * 12, r.z + dz * 12).strength < 0.05) {
        dir = [dx, dz];
        break;
      }
    }
    if (!dir) return null;
    const [dx, dz] = dir;
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
  }, river);
  console.log('aqueduct:', JSON.stringify(works));

  if (works) {
    const farWater = () =>
      evaluate((w) => window.voxelcraft.waterAt(w.far[0], w.floorY + 1, w.far[1]), works);
    // Wait for the far end to stop changing rather than for a duration long enough to be
    // sure: the depth that gets logged is the settled one either way, and the run stops
    // waiting the moment the water is done.
    const farLevel = `window.voxelcraft.waterAt(${works.far[0]}, ${works.floorY + 1}, ${works.far[1]})`;
    await until(`${farLevel} > 0`, null, 60000);
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
    await until(`${farLevel} === 0`, null, 60000);
    console.log('with the gate shut:', await farWater());
    await shot('17-gate-closed');

    await evaluate((w) => {
      const g = window.voxelcraft.game;
      for (let y = w.floorY; y <= w.surface; y++) g.world.setBlock(w.gate[0], y, w.gate[1], 58);
    }, works);
    await until(`${farLevel} > 0`, null, 60000);
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
    await until(`window.voxelcraft.waterAt(${pumped.x}, ${pumped.base + 4}, ${pumped.z}) > 0`, null, 60000);
    console.log('pump lifted water to:', JSON.stringify(await evaluate((p) => ({
      firstStage: window.voxelcraft.waterAt(p.x, p.base + 2, p.z),
      secondStage: window.voxelcraft.waterAt(p.x, p.base + 4, p.z),
    }), pumped)));
  }

  // Dive in and watch the breath meter drop.
  await evaluate((r) => {
    const g = window.voxelcraft.game;
    window.voxelcraft.heal();
    g.player.teleportTo(r.x + 0.5, r.surface - 3, r.z + 0.5);
  }, river);
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

console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
await browser.close();
