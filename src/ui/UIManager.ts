import { ARENA_DEFINITIONS, getArenaDefinition } from '../config/arenas';
import { PHYSICS_CONSTANTS } from '../config/constants';
import { PLAYER_ENTITY_ID } from '../simulation/GameSimulation';
import type {
  ArenaId,
  BotDifficulty,
  GameEvent,
  GameSettings,
  GraphicsQuality,
  MapSelectionId,
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
  onArenaSelectionChanged?: (selection: MapSelectionId) => void;
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
  private hudModeTag: HTMLElement;
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
    this.stats = {
      ...stats,
      arenaBestScores: { ...stats.arenaBestScores },
    };
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
    this.hudModeTag = document.getElementById('hud-mode-tag')!;
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
    // Arena map selection
    const arenaBtns = document.querySelectorAll<HTMLButtonElement>('[data-arena]');
    arenaBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.actions.onButtonClickSound();
        const selected = btn.dataset.arena as MapSelectionId;
        this.settings.selectedArena = selected;
        this.syncMenuControls();
        this.actions.onSettingsChanged({ ...this.settings });
        this.actions.onArenaSelectionChanged?.(selected);
      });
    });

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
    const arenaBtns = document.querySelectorAll<HTMLButtonElement>('[data-arena]');
    arenaBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.arena === this.settings.selectedArena);
    });

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

    this.updateArenaPreviewCard();
  }

  private updateArenaPreviewCard(): void {
    const sel = this.settings.selectedArena;
    const titleEl = document.getElementById('arena-preview-title');
    const subEl = document.getElementById('arena-preview-subtitle');
    const descEl = document.getElementById('arena-preview-desc');
    const bestBadgeEl = document.getElementById('arena-best-badge');
    const playSubEl = document.getElementById('btn-play-sub');
    const canvas = document.getElementById('arena-preview-canvas') as HTMLCanvasElement | null;

    if (sel === 'random') {
      if (titleEl) titleEl.textContent = 'RANDOM MAP';
      if (subEl) subEl.textContent = '4 ARENAS IN ROTATION';
      if (descEl) {
        descEl.textContent =
          'Picks Classic, Crater, Donut, or Bumper Arena at match start for unpredictable variety!';
      }
      if (bestBadgeEl) {
        bestBadgeEl.textContent = `ALL-MAP BEST: ${this.stats.bestScore} KOs`;
      }
      if (playSubEl) {
        playSubEl.textContent = 'RANDOM ARENA · 2:00';
      }
    } else {
      const def = getArenaDefinition(sel);
      if (titleEl) titleEl.textContent = def.name;
      if (subEl) subEl.textContent = def.badge;
      if (descEl) descEl.textContent = def.subtitle;
      const mapBest = this.stats.arenaBestScores?.[sel] ?? 0;
      if (bestBadgeEl) {
        bestBadgeEl.textContent = `ARENA BEST: ${mapBest} KOs`;
      }
      if (playSubEl) {
        playSubEl.textContent = `${def.name} · 2:00`;
      }
    }

    if (canvas) {
      this.drawArenaPreviewCanvas(canvas, sel);
    }
  }

  private drawArenaPreviewCanvas(canvas: HTMLCanvasElement, selection: MapSelectionId): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.clearRect(0, 0, w, h);

    // Subtle dark radial background
    const bgGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, w * 0.52);
    bgGrad.addColorStop(0, '#0E1C38');
    bgGrad.addColorStop(1, '#050A16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const previewArenaId: ArenaId = selection === 'random' ? 'crater' : selection;
    const def = ARENA_DEFINITIONS[previewArenaId];
    const scale = (w * 0.41) / def.baseRadius;
    const outerPx = def.baseRadius * scale;

    // Deck surface fill
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerPx, 0, Math.PI * 2);
    ctx.fillStyle = '#132547';
    ctx.fill();

    // Concentric tactical rings
    ctx.strokeStyle = def.theme.accentHex;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.2;
    [0.36, 0.68].forEach((rFrac) => {
      ctx.beginPath();
      ctx.arc(cx, cy, outerPx * rFrac, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1.0;

    // Punch out internal holes and draw glowing danger rims
    for (const hole of def.holes) {
      const hx = cx + hole.x * scale;
      const hy = cy + hole.z * scale;
      const hr = Math.max(4, hole.radius * scale);

      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = '#040812';
      ctx.fill();

      ctx.lineWidth = 2.2;
      ctx.strokeStyle = def.theme.hazardHex;
      ctx.stroke();
    }

    // Draw kinetic bumpers
    for (const bumper of def.bumpers) {
      const bx = cx + bumper.x * scale;
      const by = cy + bumper.z * scale;
      const br = Math.max(4.2, bumper.radius * scale * 1.4);

      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = '#06D6A0';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }

    // Outer glowing rim
    ctx.beginPath();
    ctx.arc(cx, cy, outerPx, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = def.theme.primaryHex;
    ctx.stroke();

    if (selection === 'random') {
      ctx.fillStyle = 'rgba(4, 10, 24, 0.68)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#00F0FF';
      ctx.font = '900 32px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy + 2);
    }

    ctx.restore();
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
    this.stats = {
      ...stats,
      arenaBestScores: { ...stats.arenaBestScores },
    };
    const bestEl = document.getElementById('menu-best-score');
    const totalKosEl = document.getElementById('menu-total-kos');
    const totalWinsEl = document.getElementById('menu-total-wins');

    if (bestEl) bestEl.textContent = `${stats.bestScore} KOs`;
    if (totalKosEl) totalKosEl.textContent = `${stats.totalKnockouts}`;
    if (totalWinsEl) totalWinsEl.textContent = `${stats.totalWins}`;
    this.updateArenaPreviewCard();
  }

  public showMenuScreen(): void {
    this.menuScreen.classList.add('active');
    this.hudScreen.classList.remove('active');
    this.resultsScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
    this.eventFeed.innerHTML = '';
    this.syncMenuControls();
  }

  public showHudScreen(): void {
    this.menuScreen.classList.remove('active');
    this.hudScreen.classList.add('active');
    this.resultsScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
    this.eventFeed.innerHTML = '';
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
    isNewBestScore: boolean,
    arenaId: ArenaId = 'classic'
  ): void {
    this.updateCareerStrip(stats);
    this.hudScreen.classList.remove('active');
    this.pauseModal.classList.add('hidden');
    this.resultsScreen.classList.add('active');

    const playerEntry = rankings.find((r) => r.entityId === PLAYER_ENTITY_ID) ?? rankings[0];
    const rank = playerEntry.rank;
    const arenaDef = getArenaDefinition(arenaId);

    const headlineEl = document.getElementById('results-headline')!;
    const subheadlineEl = document.getElementById('results-subheadline')!;
    const newBestEl = document.getElementById('results-new-best')!;

    newBestEl.classList.toggle('hidden', !isNewBestScore);

    if (rank === 1) {
      headlineEl.textContent = '1ST PLACE — VICTORY!';
      subheadlineEl.textContent = `You conquered ${arenaDef.name} and outlasted every rival!`;
    } else if (rank === 2) {
      headlineEl.textContent = '2ND PLACE — RUNNER UP!';
      subheadlineEl.textContent = `Strong showing on ${arenaDef.name}! One more KO could seal it.`;
    } else if (rank === 3) {
      headlineEl.textContent = '3RD PLACE — PODIUM FINISH!';
      subheadlineEl.textContent = `Solid brawl on ${arenaDef.name}! Use flank angles to rack up more KOs.`;
    } else {
      headlineEl.textContent = `#${rank} PLACE FINISH`;
      subheadlineEl.textContent = `Watch the hazards on ${arenaDef.name} and save boost for recoveries!`;
    }

    document.getElementById('res-placement')!.textContent = `#${rank}`;
    document.getElementById('res-score')!.textContent = `${playerEntry.score}`;
    document.getElementById('res-falls')!.textContent = `${playerEntry.falls}`;
    const arenaBest = stats.arenaBestScores?.[arenaId] ?? stats.bestScore;
    document.getElementById('res-best')!.textContent = `${arenaBest}`;

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

    if (this.hudModeTag && this.hudModeTag.textContent !== snapshot.arena.arenaName) {
      this.hudModeTag.textContent = snapshot.arena.arenaName;
    }

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
      if (ev.type === 'collision') {
        if (ev.isPerfectImpact && ev.attackerId === PLAYER_ENTITY_ID) {
          this.pushToast('⚡ PERFECT IMPACT! Maximum Knockback!', false);
        }
      } else if (ev.type === 'knockout') {
        const viaPit = ev.viaHole ? ' into the pit' : '';
        if (ev.attackerId === PLAYER_ENTITY_ID) {
          this.pushToast(
            ev.viaHole
              ? `🕳️ PIT KNOCKOUT! You sent ${ev.victimName} into the abyss! (+1 SCORE)`
              : `⚡ YOU knocked out ${ev.victimName}! (+1 SCORE)`,
            false
          );
        } else if (ev.victimId === PLAYER_ENTITY_ID) {
          this.pushToast(`💥 Knocked${viaPit} by ${ev.attackerName}!`, true);
        } else {
          this.pushToast(`${ev.attackerName} knocked ${ev.victimName}${viaPit}`, false);
        }
      } else if (ev.type === 'self_fall') {
        if (ev.victimId === PLAYER_ENTITY_ID) {
          this.pushToast(
            ev.viaHole
              ? '⚠ Pit Fall! Watch the internal hazard holes!'
              : '⚠ Ring-Out! Watch the arena edge!',
            true
          );
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
