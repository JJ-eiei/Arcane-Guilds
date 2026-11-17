// Arcane Guilds — rules engine (server-authoritative).
// Implements the game-module interface used by server/rooms.js:
//   setup(players, options) · move(state, seat, move) · view(state, seat)
//   currentTurn(state) · isOver(state)
// plus helpers used by bots / simulation: legalMoves, scoreOf, CARD …
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
const EVENT = Object.fromEntries(D.EVENTS.map((e) => [e.id, e]));
const OMEN = 'omen';           // deck entries that are omen cards look like 'omen:1:0'
const isOmen = (id) => typeof id === 'string' && id.startsWith(OMEN);
const MAX_TURNS = 400;         // safety valve for simulations

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
const round = (state) => Math.ceil(state.turnCount / state.n);

function bonuses(state, seat) {
  const b = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
  for (const id of state.players[seat].cards) b[CARD[id].bonus]++;
  return b;
}
const meets = (bonus, req) => Object.entries(req).every(([e, n]) => bonus[e] >= n);

function dragonReq(config, id) {
  const n = config.dragonReq;
  return Object.fromEntries(Object.keys(DRAGON[id].req).map((e) => [e, n]));
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

function prophecyDef(state, id) {
  return id ? { ...PROPHECY[id], ...((state.config.prophecy || {})[id] || {}) } : null;
}
function prophecyMet(state, seat) {
  const p = state.players[seat];
  const pr = prophecyDef(state, p.prophecy);
  if (!pr) return false;
  const b = bonuses(state, seat);
  switch (pr.kind) {
    case 'elementBonus': return b[pr.element] >= pr.min;
    case 'allBonus': return ELEMENTS.every((e) => b[e] >= pr.min);
    case 'guardians': return p.guardians.length >= pr.min;
    case 'dragon': return state.dragon.owner === seat;
    case 'starsGained': return (p.starsGained || 0) >= pr.min;
    case 'levelCount': return p.cards.filter((id) => CARD[id].level === pr.level).length >= pr.min;
    default: return false;
  }
}
function scoreOf(state, seat) {
  const pub = publicPoints(state, seat);
  const pr = prophecyDef(state, state.players[seat].prophecy);
  const proph = pr && prophecyMet(state, seat) ? pr.points : 0;
  return { public: pub, prophecy: proph, total: pub + proph };
}

function log(state, entry) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ id: state.logSeq, n: state.turnCount, ...entry });
  if (state.log.length > 60) state.log.shift();
}

function findMarket(state, cardId) {
  if (typeof cardId !== 'string') return null;
  for (const lv of [1, 2, 3]) {
    const i = state.market[lv].indexOf(cardId);
    if (i !== -1) return { level: lv, index: i };
  }
  return null;
}

const activeEvent = (state, id) => state.event && state.event.id === id ? state.event : null;

// ---------------------------------------------------------------- omen events
// Draw the next real card for a market slot; omens met on the way may trigger.
function refill(state, level, index) {
  // empty the slot first so an event (eclipse) never sees the card that just left
  state.market[level][index] = null;
  const deck = state.decks[level];
  while (deck.length) {
    const top = deck.pop();
    if (isOmen(top)) {
      revealOmen(state, level);
      if (state.market[level][index] !== null) return; // the event refilled it
      continue;
    }
    state.market[level][index] = top;
    return;
  }
}

function revealOmen(state, level) {
  const cfg = state.config.omens;
  const r = round(state);
  const tooEarly = r < cfg.firstRound;
  const tooSoon = state.lastEventRound != null && r - state.lastEventRound < cfg.minGap;
  if (tooEarly || tooSoon || state.finalRound || state.resolvingEvent || !state.eventDeck.length) {
    state.stats.omenFizzles++;
    log(state, { seat: state.turn, type: 'omenFizzle', level });
    return;
  }
  const id = state.eventDeck.pop();
  state.lastEventRound = r;
  state.stats.events++;
  state.stats.eventsById[id] = (state.stats.eventsById[id] || 0) + 1;
  state.resolvingEvent = true;
  triggerEvent(state, id, state.turn);
  state.resolvingEvent = false;
}

