/* Arcane Guilds — browser renderer.
   Registers window.GameRenderers.arcane = ({ el, sendMove }) => ({ update, result, unmount })
   Everything the server sends per seat arrives in snap.view (see engine.view).
   Rules are enforced on the server; checks here only drive the UI. */
(() => {
  const ELEMENTS = ['fire', 'water', 'earth', 'wind', 'light'];
  const TOKENS = [...ELEMENTS, 'star'];
  const TH = { fire: 'ไฟ', water: 'น้ำ', earth: 'ดิน', wind: 'ลม', light: 'แสง', star: 'ดวงดาว' };
  const COL = {
    fire: ['#ff9a4d', '#e4572e', '#9e2a12'], water: ['#8fd0ff', '#2e86de', '#174a8b'],
    earth: ['#e0b27a', '#9a7442', '#4e3a1e'], wind: ['#a8f5c2', '#3bb273', '#1d6b42'],
    light: ['#fff7c2', '#f2c94c', '#b5891b'], star: ['#ead2ff', '#9b5de5', '#5a2ea8'],
  };
  const SHAPE = { // viewBox 0 0 40 46 — distinct silhouettes for colour-blind play
    fire: 'M21 2 C25 11 35 17 35 29 A15 15 0 0 1 5 29 C5 22 9 17 12 13 C13 19 15 21 18 22 C15 15 16 8 21 2Z',
    water: 'M20 3 C30 14 37 22 37 30 A17 15 0 0 1 3 30 C3 22 10 14 20 3Z',
    earth: 'M6 6 H34 V40 H6 Z',
    wind: 'M20 2 L38 23 L20 44 L2 23 Z',
    light: 'M20 2 L37 12 V34 L20 44 L3 34 V12 Z',
    star: 'M20 2 L25 16 L39 17 L28 27 L32 42 L20 33 L8 42 L12 27 L1 17 L15 16 Z',
  };
  const EMBLEM = { // viewBox 0 0 64 64, white
    fire: '<path d="M32 4 C38 16 52 24 52 40 A20 20 0 0 1 12 40 C12 30 18 24 22 18 C23 26 27 30 31 31 C28 22 29 12 32 4Z" fill="#fff"/>',
    water: '<path d="M32 4 C42 18 50 28 50 40 A18 18 0 0 1 14 40 C14 28 22 18 32 4Z" fill="#fff"/><path d="M20 42 Q26 36 32 42 T44 42" stroke="#2e86de" stroke-width="3" fill="none"/>',
    earth: '<path d="M4 54 L24 16 L34 32 L42 22 L60 54Z" fill="#fff"/><path d="M19 26 L24 16 L29 26 Z" fill="#9a7442"/>',
    wind: '<g stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"><path d="M6 22 H38 A8 8 0 1 0 30 14"/><path d="M6 34 H48 A8 8 0 1 1 40 42"/><path d="M6 46 H28"/></g>',
    light: '<circle cx="32" cy="32" r="12" fill="#fff"/><g stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M32 4V12M32 52V60M4 32H12M52 32H60M12 12L18 18M46 46L52 52M12 52L18 46M46 18L52 12"/></g>',
  };
  const ROMAN = { 1: '★', 2: '★★', 3: '★★★' };

  let DATA = null; let ART = { cards: [], guardians: [], dragons: [] };
  let CARD = {}, GUARD = {}, DRAGON = {}, PROPH = {};
  const dataReady = Promise.all([
    fetch('/api/games/arcane/data').then((r) => r.json()),
    fetch('/art/manifest.json').then((r) => (r.ok ? r.json() : ART)).catch(() => ART),
  ]).then(([d, art]) => {
    DATA = d; ART = art;
    CARD = Object.fromEntries(d.cards.map((c) => [c.id, c]));
    GUARD = Object.fromEntries(d.guardians.map((g) => [g.id, g]));
    DRAGON = Object.fromEntries(d.dragons.map((g) => [g.id, g]));
    PROPH = Object.fromEntries(d.prophecies.map((g) => [g.id, g]));
  });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

  // ---------- svg pieces ----------
  const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${TOKENS.map((e) =>
    `<linearGradient id="ag-g-${e}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${COL[e][0]}"/><stop offset=".55" stop-color="${COL[e][1]}"/><stop offset="1" stop-color="${COL[e][2]}"/></linearGradient>`).join('')}</defs></svg>`;
  const gem = (e, cls = '') => `<svg class="${cls}" viewBox="0 0 40 46" aria-label="${TH[e]}"><path d="${SHAPE[e]}" fill="url(#ag-g-${e})" stroke="#1a1033" stroke-width="3" stroke-linejoin="round"/><ellipse cx="14" cy="15" rx="4" ry="6" fill="#fff" opacity=".65" transform="rotate(-25 14 15)"/></svg>`;
  const chip = (e, n, extra = '') => `<span class="gc ${extra}">${gem(e)}<b>${n}</b></span>`;
  const emblem = (e) => `<svg class="emblem" viewBox="0 0 64 64">${EMBLEM[e]}</svg>`;
  const elementBg = (e, lv) => `radial-gradient(circle at 50% 42%, ${COL[e][0]} 0%, ${COL[e][1]} ${lv === 3 ? 30 : 22}%, #3a1f6e 62%, #1d1240 100%)`;

  function cardArt(c) {
    if (ART.cards.includes(c.id)) return `<div class="art" style="background-image:url(/art/cards/${c.id}.webp)"></div>`;
    return `<div class="art" style="background:${elementBg(c.bonus, c.level)}"><div class="gen-art">${emblem(c.bonus)}</div></div>`;
  }
  function cardHTML(id, { cls = '', act = 'card', seal = null, players = [], afford = false, mini = false } = {}) {
    const c = CARD[id];
    if (!c) return '';
    const sealHTML = seal ? (() => {
      const owner = players.find((p) => p.seat === seal.seat);
      return `<span class="seal" style="background:${owner ? owner.color : '#d6336c'}" title="ผนึกของ ${esc(owner ? owner.name : '')}">🔒</span>`;
    })() : '';
    return `<button class="card l${c.level} ${mini ? 'mini' : ''} ${afford ? 'afford' : ''} ${cls}" data-a="${act}" data-id="${c.id}" aria-label="${esc(c.name)}">
      <div class="in">${cardArt(c)}
        <div class="top"><span class="pts">${c.points || ''}</span>${gem(c.bonus, 'gem-b')}</div>
        <div class="nm">${esc(c.name)}</div>
        <div class="cost">${ELEMENTS.filter((e) => c.cost[e]).map((e) => chip(e, c.cost[e])).join('')}</div>
        <div class="lvl">${ROMAN[c.level]}</div>
      </div>${sealHTML}</button>`;
  }
  function tileArt(kind, id, els) {
    const dir = kind === 'g' ? 'guardians' : 'dragons';
    const list = kind === 'g' ? ART.guardians : ART.dragons;
    if (list.includes(id)) return `<div class="art" style="background-image:url(/art/${dir}/${id}.webp)"></div>`;
    const bg = els.length === 2
      ? `linear-gradient(135deg, ${COL[els[0]][1]}, #3a1f6e 55%, ${COL[els[1]][1]})`
      : `radial-gradient(circle at 50% 40%, #c9a7ff, #5a2ea8 60%, #1d1240)`;
    return `<div class="art" style="background:${bg}"><div class="gen-art">${emblem(els[0])}</div></div>`;
  }

  // ---------- renderer ----------
  window.GameRenderers = window.GameRenderers || {};
  window.GameRenderers.arcane = ({ el, sendMove }) => {
    const root = document.createElement('div');
    root.className = 'ag';
    el.append(root);
    const feed = document.createElement('div');
    feed.className = 'ag-feed';
    document.body.append(feed);
    const layer = document.createElement('div');
    layer.className = 'ag-layer';
    layer.hidden = true;
    document.body.append(layer);

    let snap = null;
    let sel = [];                  // selected supply colours
    let sheet = null;              // { kind: 'card'|'deck', id|level, from: 'market'|'reserve' }
    let sealColor = null, sealExtra = [], curseColor = null;
    let modal = null;              // { kind: 'opp'|'rules'|'proph'|'tile'|'score', ... }
    let discardSel = {};
    let busy = false;
    let lastLogId = null;
    let scoreShown = false;

    const V = () => snap.view;
    const me = () => (snap.mySeat == null ? null : V().players[snap.mySeat]);
    const pl = (seat) => snap.players.find((p) => p.seat === seat) || { name: '?', color: '#999', connected: true };
    const myTurn = () => V().phase === 'action' && V().turn === snap.mySeat;
    const cfg = () => V().config;
    const inMarket = (id) => [1, 2, 3].some((lv) => V().market[lv].includes(id));

    async function send(move) {
      if (busy) return { error: 'busy' };
      busy = true;
      const r = await sendMove(move);
      busy = false;
      if (!r.error) { sel = []; sheet = null; sealColor = null; sealExtra = []; curseColor = null; discardSel = {}; }
      render();
      return r;
    }

    // --- payment preview (mirrors engine.planPayment) ---
    function plan(id) {
      const m = me(); if (!m) return null;
      const c = CARD[id];
      const pay = Object.fromEntries(TOKENS.map((t) => [t, 0]));
      let shortage = 0;
      for (const e of ELEMENTS) {
        const need = Math.max(0, (c.cost[e] || 0) - m.bonuses[e]);
        const use = Math.min(need, m.tokens[e]);
        pay[e] = use; shortage += need - use;
      }
      let sealUsed = 0;
      const seal = V().seals[id];
      if (seal && seal.seat === snap.mySeat && cfg().seal.ownerWild && shortage > 0) {
        sealUsed = Math.min(shortage, cfg().seal.ownerWildCount || 1); shortage -= sealUsed;
      }
      if (shortage > m.tokens.star) return { ok: false, missing: shortage - m.tokens.star };
      pay.star = shortage;
      return { ok: true, pay, sealUsed };
    }
    function curseInfo(id, tokensAfter) {
      const seal = V().seals[id];
      if (!seal || seal.seat === snap.mySeat || !inMarket(id)) return null;
      const n = cfg().seal.curse;
      const options = TOKENS.filter((t) => tokensAfter[t] >= n);
      const auto = ELEMENTS.filter((e) => tokensAfter[e] >= n).sort((a, b) => tokensAfter[b] - tokensAfter[a])[0] || (tokensAfter.star >= n ? 'star' : null);
      return { to: seal.seat, n, options, color: options.includes(curseColor) ? curseColor : auto };
    }
    function buyCheck(id) {
      const p = plan(id);
      if (!p || !p.ok) return { ok: false, why: p ? `ขาดผลึกอีก ${p.missing} เม็ด` : '' };
      const after = { ...me().tokens };
      for (const t of TOKENS) after[t] -= p.pay[t];
      const curse = curseInfo(id, after);
      if (curse && !curse.color) return { ok: false, why: 'ไม่มีผลึกเหลือจ่ายค่าสาป', plan: p };
      return { ok: true, plan: p, curse };
    }
    function reserveCheck(id) {
      const m = me();
      if (m.reserved.length >= cfg().reserveLimit) return { ok: false, why: `จองได้สูงสุด ${cfg().reserveLimit} ใบ` };
      const after = { ...m.tokens };
      const star = V().supply.star > 0;
      if (star) after.star++;
      const curse = id ? curseInfo(id, after) : null;
      if (curse && !curse.color) return { ok: false, why: 'ไม่มีผลึกเหลือจ่ายค่าสาป' };
      return { ok: true, star, curse };
    }
    function takeValid() {
      const s = V().supply;
      if (sel.length === 2 && sel[0] === sel[1]) return s[sel[0]] >= cfg().takeTwoMin;
      const avail = ELEMENTS.filter((e) => s[e] > 0).length;
      return sel.length > 0 && new Set(sel).size === sel.length && sel.length === Math.min(3, avail);
    }
    function toggleSel(c) {
      const s = V().supply;
      if (!myTurn()) return flash('ยังไม่ถึงตาคุณ');
      if (c === 'star') return flash('ดวงดาวได้จากการจองการ์ดเท่านั้น');
      if (s[c] <= 0) return;
      const count = sel.filter((x) => x === c).length;
      if (count === 2) sel = [];
      else if (count === 1) {
        if (sel.length === 1 && s[c] >= cfg().takeTwoMin) sel = [c, c];
        else sel = sel.filter((x) => x !== c);
      } else if (sel.length === 2 && sel[0] === sel[1]) sel = [c];
      else if (sel.length < 3) sel.push(c);
      else return flash('เลือกได้สูงสุด 3 ธาตุ');
      render();
    }

    function flash(text, big = false, color = '#fff') {
      const d = document.createElement('div');
      d.className = 'feed-item' + (big ? ' big' : '');
      d.style.setProperty('--c', color);
      d.textContent = text;
      feed.prepend(d);
      while (feed.children.length > 4) feed.lastChild.remove();
      setTimeout(() => d.remove(), big ? 6000 : 4000);
    }

    // --- event feed from the server log ---
    function pumpLog() {
      const log = V().log || [];
      if (lastLogId === null) { lastLogId = log.length ? log[log.length - 1].id : 0; return; }
      for (const e of log) {
        if (e.id <= lastLogId) continue;
        lastLogId = e.id;
        const who = e.seat != null ? pl(e.seat) : null;
        const name = who ? (e.seat === snap.mySeat ? 'คุณ' : who.name) : '';
        const color = who ? who.color : '#fff';
        switch (e.type) {
          case 'start': flash(`เริ่มเกม — ${e.firstSeat === snap.mySeat ? 'คุณ' : pl(e.firstSeat).name} เล่นก่อน`, true, '#ffd36b'); break;
          case 'take': flash(`${name} เก็บผลึก ${e.colors.map((c) => TH[c]).join(' ')}`, false, color); break;
          case 'reserve': flash(`${name} จอง${e.cardId ? ` "${CARD[e.cardId].name}"` : `การ์ดคว่ำ Lv${e.level}`}${e.star ? ' +⭐' : ''}`, false, color); break;
          case 'buy': flash(`${name} ซื้อ "${CARD[e.cardId].name}"`, false, color); break;
          case 'seal': flash(`${name} ผนึก "${CARD[e.cardId].name}" 🔒`, false, color); break;
          case 'curse': flash(`คำสาป! ${e.from === snap.mySeat ? 'คุณ' : pl(e.from).name} จ่าย ${TH[e.color]} ให้ ${name}`, true, color); break;
          case 'guardian': flash(`${name} ได้ภูต "${GUARD[e.id].name}" (+3)`, true, color); break;
          case 'dragon': flash(e.from == null ? `🐉 ${name} ได้มังกร!` : `🐉 ${name} แย่งมังกรจาก ${e.from === snap.mySeat ? 'คุณ' : pl(e.from).name}!`, true, color); break;
          case 'finalRound': flash(`${name} ถึง ${cfg().winPoints} เกียรติยศ — รอบสุดท้าย!`, true, '#ff8b8b'); break;
          case 'discard': flash(`${name} คืนผลึก ${sum(e.tokens)} เม็ด`, false, color); break;
          default: break;
        }
      }
    }

    // ---------- area renderers ----------
    function oppsHTML() {
      const v = V();
      return v.players.filter((p) => p.seat !== snap.mySeat).map((p) => {
        const info = pl(p.seat);
        const turn = v.turn === p.seat && v.phase !== 'over';
        return `<button class="opp ${turn ? 'turn' : ''} ${info.connected ? '' : 'off'}" data-a="opp" data-seat="${p.seat}">
          <span class="who"><span class="dot" style="background:${info.color}"></span>${esc(info.name)}</span>
          <span class="score">★${p.points}</span>
          <span class="mini-gems">${TOKENS.map((t) => (p.tokens[t] ? `<span class="mini-gem">${gem(t)}${p.tokens[t]}</span>` : '')).join('')}</span>
          <span class="bonus-row">${ELEMENTS.map((e) => `<span class="bonus-pip" style="background:${COL[e][1]}">${p.bonuses[e]}</span>`).join('')}</span>
          ${p.reserved.length ? `<span class="tag">จอง ${p.reserved.length}</span>` : ''}
          ${p.guardians.length ? `<span class="tag">ภูต ${p.guardians.length}</span>` : ''}
          ${v.dragon.owner === p.seat ? '<span class="tag">🐉</span>' : ''}
          ${v.phase === 'prophecy' ? `<span class="tag">${p.prophecyChosen ? '✓ เลือกแล้ว' : '…กำลังเลือก'}</span>` : ''}
        </button>`;
      }).join('');
    }

    function sideHTML() {
      const v = V();
      const d = DRAGON[v.dragon.id];
      const dreq = Object.keys(d.req);
      const owner = v.dragon.owner;
      const g = v.guardians.map((id) => {
        const G = GUARD[id];
        const els = Object.keys(G.req);
        return `<button class="tile" data-a="tile" data-kind="g" data-id="${id}" aria-label="${esc(G.name)}"><div class="in">${tileArt('g', id, els)}
          <span class="pts">${G.points}</span><span class="req">${els.map((e) => chip(e, G.req[e])).join('')}</span></div></button>`;
      }).join('');
      const dragon = `<button class="tile dragon" data-a="tile" data-kind="d" data-id="${d.id}" aria-label="${esc(d.name)}"><div class="in">${tileArt('d', d.id, dreq)}
        <span class="pts">${cfg().dragonPoints}</span>
        ${owner != null ? `<span class="owner" style="border-color:${pl(owner).color}">🐉 ${owner === snap.mySeat ? 'คุณ' : esc(pl(owner).name)}</span>` : ''}
        <span class="req">${dreq.map((e) => chip(e, cfg().dragonReq)).join('')}</span></div></button>`;
      return dragon + g;
    }

    function marketHTML() {
      const v = V();
      return [3, 2, 1].map((lv) => {
        const deck = v.deckCounts[lv]
          ? `<button class="card back deck l${lv}" data-a="deck" data-lv="${lv}" aria-label="กองการ์ด Lv${lv}"><div class="in"><span class="rune">✦</span><span class="cnt">${v.deckCounts[lv]}</span></div></button>`
          : '<div class="card empty"></div>';
        const cards = v.market[lv].map((id) => (id
          ? cardHTML(id, { seal: v.seals[id], players: snap.players, afford: myTurn() && buyCheck(id).ok })
          : '<div class="card empty"></div>')).join('');
        return `<div class="ag-row">${deck}${cards}</div>`;
      }).join('');
    }

    function supplyHTML() {
      const s = V().supply;
      return TOKENS.map((t) => {
        const k = sel.filter((x) => x === t).length;
        return `<button class="pile ${t === 'star' ? 'star' : ''} ${s[t] ? '' : 'empty'} ${k ? 'sel' : ''}" data-a="pile" data-c="${t}" data-sel="${k}" aria-label="${TH[t]} เหลือ ${s[t]}">${gem(t)}<span class="n">${s[t]}</span></button>`;
      }).join('');
    }

    function meHTML() {
      const v = V();
      const m = me();
      if (!m) return '<div class="hint">คุณกำลังดูเกมนี้</div>';
      const total = sum(m.tokens);
      const pr = m.prophecy && PROPH[m.prophecy];
      let hint = '', actions = '';
      if (v.phase === 'prophecy') {
        hint = m.prophecyChosen ? `รอผู้เล่นอื่นเลือกคำทำนาย (${v.players.filter((p) => p.prophecyChosen).length}/${v.players.length})` : 'เลือกคำทำนายของคุณ';
        if (!m.prophecyChosen) actions = '<button class="agbtn primary" data-a="open-proph">เลือกคำทำนาย</button>';
      } else if (v.phase === 'over') {
        hint = 'จบเกมแล้ว';
        actions = '<button class="agbtn primary" data-a="score">ตารางคะแนน</button>';
      } else if (myTurn()) {
        if (sel.length) {
          hint = sel.length === 1 && v.supply[sel[0]] >= cfg().takeTwoMin ? 'แตะธาตุเดิมอีกครั้ง = เก็บ 2 เม็ดสีเดียว' : (takeValid() ? 'พร้อมเก็บ' : 'เลือกให้ครบ 3 ธาตุ หรือ 2 เม็ดสีเดียว');
          actions = `<button class="agbtn ghost" data-a="clear">ล้าง</button><button class="agbtn go" data-a="take" ${takeValid() ? '' : 'disabled'}>เก็บผลึก ${sel.map((c) => gem(c)).join('').replace(/<svg /g, '<svg style="width:18px;height:20px;vertical-align:middle" ')}</button>`;
        } else hint = '✨ ตาคุณ — แตะผลึกเพื่อเก็บ หรือแตะการ์ดเพื่อซื้อ / จอง / ผนึก';
      } else if (v.phase === 'discard' || v.phase === 'guardian') {
        hint = v.turn === snap.mySeat ? (v.phase === 'discard' ? 'คืนผลึกให้เหลือไม่เกินลิมิต' : 'เลือกภูตพิทักษ์') : `รอ ${esc(pl(v.turn).name)}…`;
      } else hint = `รอ ${esc(pl(v.turn).name)} เล่น…`;
      if (v.finalRound && v.phase !== 'over') hint = `<span class="final">รอบสุดท้าย!</span> ${hint}`;

      const reserved = m.reserved.map((r) => (r.id
        ? cardHTML(r.id, { act: 'rcard', mini: true, afford: myTurn() && buyCheck(r.id).ok })
        : '')).join('');
      return `
        <div class="me-score"><span class="ag-label">เกียรติยศ</span><span class="score">★${m.points}</span></div>
        <div class="me-block"><span class="ag-label">ผลึก <span class="limit ${total > cfg().tokenLimit ? 'over' : ''}">${total}/${cfg().tokenLimit}</span></span>
          <div class="me-tokens">${TOKENS.map((t) => `<span class="tok ${m.tokens[t] ? '' : 'zero'}">${gem(t)}<b>${m.tokens[t]}</b></span>`).join('')}</div></div>
        <div class="me-block"><span class="ag-label">โบนัส (ส่วนลดถาวร)</span>
          <div class="bonus-row">${ELEMENTS.map((e) => `<span class="bonus-pip" style="background:${COL[e][1]};min-width:26px;height:26px;font-size:14px">${m.bonuses[e]}</span>`).join('')}</div></div>
        ${reserved ? `<div class="me-block"><span class="ag-label">การ์ดที่จอง</span><div class="ag-row">${reserved}</div></div>` : ''}
        ${pr ? `<button class="prophecy-mini" data-a="my-proph"><div class="ag-label">🔮 คำทำนายลับ</div><div class="t">${esc(pr.name)} +${pr.points}</div></button>` : ''}
        ${m.guardians.length || v.dragon.owner === snap.mySeat ? `<div class="me-block"><span class="ag-label">ผู้พิทักษ์</span><div class="ag-row" style="gap:4px">${m.guardians.map((id) => `<span class="tag">${esc(GUARD[id].name)}</span>`).join('')}${v.dragon.owner === snap.mySeat ? '<span class="tag">🐉 มังกร</span>' : ''}</div></div>` : ''}
        ${m.sealsActive ? `<span class="tag">🔒 ผนึก ${m.sealsActive}/${cfg().seal.maxPerPlayer}</span>` : ''}
        <div class="me-actions"><span class="hint">${hint}</span>${actions}<button class="agbtn ghost" data-a="rules" aria-label="กฎ">กฎ</button></div>`;
    }

    // ---------- dialogs ----------
    function sheetHTML() {
      const v = V(); const m = me();
      if (sheet.kind === 'deck') {
        const rc = m && reserveCheck(null);
        return `<div class="ag-dialog"><button class="close-x" data-a="close">✕</button>
          <h3>จองการ์ดคว่ำ Lv${sheet.level}</h3><p class="sub">หยิบใบบนสุดของกองโดยไม่ให้คนอื่นเห็น${rc && rc.star ? ' และได้ ⭐ ดวงดาว 1 เม็ด' : ''}</p>
          ${!myTurn() ? '<p class="sub">ยังไม่ถึงตาคุณ</p>' : (rc.ok ? '' : `<p class="why">${rc.why}</p>`)}
          <button class="agbtn primary" data-a="do-reserve-deck" ${myTurn() && rc.ok ? '' : 'disabled'}>จอง</button></div>`;
      }
      const id = sheet.id; const c = CARD[id];
      const seal = v.seals[id];
      const fromMarket = inMarket(id);
      let body = '';
      if (!m) body = '';
      else if (!myTurn()) body = '<div class="act"><div class="why">ยังไม่ถึงตาคุณ — ดูข้อมูลได้อย่างเดียว</div></div>';
      else {
        // buy
        const bc = buyCheck(id);
        const payChips = bc.plan && bc.plan.ok ? TOKENS.filter((t) => bc.plan.pay[t]).map((t) => chip(t, bc.plan.pay[t])).join('') : '';
        const curseRow = (cur) => (cur ? `<div class="pay">คำสาป: จ่ายเพิ่ม ${cur.n} เม็ดให้ <b style="color:${pl(cur.to).color}">${esc(pl(cur.to).name)}</b>
          <div class="pick">${cur.options.map((t) => `<button class="${cur.color === t ? 'on' : ''}" data-a="curse" data-c="${t}">${gem(t)}</button>`).join('')}</div></div>` : '');
        body += `<div class="act"><b>ซื้อ</b>
          ${bc.ok ? `<div class="pay">จ่าย: ${payChips || '<span>ฟรี! (โบนัสพอ)</span>'}${bc.plan.sealUsed ? ` + ผนึก 🔒 แทน ${bc.plan.sealUsed} เม็ด` : ''}</div>${curseRow(bc.curse)}` : `<div class="why">${bc.why}</div>`}
          <button class="agbtn go" data-a="do-buy" ${bc.ok ? '' : 'disabled'}>ซื้อการ์ดนี้</button></div>`;
        if (fromMarket) {
          const rc = reserveCheck(id);
          body += `<div class="act"><b>จอง ${rc.star ? '(+⭐ ดวงดาว)' : ''}</b>
            ${rc.ok ? curseRow(rc.curse) : `<div class="why">${rc.why}</div>`}
            <button class="agbtn primary" data-a="do-reserve" ${rc.ok ? '' : 'disabled'}>จองการ์ดนี้</button></div>`;
          // seal
          const sc = cfg().seal;
          let why = '';
          if (seal) why = 'การ์ดนี้มีผนึกอยู่แล้ว';
          else if (m.sealsActive >= sc.maxPerPlayer) why = `มีผนึกค้างได้สูงสุด ${sc.maxPerPlayer} อัน`;
          else if (!ELEMENTS.some((e) => m.tokens[e] > 0)) why = 'ต้องมีผลึกธาตุอย่างน้อย 1 เม็ด';
          const extraMax = sc.takeWith || 0;
          body += `<div class="act"><b>วางผนึกเวท 🔒</b>
            <span class="sub" style="margin:0">ใช้ผลึกของคุณ 1 เม็ดผนึกการ์ดนี้${extraMax ? ` แล้วเก็บผลึกต่างธาตุเพิ่มได้ ${extraMax} เม็ด` : ''} · ถ้าคุณซื้อเองภายหลัง ผนึกใช้แทนผลึกได้ ${sc.ownerWildCount || 1} เม็ด · ถ้าคนอื่นซื้อ/จอง เขาต้องจ่ายค่าสาป ${sc.curse} เม็ดให้คุณ</span>
            ${why ? `<div class="why">${why}</div>` : `
              <div class="ag-label">ผลึกที่ใช้ผนึก</div>
              <div class="pick">${ELEMENTS.map((e) => `<button class="${sealColor === e ? 'on' : ''}" data-a="seal-color" data-c="${e}" ${m.tokens[e] ? '' : 'disabled'}>${gem(e)}<b>${m.tokens[e]}</b></button>`).join('')}</div>
              ${extraMax ? `<div class="ag-label">เก็บเพิ่มจากกองกลาง (เลือกได้ ${extraMax})</div>
              <div class="pick">${ELEMENTS.map((e) => `<button class="${sealExtra.includes(e) ? 'on' : ''}" data-a="seal-extra" data-c="${e}" ${v.supply[e] ? '' : 'disabled'}>${gem(e)}<b>${v.supply[e]}</b></button>`).join('')}</div>` : ''}`}
            <button class="agbtn primary" data-a="do-seal" ${!why && sealColor ? '' : 'disabled'}>ผนึก${sealExtra.length ? ` + เก็บ ${sealExtra.length} เม็ด` : ''}</button></div>`;
        }
      }
      const sealNote = seal ? `<p class="sub">🔒 ผนึกโดย <b style="color:${pl(seal.seat).color}">${seal.seat === snap.mySeat ? 'คุณ' : esc(pl(seal.seat).name)}</b></p>` : '';
      return `<div class="ag-dialog"><button class="close-x" data-a="close">✕</button>
        <div class="sheet-body"><div class="sheet-card">${cardHTML(id, { act: 'noop', seal, players: snap.players })}</div>
        <div class="sheet-info"><div><h3>${esc(c.name)}</h3><p class="sub">Lv${c.level} · ให้โบนัส ${TH[c.bonus]} ${c.points ? `· ${c.points} เกียรติยศ` : ''}</p>${sealNote}</div>${body}</div></div></div>`;
    }

    function modalHTML() {
      const v = V(); const m = me();
      const close = '<button class="close-x" data-a="close">✕</button>';
      switch (modal.kind) {
        case 'proph': {
          const opts = m.prophecyOptions || [];
          return `<div class="ag-dialog"><h3>🔮 เลือกคำทำนายลับ</h3><p class="sub">เก็บไว้ 1 ใบ คนอื่นจะไม่เห็นจนจบเกม · ทำสำเร็จได้เกียรติยศเพิ่มตอนนับคะแนน</p>
            <div class="choice-row">${opts.map((id) => { const p = PROPH[id]; return `<button class="proph-card" data-a="pick-proph" data-id="${id}"><div class="eye">🔮</div><div class="t">${esc(p.name)}</div><div>${esc(p.text)}</div><div class="pts">+${p.points}</div></button>`; }).join('')}</div></div>`;
        }
        case 'my-proph': {
          const p = PROPH[m.prophecy];
          return `<div class="ag-dialog">${close}<h3>🔮 ${esc(p.name)}</h3><p class="sub">${esc(p.text)} → +${p.points} เกียรติยศตอนจบเกม (ไม่นับตอนเช็ก ${cfg().winPoints} แต้ม)</p></div>`;
        }
        case 'discard': {
          const need = v.discardNeeded;
          const chosen = sum(discardSel);
          return `<div class="ag-dialog"><h3>ผลึกเกิน ${cfg().tokenLimit} เม็ด</h3><p class="sub">เลือกคืน ${need} เม็ด (เลือกแล้ว ${chosen})</p>
            <div class="pick" style="justify-content:center">${TOKENS.filter((t) => m.tokens[t]).map((t) => `<button class="${discardSel[t] ? 'on' : ''}" data-a="discard-add" data-c="${t}">${gem(t)}<b>${m.tokens[t] - (discardSel[t] || 0)}</b></button>`).join('')}</div>
            <p class="sub" style="margin-top:10px">คืน: ${TOKENS.filter((t) => discardSel[t]).map((t) => chip(t, discardSel[t])).join('') || '–'}</p>
            <div style="display:flex;gap:8px;justify-content:flex-end"><button class="agbtn ghost" data-a="discard-reset">เริ่มใหม่</button><button class="agbtn go" data-a="discard-ok" ${chosen === need ? '' : 'disabled'}>คืนผลึก</button></div></div>`;
        }
        case 'guardian':
          return `<div class="ag-dialog"><h3>ภูตพิทักษ์หลายตนอยากมาหาคุณ</h3><p class="sub">เลือกได้ 1 ตน (ตนอื่นยังรออยู่บนโต๊ะ)</p>
            <div class="choice-row">${v.pendingGuardians.map((id) => { const g = GUARD[id]; const els = Object.keys(g.req); return `<button class="proph-card" data-a="pick-guardian" data-id="${id}" style="border-color:#a36bff"><div class="t">${esc(g.name)}</div><div class="pick" style="justify-content:center">${els.map((e) => chip(e, g.req[e])).join('')}</div><div class="pts">+${g.points}</div></button>`; }).join('')}</div></div>`;
        case 'tile': {
          if (modal.k === 'd') {
            const d = DRAGON[modal.id]; const els = Object.keys(d.req);
            const owner = v.dragon.owner;
            return `<div class="ag-dialog">${close}<h3>🐉 ${esc(d.name)}</h3>
              <p class="sub">ต้องมีโบนัส ${els.map((e) => `${TH[e]} ≥ ${cfg().dragonReq}`).join(' และ ')} · ${cfg().dragonPoints} เกียรติยศ</p>
              <p class="sub">ใครมีโบนัสรวม 2 ธาตุนี้${cfg().dragonStealOnTie ? 'มากกว่าหรือเท่ากับ' : 'มากกว่า'}เจ้าของ ตอนจบเทิร์นของตัวเอง จะแย่งมังกรไปได้</p>
              <p>เจ้าของตอนนี้: <b>${owner == null ? 'ยังไม่มี' : (owner === snap.mySeat ? 'คุณ' : esc(pl(owner).name))}</b></p>
              <table class="scoreboard"><tr><th>ผู้เล่น</th>${els.map((e) => `<th>${TH[e]}</th>`).join('')}<th>รวม</th></tr>
              ${v.players.map((p) => `<tr><td>${p.seat === snap.mySeat ? 'คุณ' : esc(pl(p.seat).name)}</td>${els.map((e) => `<td>${p.bonuses[e]}</td>`).join('')}<td>${els.reduce((a, e) => a + p.bonuses[e], 0)}</td></tr>`).join('')}</table></div>`;
          }
          const g = GUARD[modal.id];
          return `<div class="ag-dialog">${close}<h3>${esc(g.name)}</h3><p class="sub">ภูตพิทักษ์ · ${g.points} เกียรติยศ · มาหาคนแรกที่มีโบนัสครบ (ตอนจบเทิร์น)</p>
            <div class="pick">${Object.keys(g.req).map((e) => chip(e, g.req[e])).join('')}</div></div>`;
        }
        case 'opp': {
          const p = v.players[modal.seat]; const info = pl(p.seat);
          const byEl = ELEMENTS.map((e) => ({ e, ids: p.cards.filter((id) => CARD[id].bonus === e) }));
          return `<div class="ag-dialog">${close}<h3><span style="color:${info.color}">●</span> ${esc(info.name)} · ★${p.points}</h3>
            <div class="ag-label">ผลึก ${p.tokenCount}/${cfg().tokenLimit}</div><div class="me-tokens">${TOKENS.map((t) => `<span class="tok ${p.tokens[t] ? '' : 'zero'}">${gem(t)}<b>${p.tokens[t]}</b></span>`).join('')}</div>
            <div class="ag-label" style="margin-top:8px">การ์ดที่ซื้อ (${p.cards.length})</div>
            <div class="bonus-row">${byEl.map(({ e, ids }) => `<span class="bonus-pip" style="background:${COL[e][1]};min-width:28px;height:28px">${ids.length}</span>`).join('')}</div>
            <div class="ag-label" style="margin-top:8px">การ์ดที่จอง (${p.reserved.length})</div>
            <div class="ag-row">${p.reserved.map((r) => (r.id ? cardHTML(r.id, { act: 'noop', mini: true }) : `<div class="card back mini l${r.level}"><div class="in"><span class="rune">?</span><span class="cnt">Lv${r.level}</span></div></div>`)).join('') || '–'}</div>
            <p class="sub" style="margin-top:8px">ภูต: ${p.guardians.map((id) => esc(GUARD[id].name)).join(', ') || '–'} · ผนึกค้าง ${p.sealsActive} · เก็บค่าสาปได้ ${p.cursesCollected} ครั้ง · คำทำนาย: ${p.prophecy ? esc(PROPH[p.prophecy].name) : 'ลับ'}</p></div>`;
        }
        case 'score': {
          const res = v.result;
          const rows = res.scores.map((s) => {
            const p = v.players[s.seat];
            const cardPts = p.cards.reduce((a, id) => a + CARD[id].points, 0);
            const gPts = p.guardians.reduce((a, id) => a + GUARD[id].points, 0);
            const dPts = v.dragon.owner === s.seat ? cfg().dragonPoints : 0;
            const pr = p.prophecy ? PROPH[p.prophecy] : null;
            return `<tr class="${res.winners.includes(s.seat) ? 'win' : ''}"><td>${res.winners.includes(s.seat) ? '👑 ' : ''}${s.seat === snap.mySeat ? 'คุณ' : esc(pl(s.seat).name)}</td>
              <td>${cardPts}</td><td>${gPts}</td><td>${dPts}</td><td>${pr ? `${esc(pr.name)} ${s.prophecy ? `✓ +${s.prophecy}` : '✗'}` : '–'}</td><td><b>${s.total}</b></td><td>${s.cards}</td></tr>`;
          }).join('');
          return `<div class="ag-dialog" style="width:min(680px,100%)">${close}<h3>ผลการแข่งขัน</h3><p class="sub">เล่นไป ${Math.ceil(res.turns / v.players.length)} รอบ · เสมอกันตัดสินด้วยจำนวนการ์ดที่น้อยกว่า</p>
            <table class="scoreboard"><tr><th>ผู้เล่น</th><th>การ์ด</th><th>ภูต</th><th>มังกร</th><th>คำทำนาย</th><th>รวม</th><th>#การ์ด</th></tr>${rows}</table></div>`;
        }
        case 'rules': {
          const c = cfg();
          return `<div class="ag-dialog" style="width:min(640px,100%)">${close}<h3>กฎ Arcane Guilds</h3><div class="rules">
            <p>เก็บผลึกมานา ซื้อการ์ดศาสตร์เวทที่ให้ <b>โบนัสถาวร</b> (ส่วนลด) แล้วดึงดูดภูตพิทักษ์และมังกร คนแรกที่ถึง <b>${c.winPoints} เกียรติยศ</b> ทำให้เกมเข้ารอบสุดท้าย (เล่นจนครบรอบ)</p>
            <h4>ในเทิร์นของคุณ ทำ 1 อย่าง</h4><ul>
            <li>เก็บผลึก 3 ธาตุไม่ซ้ำ หรือ 2 เม็ดสีเดียว (ถ้ากองนั้นเหลือ ≥ ${c.takeTwoMin})</li>
            <li>จองการ์ด (บนโต๊ะหรือคว่ำจากกอง) ได้ ⭐ ดวงดาว 1 เม็ด · จองค้างได้ ${c.reserveLimit} ใบ</li>
            <li>ซื้อการ์ดบนโต๊ะหรือที่จองไว้ · ⭐ ใช้แทนสีอะไรก็ได้</li>
            <li>วางผนึกเวท 🔒 บนการ์ดบนโต๊ะ + เก็บผลึกต่างธาตุ ${c.seal.takeWith} เม็ด</li></ul>
            <h4>จบเทิร์น</h4><ul><li>ถือผลึกได้ไม่เกิน ${c.tokenLimit} เม็ด</li><li>ภูตพิทักษ์มาหาเมื่อโบนัสครบ (เทิร์นละ 1 ตน, ${3} เกียรติยศ)</li>
            <li>มังกร 🐉 (${c.dragonPoints} เกียรติยศ) ต้องมีโบนัส ${c.dragonReq}+${c.dragonReq} ใน 2 ธาตุ · ใครมีโบนัสรวม${c.dragonStealOnTie ? 'มากกว่าหรือเท่ากับ' : 'มากกว่า'}เจ้าของ แย่งได้</li></ul>
            <h4>ผนึกเวท</h4><ul><li>ถ้าคนอื่นซื้อ/จองการ์ดที่คุณผนึก เขาต้องจ่ายค่าสาป ${c.seal.curse} เม็ดให้คุณ</li><li>ถ้าคุณซื้อเอง ผนึกใช้แทนผลึกได้ ${c.seal.ownerWildCount} เม็ด · ผนึกค้างได้ ${c.seal.maxPerPlayer} อัน</li></ul>
            <h4>คำทำนายลับ</h4><ul><li>เลือก 1 จาก 2 ตอนเริ่มเกม ทำสำเร็จได้เกียรติยศเพิ่มตอนนับคะแนน</li></ul>
            <h4>คะแนนเสมอ</h4><ul><li>คนที่ซื้อการ์ดน้อยกว่าชนะ</li></ul></div></div>`;
        }
        default: return '';
      }
    }

    // ---------- main render ----------
    function autoModal() {
      const v = V(); const m = me();
      if (!m) return;
      if (v.phase === 'prophecy' && !m.prophecyChosen) modal = { kind: 'proph' };
      else if (v.phase === 'discard' && v.turn === snap.mySeat) modal = { kind: 'discard' };
      else if (v.phase === 'guardian' && v.turn === snap.mySeat) modal = { kind: 'guardian' };
      else if (modal && ['proph', 'discard', 'guardian'].includes(modal.kind)) modal = null;
      if (v.phase === 'over' && !scoreShown) { scoreShown = true; setTimeout(() => { modal = { kind: 'score' }; render(); }, 2500); }
    }

    function render() {
      if (!snap || !DATA) return;
      autoModal();
      if (sheet && sheet.kind === 'card' && !inMarket(sheet.id) && !(me() && me().reserved.some((r) => r.id === sheet.id))) sheet = null;
      root.innerHTML = `${DEFS}
        <section class="ag-opps">${oppsHTML()}</section>
        <section class="ag-side">${sideHTML()}</section>
        <section class="ag-market">${marketHTML()}</section>
        <section class="ag-supply">${supplyHTML()}</section>
        <section class="ag-me ${myTurn() ? 'myturn' : ''}">${meHTML()}</section>`;
      const dialog = modal ? modalHTML() : (sheet ? sheetHTML() : '');
      layer.hidden = !dialog;
      layer.innerHTML = dialog ? `${DEFS}${dialog}` : '';
      layout();
    }

    // ---------- sizing ----------
    let lastCw = 0;
    function layout() {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const portrait = H > W * 1.05;
      root.classList.toggle('portrait', portrait);
      const opps = root.querySelector('.ag-opps').offsetHeight || 56;
      const meH = root.querySelector('.ag-me').offsetHeight || 120;
      let cw;
      if (portrait) {
        const side = root.querySelector('.ag-side').offsetHeight;
        const supply = root.querySelector('.ag-supply').offsetHeight;
        cw = Math.min((H - opps - meH - side - supply - 60) / (3 * 1.4 + 0.2), (W - 20) / 5.4);
      } else {
        cw = Math.min((H - opps - meH - 40) / (3 * 1.4 + 0.2), (W - 60) / (5.4 + 1.05 + 0.6));
      }
      cw = Math.max(52, Math.min(150, Math.floor(cw)));
      if (Math.abs(cw - lastCw) >= 1) {
        lastCw = cw;
        root.style.setProperty('--cw', `${cw}px`);
        requestAnimationFrame(layout); // side/supply heights depend on cw in portrait
      }
    }
    const ro = new ResizeObserver(() => layout());
    ro.observe(el);

    // ---------- input ----------
    async function onClick(e) {
      const t = e.target.closest('[data-a]');
      if (!t) {
        if (e.currentTarget === layer && e.target === layer && !(modal && ['proph', 'discard', 'guardian'].includes(modal.kind))) { sheet = null; modal = null; render(); }
        return;
      }
      const a = t.dataset.a;
      const v = V();
      switch (a) {
        case 'pile': toggleSel(t.dataset.c); break;
        case 'clear': sel = []; render(); break;
        case 'take': await send({ type: 'take', colors: sel }); break;
        case 'card': case 'rcard': sheet = { kind: 'card', id: t.dataset.id }; sealColor = null; sealExtra = []; curseColor = null; modal = null; render(); break;
        case 'deck': sheet = { kind: 'deck', level: Number(t.dataset.lv) }; modal = null; render(); break;
        case 'close': sheet = null; modal = null; render(); break;
        case 'curse': curseColor = t.dataset.c; render(); break;
        case 'seal-color': sealColor = t.dataset.c; render(); break;
        case 'seal-extra': {
          const c = t.dataset.c;
          if (sealExtra.includes(c)) sealExtra = sealExtra.filter((x) => x !== c);
          else if (sealExtra.length < (cfg().seal.takeWith || 0)) sealExtra.push(c);
          render(); break;
        }
        case 'do-buy': {
          const bc = buyCheck(sheet.id);
          await send({ type: 'buy', cardId: sheet.id, curseColor: bc.curse ? bc.curse.color : undefined });
          break;
        }
        case 'do-reserve': {
          const rc = reserveCheck(sheet.id);
          await send({ type: 'reserve', cardId: sheet.id, curseColor: rc.curse ? rc.curse.color : undefined });
          break;
        }
        case 'do-reserve-deck': await send({ type: 'reserve', deck: sheet.level }); break;
        case 'do-seal': await send({ type: 'seal', cardId: sheet.id, color: sealColor, colors: sealExtra }); break;
        case 'opp': modal = { kind: 'opp', seat: Number(t.dataset.seat) }; render(); break;
        case 'tile': modal = { kind: 'tile', k: t.dataset.kind, id: t.dataset.id }; render(); break;
        case 'open-proph': modal = { kind: 'proph' }; render(); break;
        case 'pick-proph': await send({ type: 'chooseProphecy', id: t.dataset.id }); break;
        case 'my-proph': modal = { kind: 'my-proph' }; render(); break;
        case 'pick-guardian': await send({ type: 'chooseGuardian', id: t.dataset.id }); break;
        case 'discard-add': {
          const c = t.dataset.c; const m = me();
          if (sum(discardSel) < v.discardNeeded && (discardSel[c] || 0) < m.tokens[c]) discardSel[c] = (discardSel[c] || 0) + 1;
          render(); break;
        }
        case 'discard-reset': discardSel = {}; render(); break;
        case 'discard-ok': await send({ type: 'discard', tokens: discardSel }); break;
        case 'score': modal = { kind: 'score' }; render(); break;
        case 'rules': modal = { kind: 'rules' }; render(); break;
        default: break;
      }
    }
    root.addEventListener('click', onClick);
    layer.addEventListener('click', onClick);
    const onKey = (e) => {
      if (e.key === 'Escape' && (sheet || (modal && !['proph', 'discard', 'guardian'].includes(modal.kind)))) { sheet = null; modal = null; render(); }
      if (e.key === 'Enter' && sel.length && takeValid() && myTurn() && !sheet && !modal) send({ type: 'take', colors: sel });
    };
    document.addEventListener('keydown', onKey);

    root.innerHTML = '<div style="margin:auto;opacity:.7">กำลังโหลด…</div>';

    return {
      update(s) {
        snap = s;
        dataReady.then(() => { pumpLog(); render(); });
      },
      result(s) {
        const res = s.view.result;
        if (!res) return null;
        const names = res.winners.map((w) => (w === s.mySeat ? 'คุณ' : (s.players.find((p) => p.seat === w) || {}).name));
        const top = res.scores.find((x) => x.seat === res.winners[0]);
        return {
          title: res.winners.includes(s.mySeat) ? (res.winners.length > 1 ? 'ชนะร่วม! 🎉' : 'คุณชนะ! 🎉') : `${names.join(', ')} ชนะ`,
          sub: `${top.total} เกียรติยศ · กด "ดูกระดาน" เพื่อดูตารางคะแนน`,
        };
      },
      unmount() {
        ro.disconnect();
        document.removeEventListener('keydown', onKey);
        root.remove(); feed.remove(); layer.remove();
      },
    };
  };
})();
