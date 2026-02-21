// components/BlockBlast/engine/types.ts

export const ROWS = 8;
export const COLS = 8;

// 0 = empty, number>0 = colorId
export type Cell = number;

export type Board = Cell[][];

export type Pos = { r: number; c: number };

export type BlockShape = Pos[]; // offsets from anchor

// ===== Combo / Clear types =====
export type ClearResult = {
  clearedRows: number[];
  clearedCols: number[];
  clearedCount: number; // rows + cols
  clearedCells: Array<{ r: number; c: number }>;
};

export type ComboState = {
  chain: number;       // consecutive clears
  level: number;       // 0..5 (0 means no combo this move)
  multiplier: number;  // e.g. 1..6
};

export type ComboFxPayload = {
  level: number;           // 1..5
  chain: number;
  multiplier: number;
  clearedCount: number;    // rows+cols cleared this move
  clearedRows: number[];
  clearedCols: number[];
  clearedCells: Array<{ r: number; c: number }>;
  origin?: { r: number; c: number }; // where player placed (optional)
};
