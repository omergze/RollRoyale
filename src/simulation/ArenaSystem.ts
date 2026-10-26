import { getArenaDefinition, type ArenaDefinition } from '../config/arenas';
import { ARENA_CONSTANTS, PHYSICS_CONSTANTS } from '../config/constants';
import type {
  ArenaHoleConfig,
  ArenaId,
  ArenaState,
  BallEntityState,
  Vector3Like,
} from '../types/game';
import { clamp, distanceXZ, lengthXZ, lerp } from '../utils/math';

export class ArenaSystem {
  private definition: ArenaDefinition;
  private state: ArenaState;
  private shrinkStartedEmitted = false;

  constructor(
    baseRadiusOrArenaId: number | ArenaId = 'classic',
    customMinRadius?: number
  ) {
    if (typeof baseRadiusOrArenaId === 'string') {
      this.definition = getArenaDefinition(baseRadiusOrArenaId);
      this.state = this.createStateFromDefinition(this.definition);
    } else {
      this.definition = {
        ...getArenaDefinition('classic'),
        baseRadius: baseRadiusOrArenaId,
        minRadius: customMinRadius ?? ARENA_CONSTANTS.MIN_RADIUS,
      };
      this.state = this.createStateFromDefinition(this.definition);
    }
  }

  private createStateFromDefinition(def: ArenaDefinition): ArenaState {
    return {
      arenaId: def.id,
      arenaName: def.name,
      baseRadius: def.baseRadius,
      minRadius: def.minRadius,
      currentRadius: def.baseRadius,
      innerHoleRadius: def.innerHoleRadius,
      holes: def.holes.map((h) => ({ ...h })),
      bumpers: def.bumpers.map((b) => ({ ...b })),
      isShrinking: false,
      shrinkProgress: 0,
      fallThresholdY: ARENA_CONSTANTS.FALL_THRESHOLD_Y,
    };
  }

  public setArena(arenaId: ArenaId): void {
    this.definition = getArenaDefinition(arenaId);
    this.state = this.createStateFromDefinition(this.definition);
    this.shrinkStartedEmitted = false;
  }

  public getDefinition(): ArenaDefinition {
    return this.definition;
  }

  public reset(): void {
    this.state = this.createStateFromDefinition(this.definition);
    this.shrinkStartedEmitted = false;
  }

