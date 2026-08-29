import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5295/';
const out = process.argv[3] ?? 'screenshots/rounded-toggle';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});

const waitForWorld = async () => {
  await page.waitForFunction(() => window.voxelcraft?.isReady?.() === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.voxelcraft?.backlog?.() === 0, null, { timeout: 60_000 });
  await page.waitForTimeout(2_000);
};
const rendererInfo = () => page.evaluate(() => ({
  calls: window.voxelcraft.game.renderer.info.render.calls,
  triangles: window.voxelcraft.game.renderer.info.render.triangles,
}));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.removeItem('voxelcraft.settings.v1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.menu-button:has-text("検証用ワールド")').click();
await waitForWorld();
const rounded = await rendererInfo();
await page.screenshot({ path: `${out}/rounded-on.png` });

await page.keyboard.press('Escape');
const toggle = page.locator('.toggle-row:has-text("地形ブロックの角を丸くする") input');
await toggle.uncheck();
await page.screenshot({ path: `${out}/settings-off.png` });
await page.waitForFunction(() => window.voxelcraft.game.world.dirtyChunks.size === 0, null, { timeout: 60_000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(1_000);
const square = await rendererInfo();
await page.screenshot({ path: `${out}/rounded-off.png` });

const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('voxelcraft.settings.v1') ?? '{}').roundedBlocks);
console.log(JSON.stringify({ rounded, square, persisted, errors }, null, 2));
if (persisted !== false || square.triangles >= rounded.triangles || errors.length > 0) process.exitCode = 1;
await browser.close();
