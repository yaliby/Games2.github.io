// components/BlockBlast/engine/types.ts

export const ROWS = 10;
export const COLS = 10;

// 0 = empty, number>0 = colorId
export type Cell = number;

export type Board = Cell[][];

export type Pos = { r: number; c: number };

export type BlockShape = Pos[]; // offsets from anchor