function triggerEvent(state, id, bySeat) {
  const ev = EVENT[id];
  const entry = { seat: bySeat, type: 'event', event: id };
  if (ev.kind === 'round') {
    // active for every other player's next turn and the revealer's next turn
    state.event = { id, remaining: state.n + 1, by: bySeat, used: {} };
    if (id === 'drought') {
      state.event.element = ELEMENTS[Math.floor(rng(state) * ELEMENTS.length)];
      entry.element = state.event.element;
    }
    log(state, entry);
    return;
  }
  log(state, entry);
  switch (id) {
    case 'wrath': {
      for (let s = 0; s < state.n; s++) {
        if (s === state.dragon.owner) continue;
        const p = state.players[s];
        if (sumTokens(p.tokens) <= 6) continue;
        const lost = {};
        for (let k = 0; k < 2; k++) {
          const c = ELEMENTS.filter((e) => p.tokens[e] > 0).sort((a, b) => p.tokens[b] - p.tokens[a])[0] || (p.tokens[STAR] > 0 ? STAR : null);
          if (!c) break;
          p.tokens[c]--; state.supply[c]++; lost[c] = (lost[c] || 0) + 1;
        }
        log(state, { seat: s, type: 'lose', tokens: lost, cause: 'wrath' });
      }
      break;
    }
    case 'eclipse': {
      const gone = state.market[3].filter(Boolean);
      state.decks[3].unshift(...gone);       // to the bottom of the deck
      state.market[3] = state.market[3].map(() => null);
      for (let i = 0; i < 4; i++) refill(state, 3, i);
      log(state, { seat: null, type: 'eclipse', gone });
      break;
    }
    case 'meteor': {
      for (let k = 0; k < state.n; k++) {
        const s = (bySeat + k) % state.n;
        if (state.supply[STAR] <= 0) break;
        state.supply[STAR]--; state.players[s].tokens[STAR]++; state.players[s].starsGained = (state.players[s].starsGained || 0) + 1;
        log(state, { seat: s, type: 'gain', tokens: { [STAR]: 1 }, cause: 'meteor' });
      }
      break;
    }
    case 'wanderer': {
      const inPlay = new Set([...state.guardians, ...state.players.flatMap((p) => p.guardians)]);
      const pool = D.GUARDIANS.map((g) => g.id).filter((g) => !inPlay.has(g));
      if (pool.length) {
        const g = pool[Math.floor(rng(state) * pool.length)];
        state.guardians.push(g);
        log(state, { seat: null, type: 'guardianAppears', id: g });
      }
      break;
    }
    default: break;
  }
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
  let discount = 0;
  if (activeEvent(state, 'festival') && card.level === 1) {
    // one free crystal of any colour: cover a shortage first, else refund the
    // most plentiful colour you were about to pay
    if (shortage > 0) shortage -= 1;
    else {
      const e = ELEMENTS.filter((x) => pay[x] > 0).sort((x, y) => pay[y] - pay[x])[0];
      if (e) pay[e] -= 1;
    }
    discount = 1;
  }
  if (shortage > p.tokens[STAR]) return null;
  pay[STAR] = shortage;
  return { pay, discount };
}

