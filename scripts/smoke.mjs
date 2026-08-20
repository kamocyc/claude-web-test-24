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
/** Right-clicks at the crosshair until the world reacts. A single dropped frame on the
 *  software renderer can swallow the press, and a retry is cheaper than a flaky run. */
const useUntil = async (predicate, arg = null, attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.mouse.move(640, 360);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(500);
    if (await page.evaluate(predicate, arg)) return true;
  }
  return false;
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot('01-title');

// The fixed verification seed is one click on the title screen.
await page.click('.menu-button:has-text("検証用ワールド")');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.keyboard.press('F3');
await page.waitForTimeout(400);
await shot('02-spawn');
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
await page.waitForTimeout(500);
await shot('04-inventory');

const plankRow = page.locator('.recipe-row', { hasText: '木材' }).first();
await plankRow.click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
const stickRow = page.locator('.recipe-row', { hasText: '棒' }).first();
await stickRow.click();
await page.waitForTimeout(300);
const tableRow = page.locator('.recipe-row', { hasText: '作業台' }).first();
await tableRow.click();
await page.waitForTimeout(300);
const handCrafted = await evaluate(() => {
  const inv = window.voxelcraft.player.inventory;
  return { planks: inv.count('oak_planks'), sticks: inv.count('stick'), tables: inv.count('crafting_table') };
});
console.log('hand crafted from the recipe list:', JSON.stringify(handCrafted));
// A crafting table is needed before any tool shows up in the list.
const toolBeforeTable = await page.locator('.recipe-row', { hasText: '石のツルハシ' }).count();
await page.keyboard.press('Escape');

await evaluate(() => window.voxelcraft.openScreen('crafting'));
await page.waitForTimeout(500);
await page.fill('.recipe-search', 'ツルハシ');
await page.waitForTimeout(300);
await shot('04b-recipes');
await page.locator('.recipe-row', { hasText: '石のツルハシ' }).first().click();
await page.waitForTimeout(300);
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
await page.waitForTimeout(2500);
await shot('05-night');
console.log('night:', JSON.stringify(await debugText()));

