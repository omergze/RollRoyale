import { BotController } from '../ai/BotController';
import {
  ARENA_CONSTANTS,
  BOT_PALETTES,
  PHYSICS_CONSTANTS,
  PLAYER_PALETTE,
} from '../config/constants';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type {
  BallEntityState,
  BotDifficulty,
  GameEvent,
  MatchConfig,
  MatchPhase,
  PlayerInputCommand,
  PlayerRankingEntry,
  SimulationSnapshot,
} from '../types/game';
import { cloneQuat, cloneVec3, identityQuat, vec3 } from '../utils/math';
import { ArenaSystem } from './ArenaSystem';
import { CollisionSystem } from './CollisionSystem';
import { MovementController } from './MovementController';
import { ScoringSystem } from './ScoringSystem';

export const PLAYER_ENTITY_ID = 'player-0';

export class GameSimulation {
  private physics: PhysicsWorld;
  private arena: ArenaSystem;
  private collisionSystem: CollisionSystem;
  private botController: BotController;

  private entities = new Map<string, BallEntityState>();
  private entityList: BallEntityState[] = [];
  private playerInput: PlayerInputCommand = {
    entityId: PLAYER_ENTITY_ID,
    moveX: 0,
    moveZ: 0,
    boostPressed: false,
  };
  private latchedBoostPress = false;

  private phase: MatchPhase = 'menu';
  private isDemoMode = true;
  private tick = 0;
  private elapsedTime = 0;
  private matchDuration: number = ARENA_CONSTANTS.MATCH_DURATION_SECONDS;
  private remainingTime: number = ARENA_CONSTANTS.MATCH_DURATION_SECONDS;
  private accumulator = 0;
  private pendingEvents: GameEvent[] = [];

  constructor() {
    this.physics = new PhysicsWorld(ARENA_CONSTANTS.BASE_RADIUS);
    this.arena = new ArenaSystem(ARENA_CONSTANTS.BASE_RADIUS, ARENA_CONSTANTS.MIN_RADIUS);
    this.collisionSystem = new CollisionSystem();
    this.botController = new BotController();
  }

  public startMatch(config: MatchConfig): void {
    const botCount = Math.max(1, Math.min(7, Math.round(config.botCount)));
    const difficulty: BotDifficulty = config.difficulty;
    this.isDemoMode = Boolean(config.isDemoMode);
    this.matchDuration = config.matchDuration ?? ARENA_CONSTANTS.MATCH_DURATION_SECONDS;
    this.remainingTime = this.matchDuration;
    this.elapsedTime = 0;
    this.tick = 0;
    this.accumulator = 0;
    this.pendingEvents = [];
    this.latchedBoostPress = false;

    this.arena.reset();
    this.collisionSystem.reset();
    this.botController.reset(1337 + botCount * 97);

    // Clear old physics bodies
    for (const id of this.entities.keys()) {
      this.physics.removeBallBody(id);
    }
    this.entities.clear();
    this.entityList = [];

    this.physics.updateArenaRadius(ARENA_CONSTANTS.BASE_RADIUS);

    const totalParticipants = 1 + botCount;
    const spawnPositions = this.arena.getInitialSpawnPositions(totalParticipants);

    for (let i = 0; i < totalParticipants; i++) {
      const isPlayer = i === 0;
      const id = isPlayer ? PLAYER_ENTITY_ID : `bot-${i}`;
      const palette = isPlayer ? PLAYER_PALETTE : BOT_PALETTES[(i - 1) % BOT_PALETTES.length];
      const spawnPos = spawnPositions[i];

      const entity: BallEntityState = {
        id,
        name: palette.name,
        isPlayer,
        difficulty,
        colorPrimary: palette.primary,
        colorAccent: palette.accent,
        slotIndex: i,
        radius: PHYSICS_CONSTANTS.BALL_RADIUS,
        mass: PHYSICS_CONSTANTS.BALL_MASS,
        position: cloneVec3(spawnPos),
        prevPosition: cloneVec3(spawnPos),
        velocity: vec3(0, 0, 0),
        rotation: identityQuat(),
        prevRotation: identityQuat(),
        squashStretch: vec3(1, 1, 1),
        isAlive: true,
        respawnTimer: 0,
        spawnProtectionTimer: 0.75,
        boostActiveTimer: 0,
        boostCooldownTimer: 0,
        boostDirection: vec3(0, 0, -1),
        lastHit: null,
        score: 0,
        knockouts: 0,
        falls: 0,
        streak: 0,
        bestStreak: 0,
        firstKnockoutTime: null,
        totalImpactDealt: 0,
      };

      this.entities.set(id, entity);
      this.entityList.push(entity);
      this.physics.addBallBody(id, spawnPos, entity.radius, entity.mass);
    }

    this.phase = this.isDemoMode ? 'menu' : 'playing';
  }