// ---------------------------------------------------------------- setup
function setup(players, options = {}) {
  const n = players.length;
  if (n < 2 || n > 4) throw new Error('Arcane Guilds needs 2–4 players');
  const config = JSON.parse(JSON.stringify({ ...D.CONFIG, ...(options.config || {}) }));
  config.omens = { ...D.CONFIG.omens, ...((options.config || {}).omens || {}) };
  const seed = options.seed != null ? options.seed >>> 0 : crypto.randomInt(2 ** 31);
  const state = {
    config, n, seed, rng: seed,
    supply: emptyTokens(),
    decks: { 1: [], 2: [], 3: [] },
    market: { 1: [], 2: [], 3: [] },
    guardians: [],
    dragon: { id: null, owner: null },
    players: [],
    phase: 'prophecy',
    turn: null, firstSeat: 0, finalRound: false, turnCount: 0,
    pendingGuardians: [],
    event: null, eventDeck: [], lastEventRound: null, resolvingEvent: false,
    log: [],
    result: null,
    stats: { takes: 0, reserves: 0, blindReserves: 0, buys: 0, discards: 0, guardians: 0, exchanges: 0,
      dragonClaims: 0, dragonSteals: 0, events: 0, omenFizzles: 0, eventsById: {} },
  };

  for (const e of ELEMENTS) state.supply[e] = config.tokensPerElement[n];
  state.supply[STAR] = config.starTokens;

  for (const lv of [1, 2, 3]) {
    state.decks[lv] = shuffle(state, D.CARDS.filter((c) => c.level === lv).map((c) => c.id));
    for (let i = 0; i < 4; i++) state.market[lv].push(state.decks[lv].pop());
    // omens go in after the opening market is dealt
    const k = (config.omens.perLevel || {})[lv] || 0;
    for (let i = 0; i < k; i++) state.decks[lv].push(`${OMEN}:${lv}:${i}`);
    shuffle(state, state.decks[lv]);
  }
  const evIds = config.omens.events || D.EVENTS.map((e) => e.id);
  state.eventDeck = shuffle(state, [...evIds]);
  state.guardians = shuffle(state, D.GUARDIANS.map((g) => g.id)).slice(0, n + 1);
  state.dragon.id = shuffle(state, D.DRAGONS.map((d) => d.id))[0];

  const prophecies = shuffle(state, D.PROPHECIES.map((p) => p.id));
  for (let s = 0; s < n; s++) {
    state.players.push({
      tokens: emptyTokens(), cards: [], reserved: [], guardians: [],
      prophecy: null, prophecyOptions: prophecies.splice(0, 2), starsGained: 0,
    });
  }

  state.firstSeat = Math.floor(rng(state) * n);
  // turn-order compensation: startTokens[k] distinct crystals for the k-th player
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
    if (!p) return 'คุณไม่ได้อยู่ในเกมนี้';
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
  if (m.type === 'exchange') return doExchange(state, seat, m.give, m.get); // free, turn continues
  let err;
  switch (m.type) {
    case 'take': err = doTake(state, seat, m.colors); break;
    case 'reserve': err = doReserve(state, seat, m); break;
    case 'buy': err = doBuy(state, seat, m.cardId); break;
    case 'pass':
      if (legalMoves(state, seat).some((x) => x.type !== 'pass')) return 'ยังมีสิ่งที่ทำได้ ผ่านตาไม่ได้';
      log(state, { seat, type: 'pass' });
      break;
    default: return 'ไม่รู้จักคำสั่งนี้';
  }
  if (err) return err;
  return endOfAction(state, seat);
}

function takeRules(state) {
  const drought = activeEvent(state, 'drought');
  const banned = drought ? drought.element : null;
  const max = activeEvent(state, 'storm') ? 4 : 3;
  const avail = ELEMENTS.filter((e) => e !== banned && state.supply[e] > 0);
  return { banned, max, avail };
}

function doTake(state, seat, colors) {
  const { banned, max, avail } = takeRules(state);
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > max) return `เลือกผลึก 1–${max} เม็ด`;
  if (!colors.every((c) => ELEMENTS.includes(c))) return 'เก็บได้เฉพาะผลึกธาตุ (ดวงดาวได้จากการจองเท่านั้น)';
  if (banned && colors.includes(banned)) return `ธาตุ${D.ELEMENT_INFO[banned].th}ขาดแคลน — เก็บไม่ได้รอบนี้`;
  const p = state.players[seat];
  const distinct = new Set(colors);
  if (colors.length === 2 && distinct.size === 1) {
    if (state.supply[colors[0]] < state.config.takeTwoMin) return `เก็บ 2 เม็ดสีเดียวได้เมื่อกองกลางเหลือ ≥ ${state.config.takeTwoMin} เม็ด`;
  } else {
    if (distinct.size !== colors.length) return 'ถ้าเก็บหลายเม็ด ต้องเป็นธาตุไม่ซ้ำกัน (หรือ 2 เม็ดสีเดียว)';
    if (colors.length < Math.min(3, avail.length)) return 'ต้องเก็บ 3 ธาตุ (เก็บน้อยกว่านี้ได้เฉพาะตอนกองกลางมีไม่ครบ)';
    if (colors.some((c) => state.supply[c] < 1)) return 'ผลึกธาตุนั้นหมดแล้ว';
  }
  for (const c of colors) { state.supply[c]--; p.tokens[c]++; }
  state.stats.takes++;
  log(state, { seat, type: 'take', colors });
}

