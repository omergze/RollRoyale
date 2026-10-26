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
   * Designed to be applied to the Rapier rigid body's linear velocity while preserving
   * vertical gravity/collision response and physical momentum.
   */
  public static stepMovement(
    entity: BallEntityState,
    input: PlayerInputCommand,
    dt: number,
    isGroundedOnDeck: boolean
  ): MovementStepResult {
    // Update timers
    entity.boostActiveTimer = Math.max(0, entity.boostActiveTimer - dt);
    entity.boostCooldownTimer = Math.max(0, entity.boostCooldownTimer - dt);
    entity.spawnProtectionTimer = Math.max(0, entity.spawnProtectionTimer - dt);

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

    // Check Boost Activation
    if (input.boostPressed && entity.boostCooldownTimer <= 0 && entity.isAlive) {
      boostActivated = true;
      entity.boostActiveTimer = PHYSICS_CONSTANTS.BOOST_DURATION;
      entity.boostCooldownTimer = PHYSICS_CONSTANTS.BOOST_COOLDOWN;

      // Determine boost direction: input direction -> current velocity direction -> toward center
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

      // Apply immediate burst impulse in boost direction, cutting opposing drift
      const forwardSpeed = dotXZ({ x: vx, y: 0, z: vz }, boostDir);
      const baseForward = Math.max(0, forwardSpeed * 0.75);
      const targetBurstSpeed = Math.min(
        PHYSICS_CONSTANTS.MAX_BOOST_SPEED,
        baseForward + PHYSICS_CONSTANTS.BOOST_INITIAL_IMPULSE
      );

      // Retain slight lateral component for natural arc, mostly aligned with boostDir
      const lateralX = vx - forwardSpeed * boostDir.x;
      const lateralZ = vz - forwardSpeed * boostDir.z;

      vx = boostDir.x * targetBurstSpeed + lateralX * 0.25;
      vz = boostDir.z * targetBurstSpeed + lateralZ * 0.25;

      // Trigger visual stretch along movement
      entity.squashStretch = { x: 0.82, y: 0.86, z: 1.28 };
    }

    // Air control is reduced if the ball has slipped off the deck edge
    const controlFactor = isGroundedOnDeck ? 1.0 : 0.35;

    if (entity.boostActiveTimer > 0) {
      // Sustained boost drive
      const steerDir =
        inputMag > 0.15
          ? normalizeXZ({
              x: entity.boostDirection.x * 0.65 + inputDir.x * 0.35,
              y: 0,
              z: entity.boostDirection.z * 0.65 + inputDir.z * 0.35,
            })
          : entity.boostDirection;

      entity.boostDirection = steerDir;
      vx += steerDir.x * PHYSICS_CONSTANTS.BOOST_SUSTAIN_ACCELERATION * controlFactor * dt;
      vz += steerDir.z * PHYSICS_CONSTANTS.BOOST_SUSTAIN_ACCELERATION * controlFactor * dt;
    } else if (inputMag > 0.02) {
      // Normal arcade rolling movement with lateral grip & turn assist
      const currentSpeed = Math.hypot(vx, vz);
      if (currentSpeed > 0.2) {
        const forwardComp = vx * inputDir.x + vz * inputDir.z;
        const lateralX = vx - forwardComp * inputDir.x;
        const lateralZ = vz - forwardComp * inputDir.z;

        // Counter lateral sliding so steering feels crisp and responsive
        const gripDecay = Math.exp(-PHYSICS_CONSTANTS.TURN_GRIP_FACTOR * controlFactor * dt);
        vx = forwardComp * inputDir.x + lateralX * gripDecay;
        vz = forwardComp * inputDir.z + lateralZ * gripDecay;

        // Extra braking assist when reversing direction (< 0 dot product)
        if (forwardComp < 0) {
          vx += inputDir.x * PHYSICS_CONSTANTS.BRAKE_DECELERATION * 0.65 * controlFactor * dt;
          vz += inputDir.z * PHYSICS_CONSTANTS.BRAKE_DECELERATION * 0.65 * controlFactor * dt;
        }
      }

      // Apply smooth acceleration up to MAX_MOVE_SPEED (do not exceed normal cap via standard input)
      const preAccelSpeed = Math.hypot(vx, vz);
      if (preAccelSpeed < PHYSICS_CONSTANTS.MAX_MOVE_SPEED) {
        const accel = PHYSICS_CONSTANTS.MOVE_ACCELERATION * inputMag * controlFactor;
        vx += inputDir.x * accel * dt;
        vz += inputDir.z * accel * dt;
        const postAccelSpeed = Math.hypot(vx, vz);
        if (postAccelSpeed > PHYSICS_CONSTANTS.MAX_MOVE_SPEED) {
          const s = PHYSICS_CONSTANTS.MAX_MOVE_SPEED / postAccelSpeed;
          vx *= s;
          vz *= s;
        }
      }
    } else if (isGroundedOnDeck) {
      // Controlled deceleration when no movement input is pressed (prevents endless sliding)
      const currentSpeed = Math.hypot(vx, vz);
      if (currentSpeed > 0) {
        const drop = PHYSICS_CONSTANTS.BRAKE_DECELERATION * dt;
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

    // Smoothly cap horizontal speed (allow high knockback velocities to decay smoothly rather than hard-snapping)
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
        // Bleed excess knockback/post-boost speed smoothly
        const clampedSpeed = lerp(horizSpeed, maxTargetSpeed, clamp(6.5 * dt, 0, 1));
        const scale = clampedSpeed / horizSpeed;
        vx *= scale;
        vz *= scale;
      }
    }

    // Clamp upward vertical velocity to prevent physics explosions or sky launches
    if (vy > PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY) {
      vy = PHYSICS_CONSTANTS.MAX_UPWARD_VELOCITY;
    }

    // Smoothly recover visual squash-and-stretch toward (1, 1, 1)
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
