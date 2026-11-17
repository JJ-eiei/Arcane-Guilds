// Room / lobby / turn management, independent of the transport layer so it
// can be unit-tested. The socket layer (index.js) calls these methods and
// pushes `snapshot(room, playerId)` to each connected player after changes.

const crypto = require('crypto');
const games = require('./games');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion
const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#9b5de5', '#f15bb5', '#43aa8b', '#ffb703'];
const MAX_ROOMS = 2000;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;   // drop rooms nobody has been connected to for 30 min
const IDLE_ROOM_TTL_MS = 6 * 60 * 60 * 1000; // drop any room idle for 6 h
const HOST_GRACE_MS = 45 * 1000;              // host keeps the role through a quick reconnect

class RoomError extends Error {}

function cleanName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  if (!n) throw new RoomError('กรุณาใส่ชื่อ');
  return n;
}

function cleanCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

class RoomManager {
  constructor({ now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.now = now;
  }

  _newCode() {
    for (let i = 0; i < 50; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('เซิร์ฟเวอร์ไม่ว่าง ลองใหม่อีกครั้ง');
  }

  _newPlayer(room, name, socketId) {
    const used = new Set(room.players.map((p) => p.color));
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(18).toString('base64url'),
      name: cleanName(name),
      socketId,
      connected: true,
      seat: null,
      color: COLORS.find((c) => !used.has(c)) || COLORS[room.players.length % COLORS.length],
    };
    room.players.push(player);
    return player;
  }

  get(code) {
    return this.rooms.get(cleanCode(code)) || null;
  }

  create({ name, gameId, socketId }) {
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('ห้องเต็มทั้งเซิร์ฟเวอร์ ลองใหม่ภายหลัง');
    const game = games.get(gameId || games.defaultId);
    if (!game) throw new RoomError('ไม่พบเกมนี้');
    const room = {
      code: this._newCode(),
      gameId: game.id,
      status: 'lobby',     // lobby | playing | over
      hostId: null,
      players: [],
      state: null,
      lastActive: this.now(),
      emptySince: null,
    };
    const player = this._newPlayer(room, name, socketId);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { room, player };
  }

  join({ code, name, socketId }) {
    const room = this.get(code);
    if (!room) throw new RoomError('ไม่พบห้องนี้ ตรวจรหัสอีกครั้ง');
    const game = games.get(room.gameId);
    if (room.status !== 'lobby') throw new RoomError('ห้องนี้เริ่มเกมไปแล้ว');
    if (room.players.length >= game.maxPlayers) throw new RoomError('ห้องเต็มแล้ว');
    const nm = cleanName(name);
    if (room.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) {
      throw new RoomError('มีคนใช้ชื่อนี้ในห้องแล้ว');
    }
    const player = this._newPlayer(room, nm, socketId);
    this._touch(room);
    return { room, player };
  }

  // Re-attach a socket to an existing seat after refresh / network drop.
  resume({ code, token, socketId }) {
    const room = this.get(code);
    if (!room) throw new RoomError('ห้องนี้ปิดไปแล้ว');
    const player = room.players.find((p) => p.token === token);
    if (!player) throw new RoomError('ไม่พบผู้เล่นในห้องนี้');
    player.socketId = socketId;
    player.connected = true;
    this._touch(room);
    return { room, player };
  }

  disconnect(socketId) {
    const hit = this.findBySocket(socketId);
    if (!hit) return null;
    hit.player.connected = false;
    hit.player.socketId = null;
    hit.player.disconnectedAt = this.now();
    this._afterPresenceChange(hit.room);
    return hit;
  }

  leave({ code, playerId }) {
    const room = this.get(code);
    if (!room) return null;
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return null;
    if (room.status === 'lobby') {
      room.players.splice(idx, 1);
    } else {
      // keep the seat so the game state stays consistent; just mark gone
      room.players[idx].connected = false;
      room.players[idx].socketId = null;
      room.players[idx].left = true;
    }
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return { room, deleted: true };
    }
    this._afterPresenceChange(room);
    return { room };
  }

  kick({ code, byId, playerId }) {
    const room = this._requireHost(code, byId);
    if (room.status !== 'lobby') throw new RoomError('เตะได้เฉพาะตอนอยู่ในล็อบบี้');
    if (playerId === byId) throw new RoomError('เตะตัวเองไม่ได้');
    const target = room.players.find((p) => p.id === playerId);
    if (!target) throw new RoomError('ไม่พบผู้เล่น');
    room.players = room.players.filter((p) => p.id !== playerId);
    this._touch(room);
    return { room, kicked: target };
  }

