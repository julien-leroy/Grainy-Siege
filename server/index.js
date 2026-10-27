// Serveur du jeu : Express (fichiers + API d'admin pour le MCP) + Socket.IO (temps réel).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './game.js';
import { CONFIG, DEFAULT_CONFIG, updateConfig, resetConfig } from './config.js';
import { SandWorld } from './sandsim.js';
import { TICK_RATE, LAUNCH_X, LAUNCH_Y, launchVelocity } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3080;

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/confetti', express.static(path.join(ROOT, 'node_modules/canvas-confetti/dist')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, perMessageDeflate: { threshold: 2048 } });

/** @type {Map<string, Room>} */
const rooms = new Map();

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
}

function createRoom() {
  const room = new Room(newCode(), io);
  rooms.set(room.code, room);
  return room;
}

// ------------------------------------------------------------------ Socket.IO
io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const fail = (cb, e) => cb?.({ ok: false, error: e.message || String(e) });
  const guard = (fn) => (data, cb) => {
    try {
      fn(data || {}, cb);
    } catch (e) {
      fail(cb, e);
    }
  };

  socket.on('create', guard(({ name }, cb) => {
    if (room) {
      room.disconnect(socket);
      socket.leave(room.channel);
    }
    room = createRoom();
    me = room.addPlayer({ name, socket });
    cb?.({ ok: true, code: room.code, playerId: me.id });
    room.sendAllWorlds(socket);
  }));

  socket.on('join', guard(({ code, name, playerId }, cb) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) throw new Error('Salle introuvable');
    if (room && room !== r) {
      room.disconnect(socket);
      socket.leave(room.channel);
    }
    room = r;
    me = (playerId && r.reattach(playerId, socket)) || r.addPlayer({ name, socket });
    cb?.({ ok: true, code: r.code, playerId: me.id });
    r.sendAllWorlds(socket);
  }));

  socket.on('addBot', guard((_, cb) => {
    if (!room || me?.id !== room.hostId) throw new Error("Réservé à l'hôte");
    room.addBot();
    room.sendAllWorlds();
    cb?.({ ok: true });
  }));

  socket.on('kick', guard(({ id }, cb) => {
    if (!room || me?.id !== room.hostId || room.phase !== 'lobby') return;
    const p = room.players.get(id);
    if (p?.isBot) room.removePlayer(id);
    cb?.({ ok: true });
  }));

  socket.on('start', guard((_, cb) => {
    room?.start(me?.id);
    cb?.({ ok: true });
  }));

  socket.on('lobby', guard((_, cb) => {
    room?.backToLobby(me?.id);
    cb?.({ ok: true });
  }));

  socket.on('leave', guard((_, cb) => {
    if (room && me) {
      room.removePlayer(me.id);
      socket.leave(room.code);
      room = null;
      me = null;
    }
    cb?.({ ok: true });
  }));

  socket.on('place', guard((d, cb) => {
    console.log('[SOCKET PLACE RECEIVED]', d, 'meId=', me?.id, 'roomCode=', room?.code);
    const res = !!room?.place(me?.id, d);
    cb?.({ ok: res });
  }));
  socket.on('flatten', guard((d, cb) => cb?.({ ok: !!room?.flatten(me?.id, d) })));
  socket.on('dig', guard((d, cb) => cb?.({ ok: !!room?.dig(me?.id, d) })));
  socket.on('placeKing', guard((d, cb) => cb?.({ ok: !!room?.placeKing(me?.id, d) })));
  socket.on('spray', guard((d, cb) => cb?.(room?.spray(me?.id, d) || { ok: false })));
  socket.on('chooseTarget', guard(({ targetId }) => room?.chooseTarget(me?.id, targetId)));
  socket.on('chooseCatapultSide', guard(({ side }) => room?.chooseCatapultSide(me?.id, side)));
  socket.on('aim', guard((d) => room?.relayAim(me?.id, d)));
  socket.on('fire', guard((d, cb) => cb?.({ ok: !!room?.fire(me?.id, d) })));
  socket.on('collectBonus', guard(({ dropId, targetPlayerId }, cb) => cb?.({ ok: !!room?.collectBonus(me?.id, dropId, targetPlayerId) })));
  socket.on('chat', guard(({ message }, cb) => {
    const text = String(message || '').trim().slice(0, 140);
    if (!text || !room || !me) return;
    room.broadcastChat(me, text);
    cb?.({ ok: true });
  }));

  socket.on('disconnect', () => {
    room?.disconnect(socket);
  });
});

