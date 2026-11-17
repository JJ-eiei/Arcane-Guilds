// Round 4: validate the full recommended config. → docs/sim-validate.json
const fs = require('fs');
const path = require('path');
const { playGame } = require('./play');
const { STYLES } = require('./bots');
const RECOMMENDED = require('./recommended');

const SCALE = Number(process.argv[2] || 1);
const N = (k) => Math.max(20, Math.round(k * SCALE));
let seed = 1300000;
const strong = { name: 'strong', ...STYLES.strong };
const variant = (name, over) => ({ ...strong, name, ...over });
const pct = (x) => Math.round(x * 1000) / 10;
const avg = (R, f) => R.reduce((a, r) => a + f(r), 0) / R.length;
const runMany = (games, mk) => Array.from({ length: games }, (_, i) => playGame({ seed: seed++, ...mk(i) }));
const seatTable = (R) => { const n = R[0].n; const w = Array(n).fill(0); for (const r of R) for (const s of r.winners) w[(s - r.firstSeat + n) % n] += 1 / r.winners.length; return w.map((x) => pct(x / R.length)); };
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const res = { config: RECOMMENDED };

step('seats + mechanics per player count');
res.byPlayers = {};
const allR = [];
for (const n of [2, 3, 4]) {
  const R = runMany(N(3000), () => ({ styles: Array(n).fill(strong), config: RECOMMENDED }));
  allR.push(...R);
  res.byPlayers[n] = {
    seats: seatTable(R), rounds: +avg(R, (r) => r.rounds).toFixed(1),
    winnerScore: +avg(R, (r) => Math.max(...r.scores.map((s) => s.total))).toFixed(1),
    dragonClaimedPct: pct(avg(R, (r) => (r.stats.dragonClaims ? 1 : 0))), steals: +avg(R, (r) => r.stats.dragonSteals).toFixed(2),
    seals: +avg(R, (r) => r.stats.seals).toFixed(2), curses: +avg(R, (r) => r.stats.curses).toFixed(2),
    guardians: +avg(R, (r) => r.stats.guardians).toFixed(2), prophecySwingPct: pct(avg(R, (r) => (r.prophecySwing ? 1 : 0))),
  };
}
const t = {};
for (const r of allR) for (const p of r.prophecies) { t[p.id] = t[p.id] || [0, 0]; t[p.id][0]++; if (p.met) t[p.id][1]++; }
res.prophecy = Object.fromEntries(Object.entries(t).sort().map(([k, [h, m]]) => [k, pct(m / h)]));

step('style A/B (4p, 2 vs 2 strong; fair = 50%)');
res.ab = {};
for (const [label, v] of [
  ['ผนึกหนัก', variant('sealer+', { seal: 1.4, deny: 0.6 })],
  ['ล่ามังกร', variant('dragon+', { dragon: 1.5 })],
  ['เน้นแต้ม', variant('points+', { pts: 1.0, bonus: 0.4 })],
  ['เน้นภูต', variant('guard+', { guard: 2.0 })],
  ['ไม่ใช้ผนึกเลย', variant('noseal', { seal: 0 })],
]) {
  const R = runMany(N(2000), (i) => ({ styles: i % 2 ? [v, strong, v, strong] : [strong, v, strong, v], config: RECOMMENDED }));
  let wv = 0; for (const r of R) for (const s of r.winners) if (r.styles[s] === v) wv += 1 / r.winners.length;
  res.ab[label] = pct(wv / R.length);
}
res.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sim-validate.json'), JSON.stringify(res, null, 2));
step('done');
