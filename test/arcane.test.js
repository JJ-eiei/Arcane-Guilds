// Rule-by-rule tests for the Arcane Guilds engine.
// Section numbers refer to docs/arcane-guilds-design.md
const test = require('node:test');
const assert = require('node:assert');
const G = require('../server/games/arcane/engine');
const D = require('../server/games/arcane/data');

const { ELEMENTS } = D;
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

// A started game with prophecies picked, seat 0 to move.
// Turn-order compensation is switched off here so token counts are exact;
// it has its own test.
function game(n = 2, seed = 1, config) {
  const s = G.setup(P(n), { seed, skipProphecyPick: true, config: { startTokens: Array(n).fill(0), omens: { perLevel: {} }, ...config } });
  s.firstSeat = 0; s.turn = 0;
  return s;
}
const ok = (s, seat, m) => { const e = G.move(s, seat, m); assert.equal(e, undefined, `move failed: ${e} ${JSON.stringify(m)}`); };
const bad = (s, seat, m, re) => { const e = G.move(s, seat, m); assert.ok(e, 'expected rejection'); if (re) assert.match(e, re); };
const give = (s, seat, tokens) => { for (const [k, v] of Object.entries(tokens)) { s.players[seat].tokens[k] += v; s.supply[k] -= v; } };
const giveCards = (s, seat, ids) => { s.players[seat].cards.push(...ids); };
const cardsOf = (el, n, level = 1) => D.CARDS.filter((c) => c.bonus === el && c.level === level).slice(0, n).map((c) => c.id);
const putInMarket = (s, id) => {
  // swap a specific card into market slot 0 of its level (from wherever it is)
  const lv = G.CARD[id].level;
  for (const L of [1, 2, 3]) { s.decks[L] = s.decks[L].filter((x) => x !== id); s.market[L] = s.market[L].map((x) => (x === id ? s.decks[L].pop() : x)); }
  const old = s.market[lv][0]; s.market[lv][0] = id; if (old) s.decks[lv].unshift(old);
};
const totalTokens = (s) => {
  const t = Object.fromEntries(G.TOKEN_TYPES.map((k) => [k, s.supply[k]]));
  for (const p of s.players) for (const k of G.TOKEN_TYPES) t[k] += p.tokens[k];
  return t;
};

// ---------------------------------------------------------------- §3 setup
test('§3 setup: supply by player count, market, guardians, dragon, prophecy options', () => {
  for (const [n, per] of [[2, 4], [3, 5], [4, 7]]) {
    const s = G.setup(P(n), { seed: n });
    for (const e of ELEMENTS) assert.equal(s.supply[e] + s.players.reduce((a, p) => a + p.tokens[e], 0), per);
    assert.equal(s.supply.star, 5);
    for (const lv of [1, 2, 3]) assert.equal(s.market[lv].filter(Boolean).length, 4);
    assert.equal(s.guardians.length, n + 1);
    assert.ok(s.dragon.id && s.dragon.owner === null);
    assert.equal(s.phase, 'prophecy');
    for (const p of s.players) assert.equal(p.prophecyOptions.length, 2);
    const all = s.players.flatMap((p) => p.prophecyOptions);
    assert.equal(new Set(all).size, all.length, 'no prophecy dealt twice');
  }
  assert.throws(() => G.setup(P(1)));
  assert.throws(() => G.setup(P(5)));
});

test('§3 same seed → same game (reproducible)', () => {
  const a = G.setup(P(3), { seed: 42 }); const b = G.setup(P(3), { seed: 42 });
  assert.deepEqual(a.market, b.market); assert.equal(a.firstSeat, b.firstSeat);
});

