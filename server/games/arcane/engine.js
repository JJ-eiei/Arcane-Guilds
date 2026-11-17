// Arcane Guilds — rules engine (server-authoritative).
// Implements the game-module interface used by server/rooms.js:
//   setup(players, options) · move(state, seat, move) · view(state, seat)
//   currentTurn(state) · isOver(state)
// plus helpers used by bots / simulation: legalMoves, scoreOf, CARD.
//
// Rules reference: docs/arcane-guilds-design.md

const crypto = require('crypto');
const D = require('./data');

const { ELEMENTS, STAR } = D;
const TOKEN_TYPES = [...ELEMENTS, STAR];
const CARD = Object.fromEntries(D.CARDS.map((c) => [c.id, c]));
const GUARDIAN = Object.fromEntries(D.GUARDIANS.map((g) => [g.id, g]));
const DRAGON = Object.fromEntries(D.DRAGONS.map((d) => [d.id, d]));
const PROPHECY = Object.fromEntries(D.PROPHECIES.map((p) => [p.id, p]));
const MAX_TURNS = 400; // safety valve for simulations

// ---------------------------------------------------------------- helpers
function rng(state) {
  // mulberry32 — deterministic per game so simulations are reproducible
  let t = (state.rng += 0x6D2B79F5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const emptyTokens = () => Object.fromEntries(TOKEN_TYPES.map((t) => [t, 0]));
const sumTokens = (t) => TOKEN_TYPES.reduce((a, k) => a + (t[k] || 0), 0);

function bonuses(state, seat) {
  const b = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
  for (const id of state.players[seat].cards) b[CARD[id].bonus]++;
  return b;
}

function meets(bonus, req) {
  return Object.entries(req).every(([e, n]) => bonus[e] >= n);
}

// Public prestige (no prophecy) — used for the 15-point trigger.
function publicPoints(state, seat) {
  const p = state.players[seat];
  let pts = 0;
  for (const id of p.cards) pts += CARD[id].points;
  for (const id of p.guardians) pts += GUARDIAN[id].points;
  if (state.dragon.owner === seat) pts += state.config.dragonPoints;
  return pts;
}

function prophecyMet(state, seat) {
  const p = state.players[seat];
  const base = p.prophecy && PROPHECY[p.prophecy];
  if (!base) return false;
  const pr = { ...base, ...((state.config.prophecy || {})[base.id] || {}) };
  const b = bonuses(state, seat);
  switch (pr.kind) {
    case 'elementBonus': return b[pr.element] >= pr.min;
    case 'allBonus': return ELEMENTS.every((e) => b[e] >= pr.min);
    case 'guardians': return p.guardians.length >= pr.min;
    case 'dragon': return state.dragon.owner === seat;
    case 'curses': return p.cursesCollected >= pr.min;
    case 'levelCount': return p.cards.filter((id) => CARD[id].level === pr.level).length >= pr.min;
    default: return false;
  }
}

function scoreOf(state, seat) {
  const pub = publicPoints(state, seat);
  const pid = state.players[seat].prophecy;
  const proph = prophecyMet(state, seat) ? (((state.config.prophecy || {})[pid] || {}).points ?? PROPHECY[pid].points) : 0;
  return { public: pub, prophecy: proph, total: pub + proph };
}

function log(state, entry) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ id: state.logSeq, n: state.turnCount, ...entry });
  if (state.log.length > 60) state.log.shift();
}

// Locate a card that can be targeted: market or own reserve.
function findMarket(state, cardId) {
  for (const lv of [1, 2, 3]) {
    const i = state.market[lv].indexOf(cardId);
    if (i !== -1) return { level: lv, index: i };
  }
  return null;
}

function refill(state, level, index) {
  const deck = state.decks[level];
  state.market[level][index] = deck.length ? deck.pop() : null;
}

