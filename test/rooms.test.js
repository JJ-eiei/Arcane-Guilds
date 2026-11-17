const test = require('node:test');
const assert = require('node:assert');
const { RoomManager, RoomError } = require('../server/rooms');

test('create, join, start, play to a win', () => {
  const rm = new RoomManager();
  const { room, player: a } = rm.create({ name: 'A', socketId: 's1' });
  assert.match(room.code, /^[A-Z]{4}$/);
  const { player: b } = rm.join({ code: room.code.toLowerCase(), name: 'B', socketId: 's2' });
  assert.throws(() => rm.join({ code: room.code, name: 'C', socketId: 's3' }), RoomError); // full (2p)
  assert.throws(() => rm.start({ code: room.code, byId: b.id }), /หัวห้อง/);
  rm.start({ code: room.code, byId: a.id });
  assert.throws(() => rm.move({ code: room.code, playerId: b.id, move: { col: 0 } }), /ยังไม่ถึงตา/);
  for (let i = 0; i < 3; i++) {
    rm.move({ code: room.code, playerId: a.id, move: { col: 0 } });
    rm.move({ code: room.code, playerId: b.id, move: { col: 1 } });
  }
  rm.move({ code: room.code, playerId: a.id, move: { col: 0 } });
  assert.equal(room.status, 'over');
  assert.equal(room.state.winner, 0);
  // rematch
  rm.start({ code: room.code, byId: a.id });
  assert.equal(room.status, 'playing');
});

test('resume with token, reject bad token, duplicate names', () => {
  const rm = new RoomManager();
  const { room, player } = rm.create({ name: 'A', socketId: 's1' });
  assert.throws(() => rm.join({ code: room.code, name: 'a', socketId: 's2' }), /ชื่อนี้/);
  rm.disconnect('s1');
  assert.equal(player.connected, false);
  rm.resume({ code: room.code, token: player.token, socketId: 's9' });
  assert.equal(player.connected, true);
  assert.throws(() => rm.resume({ code: room.code, token: 'nope', socketId: 's3' }), RoomError);
});

test('host hands off only after grace period; empty rooms are swept', () => {
  let t = 0;
  const rm = new RoomManager({ now: () => t });
  const { room, player: a } = rm.create({ name: 'A', socketId: 's1' });
  const { player: b } = rm.join({ code: room.code, name: 'B', socketId: 's2' });
  rm.disconnect('s1');
  assert.equal(room.hostId, a.id);       // quick refresh keeps host
  t += 60_000; rm.sweep();
  assert.equal(room.hostId, b.id);
  rm.disconnect('s2');
  t += 31 * 60_000; rm.sweep();
  assert.equal(rm.rooms.size, 0);
});

test('names are sanitised', () => {
  const rm = new RoomManager();
  assert.throws(() => rm.create({ name: '   ', socketId: 's' }), RoomError);
  const { player } = rm.create({ name: '<b>JJ</b>' + 'x'.repeat(40), socketId: 's' });
  assert.ok(!player.name.includes('<'));
  assert.ok(player.name.length <= 20);
});
