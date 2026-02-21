import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, TouchEvent } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import UserBox from "../UserBox/UserBox";
import { auth, db } from "../../services/firebase";
import { submit6767Score } from "../../services/scoreService";
import "./Game6767.css";

type Board = number[][];
type MoveDirection = "up" | "down" | "left" | "right";

interface Tile {
  id: number;
  value: number;
  row: number;
  col: number;
}

interface Snapshot {
  tiles: Tile[];
  gameOver: boolean;
  nextTileId: number;
}

interface SavedGameState extends Snapshot {
  botomized: boolean;
  undoStack: Snapshot[];
}

interface MoveMerge {
  survivorId: number;
  consumedId: number;
  nextValue: number;
}

interface MoveComputation {
  moved: boolean;
  animatedTiles: Tile[];
  settledTiles: Tile[];
  mergeSurvivorIds: number[];
  mergeValue: number;
}

interface PendingMoveState {
  finalTiles: Tile[];
  nextTileId: number;
  finalGameOver: boolean;
  mergeSurvivorIds: number[];
  spawnId: number | null;
}

interface RectPosition {
  left: number;
  top: number;
}

interface CellLayout {
  x: number;
  y: number;
  size: number;
}

interface LeaderboardRow {
  uid: string;
  score: number;
}

const SIZE = 4;
const MAX_TILE = 6767;
const LS_SAVE = "g6767_save_flip_v1";
const LS_BEST_PREFIX = "g6767_best_v1";
const SLIDE_MS = 220;
const MERGE_POP_MS = 240;
const SPAWN_POP_MS = 180;
const BOT_STEP_MS = 95;
const BOT_TIME_BUDGET_MS = 42;
const BOT_MAX_DEPTH = 5;
const BOT_MAX_CHANCE_BRANCHES = 6;
const BOT_DIRECTIONS: MoveDirection[] = ["up", "left", "right", "down"];
const CORNER_GRADIENTS: readonly Board[] = [
  [
    [16, 12, 8, 4],
    [12, 9, 6, 3],
    [8, 6, 4, 2],
    [4, 3, 2, 1],
  ],
  [
    [4, 8, 12, 16],
    [3, 6, 9, 12],
    [2, 4, 6, 8],
    [1, 2, 3, 4],
  ],
  [
    [4, 3, 2, 1],
    [8, 6, 4, 2],
    [12, 9, 6, 3],
    [16, 12, 8, 4],
  ],
  [
    [1, 2, 3, 4],
    [2, 4, 6, 8],
    [3, 6, 9, 12],
    [4, 8, 12, 16],
  ],
];
const MERGE_SEQUENCE = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, MAX_TILE] as const;
const MERGE_NEXT_MAP = new Map<number, number>(
  MERGE_SEQUENCE.slice(0, -1).map((value, index) => [value, MERGE_SEQUENCE[index + 1]])
);

function areLayoutsEqual(a: CellLayout[], b: CellLayout[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      Math.abs(a[i].x - b[i].x) > 0.5 ||
      Math.abs(a[i].y - b[i].y) > 0.5 ||
      Math.abs(a[i].size - b[i].size) > 0.5
    ) {
      return false;
    }
  }
  return true;
}

function createEmptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function normalizeTileValue(value: number): number {
  return Math.max(0, Math.min(MAX_TILE, value));
}

function normalizeTiles(tiles: Tile[]): Tile[] {
  return tiles.map((tile) => ({
    ...tile,
    value: normalizeTileValue(tile.value),
  }));
}

function getNextMergeValue(value: number): number | null {
  return MERGE_NEXT_MAP.get(value) ?? null;
}

function cloneTiles(tiles: Tile[]): Tile[] {
  return tiles.map((tile) => ({ ...tile }));
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    tiles: cloneTiles(snapshot.tiles),
    gameOver: snapshot.gameOver,
    nextTileId: snapshot.nextTileId,
  };
}

function tilesToBoard(tiles: Tile[]): Board {
  const board = createEmptyBoard();
  tiles.forEach((tile) => {
    board[tile.row][tile.col] = tile.value;
  });
  return board;
}

function getEmptyCells(board: Board): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] === 0) cells.push([row, col]);
    }
  }
  return cells;
}

function canAnyMove(board: Board): boolean {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = board[row][col];
      if (value === 0) return true;
      if (
        col + 1 < SIZE &&
        board[row][col + 1] === value &&
        getNextMergeValue(value) !== null
      ) {
        return true;
      }
      if (
        row + 1 < SIZE &&
        board[row + 1][col] === value &&
        getNextMergeValue(value) !== null
      ) {
        return true;
      }
    }
  }
  return false;
}

function isValidBoard(value: unknown): value is Board {
  if (!Array.isArray(value) || value.length !== SIZE) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === SIZE &&
      row.every((cell) => Number.isInteger(cell) && cell >= 0)
  );
}

function isValidTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Tile>;
  return (
    Number.isInteger(candidate.id) &&
    Number.isInteger(candidate.value) &&
    Number.isInteger(candidate.row) &&
    Number.isInteger(candidate.col) &&
    (candidate.id ?? 0) > 0 &&
    (candidate.value ?? 0) > 0 &&
    (candidate.row ?? -1) >= 0 &&
    (candidate.row ?? SIZE) < SIZE &&
    (candidate.col ?? -1) >= 0 &&
    (candidate.col ?? SIZE) < SIZE
  );
}

function isValidTileList(value: unknown): value is Tile[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<number>();
  const cells = new Set<string>();

  for (const tile of value) {
    if (!isValidTile(tile)) return false;
    if (ids.has(tile.id)) return false;
    ids.add(tile.id);

    const cellKey = `${tile.row}-${tile.col}`;
    if (cells.has(cellKey)) return false;
    cells.add(cellKey);
  }

  return true;
}

function isValidSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Snapshot>;

  if (!isValidTileList(candidate.tiles)) return false;
  if (typeof candidate.gameOver !== "boolean") return false;
  if (!Number.isInteger(candidate.nextTileId) || (candidate.nextTileId ?? 0) < 1) return false;

  return true;
}

function boardToTiles(board: Board, startId: number): { tiles: Tile[]; nextTileId: number } {
  const tiles: Tile[] = [];
  let nextId = startId;

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = normalizeTileValue(board[row][col]);
      if (value > 0) {
        tiles.push({ id: nextId, value, row, col });
        nextId += 1;
      }
    }
  }

  return { tiles, nextTileId: nextId };
}

function createInitialTiles(startId = 1): { tiles: Tile[]; nextTileId: number } {
  const board = createEmptyBoard();

  const place = () => {
    const empty = getEmptyCells(board);
    if (empty.length === 0) return;
    const [row, col] = empty[Math.floor(Math.random() * empty.length)];
    board[row][col] = Math.random() < 0.9 ? 2 : 4;
  };

  place();
  place();

  return boardToTiles(board, startId);
}

function spawnRandomTile(tiles: Tile[], nextTileId: number): {
  tiles: Tile[];
  nextTileId: number;
  spawnId: number | null;
} {
  const board = tilesToBoard(tiles);
  const empty = getEmptyCells(board);

  if (empty.length === 0) {
    return { tiles: cloneTiles(tiles), nextTileId, spawnId: null };
  }

  const [row, col] = empty[Math.floor(Math.random() * empty.length)];
  const value = Math.random() < 0.9 ? 2 : 4;
  const spawned: Tile = { id: nextTileId, value, row, col };

  return {
    tiles: [...cloneTiles(tiles), spawned],
    nextTileId: nextTileId + 1,
    spawnId: spawned.id,
  };
}

function createFallbackSavedGame(): SavedGameState {
  const initial = createInitialTiles(1);
  return {
    tiles: initial.tiles,
    nextTileId: initial.nextTileId,
    gameOver: false,
    botomized: false,
    undoStack: [],
  };
}

function loadSavedGameState(): SavedGameState {
  const fallback = () => createFallbackSavedGame();

  try {
    const raw = localStorage.getItem(LS_SAVE);
    if (!raw) return fallback();

    const parsed = JSON.parse(raw) as Partial<SavedGameState> & {
      board?: Board;
      undoStack?: Array<Snapshot | { board: Board; score?: number }>;
      tiles?: Tile[];
      nextTileId?: number;
      gameOver?: boolean;
      botomized?: boolean;
    };

    if (
      isValidTileList(parsed.tiles) &&
      Number.isInteger(parsed.nextTileId) &&
      (parsed.nextTileId ?? 0) >= 1
    ) {
      const parsedUndo = Array.isArray(parsed.undoStack)
        ? parsed.undoStack.filter(isValidSnapshot).slice(-5).map(cloneSnapshot)
        : [];

      return {
        tiles: normalizeTiles(parsed.tiles),
        nextTileId: parsed.nextTileId as number,
        gameOver: Boolean(parsed.gameOver),
        botomized: Boolean(parsed.botomized),
        undoStack: parsedUndo,
      };
    }

    if (isValidBoard(parsed.board)) {
      const converted = boardToTiles(parsed.board, 1);
      return {
        tiles: converted.tiles,
        nextTileId: converted.nextTileId,
        gameOver: Boolean(parsed.gameOver),
        botomized: Boolean(parsed.botomized),
        undoStack: [],
      };
    }

    return fallback();
  } catch {
    return fallback();
  }
}

function normalizeLeaderboardScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function getBestStorageKey(uid: string | null): string {
  return uid ? `${LS_BEST_PREFIX}:${uid}` : `${LS_BEST_PREFIX}:guest`;
}

