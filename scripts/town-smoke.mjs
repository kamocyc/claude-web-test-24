/**
 * Browser scenario: the town as a place people go to.
 *
 * Vitest can hold the plan of a building to its shape and the economy to its arithmetic.
 * What it cannot do is stand in the street. This grows one village until it rebuilds its
 * middle, then checks the three things that only exist once the world is running:
 *
 *   1. the buildings the town put up are really in the world, floors and all;
 *   2. the lift and the escalator inside one carry the player, without a key being held;
 *   3. somebody walks in to buy something, and what they buy comes off the shelf.
 *
 * Run the dev server first, then:
 *   node scripts/town-smoke.mjs [url] [outputDir]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'screenshots/town';
await mkdir(out, { recursive: true });

/** Block ids this script has to name. Kept here rather than imported: the page is the
 *  built game and this file is plain node with no bundler behind it. */
const ELEVATOR = 103;
const ESCALATOR_FIRST = 104;
const ESCALATOR_LAST = 107;

const launchOptions = {
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
};
if (process.env.PW_CHROMIUM) launchOptions.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    errors.push(`[console] ${message.text()}`);
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('.menu-button:has-text("検証用ワールド")').waitFor({ timeout: 30000 });
await page.click('.menu-button:has-text("検証用ワールド")');
await page.waitForFunction(() => window.voxelcraft?.isReady?.() === true, null, { timeout: 180000 });
await page.evaluate(() => {
  window.voxelcraft.game.setRenderDistance(10);
  window.voxelcraft.setTime(0.25);
  window.voxelcraft.toggleDayCycle();
});

const settle = async () => {
  await page.waitForFunction(() => window.voxelcraft.backlog() === 0, null, { timeout: 240000 });
  await page.waitForTimeout(1200);
};
const bare = () => page.addStyleTag({
  content: '.hud, .menu-layer, .toast, .compass, .minimap { display: none !important; }',
});
const shot = async (name) => {
  await bare();
  await page.screenshot({ path: `${out}/${name}.png` });
};

/** Stands the camera at a point, looking along a direction.
 *
 *  Healed on the way, because being flown around a world by the scruff of the neck is not
 *  something the game was built for: a warp that lands badly is a fall, and a dead player
 *  stops updating — which reads downstream as a lift that does not work. */
async function stand(x, y, z, dx, dz, pitch) {
  await page.evaluate((view) => {
    window.voxelcraft.heal();
    window.voxelcraft.warp(Math.round(view.x), Math.round(view.z), Math.round(view.y));
    const player = window.voxelcraft.player;
    player.flying = true;
    player.x = view.x; player.y = view.y; player.z = view.z;
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.yaw = Math.atan2(-view.dx, -view.dz);
    player.pitch = view.pitch;
  }, { x, y, z, dx, dz, pitch });
  await settle();
}

/** Winds the world on until a condition holds, the way the main smoke run does. */
async function advance(condition, seconds = 600, chunk = 4) {
  for (let spent = 0; spent <= seconds; spent += chunk) {
    if (await page.evaluate(condition)) return spent;
    await page.evaluate((n) => window.voxelcraft.fastForward(n), chunk);
  }
  if (await page.evaluate(condition)) return seconds;
  throw new Error(`nothing came of ${seconds}s of world: ${String(condition).slice(0, 140)}`);
}

const village = await page.evaluate(() => window.voxelcraft.gotoVillage());
if (!village) throw new Error('no village to grow');
console.log('village at', JSON.stringify(village));
await settle();

// --- the town rebuilds its middle ---------------------------------------------
const grown = await page.evaluate(() => window.voxelcraft.growHere(6));
console.log('grown to stage', grown?.stage);
await settle();

const towers = await page.evaluate(() =>
  window.voxelcraft.buildings().list.filter((b) => b.role === 'tower'));
if (towers.length === 0) throw new Error('a town that grew past 町 and never rebuilt its middle');
const plots = new Set(towers.map((t) => `${t.x0},${t.z0}`));
console.log('towers:', plots.size, 'tenants:', towers.map((t) => t.label).join(', '));