// Seal resolution when a sealed card leaves the market.
// Returns { error } or { curse: {from, to, color} | null }.
function planCurse(state, seat, cardId, tokensAfter, curseColor) {
  const seal = state.seals[cardId];
  if (!seal || seal.seat === seat) return { curse: null };
  const n = state.config.seal.curse;
  if (n <= 0) return { curse: null };
  let color = curseColor;
  if (color != null) {
    if (!TOKEN_TYPES.includes(color)) return { error: 'สีค่าสาปไม่ถูกต้อง' };
    if ((tokensAfter[color] || 0) < n) return { error: 'ผลึกสีนั้นไม่พอจ่ายค่าสาป' };
  } else {
    // default: the element token you hold the most of, star as last resort
    const best = ELEMENTS.filter((e) => tokensAfter[e] >= n).sort((a, b) => tokensAfter[b] - tokensAfter[a])[0];
    color = best || (tokensAfter[STAR] >= n ? STAR : null);
  }
  if (!color) return { error: `การ์ดนี้ติดผนึก ต้องมีผลึกเหลือจ่ายค่าสาป ${n} เม็ด` };
  return { curse: { from: seat, to: seal.seat, color, n } };
}

function applyCurse(state, cardId, curse) {
  const seal = state.seals[cardId];
  if (!seal) return;
  delete state.seals[cardId];
  if (curse) {
    state.players[curse.from].tokens[curse.color] -= curse.n;
    state.players[curse.to].tokens[curse.color] += curse.n;
    state.players[curse.to].cursesCollected += 1;
    state.stats.curses++;
    log(state, { seat: curse.to, type: 'curse', from: curse.from, cardId, color: curse.color });
  }
  // the sealing crystal goes home to its owner
  state.players[seal.seat].tokens[seal.color] += 1;
  state.players[seal.seat].sealsActive -= 1;
}

// Payment plan for buying `cardId` by `seat`. Pure (no mutation).
function planPayment(state, seat, cardId) {
  const p = state.players[seat];
  const card = CARD[cardId];
  const b = bonuses(state, seat);
  const pay = emptyTokens();
  let shortage = 0;
  for (const e of ELEMENTS) {
    const need = Math.max(0, (card.cost[e] || 0) - b[e]);
    const use = Math.min(need, p.tokens[e]);
    pay[e] = use;
    shortage += need - use;
  }
  let useSeal = false;
  const seal = state.seals[cardId];
  if (seal && seal.seat === seat && state.config.seal.ownerWild && shortage > 0) {
    // the seal crystal covers up to `ownerWildCount` missing crystals (default 1)
    useSeal = true;
    shortage -= Math.min(shortage, state.config.seal.ownerWildCount || 1);
  }
  if (shortage > p.tokens[STAR]) return null;
  pay[STAR] = shortage;
  return { pay, useSeal };
}

