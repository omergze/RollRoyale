import * as THREE from 'three';
import type { BallEntityState, ImpactTier, MatchPhase } from '../types/game';
import { clamp, lerp } from '../utils/math';

export class CameraController {
  public readonly camera: THREE.PerspectiveCamera;

  private currentLookAt = new THREE.Vector3(0, 0, 0);
  private currentPos = new THREE.Vector3(0, 23.5, 25.0);
  private shakeIntensity = 0;
  private shakeTimer = 0;
  private menuOrbitAngle = 0;
  private reducedEffects = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.5, 260);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  public setAspect(aspect: number): void {
    // On narrow portrait mobile viewports, slightly widen vertical FOV / distance so full arena stays readable
    const portraitAdjust = aspect < 0.85 ? clamp((0.85 - aspect) * 18, 0, 10) : 0;
    this.camera.fov = 46 + portraitAdjust;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setReducedEffects(reduced: boolean): void {
    this.reducedEffects = reduced;
    if (reduced) {
      this.shakeIntensity = 0;
      this.shakeTimer = 0;
    }
  }

  public addImpactShake(impulse: number, impactTier: ImpactTier = 'normal'): void {
    if (this.reducedEffects || impactTier === 'glancing') return;
    const tierBonus =
      impactTier === 'perfect_boost'
        ? 0.12
        : impactTier === 'boost'
          ? 0.06
          : impactTier === 'heavy'
            ? 0.02
            : 0;
    const strength = clamp((impulse - 7) / 28 + tierBonus, 0.03, 0.32);
    if (strength > this.shakeIntensity) {
      this.shakeIntensity = strength;
      this.shakeTimer = impactTier === 'perfect_boost' ? 0.19 : 0.15;
    }
  }

  public update(
    phase: MatchPhase,
    player: BallEntityState | undefined,
    dt: number
  ): void {
    if (phase === 'menu' || !player) {
      // Smooth elevated cinematic orbit around the live 3D arena on Main Menu
      this.menuOrbitAngle += dt * 0.22;
      const orbitR = 28.5;
      const targetX = Math.sin(this.menuOrbitAngle) * orbitR;
      const targetZ = Math.cos(this.menuOrbitAngle) * orbitR;
      const targetY = 20.5 + Math.sin(this.menuOrbitAngle * 0.7) * 1.4;

      const smooth = clamp(dt * 3.5, 0, 1);
      this.currentPos.lerp(new THREE.Vector3(targetX, targetY, targetZ), smooth);
      this.currentLookAt.lerp(new THREE.Vector3(0, -0.5, 0), smooth);

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    // Elevated angled gameplay follow camera:
    // Blends player position with arena center so player is always framed AND arena edges remain visible
    const trackX = clamp(player.position.x * 0.54, -11.5, 11.5);
    const trackZ = clamp(player.position.z * 0.54, -11.5, 11.5);

    const isBoosting = player.boostActiveTimer > 0;
    const boostZoomOffset = isBoosting && !this.reducedEffects ? 1.4 : 0.0;

    const desiredPos = new THREE.Vector3(
      trackX,
      22.8 + boostZoomOffset * 0.45,
      trackZ + 23.6 + boostZoomOffset
    );

    const desiredLookAt = new THREE.Vector3(
      player.position.x * 0.4,
      -0.4,
      player.position.z * 0.4 - 1.0
    );

    const posFollowRate = clamp(dt * 6.8, 0, 1);
    const lookFollowRate = clamp(dt * 8.2, 0, 1);

    this.currentPos.lerp(desiredPos, posFollowRate);
    this.currentLookAt.lerp(desiredLookAt, lookFollowRate);

    // Subtle micro-shake on heavy collisions
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (this.shakeTimer > 0 && !this.reducedEffects) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const decay = clamp(this.shakeTimer / 0.16, 0, 1);
      shakeOffsetX = (Math.random() - 0.5) * 2 * this.shakeIntensity * decay;
      shakeOffsetY = (Math.random() - 0.5) * 2 * this.shakeIntensity * decay;
      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
      }
    }

    this.camera.position.set(
      this.currentPos.x + shakeOffsetX,
      this.currentPos.y + shakeOffsetY,
      this.currentPos.z
    );
    this.camera.lookAt(this.currentLookAt);

    // Subtle FOV response on boost
    const baseFov =
      this.camera.aspect < 0.85 ? 46 + clamp((0.85 - this.camera.aspect) * 18, 0, 10) : 46;
    const targetFov = isBoosting && !this.reducedEffects ? baseFov + 2.2 : baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, clamp(dt * 8.0, 0, 1));
      this.camera.updateProjectionMatrix();
    }
  }
}