function doExchange(state, seat, give, get) {
  const ev = activeEvent(state, 'black');
  if (!ev) return 'ตลาดมืดไม่ได้เปิดอยู่';
  if (ev.used[seat]) return 'คุณแลกในตลาดมืดไปแล้ว';
  if (!ELEMENTS.includes(get)) return 'เลือกผลึกที่จะรับให้ถูกต้อง';
  if (state.supply[get] < 1) return 'ผลึกธาตุนั้นหมดแล้ว';
  if (!give || typeof give !== 'object') return 'เลือกผลึกที่จะแลก 2 เม็ด';
  const p = state.players[seat];
  let total = 0;
  for (const [t, k] of Object.entries(give)) {
    if (!TOKEN_TYPES.includes(t) || !Number.isInteger(k) || k < 0 || k > p.tokens[t]) return 'ผลึกที่จะแลกไม่ถูกต้อง';
    total += k;
  }
  if (total !== 2) return 'ต้องแลกผลึก 2 เม็ด';
  for (const [t, k] of Object.entries(give)) { p.tokens[t] -= k; state.supply[t] += k; }
  state.supply[get]--; p.tokens[get]++;
  ev.used[seat] = true;
  state.stats.exchanges++;
  log(state, { seat, type: 'exchange', give, get });
}

function doReserve(state, seat, m) {
  const p = state.players[seat];
  if (p.reserved.length >= state.config.reserveLimit) return `จองได้สูงสุด ${state.config.reserveLimit} ใบ`;
  let cardId; let hidden = false; let where = null; let lv;
  if (m.cardId) {
    where = findMarket(state, m.cardId);
    if (!where) return 'ไม่มีการ์ดนี้ในตลาด';
    cardId = m.cardId;
  } else {
    lv = Number(m.deck);
    if (![1, 2, 3].includes(lv)) return 'เลือกกองการ์ดไม่ถูกต้อง';
    if (!state.decks[lv].some((x) => !isOmen(x))) return 'กองนี้หมดแล้ว';
    hidden = true;
  }
  const gotStar = state.supply[STAR] > 0;
  if (gotStar) { state.supply[STAR]--; p.tokens[STAR]++; p.starsGained = (p.starsGained || 0) + 1; }
  if (where) {
    p.reserved.push({ id: cardId, hidden });
    log(state, { seat, type: 'reserve', cardId, level: CARD[cardId].level, star: gotStar, slot: where });
    refill(state, where.level, where.index);
  } else {
    // blind reserve: omens on top of the deck are revealed on the way
    const deck = state.decks[lv];
    while (deck.length && isOmen(deck[deck.length - 1])) { deck.pop(); revealOmen(state, lv); }
    cardId = deck.pop();
    p.reserved.push({ id: cardId, hidden });
    log(state, { seat, type: 'reserve', cardId: null, level: lv, star: gotStar });
  }
  state.stats.reserves++;
  if (hidden) state.stats.blindReserves++;
}

function doBuy(state, seat, cardId) {
  const p = state.players[seat];
  const where = findMarket(state, cardId);
  const rIdx = p.reserved.findIndex((r) => r.id === cardId);
  if (!where && rIdx === -1) return 'ซื้อได้เฉพาะการ์ดในตลาดหรือที่คุณจองไว้';
  const plan = planPayment(state, seat, cardId);
  if (!plan) return 'ผลึกไม่พอซื้อการ์ดใบนี้';
  for (const t of TOKEN_TYPES) { p.tokens[t] -= plan.pay[t]; state.supply[t] += plan.pay[t]; }
  if (rIdx !== -1 && !where) p.reserved.splice(rIdx, 1);
  p.cards.push(cardId);
  state.stats.buys++;
  log(state, { seat, type: 'buy', cardId, from: where ? 'market' : 'reserve', pay: plan.pay, slot: where || null });
  if (where) refill(state, where.level, where.index);
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
  state.pendingGuardians = [];
  state.stats.guardians++;
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
  if (state.event) {
    state.event.remaining -= 1;
    if (state.event.remaining <= 0) {
      log(state, { seat: null, type: 'eventEnd', event: state.event.id });
      state.event = null;
    }
  }
  state.turn = next;
  state.turnCount += 1;
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
  const mine = strength(seat); const theirs = strength(owner);
  if (mine > theirs || (mine === theirs && state.config.dragonStealOnTie)) {
    state.dragon.owner = seat;
    state.stats.dragonSteals++;
    log(state, { seat, type: 'dragon', from: owner });
  }
}