// ---------------------------------------------------------------- setup
function setup(players, options = {}) {
  const n = players.length;
  if (n < 2 || n > 4) throw new Error('Arcane Guilds needs 2–4 players');
  const config = JSON.parse(JSON.stringify({ ...D.CONFIG, ...(options.config || {}) }));
  const seed = options.seed != null ? options.seed >>> 0 : crypto.randomInt(2 ** 31);
  const state = {
    config, n, seed, rng: seed,
    supply: emptyTokens(),
    decks: { 1: [], 2: [], 3: [] },
    market: { 1: [], 2: [], 3: [] },
    seals: {},
    guardians: [],
    dragon: { id: null, owner: null },
    players: [],
    phase: 'prophecy',
    turn: null, firstSeat: 0, finalRound: false, turnCount: 0,
    pendingGuardians: [],
    log: [],
    result: null,
    stats: { takes: 0, reserves: 0, blindReserves: 0, buys: 0, seals: 0, curses: 0, dragonClaims: 0, dragonSteals: 0, discards: 0, guardians: 0 },
  };

  for (const e of ELEMENTS) state.supply[e] = config.tokensPerElement[n];
  state.supply[STAR] = config.starTokens;

  for (const lv of [1, 2, 3]) {
    state.decks[lv] = shuffle(state, D.CARDS.filter((c) => c.level === lv).map((c) => c.id));
    for (let i = 0; i < 4; i++) state.market[lv].push(state.decks[lv].pop());
  }
  state.guardians = shuffle(state, D.GUARDIANS.map((g) => g.id)).slice(0, n + 1);
  state.dragon.id = shuffle(state, D.DRAGONS.map((d) => d.id))[0];

  const prophecies = shuffle(state, D.PROPHECIES.map((p) => p.id));
  for (let s = 0; s < n; s++) {
    state.players.push({
      tokens: emptyTokens(), cards: [], reserved: [], guardians: [],
      prophecy: null, prophecyOptions: prophecies.splice(0, 2),
      cursesCollected: 0, sealsActive: 0,
    });
  }

  state.firstSeat = Math.floor(rng(state) * n);
  // Turn-order compensation: startTokens[k] = number of different element
  // crystals the k-th player in turn order starts with (k = 0 is first).
  let comp = config.startTokens || (config.startTokensByPlayers && config.startTokensByPlayers[n]);
  if (!comp && config.lastSeatBonusToken) comp = [...Array(n - 1).fill(0), 1];
  if (comp) {
    for (let k = 0; k < n; k++) {
      const seat = (state.firstSeat + k) % n;
      const count = Math.min(comp[k] || 0, ELEMENTS.length);
      const pick = shuffle(state, [...ELEMENTS]).sort((x, y) => state.supply[y] - state.supply[x]).slice(0, count);
      for (const e of pick) { state.players[seat].tokens[e]++; state.supply[e]--; }
    }
  }
  if (options.skipProphecyPick) {
    for (const p of state.players) p.prophecy = p.prophecyOptions[0];
    startPlay(state);
  }
  return state;
}

function startPlay(state) {
  state.phase = 'action';
  state.turn = state.firstSeat;
  state.turnCount = 1;
  log(state, { seat: null, type: 'start', firstSeat: state.firstSeat });
}

// ---------------------------------------------------------------- moves
function move(state, seat, m) {
  if (!m || typeof m !== 'object') return 'คำสั่งไม่ถูกต้อง';
  if (state.phase === 'over') return 'เกมจบแล้ว';

  if (state.phase === 'prophecy') {
    if (m.type !== 'chooseProphecy') return 'ต้องเลือกคำทำนายก่อน';
    const p = state.players[seat];
    if (p.prophecy) return 'คุณเลือกคำทำนายไปแล้ว';
    if (!p.prophecyOptions.includes(m.id)) return 'ไม่มีคำทำนายนี้ให้เลือก';
    p.prophecy = m.id;
    if (state.players.every((x) => x.prophecy)) startPlay(state);
    return;
  }

  if (seat !== state.turn) return 'ยังไม่ถึงตาคุณ';

  if (state.phase === 'discard') {
    if (m.type !== 'discard') return 'ต้องคืนผลึกให้เหลือไม่เกินลิมิตก่อน';
    return doDiscard(state, seat, m.tokens);
  }
  if (state.phase === 'guardian') {
    if (m.type !== 'chooseGuardian') return 'ต้องเลือกภูตพิทักษ์ก่อน';
    if (!state.pendingGuardians.includes(m.id)) return 'เลือกภูตตนนี้ไม่ได้';
    grantGuardian(state, seat, m.id);
    return afterGuardians(state, seat);
  }

  // phase === 'action'
  let err;
  switch (m.type) {
    case 'take': err = doTake(state, seat, m.colors); break;
    case 'reserve': err = doReserve(state, seat, m); break;
    case 'buy': err = doBuy(state, seat, m.cardId, m.curseColor); break;
    case 'seal': err = doSeal(state, seat, m.cardId, m.color, m.colors); break;
    case 'pass':
      if (legalMoves(state, seat).some((x) => x.type !== 'pass')) return 'ยังมีสิ่งที่ทำได้ ผ่านตาไม่ได้';
      log(state, { seat, type: 'pass' });
      break;
    default: return 'ไม่รู้จักคำสั่งนี้';
  }
  if (err) return err;
  return endOfAction(state, seat);
}

