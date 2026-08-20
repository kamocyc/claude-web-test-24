import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.fill('.seed-input', 'voxelcraft');
await page.click('.menu-button.primary');
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
console.log('spawn area:', JSON.stringify(await page.evaluate(() => {
  const g = window.voxelcraft.game;
  const x = Math.floor(g.player.x), z = Math.floor(g.player.z);
  const top = g.world.heightAt(x, z);
  return { top, sky: g.world.getSkyLight(x, top + 1, z), lightPending: g.light.pending, dirty: g.world.dirtyChunks.size };
})));
await page.evaluate(() => window.voxelcraft.gotoVillage());
await page.waitForFunction(() => window.voxelcraft.pending() === 0, null, { timeout: 90000 });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(2000);
  console.log(JSON.stringify(await page.evaluate(() => {
    const g = window.voxelcraft.game;
    const x = Math.floor(g.player.x), z = Math.floor(g.player.z);
    const top = g.world.heightAt(x, z);
    return { py: +g.player.y.toFixed(1), top, sky: g.world.getSkyLight(x, top + 1, z), skyAtPlayer: g.world.getSkyLight(x, Math.floor(g.player.y) + 1, z), lightPending: Math.round(g.light.pending), dirty: g.world.dirtyChunks.size, chunks: g.world.chunks.size };
  })));
}
await page.screenshot({ path: '/tmp/shots/probe-village.png' });
await browser.close();
