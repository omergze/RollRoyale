import { DEFAULT_SETTINGS, DEFAULT_STATS } from '../config/constants';
import type { BotDifficulty, GameSettings, GraphicsQuality, PlayerStats } from '../types/game';
import { clamp } from '../utils/math';

const SETTINGS_KEY = 'rollroyale_settings_v1';
const STATS_KEY = 'rollroyale_stats_v1';

export class StorageManager {
  public static loadSettings(): GameSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      const validQuality: GraphicsQuality =
        parsed.graphicsQuality === 'low' ||
        parsed.graphicsQuality === 'medium' ||
        parsed.graphicsQuality === 'high'
          ? parsed.graphicsQuality
          : DEFAULT_SETTINGS.graphicsQuality;

      const validDifficulty: BotDifficulty =
        parsed.difficulty === 'normal' || parsed.difficulty === 'hard'
          ? parsed.difficulty
          : DEFAULT_SETTINGS.difficulty;

      return {
        soundEnabled:
          typeof parsed.soundEnabled === 'boolean'
            ? parsed.soundEnabled
            : DEFAULT_SETTINGS.soundEnabled,
        graphicsQuality: validQuality,
        controlSensitivity:
          typeof parsed.controlSensitivity === 'number'
            ? clamp(parsed.controlSensitivity, 0.6, 1.5)
            : DEFAULT_SETTINGS.controlSensitivity,
        reducedEffects:
          typeof parsed.reducedEffects === 'boolean'
            ? parsed.reducedEffects
            : DEFAULT_SETTINGS.reducedEffects,
        difficulty: validDifficulty,
        botCount:
          typeof parsed.botCount === 'number'
            ? Math.round(clamp(parsed.botCount, 3, 7))
            : DEFAULT_SETTINGS.botCount,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  public static saveSettings(settings: GameSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota or privacy mode errors
    }
  }

  public static loadStats(): PlayerStats {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) {
        return { ...DEFAULT_STATS };
      }
      const parsed = JSON.parse(raw) as Partial<PlayerStats>;
      return {
        bestScore: typeof parsed.bestScore === 'number' ? Math.max(0, parsed.bestScore) : 0,
        bestKnockouts:
          typeof parsed.bestKnockouts === 'number' ? Math.max(0, parsed.bestKnockouts) : 0,
        totalKnockouts:
          typeof parsed.totalKnockouts === 'number' ? Math.max(0, parsed.totalKnockouts) : 0,
        totalMatches:
          typeof parsed.totalMatches === 'number' ? Math.max(0, parsed.totalMatches) : 0,
        totalWins: typeof parsed.totalWins === 'number' ? Math.max(0, parsed.totalWins) : 0,
        normalWins: typeof parsed.normalWins === 'number' ? Math.max(0, parsed.normalWins) : 0,
        hardWins: typeof parsed.hardWins === 'number' ? Math.max(0, parsed.hardWins) : 0,
      };
    } catch {
      return { ...DEFAULT_STATS };
    }
  }

  public static recordMatchResult(
    score: number,
    knockouts: number,
    wonMatch: boolean,
    difficulty: BotDifficulty
  ): { stats: PlayerStats; isNewBestScore: boolean } {
    const current = StorageManager.loadStats();
    const isNewBestScore = score > current.bestScore;

    const updated: PlayerStats = {
      bestScore: Math.max(current.bestScore, score),
      bestKnockouts: Math.max(current.bestKnockouts, knockouts),
      totalKnockouts: current.totalKnockouts + knockouts,
      totalMatches: current.totalMatches + 1,
      totalWins: current.totalWins + (wonMatch ? 1 : 0),
      normalWins: current.normalWins + (wonMatch && difficulty === 'normal' ? 1 : 0),
      hardWins: current.hardWins + (wonMatch && difficulty === 'hard' ? 1 : 0),
    };

    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }

    return { stats: updated, isNewBestScore };
  }
}
