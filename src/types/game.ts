export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type BotDifficulty = 'normal' | 'hard';
export type GraphicsQuality = 'low' | 'medium' | 'high';
export type MatchPhase = 'menu' | 'playing' | 'paused' | 'results';
export type ImpactTier = 'glancing' | 'normal' | 'heavy' | 'boost' | 'perfect_boost';

export interface PlayerInputCommand {
  entityId: string;
  moveX: number; // -1 to 1 (left to right)
  moveZ: number; // -1 to 1 (up/forward to down/backward)
  boostPressed: boolean;
  sequence?: number;
}

export interface LastHitAttribution {
  attackerId: string;
  attackerName: string;
  timestamp: number;
  impactSpeed: number;
  impulseMagnitude: number;
  impactTier?: ImpactTier;
}

export interface BallEntityState {
  id: string;
  name: string;
  isPlayer: boolean;
  difficulty: BotDifficulty;
  colorPrimary: string;
  colorAccent: string;
  slotIndex: number;
  radius: number;
  mass: number;
  position: Vector3Like;
  prevPosition: Vector3Like;
  velocity: Vector3Like;
  rotation: QuaternionLike;
  prevRotation: QuaternionLike;
  squashStretch: Vector3Like;
  isAlive: boolean;
  respawnTimer: number;
  spawnProtectionTimer: number;
  boostActiveTimer: number;
  boostCooldownTimer: number;
  boostDirection: Vector3Like;
  knockbackTimer: number;
  lastHit: LastHitAttribution | null;
  score: number;
  knockouts: number;
  falls: number;
  streak: number;
  bestStreak: number;
  firstKnockoutTime: number | null;
  totalImpactDealt: number;
}

export interface ArenaState {
  baseRadius: number;
  minRadius: number;
  currentRadius: number;
  isShrinking: boolean;
  shrinkProgress: number; // 0 to 1
  fallThresholdY: number;
}

export interface PlayerRankingEntry {
  rank: number;
  entityId: string;
  name: string;
  isPlayer: boolean;
  colorPrimary: string;
  colorAccent: string;
  score: number;
  knockouts: number;
  falls: number;
  bestStreak: number;
  totalImpactDealt: number;
  firstKnockoutTime: number | null;
  slotIndex: number;
}

export type GameEvent =
  | {
      type: 'collision';
      timestamp: number;
      point: Vector3Like;
      normal: Vector3Like;
      knockbackDirection: Vector3Like;
      entityAId: string;
      entityBId: string;
      attackerId: string | null;
      relativeSpeed: number;
      impulse: number;
      impactTier: ImpactTier;
      isBoostedImpact: boolean;
      isPerfectImpact: boolean;
    }
  | {
      type: 'boost';
      timestamp: number;
      entityId: string;
      position: Vector3Like;
      direction: Vector3Like;
    }
  | {
      type: 'knockout';
      timestamp: number;
      attackerId: string;
      attackerName: string;
      victimId: string;
      victimName: string;
      position: Vector3Like;
      isSelfFall: false;
    }
  | {
      type: 'self_fall';
      timestamp: number;
      victimId: string;
      victimName: string;
      position: Vector3Like;
      isSelfFall: true;
    }
  | {
      type: 'respawn';
      timestamp: number;
      entityId: string;
      position: Vector3Like;
    }
  | {
      type: 'shrink_start';
      timestamp: number;
    }
  | {
      type: 'match_end';
      timestamp: number;
      rankings: PlayerRankingEntry[];
    };

export interface SimulationSnapshot {
  tick: number;
  elapsedTime: number;
  remainingTime: number;
  matchDuration: number;
  phase: MatchPhase;
  arena: ArenaState;
  entities: BallEntityState[];
  rankings: PlayerRankingEntry[];
}

export interface MatchConfig {
  botCount: number;
  difficulty: BotDifficulty;
  matchDuration?: number;
  isDemoMode?: boolean;
  seed?: number;
}

export interface GameSettings {
  soundEnabled: boolean;
  graphicsQuality: GraphicsQuality;
  controlSensitivity: number;
  reducedEffects: boolean;
  difficulty: BotDifficulty;
  botCount: number;
}

export interface PlayerStats {
  bestScore: number;
  bestKnockouts: number;
  totalKnockouts: number;
  totalMatches: number;
  totalWins: number;
  normalWins: number;
  hardWins: number;
}
