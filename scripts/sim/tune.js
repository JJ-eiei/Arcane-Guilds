// Round 2: test candidate fixes found in round 1.
// Usage: node scripts/sim/tune.js [scale]  → docs/sim-tune.json
const fs = require('fs');
const path = require('path');
const { playGame } = require('./play');
const { STYLES } = require('./bots');

const SCALE = Number(process.argv[2] || 1);
const N = (k) => Math.max(20, Math.round(k * SCALE));
let seed = 500000;
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
function ab(v, config, games) {
  const R = runMany(games, (i) => ({ styles: i % 2 ? [v, strong, v, strong] : [strong, v, strong, v], config }));
  let wv = 0;
  for (const r of R) for (const s of r.winners) if (r.styles[s] === v) wv += 1 / r.winners.length;
  return {
    variantWinPct: pct(wv / games),
    seals: +avg(R, (r) => r.stats.seals).toFixed(2), curses: +avg(R, (r) => r.stats.curses).toFixed(2),
    dragonClaimedPct: pct(avg(R, (r) => (r.stats.dragonClaims ? 1 : 0))), steals: +avg(R, (r) => r.stats.dragonSteals).toFixed(2),
    rounds: +avg(R, (r) => r.rounds).toFixed(1),
  };
}
const t0 = Date.now();
const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const res = {};

step('A seat compensation');
res.seat = {};
for (const [n, schemes] of [[2, [null, [0, 1]]], [3, [null, [0, 1, 1], [0, 1, 2]]], [4, [null, [0, 1, 1, 2], [0, 1, 2, 2], [0, 1, 2, 3]]]]) {
  res.seat[n] = {};
  for (const sc of schemes) {
    const R = runMany(N(3000), () => ({ styles: Array(n).fill(strong), config: sc ? { startTokens: sc } : {} }));
    res.seat[n][sc ? sc.join('-') : 'none'] = seatTable(R);
  }
}

step('B seals: seal action also takes crystals');
const sealer = variant('sealer+', { seal: 1.4, deny: 0.6 });
res.seal = {};
for (const [label, seal] of [
  ['takeWith2 curse1', { maxPerPlayer: 2, curse: 1, ownerWild: true, takeWith: 2 }],
  ['takeWith2 curse2', { maxPerPlayer: 2, curse: 2, ownerWild: true, takeWith: 2 }],
  ['takeWith1 curse1', { maxPerPlayer: 2, curse: 1, ownerWild: true, takeWith: 1 }],
  ['takeWith1 curse2', { maxPerPlayer: 2, curse: 2, ownerWild: true, takeWith: 1 }],
]) res.seal[label] = ab(sealer, { seal }, N(2000));

step('C dragon contest (all hunters)');
const hunter = variant('dragon+', { dragon: 1.5 });
res.dragonAllHunters = {};
for (const [label, cfg] of [['req3 pts4', { dragonReq: 3 }], ['req4 pts4', { dragonReq: 4 }]]) {
  const R = runMany(N(1500), () => ({ styles: [hunter, hunter, hunter, hunter], config: cfg }));
  res.dragonAllHunters[label] = { claimedPct: pct(avg(R, (r) => (r.stats.dragonClaims ? 1 : 0))), steals: +avg(R, (r) => r.stats.dragonSteals).toFixed(2) };
}

step('D prophecy thresholds');
const P = {
  'p-fire': { min: 4 }, 'p-water': { min: 4 }, 'p-earth': { min: 4 }, 'p-wind': { min: 4 }, 'p-light': { min: 4 },
  'p-trainee': { min: 9 }, 'p-legend': { min: 1, points: 2 }, 'p-sealer': { min: 2 },
};
res.prophecy = {};
for (const [label, cfg] of [
  ['current', {}],
  ['tuned', { prophecy: P, dragonReq: 3, seal: { maxPerPlayer: 2, curse: 1, ownerWild: true, takeWith: 2 } }],
]) {
  const R = runMany(N(4000), (i) => ({ styles: Array(2 + (i % 3)).fill(strong), config: cfg }));
  const t = {};
  for (const r of R) for (const p of r.prophecies) { t[p.id] = t[p.id] || [0, 0]; t[p.id][0]++; if (p.met) t[p.id][1]++; }
  res.prophecy[label] = Object.fromEntries(Object.entries(t).sort().map(([k, [h, m]]) => [k, pct(m / h)]));
  res.prophecy[label].swingPct = pct(avg(R, (r) => (r.prophecySwing ? 1 : 0)));
}
res.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sim-tune.json'), JSON.stringify(res, null, 2));
step('done');
