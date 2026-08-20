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

const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    errors.push(`[console] ${message.text()}`);
  }
});

const shot = async (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const debugText = () => page.locator('.debug').textContent();
const evaluate = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot('01-title');

await page.fill('.seed-input', 'voxelcraft');
await page.click('.menu-button.primary');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.keyboard.press('F3');
await page.waitForTimeout(400);
await shot('02-spawn');
console.log('spawn:', JSON.stringify(await debugText()));

// --- mining: look down and hold the left mouse button ------------------------
await evaluate(() => {
  window.voxelcraft.player.pitch = -1.2;
});
await page.mouse.move(640, 360);
await page.mouse.down();
await page.waitForTimeout(2500);
await page.mouse.up();
await page.waitForTimeout(1200);
const mined = await evaluate(() => window.voxelcraft.player.inventory.slots.filter(Boolean));
console.log('after mining:', JSON.stringify(mined));
await shot('03-mining');

// --- crafting: logs -> planks -> sticks -> pickaxe ---------------------------
await evaluate(() => {
  window.voxelcraft.give('oak_log', 8);
  window.voxelcraft.give('cobblestone', 8);
});
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
await shot('04-inventory');
await page.keyboard.press('Escape');

// --- night and hostile mobs --------------------------------------------------
await evaluate(() => {
  window.voxelcraft.setTime(0.68);
  window.voxelcraft.player.pitch = -0.1;
  window.voxelcraft.spawnMob('zombie', 4);
  window.voxelcraft.spawnMob('skeleton', 6);
  window.voxelcraft.spawnMob('cow', 8);
});
await page.waitForTimeout(2500);
await shot('05-night');
console.log('night:', JSON.stringify(await debugText()));

// --- village -----------------------------------------------------------------
const village = await evaluate(() => window.voxelcraft.gotoVillage());
console.log('village:', JSON.stringify(village));
await page.waitForFunction(() => window.voxelcraft.pending() === 0, null, { timeout: 90000 });
await page.waitForTimeout(2500);
await evaluate(() => {
  window.voxelcraft.setTime(0.2);
  window.voxelcraft.player.pitch = -0.25;
});
await page.waitForTimeout(1500);
await shot('06-village');
console.log('at village:', JSON.stringify(await debugText()));
const villagers = await evaluate(() => window.voxelcraft.mobs().filter((m) => m.kind === 'villager').length);
console.log('villagers nearby:', villagers);

// --- underground -------------------------------------------------------------
const cave = await evaluate(() => {
  window.voxelcraft.give('torch', 16);
  window.voxelcraft.player.pitch = 0;
  return window.voxelcraft.findCave();
});
console.log('cave:', JSON.stringify(cave));
await page.waitForTimeout(2500);
await shot('07-underground');

// --- place a torch in the dark ----------------------------------------------
await evaluate(() => {
  const inv = window.voxelcraft.player.inventory;
  inv.selected = inv.find('torch');
  window.voxelcraft.player.pitch = -1.0;
});
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(800);
await evaluate(() => {
  window.voxelcraft.player.pitch = -0.2;
});
await page.waitForTimeout(600);
await shot('08-torch');
const torchLight = await evaluate(() => {
  const g = window.voxelcraft.game;
  return g.world.getBlockLight(Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z));
});
console.log('block light at player:', torchLight);

console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
await browser.close();