test('§3.5 prophecy pick: hidden, one each, game starts when all chose', () => {
  const s = G.setup(P(2), { seed: 3 });
  assert.equal(G.currentTurn(s), null);
  bad(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] }, /คำทำนาย/);
  bad(s, 0, { type: 'chooseProphecy', id: s.players[1].prophecyOptions[0] }, /ไม่มีคำทำนาย/);
  ok(s, 1, { type: 'chooseProphecy', id: s.players[1].prophecyOptions[1] });
  bad(s, 1, { type: 'chooseProphecy', id: s.players[1].prophecyOptions[0] }, /ไปแล้ว/);
  assert.equal(s.phase, 'prophecy');
  ok(s, 0, { type: 'chooseProphecy', id: s.players[0].prophecyOptions[0] });
  assert.equal(s.phase, 'action');
  assert.equal(G.currentTurn(s), s.firstSeat);
});

// ---------------------------------------------------------------- §4 actions
test('§4A take 3 different elements; reject duplicates, star, wrong turn', () => {
  const s = game();
  bad(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] }, /ยังไม่ถึงตา/);
  bad(s, 0, { type: 'take', colors: ['fire', 'fire', 'earth'] });
  bad(s, 0, { type: 'take', colors: ['fire', 'water', 'star'] }, /ดวงดาว/);
  bad(s, 0, { type: 'take', colors: ['fire', 'water'] }, /3 ธาตุ/);
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.deepEqual([s.players[0].tokens.fire, s.supply.fire], [1, 3]);
  assert.equal(s.turn, 1);
});

test('§4A may take fewer than 3 only when fewer elements are available', () => {
  const s = game();
  for (const e of ['fire', 'water', 'earth']) { s.supply[e] = 0; }
  ok(s, 0, { type: 'take', colors: ['wind', 'light'] });
});

test('§4B take 2 same only when supply ≥ 4', () => {
  const s = game(2); // 4 per element
  ok(s, 0, { type: 'take', colors: ['fire', 'fire'] });
  bad(s, 1, { type: 'take', colors: ['fire', 'fire'] }, /≥ 4/);
});

test('§4C reserve from market or blind from deck, gets star, max 3, card refilled', () => {
  const s = game();
  const id = s.market[2][1];
  ok(s, 0, { type: 'reserve', cardId: id });
  assert.equal(s.players[0].tokens.star, 1);
  assert.equal(s.market[2].includes(id), false);
  assert.equal(s.market[2].filter(Boolean).length, 4, 'refilled');
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  ok(s, 0, { type: 'reserve', deck: 3 });
  assert.equal(s.players[0].reserved[1].hidden, true);
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  s.supply.star = 0;
  ok(s, 0, { type: 'reserve', deck: 1 }); // allowed with no gold left
  assert.equal(s.players[0].tokens.star, 2);
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  bad(s, 0, { type: 'reserve', deck: 1 }, /สูงสุด 3/);
});

test('§4D buy with bonuses as discount, star as wild, from market and reserve', () => {
  const s = game();
  const card = D.CARDS.find((c) => c.id === 'fi14'); // ✨3, 0 pts
  putInMarket(s, 'fi14');
  bad(s, 0, { type: 'buy', cardId: 'fi14' }, /ไม่พอ/);
  give(s, 0, { light: 2, star: 1 });
  const supplyLight = s.supply.light;
  ok(s, 0, { type: 'buy', cardId: 'fi14' });
  assert.deepEqual(s.players[0].cards, ['fi14']);
  assert.equal(s.players[0].tokens.light, 0);
  assert.equal(s.players[0].tokens.star, 0);
  assert.equal(s.supply.light, supplyLight + 2);
  assert.equal(G.bonuses(s, 0).fire, 1);
  assert.equal(card.cost.light, 3);

  // bonuses discount: 3 light bonuses → wa?? card costing light only is free
  const t = game();
  giveCards(t, 0, cardsOf('light', 3));
  const lightOnly = D.CARDS.find((c) => Object.keys(c.cost).length === 1 && c.cost.light === 3);
  putInMarket(t, lightOnly.id);
  ok(t, 0, { type: 'buy', cardId: lightOnly.id });
  assert.equal(G.sumTokens(t.players[0].tokens), 0);

  // buy from reserve
  const r = game();
  ok(r, 0, { type: 'reserve', cardId: r.market[1][0] });
  const rid = r.players[0].reserved[0].id;
  ok(r, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  give(r, 0, G.CARD[rid].cost);
  ok(r, 0, { type: 'buy', cardId: rid });
  assert.equal(r.players[0].reserved.length, 0);
  // can't buy someone else's reserve / random id
  bad(r, 1, { type: 'buy', cardId: 'zz99' });
});

test('§4 10-token limit: must discard exactly the excess, star counts', () => {
  const s = game(4);
  give(s, 0, { fire: 3, water: 3, star: 2 });
  ok(s, 0, { type: 'take', colors: ['earth', 'wind', 'light'] }); // 11
  assert.equal(s.phase, 'discard');
  assert.equal(s.turn, 0);
  assert.equal(G.view(s, 0).discardNeeded, 1);
  bad(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] }, /คืนผลึก/);
  bad(s, 0, { type: 'discard', tokens: { fire: 2 } }, /1 เม็ดพอดี/);
  bad(s, 1, { type: 'discard', tokens: { fire: 1 } }, /ยังไม่ถึงตา/);
  ok(s, 0, { type: 'discard', tokens: { star: 1 } });
  assert.equal(G.sumTokens(s.players[0].tokens), 10);
  assert.equal(s.turn, 1);
});