  public setPlayerInput(input: PlayerInputCommand): void {
    this.playerInput = { ...input };
    if (input.boostPressed) {
      this.latchedBoostPress = true;
    }
  }

  public setPaused(paused: boolean): void {
    if (this.phase === 'playing' && paused) {
      this.phase = 'paused';
    } else if (this.phase === 'paused' && !paused) {
      this.phase = 'playing';
    }
  }

  public getPhase(): MatchPhase {
    return this.phase;
  }

  /**
   * Advances simulation using fixed timestep accumulator.
   * Returns interpolation factor alpha in [0, 1] for smooth rendering at any refresh rate.
   */
  public update(deltaSeconds: number): number {
    if (this.phase === 'paused' || this.phase === 'results') {
      return 1.0;
    }

    const clampedDelta = Math.min(Math.max(0, deltaSeconds), 0.1);
    this.accumulator += clampedDelta;

    const fixedDt = PHYSICS_CONSTANTS.FIXED_TIMESTEP;
    let steps = 0;

    while (this.accumulator >= fixedDt && steps < PHYSICS_CONSTANTS.MAX_SUBSTEPS) {
      this.stepFixed(fixedDt);
      this.accumulator -= fixedDt;
      steps++;
      if (this.getPhase() === 'results') {
        this.accumulator = 0;
        break;
      }
    }

    return Math.min(1, Math.max(0, this.accumulator / fixedDt));
  }

  /**
   * Executes one deterministic fixed physics/gameplay step of `dt` seconds.
   */
  public stepFixed(dt: number = PHYSICS_CONSTANTS.FIXED_TIMESTEP): void {
    if (this.phase === 'paused' || this.phase === 'results') {
      return;
    }

    this.tick += 1;
    this.elapsedTime += dt;

    if (!this.isDemoMode) {
      this.remainingTime = Math.max(0, this.matchDuration - this.elapsedTime);

      // Update arena shrinking state
      const shrinkJustStarted = this.arena.update(this.remainingTime);
      if (shrinkJustStarted) {
        this.pendingEvents.push({
          type: 'shrink_start',
          timestamp: this.elapsedTime,
        });
      }
      this.physics.updateArenaRadius(this.arena.getState().currentRadius);
    }

    ScoringSystem.clearExpiredAttributions(this.entityList, this.elapsedTime);

    const arenaState = this.arena.getState();

    // 1. Handle respawns & prepare movement forces for alive balls
    for (const entity of this.entityList) {
      if (!entity.isAlive) {
        entity.respawnTimer -= dt;
        if (entity.respawnTimer <= 0) {
          this.respawnEntity(entity);
        }
        continue;
      }

      entity.prevPosition = cloneVec3(entity.position);
      entity.prevRotation = cloneQuat(entity.rotation);

      // Sync latest physical state from Rapier before applying input forces
      entity.position = this.physics.getBallPosition(entity.id);
      entity.velocity = this.physics.getBallVelocity(entity.id);

      const isGroundedOnDeck =
        entity.position.y >= -0.25 && !this.arena.isPastPlatformEdge(entity.position);

      let inputCmd: PlayerInputCommand;
      if (entity.isPlayer && !this.isDemoMode) {
        inputCmd = {
          ...this.playerInput,
          boostPressed: this.playerInput.boostPressed || this.latchedBoostPress,
        };
        this.latchedBoostPress = false;
      } else {
        inputCmd = this.botController.computeBotInput(entity, this.entityList, arenaState, dt);
      }

      const moveResult = MovementController.stepMovement(entity, inputCmd, dt, isGroundedOnDeck);
      entity.velocity = moveResult.newVelocity;
      this.physics.setBallVelocity(entity.id, entity.velocity);

      if (moveResult.boostActivated) {
        this.pendingEvents.push({
          type: 'boost',
          timestamp: this.elapsedTime,
          entityId: entity.id,
          position: cloneVec3(entity.position),
          direction: cloneVec3(moveResult.boostDirection),
        });
      }
    }

    // 2. Step Rapier 3D physics world
    const activeIds = this.entityList.filter((e) => e.isAlive).map((e) => e.id);
    const contactPairs = this.physics.step(activeIds, PHYSICS_CONSTANTS.BALL_RADIUS);

    // Sync post-step positions and velocities
    for (const entity of this.entityList) {
      if (!entity.isAlive) continue;
      entity.position = this.physics.getBallPosition(entity.id);
      entity.velocity = this.physics.getBallVelocity(entity.id);
    }

    // 3. Resolve ball-to-ball combat collisions & knockback impulses
    for (const pair of contactPairs) {
      const ballA = this.entities.get(pair.idA);
      const ballB = this.entities.get(pair.idB);
      if (!ballA || !ballB || !ballA.isAlive || !ballB.isAlive) continue;

      const resolution = this.collisionSystem.resolveBallCollision(ballA, ballB, this.elapsedTime);
      if (resolution.applied) {
        ballA.velocity = resolution.velocityA;
        ballB.velocity = resolution.velocityB;
        this.physics.setBallVelocity(ballA.id, ballA.velocity);
        this.physics.setBallVelocity(ballB.id, ballB.velocity);

        if (resolution.event) {
          this.pendingEvents.push(resolution.event);
        }
      }
    }

    // 4. Update visual rolling rotation & check for ring-outs (falling off the arena)
    for (const entity of this.entityList) {
      if (!entity.isAlive) continue;

      MovementController.updateRollingRotation(entity);

      if (this.arena.isEntityOutOfBounds(entity.position)) {
        this.eliminateEntity(entity);
      }
    }

    // 5. Check match timer completion
    if (!this.isDemoMode && this.remainingTime <= 0 && this.phase === 'playing') {
      this.phase = 'results';
      const rankings = ScoringSystem.computeRankings(this.entityList);
      this.pendingEvents.push({
        type: 'match_end',
        timestamp: this.elapsedTime,
        rankings,
      });
    }
  }

