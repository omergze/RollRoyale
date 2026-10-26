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
- Milestone 1 (Single-Player Knockout Rush, 3D Arena with Final-30s Shrink, Rolling Physics, Boost, Knockback & Attribution, Normal/Hard AI Bots, Desktop & iPad Touch Controls, Web Audio Synth, LocalStorage Stats, Unit & E2E Tests) is **complete and passing**.

### What to Build Next (Milestone 2 / Polish)
1. **Solo Challenge Modes**:
   - Add an optional mode selector on the Main Menu for **Survival Rush** (endless waves of bots where 1 fall = game over) or **Target Blitz** (first to 10 Knockouts wins).
2. **Dynamic Arena Obstacles (Optional Variant)**:
   - Add a second arena variant featuring a central pulsing energy bumper pillar using a kinematic Rapier cylinder collider.
3. **Colyseus Authoritative Multiplayer Prototype**:
   - Create a `server/` workspace using Node.js + `colyseus` that hosts `GameSimulation` and implements a `ColyseusNetworkAdapter` client in `src/network/`.
