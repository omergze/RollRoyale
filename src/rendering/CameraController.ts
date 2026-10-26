import * as THREE from 'three';
import type { BallEntityState, MatchPhase } from '../types/game';
import { clamp, lerp } from '../utils/math';

export class CameraController {
  public readonly camera: THREE.PerspectiveCamera;

  private currentLookAt = new THREE.Vector3(0, 0, 0);
  private currentPos = new THREE.Vector3(0, 25, 27);
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

  public addImpactShake(impulse: number): void {
    if (this.reducedEffects) return;
    const strength = clamp((impulse - 8) / 28, 0.04, 0.28);
    if (strength > this.shakeIntensity) {
      this.shakeIntensity = strength;
      this.shakeTimer = 0.16;
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
      const orbitR = 31.0;
      const targetX = Math.sin(this.menuOrbitAngle) * orbitR;
      const targetZ = Math.cos(this.menuOrbitAngle) * orbitR;
      const targetY = 21.5 + Math.sin(this.menuOrbitAngle * 0.7) * 1.5;

      const smooth = clamp(dt * 3.5, 0, 1);
      this.currentPos.lerp(new THREE.Vector3(targetX, targetY, targetZ), smooth);
      this.currentLookAt.lerp(new THREE.Vector3(0, -0.5, 0), smooth);

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    // Elevated angled gameplay follow camera:
    // Blends player position with arena center so player is always framed AND arena edges remain visible
    const trackX = clamp(player.position.x * 0.56, -13.5, 13.5);
    const trackZ = clamp(player.position.z * 0.56, -13.5, 13.5);

    const isBoosting = player.boostActiveTimer > 0;
    const boostZoomOffset = isBoosting && !this.reducedEffects ? 1.8 : 0.0;

    const desiredPos = new THREE.Vector3(
      trackX,
      24.2 + boostZoomOffset * 0.5,
      trackZ + 25.5 + boostZoomOffset
    );

    const desiredLookAt = new THREE.Vector3(
      player.position.x * 0.42,
      -0.4,
      player.position.z * 0.42 - 1.2
    );

    const posFollowRate = clamp(dt * 6.5, 0, 1);
    const lookFollowRate = clamp(dt * 8.0, 0, 1);

    this.currentPos.lerp(desiredPos, posFollowRate);
    this.currentLookAt.lerp(desiredLookAt, lookFollowRate);

    // Subtle micro-shake on heavy collisions
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (this.shakeTimer > 0 && !this.reducedEffects) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const decay = this.shakeTimer / 0.16;
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
    const baseFov = this.camera.aspect < 0.85 ? 46 + clamp((0.85 - this.camera.aspect) * 18, 0, 10) : 46;
    const targetFov = isBoosting && !this.reducedEffects ? baseFov + 2.5 : baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, clamp(dt * 8.0, 0, 1));
      this.camera.updateProjectionMatrix();
    }
  }
}
