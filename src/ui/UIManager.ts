import { PHYSICS_CONSTANTS } from '../config/constants';
import { PLAYER_ENTITY_ID } from '../simulation/GameSimulation';
import type {
  BotDifficulty,
  GameEvent,
  GameSettings,
  GraphicsQuality,
  PlayerRankingEntry,
  PlayerStats,
  SimulationSnapshot,
} from '../types/game';
import { clamp } from '../utils/math';

export interface UIActions {
  onStartSoloMatch: () => void;
  onResumeMatch: () => void;
  onRestartMatch: () => void;
  onReturnToMenu: () => void;
  onPauseClick: () => void;
  onSettingsChanged: (settings: GameSettings) => void;
  onButtonClickSound: () => void;
}

export class UIManager {
  private settings: GameSettings;
  private stats: PlayerStats;
  private actions: UIActions;

  // Screens & Modals
  private menuScreen: HTMLElement;
  private hudScreen: HTMLElement;
  private resultsScreen: HTMLElement;
  private pauseModal: HTMLElement;
  private settingsModal: HTMLElement;

  // HUD Elements
  private hudPlayerRank: HTMLElement;
  private hudPlayerScore: HTMLElement;
  private hudPlayerFalls: HTMLElement;
  private hudTimerBox: HTMLElement;
  private hudTimer: HTMLElement;
  private hudShrinkBanner: HTMLElement;
  private hudStatusPill: HTMLElement;
  private hudLeaderboard: HTMLElement;
  private hudBoostCard: HTMLElement;
  private hudBoostStatus: HTMLElement;
  private hudBoostFill: HTMLElement;
  private touchBoostBtn: HTMLElement;
  private touchBoostSub: HTMLElement;
  private eventFeed: HTMLElement;

  constructor(settings: GameSettings, stats: PlayerStats, actions: UIActions) {
    this.settings = { ...settings };
    this.stats = { ...stats };
    this.actions = actions;

    this.menuScreen = document.getElementById('menu-screen')!;
    this.hudScreen = document.getElementById('hud-screen')!;
    this.resultsScreen = document.getElementById('results-screen')!;
    this.pauseModal = document.getElementById('pause-modal')!;
    this.settingsModal = document.getElementById('settings-modal')!;

    this.hudPlayerRank = document.getElementById('hud-player-rank')!;
    this.hudPlayerScore = document.getElementById('hud-player-score')!;
    this.hudPlayerFalls = document.getElementById('hud-player-falls')!;
    this.hudTimerBox = document.getElementById('hud-timer-box')!;
    this.hudTimer = document.getElementById('hud-timer')!;
    this.hudShrinkBanner = document.getElementById('hud-shrink-banner')!;
    this.hudStatusPill = document.getElementById('hud-status-pill')!;
    this.hudLeaderboard = document.getElementById('hud-leaderboard')!;
    this.hudBoostCard = document.getElementById('hud-boost-card')!;
    this.hudBoostStatus = document.getElementById('hud-boost-status')!;
    this.hudBoostFill = document.getElementById('hud-boost-fill')!;
    this.touchBoostBtn = document.getElementById('btn-touch-boost')!;
    this.touchBoostSub = document.getElementById('touch-boost-sub')!;
    this.eventFeed = document.getElementById('event-feed')!;

    this.bindEvents();
    this.syncMenuControls();
    this.syncSettingsControls();
    this.updateCareerStrip(this.stats);
  }

