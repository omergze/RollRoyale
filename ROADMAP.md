# RollRoyale Roadmap

This document distinguishes **genuinely implemented features** in the current first playable release from **planned future milestones**.

---

## Milestone 1 — First Playable Single-Player Release (Implemented)

All items below are implemented, tested, and verified:

- [x] **Core 3D Arena (`ArenaRenderer` & `ArenaSystem`)**
  - Procedural futuristic floating circular arena with sector markings, distance rings, hazard warning track, glowing energy rim, under-deck reactor core, floating monoliths, and starfield.
  - Final 30-second **Arena Shrinking Phase** that smoothly contracts both the visual deck and the physical Rapier 3D cylinder collider from `R = 22.0` to `R = 12.5`, accompanied by pulsing hazard warnings and an original-boundary holographic ghost ring.
- [x] **Rolling-Ball Physics & Movement (`MovementController` & `PhysicsWorld`)**
  - Fixed-step 60Hz Rapier 3D rigid-body simulation with render interpolation (`alpha`) for consistent behavior across 30Hz, 60Hz, 120Hz, and 144Hz displays.
  - Smooth acceleration, lateral turn grip to prevent uncontrollable sliding, controlled braking when input is released, and accurate visual rolling rotation (`integrateRollingRotation`).
- [x] **Boost Mechanic**
  - Directional burst impulse + sustained thruster drive (`0.38s` duration, `3.4s` cooldown).
  - Visual squash-and-stretch deformation, particle trail, sonic burst ring, subtle FOV pull-back, and HUD/touch cooldown indicators.
- [x] **Combat Collision & Knockback System (`CollisionSystem`)**
  - Automatic physical ball-to-ball combat with pair cooldown deduplication (`0.16s`).
  - Knockback scaled by closing speed, attacker velocity, boost state (`1.55x` attack multiplier), and positional hit angle (`1.18x` side/flank bonus, `1.32x` rear hit bonus).
- [x] **Knockout Rush Mode & Scoring (`ScoringSystem`)**
  - 120-second matches with accurate last-hit attribution (`4.5s` attribution window).
  - Distinguishes opponent-assisted **Knockouts** (+1 Score to attacker) from unassisted **Self-Falls** (increments victim's falls only, never falsely credits opponents).
  - Safe interior respawns after `1.8s` with `2.2s` temporary spawn protection shield.
  - Deterministic tie-breaker ranking rules (Score -> Fewer Falls -> Earlier First KO -> Higher Total Impact Dealt -> Slot Index).
- [x] **Autonomous AI Opponents (`BotController`)**
  - Supports 3 to 7 AI bots using the exact same `PlayerInputCommand` and physics rules as the player.
  - **Normal** and **Hard** difficulty profiles with predictive target selection, radial flank positioning, boost strike checks, and emergency edge recovery.
- [x] **Menus, HUD, Audio & Local Persistence**
  - Main Menu over live 3D demo arena battle, Difficulty & Bot Count selectors, Career Personal Best strip, In-Game HUD, Kill Feed, Pause Modal, functional Settings Modal, and Match Results screen.
  - Desktop keyboard (`WASD`/Arrows + `Space` + `Esc`) and multi-touch iPad/Mobile controls (Virtual Joystick + Boost button).
  - Procedural Web Audio API sound effects and `localStorage` persistence.

---

## Milestone 2 — Real-Time Multiplayer (Planned — Not Yet Implemented)

> **Note:** Online multiplayer is **not** implemented in Milestone 1. The codebase is architected via `PlayerInputCommand`, headless `GameSimulation`, and `INetworkAdapter` so multiplayer can be added without rewriting core game logic.

- [ ] **Authoritative Multiplayer Server (Node.js + Colyseus)**
  - Run `GameSimulation` on a Node.js Colyseus room instance at 60Hz (or 30Hz tick / 20Hz snapshot broadcast) for 2–8 human players + backfill bots.
- [ ] **WebSocket Client Adapter (`ColyseusNetworkAdapter`)**
  - Implement `INetworkAdapter` to transmit sequenced `PlayerInputCommand` packets and receive authoritative `SimulationSnapshot` frames.
- [ ] **Client-Side Prediction & Snapshot Interpolation**
  - Local input prediction with server state reconciliation for the local player ball and buffered entity interpolation for remote players.
- [ ] **Room Codes & Quick Play Lobby**
  - Simple room creation and invite links for playing with friends on desktop and iPad.

---

## Milestone 3 — Arena Variety & Solo Challenges (Planned)

- [ ] **Dynamic Arena Hazards**
  - Optional pulsing center bumper pillar or rotating energy barriers in advanced arenas.
- [ ] **Solo Survival & Time-Attack Challenges**
  - Endless wave survival mode and target-knockout speedrun challenges.
- [ ] **Unlockable Ball Trails & Patterns**
  - Earned purely through local solo milestones and personal bests.
