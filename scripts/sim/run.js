// Balance experiments. Usage: node scripts/sim/run.js [scale]
//   scale multiplies game counts (default 1). Writes docs/sim-results.json
const fs = require('fs');
const path = require('path');
const { playGame } = require('./play');
const { STYLES } = require('./bots');

const SCALE = Number(process.argv[2] || 1);
const N = (k) => Math.round(k * SCALE);
let seed = 1;
const strong = { name: 'strong', ...STYLES.strong };
const variant = (name, over) => ({ ...strong, name, ...over });

function runMany(games, mk) {
  const out = [];
  for (let i = 0; i < games; i++) out.push(playGame({ seed: seed++, ...mk(i) }));
  return out;
}
const pct = (x) => Math.round(x * 1000) / 10;
const avg = (R, f) => R.reduce((a, r) => a + f(r), 0) / R.length;
const ci95 = (p, n) => pct(1.96 * Math.sqrt((p * (1 - p)) / n));

// win share by turn-order position (0 = first player)
function seatTable(R) {
  const n = R[0].n;
  const w = Array(n).fill(0);
  for (const r of R) for (const s of r.winners) w[(s - r.firstSeat + n) % n] += 1 / r.winners.length;
  return w.map((x) => ({ winPct: pct(x / R.length), ci: ci95(x / R.length, R.length) }));
}

function mechanics(R) {
  return {
    rounds: +avg(R, (r) => r.rounds).toFixed(1),
    winnerScore: +avg(R, (r) => Math.max(...r.scores.map((s) => s.total))).toFixed(1),
    seals: +avg(R, (r) => r.stats.seals).toFixed(2),
    curses: +avg(R, (r) => r.stats.curses).toFixed(2),
    reserves: +avg(R, (r) => r.stats.reserves).toFixed(2),
    dragonClaimedPct: pct(avg(R, (r) => (r.stats.dragonClaims > 0 ? 1 : 0))),
    dragonStealsPerGame: +avg(R, (r) => r.stats.dragonSteals).toFixed(2),
    dragonOwnerWinsPct: pct(avg(R.filter((r) => r.dragonOwner !== null), (r) => (r.winners.includes(r.dragonOwner) ? 1 : 0)) || 0),
    guardiansPerGame: +avg(R, (r) => r.stats.guardians).toFixed(2),
    prophecySwingPct: pct(avg(R, (r) => (r.prophecySwing ? 1 : 0))),
    capped: R.filter((r) => r.capped).length,
  };
}

// A/B: 4 players, 2× variant vs 2× strong, alternating seats
function ab(v, config, games) {
  const R = runMany(games, (i) => ({ styles: i % 2 ? [v, strong, v, strong] : [strong, v, strong, v], config }));
  let wv = 0;
  for (const r of R) for (const s of r.winners) if (r.styles[s] === v) wv += 1 / r.winners.length;
  const share = wv / games; // fair = 50%
  return { variantWinPct: pct(share), ci: ci95(share, games), ...mechanics(R) };
}

const results = { generatedAt: new Date().toISOString(), scale: SCALE };
const t0 = Date.now();
const step = (name) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${name}`);

// E1 — seat advantage & baseline mechanics per player count
step('E1 seat advantage');
results.seat = {};
for (const n of [2, 3, 4]) {
  const R = runMany(N(3000), () => ({ styles: Array(n).fill(strong) }));
  results.seat[n] = { seats: seatTable(R), ...mechanics(R) };
}
step('E1b seat advantage with last-seat bonus token');
results.seatFix = {};
for (const n of [2, 3, 4]) {
  const R = runMany(N(3000), () => ({ styles: Array(n).fill(strong), config: { lastSeatBonusToken: true } }));
  results.seatFix[n] = { seats: seatTable(R), ...mechanics(R) };
}

// E2 — style matchups (4p, rotating line-ups)
step('E2 styles');
{
  const names = ['strong', 'balanced', 'points', 'engine', 'sealer', 'dragon'];
  const st = (nm) => (nm === 'strong' ? strong : nm);
  const wins = Object.fromEntries(names.map((s) => [s, 0]));
  const plays = { ...wins };
  const games = N(3000);
  for (let i = 0; i < games; i++) {
    const pool = names.filter((_, k) => k !== i % 6 && k !== (i + 3) % 6);
    const lineup = pool.map((_, j) => pool[(j + i) % 4]);
    const r = playGame({ seed: seed++, styles: lineup.map(st) });
    lineup.forEach((s) => plays[s]++);
    r.winners.forEach((w) => { wins[lineup[w]] += 1 / r.winners.length; });
  }
  results.styles = Object.fromEntries(names.map((s) => [s, pct(wins[s] / plays[s])]));
}

// E3 — seal mechanic: does a seal-happy player beat the same bot that rarely seals?
step('E3 seals');
const sealer = variant('sealer+', { seal: 1.4, deny: 0.6 });
results.seal = {
  'curse1 (ปัจจุบัน)': ab(sealer, {}, N(2000)),
  curse2: ab(sealer, { seal: { maxPerPlayer: 2, curse: 2, ownerWild: true } }, N(2000)),
  'curse1, seal ใช้แทน 2 เม็ด': ab(sealer, { seal: { maxPerPlayer: 2, curse: 1, ownerWild: true, ownerWildCount: 2 } }, N(2000)),
  'curse2, max3': ab(sealer, { seal: { maxPerPlayer: 3, curse: 2, ownerWild: true } }, N(2000)),
};

// E4 — dragon: claim rate & whether chasing it pays
step('E4 dragon');
const hunter = variant('dragon+', { dragon: 1.5 });
results.dragon = {};
for (const [label, cfg] of [
  ['req4 pts4 (ปัจจุบัน)', { dragonReq: 4, dragonPoints: 4 }],
  ['req3 pts4', { dragonReq: 3, dragonPoints: 4 }],
  ['req3 pts3', { dragonReq: 3, dragonPoints: 3 }],
  ['req3 pts5', { dragonReq: 3, dragonPoints: 5 }],
]) results.dragon[label] = ab(hunter, cfg, N(2000));

// E5 — prophecy completion by card (random picks: style "strong" has no preference)
step('E5 prophecies');
{
  const R = runMany(N(4000), (i) => ({ styles: Array(2 + (i % 3)).fill(strong) }));
  const tally = {};
  for (const r of R) for (const p of r.prophecies) {
    tally[p.id] = tally[p.id] || { held: 0, met: 0 };
    tally[p.id].held++; if (p.met) tally[p.id].met++;
  }
  results.prophecy = Object.fromEntries(Object.entries(tally).map(([id, t]) => [id, pct(t.met / t.held)]));
  results.prophecySwingPct = pct(avg(R, (r) => (r.prophecySwing ? 1 : 0)));
}

results.seconds = Math.round((Date.now() - t0) / 1000);
const out = path.join(__dirname, '..', '..', 'docs', 'sim-results.json');
fs.writeFileSync(out, JSON.stringify(results, null, 2));
step(`done → ${out}`);
