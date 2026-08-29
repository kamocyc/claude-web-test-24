export const QUEST_ROUTE = `(() => {
  const q = window.voxelcraft.quest();
  return window.voxelcraft.routes().find((r) =>
    (r.fromTown === q.origin && r.toTown === q.target)
    || (r.fromTown === q.target && r.toTown === q.origin)) ?? null;
})()`;

/** Shared browser actions and condition-based waits for the smoke scenarios. */
export function createSmokeHelpers(page, outDir) {
  const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
  const evaluate = (fn, arg) => page.evaluate(fn, arg);
  const until = (condition, arg = null, timeout = 30000) =>
    page.waitForFunction(condition, arg, { timeout });
  const frame = () =>
    page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  const settled = (timeout = 90000) => until(() => window.voxelcraft.backlog() === 0, null, timeout);

  const closeScreen = async () => {
    if (await page.evaluate(() => window.voxelcraft?.game?.screens.isOpen === true)) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.voxelcraft.game.screens.isOpen === false, null, { timeout: 10000 });
    }
  };

  const debugText = () => page.locator('.debug').textContent();

  const stable = (expression, { tolerance = 0.001, dwell = 900, timeout = 60000 } = {}) =>
    page.waitForFunction(
      `(() => {
        const value = ${expression};
        const state = window.__smokeStable ?? (window.__smokeStable = { since: Date.now() });
        const previous = state.value;
        state.value = value;
        if (Date.now() - state.since < ${dwell}) return false;
        return previous !== undefined && Math.abs(previous - value) <= ${tolerance};
      })()`,
      null,
      { timeout, polling: 300 },
    ).finally(() => page.evaluate(() => { delete window.__smokeStable; }));

  const advance = async (condition, { seconds = 240, chunk = 4, arg = null } = {}) => {
    for (let spent = 0; spent <= seconds; spent += chunk) {
      if (await page.evaluate(condition, arg)) return spent;
      await page.evaluate((n) => window.voxelcraft.fastForward(n), chunk);
    }
    if (await page.evaluate(condition, arg)) return seconds;
    throw new Error(`nothing came of ${seconds}s of world: ${String(condition).slice(0, 160)}`);
  };

  const useUntil = async (predicate, arg = null, attempts = 6) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      await page.mouse.move(640, 360);
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
      try {
        await page.waitForFunction(predicate, arg, { timeout: 900 });
        return true;
      } catch {
        // A dropped frame or an empty target; retry before declaring failure.
      }
    }
    return false;
  };

  const villagerInFront = async () => {
    await settled(60000);
    const spot = await page.evaluate(() => {
      const g = window.voxelcraft.game;
      window.voxelcraft.heal();
      for (let r = 4; r < 80; r += 2) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const x = Math.round(g.player.x + Math.cos(a) * r);
          const z = Math.round(g.player.z + Math.sin(a) * r);
          const here = g.world.heightAt(x, z);
          const ahead = g.world.heightAt(x, z + 3);
          if (here > 0 && here === ahead && g.world.getBlock(x, here + 1, z) === 0
              && g.world.getBlock(x, here + 1, z + 3) === 0) {
            g.player.teleportTo(x + 0.5, here + 1, z + 0.5);
            g.player.yaw = Math.PI;
            g.player.pitch = 0;
            return { x, z, ground: here };
          }
        }
      }
      return null;
    });
    await frame();
    await page.evaluate(() => window.voxelcraft.spawnMob('villager', 2.5));
    await until(() => window.voxelcraft.mobs().at(-1)?.onGround === true, null, 10000).catch(() => {});
    return spot;
  };

  return {
    advance,
    closeScreen,
    debugText,
    evaluate,
    frame,
    settled,
    shot,
    stable,
    until,
    useUntil,
    villagerInFront,
  };
}
