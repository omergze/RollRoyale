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

### Simulation Layer (`src/simulation/`, `src/physics/`, & `src/config/arenas.ts`)
- **`arenas.ts`**: Central modular registry defining `Classic Arena` (`19.5m`), `Crater Arena` (`25.5m`, 3 internal holes of radius `3.1m`), `Donut Arena` (`23.0m`, central hole of radius `7.2m`), and `Bumper Arena` (`22.5m`, 4 kinetic bumper pillars of radius `1.35m`), including camera framing parameters and visual themes.
- **`GameSimulation.ts`**: Completely DOM-independent and Three.js-independent simulation engine. Uses a fixed timestep (`1 / 60` s) accumulator and returns an interpolation factor `alpha` (`0..1`) so gameplay physics behave identically at 30fps, 60fps, 120fps, or 144fps. Supports deterministic PRNG seeding (`MatchConfig.seed`) and map resolution (`resolveMapSelection`).
- **`PhysicsWorld.ts`**: Encapsulates Rapier 3D (`@dimforge/rapier3d-compat`). Dynamically builds either a solid cylinder collider (when `holes.length === 0`) or a **static triangulated mesh (`ColliderDesc.trimesh`)** with real physical hole openings and smooth vertical hole shaft walls (exact polar annulus trimesh for `Donut Arena` and iso-clipped polar grid + cylindrical hole walls for `Crater Arena`). During the final 30-second shrink, trimesh rebuilds are throttled to `0.22m` radius steps so holes remain at fixed world positions without per-frame collider rebuild overhead. Also manages fixed cylindrical bumper colliders and CCD-enabled sphere rigid bodies.
- **`MovementController.ts`**: Implements arcade rolling-ball feel—smooth directional acceleration, lateral turn-grip damping when cornering, controlled braking when input is released, boost burst + sustain forces, and **post-hit knockback momentum preservation** (`knockbackTimer`). While `knockbackTimer > 0`, reverse-braking traction and turn-grip cancellation are temporarily reduced (`POST_HIT_MIN_TRACTION = 0.24`) while preserving perpendicular Directional Influence (`POST_HIT_DI_STEER_FACTOR = 0.58`), ensuring heavy hits carry across the arena while still rewarding skillful defensive steering.
- **`CollisionSystem.ts`**: Resolves ball-to-ball combat collisions across **5 distinct impact tiers** (`glancing`, `normal`, `heavy`, `boost`, `perfect_boost`) with a `0.14s` per-pair cooldown, plus **`resolveBumperCollision`** for kinetic bumper pillars (`17.5 u/s` radial rebound with a `0.22s` per-bumper cooldown while preserving `ball.lastHit` for bank-shot knockouts).
- **`ArenaSystem.ts`**: Tracks the active `ArenaDefinition`, outer shrink progress, physical hole overlap (`getOverlappingHole`), deck safety checks (`isPositionSafeOnDeck`), ring-out & hole fall detection (`checkOutOfBounds` returning `{ out, viaHole }`), proximity danger level (`getHazardDangerLevel`), and hole/bumper-safe spawn and respawn positioning.
- **`ScoringSystem.ts`**: Credits knockouts (`+1` score, with `viaHole: boolean`) when a victim falls off the outer edge or through an internal hole within `5.0s` of an opponent collision, filters out unassisted self-falls, tracks streaks, and computes deterministic rankings.

### AI Layer (`src/ai/BotController.ts`)
- Bots emit standard `PlayerInputCommand` objects (`moveX`, `moveZ`, `boostPressed`) and obey the exact same physics and cooldown rules as the player.
- Priority hierarchy:
  1. **Multi-Hazard Survival Recovery (`evaluateHazardRecovery`)**: Evaluates both outer rim proximity and every internal hole (`arena.holes`) using velocity lookahead. When approaching an outer edge or internal hole rim, steers along the escape vector (inward from the outer rim or radially outward from a hole center) and triggers emergency boost when urgent.
  2. **Anti-Clustering & Hazard-Vulnerability Target Selection (`selectBestTarget` & `computeBestHazardPushForTarget`)**: Scores opponents by distance, crowd penalties (`pursuerCount` + local neighbor density), and **proximity to either the outer edge or any internal hole** (`hazardPush.vulnerability`), enabling bots to line up knockouts into nearby holes as well as off the outer rim.
  3. **Momentum-Building Run-Ups & Radial/Hole Flank Positioning (`computeAttackApproachDirection`)**: Positions behind the target along `hazardPush.pushDir` so the impact drives the target toward the nearest hole or outer edge.
  4. **Tangent Waypoint Deflection & 16-Ray Context Steering (`steerAroundHazardsAndObstacles` & `isBoostTrajectorySafe`)**: When the direct line to a target crosses an internal hole (such as the `Donut Arena` central void or `Crater Arena` pits) or a bumper pillar, bots compute a tangent waypoint around the obstacle and evaluate a 16-direction context steering ring to navigate smoothly around hazards. Multi-point trajectory sampling (`isBoostTrajectorySafe`) prevents bots from boosting into holes or off edges.

