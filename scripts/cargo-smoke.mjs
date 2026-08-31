/** Focused visual check for the cargo readouts. Run a Vite server, then:
 *  node scripts/cargo-smoke.mjs [url] [outputDir]
 *
 *  This uses the verification world, fills the real village queues, and photographs the
 *  resulting depot display. It then stages every moving presentation in one small gallery
 *  so carrier offsets and Japanese labels can be reviewed without waiting for three
 *  different road upgrades. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'screenshots-cargo';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.click('.menu-button:has-text("検証用ワールド")');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.evaluate(() => window.voxelcraft.gotoVillage());
await page.waitForTimeout(1800);

const waiting = await page.evaluate(() => {
  const g = window.voxelcraft.game;
  const village = window.voxelcraft.village();
  g.villages.discover(village.id);
  village.stock = 23;
  village.harvest = 9;
  g.towns.ensure(village).waiting = 6;
  const depot = window.voxelcraft.buildings().list.find((building) => building.depot);
  const piles = g.cargoDisplays();
  const target = {
    x: piles.reduce((sum, pile) => sum + pile.x, 0) / piles.length,
    y: piles.reduce((sum, pile) => sum + pile.y, 0) / piles.length,
    z: piles.reduce((sum, pile) => sum + pile.z, 0) / piles.length,
  };
  // Pick a street-level vantage rather than blindly stepping across the road onto the
  // next building's roof.
  let stand = { x: target.x, z: target.z + 6, y: target.y };
  outer: for (let radius = 4; radius <= 9; radius++) {
    for (let i = 0; i < 16; i++) {
      const x = target.x + Math.cos((i * Math.PI) / 8) * radius;
      const z = target.z + Math.sin((i * Math.PI) / 8) * radius;
      const y = g.world.heightAt(Math.floor(x), Math.floor(z)) + 1;
      if (y > 0 && y <= target.y + 0.1) { stand = { x, y, z }; break outer; }
    }
  }
  g.player.teleportTo(stand.x, stand.y, stand.z);
  g.player.yaw = Math.atan2(-(target.x - stand.x), -(target.z - stand.z));
  g.player.pitch = 0.1;
  g.hud.setClickPrompt(false);
  return { village: village.name, depot: depot.label };
});
// The harvest buffer is intentionally drained into the town immediately; the persistent
// outbound stock and passenger queue are the two piles that must remain to photograph.
await page.waitForFunction(() => window.voxelcraft.game.cargoDisplays().length >= 2);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/cargo-waiting.png` });
const actual = await page.evaluate(() => window.voxelcraft.game.cargoDisplays());

const gallery = await page.evaluate(() => {
  const g = window.voxelcraft.game;
  const p = g.player;
  p.pitch = -0.2;
  const y = p.y;
  const forwardX = -Math.sin(p.yaw);
  const forwardZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw);
  const rightZ = -Math.sin(p.yaw);
  const displays = [
    { key: 'gallery:wait', good: 'coal', label: '石炭', count: 18, kind: 'waiting', across: -3, ahead: 7 },
    { key: 'gallery:porter', good: 'oak_log', label: '原木', count: 2, kind: 'porter', across: -1, ahead: 7 },
    { key: 'gallery:cart', good: 'wheat', label: '小麦', count: 12, kind: 'cart', across: 1, ahead: 7 },
    { key: 'gallery:train', good: 'passenger', label: '人', count: 24, kind: 'train', across: 3, ahead: 7 },
  ].map((entry) => ({
    key: entry.key, good: entry.good, label: entry.label, count: entry.count, kind: entry.kind,
    x: p.x + forwardX * entry.ahead + rightX * entry.across,
    y: y - 1,
    z: p.z + forwardZ * entry.ahead + rightZ * entry.across,
    yaw: p.yaw,
  }));
  g.paused = true;
  g.cargoRenderer.sync(displays);
  return displays;
});
await page.waitForTimeout(100);
await page.screenshot({ path: `${outDir}/cargo-gallery.png` });

console.log(JSON.stringify({ waiting, actual, gallery, errors }, null, 2));
await browser.close();
if (errors.length > 0) process.exitCode = 1;