// --- village -----------------------------------------------------------------
const village = await evaluate(() => window.voxelcraft.gotoVillage());
console.log('village:', JSON.stringify(village));
await page.waitForFunction(() => window.voxelcraft?.pending() === 0, null, { timeout: 90000 });
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
const tradeOpen = await useUntil(() => window.voxelcraft.game.screens.kind === 'trade');
await shot('07-trade');
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
await useUntil(() => {
  const g = window.voxelcraft.game;
  return g.world.getBlockLight(Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)) > 0;
});
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
  await page.waitForFunction(() => window.voxelcraft?.pending() === 0, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  await evaluate(() => {
    window.voxelcraft.game.player.pitch = -0.3;
  });
  await shot('15-river');
  console.log('river depth:', await evaluate((r) => window.voxelcraft.waterDepth(r.x, r.surface, r.z), river));

  // --- the weather upstream, and how late it gets here ------------------------
  const calmLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  // A drought begins in the headwaters. Downstream is still in the calm season, which
  // is the whole point: the player has that long to fill a reservoir.
  await evaluate(() => window.voxelcraft.setWeatherSeconds(30 * 60));
  await page.waitForTimeout(1200);
  const warning = await evaluate(() => window.voxelcraft.weather());
  console.log('drought announced:', JSON.stringify(warning));
  console.log('forecast panel:', (await page.locator('.forecast').textContent())?.trim());
  await shot('15b-forecast');

  // Once it arrives the river drops, and the bank it leaves behind is dry.
  await evaluate(() => window.voxelcraft.setWeather('drought'));
  await page.waitForTimeout(2500);
  const dryLevel = await evaluate((r) => window.voxelcraft.waterSurface(r.x, r.z), river);
  await shot('15c-drought');

  // Heavy rain lifts it again, without ever spilling over the bank.
  await evaluate(() => window.voxelcraft.setWeather('rain'));
  await page.waitForTimeout(2500);
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
  await page.waitForTimeout(2500);
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
    await page.waitForTimeout(9000);
    console.log('water reached the far end:', await farWater());
    await evaluate((w) => {
      const g = window.voxelcraft.game;
      g.player.teleportTo(w.far[0] + 0.5 - w.dx * 3, w.surface + 3, w.far[1] + 0.5 - w.dz * 3);
      g.player.yaw = Math.atan2(-w.dx, -w.dz);
      g.player.pitch = -0.5;
    }, works);
    await page.waitForTimeout(1500);
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
    await page.waitForTimeout(7000);
    console.log('with the gate shut:', await farWater());
    await shot('17-gate-closed');

    await evaluate((w) => {
      const g = window.voxelcraft.game;
      for (let y = w.floorY; y <= w.surface; y++) g.world.setBlock(w.gate[0], y, w.gate[1], 58);
    }, works);
    await page.waitForTimeout(9000);
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
    await page.waitForTimeout(6000);
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
  await page.waitForTimeout(5000);
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
await page.waitForTimeout(500);

// One click on the recipe row is the whole interaction now.
await page.fill('.recipe-search', 'ツルハシ');
await page.waitForTimeout(300);
await shot('09-crafting');
await page.locator('.recipe-row', { hasText: '木のツルハシ' }).first().click();
await page.waitForTimeout(300);
const crafted = await evaluate(() => window.voxelcraft.player.inventory.count('wooden_pickaxe'));
const stillLocked = await page.locator('.recipe-row.locked', { hasText: 'ダイヤのツルハシ' }).count();
console.log('crafted wooden pickaxes:', crafted, '/ diamond pickaxe row locked:', stillLocked);
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
await page.waitForFunction(() => window.voxelcraft?.pending() === 0, null, { timeout: 90000 });
await page.waitForTimeout(3000);
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
  await page.waitForTimeout(600);
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
await page.waitForTimeout(600);
await shot('12-death');
const deathVisible = await page.locator('.menu.death').isVisible();
await page.click('.menu.death .menu-button');
await page.waitForTimeout(1200);
const revived = await evaluate(() => ({ health: window.voxelcraft.player.health, dead: window.voxelcraft.player.isDead }));
console.log('death screen:', deathVisible, 'after respawn:', JSON.stringify(revived));

// --- pause menu --------------------------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const paused = await page.locator('.menu-button:has-text("ゲームに戻る")').isVisible();
await shot('13-pause');
// Drag the render distance slider down and check it takes effect.
await page.locator('.setting-row:has-text("描画距離") .slider').fill('5');
await page.waitForTimeout(300);
console.log('render distance:', await evaluate(() => window.voxelcraft.game.renderDistance));
await page.click('.menu-button:has-text("ゲームに戻る")');
await page.waitForTimeout(400);
console.log('pause menu:', paused, 'resumed:', await evaluate(() => window.voxelcraft.game.paused === false));

// --- save, reload and continue ----------------------------------------------
const before = await evaluate(() => {
  const g = window.voxelcraft.game;
  g.save(false);
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch') };
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.click('.menu-button:has-text("続きから")');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(2000);
const after = await evaluate(() => {
  const g = window.voxelcraft.game;
  return { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), torches: g.player.inventory.count('torch'), seed: g.world.seed };
});
console.log('saved:', JSON.stringify(before), 'loaded:', JSON.stringify(after));
await shot('10-reloaded');

// --- the pause screen names the seed so a world can be found again ----------
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
console.log('pause seed label:', (await page.locator('.seed-label').textContent())?.trim());
await page.click('.menu-button:has-text("タイトルへ戻る")');
await page.waitForTimeout(800);

// --- a seed in the URL opens that exact world without touching the title ----
await page.goto(`${url}?seed=second`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.keyboard.press('F3');
await page.waitForTimeout(300);
await shot('14-second-world');
console.log('world from the URL:', JSON.stringify(await debugText()));

console.log(errors.length === 0 ? 'NO PAGE ERRORS' : `ERRORS:\n${errors.join('\n')}`);
await browser.close();
