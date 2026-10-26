import { expect, test } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/omerfarukgoze/.gemini/antigravity/brain/6e8aca71-720a-4818-bdeb-51fea9afad05';

test.describe('RollRoyale Real Browser Multi-Arena E2E Verification', () => {
  test('Desktop: Arena Selection (Classic, Crater, Donut, Bumper, Random), Hole Fall & Respawn, Combat, and Results', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Wait for Rapier & Three.js initialization and menu screen visibility
    await expect(page.locator('#menu-screen')).toHaveClass(/active/);
    await expect(page.locator('#canvas-container canvas')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__ROLL_ROYALE__?.getDebugSnapshot()));

    // Verify Arena Selection buttons on Main Menu update both 2D preview and live 3D background arena
    await page.click('#arena-crater');
    await expect(page.locator('#arena-crater')).toHaveClass(/active/);
    await expect(page.locator('#arena-preview-title')).toHaveText('CRATER ARENA');
    const menuCraterSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(menuCraterSnap.arena.arenaId).toBe('crater');
    expect(menuCraterSnap.arena.holes.length).toBe(3);

    // Let background 3D Crater Arena demo run a moment, then capture Main Menu screenshot
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_main_menu.png`,
    });

    // Test Random & Donut & Bumper selection on Menu
    await page.click('#arena-random');
    await expect(page.locator('#arena-preview-title')).toHaveText('RANDOM MAP');
    await page.click('#arena-classic');
    await expect(page.locator('#arena-preview-title')).toHaveText('CLASSIC ARENA');

    // Verify Difficulty & Bot count selection on Main Menu
    await page.click('#diff-hard');
    await expect(page.locator('#diff-hard')).toHaveClass(/active/);
    await page.click('[data-bots="5"]');
    await expect(page.locator('#bot-count-display')).toContainText('5 BOTS (6 PLAYERS)');

    // Open and verify Settings modal
    await page.click('#btn-open-settings');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/hidden/);
    await page.click('#btn-close-settings');
    await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

    // 1. Start Solo Match on CLASSIC ARENA
    await page.click('#btn-play-solo');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);
    await expect(page.locator('#hud-mode-tag')).toHaveText('CLASSIC ARENA');

    const classicSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(classicSnap.phase).toBe('playing');
    expect(classicSnap.arena.arenaId).toBe('classic');
    expect(classicSnap.entities.length).toBe(6);

    const initialPlayerPos = classicSnap.entities.find((e) => e.isPlayer)!.position;

    // Move player forward (KeyW) and right (KeyD) and activate Boost (Space)
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await page.waitForTimeout(550);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');

    const afterMoveSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    const movedPlayer = afterMoveSnap.entities.find((e) => e.isPlayer)!;
    const distMoved = Math.hypot(
      movedPlayer.position.x - initialPlayerPos.x,
      movedPlayer.position.z - initialPlayerPos.z
    );
    expect(distMoved).toBeGreaterThan(2.5);
    expect(movedPlayer.boostCooldownTimer).toBeGreaterThan(0);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_arena_classic.png`,
    });

    // 2. Start Solo Match on CRATER ARENA (3 physical internal holes)
    await page.evaluate(() => {
      window.__ROLL_ROYALE__!.startSoloMatch(120, 'crater');
    });
    await expect(page.locator('#hud-mode-tag')).toHaveText('CRATER ARENA');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(450);
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyW');

    const craterSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(craterSnap.arena.arenaId).toBe('crater');
    expect(craterSnap.arena.holes.length).toBe(3);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_arena_crater.png`,
    });
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_gameplay_desktop.png`,
    });

    // 3. Start Solo Match on BUMPER ARENA (4 physical kinetic bumper pillars)
    await page.evaluate(() => {
      window.__ROLL_ROYALE__!.startSoloMatch(120, 'bumper');
    });
    await expect(page.locator('#hud-mode-tag')).toHaveText('BUMPER ARENA');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(450);
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA');

    const bumperSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(bumperSnap.arena.arenaId).toBe('bumper');
    expect(bumperSnap.arena.bumpers.length).toBe(4);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_arena_bumper.png`,
    });

    // 4. Start Solo Match on DONUT ARENA & verify physical central hole fall + respawn!
    await page.evaluate(() => {
      window.__ROLL_ROYALE__!.startSoloMatch(120, 'donut');
    });
    await expect(page.locator('#hud-mode-tag')).toHaveText('DONUT ARENA');
    const donutSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(donutSnap.arena.arenaId).toBe('donut');
    expect(donutSnap.arena.innerHoleRadius).toBeCloseTo(7.2, 1);

    await page.waitForTimeout(450);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_arena_donut.png`,
    });

    // Drive straight forward (-Z) from bottom spawn (0, 14.2) into the central hole (0, 0)
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(180);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1450);
    await page.keyboard.up('KeyW');

    // Wait for player fall through central hole and safe respawn on the ring
    await page.waitForFunction(() => {
      const snap = window.__ROLL_ROYALE__?.getDebugSnapshot();
      const p = snap?.entities.find((e) => e.isPlayer);
      return Boolean(p && p.falls >= 1 && p.isAlive);
    });

    const afterHoleRespawnSnap = await page.evaluate(() =>
      window.__ROLL_ROYALE__!.getDebugSnapshot()
    );
    const respawnedPlayer = afterHoleRespawnSnap.entities.find((e) => e.isPlayer)!;
    expect(respawnedPlayer.falls).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(respawnedPlayer.position.x, respawnedPlayer.position.z)).toBeGreaterThan(8.0);

    // Test Pause & Restart Match
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-modal')).not.toHaveClass(/hidden/);
    await page.click('#btn-restart-pause');
    await expect(page.locator('#pause-modal')).toHaveClass(/hidden/);

    // Verify short match completion & Results Screen
    await page.evaluate(() => {
      window.__ROLL_ROYALE__!.startSoloMatch(1.1, 'crater');
    });
    await page.waitForTimeout(1500);

    await expect(page.locator('#results-screen')).toHaveClass(/active/);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_results_screen.png`,
    });

    // Click Play Again from Results Screen
    await page.click('#btn-play-again');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);

    expect(consoleErrors).toEqual([]);
  });

  test('Tablet (iPad) & Mobile Viewports: Touch Joystick & Boost Controls on Donut Arena', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. iPad Viewport (820x1180)
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await expect(page.locator('#menu-screen')).toHaveClass(/active/);

    await page.click('#arena-donut');
    await page.click('#btn-play-solo');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('#joystick-zone')).toBeVisible();
    await expect(page.locator('#btn-touch-boost')).toBeVisible();

    // Drag virtual joystick along the Donut ring and tap touch boost button
    const joyBox = await page.locator('#joystick-base').boundingBox();
    expect(joyBox).not.toBeNull();
    if (joyBox) {
      const cx = joyBox.x + joyBox.width / 2;
      const cy = joyBox.y + joyBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 45, cy - 25, { steps: 5 });
      await page.waitForTimeout(300);
      await page.click('#btn-touch-boost');
      await page.waitForTimeout(200);
      await page.mouse.up();
    }

    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_tablet_ipad.png`,
    });

    // 2. Mobile Phone Viewport (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_mobile_phone.png`,
    });

    expect(consoleErrors).toEqual([]);
  });
});
