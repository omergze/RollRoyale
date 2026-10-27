import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { ARENA_IDS, getArenaDefinition } from '../../src/config/arenas';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { GameSimulation } from '../../src/simulation/GameSimulation';
import { newRoomCode, validInput, validNickname } from '../src/OnlineRoom';
import type { ArenaId, SimulationSnapshot } from '../../src/types/game';

function message<T>(room: Room, type: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error(`Timed out waiting for ${type}`)); }, 10000);
    const unsub = room.onMessage(type, (value: T) => { if (predicate(value)) { clearTimeout(timer); unsub(); resolve(value); } });
  });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('rejects malicious inputs and unsafe nicknames', () => {
  expect(validNickname(' Alice ')).toBe('Alice');
  expect(validNickname('<script>')).toBeNull();
  expect(validNickname('x'.repeat(40))).toBeNull();
  expect(validInput({ sequence: 1, moveX: 1, moveZ: 0, boostPressed: true, sentAt: 1 }, 0)).toBe(true);
  expect(validInput({ sequence: 1, moveX: 1, moveZ: 0, boostPressed: true, sentAt: 1 }, 1)).toBe(false);
  expect(validInput({ sequence: 2, moveX: 99, moveZ: 0, boostPressed: true, sentAt: 1 }, 1)).toBe(false);
  expect(validInput({ sequence: 2, moveX: 1, moveZ: 1, boostPressed: true, sentAt: 1 }, 1)).toBe(false);
  expect(validInput({ sequence: 2, moveX: NaN, moveZ: 0, boostPressed: true, sentAt: 1 }, 1)).toBe(false);
  expect(newRoomCode(new Map()).length).toBe(6);
  let draws = 0;
  expect(newRoomCode(new Map([['AAAAAA', 'occupied']]), () => draws++ < 6 ? 0 : 1)).toBe('BBBBBB');
});

it('runs only human participants through authoritative Rapier on every arena', async () => {
  await PhysicsWorld.ensureInitialized();
  for (const arenaId of ARENA_IDS) {
    const simulation = new GameSimulation();
    simulation.startMatch({ botCount: 0, difficulty: 'normal', arenaId, matchDuration: 31, humanPlayers: [
      { id: 'player-a', name: 'Alice', colorPrimary: '#00f0ff', colorAccent: '#0077ff' },
      { id: 'player-b', name: 'Bob', colorPrimary: '#ff2e93', colorAccent: '#ff8a00' },
    ] });
    const initial = simulation.getSnapshot();
    expect(initial.entities.map((p) => p.id)).toEqual(['player-a', 'player-b']);
    expect(initial.arena.arenaId).toBe(arenaId);
    simulation.setHumanInput({ entityId: 'player-a', moveX: 1, moveZ: 0, boostPressed: true });
    for (let tick = 0; tick < 60; tick++) simulation.stepFixed();
    const later = simulation.getSnapshot();
    expect(later.entities[0].position.x).toBeGreaterThan(initial.entities[0].position.x + 1);
    expect(later.entities[0].boostCooldownTimer).toBeGreaterThan(0);
    expect(later.entities[1].position.x).toBeCloseTo(initial.entities[1].position.x, 0);
    simulation.setHumanConnected('player-b', false);
    expect(simulation.getEntity('player-b')?.isAlive).toBe(false);
    simulation.setHumanConnected('player-b', true);
    expect(simulation.getEntity('player-b')?.isAlive).toBe(true);
    simulation.removeHuman('player-b');
    expect(simulation.getSnapshot().entities).toHaveLength(1);
    simulation.finishMatch();
    expect(simulation.getSnapshot().phase).toBe('results');
    simulation.dispose();
  }
}, 30000);

