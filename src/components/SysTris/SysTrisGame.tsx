import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import UserBox from "../UserBox/UserBox";
import { auth, db } from "../../services/firebase";
import { submitSysTrisScore } from "../../services/scoreService";
import "./SysTrisGame.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const W = 10;
const H = 20;
const BEST_KEY = "systris_best_basic_v3";
const SAVE_KEY = "systris_save_v1";
const LINE_POINTS = [0, 100, 300, 500, 800] as const;
const SOFT_DROP_INTERVAL_MS = 40;
const DAS_DELAY_MS = 110;   // Delayed Auto Shift – delay before repeat
const DAS_REPEAT_MS  = 40;  // DAS repeat rate (faster = more responsive)
const PAUSE_COOLDOWN_MS = 3000;
const SAVE_THROTTLE_MS = 220;
const SAVE_THROTTLE_PLAYING_MS = 900;
const RAF_DISPATCH_MIN_MS = 20;

const HELP = [
  "Arrow keys: move left/right",
  "Up arrow / W / X: rotate",
  "Down arrow / S: soft drop",
  "Space: hard drop",
  "P: pause / R: restart",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
type Piece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = Piece | null;
type Board = Cell[][];
type Status = "ready" | "playing" | "paused" | "gameover";
type LeaderboardRow = { uid: string; score: number };
type GridPoint = { r: number; c: number };

type Active = { type: Piece; shape: number[][]; row: number; col: number };

type State = {
  board: Board;
  active: Active | null;
  next: Piece;
  status: Status;
  score: number;
  lines: number;
  level: number;
  best: number;
  // Gravity accumulator: when >= 1 the piece drops one row.
  // We drive gravity via requestAnimationFrame instead of setInterval
  // so soft-drop and normal gravity never double-fire.
  lockDelay: number; // ms remaining before forced lock (0 = not touching floor)
  gravityMs: number;
  softDropMs: number;
};

type Action =
  | { type: "START" }
  | { type: "RESTART" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "TICK"; dt: number }   // dt = elapsed ms since last tick
  | { type: "MOVE"; dx: -1 | 1 }
  | { type: "ROTATE" }
  | { type: "SOFT_DROP"; dt: number }
  | { type: "HARD_DROP" };

// ─── Piece data ───────────────────────────────────────────────────────────────
const PIECES: Record<Piece, { shape: number[][]; color: string }> = {
  I: { shape: [[1, 1, 1, 1]],             color: "#34ebff" },
  O: { shape: [[1, 1], [1, 1]],           color: "#ffe86a" },
  T: { shape: [[0, 1, 0], [1, 1, 1]],    color: "#b679ff" },
  S: { shape: [[0, 1, 1], [1, 1, 0]],    color: "#5ef68e" },
  Z: { shape: [[1, 1, 0], [0, 1, 1]],    color: "#ff6b8f" },
  J: { shape: [[1, 0, 0], [1, 1, 1]],    color: "#78a8ff" },
  L: { shape: [[0, 0, 1], [1, 1, 1]],    color: "#ffb468" },
};

const PIECE_KEYS = Object.keys(PIECES) as Piece[];
const STATUSES: Status[] = ["ready", "playing", "paused", "gameover"];

// Lock-delay window in ms – piece locks 500 ms after it first touches the floor
const LOCK_DELAY_MS = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isPiece(v: unknown): v is Piece {
  return typeof v === "string" && PIECE_KEYS.includes(v as Piece);
}

function emptyBoard(): Board {
  return Array.from({ length: H }, () => Array<Cell>(W).fill(null));
}

function cloneShape(s: number[][]): number[][] {
  return s.map((r) => [...r]);
}

function randomPiece(): Piece {
  return PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
}

function spawn(type: Piece): Active {
  const shape = cloneShape(PIECES[type].shape);
  return { type, shape, row: -1, col: Math.floor((W - shape[0].length) / 2) };
}

function rotateCW(shape: number[][]): number[][] {
  const h = shape.length, w = shape[0].length;
  const next = Array.from({ length: w }, () => Array<number>(h).fill(0));
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) next[c][h - 1 - r] = shape[r][c];
  return next;
}

