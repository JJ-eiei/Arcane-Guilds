const test = require('node:test');
const assert = require('node:assert');
const { RoomManager, RoomError } = require('../server/rooms');

test('create, join (max 4), start, play a full Arcane Guilds game through the room, rematch', () => {
  const { makeBot } = require('../scripts/sim/bots');
  const rm = new RoomManager();
  const { room, player: a } = rm.create({ name: 'A', socketId: 's1' });
  assert.match(room.code, /^[A-Z]{4}$/);
  assert.equal(room.gameId, 'arcane');
  assert.throws(() => rm.start({ code: room.code, byId: a.id }), /อย่างน้อย 2/);
  const others = ['B', 'C', 'D'].map((n, i) => rm.join({ code: room.code.toLowerCase(), name: n, socketId: `s${i + 2}` }).player);
  assert.throws(() => rm.join({ code: room.code, name: 'E', socketId: 's9' }), /เต็ม/);
  assert.throws(() => rm.start({ code: room.code, byId: others[0].id }), /หัวห้อง/);
  rm.start({ code: room.code, byId: a.id });
  assert.throws(() => rm.join({ code: room.code, name: 'Late', socketId: 's10' }), /เริ่มเกมไปแล้ว/);
  const players = [a, ...others];
  const bots = players.map(() => makeBot('strong', () => 0.5));
  // prophecy picks are simultaneous; a normal move before picking is refused
  assert.throws(() => rm.move({ code: room.code, playerId: a.id, move: { type: 'take', colors: ['fire', 'water', 'earth'] } }), /คำทำนาย/);
  let guard = 0;
  while (room.status === 'playing' && guard++ < 2000) {
    const st = room.state;
    const seat = st.phase === 'prophecy' ? st.players.findIndex((p) => !p.prophecy) : st.turn;
    const wrong = players.find((p) => p.seat !== seat);
    if (st.phase === 'action') {
      assert.throws(() => rm.move({ code: room.code, playerId: wrong.id, move: { type: 'pass' } }), /ยังไม่ถึงตา/);
    }
    rm.move({ code: room.code, playerId: players.find((p) => p.seat === seat).id, move: bots[seat].act(st, seat) });
  }
  assert.equal(room.status, 'over');
  const snap = rm.snapshot(room, a.id);
  assert.ok(snap.view.result.winners.length >= 1);
  assert.equal(snap.turnSeat, null);
  // rematch from the game-over screen
  rm.start({ code: room.code, byId: a.id });
  assert.equal(room.status, 'playing');
  assert.equal(room.state.phase, 'prophecy');
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