it('awards human knockout credit once for physical hole and edge falls, then respawns safely', async () => {
  await PhysicsWorld.ensureInitialized();
  for (const arenaId of ARENA_IDS) {
    const simulation = new GameSimulation();
    simulation.startMatch({ botCount: 0, difficulty: 'normal', arenaId, humanPlayers: [
      { id: 'attacker', name: 'Alice', colorPrimary: '#00f0ff', colorAccent: '#0077ff' },
      { id: 'victim', name: 'Bob', colorPrimary: '#ff2e93', colorAccent: '#ff8a00' },
    ] });
    const arena = getArenaDefinition(arenaId);
    const hole = arena.holes[0];
    const fall = hole ? { x: hole.x, y: -1, z: hole.z } : { x: arena.baseRadius + 3, y: -1, z: 0 };
    const physics = (simulation as unknown as { physics: PhysicsWorld }).physics;
    physics.setBallActive('victim', true, fall);
    simulation.getEntity('victim')!.lastHit = { attackerId: 'attacker', attackerName: 'Alice', timestamp: 0, impactSpeed: 15, impulseMagnitude: 20 };
    for (let tick = 0; tick < 12 && simulation.getEntity('victim')!.isAlive; tick++) simulation.stepFixed();
    const events = simulation.drainEvents();
    expect(events.filter((event) => event.type === 'knockout')).toHaveLength(1);
    expect(simulation.getSnapshot().entities.find((entity) => entity.id === 'attacker')?.score).toBe(1);
    expect(simulation.getSnapshot().entities.find((entity) => entity.id === 'victim')?.falls).toBe(1);
    for (let tick = 0; tick < 100; tick++) simulation.stepFixed();
    const victim = simulation.getEntity('victim')!;
    expect(victim.isAlive).toBe(true);
    expect(victim.spawnProtectionTimer).toBeGreaterThan(0);
    expect(simulation.getEntity('attacker')!.score).toBe(1);
    simulation.dispose();
  }
}, 30000);