function collides(board: Board, shape: number[][], row: number, col: number): boolean {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const y = row + r, x = col + c;
      if (x < 0 || x >= W || y >= H) return true;
      if (y >= 0 && board[y][x]) return true;
    }
  }
  return false;
}

function merge(board: Board, active: Active): Board {
  const next = board.map((r) => [...r]);
  for (let r = 0; r < active.shape.length; r++) {
    for (let c = 0; c < active.shape[r].length; c++) {
      if (!active.shape[r][c]) continue;
      const y = active.row + r, x = active.col + c;
      if (y >= 0 && y < H && x >= 0 && x < W) next[y][x] = active.type;
    }
  }
  return next;
}

function clearLines(board: Board): { board: Board; cleared: number } {
  const kept = board.filter((row) => row.some((cell) => !cell));
  const cleared = H - kept.length;
  while (kept.length < H) kept.unshift(Array<Cell>(W).fill(null));
  return { board: kept, cleared };
}

function levelFromLines(lines: number): number {
  return Math.floor(lines / 10) + 1;
}

/** Normal gravity interval (ms), rises slowly by score and mildly by level. */
function tickMs(level: number, score: number): number {
  const base = 860;
  const levelDrop = Math.max(0, level - 1) * 20;
  const scoreDrop = Math.min(Math.floor(Math.max(0, score) / 2200) * 7, 210);
  return Math.max(110, base - levelDrop - scoreDrop);
}

// ─── LocalStorage ─────────────────────────────────────────────────────────────
function readBest(): number {
  try {
    const raw = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch { return 0; }
}

function normalizeInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function parseMatrix(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (width <= 0 || width > 4) return null;
  const matrix: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== width) return null;
    matrix.push(row.map((cell) => (Number(cell) ? 1 : 0)));
  }
  return matrix;
}

function parseBoard(value: unknown): Board | null {
  if (!Array.isArray(value) || value.length !== H) return null;
  const board: Board = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== W) return null;
    const parsedRow: Cell[] = [];
    for (const cell of row) {
      if (cell === null) { parsedRow.push(null); continue; }
      if (!isPiece(cell)) return null;
      parsedRow.push(cell);
    }
    board.push(parsedRow);
  }
  return board;
}

function parseActive(value: unknown): Active | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Active>;
  if (!isPiece(candidate.type)) return null;
  const shape = parseMatrix(candidate.shape);
  const row = Number(candidate.row), col = Number(candidate.col);
  if (!shape || !Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { type: candidate.type, shape, row: Math.floor(row), col: Math.floor(col) };
}

function readSavedState(bestFallback: number): State | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<State>;
    const board = parseBoard(parsed.board);
    if (!board) return null;
    const active = parseActive(parsed.active);
    const next = isPiece(parsed.next) ? parsed.next : randomPiece();
    const status = STATUSES.includes(parsed.status as Status) ? (parsed.status as Status) : "ready";
    const lines = normalizeInt(parsed.lines);
    const score = normalizeInt(parsed.score);
    const level = Math.max(1, Number.isFinite(Number(parsed.level)) ? Math.floor(Number(parsed.level)) : levelFromLines(lines));
    const best = Math.max(bestFallback, normalizeInt(parsed.best), score);
    let resolvedStatus = status;
    if (resolvedStatus === "playing") resolvedStatus = "paused";
    if (!active && resolvedStatus === "paused") resolvedStatus = "ready";
    return { board, active, next, status: resolvedStatus, score, lines, level, best, lockDelay: 0, gravityMs: 0, softDropMs: 0 };
  } catch { return null; }
}

function saveRunState(state: State): void {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { }
}

function saveBest(score: number): void {
  try { window.localStorage.setItem(BEST_KEY, String(score)); } catch { }
}