  setGame({ code, byId, gameId }) {
    const room = this._requireHost(code, byId);
    if (room.status !== 'lobby') throw new RoomError('เปลี่ยนเกมได้เฉพาะในล็อบบี้');
    const game = games.get(gameId);
    if (!game) throw new RoomError('ไม่พบเกมนี้');
    if (room.players.length > game.maxPlayers) throw new RoomError(`เกมนี้เล่นได้สูงสุด ${game.maxPlayers} คน`);
    room.gameId = game.id;
    this._touch(room);
    return room;
  }

  start({ code, byId }) {
    const room = this._requireHost(code, byId);
    if (room.status === 'playing') throw new RoomError('เกมเริ่มไปแล้ว');
    const game = games.get(room.gameId);
    const active = room.players.filter((p) => !p.left);
    if (active.length < game.minPlayers) throw new RoomError(`ต้องมีผู้เล่นอย่างน้อย ${game.minPlayers} คน`);
    if (active.length > game.maxPlayers) throw new RoomError(`เกมนี้เล่นได้สูงสุด ${game.maxPlayers} คน`);
    room.players = active;
    room.players.forEach((p, i) => { p.seat = i; });
    room.state = game.setup(room.players.map((p) => ({ id: p.id, name: p.name })), {});
    room.status = 'playing';
    this._touch(room);
    return room;
  }

  move({ code, playerId, move }) {
    const room = this.get(code);
    if (!room) throw new RoomError('ไม่พบห้อง');
    if (room.status !== 'playing') throw new RoomError('ยังไม่ได้เริ่มเกม');
    const player = room.players.find((p) => p.id === playerId);
    if (!player || player.seat === null) throw new RoomError('คุณไม่ได้อยู่ในเกมนี้');
    const game = games.get(room.gameId);
    const err = game.move(room.state, player.seat, move);
    if (err) throw new RoomError(err);
    if (game.isOver(room.state)) room.status = 'over';
    this._touch(room);
    return room;
  }

  backToLobby({ code, byId }) {
    const room = this._requireHost(code, byId);
    room.status = 'lobby';
    room.state = null;
    room.players = room.players.filter((p) => !p.left);
    room.players.forEach((p) => { p.seat = null; });
    this._touch(room);
    return room;
  }

  findBySocket(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) return { room, player };
    }
    return null;
  }

  // Per-player view of the room sent to the client.
  snapshot(room, playerId) {
    const game = games.get(room.gameId);
    const me = room.players.find((p) => p.id === playerId);
    const turnSeat = room.state && game.currentTurn ? game.currentTurn(room.state) : null;
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      you: playerId,
      game: { id: game.id, name: game.name, minPlayers: game.minPlayers, maxPlayers: game.maxPlayers },
      games: games.list(),
      players: room.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, seat: p.seat,
        connected: p.connected, left: !!p.left,
      })),
      turnSeat,
      view: room.state ? game.view(room.state, me ? me.seat : null) : null,
    };
  }

  // Periodic housekeeping. Returns rooms whose host changed so the socket
  // layer can broadcast the update.
  sweep() {
    const t = this.now();
    const changed = [];
    for (const [code, room] of this.rooms) {
      const before = room.hostId;
      this._afterPresenceChange(room);
      if (room.hostId !== before) changed.push(room);
      const empty = room.emptySince !== null && t - room.emptySince > EMPTY_ROOM_TTL_MS;
      const idle = t - room.lastActive > IDLE_ROOM_TTL_MS;
      if (empty || idle) this.rooms.delete(code);
    }
    return changed.filter((r) => this.rooms.has(r.code));
  }

  _requireHost(code, byId) {
    const room = this.get(code);
    if (!room) throw new RoomError('ไม่พบห้อง');
    if (room.hostId !== byId) throw new RoomError('เฉพาะหัวห้องเท่านั้น');
    return room;
  }

  _touch(room) {
    room.lastActive = this.now();
    this._afterPresenceChange(room);
  }

  _afterPresenceChange(room) {
    const anyone = room.players.some((p) => p.connected);
    room.emptySince = anyone ? null : (room.emptySince ?? this.now());
    // hand host to someone still here if the host left, or has been
    // disconnected longer than the grace period (so a refresh keeps host)
    const host = room.players.find((p) => p.id === room.hostId);
    const hostGone = !host || host.left ||
      (!host.connected && this.now() - (host.disconnectedAt || 0) > HOST_GRACE_MS);
    if (hostGone) {
      const next = room.players.find((p) => p.connected && !p.left);
      if (next) room.hostId = next.id;
    }
  }
}

module.exports = { RoomManager, RoomError, cleanCode };
