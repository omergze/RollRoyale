import * as THREE from 'three';
import { GRAPHICS_PRESETS } from '../config/constants';
import type { BallEntityState, GraphicsQuality, ImpactTier, Vector3Like } from '../types/game';
import { clamp } from '../utils/math';

interface SparkParticle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  active: boolean;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  lifetime: number;
  startScale: number;
  endScale: number;
  active: boolean;
}

export class EffectsRenderer {
  public readonly group = new THREE.Group();

  private sparks: SparkParticle[] = [];
  private rings: ShockwaveRing[] = [];
  private maxActiveSparks = 160;
  private reducedEffects = false;
  private boostTrailTimer = 0;

  constructor() {
    this.initPools();
  }

  private initPools(): void {
    const sparkGeo = new THREE.OctahedronGeometry(0.18, 0);
    for (let i = 0; i < 180; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.sparks.push({
        mesh,
        mat,
        velocity: new THREE.Vector3(),
        age: 0,
        lifetime: 0.4,
        active: false,
      });
    }

    const ringGeo = new THREE.RingGeometry(0.65, 1.0, 32);
    ringGeo.rotateX(-Math.PI * 0.5);
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({
        mesh,
        mat,
        age: 0,
        lifetime: 0.45,
        startScale: 0.5,
        endScale: 3.5,
        active: false,
      });
    }
  }

  public configure(quality: GraphicsQuality, reducedEffects: boolean): void {
    this.maxActiveSparks = GRAPHICS_PRESETS[quality].maxParticles;
    this.reducedEffects = reducedEffects;
  }

  private acquireSpark(): SparkParticle | null {
    let activeCount = 0;
    for (const s of this.sparks) {
      if (s.active) activeCount++;
    }
    const cap = this.reducedEffects ? Math.min(35, this.maxActiveSparks) : this.maxActiveSparks;
    if (activeCount >= cap) {
      return null;
    }
    for (const s of this.sparks) {
      if (!s.active) return s;
    }
    return null;
  }

  private acquireRing(): ShockwaveRing | null {
    for (const r of this.rings) {
      if (!r.active) return r;
    }
    return null;
  }

  public spawnCollisionEffect(
    point: Vector3Like,
    impulse: number,
    isBoosted: boolean,
    colorHex = '#FFD60A',
    impactTier: ImpactTier = isBoosted ? 'boost' : 'normal',
    knockbackDirection: Vector3Like = { x: 0, y: 0, z: 0 },
    isPerfectImpact = false
  ): void {
    const tierSparkCounts: Record<ImpactTier, number> = {
      glancing: 5,
      normal: 11,
      heavy: 16,
      boost: 22,
      perfect_boost: 28,
    };

    const baseCount = tierSparkCounts[impactTier] ?? Math.round(clamp(impulse * 0.75, 6, 22));
    const count = this.reducedEffects ? Math.min(6, baseCount) : baseCount;

    const primaryColor = new THREE.Color(
      isPerfectImpact ? '#FFD60A' : isBoosted ? '#00F0FF' : colorHex
    );
    const accentColor = new THREE.Color('#00F0FF');

    const dirLen = Math.hypot(knockbackDirection.x, knockbackDirection.z);
    const hasDir = dirLen > 0.05;
    const baseAngle = hasDir ? Math.atan2(knockbackDirection.z, knockbackDirection.x) : 0;

    for (let i = 0; i < count; i++) {
      const spark = this.acquireSpark();
      if (!spark) break;

      // 70% of sparks spray in a directional knockback cone so impact force direction is unmistakable
      const useCone = hasDir && i < count * 0.72;
      const spread = isPerfectImpact ? 0.85 : 1.05;
      const angle = useCone
        ? baseAngle + (Math.random() - 0.5) * spread
        : (i / count) * Math.PI * 2 + Math.random() * 0.4;

      const tierSpeedMult =
        impactTier === 'perfect_boost'
          ? 15.5
          : impactTier === 'boost'
            ? 12.5
            : impactTier === 'heavy'
              ? 9.5
              : impactTier === 'normal'
                ? 7.2
                : 4.0;
      const speed = (useCone ? 5.5 : 3.2) + Math.random() * tierSpeedMult;
      const upSpeed = 2.0 + Math.random() * (isPerfectImpact ? 7.2 : isBoosted ? 5.8 : 4.2);

      spark.active = true;
      spark.age = 0;
      spark.lifetime = (isPerfectImpact ? 0.34 : 0.24) + Math.random() * 0.2;
      spark.mesh.visible = true;
      spark.mesh.position.set(point.x, Math.max(0.2, point.y), point.z);
      spark.mesh.scale.setScalar(
        isPerfectImpact ? 1.48 : isBoosted ? 1.28 : impactTier === 'heavy' ? 1.12 : 0.92
      );
      spark.mat.color.copy(isPerfectImpact && i % 2 === 1 ? accentColor : primaryColor);
      spark.mat.opacity = 1.0;
      spark.velocity.set(Math.cos(angle) * speed, upSpeed, Math.sin(angle) * speed);
    }

    if (impactTier === 'glancing' && this.reducedEffects) {
      return;
    }

    const ring = this.acquireRing();
    if (ring) {
      ring.active = true;
      ring.age = 0;
      ring.lifetime = isPerfectImpact ? 0.44 : isBoosted ? 0.36 : 0.25;
      ring.startScale = 0.55;
      ring.endScale =
        impactTier === 'perfect_boost'
          ? 5.2
          : impactTier === 'boost'
            ? 4.1
            : impactTier === 'heavy'
              ? 3.1
              : impactTier === 'normal'
                ? 2.3
                : 1.4;
      ring.mesh.visible = true;
      ring.mesh.position.set(point.x, 0.06, point.z);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mat.color.copy(primaryColor);
      ring.mat.opacity = impactTier === 'glancing' ? 0.45 : 0.88;
    }

    // Secondary crisp cyan inner shockwave ring on Perfect Impact
    if (isPerfectImpact && !this.reducedEffects) {
      const innerRing = this.acquireRing();
      if (innerRing) {
        innerRing.active = true;
        innerRing.age = 0;
        innerRing.lifetime = 0.32;
        innerRing.startScale = 0.35;
        innerRing.endScale = 3.6;
        innerRing.mesh.visible = true;
        innerRing.mesh.position.set(point.x, 0.08, point.z);
        innerRing.mesh.scale.setScalar(innerRing.startScale);
        innerRing.mat.color.copy(accentColor);
        innerRing.mat.opacity = 0.95;
      }
    }
  }

  public spawnBoostBurst(position: Vector3Like, colorHex: string): void {
    const ring = this.acquireRing();
    if (ring) {
      ring.active = true;
      ring.age = 0;
      ring.lifetime = 0.34;
      ring.startScale = 0.8;
      ring.endScale = 3.2;
      ring.mesh.visible = true;
      ring.mesh.position.set(position.x, 0.05, position.z);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mat.color.set(colorHex);
      ring.mat.opacity = 0.85;
    }
  }

  public spawnKnockoutSplash(position: Vector3Like, colorHex: string, viaHole = false): void {
    const count = this.reducedEffects ? 6 : viaHole ? 24 : 18;
    const color = new THREE.Color(colorHex);
    const holeAccent = new THREE.Color('#FF2E93');

    for (let i = 0; i < count; i++) {
      const spark = this.acquireSpark();
      if (!spark) break;

      const angle = (i / count) * Math.PI * 2;
      const speed = viaHole ? 1.8 + Math.random() * 4.5 : 3.0 + Math.random() * 7.5;
      const upSpeed = viaHole ? 8.5 + Math.random() * 11.5 : 6.0 + Math.random() * 9.0;

      spark.active = true;
      spark.age = 0;
      spark.lifetime = (viaHole ? 0.52 : 0.45) + Math.random() * 0.25;
      spark.mesh.visible = true;
      spark.mesh.position.set(position.x, Math.max(-1.2, position.y), position.z);
      spark.mesh.scale.setScalar(viaHole ? 1.55 : 1.45);
      spark.mat.color.copy(viaHole && i % 2 === 1 ? holeAccent : color);
      spark.mat.opacity = 1.0;
      spark.velocity.set(Math.cos(angle) * speed, upSpeed, Math.sin(angle) * speed);
    }

    const ring = this.acquireRing();
    if (ring) {
      ring.active = true;
      ring.age = 0;
      ring.lifetime = 0.55;
      ring.startScale = viaHole ? 0.65 : 1.0;
      ring.endScale = viaHole ? 4.4 : 5.4;
      ring.mesh.visible = true;
      ring.mesh.position.set(position.x, 0.1, position.z);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mat.color.copy(color);
      ring.mat.opacity = 0.95;
    }

    if (viaHole && !this.reducedEffects) {
      const vortexRing = this.acquireRing();
      if (vortexRing) {
        vortexRing.active = true;
        vortexRing.age = 0;
        vortexRing.lifetime = 0.42;
        vortexRing.startScale = 3.2;
        vortexRing.endScale = 0.45;
        vortexRing.mesh.visible = true;
        vortexRing.mesh.position.set(position.x, 0.14, position.z);
        vortexRing.mesh.scale.setScalar(vortexRing.startScale);
        vortexRing.mat.color.copy(holeAccent);
        vortexRing.mat.opacity = 0.92;
      }
    }
  }

  public spawnBumperHitEffect(position: Vector3Like, direction: Vector3Like): void {
    const count = this.reducedEffects ? 5 : 14;
    const primaryColor = new THREE.Color('#06D6A0');
    const accentColor = new THREE.Color('#00F0FF');
    const baseAngle = Math.atan2(direction.z, direction.x);

    for (let i = 0; i < count; i++) {
      const spark = this.acquireSpark();
      if (!spark) break;

      const angle = baseAngle + (Math.random() - 0.5) * 1.35;
      const speed = 5.0 + Math.random() * 9.5;
      const upSpeed = 3.2 + Math.random() * 5.0;

      spark.active = true;
      spark.age = 0;
      spark.lifetime = 0.26 + Math.random() * 0.16;
      spark.mesh.visible = true;
      spark.mesh.position.set(position.x, 0.65, position.z);
      spark.mesh.scale.setScalar(1.22);
      spark.mat.color.copy(i % 2 === 0 ? primaryColor : accentColor);
      spark.mat.opacity = 1.0;
      spark.velocity.set(Math.cos(angle) * speed, upSpeed, Math.sin(angle) * speed);
    }

    const ring = this.acquireRing();
    if (ring) {
      ring.active = true;
      ring.age = 0;
      ring.lifetime = 0.34;
      ring.startScale = 0.85;
      ring.endScale = 3.8;
      ring.mesh.visible = true;
      ring.mesh.position.set(position.x, 0.12, position.z);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mat.color.copy(primaryColor);
      ring.mat.opacity = 0.92;
    }
  }

  public spawnRespawnEffect(position: Vector3Like, colorHex: string): void {
    const ring = this.acquireRing();
    if (ring) {
      ring.active = true;
      ring.age = 0;
      ring.lifetime = 0.45;
      ring.startScale = 2.6;
      ring.endScale = 0.8;
      ring.mesh.visible = true;
      ring.mesh.position.set(position.x, 0.08, position.z);
      ring.mesh.scale.setScalar(ring.startScale);
      ring.mat.color.set(colorHex);
      ring.mat.opacity = 0.8;
    }
  }

  public update(entities: ReadonlyArray<BallEntityState>, dt: number): void {
    // Emit continuous trail sparks behind boosting balls
    this.boostTrailTimer += dt;
    const trailInterval = this.reducedEffects ? 0.06 : 0.025;
    if (this.boostTrailTimer >= trailInterval) {
      this.boostTrailTimer = 0;
      for (const e of entities) {
        if (!e.isAlive || e.boostActiveTimer <= 0) continue;
        const spark = this.acquireSpark();
        if (!spark) break;

        spark.active = true;
        spark.age = 0;
        spark.lifetime = 0.24;
        spark.mesh.visible = true;
        spark.mesh.position.set(
          e.position.x - e.boostDirection.x * e.radius * 0.8 + (Math.random() - 0.5) * 0.4,
          0.35 + Math.random() * 0.35,
          e.position.z - e.boostDirection.z * e.radius * 0.8 + (Math.random() - 0.5) * 0.4
        );
        spark.mesh.scale.setScalar(0.95);
        spark.mat.color.set(e.colorPrimary);
        spark.mat.opacity = 0.85;
        spark.velocity.set(
          -e.boostDirection.x * 2.5,
          1.2 + Math.random() * 1.5,
          -e.boostDirection.z * 2.5
        );
      }
    }

    // Update active sparks
    for (const s of this.sparks) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.lifetime) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const progress = s.age / s.lifetime;
      s.velocity.y -= 18.0 * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      s.mesh.rotation.x += 8.0 * dt;
      s.mesh.rotation.y += 8.0 * dt;
      s.mat.opacity = 1.0 - progress;
      s.mesh.scale.setScalar((1.0 - progress * 0.65) * 1.15);
    }

    // Update active shockwave rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.lifetime) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const progress = r.age / r.lifetime;
      const scale = r.startScale + (r.endScale - r.startScale) * (1 - Math.pow(1 - progress, 2));
      r.mesh.scale.setScalar(scale);
      r.mat.opacity = (1.0 - progress) * 0.85;
    }
  }
}
