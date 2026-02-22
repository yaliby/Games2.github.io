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
const SAVE_KEY_PREFIX = "systris_save_classic_v1";
const SNAPSHOT_SAVE_DEBOUNCE_MS = 420;

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Matrix = number[][];
type BoardCell = PieceType | null;
type Board = BoardCell[][];
type Status = "ready" | "playing" | "paused" | "gameover";
type RotationDirection = "CW" | "CCW";

interface PieceDef {
  matrix: Matrix;
  color: string;
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

interface GameState {
  board: Board;
  active: ActivePiece | null;
  queue: PieceType[];
  bag: PieceType[];
  status: Status;
  score: number;
  lines: number;
  level: number;
  best: number;
  message: string;
}

type SavedSysTrisClassic = {
  v: 1;
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
  | { type: "TOGGLE_PAUSE" };

const PIECE_ORDER: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];
const LINE_POINTS = [0, 100, 300, 500, 800] as const; // classic-ish scoring per level

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
  I: { matrix: [[1, 1, 1, 1]], color: "#36f5ff" },
  O: { matrix: [[1, 1], [1, 1]], color: "#fff765" },
  T: { matrix: [[0, 1, 0], [1, 1, 1]], color: "#bd72ff" },
  S: { matrix: [[0, 1, 1], [1, 1, 0]], color: "#5ef79a" },
  Z: { matrix: [[1, 1, 0], [0, 1, 1]], color: "#ff6d8f" },
  J: { matrix: [[1, 0, 0], [1, 1, 1]], color: "#71a3ff" },
  L: { matrix: [[0, 0, 1], [1, 1, 1]], color: "#ffb45f" },
};

function isPieceType(value: unknown): value is PieceType {
  return typeof value === "string" && value in PIECE_DEFS;
}

function normalizeStatus(value: unknown): Status {
  if (value === "ready" || value === "playing" || value === "paused" || value === "gameover") return value;
  return "ready";
}

function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<BoardCell>(BOARD_WIDTH).fill(null));
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

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
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
    if (y >= 0 && y < matrix.length && x >= 0 && x < matrix[0].length) matrix[y][x] = 1;
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
  if (Number.isFinite(explicitRotation)) return positiveMod(Math.round(explicitRotation), rotationDef.stateCount);
  for (let i = 0; i < rotationDef.stateCount; i += 1) {
    if (isSameMatrix(rotationDef.states[i].matrix, matrix)) return i;
  }
  return 0;
}

function normalizeActivePiece(raw: unknown): ActivePiece | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ActivePiece>;
  if (!isPieceType(candidate.type)) return null;
  if (!Array.isArray(candidate.matrix)) return null;
  const rawMatrix = candidate.matrix.map((row) => (Array.isArray(row) ? row.map((cell) => (cell ? 1 : 0)) : []));
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

function mergePiece(board: Board, piece: ActivePiece): Board {
  const next = board.map((row) => [...row]);
  for (let r = 0; r < piece.matrix.length; r += 1) {
    for (let c = 0; c < piece.matrix[r].length; c += 1) {
      if (piece.matrix[r][c] === 0) continue;
      const br = piece.row + r;
      const bc = piece.col + c;
      if (br >= 0 && br < BOARD_HEIGHT && bc >= 0 && bc < BOARD_WIDTH) next[br][bc] = piece.type;
    }
  }
  return next;
}

function clearFullLines(board: Board) {
  const kept: Board = [];
  let cleared = 0;

  for (let rowIndex = 0; rowIndex < board.length; rowIndex += 1) {
    const row = board[rowIndex];
    const isFull = row.every((cell) => Boolean(cell));
    if (!isFull) kept.push(row);
    else cleared += 1;
  }

  while (kept.length < BOARD_HEIGHT) kept.unshift(Array<BoardCell>(BOARD_WIDTH).fill(null));
  return { board: kept, cleared };
}

function getLevel(lines: number): number {
  return Math.floor(lines / 10) + 1;
}

function getDropDelay(level: number): number {
  return Math.max(90, 760 - (level - 1) * 55);
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
  } catch {
    return 0;
  }
}

function loadSavedState(best: number, uid: string | null): GameState | null {
  try {
    const raw = localStorage.getItem(getSaveStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSysTrisClassic;
    if (!parsed || parsed.v !== 1 || !parsed.state) return null;

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
      best: rebuiltBest,
      message: status === "paused" ? "Paused" : typeof saved.message === "string" ? saved.message : "Press Start",
    };
  } catch {
    return null;
  }
}

function buildSnapshot(state: GameState, pauseIfPlaying: boolean): SavedSysTrisClassic {
  const status: Status = pauseIfPlaying && state.status === "playing" ? "paused" : state.status;
  const message = pauseIfPlaying && state.status === "playing" ? "Paused" : state.message;
  return {
    v: 1,
    state: {
      board: state.board,
      active: state.active,
      queue: state.queue,
      bag: state.bag,
      status,
      score: state.score,
      lines: state.lines,
      level: state.level,
      best: state.best,
      message,
    },
  };
}

