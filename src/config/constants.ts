import type { BotDifficulty, GameSettings, GraphicsQuality, PlayerStats } from '../types/game';

/**
 * Centralized Gameplay Tuning Architecture
 * Groups all movement, boost, combat/knockback, arena, and AI balance parameters
 * so gameplay feel can be tuned in one place without scattered magic numbers.
 */
export const MOVEMENT_TUNING = {
  FIXED_TIMESTEP: 1 / 60,
  MAX_SUBSTEPS: 5,
  GRAVITY_Y: -30.0,

  BALL_RADIUS: 1.05,
  BALL_MASS: 2.0,
  BALL_RESTITUTION: 0.5,
  BALL_FRICTION: 0.6,
  LINEAR_DAMPING: 0.12,
  ANGULAR_DAMPING: 2.2,

  MOVE_ACCELERATION: 42.0,
  TURN_GRIP_FACTOR: 7.2, // Counters lateral drift during normal steering
  BRAKE_DECELERATION: 21.0, // Controlled deceleration when input is released
  MAX_MOVE_SPEED: 16.5,

  // Post-hit knockback momentum preservation & recovery tuning
  KNOCKBACK_EXCESS_DECAY_ACTIVE: 1.65, // Low speed bleed while knockbackTimer > 0 so hits travel across the arena
  KNOCKBACK_EXCESS_DECAY_NORMAL: 3.4, // Normal post-boost speed bleed back to MAX_MOVE_SPEED
  POST_HIT_MIN_TRACTION: 0.24, // Minimum steering/braking authority right after a heavy hit (recovers smoothly to 1.0)
  POST_HIT_DI_STEER_FACTOR: 0.58, // Perpendicular directional-influence steering allowed during knockback
} as const;

export const BOOST_TUNING = {
  BOOST_DURATION: 0.42, // Active boost thruster duration (seconds)
  BOOST_COOLDOWN: 3.0, // Cooldown between boosts (seconds)
  BOOST_INITIAL_IMPULSE: 16.5, // Immediate velocity burst added in boost direction
  BOOST_SUSTAIN_ACCELERATION: 56.0, // Sustained acceleration while boostActiveTimer > 0
  MAX_BOOST_SPEED: 29.0, // Maximum horizontal speed while boosting
  PERFECT_IMPACT_WINDOW_SECONDS: 0.24, // First 0.24s of boost grants a Perfect Impact bonus on direct collision
} as const;

export const COMBAT_TUNING = {
  COLLISION_PAIR_COOLDOWN: 0.14, // Seconds before the same pair can trigger another combat resolution
  GLANCING_SPEED_THRESHOLD: 3.6, // Below this closing speed, collisions are light glancing separations
  HEAVY_HIT_SPEED_THRESHOLD: 11.8, // Approach speed threshold for heavy non-boosted impacts

  BASE_KNOCKBACK_IMPULSE: 6.2,
  VELOCITY_KNOCKBACK_SCALE: 0.48, // Scales attacker's approach speed into knockback impulse
  CLOSING_SPEED_SHARE: 0.3, // Additional contribution from mutual closing speed

  BOOST_ATTACK_MULTIPLIER: 1.28, // Multiplier when attacker is boosting
  PERFECT_BOOST_MULTIPLIER: 1.48, // Multiplier when attacker lands a timed Perfect Boost Impact
  BOOST_DEFENSE_RESISTANCE: 0.78, // Knockback reduction when defender is actively boosting

  SIDE_HIT_BONUS_MULTIPLIER: 1.18, // Positional bonus for perpendicular flank hits
  REAR_HIT_BONUS_MULTIPLIER: 1.32, // Positional bonus for rear pursuit hits
  STATIONARY_TARGET_MULTIPLIER: 1.08, // Bonus against stationary/stalled targets

  ATTACKER_FOLLOWTHROUGH_RETENTION: 0.52, // Dominant attacker retains forward velocity after winning impact
  DOMINANT_ATTACKER_RECOIL_SCALE: 0.24, // Reduced backward recoil for the winner of a collision

  MIN_KNOCKBACK_IMPULSE: 3.2,
  MAX_KNOCKBACK_IMPULSE: 34.5,
  MAX_RESULTANT_HORIZONTAL_SPEED: 36.0,

  // Post-hit recovery timer durations (seconds)
  GLANCING_KNOCKBACK_DURATION: 0.08,
  NORMAL_KNOCKBACK_DURATION: 0.28,
  HEAVY_KNOCKBACK_DURATION: 0.36,
  BOOST_KNOCKBACK_DURATION: 0.46,
  PERFECT_BOOST_KNOCKBACK_DURATION: 0.54,

  // Grounded vertical response (prevents unrealistic sky launches)
  VERTICAL_POP_IMPULSE: 0.85,
  MAX_UPWARD_VELOCITY: 3.2,
} as const;

