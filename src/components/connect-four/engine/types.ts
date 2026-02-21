export const ROWS = 6 as const;
export const COLS = 7 as const;

export type Cell = 0 | 1 | 2; // 0 EMPTY, 1 RED, 2 YELLOW
export type Player = Exclude<Cell, 0>; // 1 | 2

export type Board = Cell[][];

export type Pos = { r: number; c: number };

export type MoveResult =
  | { ok: true; pos: Pos }
  | { ok: false; pos: null };

export type Winner =
  | { kind: 'NONE' }
  | { kind: 'DRAW' }
  | { kind: 'WIN'; player: Player; line: Pos[] };

export type GameStatus = {
  board: Board;
  turn: Player;
  winner: Winner;
  lastMove: Pos | null;
};
