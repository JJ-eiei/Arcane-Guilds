/* Client shell: screens, lobby, chat, reconnection. Game-specific drawing
   lives in /games/<id>.js and registers itself on window.GameRenderers. */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const STORE_KEY = 'bg.session';
  const NAME_KEY = 'bg.name';

  const socket = io({ transports: ['websocket', 'polling'] });
  let snap = null;            // latest room snapshot from server
  let renderer = null;        // active game renderer
  let rendererId = null;
  let overDismissed = false;
  let unread = 0;

  // ---------- helpers ----------
  const call = (event, payload) => new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) return resolve({ error: 'เซิร์ฟเวอร์ไม่ตอบ ลองอีกครั้ง' });
      resolve(res || {});
    });
  });

  function toast(text, isErr = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = text;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 2800);
  }

  const saveSession = (s) => localStorage.setItem(STORE_KEY, JSON.stringify(s));
  const loadSession = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } };
  const clearSession = () => localStorage.removeItem(STORE_KEY);

  function show(screen) {
    for (const id of ['home', 'lobby', 'game']) $('#screen-' + id).hidden = id !== screen;
  }

  const me = () => snap && snap.players.find((p) => p.id === snap.you);
  const isHost = () => snap && snap.hostId === snap.you;
  const shareUrl = () => `${location.origin}/?room=${snap.code}`;

  async function share() {
    const url = shareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: 'มาเล่นด้วยกัน!', text: `รหัสห้อง ${snap.code}`, url }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์แล้ว'); }
    catch { prompt('คัดลอกลิงก์นี้', url); }
  }

  // ---------- home ----------
  const nameInput = $('#name');
  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('#code').value = params.get('room').toUpperCase().slice(0, 4);

  function getName() {
    const n = nameInput.value.trim();
    if (!n) { toast('ใส่ชื่อก่อนนะ', true); nameInput.focus(); return null; }
    localStorage.setItem(NAME_KEY, n);
    return n;
  }

  function entered(res) {
    if (res.error) return toast(res.error, true);
    saveSession({ code: res.code, token: res.token });
    history.replaceState(null, '', `/?room=${res.code}`);
  }

  $('#btn-create').addEventListener('click', async () => {
    const name = getName(); if (!name) return;
    entered(await call('room:create', { name }));
  });

  $('#code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });

  $('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = getName(); if (!name) return;
    const code = $('#code').value.trim();
    if (code.length !== 4) return toast('รหัสห้องมี 4 ตัวอักษร', true);
    entered(await call('room:join', { code, name }));
  });

  // ---------- lobby ----------
  $('#btn-share').addEventListener('click', share);
  $('#btn-menu-share').addEventListener('click', share);

  async function leave() {
    await call('room:leave');
    clearSession();
    snap = null;
    unmountRenderer();
    history.replaceState(null, '', '/');
    $('#menu').hidden = true;
    show('home');
  }
  $('#btn-leave').addEventListener('click', leave);
  $('#btn-menu-leave').addEventListener('click', () => { if (confirm('ออกจากห้องนี้?')) leave(); });

  $('#btn-start').addEventListener('click', async () => {
    const r = await call('game:start'); if (r.error) toast(r.error, true);
  });

  $('#game-pick').addEventListener('change', async (e) => {
    const r = await call('room:setGame', { gameId: e.target.value }); if (r.error) toast(r.error, true);
  });

  function renderLobby() {
    $('#lobby-code').textContent = snap.code;
    const { game, players } = snap;
    $('#player-count').textContent = `${players.length}/${game.maxPlayers}`;
    const ul = $('#lobby-players');
    ul.replaceChildren(...players.map((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('off');
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name + (p.id === snap.you ? ' (คุณ)' : '');
      li.append(dot, nm);
      if (p.id === snap.hostId) { const t = document.createElement('span'); t.className = 'tag host'; t.textContent = 'หัวห้อง'; li.append(t); }
      if (!p.connected) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'หลุด'; li.append(t); }
      if (isHost() && p.id !== snap.you) {
        const k = document.createElement('button'); k.className = 'kick'; k.textContent = '✕'; k.title = 'เตะออก';
        k.setAttribute('aria-label', `เตะ ${p.name} ออก`);
        k.addEventListener('click', async () => {
          if (!confirm(`เตะ ${p.name} ออกจากห้อง?`)) return;
          const r = await call('room:kick', { playerId: p.id }); if (r.error) toast(r.error, true);
        });
        li.append(k);
      }
      return li;
    }));

    const sel = $('#game-pick');
    sel.replaceChildren(...snap.games.map((g) => {
      const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; return o;
    }));
    sel.value = game.id;
    sel.disabled = !isHost();
    $('#game-pick-wrap').hidden = snap.games.length < 2 && !isHost();
    $('#game-info').textContent = game.minPlayers === game.maxPlayers
      ? `เล่น ${game.minPlayers} คน` : `เล่น ${game.minPlayers}–${game.maxPlayers} คน`;

    const enough = players.length >= game.minPlayers;
    $('#btn-start').hidden = !isHost();
    $('#btn-start').disabled = !enough;
    $('#lobby-hint').textContent = isHost()
      ? (enough ? 'พร้อมแล้ว กดเริ่มเกมได้เลย' : `รอผู้เล่นอีก ${game.minPlayers - players.length} คน — แชร์รหัสห้องให้เพื่อน`)
      : 'รอหัวห้องกดเริ่มเกม…';
  }

  // ---------- game ----------
  function unmountRenderer() {
    if (renderer && renderer.unmount) renderer.unmount();
    renderer = null; rendererId = null;
    $('#board').replaceChildren();
  }

  function ensureRenderer() {
    if (rendererId === snap.game.id && renderer) return;
    unmountRenderer();
    const factory = window.GameRenderers && window.GameRenderers[snap.game.id];
    if (!factory) { $('#board').textContent = 'ไม่พบตัวแสดงผลของเกมนี้'; return; }
    renderer = factory({
      el: $('#board'),
      sendMove: async (move) => {
        const r = await call('game:move', { move });
        if (r.error) toast(r.error, true);
        return r;
      },
    });
    rendererId = snap.game.id;
  }

  function renderGame() {
    ensureRenderer();
    const my = me();
    const mySeat = my ? my.seat : null;

    $('#game-players').replaceChildren(...snap.players.map((p) => {
      const c = document.createElement('div');
      c.className = 'chip' + (p.seat === snap.turnSeat ? ' turn' : '') + (p.id === snap.you ? ' me' : '') + (p.connected ? '' : ' off');
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
      c.append(dot, nm);
      return c;
    }));

    const banner = $('#turn-banner');
    const turnPlayer = snap.players.find((p) => p.seat === snap.turnSeat);
    banner.classList.toggle('mine', snap.turnSeat !== null && snap.turnSeat === mySeat);
    if (snap.status === 'over') banner.textContent = 'จบเกม';
    else if (!turnPlayer) banner.textContent = '';
    else if (turnPlayer.id === snap.you) banner.textContent = 'ตาคุณแล้ว!';
    else banner.textContent = `ตาของ ${turnPlayer.name}${turnPlayer.connected ? '' : ' (หลุดอยู่ รอกลับมา…)'}`;

    if (renderer) renderer.update({ ...snap, mySeat });

    // game-over overlay
    const over = $('#over');
    if (snap.status === 'over' && !overDismissed) {
      const result = renderer && renderer.result ? renderer.result({ ...snap, mySeat }) : null;
      $('#over-title').textContent = result ? result.title : 'จบเกม';
      $('#over-sub').textContent = result ? result.sub || '' : '';
      $('#btn-rematch').hidden = !isHost();
      $('#btn-to-lobby').hidden = !isHost();
      if (!isHost()) $('#over-sub').textContent += (result && result.sub ? ' · ' : '') + 'รอหัวห้องเลือกเล่นต่อ';
      over.hidden = false;
    } else if (snap.status !== 'over') {
      over.hidden = true; overDismissed = false;
    }
    $('#menu-code').textContent = snap.code;
    $('#btn-menu-lobby').hidden = !isHost();
  }

  $('#btn-rematch').addEventListener('click', async () => { const r = await call('game:start'); if (r.error) toast(r.error, true); });
  $('#btn-to-lobby').addEventListener('click', async () => { const r = await call('game:lobby'); if (r.error) toast(r.error, true); });
  $('#btn-menu-lobby').addEventListener('click', async () => {
    if (!confirm('จบเกมนี้แล้วกลับล็อบบี้?')) return;
    const r = await call('game:lobby'); if (r.error) toast(r.error, true); $('#menu').hidden = true;
  });
  $('#btn-over-close').addEventListener('click', () => { overDismissed = true; $('#over').hidden = true; });
  $('#btn-menu').addEventListener('click', () => { $('#menu').hidden = false; });
  $('#btn-menu-close').addEventListener('click', () => { $('#menu').hidden = true; });

  // ---------- chat ----------
  const chat = $('#chat');
  const chatOpen = () => getComputedStyle($('#btn-chat')).display === 'none' || chat.classList.contains('open');
  $('#btn-chat').addEventListener('click', () => {
    chat.classList.toggle('open');
    if (chat.classList.contains('open')) { unread = 0; $('#chat-badge').hidden = true; }
  });
  $('#btn-chat-close').addEventListener('click', () => chat.classList.remove('open'));
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim(); if (!text) return;
    input.value = '';
    const r = await call('chat', { text }); if (r.error) toast(r.error, true);
  });

  socket.on('chat', (m) => {
    const li = document.createElement('li');
    if (m.system) { li.className = 'sys'; li.textContent = m.text; }
    else {
      const who = document.createElement('span'); who.className = 'who'; who.style.color = m.color; who.textContent = m.name + ': ';
      li.append(who, document.createTextNode(m.text));
      if (!chatOpen() && m.from !== (snap && snap.you)) { unread++; $('#chat-badge').hidden = false; }
    }
    const log = $('#chat-log');
    log.append(li);
    while (log.children.length > 150) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  });

  // ---------- server events ----------
  socket.on('room:update', (s) => {
    snap = s;
    if (s.status === 'lobby') { unmountRenderer(); renderLobby(); show('lobby'); }
    else { renderGame(); show('game'); }
  });

  socket.on('kicked', () => {
    clearSession(); snap = null; unmountRenderer();
    history.replaceState(null, '', '/'); show('home');
    toast('คุณถูกเตะออกจากห้อง', true);
  });

  socket.on('connect', async () => {
    $('#conn').hidden = true;
    const saved = loadSession();
    const urlRoom = new URLSearchParams(location.search).get('room');
    if (saved && (!urlRoom || urlRoom.toUpperCase() === saved.code)) {
      const r = await call('room:resume', saved);
      if (r.error) {
        clearSession();
        if (snap) { snap = null; unmountRenderer(); show('home'); toast(r.error, true); }
      }
    }
  });

  socket.on('disconnect', () => { if (snap) $('#conn').hidden = false; });

  show('home');
})();
