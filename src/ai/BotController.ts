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
  frustratedTargetId: string | null;
  frustratedCooldown: number;
  targetPursuitTime: number;
  lastImpactDealt: number;
  runUpTimer: number;
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

  private getOrCreateMemory(bot: BallEntityState): BotMemory {
    let mem = this.memories.get(bot.id);
    if (!mem) {
      mem = {
        reactionTimer: (bot.slotIndex % 4) * 0.03,
        cachedTargetId: null,
        frustratedTargetId: null,
        frustratedCooldown: 0,
        targetPursuitTime: 0,
        lastImpactDealt: bot.totalImpactDealt,
        runUpTimer: 0,
        aimOffsetAngle: 0,
        strafeSign: bot.slotIndex % 2 === 0 ? 1 : -1,
        strafeSwitchTimer: 1.4 + (bot.slotIndex % 3) * 0.55,
        lowSpeedTimer: 0,
      };
      this.memories.set(bot.id, mem);
    }
    return mem;
  }

  /**
   * Computes the AI bot's input command for the current fixed step.
   * Uses the exact same PlayerInputCommand structure and physics rules as the human player.
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
    const mem = this.getOrCreateMemory(bot);

    mem.reactionTimer -= dt;
    mem.strafeSwitchTimer -= dt;
    mem.frustratedCooldown = Math.max(0, mem.frustratedCooldown - dt);
    mem.runUpTimer = Math.max(0, mem.runUpTimer - dt);

    if (mem.frustratedCooldown <= 0) {
      mem.frustratedTargetId = null;
    }

    if (mem.strafeSwitchTimer <= 0) {
      mem.strafeSign = -mem.strafeSign;
      mem.strafeSwitchTimer = 1.6 + this.nextRandom() * 1.4;
    }

    // Check if bot recently landed a meaningful hit; if so, reset frustration timer
    if (bot.totalImpactDealt > mem.lastImpactDealt + 6.0) {
      mem.lastImpactDealt = bot.totalImpactDealt;
      mem.targetPursuitTime = 0;
      mem.runUpTimer = 0;
    } else {
      mem.targetPursuitTime += dt;
    }

    const currentSpeed = lengthXZ(bot.velocity);
    if (currentSpeed < 2.2) {
      mem.lowSpeedTimer += dt;
    } else {
      mem.lowSpeedTimer = Math.max(0, mem.lowSpeedTimer - dt * 2);
    }

    // 1. Evaluate Edge Danger & Knockback Recovery
    const projectedPos: Vector3Like = {
      x: bot.position.x + bot.velocity.x * profile.velocityLookaheadSeconds,
      y: 0,
      z: bot.position.z + bot.velocity.z * profile.velocityLookaheadSeconds,
    };

    const currentRadialDist = lengthXZ(bot.position);
    const projectedRadialDist = lengthXZ(projectedPos);
    const effectiveRadius = Math.max(arena.minRadius * 0.82, arena.currentRadius);

    const currentDangerRatio = currentRadialDist / effectiveRadius;
    const projectedDangerRatio = projectedRadialDist / effectiveRadius;
    const maxDangerRatio = Math.max(currentDangerRatio, projectedDangerRatio);

    const toCenterDir = normalizeXZ({ x: -bot.position.x, y: 0, z: -bot.position.z });
    const outwardDir = { x: -toCenterDir.x, y: 0, z: -toCenterDir.z };
    const outwardSpeed = dotXZ(bot.velocity, outwardDir);

    // Check if the bot has an immediate opportunity to finish off an opponent who is even closer to the edge
    const currentTarget = allEntities.find(
      (e) => e.id === mem.cachedTargetId && e.isAlive && e.id !== bot.id
    );
    const targetDangerRatio = currentTarget
      ? lengthXZ(currentTarget.position) / effectiveRadius
      : 0;
    const canCommitToEdgeKill =
      currentTarget !== undefined &&
      (bot.knockbackTimer ?? 0) <= 0.05 &&
      outwardSpeed < 7.0 &&
      currentDangerRatio < profile.offensiveEdgeCommitRatio &&
      targetDangerRatio > currentDangerRatio + 0.03 &&
      distanceXZ(bot.position, currentTarget.position) < 6.5;

    const effectiveDangerLimit = canCommitToEdgeKill
      ? profile.offensiveEdgeCommitRatio
      : profile.edgeDangerThresholdRatio;

    const isBeingKnockedOut =
      maxDangerRatio >= effectiveDangerLimit ||
      (currentDangerRatio > 0.62 && outwardSpeed > 8.0) ||
      ((bot.knockbackTimer ?? 0) > 0.1 && currentDangerRatio > 0.58 && outwardSpeed > 4.5);

    if (isBeingKnockedOut) {
      const tangent: Vector3Like = {
        x: -toCenterDir.z * mem.strafeSign,
        y: 0,
        z: toCenterDir.x * mem.strafeSign,
      };
      const urgency = clamp(
        (maxDangerRatio - effectiveDangerLimit) / Math.max(0.08, 1.0 - effectiveDangerLimit),
        0.45,
        1.0
      );

      const recoverDir = normalizeXZ({
        x: toCenterDir.x * (0.88 + urgency * 0.12) + tangent.x * (1 - urgency) * 0.2,
        y: 0,
        z: toCenterDir.z * (0.88 + urgency * 0.12) + tangent.z * (1 - urgency) * 0.2,
      });

      const criticalDanger =
        maxDangerRatio >= profile.edgeCriticalRatio ||
        (currentDangerRatio > 0.74 && outwardSpeed > 6.5) ||
        ((bot.knockbackTimer ?? 0) > 0.18 && currentDangerRatio > 0.68 && outwardSpeed > 5.5);

      return {
        entityId: bot.id,
        moveX: recoverDir.x,
        moveZ: recoverDir.z,
        boostPressed: criticalDanger && bot.boostCooldownTimer <= 0,
      };
    }

    // 2. Target Frustration Check & Dynamic Target Selection
    if (mem.targetPursuitTime >= profile.targetFrustrationSeconds && mem.cachedTargetId) {
      mem.frustratedTargetId = mem.cachedTargetId;
      mem.frustratedCooldown = 2.6;
      mem.cachedTargetId = null;
      mem.targetPursuitTime = 0;
      mem.reactionTimer = 0;
    }

    let target = allEntities.find(
      (e) => e.id === mem.cachedTargetId && e.isAlive && e.id !== bot.id
    );
    if (mem.reactionTimer <= 0 || !target) {
      mem.reactionTimer = profile.reactionInterval;
      const prevTargetId = mem.cachedTargetId;
      target = this.selectBestTarget(bot, allEntities, arena, bot.difficulty, mem.frustratedTargetId);
      mem.cachedTargetId = target ? target.id : null;
      if (mem.cachedTargetId !== prevTargetId) {
        mem.targetPursuitTime = 0;
      }
      mem.aimOffsetAngle = (this.nextRandom() * 2 - 1) * profile.aimNoiseRadians;
    }

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

    // 3. Momentum-Building Run-Up vs. Tactical Strike Approach
    const rawDistToTarget = distanceXZ(bot.position, target.position);

    // If bot is stuck in close quarters with low momentum and no boost ready, peel back briefly to build a charge!
    if (
      mem.runUpTimer <= 0 &&
      rawDistToTarget < 3.4 &&
      currentSpeed < 6.2 &&
      bot.boostCooldownTimer > 0.45 &&
      mem.lowSpeedTimer > 0.28
    ) {
      mem.runUpTimer = 0.72;
      mem.lowSpeedTimer = 0;
    }

    const leadTime = clamp(rawDistToTarget / 22.0, 0.05, 0.42);
    const leadScale = bot.difficulty === 'hard' ? 1.0 : 0.45;
    const predictedTargetPos: Vector3Like = {
      x: target.position.x + target.velocity.x * leadTime * leadScale,
      y: 0,
      z: target.position.z + target.velocity.z * leadTime * leadScale,
    };

    const targetOutwardDir = normalizeXZ(predictedTargetPos);
    const hasOutwardDir = lengthXZ(targetOutwardDir) > 1e-4;
    const distToPredicted = distanceXZ(bot.position, predictedTargetPos);

    const dirToTarget = normalizeXZ({
      x: predictedTargetPos.x - bot.position.x,
      y: 0,
      z: predictedTargetPos.z - bot.position.z,
    });

    let desiredDir = dirToTarget;

    if (mem.runUpTimer > 0) {
      // Peel back toward inner side of target + tangent arc so bot builds run-up momentum
      const peelBackDir = hasOutwardDir
        ? { x: -targetOutwardDir.x, y: 0, z: -targetOutwardDir.z }
        : toCenterDir;
      const tangentDir = {
        x: -dirToTarget.z * mem.strafeSign,
        y: 0,
        z: dirToTarget.x * mem.strafeSign,
      };
      desiredDir = normalizeXZ({
        x: peelBackDir.x * 0.65 + tangentDir.x * 0.35,
        y: 0,
        z: peelBackDir.z * 0.65 + tangentDir.z * 0.35,
      });
    } else if (hasOutwardDir && distToPredicted > 3.2 && profile.flankPreference > 0) {
      // Stage behind the target along the center-to-target vector so the strike pushes them toward the rim
      const stagingDistance = clamp(distToPredicted * 0.48, 2.0, 4.6);
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

      const blend = profile.flankPreference * clamp((distToPredicted - 2.6) / 6.5, 0, 0.72);
      desiredDir = normalizeXZ({
        x: dirToTarget.x * (1 - blend) + dirToStaging.x * blend,
        y: 0,
        z: dirToTarget.z * (1 - blend) + dirToStaging.z * blend,
      });
    }

    // 4. Anti-Cluster Separation Force (prevents multiple bots from clumping together)
    let sepX = 0;
    let sepZ = 0;
    for (const other of allEntities) {
      if (other.id === bot.id || other.id === target.id || !other.isAlive) continue;
      const d = distanceXZ(bot.position, other.position);
      if (d > 1e-3 && d < 4.2) {
        const weight = (4.2 - d) / 4.2;
        sepX += ((bot.position.x - other.position.x) / d) * weight;
        sepZ += ((bot.position.z - other.position.z) / d) * weight;
      }
    }
    if (Math.hypot(sepX, sepZ) > 0.05) {
      desiredDir = normalizeXZ({
        x: desiredDir.x * 0.76 + sepX * 0.24,
        y: 0,
        z: desiredDir.z * 0.76 + sepZ * 0.24,
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

    // 5. Aimed Boost Decision (timed for high-impact strikes without self-elimination)
    let shouldBoost = false;
    if (
      mem.runUpTimer <= 0 &&
      bot.boostCooldownTimer <= 0 &&
      target.spawnProtectionTimer <= 0.15
    ) {
      const alignment = dotXZ(noisyDir, dirToTarget);
      const inStrikeRange =
        distToPredicted >= profile.boostMinRange &&
        distToPredicted <= profile.boostStrikeRange;

      // Project where a boost would carry the bot if it misses or follows through
      const boostTravelCheckDist = bot.difficulty === 'hard' ? 6.2 : 5.4;
      const boostEndEstimate: Vector3Like = {
        x: bot.position.x + noisyDir.x * boostTravelCheckDist,
        y: 0,
        z: bot.position.z + noisyDir.z * boostTravelCheckDist,
      };
      const boostEndDanger = lengthXZ(boostEndEstimate) / effectiveRadius;
      const safeToBoost = boostEndDanger < profile.edgeCriticalRatio * 0.95;

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
    difficulty: BotDifficulty,
    frustratedTargetId: string | null
  ): BallEntityState | undefined {
    const profile = BOT_DIFFICULTY_PROFILES[difficulty];
    let bestTarget: BallEntityState | undefined;
    let bestScore = -Infinity;

    for (const candidate of allEntities) {
      if (candidate.id === bot.id || !candidate.isAlive) {
        continue;
      }

      const dist = distanceXZ(bot.position, candidate.position);
      const candidateEdgeRatio = lengthXZ(candidate.position) / Math.max(1, arena.currentRadius);

      // Prefer targets within ideal strike/charge distance (4 to 12 units)
      const distPenalty = dist < 2.2 ? (2.2 - dist) * 2.5 : dist * 1.05;
      let score = -distPenalty;

      // Penalize spawn-protected targets
      if (candidate.spawnProtectionTimer > 0.2) {
        score -= 16.0;
      }

      // Penalize target if this bot recently got frustrated chasing it without landing a hit
      if (frustratedTargetId && candidate.id === frustratedTargetId) {
        score -= 12.0;
      }

      // Anti-clustering: count how many OTHER bots are already targeting or crowding this candidate
      let pursuerCount = 0;
      let localCrowdCount = 0;
      for (const other of allEntities) {
        if (other.id === bot.id || other.id === candidate.id || !other.isAlive) continue;
        const otherMem = this.memories.get(other.id);
        if (otherMem?.cachedTargetId === candidate.id) {
          pursuerCount += 1;
        }
        if (distanceXZ(other.position, candidate.position) < 4.5) {
          localCrowdCount += 1;
        }
      }
      score -= pursuerCount * profile.crowdPenaltyWeight + localCrowdCount * 4.2;

      if (difficulty === 'hard') {
        // Hard bots strongly prioritize vulnerable opponents near the arena edge
        score += candidateEdgeRatio * 15.5;

        // Bonus if candidate is already knocked back / sliding toward the edge
        if ((candidate.knockbackTimer ?? 0) > 0) {
          score += 4.5;
        }

        // Favor targets where the bot is positioned on the inner side (radial push alignment)
        const botToCandidate = normalizeXZ({
          x: candidate.position.x - bot.position.x,
          y: 0,
          z: candidate.position.z - bot.position.z,
        });
        const candidateOutward = normalizeXZ(candidate.position);
        const radialAlignment = dotXZ(botToCandidate, candidateOutward);
        score += radialAlignment * 5.8;
      } else {
        // Normal bots balance distance with moderate edge preference
        score += candidateEdgeRatio * 7.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }
}