  private bindEvents(): void {
    // Difficulty selection
    const diffBtns = document.querySelectorAll<HTMLButtonElement>('[data-difficulty]');
    diffBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.actions.onButtonClickSound();
        const diff = btn.dataset.difficulty as BotDifficulty;
        this.settings.difficulty = diff;
        this.syncMenuControls();
        this.actions.onSettingsChanged({ ...this.settings });
      });
    });

    // Bot count selection
    const botBtns = document.querySelectorAll<HTMLButtonElement>('[data-bots]');
    botBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.actions.onButtonClickSound();
        const count = Number(btn.dataset.bots);
        this.settings.botCount = clamp(count, 3, 7);
        this.syncMenuControls();
        this.actions.onSettingsChanged({ ...this.settings });
      });
    });

    // Main Menu buttons
    document.getElementById('btn-play-solo')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onStartSoloMatch();
    });

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.openSettingsModal();
    });

    // HUD Pause button
    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onPauseClick();
    });

    // Pause Modal buttons
    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onResumeMatch();
    });

    document.getElementById('btn-restart-pause')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onRestartMatch();
    });

    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.openSettingsModal();
    });

    document.getElementById('btn-pause-menu')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onReturnToMenu();
    });

    // Settings Modal controls
    const soundBtn = document.getElementById('toggle-sound')!;
    soundBtn.addEventListener('click', () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      this.syncSettingsControls();
      this.actions.onSettingsChanged({ ...this.settings });
      this.actions.onButtonClickSound();
    });

    const qualityBtns = document.querySelectorAll<HTMLButtonElement>('[data-quality]');
    qualityBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.actions.onButtonClickSound();
        this.settings.graphicsQuality = btn.dataset.quality as GraphicsQuality;
        this.syncSettingsControls();
        this.actions.onSettingsChanged({ ...this.settings });
      });
    });

    const sensSlider = document.getElementById('slider-sensitivity') as HTMLInputElement;
    sensSlider.addEventListener('input', () => {
      this.settings.controlSensitivity = parseFloat(sensSlider.value);
      this.syncSettingsControls();
      this.actions.onSettingsChanged({ ...this.settings });
    });

    const reducedEffectsBtn = document.getElementById('toggle-reduced-effects')!;
    reducedEffectsBtn.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.settings.reducedEffects = !this.settings.reducedEffects;
      this.syncSettingsControls();
      this.actions.onSettingsChanged({ ...this.settings });
    });

    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.closeSettingsModal();
    });

    // Results Screen buttons
    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onRestartMatch();
    });

    document.getElementById('btn-results-menu')?.addEventListener('click', () => {
      this.actions.onButtonClickSound();
      this.actions.onReturnToMenu();
    });
  }

  private syncMenuControls(): void {
    const diffBtns = document.querySelectorAll<HTMLButtonElement>('[data-difficulty]');
    diffBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === this.settings.difficulty);
    });

    const botBtns = document.querySelectorAll<HTMLButtonElement>('[data-bots]');
    botBtns.forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.bots) === this.settings.botCount);
    });

    const botDisplay = document.getElementById('bot-count-display');
    if (botDisplay) {
      botDisplay.textContent = `${this.settings.botCount} BOTS (${this.settings.botCount + 1} PLAYERS)`;
    }
  }

  private syncSettingsControls(): void {
    const soundBtn = document.getElementById('toggle-sound')!;
    soundBtn.classList.toggle('active', this.settings.soundEnabled);
    soundBtn.setAttribute('aria-pressed', String(this.settings.soundEnabled));
    soundBtn.textContent = this.settings.soundEnabled ? 'ON' : 'OFF';

    const qualityBtns = document.querySelectorAll<HTMLButtonElement>('[data-quality]');
    qualityBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.quality === this.settings.graphicsQuality);
    });

    const sensSlider = document.getElementById('slider-sensitivity') as HTMLInputElement;
    sensSlider.value = this.settings.controlSensitivity.toFixed(1);
    const sensLabel = document.getElementById('sensitivity-label')!;
    sensLabel.textContent = `${this.settings.controlSensitivity.toFixed(1)}x Sensitivity`;

    const reducedBtn = document.getElementById('toggle-reduced-effects')!;
    reducedBtn.classList.toggle('active', this.settings.reducedEffects);
    reducedBtn.setAttribute('aria-pressed', String(this.settings.reducedEffects));
    reducedBtn.textContent = this.settings.reducedEffects ? 'ON' : 'OFF';
  }

  public updateCareerStrip(stats: PlayerStats): void {
    this.stats = { ...stats };
    const bestEl = document.getElementById('menu-best-score');
    const totalKosEl = document.getElementById('menu-total-kos');
    const totalWinsEl = document.getElementById('menu-total-wins');

    if (bestEl) bestEl.textContent = `${stats.bestScore} KOs`;
    if (totalKosEl) totalKosEl.textContent = `${stats.totalKnockouts}`;
    if (totalWinsEl) totalWinsEl.textContent = `${stats.totalWins}`;
  }

  public showMenuScreen(): void {
    this.menuScreen.classList.add('active');
    this.hudScreen.classList.remove('active');
    this.resultsScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
    this.eventFeed.innerHTML = '';
  }

  public showHudScreen(): void {
    this.menuScreen.classList.remove('active');
    this.hudScreen.classList.add('active');
    this.resultsScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
  }

  public setPauseModalVisible(visible: boolean): void {
    this.pauseModal.classList.toggle('hidden', !visible);
  }

  public openSettingsModal(): void {
    this.settingsModal.classList.remove('hidden');
  }

  public closeSettingsModal(): void {
    this.settingsModal.classList.add('hidden');
  }

  public showResultsScreen(
    rankings: ReadonlyArray<PlayerRankingEntry>,
    stats: PlayerStats,
    isNewBestScore: boolean
  ): void {
    this.updateCareerStrip(stats);
    this.hudScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.resultsScreen.classList.add('active');

    const playerEntry = rankings.find((r) => r.entityId === PLAYER_ENTITY_ID) ?? rankings[0];
    const rank = playerEntry.rank;

    const headlineEl = document.getElementById('results-headline')!;
    const subheadlineEl = document.getElementById('results-subheadline')!;
    const newBestEl = document.getElementById('results-new-best')!;

    newBestEl.classList.toggle('hidden', !isNewBestScore);

    if (rank === 1) {
      headlineEl.textContent = '1ST PLACE — VICTORY!';
      subheadlineEl.textContent = 'You ruled the floating arena and outlasted every rival!';
    } else if (rank === 2) {
      headlineEl.textContent = '2ND PLACE — RUNNER UP!';
      subheadlineEl.textContent = 'So close to the crown! One more knockout could seal it.';
    } else if (rank === 3) {
      headlineEl.textContent = '3RD PLACE — PODIUM FINISH!';
      subheadlineEl.textContent = 'Solid arena brawl! Use flank angles to rack up more KOs.';
    } else {
      headlineEl.textContent = `#${rank} PLACE FINISH`;
      subheadlineEl.textContent = 'Save your boost for edge strikes and emergency recoveries!';
    }

    document.getElementById('res-placement')!.textContent = `#${rank}`;
    document.getElementById('res-score')!.textContent = `${playerEntry.score}`;
    document.getElementById('res-falls')!.textContent = `${playerEntry.falls}`;
    document.getElementById('res-best')!.textContent = `${stats.bestScore}`;

    const tbody = document.getElementById('results-table-body')!;
    tbody.innerHTML = '';

    for (const row of rankings) {
      const tr = document.createElement('tr');
      if (row.isPlayer) {
        tr.className = 'is-player-row';
      }
      tr.innerHTML = `
        <td>#${row.rank}</td>
        <td>
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${row.colorPrimary};margin-right:6px;"></span>
          ${row.name}
        </td>
        <td>${row.score}</td>
        <td>${row.falls}</td>
        <td>${row.bestStreak}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  public updateHud(snapshot: SimulationSnapshot): void {
    const player = snapshot.entities.find((e) => e.id === PLAYER_ENTITY_ID);
    const playerRankEntry = snapshot.rankings.find((r) => r.entityId === PLAYER_ENTITY_ID);

    if (player && playerRankEntry) {
      this.hudPlayerRank.textContent = `#${playerRankEntry.rank}`;
      this.hudPlayerScore.textContent = `${player.score}`;
      this.hudPlayerFalls.textContent = `${player.falls}`;

      // Respawn / Spawn Protection Status Pill
      if (!player.isAlive) {
        this.hudStatusPill.classList.remove('hidden');
        this.hudStatusPill.textContent = `RESPAWNING IN ${Math.max(0.1, player.respawnTimer).toFixed(1)}s...`;
      } else if (player.spawnProtectionTimer > 0) {
        this.hudStatusPill.classList.remove('hidden');
        this.hudStatusPill.textContent = `SHIELD ACTIVE (${player.spawnProtectionTimer.toFixed(1)}s)`;
      } else {
        this.hudStatusPill.classList.add('hidden');
      }

      // Boost Cooldown Bar & Touch Button
      const cd = player.boostCooldownTimer;
      if (cd <= 0) {
        this.hudBoostCard.classList.remove('cooldown');
        this.hudBoostStatus.textContent = 'READY [SPACE]';
        this.hudBoostFill.style.width = '100%';

        this.touchBoostBtn.classList.remove('cooldown');
        this.touchBoostBtn.classList.add('ready');
        this.touchBoostSub.textContent = 'READY';
      } else {
        const progress = clamp(1 - cd / PHYSICS_CONSTANTS.BOOST_COOLDOWN, 0, 1);
        this.hudBoostCard.classList.add('cooldown');
        this.hudBoostStatus.textContent = `${cd.toFixed(1)}s`;
        this.hudBoostFill.style.width = `${(progress * 100).toFixed(1)}%`;

        this.touchBoostBtn.classList.add('cooldown');
        this.touchBoostBtn.classList.remove('ready');
        this.touchBoostSub.textContent = `${cd.toFixed(1)}s`;
      }
    }

    // Timer formatting (MM:SS)
    const totalSecs = Math.ceil(snapshot.remainingTime);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    this.hudTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const isUrgent = snapshot.arena.isShrinking;
    this.hudTimerBox.classList.toggle('urgent', isUrgent);
    this.hudShrinkBanner.classList.toggle('hidden', !isUrgent);

    // Compact Live Leaderboard (top 4 + ensure player is visible)
    const topRows = snapshot.rankings.slice(0, 4);
    if (playerRankEntry && !topRows.some((r) => r.entityId === PLAYER_ENTITY_ID)) {
      topRows[topRows.length - 1] = playerRankEntry;
    }

    this.hudLeaderboard.innerHTML = topRows
      .map(
        (r) => `
        <div class="lb-row ${r.isPlayer ? 'is-player' : ''}">
          <div class="lb-left">
            <span>#${r.rank}</span>
            <span class="lb-dot" style="background:${r.colorPrimary}"></span>
            <span>${r.name}</span>
          </div>
          <span>${r.score}</span>
        </div>
      `
      )
      .join('');
  }

  public handleGameEvents(events: ReadonlyArray<GameEvent>): void {
    for (const ev of events) {
      if (ev.type === 'knockout') {
        if (ev.attackerId === PLAYER_ENTITY_ID) {
          this.pushToast(`⚡ YOU knocked out ${ev.victimName}! (+1 SCORE)`, false);
        } else if (ev.victimId === PLAYER_ENTITY_ID) {
          this.pushToast(`💥 Knocked out by ${ev.attackerName}!`, true);
        } else {
          this.pushToast(`${ev.attackerName} knocked out ${ev.victimName}`, false);
        }
      } else if (ev.type === 'self_fall') {
        if (ev.victimId === PLAYER_ENTITY_ID) {
          this.pushToast('⚠ Ring-Out! Watch the arena edge!', true);
        }
      } else if (ev.type === 'shrink_start') {
        this.pushToast('⚠ FINAL 30 SECONDS — ARENA IS SHRINKING!', true);
      }
    }
  }

  private pushToast(message: string, isWarning: boolean): void {
    const toast = document.createElement('div');
    toast.className = `feed-toast ${isWarning ? 'warn' : ''}`;
    toast.textContent = message;
    this.eventFeed.appendChild(toast);

    while (this.eventFeed.children.length > 3) {
      this.eventFeed.removeChild(this.eventFeed.firstChild!);
    }

    window.setTimeout(() => {
      if (toast.parentElement === this.eventFeed) {
        this.eventFeed.removeChild(toast);
      }
    }, 2600);
  }
}