// ---------------------------------------------------------------- §4 guardians
test('§4.2 guardian: auto when one qualifies, choice when several, one per turn', () => {
  const s = game(2);
  const g = s.guardians[0];
  for (const [e, n] of Object.entries(G.GUARDIAN[g].req)) giveCards(s, 0, cardsOf(e, n));
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.ok(s.players[0].guardians.includes(g));
  assert.equal(s.players[0].guardians.length, 1);

  const t = game(3);
  for (const e of ELEMENTS) giveCards(t, 0, cardsOf(e, 3)); // meets every guardian
  ok(t, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(t.phase, 'guardian');
  assert.equal(t.pendingGuardians.length, 4);
  bad(t, 0, { type: 'chooseGuardian', id: 'nope' });
  const pick = t.pendingGuardians[2];
  ok(t, 0, { type: 'chooseGuardian', id: pick });
  assert.deepEqual(t.players[0].guardians, [pick]);
  assert.equal(t.turn, 1);
  assert.equal(t.guardians.length, 3);
});

test('§6 dragon (stealOnTie off): first to qualify claims; strictly stronger steals; ties do not', () => {
  const s = game(3, 1, { dragonStealOnTie: false });
  const dr = G.DRAGON[s.dragon.id];
  const [e1, e2] = Object.keys(dr.req);
  giveCards(s, 0, [...cardsOf(e1, 4), ...cardsOf(e2, 4)]);
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.dragon.owner, 0);

  giveCards(s, 1, [...cardsOf(e1, 4), ...cardsOf(e2, 4)]); // equal strength
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.dragon.owner, 0, 'tie does not steal');

  giveCards(s, 2, [...cardsOf(e1, 5), ...cardsOf(e2, 4)]); // stronger
  ok(s, 2, { type: 'take', colors: ['wind', 'light', 'water'] });
  assert.equal(s.dragon.owner, 2);
  assert.equal(G.publicPoints(s, 2) >= 4, true);

  // stronger in total but missing the requirement → no steal
  const t = game(2, 1, { dragonReq: 4 });
  const d2 = G.DRAGON[t.dragon.id];
  const [a, b] = Object.keys(d2.req);
  giveCards(t, 0, [...cardsOf(a, 4), ...cardsOf(b, 4)]);
  ok(t, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  giveCards(t, 1, [...cardsOf(a, 8), ...cardsOf(b, 3)]);
  ok(t, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(t.dragon.owner, 0);
});

// ---------------------------------------------------------------- §7/§8 end + scoring
test('§8 reaching 15 finishes the round; prophecy only counts at the end; tie → fewer cards', () => {
  const s = game(3);
  s.firstSeat = 0;
  // seat 1 reaches 15 public points mid-round
  const l3 = D.CARDS.filter((c) => c.level === 3 && c.points === 5).slice(0, 3).map((c) => c.id);
  giveCards(s, 1, l3);
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.finalRound, true);
  assert.equal(s.phase, 'action', 'round continues');
  ok(s, 2, { type: 'take', colors: ['wind', 'light', 'water'] });
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.winners, [1]);
  assert.equal(G.isOver(s), true);
  bad(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] }, /จบแล้ว/);
});