function doTake(state, seat, colors) {
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 3) return 'เลือกผลึก 1–3 เม็ด';
  if (!colors.every((c) => ELEMENTS.includes(c))) return 'เก็บได้เฉพาะผลึกธาตุ (ดวงดาวได้จากการจองเท่านั้น)';
  const p = state.players[seat];
  const distinct = new Set(colors);
  if (colors.length === 2 && distinct.size === 1) {
    const c = colors[0];
    if (state.supply[c] < state.config.takeTwoMin) return `เก็บ 2 เม็ดสีเดียวได้เมื่อกองกลางเหลือ ≥ ${state.config.takeTwoMin} เม็ด`;
  } else {
    if (distinct.size !== colors.length) return 'ถ้าเก็บหลายเม็ด ต้องเป็นธาตุไม่ซ้ำกัน (หรือ 2 เม็ดสีเดียว)';
    const available = ELEMENTS.filter((e) => state.supply[e] > 0).length;
    if (colors.length < Math.min(3, available)) return 'ต้องเก็บ 3 ธาตุ (เก็บน้อยกว่านี้ได้เฉพาะตอนกองกลางมีไม่ครบ)';
    if (colors.some((c) => state.supply[c] < 1)) return 'ผลึกธาตุนั้นหมดแล้ว';
  }
  for (const c of colors) { state.supply[c]--; p.tokens[c]++; }
  state.stats.takes++;
  log(state, { seat, type: 'take', colors });
}

function doReserve(state, seat, m) {
  const p = state.players[seat];
  if (p.reserved.length >= state.config.reserveLimit) return `จองได้สูงสุด ${state.config.reserveLimit} ใบ`;
  let cardId, hidden = false, where = null;
  if (m.cardId) {
    where = findMarket(state, m.cardId);
    if (!where) return 'ไม่มีการ์ดนี้ในตลาด';
    cardId = m.cardId;
  } else {
    const lv = Number(m.deck);
    if (![1, 2, 3].includes(lv)) return 'เลือกกองการ์ดไม่ถูกต้อง';
    if (!state.decks[lv].length) return 'กองนี้หมดแล้ว';
    cardId = state.decks[lv][state.decks[lv].length - 1];
    hidden = true;
  }
  // gold first (it can be used to pay a curse)
  const after = { ...p.tokens };
  const gotStar = state.supply[STAR] > 0;
  if (gotStar) after[STAR]++;
  const plan = where ? planCurse(state, seat, cardId, after, m.curseColor) : { curse: null };
  if (plan.error) return plan.error;

  if (where) refill(state, where.level, where.index);
  else state.decks[Number(m.deck)].pop();
  if (gotStar) { state.supply[STAR]--; p.tokens[STAR]++; }
  p.reserved.push({ id: cardId, hidden });
  state.stats.reserves++;
  if (hidden) state.stats.blindReserves++;
  if (where) applyCurse(state, cardId, plan.curse);
  log(state, { seat, type: 'reserve', cardId: hidden ? null : cardId, level: CARD[cardId].level, star: gotStar });
}

