import { PHYSICS_CONSTANTS } from '../config/constants';
import type { BallEntityState, GameEvent, ImpactTier, Vector3Like } from '../types/game';
import { clamp, dotXZ, lengthXZ, normalizeXZ } from '../utils/math';

export interface CollisionResolution {
  applied: boolean;
  velocityA: Vector3Like;
  velocityB: Vector3Like;
  event?: Extract<GameEvent, { type: 'collision' }>;
}

interface DirectionalStrikeMetrics {
  impulse: number;
  tier: ImpactTier;
  isBoosted: boolean;
  isPerfect: boolean;
  knockbackDuration: number;
}

export class CollisionSystem {
  private pairCooldowns = new Map<string, number>();

  public reset(): void {
    this.pairCooldowns.clear();
  }

  private getPairKey(idA: string, idB: string): string {
    return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
  }

  /**
   * Resolves a physical combat collision between two balls:
   * - Distinguishes 5 clear impact tiers: glancing, normal, heavy, boost, and perfect_boost
   * - Computes asymmetric momentum transfer so a charging/boosting attacker launches the defender
   *   while retaining forward follow-through momentum
   * - Sets knockbackTimer on the receiver so impacts carry meaningful distance
   */
  public resolveBallCollision(
    ballA: BallEntityState,
    ballB: BallEntityState,
    currentTime: number
  ): CollisionResolution {
    if (!ballA.isAlive || !ballB.isAlive) {
      return {
        applied: false,
        velocityA: { ...ballA.velocity },
        velocityB: { ...ballB.velocity },
      };
    }

    const pairKey = this.getPairKey(ballA.id, ballB.id);
    const lastCollisionTime = this.pairCooldowns.get(pairKey);
    if (
      lastCollisionTime !== undefined &&
      currentTime - lastCollisionTime < PHYSICS_CONSTANTS.COLLISION_PAIR_COOLDOWN
    ) {
      return {
        applied: false,
        velocityA: { ...ballA.velocity },
        velocityB: { ...ballB.velocity },
      };
    }

    // Horizontal contact normal from A to B
    const delta = {
      x: ballB.position.x - ballA.position.x,
      y: 0,
      z: ballB.position.z - ballA.position.z,
    };
    let normalAB = normalizeXZ(delta);
    if (lengthXZ(normalAB) < 1e-5) {
      normalAB = { x: 1, y: 0, z: 0 };
    }
    const normalBA = { x: -normalAB.x, y: 0, z: -normalAB.z };

    // Approach speeds along the collision normal
    const speedATowardB = Math.max(0, dotXZ(ballA.velocity, normalAB));
    const speedBTowardA = Math.max(0, dotXZ(ballB.velocity, normalBA));
    const closingSpeed = speedATowardB + speedBTowardA;

    const aBoosting = ballA.boostActiveTimer > 0;
    const bBoosting = ballB.boostActiveTimer > 0;

    // Evaluate offensive strike from A -> B and B -> A
    const strikeAOnB = CollisionSystem.evaluateStrike(
      ballA,
      ballB,
      normalAB,
      speedATowardB,
      closingSpeed
    );
    const strikeBOnA = CollisionSystem.evaluateStrike(
      ballB,
      ballA,
      normalBA,
      speedBTowardA,
      closingSpeed
    );

    this.pairCooldowns.set(pairKey, currentTime);

    // Determine if one ball clearly dominated the collision
    const aDominated = strikeAOnB.impulse > strikeBOnA.impulse * 1.22;
    const bDominated = strikeBOnA.impulse > strikeAOnB.impulse * 1.22;

    // Compute resultant velocity for Ball B (hit along normalAB)
    const newVelB = CollisionSystem.computePostImpactVelocity(
      ballB.velocity,
      normalAB,
      speedBTowardA,
      strikeAOnB.impulse,
      bDominated,
      speedBTowardA,
      strikeAOnB.isBoosted || strikeBOnA.isBoosted
    );

    // Compute resultant velocity for Ball A (hit along normalBA)
    const newVelA = CollisionSystem.computePostImpactVelocity(
      ballA.velocity,
      normalBA,
      speedATowardB,
      strikeBOnA.impulse,
      aDominated,
      speedATowardB,
      strikeAOnB.isBoosted || strikeBOnA.isBoosted
    );

    // Apply post-hit knockback recovery timers (winner of impact gets minimal stun)
    const stunOnB = aDominated
      ? strikeAOnB.knockbackDuration
      : bDominated
        ? strikeAOnB.knockbackDuration * 0.25
        : strikeAOnB.knockbackDuration * 0.75;
    const stunOnA = bDominated
      ? strikeBOnA.knockbackDuration
      : aDominated
        ? strikeBOnA.knockbackDuration * 0.25
        : strikeBOnA.knockbackDuration * 0.75;

    ballB.knockbackTimer = Math.max(ballB.knockbackTimer ?? 0, stunOnB);
    ballA.knockbackTimer = Math.max(ballA.knockbackTimer ?? 0, stunOnA);

    // Record LastHitAttribution for knockout scoring
    const effectiveClosing = Math.max(closingSpeed, 2.5);
    ballB.lastHit = {
      attackerId: ballA.id,
      attackerName: ballA.name,
      timestamp: currentTime,
      impactSpeed: effectiveClosing,
      impulseMagnitude: strikeAOnB.impulse,
      impactTier: strikeAOnB.tier,
    };

    ballA.lastHit = {
      attackerId: ballB.id,
      attackerName: ballB.name,
      timestamp: currentTime,
      impactSpeed: effectiveClosing,
      impulseMagnitude: strikeBOnA.impulse,
      impactTier: strikeBOnA.tier,
    };

    ballA.totalImpactDealt += strikeAOnB.impulse;
    ballB.totalImpactDealt += strikeBOnA.impulse;

    // Dominant impact metrics for visual/audio event
    const aIsPrimaryAttacker = strikeAOnB.impulse >= strikeBOnA.impulse;
    const primaryStrike = aIsPrimaryAttacker ? strikeAOnB : strikeBOnA;
    const knockbackDirection = aIsPrimaryAttacker ? normalAB : normalBA;
    const attackerId =
      Math.abs(strikeAOnB.impulse - strikeBOnA.impulse) < 1.5
        ? null
        : aIsPrimaryAttacker
          ? ballA.id
          : ballB.id;

    // Visual squash-and-stretch proportional to impact tier
    const squashFactor = clamp(
      primaryStrike.impulse / 72.0,
      0.1,
      primaryStrike.isPerfect ? 0.42 : 0.34
    );
    ballA.squashStretch = {
      x: 1 + squashFactor,
      y: 1 - squashFactor * 0.78,
      z: 1 + squashFactor,
    };
    ballB.squashStretch = {
      x: 1 + squashFactor,
      y: 1 - squashFactor * 0.78,
      z: 1 + squashFactor,
    };

    const contactPoint: Vector3Like = {
      x: (ballA.position.x + ballB.position.x) * 0.5,
      y: (ballA.position.y + ballB.position.y) * 0.5,
      z: (ballA.position.z + ballB.position.z) * 0.5,
    };

    return {
      applied: true,
      velocityA: newVelA,
      velocityB: newVelB,
      event: {
        type: 'collision',
        timestamp: currentTime,
        point: contactPoint,
        normal: normalAB,
        knockbackDirection,
        entityAId: ballA.id,
        entityBId: ballB.id,
        attackerId,
        relativeSpeed: effectiveClosing,
        impulse: primaryStrike.impulse,
        impactTier: primaryStrike.tier,
        isBoostedImpact: aBoosting || bBoosting,
        isPerfectImpact: strikeAOnB.isPerfect || strikeBOnA.isPerfect,
      },
    };
  }