// The economy re-lays a town out on the tick after it grows, so the world is wound on a
// little rather than read the instant the buildings appear.
await advance(() => window.voxelcraft.town().buildings.some((b) => b.use === 'office'), 60);
const uses = await page.evaluate(() => {
  const town = window.voxelcraft.town();
  return town.buildings.reduce((all, b) => ({ ...all, [b.use]: (all[b.use] ?? 0) + 1 }), {});
});
console.log('uses:', JSON.stringify(uses));
if (!uses.office) throw new Error('a rebuilt middle with no offices in it');
if (!uses.commercial) throw new Error('a rebuilt middle with no shop under them');

// Every building the town lists is really standing: a plan that is not written into the
// world is a town of addresses with nothing at them.
const unbuilt = await page.evaluate(() => {
  const world = window.voxelcraft.game.world;
  return window.voxelcraft.buildings().list.filter((h) => {
    let walls = 0;
    for (let x = h.x0; x < h.x0 + h.w; x++) {
      for (let z = h.z0; z < h.z0 + h.d; z++) {
        const edge = x === h.x0 || x === h.x0 + h.w - 1 || z === h.z0 || z === h.z0 + h.d - 1;
        if (edge && world.getBlock(x, h.door.y + 1, z) !== 0) walls++;
      }
    }
    return walls <= 8;
  }).map((h) => h.label);
});
if (unbuilt.length > 0) throw new Error(`buildings with nothing standing on them: ${unbuilt.join(', ')}`);
console.log('every building is standing');

const tower = towers[0];
const ground = tower.door.y;
const middle = { x: tower.x0 + 5.5, z: tower.z0 + 5.5 };
const outward = { x: tower.outside.x - tower.door.x, z: tower.outside.z - tower.door.z };
await stand(
  middle.x + outward.x * 46, ground + 16, middle.z + outward.z * 46,
  -outward.x, -outward.z, 0.16,
);
await shot('tower-front');

// --- riding it ----------------------------------------------------------------
// Inside first, on the shop floor: everything below searches out from where the player
// is standing, and a lift is only findable from in the building it is in.
await stand(middle.x, ground, middle.z, -outward.x, -outward.z, 0.1);
await shot('tower-inside');

// The escalator, with nothing held down: a flight that only works while the player walks
// into it is a staircase with a texture on it.
const ride = await page.evaluate((arg) => {
  const player = window.voxelcraft.player;
  const world = window.voxelcraft.game.world;
  const tread = (x, y, z) => {
    const block = world.getBlock(x, y, z);
    return block >= arg.first && block <= arg.last;
  };
  // The lowest tread of the flight, searched over the building's own plot rather than
  // around the player: where the player happens to have landed is the one thing here
  // that is not decided by this script.
  let bottom = null;
  for (let y = arg.ground; y < arg.ground + 8; y++) {
    for (let x = arg.x0; x < arg.x0 + arg.w; x++) {
      for (let z = arg.z0; z < arg.z0 + arg.d; z++) {
        if (tread(x, y, z) && (!bottom || y < bottom.y)) bottom = { x, y, z };
      }
    }
  }
  if (!bottom) return { found: false };
  window.voxelcraft.heal();
  player.flying = false;
  player.x = bottom.x + 0.5; player.y = bottom.y + 1; player.z = bottom.z + 0.5;
  player.vx = 0; player.vy = 0; player.vz = 0;
  const from = player.y;
  const idle = {
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false,
  };
  // Where it got to every so often, so a flight that carried nobody anywhere says why.
  const trace = [];
  for (let frame = 0; frame < 300; frame++) {
    player.update(1 / 60, world, idle);
    if (frame % 40 === 0) {
      trace.push([+player.x.toFixed(2), +player.y.toFixed(2), +player.z.toFixed(2)]);
    }
  }
  return {
    found: true, from, to: player.y, bottom, trace,
    state: {
      health: player.health, flying: player.flying, inWater: player.inWater,
      boating: player.boating, ground: player.onGround, autoStep: player.autoStep,
    },
  };
}, {
  first: ESCALATOR_FIRST, last: ESCALATOR_LAST, ground,
  x0: tower.x0, z0: tower.z0, w: tower.w, d: tower.d,
});
if (!ride.found) throw new Error('a rebuilt building with no escalator in it');
if (ride.state.health <= 0) throw new Error('the rider died on the way to the escalator');
if (ride.to - ride.from < 3) {
  throw new Error(`the escalator carried nobody anywhere: ${JSON.stringify(ride)}`);
}
console.log('escalator carried the player', (ride.to - ride.from).toFixed(1), 'blocks up');
await settle();
await shot('tower-escalator');

