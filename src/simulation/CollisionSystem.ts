import { PHYSICS_CONSTANTS } from '../config/constants';
import type { BallEntityState, GameEvent, Vector3Like } from '../types/game';
import { clamp, dotXZ, lengthXZ, normalizeXZ } from '../utils/math';

export interface CollisionResolution {
  applied: boolean;
  velocityA: Vector3Like;
  velocityB: Vector3Like;
  event?: Extract<GameEvent, { type: 'collision' }>;
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
   * Resolves a combat collision between two balls:
   * - Respects pair cooldown to prevent duplicate impulses/knockouts
   * - Calculates relative closing speed, individual momentum, boost states, and flank/rear angles
   * - Applies arcade knockback impulses and records last-hit attribution for scoring
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

    // Normal from A to B on horizontal XZ plane
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

    // Speed of A toward B, and speed of B toward A
    const speedATowardB = Math.max(0, dotXZ(ballA.velocity, normalAB));
    const speedBTowardA = Math.max(0, dotXZ(ballB.velocity, normalBA));
    const closingSpeed = speedATowardB + speedBTowardA;

    // Even glancing or low-speed touches should separate cleanly
    const effectiveClosing = Math.max(closingSpeed, 3.0);

    const aBoosting = ballA.boostActiveTimer > 0;
    const bBoosting = ballB.boostActiveTimer > 0;

    // Compute positional angle bonus (side/rear hit advantage)
    const angleBonusAOnB = CollisionSystem.computeAngleMultiplier(normalAB, ballB.velocity);
    const angleBonusBOnA = CollisionSystem.computeAngleMultiplier(normalBA, ballA.velocity);

    // Spawn protection reduces incoming knockback
    const aProtectedScale = ballA.spawnProtectionTimer > 0 ? 0.45 : 1.0;
    const bProtectedScale = ballB.spawnProtectionTimer > 0 ? 0.45 : 1.0;

    // Attack power from A onto B
    const rawAttackAOnB =
      (PHYSICS_CONSTANTS.BASE_KNOCKBACK_IMPULSE +
        (speedATowardB * 1.15 + effectiveClosing * 0.45) *
          PHYSICS_CONSTANTS.VELOCITY_KNOCKBACK_SCALE) *
      (aBoosting ? PHYSICS_CONSTANTS.BOOST_ATTACK_MULTIPLIER : 1.0) *
      (bBoosting ? PHYSICS_CONSTANTS.BOOST_DEFENSE_RESISTANCE : 1.0) *
      angleBonusAOnB *
      bProtectedScale;

    // Attack power from B onto A
    const rawAttackBOnA =
      (PHYSICS_CONSTANTS.BASE_KNOCKBACK_IMPULSE +
        (speedBTowardA * 1.15 + effectiveClosing * 0.45) *
          PHYSICS_CONSTANTS.VELOCITY_KNOCKBACK_SCALE) *
      (bBoosting ? PHYSICS_CONSTANTS.BOOST_ATTACK_MULTIPLIER : 1.0) *
      (aBoosting ? PHYSICS_CONSTANTS.BOOST_DEFENSE_RESISTANCE : 1.0) *
      angleBonusBOnA *
      aProtectedScale;

    const impulseOnB = clamp(rawAttackAOnB, 4.0, PHYSICS_CONSTANTS.MAX_KNOCKBACK_IMPULSE);
    const impulseOnA = clamp(rawAttackBOnA, 4.0, PHYSICS_CONSTANTS.MAX_KNOCKBACK_IMPULSE);

    this.pairCooldowns.set(pairKey, currentTime);

    // Elastic momentum transfer + arcade knockback impulse along collision normals
    // Remove inward velocity components first so balls never clip through each other
    const aVelOutX = ballA.velocity.x - speedATowardB * normalAB.x * 0.85;
    const aVelOutZ = ballA.velocity.z - speedATowardB * normalAB.z * 0.85;

    const bVelOutX = ballB.velocity.x - speedBTowardA * normalBA.x * 0.85;
    const bVelOutZ = ballB.velocity.z - speedBTowardA * normalBA.z * 0.85;

    // Attacker retains more forward momentum if they clearly won the impact
    const aWonImpact = impulseOnB > impulseOnA * 1.18;
    const bWonImpact = impulseOnA > impulseOnB * 1.18;

