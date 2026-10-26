# RollRoyale Testing & Validation Guide

RollRoyale includes both **deterministic unit/physics simulation tests (Vitest)** and **real-browser end-to-end tests (Playwright)**.

---

## 1. Automated Unit & Simulation Tests (`tests/unit/simulation.test.ts`)

Run with:

```bash
npm test
```

### What Is Tested
1. **Player Movement Rules**:
   - Smooth acceleration along input vector (`moveX`, `moveZ`).
   - Top speed clamping at `MAX_MOVE_SPEED` (`15.5` u/s) during standard movement.
   - Controlled braking deceleration when input is released so the ball comes to a clean stop without endless sliding.
   - Visual rolling rotation (`integrateRollingRotation`) proportional to horizontal displacement and sphere radius.
2. **Boost Activation & Cooldown**:
   - Immediate velocity burst + active duration (`0.38s`) and cooldown timer (`3.4s`).
   - Cooldown enforcement preventing repeated boost triggers before cooldown expires.
3. **Collision & Knockback System**:
   - Stronger knockback impulses when the attacker has higher closing speed or is actively boosting.
   - Positional angle bonuses (`1.32x` rear hit, `1.18x` side/flank hit, `1.0x` head-on).
   - Per-pair collision cooldown (`0.16s`) preventing duplicate impulses or double knockout attribution from a single contact.
4. **Knockout Attribution vs. Self-Falls**:
   - Credits `+1` Score and `+1` Knockout to the attacker when the victim leaves the arena within `4.5s` of an opponent impact.
   - Treats unassisted ring-outs (or falls after the attribution window expires) as `self_fall` events that increment the victim's `falls` without awarding points to any opponent.
5. **Deterministic Tie-Breaker Rankings**:
   - Verifies exact tie-breaking order: Score -> Fewer Falls -> Earlier First Knockout Timestamp -> Higher Total Impact Dealt -> Slot Index.
6. **Arena Boundaries & Final 30-Second Shrinking**:
   - Verifies `shrink_start` event emission at `30.0s` remaining and linear contraction of `currentRadius` from `22.0` to `12.5`.
   - Verifies safe interior respawn point selection away from active opponents.
7. **AI Bot Decision Rules (`Normal` & `Hard`)**:
   - Edge danger recovery: bots near the perimeter moving outward steer strongly back toward center and trigger emergency boost.
   - Target selection & strike boost: `Hard` bots prioritize vulnerable edge targets and trigger boost when aligned within strike range.
8. **Full Headless `GameSimulation` Lifecycle**:
   - Multi-entity match start, physical collision knockout, `1.8s` respawn timer, `2.2s` spawn protection shield, and `match_end` transition when `remainingTime` reaches `0`.

---

## 2. Real Browser End-to-End Smoke Tests (`tests/e2e/gameplay.spec.ts`)

Run with:

```bash
npm run test:e2e
```

### What Is Verified in a Real Browser (Chrome + WebGL)
1. Starts the Vite dev server and loads `http://localhost:5173`.
2. Verifies the 3D WebGL canvas and Main Menu render with zero console or page errors.
3. Tests Difficulty (`Normal` / `Hard`), Bot Count (`3`–`7`), and Settings Modal interactions.
4. Starts a Solo Match and verifies `1` human player + `N` AI bots spawn on the arena.
5. Sends real keyboard input (`KeyW`, `KeyD`, `Space`) to move the player ball and trigger boost.
6. Verifies player displacement, boost cooldown activation, and autonomous AI bot movement.
7. Tests Pause (`Escape`) and Match Restart.
8. Verifies Match Completion and the Match Results screen (`Play Again`).
9. Tests **Tablet (iPad `820x1180`)** and **Mobile (`390x844`)** viewports, including dragging the virtual thumbstick (`#joystick-base`) and tapping the touch Boost button (`#btn-touch-boost`).