test('§8 prophecy can swing the winner', () => {
  const s = game(2);
  s.players[0].prophecy = 'p-fire';
  s.players[1].prophecy = 'p-water';
  const fiveFire = D.CARDS.filter((c) => c.bonus === 'fire' && c.level === 1 && c.points === 0).slice(0, 5).map((c) => c.id);
  giveCards(s, 0, [...fiveFire, 'li34', 'wa34']);           // 10 public, prophecy met (+3)
  giveCards(s, 1, ['ea34', 'wi34', 'fi23']);                // 12 public, prophecy not met
  assert.equal(G.publicPoints(s, 0), 10);
  assert.equal(G.publicPoints(s, 1), 12);
  s.finalRound = true; s.firstSeat = 0;
  ok(s, 0, { type: 'take', colors: ['wind', 'light', 'water'] });
  ok(s, 1, { type: 'take', colors: ['wind', 'light', 'fire'] });
  assert.equal(s.phase, 'over');
  assert.equal(s.result.scores[0].total, 13);
  assert.equal(s.result.scores[1].total, 12);
  assert.deepEqual(s.result.winners, [0]);
});

test('§8 tie → fewest cards wins; full tie is shared', () => {
  const s = game(2);
  s.players[0].prophecy = s.players[1].prophecy = 'p-legend';
  giveCards(s, 0, ['li34', 'wa34']);                        // 10 pts, 2 cards
  giveCards(s, 1, ['ea34', 'wi23', 'wi24', 'fi12']);        // 5+2+2+0 = 9 → add 1
  giveCards(s, 1, ['ea18']);                                // 10 pts, 5 cards
  assert.equal(G.publicPoints(s, 1), 10);
  s.finalRound = true; s.firstSeat = 0;
  ok(s, 0, { type: 'take', colors: ['wind', 'light', 'water'] });
  ok(s, 1, { type: 'take', colors: ['wind', 'light', 'fire'] });
  assert.deepEqual(s.result.winners, [0]);

  const t = game(2);
  t.players[0].prophecy = t.players[1].prophecy = 'p-legend';
  giveCards(t, 0, ['li34', 'wa34']);
  giveCards(t, 1, ['ea34', 'wi34']);
  t.finalRound = true; t.firstSeat = 0;
  ok(t, 0, { type: 'take', colors: ['wind', 'light', 'water'] });
  ok(t, 1, { type: 'take', colors: ['wind', 'light', 'fire'] });
  assert.deepEqual(t.result.winners, [0, 1]);
});

test('§7 every prophecy kind evaluates', () => {
  const s = game(2);
  const p = s.players[0];
  const check = (id) => { p.prophecy = id; return G.scoreOf(s, 0).prophecy > 0; };
  assert.equal(check('p-balance'), false);
  for (const e of ELEMENTS) giveCards(s, 0, cardsOf(e, 2));
  assert.equal(check('p-balance'), true);
  assert.equal(check('p-trainee'), false); // 10 L1 cards < 12
  giveCards(s, 0, D.CARDS.filter((c) => c.level === 1 && c.bonus === 'light').slice(2, 4).map((c) => c.id));
  assert.equal(check('p-trainee'), true);  // 12
  assert.equal(check('p-legend'), false);
  giveCards(s, 0, D.CARDS.filter((c) => c.level === 3).slice(0, 2).map((c) => c.id));
  assert.equal(check('p-legend'), true);
  assert.equal(check('p-spirits'), false);
  p.guardians = ['g31', 'g32'];
  assert.equal(check('p-spirits'), true);
  assert.equal(check('p-dragon'), false);
  s.dragon.owner = 0;
  assert.equal(check('p-dragon'), true);
  assert.equal(check('p-summoner'), false);
  giveCards(s, 0, D.CARDS.filter((c) => c.level === 2).slice(0, 4).map((c) => c.id));
  assert.equal(check('p-summoner'), true);
});

