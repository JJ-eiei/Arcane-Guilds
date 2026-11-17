// Round 3: last open questions + validation of the recommended config.
// Usage: node scripts/sim/final.js [scale] → docs/sim-final.json
const fs = require('fs');
const path = require('path');
const { playGame } = require('./play');
const { STYLES } = require('./bots');

const SCALE = Number(process.argv[2] || 1);
const N = (k) => Math.max(20, Math.round(k * SCALE));
let seed = 900000;
const strong = { name: 'strong', ...STYLES.strong };
const variant = (name, over) => ({ ...strong, name, ...over });
const pct = (x) => Math.round(x * 1000) / 10;
const avg = (R, f) => R.reduce((a, r) => a + f(r), 0) / R.length;
const runMany = (games, mk) => Array.from({ length: games }, (_, i) => playGame({ seed: seed++, ...mk(i) }));
function seatTable(R) {
  const n = R[0].n; const w = Array(n).fill(0);
  for (const r of R) for (const s of r.winners) w[(s - r.firstSeat + n) % n] += 1 / r.winners.length;
  return w.map((x) => pct(x / R.length));
}
function ab(v, config, games, n = 4) {
  const lineup = (i) => (n === 4 ? (i % 2 ? [v, strong, v, strong] : [strong, v, strong, v]) : (i % 2 ? [v, strong] : [strong, v]));
  const R = runMany(games, (i) => ({ styles: lineup(i), config }));
  let wv = 0;
  for (const r of R) for (const s of r.winners) if (r.styles[s] === v) wv += 1 / r.winners.length;
  return { variantWinPct: pct(wv / games), ci: pct(1.96 * Math.sqrt(0.25 / games)),
    seals: +avg(R, (r) => r.stats.seals).toFixed(2), curses: +avg(R, (r) => r.stats.curses).toFixed(2),
    dragonClaimedPct: pct(avg(R, (r) => (r.stats.dragonClaims ? 1 : 0))), steals: +avg(R, (r) => r.stats.dragonSteals).toFixed(2) };
}
const t0 = Date.now();
const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const res = {};

const PROPH = {
  'p-fire': { min: 4 }, 'p-water': { min: 4 }, 'p-earth': { min: 4 }, 'p-wind': { min: 4 }, 'p-light': { min: 4 },
  'p-legend': { min: 1, points: 2 }, 'p-sealer': { min: 2 },
};
const BASE = {
  dragonReq: 3, dragonPoints: 4,
  seal: { maxPerPlayer: 2, curse: 1, ownerWild: true, ownerWildCount: 1, takeWith: 2 },
  prophecy: PROPH,
};
const hunter = variant('dragon+', { dragon: 1.5 });

step('dragon steal on tie');
res.dragon = {};
for (const [label, cfg] of [
  ['req3 pts4', {}], ['req3 pts4 tieSteal', { dragonStealOnTie: true }],
  ['req3 pts3 tieSteal', { dragonStealOnTie: true, dragonPoints: 3 }],
]) {
  const c = { ...BASE, ...cfg };
  const all = runMany(N(1500), () => ({ styles: [hunter, hunter, hunter, hunter], config: c }));
  res.dragon[label] = { ...ab(hunter, c, N(2000)), allHuntersSteals: +avg(all, (r) => r.stats.dragonSteals).toFixed(2) };
}

step('prophecy thresholds v2');
res.prophecy = {};
for (const [label, extra] of [
  ['balance3 trainee11', { 'p-balance': { min: 3 }, 'p-trainee': { min: 11 } }],
  ['balance3 trainee12', { 'p-balance': { min: 3 }, 'p-trainee': { min: 12 } }],
]) {
  const R = runMany(N(3000), (i) => ({ styles: Array(2 + (i % 3)).fill(strong), config: { ...BASE, prophecy: { ...PROPH, ...extra } } }));
  const t = {};
  for (const r of R) for (const p of r.prophecies) { t[p.id] = t[p.id] || [0, 0]; t[p.id][0]++; if (p.met) t[p.id][1]++; }
  res.prophecy[label] = Object.fromEntries(Object.entries(t).sort().map(([k, [h, m]]) => [k, pct(m / h)]));
}
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sim-final.json'), JSON.stringify(res, null, 2));
step('done part 1');
