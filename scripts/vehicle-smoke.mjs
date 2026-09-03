/** What the three new ways of moving goods actually look like, and whether they work.
 *
 *  Run a Vite server, then:
 *    node scripts/vehicle-smoke.mjs [url] [outputDir]
 *
 *  Three scenarios, each from a fresh page on the verification world, because each one
 *  needs the world built a different way:
 *
 *  - **船**: a hull on real ocean water, floating at the waterline rather than sinking to
 *    the sea bed, and a leg between two stops on that water surveyed as a sea crossing.
 *  - **馬車**: a wide paved road between two towns with people waiting at both ends, which
 *    is the one thing that puts a carriage on a road instead of a cart.
 *  - **運転**: the controls of a train on a line, taken from the 路線表, driven with the
 *    W and S keys — the real ones, through the browser, because driving is a thing done
 *    with the hands and a script that called a function would not be testing that.
 *
 *  Every check throws on failure. The screenshots are the other half of the point: a
 *  vehicle that works and looks wrong is still wrong. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots/vehicles';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

/** A page on the verification world, ready to be poked. */
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.click('.menu-button:has-text("検証用ワールド")');
  await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const v = window.voxelcraft;
    v.setTime(0.3);
    // Nothing here is about surviving. A photographer who is teleported onto a roof and
    // falls off it is not a finding about vehicles.
    v.setDifficulty('peaceful');
    v.heal();
    v.game.hud.setClickPrompt(false);
  });
  return { page, errors };
}

const settled = (page) =>
  page.waitForFunction(() => window.voxelcraft.backlog() === 0, null, { timeout: 120000 });

/** Stands somewhere and looks at something. */
const look = (page, from, at, pitch = 0.12) =>
  page.evaluate(
    ([stand, target, tilt]) => {
      const g = window.voxelcraft.game;
      g.player.teleportTo(stand.x, stand.y, stand.z);
      g.player.yaw = Math.atan2(-(target.x - stand.x), -(target.z - stand.z));
      g.player.pitch = tilt;
      g.hud.setClickPrompt(false);
    },
    [from, at, pitch],
  );

function check(ok, what) {
  if (!ok) throw new Error(what);
}

// --- 船 -----------------------------------------------------------------------

{
  const { page, errors } = await open();
  // A coast the verification seed has: the water west of the northern towns.
  await page.evaluate(() => window.voxelcraft.warp(-276, -1168));
  await settled(page);
  const port = await page.evaluate(() => {
    const v = window.voxelcraft;
    for (let r = 0; r <= 160; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = -276 + Math.cos((a * Math.PI) / 8) * r;
        const z = -1168 + Math.sin((a * Math.PI) / 8) * r;
        const cell = v.harbour(x, z);
        if (cell) return { shore: { x: Math.round(x), z: Math.round(z) }, cell };
      }
    }
    return null;
  });
  check(port, 'no navigable water anywhere near the coast the fixture picked');
  const water = { x: port.cell.cx * 4, z: port.cell.cz * 4 };

  // A second port on the same water, far enough off to be a crossing.
  const far = await page.evaluate((from) => {
    const v = window.voxelcraft;
    for (let r = 120; r <= 400; r += 40) {
      for (let a = 0; a < 24; a++) {
        const x = from.x + Math.cos((a * Math.PI) / 12) * r;
        const z = from.z + Math.sin((a * Math.PI) / 12) * r;
        if (!v.harbour(x, z)) continue;
        const lane = v.seaLane(from.x, from.z, x, z);
        if (lane) return { at: { x: Math.round(x), z: Math.round(z) }, length: lane.length };
      }
    }
    return null;
  }, port.shore);
  check(far, 'no second port on the same water within 400 blocks');
  console.log(`海路 ${far.length}m: (${port.shore.x}, ${port.shore.z}) → (${far.at.x}, ${far.at.z})`);

  const sailed = await page.evaluate(([a, b]) => {
    const v = window.voxelcraft;
    const first = v.placeStop(a.x, a.z);
    const second = v.placeStop(b.x, b.z);
    v.makeLine([first.id, second.id], '海の便');
    v.fastForward(6);
    return v.routes().map((route) => ({ vehicle: route.vehicle, length: Math.round(route.length) }));
  }, [port.shore, far.at]);
  check(sailed.some((route) => route.vehicle === 'ship'), `the leg is not a sea crossing: ${JSON.stringify(sailed)}`);

  // The hull itself, on the water, with the camera on the shore looking out.
  const afloat = await page.evaluate((at) => {
    const v = window.voxelcraft;
    v.spawnHauler('ship', at.x, at.z, 5, 'oak_log', v.seaLevel);
    return v.haulers().filter((mob) => mob.kind === 'ship');
  }, water);
  check(afloat.length === 1, 'the ship did not appear');
  await look(
    page,
    { x: water.x + 14, y: 36, z: water.z + 12 },
    { x: water.x, y: 35, z: water.z },
    0.05,
  );
  await page.waitForTimeout(2500);
  const still = await page.evaluate(() => {
    const v = window.voxelcraft;
    const ship = v.haulers().find((mob) => mob.kind === 'ship');
    return { ship, waterline: v.seaLevel + 1 };
  });
  check(still.ship, 'the ship stopped existing');
  check(
    still.ship.y === still.waterline,
    `the ship is not floating: y ${still.ship.y}, waterline ${still.waterline}`,
  );
  await page.screenshot({ path: `${outDir}/ship.png` });
  check(errors.length === 0, `console errors: ${errors.join(' / ')}`);
  console.log('船: 喫水線に浮いて、海路の区間ができた');
  await page.close();
}