function doBuy(state, seat, cardId, curseColor) {
  const p = state.players[seat];
  const where = findMarket(state, cardId);
  const rIdx = p.reserved.findIndex((r) => r.id === cardId);
  if (!where && rIdx === -1) return 'ซื้อได้เฉพาะการ์ดในตลาดหรือที่คุณจองไว้';
  const plan = planPayment(state, seat, cardId);
  if (!plan) return 'ผลึกไม่พอซื้อการ์ดใบนี้';
  const after = { ...p.tokens };
  for (const t of TOKEN_TYPES) after[t] -= plan.pay[t];
  const cplan = where ? planCurse(state, seat, cardId, after, curseColor) : { curse: null };
  if (cplan.error) return cplan.error;

  for (const t of TOKEN_TYPES) { p.tokens[t] -= plan.pay[t]; state.supply[t] += plan.pay[t]; }
  if (where) {
    const seal = state.seals[cardId];
    if (seal && seal.seat === seat) {
      delete state.seals[cardId];
      p.sealsActive -= 1;
      if (plan.useSeal) state.supply[seal.color] += 1; // spent as a wild
      else p.tokens[seal.color] += 1;                // not needed: comes home
    } else {
      applyCurse(state, cardId, cplan.curse);
    }
    refill(state, where.level, where.index);
  } else {
    p.reserved.splice(rIdx, 1);
  }
  p.cards.push(cardId);
  state.stats.buys++;
  log(state, { seat, type: 'buy', cardId, from: where ? 'market' : 'reserve' });
}

function doSeal(state, seat, cardId, color, extra) {
  const p = state.players[seat];
  const cfg = state.config.seal;
  const takeWith = cfg.takeWith || 0;
  extra = extra || [];
  if (!Array.isArray(extra) || extra.length > takeWith) return takeWith ? `วางผนึกแล้วเก็บผลึกเพิ่มได้ไม่เกิน ${takeWith} เม็ด` : 'การวางผนึกไม่ได้ผลึกเพิ่ม';
  if (new Set(extra).size !== extra.length || !extra.every((c) => ELEMENTS.includes(c) && state.supply[c] > 0)) return 'ผลึกที่เก็บเพิ่มต้องเป็นธาตุต่างกันและยังมีในกองกลาง';
  if (cfg.maxPerPlayer <= 0) return 'ปิดใช้ผนึกเวทในเกมนี้';
  if (!findMarket(state, cardId)) return 'ผนึกได้เฉพาะการ์ดที่เปิดอยู่ในตลาด';
  if (state.seals[cardId]) return 'การ์ดใบนี้มีผนึกอยู่แล้ว';
  if (p.sealsActive >= cfg.maxPerPlayer) return `มีผนึกค้างได้สูงสุด ${cfg.maxPerPlayer} อัน`;
  if (!ELEMENTS.includes(color)) return 'ใช้ผลึกธาตุวางผนึก (ใช้ดวงดาวไม่ได้)';
  if (p.tokens[color] < 1) return 'คุณไม่มีผลึกธาตุนั้น';
  p.tokens[color]--;
  p.sealsActive++;
  state.seals[cardId] = { seat, color };
  for (const c of extra) { state.supply[c]--; p.tokens[c]++; }
  state.stats.seals++;
  log(state, { seat, type: 'seal', cardId, color });
}

// ---------------------------------------------------------------- end of turn
function endOfAction(state, seat) {
  if (sumTokens(state.players[seat].tokens) > state.config.tokenLimit) {
    state.phase = 'discard';
    return;
  }
  return checkGuardians(state, seat);
}

function doDiscard(state, seat, tokens) {
  const p = state.players[seat];
  if (!tokens || typeof tokens !== 'object') return 'ระบุผลึกที่จะคืน';
  const over = sumTokens(p.tokens) - state.config.tokenLimit;
  let total = 0;
  for (const [t, n] of Object.entries(tokens)) {
    if (!TOKEN_TYPES.includes(t) || !Number.isInteger(n) || n < 0) return 'จำนวนผลึกไม่ถูกต้อง';
    if (n > p.tokens[t]) return 'คืนเกินจำนวนที่มี';
    total += n;
  }
  if (total !== over) return `ต้องคืนผลึก ${over} เม็ดพอดี`;
  for (const [t, n] of Object.entries(tokens)) { p.tokens[t] -= n; state.supply[t] += n; }
  state.stats.discards++;
  log(state, { seat, type: 'discard', tokens });
  return checkGuardians(state, seat);
}

