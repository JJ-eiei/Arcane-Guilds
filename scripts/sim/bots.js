// Heuristic bots for Arcane Guilds — used for balance simulation (and later
// optionally to fill empty seats). Each bot sees only G.view(state, seat):
// it never peeks at other players' prophecies, blind reserves or deck order.
//
// One evaluator, different weights per style:
//   balanced · points · engine · dragon · strong

const G = require('../../server/games/arcane/engine');
const { ELEMENTS } = require('../../server/games/arcane/data');

const STYLES = {
  balanced: { pts: 1.0, bonus: 0.35, guard: 0.6, dragon: 0.4, proph: 0.5, deny: 0.6, reserve: 0.5 },
  points:   { pts: 1.4, bonus: 0.20, guard: 0.3, dragon: 0.2, proph: 0.4, deny: 0.4, reserve: 0.6 },
  engine:   { pts: 0.7, bonus: 0.60, guard: 1.0, dragon: 0.5, proph: 0.6, deny: 0.3, reserve: 0.3 },
  dragon:   { pts: 0.9, bonus: 0.35, guard: 0.4, dragon: 1.6, proph: 0.5, deny: 0.5, reserve: 0.4 },
  // tuned by self-play hill-climbing (scripts/sim/hill.js) — strongest so far
  strong:   { pts: 0.46, bonus: 0.69, guard: 1.24, dragon: 0.44, proph: 0.38, deny: 0.3, reserve: 0.15 },
};

