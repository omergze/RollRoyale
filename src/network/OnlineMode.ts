import { Client, type Room } from '@colyseus/sdk';
import type { GameEvent, MapSelectionId, PlayerInputCommand, SimulationSnapshot, Vector3Like } from '../types/game';

interface LobbyPlayer { sessionId: string; entityId: string; nickname: string; ready: boolean; connected: boolean; colorPrimary: string }
interface Lobby { code: string; hostId: string; map: MapSelectionId; phase: 'lobby' | 'countdown' | 'playing' | 'results'; players: LobbyPlayer[] }
export class OnlineMode {
  private endpoint = import.meta.env.VITE_MULTIPLAYER_URL || (import.meta.env.DEV ? `http://${location.hostname}:2567` : '');
  private client: Client | null = null;
  private room: Room | null = null;
  private lobby: Lobby | null = null;
  private entityId = '';
  private sessionId = '';
  private sequence = 0;
  private latest: SimulationSnapshot | null = null;
  private prior: SimulationSnapshot | null = null;
  private receivedAt = 0;
  private localVisual: Vector3Like | null = null;
  private lastAck = -1;
  private events: GameEvent[] = [];
  private lastInputAt = 0;
  private pendingBoost = false;
  private lastPingAt = 0;
  private pingMs = 0;
  private leaving = false;
  private panel: HTMLElement;
  private matchHud: HTMLElement;
  private matchLeave: HTMLButtonElement;
  private status: HTMLElement;
  private players: HTMLElement;
  private mapSelect: HTMLSelectElement;
  private readyButton: HTMLButtonElement;
  private startButton: HTMLButtonElement;
  private lobbyControls: HTMLElement;
  private results: HTMLElement;
  private onLocalPlayer: (id: string) => void;
  private onExit: () => void;

  constructor(onLocalPlayer: (id: string) => void, onExit: () => void) {
    this.onLocalPlayer = onLocalPlayer;
    this.onExit = onExit;
    this.panel = document.createElement('section');
    this.panel.className = 'online-panel hidden';
    this.panel.innerHTML = `<div class="online-card"><h2>ONLINE PLAY</h2><p id="online-status">Create or join a private room.</p>
      <div id="online-entry"><label>Nickname <input id="online-name" maxlength="20" autocomplete="nickname" placeholder="Your nickname"></label>
      <div class="online-row"><button id="online-create" class="btn-primary">CREATE ROOM</button><input id="online-code-input" maxlength="6" placeholder="ROOM CODE" aria-label="Room code"><button id="online-join" class="btn-secondary">JOIN ROOM</button></div></div>
      <div id="online-lobby" class="hidden"><p>ROOM <strong id="online-code"></strong> <button id="online-copy" class="btn-secondary">COPY CODE</button></p>
      <div id="online-players"></div><label>ARENA <select id="online-map"><option value="classic">Classic</option><option value="crater">Crater</option><option value="donut">Donut</option><option value="bumper">Bumper</option><option value="random">Random</option></select></label>
      <div class="online-row"><button id="online-ready" class="btn-secondary">READY</button><button id="online-start" class="btn-primary">START MATCH</button></div></div>
      <div id="online-results" class="hidden"></div><button id="online-leave" class="btn-secondary">LEAVE ONLINE</button></div>`;
    this.matchHud = document.createElement('div');
    this.matchHud.className = 'online-match-hud hidden';
    this.matchLeave = document.createElement('button');
    this.matchLeave.className = 'online-match-leave hidden';
    this.matchLeave.textContent = 'LEAVE MATCH';
    this.matchLeave.addEventListener('click', () => void this.leave());
    document.getElementById('app')!.append(this.panel, this.matchHud, this.matchLeave);
    this.status = this.panel.querySelector('#online-status')!;
    this.players = this.panel.querySelector('#online-players')!;
    this.mapSelect = this.panel.querySelector('#online-map')!;
    this.readyButton = this.panel.querySelector('#online-ready')!;
    this.startButton = this.panel.querySelector('#online-start')!;
    this.lobbyControls = this.panel.querySelector('#online-lobby')!;
    this.results = this.panel.querySelector('#online-results')!;
    this.panel.querySelector('#online-create')!.addEventListener('click', () => void this.connect('create'));
    this.panel.querySelector('#online-join')!.addEventListener('click', () => void this.connect('join'));
    this.panel.querySelector('#online-leave')!.addEventListener('click', () => void this.leave());
    this.panel.querySelector('#online-copy')!.addEventListener('click', () => void navigator.clipboard.writeText(this.lobby?.code ?? ''));
    this.readyButton.addEventListener('click', () => this.room?.send('ready', !this.mine()?.ready));
    this.startButton.addEventListener('click', () => this.room?.send('start'));
    this.mapSelect.addEventListener('change', () => this.room?.send('map', this.mapSelect.value));
  }