function finish(state) {
  state.phase = 'over';
  state.turn = null;
  state.event = null;
  const scores = state.players.map((_, s) => ({ seat: s, ...scoreOf(state, s), cards: state.players[s].cards.length }));
  const best = Math.max(...scores.map((x) => x.total));
  let top = scores.filter((x) => x.total === best);
  const fewest = Math.min(...top.map((x) => x.cards));
  top = top.filter((x) => x.cards === fewest);
  state.result = { scores, winners: top.map((x) => x.seat), turns: state.turnCount, capped: state.turnCount >= MAX_TURNS };
  log(state, { seat: null, type: 'over', winners: state.result.winners });
}

// ---------------------------------------------------------------- legal moves
// Enumerates turn-ending action-phase moves (used for `pass` validation and
// bots). The free black-market exchange is not listed.
function legalMoves(state, seat) {
  const out = [];
  if (state.phase === 'over' || seat !== state.turn) return out;
  const p = state.players[seat];
  if (state.phase === 'discard') return [{ type: 'discard' }];
  if (state.phase === 'guardian') return state.pendingGuardians.map((id) => ({ type: 'chooseGuardian', id }));

  const { max, avail } = takeRules(state);
  const combos = (arr, r, start = 0, acc = []) => {
    if (acc.length === r) { out.push({ type: 'take', colors: [...acc] }); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, r, i + 1, acc); acc.pop(); }
  };
  const k = Math.min(3, avail.length);
  if (k > 0) combos(avail, k);
  if (max === 4 && avail.length >= 4) combos(avail, 4);
  for (const e of avail) if (state.supply[e] >= state.config.takeTwoMin) out.push({ type: 'take', colors: [e, e] });

  const marketIds = [1, 2, 3].flatMap((lv) => state.market[lv].filter(Boolean));
  if (p.reserved.length < state.config.reserveLimit) {
    for (const id of marketIds) out.push({ type: 'reserve', cardId: id });
    for (const lv of [1, 2, 3]) if (state.decks[lv].some((x) => !isOmen(x))) out.push({ type: 'reserve', deck: lv });
  }
  for (const id of [...marketIds, ...p.reserved.map((r) => r.id)]) {
    if (planPayment(state, seat, id)) out.push({ type: 'buy', cardId: id });
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
      starsGained: p.starsGained || 0,
      prophecyChosen: !!p.prophecy,
      prophecy: mine || over ? p.prophecy : null,
      prophecyOptions: mine && state.phase === 'prophecy' ? p.prophecyOptions : undefined,
    };
  });
  const ev = state.event;
  return {
    phase: state.phase,
    turn: state.turn,
    firstSeat: state.firstSeat,
    finalRound: state.finalRound,
    turnCount: state.turnCount,
    round: state.turnCount ? round(state) : 0,
    supply: state.supply,
    market: state.market,
    deckCounts: Object.fromEntries([1, 2, 3].map((lv) => [lv, state.decks[lv].length])),
    guardians: state.guardians,
    dragon: state.dragon,
    event: ev ? { id: ev.id, remaining: ev.remaining, by: ev.by, element: ev.element, usedByMe: !!ev.used[seat] } : null,
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
  cards: D.CARDS, guardians: D.GUARDIANS, dragons: D.DRAGONS, prophecies: D.PROPHECIES, events: D.EVENTS,
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
  legalMoves, scoreOf, dragonReq, publicPoints, bonuses, planPayment, sumTokens, takeRules, triggerEvent, isOmen,
  CARD, GUARDIAN, DRAGON, PROPHECY, EVENT, TOKEN_TYPES,
};