  private eliminateEntity(entity: BallEntityState): void {
    const fallPosition = cloneVec3(entity.position);
    entity.isAlive = false;
    entity.respawnTimer = ARENA_CONSTANTS.RESPAWN_DELAY_SECONDS;
    entity.boostActiveTimer = 0;
    entity.spawnProtectionTimer = 0;
    entity.velocity = vec3(0, 0, 0);

    const event = ScoringSystem.processRingOut(entity, this.entities, this.elapsedTime);
    event.position = fallPosition;
    this.pendingEvents.push(event);

    this.physics.setBallActive(entity.id, false);
  }

  private respawnEntity(entity: BallEntityState): void {
    const safePos = this.arena.findSafeRespawnPosition(this.entityList, entity.slotIndex);
    entity.isAlive = true;
    entity.respawnTimer = 0;
    entity.spawnProtectionTimer = ARENA_CONSTANTS.SPAWN_PROTECTION_SECONDS;
    entity.boostActiveTimer = 0;
    entity.lastHit = null;
    entity.position = cloneVec3(safePos);
    entity.prevPosition = cloneVec3(safePos);
    entity.velocity = vec3(0, 0, 0);
    entity.squashStretch = vec3(0.65, 1.35, 0.65);

    this.physics.setBallActive(entity.id, true, safePos);

    this.pendingEvents.push({
      type: 'respawn',
      timestamp: this.elapsedTime,
      entityId: entity.id,
      position: cloneVec3(safePos),
    });
  }

  public drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  public getEntity(id: string): BallEntityState | undefined {
    return this.entities.get(id);
  }

  public getEntities(): ReadonlyArray<BallEntityState> {
    return this.entityList;
  }

  public getRankings(): PlayerRankingEntry[] {
    return ScoringSystem.computeRankings(this.entityList);
  }

  public getSnapshot(): SimulationSnapshot {
    return {
      tick: this.tick,
      elapsedTime: this.elapsedTime,
      remainingTime: this.remainingTime,
      matchDuration: this.matchDuration,
      phase: this.phase,
      arena: this.arena.getState(),
      entities: this.entityList.map((e) => ({
        ...e,
        position: cloneVec3(e.position),
        prevPosition: cloneVec3(e.prevPosition),
        velocity: cloneVec3(e.velocity),
        rotation: cloneQuat(e.rotation),
        prevRotation: cloneQuat(e.prevRotation),
        squashStretch: cloneVec3(e.squashStretch),
        boostDirection: cloneVec3(e.boostDirection),
        lastHit: e.lastHit ? { ...e.lastHit } : null,
      })),
      rankings: this.getRankings(),
    };
  }

  public dispose(): void {
    this.physics.dispose();
  }
}
