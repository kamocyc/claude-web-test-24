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

// --- crafting table UI -------------------------------------------------------
await evaluate(() => {
  window.voxelcraft.give('oak_planks', 12);
  window.voxelcraft.give('stick', 6);
  window.voxelcraft.give('iron_ingot', 5);
  window.voxelcraft.openScreen('crafting');
});
await page.waitForTimeout(500);

// Lay out a wooden pickaxe by clicking slots, exactly as a player would.
const slots = page.locator('.panel .slot');
const GRID = 0;
const RESULT = 9;
const HOTBAR = 10 + 27;
const planksSlot = HOTBAR + (await evaluate(() => window.voxelcraft.player.inventory.find('oak_planks')));
const sticksSlot = HOTBAR + (await evaluate(() => window.voxelcraft.player.inventory.find('stick')));

await slots.nth(planksSlot).click();
for (const cell of [0, 1, 2]) await slots.nth(GRID + cell).click({ button: 'right' });
await slots.nth(planksSlot).click();
await slots.nth(sticksSlot).click();
for (const cell of [4, 7]) await slots.nth(GRID + cell).click({ button: 'right' });
await slots.nth(sticksSlot).click();
await page.waitForTimeout(300);
await shot('09-crafting');

await slots.nth(RESULT).click();
await slots.nth(10).click();
await page.waitForTimeout(300);
const crafted = await evaluate(() => window.voxelcraft.player.inventory.count('wooden_pickaxe'));
console.log('crafted wooden pickaxes:', crafted);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

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
await page.waitForFunction(() => window.voxelcraft.pending() === 0, null, { timeout: 90000 });
await page.waitForTimeout(3000);
await shot('11-water');
console.log('in water:', await evaluate(() => window.voxelcraft.player.inWater));

// --- death and respawn -------------------------------------------------------
await evaluate(() => {
  window.voxelcraft.player.health = 0;
});
await page.waitForTimeout(600);
await shot('12-death');
const deathVisible = await page.locator('.menu.death').isVisible();
await page.click('.menu.death .menu-button');
await page.waitForTimeout(1200);
const revived = await evaluate(() => ({ health: window.voxelcraft.player.health, dead: window.voxelcraft.player.isDead }));
console.log('death screen:', deathVisible, 'after respawn:', JSON.stringify(revived));

// --- save, reload and continue ----------------------------------------------
const before = await evaluate(() => {
  const g = window.voxelcraft.game;
  g.save(false);
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch') };
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.click('.menu-button:not(.primary)');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(2000);
const after = await evaluate(() => {
  const g = window.voxelcraft.game;
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch'), seed: g.world.seed };
});
console.log('saved:', JSON.stringify(before), 'loaded:', JSON.stringify(after));
await shot('10-reloaded');

console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
await browser.close();
