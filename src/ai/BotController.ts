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

interface HazardPushAnalysis {
  vulnerabilityRatio: number; // 0 (safe) to 1 (right next to outer edge or hole)
  idealPushDir: Vector3Like;
  isHoleHazard: boolean;
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

    // 1. Evaluate Multi-Hazard Survival & Recovery (Outer Edge + Internal Holes)
    const currentTarget = allEntities.find(
      (e) => e.id === mem.cachedTargetId && e.isAlive && e.id !== bot.id
    );
    const hazardRecovery = this.evaluateHazardRecovery(
      bot,
      arena,
      currentTarget,
      mem.strafeSign
    );

    if (hazardRecovery.inDanger) {
      return {
        entityId: bot.id,
        moveX: hazardRecovery.recoverDir.x,
        moveZ: hazardRecovery.recoverDir.z,
        boostPressed:
          hazardRecovery.criticalDanger &&
          bot.boostCooldownTimer <= 0 &&
          this.isBoostTrajectorySafe(bot.position, hazardRecovery.recoverDir, arena, bot.difficulty),
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
      target = this.selectBestTarget(
        bot,
        allEntities,
        arena,
        bot.difficulty,
        mem.frustratedTargetId
      );
      mem.cachedTargetId = target ? target.id : null;
      if (mem.cachedTargetId !== prevTargetId) {
        mem.targetPursuitTime = 0;
      }
      mem.aimOffsetAngle = (this.nextRandom() * 2 - 1) * profile.aimNoiseRadians;
    }

    if (!target) {
      const patrolDir = this.computeSafePatrolDir(bot.position, arena, mem.strafeSign);
      return {
        entityId: bot.id,
        moveX: patrolDir.x,
        moveZ: patrolDir.z,
        boostPressed: false,
      };
    }

    // 3. Momentum-Building Run-Up vs. Tactical Hazard Strike Approach
    const rawDistToTarget = distanceXZ(bot.position, target.position);

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

    const targetPushAnalysis = this.computeBestHazardPushForTarget(predictedTargetPos, arena);
    const distToPredicted = distanceXZ(bot.position, predictedTargetPos);

    const dirToTarget = normalizeXZ({
      x: predictedTargetPos.x - bot.position.x,
      y: 0,
      z: predictedTargetPos.z - bot.position.z,
    });

    let goalPos: Vector3Like = predictedTargetPos;
    let desiredDir = dirToTarget;

    if (mem.runUpTimer > 0) {
      const awayFromTarget = {
        x: -dirToTarget.x,
        y: 0,
        z: -dirToTarget.z,
      };
      const tangentDir = {
        x: -dirToTarget.z * mem.strafeSign,
        y: 0,
        z: dirToTarget.x * mem.strafeSign,
      };
      desiredDir = normalizeXZ({
        x: awayFromTarget.x * 0.58 + tangentDir.x * 0.42,
        y: 0,
        z: awayFromTarget.z * 0.58 + tangentDir.z * 0.42,
      });
      goalPos = {
        x: bot.position.x + desiredDir.x * 5.0,
        y: 0,
        z: bot.position.z + desiredDir.z * 5.0,
      };
    } else if (distToPredicted > 3.2 && profile.flankPreference > 0) {
      // Stage behind the target along the ideal hazard push vector (toward outer rim OR nearest hole!)
      const stagingDistance = clamp(distToPredicted * 0.46, 2.0, 4.4);
      const stagingPoint: Vector3Like = {
        x: predictedTargetPos.x - targetPushAnalysis.idealPushDir.x * stagingDistance,
        y: 0,
        z: predictedTargetPos.z - targetPushAnalysis.idealPushDir.z * stagingDistance,
      };

      if (this.isPointSafeForNavigation(stagingPoint, arena, 2.1)) {
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
        goalPos = {
          x: predictedTargetPos.x * (1 - blend) + stagingPoint.x * blend,
          y: 0,
          z: predictedTargetPos.z * (1 - blend) + stagingPoint.z * blend,
        };
      }
    }

    // 4. Anti-Cluster Separation Force
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

    // 5. Navigate Safely Around Holes & Bumpers (Waypoints + Lookahead Context Steering)
    desiredDir = this.steerAroundHazardsAndObstacles(
      bot,
      desiredDir,
      goalPos,
      arena,
      mem.strafeSign
    );

    // Apply difficulty aim noise (clamped so noise never steers into an immediate hole)
    const cosA = Math.cos(mem.aimOffsetAngle);
    const sinA = Math.sin(mem.aimOffsetAngle);
    let noisyDir = normalizeXZ({
      x: desiredDir.x * cosA - desiredDir.z * sinA,
      y: 0,
      z: desiredDir.x * sinA + desiredDir.z * cosA,
    });

    const noisyCheckPt: Vector3Like = {
      x: bot.position.x + noisyDir.x * 3.2,
      y: 0,
      z: bot.position.z + noisyDir.z * 3.2,
    };
    if (!this.isPointSafeForNavigation(noisyCheckPt, arena, 1.6)) {
      noisyDir = desiredDir;
    }

    // 6. Aimed Boost Decision (verified safe across all holes and outer boundary)
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

      const safeToBoost = this.isBoostTrajectorySafe(
        bot.position,
        noisyDir,
        arena,
        bot.difficulty
      );

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

  /**
   * Evaluates whether the bot is in danger from either the outer arena boundary or any internal hole,
   * and returns the combined safe recovery direction.
   */
  private evaluateHazardRecovery(
    bot: BallEntityState,
    arena: ArenaState,
    currentTarget: BallEntityState | undefined,
    strafeSign: number
  ): { inDanger: boolean; criticalDanger: boolean; recoverDir: Vector3Like } {
    const profile = BOT_DIFFICULTY_PROFILES[bot.difficulty];
    const projectedPos: Vector3Like = {
      x: bot.position.x + bot.velocity.x * profile.velocityLookaheadSeconds,
      y: 0,
      z: bot.position.z + bot.velocity.z * profile.velocityLookaheadSeconds,
    };

    const effectiveRadius = Math.max(arena.minRadius * 0.85, arena.currentRadius);
    const currentRadialDist = lengthXZ(bot.position);
    const projectedRadialDist = lengthXZ(projectedPos);
    const currentDangerRatio = currentRadialDist / effectiveRadius;
    const projectedDangerRatio = projectedRadialDist / effectiveRadius;
    const maxOuterRatio = Math.max(currentDangerRatio, projectedDangerRatio);

    const toCenterDir = normalizeXZ({ x: -bot.position.x, y: 0, z: -bot.position.z });
    const outwardDir = { x: -toCenterDir.x, y: 0, z: -toCenterDir.z };
    const outwardSpeed = dotXZ(bot.velocity, outwardDir);

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

    const effectiveOuterLimit = canCommitToEdgeKill
      ? profile.offensiveEdgeCommitRatio
      : profile.edgeDangerThresholdRatio;

    let recoverX = 0;
    let recoverZ = 0;
    let inDanger = false;
    let criticalDanger = false;

    // A. Outer Boundary Danger
    const outerDangerTriggered =
      maxOuterRatio >= effectiveOuterLimit ||
      (currentDangerRatio > 0.62 && outwardSpeed > 8.0) ||
      ((bot.knockbackTimer ?? 0) > 0.1 && currentDangerRatio > 0.58 && outwardSpeed > 4.5);

    if (outerDangerTriggered) {
      inDanger = true;
      const urgency = clamp(
        (maxOuterRatio - effectiveOuterLimit) / Math.max(0.08, 1.0 - effectiveOuterLimit),
        0.5,
        1.0
      );
      const tangentX = -toCenterDir.z * strafeSign;
      const tangentZ = toCenterDir.x * strafeSign;
      recoverX += toCenterDir.x * (0.9 + urgency * 0.25) + tangentX * (1 - urgency) * 0.22;
      recoverZ += toCenterDir.z * (0.9 + urgency * 0.25) + tangentZ * (1 - urgency) * 0.22;

      if (
        maxOuterRatio >= profile.edgeCriticalRatio ||
        (currentDangerRatio > 0.74 && outwardSpeed > 6.5) ||
        ((bot.knockbackTimer ?? 0) > 0.18 && currentDangerRatio > 0.68 && outwardSpeed > 5.5)
      ) {
        criticalDanger = true;
      }
    }

    // B. Internal Holes Danger (Crater & Donut Arenas)
    const holeWarnClearance = bot.difficulty === 'hard' ? 3.3 : 2.75;
    const holeCriticalClearance = bot.difficulty === 'hard' ? 1.85 : 1.55;

    for (const hole of arena.holes) {
      const dxCurr = bot.position.x - hole.x;
      const dzCurr = bot.position.z - hole.z;
      const distCurr = Math.hypot(dxCurr, dzCurr);
      const clearanceCurr = distCurr - hole.radius;

      const dxProj = projectedPos.x - hole.x;
      const dzProj = projectedPos.z - hole.z;
      const distProj = Math.hypot(dxProj, dzProj);
      const clearanceProj = distProj - hole.radius;

      const minClearance = Math.min(clearanceCurr, clearanceProj);
      const awayFromHole =
        distCurr > 1e-4
          ? { x: dxCurr / distCurr, y: 0, z: dzCurr / distCurr }
          : { x: 1, y: 0, z: 0 };
      const speedTowardHole = -dotXZ(bot.velocity, awayFromHole);

      const holeDangerTriggered =
        minClearance < holeWarnClearance ||
        (clearanceCurr < holeWarnClearance + 1.6 && speedTowardHole > 5.2) ||
        ((bot.knockbackTimer ?? 0) > 0.08 &&
          clearanceCurr < holeWarnClearance + 2.0 &&
          speedTowardHole > 3.5);

      if (holeDangerTriggered) {
        inDanger = true;
        const holeUrgency = clamp(
          (holeWarnClearance - minClearance) / Math.max(0.5, holeWarnClearance),
          0.6,
          1.4
        );
        // Add a tangent component so the bot curves around the hole rim instead of stalling
        const holeTanX = -awayFromHole.z * strafeSign;
        const holeTanZ = awayFromHole.x * strafeSign;
        recoverX += awayFromHole.x * (1.15 * holeUrgency) + holeTanX * 0.32;
        recoverZ += awayFromHole.z * (1.15 * holeUrgency) + holeTanZ * 0.32;

        if (
          minClearance < holeCriticalClearance ||
          (clearanceCurr < holeCriticalClearance + 1.1 && speedTowardHole > 5.0)
        ) {
          criticalDanger = true;
        }
      }
    }

    if (!inDanger) {
      return { inDanger: false, criticalDanger: false, recoverDir: { x: 0, y: 0, z: 0 } };
    }

    const recoverDir = normalizeXZ({ x: recoverX, y: 0, z: recoverZ });
    return {
      inDanger: true,
      criticalDanger,
      recoverDir: lengthXZ(recoverDir) > 1e-4 ? recoverDir : toCenterDir,
    };
  }

  /**
   * Computes which hazard (outer rim or nearest internal hole) a target is most vulnerable to,
   * and the unit vector direction that pushes the target into that hazard.
   */
  private computeBestHazardPushForTarget(
    targetPos: Vector3Like,
    arena: ArenaState
  ): HazardPushAnalysis {
    const radialDist = lengthXZ(targetPos);
    const outerClearance = Math.max(0.1, arena.currentRadius - radialDist);
    let minClearance = outerClearance;
    let idealPushDir =
      radialDist > 1e-3 ? normalizeXZ(targetPos) : { x: 1, y: 0, z: 0 };
    let isHoleHazard = false;

    for (const hole of arena.holes) {
      const dx = hole.x - targetPos.x;
      const dz = hole.z - targetPos.z;
      const distToCenter = Math.hypot(dx, dz);
      const holeClearance = Math.max(0.1, distToCenter - hole.radius);

      // Weight hole proximity slightly higher so bots actively look for hole knockouts when enemies are near a hole
      if (holeClearance * 0.88 < minClearance && distToCenter > 1e-3) {
        minClearance = holeClearance;
        idealPushDir = { x: dx / distToCenter, y: 0, z: dz / distToCenter };
        isHoleHazard = true;
      }
    }

    const maxRefDist = Math.max(6.0, arena.currentRadius * 0.65);
    const vulnerabilityRatio = clamp(1 - minClearance / maxRefDist, 0, 1);

    return {
      vulnerabilityRatio,
      idealPushDir,
      isHoleHazard,
    };
  }

  /**
   * Steers the bot around any blocking holes (Crater / Donut) and bumper pillars (Bumper Arena)
   * using tangent waypoint deflection + multi-ray lookahead scoring.
   */
  private steerAroundHazardsAndObstacles(
    bot: BallEntityState,
    desiredDir: Vector3Like,
    goalPos: Vector3Like,
    arena: ArenaState,
    strafeSign: number
  ): Vector3Like {
    let navDir = desiredDir;
    const distToGoal = distanceXZ(bot.position, goalPos);

    // 1. Analytical Tangent Deflection around blocking holes and bumpers along the path to goalPos
    const holeSafetyMargin = bot.difficulty === 'hard' ? 2.55 : 2.05;

    for (const hole of arena.holes) {
      const safeR = hole.radius + holeSafetyMargin;
      const toHoleX = hole.x - bot.position.x;
      const toHoleZ = hole.z - bot.position.z;
      const distToHole = Math.hypot(toHoleX, toHoleZ);

      const proj = toHoleX * navDir.x + toHoleZ * navDir.z;
      if (proj > -0.5 && proj < distToGoal + 1.0) {
        const perpSq = Math.max(0, distToHole * distToHole - proj * proj);
        const perpDist = Math.sqrt(perpSq);

        if (perpDist < safeR && distToHole > 1e-3) {
          // Straight path cuts through or too close to this hole!
          // Compute the two tangent directions around the hole and pick the better side.
          const toHoleUnit = { x: toHoleX / distToHole, y: 0, z: toHoleZ / distToHole };
          const tanLeft = { x: -toHoleUnit.z, y: 0, z: toHoleUnit.x };
          const tanRight = { x: toHoleUnit.z, y: 0, z: -toHoleUnit.x };

          // Push outward from the hole while following the tangent that aligns best with goalPos
          const sinAlpha = clamp(safeR / Math.max(safeR + 0.1, distToHole), 0.35, 0.92);
          const cosAlpha = Math.sqrt(Math.max(0.08, 1 - sinAlpha * sinAlpha));

          const candLeft = normalizeXZ({
            x: toHoleUnit.x * cosAlpha * 0.25 + tanLeft.x * sinAlpha,
            y: 0,
            z: toHoleUnit.z * cosAlpha * 0.25 + tanLeft.z * sinAlpha,
          });
          const candRight = normalizeXZ({
            x: toHoleUnit.x * cosAlpha * 0.25 + tanRight.x * sinAlpha,
            y: 0,
            z: toHoleUnit.z * cosAlpha * 0.25 + tanRight.z * sinAlpha,
          });

          const leftTestPt = {
            x: bot.position.x + candLeft.x * 4.5,
            y: 0,
            z: bot.position.z + candLeft.z * 4.5,
          };
          const rightTestPt = {
            x: bot.position.x + candRight.x * 4.5,
            y: 0,
            z: bot.position.z + candRight.z * 4.5,
          };

          const leftSafe = this.isPointSafeForNavigation(leftTestPt, arena, 1.8);
          const rightSafe = this.isPointSafeForNavigation(rightTestPt, arena, 1.8);

          const leftAlign = dotXZ(candLeft, desiredDir);
          const rightAlign = dotXZ(candRight, desiredDir);

          if (leftSafe && !rightSafe) {
            navDir = candLeft;
          } else if (rightSafe && !leftSafe) {
            navDir = candRight;
          } else if (Math.abs(leftAlign - rightAlign) > 0.08) {
            navDir = leftAlign >= rightAlign ? candLeft : candRight;
          } else {
            navDir = strafeSign >= 0 ? candLeft : candRight;
          }
        }
      }
    }

    // Also deflect smoothly around bumper pillars when navigating toward a target
    for (const bumper of arena.bumpers) {
      const safeR = bumper.radius + 1.55;
      const toBumpX = bumper.x - bot.position.x;
      const toBumpZ = bumper.z - bot.position.z;
      const distToBump = Math.hypot(toBumpX, toBumpZ);
      const proj = toBumpX * navDir.x + toBumpZ * navDir.z;

      if (proj > 0 && proj < Math.min(distToGoal, 5.5)) {
        const perpDist = Math.sqrt(Math.max(0, distToBump * distToBump - proj * proj));
        if (perpDist < safeR && distToBump > 1e-3) {
          const toBumpUnit = { x: toBumpX / distToBump, y: 0, z: toBumpZ / distToBump };
          const tanA = { x: -toBumpUnit.z, y: 0, z: toBumpUnit.x };
          const tanB = { x: toBumpUnit.z, y: 0, z: -toBumpUnit.x };
          const chosenTan = dotXZ(tanA, navDir) >= dotXZ(tanB, navDir) ? tanA : tanB;
          navDir = normalizeXZ({
            x: navDir.x * 0.45 + chosenTan.x * 0.55,
            y: 0,
            z: navDir.z * 0.45 + chosenTan.z * 0.55,
          });
        }
      }
    }

    // 2. Multi-Ray Context Steering Safety Filter (ensures chosen direction won't roll into a hole or off the edge)
    const lookaheadDist = Math.max(3.6, lengthXZ(bot.velocity) * 0.42);
    const checkMid: Vector3Like = {
      x: bot.position.x + navDir.x * (lookaheadDist * 0.55),
      y: 0,
      z: bot.position.z + navDir.z * (lookaheadDist * 0.55),
    };
    const checkFar: Vector3Like = {
      x: bot.position.x + navDir.x * lookaheadDist,
      y: 0,
      z: bot.position.z + navDir.z * lookaheadDist,
    };

    const margin = bot.difficulty === 'hard' ? 1.85 : 1.5;
    if (
      this.isPointSafeForNavigation(checkMid, arena, margin) &&
      this.isPointSafeForNavigation(checkFar, arena, margin)
    ) {
      return navDir;
    }

    // Current navDir approaches a hazard: evaluate 16 candidate directions around the compass
    let bestDir = navDir;
    let bestDirScore = -Infinity;
    const candidateCount = 16;

    for (let i = 0; i < candidateCount; i++) {
      const angle = (i / candidateCount) * Math.PI * 2;
      const cand: Vector3Like = { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
      const ptNear: Vector3Like = {
        x: bot.position.x + cand.x * 2.4,
        y: 0,
        z: bot.position.z + cand.z * 2.4,
      };
      const ptFar: Vector3Like = {
        x: bot.position.x + cand.x * 4.6,
        y: 0,
        z: bot.position.z + cand.z * 4.6,
      };

      const nearSafe = this.isPointSafeForNavigation(ptNear, arena, margin);
      const farSafe = this.isPointSafeForNavigation(ptFar, arena, margin * 0.85);

      let score = dotXZ(cand, navDir) * 3.0 + dotXZ(cand, desiredDir) * 1.5;
      if (!nearSafe) score -= 25.0;
      if (!farSafe) score -= 12.0;

      if (score > bestDirScore) {
        bestDirScore = score;
        bestDir = cand;
      }
    }

    return bestDir;
  }

  private isPointSafeForNavigation(
    pt: Vector3Like,
    arena: ArenaState,
    margin: number
  ): boolean {
    const radialDist = lengthXZ(pt);
    if (radialDist > arena.currentRadius - margin) {
      return false;
    }
    for (const hole of arena.holes) {
      const d = Math.hypot(pt.x - hole.x, pt.z - hole.z);
      if (d < hole.radius + margin) {
        return false;
      }
    }
    for (const bumper of arena.bumpers) {
      const d = Math.hypot(pt.x - bumper.x, pt.z - bumper.z);
      if (d < bumper.radius + Math.min(margin, 1.15)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Verifies that boosting along `boostDir` will not carry the bot into a hole or over the outer arena edge.
   */
  private isBoostTrajectorySafe(
    startPos: Vector3Like,
    boostDir: Vector3Like,
    arena: ArenaState,
    difficulty: BotDifficulty
  ): boolean {
    const profile = BOT_DIFFICULTY_PROFILES[difficulty];
    const effectiveRadius = Math.max(arena.minRadius * 0.85, arena.currentRadius);
    const maxSafeOuterR = effectiveRadius * profile.edgeCriticalRatio * 0.95;
    const travelDist = difficulty === 'hard' ? 6.4 : 5.4;
    const holeBuffer = difficulty === 'hard' ? 1.85 : 1.55;

    const fractions = [0.25, 0.5, 0.75, 1.0];
    for (const frac of fractions) {
      const sampleX = startPos.x + boostDir.x * (travelDist * frac);
      const sampleZ = startPos.z + boostDir.z * (travelDist * frac);

      if (Math.hypot(sampleX, sampleZ) > maxSafeOuterR) {
        return false;
      }
      for (const hole of arena.holes) {
        if (Math.hypot(sampleX - hole.x, sampleZ - hole.z) < hole.radius + holeBuffer) {
          return false;
        }
      }
    }

    return true;
  }

  private computeSafePatrolDir(
    pos: Vector3Like,
    arena: ArenaState,
    strafeSign: number
  ): Vector3Like {
    const radialDist = lengthXZ(pos);
    if (arena.innerHoleRadius > 0) {
      // Donut Arena: patrol around the midline of the ring
      const midR = (arena.innerHoleRadius + arena.currentRadius) * 0.5;
      const radialUnit = radialDist > 1e-3 ? normalizeXZ(pos) : { x: 1, y: 0, z: 0 };
      const tangent = {
        x: -radialUnit.z * strafeSign,
        y: 0,
        z: radialUnit.x * strafeSign,
      };
      const radialPull = clamp((midR - radialDist) * 0.35, -0.7, 0.7);
      return normalizeXZ({
        x: tangent.x + radialUnit.x * radialPull,
        y: 0,
        z: tangent.z + radialUnit.z * radialPull,
      });
    }

    if (radialDist > 4.5) {
      return normalizeXZ({ x: -pos.x, y: 0, z: -pos.z });
    }
    return { x: strafeSign, y: 0, z: 0 };
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
      const pushAnalysis = this.computeBestHazardPushForTarget(candidate.position, arena);

      // Prefer targets within ideal strike/charge distance (4 to 12 units)
      const distPenalty = dist < 2.2 ? (2.2 - dist) * 2.5 : dist * 1.05;
      let score = -distPenalty;

      if (candidate.spawnProtectionTimer > 0.2) {
        score -= 16.0;
      }

      if (frustratedTargetId && candidate.id === frustratedTargetId) {
        score -= 12.0;
      }

      // Penalize candidates where a hole directly blocks the straight line between bot and candidate
      for (const hole of arena.holes) {
        const toHoleX = hole.x - bot.position.x;
        const toHoleZ = hole.z - bot.position.z;
        const botToCand = normalizeXZ({
          x: candidate.position.x - bot.position.x,
          y: 0,
          z: candidate.position.z - bot.position.z,
        });
        const proj = toHoleX * botToCand.x + toHoleZ * botToCand.z;
        if (proj > 0 && proj < dist) {
          const distToHoleSq = toHoleX * toHoleX + toHoleZ * toHoleZ;
          const perpDist = Math.sqrt(Math.max(0, distToHoleSq - proj * proj));
          if (perpDist < hole.radius + 1.5) {
            score -= 6.5;
          }
        }
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
        // Hard bots strongly prioritize vulnerable opponents near the outer edge OR near a hole
        score += pushAnalysis.vulnerabilityRatio * 16.5;

        if ((candidate.knockbackTimer ?? 0) > 0) {
          score += 4.5;
        }

        // Favor targets where the bot is already aligned behind the ideal push vector into a hole or edge
        const botToCandidate = normalizeXZ({
          x: candidate.position.x - bot.position.x,
          y: 0,
          z: candidate.position.z - bot.position.z,
        });
        const pushAlignment = dotXZ(botToCandidate, pushAnalysis.idealPushDir);
        score += pushAlignment * 6.2;
      } else {
        score += pushAnalysis.vulnerabilityRatio * 8.0;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }
}