function loadBest(uid: string | null): number {
  try {
    const value = Number(localStorage.getItem(getBestStorageKey(uid)));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function saveBest(uid: string | null, score: number): void {
  const safeScore = normalizeLeaderboardScore(score);
  try {
    localStorage.setItem(getBestStorageKey(uid), String(safeScore));
  } catch {
    // Ignore storage failures.
  }
}

function getLineOfTile(tile: Tile, direction: MoveDirection): number {
  return direction === "left" || direction === "right" ? tile.row : tile.col;
}

function getLinePosition(tile: Tile, direction: MoveDirection): number {
  switch (direction) {
    case "left":
      return tile.col;
    case "right":
      return SIZE - 1 - tile.col;
    case "up":
      return tile.row;
    case "down":
      return SIZE - 1 - tile.row;
    default:
      return tile.col;
  }
}

function linePositionToCoord(direction: MoveDirection, line: number, position: number): [number, number] {
  switch (direction) {
    case "left":
      return [line, position];
    case "right":
      return [line, SIZE - 1 - position];
    case "up":
      return [position, line];
    case "down":
      return [SIZE - 1 - position, line];
    default:
      return [line, position];
  }
}

function computeMove(tiles: Tile[], direction: MoveDirection): MoveComputation {
  const originalById = new Map(tiles.map((tile) => [tile.id, tile]));
  const animatedById = new Map<number, Tile>();
  const merges: MoveMerge[] = [];
  let mergeValue = 0;

  for (let line = 0; line < SIZE; line += 1) {
    const lineTiles = tiles
      .filter((tile) => getLineOfTile(tile, direction) === line)
      .map((tile) => ({ tile, pos: getLinePosition(tile, direction) }))
      .sort((a, b) => a.pos - b.pos);

    let writePos = 0;
    let lastPlaced:
      | {
          id: number;
          value: number;
          linePos: number;
          merged: boolean;
        }
      | null = null;

    for (const entry of lineTiles) {
      const canMergeWithLast =
        lastPlaced && !lastPlaced.merged && lastPlaced.value === entry.tile.value;
      const nextMergeValue = canMergeWithLast ? getNextMergeValue(entry.tile.value) : null;

      if (canMergeWithLast && nextMergeValue !== null && lastPlaced) {
        const [toRow, toCol] = linePositionToCoord(direction, line, lastPlaced.linePos);

        animatedById.set(entry.tile.id, {
          ...entry.tile,
          row: toRow,
          col: toCol,
        });

        merges.push({
          survivorId: lastPlaced.id,
          consumedId: entry.tile.id,
          nextValue: nextMergeValue,
        });

        mergeValue += nextMergeValue;
        lastPlaced.value = nextMergeValue;
        lastPlaced.merged = true;
        continue;
      }

      const targetLinePos = writePos;
      writePos += 1;
      const [toRow, toCol] = linePositionToCoord(direction, line, targetLinePos);

      animatedById.set(entry.tile.id, {
        ...entry.tile,
        row: toRow,
        col: toCol,
      });

      lastPlaced = {
        id: entry.tile.id,
        value: entry.tile.value,
        linePos: targetLinePos,
        merged: false,
      };
    }
  }

  const animatedTiles = tiles.map((tile) => animatedById.get(tile.id) ?? tile);

  const positionChanged = animatedTiles.some((tile) => {
    const original = originalById.get(tile.id);
    if (!original) return false;
    return original.row !== tile.row || original.col !== tile.col;
  });

  const moved = positionChanged || merges.length > 0;
  if (!moved) {
    return {
      moved: false,
      animatedTiles: cloneTiles(tiles),
      settledTiles: cloneTiles(tiles),
      mergeSurvivorIds: [],
      mergeValue: 0,
    };
  }

  const settledById = new Map<number, Tile>(animatedTiles.map((tile) => [tile.id, { ...tile }]));

  merges.forEach((merge) => {
    settledById.delete(merge.consumedId);
    const survivor = settledById.get(merge.survivorId);
    if (survivor) {
      survivor.value = merge.nextValue;
    }
  });

  const settledTiles = Array.from(settledById.values());

  return {
    moved: true,
    animatedTiles,
    settledTiles,
    mergeSurvivorIds: merges.map((merge) => merge.survivorId),
    mergeValue,
  };
}

function getMaxTileValue(tiles: Tile[]): number {
  if (tiles.length === 0) return 0;
  return tiles.reduce((max, tile) => Math.max(max, tile.value), 0);
}

interface BoardMoveResult {
  board: Board;
  moved: boolean;
  mergeValue: number;
}

interface BotMoveEvaluation {
  direction: MoveDirection;
  board: Board;
  mergeValue: number;
  score: number;
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

function boardToKey(board: Board): string {
  let key = "";
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      key += `${board[row][col]},`;
    }
  }
  return key;
}

function getBoardMaxValue(board: Board): number {
  let max = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      max = Math.max(max, board[row][col]);
    }
  }
  return max;
}

function valueLog(value: number): number {
  return value > 0 ? Math.log2(value) : 0;
}

function computeGradientScore(board: Board): number {
  let best = Number.NEGATIVE_INFINITY;

  for (const gradient of CORNER_GRADIENTS) {
    let score = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        score += valueLog(board[row][col]) * gradient[row][col];
      }
    }
    best = Math.max(best, score);
  }

  return best;
}

function computeSmoothnessScore(board: Board): number {
  let score = 0;

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const current = board[row][col];
      if (current === 0) continue;
      const currentLog = valueLog(current);

      if (col + 1 < SIZE && board[row][col + 1] > 0) {
        score -= Math.abs(currentLog - valueLog(board[row][col + 1]));
      }
      if (row + 1 < SIZE && board[row + 1][col] > 0) {
        score -= Math.abs(currentLog - valueLog(board[row + 1][col]));
      }
    }
  }

  return score;
}

function computeMonotonicityScore(board: Board): number {
  let score = 0;

  for (let row = 0; row < SIZE; row += 1) {
    let increasing = 0;
    let decreasing = 0;
    for (let col = 0; col + 1 < SIZE; col += 1) {
      const current = valueLog(board[row][col]);
      const next = valueLog(board[row][col + 1]);
      if (current > next) {
        decreasing += next - current;
      } else {
        increasing += current - next;
      }
    }
    score += Math.max(increasing, decreasing);
  }

  for (let col = 0; col < SIZE; col += 1) {
    let increasing = 0;
    let decreasing = 0;
    for (let row = 0; row + 1 < SIZE; row += 1) {
      const current = valueLog(board[row][col]);
      const next = valueLog(board[row + 1][col]);
      if (current > next) {
        decreasing += next - current;
      } else {
        increasing += current - next;
      }
    }
    score += Math.max(increasing, decreasing);
  }

  return score;
}

function evaluateBoardHeuristic(board: Board): number {
  const emptyCount = getEmptyCells(board).length;
  const maxTile = getBoardMaxValue(board);
  const maxLog = valueLog(maxTile);
  const gradientScore = computeGradientScore(board);
  const monotonicityScore = computeMonotonicityScore(board);
  const smoothnessScore = computeSmoothnessScore(board);

  const maxInCorner =
    board[0][0] === maxTile ||
    board[0][SIZE - 1] === maxTile ||
    board[SIZE - 1][0] === maxTile ||
    board[SIZE - 1][SIZE - 1] === maxTile;

  return (
    emptyCount * 900 +
    gradientScore * 34 +
    monotonicityScore * 120 +
    smoothnessScore * 22 +
    maxLog * 220 +
    (maxInCorner ? 900 : 0)
  );
}