// ---------------------------------------------------------------- §9 hidden info
test('§9 view hides others\' prophecy and blind reserves until game over', () => {
  const s = game(2);
  ok(s, 0, { type: 'reserve', deck: 2 });
  ok(s, 1, { type: 'reserve', cardId: s.market[1][0] });
  const v1 = G.view(s, 1);
  assert.equal(v1.players[0].prophecy, null);
  assert.equal(v1.players[0].prophecyChosen, true);
  assert.deepEqual(v1.players[0].reserved[0], { id: null, hidden: true, level: 2 });
  assert.ok(v1.players[1].prophecy, 'own prophecy visible');
  const v0 = G.view(s, 0);
  assert.ok(v0.players[0].reserved[0].id, 'own blind reserve visible');
  assert.ok(v0.players[1].reserved[0].id, 'market reserve is public');
  const spectator = G.view(s, null);
  assert.equal(spectator.players[0].prophecy, null);
  assert.equal(spectator.players[1].prophecy, null);
  assert.equal(JSON.stringify(spectator).includes('"decks"'), false, 'deck order never sent');
  // during prophecy phase only my options are sent
  const t = G.setup(P(3), { seed: 9 });
  const tv = G.view(t, 1);
  assert.ok(tv.players[1].prophecyOptions);
  assert.equal(tv.players[0].prophecyOptions, undefined);
});

// ---------------------------------------------------------------- robustness
test('rejects junk input', () => {
  const s = game();
  for (const m of [null, 5, 'x', {}, { type: 'nope' }, { type: 'take' }, { type: 'take', colors: 'fire' },
    { type: 'buy' }, { type: 'reserve' }, { type: 'reserve', deck: 9 }, { type: 'seal' },
    { type: 'discard', tokens: { fire: -1 } }, { type: 'pass' }]) {
    assert.ok(G.move(s, 0, m), `should reject ${JSON.stringify(m)}`);
  }
  assert.equal(s.turn, 0);
});

test('fuzz: 300 random games (2–4p) — invariants hold and games end', () => {
  let ended = 0;
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 3);
    const s = G.setup(P(n), { seed: 1000 + g });
    const initial = totalTokens(s);
    let rnd = g * 7919 + 1;
    const r = (k) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % k; };
    for (let i = 0; i < n; i++) ok(s, i, { type: 'chooseProphecy', id: s.players[i].prophecyOptions[r(2)] });
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 5000) {
      const seat = s.turn;
      let m;
      if (s.phase === 'discard') {
        let over = G.sumTokens(s.players[seat].tokens) - s.config.tokenLimit;
        const tokens = {};
        for (const t of G.TOKEN_TYPES) { const k = Math.min(over, s.players[seat].tokens[t]); if (k) { tokens[t] = k; over -= k; } }
        m = { type: 'discard', tokens };
      } else {
        const moves = G.legalMoves(s, seat);
        // prefer buying to make games finish
        const buys = moves.filter((x) => x.type === 'buy');
        m = buys.length && r(3) ? buys[r(buys.length)] : moves[r(moves.length)];
      }
      ok(s, seat, m);
      // invariants
      assert.deepEqual(totalTokens(s), initial, 'token conservation');
      for (const [i, p] of s.players.entries()) {
        // limit is enforced at the end of your own turn; a meteor shower on
        // someone else's turn can push you over by one
        const cap = s.config.tokenLimit + 1 + (s.phase === 'discard' && s.turn === i ? 4 : 0);
        assert.ok(G.sumTokens(p.tokens) <= cap, '10 limit');
        assert.ok(p.reserved.length <= s.config.reserveLimit);
        for (const t of G.TOKEN_TYPES) assert.ok(p.tokens[t] >= 0, 'no negative tokens');
      }
      for (const t of G.TOKEN_TYPES) assert.ok(s.supply[t] >= 0, 'no negative supply');
      const all = [...[1, 2, 3].flatMap((lv) => [...s.market[lv], ...s.decks[lv]].filter((x) => x && !G.isOmen(x))),
        ...s.players.flatMap((p) => [...p.cards, ...p.reserved.map((x) => x.id)])];
      assert.equal(all.length, 90, 'every card accounted for');
      assert.equal(new Set(all).size, 90, 'no duplicated card');
    }
    if (s.phase === 'over') ended++;
    assert.ok(s.result && s.result.winners.length >= 1);
  }
  assert.equal(ended, 300);
});