// ─── State management ─────────────────────────────────────────────────────────
function newRun(best: number, status: Status): State {
  const first = randomPiece();
  return {
    board: emptyBoard(),
    active: spawn(first),
    next: randomPiece(),
    status,
    score: 0,
    lines: 0,
    level: 1,
    best,
    lockDelay: 0,
    gravityMs: 0,
    softDropMs: 0,
  };
}

function initState(): State {
  const best = readBest();
  return readSavedState(best) ?? newRun(best, "ready");
}

function lockActive(state: State, dropBonus = 0): State {
  if (!state.active) return state;
  const merged = merge(state.board, state.active);
  const { board, cleared } = clearLines(merged);
  const lines = state.lines + cleared;
  const level = levelFromLines(lines);
  const score = state.score + LINE_POINTS[cleared as 0 | 1 | 2 | 3 | 4] * state.level + dropBonus;
  const best = Math.max(state.best, score);
  const nextActive = spawn(state.next);
  if (collides(board, nextActive.shape, nextActive.row, nextActive.col)) {
    return { ...state, board, active: null, status: "gameover", score, lines, level, best, lockDelay: 0, gravityMs: 0, softDropMs: 0 };
  }
  return { ...state, board, active: nextActive, next: randomPiece(), score, lines, level, best, lockDelay: 0, gravityMs: 0, softDropMs: 0 };
}

/**
 * Core gravity step.
 * dt        – elapsed ms since last frame
 * softDrop  – player is holding soft-drop
 *
 * Strategy: we accumulate gravity as fractional rows. When the piece
 * touches the floor we start the lock-delay clock instead of locking
 * immediately – this gives the player time to slide/rotate before it locks.
 */
function applyGravity(state: State, dt: number, softDrop: boolean): State {
  if (state.status !== "playing" || !state.active) return state;

  const interval = softDrop ? SOFT_DROP_INTERVAL_MS : tickMs(state.level, state.score);
  const accumulated = (softDrop ? state.softDropMs : state.gravityMs) + dt;
  const steps = Math.floor(accumulated / interval);
  const nextCarry = accumulated - steps * interval;
  const base = softDrop
    ? { ...state, softDropMs: nextCarry, gravityMs: 0 }
    : { ...state, gravityMs: nextCarry, softDropMs: 0 };

  if (steps <= 0) {
    // No full step yet – but check if on floor and update lock-delay
    const onFloor = collides(state.board, state.active.shape, state.active.row + 1, state.active.col);
    if (onFloor) {
      const newLockDelay = state.lockDelay + dt;
      if (newLockDelay >= LOCK_DELAY_MS) return lockActive(base, softDrop ? 1 : 0);
      return { ...base, lockDelay: newLockDelay };
    }
    return { ...base, lockDelay: 0 };
  }

  let cur = state.active;
  let bonus = 0;
  for (let i = 0; i < steps; i++) {
    const next = { ...cur, row: cur.row + 1 };
    if (collides(state.board, next.shape, next.row, next.col)) {
      // Hit the floor – start/continue lock delay
      const newLockDelay = state.lockDelay + dt;
      if (newLockDelay >= LOCK_DELAY_MS) {
        return lockActive({ ...base, active: cur, lockDelay: 0 }, bonus);
      }
      return { ...base, active: cur, lockDelay: newLockDelay };
    }
    cur = next;
    if (softDrop) bonus++;
  }

  const score = state.score + bonus;
  return { ...base, active: cur, lockDelay: 0, score, best: Math.max(state.best, score) };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      if (state.status === "paused") return { ...state, status: "playing" };
      if (state.status === "ready" || state.status === "gameover") return newRun(state.best, "playing");
      return state;

    case "RESTART":
      return newRun(state.best, "playing");

    case "TOGGLE_PAUSE":
      if (state.status === "playing") return { ...state, status: "paused" };
      if (state.status === "paused") return { ...state, status: "playing" };
      return state;

    case "TICK":
      return applyGravity(state, action.dt, false);

    case "SOFT_DROP":
      return applyGravity(state, action.dt, true);

    case "MOVE": {
      if (state.status !== "playing" || !state.active) return state;
      const newCol = state.active.col + action.dx;
      if (collides(state.board, state.active.shape, state.active.row, newCol)) return state;
      const moved = { ...state.active, col: newCol };
      const grounded = collides(state.board, moved.shape, moved.row + 1, moved.col);
      // Prevent infinite spin/slide stalling: if piece is grounded, keep lock timer running.
      return { ...state, active: moved, lockDelay: grounded ? state.lockDelay : 0 };
    }

    case "ROTATE": {
      if (state.status !== "playing" || !state.active) return state;
      const rotated = rotateCW(state.active.shape);
      const kicks = [0, -1, 1, -2, 2];
      for (const kick of kicks) {
        const newCol = state.active.col + kick;
        if (!collides(state.board, rotated, state.active.row, newCol)) {
          const moved = { ...state.active, shape: rotated, col: newCol };
          const grounded = collides(state.board, moved.shape, moved.row + 1, moved.col);
          return { ...state, active: moved, lockDelay: grounded ? state.lockDelay : 0 };
        }
      }
      return state;
    }

    case "HARD_DROP": {
      if (state.status !== "playing" || !state.active) return state;
      let row = state.active.row;
      while (!collides(state.board, state.active.shape, row + 1, state.active.col)) row++;
      const distance = row - state.active.row;
      return lockActive({ ...state, active: { ...state.active, row }, lockDelay: 0 }, distance * 2);
    }

    default:
      return state;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return ["input", "textarea", "select", "button"].includes(tag) || target.isContentEditable;
}

