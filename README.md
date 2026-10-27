# RollRoyale

**RollRoyale** is a fast-paced, physics-based 3D arcade knockout game built with **TypeScript**, **Vite**, **Three.js**, and **Rapier 3D**.

Players control colorful rolling spheres across multiple floating arenas—using momentum, directional positioning, kinetic bumpers, and high-speed boosts to knock opponents off the outer rim or into abyssal floor pits while avoiding ring-outs during the final 30-second arena shrink phase.

---

## Playable Arenas

RollRoyale features a modular multi-arena system selectable from the Main Menu (with both a 2D tactical schematic preview and a live 3D background battle preview):

1. **Classic Arena (`classic` · `19.5m` -> `11.0m`)**:
   - Balanced circular knockout platform with no internal hazards. Ideal for pure high-speed collisions and final-30s rim duels.
2. **Crater Arena (`crater` · `25.5m` -> `16.2m`)**:
   - Expanded circular deck perforated by **3 real physical gravity craters** (`3.1m` radius each at $30^\circ, 150^\circ, 270^\circ$). Balls physically fall through the floor openings using static Rapier `trimesh` collision geometry and extruded 3D visual geometry.
3. **Donut Arena (`donut` · `23.0m` -> `16.5m`)**:
   - Ring-shaped orbital arena with a massive **central void** (`7.2m` inner hole radius). Enemies can be eliminated either into the central core or off the outer perimeter.
4. **Bumper Arena (`bumper` · `22.5m` -> `13.8m`)**:
   - High-action circular arena equipped with **4 kinetic pulse bumper pillars** that deliver bounded radial rebounds (`17.5 u/s`) and preserve `lastHit` attribution for bank-shot knockouts.
5. **Random Map (`random`)**:
   - Selects one of the 4 arenas at match start for varied replayability.

---

## Requirements

- **Node.js**: `>= 20.0.0` (tested on Node `v22+`)
- **npm**: `>= 10.0.0`
- A modern browser with WebGL2 and WebAssembly support (Chrome, Safari, Firefox, Edge, iPadOS Safari)

---

## Installation

```bash
npm install
```

---

## Local Development

Start the Vite development server with hot module replacement:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Production Build

