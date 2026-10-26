import { PHYSICS_CONSTANTS } from '../config/constants';
import type { BallEntityState, PlayerInputCommand, Vector3Like } from '../types/game';
import {
  clamp,
  dotXZ,
  integrateRollingRotation,
  lengthXZ,
  lerp,
  normalizeXZ,
} from '../utils/math';

export interface MovementStepResult {
  newVelocity: Vector3Like;
  boostActivated: boolean;
  boostDirection: Vector3Like;
}

export class MovementController {
  /**
   * Computes the next velocity and boost state for a ball entity over fixed timestep `dt`.
   * Preserves post-hit knockback momentum while allowing limited skillful defensive steering (DI).
   */
  public static stepMovement(
    entity: BallEntityState,
    input: PlayerInputCommand,
    dt: number,
    isGroundedOnDeck: boolean
  ): MovementStepResult {
    // Update state timers
    entity.boostActiveTimer = Math.max(0, entity.boostActiveTimer - dt);
    entity.boostCooldownTimer = Math.max(0, entity.boostCooldownTimer - dt);
    entity.spawnProtectionTimer = Math.max(0, entity.spawnProtectionTimer - dt);
    entity.knockbackTimer = Math.max(0, (entity.knockbackTimer ?? 0) - dt);

    // Clamp & normalize input direction
    const rawMag = Math.hypot(input.moveX, input.moveZ);
    const inputMag = clamp(rawMag, 0, 1);
    const inputDir: Vector3Like =
      rawMag > 1e-4
        ? { x: input.moveX / rawMag, y: 0, z: input.moveZ / rawMag }
        : { x: 0, y: 0, z: 0 };

    let vx = entity.velocity.x;
    let vy = entity.velocity.y;
    let vz = entity.velocity.z;

    let boostActivated = false;

    // 1. Check Boost Activation
    if (input.boostPressed && entity.boostCooldownTimer <= 0 && entity.isAlive) {
      boostActivated = true;
      entity.boostActiveTimer = PHYSICS_CONSTANTS.BOOST_DURATION;
      entity.boostCooldownTimer = PHYSICS_CONSTANTS.BOOST_COOLDOWN;

      // Activating boost helps recover from knockback stun (rewards saving boost for emergencies)
      entity.knockbackTimer *= 0.3;

      // Determine boost direction: input intent -> current velocity -> toward arena center
      let boostDir = inputDir;
      if (lengthXZ(boostDir) < 1e-4) {
        const velDir = normalizeXZ({ x: vx, y: 0, z: vz });
        if (lengthXZ(velDir) > 1e-4) {
          boostDir = velDir;
        } else {
          const toCenter = normalizeXZ({
            x: -entity.position.x,
            y: 0,
            z: -entity.position.z,
          });
          boostDir = lengthXZ(toCenter) > 1e-4 ? toCenter : { x: 0, y: 0, z: -1 };
        }
      }

      entity.boostDirection = { ...boostDir };

      // Immediate burst impulse in boost direction, cutting opposing drift
      const forwardSpeed = dotXZ({ x: vx, y: 0, z: vz }, boostDir);
      const baseForward = Math.max(0, forwardSpeed * 0.8);
      const targetBurstSpeed = Math.min(
        PHYSICS_CONSTANTS.MAX_BOOST_SPEED,
        baseForward + PHYSICS_CONSTANTS.BOOST_INITIAL_IMPULSE
      );

      const lateralX = vx - forwardSpeed * boostDir.x;
      const lateralZ = vz - forwardSpeed * boostDir.z;

      vx = boostDir.x * targetBurstSpeed + lateralX * 0.2;
      vz = boostDir.z * targetBurstSpeed + lateralZ * 0.2;

      // Visual stretch along boost vector
      entity.squashStretch = { x: 0.78, y: 0.84, z: 1.34 };
    }

    // Air control is reduced if the ball has slipped past the platform rim
    const deckFactor = isGroundedOnDeck ? 1.0 : 0.32;

    // Post-hit traction recovery curve:
    // Right after a strong impact (knockbackTimer > 0), traction is reduced so knockback
    // carries meaningful distance and cannot be instantaneously cancelled by holding opposite keys.
    const knockbackRatio = clamp(
      entity.knockbackTimer / PHYSICS_CONSTANTS.PERFECT_BOOST_KNOCKBACK_DURATION,
      0,
      1
    );
    const tractionFactor =
      entity.knockbackTimer > 0
        ? lerp(1.0, PHYSICS_CONSTANTS.POST_HIT_MIN_TRACTION, knockbackRatio)
        : 1.0;

    const controlFactor = deckFactor * tractionFactor;

    // 2. Apply Active Boost, Steering, or Braking
    if (entity.boostActiveTimer > 0) {
      const steerDir =
        inputMag > 0.15
          ? normalizeXZ({
              x: entity.boostDirection.x * 0.68 + inputDir.x * 0.32,
              y: 0,
              z: entity.boostDirection.z * 0.68 + inputDir.z * 0.32,
            })
          : entity.boostDirection;

      entity.boostDirection = steerDir;
      vx += steerDir.x * PHYSICS_CONSTANTS.BOOST_SUSTAIN_ACCELERATION * deckFactor * dt;
      vz += steerDir.z * PHYSICS_CONSTANTS.BOOST_SUSTAIN_ACCELERATION * deckFactor * dt;
    } else if (inputMag > 0.02) {
      const currentSpeed = Math.hypot(vx, vz);

      if (currentSpeed > 0.2) {
        const forwardComp = vx * inputDir.x + vz * inputDir.z;
        const lateralX = vx - forwardComp * inputDir.x;
        const lateralZ = vz - forwardComp * inputDir.z;

        // During knockback, preserve lateral knockback velocity instead of wiping it out via turn-grip
        const effectiveGrip =
          entity.knockbackTimer > 0
            ? PHYSICS_CONSTANTS.TURN_GRIP_FACTOR * tractionFactor * 0.25
            : PHYSICS_CONSTANTS.TURN_GRIP_FACTOR;

        const gripDecay = Math.exp(-effectiveGrip * deckFactor * dt);
        vx = forwardComp * inputDir.x + lateralX * gripDecay;
        vz = forwardComp * inputDir.z + lateralZ * gripDecay;

        // Extra braking assist when reversing direction (heavily reduced during active knockback)
        if (forwardComp < 0) {
          const reverseBrakeScale = entity.knockbackTimer > 0 ? tractionFactor * 0.42 : 0.68;
          vx +=
            inputDir.x *
            PHYSICS_CONSTANTS.BRAKE_DECELERATION *
            reverseBrakeScale *
            deckFactor *
            dt;
          vz +=
            inputDir.z *
            PHYSICS_CONSTANTS.BRAKE_DECELERATION *
            reverseBrakeScale *
            deckFactor *
            dt;
        }
      }

      // Apply smooth movement acceleration:
      // - Under normal speed cap: full acceleration up to MAX_MOVE_SPEED
      // - During knockback above speed cap: allow limited defensive directional influence (DI)
      const preAccelSpeed = Math.hypot(vx, vz);
      if (preAccelSpeed < PHYSICS_CONSTANTS.MAX_MOVE_SPEED) {
        const accel = PHYSICS_CONSTANTS.MOVE_ACCELERATION * inputMag * controlFactor;
        vx += inputDir.x * accel * dt;
        vz += inputDir.z * accel * dt;
        const postAccelSpeed = Math.hypot(vx, vz);
        if (postAccelSpeed > PHYSICS_CONSTANTS.MAX_MOVE_SPEED && entity.knockbackTimer <= 0) {
          const s = PHYSICS_CONSTANTS.MAX_MOVE_SPEED / postAccelSpeed;
          vx *= s;
          vz *= s;
        }
      } else if (entity.knockbackTimer > 0) {
        // Skillful defensive directional influence (DI) while flying from a hit
        const diAccel =
          PHYSICS_CONSTANTS.MOVE_ACCELERATION *
          PHYSICS_CONSTANTS.POST_HIT_DI_STEER_FACTOR *
          inputMag *
          controlFactor;
        vx += inputDir.x * diAccel * dt;
        vz += inputDir.z * diAccel * dt;
      }
    } else if (isGroundedOnDeck) {
      // Controlled deceleration when no movement input is pressed:
      // While knockbackTimer > 0, reduce passive ground braking so hits slide with weight
      const currentSpeed = Math.hypot(vx, vz);
      if (currentSpeed > 0) {
        const passiveBrakeScale = entity.knockbackTimer > 0 ? tractionFactor * 0.35 : 1.0;
        const drop = PHYSICS_CONSTANTS.BRAKE_DECELERATION * passiveBrakeScale * dt;
        const nextSpeed = Math.max(0, currentSpeed - drop);
        if (nextSpeed < 0.05) {
          vx = 0;
          vz = 0;
        } else {
          const scale = nextSpeed / currentSpeed;
          vx *= scale;
          vz *= scale;
        }
      }
    }

    // 3. Smoothly manage horizontal speed above normal/boost cap
    const maxTargetSpeed =
      entity.boostActiveTimer > 0
        ? PHYSICS_CONSTANTS.MAX_BOOST_SPEED
        : PHYSICS_CONSTANTS.MAX_MOVE_SPEED;
    const horizSpeed = Math.hypot(vx, vz);

    if (horizSpeed > maxTargetSpeed) {
      if (entity.boostActiveTimer > 0) {
        const scale = maxTargetSpeed / horizSpeed;
        vx *= scale;
        vz *= scale;
      } else {
        // Bleed excess knockback speed slowly while knockbackTimer > 0 so hits travel across the arena
        const decayRate =
          entity.knockbackTimer > 0
            ? PHYSICS_CONSTANTS.KNOCKBACK_EXCESS_DECAY_ACTIVE
            : PHYSICS_CONSTANTS.KNOCKBACK_EXCESS_DECAY_NORMAL;
        const clampedSpeed = lerp(horizSpeed, maxTargetSpeed, clamp(decayRate * dt, 0, 1));
        const scale = clampedSpeed / horizSpeed;
        vx *= scale;
        vz *= scale;
      }
    }

    // Clamp upward vertical velocity so balls remain grounded during combat
    if (vy > PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY) {
      vy = PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY;
    }

    // Recover visual squash-and-stretch toward (1, 1, 1)
    const recoverRate = clamp(10.0 * dt, 0, 1);
    entity.squashStretch = {
      x: lerp(entity.squashStretch.x, 1.0, recoverRate),
      y: lerp(entity.squashStretch.y, 1.0, recoverRate),
      z: lerp(entity.squashStretch.z, 1.0, recoverRate),
    };

    return {
      newVelocity: { x: vx, y: vy, z: vz },
      boostActivated,
      boostDirection: { ...entity.boostDirection },
    };
  }

  /**
   * Updates visual rolling quaternion from actual frame displacement.
   */
  public static updateRollingRotation(entity: BallEntityState): void {
    const dx = entity.position.x - entity.prevPosition.x;
    const dz = entity.position.z - entity.prevPosition.z;
    entity.prevRotation = { ...entity.rotation };
    entity.rotation = integrateRollingRotation(entity.rotation, dx, dz, entity.radius);
  }
}
