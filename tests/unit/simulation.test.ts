import { beforeAll, describe, expect, it } from 'vitest';
import { BotController } from '../../src/ai/BotController';
import {
  ARENA_IDS,
  getArenaDefinition,
  resolveMapSelection,
} from '../../src/config/arenas';
import {
  ARENA_CONSTANTS,
  BOOST_TUNING,
  COMBAT_TUNING,
  PHYSICS_CONSTANTS,
} from '../../src/config/constants';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { ArenaSystem } from '../../src/simulation/ArenaSystem';
import { CollisionSystem } from '../../src/simulation/CollisionSystem';
import { GameSimulation, PLAYER_ENTITY_ID } from '../../src/simulation/GameSimulation';
import { MovementController } from '../../src/simulation/MovementController';
import { ScoringSystem } from '../../src/simulation/ScoringSystem';
import type { ArenaId, BallEntityState } from '../../src/types/game';
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
    knockbackTimer: 0,
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

  describe('1. Player Movement, Boost & Post-Hit Knockback Momentum', () => {
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
      expect(speedAfterAccel).toBeGreaterThan(8.5);
      expect(speedAfterAccel).toBeLessThanOrEqual(PHYSICS_CONSTANTS.MAX_MOVE_SPEED + 0.01);

      // Release input and verify controlled deceleration stops the ball without sliding forever
      for (let i = 0; i < 65; i++) {
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

    it('preserves post-hit knockback momentum against instant reverse braking while allowing limited defensive steering (DI)', () => {
      const dt = 1 / 60;

      // Defender launched outward at +18 u/s along +X with active knockbackTimer
      const defenderBraking = createDummyBall({
        velocity: vec3(18, 0, 0),
        knockbackTimer: 0.45,
      });

      // Defender holds full reverse input (-X) plus perpendicular DI (+Z) for 15 frames (0.25s)
      let distanceTraveledX = 0;
      for (let i = 0; i < 15; i++) {
        const res = MovementController.stepMovement(
          defenderBraking,
          { entityId: defenderBraking.id, moveX: -1, moveZ: 1, boostPressed: false },
          dt,
          true
        );
        defenderBraking.velocity = res.newVelocity;
        distanceTraveledX += defenderBraking.velocity.x * dt;
      }

      // Even while holding full reverse brake, the hit must still carry the ball > 3.0m outward
      // and retain significant forward knockback speed after 0.25s, while allowing some lateral DI (+Z)
      expect(distanceTraveledX).toBeGreaterThan(3.0);
      expect(defenderBraking.velocity.x).toBeGreaterThan(8.5);
      expect(defenderBraking.velocity.z).toBeGreaterThan(0.8);
    });

    it('updates ball visual rolling rotation proportionally to ground displacement', () => {
      const ball = createDummyBall({
        prevPosition: vec3(0, 1, 0),
        position: vec3(1.5, 1, 0),
      });
      MovementController.updateRollingRotation(ball);
      expect(ball.rotation.w).toBeLessThan(1.0);
      expect(
        Math.hypot(ball.rotation.x, ball.rotation.y, ball.rotation.z, ball.rotation.w)
      ).toBeCloseTo(1.0, 5);
    });
  });

  describe('2. Five-Tier Collision System, Perfect Impact & High-Speed Stability', () => {
    it('clearly differentiates glancing, normal, heavy, boost, and perfect_boost collision tiers', () => {
      const collisionSystem = new CollisionSystem();

      // 1. Glancing / low-speed touch
      const glancingA = createDummyBall({
        id: 'g-a',
        position: vec3(-1, 1, 0),
        velocity: vec3(1.5, 0, 0),
      });
      const glancingB = createDummyBall({
        id: 'g-b',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const glancingRes = collisionSystem.resolveBallCollision(glancingA, glancingB, 1.0);

      // 2. Normal moving collision
      const normalA = createDummyBall({
        id: 'n-a',
        position: vec3(-1, 1, 0),
        velocity: vec3(8.5, 0, 0),
      });
      const normalB = createDummyBall({
        id: 'n-b',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const normalRes = collisionSystem.resolveBallCollision(normalA, normalB, 2.0);

      // 3. Heavy high-speed unboosted charge
      const heavyA = createDummyBall({
        id: 'h-a',
        position: vec3(-1, 1, 0),
        velocity: vec3(13.2, 0, 0),
      });
      const heavyB = createDummyBall({
        id: 'h-b',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const heavyRes = collisionSystem.resolveBallCollision(heavyA, heavyB, 3.0);

      // 4. Standard Boost impact (late in boost window)
      const boostA = createDummyBall({
        id: 'b-a',
        position: vec3(-1, 1, 0),
        velocity: vec3(19.5, 0, 0),
        boostActiveTimer: 0.08, // Outside Perfect Impact window, still boosting
      });
      const boostB = createDummyBall({
        id: 'b-b',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const boostRes = collisionSystem.resolveBallCollision(boostA, boostB, 4.0);

      // 5. Perfect Impact Boost (early surge window of boost)
      const perfectA = createDummyBall({
        id: 'p-a',
        position: vec3(-1, 1, 0),
        velocity: vec3(23.5, 0, 0),
        boostActiveTimer:
          BOOST_TUNING.BOOST_DURATION - BOOST_TUNING.PERFECT_IMPACT_WINDOW_SECONDS * 0.4,
      });
      const perfectB = createDummyBall({
        id: 'p-b',
        position: vec3(1, 1, 0),
        velocity: vec3(0, 0, 0),
      });
      const perfectRes = collisionSystem.resolveBallCollision(perfectA, perfectB, 5.0);

      expect(glancingRes.event?.impactTier).toBe('glancing');
      expect(normalRes.event?.impactTier).toBe('normal');
      expect(heavyRes.event?.impactTier).toBe('heavy');
      expect(boostRes.event?.impactTier).toBe('boost');
      expect(perfectRes.event?.impactTier).toBe('perfect_boost');
      expect(perfectRes.event?.isPerfectImpact).toBe(true);

      // Verify monotonic increase in defender knockback velocity across all 5 tiers
      expect(normalRes.velocityB.x).toBeGreaterThan(glancingRes.velocityB.x * 2.2);
      expect(heavyRes.velocityB.x).toBeGreaterThan(normalRes.velocityB.x * 1.25);
      expect(boostRes.velocityB.x).toBeGreaterThan(heavyRes.velocityB.x * 1.2);
      expect(perfectRes.velocityB.x).toBeGreaterThan(boostRes.velocityB.x * 1.12);

      // Verify attacker retains forward follow-through momentum on a clean strike instead of bouncing backward
      expect(normalRes.velocityA.x).toBeGreaterThan(1.5);
      expect(perfectRes.velocityA.x).toBeGreaterThan(6.0);
    });

    it('grants side and rear positional bonuses, prevents duplicate pair callbacks, and clamps extreme velocities safely', () => {
      const rearBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(8, 0, 0));
      const sideBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(0, 0, 8));
      const headOnBonus = CollisionSystem.computeAngleMultiplier(vec3(1, 0, 0), vec3(-8, 0, 0));

      expect(rearBonus).toBeGreaterThan(sideBonus);
      expect(sideBonus).toBeGreaterThan(headOnBonus);

      const collisionSystem = new CollisionSystem();
      const ballA = createDummyBall({
        id: 'a',
        position: vec3(0, 1, 0),
        velocity: vec3(30, 0, 0),
        boostActiveTimer: 0.4,
      });
      const ballB = createDummyBall({
        id: 'b',
        position: vec3(2, 1, 0),
        velocity: vec3(-30, 0, 0),
        boostActiveTimer: 0.4,
      });

      const first = collisionSystem.resolveBallCollision(ballA, ballB, 2.0);
      const duplicateImmediate = collisionSystem.resolveBallCollision(ballA, ballB, 2.05);
      const afterCooldown = collisionSystem.resolveBallCollision(ballA, ballB, 2.5);

      expect(first.applied).toBe(true);
      expect(duplicateImmediate.applied).toBe(false);
      expect(afterCooldown.applied).toBe(true);

      // Resultant horizontal speeds must never exceed MAX_RESULTANT_HORIZONTAL_SPEED or produce NaN
      expect(lengthXZ(first.velocityA)).toBeLessThanOrEqual(
        COMBAT_TUNING.MAX_RESULTANT_HORIZONTAL_SPEED + 0.01
      );
      expect(lengthXZ(first.velocityB)).toBeLessThanOrEqual(
        COMBAT_TUNING.MAX_RESULTANT_HORIZONTAL_SPEED + 0.01
      );
      expect(Number.isFinite(first.velocityB.x)).toBe(true);
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
    it('shrinks smoothly from BASE_RADIUS (19.5) to MIN_RADIUS (11.0) during the final 30 seconds', () => {
      const arena = new ArenaSystem();

      expect(arena.update(60)).toBe(false);
      expect(arena.getState().isShrinking).toBe(false);
      expect(arena.getState().currentRadius).toBeCloseTo(ARENA_CONSTANTS.BASE_RADIUS, 3);

      // Crossing into 30s triggers shrink_start
      expect(arena.update(30)).toBe(true);
      expect(arena.getState().isShrinking).toBe(true);

      // Halfway through final 30s (15s remaining)
      arena.update(15);
      expect(arena.getState().shrinkProgress).toBeCloseTo(0.5, 3);
      expect(arena.getState().currentRadius).toBeCloseTo(
        (ARENA_CONSTANTS.BASE_RADIUS + ARENA_CONSTANTS.MIN_RADIUS) / 2,
        2
      );

      // At 0s remaining, reaches minimum radius
      arena.update(0);
      expect(arena.getState().currentRadius).toBeCloseTo(ARENA_CONSTANTS.MIN_RADIUS, 3);

      const opponent = createDummyBall({ position: vec3(4, 1, 0) });
      const respawnPos = arena.findSafeRespawnPosition([opponent], 1);
      expect(lengthXZ(respawnPos)).toBeLessThan(arena.getState().currentRadius * 0.65);
    });
  });

  describe('5. AI Bot Decision Rules, Anti-Clustering & Momentum Run-Ups', () => {
    it('steers back toward center and uses emergency boost when dangerously close to the arena edge', () => {
      const botController = new BotController();
      const arena = new ArenaSystem().getState();

      const endangeredBot = createDummyBall({
        id: 'bot-1',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(arena.currentRadius * 0.91, 1, 0), // Near +X edge
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
      const arena = new ArenaSystem().getState();

      const hardBot = createDummyBall({
        id: 'bot-1',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(9.5, 1, 0),
        velocity: vec3(6.5, 0, 0),
      });
      const vulnerableTarget = createDummyBall({
        id: 'player-0',
        position: vec3(14.5, 1, 0), // 5 units ahead toward the +X edge
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

    it('distributes multiple bots across available targets instead of dogpiling a single target', () => {
      const botController = new BotController();
      const arena = new ArenaSystem().getState();

      const targetA = createDummyBall({
        id: 'target-a',
        position: vec3(11, 1, 0),
      });
      const targetB = createDummyBall({
        id: 'target-b',
        position: vec3(-11, 1, 0),
      });

      const bots = [1, 2, 3, 4].map((idx) =>
        createDummyBall({
          id: `bot-${idx}`,
          isPlayer: false,
          difficulty: 'hard',
          slotIndex: idx,
          position: vec3((idx % 2 === 0 ? -1 : 1) * 4, 1, idx * 1.5 - 3),
          velocity: vec3(5, 0, 0),
        })
      );

      const allEntities = [targetA, targetB, ...bots];
      for (const b of bots) {
        botController.computeBotInput(b, allEntities, arena, 0.25);
      }

      // Verify that bots did not all lock onto the exact same target
      const steersRight = bots.filter(
        (b) => botController.computeBotInput(b, allEntities, arena, 1 / 60).moveX > 0
      ).length;
      const steersLeft = bots.filter(
        (b) => botController.computeBotInput(b, allEntities, arena, 1 / 60).moveX < 0
      ).length;

      expect(steersRight).toBeGreaterThanOrEqual(1);
      expect(steersLeft).toBeGreaterThanOrEqual(1);
    });
  });

  describe('6. Full Headless GameSimulation Integration & Multi-Seed Match Verification', () => {
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
      expect(player.position.z).toBeLessThan(7.5); // Moved inward from initial spawn

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

      // Simulate a recent hit by player on bot-1 right at the edge
      bot.lastHit = {
        attackerId: player.id,
        attackerName: player.name,
        timestamp: 0.1,
        impactSpeed: 18,
        impulseMagnitude: 22,
      };
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

      // Advance simulation past RESPAWN_DELAY_SECONDS (1.45s -> 95 steps)
      for (let i = 0; i < 95; i++) {
        sim.stepFixed(1 / 60);
      }

      expect(bot.isAlive).toBe(true);
      expect(bot.spawnProtectionTimer).toBeGreaterThan(1.2);
      const respawnEvents = sim.drainEvents();
      expect(respawnEvents.some((e) => e.type === 'respawn' && e.entityId === bot.id)).toBe(true);

      sim.dispose();
    });

    it('produces genuine knockouts regularly across multi-seed 45s combat simulations without physics instability', () => {
      const seeds = [101, 202, 303];
      let totalKnockoutsAcrossSeeds = 0;
      let totalRingOutsAcrossSeeds = 0;
      let totalBoostedCollisions = 0;

      for (const seed of seeds) {
        const sim = new GameSimulation();
        sim.startMatch({
          botCount: 5,
          difficulty: 'hard',
          matchDuration: 45.0,
          isDemoMode: true, // All 6 balls driven by AI so combat runs autonomously
          seed,
        });

        const totalSteps = 45 * 60;
        let seedKnockouts = 0;
        let seedRingOuts = 0;

        for (let step = 0; step < totalSteps; step++) {
          sim.stepFixed(1 / 60);
          const events = sim.drainEvents();
          for (const ev of events) {
            if (ev.type === 'knockout') {
              seedKnockouts++;
              seedRingOuts++;
            } else if (ev.type === 'self_fall') {
              seedRingOuts++;
            } else if (ev.type === 'collision' && ev.isBoostedImpact) {
              totalBoostedCollisions++;
            }
          }

          // Verify no NaN or explosive velocities at any step
          for (const ent of sim.getEntities()) {
            expect(Number.isFinite(ent.position.x)).toBe(true);
            expect(Number.isFinite(ent.position.z)).toBe(true);
            expect(lengthXZ(ent.velocity)).toBeLessThanOrEqual(
              COMBAT_TUNING.MAX_RESULTANT_HORIZONTAL_SPEED + 2.0
            );
          }
        }

        totalKnockoutsAcrossSeeds += seedKnockouts;
        totalRingOutsAcrossSeeds += seedRingOuts;
        sim.dispose();
      }

      // Across 3 seeds of 45s matches (6 balls each), genuine knockouts and boosted hits must occur regularly
      expect(totalBoostedCollisions).toBeGreaterThanOrEqual(8);
      expect(totalKnockoutsAcrossSeeds).toBeGreaterThanOrEqual(4);
      expect(totalRingOutsAcrossSeeds).toBeGreaterThanOrEqual(6);
    });
  });

  describe('7. Multi-Arena System: Crater, Donut & Bumper Arenas, Physical Holes & AI Navigation', () => {
    it('configures Classic, Crater, Donut, Bumper, and Random arenas accurately', () => {
      const classicDef = getArenaDefinition('classic');
      const craterDef = getArenaDefinition('crater');
      const donutDef = getArenaDefinition('donut');
      const bumperDef = getArenaDefinition('bumper');

      expect(classicDef.holes.length).toBe(0);
      expect(classicDef.bumpers.length).toBe(0);
      expect(craterDef.baseRadius).toBeCloseTo(25.5, 2);
      expect(craterDef.holes.length).toBe(3);
      expect(donutDef.baseRadius).toBeCloseTo(23.0, 2);
      expect(donutDef.innerHoleRadius).toBeCloseTo(7.2, 2);
      expect(donutDef.holes.length).toBe(1);
      expect(bumperDef.baseRadius).toBeCloseTo(22.5, 2);
      expect(bumperDef.bumpers.length).toBe(4);

      // Verify deterministic random map resolution across seeds
      const resolvedMaps = new Set<ArenaId>();
      for (let seed = 0; seed < 8; seed++) {
        const picked = resolveMapSelection('random', seed);
        expect(ARENA_IDS).toContain(picked);
        resolvedMaps.add(picked);
      }
      expect(resolvedMaps.size).toBe(4);
    });

    it('guarantees safe initial spawns and dynamic respawns outside holes and bumpers on all 4 arenas', () => {
      for (const arenaId of ARENA_IDS) {
        const arena = new ArenaSystem(arenaId);
        const spawns = arena.getInitialSpawnPositions(8);
        expect(spawns.length).toBe(8);

        for (const pos of spawns) {
          expect(arena.isPositionSafeOnDeck(pos, 1.4)).toBe(true);
          expect(arena.getOverlappingHole(pos, PHYSICS_CONSTANTS.BALL_RADIUS)).toBeNull();
        }

        // Also test respawns when the arena is fully shrunk at t=0s remaining
        arena.update(0);
        const activeOpponents = spawns.slice(0, 5).map((p, idx) =>
          createDummyBall({
            id: `opp-${idx}`,
            position: p,
          })
        );

        for (let slot = 0; slot < 20; slot++) {
          const respawnPos = arena.findSafeRespawnPosition(activeOpponents, slot);
          expect(arena.isPositionSafeOnDeck(respawnPos, 1.1)).toBe(true);
          expect(arena.getOverlappingHole(respawnPos, PHYSICS_CONSTANTS.BALL_RADIUS)).toBeNull();
        }
      }
    });

    it('physically drops balls through Crater Arena holes and Donut Arena central hole while supporting solid deck', () => {
      // 1. Crater Arena physical trimesh hole verification
      const craterArena = new ArenaSystem('crater');
      const craterState = craterArena.getState();
      const craterPhysics = new PhysicsWorld(craterState.baseRadius);
      craterPhysics.configureArenaGeometry(
        craterState.baseRadius,
        craterState.holes,
        craterState.bumpers
      );

      const hole0 = craterState.holes[0];
      craterPhysics.addBallBody('on-deck', vec3(0, 1.0, 0), PHYSICS_CONSTANTS.BALL_RADIUS, 1.0);
      craterPhysics.addBallBody(
        'over-crater',
        vec3(hole0.x, 1.0, hole0.z),
        PHYSICS_CONSTANTS.BALL_RADIUS,
        1.0
      );

      for (let i = 0; i < 65; i++) {
        craterPhysics.step(['on-deck', 'over-crater'], PHYSICS_CONSTANTS.BALL_RADIUS);
      }

      const deckBallPos = craterPhysics.getBallPosition('on-deck');
      const fallenCraterPos = craterPhysics.getBallPosition('over-crater');

      expect(deckBallPos.y).toBeGreaterThan(0.85);
      expect(fallenCraterPos.y).toBeLessThanOrEqual(ARENA_CONSTANTS.FALL_THRESHOLD_Y);
      const craterBounds = craterArena.checkOutOfBounds(fallenCraterPos);
      expect(craterBounds.out).toBe(true);
      expect(craterBounds.viaHole).toBe(true);
      craterPhysics.dispose();

      // 2. Donut Arena physical annulus trimesh verification
      const donutArena = new ArenaSystem('donut');
      const donutState = donutArena.getState();
      const donutPhysics = new PhysicsWorld(donutState.baseRadius);
      donutPhysics.configureArenaGeometry(
        donutState.baseRadius,
        donutState.holes,
        donutState.bumpers
      );

      donutPhysics.addBallBody('on-ring', vec3(14.0, 1.0, 0), PHYSICS_CONSTANTS.BALL_RADIUS, 1.0);
      donutPhysics.addBallBody('in-core', vec3(0, 1.0, 0), PHYSICS_CONSTANTS.BALL_RADIUS, 1.0);

      for (let i = 0; i < 65; i++) {
        donutPhysics.step(['on-ring', 'in-core'], PHYSICS_CONSTANTS.BALL_RADIUS);
      }

      const ringBallPos = donutPhysics.getBallPosition('on-ring');
      const coreBallPos = donutPhysics.getBallPosition('in-core');

      expect(ringBallPos.y).toBeGreaterThan(0.85);
      expect(coreBallPos.y).toBeLessThanOrEqual(ARENA_CONSTANTS.FALL_THRESHOLD_Y);
      const donutBounds = donutArena.checkOutOfBounds(coreBallPos);
      expect(donutBounds.out).toBe(true);
      expect(donutBounds.viaHole).toBe(true);
      donutPhysics.dispose();
    });

    it('attributes hole knockouts with viaHole=true and awards +1 score when pushed into an internal hole', () => {
      const sim = new GameSimulation();
      sim.startMatch({
        botCount: 3,
        difficulty: 'normal',
        arenaId: 'donut',
        matchDuration: 60.0,
        isDemoMode: false,
      });

      const player = sim.getEntity(PLAYER_ENTITY_ID)!;
      const bot = sim.getEntity('bot-1')!;

      // Credit player with hitting bot-1 toward the central Donut hole
      bot.lastHit = {
        attackerId: player.id,
        attackerName: player.name,
        timestamp: 0.05,
        impactSpeed: 19,
        impulseMagnitude: 24,
      };
      sim.stepFixed(1 / 60);

      // Eliminate bot-1 via hole (`viaHole = true`) and verify knockout attribution & score
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sim as any).eliminateEntity(bot, true);

      const events = sim.drainEvents();
      const holeKoEvent = events.find(
        (ev) => ev.type === 'knockout' && ev.victimId === bot.id && ev.viaHole === true
      );

      expect(holeKoEvent).toBeDefined();
      expect(player.score).toBe(1);
      expect(player.knockouts).toBe(1);
      sim.dispose();
    });

    it('delivers bounded radial rebounds off Bumper Arena pillars while preserving lastHit for bank-shot knockouts', () => {
      const collisionSystem = new CollisionSystem();
      const bumperDef = getArenaDefinition('bumper').bumpers[0]; // (5.515, 5.515)

      const victim = createDummyBall({
        id: 'bot-1',
        name: 'NOVA',
        position: vec3(bumperDef.x + bumperDef.radius + 0.9, 1.0, bumperDef.z),
        velocity: vec3(-12.0, 0, 0), // Moving into the bumper
        lastHit: {
          attackerId: PLAYER_ENTITY_ID,
          attackerName: 'YOU',
          timestamp: 5.0,
          impactSpeed: 16,
          impulseMagnitude: 20,
        },
      });

      const rebound = collisionSystem.resolveBumperCollision(victim, bumperDef, 5.4);
      expect(rebound.applied).toBe(true);
      expect(rebound.event?.type).toBe('bumper_hit');
      expect(rebound.velocity.x).toBeGreaterThan(12.0); // Bounced strongly outward (+X)
      expect(lengthXZ(rebound.velocity)).toBeLessThanOrEqual(
        COMBAT_TUNING.MAX_RESULTANT_HORIZONTAL_SPEED
      );
      // Bank-shot attribution: victim.lastHit must remain intact!
      expect(victim.lastHit?.attackerId).toBe(PLAYER_ENTITY_ID);
    });

    it('AI navigates tangentially around the Donut central hole and recovers outward when near an internal hole rim', () => {
      const botController = new BotController();
      const donutArena = new ArenaSystem('donut').getState();

      // 1. Bot at (-13.5, 0) targeting opponent across the central hole at (+13.5, 0)
      const ringBot = createDummyBall({
        id: 'bot-ring',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(-13.5, 1, 0.4),
        velocity: vec3(5.0, 0, 0),
      });
      const oppositeTarget = createDummyBall({
        id: 'player-0',
        position: vec3(13.5, 1, 0),
      });

      const navCmd = botController.computeBotInput(
        ringBot,
        [ringBot, oppositeTarget],
        donutArena,
        1 / 60
      );

      // Instead of driving straight along +X into the (0,0) hole (moveZ ~ 0),
      // the bot must deflect tangentially around the ring (|moveZ| > 0.35) and NOT boost into the hole
      expect(Math.abs(navCmd.moveZ)).toBeGreaterThan(0.35);
      expect(navCmd.boostPressed).toBe(false);

      // 2. Bot dangerously close to the inner Donut hole rim (r = 7.9, hole radius = 7.2) moving inward
      const endangeredHoleBot = createDummyBall({
        id: 'bot-hole-danger',
        isPlayer: false,
        difficulty: 'hard',
        position: vec3(-7.9, 1, 0),
        velocity: vec3(8.5, 0, 0), // Moving toward (0,0) hole!
      });

      const recoveryCmd = botController.computeBotInput(
        endangeredHoleBot,
        [endangeredHoleBot, oppositeTarget],
        donutArena,
        1 / 60
      );

      // Must steer outward away from the central hole (-X) and trigger emergency boost!
      expect(recoveryCmd.moveX).toBeLessThan(-0.7);
      expect(recoveryCmd.boostPressed).toBe(true);
    });

    it('runs stable multi-bot matches across Crater, Donut, and Bumper arenas with hole knockouts and bumper hits', () => {
      const arenasToTest: ArenaId[] = ['crater', 'donut', 'bumper'];
      let holeEliminations = 0;
      let bumperHitsCount = 0;
      let totalKos = 0;

      for (const arenaId of arenasToTest) {
        const sim = new GameSimulation();
        sim.startMatch({
          botCount: 5,
          difficulty: 'hard',
          arenaId,
          matchDuration: 35.0,
          isDemoMode: true,
          seed: 707,
        });

        const steps = 35 * 60;
        for (let step = 0; step < steps; step++) {
          sim.stepFixed(1 / 60);
          for (const ev of sim.drainEvents()) {
            if (ev.type === 'knockout') {
              totalKos++;
              if (ev.viaHole) holeEliminations++;
            } else if (ev.type === 'self_fall' && ev.viaHole) {
              holeEliminations++;
            } else if (ev.type === 'bumper_hit') {
              bumperHitsCount++;
            }
          }

          for (const ent of sim.getEntities()) {
            expect(Number.isFinite(ent.position.x)).toBe(true);
            expect(Number.isFinite(ent.position.y)).toBe(true);
            expect(Number.isFinite(ent.position.z)).toBe(true);
          }
        }
        sim.dispose();
      }

      expect(totalKos).toBeGreaterThanOrEqual(2);
      expect(holeEliminations).toBeGreaterThanOrEqual(1);
      expect(bumperHitsCount).toBeGreaterThanOrEqual(3);
    });
  });
});
