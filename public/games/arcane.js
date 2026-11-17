/* Arcane Guilds — browser renderer.
   Registers window.GameRenderers.arcane = ({ el, sendMove }) => ({ update, result, unmount })
   Everything the server sends per seat arrives in snap.view (see engine.view).
   Rules are enforced on the server; checks here only drive the UI.

   Animations: before each re-render we measure where things are (market
   cards, crystal piles, player panels), re-render, then fly "ghost" copies
   from the old positions to the new ones for every new log entry. */
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
  const STARS = { 1: '★', 2: '★★', 3: '★★★' };
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let ART = { cards: [], guardians: [], dragons: [] };
  let CARD = {}, GUARD = {}, DRAGON = {}, PROPH = {}, EVENT = {};
  let loaded = false;
  const dataReady = Promise.all([
    fetch('/api/games/arcane/data').then((r) => r.json()),
    fetch('/art/manifest.json').then((r) => (r.ok ? r.json() : ART)).catch(() => ART),
  ]).then(([d, art]) => {
    ART = art;
    CARD = Object.fromEntries(d.cards.map((c) => [c.id, c]));
    GUARD = Object.fromEntries(d.guardians.map((g) => [g.id, g]));
    DRAGON = Object.fromEntries(d.dragons.map((g) => [g.id, g]));
    PROPH = Object.fromEntries(d.prophecies.map((g) => [g.id, g]));
    EVENT = Object.fromEntries((d.events || []).map((g) => [g.id, g]));
    loaded = true;
  });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

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
  function cardHTML(id, { cls = '', act = 'card', afford = false, mini = false, attrs = '' } = {}) {
    const c = CARD[id];
    if (!c) return '';
    return `<button class="card l${c.level} ${mini ? 'mini' : ''} ${afford ? 'afford' : ''} ${cls}" data-a="${act}" data-id="${c.id}" ${attrs} aria-label="${esc(c.name)}">
      <div class="in">${cardArt(c)}
        <div class="top"><span class="pts">${c.points || ''}</span><span class="lvl">${STARS[c.level]}</span>${gem(c.bonus, 'gem-b')}</div>
        <div class="nm">${esc(c.name)}</div>
        <div class="cost">${ELEMENTS.filter((e) => c.cost[e]).map((e) => chip(e, c.cost[e])).join('')}</div>
      </div></button>`;
  }
  function tileArt(kind, id, els) {
    const dir = kind === 'g' ? 'guardians' : 'dragons';
    const list = kind === 'g' ? ART.guardians : ART.dragons;
    if (list.includes(id)) return `<div class="art" style="background-image:url(/art/${dir}/${id}.webp)"></div>`;
    const bg = els.length === 2
      ? `linear-gradient(135deg, ${COL[els[0]][1]}, #3a1f6e 55%, ${COL[els[1]][1]})`
      : 'radial-gradient(circle at 50% 40%, #c9a7ff, #5a2ea8 60%, #1d1240)';
    return `<div class="art" style="background:${bg}"><div class="gen-art">${emblem(els[0])}</div></div>`;
  }
  // a player's purchased cards, stacked by element (everyone can see them)
  function tableauHTML(p, seat, size) {
    return `<div class="tab ${size}">${ELEMENTS.map((e) => {
      const ids = p.cards.filter((id) => CARD[id].bonus === e);
      const pts = ids.reduce((a, id) => a + CARD[id].points, 0);
      return `<div class="col" data-anchor="tab-${seat}-${e}" title="${TH[e]}: ${ids.length} ใบ${pts ? ` · ${pts} เกียรติยศ` : ''}">
        <span class="col-h" style="background:${COL[e][1]}">${ids.length}</span>
        <div class="stack" style="--k:${ids.length}">${ids.map((id, i) => {
          const c = CARD[id];
          return `<span class="mc l${c.level}" data-tid="${id}" style="--i:${i};background:${elementBg(c.bonus, c.level)}">${c.points ? `<b>${c.points}</b>` : ''}</span>`;
        }).join('')}</div></div>`;
    }).join('')}</div>`;
  }

  // ---------- renderer ----------
  window.GameRenderers = window.GameRenderers || {};
  window.GameRenderers.arcane = ({ el, sendMove }) => {
    const root = document.createElement('div');
    root.className = 'ag';
    el.append(root);
    const feed = document.createElement('div'); feed.className = 'ag-feed'; document.body.append(feed);
    const layer = document.createElement('div'); layer.className = 'ag-layer'; layer.hidden = true; document.body.append(layer);
    const fx = document.createElement('div'); fx.className = 'ag-fx'; document.body.append(fx);
    fx.innerHTML = DEFS;

    let snap = null;
    let sel = [];                  // selected supply colours
    let sheet = null;              // { kind: 'card'|'deck', id|level }
    let modal = null;              // { kind: ... }
    let discardSel = {};
    let xGive = {}, xGet = null;   // black-market exchange picks
    let busy = false;
    let lastLogId = null;
    let scoreShown = false;
    let wasMyTurn = null;    // turnCount of the last turn we announced

    const V = () => snap.view;
    const me = () => (snap.mySeat == null ? null : V().players[snap.mySeat]);
    const pl = (seat) => snap.players.find((p) => p.seat === seat) || { name: '?', color: '#999', connected: true };
    const nameOf = (seat) => (seat === snap.mySeat ? 'คุณ' : pl(seat).name);
    const myTurn = () => V().phase === 'action' && V().turn === snap.mySeat;
    const cfg = () => V().config;
    const ev = () => V().event;
    const inMarket = (id) => [1, 2, 3].some((lv) => V().market[lv].includes(id));

    async function send(move, keep = false) {
      if (busy) return { error: 'busy' };
      busy = true;
      const r = await sendMove(move);
      busy = false;
      if (!r.error && !keep) { sel = []; sheet = null; discardSel = {}; }
      return r;
    }

    // --- rules mirrors (UI only) ---
    function takeRules() {
      const d = ev() && ev().id === 'drought' ? ev().element : null;
      const max = ev() && ev().id === 'storm' ? 4 : 3;
      const avail = ELEMENTS.filter((e) => e !== d && V().supply[e] > 0);
      return { banned: d, max, avail };
    }
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
      let discount = 0;
      if (ev() && ev().id === 'festival' && c.level === 1) {
        if (shortage > 0) shortage -= 1;
        else { const e = ELEMENTS.filter((x) => pay[x] > 0).sort((x, y) => pay[y] - pay[x])[0]; if (e) pay[e] -= 1; }
        discount = 1;
      }
      if (shortage > m.tokens.star) return { ok: false, missing: shortage - m.tokens.star };
      pay.star = shortage;
      return { ok: true, pay, discount };
    }
    function reserveCheck() {
      const m = me();
      if (m.reserved.length >= cfg().reserveLimit) return { ok: false, why: `จองได้สูงสุด ${cfg().reserveLimit} ใบ` };
      return { ok: true, star: V().supply.star > 0 };
    }
    function takeValid() {
      const s = V().supply; const { max, avail } = takeRules();
      if (sel.length === 2 && sel[0] === sel[1]) return s[sel[0]] >= cfg().takeTwoMin;
      return sel.length > 0 && sel.length <= max && new Set(sel).size === sel.length && sel.length >= Math.min(3, avail.length);
    }
    function toggleSel(c) {
      const s = V().supply; const { banned, max } = takeRules();
      if (!myTurn()) return flash('ยังไม่ถึงตาคุณ');
      if (c === 'star') return flash('ดวงดาวได้จากการจองการ์ดเท่านั้น');
      if (c === banned) return flash(`ธาตุ${TH[c]}ขาดแคลน — เก็บไม่ได้รอบนี้`);
      if (s[c] <= 0) return;
      const count = sel.filter((x) => x === c).length;
      if (count === 2) sel = [];
      else if (count === 1) {
        if (sel.length === 1 && s[c] >= cfg().takeTwoMin) sel = [c, c];
        else sel = sel.filter((x) => x !== c);
      } else if (sel.length === 2 && sel[0] === sel[1]) sel = [c];
      else if (sel.length < max) sel.push(c);
      else return flash(`เลือกได้สูงสุด ${max} ธาตุ`);
      render();
    }

    function flash(text, big = false, color = '#fff') {
      const d = document.createElement('div');
      d.className = 'feed-item' + (big ? ' big' : '');
      d.style.setProperty('--c', color);
      d.textContent = text;
      feed.prepend(d);
      while (feed.children.length > 3) feed.lastChild.remove();
      setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, big ? 4500 : 3000);
    }

    function eventBanner(e) {
      const def = EVENT[e.event]; if (!def) return;
      const b = document.createElement('div');
      b.className = 'ag-event';
      b.innerHTML = `<div class="ag-event-card"><div class="ev-omen">ลางบอกเหตุ!</div><div class="ev-icon">${def.icon}</div>
        <div class="ev-name">${esc(def.name)}</div><div class="ev-text">${esc(def.text)}${e.element ? ` — <b>${TH[e.element]}</b>` : ''}</div>
        <div class="ev-dur">${def.kind === 'round' ? 'มีผล 1 รอบ (ทุกคนคนละ 1 ตา)' : 'เกิดขึ้นทันที'}</div></div>`;
      b.addEventListener('click', () => b.remove());
      document.body.append(b);
      setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 400); }, 4200);
    }

    // ---------- measuring & animation ----------
    function rectOf(sel2, scope = document) {
      const n = scope.querySelector(sel2);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height, html: n.outerHTML } : null;
    }
    function capture() {
      if (!root.querySelector('.ag-market')) return null;
      const snapR = { cards: {}, piles: {}, decks: {}, tiles: {} };
      root.querySelectorAll('.ag-market .card[data-id], .ag-me .card[data-id]').forEach((n) => {
        const r = n.getBoundingClientRect(); snapR.cards[n.dataset.id] = { x: r.left, y: r.top, w: r.width, h: r.height, html: n.outerHTML };
      });
      TOKENS.forEach((t) => { snapR.piles[t] = rectOf(`.pile[data-c="${t}"]`, root); });
      [1, 2, 3].forEach((lv) => { snapR.decks[lv] = rectOf(`[data-a="deck"][data-lv="${lv}"]`, root); });
      root.querySelectorAll('.tile[data-id]').forEach((n) => {
        const r = n.getBoundingClientRect(); snapR.tiles[n.dataset.id] = { x: r.left, y: r.top, w: r.width, h: r.height, html: n.outerHTML };
      });
      return snapR;
    }
    const anchor = (name) => rectOf(`[data-anchor="${name}"]`, root);
    const tokenAnchor = (seat, t) => anchor(`tok-${seat}-${t}`) || anchor(`tokens-${seat}`);

    function fly(html, from, to, { delay = 0, dur = 520, size = null, hide = null, arc = true } = {}) {
      if (!from || !to || REDUCED) { if (hide) hide.style.opacity = ''; return; }
      const g = document.createElement('div');
      g.className = 'ag-fly';
      const w = size ? size.w : from.w; const h = size ? size.h : from.h;
      g.style.cssText = `left:${from.x + (from.w - w) / 2}px;top:${from.y + (from.h - h) / 2}px;width:${w}px;height:${h}px;`;
      g.innerHTML = html;
      // cards/tiles size themselves from --cw: match the source element
      if (html.includes('class="tile')) g.style.setProperty('--cw', `${(html.includes('dragon') ? 1 : 1 / 0.82) * from.w}px`);
      else if (html.includes('class="card')) g.style.setProperty('--cw', `${from.w}px`);
      fx.append(g);
      const dx = to.x + to.w / 2 - (from.x + from.w / 2);
      const dy = to.y + to.h / 2 - (from.y + from.h / 2);
      const s = Math.max(0.25, Math.min(1.2, (to.w || w) / w));
      const lift = arc ? -Math.min(80, Math.abs(dx) * 0.15 + 30) : 0;
      const anim = g.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + lift}px) scale(${(1 + s) / 2 * 1.08})`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.9 },
      ], { duration: dur, delay, easing: 'cubic-bezier(.35,.0,.25,1)', fill: 'both' });
      anim.onfinish = () => { g.remove(); if (hide) { hide.style.opacity = ''; pop(hide); } };
    }
    function pop(n) { if (!REDUCED && n) n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); }
    function gemFly(t, from, to, delay) {
      fly(`<div class="ghost-gem">${gem(t)}</div>`, from, to, { delay, dur: 480, size: { w: 30, h: 34 } });
    }

    function animate(before, entries) {
      if (!before || REDUCED) return;
      const v = V();
      let t = 0; // stagger between log entries
      const nextDelay = (ms) => { const d = t; t += ms; return d; };
      // new cards that appeared in the market flip in (refills, eclipse)
      const appeared = [];
      root.querySelectorAll('.ag-market .card[data-id]').forEach((n) => { if (!before.cards[n.dataset.id]) appeared.push(n); });
      appeared.forEach((n) => { n.style.opacity = '0'; });

      for (const e of entries) {
        switch (e.type) {
          case 'take': {
            const d = nextDelay(140);
            e.colors.forEach((c, i) => gemFly(c, before.piles[c], tokenAnchor(e.seat, c), d + i * 90));
            break;
          }
          case 'buy': {
            const d = nextDelay(320);
            const c = CARD[e.cardId];
            const from = before.cards[e.cardId];
            const dest = root.querySelector(`[data-tid="${e.cardId}"]`);
            if (dest) dest.style.opacity = '0';
            // payment flies back to the bank first
            let k = 0;
            for (const tk of TOKENS) for (let i = 0; i < ((e.pay || {})[tk] || 0); i++) gemFly(tk, tokenAnchor(e.seat, tk), anchorPile(tk), d + 60 * k++);
            if (from) fly(from.html, from, rectFromNode(dest) || anchor(`tab-${e.seat}-${c.bonus}`), { delay: d + 120, dur: 650, hide: dest });
            else if (dest) dest.style.opacity = '';
            break;
          }
          case 'reserve': {
            const d = nextDelay(280);
            const to = anchor(`res-${e.seat}`) || anchor(`tokens-${e.seat}`);
            if (e.cardId && before.cards[e.cardId]) fly(before.cards[e.cardId].html, before.cards[e.cardId], to, { delay: d, dur: 600 });
            else if (before.decks[e.level]) fly(before.decks[e.level].html, before.decks[e.level], to, { delay: d, dur: 600 });
            if (e.star) gemFly('star', before.piles.star, tokenAnchor(e.seat, 'star'), d + 200);
            break;
          }
          case 'discard': case 'lose': {
            const d = nextDelay(160);
            let k = 0;
            for (const [tk, n] of Object.entries(e.tokens || {})) for (let i = 0; i < n; i++) gemFly(tk, tokenAnchor(e.seat, tk), anchorPile(tk), d + 70 * k++);
            break;
          }
          case 'gain': {
            const d = nextDelay(150);
            for (const [tk, n] of Object.entries(e.tokens || {})) for (let i = 0; i < n; i++) gemFly(tk, before.piles[tk] || anchorPile(tk), tokenAnchor(e.seat, tk), d);
            break;
          }
          case 'exchange': {
            const d = nextDelay(260);
            let k = 0;
            for (const [tk, n] of Object.entries(e.give || {})) for (let i = 0; i < n; i++) gemFly(tk, tokenAnchor(e.seat, tk), anchorPile(tk), d + 70 * k++);
            gemFly(e.get, before.piles[e.get], tokenAnchor(e.seat, e.get), d + 260);
            break;
          }
          case 'guardian': {
            const d = nextDelay(380);
            const from = before.tiles[e.id];
            if (from) fly(from.html, from, anchor(`guard-${e.seat}`) || anchor(`tokens-${e.seat}`), { delay: d, dur: 700 });
            break;
          }
          case 'guardianAppears': {
            const n = root.querySelector(`.tile[data-id="${e.id}"]`);
            if (n) n.animate([{ transform: 'scale(0) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }], { duration: 700, delay: nextDelay(200), fill: 'backwards' });
            break;
          }
          case 'dragon': {
            const d = nextDelay(400);
            const tile = root.querySelector('.tile.dragon');
            const from = e.from == null ? rectFromNode(tile) : anchor(`guard-${e.from}`) || anchor(`tokens-${e.from}`);
            fly('<div class="ghost-dragon">🐉</div>', from, anchor(`guard-${e.seat}`) || anchor(`tokens-${e.seat}`), { delay: d, dur: 800, size: { w: 56, h: 56 } });
            if (tile) tile.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.8) drop-shadow(0 0 12px #ff8a3d)' }, { filter: 'brightness(1)' }], { duration: 900, delay: d });
            break;
          }
          case 'eclipse': {
            const d = nextDelay(300);
            for (const id of e.gone || []) {
              const r = before.cards[id];
              if (r) fly(r.html, r, before.decks[3] || r, { delay: d, dur: 600, arc: false });
            }
            break;
          }
          default: break;
        }
      }
      // reveal refilled cards with a flip after the flights
      appeared.forEach((n, i) => {
        n.animate([{ transform: 'rotateY(90deg) scale(.9)', opacity: 0 }, { transform: 'rotateY(0) scale(1)', opacity: 1 }],
          { duration: 420, delay: Math.min(t, 900) + 250 + i * 80, easing: 'ease-out', fill: 'backwards' })
          .onfinish = () => { n.style.opacity = ''; };
        setTimeout(() => { n.style.opacity = ''; }, Math.min(t, 900) + 260 + i * 80);
      });
    }
    function rectFromNode(n) { if (!n) return null; const r = n.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }
    function anchorPile(t) { return rectOf(`.pile[data-c="${t}"]`, root); }

    // --- event feed (text) for things animations don't explain on their own ---
    function feedFor(e) {
      const who = e.seat != null ? pl(e.seat) : null;
      const name = e.seat != null ? nameOf(e.seat) : '';
      const color = who ? who.color : '#fff';
      switch (e.type) {
        case 'start': flash(`เริ่มเกม — ${nameOf(e.firstSeat)} เล่นก่อน`, true, '#ffd36b'); break;
        case 'buy': if (e.seat !== snap.mySeat) flash(`${name} ซื้อ "${CARD[e.cardId].name}"${CARD[e.cardId].points ? ` (+${CARD[e.cardId].points})` : ''}`, false, color); break;
        case 'reserve': if (e.seat !== snap.mySeat) flash(`${name} จอง${e.cardId ? ` "${CARD[e.cardId].name}"` : `การ์ดคว่ำ Lv${e.level}`}`, false, color); break;
        case 'guardian': flash(`${name} ได้ภูต "${GUARD[e.id].name}" (+3)`, true, color); break;
        case 'dragon': flash(e.from == null ? `🐉 ${name} ได้มังกร!` : `🐉 ${name} แย่งมังกรจาก ${nameOf(e.from)}!`, true, color); break;
        case 'finalRound': flash(`${name} ถึง ${cfg().winPoints} เกียรติยศ — รอบสุดท้าย!`, true, '#ff8b8b'); break;
        case 'event': eventBanner(e); break;
        case 'eventEnd': flash(`${EVENT[e.event] ? EVENT[e.event].icon + ' ' + EVENT[e.event].name : 'event'} หมดผลแล้ว`, false, '#c9a7ff'); break;
        case 'omenFizzle': flash('ลางบอกเหตุเลือนหายไป… (ยังไม่ถึงเวลา)', false, '#c9a7ff'); break;
        case 'lose': flash(`🐉 มังกรพิโรธ: ${name} เสียผลึก ${sum(e.tokens)} เม็ด`, false, color); break;
        case 'exchange': if (e.seat !== snap.mySeat) flash(`🌑 ${name} แลกผลึกในตลาดมืด`, false, color); break;
        default: break;
      }
    }

    // ---------- area renderers ----------
    function oppsHTML() {
      const v = V();
      return v.players.filter((p) => p.seat !== snap.mySeat).map((p) => {
        const info = pl(p.seat);
        const turn = v.turn === p.seat && v.phase !== 'over';
        return `<button class="opp ${turn ? 'turn' : ''} ${info.connected ? '' : 'off'}" data-a="opp" data-seat="${p.seat}">
          <div class="opp-head">
            <span class="who"><span class="dot" style="background:${info.color}"></span>${esc(info.name)}</span>
            <span class="score">★${p.points}</span>
            <span class="mini-gems" data-anchor="tokens-${p.seat}">${TOKENS.map((t) => (p.tokens[t] ? `<span class="mini-gem">${gem(t)}${p.tokens[t]}</span>` : '')).join('') || '<span class="mini-gem dim">ไม่มีผลึก</span>'}</span>
            <span class="opp-tags" data-anchor="guard-${p.seat}">
              ${p.guardians.length ? `<span class="tag">👻×${p.guardians.length}</span>` : ''}
              ${v.dragon.owner === p.seat ? '<span class="tag">🐉</span>' : ''}
              ${v.phase === 'prophecy' ? `<span class="tag">${p.prophecyChosen ? '✓ เลือกแล้ว' : '…กำลังเลือก'}</span>` : ''}
            </span>
            <span class="opp-res" data-anchor="res-${p.seat}">${p.reserved.map((r) => `<span class="res-back l${r.id ? CARD[r.id].level : r.level}">${r.id ? (CARD[r.id].points || '') : '?'}</span>`).join('')}</span>
          </div>
          ${tableauHTML(p, p.seat, 'small')}
        </button>`;
      }).join('');
    }

    function sideHTML() {
      const v = V();
      const d = DRAGON[v.dragon.id];
      const dreq = Object.keys(d.req);
      const owner = v.dragon.owner;
      const g = v.guardians.map((id) => {
        const G = GUARD[id]; const els = Object.keys(G.req);
        return `<button class="tile" data-a="tile" data-kind="g" data-id="${id}" aria-label="${esc(G.name)}"><div class="in">${tileArt('g', id, els)}
          <span class="pts">${G.points}</span><span class="req">${els.map((e) => chip(e, G.req[e])).join('')}</span></div></button>`;
      }).join('');
      const dragon = `<button class="tile dragon" data-a="tile" data-kind="d" data-id="${d.id}" aria-label="${esc(d.name)}"><div class="in">${tileArt('d', d.id, dreq)}
        <span class="pts">${cfg().dragonPoints}</span>
        ${owner != null ? `<span class="owner" style="border-color:${pl(owner).color}">🐉 ${esc(nameOf(owner))}</span>` : ''}
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
          ? cardHTML(id, { afford: myTurn() && (plan(id) || {}).ok })
          : '<div class="card empty"></div>')).join('');
        return `<div class="ag-row">${deck}${cards}</div>`;
      }).join('');
    }

    function supplyHTML() {
      const s = V().supply; const { banned } = takeRules();
      return TOKENS.map((t) => {
        const k = sel.filter((x) => x === t).length;
        return `<button class="pile ${t === 'star' ? 'star' : ''} ${s[t] ? '' : 'empty'} ${k ? 'sel' : ''} ${t === banned ? 'banned' : ''}" data-a="pile" data-c="${t}" data-sel="${k}" aria-label="${TH[t]} เหลือ ${s[t]}">${gem(t)}<span class="n">${s[t]}</span>${t === banned ? '<span class="ban">🏜️</span>' : ''}</button>`;
      }).join('');
    }

    function eventChip() {
      const e = ev(); if (!e) return '';
      const def = EVENT[e.id] || { icon: '✦', name: e.id };
      const turnsLeft = Math.max(1, e.remaining);
      return `<button class="ev-chip" data-a="event-info">${def.icon} ${esc(def.name)}${e.element ? ` (${TH[e.element]})` : ''} · อีก ${turnsLeft} ตา</button>`;
    }

    function meHTML() {
      const v = V(); const m = me();
      if (!m) return '<div class="hint">คุณกำลังดูเกมนี้</div>';
      const total = sum(m.tokens);
      const pr = m.prophecy && PROPH[m.prophecy];
      let hint = ''; let actions = '';
      if (v.phase === 'prophecy') {
        hint = m.prophecyChosen ? `รอผู้เล่นอื่นเลือกคำทำนาย (${v.players.filter((p) => p.prophecyChosen).length}/${v.players.length})` : 'เลือกคำทำนายของคุณ';
        if (!m.prophecyChosen) actions = '<button class="agbtn primary" data-a="open-proph">เลือกคำทำนาย</button>';
      } else if (v.phase === 'over') {
        hint = 'จบเกมแล้ว';
        actions = '<button class="agbtn primary" data-a="score">ตารางคะแนน</button>';
      } else if (myTurn()) {
        const { max } = takeRules();
        if (sel.length) {
          hint = sel.length === 1 && v.supply[sel[0]] >= cfg().takeTwoMin ? 'แตะธาตุเดิมอีกครั้ง = เก็บ 2 เม็ดสีเดียว' : (takeValid() ? 'พร้อมเก็บ' : `เลือกให้ครบ ${max === 4 ? '3–4' : '3'} ธาตุ หรือ 2 เม็ดสีเดียว`);
          actions = `<button class="agbtn ghost" data-a="clear">ล้าง</button><button class="agbtn go" data-a="take" ${takeValid() ? '' : 'disabled'}>เก็บผลึก</button>`;
        } else hint = `✨ ตาคุณ — แตะผลึกเพื่อเก็บ${max === 4 ? ' (ได้ถึง 4 ธาตุ!)' : ''} หรือแตะการ์ดเพื่อซื้อ / จอง`;
        if (ev() && ev().id === 'black' && !ev().usedByMe) actions = `<button class="agbtn dark" data-a="open-exchange">🌑 แลกผลึก</button>${actions}`;
      } else if (v.phase === 'discard' || v.phase === 'guardian') {
        hint = v.turn === snap.mySeat ? (v.phase === 'discard' ? 'คืนผลึกให้เหลือไม่เกินลิมิต' : 'เลือกภูตพิทักษ์') : `รอ ${esc(pl(v.turn).name)}…`;
      } else hint = `รอ ${esc(pl(v.turn).name)} เล่น…`;
      if (v.finalRound && v.phase !== 'over') hint = `<span class="final">รอบสุดท้าย!</span> ${hint}`;

      const reserved = m.reserved.map((r) => (r.id ? cardHTML(r.id, { act: 'rcard', mini: true, afford: myTurn() && (plan(r.id) || {}).ok }) : '')).join('');
      return `
        <div class="me-score"><span class="ag-label">เกียรติยศ</span><span class="score">★${m.points}</span></div>
        <div class="me-block"><span class="ag-label">ผลึก <span class="limit ${total > cfg().tokenLimit ? 'over' : ''}">${total}/${cfg().tokenLimit}</span></span>
          <div class="me-tokens" data-anchor="tokens-${snap.mySeat}">${TOKENS.map((t) => `<span class="tok ${m.tokens[t] ? '' : 'zero'}" data-anchor="tok-${snap.mySeat}-${t}">${gem(t)}<b>${m.tokens[t]}</b></span>`).join('')}</div></div>
        <div class="me-block"><span class="ag-label">การ์ดของคุณ (โบนัส)</span>${tableauHTML(m, snap.mySeat, 'big')}</div>
        <div class="me-block" data-anchor="res-${snap.mySeat}"><span class="ag-label">จองไว้ ${m.reserved.length}/${cfg().reserveLimit}</span><div class="ag-row">${reserved || '<span class="dim">–</span>'}</div></div>
        <div class="me-block" data-anchor="guard-${snap.mySeat}">
          ${pr ? `<button class="prophecy-mini" data-a="my-proph"><span class="ag-label">🔮 คำทำนายลับ</span><span class="t">${esc(pr.name)} +${pr.points}</span></button>` : ''}
          <div class="ag-row" style="gap:4px;flex-wrap:wrap">${m.guardians.map((id) => `<span class="tag">👻 ${esc(GUARD[id].name)}</span>`).join('')}${v.dragon.owner === snap.mySeat ? '<span class="tag">🐉 มังกร</span>' : ''}</div>
        </div>
        <div class="me-actions"><span class="hint">${hint}</span>${actions}<button class="agbtn ghost" data-a="rules" aria-label="กฎ">กฎ</button></div>`;
    }

    // ---------- dialogs ----------
    function sheetHTML() {
      const v = V(); const m = me();
      const close = '<button class="close-x" data-a="close">✕</button>';
      if (sheet.kind === 'deck') {
        const rc = m && reserveCheck();
        return `<div class="ag-dialog">${close}<h3>จองการ์ดคว่ำ Lv${sheet.level}</h3><p class="sub">หยิบใบบนสุดของกองโดยไม่ให้คนอื่นเห็น${rc && rc.star ? ' และได้ ⭐ ดวงดาว 1 เม็ด' : ''}</p>
          ${!myTurn() ? '<p class="sub">ยังไม่ถึงตาคุณ</p>' : (rc.ok ? '' : `<p class="why">${rc.why}</p>`)}
          <button class="agbtn primary" data-a="do-reserve-deck" ${myTurn() && rc.ok ? '' : 'disabled'}>จอง</button></div>`;
      }
      const id = sheet.id; const c = CARD[id];
      const fromMarket = inMarket(id);
      let body = '';
      if (m && !myTurn()) body = '<div class="act"><div class="why">ยังไม่ถึงตาคุณ — ดูข้อมูลได้อย่างเดียว</div></div>';
      else if (m) {
        const p = plan(id);
        const payChips = p && p.ok ? TOKENS.filter((t) => p.pay[t]).map((t) => chip(t, p.pay[t])).join('') : '';
        body += `<div class="act"><b>ซื้อ</b>
          ${p && p.ok ? `<div class="pay">จ่าย: ${payChips || '<span>ฟรี! (โบนัสพอ)</span>'}${p.discount ? ' <span class="tag">🎪 ลด 1</span>' : ''}</div>` : `<div class="why">ขาดผลึกอีก ${p ? p.missing : '?'} เม็ด</div>`}
          <button class="agbtn go" data-a="do-buy" ${p && p.ok ? '' : 'disabled'}>ซื้อการ์ดนี้</button></div>`;
        if (fromMarket) {
          const rc = reserveCheck();
          body += `<div class="act"><b>จอง ${rc.star ? '(+⭐ ดวงดาว)' : ''}</b>${rc.ok ? '<span class="sub" style="margin:0">เก็บการ์ดไว้ซื้อทีหลัง คนอื่นจะซื้อใบนี้ไม่ได้</span>' : `<div class="why">${rc.why}</div>`}
            <button class="agbtn primary" data-a="do-reserve" ${rc.ok ? '' : 'disabled'}>จองการ์ดนี้</button></div>`;
        }
      }
      return `<div class="ag-dialog">${close}
        <div class="sheet-body"><div class="sheet-card">${cardHTML(id, { act: 'noop' })}</div>
        <div class="sheet-info"><div><h3>${esc(c.name)}</h3><p class="sub">Lv${c.level} · ให้โบนัส ${TH[c.bonus]} ถาวร${c.points ? ` · ${c.points} เกียรติยศ` : ''}</p></div>${body}</div></div></div>`;
    }

    function modalHTML() {
      const v = V(); const m = me();
      const close = '<button class="close-x" data-a="close">✕</button>';
      switch (modal.kind) {
        case 'proph': {
          const opts = m.prophecyOptions || [];
          return `<div class="ag-dialog"><h3>🔮 เลือกคำทำนายลับ</h3><p class="sub">เก็บไว้ 1 ใบ คนอื่นจะไม่เห็นจนจบเกม · ทำสำเร็จได้เกียรติยศเพิ่มตอนนับคะแนน</p>
            <div class="choice-row">${opts.map((pid) => { const p = PROPH[pid]; return `<button class="proph-card" data-a="pick-proph" data-id="${pid}"><div class="eye">🔮</div><div class="t">${esc(p.name)}</div><div>${esc(p.text)}</div><div class="pts">+${p.points}</div></button>`; }).join('')}</div></div>`;
        }
        case 'my-proph': {
          const p = PROPH[m.prophecy];
          return `<div class="ag-dialog">${close}<h3>🔮 ${esc(p.name)}</h3><p class="sub">${esc(p.text)} → +${p.points} เกียรติยศตอนจบเกม (ไม่นับตอนเช็ก ${cfg().winPoints} แต้ม)</p></div>`;
        }
        case 'event-info': {
          const e = ev(); if (!e) return '';
          const def = EVENT[e.id];
          return `<div class="ag-dialog">${close}<h3>${def.icon} ${esc(def.name)}</h3><p class="sub">${esc(def.text)}${e.element ? ` — ธาตุ <b>${TH[e.element]}</b>` : ''}</p><p class="sub">มีผลอีก ${e.remaining} ตา (เปิดโดย ${esc(nameOf(e.by))})</p></div>`;
        }
        case 'exchange': {
          const given = sum(xGive);
          return `<div class="ag-dialog">${close}<h3>🌑 ตลาดมืด</h3><p class="sub">ให้ผลึก 2 เม็ด รับ 1 เม็ดสีไหนก็ได้ · ใช้ได้ 1 ครั้ง ไม่เสียตา</p>
            <div class="ag-label">ให้ (เลือกแล้ว ${given}/2)</div>
            <div class="pick">${TOKENS.filter((t) => m.tokens[t]).map((t) => `<button class="${xGive[t] ? 'on' : ''}" data-a="x-give" data-c="${t}">${gem(t)}<b>${m.tokens[t] - (xGive[t] || 0)}</b></button>`).join('')}</div>
            <div class="ag-label" style="margin-top:10px">รับ</div>
            <div class="pick">${ELEMENTS.map((e) => `<button class="${xGet === e ? 'on' : ''}" data-a="x-get" data-c="${e}" ${v.supply[e] ? '' : 'disabled'}>${gem(e)}<b>${v.supply[e]}</b></button>`).join('')}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="agbtn ghost" data-a="x-reset">เริ่มใหม่</button><button class="agbtn go" data-a="x-ok" ${given === 2 && xGet ? '' : 'disabled'}>แลก</button></div></div>`;
        }
        case 'discard': {
          const need = v.discardNeeded; const chosen = sum(discardSel);
          return `<div class="ag-dialog"><h3>ผลึกเกิน ${cfg().tokenLimit} เม็ด</h3><p class="sub">แตะเพื่อเลือกคืน ${need} เม็ด (เลือกแล้ว ${chosen})</p>
            <div class="pick" style="justify-content:center">${TOKENS.filter((t) => m.tokens[t]).map((t) => `<button class="${discardSel[t] ? 'on' : ''}" data-a="discard-add" data-c="${t}">${gem(t)}<b>${m.tokens[t] - (discardSel[t] || 0)}</b></button>`).join('')}</div>
            <p class="sub" style="margin-top:10px">คืน: ${TOKENS.filter((t) => discardSel[t]).map((t) => chip(t, discardSel[t])).join('') || '–'}</p>
            <div style="display:flex;gap:8px;justify-content:flex-end"><button class="agbtn ghost" data-a="discard-reset">เริ่มใหม่</button><button class="agbtn go" data-a="discard-ok" ${chosen === need ? '' : 'disabled'}>คืนผลึก</button></div></div>`;
        }
        case 'guardian':
          return `<div class="ag-dialog"><h3>ภูตพิทักษ์หลายตนอยากมาหาคุณ</h3><p class="sub">เลือกได้ 1 ตน (ตนอื่นยังรออยู่บนโต๊ะ)</p>
            <div class="choice-row">${v.pendingGuardians.map((gid) => { const g = GUARD[gid]; const els = Object.keys(g.req); return `<button class="proph-card" data-a="pick-guardian" data-id="${gid}" style="border-color:#a36bff"><div class="t">${esc(g.name)}</div><div class="pick" style="justify-content:center">${els.map((e) => chip(e, g.req[e])).join('')}</div><div class="pts">+${g.points}</div></button>`; }).join('')}</div></div>`;
        case 'tile': {
          if (modal.k === 'd') {
            const d = DRAGON[modal.id]; const els = Object.keys(d.req); const owner = v.dragon.owner;
            return `<div class="ag-dialog">${close}<h3>🐉 ${esc(d.name)}</h3>
              <p class="sub">ต้องมีโบนัส ${els.map((e) => `${TH[e]} ≥ ${cfg().dragonReq}`).join(' และ ')} · ${cfg().dragonPoints} เกียรติยศ</p>
              <p class="sub">ใครมีโบนัสรวม 2 ธาตุนี้${cfg().dragonStealOnTie ? 'มากกว่าหรือเท่ากับ' : 'มากกว่า'}เจ้าของ ตอนจบเทิร์นของตัวเอง จะแย่งมังกรไปได้</p>
              <p>เจ้าของตอนนี้: <b>${owner == null ? 'ยังไม่มี' : esc(nameOf(owner))}</b></p>
              <table class="scoreboard"><tr><th>ผู้เล่น</th>${els.map((e) => `<th>${TH[e]}</th>`).join('')}<th>รวม</th></tr>
              ${v.players.map((p) => `<tr><td>${esc(nameOf(p.seat))}</td>${els.map((e) => `<td>${p.bonuses[e]}</td>`).join('')}<td>${els.reduce((a, e) => a + p.bonuses[e], 0)}</td></tr>`).join('')}</table></div>`;
          }
          const g = GUARD[modal.id];
          return `<div class="ag-dialog">${close}<h3>${esc(g.name)}</h3><p class="sub">ภูตพิทักษ์ · ${g.points} เกียรติยศ · มาหาคนแรกที่มีโบนัสครบ (ตอนจบเทิร์น)</p>
            <div class="pick">${Object.keys(g.req).map((e) => chip(e, g.req[e])).join('')}</div></div>`;
        }
        case 'opp': {
          const p = v.players[modal.seat]; const info = pl(p.seat);
          return `<div class="ag-dialog">${close}<h3><span style="color:${info.color}">●</span> ${esc(info.name)} · ★${p.points}</h3>
            <div class="ag-label">ผลึก ${p.tokenCount}/${cfg().tokenLimit}</div><div class="me-tokens">${TOKENS.map((t) => `<span class="tok ${p.tokens[t] ? '' : 'zero'}">${gem(t)}<b>${p.tokens[t]}</b></span>`).join('')}</div>
            <div class="ag-label" style="margin-top:10px">การ์ดที่ซื้อ (${p.cards.length})</div>
            <div class="ag-row" style="flex-wrap:wrap;gap:6px">${p.cards.map((cid) => cardHTML(cid, { act: 'noop', mini: true })).join('') || '–'}</div>
            <div class="ag-label" style="margin-top:10px">การ์ดที่จอง (${p.reserved.length})</div>
            <div class="ag-row">${p.reserved.map((r) => (r.id ? cardHTML(r.id, { act: 'noop', mini: true }) : `<div class="card back mini l${r.level}"><div class="in"><span class="rune">?</span><span class="cnt">Lv${r.level}</span></div></div>`)).join('') || '–'}</div>
            <p class="sub" style="margin-top:8px">ภูต: ${p.guardians.map((gid) => esc(GUARD[gid].name)).join(', ') || '–'} · คำทำนาย: ${p.prophecy ? esc(PROPH[p.prophecy].name) : 'ลับ'}</p></div>`;
        }
        case 'score': {
          const res = v.result;
          const rows = res.scores.map((s) => {
            const p = v.players[s.seat];
            const cardPts = p.cards.reduce((a, cid) => a + CARD[cid].points, 0);
            const gPts = p.guardians.reduce((a, gid) => a + GUARD[gid].points, 0);
            const dPts = v.dragon.owner === s.seat ? cfg().dragonPoints : 0;
            const pr = p.prophecy ? PROPH[p.prophecy] : null;
            return `<tr class="${res.winners.includes(s.seat) ? 'win' : ''}"><td>${res.winners.includes(s.seat) ? '👑 ' : ''}${esc(nameOf(s.seat))}</td>
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
            <li>ซื้อการ์ดบนโต๊ะหรือที่จองไว้ · โบนัสลดราคา · ⭐ ใช้แทนสีอะไรก็ได้</li></ul>
            <h4>จบเทิร์น</h4><ul><li>ถือผลึกได้ไม่เกิน ${c.tokenLimit} เม็ด</li><li>ภูตพิทักษ์มาหาเมื่อโบนัสครบ (เทิร์นละ 1 ตน, 3 เกียรติยศ)</li>
            <li>มังกร 🐉 (${c.dragonPoints} เกียรติยศ) ต้องมีโบนัส ${c.dragonReq}+${c.dragonReq} ใน 2 ธาตุ · ใครมีโบนัสรวม${c.dragonStealOnTie ? 'มากกว่าหรือเท่ากับ' : 'มากกว่า'}เจ้าของ แย่งได้</li></ul>
            <h4>ลางบอกเหตุ</h4><ul><li>มีการ์ดลางบอกเหตุซ่อนอยู่ในกอง เมื่อถูกเปิดจะเกิด event สุ่ม (ไม่เกิดก่อนรอบ ${c.omens.firstRound} และห่างกันอย่างน้อย ${c.omens.minGap} รอบ)</li>
            ${Object.values(EVENT).map((e) => `<li>${e.icon} <b>${esc(e.name)}</b> — ${esc(e.text)}</li>`).join('')}</ul>
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
      if (modal && modal.kind === 'exchange' && !(ev() && ev().id === 'black' && !ev().usedByMe && myTurn())) modal = null;
      if (v.phase === 'over' && !scoreShown) { scoreShown = true; setTimeout(() => { modal = { kind: 'score' }; render(); }, 3000); }
    }

    function render() {
      if (!snap || !loaded) return;
      autoModal();
      if (sheet && sheet.kind === 'card' && !inMarket(sheet.id) && !(me() && me().reserved.some((r) => r.id === sheet.id))) sheet = null;
      root.innerHTML = `${DEFS}
        <section class="ag-opps">${oppsHTML()}</section>
        <section class="ag-side">${sideHTML()}</section>
        <section class="ag-market">${eventChip()}${marketHTML()}</section>
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
      const W = el.clientWidth; const H = el.clientHeight;
      if (!W || !H) return;
      const portrait = H > W * 1.05;
      root.classList.toggle('portrait', portrait);
      const opps = root.querySelector('.ag-opps').offsetHeight || 56;
      const meH = root.querySelector('.ag-me').offsetHeight || 120;
      const chipH = root.querySelector('.ev-chip') ? 34 : 0;
      let cw;
      if (portrait) {
        const side = root.querySelector('.ag-side').offsetHeight;
        const supply = root.querySelector('.ag-supply').offsetHeight;
        cw = Math.min((H - opps - meH - side - supply - chipH - 60) / (3 * 1.4 + 0.2), (W - 20) / 5.4);
      } else {
        cw = Math.min((H - opps - meH - chipH - 40) / (3 * 1.4 + 0.2), (W - 60) / (5.4 + 1.05 + 0.6));
      }
      cw = Math.max(48, Math.min(150, Math.floor(cw)));
      if (Math.abs(cw - lastCw) >= 1) {
        lastCw = cw;
        root.style.setProperty('--cw', `${cw}px`);
        requestAnimationFrame(layout);
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
      const a = t.dataset.a; const v = V();
      switch (a) {
        case 'pile': toggleSel(t.dataset.c); break;
        case 'clear': sel = []; render(); break;
        case 'take': await send({ type: 'take', colors: sel }); break;
        case 'card': case 'rcard': sheet = { kind: 'card', id: t.dataset.id }; modal = null; render(); break;
        case 'deck': sheet = { kind: 'deck', level: Number(t.dataset.lv) }; modal = null; render(); break;
        case 'close': sheet = null; modal = null; render(); break;
        case 'do-buy': await send({ type: 'buy', cardId: sheet.id }); break;
        case 'do-reserve': await send({ type: 'reserve', cardId: sheet.id }); break;
        case 'do-reserve-deck': await send({ type: 'reserve', deck: sheet.level }); break;
        case 'opp': modal = { kind: 'opp', seat: Number(t.dataset.seat) }; render(); break;
        case 'tile': modal = { kind: 'tile', k: t.dataset.kind, id: t.dataset.id }; render(); break;
        case 'event-info': modal = { kind: 'event-info' }; render(); break;
        case 'open-proph': modal = { kind: 'proph' }; render(); break;
        case 'pick-proph': await send({ type: 'chooseProphecy', id: t.dataset.id }); break;
        case 'my-proph': modal = { kind: 'my-proph' }; render(); break;
        case 'pick-guardian': await send({ type: 'chooseGuardian', id: t.dataset.id }); break;
        case 'open-exchange': xGive = {}; xGet = null; modal = { kind: 'exchange' }; render(); break;
        case 'x-give': {
          const c = t.dataset.c;
          if (sum(xGive) < 2 && (xGive[c] || 0) < me().tokens[c]) xGive[c] = (xGive[c] || 0) + 1;
          render(); break;
        }
        case 'x-get': xGet = t.dataset.c; render(); break;
        case 'x-reset': xGive = {}; xGet = null; render(); break;
        case 'x-ok': { const r = await send({ type: 'exchange', give: xGive, get: xGet }, true); if (!r.error) { modal = null; render(); } break; }
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
        dataReady.then(() => {
          const log = V().log || [];
          const first = lastLogId === null;
          const fresh = first ? [] : log.filter((e) => e.id > lastLogId);
          if (log.length) lastLogId = Math.max(lastLogId || 0, log[log.length - 1].id);
          const before = first ? null : capture();
          render();
          fresh.forEach(feedFor);
          animate(before, fresh);
          // announce "your turn" once per turn
          if (myTurn() && V().turnCount !== wasMyTurn && !first) { flash('✨ ตาคุณแล้ว!', false, '#ffd36b'); pop(root.querySelector('.ag-me')); }
          if (myTurn()) wasMyTurn = V().turnCount;
        });
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
        root.remove(); feed.remove(); layer.remove(); fx.remove();
      },
    };
  };
})();