  /**
   * Evaluates the offensive strike delivered by `attacker` onto `defender` along `attackNormal`.
   */
  public static evaluateStrike(
    attacker: BallEntityState,
    defender: BallEntityState,
    attackNormal: Vector3Like,
    approachSpeed: number,
    closingSpeed: number
  ): DirectionalStrikeMetrics {
    const attackerSpeed = lengthXZ(attacker.velocity);
    const directness =
      attackerSpeed > 1.0 ? clamp(dotXZ(attacker.velocity, attackNormal) / attackerSpeed, 0, 1) : 0.4;

    const isBoosting = attacker.boostActiveTimer > 0;
    const boostElapsed = isBoosting
      ? PHYSICS_CONSTANTS.BOOST_DURATION - attacker.boostActiveTimer
      : 999;

    // Perfect Impact Window: hitting an opponent directly during the high-output first 0.24s of boost
    const isPerfect =
      isBoosting &&
      boostElapsed <= PHYSICS_CONSTANTS.PERFECT_IMPACT_WINDOW_SECONDS &&
      directness >= 0.6 &&
      approachSpeed >= 10.5;

    // 1. Low-speed / accidental glancing touch
    if (
      !isBoosting &&
      closingSpeed < PHYSICS_CONSTANTS.GLANCING_SPEED_THRESHOLD &&
      approachSpeed < 3.5
    ) {
      const glancingImpulse = clamp(
        PHYSICS_CONSTANTS.MIN_KNOCKBACK_IMPULSE + closingSpeed * 0.55,
        PHYSICS_CONSTANTS.MIN_KNOCKBACK_IMPULSE,
        6.8
      );
      return {
        impulse: glancingImpulse,
        tier: 'glancing',
        isBoosted: false,
        isPerfect: false,
        knockbackDuration: PHYSICS_CONSTANTS.GLANCING_KNOCKBACK_DURATION,
      };
    }

    // Scale base impulse by how actively this ball is driving into the contact
    // (Prevents a stationary or retreating ball from dealing full base knockback back onto a charger)
    const activeDriveRatio = isBoosting
      ? 1.0
      : clamp(0.28 + (approachSpeed / 9.5) * 0.72, 0.28, 1.0);

    const baseComponent = PHYSICS_CONSTANTS.BASE_KNOCKBACK_IMPULSE * activeDriveRatio;
    const velocityComponent =
      (approachSpeed * (0.78 + 0.32 * directness) +
        closingSpeed * PHYSICS_CONSTANTS.CLOSING_SPEED_SHARE * activeDriveRatio) *
      PHYSICS_CONSTANTS.VELOCITY_KNOCKBACK_SCALE;

    const isHeavyCharge =
      !isBoosting && approachSpeed >= PHYSICS_CONSTANTS.HEAVY_HIT_SPEED_THRESHOLD;

    const boostMult = isPerfect
      ? PHYSICS_CONSTANTS.PERFECT_BOOST_MULTIPLIER
      : isBoosting
        ? PHYSICS_CONSTANTS.BOOST_ATTACK_MULTIPLIER
        : isHeavyCharge
          ? 1.12
          : 1.0;

    const defenderBoostResist =
      defender.boostActiveTimer > 0 ? PHYSICS_CONSTANTS.BOOST_DEFENSE_RESISTANCE : 1.0;
    const defenderSpawnShield = defender.spawnProtectionTimer > 0 ? 0.45 : 1.0;
    const angleBonus = CollisionSystem.computeAngleMultiplier(attackNormal, defender.velocity);

    const rawImpulse =
      (baseComponent + velocityComponent) *
      boostMult *
      defenderBoostResist *
      angleBonus *
      defenderSpawnShield;

    const impulse = clamp(
      rawImpulse,
      PHYSICS_CONSTANTS.MIN_KNOCKBACK_IMPULSE,
      PHYSICS_CONSTANTS.MAX_KNOCKBACK_IMPULSE
    );

    let tier: ImpactTier = 'normal';
    let knockbackDuration: number = PHYSICS_CONSTANTS.NORMAL_KNOCKBACK_DURATION;

    if (isPerfect) {
      tier = 'perfect_boost';
      knockbackDuration = PHYSICS_CONSTANTS.PERFECT_BOOST_KNOCKBACK_DURATION;
    } else if (isBoosting) {
      tier = 'boost';
      knockbackDuration = PHYSICS_CONSTANTS.BOOST_KNOCKBACK_DURATION;
    } else if (isHeavyCharge || impulse >= 16.5) {
      tier = 'heavy';
      knockbackDuration = PHYSICS_CONSTANTS.HEAVY_KNOCKBACK_DURATION;
    }

    return {
      impulse,
      tier,
      isBoosted: isBoosting,
      isPerfect,
      knockbackDuration,
    };
  }

