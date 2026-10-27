import { BotController } from '../ai/BotController';
import { resolveMapSelection } from '../config/arenas';
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
  private humanInputs = new Map<string, PlayerInputCommand>();
  private humanBoosts = new Set<string>();

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
    this.arena = new ArenaSystem('classic');
    this.collisionSystem = new CollisionSystem();
    this.botController = new BotController();
  }

  public startMatch(config: MatchConfig): void {
    const humanPlayers = config.humanPlayers;
    const botCount = humanPlayers ? 0 : Math.max(1, Math.min(7, Math.round(config.botCount)));
    const difficulty: BotDifficulty = config.difficulty;
    this.isDemoMode = Boolean(config.isDemoMode);
    this.matchDuration = config.matchDuration ?? ARENA_CONSTANTS.MATCH_DURATION_SECONDS;
    this.remainingTime = this.matchDuration;
    this.elapsedTime = 0;
    this.tick = 0;
    this.accumulator = 0;
    this.pendingEvents = [];
    this.latchedBoostPress = false;
    this.humanInputs.clear();
    this.humanBoosts.clear();

    const seed = config.seed ?? 1337 + botCount * 97;
    const resolvedArenaId = resolveMapSelection(config.arenaId ?? 'classic', seed);

    this.arena.setArena(resolvedArenaId);
    this.collisionSystem.reset();
    this.botController.reset(seed);

    // Clear old physics bodies
    for (const id of this.entities.keys()) {
      this.physics.removeBallBody(id);
    }
    this.entities.clear();
    this.entityList = [];

    const arenaState = this.arena.getState();
    this.physics.configureArenaGeometry(
      arenaState.baseRadius,
      arenaState.holes,
      arenaState.bumpers
    );

    const totalParticipants = (humanPlayers?.length ?? 1) + botCount;
    const spawnPositions = this.arena.getInitialSpawnPositions(totalParticipants);

    for (let i = 0; i < totalParticipants; i++) {
      const isPlayer = humanPlayers ? true : i === 0;
      const id = humanPlayers ? humanPlayers[i].id : isPlayer ? PLAYER_ENTITY_ID : `bot-${i}`;
      const palette = isPlayer ? PLAYER_PALETTE : BOT_PALETTES[(i - 1) % BOT_PALETTES.length];
      const human = humanPlayers?.[i];
      const spawnPos = spawnPositions[i];

      const entity: BallEntityState = {
        id,
        name: human?.name ?? palette.name,
        isPlayer,
        difficulty,
        colorPrimary: human?.colorPrimary ?? palette.primary,
        colorAccent: human?.colorAccent ?? palette.accent,
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
        knockbackTimer: 0,
        dangerLevel: 0,
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
      if (human) {
        this.humanInputs.set(id, { entityId: id, moveX: 0, moveZ: 0, boostPressed: false });
      }
    }

    this.phase = this.isDemoMode ? 'menu' : 'playing';
  }

  public setPlayerInput(input: PlayerInputCommand): void {
    this.playerInput = { ...input };
    if (input.boostPressed) {
      this.latchedBoostPress = true;
    }
  }

  public setHumanInput(input: PlayerInputCommand): void {
    if (!this.entities.has(input.entityId)) return;
    this.humanInputs.set(input.entityId, { ...input });
    if (input.boostPressed) this.humanBoosts.add(input.entityId);
  }

  /** Freeze a dropped human during the reconnection grace period. */
  public setHumanConnected(id: string, connected: boolean): void {
    const entity = this.entities.get(id);
    if (!entity || !this.humanInputs.has(id)) return;
    this.setHumanInput({ entityId: id, moveX: 0, moveZ: 0, boostPressed: false });
    if (!connected && entity.isAlive) {
      entity.isAlive = false;
      entity.respawnTimer = 1_000_000;
      this.physics.setBallActive(id, false);
    } else if (connected && !entity.isAlive) {
      this.respawnEntity(entity);
    }
  }

  public removeHuman(id: string): void {
    if (!this.humanInputs.has(id)) return;
    this.physics.removeBallBody(id);
    this.entities.delete(id);
    this.entityList = this.entityList.filter((entity) => entity.id !== id);
    this.humanInputs.delete(id);
    this.humanBoosts.delete(id);
  }

  public finishMatch(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'results';
    this.pendingEvents.push({ type: 'match_end', timestamp: this.elapsedTime, rankings: this.getRankings() });
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
        entity.position.y >= -0.22 && !this.arena.isPastPlatformEdge(entity.position);

      let inputCmd: PlayerInputCommand;
      if (this.humanInputs.has(entity.id)) {
        const humanInput = this.humanInputs.get(entity.id)!;
        inputCmd = { ...humanInput, boostPressed: humanInput.boostPressed || this.humanBoosts.has(entity.id) };
        this.humanBoosts.delete(entity.id);
      } else if (entity.isPlayer && !this.isDemoMode) {
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
    const { ballPairs, bumperHits } = this.physics.step(activeIds, PHYSICS_CONSTANTS.BALL_RADIUS);

    // Sync post-step positions and velocities
    for (const entity of this.entityList) {
      if (!entity.isAlive) continue;
      entity.position = this.physics.getBallPosition(entity.id);
      entity.velocity = this.physics.getBallVelocity(entity.id);
    }

    // 3a. Resolve ball-to-ball combat collisions & knockback impulses
    for (const pair of ballPairs) {
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

    // 3b. Resolve ball-to-bumper pillar rebounds (Bumper Arena)
    for (const hit of bumperHits) {
      const ball = this.entities.get(hit.ballId);
      if (!ball || !ball.isAlive) continue;

      const res = this.collisionSystem.resolveBumperCollision(ball, hit.bumper, this.elapsedTime);
      if (res.applied) {
        ball.velocity = res.velocity;
        this.physics.setBallVelocity(ball.id, ball.velocity);
        if (res.event) {
          this.pendingEvents.push(res.event);
        }
      }
    }

    // 4. Update visual rolling rotation, hazard danger feedback & check for ring-outs (outer edge or holes)
    for (const entity of this.entityList) {
      if (!entity.isAlive) continue;

      MovementController.updateRollingRotation(entity);
      entity.dangerLevel = this.arena.getHazardDangerLevel(entity.position);

      const boundsCheck = this.arena.checkOutOfBounds(entity.position);
      if (boundsCheck.out) {
        this.eliminateEntity(entity, boundsCheck.viaHole);
      }
    }

    // 5. Check match timer completion
    if (!this.isDemoMode && this.remainingTime <= 0 && this.phase === 'playing') {
      this.finishMatch();
    }
  }

  private eliminateEntity(entity: BallEntityState, viaHole = false): void {
    const fallPosition = cloneVec3(entity.position);
    entity.isAlive = false;
    entity.respawnTimer = ARENA_CONSTANTS.RESPAWN_DELAY_SECONDS;
    entity.boostActiveTimer = 0;
    entity.spawnProtectionTimer = 0;
    entity.knockbackTimer = 0;
    entity.dangerLevel = 0;
    entity.velocity = vec3(0, 0, 0);

    const event = ScoringSystem.processRingOut(entity, this.entities, this.elapsedTime, viaHole);
    event.position = fallPosition;
    this.pendingEvents.push(event);

    this.physics.setBallActive(entity.id, false);
  }

  private respawnEntity(entity: BallEntityState): void {
    const safePos = this.arena.findSafeRespawnPosition(
      this.entityList,
      entity.slotIndex,
      this.tick
    );
    entity.isAlive = true;
    entity.respawnTimer = 0;
    entity.spawnProtectionTimer = ARENA_CONSTANTS.SPAWN_PROTECTION_SECONDS;
    entity.boostActiveTimer = 0;
    entity.knockbackTimer = 0;
    entity.dangerLevel = 0;
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
