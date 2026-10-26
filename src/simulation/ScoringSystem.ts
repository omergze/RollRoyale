import { ARENA_CONSTANTS } from '../config/constants';
import type { BallEntityState, GameEvent, PlayerRankingEntry } from '../types/game';

export class ScoringSystem {
  /**
   * Processes a ball falling out of the arena:
   * - Increments victim's falls and resets victim's streak
   * - Checks if a valid opponent collision occurred within the attribution window
   * - Credits knockout and score to the attacker if valid, otherwise records a self-fall
   */
  public static processRingOut(
    victim: BallEntityState,
    allEntities: ReadonlyMap<string, BallEntityState>,
    currentTime: number
  ): Extract<GameEvent, { type: 'knockout' | 'self_fall' }> {
    victim.falls += 1;
    victim.streak = 0;

    const hit = victim.lastHit;
    victim.lastHit = null;

    if (
      hit &&
      hit.attackerId !== victim.id &&
      currentTime - hit.timestamp <= ARENA_CONSTANTS.KNOCKOUT_ATTRIBUTION_WINDOW_SECONDS
    ) {
      const attacker = allEntities.get(hit.attackerId);
      if (attacker) {
        attacker.knockouts += 1;
        attacker.score += 1;
        attacker.streak += 1;
        if (attacker.streak > attacker.bestStreak) {
          attacker.bestStreak = attacker.streak;
        }
        if (attacker.firstKnockoutTime === null) {
          attacker.firstKnockoutTime = currentTime;
        }

        return {
          type: 'knockout',
          timestamp: currentTime,
          attackerId: attacker.id,
          attackerName: attacker.name,
          victimId: victim.id,
          victimName: victim.name,
          position: { ...victim.position },
          isSelfFall: false,
        };
      }
    }

    return {
      type: 'self_fall',
      timestamp: currentTime,
      victimId: victim.id,
      victimName: victim.name,
      position: { ...victim.position },
      isSelfFall: true,
    };
  }

  /**
   * Expires stale hit attributions when a ball has been safely recovering on the arena
   * past the attribution window.
   */
  public static clearExpiredAttributions(
    entities: Iterable<BallEntityState>,
    currentTime: number
  ): void {
    for (const entity of entities) {
      if (
        entity.lastHit &&
        currentTime - entity.lastHit.timestamp >
          ARENA_CONSTANTS.KNOCKOUT_ATTRIBUTION_WINDOW_SECONDS
      ) {
        entity.lastHit = null;
      }
    }
  }

  /**
   * Computes deterministic rankings for all participants.
   * Tie-breaker order:
   * 1. Higher Score (Knockouts)
   * 2. Fewer Falls
   * 3. Earlier First Knockout Timestamp
   * 4. Higher Total Impact Dealt
   * 5. Lower Slot Index (Human player is slot 0)
   */
  public static computeRankings(entities: ReadonlyArray<BallEntityState>): PlayerRankingEntry[] {
    const entries: PlayerRankingEntry[] = entities.map((e) => ({
      rank: 1,
      entityId: e.id,
      name: e.name,
      isPlayer: e.isPlayer,
      colorPrimary: e.colorPrimary,
      colorAccent: e.colorAccent,
      score: e.score,
      knockouts: e.knockouts,
      falls: e.falls,
      bestStreak: e.bestStreak,
      totalImpactDealt: Math.round(e.totalImpactDealt),
      firstKnockoutTime: e.firstKnockoutTime,
      slotIndex: e.slotIndex,
    }));

    entries.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.falls !== b.falls) {
        return a.falls - b.falls;
      }
      if (a.firstKnockoutTime !== null && b.firstKnockoutTime !== null) {
        if (Math.abs(a.firstKnockoutTime - b.firstKnockoutTime) > 1e-4) {
          return a.firstKnockoutTime - b.firstKnockoutTime;
        }
      } else if (a.firstKnockoutTime !== null) {
        return -1;
      } else if (b.firstKnockoutTime !== null) {
        return 1;
      }
      if (b.totalImpactDealt !== a.totalImpactDealt) {
        return b.totalImpactDealt - a.totalImpactDealt;
      }
      return a.slotIndex - b.slotIndex;
    });

    entries.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    return entries;
  }
}