  get active(): boolean { return !this.panel.classList.contains('hidden') || !!this.room; }
  get playing(): boolean { return this.lobby?.phase === 'playing'; }
  get localPlayerId(): string { return this.entityId; }
  open(): void {
    this.panel.classList.remove('hidden');
    this.matchHud.classList.add('hidden');
    this.matchLeave.classList.add('hidden');
    if (!this.endpoint) this.setStatus('Online server is not configured for this site.');
  }
  private setStatus(message: string): void { this.status.textContent = message; }
  private mine(): LobbyPlayer | undefined { return this.lobby?.players.find((p) => p.sessionId === this.sessionId); }

  private async connect(action: 'create' | 'join'): Promise<void> {
    if (!this.endpoint || this.room) return;
    const nickname = (this.panel.querySelector('#online-name') as HTMLInputElement).value.trim();
    if (!nickname || nickname.length > 20) { this.setStatus('Enter a nickname (1–20 characters).'); return; }
    this.setStatus('Connecting…');
    try {
      this.client = new Client(this.endpoint);
      if (action === 'create') {
        this.room = await this.client.create('rollroyale', { nickname });
      } else {
        const code = (this.panel.querySelector('#online-code-input') as HTMLInputElement).value.trim().toUpperCase();
        if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter a valid six-character room code.');
        const response = await fetch(`${this.endpoint}/rooms/${code}`);
        if (!response.ok) throw new Error('Room not found. Check the code.');
        const { roomId } = await response.json() as { roomId: string };
        this.room = await this.client.joinById(roomId, { nickname });
      }
      this.bindRoom(this.room);
    } catch (error) { this.setStatus(error instanceof Error ? error.message : 'Could not reach online server.'); this.room = null; }
  }

  private bindRoom(room: Room): void {
    this.leaving = false;
    room.onMessage('welcome', (data: { entityId: string; sessionId: string }) => {
      this.entityId = data.entityId; this.sessionId = data.sessionId;
      this.onLocalPlayer(this.entityId);
    });
    room.onMessage('lobby', (lobby: Lobby) => { this.lobby = lobby; this.renderLobby(); });
    room.onMessage('countdown', (data: { endsAt: number }) => {
      this.panel.classList.remove('hidden');
      this.setStatus(`Match starts in ${Math.max(1, Math.ceil((data.endsAt - Date.now()) / 1000))} seconds…`);
    });
    room.onMessage('snapshot', (data: { snapshot: SimulationSnapshot; acks: Record<string, number> }) => {
      this.prior = this.latest; this.latest = data.snapshot; this.receivedAt = performance.now();
      this.lastAck = data.acks?.[this.entityId] ?? this.lastAck;
      if (data.snapshot.phase === 'playing') {
        this.panel.classList.add('hidden'); this.matchHud.classList.remove('hidden'); this.matchLeave.classList.remove('hidden');
        document.body.classList.add('online-playing');
        document.getElementById('menu-screen')?.classList.remove('active');
        document.getElementById('hud-screen')?.classList.add('active');
      }
      if (data.snapshot.phase === 'results') this.renderResults();
    });
    room.onMessage('events', (events: GameEvent[]) => this.events.push(...events));
    room.onMessage('error', (message: string) => this.setStatus(message));
    room.onMessage('pong', (sentAt: number) => { this.pingMs = Math.max(0, Math.round(performance.now() - sentAt)); });
    room.onLeave(() => { if (!this.leaving) void this.reconnect(room.reconnectionToken); });
    room.onError((_code, message) => this.setStatus(message ?? 'Room connection error.'));
    room.send('sync');
  }

