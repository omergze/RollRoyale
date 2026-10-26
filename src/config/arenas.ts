import type {
  ArenaBumperConfig,
  ArenaHoleConfig,
  ArenaId,
  MapSelectionId,
} from '../types/game';

export interface ArenaVisualTheme {
  primaryHex: string;
  accentHex: string;
  hazardHex: string;
  deckColorCenter: string;
  deckColorMid: string;
  deckColorEdge: string;
  sideMetalHex: number;
  rimHex: number;
  rimEmissiveHex: number;
}

export interface ArenaDefinition {
  id: ArenaId;
  name: string;
  shortName: string;
  subtitle: string;
  badge: string;
  baseRadius: number;
  minRadius: number;
  innerHoleRadius: number;
  holes: ReadonlyArray<ArenaHoleConfig>;
  bumpers: ReadonlyArray<ArenaBumperConfig>;
  spawnRingRadius: number;
  cameraHeight: number;
  cameraDistance: number;
  cameraTrackClamp: number;
  theme: ArenaVisualTheme;
}

export const ARENA_IDS: ReadonlyArray<ArenaId> = ['classic', 'crater', 'donut', 'bumper'];

const CRATER_DIST = 10.0;
const CRATER_RADIUS = 3.1;
const CRATER_ANGLES = [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2];

const BUMPER_DIST = 7.8;
const BUMPER_RADIUS = 1.35;
const BUMPER_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

export const ARENA_DEFINITIONS: Record<ArenaId, ArenaDefinition> = {
  classic: {
    id: 'classic',
    name: 'CLASSIC ARENA',
    shortName: 'CLASSIC',
    subtitle: 'Pure high-speed circular deck with final-30s shrink.',
    badge: 'STANDARD · 19.5m',
    baseRadius: 19.5,
    minRadius: 11.0,
    innerHoleRadius: 0,
    holes: [],
    bumpers: [],
    spawnRingRadius: 10.5,
    cameraHeight: 22.8,
    cameraDistance: 23.6,
    cameraTrackClamp: 11.5,
    theme: {
      primaryHex: '#00F0FF',
      accentHex: '#0088FF',
      hazardHex: '#FF5E3A',
      deckColorCenter: '#1B2D52',
      deckColorMid: '#12203D',
      deckColorEdge: '#1A1428',
      sideMetalHex: 0x162447,
      rimHex: 0x00f0ff,
      rimEmissiveHex: 0x00c8ff,
    },
  },
  crater: {
    id: 'crater',
    name: 'CRATER ARENA',
    shortName: 'CRATER',
    subtitle: 'Expanded 25.5m deck perforated by 3 abyssal gravity wells.',
    badge: '3 HOLES · 25.5m',
    baseRadius: 25.5,
    minRadius: 16.2,
    innerHoleRadius: 0,
    holes: CRATER_ANGLES.map((angle, idx) => ({
      id: `crater-${idx + 1}`,
      x: Number((Math.cos(angle) * CRATER_DIST).toFixed(3)),
      z: Number((Math.sin(angle) * CRATER_DIST).toFixed(3)),
      radius: CRATER_RADIUS,
    })),
    bumpers: [],
    spawnRingRadius: 15.6,
    cameraHeight: 27.2,
    cameraDistance: 28.2,
    cameraTrackClamp: 14.5,
    theme: {
      primaryHex: '#FF9F1C',
      accentHex: '#FF2E93',
      hazardHex: '#FF3B30',
      deckColorCenter: '#2B1E3E',
      deckColorMid: '#1A162B',
      deckColorEdge: '#120E1E',
      sideMetalHex: 0x26173e,
      rimHex: 0xff9f1c,
      rimEmissiveHex: 0xff6b00,
    },
  },
  donut: {
    id: 'donut',
    name: 'DONUT ARENA',
    shortName: 'DONUT',
    subtitle: '23m orbital ring track surrounding a massive central void.',
    badge: 'RING CORE · 23.0m',
    baseRadius: 23.0,
    minRadius: 16.5,
    innerHoleRadius: 7.2,
    holes: [
      {
        id: 'donut-core',
        x: 0,
        z: 0,
        radius: 7.2,
      },
    ],
    bumpers: [],
    spawnRingRadius: 14.2,
    cameraHeight: 26.2,
    cameraDistance: 27.0,
    cameraTrackClamp: 13.4,
    theme: {
      primaryHex: '#FF2E93',
      accentHex: '#00F0FF',
      hazardHex: '#FF2E93',
      deckColorCenter: '#2D1436',
      deckColorMid: '#161B38',
      deckColorEdge: '#0E1329',
      sideMetalHex: 0x28153d,
      rimHex: 0xff2e93,
      rimEmissiveHex: 0xff0077,
    },
  },
  bumper: {
    id: 'bumper',
    name: 'BUMPER ARENA',
    shortName: 'BUMPER',
    subtitle: '22.5m combat deck with 4 kinetic pulse pillars for bank shots.',
    badge: '4 BUMPERS · 22.5m',
    baseRadius: 22.5,
    minRadius: 13.8,
    innerHoleRadius: 0,
    holes: [],
    bumpers: BUMPER_ANGLES.map((angle, idx) => ({
      id: `bumper-${idx + 1}`,
      x: Number((Math.cos(angle) * BUMPER_DIST).toFixed(3)),
      z: Number((Math.sin(angle) * BUMPER_DIST).toFixed(3)),
      radius: BUMPER_RADIUS,
      height: 2.2,
      impulse: 17.5,
    })),
    spawnRingRadius: 13.6,
    cameraHeight: 25.0,
    cameraDistance: 25.8,
    cameraTrackClamp: 12.8,
    theme: {
      primaryHex: '#00F59B',
      accentHex: '#00F0FF',
      hazardHex: '#FFB703',
      deckColorCenter: '#133238',
      deckColorMid: '#0F222E',
      deckColorEdge: '#0A1622',
      sideMetalHex: 0x12353c,
      rimHex: 0x00f59b,
      rimEmissiveHex: 0x00c880,
    },
  },
};

export function getArenaDefinition(arenaId: ArenaId = 'classic'): ArenaDefinition {
  return ARENA_DEFINITIONS[arenaId] ?? ARENA_DEFINITIONS.classic;
}

export function resolveMapSelection(
  selection: MapSelectionId = 'classic',
  seedOrRandom?: number
): ArenaId {
  if (selection !== 'random' && selection in ARENA_DEFINITIONS) {
    return selection;
  }
  const idx =
    typeof seedOrRandom === 'number'
      ? Math.abs(Math.floor(seedOrRandom)) % ARENA_IDS.length
      : Math.floor(Math.random() * ARENA_IDS.length);
  return ARENA_IDS[idx];
}