function persistSnapshot(state: GameState, pauseIfPlaying: boolean, uid: string | null) {
  try {
    const snapshot = buildSnapshot(state, pauseIfPlaying);
    localStorage.setItem(getSaveStorageKey(uid), JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

function settlePiece(state: GameState, piece: ActivePiece, extraScore: number): GameState {
  const mergedBoard = mergePiece(state.board, piece);
  const clearedResult = clearFullLines(mergedBoard);
  const cleared = clearedResult.cleared;

  const nextLines = state.lines + cleared;
  const nextLevel = getLevel(nextLines);

  const lineScore = LINE_POINTS[cleared] * state.level;
  const nextScore = state.score + extraScore + lineScore;
  const nextBest = Math.max(state.best, nextScore);

  const spawned = spawnPiece(state.queue, state.bag);
  const blocked = collides(clearedResult.board, spawned.piece.matrix, spawned.piece.row, spawned.piece.col);

  if (blocked) {
    return {
      ...state,
      board: clearedResult.board,
      active: null,
      queue: spawned.queue,
      bag: spawned.bag,
      score: nextScore,
      lines: nextLines,
      level: nextLevel,
      best: nextBest,
      status: "gameover",
      message: "Game Over",
    };
  }

  return {
    ...state,
    board: clearedResult.board,
    active: spawned.piece,
    queue: spawned.queue,
    bag: spawned.bag,
    score: nextScore,
    lines: nextLines,
    level: nextLevel,
    best: nextBest,
    message: cleared > 0 ? (cleared === 4 ? "TETRIS!" : `Cleared ${cleared}`) : "",
  };
}

function createRun(best: number, status: Status): GameState {
  const spawned = spawnPiece([], []);
  return {
    board: createEmptyBoard(),
    active: spawned.piece,
    queue: spawned.queue,
    bag: spawned.bag,
    status,
    score: 0,
    lines: 0,
    level: 1,
    best,
    message: status === "ready" ? "Press Start" : "",
  };
}

function createInitialState(): GameState {
  const uid = auth.currentUser?.uid ?? null;
  const best = uid ? 0 : loadBest(null);
  const saved = loadSavedState(best, uid);
  if (saved) return saved;
  return createRun(best, "ready");
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
      if (state.status === "paused") return { ...state, status: "playing", message: "" };
      return state;
    }

    case "RESTART": {
      return createRun(state.best, "playing");
    }

    case "TOGGLE_PAUSE": {
      if (state.status === "playing") return { ...state, status: "paused", message: "Paused" };
      if (state.status === "paused") return { ...state, status: "playing", message: "" };
      return state;
    }

    case "TICK": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, row: state.active.row + 1 };
      if (!collides(state.board, moved.matrix, moved.row, moved.col)) {
        return { ...state, active: moved };
      }
      return settlePiece(state, state.active, 0);
    }

    case "MOVE": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, col: state.active.col + action.delta };
      if (collides(state.board, moved.matrix, moved.row, moved.col)) return state;
      return { ...state, active: moved };
    }

    case "ROTATE": {
      if (state.status !== "playing" || !state.active) return state;
      const rotated = attemptRotate(state.board, state.active, action.direction ?? "CW");
      if (!rotated) return state;
      if (
        rotated.row === state.active.row &&
        rotated.col === state.active.col &&
        rotated.rotation === state.active.rotation
      ) {
        return state;
      }
      return { ...state, active: rotated };
    }

    case "SOFT_DROP": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, row: state.active.row + 1 };
      if (!collides(state.board, moved.matrix, moved.row, moved.col)) {
        const nextScore = state.score + 1;
        return { ...state, active: moved, score: nextScore, best: Math.max(state.best, nextScore) };
      }
      return settlePiece(state, state.active, 0);
    }

    case "HARD_DROP": {
      if (state.status !== "playing" || !state.active) return state;
      let row = state.active.row;
      while (!collides(state.board, state.active.matrix, row + 1, state.active.col)) row += 1;
      const distance = row - state.active.row;
      const dropped: ActivePiece = { ...state.active, row };
      return settlePiece(state, dropped, distance * 2);
    }

    default:
      return state;
  }
}