function checkGuardians(state, seat) {
  const b = bonuses(state, seat);
  const ok = state.guardians.filter((id) => meets(b, GUARDIAN[id].req));
  if (ok.length === 1) grantGuardian(state, seat, ok[0]);
  else if (ok.length > 1) {
    state.phase = 'guardian';
    state.pendingGuardians = ok;
    return;
  }
  return afterGuardians(state, seat);
}

function grantGuardian(state, seat, id) {
  state.guardians = state.guardians.filter((g) => g !== id);
  state.players[seat].guardians.push(id);
  state.stats.guardians++;
  state.pendingGuardians = [];
  log(state, { seat, type: 'guardian', id });
}

function afterGuardians(state, seat) {
  checkDragon(state, seat);
  state.phase = 'action';
  if (publicPoints(state, seat) >= state.config.winPoints && !state.finalRound) {
    state.finalRound = true;
    log(state, { seat, type: 'finalRound' });
  }
  const next = (seat + 1) % state.n;
  if ((state.finalRound && next === state.firstSeat) || state.turnCount >= MAX_TURNS) {
    return finish(state);
  }
  state.turn = next;
  state.turnCount += 1;
}

function dragonReq(config, id) {
  const n = config.dragonReq;
  return Object.fromEntries(Object.keys(DRAGON[id].req).map((e) => [e, n]));
}

function checkDragon(state, seat) {
  const req = dragonReq(state.config, state.dragon.id);
  const b = bonuses(state, seat);
  if (!meets(b, req)) return;
  const owner = state.dragon.owner;
  if (owner === seat) return;
  if (owner === null) {
    state.dragon.owner = seat;
    state.stats.dragonClaims++;
    log(state, { seat, type: 'dragon', from: null });
    return;
  }
  const strength = (s) => {
    const bb = bonuses(state, s);
    return Object.keys(req).reduce((a, e) => a + bb[e], 0);
  };
  const mine = strength(seat), theirs = strength(owner);
  if (mine > theirs || (mine === theirs && state.config.dragonStealOnTie)) {
    state.dragon.owner = seat;
    state.stats.dragonSteals++;
    log(state, { seat, type: 'dragon', from: owner });
  }
}

function finish(state) {
  state.phase = 'over';
  state.turn = null;
  const scores = state.players.map((_, s) => ({ seat: s, ...scoreOf(state, s), cards: state.players[s].cards.length }));
  const best = Math.max(...scores.map((x) => x.total));
  let top = scores.filter((x) => x.total === best);
  const fewest = Math.min(...top.map((x) => x.cards));
  top = top.filter((x) => x.cards === fewest);
  state.result = { scores, winners: top.map((x) => x.seat), turns: state.turnCount, capped: state.turnCount >= MAX_TURNS };
  log(state, { seat: null, type: 'over', winners: state.result.winners });
}