// ------------------------------------------------------------------ boucle de simulation
let last = performance.now();
let acc = 0;
const STEP = 1000 / TICK_RATE;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = 250; // pas de spirale de la mort
  while (acc >= STEP) {
    acc -= STEP;
    for (const r of rooms.values()) r.tick();
  }
}, 4);

// ménage des salles abandonnées
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.humansConnected) r.lastActivity = now;
    else if (now - r.lastActivity > 120000) rooms.delete(code);
  }
}, 10000);

// ------------------------------------------------------------------ API d'admin (utilisée par le serveur MCP)
const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

api.get('/join-info', async (req, res) => {
  const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const host = ips[0] ? `${ips[0]}:${PORT}` : req.get('host');
  const url = `http://${host}${code ? `/?room=${code}` : '/'}`;
  let qrSvg = '';
  try {
    const QRCode = (await import('qrcode')).default;
    qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 132, color: { dark: '#2c2218', light: '#00000000' } });
  } catch {}
  res.json({ url, qrSvg, ips });
});

api.get('/rooms', (_req, res) => {
  res.json([...rooms.values()].map((r) => r.describe()));
});

api.post('/rooms', (_req, res) => {
  const r = createRoom();
  res.json({ code: r.code });
});

api.get('/rooms/:code', (req, res) => {
  const r = rooms.get(req.params.code.toUpperCase());
  if (!r) return res.status(404).json({ error: 'Salle introuvable' });
  res.json(r.describe({ ascii: req.query.ascii !== '0' }));
});

api.post('/rooms/:code/bots', (req, res) => {
  const r = rooms.get(req.params.code.toUpperCase());
  if (!r) return res.status(404).json({ error: 'Salle introuvable' });
  try {
    const n = Math.max(1, Math.min(7, Number(req.body?.count) || 1));
    for (let i = 0; i < n; i++) r.addBot();
    r.sendAllWorlds();
    res.json(r.describe());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.post('/rooms/:code/start', (req, res) => {
  const r = rooms.get(req.params.code.toUpperCase());
  if (!r) return res.status(404).json({ error: 'Salle introuvable' });
  try {
    r.start(null);
    res.json(r.describe());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.get('/config', (_req, res) => res.json({ current: CONFIG, defaults: DEFAULT_CONFIG }));
api.patch('/config', (req, res) => res.json(updateConfig(req.body)));
api.post('/config/reset', (_req, res) => res.json(resetConfig()));

/**
 * Bac à sable sans réseau : construit un château, laisse la physique agir, tire éventuellement,
 * et renvoie un rendu ASCII + statistiques. Idéal pour régler la physique depuis un agent IA.
 * body: { stamps: [{shape, x, y?}], king?: {x, y?}, settleTicks?, shots?: [{angle, power, wind?}] }
 */
api.post('/sandbox', (req, res) => {
  const { stamps = [], king, settleTicks = 300, shots = [] } = req.body || {};
  const w = new SandWorld(Number(req.body?.seed) || 42);
  const placed = [];
  for (const s of stamps.slice(0, 80)) {
    const pos = w.stamp(s.shape, Number(s.x), s.y == null ? 0 : Number(s.y));
    placed.push({ ...s, result: pos });
  }
  if (king) w.placeKing(Number(king.x), king.y == null ? 0 : Number(king.y));
  const ticks = Math.min(3000, Number(settleTicks) || 300);
  for (let i = 0; i < ticks; i++) w.step();
  const afterBuild = { cells: w.countTypes(), height: w.highestPoint(), failedCells: w.stats.failedCells };
  const shotResults = [];
  w.armed = true;
  for (const sh of shots.slice(0, 10)) {
    w.wind = Number(sh.wind) || 0;
    const v = launchVelocity(Number(sh.angle), Number(sh.power));
    w.launch(LAUNCH_X, LAUNCH_Y, v.vx, v.vy);
    const events = [];
    for (let i = 0; i < 900; i++) {
      w.step();
      events.push(...w.drainEvents());
      if (!w.ball && w.settled) break;
    }
    shotResults.push({ events: events.filter((e) => e.type !== 'kingLand'), cells: w.countTypes(), king: w.king });
  }
  res.json({
    placed,
    afterBuild,
    shots: shotResults,
    final: { cells: w.countTypes(), height: w.highestPoint(), king: w.king, failedCells: w.stats.failedCells },
    ascii: w.toAscii(),
  });
});

app.use('/api', api);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`🏖️  Le Plus Haut Château de Sable — http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   Sur le réseau local : http://${ip}:${PORT}`);
});