// --- 馬車 ---------------------------------------------------------------------

{
  const { page, errors } = await open();
  await page.evaluate(() => {
    const v = window.voxelcraft;
    v.gotoVillage();
    v.discoverNearby(2);
  });
  await settled(page);
  const road = await page.evaluate(() => {
    const v = window.voxelcraft;
    const all = v.villages();
    const a = all[0];
    const b = all
      .slice(1)
      .reduce((best, next) =>
        Math.hypot(next.x - a.x, next.z - a.z) < Math.hypot(best.x - a.x, best.z - a.z) ? next : best);
    // Three columns wide and paved: what a carriage needs, and what a cart needs.
    const blocks = v.pave(a.x, a.z, b.x, b.z, 'stone_bricks', 3);
    const first = v.placeStop(a.x + 4, a.z);
    const second = v.placeStop(b.x + 4, b.z);
    const line = v.makeLine([first.id, second.id], '乗合の便');
    // Nothing to ship and a queue at both ends, so the trip is worth running for people.
    for (const village of [a, b]) {
      const record = v.villages().find((entry) => entry.id === village.id);
      const town = v.game.towns.ensure(v.game.villages.get(record.id));
      town.waiting = 8;
      v.game.villages.get(record.id).stock = 0;
    }
    return { blocks, line, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } };
  });
  check(road.blocks > 0, 'nothing was paved');
  await settled(page);
  const surveyed = await page.evaluate(() => {
    window.voxelcraft.fastForward(6);
    return window.voxelcraft.routes()[0];
  });
  check(surveyed.vehicle === 'cart', `the road is not wide enough for a carriage: ${surveyed.vehicle}`);
  // The shipment first, which is the economy; the mob that draws it only appears once
  // somebody is near enough to see it.
  let riding = null;
  for (let spent = 0; spent < 240 && !riding; spent += 4) {
    await page.evaluate(() => window.voxelcraft.fastForward(4));
    riding = await page.evaluate(() =>
      window.voxelcraft.shipments().find((ship) => ship.vehicle === 'bus') ?? null);
  }
  check(riding, 'nobody ever travelled by road with a queue at both ends');
  console.log(`馬車: ${riding.good} ×${riding.cargo}（${riding.line}）`);
  await page.evaluate((at) => window.voxelcraft.warp(at.x + 6, at.z + 6), riding);
  await settled(page);
  let bus = null;
  for (let tries = 0; tries < 20 && !bus; tries++) {
    await page.waitForTimeout(400);
    bus = await page.evaluate(() => window.voxelcraft.haulers().find((mob) => mob.kind === 'bus') ?? null);
  }
  check(bus, 'the carriage was never drawn, though somebody was travelling by one');
  // Read where it is and stand there in the same breath: a carriage covers three blocks
  // in the time a round trip to the page takes, and the camera does not follow it.
  await page.evaluate(() => {
    const v = window.voxelcraft;
    const at = v.haulers().find((mob) => mob.kind === 'bus');
    if (!at) return;
    const g = v.game;
    g.player.teleportTo(at.x + 5, at.y + 2.2, at.z + 5);
    g.player.yaw = Math.atan2(-(at.x - g.player.x), -(at.z - g.player.z));
    g.player.pitch = 0.22;
    v.heal();
    g.hud.setClickPrompt(false);
  });
  await page.screenshot({ path: `${outDir}/bus.png` });
  check(errors.length === 0, `console errors: ${errors.join(' / ')}`);
  console.log(`馬車: ${road.blocks} ブロックの舗装路に出た`);
  await page.close();
}

