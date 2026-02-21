import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import UserBox from "../UserBox/UserBox";
import { auth, db } from "../../services/firebase";
import { submitSysTrisScore } from "../../services/scoreService";
import "./SysTrisGame.css";

const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const PREVIEW_COUNT = 3;
const BEST_KEY_PREFIX = "systris_best_score";
const SAVE_KEY_PREFIX = "systris_save_v2";
const PERF_MODE_KEY = "systris_perf_mode_v2";
const CLEAR_ANIM_MS = 280; // duration of is-clearing dissolve before commit
const SNAPSHOT_SAVE_DEBOUNCE_MS = 420;
const BURST_HISTORY_LIMIT_FULL = 48;
const BURST_HISTORY_LIMIT_PERF = 24;
const EFFECT_HISTORY_LIMIT_FULL = 160;
const EFFECT_HISTORY_LIMIT_PERF = 64;
const FX_INTENSITY_SCALE = 0.68;
const FX_COUNT_SCALE = 0.62;

let runtimePerfMode = true;

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Matrix = number[][];
type BoardCell = PieceType | null;
type Board = BoardCell[][];
type Status = "ready" | "playing" | "paused" | "gameover";
type RotationDirection = "CW" | "CCW";

interface PieceDef {
  matrix: Matrix;
  color: string;
  glow: string;
}

interface RotationPivot {
  x: number;
  y: number;
}

interface RotationState {
  matrix: Matrix;
  pivot: RotationPivot;
}

interface PieceRotationDef {
  states: RotationState[];
  stateCount: number;
}

interface ActivePiece {
  type: PieceType;
  matrix: Matrix;
  row: number;
  col: number;
  rotation: number;
}

interface Burst {
  id: number;
  kind: "clear" | "impact";
  lane: number;
  hue: number;
  strength: number;
  delayMs: number;
}

interface TrailEffect {
  id: number;
  kind: "trail";
  type: PieceType;
  matrix: Matrix;
  row: number;
  col: number;
  strength: number;
  motion: "fall" | "shift" | "spin";
  delayMs: number;
}

interface LockRingEffect {
  id: number;
  kind: "lock-ring";
  x: number;
  y: number;
  strength: number;
  delayMs: number;
}

interface RowShardEffect {
  id: number;
  kind: "row-shard";
  row: number;
  col: number;
  hue: number;
  strength: number;
  drift: number;
  delayMs: number;
}

type EffectEvent = TrailEffect | LockRingEffect | RowShardEffect;

/** Deferred line-clear data: board state shown during the clear animation,
 *  plus the fully computed "after" values committed once the animation ends. */
interface PendingClear {
  mergedBoard: Board;                       // board WITH the cleared rows still visible (for is-clearing anim)
  clearedRows: number[];                    // which rows get is-clearing class
  nextBoard: Board;                         // board after row removal
  nextLines: number;
  nextLevel: number;
  nextCombo: number;
  nextScore: number;
  nextBest: number;
  nextMessage: string;
  nextComboEnergy: number;
  spawnQueue: PieceType[];
  spawnBag: PieceType[];
  spawnedPiece: ActivePiece;
  blocked: boolean;
}

interface GameState {
  board: Board;
  active: ActivePiece | null;
  queue: PieceType[];
  bag: PieceType[];
  status: Status;
  score: number;
  lines: number;
  level: number;
  combo: number;
  best: number;
  lastClear: number;
  message: string;
  clearPulse: number;
  impactPulse: number;
  bursts: Burst[];
  burstSeq: number;
  effects: EffectEvent[];
  effectSeq: number;
  comboEnergy: number;
  fxPower: number;
  fxPulse: number;
  fxLabel: string;
  pendingClear: PendingClear | null;
  lockFlashKey: number;
}

type SavedSysTris = {
  v: 2;
  state: Partial<GameState>;
};

type LeaderboardRow = {
  uid: string;
  score: number;
};

type Action =
  | { type: "START" }
  | { type: "RESTART" }
  | { type: "SYNC_BEST"; best: number }
  | { type: "TICK" }
  | { type: "MOVE"; delta: -1 | 1 }
  | { type: "ROTATE"; direction?: RotationDirection }
  | { type: "SOFT_DROP" }
  | { type: "HARD_DROP" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "COMMIT_CLEAR" }
  | { type: "REMOVE_BURST"; id: number }
  | { type: "REMOVE_EFFECT"; id: number };

const PIECE_ORDER: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];
const LINE_POINTS = [0, 100, 300, 500, 800] as const;
const PIECE_HUES: Record<PieceType, number> = {
  I: 186, O: 54, T: 276, S: 142, Z: 344, J: 222, L: 28,
};
const PIECE_ROTATION_COUNTS: Record<PieceType, number> = {
  I: 4, O: 1, T: 4, S: 2, Z: 2, J: 4, L: 4,
};
const PIECE_BASE_PIVOTS: Record<PieceType, RotationPivot> = {
  I: { x: 1.5, y: 0.5 },
  O: { x: 0.5, y: 0.5 },
  T: { x: 1, y: 1 },
  S: { x: 1, y: 1 },
  Z: { x: 1, y: 1 },
  J: { x: 1, y: 1 },
  L: { x: 1, y: 1 },
};
const ROTATION_KICKS: ReadonlyArray<{ row: number; col: number }> = [
  { row: 0, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
  { row: -1, col: 0 },
  { row: -1, col: -1 },
  { row: -1, col: 1 },
];

const PIECE_DEFS: Record<PieceType, PieceDef> = {
  I: { matrix: [[1, 1, 1, 1]], color: "#36f5ff", glow: "rgba(54, 245, 255, 0.72)" },
  O: { matrix: [[1, 1], [1, 1]], color: "#fff765", glow: "rgba(255, 247, 101, 0.65)" },
  T: { matrix: [[0, 1, 0], [1, 1, 1]], color: "#bd72ff", glow: "rgba(189, 114, 255, 0.7)" },
  S: { matrix: [[0, 1, 1], [1, 1, 0]], color: "#5ef79a", glow: "rgba(94, 247, 154, 0.66)" },
  Z: { matrix: [[1, 1, 0], [0, 1, 1]], color: "#ff6d8f", glow: "rgba(255, 109, 143, 0.72)" },
  J: { matrix: [[1, 0, 0], [1, 1, 1]], color: "#71a3ff", glow: "rgba(113, 163, 255, 0.72)" },
  L: { matrix: [[0, 0, 1], [1, 1, 1]], color: "#ffb45f", glow: "rgba(255, 180, 95, 0.7)" },
};

function isPieceType(value: unknown): value is PieceType {
  return typeof value === "string" && value in PIECE_DEFS;
}

function normalizeStatus(value: unknown): Status {
  if (value === "ready" || value === "playing" || value === "paused" || value === "gameover") {
    return value;
  }
  return "ready";
}

function normalizeBoard(raw: unknown): Board {
  if (!Array.isArray(raw)) return createEmptyBoard();
  const board = createEmptyBoard();
  for (let r = 0; r < Math.min(raw.length, BOARD_HEIGHT); r += 1) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < Math.min(row.length, BOARD_WIDTH); c += 1) {
      const cell = row[c];
      board[r][c] = isPieceType(cell) ? cell : null;
    }
  }
  return board;
}

function normalizePieceList(raw: unknown): PieceType[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPieceType);
}

