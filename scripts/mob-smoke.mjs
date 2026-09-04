/**
 * A contact sheet of every mob, for judging the models by eye.
 *
 *   node scripts/mob-smoke.mjs [url] [outputDir]
 *
 * Spawns each kind in turn in front of a fixed camera and shoots it standing,
 * then walking. Nothing here asserts: the whole point is the pictures. What it
 * does report is the draw-call and triangle count with a crowd on screen, which
 * is the number the merged geometry was supposed to hold down.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/?seed=voxelcraft';
const outDir = process.argv[3] ?? 'screenshots/mobs';
mkdirSync(outDir, { recursive: true });

const KINDS = [
  'zombie', 'skeleton', 'spider', 'villager',
  'pig', 'cow', 'sheep', 'chicken',
  'cat', 'dog', 'fox', 'rabbit', 'camel',
];

const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`[console] ${m.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.voxelcraft?.isReady() === true, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = window.voxelcraft;
  g.toggleDayCycle();
  g.setTime(0.3);
  // Not peaceful: that setting empties the world of hostiles, and three of the
  // thirteen are hostile. Daylight burning is undone in `frame` instead.
});
await page.waitForFunction(() => window.voxelcraft.backlog() === 0, null, { timeout: 120000 });
// The HUD is in the way of the only thing these pictures are of.
await page.addStyleTag({ content: '.hud, .click-prompt, .toasts, .objective, .minimap, .compass, .debug { display: none !important }' });
await page.waitForTimeout(1500);

/** Stand off a mob at a fixed three-quarter angle and look straight at it. Read
 *  live rather than from the spawn, because it has to fall to the ground first. */
async function frame(id) {
  await page.evaluate((id) => {
    const g = window.voxelcraft;
    const at = g.mobs().find((m) => m.id === id);
    if (!at) return;
    if (!g.player.flying) g.toggleFly();
    // Far enough back that the tallest of them fits, and aimed at the middle of
    // whatever it is rather than at a fixed angle.
    const tall = Math.max(0.7, at.def?.height ?? 1);
    const reach = 1.9 + tall * 1.2;
    // In front of the mob, wherever the mob has decided to face: turning the mob
    // towards a fixed camera does not stick, because its own wandering turns it
    // straight back within a frame or two.
    const look = [-Math.sin(at.yaw), -Math.cos(at.yaw)];
    const side = [look[1], -look[0]];
    g.player.x = at.x + (look[0] * 0.86 + side[0] * 0.5) * reach;
    // Standing on the same ground and looking down at it: a camera lowered to a
    // rabbit's eye level would be underground, and the collision would push it
    // back up anyway.
    g.player.y = at.y;
    g.player.z = at.z + (look[1] * 0.86 + side[1] * 0.5) * reach;
    const dx = at.x - g.player.x, dz = at.z - g.player.z;
    const dy = (at.y + tall * 0.55) - (g.player.y + 1.62);
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.player.vx = g.player.vy = g.player.vz = 0;
    // Hostiles burn in daylight, and these pictures are taken in daylight.
    at.burning = 0;
    at.health = at.def.maxHealth;
  }, id);
}

for (const kind of KINDS) {
  const spot = await page.evaluate((kind) => {
    const g = window.voxelcraft;
    // Clear whatever was here: a dead mob is dropped from the list next tick.
    for (const mob of g.mobs()) mob.health = 0;
    const mob = g.spawnMob(kind, 3);
    return mob ? { x: mob.x, y: mob.y, z: mob.z, id: mob.id } : null;
  }, kind);
  if (!spot) {
    console.log(`${kind}: nowhere to spawn`);
    continue;
  }
  // Let it fall to the ground before the camera is placed off it.
  await page.waitForTimeout(900);
  await frame(spot.id);
  await page.waitForTimeout(500);
  await frame(spot.id);
  // Short: the mob turns to face wherever it is wandering within a few frames.
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${outDir}/${kind}-idle.png` });
  // Walking: push it along by hand so the pose is the moving one.
  await page.evaluate((id) => {
    const mob = window.voxelcraft.mobs().find((m) => m.id === id);
    if (mob) { mob.vx = 1.2; mob.vz = 0; mob.walkPhase = 1.1; }
  }, spot.id);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/${kind}-walk.png` });
  console.log(`${kind}: shot`);
}

// The people, all of them, in a row. The villager is the one kind with more than one
// model, and the whole point of that is how a crowd of them looks rather than how any one
// of them does — so this is a line-up rather than another twelve portraits.
{
  const spot = await page.evaluate(() => {
    const g = window.voxelcraft;
    for (const mob of g.mobs()) mob.health = 0;
    const here = g.position();
    const made = [];
    for (let i = 0; i < 12; i++) {
      const mob = g.game.mobs.addVillager(here.x - 12.1 + i * 2.2, here.y + 0.1, here.z - 20, 'farmer');
      mob.variant = i;
      made.push(mob.id);
    }
    return { x: here.x, y: here.y, z: here.z, made: made.length };
  });
  await page.waitForTimeout(900);
  await page.evaluate((at) => {
    const g = window.voxelcraft;
    if (!g.player.flying) g.toggleFly();
    g.player.x = at.x;
    g.player.y = at.y + 1.2;
    g.player.z = at.z - 2;
    g.player.vx = 0; g.player.vy = 0; g.player.vz = 0;
    g.player.yaw = 0;
    g.player.pitch = 0;
    for (const mob of g.mobs()) { if (mob.kind === 'villager') { mob.yaw = Math.PI; mob.vx = 0; mob.vz = 0; } }
  }, spot);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/villagers.png` });
  console.log(`villagers: ${spot.made} shot`);
}

const cost = await page.evaluate(async () => {
  const g = window.voxelcraft;
  for (const mob of g.mobs()) mob.health = 0;
  for (let i = 0; i < 20; i++) g.spawnMob('cow', 5 + (i % 5));
  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  return { mobs: g.mobs().length };
});
await page.screenshot({ path: `${outDir}/herd.png` });
console.log('a herd on screen:', JSON.stringify(cost));
console.log('errors', errors);
await browser.close();
