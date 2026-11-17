const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager, RoomError } = require('./rooms');

const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10000,
  pingTimeout: 8000,
});

const rooms = new RoomManager();

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit('room:update', rooms.snapshot(room, p.id));
    }
  }
}

function sendSystem(room, text) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('chat', { system: true, text, at: Date.now() });
  }
}

// Tiny per-socket rate limiter: max `limit` events per `windowMs`.
function limiter(limit = 30, windowMs = 5000) {
  let count = 0;
  let start = Date.now();
  return () => {
    const t = Date.now();
    if (t - start > windowMs) { start = t; count = 0; }
    count += 1;
    return count <= limit;
  };
}

io.on('connection', (socket) => {
  const allow = limiter();
  let session = null; // { code, playerId }

  // Wrap a handler: rate-limit, catch RoomErrors, always ack.
  const on = (event, fn) => {
    socket.on(event, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!allow()) return reply({ error: 'ส่งคำสั่งเร็วเกินไป' });
      try {
        reply(fn(payload || {}) || { ok: true });
      } catch (e) {
        if (e instanceof RoomError) return reply({ error: e.message });
        console.error(`[${event}]`, e);
        reply({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
      }
    });
  };

  const attach = (room, player) => {
    if (session && session.code !== room.code) {
      const prev = rooms.get(session.code);
      if (prev) { rooms.leave({ code: session.code, playerId: session.playerId }); broadcast(prev); }
    }
    session = { code: room.code, playerId: player.id };
    broadcast(room);
    return { ok: true, code: room.code, playerId: player.id, token: player.token };
  };

  on('room:create', ({ name, gameId }) => {
    const { room, player } = rooms.create({ name, gameId, socketId: socket.id });
    return attach(room, player);
  });

  on('room:join', ({ code, name }) => {
    const { room, player } = rooms.join({ code, name, socketId: socket.id });
    const res = attach(room, player);
    sendSystem(room, `${player.name} เข้าห้อง`);
    return res;
  });

  on('room:resume', ({ code, token }) => {
    const { room, player } = rooms.resume({ code, token: String(token || ''), socketId: socket.id });
    return attach(room, player);
  });

  on('room:leave', () => {
    if (!session) return;
    const room = rooms.get(session.code);
    const player = room && room.players.find((p) => p.id === session.playerId);
    const res = rooms.leave(session);
    session = null;
    if (res && !res.deleted) {
      broadcast(res.room);
      if (player) sendSystem(res.room, `${player.name} ออกจากห้อง`);
    }
  });

  const requireSession = () => {
    if (!session) throw new RoomError('ยังไม่ได้อยู่ในห้อง');
    return session;
  };

  on('room:kick', ({ playerId }) => {
    const s = requireSession();
    const { room, kicked } = rooms.kick({ code: s.code, byId: s.playerId, playerId });
    if (kicked.socketId) io.to(kicked.socketId).emit('kicked');
    broadcast(room);
  });

  on('room:setGame', ({ gameId }) => {
    const s = requireSession();
    broadcast(rooms.setGame({ code: s.code, byId: s.playerId, gameId }));
  });

  on('game:start', () => {
    const s = requireSession();
    const room = rooms.start({ code: s.code, byId: s.playerId });
    broadcast(room);
    sendSystem(room, 'เริ่มเกม!');
  });

  on('game:move', ({ move }) => {
    const s = requireSession();
    broadcast(rooms.move({ code: s.code, playerId: s.playerId, move }));
  });

  on('game:lobby', () => {
    const s = requireSession();
    broadcast(rooms.backToLobby({ code: s.code, byId: s.playerId }));
  });

  on('chat', ({ text }) => {
    const s = requireSession();
    const room = rooms.get(s.code);
    const player = room && room.players.find((p) => p.id === s.playerId);
    const msg = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!player || !msg) return;
    for (const p of room.players) {
      if (p.connected && p.socketId) {
        io.to(p.socketId).emit('chat', { from: player.id, name: player.name, color: player.color, text: msg, at: Date.now() });
      }
    }
  });

  socket.on('disconnect', () => {
    const hit = rooms.disconnect(socket.id);
    if (hit) broadcast(hit.room);
  });
});

setInterval(() => {
  for (const room of rooms.sweep()) broadcast(room);
}, 15000).unref();

server.listen(PORT, () => {
  console.log(`Board game server on http://localhost:${PORT}`);
});

module.exports = { server, io, rooms };
