export const ROWS = 10 as const;
export const COLS = 10 as const;

// Cell values: 0 = empty, 1 = red man, 2 = red king, 3 = black man, 4 = black king
export type Cell = 0 | 1 | 2 | 3 | 4;
export type Player = 1 | 3; // 1 = RED, 3 = BLACK
export type PieceType = 1 | 2 | 3 | 4; // Excluding 0 (empty)

export type Board = Cell[][];

export type Pos = { r: number; c: number };

export type Move = {
  from: Pos;
  to: Pos;
  captures: Pos[]; // Positions of captured pieces
  promotes: boolean; // Whether this move promotes to king
};

export type MoveSequence = {
  moves: Move[];
  totalCaptures: number;
};

export type Winner =
  | { kind: 'NONE' }
  | { kind: 'DRAW' }
  | { kind: 'WIN'; player: Player };

export type GameStatus = {
  board: Board;
  turn: Player;
  winner: Winner;
  lastMove: Move | null;
  mandatoryCapture: boolean; // Whether current player must capture
  inChainCapture: boolean; // Whether player is in the middle of a chain capture
  chainCaptureFrom: Pos | null; // Position of piece continuing chain capture
};

