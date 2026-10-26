import { beforeAll, describe, expect, it } from 'vitest';
import { BotController } from '../../src/ai/BotController';
import { PHYSICS_CONSTANTS } from '../../src/config/constants';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { ArenaSystem } from '../../src/simulation/ArenaSystem';
import { CollisionSystem } from '../../src/simulation/CollisionSystem';
import { GameSimulation, PLAYER_ENTITY_ID } from '../../src/simulation/GameSimulation';
import { MovementController } from '../../src/simulation/MovementController';
import { ScoringSystem } from '../../src/simulation/ScoringSystem';
import type { BallEntityState } from '../../src/types/game';
import { identityQuat, lengthXZ, vec3 } from '../../src/utils/math';

function createDummyBall(overrides: Partial<BallEntityState> = {}): BallEntityState {
  return {
    id: 'ball-test',
    name: 'TEST',
    isPlayer: true,
    difficulty: 'normal',
    colorPrimary: '#00F0FF',
    colorAccent: '#0077FF',
    slotIndex: 0,
    radius: PHYSICS_CONSTANTS.BALL_RADIUS,
    mass: PHYSICS_CONSTANTS.BALL_MASS,
    position: vec3(0, PHYSICS_CONSTANTS.BALL_RADIUS, 0),
    prevPosition: vec3(0, PHYSICS_CONSTANTS.BALL_RADIUS, 0),
    velocity: vec3(0, 0, 0),
    rotation: identityQuat(),
    prevRotation: identityQuat(),
    squashStretch: vec3(1, 1, 1),
    isAlive: true,
    respawnTimer: 0,
    spawnProtectionTimer: 0,
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
    ...overrides,
  };
}

