import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { OnlineRoom, activeCodes, roomMetrics } from './OnlineRoom.js';

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer();
await PhysicsWorld.ensureInitialized();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer, maxPayload: 4096 }),
  express: (app) => {
    app.use((request, response, next) => {
      response.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN ?? '*');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') { response.sendStatus(204); return; }
      next();
    });
    app.get('/health', (_request, response) => response.json({ ok: true, rooms: activeCodes.size,
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      maxStepMs: Math.round(Math.max(0, ...[...roomMetrics.values()].map((m) => m.stepDurationMs)) * 100) / 100,
      maxSnapshotBytes: Math.max(0, ...[...roomMetrics.values()].map((m) => m.snapshotBytes)) }));
    app.get('/rooms/:code', (request, response) => {
      const code = request.params.code.toUpperCase();
      const roomId = /^[A-Z2-9]{6}$/.test(code) ? activeCodes.get(code) : undefined;
      if (!roomId) { response.status(404).json({ error: 'Room not found' }); return; }
      response.json({ roomId });
    });
  },
});
gameServer.define('rollroyale', OnlineRoom);
await gameServer.listen(port, '0.0.0.0');
console.log(`RollRoyale multiplayer listening on ${port}`);
