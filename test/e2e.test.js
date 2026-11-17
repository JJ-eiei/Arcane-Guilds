// End-to-end: real HTTP + Socket.io server, real clients.
const test = require('node:test');
const assert = require('node:assert');
const { io: Client } = require('socket.io-client');

process.env.PORT = 0;
const { server } = require('../server/index');

const url = () => `http://localhost:${server.address().port}`;
const call = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const next = (s, ev, pred = () => true) => new Promise((r) => {
  const h = (x) => { if (pred(x)) { s.off(ev, h); r(x); } };
  s.on(ev, h);
});

test('two clients play Arcane Guilds over sockets: lobby, hidden info, reconnect, moves', async (t) => {
  t.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); });
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));

  // static + API
  const html = await fetch(url() + '/').then((r) => r.text());
  assert.match(html, /Arcane Guilds/);
  assert.equal((await fetch(url() + '/healthz').then((r) => r.json())).ok, true);
  const data = await fetch(url() + '/api/games/arcane/data').then((r) => r.json());
  assert.equal(data.cards.length, 90);
  assert.equal((await fetch(url() + '/api/games/nope/data')).status, 404);
  const js = await fetch(url() + '/games/arcane.js');
  assert.match(js.headers.get('cache-control') || '', /no-cache/, 'code must revalidate after deploys');

  const a = Client(url(), { transports: ['websocket'] });
  const b = Client(url(), { transports: ['websocket'] });
  const created = await call(a, 'room:create', { name: 'Alice' });
  assert.ok(created.ok, JSON.stringify(created));
  const joined = await call(b, 'room:join', { code: created.code, name: 'Bob' });
  assert.ok(joined.ok);
  assert.match((await call(b, 'game:start')).error, /หัวห้อง/);

  const bStart = next(b, 'room:update', (s) => s.status === 'playing');
  const aStart = next(a, 'room:update', (s) => s.status === 'playing');
  assert.ok((await call(a, 'game:start')).ok);
  const sb = await bStart;
  assert.equal(sb.view.phase, 'prophecy');
  // hidden information: Bob sees his own options only
  assert.equal(sb.view.players[1].prophecyOptions.length, 2);
  assert.equal(sb.view.players[0].prophecyOptions, undefined);
  assert.equal(JSON.stringify(sb).includes('"decks"'), false);

  const aOpts = (await aStart).view.players[0].prophecyOptions;
  assert.ok((await call(a, 'game:move', { move: { type: 'chooseProphecy', id: aOpts[0] } })).ok);
  const playing = next(a, 'room:update', (s) => s.view.phase === 'action');
  assert.ok((await call(b, 'game:move', { move: { type: 'chooseProphecy', id: sb.view.players[1].prophecyOptions[1] } })).ok);
  const sa = await playing;
  assert.equal(sa.view.players[1].prophecy, null, "Alice can't see Bob's prophecy");
  assert.equal(sa.view.players[0].prophecy, aOpts[0]);

  // Bob drops and comes back with his token
  b.disconnect();
  const b2 = Client(url(), { transports: ['websocket'] });
  const resumed = await call(b2, 'room:resume', { code: created.code, token: joined.token });
  assert.ok(resumed.ok);

  // whoever's turn it is takes three crystals; the other is refused
  const sockets = [a, b2];
  const turn = sa.view.turn;
  const wrong = await call(sockets[1 - turn], 'game:move', { move: { type: 'take', colors: ['fire', 'water', 'earth'] } });
  assert.match(wrong.error, /ยังไม่ถึงตา/);
  const after = next(sockets[1 - turn], 'room:update', (s) => s.view.turn === 1 - turn);
  assert.ok((await call(sockets[turn], 'game:move', { move: { type: 'take', colors: ['fire', 'water', 'earth'] } })).ok);
  const s2 = await after;
  assert.equal(s2.view.players[turn].tokens.fire >= 1, true);
  // junk and oversized input are rejected, not crashing the server
  assert.ok((await call(sockets[1 - turn], 'game:move', { move: { type: 'buy', cardId: { $ne: 1 } } })).error);
  assert.ok((await call(sockets[1 - turn], 'game:move', null)).error);

  a.close(); b2.close();
});