Run strict TypeScript type checking and build the production bundle into `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

### Cloudflare Workers static-assets deployment

The production bundle is deployed as a static-assets-only Worker. The explicit
[`wrangler.jsonc`](wrangler.jsonc) config points Wrangler at `./dist`, so it
does not invoke Vite framework auto-configuration (which requires Vite 6 or
newer). Vite 5 remains supported.

In the Cloudflare Worker Git integration, use the repository root as the root
directory, `npm run build` as the build command, and the following deploy
command:

```bash
npx wrangler deploy --config wrangler.jsonc
```

For a local authenticated deployment, run `npm run build` first and then:

```bash
npm run deploy:cloudflare
```

---

## Testing

### Unit & Headless Physics Simulation Tests (Vitest)

Runs 22 deterministic tests covering rolling-ball movement, boost activation/cooldown, 5-tier collision knockback, Perfect Impact, directional hit bonuses, knockout attribution (both outer edge and `viaHole` internal pits), deterministic tie-breakers, arena shrinking, safe spawns/respawns across all 4 arenas, physical Rapier `trimesh` hole fall-through, bumper rebounds, AI hole/obstacle navigation, and multi-seed matches:

```bash
npm test
```

### TypeScript Type Check

```bash
npm run typecheck
```

### End-to-End Browser Smoke Tests (Playwright)

Starts the development server, launches a real browser, tests the Main Menu Arena Selector (`Classic`, `Crater`, `Donut`, `Bumper`, `Random`), Solo Match across all 4 arenas, physical hole fall & respawn on Donut Arena, keyboard movement, boost, AI opponents, pause/restart, match results, and tablet/mobile touch controls:

```bash
npm run test:e2e
```

---

## Controls

### Desktop Controls

| Input | Action |
| :--- | :--- |
| **W / A / S / D** or **Arrow Keys** | Roll & steer ball in 4/8 directions |
| **Space** or **Shift** | Activate Boost burst (`0.42s` duration, `3.0s` cooldown, `0.24s` **Perfect Impact** surge window) |
| **Escape** or **P** | Pause / Resume match |

### iPad & Mobile Touchscreen Controls

| Input | Action |
| :--- | :--- |
| **Left Virtual Thumbstick** | Drag in any direction for analog 360° movement |
| **Right BOOST Button** | Tap to trigger Boost burst (supports simultaneous multi-touch while steering) |
| **Top-Right Pause Button (`❚❚`)** | Open Pause & Settings modal |

---

## Project Structure

```text
RollRoyale/
├── index.html                  # Application shell, Main Menu, Arena Selector, HUD, Modals, Results UI
├── package.json                # Scripts and dependencies
├── tsconfig.json               # Strict TypeScript configuration
├── vite.config.ts              # Vite bundler and Vitest configuration
├── playwright.config.ts        # Playwright browser E2E test configuration
├── src/
│   ├── main.ts                 # Application bootstrap & main frame loop
│   ├── types/
│   │   └── game.ts             # Core serializable state, arena, input, event, and config types
│   ├── config/
│   │   ├── arenas.ts           # Modular definitions for Classic, Crater, Donut, and Bumper arenas
│   │   └── constants.ts        # Tuned physics, combat, boost, AI difficulty, and graphics constants
│   ├── utils/
│   │   └── math.ts             # Pure vector, quaternion, and rolling rotation helpers
│   ├── physics/
│   │   └── PhysicsWorld.ts     # Rapier 3D world, cylinder & perforated trimesh decks, bumpers, CCD balls
│   ├── simulation/
│   │   ├── ArenaSystem.ts      # Multi-arena bounds, holes, bumpers, shrink, danger level, safe spawns
│   │   ├── MovementController.ts # Rolling acceleration, turn grip, braking, boost, post-hit DI
│   │   ├── CollisionSystem.ts  # 5-tier knockback, Perfect Impact, bumper rebounds, hit attribution
│   │   ├── ScoringSystem.ts    # Knockout Rush scoring, hole/edge attribution, tie-breakers
│   │   └── GameSimulation.ts   # Headless fixed-timestep (60Hz) simulation engine
│   ├── ai/
│   │   └── BotController.ts    # Hole/edge recovery, tangent navigation around holes/bumpers, flanking
│   ├── network/
│   │   └── NetworkAdapter.ts   # Transport abstraction (LocalLoopbackAdapter for solo play)
│   ├── rendering/
│   │   ├── ArenaRenderer.ts    # Extruded 3D perforated decks, glowing hole shafts, animated bumpers
│   │   ├── BallRenderer.ts     # Striped rolling spheres, danger ring pulse, shields, score badges
│   │   ├── EffectsRenderer.ts  # Object-pooled impact cones, shockwave rings, hole vortex & bumper FX
│   │   ├── CameraController.ts # Arena-adaptive elevated follow camera + menu orbit camera
│   │   └── SceneManager.ts     # Three.js WebGLRenderer, lighting, shadows, quality presets
│   ├── input/
│   │   └── InputManager.ts     # Keyboard + multi-touch virtual joystick & boost button
│   ├── audio/
│   │   └── SoundManager.ts     # Procedural Web Audio API sound synthesizer
│   ├── storage/
│   │   └── StorageManager.ts   # LocalStorage persistence for settings and per-arena personal bests
│   ├── ui/
│   │   └── UIManager.ts        # Responsive menus, 2D arena preview canvas, HUD, kill feed, results
│   └── styles/
│       └── main.css            # Responsive arcade UI styling
└── tests/
    ├── unit/
    │   └── simulation.test.ts  # Vitest unit, multi-arena physics & multi-seed simulation suite
    └── e2e/
        └── gameplay.spec.ts    # Playwright real-browser multi-arena verification suite
```

