// Round 2 balance: seals removed, omen events added.
// Usage: node scripts/sim/events.js [scale] → docs/sim-events.json
const fs = require('fs');
const path = require('path');
const { playGame } = require('./play');
const { STYLES } = require('./bots');

const SCALE = Number(process.argv[2] || 1);
const N = (k) => Math.max(20, Math.round(k * SCALE));
let seed = 3000000;
const strong = { name: 'strong', ...STYLES.strong };
const variant = (name, over) => ({ ...strong, name, ...over });
const pct = (x) => Math.round(x * 1000) / 10;
const avg = (R, f) => R.reduce((a, r) => a + f(r), 0) / R.length;
const runMany = (games, mk) => Array.from({ length: games }, (_, i) => playGame({ seed: seed++, ...mk(i) }));
const seatTable = (R) => { const n = R[0].n; const w = Array(n).fill(0); for (const r of R) for (const s of r.winners) w[(s - r.firstSeat + n) % n] += 1 / r.winners.length; return w.map((x) => pct(x / R.length)); };
const dist = (R) => { const d = {}; for (const r of R) { const k = Math.min(r.events, 4); d[k === 4 ? '4+' : k] = (d[k === 4 ? '4+' : k] || 0) + 1; } return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, pct(v / R.length)])); };
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const res = {};

step('A events per game for omen counts');
res.frequency = {};
for (const [label, perLevel] of [['2/2/1 (ปัจจุบัน)', { 1: 2, 2: 2, 3: 1 }], ['3/2/1', { 1: 3, 2: 2, 3: 1 }], ['3/3/2', { 1: 3, 2: 3, 3: 2 }]]) {
  res.frequency[label] = {};
  for (const n of [2, 3, 4]) {
    const R = runMany(N(800), () => ({ styles: Array(n).fill(strong), config: { omens: { perLevel } } }));
    res.frequency[label][n] = { avg: +avg(R, (r) => r.events).toFixed(2), dist: dist(R), rounds: +avg(R, (r) => r.rounds).toFixed(1) };
  }
}

step('B seat balance (events on) for compensation schemes');
res.seats = {};
for (const [n, schemes] of [[2, [[0, 0], [0, 1]]], [3, [[0, 0, 0], [0, 0, 1], [0, 1, 1]]], [4, [[0, 0, 0, 0], [0, 0, 1, 1], [0, 1, 1, 1], [0, 1, 1, 2]]]]) {
  res.seats[n] = {};
  for (const sc of schemes) {
    const R = runMany(N(3000), () => ({ styles: Array(n).fill(strong), config: { startTokensByPlayers: { [n]: sc } } }));
    res.seats[n][sc.join('-')] = seatTable(R);
  }
}

step('C events vs no events (4p): length, score, seat spread');
res.compare = {};
for (const [label, cfg] of [['ไม่มี event', { omens: { perLevel: {} } }], ['มี event', {}]]) {
  const R = runMany(N(3000), () => ({ styles: Array(4).fill(strong), config: cfg }));
  res.compare[label] = {
    rounds: +avg(R, (r) => r.rounds).toFixed(1),
    winnerScore: +avg(R, (r) => Math.max(...r.scores.map((s) => s.total))).toFixed(1),
    seats: seatTable(R),
    dragonClaimedPct: pct(avg(R, (r) => (r.stats.dragonClaims ? 1 : 0))),
    steals: +avg(R, (r) => r.stats.dragonSteals).toFixed(2),
  };
}

step('D per-event: how often each fires; dragon hunter / hoarder A/B');
{
  const R = runMany(N(4000), (i) => ({ styles: Array(2 + (i % 3)).fill(strong) }));
  const t = {};
  for (const r of R) for (const [id, k] of Object.entries(r.stats.eventsById || {})) t[id] = (t[id] || 0) + k;
  res.perEvent = Object.fromEntries(Object.entries(t).sort().map(([k, v]) => [k, +(v / R.length).toFixed(2)]));
  const pt = {};
  for (const r of R) for (const p of r.prophecies) { pt[p.id] = pt[p.id] || [0, 0]; pt[p.id][0]++; if (p.met) pt[p.id][1]++; }
  res.prophecy = Object.fromEntries(Object.entries(pt).sort().map(([k, [h, m]]) => [k, pct(m / h)]));
}
const ab = (v, games) => {
  const R = runMany(games, (i) => ({ styles: i % 2 ? [v, strong, v, strong] : [strong, v, strong, v] }));
  let w = 0; for (const r of R) for (const s of r.winners) if (r.styles[s] === v) w += 1 / r.winners.length;
  return pct(w / games);
};
res.ab = {
  'ล่ามังกร': ab(variant('dragon+', { dragon: 1.5 }), N(2000)),
  'เน้นภูต': ab(variant('guard+', { guard: 2.0 }), N(2000)),
  'เน้นแต้ม': ab(variant('points+', { pts: 1.0, bonus: 0.4 }), N(2000)),
};
res.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sim-events.json'), JSON.stringify(res, null, 2));
step('done');
