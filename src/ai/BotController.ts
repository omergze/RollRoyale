import { BOT_DIFFICULTY_PROFILES } from '../config/constants';
import type {
  ArenaState,
  BallEntityState,
  BotDifficulty,
  PlayerInputCommand,
  Vector3Like,
} from '../types/game';
import { clamp, distanceXZ, dotXZ, lengthXZ, normalizeXZ } from '../utils/math';

interface BotMemory {
  reactionTimer: number;
  cachedTargetId: string | null;
  aimOffsetAngle: number;
  strafeSign: number;
  strafeSwitchTimer: number;
  lowSpeedTimer: number;
}

export class BotController {
  private memories = new Map<string, BotMemory>();
  private rngState = 1337;

  public reset(seed = 1337): void {
    this.memories.clear();
    this.rngState = seed >>> 0;
  }

  /**
   * Deterministic pseudo-random generator in [0, 1) so tests and simulations are reproducible.
   */
  private nextRandom(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private getOrCreateMemory(botId: string, slotIndex: number): BotMemory {
    let mem = this.memories.get(botId);
    if (!mem) {
      mem = {
        reactionTimer: 0,
        cachedTargetId: null,
        aimOffsetAngle: 0,
        strafeSign: slotIndex % 2 === 0 ? 1 : -1,
        strafeSwitchTimer: 1.5 + (slotIndex % 3) * 0.6,
        lowSpeedTimer: 0,
      };
      this.memories.set(botId, mem);
    }
    return mem;
  }

  /**
   * Computes the AI bot's input command for the current fixed step.
   * Uses the exact same PlayerInputCommand structure as the human player.
   */
  public computeBotInput(
    bot: BallEntityState,
    allEntities: ReadonlyArray<BallEntityState>,
    arena: ArenaState,
    dt: number
  ): PlayerInputCommand {
    if (!bot.isAlive) {
      return {
        entityId: bot.id,
        moveX: 0,
        moveZ: 0,
        boostPressed: false,
      };
    }

    const profile = BOT_DIFFICULTY_PROFILES[bot.difficulty];
    const mem = this.getOrCreateMemory(bot.id, bot.slotIndex);

    mem.reactionTimer -= dt;
    mem.strafeSwitchTimer -= dt;

    if (mem.strafeSwitchTimer <= 0) {
      mem.strafeSign = -mem.strafeSign;
      mem.strafeSwitchTimer = 1.8 + this.nextRandom() * 1.6;
    }

    const currentSpeed = lengthXZ(bot.velocity);
    if (currentSpeed < 1.2) {
      mem.lowSpeedTimer += dt;
    } else {
      mem.lowSpeedTimer = 0;
    }

    // 1. Evaluate Edge Danger (including projected position from velocity lookahead)
    const projectedPos: Vector3Like = {
      x: bot.position.x + bot.velocity.x * profile.velocityLookaheadSeconds,
      y: 0,
      z: bot.position.z + bot.velocity.z * profile.velocityLookaheadSeconds,
    };

    const currentRadialDist = lengthXZ(bot.position);
    const projectedRadialDist = lengthXZ(projectedPos);
    const effectiveRadius = Math.max(arena.minRadius * 0.8, arena.currentRadius);

    const currentDangerRatio = currentRadialDist / effectiveRadius;
    const projectedDangerRatio = projectedRadialDist / effectiveRadius;
    const maxDangerRatio = Math.max(currentDangerRatio, projectedDangerRatio);

    const toCenterDir = normalizeXZ({ x: -bot.position.x, y: 0, z: -bot.position.z });
    const outwardDir = { x: -toCenterDir.x, y: 0, z: -toCenterDir.z };
    const outwardSpeed = dotXZ(bot.velocity, outwardDir);

    // Emergency Edge Recovery!
    if (
      maxDangerRatio >= profile.edgeDangerThresholdRatio ||
      (currentDangerRatio > 0.65 && outwardSpeed > 8.5)
    ) {
      // Blend strong inward pull with slight tangent to avoid predictable straight lines
      const tangent: Vector3Like = {
        x: -toCenterDir.z * mem.strafeSign,
        y: 0,
        z: toCenterDir.x * mem.strafeSign,
      };
      const urgency = clamp(
        (maxDangerRatio - profile.edgeDangerThresholdRatio) /
          (1.0 - profile.edgeDangerThresholdRatio),
        0.35,
        1.0
      );

      const recoverDir = normalizeXZ({
        x: toCenterDir.x * (0.85 + urgency * 0.15) + tangent.x * (1 - urgency) * 0.25,
        y: 0,
        z: toCenterDir.z * (0.85 + urgency * 0.15) + tangent.z * (1 - urgency) * 0.25,
      });

      const criticalDanger =
        maxDangerRatio >= profile.edgeCriticalRatio ||
        (currentDangerRatio > 0.78 && outwardSpeed > 6.5);

      return {
        entityId: bot.id,
        moveX: recoverDir.x,
        moveZ: recoverDir.z,
        boostPressed: criticalDanger && bot.boostCooldownTimer <= 0,
      };
    }

    // 2. Target Selection (updated at reactionInterval)
    let target = allEntities.find((e) => e.id === mem.cachedTargetId && e.isAlive && e.id !== bot.id);
    if (mem.reactionTimer <= 0 || !target) {
      mem.reactionTimer = profile.reactionInterval;
      target = this.selectBestTarget(bot, allEntities, arena, bot.difficulty);
      mem.cachedTargetId = target ? target.id : null;
      mem.aimOffsetAngle = (this.nextRandom() * 2 - 1) * profile.aimNoiseRadians;
    }

    // If no valid alive opponents exist, patrol near arena center
    if (!target) {
      const patrolDir =
        currentRadialDist > 3.5
          ? toCenterDir
          : {
              x: Math.cos(mem.strafeSwitchTimer * 2) * mem.strafeSign,
              y: 0,
              z: Math.sin(mem.strafeSwitchTimer * 2),
            };
      return {
        entityId: bot.id,
        moveX: patrolDir.x,
        moveZ: patrolDir.z,
        boostPressed: false,
      };
    }

    // 3. Tactical Approach & Attack Vector Calculation
    const leadTime = clamp(distanceXZ(bot.position, target.position) / 22.0, 0.05, 0.45);
    const predictedTargetPos: Vector3Like = {
      x: target.position.x + target.velocity.x * leadTime * (bot.difficulty === 'hard' ? 1.0 : 0.4),
      y: 0,
      z: target.position.z + target.velocity.z * leadTime * (bot.difficulty === 'hard' ? 1.0 : 0.4),
    };

    // Direction from arena center through target toward nearest outer edge
    const targetOutwardDir = normalizeXZ(predictedTargetPos);
    const hasOutwardDir = lengthXZ(targetOutwardDir) > 1e-4;

    const distToTarget = distanceXZ(bot.position, predictedTargetPos);
    const dirToTarget = normalizeXZ({
      x: predictedTargetPos.x - bot.position.x,
      y: 0,
      z: predictedTargetPos.z - bot.position.z,
    });

    let desiredDir = dirToTarget;

    // Hard bots (and occasionally Normal bots) try to line up behind the target radially
    // so the collision pushes the target outward toward the rim!
    if (hasOutwardDir && distToTarget > 3.8 && profile.flankPreference > 0) {
      const stagingDistance = clamp(distToTarget * 0.45, 1.8, 4.2);
      const stagingPoint: Vector3Like = {
        x: predictedTargetPos.x - targetOutwardDir.x * stagingDistance,
        y: 0,
        z: predictedTargetPos.z - targetOutwardDir.z * stagingDistance,
      };
      const dirToStaging = normalizeXZ({
        x: stagingPoint.x - bot.position.x,
        y: 0,
        z: stagingPoint.z - bot.position.z,
      });

      const blend = profile.flankPreference * clamp((distToTarget - 3.0) / 7.0, 0, 0.65);
      desiredDir = normalizeXZ({
        x: dirToTarget.x * (1 - blend) + dirToStaging.x * blend,
        y: 0,
        z: dirToTarget.z * (1 - blend) + dirToStaging.z * blend,
      });
    }

    // Anti-stuck / anti-stall maneuver if two balls are locked pushing against each other
    if (mem.lowSpeedTimer > 0.45) {
      const perp: Vector3Like = {
        x: -desiredDir.z * mem.strafeSign,
        y: 0,
        z: desiredDir.x * mem.strafeSign,
      };
      desiredDir = normalizeXZ({
        x: desiredDir.x * 0.55 + perp.x * 0.45,
        y: 0,
        z: desiredDir.z * 0.55 + perp.z * 0.45,
      });
    }

    // Apply difficulty aim noise
    const cosA = Math.cos(mem.aimOffsetAngle);
    const sinA = Math.sin(mem.aimOffsetAngle);
    const noisyDir = normalizeXZ({
      x: desiredDir.x * cosA - desiredDir.z * sinA,
      y: 0,
      z: desiredDir.x * sinA + desiredDir.z * cosA,
    });

    // 4. Smart Boost Decision
    let shouldBoost = false;
    if (bot.boostCooldownTimer <= 0 && target.spawnProtectionTimer <= 0.15) {
      const alignment = dotXZ(noisyDir, dirToTarget);
      const inStrikeRange = distToTarget >= 2.1 && distToTarget <= profile.boostStrikeRange;

      // Ensure boosting in `noisyDir` won't send the bot flying off the arena edge!
      const boostEndEstimate: Vector3Like = {
        x: bot.position.x + noisyDir.x * 6.8,
        y: 0,
        z: bot.position.z + noisyDir.z * 6.8,
      };
      const boostEndDanger = lengthXZ(boostEndEstimate) / effectiveRadius;
      const safeToBoost = boostEndDanger < profile.edgeCriticalRatio * 0.96;

      if (inStrikeRange && alignment >= profile.boostAlignmentDotThreshold && safeToBoost) {
        shouldBoost = true;
      }
    }

    return {
      entityId: bot.id,
      moveX: noisyDir.x,
      moveZ: noisyDir.z,
      boostPressed: shouldBoost,
    };
  }

  private selectBestTarget(
    bot: BallEntityState,
    allEntities: ReadonlyArray<BallEntityState>,
    arena: ArenaState,
    difficulty: BotDifficulty
  ): BallEntityState | undefined {
    let bestTarget: BallEntityState | undefined;
    let bestScore = -Infinity;

    for (const candidate of allEntities) {
      if (candidate.id === bot.id || !candidate.isAlive) {
        continue;
      }

      const dist = distanceXZ(bot.position, candidate.position);
      const candidateEdgeRatio = lengthXZ(candidate.position) / Math.max(1, arena.currentRadius);

      // Prefer closer opponents
      let score = -dist * 1.15;

      // Avoid wasting attacks on spawn-protected opponents unless no one else is near
      if (candidate.spawnProtectionTimer > 0.2) {
        score -= 14.0;
      }

      if (difficulty === 'hard') {
        // Hard bots strongly prioritize targets who are dangerously close to the edge!
        score += candidateEdgeRatio * 12.5;

        // Also favor targets when the bot is already positioned between center and target
        const botToCandidate = normalizeXZ({
          x: candidate.position.x - bot.position.x,
          y: 0,
          z: candidate.position.z - bot.position.z,
        });
        const candidateOutward = normalizeXZ(candidate.position);
        const radialAlignment = dotXZ(botToCandidate, candidateOutward);
        score += radialAlignment * 4.5;
      } else {
        // Normal bots mostly pick nearest target with mild edge preference
        score += candidateEdgeRatio * 4.0;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }
}