    const recoilScaleA = aWonImpact ? 0.52 : 1.0;
    const recoilScaleB = bWonImpact ? 0.52 : 1.0;

    const newVelA: Vector3Like = {
      x: aVelOutX + normalBA.x * impulseOnA * recoilScaleA,
      y: Math.min(
        PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY,
        Math.max(ballA.velocity.y, 0) + PHYSICS_CONSTANTS.VERTICAL_POP_IMPULSE * 0.5
      ),
      z: aVelOutZ + normalBA.z * impulseOnA * recoilScaleA,
    };

    const newVelB: Vector3Like = {
      x: bVelOutX + normalAB.x * impulseOnB * recoilScaleB,
      y: Math.min(
        PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY,
        Math.max(ballB.velocity.y, 0) + PHYSICS_CONSTANTS.VERTICAL_POP_IMPULSE * 0.5
      ),
      z: bVelOutZ + normalAB.z * impulseOnB * recoilScaleB,
    };

    // Clamp resultant horizontal speeds to prevent runaway energy
    const maxResultSpeed = PHYSICS_CONSTANTS.MAX_KNOCKBACK_IMPULSE * 1.05;
    const speedA = Math.hypot(newVelA.x, newVelA.z);
    if (speedA > maxResultSpeed) {
      newVelA.x = (newVelA.x / speedA) * maxResultSpeed;
      newVelA.z = (newVelA.z / speedA) * maxResultSpeed;
    }
    const speedB = Math.hypot(newVelB.x, newVelB.z);
    if (speedB > maxResultSpeed) {
      newVelB.x = (newVelB.x / speedB) * maxResultSpeed;
      newVelB.z = (newVelB.z / speedB) * maxResultSpeed;
    }

    // Record LastHitAttribution on both balls for accurate knockout scoring
    ballB.lastHit = {
      attackerId: ballA.id,
      attackerName: ballA.name,
      timestamp: currentTime,
      impactSpeed: effectiveClosing,
      impulseMagnitude: impulseOnB,
    };

    ballA.lastHit = {
      attackerId: ballB.id,
      attackerName: ballB.name,
      timestamp: currentTime,
      impactSpeed: effectiveClosing,
      impulseMagnitude: impulseOnA,
    };

    ballA.totalImpactDealt += impulseOnB;
    ballB.totalImpactDealt += impulseOnA;

    // Trigger visual impact squash on both balls
    const squashFactor = clamp(effectiveClosing / 25.0, 0.12, 0.32);
    ballA.squashStretch = {
      x: 1 + squashFactor,
      y: 1 - squashFactor * 0.75,
      z: 1 + squashFactor,
    };
    ballB.squashStretch = {
      x: 1 + squashFactor,
      y: 1 - squashFactor * 0.75,
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
        entityAId: ballA.id,
        entityBId: ballB.id,
        relativeSpeed: effectiveClosing,
        impulse: Math.max(impulseOnA, impulseOnB),
        isBoostedImpact: aBoosting || bBoosting,
      },
    };
  }

  /**
   * Computes positional angle multiplier when hitting a target:
   * - Rear hit (attacking in same direction target is moving): 1.32x
   * - Side/flank hit (perpendicular to target's velocity): 1.18x
   * - Head-on hit (opposing target's velocity): 1.0x
   */
  public static computeAngleMultiplier(
    attackDir: Vector3Like,
    targetVelocity: Vector3Like
  ): number {
    const targetSpeed = lengthXZ(targetVelocity);
    if (targetSpeed < 1.5) {
      // Stationary target receives a modest flank-equivalent bonus
      return 1.12;
    }
    const targetDir = normalizeXZ(targetVelocity);
    const alignment = dotXZ(attackDir, targetDir); // +1 = rear hit, 0 = side hit, -1 = head-on

    if (alignment > 0.45) {
      return PHYSICS_CONSTANTS.REAR_HIT_BONUS_MULTIPLIER;
    }
    if (alignment >= -0.35) {
      return PHYSICS_CONSTANTS.SIDE_HIT_BONUS_MULTIPLIER;
    }
    return 1.0;
  }
}