  private async reconnect(token: string): Promise<void> {
    this.panel.classList.remove('hidden'); this.matchHud.classList.add('hidden');
    this.matchLeave.classList.add('hidden'); document.body.classList.remove('online-playing');
    this.setStatus('Connection lost. Reconnecting…');
    for (let attempt = 0; attempt < 6 && !this.leaving; attempt++) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 1000));
        if (!this.client) break;
        this.room = await this.client.reconnect(token || '');
        this.bindRoom(this.room);
        return;
      } catch { /* retry within server grace period */ }
    }
    this.room = null; this.setStatus('Connection lost. Rejoin with the room code.');
  }

  private renderLobby(): void {
    if (!this.lobby) return;
    const lobby = this.lobby;
    this.panel.querySelector('#online-entry')!.classList.add('hidden');
    this.lobbyControls.classList.remove('hidden');
    this.panel.querySelector('#online-code')!.textContent = lobby.code;
    this.players.replaceChildren(...lobby.players.map((player) => {
      const row = document.createElement('div'); row.className = 'online-player';
      const color = document.createElement('span'); color.className = 'online-color'; color.style.background = player.colorPrimary;
      const label = document.createElement('span'); label.textContent = `${player.nickname}${player.sessionId === lobby.hostId ? ' ★ HOST' : ''} — ${player.connected ? player.ready ? 'READY' : 'WAITING' : 'DISCONNECTED'}`;
      row.append(color, label); return row;
    }));
    this.mapSelect.value = lobby.map;
    this.mapSelect.disabled = lobby.hostId !== this.sessionId || lobby.phase !== 'lobby';
    this.readyButton.textContent = this.mine()?.ready ? 'NOT READY' : 'READY';
    this.readyButton.disabled = lobby.phase !== 'lobby';
    this.startButton.classList.toggle('hidden', lobby.hostId !== this.sessionId);
    this.startButton.disabled = lobby.phase !== 'lobby' || lobby.players.filter((p) => p.connected).length < 2 || lobby.players.some((p) => p.connected && !p.ready);
    if (lobby.phase === 'lobby') {
      this.panel.classList.remove('hidden'); this.matchHud.classList.add('hidden'); this.matchLeave.classList.add('hidden');
      document.body.classList.remove('online-playing'); document.getElementById('hud-screen')?.classList.remove('active');
      this.results.classList.add('hidden'); this.setStatus('Invite friends with the code, then ready up.');
    }
  }

  private renderResults(): void {
    if (!this.latest) return;
    this.panel.classList.remove('hidden'); this.matchHud.classList.add('hidden'); this.matchLeave.classList.add('hidden');
    document.body.classList.remove('online-playing'); document.getElementById('hud-screen')?.classList.remove('active');
    this.results.classList.remove('hidden');
    this.results.textContent = `RESULTS — ${this.latest.rankings.map((r) => `#${r.rank} ${r.name}: ${r.score} KOs`).join(' · ')}. Rematch lobby opens shortly.`;
    this.setStatus('Match complete.');
  }

  update(now: number, command?: PlayerInputCommand): { snapshot: SimulationSnapshot | null; events: GameEvent[]; alpha: number } {
    if (command?.boostPressed) this.pendingBoost = true;
    if (this.room && this.playing && command && now - this.lastInputAt >= 33) {
      this.lastInputAt = now;
      this.room.send('input', { sequence: ++this.sequence, moveX: command.moveX, moveZ: command.moveZ, boostPressed: this.pendingBoost, sentAt: now });
      this.pendingBoost = false;
    }
    if (this.room && now - this.lastPingAt >= 2000) { this.lastPingAt = now; this.room.send('ping', now); }
    if (this.latest?.phase === 'playing') {
      const local = this.latest.entities.find((e) => e.id === this.entityId);
      this.matchHud.textContent = `${this.latest.arena.arenaName} · ${Math.ceil(this.latest.remainingTime)}s · ${local?.name ?? 'YOU'}: ${local?.score ?? 0} KOs · BOOST ${local ? Math.max(0, local.boostCooldownTimer).toFixed(1) : '0.0'}s · ${this.pingMs}ms · ${this.latest.rankings.map((r) => `${r.name} ${r.score}`).join('  ')}`;
    }
    const events = this.events.splice(0);
    const snapshot = this.latest ? structuredClone(this.latest) : null;
    if (snapshot) {
      for (const entity of snapshot.entities) entity.isPlayer = entity.id === this.entityId;
      for (const rank of snapshot.rankings) rank.isPlayer = rank.entityId === this.entityId;
      const local = snapshot.entities.find((entity) => entity.id === this.entityId);
      if (local && local.isAlive) {
        const ahead = Math.max(0, Math.min(0.05, (now - this.receivedAt) / 1000));
        const target = {
          x: local.position.x + local.velocity.x * ahead,
          y: local.position.y + local.velocity.y * ahead,
          z: local.position.z + local.velocity.z * ahead,
        };
        const error = this.localVisual ? Math.hypot(target.x - this.localVisual.x, target.y - this.localVisual.y, target.z - this.localVisual.z) : Infinity;
        this.localVisual = error > 3 ? target : {
          x: this.localVisual!.x + (target.x - this.localVisual!.x) * 0.35,
          y: this.localVisual!.y + (target.y - this.localVisual!.y) * 0.35,
          z: this.localVisual!.z + (target.z - this.localVisual!.z) * 0.35,
        };
        local.position = { ...this.localVisual }; local.prevPosition = { ...this.localVisual };
      } else this.localVisual = null;
    }
    // Delay remote rendering by one snapshot interval; keep the local player authoritative.
    if (snapshot && this.prior && this.prior.arena.arenaId === snapshot.arena.arenaId) {
      const t = Math.max(0, Math.min(1, (now - this.receivedAt) / 50));
      for (const entity of snapshot.entities) {
        if (entity.id === this.entityId) continue;
        const previous = this.prior.entities.find((p) => p.id === entity.id);
        if (previous && previous.isAlive === entity.isAlive) {
          entity.position.x = previous.position.x + (entity.position.x - previous.position.x) * t;
          entity.position.y = previous.position.y + (entity.position.y - previous.position.y) * t;
          entity.position.z = previous.position.z + (entity.position.z - previous.position.z) * t;
          entity.prevPosition = { ...entity.position };
        }
      }
    }
    return { snapshot, events, alpha: 1 };
  }

  async leave(): Promise<void> {
    this.leaving = true;
    try { await this.room?.leave(); } catch { /* local exit still succeeds */ }
    this.room = null; this.lobby = null; this.latest = null; this.prior = null;
    this.localVisual = null; this.sequence = 0; this.lastAck = -1; this.pendingBoost = false;
    this.panel.classList.add('hidden'); this.matchHud.classList.add('hidden');
    this.matchLeave.classList.add('hidden'); document.body.classList.remove('online-playing');
    this.panel.querySelector('#online-entry')!.classList.remove('hidden'); this.lobbyControls.classList.add('hidden');
    this.onExit();
  }
}