  public getState(): ArenaState {
    return {
      ...this.state,
      holes: this.state.holes.map((h) => ({ ...h })),
      bumpers: this.state.bumpers.map((b) => ({ ...b })),
    };
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
   * Returns the hole config if the horizontal position is inside a physical hole opening.
   */
  public getOverlappingHole(position: Vector3Like, margin = -0.12): ArenaHoleConfig | null {
    for (const hole of this.state.holes) {
      const d = Math.hypot(position.x - hole.x, position.z - hole.z);
      if (d < hole.radius + margin) {
        return hole;
      }
    }
    return null;
  }

  /**
   * Checks whether a candidate 2D position lies safely on the solid deck away from edges, holes, and bumpers.
   */
  public isPositionSafeOnDeck(position: Vector3Like, clearance = 2.0): boolean {
    const radialDist = lengthXZ(position);
    if (radialDist > this.state.currentRadius - clearance) {
      return false;
    }
    for (const hole of this.state.holes) {
      const d = Math.hypot(position.x - hole.x, position.z - hole.z);
      if (d < hole.radius + clearance) {
        return false;
      }
    }
    for (const bumper of this.state.bumpers) {
      const d = Math.hypot(position.x - bumper.x, position.z - bumper.z);
      if (d < bumper.radius + clearance) {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks if a ball has genuinely fallen out of the playable arena, and whether it fell through an internal hole.
   */
  public checkOutOfBounds(position: Vector3Like): { out: boolean; viaHole: boolean } {
    const radialDist = lengthXZ(position);

    // Check if the ball is within a hole shaft horizontally
    let insideOrNearHole = false;
    for (const hole of this.state.holes) {
      const d = Math.hypot(position.x - hole.x, position.z - hole.z);
      if (d <= hole.radius + PHYSICS_CONSTANTS.BALL_RADIUS * 0.65) {
        insideOrNearHole = true;
        break;
      }
    }

    if (position.y <= this.state.fallThresholdY) {
      const viaHole =
        this.state.holes.length > 0 &&
        (insideOrNearHole || radialDist < this.state.currentRadius * 0.88);
      return { out: true, viaHole };
    }

    if (position.y < -0.58) {
      if (insideOrNearHole) {
        return { out: true, viaHole: true };
      }
      if (radialDist > this.state.currentRadius + ARENA_CONSTANTS.OUTER_RING_OUT_MARGIN * 0.45) {
        return { out: true, viaHole: false };
      }
    }

    return { out: false, viaHole: false };
  }

  /**
   * Checks if a ball has genuinely fallen out of the playable arena.
   */
  public isEntityOutOfBounds(position: Vector3Like): boolean {
    return this.checkOutOfBounds(position).out;
  }

  /**
   * Checks if a ball is horizontally beyond the supporting platform surface (over outer edge or over a hole).
   */
  public isPastPlatformEdge(position: Vector3Like): boolean {
    const radialDist = lengthXZ(position);
    if (radialDist > this.state.currentRadius + PHYSICS_CONSTANTS.BALL_RADIUS * 0.25) {
      return true;
    }
    if (this.getOverlappingHole(position, -PHYSICS_CONSTANTS.BALL_RADIUS * 0.18) !== null) {
      return true;
    }
    return false;
  }

  /**
   * Returns normalized outer edge danger ratio (0 = center, 1 = on the outer edge).
   */
  public getEdgeDangerRatio(position: Vector3Like): number {
    if (this.state.currentRadius <= 0) return 1;
    return lengthXZ(position) / this.state.currentRadius;
  }

  /**
   * Returns overall hazard danger level in [0, 1] considering both the outer edge and all internal holes.
   * 0 = completely safe (> 3.4m from any drop), 1 = right on the brink of falling.
   */
  public getHazardDangerLevel(position: Vector3Like): number {
    const radialDist = lengthXZ(position);
    const distToOuterEdge = Math.max(0, this.state.currentRadius - radialDist);
    let minClearance = distToOuterEdge;

    for (const hole of this.state.holes) {
      const distToHoleRim = Math.max(0, Math.hypot(position.x - hole.x, position.z - hole.z) - hole.radius);
      if (distToHoleRim < minClearance) {
        minClearance = distToHoleRim;
      }
    }

    const warningBand = 3.4;
    if (minClearance >= warningBand) {
      return 0;
    }
    return clamp(1 - minClearance / warningBand, 0, 1);
  }

  /**
   * Computes initial evenly spaced ring positions for match start, guaranteed to be safe from holes & bumpers.
   */
  public getInitialSpawnPositions(totalCount: number): Vector3Like[] {
    const positions: Vector3Like[] = [];
    const defaultRing = Math.min(
      this.definition.spawnRingRadius,
      this.state.currentRadius - 3.2
    );
    const minRing =
      this.state.innerHoleRadius > 0 ? this.state.innerHoleRadius + 3.2 : 3.5;
    const baseRingRadius = Math.max(minRing, defaultRing);
    const y = PHYSICS_CONSTANTS.BALL_RADIUS + 0.08;

    for (let i = 0; i < totalCount; i++) {
      // Place human player (i = 0) at bottom (positive Z) facing center (-Z)
      const baseAngle = Math.PI * 0.5 + (i * Math.PI * 2) / totalCount;
      let chosenPos: Vector3Like = {
        x: Math.cos(baseAngle) * baseRingRadius,
        y,
        z: Math.sin(baseAngle) * baseRingRadius,
      };

      if (!this.isPositionSafeOnDeck(chosenPos, 2.1)) {
        // Search nearby angles/radii for the closest completely safe spot
        let found = false;
        const radiusOffsets = [0, 2.2, -2.2, 3.8, -3.8];
        const angleOffsets = [0, 0.22, -0.22, 0.44, -0.44, 0.65, -0.65];
        for (const dr of radiusOffsets) {
          const r = clamp(baseRingRadius + dr, minRing, this.state.currentRadius - 2.6);
          for (const da of angleOffsets) {
            const candidate: Vector3Like = {
              x: Math.cos(baseAngle + da) * r,
              y,
              z: Math.sin(baseAngle + da) * r,
            };
            if (this.isPositionSafeOnDeck(candidate, 2.1)) {
              chosenPos = candidate;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      positions.push(chosenPos);
    }

    return positions;
  }

  /**
   * Finds a safe respawn location well inside the current shrinking safe deck,
   * avoiding all holes, bumpers, and edges while maximizing distance from active opponents.
   */
  public findSafeRespawnPosition(
    activeEntities: ReadonlyArray<BallEntityState>,
    slotIndex: number,
    tickOffset = 0
  ): Vector3Like {
    const y = PHYSICS_CONSTANTS.BALL_RADIUS + 0.28;
    const maxSafeR = Math.max(4.0, this.state.currentRadius - 2.8);
    const minSafeR =
      this.state.innerHoleRadius > 0 ? this.state.innerHoleRadius + 2.8 : 0.0;

    const candidates: Vector3Like[] = [];
    const angleSteps = 20;
    const phaseShift = (slotIndex * 1.618 + tickOffset * 0.17) % 1;

    const radiusRings =
      minSafeR > 0
        ? [
            lerp(minSafeR, maxSafeR, 0.28),
            lerp(minSafeR, maxSafeR, 0.52),
            lerp(minSafeR, maxSafeR, 0.76),
          ]
        : [maxSafeR * 0.26, maxSafeR * 0.52, maxSafeR * 0.78];

    for (const r of radiusRings) {
      for (let i = 0; i < angleSteps; i++) {
        const angle = ((i + phaseShift) / angleSteps) * Math.PI * 2;
        const pt: Vector3Like = {
          x: Math.cos(angle) * r,
          y,
          z: Math.sin(angle) * r,
        };
        if (this.isPositionSafeOnDeck(pt, 2.15)) {
          candidates.push(pt);
        }
      }
    }

    if (minSafeR === 0) {
      const originPt = { x: 0, y, z: 0 };
      if (this.isPositionSafeOnDeck(originPt, 2.15)) {
        candidates.push(originPt);
      }
    }

    // Fallback with slightly relaxed clearance if arena is at minimum shrink
    if (candidates.length === 0) {
      const fallbackR = minSafeR > 0 ? (minSafeR + maxSafeR) * 0.5 : maxSafeR * 0.45;
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const pt = { x: Math.cos(angle) * fallbackR, y, z: Math.sin(angle) * fallbackR };
        if (this.isPositionSafeOnDeck(pt, 1.4)) {
          candidates.push(pt);
        }
      }
    }

    if (candidates.length === 0) {
      const safeR = minSafeR > 0 ? minSafeR + 1.5 : 0;
      return { x: safeR, y, z: 0 };
    }

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

      const hazardDangerPenalty = this.getHazardDangerLevel(candidate) * 6.0;
      const candidateScore = minDistToOpponent - nearbyCount * 2.5 - hazardDangerPenalty;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }
}
