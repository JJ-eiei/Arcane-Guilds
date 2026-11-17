// Sample game used to exercise the framework. Replace / add your own game
// module alongside it — see server/games/README.md for the interface.

const ROWS = 6;
const COLS = 7;

module.exports = {
  id: 'connect4',
  name: 'Connect 4 (เกมตัวอย่าง)',
  minPlayers: 2,
  maxPlayers: 2,

  // Called once when the host presses Start. `players` = [{id, name}] in seat order.
  setup(players) {
    return {
      board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      turn: 0,            // seat index whose turn it is
      winner: null,       // seat index, 'draw', or null
      lastMove: null,
      winLine: null,
    };
  },

  // Validate + apply a move. Return a string to reject the move (shown to
  // that player), or nothing on success. Mutate `state` in place.
  move(state, seat, move) {
    if (state.winner !== null) return 'เกมจบแล้ว';
    if (seat !== state.turn) return 'ยังไม่ถึงตาคุณ';
    const col = Number(move && move.col);
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return 'คอลัมน์ไม่ถูกต้อง';

    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (state.board[r][col] === null) { row = r; break; }
    }
    if (row === -1) return 'คอลัมน์นี้เต็มแล้ว';

    state.board[row][col] = seat;
    state.lastMove = { row, col };

    const line = findWin(state.board, row, col, seat);
    if (line) {
      state.winner = seat;
      state.winLine = line;
    } else if (state.board[0].every((c) => c !== null)) {
      state.winner = 'draw';
    } else {
      state.turn = (state.turn + 1) % 2;
    }
  },

  // What a given seat is allowed to see. Hide private info here
  // (e.g. other players' hands). Connect 4 has none.
  view(state, seat) {
    return state;
  },

  // Which seat should act now (used for the turn indicator), or null.
  currentTurn(state) {
    return state.winner === null ? state.turn : null;
  },

  isOver(state) {
    return state.winner !== null;
  },
};

function findWin(board, row, col, seat) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [{ row, col }];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === seat) {
        line.push({ row: r, col: c });
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}