// --- 運転 ---------------------------------------------------------------------

{
  const { page, errors } = await open();
  const built = await page.evaluate(() => {
    const v = window.voxelcraft;
    v.gotoVillage();
    v.discoverNearby(2);
    const all = v.villages();
    const a = all[0];
    const b = all
      .slice(1)
      .reduce((best, next) =>
        Math.hypot(next.x - a.x, next.z - a.z) < Math.hypot(best.x - a.x, best.z - a.z) ? next : best);
    const rails = v.buildRailway(a.id, b.id);
    v.buildStation(a.x, a.z);
    v.buildStation(b.x, b.z);
    const first = v.placeStop(a.x + 4, a.z);
    const second = v.placeStop(b.x + 4, b.z);
    // Something worth hauling at both ends, so the train the player takes out is a train
    // and not a light engine — whichever end they happen to be standing at.
    v.game.villages.get(a.id).stock = 30;
    v.game.villages.get(b.id).stock = 30;
    return { rails, line: v.makeLine([first.id, second.id], '試験線'), stations: v.stations() };
  });
  check(built.rails > 0, 'no railway was laid');
  check(built.stations.length >= 2, 'the railway has no stations on it');
  await settled(page);
  const railed = await page.evaluate(() => {
    window.voxelcraft.fastForward(6);
    return window.voxelcraft.routes()[0];
  });
  check(railed.vehicle === 'train', `the leg is not a railway: ${railed.vehicle}`);
  console.log(`線路 ${Math.round(railed.length)}m / 線形 ${railed.pace} / 最急 ${railed.steepest}`);
  check(railed.pace <= 1, 'a railway cannot be better than straight and level');

  const cab = await page.evaluate(() => {
    const v = window.voxelcraft;
    return v.drive(v.lines()[0].id);
  });
  check(cab, 'the controls were refused on a line that is a railway');
  check(cab.speed === 0, 'the train set off by itself');
  await page.waitForTimeout(300);

  // Power for a few seconds, and it goes.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  const rolling = await page.evaluate(() => ({
    cab: window.voxelcraft.driving(),
    haulers: window.voxelcraft.haulers(),
    panel: document.querySelector('.cab')?.textContent ?? '',
  }));
  await page.keyboard.up('KeyW');
  check(rolling.cab.speed > 1, `the throttle did nothing: ${JSON.stringify(rolling.cab)}`);
  check(rolling.cab.toGo < cab.toGo, 'the train did not get any nearer the far end');
  check(
    rolling.haulers.some((mob) => mob.kind === 'train'),
    `what is being driven is not drawn as a train: ${JSON.stringify(rolling.haulers)}`,
  );
  check(rolling.panel.includes('制限'), `the cab panel is not up: ${rolling.panel}`);
  check(rolling.cab.speed <= rolling.cab.lineSpeed * 1.8 + 0.01, 'the train went faster than it can');
  await page.screenshot({ path: `${outDir}/cab.png` });

  // And the brake stops it.
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyS');
  const stopped = await page.evaluate(() => window.voxelcraft.driving());
  check(stopped.speed === 0, `the brake did not stop it: ${stopped.speed}`);

  // Somebody standing beside the line, so the train can be seen from outside it.
  await page.evaluate(() => window.voxelcraft.stopDriving());
  const train = await page.evaluate(() => {
    const v = window.voxelcraft;
    const at = v.driving();
    return at ?? v.haulers().find((mob) => mob.kind === 'train') ?? null;
  });
  if (train) {
    await look(page, { x: train.x + 9, y: train.y + 3, z: train.z + 9 }, { x: train.x, y: train.y + 1, z: train.z });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/train.png` });
  }
  check(errors.length === 0, `console errors: ${errors.join(' / ')}`);
  console.log('運転: 力行で走り、制動で止まった');
  await page.close();
}

await browser.close();
console.log(`できあがり: ${outDir}`);
