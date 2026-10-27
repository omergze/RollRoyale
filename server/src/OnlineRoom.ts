import { randomInt } from 'node:crypto';
import { Room, type Client } from 'colyseus';
import { ARENA_IDS, resolveMapSelection } from '../../src/config/arenas.js';
import { BOT_PALETTES, PLAYER_PALETTE } from '../../src/config/constants.js';
import { GameSimulation } from '../../src/simulation/GameSimulation.js';
import type { ArenaId, GameEvent, MapSelectionId, PlayerInputCommand } from '../../src/types/game.js';

export const activeCodes = new Map<string, string>();
export const roomMetrics = new Map<string, { stepDurationMs: number; snapshotBytes: number }>();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(existing: ReadonlyMap<string, string> = activeCodes, draw: (max: number) => number = randomInt): string {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[draw(CODE_CHARS.length)];
    if (!existing.has(code)) return code;
  }
  throw new Error('Unable to allocate room code');
}

type Member = { sessionId: string; entityId: string; nickname: string; ready: boolean; connected: boolean; colorPrimary: string; colorAccent: string; lastSequence: number; lastInputAt: number };
export function validNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 20 && /^[\p{L}\p{N} _-]+$/u.test(name) ? name : null;
}
export function validInput(value: unknown, previousSequence: number): value is { sequence: number; moveX: number; moveZ: number; boostPressed: boolean; sentAt: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Number.isSafeInteger(v.sequence) && (v.sequence as number) > previousSequence &&
    typeof v.moveX === 'number' && Number.isFinite(v.moveX) && Math.abs(v.moveX) <= 1 &&
    typeof v.moveZ === 'number' && Number.isFinite(v.moveZ) && Math.abs(v.moveZ) <= 1 &&
    Math.hypot(v.moveX, v.moveZ) <= 1.01 && typeof v.boostPressed === 'boolean' &&
    typeof v.sentAt === 'number' && Number.isFinite(v.sentAt);
}

export class OnlineRoom extends Room {
  maxClients = 8;
  private code = '';
  private members = new Map<string, Member>();
  private hostId = '';
  private selection: MapSelectionId = 'classic';
  private phase: 'lobby' | 'countdown' | 'playing' | 'results' = 'lobby';
  private simulation: GameSimulation | null = null;
  private snapshotTicks = 0;
  private countdownEndsAt = 0;
  private resultsEndsAt = 0;
  private nextSlot = 0;
  private stepDurationMs = 0;
  private previousTickAt = performance.now();
  private accumulatedMs = 0;