function normalizeActivePiece(raw: unknown): ActivePiece | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ActivePiece>;
  if (!isPieceType(candidate.type)) return null;
  if (!Array.isArray(candidate.matrix)) return null;
  const rawMatrix = candidate.matrix.map((row) =>
    Array.isArray(row) ? row.map((cell) => (cell ? 1 : 0)) : []
  );
  if (rawMatrix.length === 0 || rawMatrix.some((row) => row.length === 0)) return null;
  const rotation = getCanonicalRotation(candidate.type, rawMatrix, candidate.rotation);
  const matrix = cloneMatrix(PIECE_ROTATIONS[candidate.type].states[rotation].matrix);
  return {
    type: candidate.type,
    matrix,
    row: Number.isFinite(candidate.row) ? Number(candidate.row) : -1,
    col: Number.isFinite(candidate.col) ? Number(candidate.col) : 0,
    rotation,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (["input", "textarea", "select", "button"].includes(tag)) return true;
  return target.isContentEditable;
}

function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<BoardCell>(BOARD_WIDTH).fill(null));
}

function cloneMatrix(matrix: Matrix): Matrix {
  return matrix.map((row) => [...row]);
}

function normalizeInteger(value: number): number {
  return Math.round(value);
}

function positiveMod(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function isSameMatrix(a: Matrix, b: Matrix): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c += 1) {
      if ((a[r][c] ? 1 : 0) !== (b[r][c] ? 1 : 0)) return false;
    }
  }
  return true;
}

function buildRotatedState(state: RotationState, direction: RotationDirection): RotationState {
  const occupied: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < state.matrix.length; r += 1) {
    for (let c = 0; c < state.matrix[r].length; c += 1) {
      if (!state.matrix[r][c]) continue;
      occupied.push({ x: c, y: r });
    }
  }
  if (occupied.length === 0) return { matrix: [[1]], pivot: { x: 0, y: 0 } };

  const rotated = occupied.map((cell) => {
    const dx = cell.x - state.pivot.x;
    const dy = cell.y - state.pivot.y;
    const nextDx = direction === "CW" ? dy : -dy;
    const nextDy = direction === "CW" ? -dx : dx;
    return {
      x: normalizeInteger(state.pivot.x + nextDx),
      y: normalizeInteger(state.pivot.y + nextDy),
    };
  });

  const minX = Math.min(...rotated.map((cell) => cell.x));
  const maxX = Math.max(...rotated.map((cell) => cell.x));
  const minY = Math.min(...rotated.map((cell) => cell.y));
  const maxY = Math.max(...rotated.map((cell) => cell.y));
  const width = normalizeInteger(maxX - minX + 1);
  const height = normalizeInteger(maxY - minY + 1);
  const matrix: Matrix = Array.from({ length: height }, () => Array(width).fill(0));

  for (const cell of rotated) {
    const x = normalizeInteger(cell.x - minX);
    const y = normalizeInteger(cell.y - minY);
    if (y >= 0 && y < matrix.length && x >= 0 && x < matrix[0].length) {
      matrix[y][x] = 1;
    }
  }

  return {
    matrix,
    pivot: {
      x: normalizeInteger(state.pivot.x - minX),
      y: normalizeInteger(state.pivot.y - minY),
    },
  };
}

function buildPieceRotationDefs(): Record<PieceType, PieceRotationDef> {
  return PIECE_ORDER.reduce<Record<PieceType, PieceRotationDef>>((defs, type) => {
    const stateCount = PIECE_ROTATION_COUNTS[type];
    const states: RotationState[] = [];
    let current: RotationState = {
      matrix: cloneMatrix(PIECE_DEFS[type].matrix),
      pivot: { ...PIECE_BASE_PIVOTS[type] },
    };
    states.push({ matrix: cloneMatrix(current.matrix), pivot: { ...current.pivot } });
    for (let i = 1; i < stateCount; i += 1) {
      current = buildRotatedState(current, "CW");
      states.push({ matrix: cloneMatrix(current.matrix), pivot: { ...current.pivot } });
    }
    defs[type] = { states, stateCount };
    return defs;
  }, {} as Record<PieceType, PieceRotationDef>);
}

const PIECE_ROTATIONS = buildPieceRotationDefs();

function getCanonicalRotation(type: PieceType, matrix: Matrix, rawRotation: unknown): number {
  const rotationDef = PIECE_ROTATIONS[type];
  const explicitRotation = Number(rawRotation);
  if (Number.isFinite(explicitRotation)) {
    return positiveMod(Math.round(explicitRotation), rotationDef.stateCount);
  }
  for (let i = 0; i < rotationDef.stateCount; i += 1) {
    if (isSameMatrix(rotationDef.states[i].matrix, matrix)) return i;
  }
  return 0;
}

function attemptRotate(board: Board, piece: ActivePiece, direction: RotationDirection): ActivePiece | null {
  const rotationDef = PIECE_ROTATIONS[piece.type];
  if (rotationDef.stateCount <= 1) return piece;

  const step = direction === "CW" ? 1 : -1;
  const currentRotation = positiveMod(piece.rotation, rotationDef.stateCount);
  const nextRotation = positiveMod(currentRotation + step, rotationDef.stateCount);
  const currentState = rotationDef.states[currentRotation];
  const nextState = rotationDef.states[nextRotation];

  const pivotRow = piece.row + currentState.pivot.y;
  const pivotCol = piece.col + currentState.pivot.x;
  const baseRow = normalizeInteger(pivotRow - nextState.pivot.y);
  const baseCol = normalizeInteger(pivotCol - nextState.pivot.x);

  for (const kick of ROTATION_KICKS) {
    const candidateRow = baseRow + kick.row;
    const candidateCol = baseCol + kick.col;
    if (!collides(board, nextState.matrix, candidateRow, candidateCol)) {
      return {
        ...piece,
        matrix: cloneMatrix(nextState.matrix),
        rotation: nextRotation,
        row: candidateRow,
        col: candidateCol,
      };
    }
  }
  return null;
}

function shuffledBag(): PieceType[] {
  const bag = [...PIECE_ORDER];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function refillQueue(queue: PieceType[], bag: PieceType[], minSize = PREVIEW_COUNT + 1) {
  const nextQueue = [...queue];
  let nextBag = [...bag];
  while (nextQueue.length < minSize) {
    if (nextBag.length === 0) nextBag = shuffledBag();
    const nextType = nextBag[0];
    if (!nextType) break;
    nextQueue.push(nextType);
    nextBag = nextBag.slice(1);
  }
  return { queue: nextQueue, bag: nextBag };
}

function spawnPiece(queue: PieceType[], bag: PieceType[]) {
  const refilled = refillQueue(queue, bag);
  const type = refilled.queue[0];
  if (!type) throw new Error("SysTris queue generation failed");
  const matrix = cloneMatrix(PIECE_ROTATIONS[type].states[0].matrix);
  const col = Math.floor((BOARD_WIDTH - matrix[0].length) / 2);
  return {
    piece: { type, matrix, row: -1, col, rotation: 0 } as ActivePiece,
    queue: refilled.queue.slice(1),
    bag: refilled.bag,
  };
}

function collides(board: Board, matrix: Matrix, row: number, col: number): boolean {
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (matrix[r][c] === 0) continue;
      const br = row + r;
      const bc = col + c;
      if (bc < 0 || bc >= BOARD_WIDTH || br >= BOARD_HEIGHT) return true;
      if (br >= 0 && board[br][bc]) return true;
    }
  }
  return false;
}

function mergePiece(board: Board, piece: ActivePiece): Board {
  const next = board.map((row) => [...row]);
  for (let r = 0; r < piece.matrix.length; r += 1) {
    for (let c = 0; c < piece.matrix[r].length; c += 1) {
      if (piece.matrix[r][c] === 0) continue;
      const br = piece.row + r;
      const bc = piece.col + c;
      if (br >= 0 && br < BOARD_HEIGHT && bc >= 0 && bc < BOARD_WIDTH) {
        next[br][bc] = piece.type;
      }
    }
  }
  return next;
}

