// Round 5: re-fit seat compensation + dragon points + seal wild under the full config.
const fs = require('fs'); const path = require('path');
const { playGame } = require('./play'); const { STYLES } = require('./bots');
const REC = require('./recommended');
const SCALE = Number(process.argv[2] || 1); const N = (k) => Math.max(20, Math.round(k * SCALE));
let seed = 1700000;
const strong = { name: 'strong', ...STYLES.strong }; const variant = (name, o) => ({ ...strong, name, ...o });
const pct = (x) => Math.round(x * 1000) / 10;
const runMany = (g, mk) => Array.from({ length: g }, (_, i) => playGame({ seed: seed++, ...mk(i) }));
const seatTable = (R) => { const n = R[0].n; const w = Array(n).fill(0); for (const r of R) for (const s of r.winners) w[(s - r.firstSeat + n) % n] += 1 / r.winners.length; return w.map((x) => pct(x / R.length)); };
const ab = (v, cfg, g) => { const R = runMany(g, (i) => ({ styles: i % 2 ? [v, strong, v, strong] : [strong, v, strong, v], config: cfg })); let w = 0; for (const r of R) for (const s of r.winners) if (r.styles[s] === v) w += 1 / r.winners.length; return pct(w / g); };
const t0 = Date.now(); const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const res = { seats: {}, dragonPts: {}, seal: {} };
step('seats');
for (const [n, schemes] of [[2, [[0, 0], [0, 1]]], [3, [[0, 0, 0], [0, 0, 1], [0, 1, 1]]], [4, [[0, 0, 0, 0], [0, 0, 1, 1], [0, 1, 1, 1], [0, 1, 0, 1]]]]) {
  res.seats[n] = {};
  for (const sc of schemes) res.seats[n][sc.join('-')] = seatTable(runMany(N(3000), () => ({ styles: Array(n).fill(strong), config: { ...REC, startTokensByPlayers: { [n]: sc } } })));
}
step('dragon points');
const hunter = variant('dragon+', { dragon: 1.5 });
for (const p of [3, 4]) res.dragonPts[p] = ab(hunter, { ...REC, dragonPoints: p }, N(2000));
step('seal wild 2');
const sealer = variant('sealer+', { seal: 1.4, deny: 0.6 });
res.seal['ownerWild1'] = ab(sealer, REC, N(2000));
res.seal['ownerWild2'] = ab(sealer, { ...REC, seal: { ...REC.seal, ownerWildCount: 2 } }, N(2000));
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sim-refit.json'), JSON.stringify(res, null, 2));
step('done');