function getGhostRow(board: Board, active: Active): number {
  let row = active.row;
  while (!collides(board, active.shape, row + 1, active.col)) row++;
  return row;
}

function normalizeScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function isSoftDropKey(code: string): boolean { return code === "ArrowDown" || code === "KeyS"; }
function isLeftKey(code: string): boolean     { return code === "ArrowLeft"  || code === "KeyA"; }
function isRightKey(code: string): boolean    { return code === "ArrowRight" || code === "KeyD"; }

// ─── Derived display data ─────────────────────────────────────────────────────
function getActiveCells(active: Active | null): Array<GridPoint & { type: Piece }> {
  if (!active) return [];
  const cells: Array<GridPoint & { type: Piece }> = [];
  for (let r = 0; r < active.shape.length; r++) {
    for (let c = 0; c < active.shape[r].length; c++) {
      if (!active.shape[r][c]) continue;
      const y = active.row + r, x = active.col + c;
      if (y >= 0 && y < H && x >= 0 && x < W) cells.push({ r: y, c: x, type: active.type });
    }
  }
  return cells;
}

function getGhostCells(board: Board, active: Active | null): GridPoint[] {
  if (!active) return [];
  const ghostRow = getGhostRow(board, active);
  if (ghostRow === active.row) return []; // already on floor – don't draw ghost over active
  const cells: GridPoint[] = [];
  for (let r = 0; r < active.shape.length; r++) {
    for (let c = 0; c < active.shape[r].length; c++) {
      if (!active.shape[r][c]) continue;
      const y = ghostRow + r, x = active.col + c;
      if (y >= 0 && y < H && x >= 0 && x < W && !board[y][x]) cells.push({ r: y, c: x });
    }
  }
  return cells;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
const StaticBoardCells = memo(function StaticBoardCells({ board }: { board: Board }) {
  // Keep static cells in fixed grid coordinates to avoid auto-placement shifts
  // when ghost/active overlay cells are rendered with explicit row/column.
  return (
    <>
      {board.map((row, r) =>
        row.map((cell, c) => (
          <div
            key={`${r}:${c}`}
            className="systris-cell systris-cell--static"
            style={
              cell
                ? { gridRow: r + 1, gridColumn: c + 1, background: PIECES[cell].color }
                : { gridRow: r + 1, gridColumn: c + 1 }
            }
          />
        ))
      )}
    </>
  );
});

const PauseCooldownIndicator = memo(function PauseCooldownIndicator({
  cooldownUntil,
  onDone,
}: {
  cooldownUntil: number;
  onDone: () => void;
}) {
  const textRef = useRef<HTMLElement | null>(null);
  const fillRef = useRef<HTMLElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    let raf = 0;
    let lastTextUpdate = 0;

    const tick = () => {
      const now = Date.now();
      const left = cooldownUntil - now;
      if (left <= 0) {
        if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
        if (textRef.current) textRef.current.textContent = "0.0s";
        if (!doneRef.current) { doneRef.current = true; onDone(); }
        return;
      }
      const ratio = Math.max(0, Math.min(1, left / PAUSE_COOLDOWN_MS));
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`;
      if (now - lastTextUpdate > 80) {
        if (textRef.current) textRef.current.textContent = `${(left / 1000).toFixed(1)}s`;
        lastTextUpdate = now;
      }
      raf = window.requestAnimationFrame(tick);
    };

    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [cooldownUntil, onDone]);

  return (
    <div className="systris-pause-lock" role="status" aria-live="polite">
      <div className="systris-pause-lock-head">
        <span>Pause cooldown</span>
        <strong ref={textRef}>3.0s</strong>
      </div>
      <div className="systris-pause-lock-track">
        <i ref={fillRef} style={{ transform: "scaleX(1)" }} />
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────
export default function SysTrisGame() {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const [activeUid, setActiveUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [pauseCooldownUntil, setPauseCooldownUntil] = useState(0);

  // Refs that survive renders without causing them
  const submittedBestRef    = useRef(0);
  const statusRef           = useRef<Status>(state.status);
  const softDropHeldRef     = useRef(false);
  const leftHeldRef         = useRef(false);
  const rightHeldRef        = useRef(false);
  const pauseCooldownRef    = useRef(0);
  const lastSaveRef         = useRef(0);
  const saveTimerRef        = useRef<number | null>(null);

  // ── rAF-based game loop ──────────────────────────────────────────────────
  // A single requestAnimationFrame loop drives ALL time-based mechanics:
  //   - Normal gravity (TICK)
  //   - Soft-drop gravity (SOFT_DROP)
  // This prevents setInterval drift and the classic "double-drop" bug where
  // an interval fires while another interval is already in flight.
  const lastFrameRef = useRef<number | null>(null);
  const pendingFrameDtRef = useRef(0);

  useEffect(() => {
    if (state.status !== "playing") {
      lastFrameRef.current = null;
      pendingFrameDtRef.current = 0;
      return;
    }

    let rafId = 0;

    const loop = (ts: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = ts;
      const dt = Math.min(ts - lastFrameRef.current, 150); // cap at 150 ms to avoid huge jumps
      lastFrameRef.current = ts;
      pendingFrameDtRef.current += dt;

      if (pendingFrameDtRef.current < RAF_DISPATCH_MIN_MS) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      const frameDt = pendingFrameDtRef.current;
      pendingFrameDtRef.current = 0;

      if (softDropHeldRef.current) {
        dispatch({ type: "SOFT_DROP", dt: frameDt });
      } else {
        dispatch({ type: "TICK", dt: frameDt });
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      lastFrameRef.current = null;
      pendingFrameDtRef.current = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // ── DAS (Delayed Auto Shift) ──────────────────────────────────────────────
  // We replicate classic DAS: instant move on first press, delay, then repeat.
  const dasTimerRef   = useRef<number | null>(null);
  const dasRepeatRef  = useRef<number | null>(null);
  const dasDirRef     = useRef<-1 | 0 | 1>(0);

  const clearDAS = useCallback(() => {
    if (dasTimerRef.current  !== null) { clearTimeout(dasTimerRef.current);   dasTimerRef.current  = null; }
    if (dasRepeatRef.current !== null) { clearInterval(dasRepeatRef.current); dasRepeatRef.current = null; }
    dasDirRef.current = 0;
  }, []);

  const startDAS = useCallback((dx: -1 | 1) => {
    clearDAS();
    dasDirRef.current = dx;
    dispatch({ type: "MOVE", dx });
    dasTimerRef.current = window.setTimeout(() => {
      dasRepeatRef.current = window.setInterval(() => {
        if (dasDirRef.current !== 0) dispatch({ type: "MOVE", dx: dasDirRef.current as -1 | 1 });
      }, DAS_REPEAT_MS);
    }, DAS_DELAY_MS);
  }, [clearDAS]);

  // ── Sync status ref ───────────────────────────────────────────────────────
  useEffect(() => { statusRef.current = state.status; }, [state.status]);

  // Stop DAS when not playing
  useEffect(() => {
    if (state.status !== "playing") {
      clearDAS();
      softDropHeldRef.current = false;
      leftHeldRef.current = false;
      rightHeldRef.current = false;
    }
  }, [state.status, clearDAS]);

  // ── Save best ─────────────────────────────────────────────────────────────
  useEffect(() => { saveBest(state.best); }, [state.best]);

  const persistedSnapshot = useMemo<State>(() => ({
    board: state.board,
    active: state.active,
    next: state.next,
    status: state.status,
    score: state.score,
    lines: state.lines,
    level: state.level,
    best: state.best,
    lockDelay: 0,
    gravityMs: 0,
    softDropMs: 0,
  }), [
    state.board,
    state.active,
    state.next,
    state.status,
    state.score,
    state.lines,
    state.level,
    state.best,
  ]);

  // ── Throttled save ────────────────────────────────────────────────────────
  useEffect(() => {
    const throttleMs =
      persistedSnapshot.status === "playing" ? SAVE_THROTTLE_PLAYING_MS : SAVE_THROTTLE_MS;
    const flushSave = () => {
      saveTimerRef.current = null;
      lastSaveRef.current = Date.now();
      saveRunState(persistedSnapshot);
    };
    const elapsed = Date.now() - lastSaveRef.current;
    if (elapsed >= throttleMs) { flushSave(); return; }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, throttleMs - elapsed);
  }, [persistedSnapshot]);

  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => onAuthStateChanged(auth, (user) => setActiveUid(user?.uid ?? null)), []);

  // ── Leaderboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const scoresRef = collection(db, "scores", "systris", "users");
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown };
            return { uid: entry.id, score: normalizeScore(data?.score) };
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score);
        setLeaderboardRows(rows);
      },
      (err) => console.warn("systris leaderboard listener failed:", err)
    );
  }, []);

  // ── Score submission ──────────────────────────────────────────────────────
  useEffect(() => { submittedBestRef.current = 0; }, [activeUid]);

  useEffect(() => {
    if (!activeUid || state.best <= 0 || state.best <= submittedBestRef.current) return;
    submittedBestRef.current = state.best;
    submitSysTrisScore(activeUid, state.best).catch((err) =>
      console.warn("systris score submit failed:", err)
    );
  }, [activeUid, state.best]);

  // ── Pause cooldown helpers ────────────────────────────────────────────────
  const beginPauseCooldown = useCallback(() => {
    const until = Date.now() + PAUSE_COOLDOWN_MS;
    pauseCooldownRef.current = until;
    setPauseCooldownUntil(until);
  }, []);

  const handlePauseCooldownDone = useCallback(() => setPauseCooldownUntil(0), []);

  // ── Keyboard input ────────────────────────────────────────────────────────
  useEffect(() => {
    const resumeWithCooldown = (kind: "START" | "TOGGLE_PAUSE") => {
      beginPauseCooldown();
      dispatch({ type: kind });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isInputTarget(event.target)) return;

      if (isSoftDropKey(event.code)) {
        event.preventDefault();
        if (!softDropHeldRef.current) {
          softDropHeldRef.current = true;
          // Immediate first soft-drop step
          dispatch({ type: "SOFT_DROP", dt: SOFT_DROP_INTERVAL_MS });
        }
        return;
      }

      if (isLeftKey(event.code)) {
        event.preventDefault();
        if (!leftHeldRef.current) {
          leftHeldRef.current = true;
          // Cancel right if held
          if (rightHeldRef.current) clearDAS();
          startDAS(-1);
        }
        return;
      }

      if (isRightKey(event.code)) {
        event.preventDefault();
        if (!rightHeldRef.current) {
          rightHeldRef.current = true;
          if (leftHeldRef.current) clearDAS();
          startDAS(1);
        }
        return;
      }

      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
        case "KeyX":
          event.preventDefault();
          dispatch({ type: "ROTATE" });
          break;
        case "Space":
          event.preventDefault();
          dispatch({ type: "HARD_DROP" });
          break;
        case "KeyP":
          event.preventDefault();
          if (statusRef.current === "playing") {
            if (Date.now() < pauseCooldownRef.current) break;
            dispatch({ type: "TOGGLE_PAUSE" });
          } else if (statusRef.current === "paused") {
            resumeWithCooldown("TOGGLE_PAUSE");
          }
          break;
        case "Enter":
          event.preventDefault();
          if (statusRef.current === "paused") resumeWithCooldown("START");
          else dispatch({ type: "START" });
          break;
        case "KeyR":
          event.preventDefault();
          clearDAS();
          dispatch({ type: "RESTART" });
          break;
        default:
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isSoftDropKey(event.code)) {
        softDropHeldRef.current = false;
        return;
      }
      if (isLeftKey(event.code)) {
        leftHeldRef.current = false;
        if (dasDirRef.current === -1) {
          clearDAS();
          if (rightHeldRef.current) startDAS(1);
        }
        return;
      }
      if (isRightKey(event.code)) {
        rightHeldRef.current = false;
        if (dasDirRef.current === 1) {
          clearDAS();
          if (leftHeldRef.current) startDAS(-1);
        }
      }
    };

    const onBlur = () => {
      softDropHeldRef.current = false;
      leftHeldRef.current = false;
      rightHeldRef.current = false;
      clearDAS();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [beginPauseCooldown, clearDAS, startDAS]);

  // ── Derived display data ──────────────────────────────────────────────────
  const activeCells = useMemo(() => getActiveCells(state.active), [state.active]);
  const ghostCells  = useMemo(() => getGhostCells(state.board, state.active), [state.board, state.active]);

  const leaders = useMemo(
    () => leaderboardRows.map((row) => ({ ...row, self: row.uid === activeUid })),
    [activeUid, leaderboardRows]
  );

  const podiumSlots = useMemo(() => [
    { rank: 2, tone: "silver" as const, row: leaders[1] ?? null },
    { rank: 1, tone: "gold"   as const, row: leaders[0] ?? null },
    { rank: 3, tone: "bronze" as const, row: leaders[2] ?? null },
  ], [leaders]);

  const yourBestScore = useMemo(() => {
    if (!activeUid) return state.best;
    const ownRow = leaderboardRows.find((row) => row.uid === activeUid);
    return ownRow ? ownRow.score : state.best;
  }, [activeUid, leaderboardRows, state.best]);

  const overlayTitle =
    state.status === "ready"    ? "SYSTRIS" :
    state.status === "paused"   ? "Paused"  :
    state.status === "gameover" ? "Game Over" : "";

  const nextShape  = PIECES[state.next].shape;
  const nextColor  = PIECES[state.next].color;
  const ghostColor = state.active ? PIECES[state.active.type].color : "#9fb2dc";

  const handleStartOrResume = () => {
    if (state.status === "paused") beginPauseCooldown();
    dispatch({ type: "START" });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="systris">
      <section className="systris-shell">
        <header className="systris-head">
          <h1>SYSTRIS</h1>
          <span>CLASSIC TETRIS</span>
        </header>

        <div className="systris-main">
          {/* ── Left panel ── */}
          <aside className="systris-panel">
            <div className="systris-card">
              <span>Score</span>
              <strong>{state.score.toLocaleString()}</strong>
            </div>
            <div className="systris-card">
              <span>Best</span>
              <strong>{state.best.toLocaleString()}</strong>
            </div>
            <div className="systris-mini-row">
              <div className="systris-mini"><span>Level</span><strong>{state.level}</strong></div>
              <div className="systris-mini"><span>Lines</span><strong>{state.lines}</strong></div>
            </div>
            <div className="systris-next">
              <span>Next</span>
              <div className="systris-next-grid">
                {nextShape.map((row, r) => (
                  <div className="systris-next-row" key={`n-r-${r}`}>
                    {row.map((on, c) => (
                      <i
                        key={`n-${r}-${c}`}
                        className="systris-next-cell"
                        style={on ? { background: nextColor } : undefined}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <p className="systris-note">
              {state.status === "ready" ? "Press Start" : state.status === "paused" ? "Paused" : ""}
            </p>
            {state.status === "playing" && pauseCooldownUntil > Date.now() && (
              <PauseCooldownIndicator cooldownUntil={pauseCooldownUntil} onDone={handlePauseCooldownDone} />
            )}
          </aside>

          {/* ── Board ── */}
          <section className="systris-board-wrap">
            <div className="systris-grid" role="grid" aria-label="SysTris board">
              <StaticBoardCells board={state.board} />

              {ghostCells.map((cell) => (
                <div
                  key={`g-${cell.r}:${cell.c}`}
                  className="systris-cell systris-cell--ghost"
                  style={{
                    gridRow: cell.r + 1,
                    gridColumn: cell.c + 1,
                    "--systris-ghost-color": ghostColor,
                  } as CSSProperties}
                />
              ))}

              {activeCells.map((cell) => (
                <div
                  key={`a-${cell.r}:${cell.c}`}
                  className="systris-cell systris-cell--active"
                  style={{
                    gridRow: cell.r + 1,
                    gridColumn: cell.c + 1,
                    background: PIECES[cell.type].color,
                  }}
                />
              ))}
            </div>

            {overlayTitle && (
              <div className="systris-overlay">
                <h2>{overlayTitle}</h2>
                <p>Arrows: move/rotate | Down: soft drop | Space: hard drop | P: pause</p>
                <button type="button" onClick={handleStartOrResume}>
                  {state.status === "paused" ? "Resume" : "Start"}
                </button>
              </div>
            )}
          </section>

          {/* ── Leaderboard ── */}
          <aside className="systris-panel systris-panel--leader">
            <div className="systris-panel-head">
              <h2>Leaderboard</h2>
              <span>Best Score</span>
            </div>
            <div className="systris-card systris-card--small">
              <span>Your Best</span>
              <strong>{yourBestScore.toLocaleString()}</strong>
            </div>
            <div className="systris-leaders">
              {leaders.length === 0 ? (
                <p className="systris-leader-empty">No scores yet. Play to claim rank #1.</p>
              ) : (
                leaders.map((row, i) => (
                  <div className={`systris-leader ${row.self ? "is-self" : ""}`} key={`${row.uid}-${i}`}>
                    <b>{i + 1}</b>
                    <div className="systris-leader-user"><UserBox userId={row.uid} /></div>
                    <strong>{row.score.toLocaleString()}</strong>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        {/* ── How to play ── */}
        <section className="systris-strip">
          <h2>How To Play</h2>
          <div className="systris-strip-row">
            {HELP.map((hint) => (
              <article className="systris-strip-item" key={hint}>{hint}</article>
            ))}
          </div>
        </section>

        {/* ── Podium ── */}
        <section className="systris-strip">
          <div className="systris-panel-head">
            <h2>Podium</h2>
            <span>All-Time Top 3</span>
          </div>
          <div className="systris-podium">
            {podiumSlots.map((slot) => (
              <article className={`systris-podium-card tone-${slot.tone}`} key={`podium-${slot.rank}`}>
                <span>#{slot.rank}</span>
                <div className="systris-podium-user">
                  {slot.row
                    ? <UserBox userId={slot.row.uid} />
                    : <em className="systris-podium-empty">Waiting...</em>}
                </div>
                <b>{slot.row ? slot.row.score.toLocaleString() : "--"}</b>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