// ---------------------------------------------------------------- tunable options
test('config: startTokens compensates later seats with distinct crystals', () => {
  const s = G.setup(P(4), { seed: 5, skipProphecyPick: true, config: { startTokens: [0, 1, 1, 2] } });
  const byPos = [0, 1, 2, 3].map((k) => s.players[(s.firstSeat + k) % 4].tokens);
  assert.deepEqual(byPos.map((t) => G.sumTokens(t)), [0, 1, 1, 2]);
  assert.ok(Object.values(byPos[3]).every((v) => v <= 1), 'distinct elements');
  assert.equal(byPos[3].star, 0);
  assert.deepEqual(totalTokens(s), totalTokens(G.setup(P(4), { seed: 5, skipProphecyPick: true })));
});

test('config: dragonReq and prophecy overrides', () => {
  const s = game(2, 1, { dragonReq: 3, prophecy: { 'p-fire': { min: 3, points: 2 } } });
  const [a, b] = Object.keys(G.DRAGON[s.dragon.id].req);
  giveCards(s, 0, [...cardsOf(a, 3), ...cardsOf(b, 3)]);
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.dragon.owner, 0);
  s.players[1].prophecy = 'p-fire';
  giveCards(s, 1, cardsOf('fire', 3));
  assert.equal(G.scoreOf(s, 1).prophecy, 2);
});

test('defaults: dragon equal strength steals on your own turn', () => {
  const s = game(2);
  assert.equal(s.config.dragonStealOnTie, true);
  const [a, b] = Object.keys(G.DRAGON[s.dragon.id].req);
  giveCards(s, 0, [...cardsOf(a, 3), ...cardsOf(b, 3)]);
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.dragon.owner, 0);
  giveCards(s, 1, [...cardsOf(a, 3), ...cardsOf(b, 3)]);
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.equal(s.dragon.owner, 1, 'tie steals');
  ok(s, 0, { type: 'take', colors: ['wind', 'light', 'water'] });
  assert.equal(s.dragon.owner, 0, 'a tie on your own turn steals it back');
});

test('defaults: turn-order compensation 2p none, 3p 0-1-1, 4p 0-1-1-1', () => {
  for (const [n, exp] of [[2, [0, 0]], [3, [0, 1, 1]], [4, [0, 1, 1, 1]]]) {
    const s = G.setup(P(n), { seed: 11 });
    assert.deepEqual([...Array(n).keys()].map((k) => G.sumTokens(s.players[(s.firstSeat + k) % n].tokens)), exp);
  }
});

// ---------------------------------------------------------------- §5 omen events
// A started game with omens on, seat 0 to move, no turn-order compensation.
function evGame(n = 2, seed = 3, config) {
  const s = G.setup(P(n), { seed, skipProphecyPick: true, config: { startTokens: Array(n).fill(0), ...config } });
  s.firstSeat = 0; s.turn = 0;
  return s;
}
const toRound = (s, r) => { s.turnCount = (r - 1) * s.n + 1; };
const omenOnTop = (s, lv) => { s.decks[lv] = s.decks[lv].filter((x) => !G.isOmen(x)); s.decks[lv].push('omen:t'); };
const forceEvent = (s, id) => { s.eventDeck = [id]; };

