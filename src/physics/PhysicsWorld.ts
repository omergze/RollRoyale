import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_CONSTANTS, PHYSICS_CONSTANTS } from '../config/constants';
import type { Vector3Like } from '../types/game';

export interface PhysicsContactPair {
  idA: string;
  idB: string;
}

export class PhysicsWorld {
  private static initialized = false;
  private static initPromise: Promise<void> | null = null;

  public static async ensureInitialized(): Promise<void> {
    if (PhysicsWorld.initialized) {
      return;
    }
    if (!PhysicsWorld.initPromise) {
      PhysicsWorld.initPromise = RAPIER.init().then(() => {
        PhysicsWorld.initialized = true;
      });
    }
    await PhysicsWorld.initPromise;
  }

  private world: RAPIER.World;
  private eventQueue: RAPIER.EventQueue;
  private arenaBody: RAPIER.RigidBody;
  private arenaCollider: RAPIER.Collider;
  private currentColliderRadius: number;

  private bodies = new Map<string, RAPIER.RigidBody>();
  private colliders = new Map<string, RAPIER.Collider>();
  private colliderHandleToEntityId = new Map<number, string>();

  constructor(initialArenaRadius: number = ARENA_CONSTANTS.BASE_RADIUS) {
    if (!PhysicsWorld.initialized) {
      throw new Error(
        'PhysicsWorld.ensureInitialized() must be awaited before constructing PhysicsWorld.'
      );
    }

    this.world = new RAPIER.World({
      x: 0,
      y: PHYSICS_CONSTANTS.GRAVITY_Y,
      z: 0,
    });
    this.world.timestep = PHYSICS_CONSTANTS.FIXED_TIMESTEP;
    this.eventQueue = new RAPIER.EventQueue(true);

    // Create fixed arena platform cylinder
    const halfHeight = ARENA_CONSTANTS.DECK_THICKNESS * 0.5;
    const arenaBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -halfHeight, 0);
    this.arenaBody = this.world.createRigidBody(arenaBodyDesc);

    this.currentColliderRadius = initialArenaRadius;
    const arenaColliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, initialArenaRadius)
      .setFriction(0.0)
      .setRestitution(0.0);
    this.arenaCollider = this.world.createCollider(arenaColliderDesc, this.arenaBody);
  }

  /**
   * Updates the physical cylinder collider radius during the final 30-second arena shrink.
   */
  public updateArenaRadius(newRadius: number): void {
    if (Math.abs(newRadius - this.currentColliderRadius) < 0.03) {
      return;
    }
    this.currentColliderRadius = newRadius;
    const halfHeight = ARENA_CONSTANTS.DECK_THICKNESS * 0.5;

    this.world.removeCollider(this.arenaCollider, true);
    const arenaColliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, newRadius)
      .setFriction(0.0)
      .setRestitution(0.0);
    this.arenaCollider = this.world.createCollider(arenaColliderDesc, this.arenaBody);

    // Wake up all dynamic bodies so balls near the shrinking rim immediately react to gravity
    for (const body of this.bodies.values()) {
      body.wakeUp();
    }
  }

  public addBallBody(id: string, position: Vector3Like, radius: number, mass: number): void {
    this.removeBallBody(id);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.15)
      .setAngularDamping(PHYSICS_CONSTANTS.ANGULAR_DAMPING)
      .setCcdEnabled(true)
      .lockRotations();

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setMass(mass)
      .setRestitution(PHYSICS_CONSTANTS.BALL_RESTITUTION)
      .setFriction(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(id, body);
    this.colliders.set(id, collider);
    this.colliderHandleToEntityId.set(collider.handle, id);
  }

  public removeBallBody(id: string): void {
    const collider = this.colliders.get(id);
    if (collider) {
      this.colliderHandleToEntityId.delete(collider.handle);
      this.colliders.delete(id);
    }
    const body = this.bodies.get(id);
    if (body) {
      this.world.removeRigidBody(body);
      this.bodies.delete(id);
    }
  }

  public setBallActive(id: string, active: boolean, position?: Vector3Like): void {
    const body = this.bodies.get(id);
    if (!body) return;

    if (!active) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setTranslation({ x: 0, y: -100, z: 0 }, false);
      body.sleep();
    } else {
      if (position) {
        body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      }
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.wakeUp();
    }
  }

  public getBallPosition(id: string): Vector3Like {
    const body = this.bodies.get(id);
    if (!body) return { x: 0, y: 0, z: 0 };
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  public getBallVelocity(id: string): Vector3Like {
    const body = this.bodies.get(id);
    if (!body) return { x: 0, y: 0, z: 0 };
    const v = body.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  public setBallVelocity(id: string, velocity: Vector3Like): void {
    const body = this.bodies.get(id);
    if (!body) return;
    body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  /**
   * Advances the Rapier simulation by one fixed timestep and returns all ball-to-ball
   * collision pairs detected during this step.
   */
  public step(activeIds: ReadonlyArray<string>, ballRadius: number): PhysicsContactPair[] {
    this.world.step(this.eventQueue);

    const pairSet = new Set<string>();
    const pairs: PhysicsContactPair[] = [];

    const recordPair = (idA: string, idB: string) => {
      if (idA === idB) return;
      const key = idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        pairs.push({ idA, idB });
      }
    };

    // 1. Collect Rapier collision events
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      const idA = this.colliderHandleToEntityId.get(handle1);
      const idB = this.colliderHandleToEntityId.get(handle2);
      if (idA && idB) {
        recordPair(idA, idB);
      }
    });

    // 2. Also check continuous physical proximity between active balls
    // (handles cases where two balls are already touching and one boosts into the other)
    const contactThreshold = ballRadius * 2 + 0.14;
    const contactThresholdSq = contactThreshold * contactThreshold;

    for (let i = 0; i < activeIds.length; i++) {
      const idA = activeIds[i];
      const bodyA = this.bodies.get(idA);
      if (!bodyA) continue;
      const posA = bodyA.translation();

      for (let j = i + 1; j < activeIds.length; j++) {
        const idB = activeIds[j];
        const bodyB = this.bodies.get(idB);
        if (!bodyB) continue;
        const posB = bodyB.translation();

        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const dz = posB.z - posA.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq <= contactThresholdSq) {
          recordPair(idA, idB);
        }
      }
    }

    return pairs;
  }

  public dispose(): void {
    this.bodies.clear();
    this.colliders.clear();
    this.colliderHandleToEntityId.clear();
    this.eventQueue.free();
    this.world.free();
  }
}