describe('RollRoyale Core Simulation & Physics Suite', () => {
  beforeAll(async () => {
    await PhysicsWorld.ensureInitialized();
  });

  describe('1. Player Movement & Boost Rules', () => {
    it('accelerates smoothly in input direction and decelerates when input is released', () => {
      const ball = createDummyBall();
      const dt = 1 / 60;

      // Accelerate right (+X) for 30 frames (0.5s)
      for (let i = 0; i < 30; i++) {
        const res = MovementController.stepMovement(
          ball,
          { entityId: ball.id, moveX: 1, moveZ: 0, boostPressed: false },
          dt,
          true
        );
        ball.velocity = res.newVelocity;
      }

      const speedAfterAccel = lengthXZ(ball.velocity);
      expect(speedAfterAccel).toBeGreaterThan(8.0);
      expect(speedAfterAccel).toBeLessThanOrEqual(PHYSICS_CONSTANTS.MAX_MOVE_SPEED + 0.01);

      // Release input and verify controlled deceleration stops the ball without sliding forever
      for (let i = 0; i < 60; i++) {
        const res = MovementController.stepMovement(
          ball,
          { entityId: ball.id, moveX: 0, moveZ: 0, boostPressed: false },
          dt,
          true
        );
        ball.velocity = res.newVelocity;
      }

      expect(lengthXZ(ball.velocity)).toBe(0);
    });

    it('activates boost, increases speed beyond normal cap, and enforces cooldown', () => {
      const ball = createDummyBall();
      const dt = 1 / 60;

      const firstBoost = MovementController.stepMovement(
        ball,
        { entityId: ball.id, moveX: 0, moveZ: -1, boostPressed: true },
        dt,
        true
      );
      ball.velocity = firstBoost.newVelocity;

      expect(firstBoost.boostActivated).toBe(true);
      expect(ball.boostActiveTimer).toBeCloseTo(PHYSICS_CONSTANTS.BOOST_DURATION, 3);
      expect(ball.boostCooldownTimer).toBeCloseTo(PHYSICS_CONSTANTS.BOOST_COOLDOWN, 3);
      expect(lengthXZ(ball.velocity)).toBeGreaterThan(PHYSICS_CONSTANTS.BOOST_INITIAL_IMPULSE * 0.9);

      // Attempting to boost again while on cooldown must not re-trigger boost
      const secondAttempt = MovementController.stepMovement(
        ball,
        { entityId: ball.id, moveX: 0, moveZ: -1, boostPressed: true },
        dt,
        true
      );
      expect(secondAttempt.boostActivated).toBe(false);
      expect(ball.boostCooldownTimer).toBeCloseTo(PHYSICS_CONSTANTS.BOOST_COOLDOWN - dt, 3);
    });

    it('updates ball visual rolling rotation proportionally to ground displacement', () => {
      const ball = createDummyBall({
        prevPosition: vec3(0, 1, 0),
        position: vec3(1.5, 1, 0),
      });
      MovementController.updateRollingRotation(ball);
      expect(ball.rotation.w).toBeLessThan(1.0);
      expect(Math.hypot(ball.rotation.x, ball.rotation.y, ball.rotation.z, ball.rotation.w)).toBeCloseTo(1.0, 5);
    });
  });

  describe('2. Collision, Knockback & Positional Advantage', () => {
    it('delivers stronger knockback when attacker is moving fast or boosting', () => {
      const collisionSystem = new CollisionSystem();

      const slowAttacker = createDummyBall({
        id: 'a1',
        position: vec3(-1, 1, 0),
        velocity: vec3(5, 0, 0),
      });
      const defender1 = createDummyBall({
        id: 'b1',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const slowRes = collisionSystem.resolveBallCollision(slowAttacker, defender1, 1.0);

      const boostedAttacker = createDummyBall({
        id: 'a2',
        position: vec3(-1, 1, 0),
        velocity: vec3(20, 0, 0),
        boostActiveTimer: 0.3,
      });
      const defender2 = createDummyBall({
        id: 'b2',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const fastRes = collisionSystem.resolveBallCollision(boostedAttacker, defender2, 1.0);

      expect(slowRes.applied).toBe(true);
      expect(fastRes.applied).toBe(true);
      expect(fastRes.velocityB.x).toBeGreaterThan(slowRes.velocityB.x * 1.4);
    });

    it('grants side and rear positional bonuses and prevents duplicate pair callbacks within cooldown', () => {
      const rearBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(8, 0, 0));
      const sideBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(0, 0, 8));
      const headOnBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(-8, 0, 0));

      expect(rearBonus).toBeGreaterThan(sideBonus);
      expect(sideBonus).toBeGreaterThan(headOnBonus);

      const collisionSystem = new CollisionSystem();
      const ballA = createDummyBall({ id: 'a', position: vec3(0, 1, 0), velocity: vec3(10, 0, 0) });
      const ballB = createDummyBall({ id: 'b', position: vec3(2, 1, 0), velocity: vec3(0, 0, 0) });

      const first = collisionSystem.resolveBallCollision(ballA, ballB, 2.0);
      const duplicateImmediate = collisionSystem.resolveBallCollision(ballA, ballB, 2.05);
      const afterCooldown = collisionSystem.resolveBallCollision(ballA, ballB, 2.5);

      expect(first.applied).toBe(true);
      expect(duplicateImmediate.applied).toBe(false);
      expect(afterCooldown.applied).toBe(true);
    });
  });

  describe('3. Knockout Attribution, Self-Falls & Deterministic Tie-Breakers', () => {
    it('credits knockout to attacker within attribution window and treats unassisted falls as self-falls', () => {
      const attacker = createDummyBall({ id: 'player-0', name: 'YOU' });
      const victim = createDummyBall({
        id: 'bot-1',
        name: 'NOVA',
        lastHit: {
          attackerId: 'player-0',
          attackerName: 'YOU',
          timestamp: 10.0,
          impactSpeed: 14,
          impulseMagnitude: 16,
        },
      });

      const map = new Map<string, BallEntityState>([
        [attacker.id, attacker],
        [victim.id, victim],
      ]);

      // Knocked out 1.5s after collision -> valid knockout
      const koEvent = ScoringSystem.processRingOut(victim, map, 11.5);
      expect(koEvent.type).toBe('knockout');
      expect(attacker.knockouts).toBe(1);
      expect(attacker.score).toBe(1);
      expect(victim.falls).toBe(1);

      // Victim falls again at t=20s with no recent hit -> self_fall
      const selfFallEvent = ScoringSystem.processRingOut(victim, map, 20.0);
      expect(selfFallEvent.type).toBe('self_fall');
      expect(attacker.knockouts).toBe(1); // Unchanged!
      expect(victim.falls).toBe(2);
    });

    it('breaks ties deterministically using falls, first knockout time, and impact dealt', () => {
      const p1 = createDummyBall({
        id: 'p1',
        name: 'P1',
        slotIndex: 0,
        score: 3,
        knockouts: 3,
        falls: 2,
        firstKnockoutTime: 15,
      });
      const p2 = createDummyBall({
        id: 'p2',
        name: 'P2',
        slotIndex: 1,
        score: 3,
        knockouts: 3,
        falls: 1, // Fewer falls wins tie-breaker #1
        firstKnockoutTime: 25,
      });
      const p3 = createDummyBall({
        id: 'p3',
        name: 'P3',
        slotIndex: 2,
        score: 3,
        knockouts: 3,
        falls: 2,
        firstKnockoutTime: 9, // Same falls as P1, earlier first KO wins tie-breaker #2
      });

      const rankings = ScoringSystem.computeRankings([p1, p2, p3]);
      expect(rankings.map((r) => r.entityId)).toEqual(['p2', 'p3', 'p1']);
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].rank).toBe(2);
      expect(rankings[2].rank).toBe(3);
    });
  });

  describe('4. Arena Boundaries & Final 30-Second Shrinking', () => {
    it('shrinks smoothly during the final 30 seconds and selects safe interior respawn points', () => {
      const arena = new ArenaSystem(22, 12.5);

      expect(arena.update(60)).toBe(false);
      expect(arena.getState().isShrinking).toBe(false);
      expect(arena.getState().currentRadius).toBe(22);

      // Crossing into 30s triggers shrink_start
      expect(arena.update(30)).toBe(true);
      expect(arena.getState().isShrinking).toBe(true);

      // Halfway through final 30s (15s remaining)
      arena.update(15);
      expect(arena.getState().shrinkProgress).toBeCloseTo(0.5, 3);
      expect(arena.getState().currentRadius).toBeCloseTo((22 + 12.5) / 2, 2);

      // At 0s remaining, reaches minimum radius
      arena.update(0);
      expect(arena.getState().currentRadius).toBeCloseTo(12.5, 3);

      const opponent = createDummyBall({ position: vec3(4, 1, 0) });
      const respawnPos = arena.findSafeRespawnPosition([opponent], 1);
      expect(lengthXZ(respawnPos)).toBeLessThan(arena.getState().currentRadius * 0.65);
    });
  });

  describe('5. AI Bot Decision Rules (Normal & Hard)', () => {
    it('steers back toward center and uses emergency boost when dangerously close to the arena edge', () => {
      const botController = new BotController();
      const arena = new ArenaSystem(22, 12.5).getState();

      const endangeredBot = createDummyBall({
        id: 'bot-1',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(19.8, 1, 0), // Near +X edge (radius 22)
        velocity: vec3(9.0, 0, 0), // Moving outward toward edge
      });
      const centerTarget = createDummyBall({
        id: 'player-0',
        position: vec3(0, 1, 0),
      });

      const cmd = botController.computeBotInput(
        endangeredBot,
        [endangeredBot, centerTarget],
        arena,
        1 / 60
      );

      // Must steer strongly inward (-X) to survive and trigger emergency boost
      expect(cmd.moveX).toBeLessThan(-0.7);
      expect(cmd.boostPressed).toBe(true);
    });

    it('Hard bot prioritizes vulnerable edge targets and triggers boost in strike range', () => {
      const botController = new BotController();
      const arena = new ArenaSystem(22, 12.5).getState();

      const hardBot = createDummyBall({
        id: 'bot-1',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(10, 1, 0),
        velocity: vec3(4, 0, 0),
      });
      const vulnerableTarget = createDummyBall({
        id: 'player-0',
        position: vec3(15, 1, 0), // 5 units ahead toward the +X edge
        velocity: vec3(0, 0, 0),
      });

      const cmd = botController.computeBotInput(
        hardBot,
        [hardBot, vulnerableTarget],
        arena,
        1 / 60
      );

      expect(cmd.moveX).toBeGreaterThan(0.8);
      expect(cmd.boostPressed).toBe(true);
    });
  });

  describe('6. Full Headless GameSimulation Integration (Respawns & Match Completion)', () => {
    it('runs a full match lifecycle, respawns fallen balls, and ends cleanly at duration', () => {
      const sim = new GameSimulation();
      sim.startMatch({
        botCount: 3,
        difficulty: 'normal',
        matchDuration: 5.0, // Short 5s match for integration test
        isDemoMode: false,
      });

      expect(sim.getPhase()).toBe('playing');
      expect(sim.getEntities().length).toBe(4);

      // Step 60 frames (1.0s) with player moving forward and boosting
      sim.setPlayerInput({
        entityId: PLAYER_ENTITY_ID,
        moveX: 0,
        moveZ: -1,
        boostPressed: true,
      });

      for (let i = 0; i < 60; i++) {
        sim.stepFixed(1 / 60);
      }

      const player = sim.getEntity(PLAYER_ENTITY_ID)!;
      expect(player.position.z).toBeLessThan(8.0); // Moved inward from initial spawn

      // Advance remaining 4.1 seconds to complete the 5.0s match
      for (let i = 0; i < 250; i++) {
        sim.stepFixed(1 / 60);
      }

      expect(sim.getPhase()).toBe('results');
      const events = sim.drainEvents();
      const matchEndEvent = events.find((e) => e.type === 'match_end');
      expect(matchEndEvent).toBeDefined();
      expect(sim.getRankings().length).toBe(4);

      sim.dispose();
    });

    it('awards knockout score when a ball is knocked off the arena and respawns the eliminated ball with protection', () => {
      const sim = new GameSimulation();
      sim.startMatch({
        botCount: 3,
        difficulty: 'normal',
        matchDuration: 60.0,
        isDemoMode: false,
      });

      const player = sim.getEntity(PLAYER_ENTITY_ID)!;
      const bot = sim.getEntity('bot-1')!;

      // Simulate a recent hit by player on bot-1 right at the edge, then bot falling below threshold
      bot.lastHit = {
        attackerId: player.id,
        attackerName: player.name,
        timestamp: 0.1,
        impactSpeed: 18,
        impulseMagnitude: 22,
      };
      // Step once so elapsedTime > 0
      sim.stepFixed(1 / 60);

      // Force bot ring-out via ScoringSystem & verify GameSimulation respawn loop
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sim as any).eliminateEntity(bot);

      expect(bot.isAlive).toBe(false);
      expect(player.score).toBe(1);
      expect(player.knockouts).toBe(1);
      expect(bot.falls).toBe(1);

      const koEvents = sim.drainEvents();
      expect(koEvents.some((e) => e.type === 'knockout' && e.attackerId === player.id)).toBe(true);

      // Advance simulation past RESPAWN_DELAY_SECONDS (1.8s -> 115 steps)
      for (let i = 0; i < 115; i++) {
        sim.stepFixed(1 / 60);
      }

      expect(bot.isAlive).toBe(true);
      expect(bot.spawnProtectionTimer).toBeGreaterThan(1.5);
      const respawnEvents = sim.drainEvents();
      expect(respawnEvents.some((e) => e.type === 'respawn' && e.entityId === bot.id)).toBe(true);

      sim.dispose();
    });
  });
});
