import type { Board, Cell, Player, Pos, MoveResult, Winner } from './types';
import { ROWS, COLS } from './types';

export const EMPTY: Cell = 0;
export const RED: Player = 1;
export const YELLOW: Player = 2;

export function otherPlayer(p: Player): Player {
  return p === RED ? YELLOW : RED;
}

export function createBoard(): Board {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => EMPTY)
  );
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function canDrop(board: Board, col: number): boolean {
  return col >= 0 && col < COLS && board[0][col] === EMPTY;
}

export function validColumns(board: Board): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) if (canDrop(board, c)) cols.push(c);
  return cols;
}

export function nextOpenRow(board: Board, col: number): number | null {
  if (!canDrop(board, col)) return null;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === EMPTY) return r;
  }
  return null;
}

/**
 * Mutates board in-place (fast for canvas gameplay).
 */
export function applyMove(board: Board, col: number, piece: Player): MoveResult {
  const r = nextOpenRow(board, col);
  if (r === null) return { ok: false, pos: null };
  board[r][col] = piece;
  return { ok: true, pos: { r, c: col } };
}

export function isDraw(board: Board): boolean {
  // draw if top row has no EMPTY
  for (let c = 0; c < COLS; c++) if (board[0][c] === EMPTY) return false;
  return true;
}

const DIRS: Array<[number, number]> = [
  [0, 1],  // →
  [1, 0],  // ↓
  [1, 1],  // ↘
  [1, -1], // ↙
];

/**
 * Returns Winner with winning line for rendering highlights.
 */
export function getWinner(board: Board): Winner {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (cell === EMPTY) continue;

      for (const [dr, dc] of DIRS) {
        const line: Pos[] = [];
        for (let i = 0; i < 4; i++) {
          const rr = r + dr * i;
          const cc = c + dc * i;
          if (!inBounds(rr, cc) || board[rr][cc] !== cell) break;
          line.push({ r: rr, c: cc });
        }
        if (line.length === 4) {
          return { kind: 'WIN', player: cell as Player, line };
        }
      }
    }
  }

  if (isDraw(board)) return { kind: 'DRAW' };
  return { kind: 'NONE' };
}

export function checkWinner(board: Board, piece: Player): boolean {
  const w = getWinner(board);
  return w.kind === 'WIN' && w.player === piece;
}

/* =========================
   AI — AlphaBeta + Cache
   ========================= */

type EvalResult = { value: number; bestCol: number | null };

const WIN_SCORE = 100000;
const INF = 1_000_000_000;

function cloneBoard(board: Board): Board {
  return board.map(row => row.slice()) as Board;
}

function boardKey(board: Board): string {
  // compact key for transposition table
  // rows*cols = 42 chars
  let s = '';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s += board[r][c];
  return s;
}

function orderedMoves(board: Board): number[] {
  const cols = validColumns(board);
  const center = Math.floor(COLS / 2);
  cols.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
  return cols;
}

function windowScore(window: Cell[], me: Player): number {
  const opp = otherPlayer(me);

  let meCount = 0;
  let oppCount = 0;
  let empty = 0;

  for (const x of window) {
    if (x === me) meCount++;
    else if (x === opp) oppCount++;
    else empty++;
  }

  // terminal-ish
  if (meCount === 4) return WIN_SCORE;
  if (oppCount === 4) return -WIN_SCORE;

  let score = 0;

  // Strong threats / blocks
  if (meCount === 3 && empty === 1) score += 90;
  if (meCount === 2 && empty === 2) score += 12;

  if (oppCount === 3 && empty === 1) score -= 100;
  if (oppCount === 2 && empty === 2) score -= 14;

  return score;
}

function evaluate(board: Board, me: Player): number {
  const w = getWinner(board);
  if (w.kind === 'WIN') return w.player === me ? WIN_SCORE : -WIN_SCORE;
  if (w.kind === 'DRAW') return 0;

  let score = 0;
  const opp = otherPlayer(me);

  // center control
  const centerCol = Math.floor(COLS / 2);
  let meCenter = 0, oppCenter = 0;
  for (let r = 0; r < ROWS; r++) {
    if (board[r][centerCol] === me) meCenter++;
    if (board[r][centerCol] === opp) oppCenter++;
  }
  score += meCenter * 8;
  score -= oppCenter * 8;

  // horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 3; c++) {
      score += windowScore(
        [board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]],
        me
      );
    }
  }

  // vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 3; r++) {
      score += windowScore(
        [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]],
        me
      );
    }
  }

  // diag \
  for (let r = 0; r < ROWS - 3; r++) {
    for (let c = 0; c < COLS - 3; c++) {
      score += windowScore(
        [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]],
        me
      );
    }
  }

  // diag /
  for (let r = 3; r < ROWS; r++) {
    for (let c = 0; c < COLS - 3; c++) {
      score += windowScore(
        [board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3]],
        me
      );
    }
  }

  return score;
}

function alphabeta(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  toMove: Player,
  me: Player,
  tt: Map<string, { depth: number; value: number; bestCol: number | null }>
): EvalResult {
  const key = boardKey(board) + `|${toMove}`;
  const cached = tt.get(key);
  if (cached && cached.depth >= depth) {
    return { value: cached.value, bestCol: cached.bestCol };
  }

  const evalNow = evaluate(board, me);
  if (depth <= 0 || Math.abs(evalNow) >= WIN_SCORE || isDraw(board)) {
    return { value: evalNow, bestCol: null };
  }

  const moves = orderedMoves(board);
  if (moves.length === 0) return { value: evalNow, bestCol: null };

  const maximizing = toMove === me;

  let bestCol: number | null = null;

  if (maximizing) {
    let value = -INF;

    for (const col of moves) {
      const b2 = cloneBoard(board);
      applyMove(b2, col, toMove);

      const res = alphabeta(b2, depth - 1, alpha, beta, otherPlayer(toMove), me, tt);
      if (res.value > value) {
        value = res.value;
        bestCol = col;
      }

      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }

    tt.set(key, { depth, value, bestCol });
    return { value, bestCol };
  } else {
    let value = INF;

    for (const col of moves) {
      const b2 = cloneBoard(board);
      applyMove(b2, col, toMove);

      const res = alphabeta(b2, depth - 1, alpha, beta, otherPlayer(toMove), me, tt);
      if (res.value < value) {
        value = res.value;
        bestCol = col;
      }

      beta = Math.min(beta, value);
      if (beta <= alpha) break;
    }

    tt.set(key, { depth, value, bestCol });
    return { value, bestCol };
  }
}

/**
 * AI best move for player "me".
 * - depth: 5–8 is good.
 * - includes transposition cache + center-first ordering.
 */
export function aiBestMove(board: Board, me: Player, depth = 6): number | null {
  const cols = validColumns(board);
  if (cols.length === 0) return null;

  const tt = new Map<string, { depth: number; value: number; bestCol: number | null }>();
  const res = alphabeta(board, depth, -INF, INF, me, me, tt);

  if (res.bestCol === null) {
    // fallback: random valid
    return cols[Math.floor(Math.random() * cols.length)];
  }
  return res.bestCol;
}
