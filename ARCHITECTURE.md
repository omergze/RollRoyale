# RollRoyale Architecture

RollRoyale is designed around a strict separation between **input commands**, **deterministic fixed-step simulation**, **3D physics**, **AI decision-making**, **3D rendering**, and **DOM UI**.

---

## 1. High-Level System Diagram

```text
┌───────────────────┐     PlayerInputCommand     ┌─────────────────────────┐
│   InputManager    │ ─────────────────────────▶ │     INetworkAdapter     │
│ (Keyboard / Touch)│                            │ (LocalLoopbackAdapter)  │
└───────────────────┘                            └────────────┬────────────┘
                                                              │
                                                              ▼
┌───────────────────┐      PlayerInputCommand     ┌─────────────────────────┐
│   BotController   │ ─────────────────────────▶ │     GameSimulation      │
│  (Normal / Hard)  │ ◀───────────────────────── │  (Headless 60Hz Engine) │
└───────────────────┘      Arena & Entity State  └─────┬──────┬──────┬─────┘
                                                       │      │      │
                       ┌───────────────────────────────┘      │      └────────────────────────────┐
                       ▼                                      ▼                                   ▼
         ┌──────────────────────────┐           ┌──────────────────────────┐        ┌──────────────────────────┐
         │       PhysicsWorld       │           │     CollisionSystem      │        │   ArenaSystem & Scoring  │
         │ (@dimforge/rapier3d-wasm)│           │ (Knockback & Attribution)│        │ (Shrink, Respawn, Ranks) │
         └──────────────────────────┘           └──────────────────────────┘        └──────────────────────────┘
                                                              │
                                           SimulationSnapshot │ + GameEvent[] + alpha
                                                              ▼
                                     ┌────────────────────────┴────────────────────────┐
                                     ▼                                                 ▼
                       ┌──────────────────────────┐                      ┌──────────────────────────┐
                       │       SceneManager       │                      │    UIManager & Audio     │
                       │ (Three.js Arena/Balls/FX)│                      │  (HUD, Menus, WebAudio)  │
                       └──────────────────────────┘                      └──────────────────────────┘
```

---

## 2. Core Modules

### Simulation Layer (`src/simulation/` & `src/physics/`)
- **`GameSimulation.ts`**: Completely DOM-independent and Three.js-independent simulation engine. Uses a fixed timestep (`1 / 60` s) accumulator and returns an interpolation factor `alpha` (`0..1`) so gameplay physics behave identically at 30fps, 60fps, 120fps, or 144fps.
- **`PhysicsWorld.ts`**: Encapsulates Rapier 3D (`@dimforge/rapier3d-compat`). Manages the fixed cylinder arena collider (including dynamic collider resizing during the final 30-second shrink) and dynamic CCD-enabled sphere rigid bodies.
- **`MovementController.ts`**: Implements arcade rolling-ball feel—smooth directional acceleration, lateral turn-grip damping (eliminating ice-rink sliding when cornering), controlled braking when input is released, boost burst + sustain forces, and quaternion rolling rotation integration.
- **`CollisionSystem.ts`**: Resolves ball-to-ball combat collisions with a `0.16s` per-pair cooldown. Computes knockback impulses from closing speed, individual velocity, boost state (`1.55x` offensive multiplier, `0.78x` defensive resistance), and attack angle (`1.18x` side flank, `1.32x` rear strike). Records `LastHitAttribution` on both balls.
- **`ArenaSystem.ts`**: Tracks the playable radius (`22.0` units down to `12.5` units during the final 30 seconds), detects ring-outs (`y <= -4.2` or below deck outside the rim), and selects safe interior respawn points that maximize distance from active opponents.
- **`ScoringSystem.ts`**: Credits knockouts when a victim falls within `4.5s` of an opponent collision, filters out unassisted self-falls, tracks streaks, and computes deterministic rankings.

### AI Layer (`src/ai/BotController.ts`)
- Bots emit standard `PlayerInputCommand` objects (`moveX`, `moveZ`, `boostPressed`) and obey the exact same physics and cooldown rules as the player.
- Priority hierarchy:
  1. **Edge Danger Recovery**: Projects position using velocity lookahead (`position + velocity * lookahead`). When approaching or exceeding the danger threshold ratio, steers inward toward the arena center and triggers emergency boost if critical.
  2. **Target Evaluation**: Scores alive opponents by distance, edge vulnerability (`radialDist / currentRadius`), and spawn protection state.
  3. **Radial Flank Positioning**: Hard bots stage slightly behind the target along the center-to-target vector so collisions push opponents outward toward the rim.
  4. **Boost Strike Check**: Activates boost only when aligned with a target in strike range AND when the projected boost trajectory remains safely inside the arena boundary.

### Rendering Layer (`src/rendering/`)
- **`SceneManager.ts`**: Manages `THREE.WebGLRenderer`, ACES Filmic tone mapping, soft shadows, and quality presets (`low`, `medium`, `high`).
- **`ArenaRenderer.ts`**: Generates high-DPI procedural canvas textures for the arena deck, hazard chevrons, glowing rim torus, under-deck reactor core, and distant floating monoliths.
- **`BallRenderer.ts`**: Generates high-contrast striped sphere textures so rolling rotation is clearly visible, applies squash-and-stretch impact/boost deformations, renders spawn-protection shields, and draws floating score/name sprites.
- **`EffectsRenderer.ts`**: Object-pooled spark particles and expanding shockwave rings for zero-allocation combat feedback.
- **`CameraController.ts`**: Elevated, angled follow camera (`56%` player tracking + `44%` arena center framing) with subtle boost FOV response and optional impact micro-shake.

---

## 3. Future Server-Authoritative Multiplayer Architecture (Node.js + Colyseus)

Because `GameSimulation` has zero browser DOM or Three.js dependencies and communicates exclusively through serializable `PlayerInputCommand` and `SimulationSnapshot` structures, transitioning to real-time WebSocket multiplayer requires no rewrite of the simulation or rendering layers:

1. **Authoritative Server Room (`Colyseus`)**:
   - A Node.js server imports `GameSimulation` and `@dimforge/rapier3d-compat`.
   - Each match room runs `simulation.stepFixed(1 / 60)` on a server timer.
   - Connected clients send `{ sequence, moveX, moveZ, boostPressed }` input messages; unfilled slots are driven by `BotController`.
2. **Client-Side Prediction & Reconciliation**:
   - Implement `ColyseusNetworkAdapter` conforming to `INetworkAdapter`.
   - The client immediately applies local inputs to a predicted local state buffer while tagging each input with a monotonically increasing `sequence` number.
   - When an authoritative `SimulationSnapshot` arrives from the server, the client reconciles its position/velocity and replays unacknowledged inputs where `sequence > lastAckedSequence`.
3. **Remote Entity Interpolation**:
   - Remote balls are rendered using a 100ms interpolation buffer (`lerpVec3` and `slerpQuat` between the two most recent authoritative server snapshots) to guarantee smooth 60fps visuals even under network jitter.