function moveBoard(board: Board, direction: MoveDirection): BoardMoveResult {
  const next = createEmptyBoard();
  let moved = false;
  let mergeValue = 0;

  for (let line = 0; line < SIZE; line += 1) {
    const lineValues: number[] = [];
    for (let pos = 0; pos < SIZE; pos += 1) {
      const [row, col] = linePositionToCoord(direction, line, pos);
      const value = board[row][col];
      if (value > 0) lineValues.push(value);
    }

    const merged: number[] = [];
    for (let i = 0; i < lineValues.length; i += 1) {
      const current = lineValues[i];
      const nextValue = lineValues[i + 1];
      const mergeTo = nextValue === current ? getNextMergeValue(current) : null;

      if (nextValue === current && mergeTo !== null) {
        merged.push(mergeTo);
        mergeValue += mergeTo;
        i += 1;
      } else {
        merged.push(current);
      }
    }

    while (merged.length < SIZE) {
      merged.push(0);
    }

    for (let pos = 0; pos < SIZE; pos += 1) {
      const [row, col] = linePositionToCoord(direction, line, pos);
      next[row][col] = merged[pos];
      if (next[row][col] !== board[row][col]) {
        moved = true;
      }
    }
  }

  return { board: next, moved, mergeValue };
}

function pickChanceCells(board: Board, emptyCells: Array<[number, number]>): Array<[number, number]> {
  if (emptyCells.length <= BOT_MAX_CHANCE_BRANCHES) {
    return emptyCells;
  }

  const ranked = emptyCells
    .map(([row, col]) => {
      const preview = cloneBoard(board);
      preview[row][col] = 2;
      return {
        cell: [row, col] as [number, number],
        score: evaluateBoardHeuristic(preview),
      };
    })
    .sort((a, b) => a.score - b.score);

  return ranked.slice(0, BOT_MAX_CHANCE_BRANCHES).map((entry) => entry.cell);
}

