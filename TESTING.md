# RollRoyale Testing & Validation Guide

RollRoyale includes both **deterministic unit/physics simulation tests (Vitest)** and **real-browser end-to-end tests (Playwright)**.

---

## 1. Automated Unit & Simulation Tests (`tests/unit/simulation.test.ts`)

Run with:

```bash
npm test
```

### What Is Tested (22 Deterministic Unit, Multi-Arena Physics & Multi-Seed Simulation Tests)
1. **Player Movement, Boost & Post-Hit Knockback Momentum**:
   - Smooth acceleration along input vector (`moveX`, `moveZ`) and top speed clamping at `MAX_MOVE_SPEED` (`16.0` u/s).
   - Controlled braking deceleration when input is released so the ball comes to a clean stop without endless sliding.
   - Immediate boost velocity burst + active duration (`0.42s`) and cooldown timer (`3.0s`), with cooldown enforcement.
   - **Post-Hit Knockback Momentum Preservation**: Verifies that a defender hit at high speed (`knockbackTimer > 0`) cannot instantly cancel knockback by holding reverse brake, while still having limited perpendicular Directional Influence (`DI`) steering.
   - Visual rolling rotation (`integrateRollingRotation`) proportional to horizontal displacement and sphere radius.
2. **Five-Tier Collision System, Perfect Impact & High-Speed Stability**:
   - Monotonic knockback progression across all 5 collision tiers (`glancing` -> `normal` -> `heavy` -> `boost` -> `perfect_boost`).
   - Asymmetric momentum transfer verifying the dominant attacker retains forward follow-through velocity instead of bouncing backward.
   - Positional angle bonuses (`1.32x` rear hit, `1.18x` side/flank hit, `1.0x` head-on).
   - Per-pair collision cooldown (`0.14s`) and velocity clamping (`MAX_RESULTANT_HORIZONTAL_SPEED = 36.0`) under extreme head-on boosted collisions.
3. **Knockout Attribution vs. Self-Falls & Deterministic Tie-Breakers**:
   - Credits `+1` Score and `+1` Knockout to the attacker when the victim leaves the arena within `5.0s` of an opponent impact.
   - Treats unassisted ring-outs as `self_fall` events without awarding opponent points.
   - Verifies exact tie-breaking order: Score -> Fewer Falls -> Earlier First Knockout Timestamp -> Higher Total Impact Dealt -> Slot Index.
4. **Arena Boundaries & Final 30-Second Shrinking**:
   - Verifies `shrink_start` event emission at `30.0s` remaining and linear contraction of `currentRadius` from `19.5` to `11.0`.
   - Verifies safe interior respawn point selection away from active opponents.
5. **AI Bot Decision Rules, Anti-Clustering & Momentum Run-Ups**:
   - Edge danger recovery: bots near the perimeter moving outward steer strongly back toward center and trigger emergency boost.
   - Target selection & strike boost: `Hard` bots prioritize vulnerable edge targets and trigger boost when aligned within strike range.
   - **Anti-Clustering Target Distribution**: Verifies that multiple bots spread across available targets rather than dogpiling a single ball.
6. **Full Headless `GameSimulation` Lifecycle & Multi-Seed Combat Verification**:
   - Multi-entity match start, physical collision knockout, `1.45s` respawn timer, `1.65s` spawn protection shield, and `match_end` transition.
   - **Multi-Seed 45s Combat Simulation (`seeds = [101, 202, 303]`)**: Runs 3 full 6-ball matches (`8,100` physics steps total) verifying regular boosted collisions, genuine knockouts, and zero `NaN` or unbounded velocities.
7. **Multi-Arena System (`Classic`, `Crater`, `Donut`, `Bumper`, `Random`), Physical Holes & AI Navigation**:
   - Verifies arena definitions, hole/bumper counts, and deterministic `resolveMapSelection('random', seed)`.
   - Verifies safe initial spawns (8 players) and 20 dynamic respawns across all 4 arenas (both full size and fully shrunk), guaranteeing no spawn/respawn ever overlaps a hole or bumper.
   - **Physical Hole Fall-Through (`PhysicsWorld` Trimesh Verification)**: Spawns dynamic Rapier sphere bodies on `Crater Arena` and `Donut Arena` to verify that balls on the solid deck remain supported at `y ~ 1.0` while balls over any of Crater's 3 holes or Donut's central hole physically fall through (`y <= -3.8`) and trigger `viaHole: true`.
   - Verifies hole knockout attribution (`viaHole: true`, `+1` score to attacker).
   - Verifies `Bumper Arena` physical radial rebounds (`bumper_hit` event) and bank-shot `lastHit` preservation.
   - Verifies AI tangential navigation around the `Donut Arena` central hole and emergency outward recovery when near an internal hole rim.
   - Runs 35s multi-bot combat simulations across `Crater`, `Donut`, and `Bumper` arenas verifying hole eliminations, bumper hits, knockouts, and zero `NaN` states.

---

## 2. Real Browser End-to-End Smoke Tests (`tests/e2e/gameplay.spec.ts`)

Run with:

```bash
npm run test:e2e
```

### What Is Verified in a Real Browser (Chrome + WebGL)
1. Starts the Vite dev server and loads `http://localhost:5173`.
2. Verifies the 3D WebGL canvas, Main Menu, and Arena Selector (`Classic`, `Crater`, `Donut`, `Bumper`, `Random`) render with zero console or page errors, updating both the 2D schematic canvas and live 3D background battle.
3. Starts Solo Matches across **Classic Arena**, **Crater Arena**, **Bumper Arena**, and **Donut Arena**, verifying `#hud-mode-tag`, movement, boost, and capturing screenshots of each arena.
4. Drives into the central hole on **Donut Arena** and verifies the ball physically falls through (`falls >= 1`) and respawns safely on the ring track.
5. Tests Pause (`Escape`), Match Restart, Match Completion, Results Screen, and **Tablet (iPad `820x1180`)** / **Mobile (`390x844`)** touch controls.
