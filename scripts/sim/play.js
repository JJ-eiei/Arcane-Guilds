// Plays one bot game and returns a compact record.
const G = require('../../server/games/arcane/engine');
const { makeBot } = require('./bots');

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame({ styles, seed, config }) {
  const n = styles.length;
  const rand = mulberry(seed * 2654435761);
  const bots = styles.map((s) => makeBot(s, rand));
  const state = G.setup(styles.map((s, i) => ({ id: `b${i}`, name: String(s.name || s) })), { seed, config });
  for (let i = 0; i < n; i++) {
    const err = G.move(state, i, bots[i].act(state, i));
    if (err) throw new Error(`prophecy: ${err}`);
  }
  let guard = 0;
  while (state.phase !== 'over') {
    const seat = state.turn;
    const m = bots[seat].act(state, seat);
    const err = G.move(state, seat, m);
    if (err) throw new Error(`seat ${seat} ${JSON.stringify(m)}: ${err}`);
    if (++guard > 5000) throw new Error('runaway game');
  }
  const r = state.result;
  // prophecy swing: would the winner change without prophecies?
  const pubBest = Math.max(...r.scores.map((s) => s.public));
  const pubWinners = r.scores.filter((s) => s.public === pubBest).map((s) => s.seat);
  return {
    n, seed, styles,
    firstSeat: state.firstSeat,
    winners: r.winners,
    rounds: r.turns / n,
    capped: r.capped,
    scores: r.scores,
    stats: state.stats,
    dragonOwner: state.dragon.owner,
    prophecies: state.players.map((p, i) => ({ id: p.prophecy, met: r.scores[i].prophecy > 0 })),
    prophecySwing: !pubWinners.includes(r.winners[0]) || pubWinners.length !== r.winners.length,
    guardiansTaken: state.players.map((p) => p.guardians.length),
    events: state.stats.events,
  };
}

module.exports = { playGame };