// The lift: up while jump is held, and staying put when it is let go.
const lift = await page.evaluate((arg) => {
  const player = window.voxelcraft.player;
  const world = window.voxelcraft.game.world;
  let shaft = null;
  for (let x = arg.x0; x < arg.x0 + arg.w && !shaft; x++) {
    for (let z = arg.z0; z < arg.z0 + arg.d && !shaft; z++) {
      if (world.getBlock(x, arg.ground, z) === arg.car) shaft = { x, z };
    }
  }
  if (!shaft) return { found: false };
  window.voxelcraft.heal();
  player.flying = false;
  player.x = shaft.x + 0.5; player.y = arg.ground; player.z = shaft.z + 0.5;
  player.vx = 0; player.vy = 0; player.vz = 0;
  const idle = {
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false,
  };
  const from = player.y;
  for (let frame = 0; frame < 120; frame++) player.update(1 / 60, world, { ...idle, jump: true });
  const top = player.y;
  for (let frame = 0; frame < 60; frame++) player.update(1 / 60, world, idle);
  return { found: true, from, top, held: player.y };
}, { car: ELEVATOR, ground, x0: tower.x0, z0: tower.z0, w: tower.w, d: tower.d });
if (!lift.found) throw new Error('a rebuilt building with no lift in it');
if (lift.top - lift.from < 4) throw new Error(`the lift went nowhere: ${JSON.stringify(lift)}`);
if (Math.abs(lift.held - lift.top) > 0.5) {
  throw new Error(`the lift dropped its passenger: ${JSON.stringify(lift)}`);
}
console.log('lift carried the player', (lift.top - lift.from).toFixed(1), 'blocks up, and held them there');
await settle();
await shot('tower-lift');

// --- somebody goes shopping ----------------------------------------------------
// Deliveries first: a shop with nothing in it still gets customers, and this is about
// what happens to the stock when they arrive.
const delivered = await page.evaluate(() => {
  const wanted = new Set();
  for (const cell of window.voxelcraft.town().buildings) {
    for (const want of cell.wants) wanted.add(want.good);
  }
  let total = 0;
  for (const good of wanted) total += window.voxelcraft.deliverHere(good, 999);
  return total;
});
console.log('delivered', delivered, 'units into the town');
await page.evaluate(() => window.voxelcraft.setSpeed(16));
await advance(() => window.voxelcraft.commutes().some((c) => c.purpose === 'work'));
console.log('somebody is walking to work');
await advance(() => window.voxelcraft.town().buildings.some((b) => b.staff > 0));
console.log('a job is filled, so the shops are open');
await advance(() => window.voxelcraft.commutes().some((c) => c.purpose === 'shopping'));
console.log('somebody is walking to the shops');
await advance(() => window.voxelcraft.town().buildings.some((b) => b.customers > 0));
console.log('somebody is in a shop');
// And the shelf goes down. Watched for rather than read at the end: the town carries its
// own crop into its shops all the while, so a shop that sold something a minute ago can
// be back to full by the time anybody looks.
await advance(() => window.voxelcraft.town().buildings
  .some((b) => b.use === 'commercial' && b.wants.some((w) => w.held < 8)));
const shopping = await page.evaluate(() => {
  const town = window.voxelcraft.town();
  return town.buildings
    .filter((b) => b.use === 'commercial')
    .map((b) => ({
      label: b.label, staff: b.staff, customers: b.customers,
      stock: b.wants.map((w) => `${w.good} ${w.held}`).join(' '),
    }));
});
console.log('shops:', JSON.stringify(shopping));
if (!shopping.some((s) => s.customers > 0)) throw new Error('a town whose shops never had a customer');
await page.evaluate(() => window.voxelcraft.setSpeed(1));

// And it is legible: the ledger names the tenants floor by floor, with their custom.
await page.keyboard.press('KeyL');
await page.waitForFunction(() => document.querySelector('.ledger') !== null, null, { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/town-ledger.png` });
const ledger = await page.locator('.ledger').textContent();
for (const word of ['事務所', '商店', '客']) {
  if (!ledger.includes(word)) throw new Error(`the ledger never says ${word}`);
}
console.log('the ledger names the tenants and their custom');

if (errors.length > 0) console.log('errors:', JSON.stringify(errors.slice(0, 8), null, 2));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