const PROPHECY_PREF = {
  points: ['p-legend'], engine: ['p-trainee', 'p-balance', 'p-spirits'],
  dragon: ['p-dragon'], balanced: ['p-spirits', 'p-balance'],
};

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function makeBot(style, rand = Math.random) {
  // style: a name from STYLES, or { name, ...weights }
  const styleName = typeof style === 'string' ? style : style.name || 'custom';
  const W = typeof style === 'string' ? STYLES[style] : { ...STYLES.balanced, ...style };
  if (!W) throw new Error(`unknown style ${style}`);

  // --- valuation helpers (from the bot's own view) ---
  function context(view, seat) {
    const me = view.players[seat];
    const b = me.bonuses;
    const t = me.tokens;
    const w = Object.fromEntries(ELEMENTS.map((e) => [e, 1]));

    // guardians still on the table
    for (const gid of view.guardians) {
      const req = G.GUARDIAN[gid].req;
      const rem = Object.entries(req).reduce((a, [e, n]) => a + Math.max(0, n - b[e]), 0);
      for (const [e, n] of Object.entries(req)) if (b[e] < n) w[e] += W.guard * 3 / (1 + rem);
    }
    // dragon
    const dr = { req: G.dragonReq(view.config, view.dragon.id) };
    if (view.dragon.owner !== seat) {
      const rem = Object.entries(dr.req).reduce((a, [e, n]) => a + Math.max(0, n - b[e]), 0);
      for (const e of Object.keys(dr.req)) w[e] += W.dragon * 4 / (1 + rem);
    } else {
      // defend: keep growing the dragon colours a little
      for (const e of Object.keys(dr.req)) w[e] += W.dragon * 0.3;
    }
    // prophecy
    const pr = me.prophecy && { ...G.PROPHECY[me.prophecy], ...((view.config.prophecy || {})[me.prophecy] || {}) };
    if (pr) {
      if (pr.kind === 'elementBonus' && b[pr.element] < pr.min) w[pr.element] += W.proph * 2;
      if (pr.kind === 'allBonus') for (const e of ELEMENTS) if (b[e] < pr.min) w[e] += W.proph * 1.5;
      if (pr.kind === 'dragon') for (const e of Object.keys(dr.req)) w[e] += W.proph * 1.5;
    }

    const cardValue = (id) => {
      const c = G.CARD[id];
      let v = W.pts * c.points + W.bonus * w[c.bonus];
      if (pr && pr.kind === 'levelCount' && pr.level === c.level) v += W.proph * 0.8;
      // late game: points matter more
      const lead = Math.max(...view.players.map((p) => p.points));
      if (lead >= 10) v += c.points * 0.5;
      return v;
    };
    const effCost = (id) => ELEMENTS.reduce((a, e) => a + Math.max(0, (G.CARD[id].cost[e] || 0) - b[e]), 0);
    const shortage = (id, tok = t, bon = b) => {
      let s = 0;
      for (const e of ELEMENTS) s += Math.max(0, (G.CARD[id].cost[e] || 0) - bon[e] - tok[e]);
      return Math.max(0, s - tok.star);
    };
    const marketIds = [1, 2, 3].flatMap((lv) => view.market[lv].filter(Boolean));
    const myReserved = me.reserved.map((r) => r.id).filter(Boolean);
    const candidates = [...marketIds, ...myReserved];
    const targets = candidates
      .map((id) => ({ id, v: cardValue(id), s: shortage(id), c: effCost(id) }))
      .filter((x) => x.s > 0)
      .map((x) => ({ ...x, p: x.v / (1 + x.s) / (1 + 0.12 * x.c) }))
      .sort((a, b2) => b2.p - a.p)
      .slice(0, 3);
    return { me, b, t, w, cardValue, effCost, shortage, marketIds, myReserved, targets };
  }

  function tokenNeed(ctx) {
    // how much each colour is wanted by the top targets
    const need = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
    ctx.targets.forEach((x, i) => {
      const f = [1, 0.5, 0.25][i] * x.v;
      for (const e of ELEMENTS) {
        const miss = Math.max(0, (G.CARD[x.id].cost[e] || 0) - ctx.b[e] - ctx.t[e]);
        if (miss > 0) need[e] += f * Math.min(miss, 2) / (1 + x.c);
      }
    });
    return need;
  }

  function scoreMove(view, seat, m, ctx, need) {
    const tokCount = sum(ctx.t);
    switch (m.type) {
      case 'buy': {
        let v = ctx.cardValue(m.cardId) + 0.6;
        if (ctx.myReserved.includes(m.cardId)) v += 0.3; // frees a reserve slot
        return v;
      }
      case 'take': {
        let v = 0;
        const left = { ...need };
        for (const c of m.colors) { v += left[c]; left[c] *= 0.5; }
        v *= 0.5;
        const over = tokCount + m.colors.length - view.config.tokenLimit;
        if (over > 0) v -= over * 0.35;
        return v + 0.05 * m.colors.length;
      }
      case 'reserve': {
        if (ctx.me.reserved.length >= 2) return -1; // keep a slot free
        const star = view.supply.star > 0 ? 0.35 : 0;
        if (m.deck) return W.reserve * 0.25 + star - 0.2;
        const c = G.CARD[m.cardId];
        let v = W.reserve * ctx.cardValue(m.cardId) * 0.35 + star;
        // deny: an opponent can afford a juicy card right now
        for (const p of view.players) {
          if (p.seat === seat) continue;
          if (ctx.shortage(m.cardId, p.tokens, p.bonuses) === 0 && c.points >= 3) v += W.deny * c.points * 0.35;
        }
        if (c.points === 0) v -= 0.4;
        return v;
      }
      case 'pass': return -10;
      default: return -10;
    }
  }

  function chooseDiscard(view, seat) {
    const ctx = context(view, seat);
    const need = tokenNeed(ctx);
    let over = sum(ctx.t) - view.config.tokenLimit;
    const tokens = {};
    const left = { ...ctx.t };
    while (over > 0) {
      // drop the least-needed colour (star last)
      const opts = ELEMENTS.filter((e) => left[e] > 0).sort((a, b2) => need[a] - need[b2] || left[b2] - left[a]);
      const pick = opts[0] || 'star';
      left[pick]--; tokens[pick] = (tokens[pick] || 0) + 1; over--;
    }
    return { type: 'discard', tokens };
  }

  function chooseProphecy(view, seat) {
    const opts = view.players[seat].prophecyOptions;
    const pref = PROPHECY_PREF[styleName] || [];
    const hit = opts.find((id) => pref.includes(id));
    return { type: 'chooseProphecy', id: hit || opts[Math.floor(rand() * opts.length)] };
  }

  function act(state, seat) {
    const view = G.view(state, seat);
    if (view.phase === 'prophecy') return chooseProphecy(view, seat);
    if (view.phase === 'discard') return chooseDiscard(view, seat);
    if (view.phase === 'guardian') return { type: 'chooseGuardian', id: view.pendingGuardians[0] };
    const moves = G.legalMoves(state, seat);
    const ctx = context(view, seat);
    const need = tokenNeed(ctx);
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const sc = scoreMove(view, seat, m, ctx, need) + rand() * 0.08;
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    return best;
  }

  return { style: styleName, act };
}

module.exports = { makeBot, STYLES };
