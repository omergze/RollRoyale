# RollRoyale

**RollRoyale** is a fast-paced, physics-based 3D arcade knockout game built with **TypeScript**, **Vite**, **Three.js**, and **Rapier 3D**.

Players control colorful rolling spheres on a futuristic floating arena, using momentum, directional positioning, and high-speed boosts to knock opponents off the platform while avoiding ring-outs—especially during the final 30-second arena shrink phase.

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

---

## Testing

### Unit & Headless Physics Simulation Tests (Vitest)

Runs deterministic tests covering rolling-ball movement, boost activation/cooldown, collision knockback, directional hit bonuses, knockout attribution vs. self-falls, deterministic tie-breakers, arena shrinking, AI bot decision rules, respawns, and match completion:

```bash
npm test
```

### TypeScript Type Check

```bash
npm run typecheck
```

### End-to-End Browser Smoke Tests (Playwright)

Starts the development server, launches a real browser, tests the Main Menu, Solo Match, keyboard movement, boost, AI opponents, pause/restart, match results, and tablet/mobile touch controls:

```bash
npm run test:e2e
```

---

## Controls

### Desktop Controls

| Input | Action |
| :--- | :--- |
| **W / A / S / D** or **Arrow Keys** | Roll & steer ball in 4/8 directions |
| **Space** or **Shift** | Activate Boost burst (0.38s duration, 3.4s cooldown) |
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
├── index.html                  # Application shell, Main Menu, HUD, Modals, Results UI
├── package.json                # Scripts and dependencies
├── tsconfig.json               # Strict TypeScript configuration
├── vite.config.ts              # Vite bundler and Vitest configuration
├── playwright.config.ts        # Playwright browser E2E test configuration
├── src/
│   ├── main.ts                 # Application bootstrap & main frame loop
│   ├── types/
│   │   └── game.ts             # Core serializable state, input, event, and config types
│   ├── config/
│   │   └── constants.ts        # Tuned physics, arena, AI difficulty, and graphics constants
│   ├── utils/
│   │   └── math.ts             # Pure vector, quaternion, and rolling rotation helpers
│   ├── physics/
│   │   └── PhysicsWorld.ts     # Rapier 3D world, dynamic shrinking deck collider, CCD balls
│   ├── simulation/
│   │   ├── ArenaSystem.ts      # Arena radius, final 30s shrink, bounds, and safe respawns
│   │   ├── MovementController.ts # Rolling acceleration, turn grip, braking, and boost
│   │   ├── CollisionSystem.ts  # Momentum transfer, knockback, flank bonuses, hit attribution
│   │   ├── ScoringSystem.ts    # Knockout Rush scoring, self-fall filtering, tie-breakers
│   │   └── GameSimulation.ts   # Headless fixed-timestep (60Hz) simulation engine
│   ├── ai/
│   │   └── BotController.ts    # Normal and Hard AI bot target selection, flanking, edge recovery
│   ├── network/
│   │   └── NetworkAdapter.ts   # Transport abstraction (LocalLoopbackAdapter for solo play)
│   ├── rendering/
│   │   ├── ArenaRenderer.ts    # Procedural 3D arena deck, hazard rim, shrinking visual, sky
│   │   ├── BallRenderer.ts     # Striped rolling spheres, squash/stretch, shields, score badges
│   │   ├── EffectsRenderer.ts  # Object-pooled impact sparks, shockwave rings, boost trails
│   │   ├── CameraController.ts # Elevated angled follow camera + menu orbit camera
│   │   └── SceneManager.ts     # Three.js WebGLRenderer, lighting, shadows, quality presets
│   ├── input/
│   │   └── InputManager.ts     # Keyboard + multi-touch virtual joystick & boost button
│   ├── audio/
│   │   └── SoundManager.ts     # Procedural Web Audio API sound synthesizer
│   ├── storage/
│   │   └── StorageManager.ts   # LocalStorage persistence for settings and personal bests
│   ├── ui/
│   │   └── UIManager.ts        # Responsive menus, HUD, kill feed, settings, and results screen
│   └── styles/
│       └── main.css            # Responsive arcade UI styling
└── tests/
    ├── unit/
    │   └── simulation.test.ts  # Vitest unit & Rapier physics integration suite
    └── e2e/
        └── gameplay.spec.ts    # Playwright real-browser verification suite
```