function expectimaxPlayer(
  board: Board,
  depth: number,
  deadline: number,
  memo: Map<string, number>
): number {
  if (performance.now() >= deadline) return evaluateBoardHeuristic(board);
  if (depth <= 0 || !canAnyMove(board)) return evaluateBoardHeuristic(board);

  const key = `P|${depth}|${boardToKey(board)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = Number.NEGATIVE_INFINITY;

  for (const direction of BOT_DIRECTIONS) {
    const moved = moveBoard(board, direction);
    if (!moved.moved) continue;

    const score = moved.mergeValue * 18 + expectimaxChance(moved.board, depth - 1, deadline, memo);
    if (score > best) best = score;
  }

  if (!Number.isFinite(best)) {
    best = -1_000_000_000;
  }

  memo.set(key, best);
  return best;
}

function expectimaxChance(
  board: Board,
  depth: number,
  deadline: number,
  memo: Map<string, number>
): number {
  if (performance.now() >= deadline) return evaluateBoardHeuristic(board);
  if (depth <= 0) return evaluateBoardHeuristic(board);

  const key = `C|${depth}|${boardToKey(board)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const emptyCells = getEmptyCells(board);
  if (emptyCells.length === 0) {
    const score = expectimaxPlayer(board, depth, deadline, memo);
    memo.set(key, score);
    return score;
  }

  const chanceCells = pickChanceCells(board, emptyCells);
  const probPerCell = 1 / chanceCells.length;
  let expected = 0;

  for (const [row, col] of chanceCells) {
    const boardWithTwo = cloneBoard(board);
    boardWithTwo[row][col] = 2;
    const boardWithFour = cloneBoard(board);
    boardWithFour[row][col] = 4;

    const scoreWithTwo = expectimaxPlayer(boardWithTwo, depth, deadline, memo);
    const scoreWithFour = expectimaxPlayer(boardWithFour, depth, deadline, memo);
    expected += probPerCell * (0.9 * scoreWithTwo + 0.1 * scoreWithFour);
  }

  memo.set(key, expected);
  return expected;
}

function evaluateBotMove(board: Board, direction: MoveDirection): BotMoveEvaluation | null {
  const moved = moveBoard(board, direction);
  if (!moved.moved) return null;

  const directionBias =
    direction === "up" ? 0.35 : direction === "left" ? 0.25 : direction === "right" ? 0.08 : 0;

  return {
    direction,
    board: moved.board,
    mergeValue: moved.mergeValue,
    score: evaluateBoardHeuristic(moved.board) + moved.mergeValue * 20 + directionBias,
  };
}

function chooseBotMove(tiles: Tile[]): MoveDirection | null {
  const board = tilesToBoard(tiles);
  const candidates = BOT_DIRECTIONS.map((direction) => evaluateBotMove(board, direction)).filter(
    (entry): entry is BotMoveEvaluation => entry !== null
  );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  let bestDirection = candidates[0].direction;
  const deadline = performance.now() + BOT_TIME_BUDGET_MS;

  for (let depth = 1; depth <= BOT_MAX_DEPTH; depth += 1) {
    if (performance.now() >= deadline) break;

    const memo = new Map<string, number>();
    let bestAtDepth = bestDirection;
    let bestScore = Number.NEGATIVE_INFINITY;
    let finishedDepth = true;

    for (const candidate of candidates) {
      if (performance.now() >= deadline) {
        finishedDepth = false;
        break;
      }

      const score =
        candidate.mergeValue * 20 +
        expectimaxChance(candidate.board, depth - 1, deadline, memo) +
        candidate.score * 0.05;

      if (score > bestScore) {
        bestScore = score;
        bestAtDepth = candidate.direction;
      }
    }

    if (!finishedDepth) break;
    bestDirection = bestAtDepth;
  }

  return bestDirection;
}

export default function Game6767() {
  const initialState = useMemo(() => loadSavedGameState(), []);
  const initialUid = auth.currentUser?.uid ?? null;
  const initialBest = initialUid ? 0 : loadBest(null);

  const [tiles, setTiles] = useState<Tile[]>(() => cloneTiles(initialState.tiles));
  const [nextTileId, setNextTileId] = useState(initialState.nextTileId);
  const [gameOver, setGameOver] = useState(initialState.gameOver);
  const [botomized, setBotomized] = useState(initialState.botomized);
  const [botEnabled, setBotEnabled] = useState(false);
  const [undoStack, setUndoStack] = useState<Snapshot[]>(() =>
    initialState.undoStack.map(cloneSnapshot)
  );

  const [isAnimatingMove, setIsAnimatingMove] = useState(false);
  const [spawnIds, setSpawnIds] = useState<Set<number>>(() => new Set());
  const [mergePopIds, setMergePopIds] = useState<Set<number>>(() => new Set());
  const [cellLayouts, setCellLayouts] = useState<CellLayout[]>([]);
  const [activeUid, setActiveUid] = useState<string | null>(initialUid);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [displayBest, setDisplayBest] = useState(initialBest);
  const [dbBestScore, setDbBestScore] = useState<number | null>(initialUid ? null : initialBest);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const prevRectsRef = useRef<Map<number, RectPosition> | null>(null);
  const pendingMoveRef = useRef<PendingMoveState | null>(null);
  const activeUidRef = useRef<string | null>(initialUid);
  const bestRef = useRef<number>(initialBest);
  const bestSyncReadyRef = useRef(initialUid === null);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);

  const flipFallbackTimerRef = useRef<number | null>(null);
  const spawnClearTimerRef = useRef<number | null>(null);
  const mergeClearTimerRef = useRef<number | null>(null);
  const botLoopTimerRef = useRef<number | null>(null);
  const latestTilesRef = useRef<Tile[]>(cloneTiles(initialState.tiles));
  const latestBotFlagsRef = useRef({
    layoutReady: false,
    isAnimatingMove: false,
    gameOver: initialState.gameOver,
  });
  const applyMoveRef = useRef<(direction: MoveDirection) => void>(() => {});

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const layoutReady = useMemo(
    () => cellLayouts.length === SIZE * SIZE && cellLayouts.every((entry) => entry.size > 0),
    [cellLayouts]
  );

  const clearPulseTimers = useCallback(() => {
    if (spawnClearTimerRef.current) {
      window.clearTimeout(spawnClearTimerRef.current);
      spawnClearTimerRef.current = null;
    }

    if (mergeClearTimerRef.current) {
      window.clearTimeout(mergeClearTimerRef.current);
      mergeClearTimerRef.current = null;
    }
  }, []);

  const clearFlipFallbackTimer = useCallback(() => {
    if (flipFallbackTimerRef.current) {
      window.clearTimeout(flipFallbackTimerRef.current);
      flipFallbackTimerRef.current = null;
    }
  }, []);

  const clearBotLoopTimer = useCallback(() => {
    if (botLoopTimerRef.current) {
      window.clearTimeout(botLoopTimerRef.current);
      botLoopTimerRef.current = null;
    }
  }, []);

  const resetFlipInlineStyles = useCallback(() => {
    tileRefs.current.forEach((el) => {
      el.style.transition = "";
      el.style.setProperty("--flip-x", "0px");
      el.style.setProperty("--flip-y", "0px");
    });
  }, []);

  const clearAllTransient = useCallback(() => {
    clearBotLoopTimer();
    clearPulseTimers();
    clearFlipFallbackTimer();
    resetFlipInlineStyles();
    pendingMoveRef.current = null;
    prevRectsRef.current = null;
    setSpawnIds(new Set());
    setMergePopIds(new Set());
  }, [clearBotLoopTimer, clearFlipFallbackTimer, clearPulseTimers, resetFlipInlineStyles]);

  const measureCellLayouts = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const nextLayouts: CellLayout[] = [];

    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const cell = cellRefs.current[i];
      if (!cell) return;
      const rect = cell.getBoundingClientRect();
      nextLayouts.push({
        x: rect.left - boardRect.left,
        y: rect.top - boardRect.top,
        size: rect.width,
      });
    }

    setCellLayouts((prev) => (areLayoutsEqual(prev, nextLayouts) ? prev : nextLayouts));
  }, []);

  useLayoutEffect(() => {
    measureCellLayouts();

    const board = boardRef.current;
    if (!board) return;

    const onResize = () => measureCellLayouts();
    window.addEventListener("resize", onResize);

    const observer = new ResizeObserver(() => {
      measureCellLayouts();
    });
    observer.observe(board);

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [measureCellLayouts]);

  const saveHistory = useCallback((snapshot: Snapshot) => {
    setUndoStack((prev) => [...prev.slice(-4), cloneSnapshot(snapshot)]);
  }, []);

  const commitPendingMove = useCallback(() => {
    const pending = pendingMoveRef.current;
    if (!pending) return;

    clearFlipFallbackTimer();
    resetFlipInlineStyles();

    setTiles(cloneTiles(pending.finalTiles));
    setNextTileId(pending.nextTileId);
    setGameOver(pending.finalGameOver);
    setIsAnimatingMove(false);

    clearPulseTimers();

    const mergeSet = new Set<number>(pending.mergeSurvivorIds);
    setMergePopIds(mergeSet);

    if (mergeSet.size > 0) {
      mergeClearTimerRef.current = window.setTimeout(() => {
        setMergePopIds(new Set());
        mergeClearTimerRef.current = null;
      }, MERGE_POP_MS);
    }

    const spawnSet = pending.spawnId ? new Set<number>([pending.spawnId]) : new Set<number>();
    setSpawnIds(spawnSet);

    if (spawnSet.size > 0) {
      spawnClearTimerRef.current = window.setTimeout(() => {
        setSpawnIds(new Set());
        spawnClearTimerRef.current = null;
      }, SPAWN_POP_MS);
    }

    pendingMoveRef.current = null;
    prevRectsRef.current = null;
  }, [clearFlipFallbackTimer, clearPulseTimers, resetFlipInlineStyles]);

  const restart = useCallback(() => {
    clearAllTransient();
    const fresh = createInitialTiles(1);

    setTiles(fresh.tiles);
    setNextTileId(fresh.nextTileId);
    setGameOver(false);
    setBotomized(false);
    setBotEnabled(false);
    setUndoStack([]);
    setIsAnimatingMove(false);
  }, [clearAllTransient]);

  const undo = useCallback(() => {
    if (isAnimatingMove || undoStack.length === 0) return;

    clearAllTransient();

    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));

    setTiles(cloneTiles(prev.tiles));
    setNextTileId(prev.nextTileId);
    setGameOver(prev.gameOver);
    setIsAnimatingMove(false);
  }, [clearAllTransient, isAnimatingMove, undoStack]);

  const applyMove = useCallback(
    (direction: MoveDirection) => {
      if (!layoutReady || isAnimatingMove || gameOver) return;

      const computed = computeMove(tiles, direction);
      if (!computed.moved) return;

      saveHistory({
        tiles: cloneTiles(tiles),
        gameOver,
        nextTileId,
      });

      const spawnResult = spawnRandomTile(computed.settledTiles, nextTileId);
      const finalBoard = tilesToBoard(spawnResult.tiles);
      const finalGameOver = !canAnyMove(finalBoard);

      pendingMoveRef.current = {
        finalTiles: cloneTiles(spawnResult.tiles),
        nextTileId: spawnResult.nextTileId,
        finalGameOver,
        mergeSurvivorIds: [...computed.mergeSurvivorIds],
        spawnId: spawnResult.spawnId,
      };

      const boardRect = boardRef.current?.getBoundingClientRect();
      const prevRects = new Map<number, RectPosition>();

      if (boardRect) {
        tiles.forEach((tile) => {
          const el = tileRefs.current.get(tile.id);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          prevRects.set(tile.id, {
            left: rect.left - boardRect.left,
            top: rect.top - boardRect.top,
          });
        });
      }

      prevRectsRef.current = prevRects;

      clearPulseTimers();
      setSpawnIds(new Set());
      setMergePopIds(new Set());
      setIsAnimatingMove(true);
      setTiles(cloneTiles(computed.animatedTiles));
    },
    [clearPulseTimers, gameOver, isAnimatingMove, layoutReady, nextTileId, saveHistory, tiles]
  );

  useLayoutEffect(() => {
    if (!isAnimatingMove) return;

    const pending = pendingMoveRef.current;
    const previousRects = prevRectsRef.current;
    const boardEl = boardRef.current;

    if (!pending || !previousRects || !boardEl) {
      commitPendingMove();
      return;
    }

    const boardRect = boardEl.getBoundingClientRect();
    const animatedElements: HTMLDivElement[] = [];

    tiles.forEach((tile) => {
      const el = tileRefs.current.get(tile.id);
      const previous = previousRects.get(tile.id);
      if (!el || !previous) return;

      const nextRect = el.getBoundingClientRect();
      const nextLeft = nextRect.left - boardRect.left;
      const nextTop = nextRect.top - boardRect.top;

      const dx = previous.left - nextLeft;
      const dy = previous.top - nextTop;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      el.style.transition = "none";
      el.style.setProperty("--flip-x", `${dx}px`);
      el.style.setProperty("--flip-y", `${dy}px`);
      animatedElements.push(el);
    });

    if (animatedElements.length === 0) {
      commitPendingMove();
      return;
    }

    boardEl.getBoundingClientRect();

    let done = false;
    const listeners: Array<{ el: HTMLDivElement; fn: (event: TransitionEvent) => void }> = [];

    const finish = () => {
      if (done) return;
      done = true;

      clearFlipFallbackTimer();

      listeners.forEach(({ el, fn }) => {
        el.removeEventListener("transitionend", fn);
      });

      resetFlipInlineStyles();
      commitPendingMove();
    };

    flipFallbackTimerRef.current = window.setTimeout(finish, SLIDE_MS + 150);

    const rafId = window.requestAnimationFrame(() => {
      if (done) return;
      let remaining = animatedElements.length;

      animatedElements.forEach((el) => {
        const onEnd = (event: TransitionEvent) => {
          if (event.propertyName !== "transform") return;
          el.removeEventListener("transitionend", onEnd);
          remaining -= 1;
          if (remaining <= 0) finish();
        };

        listeners.push({ el, fn: onEnd });
        el.addEventListener("transitionend", onEnd);

        el.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        el.style.setProperty("--flip-x", "0px");
        el.style.setProperty("--flip-y", "0px");
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [commitPendingMove, clearFlipFallbackTimer, isAnimatingMove, resetFlipInlineStyles, tiles]);

  useEffect(() => {
    return () => {
      clearAllTransient();
    };
  }, [clearAllTransient]);

  useEffect(() => {
    if (isAnimatingMove) return;

    try {
      const payload: SavedGameState = {
        tiles: cloneTiles(tiles),
        nextTileId,
        gameOver,
        botomized,
        undoStack: undoStack.map(cloneSnapshot),
      };
      localStorage.setItem(LS_SAVE, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }
  }, [botomized, gameOver, isAnimatingMove, nextTileId, tiles, undoStack]);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      activeUidRef.current = uid;
      setActiveUid(uid);
      bestSyncReadyRef.current = uid === null;
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSubmitInFlightRef.current = false;

      if (uid) {
        bestRef.current = 0;
        setDisplayBest(0);
        setDbBestScore(null);
      } else {
        const guestBest = loadBest(null);
        bestRef.current = guestBest;
        setDisplayBest(guestBest);
        setDbBestScore(guestBest);
      }
    });
  }, []);

  useEffect(() => {
    const scoresRef = collection(db, "scores", "6767", "users");
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown };
            return { uid: entry.id, score: normalizeLeaderboardScore(data?.score) };
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        setLeaderboardRows(rows);
      },
      (err) => console.warn("6767 leaderboard listener failed:", err)
    );
  }, []);

  useEffect(() => {
    if (!activeUid) {
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSyncReadyRef.current = true;
      return undefined;
    }

    const scoreRef = doc(db, "scores", "6767", "users", activeUid);
    return onSnapshot(
      scoreRef,
      (snap) => {
        const dbBest = snap.exists()
          ? normalizeLeaderboardScore((snap.data() as { score?: unknown })?.score)
          : 0;

        bestSyncReadyRef.current = true;
        setDbBestScore(dbBest);
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, dbBest);
        if (pendingBestScoreRef.current <= dbBest) {
          pendingBestScoreRef.current = 0;
        }

        bestRef.current = dbBest;
        saveBest(activeUidRef.current, dbBest);
        setDisplayBest(dbBest);
      },
      (err) => console.warn("6767 best score listener failed:", err)
    );
  }, [activeUid]);

  useEffect(() => {
    const uid = activeUidRef.current;
    const best = normalizeLeaderboardScore(bestRef.current);
    if (!bestSyncReadyRef.current) return;
    if (!uid || best <= 0) return;
    if (best <= submittedBestScoreRef.current && best <= pendingBestScoreRef.current) return;

    pendingBestScoreRef.current = Math.max(pendingBestScoreRef.current, best);

    function flushBestScoreUpdate() {
      const targetUid = activeUidRef.current;
      if (!targetUid) {
        pendingBestScoreRef.current = 0;
        return;
      }

      if (bestSubmitInFlightRef.current) return;

      const targetScore = pendingBestScoreRef.current;
      if (targetScore <= submittedBestScoreRef.current) {
        pendingBestScoreRef.current = 0;
        return;
      }

      bestSubmitInFlightRef.current = true;
      submit6767Score(targetUid, targetScore)
        .then(() => {
          submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, targetScore);
          if (pendingBestScoreRef.current <= targetScore) {
            pendingBestScoreRef.current = 0;
          }
        })
        .catch((err) => console.warn("6767 best score update failed:", err))
        .finally(() => {
          bestSubmitInFlightRef.current = false;
          if (pendingBestScoreRef.current > submittedBestScoreRef.current) {
            flushBestScoreUpdate();
          }
        });
    }

    flushBestScoreUpdate();
  }, [activeUid, displayBest]);

  useEffect(() => {
    const keyMap: Record<string, MoveDirection> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      applyMove(direction);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyMove]);

  useEffect(() => {
    latestTilesRef.current = tiles;
    latestBotFlagsRef.current = {
      layoutReady,
      isAnimatingMove,
      gameOver,
    };
    applyMoveRef.current = applyMove;
  }, [applyMove, gameOver, isAnimatingMove, layoutReady, tiles]);

  useEffect(() => {
    clearBotLoopTimer();
    if (!botEnabled) return;

    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      const { layoutReady: ready, isAnimatingMove: animating, gameOver: ended } =
        latestBotFlagsRef.current;

      if (ready && !animating && !ended) {
        const move = chooseBotMove(latestTilesRef.current);
        if (move) {
          applyMoveRef.current(move);
        }
      }

      botLoopTimerRef.current = window.setTimeout(tick, BOT_STEP_MS);
    };

    botLoopTimerRef.current = window.setTimeout(tick, BOT_STEP_MS);

    return () => {
      cancelled = true;
      clearBotLoopTimer();
    };
  }, [botEnabled, clearBotLoopTimer]);

  const handleTouchStart = useCallback((event: TouchEvent) => {
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (!touchStartRef.current) return;

      const dx = event.changedTouches[0].clientX - touchStartRef.current.x;
      const dy = event.changedTouches[0].clientY - touchStartRef.current.y;
      touchStartRef.current = null;

      if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        applyMove(dx > 0 ? "right" : "left");
      } else {
        applyMove(dy > 0 ? "down" : "up");
      }
    },
    [applyMove]
  );

  const highestTile = useMemo(() => getMaxTileValue(tiles), [tiles]);

  useEffect(() => {
    if (botomized) return;
    const currentScore = normalizeLeaderboardScore(highestTile);
    if (currentScore <= bestRef.current) return;
    bestRef.current = currentScore;
    saveBest(activeUidRef.current, currentScore);
    setDisplayBest(currentScore);
  }, [activeUid, botomized, dbBestScore, highestTile]);

  const shownBest = Math.max(displayBest, dbBestScore ?? 0);
  const topLeaderboardRows = leaderboardRows.slice(0, 6);

  const toggleBot = useCallback(() => {
    setBotEnabled((value) => {
      const nextValue = !value;
      if (nextValue) {
        setBotomized(true);
      }
      return nextValue;
    });
  }, []);

  return (
    <main className="g67">
      <div className="g67__layout">
        <section className="g67__card">
        <header className="g67__header">
          <div>
            <h1 className="g67__title">6767</h1>
            <p className="g67__subtitle">בלוק הדגל מציג את הבלוק הכי גבוה שהגעת אליו.</p>
            {botomized && <p className="g67__botomized">BOTOMIZED · לא נספר</p>}
          </div>

          <div className="g67__header-actions">
            <button
              className={`g67__btn${botEnabled ? " is-active" : ""}`}
              type="button"
              onClick={toggleBot}
              title="הפעלת בוט אוטומטי"
              aria-label="Toggle auto bot"
            >
              {botEnabled ? "⏹ עצור בוט" : "🤖 בוט"}
            </button>

            <button
              className="g67__btn g67__btn--undo"
              type="button"
              onClick={undo}
              disabled={undoStack.length === 0 || isAnimatingMove}
              title="בטל מהלך"
              aria-label="Undo last move"
            >
              ↩
            </button>

            <button className="g67__btn" type="button" onClick={restart}>
              ↺ חדש
            </button>
          </div>
        </header>

        <div className="g67__stats g67__stats--single" aria-live="polite">
          <article className="g67__stat">
            <span>בלוק הדגל</span>
            <strong>{highestTile}</strong>
          </article>
        </div>

        <div
          className="g67__board-wrapper"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="g67__board" role="grid" aria-label="לוח משחק 6767" ref={boardRef}>
            {Array.from({ length: SIZE * SIZE }, (_, index) => (
              <div
                key={`cell-bg-${index}`}
                ref={(el) => {
                  cellRefs.current[index] = el;
                }}
                className="g67__cell-bg"
                role="gridcell"
                aria-hidden
              />
            ))}

            <div className={`g67__tiles-layer${layoutReady ? " is-ready" : ""}`} aria-hidden>
              {tiles.map((tile) => {
                const layout = cellLayouts[tile.row * SIZE + tile.col];
                return (
                  <div
                    key={tile.id}
                    ref={(el) => {
                      if (el) {
                        tileRefs.current.set(tile.id, el);
                      } else {
                        tileRefs.current.delete(tile.id);
                      }
                    }}
                    className={[
                      "g67__tile",
                      spawnIds.has(tile.id) ? "is-new" : "",
                      mergePopIds.has(tile.id) ? "is-merged" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-value={tile.value}
                    style={
                      {
                        "--tile-x": `${layout?.x ?? 0}px`,
                        "--tile-y": `${layout?.y ?? 0}px`,
                        "--tile-size": `${layout?.size ?? 0}px`,
                      } as CSSProperties
                    }
                  >
                    <div className="g67__tile-inner">{tile.value}</div>
                  </div>
                );
              })}
            </div>

            {gameOver && (
              <div className="g67__overlay g67__overlay--lose" role="dialog" aria-label="Game over">
                <div className="g67__overlay-content">
                  <div className="g67__overlay-emoji">💀</div>
                  <p className="g67__overlay-title">נגמרו המהלכים</p>
                  <p className="g67__overlay-sub">בלוק הדגל בסיבוב: {highestTile}</p>
                  <div className="g67__overlay-actions">
                    {undoStack.length > 0 && (
                      <button
                        className="g67__overlay-btn g67__overlay-btn--secondary"
                        type="button"
                        onClick={undo}
                        disabled={isAnimatingMove}
                      >
                        ↩ בטל
                      </button>
                    )}
                    <button
                      className="g67__overlay-btn g67__overlay-btn--primary"
                      type="button"
                      onClick={restart}
                    >
                      נסה שוב
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="g67__controls" aria-label="כפתורי כיוון">
          <button
            className="g67__dir-btn"
            type="button"
            onClick={() => applyMove("up")}
            aria-label="למעלה"
            disabled={isAnimatingMove}
          >
            ↑
          </button>
          <button
            className="g67__dir-btn"
            type="button"
            onClick={() => applyMove("left")}
            aria-label="שמאלה"
            disabled={isAnimatingMove}
          >
            ←
          </button>
          <button
            className="g67__dir-btn"
            type="button"
            onClick={() => applyMove("down")}
            aria-label="למטה"
            disabled={isAnimatingMove}
          >
            ↓
          </button>
          <button
            className="g67__dir-btn"
            type="button"
            onClick={() => applyMove("right")}
            aria-label="ימינה"
            disabled={isAnimatingMove}
          >
            →
          </button>
        </div>

          <p className="g67__hint">⌨️ Arrow keys / WASD · 📱 Swipe · 🤖 Bot · ↩ Undo (up to 5)</p>
        </section>

        <aside className="g67__leaderboard" aria-label="6767 leaderboard">
          <div className="g67__leaderboard-head">
            <h2>Leaderboard</h2>
            <span className="g67__leaderboard-badge">Top tiles</span>
          </div>
          <div className="g67__leaderboard-best">
            <span>Your Best</span>
            <strong>{shownBest.toLocaleString()}</strong>
          </div>
          <div className="g67__leaderboard-list">
            {topLeaderboardRows.length === 0 ? (
              <p className="g67__leaderboard-empty">No scores yet. Play to claim rank #1.</p>
            ) : (
              topLeaderboardRows.map((row, index) => (
                <div
                  key={`${row.uid}-${index}`}
                  className={`g67__leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}
                >
                  <span className="g67__leaderboard-rank">{index + 1}</span>
                  <div className="g67__leaderboard-user">
                    <UserBox userId={row.uid} />
                  </div>
                  <strong className="g67__leaderboard-score">{row.score.toLocaleString()}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