  /**
   * Computes resultant velocity for a ball after receiving `incomingImpulse` along `pushNormal`.
   */
  private static computePostImpactVelocity(
    currentVel: Vector3Like,
    pushNormal: Vector3Like,
    inwardSpeedTowardOpponent: number,
    incomingImpulse: number,
    wonCollisionDominantly: boolean,
    ownForwardAttackSpeed: number,
    anyBoostInvolved: boolean
  ): Vector3Like {
    if (wonCollisionDominantly) {
      // Dominant attacker ploughs through, retaining a portion of its forward attack velocity
      // minus only a light physical recoil
      const forwardDir = { x: -pushNormal.x, y: 0, z: -pushNormal.z };
      const tangentX = currentVel.x - ownForwardAttackSpeed * forwardDir.x;
      const tangentZ = currentVel.z - ownForwardAttackSpeed * forwardDir.z;

      const retainedForward =
        ownForwardAttackSpeed * PHYSICS_CONSTANTS.ATTACKER_FOLLOWTHROUGH_RETENTION -
        incomingImpulse * PHYSICS_CONSTANTS.DOMINANT_ATTACKER_RECOIL_SCALE;

      return {
        x: forwardDir.x * retainedForward + tangentX * 0.75,
        y: Math.min(
          PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY,
          Math.max(currentVel.y, 0) + PHYSICS_CONSTANTS.VERTICAL_POP_IMPULSE * 0.25
        ),
        z: forwardDir.z * retainedForward + tangentZ * 0.75,
      };
    }

    // Receiver of the impact:
    // 1. Remove inward velocity component toward the attacker
    const withoutInwardX = currentVel.x + inwardSpeedTowardOpponent * pushNormal.x * 0.92;
    const withoutInwardZ = currentVel.z + inwardSpeedTowardOpponent * pushNormal.z * 0.92;

    // 2. Decompose remaining velocity into outward carry (already moving along pushNormal) and tangent
    const existingCarry = Math.max(0, withoutInwardX * pushNormal.x + withoutInwardZ * pushNormal.z);
    const tangentX = withoutInwardX - existingCarry * pushNormal.x;
    const tangentZ = withoutInwardZ - existingCarry * pushNormal.z;

    // 3. Compound existing outward carry with the new knockback impulse
    const totalOutwardSpeed = existingCarry * 0.62 + incomingImpulse;

    let vx = pushNormal.x * totalOutwardSpeed + tangentX * 0.58;
    let vz = pushNormal.z * totalOutwardSpeed + tangentZ * 0.58;

    const horizSpeed = Math.hypot(vx, vz);
    if (horizSpeed > PHYSICS_CONSTANTS.MAX_RESULTANT_HORIZONTAL_SPEED) {
      const scale = PHYSICS_CONSTANTS.MAX_RESULTANT_HORIZONTAL_SPEED / horizSpeed;
      vx *= scale;
      vz *= scale;
    }

    const verticalPop = anyBoostInvolved
      ? PHYSICS_CONSTANTS.VERTICAL_POP_IMPULSE
      : PHYSICS_CONSTANTS.VERTICAL_POP_IMPULSE * 0.45;

    return {
      x: vx,
      y: Math.min(
        PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY,
        Math.max(currentVel.y, 0) + verticalPop
      ),
      z: vz,
    };
  }

  /**
   * Computes positional angle multiplier when hitting a target:
   * - Rear hit (attacking in same direction target is moving): 1.38x
   * - Side/flank hit (perpendicular to target's velocity): 1.22x
   * - Stationary target: 1.18x
   * - Head-on hit (opposing target's velocity): 1.0x
   */
  public static computeAngleMultiplier(
    attackDir: Vector3Like,
    targetVelocity: Vector3Like
  ): number {
    const targetSpeed = lengthXZ(targetVelocity);
    if (targetSpeed < 1.8) {
      return PHYSICS_CONSTANTS.STATIONARY_TARGET_MULTIPLIER;
    }
    const targetDir = normalizeXZ(targetVelocity);
    const alignment = dotXZ(attackDir, targetDir); // +1 = rear hit, 0 = side hit, -1 = head-on

    if (alignment > 0.42) {
      return PHYSICS_CONSTANTS.REAR_HIT_BONUS_MULTIPLIER;
    }
    if (alignment >= -0.35) {
      return PHYSICS_CONSTANTS.SIDE_HIT_BONUS_MULTIPLIER;
    }
    return 1.0;
  }
}