test('§5 omens: 3/2/1 shuffled into decks, never in the opening market', () => {
  for (let seed = 1; seed < 30; seed++) {
    const s = G.setup(P(3), { seed });
    for (const [lv, k] of [[1, 3], [2, 2], [3, 1]]) {
      assert.equal(s.decks[lv].filter(G.isOmen).length, k);
      assert.equal(s.market[lv].filter(G.isOmen).length, 0);
    }
    assert.equal(s.eventDeck.length, 8);
  }
});

test('§5 an omen revealed while refilling triggers the next event; the slot still gets a real card', () => {
  const s = evGame();
  toRound(s, 5);
  omenOnTop(s, 1);
  forceEvent(s, 'meteor');
  give(s, 0, G.CARD[s.market[1][0]].cost);
  ok(s, 0, { type: 'buy', cardId: s.market[1][0] });
  assert.equal(s.stats.events, 1);
  assert.ok(s.market[1][0] && !G.isOmen(s.market[1][0]));
  assert.ok(s.log.some((e) => e.type === 'event' && e.event === 'meteor'));
});

test('§5 omens fizzle before round 4, within 3 rounds of the last event, and in the final round', () => {
  const s = evGame();
  toRound(s, 2); omenOnTop(s, 1); forceEvent(s, 'meteor');
  ok(s, 0, { type: 'reserve', cardId: s.market[1][0] });
  assert.equal(s.stats.events, 0); assert.equal(s.stats.omenFizzles, 1);

  const t = evGame();
  toRound(t, 5); t.lastEventRound = 3; omenOnTop(t, 1); forceEvent(t, 'meteor');
  ok(t, 0, { type: 'reserve', cardId: t.market[1][0] });
  assert.equal(t.stats.events, 0, 'gap < 3 rounds');
  t.lastEventRound = 2; omenOnTop(t, 1); forceEvent(t, 'meteor');
  ok(t, 1, { type: 'reserve', cardId: t.market[1][1] });
  assert.equal(t.stats.events, 1, 'gap of 3 rounds is fine');

  const u = evGame();
  toRound(u, 9); u.finalRound = true; omenOnTop(u, 1); forceEvent(u, 'meteor');
  ok(u, 0, { type: 'reserve', cardId: u.market[1][0] });
  assert.equal(u.stats.events, 0);
});

test('§5 blind reserve reveals omens on top of the deck too', () => {
  const s = evGame();
  toRound(s, 6); omenOnTop(s, 2); forceEvent(s, 'storm');
  ok(s, 0, { type: 'reserve', deck: 2 });
  assert.equal(s.event.id, 'storm');
  assert.ok(G.CARD[s.players[0].reserved[0].id]);
});

test('§5 one-round events last until the revealer\'s next turn ends', () => {
  const s = evGame(3);
  G.triggerEvent(s, 'storm', 0);
  s.event.remaining = s.n + 1; // as if revealed during seat 0's turn
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth'] });
  assert.ok(s.event, 'active for seat 1');
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] });
  ok(s, 2, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] });
  assert.ok(s.event, 'still active for seat 0');
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] });
  assert.equal(s.event, null, 'over after the revealer\'s next turn');
  bad(s, 1, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] }, /1–3/);
});

test('§5 wrath: >6 crystals lose 2 of their most plentiful colour; dragon owner is safe', () => {
  const s = evGame(3);
  give(s, 0, { fire: 4, water: 3 });
  give(s, 1, { earth: 5, wind: 3 });
  give(s, 2, { light: 6 });
  s.dragon.owner = 1;
  G.triggerEvent(s, 'wrath', 0);
  assert.deepEqual([s.players[0].tokens.fire, s.players[0].tokens.water], [2, 3]);
  assert.equal(G.sumTokens(s.players[1].tokens), 8, 'dragon owner untouched');
  assert.equal(s.players[2].tokens.light, 6, '6 is not more than 6');
});

