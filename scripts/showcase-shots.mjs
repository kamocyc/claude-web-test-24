import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * Photographs the superflat building showcase.
 *
 * The exhibits are the one part of the world that no unit test can look at: a
 * cathedral whose every block is in the right place can still read as a shed.
 * So this stands the camera in front of each one in turn and takes a picture.
 *
 *   npm run dev            # or any server on the URL below
 *   node scripts/showcase-shots.mjs
 */

const url = process.argv[2] ?? 'http://127.0.0.1:5294/?world=showcase';
const out = process.argv[3] ?? 'screenshots/showcase';
const PITCH = 57;
const GROUND = 40;

/** Where to stand for each exhibit: which lot, how far back, and how high. */
const VIEWS = [
  { id: 'greek_temple', seat: [0, -1], back: 46, eye: 14, pitch: 0.05 },
  { id: 'cathedral', seat: [1, -1], back: 62, eye: 22, pitch: 0.12 },
  { id: 'glass_tower', seat: [1, 0], back: 74, eye: 30, pitch: 0.25 },
  { id: 'deco_tower', seat: [1, 1], back: 74, eye: 28, pitch: 0.25 },
  { id: 'clock_tower', seat: [0, 1], back: 58, eye: 24, pitch: 0.2 },
  { id: 'lattice_tower', seat: [-1, 1], back: 74, eye: 28, pitch: 0.25 },
  { id: 'manor_house', seat: [-1, 0], back: 40, eye: 12, pitch: 0.0 },
  { id: 'townhouse_row', seat: [-1, -1], back: 42, eye: 12, pitch: 0.0 },
  // The modern quarter, one lot further out. Photographed from the avenue between the
  // two rings, which is where somebody walking out of the old quarter first sees them.
  { id: 'tower_block', seat: [0, -2], back: 70, eye: 36, pitch: 0.24 },
  { id: 'tenant_block', seat: [2, 0], back: 40, eye: 12, pitch: 0.06 },
  // The block of flats is thirty-five across and has an exhibit standing between it and
  // the plaza, so it is taken from the corner of the avenue rather than head on.
  { id: 'apartment', seat: [0, 2], from: [-44, 85], eye: 15, pitch: 0.02 },
  { id: 'jp_house', seat: [-2, 0], back: 36, eye: 10, pitch: 0.0 },
];

await mkdir(out, { recursive: true });
// The pinned Playwright build may not be the browser this machine has, so an
// explicit path wins over the download it would otherwise ask for.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.voxelcraft?.isReady?.() === true, null, { timeout: 180000 });
await page.evaluate(() => {
  window.voxelcraft.game.setRenderDistance(12);
  window.voxelcraft.setTime(0.22);
  window.voxelcraft.toggleDayCycle();
  window.voxelcraft.player.flying = true;
});

// The HUD is in the way of the thing being photographed: the click prompt sits
// exactly where the middle of a facade is, and the hotbar covers its doorstep.
const bareScreen = () => page.addStyleTag({
  content: '.hud, .menu-layer, .toast, .compass, .minimap { display: none !important; }',
});

const settle = async () => {
  await page.waitForFunction(() => window.voxelcraft.backlog() === 0, null, { timeout: 240000 });
  await page.waitForTimeout(1200);
};

/** Stands the camera at a point, looking along a direction. */
async function stand(x, y, z, dx, dz, pitch) {
  await page.evaluate((view) => {
    window.voxelcraft.warp(Math.round(view.x), Math.round(view.z), Math.round(view.y));
    const player = window.voxelcraft.player;
    player.flying = true;
    player.x = view.x;
    player.y = view.y;
    player.z = view.z;
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.yaw = Math.atan2(-view.dx, -view.dz);
    player.pitch = view.pitch;
  }, { x, y, z, dx, dz, pitch });
  await settle();
}

for (const view of VIEWS) {
  const cx = view.seat[0] * PITCH;
  const cz = view.seat[1] * PITCH;
  const length = Math.hypot(cx, cz);
  // Straight down the avenue by default; `from` is for the two lots that have an exhibit
  // standing between them and the plaza.
  const px = view.from ? view.from[0] : cx - (cx / length) * view.back;
  const pz = view.from ? view.from[1] : cz - (cz / length) * view.back;
  await stand(px, GROUND + view.eye, pz, cx - px, cz - pz, view.pitch);
  await bareScreen();
  await page.screenshot({ path: `${out}/${view.id}.png` });
  console.log(`shot ${view.id}`);
}

// The plaza from its own edge, and one corner of the exhibition from the air.
// Not the whole of it: the game's fog closes in well before 200 blocks, and a
// viewpoint far enough back to hold every lot holds them all in haze.
await stand(0, GROUND + 4, 26, 0, -1, 0.05);
await bareScreen();
await page.screenshot({ path: `${out}/plaza.png` });
// Over the avenue crossing rather than over a lot: from above an exhibit, that
// exhibit is the whole photograph.
await stand(-29, GROUND + 58, 29, 1, -1, -0.36);
await bareScreen();
await page.screenshot({ path: `${out}/overview.png` });
// And the one view the world was extended to make: the modern quarter in the foreground
// with the old ring behind it, which is the comparison the whole world is for.
await stand(0, GROUND + 62, -186, 0, 1, -0.3);
await bareScreen();
await page.screenshot({ path: `${out}/avenue.png` });

console.log(await page.evaluate(() => ({
  position: window.voxelcraft.position(),
  triangles: window.voxelcraft.game.renderer.info.render.triangles,
  calls: window.voxelcraft.game.renderer.info.render.calls,
})));
if (errors.length > 0) console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 2));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