  onCreate(): void {
    this.code = newRoomCode();
    activeCodes.set(this.code, this.roomId);
    roomMetrics.set(this.code, { stepDurationMs: 0, snapshotBytes: 0 });
    this.setPatchRate(null);
    this.setSimulationInterval(() => this.tick(), 1000 / 60);
    this.onMessage('ready', (client, value) => {
      if (this.phase !== 'lobby' || typeof value !== 'boolean') return;
      const member = this.members.get(client.sessionId);
      if (member) { member.ready = value; this.broadcastLobby(); }
    });
    this.onMessage('map', (client, value) => {
      if (this.phase !== 'lobby' || client.sessionId !== this.hostId || typeof value !== 'string') return;
      if (value === 'random' || ARENA_IDS.includes(value as ArenaId)) {
        this.selection = value as MapSelectionId;
        this.broadcastLobby();
      }
    });
    this.onMessage('start', (client) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby') return;
      const connected = [...this.members.values()].filter((p) => p.connected);
      if (connected.length < 2 || connected.some((p) => !p.ready)) {
        client.send('error', 'At least two connected, ready players are required.');
        return;
      }
      this.phase = 'countdown';
      this.countdownEndsAt = Date.now() + 3000;
      this.broadcast('countdown', { endsAt: this.countdownEndsAt });
      this.broadcastLobby();
    });
    this.onMessage('input', (client, raw) => {
      const member = this.members.get(client.sessionId);
      if (!member || !member.connected || this.phase !== 'playing') return;
      const now = Date.now();
      if (now - member.lastInputAt < 12 || !validInput(raw, member.lastSequence)) return;
      member.lastInputAt = now;
      member.lastSequence = raw.sequence;
      const input: PlayerInputCommand = { entityId: member.entityId, moveX: raw.moveX, moveZ: raw.moveZ, boostPressed: raw.boostPressed, sequence: raw.sequence };
      this.simulation?.setHumanInput(input);
    });
    this.onMessage('ping', (client, value) => {
      if (typeof value === 'number' && Number.isFinite(value)) client.send('pong', value);
    });
    this.onMessage('sync', (client) => {
      const member = this.members.get(client.sessionId);
      if (member) client.send('welcome', { code: this.code, entityId: member.entityId, sessionId: client.sessionId });
      this.broadcastLobby();
      if (this.simulation) client.send('snapshot', { snapshot: this.simulation.getSnapshot(), acks: this.acks() });
    });
  }

  onJoin(client: Client, options: { nickname?: unknown }): void {
    if (this.phase !== 'lobby') throw new Error('Match already in progress');
    const nickname = validNickname(options?.nickname);
    if (!nickname) throw new Error('Enter a nickname of 1–20 letters or numbers');
    const palette = this.nextSlot === 0 ? PLAYER_PALETTE : BOT_PALETTES[(this.nextSlot - 1) % BOT_PALETTES.length];
    const member: Member = { sessionId: client.sessionId, entityId: `player-${this.nextSlot}`, nickname, ready: false, connected: true, colorPrimary: palette.primary, colorAccent: palette.accent, lastSequence: -1, lastInputAt: 0 };
    this.nextSlot++;
    this.members.set(client.sessionId, member);
    if (!this.hostId) this.hostId = client.sessionId;
    client.send('welcome', { code: this.code, entityId: member.entityId, sessionId: client.sessionId });
    this.broadcastLobby();
  }

  onDrop(client: Client): void {
    const member = this.members.get(client.sessionId);
    if (member) { member.connected = false; member.ready = false; this.simulation?.setHumanConnected(member.entityId, false); this.broadcastLobby(); }
    this.allowReconnection(client, 15).catch(() => undefined);
  }

  onReconnect(client: Client): void {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    member.connected = true;
    this.simulation?.setHumanConnected(member.entityId, true);
    client.send('welcome', { code: this.code, entityId: member.entityId, sessionId: client.sessionId });
    if (this.simulation) client.send('snapshot', { snapshot: this.simulation.getSnapshot(), acks: this.acks() });
    this.broadcastLobby();
  }

  onLeave(client: Client): void {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    this.members.delete(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    if (this.phase === 'playing') this.simulation?.removeHuman(member.entityId);
    if (this.phase === 'countdown' && [...this.members.values()].filter((m) => m.connected).length < 2) this.phase = 'lobby';
    if (this.phase === 'playing' && [...this.members.values()].filter((m) => m.connected).length < 2) this.simulation?.finishMatch();
    this.broadcastLobby();
    if (this.members.size === 0) this.disconnect();
  }

  onDispose(): void { activeCodes.delete(this.code); roomMetrics.delete(this.code); this.simulation?.dispose(); }

  private broadcastLobby(): void {
    this.broadcast('lobby', { code: this.code, hostId: this.hostId, map: this.selection, phase: this.phase,
      players: [...this.members.values()].map(({ sessionId, entityId, nickname, ready, connected, colorPrimary }) => ({ sessionId, entityId, nickname, ready, connected, colorPrimary })) });
  }

  private acks(): Record<string, number> {
    return Object.fromEntries([...this.members.values()].map((p) => [p.entityId, p.lastSequence]));
  }

  private startMatch(): void {
    const participants = [...this.members.values()].filter((p) => p.connected);
    this.simulation?.dispose();
    this.simulation = new GameSimulation();
    const map = resolveMapSelection(this.selection, randomInt(1_000_000));
    const testDuration = process.env.NODE_ENV === 'test' ? Number(process.env.ROLLROYALE_TEST_DURATION_SECONDS) : NaN;
    this.simulation.startMatch({ botCount: 0, difficulty: 'normal', arenaId: map,
      matchDuration: Number.isFinite(testDuration) && testDuration >= 1 && testDuration <= 120 ? testDuration : undefined,
      humanPlayers: participants.map((p) => ({ id: p.entityId, name: p.nickname, colorPrimary: p.colorPrimary, colorAccent: p.colorAccent })) });
    this.phase = 'playing';
    this.previousTickAt = performance.now();
    this.accumulatedMs = 0;
    this.broadcast('started', { arenaId: map });
    this.broadcastLobby();
    this.broadcast('snapshot', { snapshot: this.simulation.getSnapshot(), acks: this.acks() });
  }

  private tick(): void {
    const began = performance.now();
    this.accumulatedMs = Math.min(100, this.accumulatedMs + Math.max(0, began - this.previousTickAt));
    this.previousTickAt = began;
    if (this.phase === 'countdown' && Date.now() >= this.countdownEndsAt) this.startMatch();
    if (this.phase === 'results' && Date.now() >= this.resultsEndsAt) {
      this.phase = 'lobby';
      this.simulation?.dispose(); this.simulation = null;
      for (const member of this.members.values()) member.ready = false;
      this.broadcastLobby();
    }
    if (this.phase !== 'playing' || !this.simulation) return;
    let steps = 0;
    while (this.accumulatedMs >= 1000 / 60 && steps++ < 5 && this.phase === 'playing') {
      this.accumulatedMs -= 1000 / 60;
      for (const member of this.members.values()) {
        if (member.connected && Date.now() - member.lastInputAt > 250) {
          this.simulation.setHumanInput({ entityId: member.entityId, moveX: 0, moveZ: 0, boostPressed: false });
        }
      }
      this.simulation.stepFixed();
      const events: GameEvent[] = this.simulation.drainEvents();
      if (events.length) this.broadcast('events', events);
      if (++this.snapshotTicks % 3 === 0 || events.length) {
        const payload = { snapshot: this.simulation.getSnapshot(), acks: this.acks() };
        this.broadcast('snapshot', payload);
        const metrics = roomMetrics.get(this.code);
        if (metrics) metrics.snapshotBytes = Buffer.byteLength(JSON.stringify(payload));
      }
      if (this.simulation.getPhase() === 'results') {
        this.phase = 'results'; this.resultsEndsAt = Date.now() + 8000;
        this.broadcast('snapshot', { snapshot: this.simulation.getSnapshot(), acks: this.acks() });
        this.broadcastLobby();
      }
    }
    this.stepDurationMs = performance.now() - began;
    const metrics = roomMetrics.get(this.code);
    if (metrics) metrics.stepDurationMs = this.stepDurationMs;
  }
  public getMetrics(): { stepDurationMs: number; players: number } { return { stepDurationMs: this.stepDurationMs, players: this.members.size }; }
}