// ---------------------------------------------------------------- legal moves
// Enumerates action-phase moves (used for `pass` validation and bots).
function legalMoves(state, seat) {
  const out = [];
  if (state.phase === 'over' || seat !== state.turn) return out;
  const p = state.players[seat];
  if (state.phase === 'discard') return [{ type: 'discard' }]; // bots compute their own amounts
  if (state.phase === 'guardian') return state.pendingGuardians.map((id) => ({ type: 'chooseGuardian', id }));

  const avail = ELEMENTS.filter((e) => state.supply[e] > 0);
  const k = Math.min(3, avail.length);
  const combos = (arr, r, start = 0, acc = []) => {
    if (acc.length === r) { out.push({ type: 'take', colors: [...acc] }); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, r, i + 1, acc); acc.pop(); }
  };
  if (k > 0) combos(avail, k);
  for (const e of ELEMENTS) if (state.supply[e] >= state.config.takeTwoMin) out.push({ type: 'take', colors: [e, e] });

  const marketIds = [1, 2, 3].flatMap((lv) => state.market[lv].filter(Boolean));
  const canPayCurse = (cardId, after) => !planCurse(state, seat, cardId, after).error;

  if (p.reserved.length < state.config.reserveLimit) {
    const after = { ...p.tokens };
    if (state.supply[STAR] > 0) after[STAR]++;
    for (const id of marketIds) if (canPayCurse(id, after)) out.push({ type: 'reserve', cardId: id });
    for (const lv of [1, 2, 3]) if (state.decks[lv].length) out.push({ type: 'reserve', deck: lv });
  }
  for (const id of [...marketIds, ...p.reserved.map((r) => r.id)]) {
    const plan = planPayment(state, seat, id);
    if (!plan) continue;
    const after = { ...p.tokens };
    for (const t of TOKEN_TYPES) after[t] -= plan.pay[t];
    if (findMarket(state, id) && !canPayCurse(id, after)) continue;
    out.push({ type: 'buy', cardId: id });
  }
  if (p.sealsActive < state.config.seal.maxPerPlayer) {
    const colors = ELEMENTS.filter((e) => p.tokens[e] > 0);
    for (const id of marketIds) if (!state.seals[id]) for (const c of colors) out.push({ type: 'seal', cardId: id, color: c });
  }
  if (!out.length) out.push({ type: 'pass' });
  return out;
}

// ---------------------------------------------------------------- view
function view(state, seat) {
  const over = state.phase === 'over';
  const players = state.players.map((p, s) => {
    const mine = s === seat;
    return {
      seat: s,
      tokens: p.tokens,
      tokenCount: sumTokens(p.tokens),
      cards: p.cards,
      bonuses: bonuses(state, s),
      reserved: p.reserved.map((r) => (mine || over || !r.hidden ? { id: r.id, hidden: r.hidden } : { id: null, hidden: true, level: CARD[r.id].level })),
      guardians: p.guardians,
      points: publicPoints(state, s),
      cursesCollected: p.cursesCollected,
      sealsActive: p.sealsActive,
      prophecyChosen: !!p.prophecy,
      prophecy: mine || over ? p.prophecy : null,
      prophecyOptions: mine && state.phase === 'prophecy' ? p.prophecyOptions : undefined,
    };
  });
  return {
    phase: state.phase,
    turn: state.turn,
    firstSeat: state.firstSeat,
    finalRound: state.finalRound,
    turnCount: state.turnCount,
    supply: state.supply,
    market: state.market,
    deckCounts: { 1: state.decks[1].length, 2: state.decks[2].length, 3: state.decks[3].length },
    seals: state.seals,
    guardians: state.guardians,
    dragon: state.dragon,
    pendingGuardians: state.phase === 'guardian' && state.turn === seat ? state.pendingGuardians : [],
    discardNeeded: state.phase === 'discard' && state.turn === seat
      ? sumTokens(state.players[seat].tokens) - state.config.tokenLimit : 0,
    config: state.config,
    players,
    log: state.log.slice(-30),
    result: state.result,
  };
}

// Static data the browser needs to draw cards (no secrets: deck order and
// hidden information stay in `view`).
const clientData = {
  elements: ELEMENTS, star: STAR, elementInfo: D.ELEMENT_INFO,
  cards: D.CARDS, guardians: D.GUARDIANS, dragons: D.DRAGONS, prophecies: D.PROPHECIES,
};

module.exports = {
  id: 'arcane',
  clientData,
  name: 'Arcane Guilds',
  minPlayers: 2,
  maxPlayers: 4,
  setup,
  move,
  view,
  currentTurn: (state) => (state.phase === 'over' || state.phase === 'prophecy' ? null : state.turn),
  isOver: (state) => state.phase === 'over',
  // extras for bots / simulation / tests
  legalMoves, scoreOf, dragonReq, publicPoints, bonuses, planPayment, sumTokens,
  CARD, GUARDIAN, DRAGON, PROPHECY, TOKEN_TYPES,
};