test('§5 black market: one 2→1 exchange per player, free action, only while active', () => {
  const s = evGame();
  give(s, 0, { fire: 2, star: 1 });
  bad(s, 0, { type: 'exchange', give: { fire: 2 }, get: 'water' }, /ไม่ได้เปิด/);
  G.triggerEvent(s, 'black', 1); s.event.remaining = 3;
  bad(s, 0, { type: 'exchange', give: { fire: 1 }, get: 'water' }, /2 เม็ด/);
  bad(s, 0, { type: 'exchange', give: { fire: 3 }, get: 'water' });
  ok(s, 0, { type: 'exchange', give: { fire: 1, star: 1 }, get: 'water' });
  assert.equal(s.turn, 0, 'turn continues');
  assert.deepEqual([s.players[0].tokens.fire, s.players[0].tokens.star, s.players[0].tokens.water], [1, 0, 1]);
  bad(s, 0, { type: 'exchange', give: { fire: 1, water: 1 }, get: 'earth' }, /ไปแล้ว/);
  ok(s, 0, { type: 'take', colors: ['earth', 'wind', 'light'] });
});

test('§5 eclipse: the four Lv3 cards go under the deck and four new ones come out', () => {
  const s = evGame();
  const before = [...s.market[3]];
  G.triggerEvent(s, 'eclipse', 0);
  assert.equal(s.market[3].filter(Boolean).length, 4);
  for (const id of before) assert.ok(!s.market[3].includes(id) && s.decks[3].slice(0, 4).includes(id));
});

test('§5 storm allows 4 different; drought bans one element', () => {
  const s = evGame(2);
  bad(s, 0, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] });
  G.triggerEvent(s, 'storm', 0); s.event.remaining = 3;
  ok(s, 0, { type: 'take', colors: ['fire', 'water', 'earth', 'wind'] });
  ok(s, 1, { type: 'take', colors: ['fire', 'water', 'earth'] }); // 3 still fine
  const t = evGame(2);
  G.triggerEvent(t, 'drought', 0); t.event.remaining = 3;
  const banned = t.event.element;
  const others = ELEMENTS.filter((e) => e !== banned);
  bad(t, 0, { type: 'take', colors: [banned, others[0], others[1]] }, /ขาดแคลน/);
  ok(t, 0, { type: 'take', colors: others.slice(0, 3) });
  assert.ok(G.legalMoves(t, 1).every((m) => m.type !== 'take' || !m.colors.includes(banned)));
});

test('§5 meteor gives stars from the revealer onwards while they last; festival discounts Lv1', () => {
  const s = evGame(3);
  s.supply.star = 2;
  G.triggerEvent(s, 'meteor', 1);
  assert.deepEqual(s.players.map((p) => p.tokens.star), [0, 1, 1]);
  const t = evGame(2);
  putInMarket(t, 'fi14'); // ✨3
  give(t, 0, { light: 2 });
  bad(t, 0, { type: 'buy', cardId: 'fi14' }, /ไม่พอ/);
  G.triggerEvent(t, 'festival', 1); t.event.remaining = 3;
  ok(t, 0, { type: 'buy', cardId: 'fi14' });
  assert.equal(t.players[0].tokens.light, 0);
});

test('§5 wanderer adds a guardian that is not already in play', () => {
  const s = evGame(2);
  const before = [...s.guardians];
  G.triggerEvent(s, 'wanderer', 0);
  assert.equal(s.guardians.length, before.length + 1);
  assert.ok(!before.includes(s.guardians[s.guardians.length - 1]));
});

test('§5 view shows the active event to everyone', () => {
  const s = evGame(2);
  G.triggerEvent(s, 'drought', 0); s.event.remaining = 3;
  const v = G.view(s, 1);
  assert.equal(v.event.id, 'drought');
  assert.ok(ELEMENTS.includes(v.event.element));
});