function clearFullLines(board: Board) {
  const kept: Board = [];
  const clearedRows: number[] = [];
  const clearedCells: Array<Array<{ col: number; type: PieceType }>> = [];
  for (let rowIndex = 0; rowIndex < board.length; rowIndex += 1) {
    const row = board[rowIndex];
    const isFull = row.every((cell) => Boolean(cell));
    if (!isFull) { kept.push(row); continue; }
    clearedRows.push(rowIndex);
    const cells: Array<{ col: number; type: PieceType }> = [];
    for (let col = 0; col < row.length; col += 1) {
      const type = row[col];
      if (type) cells.push({ col, type });
    }
    clearedCells.push(cells);
  }
  const cleared = clearedRows.length;
  while (kept.length < BOARD_HEIGHT) kept.unshift(Array<BoardCell>(BOARD_WIDTH).fill(null));
  return { board: kept, cleared, clearedRows, clearedCells };
}

function getLevel(lines: number): number {
  return Math.floor(lines / 10) + 1;
}

function getDropDelay(level: number): number {
  return Math.max(90, 760 - (level - 1) * 55);
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function loadPerformanceMode(): boolean {
  try {
    const raw = localStorage.getItem(PERF_MODE_KEY);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    // Ignore storage failures.
  }
  // Default to full mode unless user explicitly enabled saver mode.
  return false;
}

function savePerformanceMode(enabled: boolean): void {
  try {
    localStorage.setItem(PERF_MODE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

function getGhostRow(board: Board, piece: ActivePiece): number {
  let row = piece.row;
  while (!collides(board, piece.matrix, row + 1, piece.col)) row += 1;
  return row;
}

function getClearCallout(cleared: number, combo: number): string {
  if (cleared === 0) return combo > 0 ? `Flow Combo x${combo}` : "Keep the rhythm";
  let label = "Single Pulse";
  if (cleared === 2) label = "Double Sync";
  if (cleared === 3) label = "Triple Surge";
  if (cleared === 4) label = "TETRIS EFFECT";
  if (combo > 1) return `${label} · Combo x${combo}`;
  return label;
}

function getActionPower(cleared: number, combo: number, impactStrength: number): number {
  const clearPower = cleared * 0.42 + (cleared >= 4 ? 0.68 : 0);
  const comboPower = Math.max(0, combo - 1) * 0.14;
  const impactPower = impactStrength * 0.62;
  return Math.min(2.6, clearPower + comboPower + impactPower);
}

function getActionLabel(cleared: number, combo: number, impactStrength: number): string {
  if (cleared >= 4) return combo > 1 ? `TETRIS APOCALYPSE x${combo}` : "TETRIS APOCALYPSE";
  if (cleared === 3) return combo > 1 ? `TRIPLE FUSION x${combo}` : "TRIPLE FUSION";
  if (cleared === 2) return combo > 1 ? `DOUBLE IMPACT x${combo}` : "DOUBLE IMPACT";
  if (cleared === 1 && combo >= 3) return `RHYTHM RAMPAGE x${combo}`;
  if (cleared === 1) return "SINGLE SURGE";
  if (impactStrength >= 1.15) return "HYPER DROP";
  if (combo >= 5) return `COMBO FRENZY x${combo}`;
  return "";
}

function decayFx(power: number, amount = 0.08): number {
  return Math.max(0, power - amount);
}

function getBestStorageKey(uid: string | null): string {
  return uid ? `${BEST_KEY_PREFIX}:${uid}` : `${BEST_KEY_PREFIX}:guest`;
}

function getSaveStorageKey(uid: string | null): string {
  return uid ? `${SAVE_KEY_PREFIX}:${uid}` : `${SAVE_KEY_PREFIX}:guest`;
}

function loadBest(uid: string | null): number {
  try {
    const value = Number(localStorage.getItem(getBestStorageKey(uid)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

function loadSavedState(best: number, uid: string | null): GameState | null {
  try {
    const raw = localStorage.getItem(getSaveStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSysTris;
    if (!parsed || parsed.v !== 2 || !parsed.state) return null;
    const saved = parsed.state;
    let queue = normalizePieceList(saved.queue);
    let bag = normalizePieceList(saved.bag);
    let active = normalizeActivePiece(saved.active);
    const restoredStatus = normalizeStatus(saved.status);
    const status: Status = restoredStatus === "playing" ? "paused" : restoredStatus;
    const rebuiltBest = uid ? Math.max(0, best) : Math.max(best, Number(saved.best) || 0);
    if (restoredStatus === "playing" && !active) {
      const spawned = spawnPiece(queue, bag);
      active = spawned.piece;
      queue = spawned.queue;
      bag = spawned.bag;
    }
    return {
      board: normalizeBoard(saved.board),
      active,
      queue,
      bag,
      status,
      score: Math.max(0, Number(saved.score) || 0),
      lines: Math.max(0, Number(saved.lines) || 0),
      level: Math.max(1, Number(saved.level) || 1),
      combo: Math.max(0, Number(saved.combo) || 0),
      best: rebuiltBest,
      lastClear: Math.max(0, Number(saved.lastClear) || 0),
      message: status === "paused" ? "Paused" : typeof saved.message === "string" ? saved.message : "Drop into the grid",
      clearPulse: 0, impactPulse: 0,
      bursts: [], burstSeq: 0,
      effects: [], effectSeq: 0,
      comboEnergy: Math.max(0, Number(saved.comboEnergy) || 0),
      fxPower: Math.max(0, Number(saved.fxPower) || 0),
      fxPulse: Math.max(0, Number(saved.fxPulse) || 0),
      fxLabel: typeof saved.fxLabel === "string" ? saved.fxLabel : "",
      pendingClear: null,
      lockFlashKey: 0,
    };
  } catch { return null; }
}

function addBursts(
  current: Burst[], startSeq: number, kind: Burst["kind"],
  count: number, strength: number, baseDelayMs = 0, staggerMs = 8
) {
  if (runtimePerfMode) return { bursts: current, burstSeq: startSeq };
  const scaledCount = Math.max(1, Math.round(count * FX_COUNT_SCALE));
  const scaledStrength = Math.max(0.24, strength * FX_INTENSITY_SCALE);
  let burstSeq = startSeq;
  const bursts = [...current];
  for (let i = 0; i < scaledCount; i += 1) {
    burstSeq += 1;
    bursts.push({
      id: burstSeq, kind,
      lane: Math.random(),
      hue: Math.floor(Math.random() * 360),
      strength: Number((scaledStrength * (0.82 + Math.random() * 0.34)).toFixed(2)),
      delayMs: Math.max(0, Math.round(baseDelayMs + i * staggerMs)),
    });
  }
  const limit = runtimePerfMode ? BURST_HISTORY_LIMIT_PERF : BURST_HISTORY_LIMIT_FULL;
  return { bursts: bursts.slice(-limit), burstSeq };
}

function addEffect(current: EffectEvent[], startSeq: number, build: (id: number) => EffectEvent) {
  if (runtimePerfMode) return { effects: current, effectSeq: startSeq };
  const effectSeq = startSeq + 1;
  const limit = runtimePerfMode ? EFFECT_HISTORY_LIMIT_PERF : EFFECT_HISTORY_LIMIT_FULL;
  return { effects: [...current, build(effectSeq)].slice(-limit), effectSeq };
}

function addTrailEffect(
  current: EffectEvent[], startSeq: number, piece: ActivePiece,
  strength: number, motion: TrailEffect["motion"], delayMs = 0
) {
  if (piece.row + piece.matrix.length <= 0) return { effects: current, effectSeq: startSeq };
  const scaledStrength = Math.max(0.28, Math.min(1.3, strength * FX_INTENSITY_SCALE));
  return addEffect(current, startSeq, (id) => ({
    id, kind: "trail", type: piece.type,
    matrix: cloneMatrix(piece.matrix),
    row: piece.row, col: piece.col,
    strength: scaledStrength,
    motion,
    delayMs: Math.max(0, Math.round(delayMs)),
  }));
}

function addLockRingEffect(
  current: EffectEvent[], startSeq: number, piece: ActivePiece, strength: number, delayMs = 0
) {
  const centerX = piece.col + piece.matrix[0].length / 2;
  const centerY = piece.row + piece.matrix.length / 2;
  const scaledStrength = Math.max(0.32, Math.min(1.6, strength * FX_INTENSITY_SCALE));
  return addEffect(current, startSeq, (id) => ({
    id, kind: "lock-ring",
    x: centerX, y: centerY,
    strength: scaledStrength,
    delayMs: Math.max(0, Math.round(delayMs)),
  }));
}

function addLineClearEffects(
  current: EffectEvent[], startSeq: number,
  clearedRows: number[],
  clearedCells: Array<Array<{ col: number; type: PieceType }>>,
  power: number
) {
  let effects = current;
  let effectSeq = startSeq;
  for (let i = 0; i < clearedRows.length; i += 1) {
    const row = clearedRows[i];
    const rowCells = clearedCells[i] ?? [];
    const rowBaseDelay = i * 30;
    const step = Math.max(1, Math.floor(rowCells.length / 4));
    for (let cellIndex = 0; cellIndex < rowCells.length; cellIndex += step) {
      const cell = rowCells[cellIndex];
      const shardIndex = Math.floor(cellIndex / step);
      const shardStrength = Math.max(0.38, Math.min(1.1, power * FX_INTENSITY_SCALE * (0.74 + Math.random() * 0.26)));
      const shard = addEffect(effects, effectSeq, (id) => ({
        id, kind: "row-shard",
        row, col: cell.col,
        hue: PIECE_HUES[cell.type],
        strength: Number(shardStrength.toFixed(3)),
        drift: Number(((Math.random() * 2.6) - 1.3).toFixed(3)),
        delayMs: rowBaseDelay + 10 + shardIndex * 5 + Math.floor(Math.random() * 10),
      }));
      effects = shard.effects;
      effectSeq = shard.effectSeq;
    }
  }
  return { effects, effectSeq };
}

function createRun(best: number, status: Status): GameState {
  const spawned = spawnPiece([], []);
  return {
    board: createEmptyBoard(),
    active: spawned.piece,
    queue: spawned.queue,
    bag: spawned.bag,
    status,
    score: 0, lines: 0, level: 1, combo: 0, best,
    lastClear: 0,
    message: status === "ready" ? "Press Start to sync" : "Drop into the grid",
    clearPulse: 0, impactPulse: 0,
    bursts: [], burstSeq: 0,
    effects: [], effectSeq: 0,
    comboEnergy: 0, fxPower: 0, fxPulse: 0, fxLabel: "",
    pendingClear: null, lockFlashKey: 0,
  };
}

function createInitialState(): GameState {
  const uid = auth.currentUser?.uid ?? null;
  const best = uid ? 0 : loadBest(null);
  const saved = loadSavedState(best, uid);
  if (saved) return saved;
  return createRun(best, "ready");
}

function buildSnapshot(state: GameState, pauseIfPlaying: boolean): SavedSysTris {
  const status: Status = pauseIfPlaying && state.status === "playing" ? "paused" : state.status;
  const message = pauseIfPlaying && state.status === "playing" ? "Paused" : state.message;
  return {
    v: 2,
    state: {
      board: state.board, active: state.active,
      queue: state.queue, bag: state.bag, status,
      score: state.score, lines: state.lines, level: state.level,
      combo: state.combo, best: state.best, lastClear: state.lastClear,
      message, comboEnergy: state.comboEnergy,
      fxPower: state.fxPower, fxPulse: state.fxPulse, fxLabel: state.fxLabel,
    },
  };
}

function persistSnapshot(state: GameState, pauseIfPlaying: boolean, uid: string | null) {
  try {
    const snapshot = buildSnapshot(state, pauseIfPlaying);
    localStorage.setItem(getSaveStorageKey(uid), JSON.stringify(snapshot));
  } catch { /* ignore */ }
}

/**
 * Phase 1: piece locks, effects fire, shards launch.
 * If lines are cleared, we set pendingClear and defer board mutation.
 * If no lines, we commit immediately (same-frame, no visual delay needed).
 */
function settlePiece(
  state: GameState,
  piece: ActivePiece,
  extraScore: number,
  impactStrength: number
): GameState {
  const mergedBoard = mergePiece(state.board, piece);
  const clearedResult = clearFullLines(mergedBoard);
  const cleared = clearedResult.cleared;

  const nextLines = state.lines + cleared;
  const nextLevel = getLevel(nextLines);
  const levelUp = nextLevel > state.level;
  const lineScore = LINE_POINTS[cleared] * state.level;
  const nextCombo = cleared > 0 ? state.combo + 1 : 0;
  const comboBonus = cleared > 0 ? Math.max(0, nextCombo - 1) * 60 * state.level : 0;
  const nextScore = state.score + extraScore + lineScore + comboBonus;
  const nextBest = Math.max(state.best, nextScore);

  const actionPowerBase = getActionPower(cleared, nextCombo, impactStrength);
  const actionPower = runtimePerfMode
    ? 0
    : Math.min(2.1, (actionPowerBase + (levelUp ? 0.22 : 0)) * FX_INTENSITY_SCALE);
  const baseLabel = getActionLabel(cleared, nextCombo, impactStrength);
  const actionLabel = runtimePerfMode
    ? ""
    : levelUp
    ? (baseLabel ? `${baseLabel} · LEVEL ${nextLevel}` : `LEVEL ${nextLevel} SHIFT`)
    : baseLabel;
  const actionBurstBoost = Math.max(1, Math.round(actionPower * 2.2));

  const nextComboEnergy = runtimePerfMode
    ? 0
    : cleared > 0
    ? Math.min(
        1.4,
        state.comboEnergy * 0.5 +
          cleared * 0.24 +
          Math.max(0, nextCombo - 1) * 0.1 +
          (levelUp ? 0.12 : 0)
      )
    : Math.max(0, state.comboEnergy - 0.22);

  // --- Generate all effects immediately (they fire during clear animation) ---
  let bursts = state.bursts;
  let burstSeq = state.burstSeq;
  let effects = state.effects;
  let effectSeq = state.effectSeq;
  let clearPulse = state.clearPulse;
  let impactPulse = state.impactPulse;

  // Lock ring — always
  const lockFx = addLockRingEffect(effects, effectSeq, piece, Math.max(0.56, impactStrength + (cleared > 0 ? 0.22 : 0)));
  effects = lockFx.effects;
  effectSeq = lockFx.effectSeq;

  if (cleared > 0) {
    clearPulse += 1;
    // Clear bursts
    const clearBurstCount = Math.max(2, Math.round(actionPower * 2.4 + cleared * 1.2));
    const cb = addBursts(bursts, burstSeq, "clear", clearBurstCount, actionPower, 0, 10);
    bursts = cb.bursts; burstSeq = cb.burstSeq;
    // Row shards (fire slightly delayed — during the is-clearing window)
    const rowFx = addLineClearEffects(effects, effectSeq, clearedResult.clearedRows, clearedResult.clearedCells, actionPower);
    effects = rowFx.effects;
    effectSeq = rowFx.effectSeq;
  } else if (impactStrength > 0) {
    const impactFx = addBursts(
      bursts,
      burstSeq,
      "impact",
      Math.max(1, Math.round(impactStrength * (2 + actionBurstBoost * 0.5))),
      Math.max(0.28, impactStrength * FX_INTENSITY_SCALE),
      0,
      6
    );
    bursts = impactFx.bursts; burstSeq = impactFx.burstSeq;
    impactPulse += 1;
  }

  const fxPower = runtimePerfMode ? 0 : Math.min(1.8, actionPower + nextComboEnergy * 0.08);
  const fxPulse = runtimePerfMode
    ? state.fxPulse
    : actionPower > 0.56 || levelUp
      ? state.fxPulse + 1
      : state.fxPulse;
  const lockFlashKey = state.lockFlashKey + 1;

  // ── NO LINES CLEARED: commit immediately ───────────────────────────────────
  if (cleared === 0) {
    const spawned = spawnPiece(state.queue, state.bag);
    const blocked = collides(clearedResult.board, spawned.piece.matrix, spawned.piece.row, spawned.piece.col);
    const base = {
      board: clearedResult.board,
      queue: spawned.queue, bag: spawned.bag,
      score: nextScore, lines: nextLines, level: nextLevel,
      combo: nextCombo, best: nextBest, lastClear: cleared,
      message: getClearCallout(cleared, nextCombo),
      clearPulse, impactPulse,
      bursts, burstSeq, effects, effectSeq,
      comboEnergy: nextComboEnergy, fxPower, fxPulse, fxLabel: actionLabel,
      pendingClear: null, lockFlashKey,
    };
    if (blocked) {
      return { ...state, ...base, active: null, status: "gameover", message: "System overflow. Restart to resync." };
    }
    return { ...state, ...base, active: spawned.piece };
  }

  // ── LINES CLEARED: defer board commit — set pendingClear ──────────────────
  // Prepare the spawn for COMMIT_CLEAR, using the *post-clear* board
  const spawned = spawnPiece(state.queue, state.bag);
  const blocked = collides(clearedResult.board, spawned.piece.matrix, spawned.piece.row, spawned.piece.col);

  const pendingClear: PendingClear = {
    mergedBoard,
    clearedRows: clearedResult.clearedRows,
    nextBoard: clearedResult.board,
    nextLines, nextLevel, nextCombo, nextScore, nextBest,
    nextMessage: getClearCallout(cleared, nextCombo),
    nextComboEnergy,
    spawnQueue: spawned.queue,
    spawnBag: spawned.bag,
    spawnedPiece: spawned.piece,
    blocked,
  };

  return {
    ...state,
    // We set active=null so TICK doesn't try to fall anything during the clear window
    active: null,
    board: mergedBoard,    // show merged (full rows visible) during animation
    lastClear: cleared,
    clearPulse, impactPulse,
    bursts, burstSeq, effects, effectSeq,
    comboEnergy: nextComboEnergy,
    fxPower, fxPulse, fxLabel: actionLabel,
    pendingClear,
    lockFlashKey,
  };
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "SYNC_BEST": {
      const syncedBest = normalizeScore(action.best);
      if (syncedBest === state.best) return state;
      return { ...state, best: syncedBest };
    }

    case "START": {
      if (state.status === "ready" || state.status === "gameover") return createRun(state.best, "playing");
      if (state.status === "paused") return { ...state, status: "playing", message: "Back in the groove" };
      return state;
    }

    case "RESTART": {
      return createRun(state.best, "playing");
    }

    case "TOGGLE_PAUSE": {
      if (state.status === "playing") return { ...state, status: "paused", message: "Paused" };
      if (state.status === "paused") return { ...state, status: "playing", message: "Back in the groove" };
      return state;
    }

    // Commit deferred line-clear: apply board, spawn next piece
    case "COMMIT_CLEAR": {
      if (!state.pendingClear) return state;
      const pc = state.pendingClear;
      const base = {
        board: pc.nextBoard,
        queue: pc.spawnQueue, bag: pc.spawnBag,
        score: pc.nextScore, lines: pc.nextLines, level: pc.nextLevel,
        combo: pc.nextCombo, best: pc.nextBest,
        lastClear: state.lastClear,
        message: pc.nextMessage,
        comboEnergy: pc.nextComboEnergy,
        pendingClear: null as PendingClear | null,
      };
      if (pc.blocked) {
        return { ...state, ...base, active: null, status: "gameover", message: "System overflow. Restart to resync." };
      }
      return { ...state, ...base, active: pc.spawnedPiece };
    }

    case "TICK": {
      // Block ticking during line-clear animation
      if (state.status !== "playing" || !state.active || state.pendingClear) return state;
      const moved = { ...state.active, row: state.active.row + 1 };
      if (!collides(state.board, moved.matrix, moved.row, moved.col)) {
        return {
          ...state,
          active: moved,
          comboEnergy: Math.max(0, state.comboEnergy - 0.016),
          fxPower: decayFx(state.fxPower, 0.07),
        };
      }
      return settlePiece(state, state.active, 0, 0.32);
    }

    case "MOVE": {
      if (state.status !== "playing" || !state.active || state.pendingClear) return state;
      const moved = { ...state.active, col: state.active.col + action.delta };
      if (collides(state.board, moved.matrix, moved.row, moved.col)) return state;
      const trailFx = addTrailEffect(state.effects, state.effectSeq, state.active, 0.48, "shift");
      return {
        ...state, active: moved,
        effects: trailFx.effects, effectSeq: trailFx.effectSeq,
        comboEnergy: Math.max(0, state.comboEnergy - 0.01),
        fxPower: decayFx(state.fxPower, 0.03),
      };
    }

    case "ROTATE": {
      if (state.status !== "playing" || !state.active || state.pendingClear) return state;
      const rotated = attemptRotate(state.board, state.active, action.direction ?? "CW");
      if (!rotated) return state;
      if (
        rotated.row === state.active.row
        && rotated.col === state.active.col
        && rotated.rotation === state.active.rotation
      ) {
        return state;
      }
      const trailFx = addTrailEffect(state.effects, state.effectSeq, state.active, 0.62, "spin");
      return {
        ...state,
        active: rotated,
        effects: trailFx.effects, effectSeq: trailFx.effectSeq,
        comboEnergy: Math.max(0, state.comboEnergy - 0.008),
        fxPower: decayFx(state.fxPower, 0.02),
      };
    }

    case "SOFT_DROP": {
      if (state.status !== "playing" || !state.active || state.pendingClear) return state;
      const moved = { ...state.active, row: state.active.row + 1 };
      if (!collides(state.board, moved.matrix, moved.row, moved.col)) {
        const nextScore = state.score + 1;
        const trailFx = moved.row % 2 === 0
          ? addTrailEffect(state.effects, state.effectSeq, state.active, 0.46, "fall")
          : { effects: state.effects, effectSeq: state.effectSeq };
        return {
          ...state, active: moved, score: nextScore,
          best: Math.max(state.best, nextScore),
          effects: trailFx.effects, effectSeq: trailFx.effectSeq,
          comboEnergy: Math.max(0, state.comboEnergy - 0.012),
          fxPower: decayFx(state.fxPower, 0.025),
        };
      }
      return settlePiece(state, state.active, 0, 0.42);
    }

    case "HARD_DROP": {
      if (state.status !== "playing" || !state.active || state.pendingClear) return state;
      let row = state.active.row;
      while (!collides(state.board, state.active.matrix, row + 1, state.active.col)) row += 1;
      const distance = row - state.active.row;
      const impact = 0.55 + Math.min(0.9, distance / 14);
      const dropped: ActivePiece = { ...state.active, row };
      const trailFx = addTrailEffect(state.effects, state.effectSeq, dropped, 0.84, "fall");
      return settlePiece(
        { ...state, effects: trailFx.effects, effectSeq: trailFx.effectSeq },
        dropped, distance * 2, impact
      );
    }

    case "REMOVE_BURST": {
      return { ...state, bursts: state.bursts.filter((b) => b.id !== action.id) };
    }

    case "REMOVE_EFFECT": {
      return { ...state, effects: state.effects.filter((e) => e.id !== action.id) };
    }

    default:
      return state;
  }
}

function MiniPiece({ type }: { type: PieceType }) {
  const matrix = PIECE_DEFS[type].matrix;
  const miniStyle = { "--mini-color": PIECE_DEFS[type].color, "--mini-glow": PIECE_DEFS[type].glow } as CSSProperties;
  return (
    <div className="systris-mini" style={miniStyle}>
      {matrix.map((row, rIndex) => (
        <div className="systris-mini-row" key={`${type}-r-${rIndex}`}>
          {row.map((cell, cIndex) => (
            <span key={`${type}-c-${rIndex}-${cIndex}`} className={`systris-mini-cell${cell ? " is-on" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SysTrisGame() {
  const initialUid = auth.currentUser?.uid ?? null;
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [performanceMode, setPerformanceMode] = useState(() => loadPerformanceMode());
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const latestStateRef = useRef(state);
  const snapshotSaveTimerRef = useRef<number | null>(null);
  const activeUidRef = useRef<string | null>(initialUid);
  const [activeUid, setActiveUid] = useState<string | null>(activeUidRef.current);
  const bestSyncReadyRef = useRef(initialUid === null);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);

  runtimePerfMode = performanceMode;

  useEffect(() => { latestStateRef.current = state; }, [state]);

  useEffect(() => {
    runtimePerfMode = performanceMode;
    savePerformanceMode(performanceMode);
  }, [performanceMode]);

  // ── Auto-commit line clear after animation ──────────────────────────────
  useEffect(() => {
    if (!state.pendingClear) return undefined;
    const timer = window.setTimeout(() => {
      dispatch({ type: "COMMIT_CLEAR" });
    }, CLEAR_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [state.pendingClear]);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      activeUidRef.current = uid;
      setActiveUid(uid);
      bestSyncReadyRef.current = uid === null;
      dispatch({ type: "SYNC_BEST", best: uid ? 0 : loadBest(null) });
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSubmitInFlightRef.current = false;
    });
  }, []);

  useEffect(() => {
    const scoresRef = query(
      collection(db, "scores", "systris", "users"),
      orderBy("score", "desc"),
      limit(8)
    );
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown };
            return { uid: entry.id, score: normalizeScore(data?.score) };
          })
          .filter((row) => row.score > 0)
          .slice(0, 8);
        setLeaderboard(rows);
      },
      (err) => console.warn("systris leaderboard listener failed:", err)
    );
  }, []);

  useEffect(() => {
    if (!activeUid) {
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSyncReadyRef.current = true;
      return undefined;
    }
    const scoreRef = doc(db, "scores", "systris", "users", activeUid);
    return onSnapshot(
      scoreRef,
      (snap) => {
        const dbBest = snap.exists() ? normalizeScore((snap.data() as { score?: unknown })?.score) : 0;
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, dbBest);
        if (pendingBestScoreRef.current <= dbBest) pendingBestScoreRef.current = 0;
        bestSyncReadyRef.current = true;
        dispatch({ type: "SYNC_BEST", best: dbBest });
      },
      (err) => console.warn("systris best score listener failed:", err)
    );
  }, [activeUid]);

  useEffect(() => {
    const uid = activeUidRef.current;
    const safeBest = normalizeScore(state.best);
    if (!bestSyncReadyRef.current) return;
    if (!uid || safeBest <= 0) return;
    if (safeBest <= submittedBestScoreRef.current && safeBest <= pendingBestScoreRef.current) return;
    pendingBestScoreRef.current = Math.max(pendingBestScoreRef.current, safeBest);

    function flushBestScoreUpdate() {
      const targetUid = activeUidRef.current;
      if (!targetUid) { pendingBestScoreRef.current = 0; return; }
      if (bestSubmitInFlightRef.current) return;
      const targetScore = pendingBestScoreRef.current;
      if (targetScore <= submittedBestScoreRef.current) { pendingBestScoreRef.current = 0; return; }
      bestSubmitInFlightRef.current = true;
      submitSysTrisScore(targetUid, targetScore)
        .then(() => {
          submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, targetScore);
          if (pendingBestScoreRef.current <= targetScore) pendingBestScoreRef.current = 0;
        })
        .catch((err) => console.warn("systris best score update failed:", err))
        .finally(() => {
          bestSubmitInFlightRef.current = false;
          if (pendingBestScoreRef.current > submittedBestScoreRef.current) flushBestScoreUpdate();
        });
    }
    flushBestScoreUpdate();
  }, [state.best, activeUid]);

  useEffect(() => {
    try { localStorage.setItem(getBestStorageKey(activeUid), String(state.best)); } catch { /* ignore */ }
  }, [state.best, activeUid]);

  useEffect(() => {
    if (snapshotSaveTimerRef.current) {
      window.clearTimeout(snapshotSaveTimerRef.current);
      snapshotSaveTimerRef.current = null;
    }
    snapshotSaveTimerRef.current = window.setTimeout(() => {
      persistSnapshot(latestStateRef.current, false, activeUidRef.current);
      snapshotSaveTimerRef.current = null;
    }, SNAPSHOT_SAVE_DEBOUNCE_MS);

    return () => {
      if (snapshotSaveTimerRef.current) {
        window.clearTimeout(snapshotSaveTimerRef.current);
        snapshotSaveTimerRef.current = null;
      }
    };
  }, [
    activeUid,
    state.active,
    state.bag,
    state.best,
    state.board,
    state.combo,
    state.fxLabel,
    state.fxPower,
    state.fxPulse,
    state.lastClear,
    state.level,
    state.lines,
    state.message,
    state.pendingClear,
    state.queue,
    state.score,
    state.status,
  ]);

  useEffect(() => {
    const persistPaused = () => persistSnapshot(latestStateRef.current, true, activeUidRef.current);
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") persistPaused(); };
    window.addEventListener("beforeunload", persistPaused);
    window.addEventListener("pagehide", persistPaused);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", persistPaused);
      window.removeEventListener("pagehide", persistPaused);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Tick interval — level controls drop speed
  useEffect(() => {
    if (state.status !== "playing") return undefined;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      dispatch({ type: "TICK" });
    }, getDropDelay(state.level));
    return () => window.clearInterval(timer);
  }, [state.level, state.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const block = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
      switch (event.code) {
        case "ArrowLeft": case "KeyA":   block(); dispatch({ type: "MOVE", delta: -1 }); break;
        case "ArrowRight": case "KeyD":  block(); dispatch({ type: "MOVE", delta: 1 }); break;
        case "ArrowDown": case "KeyS":   block(); dispatch({ type: "SOFT_DROP" }); break;
        case "ArrowUp": case "KeyW": case "KeyX": block(); dispatch({ type: "ROTATE", direction: "CW" }); break;
        case "KeyZ": block(); dispatch({ type: "ROTATE", direction: "CCW" }); break;
        case "Space":  block(); dispatch({ type: "HARD_DROP" }); break;
        case "KeyP":   block(); dispatch({ type: "TOGGLE_PAUSE" }); break;
        case "KeyR":   block(); dispatch({ type: "RESTART" }); break;
        case "Enter":  block(); dispatch({ type: "START" }); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false, capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────

  // When a clear is in progress, show the mergedBoard (full rows visible for dissolve anim)
  const displayBoard = state.pendingClear?.mergedBoard ?? state.board;
  const clearingRowSet = useMemo(
    () => new Set(state.pendingClear?.clearedRows ?? []),
    [state.pendingClear]
  );

  const ghostRow = useMemo(() => {
    if (!state.active) return null;
    return getGhostRow(displayBoard, state.active);
  }, [state.active, displayBoard]);

  const activeCells = useMemo(() => {
    const map = new Map<string, PieceType>();
    if (!state.active) return map;
    for (let r = 0; r < state.active.matrix.length; r += 1) {
      for (let c = 0; c < state.active.matrix[r].length; c += 1) {
        if (state.active.matrix[r][c] === 0) continue;
        const row = state.active.row + r;
        const col = state.active.col + c;
        if (row >= 0 && row < BOARD_HEIGHT && col >= 0 && col < BOARD_WIDTH) {
          map.set(`${row}:${col}`, state.active.type);
        }
      }
    }
    return map;
  }, [state.active]);

  const ghostCells = useMemo(() => {
    const set = new Set<string>();
    if (!state.active || ghostRow === null) return set;
    for (let r = 0; r < state.active.matrix.length; r += 1) {
      for (let c = 0; c < state.active.matrix[r].length; c += 1) {
        if (state.active.matrix[r][c] === 0) continue;
        const row = ghostRow + r;
        const col = state.active.col + c;
        if (row >= 0 && row < BOARD_HEIGHT && col >= 0 && col < BOARD_WIDTH && !displayBoard[row][col]) {
          set.add(`${row}:${col}`);
        }
      }
    }
    return set;
  }, [ghostRow, state.active, displayBoard]);

  const energy = performanceMode
    ? 0.18
    : Math.min(
        1,
        0.15 +
          state.level * 0.06 +
          state.combo * 0.07 +
          state.comboEnergy * 0.16 +
          state.lastClear * 0.1 +
          state.fxPower * 0.14 +
          (state.status === "playing" ? 0.08 : 0)
      );
  const hue = (205 + state.level * 12 + state.lines * 5) % 360;
  const beatMs = performanceMode ? 9999 : Math.max(340, 500 - Math.min(130, state.level * 8 + state.combo * 6));
  const pageStyle = {
    "--systris-energy": energy.toFixed(3),
    "--systris-hue": String(hue),
    "--systris-fx": state.fxPower.toFixed(3),
    "--systris-combo-energy": state.comboEnergy.toFixed(3),
    "--systris-beat-ms": `${beatMs}ms`,
  } as CSSProperties;
  const bgShiftHue = (hue + 34 + state.lastClear * 28 + state.combo * 8) % 360;
  const effectTier = Math.min(4, Math.max(1, Math.round(state.fxPower * 1.18)));
  const topLeaderboardRows = leaderboard.slice(0, 6);
  const podiumSlots = [
    { rank: 2, row: leaderboard[1] ?? null, tone: "silver" as const, height: 94 },
    { rank: 1, row: leaderboard[0] ?? null, tone: "gold" as const, height: 126 },
    { rank: 3, row: leaderboard[2] ?? null, tone: "bronze" as const, height: 78 },
  ];
  const overlayTitle = state.status === "paused" ? "Paused" : state.status === "gameover" ? "System Overflow" : "SysTris";
  const overlayButton = state.status === "paused" ? "Resume" : state.status === "gameover" ? "Restart" : "Start";

  return (
    <main className={`systris-page${performanceMode ? " systris-page--perf" : ""}`} style={pageStyle}>
      <div className="systris-beat-vignette" aria-hidden />
      {!performanceMode && state.clearPulse > 0 && (
        <div
          key={`bg-shift-${state.clearPulse}`}
          className={`systris-bg-shift systris-bg-shift--${Math.max(1, state.lastClear)}`}
          style={{ "--shift-hue": String(bgShiftHue) } as CSSProperties}
          aria-hidden
        />
      )}

      <section className={`systris-shell systris-shell--${state.status}`}>
        <header className="systris-header">
          <h1 className="systris-title">SysTris</h1>
          <p className="systris-subtitle">Tetris Effect style playground</p>
          <button
            type="button"
            className={`systris-perf-toggle${performanceMode ? " is-on" : ""}`}
            onClick={() => setPerformanceMode((value) => !value)}
          >
            {performanceMode ? "Resource Saver: ON" : "Resource Saver: OFF"}
          </button>
        </header>

        <div className="systris-layout">
          <aside className="systris-sidebar">
            <div className="systris-stat">
              <span className="systris-stat-label">Score</span>
              <strong className="systris-stat-value">{state.score.toLocaleString()}</strong>
            </div>
            <div className="systris-stat">
              <span className="systris-stat-label">Best</span>
              <strong className="systris-stat-value">{state.best.toLocaleString()}</strong>
            </div>
            <div className="systris-stat-grid">
              <div className="systris-chip">
                <span>Level</span><strong>{state.level}</strong>
              </div>
              <div className="systris-chip">
                <span>Lines</span><strong>{state.lines}</strong>
              </div>
              <div className="systris-chip">
                <span>Combo</span><strong>x{state.combo}</strong>
              </div>
            </div>

            {/* Combo energy bar */}
            {state.comboEnergy > 0.05 && (
              <div className="systris-combo-bar" aria-hidden>
                <div
                  className="systris-combo-bar-fill"
                  style={{ "--combo-fill": state.comboEnergy / 1.9 } as CSSProperties}
                />
              </div>
            )}

            <section className="systris-next">
              <h2>Next</h2>
              <div className="systris-next-list">
                {state.queue.slice(0, PREVIEW_COUNT).map((type, index) => (
                  <MiniPiece key={`${type}-${index}`} type={type} />
                ))}
              </div>
            </section>
            <p className="systris-message">{state.message}</p>
          </aside>

          <section className="systris-board-wrap">
            {/* Lock flash — new element per lock so animation always retriggers */}
            {!performanceMode && state.lockFlashKey > 0 && (
              <div
                key={`lock-flash-${state.lockFlashKey}`}
                className="systris-lock-flash-overlay"
                aria-hidden
              />
            )}

            {!performanceMode && state.fxPower > 0.46 && state.lastClear === 0 && (
              <div
                key={`shock-${state.fxPulse}`}
                className={`systris-shockwave systris-shockwave--${effectTier}${state.lastClear >= 4 ? " is-mega" : ""}`}
                style={{ "--shock-power": state.fxPower.toFixed(3) } as CSSProperties}
                aria-hidden
              />
            )}

            {!performanceMode && state.status === "playing" && state.fxLabel && state.fxPower > 0.42 && (
              <div
                key={`banner-${state.fxPulse}`}
                className={`systris-action-banner systris-action-banner--${effectTier}`}
                aria-live="polite"
              >
                {state.fxLabel}
              </div>
            )}

            {/* Line flash on clear */}
            {!performanceMode && state.clearPulse > 0 && (
              <div
                key={`lflash-${state.clearPulse}`}
                className={`systris-line-flash systris-line-flash--${Math.min(4, Math.max(1, state.lastClear))}`}
                aria-hidden
              />
            )}

            {!performanceMode && (
              <div className="systris-effects" aria-hidden>
                {state.effects.map((effect) => {
                if (effect.kind === "lock-ring") {
                  const lockStyle = {
                    "--lock-x": `${((effect.x + 0.5) / BOARD_WIDTH) * 100}%`,
                    "--lock-y": `${((effect.y + 0.5) / BOARD_HEIGHT) * 100}%`,
                    "--lock-strength": effect.strength.toFixed(3),
                    "--lock-delay": `${effect.delayMs}ms`,
                  } as CSSProperties;
                  return (
                    <span
                      key={effect.id}
                      className="systris-lock-ring"
                      style={lockStyle}
                      onAnimationEnd={() => dispatch({ type: "REMOVE_EFFECT", id: effect.id })}
                    />
                  );
                }
                if (effect.kind === "row-shard") {
                  const shardStyle = {
                    "--shard-x": `${((effect.col + 0.5) / BOARD_WIDTH) * 100}%`,
                    "--shard-y": `${((effect.row + 0.5) / BOARD_HEIGHT) * 100}%`,
                    "--shard-hue": String(effect.hue),
                    "--shard-strength": effect.strength.toFixed(3),
                    "--shard-drift": String(effect.drift),
                    "--shard-delay": `${effect.delayMs}ms`,
                  } as CSSProperties;
                  return (
                    <span
                      key={effect.id}
                      className="systris-row-shard"
                      style={shardStyle}
                      onAnimationEnd={() => dispatch({ type: "REMOVE_EFFECT", id: effect.id })}
                    />
                  );
                }
                // Trail
                const trailStyle = {
                  "--trail-strength": effect.strength.toFixed(3),
                  "--trail-delay": `${effect.delayMs}ms`,
                } as CSSProperties;
                const trailCells = [];
                for (let r = 0; r < effect.matrix.length; r += 1) {
                  for (let c = 0; c < effect.matrix[r].length; c += 1) {
                    if (!effect.matrix[r][c]) continue;
                    const row = effect.row + r;
                    const col = effect.col + c;
                    if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) continue;
                    trailCells.push(
                      <span
                        key={`${effect.id}-${row}-${col}`}
                        className="systris-trail-cell"
                        style={{
                          "--trail-top": `${(row / BOARD_HEIGHT) * 100}%`,
                          "--trail-left": `${(col / BOARD_WIDTH) * 100}%`,
                          "--trail-color": PIECE_DEFS[effect.type].color,
                          "--trail-glow": PIECE_DEFS[effect.type].glow,
                        } as CSSProperties}
                      />
                    );
                  }
                }
                return (
                  <span
                    key={effect.id}
                    className={`systris-trail systris-trail--${effect.motion}`}
                    style={trailStyle}
                    onAnimationEnd={(event) => {
                      if (event.target !== event.currentTarget) return;
                      dispatch({ type: "REMOVE_EFFECT", id: effect.id });
                    }}
                  >
                    {trailCells}
                  </span>
                );
                })}
              </div>
            )}

            {!performanceMode && (
              <div className="systris-bursts" aria-hidden>
                {state.bursts.map((burst) => (
                  <span
                    key={burst.id}
                    className={`systris-burst systris-burst--${burst.kind}`}
                    style={{
                      "--burst-lane": burst.lane.toFixed(4),
                      "--burst-hue": String(burst.hue),
                      "--burst-strength": burst.strength.toFixed(2),
                      "--burst-delay": `${burst.delayMs}ms`,
                    } as CSSProperties}
                    onAnimationEnd={() => dispatch({ type: "REMOVE_BURST", id: burst.id })}
                  />
                ))}
              </div>
            )}

            {!performanceMode && state.impactPulse > 0 && (
              <div key={`impact-${state.impactPulse}`} className="systris-impact-wave" aria-hidden />
            )}

            <div className="systris-grid" role="grid" aria-label="SysTris board">
              {Array.from({ length: BOARD_HEIGHT }, (_, row) =>
                Array.from({ length: BOARD_WIDTH }, (_, col) => {
                  const key = `${row}:${col}`;
                  const isClearing = clearingRowSet.has(row);
                  const lockedType = displayBoard[row][col];
                  const activeType = activeCells.get(key);
                  const type = activeType ?? lockedType;
                  const isGhost = !type && ghostCells.has(key);

                  const cellStyle = type
                    ? ({
                        "--cell-color": PIECE_DEFS[type].color,
                        "--cell-glow": PIECE_DEFS[type].glow,
                        // staggered dissolve delay: center-out (columns 0–9, centre ~4.5)
                        ...(isClearing && {
                          "--clear-delay": `${Math.abs(col - 4.5) * 16}ms`,
                        }),
                      } as CSSProperties)
                    : isGhost && state.active
                      ? ({
                          "--cell-color": PIECE_DEFS[state.active.type].color,
                          "--cell-glow": PIECE_DEFS[state.active.type].glow,
                        } as CSSProperties)
                      : undefined;

                  const classes = [
                    "systris-cell",
                    type && "is-filled",
                    activeType && "is-active",
                    isGhost && "is-ghost",
                    isClearing && type && "is-clearing",
                  ].filter(Boolean).join(" ");

                  return <div key={key} className={classes} style={cellStyle} />;
                })
              )}
            </div>

            {(state.status === "ready" || state.status === "paused" || state.status === "gameover") && (
              <div className="systris-overlay">
                <h2>{overlayTitle}</h2>
                <p>Use keyboard controls to move and drop.</p>
                <button type="button" onClick={() => dispatch({ type: "START" })}>
                  {overlayButton}
                </button>
              </div>
            )}
          </section>

          <aside className="systris-leaderboard" aria-label="SysTris leaderboard">
            <div className="systris-leaderboard-head">
              <h2>Leaderboard</h2>
              <span className="systris-leaderboard-badge">Best score</span>
            </div>
            <div className="systris-leaderboard-best">
              <span>Your Best</span>
              <strong>{state.best.toLocaleString()}</strong>
            </div>
            <div className="systris-leaderboard-list">
              {topLeaderboardRows.length === 0 ? (
                <p className="systris-leaderboard-empty">No scores yet. Play to claim rank #1.</p>
              ) : (
                topLeaderboardRows.map((row, index) => (
                  <div
                    key={`${row.uid}-${index}`}
                    className={`systris-leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}
                  >
                    <span className="systris-leaderboard-rank">{index + 1}</span>
                    <div className="systris-leaderboard-user"><UserBox userId={row.uid} /></div>
                    <strong className="systris-leaderboard-score">{row.score.toLocaleString()}</strong>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        <section className="systris-howto" aria-label="How to play">
          <h2>How To Play</h2>
          <div className="systris-howto-list">
            <article className="systris-howto-item">
              <span className="systris-howto-icon">◀ ▶</span>
              <p>Arrow keys: move left/right</p>
            </article>
            <article className="systris-howto-item">
              <span className="systris-howto-icon">⟳</span>
              <p>Up arrow: rotate</p>
            </article>
            <article className="systris-howto-item">
              <span className="systris-howto-icon">▼</span>
              <p>Down arrow: soft drop</p>
            </article>
            <article className="systris-howto-item">
              <span className="systris-howto-icon">⤓</span>
              <p>Space: hard drop</p>
            </article>
            <article className="systris-howto-item">
              <span className="systris-howto-icon">P</span>
              <p>P: pause</p>
            </article>
          </div>
        </section>

        <section className="systris-podium-shell" aria-label="SysTris podium">
          <div className="systris-podium-head">
            <h2>Podium</h2>
            <span>All-time top 3</span>
          </div>
          {topLeaderboardRows.length === 0 ? (
            <p className="systris-podium-empty">No scores yet. Be the first on the podium.</p>
          ) : (
            <div className="systris-podium">
              {podiumSlots.map((slot) => (
                <article key={slot.rank} className={`systris-podium-slot systris-podium-slot--${slot.tone}`}>
                  <div className="systris-podium-user">
                    {slot.row ? <UserBox userId={slot.row.uid} /> : <span>Waiting...</span>}
                  </div>
                  <div className="systris-podium-pillar" style={{ height: `${slot.height}px` }}>
                    <strong>#{slot.rank}</strong>
                    <span>{slot.row ? slot.row.score.toLocaleString() : "0"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
