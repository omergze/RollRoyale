import { SoundManager } from './audio/SoundManager';
import { InputManager } from './input/InputManager';
import { LocalLoopbackAdapter } from './network/NetworkAdapter';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { SceneManager } from './rendering/SceneManager';
import { GameSimulation, PLAYER_ENTITY_ID } from './simulation/GameSimulation';
import { StorageManager } from './storage/StorageManager';
import type { GameEvent, GameSettings, SimulationSnapshot } from './types/game';
import { UIManager } from './ui/UIManager';

class RollRoyaleApp {
  private settings: GameSettings;
  private soundManager: SoundManager;
  private inputManager: InputManager;
  private simulation!: GameSimulation;
  private networkAdapter!: LocalLoopbackAdapter;
  private sceneManager!: SceneManager;
  private uiManager!: UIManager;
  private lastFrameTime = 0;

  constructor() {
    this.settings = StorageManager.loadSettings();
    this.soundManager = new SoundManager(this.settings.soundEnabled);
    this.inputManager = new InputManager({
      onPauseToggle: () => this.togglePause(),
    });
    this.inputManager.setSensitivity(this.settings.controlSensitivity);
  }

  public async init(): Promise<void> {
    await PhysicsWorld.ensureInitialized();

    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container, this.settings);

    this.simulation = new GameSimulation();
    this.networkAdapter = new LocalLoopbackAdapter(this.simulation);

    const initialStats = StorageManager.loadStats();

    this.uiManager = new UIManager(this.settings, initialStats, {
      onStartSoloMatch: () => this.startSoloMatch(),
      onResumeMatch: () => this.resumeMatch(),
      onRestartMatch: () => this.startSoloMatch(),
      onReturnToMenu: () => this.returnToMenu(),
      onPauseClick: () => this.togglePause(),
      onSettingsChanged: (newSettings) => this.applySettings(newSettings),
      onButtonClickSound: () => this.soundManager.playClick(),
    });

    // Bind touchscreen virtual joystick and boost button
    const joystickZone = document.getElementById('joystick-zone')!;
    const joystickBase = document.getElementById('joystick-base')!;
    const joystickKnob = document.getElementById('joystick-knob')!;
    const touchBoostBtn = document.getElementById('btn-touch-boost')!;
    this.inputManager.bindTouchElements(joystickZone, joystickBase, joystickKnob, touchBoostBtn);

    // Start background demo battle on Main Menu
    this.returnToMenu();

    this.lastFrameTime = performance.now();
    requestAnimationFrame((now) => this.frameLoop(now));
  }

  public startSoloMatch(customDuration?: number): void {
    this.inputManager.clearAllInputs();
    this.networkAdapter.startMatch({
      botCount: this.settings.botCount,
      difficulty: this.settings.difficulty,
      matchDuration: customDuration,
      isDemoMode: false,
    });
    this.uiManager.showHudScreen();
  }

  public returnToMenu(): void {
    this.inputManager.clearAllInputs();
    this.networkAdapter.startMatch({
      botCount: 5,
      difficulty: 'hard',
      isDemoMode: true,
    });
    this.uiManager.showMenuScreen();
  }

  public togglePause(): void {
    const phase = this.simulation.getPhase();
    if (phase === 'playing') {
      this.networkAdapter.setPaused(true);
      this.uiManager.setPauseModalVisible(true);
    } else if (phase === 'paused') {
      this.resumeMatch();
    }
  }

  public resumeMatch(): void {
    this.networkAdapter.setPaused(false);
    this.uiManager.setPauseModalVisible(false);
    this.uiManager.closeSettingsModal();
  }

  private applySettings(newSettings: GameSettings): void {
    this.settings = { ...newSettings };
    StorageManager.saveSettings(this.settings);
    this.soundManager.setEnabled(this.settings.soundEnabled);
    this.inputManager.setSensitivity(this.settings.controlSensitivity);
    this.sceneManager.applySettings(this.settings);
  }

  private frameLoop(now: number): void {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    const currentPhase = this.simulation.getPhase();
    if (currentPhase === 'playing') {
      const cmd = this.inputManager.getPlayerInputCommand();
      this.networkAdapter.sendInput(cmd);
    }

    const { snapshot, events, alpha } = this.networkAdapter.update(dt);

    this.processEvents(events, snapshot);

    if (snapshot.phase === 'playing' || snapshot.phase === 'paused') {
      this.uiManager.updateHud(snapshot);
    }

    this.sceneManager.render(snapshot, alpha, dt);

    requestAnimationFrame((nextNow) => this.frameLoop(nextNow));
  }

  private processEvents(events: ReadonlyArray<GameEvent>, snapshot: SimulationSnapshot): void {
    this.sceneManager.processEvents(events, snapshot);

    if (snapshot.phase === 'menu') {
      return;
    }

    this.uiManager.handleGameEvents(events);

    for (const ev of events) {
      if (ev.type === 'collision') {
        this.soundManager.playCollision(ev.relativeSpeed, ev.isBoostedImpact, ev.impactTier);
      } else if (ev.type === 'boost') {
        this.soundManager.playBoost(ev.entityId === PLAYER_ENTITY_ID);
      } else if (ev.type === 'knockout') {
        this.soundManager.playKnockout(ev.attackerId === PLAYER_ENTITY_ID);
      } else if (ev.type === 'self_fall') {
        this.soundManager.playSelfFall(ev.victimId === PLAYER_ENTITY_ID);
      } else if (ev.type === 'shrink_start') {
        this.soundManager.playShrinkWarning();
      } else if (ev.type === 'match_end') {
        const playerEntry = ev.rankings.find((r) => r.entityId === PLAYER_ENTITY_ID) ?? ev.rankings[0];
        const wonMatch = playerEntry.rank === 1;
        this.soundManager.playMatchEnd(wonMatch);

        const { stats, isNewBestScore } = StorageManager.recordMatchResult(
          playerEntry.score,
          playerEntry.knockouts,
          wonMatch,
          this.settings.difficulty
        );
        this.uiManager.showResultsScreen(ev.rankings, stats, isNewBestScore);
      }
    }
  }

  // Expose debug/test helpers for automated Playwright browser verification
  public getDebugSnapshot(): SimulationSnapshot {
    return this.simulation.getSnapshot();
  }
}

declare global {
  interface Window {
    __ROLL_ROYALE__?: RollRoyaleApp;
  }
}

const app = new RollRoyaleApp();
window.__ROLL_ROYALE__ = app;
app.init().catch((err) => {
  console.error('Failed to initialize RollRoyale:', err);
});