export const ARENA_TUNING = {
  BASE_RADIUS: 19.5, // Sized so 2-4 solid hits or a well-timed boost near the outer zone creates a knockout
  MIN_RADIUS: 11.0, // Final radius at end of 30s shrink phase
  DECK_THICKNESS: 1.6,
  FALL_THRESHOLD_Y: -3.8,
  OUTER_RING_OUT_MARGIN: 1.2,
  SHRINK_START_REMAINING_SECONDS: 30.0,
  MATCH_DURATION_SECONDS: 120.0,
  RESPAWN_DELAY_SECONDS: 1.5, // Brisk respawn for fast re-engagement
  SPAWN_PROTECTION_SECONDS: 1.8, // Protects newly spawned balls without stalling combat
  KNOCKOUT_ATTRIBUTION_WINDOW_SECONDS: 5.0,
} as const;

// Backwards-compatible combined exports
export const PHYSICS_CONSTANTS = {
  ...MOVEMENT_TUNING,
  ...BOOST_TUNING,
  ...COMBAT_TUNING,
} as const;

export const ARENA_CONSTANTS = {
  ...ARENA_TUNING,
} as const;

export interface BotDifficultyProfile {
  reactionInterval: number; // Seconds between AI target/tactical re-evaluations
  aimNoiseRadians: number;
  edgeDangerThresholdRatio: number; // Ratio of currentRadius where bot starts edge avoidance
  edgeCriticalRatio: number; // Ratio where bot uses emergency boost to survive
  offensiveEdgeCommitRatio: number; // Max radius ratio bot is willing to push an endangered target
  velocityLookaheadSeconds: number;
  boostStrikeRange: number;
  boostMinRange: number;
  boostAlignmentDotThreshold: number;
  flankPreference: number; // 0 = direct charge, 1 = line up radial push toward edge
  crowdPenaltyWeight: number; // Penalty per other bot targeting/crowding the same opponent
  targetFrustrationSeconds: number; // Switches target if no solid hit landed within this window
  speedMultiplier: number; // Always 1.0 so Hard bots never get unfair physics advantages!
}

export const BOT_DIFFICULTY_PROFILES: Record<BotDifficulty, BotDifficultyProfile> = {
  normal: {
    reactionInterval: 0.14,
    aimNoiseRadians: 0.16,
    edgeDangerThresholdRatio: 0.8,
    edgeCriticalRatio: 0.89,
    offensiveEdgeCommitRatio: 0.84,
    velocityLookaheadSeconds: 0.38,
    boostStrikeRange: 8.5,
    boostMinRange: 2.2,
    boostAlignmentDotThreshold: 0.8,
    flankPreference: 0.48,
    crowdPenaltyWeight: 6.5,
    targetFrustrationSeconds: 3.6,
    speedMultiplier: 1.0,
  },
  hard: {
    reactionInterval: 0.05,
    aimNoiseRadians: 0.03,
    edgeDangerThresholdRatio: 0.82,
    edgeCriticalRatio: 0.89,
    offensiveEdgeCommitRatio: 0.88,
    velocityLookaheadSeconds: 0.52,
    boostStrikeRange: 10.2,
    boostMinRange: 2.3,
    boostAlignmentDotThreshold: 0.76,
    flankPreference: 0.88,
    crowdPenaltyWeight: 8.5,
    targetFrustrationSeconds: 2.8,
    speedMultiplier: 1.0,
  },
};

export interface BallColorPalette {
  name: string;
  primary: string;
  accent: string;
}

export const PLAYER_PALETTE: BallColorPalette = {
  name: 'YOU',
  primary: '#00F0FF',
  accent: '#0077FF',
};

export const BOT_PALETTES: BallColorPalette[] = [
  { name: 'NOVA', primary: '#FF2E93', accent: '#FF8A00' },
  { name: 'VORTEX', primary: '#FFE600', accent: '#FF6B00' },
  { name: 'BLAZE', primary: '#FF4733', accent: '#FFAA00' },
  { name: 'PULSE', primary: '#9D4EDD', accent: '#00F5D4' },
  { name: 'APEX', primary: '#00F59B', accent: '#00A8FF' },
  { name: 'TITAN', primary: '#FF9F1C', accent: '#E71D36' },
  { name: 'ECHO', primary: '#70E000', accent: '#007200' },
];

export interface GraphicsPreset {
  pixelRatioCap: number;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  sphereSegments: number;
  maxParticles: number;
  backgroundDetail: 'low' | 'medium' | 'high';
}

export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: {
    pixelRatioCap: 1.0,
    shadowsEnabled: false,
    shadowMapSize: 512,
    sphereSegments: 24,
    maxParticles: 40,
    backgroundDetail: 'low',
  },
  medium: {
    pixelRatioCap: 1.5,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    sphereSegments: 32,
    maxParticles: 100,
    backgroundDetail: 'medium',
  },
  high: {
    pixelRatioCap: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    sphereSegments: 44,
    maxParticles: 180,
    backgroundDetail: 'high',
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  soundEnabled: true,
  graphicsQuality: 'high',
  controlSensitivity: 1.0,
  reducedEffects: false,
  difficulty: 'normal',
  botCount: 5,
};

export const DEFAULT_STATS: PlayerStats = {
  bestScore: 0,
  bestKnockouts: 0,
  totalKnockouts: 0,
  totalMatches: 0,
  totalWins: 0,
  normalWins: 0,
  hardWins: 0,
};