describe('real WebSocket room', () => {
  let child: ChildProcess;
  let endpoint: string;
  beforeAll(async () => {
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    endpoint = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['dist/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ROLLROYALE_TEST_DURATION_SECONDS: '8' }, stdio: 'pipe' });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${endpoint}/health`)).ok) return; } catch { /* starting */ }
      if (child.exitCode !== null) throw new Error(`Server exited: ${child.exitCode}`);
      await pause(50);
    }
    throw new Error('Server did not become healthy');
  }, 15000);
  afterAll(() => child?.kill());

  it('creates, joins, enforces host and readiness, and streams one shared match', async () => {
    const a = await new Client(endpoint).create('rollroyale', { nickname: 'Alice' });
    const welcomeA = message<{ code: string }>(a, 'welcome'); a.send('sync');
    const { code } = await welcomeA;
    const lookup = await fetch(`${endpoint}/rooms/${code}`);
    expect((await lookup.json() as { roomId: string }).roomId).toBe(a.roomId);
    expect((await fetch(`${endpoint}/rooms/ZZZZZZ`)).status).toBe(404);
    const b = await new Client(endpoint).joinById(a.roomId, { nickname: 'Bob' });
    const lobbyA = message<{ players: unknown[] }>(a, 'lobby', (l) => l.players.length === 2); a.send('sync');
    expect((await lobbyA).players).toHaveLength(2);
    const c = await new Client(endpoint).joinById(a.roomId, { nickname: 'Carol' });
    const three = message<{ players: unknown[] }>(a, 'lobby', (l) => l.players.length === 3); a.send('sync');
    expect((await three).players).toHaveLength(3);
    await c.leave();
    b.send('map', 'bumper'); await pause(100);
    const hostLobby = message<{ map: ArenaId }>(a, 'lobby', (l) => l.map === 'classic'); a.send('sync');
    expect((await hostLobby).map).toBe('classic');
    a.send('map', 'crater'); a.send('ready', true); b.send('ready', true);
    await pause(150);
    const matchA = message<{ snapshot: SimulationSnapshot }>(a, 'snapshot', (s) => s.snapshot.phase === 'playing');
    const matchB = message<{ snapshot: SimulationSnapshot }>(b, 'snapshot', (s) => s.snapshot.phase === 'playing');
    a.send('start');
    const [stateA, stateB] = await Promise.all([matchA, matchB]);
    expect(stateA.snapshot.arena.arenaId).toBe('crater');
    expect(stateB.snapshot.arena.arenaId).toBe('crater');
    expect(stateA.snapshot.entities).toHaveLength(2);
    const initialX = stateA.snapshot.entities[0].position.x;
    for (let sequence = 0; sequence < 25; sequence++) {
      a.send('input', { sequence, moveX: 1, moveZ: 0, boostPressed: sequence === 0, sentAt: Date.now() });
      await pause(34);
    }
    const laterA = message<{ snapshot: SimulationSnapshot }>(a, 'snapshot', (s) => s.snapshot.tick > 60);
    const laterB = message<{ snapshot: SimulationSnapshot }>(b, 'snapshot', (s) => s.snapshot.tick > 60);
    const [sa, sb] = await Promise.all([laterA, laterB]);
    expect(sa.snapshot.entities[0].position.x).toBeGreaterThan(initialX + 1);
    expect(sa.snapshot.tick).toBe(sb.snapshot.tick);
    expect(sa.snapshot.entities[0].position.x).toBe(sb.snapshot.entities[0].position.x);
    const completed = message<{ snapshot: SimulationSnapshot }>(a, 'snapshot', (s) => s.snapshot.phase === 'results');
    expect((await completed).snapshot.rankings).toHaveLength(2);
    const rematch = message<{ phase: string; players: Array<{ ready: boolean }> }>(a, 'lobby', (l) => l.phase === 'lobby');
    expect((await rematch).players.every((p) => !p.ready)).toBe(true);
    await a.leave(); await b.leave();
  }, 30000);

  it('enforces eight-player capacity', async () => {
    const clients: Room[] = [];
    try {
      for (let index = 0; index < 8; index++) {
        const sdk = new Client(endpoint);
        clients.push(index === 0 ? await sdk.create('rollroyale', { nickname: `P${index}` }) : await sdk.joinById(clients[0].roomId, { nickname: `P${index}` }));
      }
      await expect(new Client(endpoint).joinById(clients[0].roomId, { nickname: 'TooMany' })).rejects.toThrow();
    } finally { await Promise.all(clients.map((client) => client.leave())); }
  }, 15000);

  it('reconnects a dropped player into the same authoritative match slot', async () => {
    const sdkA = new Client(endpoint), sdkB = new Client(endpoint);
    const a = await sdkA.create('rollroyale', { nickname: 'Alice' });
    const b = await sdkB.joinById(a.roomId, { nickname: 'Bob' });
    a.onMessage('lobby', () => undefined); b.onMessage('lobby', () => undefined);
    a.onMessage('countdown', () => undefined); b.onMessage('countdown', () => undefined);
    a.onMessage('started', () => undefined); b.onMessage('started', () => undefined);
    a.onMessage('events', () => undefined); b.onMessage('events', () => undefined);
    a.onMessage('welcome', () => undefined); b.onMessage('welcome', () => undefined);
    a.send('ready', true); b.send('ready', true);
    await pause(100);
    const started = message<{ snapshot: SimulationSnapshot }>(a, 'snapshot', (s) => s.snapshot.phase === 'playing');
    a.send('start'); await started;
    const oldSession = b.sessionId, token = b.reconnectionToken;
    b.connection.close(4001); // 4000 means an intentional leave in Colyseus.
    await pause(250);
    const restored = await sdkB.reconnect(token);
    expect(restored.sessionId).toBe(oldSession);
    const state = message<{ snapshot: SimulationSnapshot }>(restored, 'snapshot');
    restored.send('sync');
    expect((await state).snapshot.entities).toHaveLength(2);
    expect((await fetch(`${endpoint}/health`)).ok).toBe(true);
    await restored.leave(); await a.leave();
  }, 12000);
});
