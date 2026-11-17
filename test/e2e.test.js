const test = require('node:test');
const assert = require('node:assert');
const { io: Client } = require('socket.io-client');

process.env.PORT = 0;
const { server } = require('../server/index');

const url = () => `http://localhost:${server.address().port}`;
const call = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const next = (s, ev) => new Promise((r) => s.once(ev, r));

test('two clients play a full game over sockets, with reconnect', async () => {
  await new Promise((r) => server.listening ? r() : server.once('listening', r));
  const a = Client(url(), { transports: ['websocket'] });
  const b = Client(url(), { transports: ['websocket'] });
  const created = await call(a, 'room:create', { name: 'Alice' });
  assert.ok(created.ok, JSON.stringify(created));
  const joined = await call(b, 'room:join', { code: created.code, name: 'Bob' });
  assert.ok(joined.ok);
  const startUpd = next(b, 'room:update');
  assert.ok((await call(a, 'game:start')).ok);
  const s = await startUpd;
  assert.equal(s.status, 'playing');
  assert.equal(s.turnSeat, 0);

  // Bob drops & reconnects mid-game with his token
  b.disconnect();
  const b2 = Client(url(), { transports: ['websocket'] });
  const resumed = await call(b2, 'room:resume', { code: created.code, token: joined.token });
  assert.ok(resumed.ok);

  const bad = await call(b2, 'game:move', { move: { col: 3 } });
  assert.match(bad.error, /ยังไม่ถึงตา/);
  for (let i = 0; i < 3; i++) {
    assert.ok((await call(a, 'game:move', { move: { col: 3 } })).ok);
    assert.ok((await call(b2, 'game:move', { move: { col: 4 } })).ok);
  }
  const fin = next(b2, 'room:update');
  await call(a, 'game:move', { move: { col: 3 } });
  const end = await fin;
  assert.equal(end.status, 'over');
  assert.equal(end.view.winner, 0);

  const health = await fetch(url() + '/healthz').then((r) => r.json());
  assert.equal(health.ok, true);
  const html = await fetch(url() + '/').then((r) => r.text());
  assert.match(html, /Board Game/);

  a.close(); b2.close();
  server.close();
  process.exit(0);
});
