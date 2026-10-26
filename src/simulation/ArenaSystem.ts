import { ARENA_CONSTANTS, PHYSICS_CONSTANTS } from '../config/constants';
import type { ArenaState, BallEntityState, Vector3Like } from '../types/game';
import { clamp, distanceXZ, lengthXZ, lerp } from '../utils/math';

export class ArenaSystem {
  private state: ArenaState;
  private shrinkStartedEmitted = false;

  constructor(
    baseRadius: number = ARENA_CONSTANTS.BASE_RADIUS,
    minRadius: number = ARENA_CONSTANTS.MIN_RADIUS
  ) {
    this.state = {
      baseRadius,
      minRadius,
      currentRadius: baseRadius,
      isShrinking: false,
      shrinkProgress: 0,
      fallThresholdY: ARENA_CONSTANTS.FALL_THRESHOLD_Y,
    };
  }

  public reset(): void {
    this.state.currentRadius = this.state.baseRadius;
    this.state.isShrinking = false;
    this.state.shrinkProgress = 0;
    this.shrinkStartedEmitted = false;
  }

  public getState(): ArenaState {
    return { ...this.state };
  }

  /**
   * Updates arena radius based on remaining match time.
   * Returns true on the exact frame the final-phase shrinking starts.
   */
  public update(remainingSeconds: number): boolean {
    const shrinkWindow = ARENA_CONSTANTS.SHRINK_START_REMAINING_SECONDS;
    if (remainingSeconds <= shrinkWindow) {
      const progress = clamp(1 - remainingSeconds / shrinkWindow, 0, 1);
      this.state.isShrinking = true;
      this.state.shrinkProgress = progress;
      this.state.currentRadius = lerp(this.state.baseRadius, this.state.minRadius, progress);

      if (!this.shrinkStartedEmitted) {
        this.shrinkStartedEmitted = true;
        return true;
      }
    } else {
      this.state.isShrinking = false;
      this.state.shrinkProgress = 0;
      this.state.currentRadius = this.state.baseRadius;
    }
    return false;
  }

  /**
   * Checks if a ball has genuinely fallen out of the playable arena.
   */
  public isEntityOutOfBounds(position: Vector3Like): boolean {
    if (position.y <= this.state.fallThresholdY) {
      return true;
    }
    // Also detect when ball has fallen below the platform deck outside the active radius
    const radialDist = lengthXZ(position);
    if (
      position.y < -0.55 &&
      radialDist > this.state.currentRadius + ARENA_CONSTANTS.OUTER_RING_OUT_MARGIN * 0.45
    ) {
      return true;
    }
    return false;
  }

  /**
   * Checks if a ball is horizontally beyond the supporting platform surface.
   */
  public isPastPlatformEdge(position: Vector3Like): boolean {
    const radialDist = lengthXZ(position);
    return radialDist > this.state.currentRadius + PHYSICS_CONSTANTS.BALL_RADIUS * 0.25;
  }

  /**
   * Returns normalized danger ratio (0 = center, 1 = on the edge, >1 = outside edge).
   */
  public getEdgeDangerRatio(position: Vector3Like): number {
    if (this.state.currentRadius <= 0) return 1;
    return lengthXZ(position) / this.state.currentRadius;
  }

  /**
   * Computes initial evenly spaced ring positions for match start.
   */
  public getInitialSpawnPositions(totalCount: number): Vector3Like[] {
    const positions: Vector3Like[] = [];
    const ringRadius = Math.min(this.state.currentRadius * 0.54, 10.8);
    const y = PHYSICS_CONSTANTS.BALL_RADIUS + 0.08;

    for (let i = 0; i < totalCount; i++) {
      // Place human player (i = 0) at bottom (positive Z) facing center (-Z)
      const angle = Math.PI * 0.5 + (i * Math.PI * 2) / totalCount;
      positions.push({
        x: Math.cos(angle) * ringRadius,
        y,
        z: Math.sin(angle) * ringRadius,
      });
    }
    return positions;
  }

  /**
   * Finds a safe respawn location well inside the current shrinking safe radius,
   * maximizing distance from currently alive opponents and avoiding clustering.
   */
  public findSafeRespawnPosition(
    activeEntities: ReadonlyArray<BallEntityState>,
    slotIndex: number,
    tickOffset = 0
  ): Vector3Like {
    const safeMaxRadius = Math.max(2.5, this.state.currentRadius * 0.5);
    const y = PHYSICS_CONSTANTS.BALL_RADIUS + 0.3;

    const candidates: Vector3Like[] = [];
    const angleSteps = 16;
    const radiusRings = [safeMaxRadius * 0.38, safeMaxRadius * 0.74];
    const phaseShift = (slotIndex * 1.618 + tickOffset * 0.17) % 1;

    for (const r of radiusRings) {
      for (let i = 0; i < angleSteps; i++) {
        const angle = ((i + phaseShift) / angleSteps) * Math.PI * 2;
        candidates.push({
          x: Math.cos(angle) * r,
          y,
          z: Math.sin(angle) * r,
        });
      }
    }
    candidates.push({ x: 0, y, z: 0 });

    const alive = activeEntities.filter((e) => e.isAlive);
    if (alive.length === 0) {
      return candidates[0];
    }

    let bestCandidate = candidates[0];
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      let minDistToOpponent = Infinity;
      let nearbyCount = 0;
      for (const other of alive) {
        const d = distanceXZ(candidate, other.position);
        if (d < minDistToOpponent) {
          minDistToOpponent = d;
        }
        if (d < 5.5) {
          nearbyCount += 1;
        }
      }
      const centerDistPenalty = lengthXZ(candidate) * 0.06;
      const candidateScore = minDistToOpponent - nearbyCount * 2.5 - centerDistPenalty;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }
}