### Rendering Layer (`src/rendering/`)
- **`SceneManager.ts`**: Manages `THREE.WebGLRenderer`, ACES Filmic tone mapping, soft shadows (`shadowExtent = 30`), and quality presets (`low`, `medium`, `high`).
- **`ArenaRenderer.ts`**: Builds true 3D perforated arena decks using `THREE.ExtrudeGeometry` with `THREE.Path` holes so internal holes are genuine 3D openings. Renders glowing 3D warning rims, recessed abyssal shaft coils, animated kinetic bumper pillars (`triggerBumperPulse`), and arena-themed procedural deck textures.
- **`BallRenderer.ts`**: Generates high-contrast striped sphere textures, applies squash-and-stretch deformations, pulses the ground locator ring orange/magenta when `entity.dangerLevel > 0.28` near a hole or edge, renders spawn-protection shields, and draws floating score/name sprites.
- **`EffectsRenderer.ts`**: Object-pooled spark particles and expanding shockwave rings. Emits directional knockback spark cones, dual Perfect Impact shockwave rings, abyssal hole knockout geysers/vortex rings (`viaHole = true`), and emerald/cyan bumper rebound bursts.
- **`CameraController.ts`**: Arena-adaptive elevated follow camera that scales `cameraHeight`, `cameraDistance`, and `cameraTrackClamp` per `ArenaDefinition` and current shrink radius so larger arenas (`Crater 25.5m`, `Donut 23m`, `Bumper 22.5m`) and internal holes remain clearly framed on desktop, iPad, and mobile.

---

## 3. Online multiplayer architecture (implemented)

Solo mode still runs `LocalLoopbackAdapter` and its own `GameSimulation` entirely in the browser. It never needs a server. `OnlineMode` is a separate Colyseus client path. It connects only after Online Play is selected and renders server snapshots through the existing `SceneManager`.

`server/src/OnlineRoom.ts` owns one authoritative `GameSimulation` per private room. It accepts 2–8 human participants, never backfills with bots, and runs `stepFixed(1/60)` on the server. The simulation uses the same Rapier world, movement, Perfect Impact, collision, scoring, arena hazard, shrinking, and respawn code as solo. Clients submit only movement, boost, sequence, and send time; the room validates sequence and vector bounds and limits accepted input to roughly 83 messages per second. Colyseus WebSocket messages carry reliable collision/knockout/match events. Snapshots are sent every third physics step (nominally 20 Hz), with an extra snapshot on events.

A six-character code maps to a live room ID in server memory. `/rooms/:code` resolves the code; `/health` reports room count, RSS memory, last step duration, and approximate snapshot JSON size. One process owns all rooms. Codes and rooms do not survive a server restart; no database or Redis is required. Host changes are broadcast when the old host leaves. A dropped player has 15 seconds to reconnect with the Colyseus reconnection token; their ball is inactive during the gap, then safely respawns with the same score/session. Permanent leavers are removed from the simulation. If fewer than two connected players remain, the match ends.

The client tracks input sequence acknowledgements but does not replay Rapier inputs. Rapier is not deterministic across browser/server environments. Instead it extrapolates the local ball from the last authoritative velocity for at most 50 ms, blends toward each new server state, and snaps only after a large correction. Remote balls interpolate between two 20 Hz snapshots. This is bounded visual prediction; the server always decides physics and scoring. Higher latency and jitter require more tuning and testing on deployed infrastructure.

Protocol messages: `ready:boolean`, `map:ArenaId|random` (host only), `start` (host only), `input:{sequence,moveX,moveZ,boostPressed,sentAt}`, `ping:number`, `sync`; server replies with `welcome`, `lobby`, `countdown`, `started`, `snapshot:{snapshot,acks}`, `events`, `pong`, and `error`. The server alone resolves Random Map. Results are followed by the same lobby after eight seconds, with ready flags cleared.

The frontend is still a Vite static build suitable for Cloudflare Workers Static Assets. The backend is a separate Node.js/WebSocket service. Set `VITE_MULTIPLAYER_URL` to the backend HTTPS origin before the frontend build; the SDK uses WSS for WebSockets. Development defaults to the Vite host on port 2567. No production URL is committed.
