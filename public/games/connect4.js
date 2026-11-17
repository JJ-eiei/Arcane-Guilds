/* Renderer for the sample Connect 4 game.
   Renderer interface (copy this for your own game):
     window.GameRenderers[gameId] = ({ el, sendMove }) => ({
       update(snapshot),   // snapshot.view = what server's view() returned, snapshot.mySeat
       result(snapshot),   // optional: { title, sub } for the game-over card
       unmount(),          // optional cleanup
     })
*/
(() => {
  const ROWS = 6, COLS = 7, CELL = 100, TOP = 100;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  window.GameRenderers = window.GameRenderers || {};
  window.GameRenderers.connect4 = ({ el, sendMove }) => {
    let snap = null;
    let hoverCol = null;
    let lastKey = null;
    let busy = false;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${COLS * CELL} ${TOP + ROWS * CELL + 10}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img', tabindex: '0', 'aria-label': 'กระดาน Connect 4 — ใช้ลูกศรซ้ายขวาแล้วกด Enter หรือกดเลข 1–7',
    });
    Object.assign(svg.style, {
      width: '100%', height: '100%', maxWidth: '860px', maxHeight: '100%',
      touchAction: 'none', outline: 'none', display: 'block', cursor: 'pointer',
    });

    const defs = svgEl('defs');
    // board with holes cut out
    const mask = svgEl('mask', { id: 'c4holes' });
    mask.append(svgEl('rect', { x: 0, y: TOP, width: COLS * CELL, height: ROWS * CELL, fill: '#fff' }));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      mask.append(svgEl('circle', { cx: c * CELL + CELL / 2, cy: TOP + r * CELL + CELL / 2, r: 38, fill: '#000' }));
    }
    defs.append(mask);
    svg.append(defs);

    const hover = svgEl('g');
    const discs = svgEl('g');
    const board = svgEl('rect', {
      x: 0, y: TOP, width: COLS * CELL, height: ROWS * CELL, rx: 24,
      fill: '#f6efe2', mask: 'url(#c4holes)', stroke: '#1f1a17', 'stroke-width': 4,
    });
    const shadow = svgEl('rect', { x: 6, y: TOP + 10, width: COLS * CELL - 12, height: ROWS * CELL, rx: 24, fill: 'rgba(0,0,0,.35)' });
    const marks = svgEl('g');
    svg.append(shadow, hover, discs, board, marks);
    el.append(svg);

    const playerColor = (seat) => {
      const p = snap && snap.players.find((x) => x.seat === seat);
      return p ? p.color : '#999';
    };
    const myTurn = () => snap && snap.status === 'playing' && snap.turnSeat === snap.mySeat;

    function colFromEvent(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const c = Math.floor(p.x / CELL);
      return c >= 0 && c < COLS ? c : null;
    }

    function drawHover() {
      hover.replaceChildren();
      if (!myTurn() || hoverCol === null) return;
      hover.append(svgEl('circle', {
        cx: hoverCol * CELL + CELL / 2, cy: TOP / 2, r: 38,
        fill: playerColor(snap.mySeat), opacity: 0.85,
      }));
      hover.append(svgEl('rect', { x: hoverCol * CELL, y: TOP, width: CELL, height: ROWS * CELL, fill: 'rgba(255,255,255,.08)' }));
    }

    async function drop(col) {
      if (!myTurn() || busy || col === null) return;
      busy = true;
      await sendMove({ col });
      busy = false;
    }

    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { hoverCol = colFromEvent(e); drawHover(); }
    });
    svg.addEventListener('pointerleave', () => { hoverCol = null; drawHover(); });
    svg.addEventListener('pointerdown', (e) => { hoverCol = colFromEvent(e); drawHover(); });
    svg.addEventListener('pointerup', (e) => {
      const c = colFromEvent(e);
      if (c !== null && c === hoverCol) drop(c);
      if (e.pointerType !== 'mouse') { hoverCol = null; drawHover(); }
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key >= '1' && e.key <= String(COLS)) { drop(Number(e.key) - 1); return; }
      if (e.key === 'ArrowLeft') hoverCol = Math.max(0, (hoverCol ?? 3) - 1);
      else if (e.key === 'ArrowRight') hoverCol = Math.min(COLS - 1, (hoverCol ?? 3) + 1);
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop(hoverCol ?? 3); return; }
      else return;
      e.preventDefault(); drawHover();
    });

    return {
      update(s) {
        snap = s;
        const v = s.view;
        discs.replaceChildren();
        marks.replaceChildren();
        const lm = v.lastMove;
        const key = lm ? `${lm.row},${lm.col}` : null;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const seat = v.board[r][c];
          if (seat === null) continue;
          const disc = svgEl('circle', { cx: c * CELL + CELL / 2, cy: TOP + r * CELL + CELL / 2, r: 40, fill: playerColor(seat) });
          if (lm && lm.row === r && lm.col === c && key !== lastKey) {
            const from = -(TOP + r * CELL);
            disc.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }],
              { duration: 260 + r * 50, easing: 'cubic-bezier(.5,0,.75,1.4)' });
          }
          discs.append(disc);
        }
        lastKey = key;
        if (v.winLine) {
          for (const { row, col } of v.winLine) {
            marks.append(svgEl('circle', { cx: col * CELL + CELL / 2, cy: TOP + row * CELL + CELL / 2, r: 14, fill: '#fff', stroke: '#1f1a17', 'stroke-width': 4 }));
          }
        }
        svg.style.cursor = myTurn() ? 'pointer' : 'default';
        drawHover();
      },
      result(s) {
        const w = s.view.winner;
        if (w === 'draw') return { title: 'เสมอ!', sub: 'กระดานเต็มแล้ว' };
        const p = s.players.find((x) => x.seat === w);
        if (w === s.mySeat) return { title: 'คุณชนะ! 🎉', sub: 'เรียงครบ 4 แล้ว' };
        return { title: `${p ? p.name : 'อีกฝ่าย'} ชนะ`, sub: 'ลองอีกตาไหม?' };
      },
      unmount() { svg.remove(); },
    };
  };
})();