function MiniPiece({ type }: { type: PieceType }) {
  const matrix = PIECE_DEFS[type].matrix;
  const miniStyle = { "--mini-color": PIECE_DEFS[type].color } as CSSProperties;
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

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const latestStateRef = useRef(state);
  const snapshotSaveTimerRef = useRef<number | null>(null);

  const activeUidRef = useRef<string | null>(initialUid);
  const [activeUid, setActiveUid] = useState<string | null>(activeUidRef.current);

  const bestSyncReadyRef = useRef(initialUid === null);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

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
    try {
      localStorage.setItem(getBestStorageKey(activeUid), String(state.best));
    } catch {
      /* ignore */
    }
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
  }, [activeUid, state.active, state.bag, state.best, state.board, state.level, state.lines, state.message, state.queue, state.score, state.status]);

  useEffect(() => {
    const persistPaused = () => persistSnapshot(latestStateRef.current, true, activeUidRef.current);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistPaused();
    };
    window.addEventListener("beforeunload", persistPaused);
    window.addEventListener("pagehide", persistPaused);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", persistPaused);
      window.removeEventListener("pagehide", persistPaused);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

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

      const block = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      };

      switch (event.code) {
        case "ArrowLeft":
        case "KeyA":
          block();
          dispatch({ type: "MOVE", delta: -1 });
          break;
        case "ArrowRight":
        case "KeyD":
          block();
          dispatch({ type: "MOVE", delta: 1 });
          break;
        case "ArrowDown":
        case "KeyS":
          block();
          dispatch({ type: "SOFT_DROP" });
          break;
        case "ArrowUp":
        case "KeyW":
        case "KeyX":
          block();
          dispatch({ type: "ROTATE", direction: "CW" });
          break;
        case "KeyZ":
          block();
          dispatch({ type: "ROTATE", direction: "CCW" });
          break;
        case "Space":
          block();
          dispatch({ type: "HARD_DROP" });
          break;
        case "KeyP":
          block();
          dispatch({ type: "TOGGLE_PAUSE" });
          break;
        case "KeyR":
          block();
          dispatch({ type: "RESTART" });
          break;
        case "Enter":
          block();
          dispatch({ type: "START" });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false, capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const activeCells = useMemo(() => {
    const map = new Map<string, PieceType>();
    if (!state.active) return map;
    for (let r = 0; r < state.active.matrix.length; r += 1) {
      for (let c = 0; c < state.active.matrix[r].length; c += 1) {
        if (state.active.matrix[r][c] === 0) continue;
        const row = state.active.row + r;
        const col = state.active.col + c;
        if (row >= 0 && row < BOARD_HEIGHT && col >= 0 && col < BOARD_WIDTH) map.set(`${row}:${col}`, state.active.type);
      }
    }
    return map;
  }, [state.active]);

  const topLeaderboardRows = leaderboard.slice(0, 6);
  const podiumSlots = [
    { rank: 2, row: leaderboard[1] ?? null, tone: "silver" as const, height: 94 },
    { rank: 1, row: leaderboard[0] ?? null, tone: "gold" as const, height: 126 },
    { rank: 3, row: leaderboard[2] ?? null, tone: "bronze" as const, height: 78 },
  ];

  const overlayTitle = state.status === "paused" ? "Paused" : state.status === "gameover" ? "Game Over" : "SysTris";
  const overlayButton = state.status === "paused" ? "Resume" : state.status === "gameover" ? "Restart" : "Start";

  return (
    <main className="systris-page">
      <section className={`systris-shell systris-shell--${state.status}`}>
        <header className="systris-header">
          <h1 className="systris-title">SysTris</h1>
          <p className="systris-subtitle">Classic Tetris</p>
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
                <span>Level</span>
                <strong>{state.level}</strong>
              </div>
              <div className="systris-chip">
                <span>Lines</span>
                <strong>{state.lines}</strong>
              </div>
            </div>

            <section className="systris-next">
              <h2>Next</h2>
              <div className="systris-next-list">
                {state.queue.slice(0, PREVIEW_COUNT).map((type, index) => (
                  <MiniPiece key={`${type}-${index}`} type={type} />
                ))}
              </div>
            </section>

            {state.message ? <p className="systris-message">{state.message}</p> : null}
          </aside>

          <section className="systris-board-wrap">
            <div className="systris-grid" role="grid" aria-label="SysTris board">
              {Array.from({ length: BOARD_HEIGHT }, (_, row) =>
                Array.from({ length: BOARD_WIDTH }, (_, col) => {
                  const key = `${row}:${col}`;
                  const lockedType = state.board[row][col];
                  const activeType = activeCells.get(key);
                  const type = activeType ?? lockedType;

                  const cellStyle = type
                    ? ({ "--cell-color": PIECE_DEFS[type].color } as CSSProperties)
                    : undefined;

                  const classes = [
                    "systris-cell",
                    type && "is-filled",
                    activeType && "is-active",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return <div key={key} className={classes} style={cellStyle} />;
                })
              )}
            </div>

            {(state.status === "ready" || state.status === "paused" || state.status === "gameover") && (
              <div className="systris-overlay">
                <h2>{overlayTitle}</h2>
                <p>Arrows: move/rotate • Down: soft drop • Space: hard drop • P: pause</p>
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
                <p className="systris-leaderboard-empty">No scores yet.</p>
              ) : (
                topLeaderboardRows.map((row, index) => (
                  <div
                    key={`${row.uid}-${index}`}
                    className={`systris-leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}
                  >
                    <span className="systris-leaderboard-rank">{index + 1}</span>
                    <div className="systris-leaderboard-user">
                      <UserBox userId={row.uid} />
                    </div>
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
            <p className="systris-podium-empty">No scores yet.</p>
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
