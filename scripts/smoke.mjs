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
/** Escape only when a screen is actually open, otherwise it would pause the game. */
const closeScreen = async () => {
  if (await page.evaluate(() => window.voxelcraft?.game?.screens.isOpen === true)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
};
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
await page.waitForFunction(() => window.voxelcraft.player.inventory.slots.some(Boolean), null, { timeout: 15000 });
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
await page.waitForTimeout(700);
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
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(600);
await shot('07-trade');
const tradeOpen = await evaluate(() => window.voxelcraft.game.screens.kind === 'trade');
if (tradeOpen) {
  await page.locator('.trade-button:not([disabled])').first().click();
  await page.waitForTimeout(400);
}
const tradeResult = await evaluate(() => {
  const g = window.voxelcraft.game;
  // The villager spawned for this test is the newest one.
  const villager = [...g.mobs.mobs].reverse().find((m) => m.kind === 'villager');
  return { screen: g.screens.kind, uses: villager ? villager.trades[0].uses : -1 };
});
console.log('trade screen open:', tradeOpen, JSON.stringify(tradeResult));
await closeScreen();

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
  await page.waitForTimeout(600);
  await evaluate(() => {
    const inv = window.voxelcraft.player.inventory;
    inv.selected = inv.find('wooden_hoe');
  });
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  const tilled = await evaluate(() => {
    const g = window.voxelcraft.game;
    const below = { x: Math.floor(g.player.x), y: Math.floor(g.player.y) - 1, z: Math.floor(g.player.z) };
    const inv = g.player.inventory;
    inv.selected = inv.find('wheat_seeds');
    return g.world.getBlock(below.x, below.y, below.z);
  });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  const planted = await evaluate(() => {
    const g = window.voxelcraft.game;
    const x = Math.floor(g.player.x), z = Math.floor(g.player.z);
    const y = Math.floor(g.player.y);
    return { soil: g.world.getBlock(x, y - 1, z), crop: g.world.getBlock(x, y, z) };
  });
  console.log('tilled block:', tilled, 'after planting:', JSON.stringify(planted));
  await shot('07b-farm');
}

const eaten = await evaluate(async () => {
  const g = window.voxelcraft.game;
  const before = g.player.hunger.food;
  const inv = g.player.inventory;
  inv.selected = inv.find('bread');
  return before;
});
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(400);
console.log('hunger before/after eating:', eaten, await evaluate(() => window.voxelcraft.player.hunger.food));

// --- furnace and chest screens ----------------------------------------------
await evaluate(() => window.voxelcraft.openScreen('furnace'));
await page.waitForTimeout(400);
await shot('07c-furnace');
await closeScreen();
await evaluate(() => window.voxelcraft.openScreen('chest'));
await page.waitForTimeout(400);
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
  window.voxelcraft.heal();
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
// DOM order inside the panel: 3x3 grid, result, 27 backpack slots, 9 hotbar slots.
const domSlot = (inventoryIndex) => (inventoryIndex < 9 ? 37 + inventoryIndex : 10 + inventoryIndex - 9);
const planksSlot = domSlot(await evaluate(() => window.voxelcraft.player.inventory.find('oak_planks')));
const sticksSlot = domSlot(await evaluate(() => window.voxelcraft.player.inventory.find('stick')));

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
await closeScreen();

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
