import type { BotDifficulty, GameSettings, GraphicsQuality, PlayerStats } from '../types/game';

export const PHYSICS_CONSTANTS = {
  FIXED_TIMESTEP: 1 / 60,
  MAX_SUBSTEPS: 5,
  GRAVITY_Y: -28.0,

  // Ball physical properties
  BALL_RADIUS: 1.05,
  BALL_MASS: 2.0,
  BALL_RESTITUTION: 0.45,
  BALL_FRICTION: 0.65,
  LINEAR_DAMPING: 1.45,
  ANGULAR_DAMPING: 2.2,

  // Rolling movement tuning
  MOVE_ACCELERATION: 38.0,
  TURN_GRIP_FACTOR: 7.5, // Helps counter lateral drift when steering sharply
  BRAKE_DECELERATION: 22.0, // Controlled deceleration when no input is given
  MAX_MOVE_SPEED: 15.5,
  MAX_BOOST_SPEED: 26.5,

  // Boost tuning (0.38s active burst, 3.4s cooldown)
  BOOST_DURATION: 0.38,
  BOOST_COOLDOWN: 3.4,
  BOOST_INITIAL_IMPULSE: 14.5,
  BOOST_SUSTAIN_ACCELERATION: 52.0,

  // Combat & Knockback tuning
  COLLISION_PAIR_COOLDOWN: 0.16, // Seconds before the same pair can trigger another combat impulse
  BASE_KNOCKBACK_IMPULSE: 6.5,
  VELOCITY_KNOCKBACK_SCALE: 0.68,
  BOOST_ATTACK_MULTIPLIER: 1.55,
  BOOST_DEFENSE_RESISTANCE: 0.78,
  SIDE_HIT_BONUS_MULTIPLIER: 1.18,
  REAR_HIT_BONUS_MULTIPLIER: 1.32,
  MAX_KNOCKBACK_IMPULSE: 32.0,
  VERTICAL_POP_IMPULSE: 1.6, // Subtle pop for impact feel, clamped to avoid launches
  MAX_UPWARD_VELOCITY: 5.5,
} as const;

export const ARENA_CONSTANTS = {
  BASE_RADIUS: 22.0,
  MIN_RADIUS: 12.5,
  DECK_THICKNESS: 1.6,
  FALL_THRESHOLD_Y: -4.2,
  OUTER_RING_OUT_MARGIN: 1.35, // Distance past currentRadius when airborne/sliding off edge
  SHRINK_START_REMAINING_SECONDS: 30.0,
  MATCH_DURATION_SECONDS: 120.0,
  RESPAWN_DELAY_SECONDS: 1.8,
  SPAWN_PROTECTION_SECONDS: 2.2,
  KNOCKOUT_ATTRIBUTION_WINDOW_SECONDS: 4.5,
} as const;

export interface BotDifficultyProfile {
  reactionInterval: number; // Seconds between AI target/tactical re-evaluations
  aimNoiseRadians: number;
  edgeDangerThresholdRatio: number; // Ratio of currentRadius where bot starts edge avoidance
  edgeCriticalRatio: number; // Ratio where bot uses emergency boost to survive
  velocityLookaheadSeconds: number;
  boostStrikeRange: number;
  boostAlignmentDotThreshold: number;
  flankPreference: number; // 0 = direct charge, 1 = line up radial push toward edge
  speedMultiplier: number; // Always 1.0 so Hard bots never get unfair physics advantages!
}

export const BOT_DIFFICULTY_PROFILES: Record<BotDifficulty, BotDifficultyProfile> = {
  normal: {
    reactionInterval: 0.16,
    aimNoiseRadians: 0.22,
    edgeDangerThresholdRatio: 0.76,
    edgeCriticalRatio: 0.88,
    velocityLookaheadSeconds: 0.35,
    boostStrikeRange: 7.5,
    boostAlignmentDotThreshold: 0.82,
    flankPreference: 0.35,
    speedMultiplier: 1.0,
  },
  hard: {
    reactionInterval: 0.05,
    aimNoiseRadians: 0.04,
    edgeDangerThresholdRatio: 0.7,
    edgeCriticalRatio: 0.83,
    velocityLookaheadSeconds: 0.58,
    boostStrikeRange: 9.5,
    boostAlignmentDotThreshold: 0.74,
    flankPreference: 0.85,
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
    maxParticles: 90,
    backgroundDetail: 'medium',
  },
  high: {
    pixelRatioCap: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    sphereSegments: 44,
    maxParticles: 160,
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
