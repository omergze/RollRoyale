# AGENTS.md — Developer & Coding Agent Handover Guide

This file is designed for coding agents (such as **Codex Cloud** on iPad) and human developers continuing work on **RollRoyale**.

---

## 1. Quick Commands

```bash
# Install dependencies
npm install

# Run strict TypeScript typecheck
npm run typecheck

# Run Vitest unit & headless Rapier 3D physics tests
npm test

# Build production bundle (runs tsc --noEmit && vite build)
npm run build

# Start local development server on http://localhost:5173
npm run dev

# Run Playwright real-browser E2E smoke tests
npm run test:e2e
```

---

## 2. Architectural Rules & Conventions

1. **Strict Separation of Simulation and Rendering**:
   - Never import `three` or reference `document`/`window` inside `src/simulation/`, `src/physics/`, or `src/ai/`.
   - `GameSimulation` must remain 100% headless and deterministic so it runs identically in Node.js (Vitest / future Colyseus server) and in the browser.
2. **Fixed-Timestep Physics**:
   - All physics and gameplay mutations happen inside `GameSimulation.stepFixed(dt)` at `dt = 1 / 60` (`PHYSICS_CONSTANTS.FIXED_TIMESTEP`).
   - Do not directly overwrite Rapier rigid-body positions per render frame. Apply velocities via `MovementController` and `CollisionSystem` during fixed steps, and let `BallRenderer` interpolate between `prevPosition`/`prevRotation` and `position`/`rotation` using `alpha`.
3. **Fair AI Opponents**:
   - Bots in `src/ai/BotController.ts` must only output a `PlayerInputCommand` (`moveX`, `moveZ`, `boostPressed`).
   - Never give `Hard` bots higher max speed, shorter cooldowns, or extra mass. `Hard` bots win through better target prioritization, radial flank staging, predictive lead aiming, and smarter edge recovery.
4. **Touch & iPad Compatibility**:
   - Keep `touch-action: none` and `user-select: none` on interactive game layers.
   - Ensure any new HUD buttons have a minimum `44x44px` touch target and do not obstruct `#joystick-zone` (bottom-left) or `#btn-touch-boost` (bottom-right).

---

## 3. Current Status & Recommended Next Tasks for Codex Cloud

### Current Status
- **Milestone 1** (Single-Player Knockout Rush, 3D Arena with Final-30s Shrink, Rolling Physics, Boost, Knockback & Attribution, Normal/Hard AI Bots, Desktop & iPad Touch Controls, Web Audio Synth, LocalStorage Stats, Unit & E2E Tests) is **complete and passing**.
- **Gameplay Feel, Knockback & AI Improvement Update** (5-Tier Collision System `glancing`/`normal`/`heavy`/`boost`/`perfect_boost`, `0.24s` Perfect Impact surge window, Post-Hit Knockback Momentum Preservation `knockbackTimer` with limited DI steering, Anti-Clustering AI with crowd penalties & momentum run-ups, Directional Impact Cones & Dual Shockwave Rings, Centralized Tuning Config in `src/config/constants.ts`, Vitest unit/multi-seed suite & Playwright E2E suite) is **complete and passing**.
- **Multi-Arena & Gameplay Expansion Update** (Modular `src/config/arenas.ts` registry for `Classic Arena`, `Crater Arena` with 3 physical trimesh floor holes, `Donut Arena` with central physical void, `Bumper Arena` with 4 kinetic pulse pillars, and `Random Map`; Extruded 3D perforated decks & glowing hole shafts in `ArenaRenderer.ts`; Hole knockout attribution `viaHole: true` & bank-shot bumper attribution; AI hole/bumper tangent navigation & 16-ray context steering; Arena-adaptive `CameraController`; Main Menu Arena Selector + 2D schematic preview + per-arena best scores; 22-test Vitest suite & Multi-Arena Playwright E2E suite) is **complete and passing**.

### What to Build Next (Milestone 3 / Polish)
1. **Solo Challenge Modes**:
   - Add an optional mode selector on the Main Menu for **Survival Rush** (endless waves of bots where 1 fall = game over) or **Target Blitz** (first to 10 Knockouts wins).
2. **Online multiplayer follow-up**:
   - Validate the private-room backend on European hosting with real devices. Tune latency behavior and expand long-running browser tests. See ARCHITECTURE.md and TESTING.md.

## Online development handover

The server package is independent: `npm ci --prefix server --legacy-peer-deps`, `npm run dev --prefix server`, `npm test --prefix server`, `npm run build --prefix server`. The browser uses `@colyseus/sdk` 0.18 with Colyseus server 0.18. Keep versions compatible. In local Vite development the browser reaches the backend at the same hostname on port 2567. Production requires `VITE_MULTIPLAYER_URL` at build time; do not hardcode a URL or put secrets in `VITE_` variables. Solo Play must remain independent of backend availability.

`GameSimulation.startMatch({ humanPlayers })` is the server path. Do not feed bots into online rooms. Do not move scoring or hit detection to clients. The server validates client commands and runs Rapier; the browser only extrapolates visuals for up to 50 ms. See `server/src/OnlineRoom.ts` for room messages, reconnect grace, and snapshot rate. New gameplay balance changes must be checked in both solo and server simulation tests.
