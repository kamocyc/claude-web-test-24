import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:5294/';
const out = process.argv[3] ?? 'screenshots/visual-check';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('.menu-button:has-text("検証用ワールド")').click();

let state = null;
for (let elapsed = 0; elapsed <= 120; elapsed += 5) {
  await page.waitForTimeout(elapsed === 0 ? 1000 : 5000);
  state = await page.evaluate(() => ({
    ready: window.voxelcraft?.isReady?.() ?? false,
    pending: window.voxelcraft?.pending?.() ?? -1,
    backlog: window.voxelcraft?.backlog?.() ?? -1,
    trees: window.voxelcraft?.game?.trees ? [...window.voxelcraft.game.trees.chunks].reduce((sum, list) => sum + list.length, 0) : -1,
  }));
  console.log(`${elapsed}s ${JSON.stringify(state)}`);
  if (errors.length > 0) {
    console.log('errors:', JSON.stringify(errors));
    break;
  }
  if (state.ready) break;
}
if (state?.ready) {
  await page.waitForFunction(() => window.voxelcraft?.backlog?.() === 0, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('settled:', await page.evaluate(() => [...document.querySelectorAll('body *')]
    .find((element) => element.children.length === 0 && element.textContent?.includes('FPS'))?.textContent ?? ''));
  console.log('renderer:', await page.evaluate(() => ({
    calls: window.voxelcraft.game.renderer.info.render.calls,
    triangles: window.voxelcraft.game.renderer.info.render.triangles,
    programs: window.voxelcraft.game.renderer.info.programs?.length ?? 0,
  })));
  console.log('frames:', await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let previous = performance.now();
    const frame = (now) => {
      samples.push(now - previous);
      previous = now;
      if (samples.length < 121) requestAnimationFrame(frame);
      else {
        const sorted = samples.slice(1).sort((a, b) => a - b);
        const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        resolve({ p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) });
      }
    };
    requestAnimationFrame(frame);
  })));
}
await page.screenshot({ path: `${out}/world.png`, fullPage: true });
await page.evaluate(() => {
  for (const mesh of window.voxelcraft.game.chunkRenderer.group.children) {
    if (mesh.material?.defines?.CUTOUT !== undefined) mesh.visible = false;
  }
});
await page.screenshot({ path: `${out}/world-no-cutout.png`, fullPage: true });
await page.evaluate(() => {
  for (const mesh of window.voxelcraft.game.chunkRenderer.group.children) mesh.visible = true;
});

if (state?.ready && errors.length === 0) {
  const staged = await page.evaluate(() => {
    const game = window.voxelcraft.game;
    const trees = [...game.trees.chunks].flat();
    trees.sort((a, b) => (a.x - game.player.x) ** 2 + (a.z - game.player.z) ** 2 - ((b.x - game.player.x) ** 2 + (b.z - game.player.z) ** 2));
    const tree = trees[0];
    if (!tree) return false;
    const model = game.trees.model(tree);
    game.player.teleportTo(tree.x, tree.y, tree.z + 6);
    game.player.yaw = 0;
    game.player.pitch = Math.atan2(tree.y + model.canopyY * tree.scale - game.player.eyeY, 6);
    window.__visualTreeId = tree.id;
    return true;
  });
  if (staged) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/tree-close.png`, fullPage: true });
    await page.evaluate(() => {
      const game = window.voxelcraft.game;
      const tree = [...game.trees.chunks].flat().find((candidate) => candidate.id === window.__visualTreeId);
      if (tree) game.trees.fell(tree, 0);
    });
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${out}/tree-falling.png`, fullPage: true });
  }
  await page.evaluate(() => window.voxelcraft.game.day.setToNight());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/night.png`, fullPage: true });
}
console.log('errors:', JSON.stringify(errors));
await browser.close();
if (!state?.ready || errors.length > 0) process.exitCode = 1;
