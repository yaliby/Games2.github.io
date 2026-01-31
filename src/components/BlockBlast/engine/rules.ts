// components/BlockBlast/engine/rules.ts
import type { Board, BlockShape } from './types';
import { ROWS, COLS } from './types';
import type { ClearResult } from "./types";

// לא נוגע ב-clearLines הישן שלך — מוסיף חדש.
export function clearLinesDetailed(board: Board): ClearResult {
  const clearedRows: number[] = [];
  const clearedCols: number[] = [];

  // rows
  for (let r = 0; r < ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS; c++) {
      if (!board[r][c]) { full = false; break; }
    }
    if (full) clearedRows.push(r);
  }

  // cols
  for (let c = 0; c < COLS; c++) {
    let full = true;
    for (let r = 0; r < ROWS; r++) {
      if (!board[r][c]) { full = false; break; }
    }
    if (full) clearedCols.push(c);
  }

  const clearedCells: Array<{ r: number; c: number }> = [];
  for (const r of clearedRows) for (let c = 0; c < COLS; c++) clearedCells.push({ r, c });
  for (const c of clearedCols) for (let r = 0; r < ROWS; r++) clearedCells.push({ r, c });

  // apply clear
  for (const r of clearedRows) for (let c = 0; c < COLS; c++) board[r][c] = 0;
  for (const c of clearedCols) for (let r = 0; r < ROWS; r++) board[r][c] = 0;

  return {
    clearedRows,
    clearedCols,
    clearedCount: clearedRows.length + clearedCols.length,
    clearedCells,
  };
}


export function createBoard(): Board {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0));
}

export function canPlace(board: Board, shape: BlockShape, r0: number, c0: number): boolean {
  for (const p of shape) {
    const r = r0 + p.r;
    const c = c0 + p.c;

    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (board[r][c] !== 0) return false;
  }
  return true;
}

export function placeBlock(
  board: Board,
  shape: BlockShape,
  r0: number,
  c0: number,
  colorId: number
): Board {
  for (const p of shape) {
    const r = r0 + p.r;
    const c = c0 + p.c;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      board[r][c] = colorId; // <-- צבע נשמר בלוח
    }
  }
  return board;
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]) as Board;
}

export function clearLines(board: Board): {
  board: Board;
  cleared: number;
  rows: number[];
  cols: number[];
  // cells that were cleared (with their original colorId)
  cells: Array<{ r: number; c: number; colorId: number }>;
} {
  const newBoard = cloneBoard(board);

  const fullRows: number[] = [];
  const fullCols: number[] = [];

  for (let r = 0; r < ROWS; r++) {
    let ok = true;
    for (let c = 0; c < COLS; c++) {
      if (newBoard[r][c] === 0) {
        ok = false;
        break;
      }
    }
    if (ok) fullRows.push(r);
  }

  for (let c = 0; c < COLS; c++) {
    let ok = true;
    for (let r = 0; r < ROWS; r++) {
      if (newBoard[r][c] === 0) {
        ok = false;
        break;
      }
    }
    if (ok) fullCols.push(c);
  }

  // collect cleared cells (avoid duplicates when a cell is in both a full row and full col)
  const clearedMap = new Map<string, { r: number; c: number; colorId: number }>();

  for (const r of fullRows) {
    for (let c = 0; c < COLS; c++) {
      const colorId = newBoard[r][c];
      if (colorId !== 0) clearedMap.set(`${r},${c}`, { r, c, colorId });
    }
  }
  for (const c of fullCols) {
    for (let r = 0; r < ROWS; r++) {
      const colorId = newBoard[r][c];
      if (colorId !== 0) clearedMap.set(`${r},${c}`, { r, c, colorId });
    }
  }

  // apply clears
  for (const r of fullRows) {
    for (let c = 0; c < COLS; c++) newBoard[r][c] = 0;
  }
  for (const c of fullCols) {
    for (let r = 0; r < ROWS; r++) newBoard[r][c] = 0;
  }

  return {
    board: newBoard,
    cleared: fullRows.length + fullCols.length,
    rows: fullRows,
    cols: fullCols,
    cells: Array.from(clearedMap.values()),
  };
}

export function anyMoveExists(board: Board, shapes: BlockShape[]): boolean {
  for (const shape of shapes) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (canPlace(board, shape, r, c)) return true;
      }
    }
  }
  return false;
}
