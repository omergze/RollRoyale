import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_CONSTANTS, PHYSICS_CONSTANTS } from '../config/constants';
import type { ArenaBumperConfig, ArenaHoleConfig, Vector3Like } from '../types/game';

export interface PhysicsContactPair {
  idA: string;
  idB: string;
}

export interface PhysicsBumperHit {
  ballId: string;
  bumper: ArenaBumperConfig;
}

export interface PhysicsStepResult {
  ballPairs: PhysicsContactPair[];
  bumperHits: PhysicsBumperHit[];
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
  private arenaCollider: RAPIER.Collider | null = null;
  private bumperColliders: RAPIER.Collider[] = [];
  private bumperHandleToConfig = new Map<number, ArenaBumperConfig>();

  private currentColliderRadius: number;
  private currentHoles: ReadonlyArray<ArenaHoleConfig> = [];
  private currentBumpers: ReadonlyArray<ArenaBumperConfig> = [];

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

    const arenaBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    this.arenaBody = this.world.createRigidBody(arenaBodyDesc);

    this.currentColliderRadius = initialArenaRadius;
    this.configureArenaGeometry(initialArenaRadius, [], []);
  }

  /**
   * Configures the physical floor deck collider (solid cylinder or perforated trimesh with real holes)
   * and any physical bumper pillar colliders for the selected arena.
   */
  public configureArenaGeometry(
    outerRadius: number,
    holes: ReadonlyArray<ArenaHoleConfig>,
    bumpers: ReadonlyArray<ArenaBumperConfig>
  ): void {
    this.currentColliderRadius = outerRadius;
    this.currentHoles = holes.map((h) => ({ ...h }));
    this.currentBumpers = bumpers.map((b) => ({ ...b }));

    this.rebuildDeckCollider(outerRadius, this.currentHoles);
    this.rebuildBumperColliders(this.currentBumpers);

    for (const body of this.bodies.values()) {
      body.wakeUp();
    }
  }

  /**
   * Updates the physical outer boundary during the final 30-second arena shrink.
   * Throttled so trimesh decks are never rebuilt every frame.
   */
  public updateArenaRadius(newRadius: number): void {
    const threshold = this.currentHoles.length > 0 ? 0.22 : 0.04;
    if (Math.abs(newRadius - this.currentColliderRadius) < threshold) {
      return;
    }
    this.currentColliderRadius = newRadius;
    this.rebuildDeckCollider(newRadius, this.currentHoles);

    for (const body of this.bodies.values()) {
      body.wakeUp();
    }
  }

  private rebuildDeckCollider(
    outerRadius: number,
    holes: ReadonlyArray<ArenaHoleConfig>
  ): void {
    if (this.arenaCollider) {
      this.world.removeCollider(this.arenaCollider, true);
      this.arenaCollider = null;
    }

    const deckThickness = ARENA_CONSTANTS.DECK_THICKNESS;
    const halfHeight = deckThickness * 0.5;

    if (holes.length === 0) {
      // Solid cylinder deck with top surface at y = 0
      const desc = RAPIER.ColliderDesc.cylinder(halfHeight, outerRadius)
        .setTranslation(0, -halfHeight, 0)
        .setFriction(0.0)
        .setRestitution(0.0);
      this.arenaCollider = this.world.createCollider(desc, this.arenaBody);
      return;
    }

    // Perforated deck with genuine physical hole openings using a static TriMesh
    const { vertices, indices } = PhysicsWorld.buildPerforatedDeckTrimesh(
      outerRadius,
      holes,
      deckThickness
    );
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.0)
      .setRestitution(0.0);
    this.arenaCollider = this.world.createCollider(desc, this.arenaBody);
  }

  private rebuildBumperColliders(bumpers: ReadonlyArray<ArenaBumperConfig>): void {
    for (const col of this.bumperColliders) {
      this.world.removeCollider(col, true);
    }
    this.bumperColliders = [];
    this.bumperHandleToConfig.clear();

    for (const bumper of bumpers) {
      const halfHeight = bumper.height * 0.5;
      const desc = RAPIER.ColliderDesc.cylinder(halfHeight, bumper.radius)
        .setTranslation(bumper.x, halfHeight, bumper.z)
        .setFriction(0.0)
        .setRestitution(0.85)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const col = this.world.createCollider(desc, this.arenaBody);
      this.bumperColliders.push(col);
      this.bumperHandleToConfig.set(col.handle, bumper);
    }
  }

  /**
   * Builds a clean, exact triangulated mesh (top surface at y = 0 + vertical shaft walls)
   * with genuine physical cutouts for all circular holes.
   */
  public static buildPerforatedDeckTrimesh(
    outerRadius: number,
    holes: ReadonlyArray<ArenaHoleConfig>,
    deckThickness: number
  ): { vertices: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    const tris: number[] = [];

    const addVertex = (x: number, y: number, z: number): number => {
      const idx = verts.length / 3;
      verts.push(x, y, z);
      return idx;
    };

    const addTri = (a: number, b: number, c: number): void => {
      tris.push(a, b, c);
    };

    // Fast path for Donut Arena (single central hole at origin)
    if (holes.length === 1 && Math.hypot(holes[0].x, holes[0].z) < 1e-3) {
      const innerR = holes[0].radius;
      const outerR = Math.max(innerR + 1.0, outerRadius);
      const angularSteps = 72;
      const radialRings = [
        innerR,
        innerR + (outerR - innerR) * 0.33,
        innerR + (outerR - innerR) * 0.66,
        outerR,
      ];

      // Top annulus surface at y = 0
      const ringVertexIndices: number[][] = [];
      for (const r of radialRings) {
        const ring: number[] = [];
        for (let i = 0; i < angularSteps; i++) {
          const theta = (i / angularSteps) * Math.PI * 2;
          ring.push(addVertex(Math.cos(theta) * r, 0, Math.sin(theta) * r));
        }
        ringVertexIndices.push(ring);
      }

      for (let rIdx = 0; rIdx < radialRings.length - 1; rIdx++) {
        const innerRing = ringVertexIndices[rIdx];
        const outerRing = ringVertexIndices[rIdx + 1];
        for (let i = 0; i < angularSteps; i++) {
          const next = (i + 1) % angularSteps;
          const a = innerRing[i];
          const b = outerRing[i];
          const c = outerRing[next];
          const d = innerRing[next];
          addTri(a, c, b);
          addTri(a, d, c);
        }
      }

      // Inner hole vertical shaft wall (at r = innerR)
      PhysicsWorld.appendCylinderWall(verts, tris, 0, 0, innerR, deckThickness, angularSteps, true);
      // Outer deck vertical wall (at r = outerR)
      PhysicsWorld.appendCylinderWall(
        verts,
        tris,
        0,
        0,
        outerR,
        deckThickness,
        angularSteps,
        false
      );

      return {
        vertices: new Float32Array(verts),
        indices: new Uint32Array(tris),
      };
    }

    // General multi-hole perforated circular deck (e.g., Crater Arena with 3 off-center holes)
    // Uses a fine polar grid clipped analytically against every circular hole boundary.
    const radialSteps = 38;
    const angularSteps = 96;

    // Signed distance function to solid deck: <= 0 is solid deck, > 0 is inside a hole or outside outerRadius
    const holeSdf = (x: number, z: number): { dist: number; holeIndex: number } => {
      let maxHoleVal = -Infinity;
      let holeIdx = -1;
      for (let k = 0; k < holes.length; k++) {
        const h = holes[k];
        const d = Math.hypot(x - h.x, z - h.z);
        const val = h.radius - d; // > 0 when inside hole k
        if (val > maxHoleVal) {
          maxHoleVal = val;
          holeIdx = k;
        }
      }
      return { dist: maxHoleVal, holeIndex: holeIdx };
    };

    const projectToHoleRim = (
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      hole: ArenaHoleConfig
    ): { x: number; z: number } => {
      const d1 = Math.hypot(x1 - hole.x, z1 - hole.z) - hole.radius;
      const d2 = Math.hypot(x2 - hole.x, z2 - hole.z) - hole.radius;
      const denom = d1 - d2;
      const t = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, d1 / denom)) : 0.5;
      const mx = x1 + (x2 - x1) * t;
      const mz = z1 + (z2 - z1) * t;
      const len = Math.hypot(mx - hole.x, mz - hole.z);
      if (len < 1e-6) {
        return { x: hole.x + hole.radius, z: hole.z };
      }
      return {
        x: hole.x + ((mx - hole.x) / len) * hole.radius,
        z: hole.z + ((mz - hole.z) / len) * hole.radius,
      };
    };

    const emitClippedTriangle = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      cx: number,
      cz: number
    ): void => {
      const sa = holeSdf(ax, az);
      const sb = holeSdf(bx, bz);
      const sc = holeSdf(cx, cz);

      const inHoleA = sa.dist > 1e-4;
      const inHoleB = sb.dist > 1e-4;
      const inHoleC = sc.dist > 1e-4;
      const insideHoleCount = (inHoleA ? 1 : 0) + (inHoleB ? 1 : 0) + (inHoleC ? 1 : 0);

      if (insideHoleCount === 3) {
        // Entire triangle is inside a hole opening -> omit completely so balls fall through!
        return;
      }

      if (insideHoleCount === 0) {
        const ia = addVertex(ax, 0, az);
        const ib = addVertex(bx, 0, bz);
        const ic = addVertex(cx, 0, cz);
        addTri(ia, ib, ic);
        return;
      }

      // Triangle straddles a hole rim: clip against the exact circular hole boundary
      const holeIdx = inHoleA ? sa.holeIndex : inHoleB ? sb.holeIndex : sc.holeIndex;
      const hole = holes[Math.max(0, holeIdx)];

      const pts = [
        { x: ax, z: az, inHole: inHoleA },
        { x: bx, z: bz, inHole: inHoleB },
        { x: cx, z: cz, inHole: inHoleC },
      ];

      if (insideHoleCount === 2) {
        // 1 vertex is on solid deck, 2 are inside the hole -> 1 clipped triangle on solid deck
        const solidIdx = pts.findIndex((p) => !p.inHole);
        const pSolid = pts[solidIdx];
        const pNext = pts[(solidIdx + 1) % 3];
        const pPrev = pts[(solidIdx + 2) % 3];

        const rim1 = projectToHoleRim(pSolid.x, pSolid.z, pNext.x, pNext.z, hole);
        const rim2 = projectToHoleRim(pSolid.x, pSolid.z, pPrev.x, pPrev.z, hole);

        const i0 = addVertex(pSolid.x, 0, pSolid.z);
        const i1 = addVertex(rim1.x, 0, rim1.z);
        const i2 = addVertex(rim2.x, 0, rim2.z);
        addTri(i0, i1, i2);
      } else {
        // 2 vertices on solid deck, 1 inside the hole -> quad split into 2 triangles on solid deck
        const holeVertIdx = pts.findIndex((p) => p.inHole);
        const pHole = pts[holeVertIdx];
        const pSolid1 = pts[(holeVertIdx + 1) % 3];
        const pSolid2 = pts[(holeVertIdx + 2) % 3];

        const rim1 = projectToHoleRim(pSolid1.x, pSolid1.z, pHole.x, pHole.z, hole);
        const rim2 = projectToHoleRim(pSolid2.x, pSolid2.z, pHole.x, pHole.z, hole);

        const is1 = addVertex(pSolid1.x, 0, pSolid1.z);
        const is2 = addVertex(pSolid2.x, 0, pSolid2.z);
        const ir1 = addVertex(rim1.x, 0, rim1.z);
        const ir2 = addVertex(rim2.x, 0, rim2.z);

        addTri(is1, is2, ir2);
        addTri(is1, ir2, ir1);
      }
    };

    for (let rStep = 0; rStep < radialSteps; rStep++) {
      const r0 = (rStep / radialSteps) * outerRadius;
      const r1 = ((rStep + 1) / radialSteps) * outerRadius;

      for (let aStep = 0; aStep < angularSteps; aStep++) {
        const theta0 = (aStep / angularSteps) * Math.PI * 2;
        const theta1 = ((aStep + 1) / angularSteps) * Math.PI * 2;

        const x00 = Math.cos(theta0) * r0;
        const z00 = Math.sin(theta0) * r0;
        const x10 = Math.cos(theta0) * r1;
        const z10 = Math.sin(theta0) * r1;
        const x11 = Math.cos(theta1) * r1;
        const z11 = Math.sin(theta1) * r1;
        const x01 = Math.cos(theta1) * r0;
        const z01 = Math.sin(theta1) * r0;

        if (rStep === 0) {
          emitClippedTriangle(0, 0, x11, z11, x10, z10);
        } else {
          emitClippedTriangle(x00, z00, x11, z11, x10, z10);
          emitClippedTriangle(x00, z00, x01, z01, x11, z11);
        }
      }
    }

    // Add smooth vertical shaft walls inside each hole so balls tipping over the rim deflect downward cleanly
    for (const hole of holes) {
      PhysicsWorld.appendCylinderWall(verts, tris, hole.x, hole.z, hole.radius, deckThickness, 40, true);
    }

    // Add outer deck vertical wall
    PhysicsWorld.appendCylinderWall(verts, tris, 0, 0, outerRadius, deckThickness, 72, false);

    return {
      vertices: new Float32Array(verts),
      indices: new Uint32Array(tris),
    };
  }

  private static appendCylinderWall(
    verts: number[],
    tris: number[],
    cx: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    inwardNormals: boolean
  ): void {
    const topRing: number[] = [];
    const botRing: number[] = [];

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const x = cx + Math.cos(theta) * radius;
      const z = cz + Math.sin(theta) * radius;

      const topIdx = verts.length / 3;
      verts.push(x, 0, z);
      topRing.push(topIdx);

      const botIdx = verts.length / 3;
      verts.push(x, -height, z);
      botRing.push(botIdx);
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const t0 = topRing[i];
      const t1 = topRing[next];
      const b0 = botRing[i];
      const b1 = botRing[next];

      if (inwardNormals) {
        tris.push(t0, b0, b1);
        tris.push(t0, b1, t1);
      } else {
        tris.push(t0, b1, b0);
        tris.push(t0, t1, b1);
      }
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
   * collision pairs and ball-to-bumper hits detected during this step.
   */
  public step(activeIds: ReadonlyArray<string>, ballRadius: number): PhysicsStepResult {
    this.world.step(this.eventQueue);

    const pairSet = new Set<string>();
    const ballPairs: PhysicsContactPair[] = [];
    const bumperHitSet = new Set<string>();
    const bumperHits: PhysicsBumperHit[] = [];

    const recordPair = (idA: string, idB: string) => {
      if (idA === idB) return;
      const key = idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        ballPairs.push({ idA, idB });
      }
    };

    const recordBumperHit = (ballId: string, bumper: ArenaBumperConfig) => {
      const key = `${ballId}::${bumper.id}`;
      if (!bumperHitSet.has(key)) {
        bumperHitSet.add(key);
        bumperHits.push({ ballId, bumper });
      }
    };

    // 1. Collect Rapier collision events
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      const idA = this.colliderHandleToEntityId.get(handle1);
      const idB = this.colliderHandleToEntityId.get(handle2);
      if (idA && idB) {
        recordPair(idA, idB);
        return;
      }

      const bumper1 = this.bumperHandleToConfig.get(handle1);
      if (bumper1 && idB) {
        recordBumperHit(idB, bumper1);
        return;
      }

      const bumper2 = this.bumperHandleToConfig.get(handle2);
      if (bumper2 && idA) {
        recordBumperHit(idA, bumper2);
      }
    });

    // 2. Also check continuous physical proximity between active balls and bumpers
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

      if (posA.y > -0.4 && posA.y < 2.8) {
        for (const bumper of this.currentBumpers) {
          const dx = posA.x - bumper.x;
          const dz = posA.z - bumper.z;
          const hitDist = ballRadius + bumper.radius + 0.12;
          if (dx * dx + dz * dz <= hitDist * hitDist) {
            recordBumperHit(idA, bumper);
          }
        }
      }
    }

    return { ballPairs, bumperHits };
  }

  public dispose(): void {
    this.bodies.clear();
    this.colliders.clear();
    this.colliderHandleToEntityId.clear();
    this.bumperColliders = [];
    this.bumperHandleToConfig.clear();
    this.eventQueue.free();
    this.world.free();
  }
}
