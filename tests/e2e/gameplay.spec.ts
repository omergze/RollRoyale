import { expect, test } from '@playwright/test';

const ARTIFACT_DIR =
  '/Users/omerfarukgoze/.gemini/antigravity/brain/6e8aca71-720a-4818-bdeb-51fea9afad05';

test.describe('RollRoyale Real Browser E2E Verification', () => {
  test('Desktop: Main Menu, Solo Match, Movement, Boost, AI Bots, Pause/Restart, and Results', async ({
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

    // Let background 3D arena demo run a moment, then capture Main Menu screenshot
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_main_menu.png`,
    });

    // Verify Difficulty & Bot count selection on Main Menu
    await page.click('#diff-hard');
    await expect(page.locator('#diff-hard')).toHaveClass(/active/);
    await page.click('[data-bots="6"]');
    await expect(page.locator('#bot-count-display')).toContainText('6 BOTS (7 PLAYERS)');

    // Open and verify Settings modal
    await page.click('#btn-open-settings');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/hidden/);
    await page.click('#btn-close-settings');
    await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

    // Start Solo Match
    await page.click('#btn-play-solo');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);

    const initialSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    expect(initialSnap.phase).toBe('playing');
    expect(initialSnap.entities.length).toBe(7); // 1 player + 6 bots

    const initialPlayerPos = initialSnap.entities.find((e) => e.isPlayer)!.position;

    // Move player forward (KeyW) and right (KeyD) and activate Boost (Space)
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await page.waitForTimeout(650);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');

    const afterMoveSnap = await page.evaluate(() => window.__ROLL_ROYALE__!.getDebugSnapshot());
    const movedPlayer = afterMoveSnap.entities.find((e) => e.isPlayer)!;

    // Verify player moved significantly and boost cooldown was triggered
    const distMoved = Math.hypot(
      movedPlayer.position.x - initialPlayerPos.x,
      movedPlayer.position.z - initialPlayerPos.z
    );
    expect(distMoved).toBeGreaterThan(2.5);
    expect(movedPlayer.boostCooldownTimer).toBeGreaterThan(0);

    // Verify AI bots also moved autonomously
    const botsMoved = afterMoveSnap.entities
      .filter((e) => !e.isPlayer)
      .every((b, idx) => {
        const startBot = initialSnap.entities.filter((e) => !e.isPlayer)[idx];
        return (
          Math.hypot(b.position.x - startBot.position.x, b.position.z - startBot.position.z) > 0.5
        );
      });
    expect(botsMoved).toBe(true);

    // Capture Active Gameplay screenshot
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_gameplay_desktop.png`,
    });

    // Test Pause & Restart Match
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-modal')).not.toHaveClass(/hidden/);
    await page.click('#btn-restart-pause');
    await expect(page.locator('#pause-modal')).toHaveClass(/hidden/);

    // Verify short match completion & Results Screen
    await page.evaluate(() => {
      window.__ROLL_ROYALE__!.startSoloMatch(1.2);
    });
    await page.waitForTimeout(1600);

    await expect(page.locator('#results-screen')).toHaveClass(/active/);
    await page.screenshot({
      path: `${ARTIFACT_DIR}/rollroyale_results_screen.png`,
    });

    // Click Play Again from Results Screen
    await page.click('#btn-play-again');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);

    expect(consoleErrors).toEqual([]);
  });

  test('Tablet (iPad) & Mobile Viewports: Touch Joystick & Boost Controls Verification', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. iPad Landscape / Portrait Tablet Viewport (820x1180)
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await expect(page.locator('#menu-screen')).toHaveClass(/active/);

    await page.click('#btn-play-solo');
    await expect(page.locator('#hud-screen')).toHaveClass(/active/);
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('#joystick-zone')).toBeVisible();
    await expect(page.locator('#btn-touch-boost')).toBeVisible();

    // Drag virtual joystick and tap touch boost button
    const joyBox = await page.locator('#joystick-base').boundingBox();
    expect(joyBox).not.toBeNull();
    if (joyBox) {
      const cx = joyBox.x + joyBox.width / 2;
      const cy = joyBox.y + joyBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 40, cy - 45, { steps: 5 });
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
