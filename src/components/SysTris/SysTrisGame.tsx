import { useEffect, useMemo, useReducer, useRef, useState } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const PREVIEW_COUNT = 3;

const BEST_KEY_PREFIX = "systris_best_score";
const SAVE_KEY_PREFIX = "systris_save_classic_v1";
const SNAPSHOT_SAVE_DEBOUNCE_MS = 420;

const PIECE_ORDER = ["I", "O", "T", "S", "Z", "J", "L"];
const LINE_POINTS = [0, 100, 300, 500, 800];

const PIECE_ROTATION_COUNTS = { I: 4, O: 1, T: 4, S: 2, Z: 2, J: 4, L: 4 };

const PIECE_BASE_PIVOTS = {
  I: { x: 1.5, y: 0.5 },
  O: { x: 0.5, y: 0.5 },
  T: { x: 1, y: 1 },
  S: { x: 1, y: 1 },
  Z: { x: 1, y: 1 },
  J: { x: 1, y: 1 },
  L: { x: 1, y: 1 },
};

const ROTATION_KICKS = [
  { row: 0, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
  { row: -1, col: 0 },
  { row: -1, col: -1 },
  { row: -1, col: 1 },
];

const PIECE_DEFS = {
  I: { matrix: [[1, 1, 1, 1]], color: "#36f5ff" },
  O: { matrix: [[1, 1], [1, 1]], color: "#fff765" },
  T: { matrix: [[0, 1, 0], [1, 1, 1]], color: "#bd72ff" },
  S: { matrix: [[0, 1, 1], [1, 1, 0]], color: "#5ef79a" },
  Z: { matrix: [[1, 1, 0], [0, 1, 1]], color: "#ff6d8f" },
  J: { matrix: [[1, 0, 0], [1, 1, 1]], color: "#71a3ff" },
  L: { matrix: [[0, 0, 1], [1, 1, 1]], color: "#ffb45f" },
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function isPieceType(value) {
  return typeof value === "string" && value in PIECE_DEFS;
}

function normalizeStatus(value) {
  if (["ready", "playing", "paused", "gameover"].includes(value)) return value;
  return "ready";
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));
}

function normalizeBoard(raw) {
  if (!Array.isArray(raw)) return createEmptyBoard();
  const board = createEmptyBoard();
  for (let r = 0; r < Math.min(raw.length, BOARD_HEIGHT); r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < Math.min(row.length, BOARD_WIDTH); c++) {
      board[r][c] = isPieceType(row[c]) ? row[c] : null;
    }
  }
  return board;
}

function normalizePieceList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPieceType);
}

function normalizeScore(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function cloneMatrix(m) { return m.map((r) => [...r]); }

function normalizeInteger(v) { return Math.round(v); }

function positiveMod(value, modulo) { return ((value % modulo) + modulo) % modulo; }

function isSameMatrix(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if ((a[r][c] ? 1 : 0) !== (b[r][c] ? 1 : 0)) return false;
    }
  }
  return true;
}

function buildRotatedState(state, direction) {
  const occupied = [];
  for (let r = 0; r < state.matrix.length; r++) {
    for (let c = 0; c < state.matrix[r].length; c++) {
      if (state.matrix[r][c]) occupied.push({ x: c, y: r });
    }
  }
  if (occupied.length === 0) return { matrix: [[1]], pivot: { x: 0, y: 0 } };

  const rotated = occupied.map(({ x, y }) => {
    const dx = x - state.pivot.x;
    const dy = y - state.pivot.y;
    return {
      x: normalizeInteger(state.pivot.x + (direction === "CW" ? dy : -dy)),
      y: normalizeInteger(state.pivot.y + (direction === "CW" ? -dx : dx)),
    };
  });

  const minX = Math.min(...rotated.map((c) => c.x));
  const maxX = Math.max(...rotated.map((c) => c.x));
  const minY = Math.min(...rotated.map((c) => c.y));
  const maxY = Math.max(...rotated.map((c) => c.y));

  const w = normalizeInteger(maxX - minX + 1);
  const h = normalizeInteger(maxY - minY + 1);
  const matrix = Array.from({ length: h }, () => Array(w).fill(0));

  for (const { x, y } of rotated) {
    const nx = normalizeInteger(x - minX);
    const ny = normalizeInteger(y - minY);
    if (ny >= 0 && ny < matrix.length && nx >= 0 && nx < matrix[0].length) matrix[ny][nx] = 1;
  }

  return {
    matrix,
    pivot: {
      x: normalizeInteger(state.pivot.x - minX),
      y: normalizeInteger(state.pivot.y - minY),
    },
  };
}

function buildPieceRotationDefs() {
  return PIECE_ORDER.reduce((defs, type) => {
    const stateCount = PIECE_ROTATION_COUNTS[type];
    const states = [];
    let current = {
      matrix: cloneMatrix(PIECE_DEFS[type].matrix),
      pivot: { ...PIECE_BASE_PIVOTS[type] },
    };
    states.push({ matrix: cloneMatrix(current.matrix), pivot: { ...current.pivot } });
    for (let i = 1; i < stateCount; i++) {
      current = buildRotatedState(current, "CW");
      states.push({ matrix: cloneMatrix(current.matrix), pivot: { ...current.pivot } });
    }
    defs[type] = { states, stateCount };
    return defs;
  }, {});
}

const PIECE_ROTATIONS = buildPieceRotationDefs();

function getCanonicalRotation(type, matrix, rawRotation) {
  const rotationDef = PIECE_ROTATIONS[type];
  const explicit = Number(rawRotation);
  if (Number.isFinite(explicit)) return positiveMod(Math.round(explicit), rotationDef.stateCount);
  for (let i = 0; i < rotationDef.stateCount; i++) {
    if (isSameMatrix(rotationDef.states[i].matrix, matrix)) return i;
  }
  return 0;
}

function normalizeActivePiece(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isPieceType(raw.type)) return null;
  if (!Array.isArray(raw.matrix)) return null;
  const rawMatrix = raw.matrix.map((row) => (Array.isArray(row) ? row.map((c) => (c ? 1 : 0)) : []));
  if (rawMatrix.length === 0 || rawMatrix.some((r) => r.length === 0)) return null;

  const rotation = getCanonicalRotation(raw.type, rawMatrix, raw.rotation);
  const matrix = cloneMatrix(PIECE_ROTATIONS[raw.type].states[rotation].matrix);

  return {
    type: raw.type,
    matrix,
    row: Number.isFinite(raw.row) ? Number(raw.row) : -1,
    col: Number.isFinite(raw.col) ? Number(raw.col) : 0,
    rotation,
  };
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (["input", "textarea", "select", "button"].includes(tag)) return true;
  return target.isContentEditable;
}

function shuffledBag() {
  const bag = [...PIECE_ORDER];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function refillQueue(queue, bag, minSize = PREVIEW_COUNT + 1) {
  const nextQueue = [...queue];
  let nextBag = [...bag];
  while (nextQueue.length < minSize) {
    if (nextBag.length === 0) nextBag = shuffledBag();
    const next = nextBag[0];
    if (!next) break;
    nextQueue.push(next);
    nextBag = nextBag.slice(1);
  }
  return { queue: nextQueue, bag: nextBag };
}

function spawnPiece(queue, bag) {
  const refilled = refillQueue(queue, bag);
  const type = refilled.queue[0];
  if (!type) throw new Error("Queue generation failed");
  const matrix = cloneMatrix(PIECE_ROTATIONS[type].states[0].matrix);
  const col = Math.floor((BOARD_WIDTH - matrix[0].length) / 2);
  return {
    piece: { type, matrix, row: -1, col, rotation: 0 },
    queue: refilled.queue.slice(1),
    bag: refilled.bag,
  };
}

function collides(board, matrix, row, col) {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      const br = row + r;
      const bc = col + c;
      if (bc < 0 || bc >= BOARD_WIDTH || br >= BOARD_HEIGHT) return true;
      if (br >= 0 && board[br][bc]) return true;
    }
  }
  return false;
}

function attemptRotate(board, piece, direction) {
  const rotationDef = PIECE_ROTATIONS[piece.type];
  if (rotationDef.stateCount <= 1) return piece;

  const step = direction === "CW" ? 1 : -1;
  const cur = positiveMod(piece.rotation, rotationDef.stateCount);
  const next = positiveMod(cur + step, rotationDef.stateCount);
  const currentState = rotationDef.states[cur];
  const nextState = rotationDef.states[next];

  const pivotRow = piece.row + currentState.pivot.y;
  const pivotCol = piece.col + currentState.pivot.x;
  const baseRow = normalizeInteger(pivotRow - nextState.pivot.y);
  const baseCol = normalizeInteger(pivotCol - nextState.pivot.x);

  for (const kick of ROTATION_KICKS) {
    const cr = baseRow + kick.row;
    const cc = baseCol + kick.col;
    if (!collides(board, nextState.matrix, cr, cc)) {
      return { ...piece, matrix: cloneMatrix(nextState.matrix), rotation: next, row: cr, col: cc };
    }
  }
  return null;
}

function mergePiece(board, piece) {
  const next = board.map((r) => [...r]);
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (!piece.matrix[r][c]) continue;
      const br = piece.row + r;
      const bc = piece.col + c;
      if (br >= 0 && br < BOARD_HEIGHT && bc >= 0 && bc < BOARD_WIDTH) next[br][bc] = piece.type;
    }
  }
  return next;
}

function clearFullLines(board) {
  const kept = board.filter((row) => !row.every(Boolean));
  const cleared = BOARD_HEIGHT - kept.length;
  while (kept.length < BOARD_HEIGHT) kept.unshift(Array(BOARD_WIDTH).fill(null));
  return { board: kept, cleared };
}

function getLevel(lines) { return Math.floor(lines / 10) + 1; }
function getDropDelay(level) { return Math.max(90, 760 - (level - 1) * 55); }

// ─── Storage ──────────────────────────────────────────────────────────────────
const bestKey = `${BEST_KEY_PREFIX}:guest`;
const saveKey = `${SAVE_KEY_PREFIX}:guest`;

function loadBest() {
  try {
    const v = Number(localStorage.getItem(bestKey));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

function buildSnapshot(state, pauseIfPlaying) {
  const status = pauseIfPlaying && state.status === "playing" ? "paused" : state.status;
  const message = pauseIfPlaying && state.status === "playing" ? "Paused" : state.message;
  return {
    v: 1,
    state: {
      board: state.board, active: state.active, queue: state.queue,
      bag: state.bag, status, score: state.score, lines: state.lines,
      level: state.level, best: state.best, message,
    },
  };
}

function persistSnapshot(state, pauseIfPlaying) {
  try {
    localStorage.setItem(saveKey, JSON.stringify(buildSnapshot(state, pauseIfPlaying)));
  } catch { /* ignore */ }
}

function loadSavedState(best) {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !parsed.state) return null;
    const saved = parsed.state;

    let queue = normalizePieceList(saved.queue);
    let bag = normalizePieceList(saved.bag);
    let active = normalizeActivePiece(saved.active);
    const restoredStatus = normalizeStatus(saved.status);
    const status = restoredStatus === "playing" ? "paused" : restoredStatus;
    const rebuiltBest = Math.max(best, Number(saved.best) || 0);

    if (restoredStatus === "playing" && !active) {
      const spawned = spawnPiece(queue, bag);
      active = spawned.piece; queue = spawned.queue; bag = spawned.bag;
    }

    return {
      board: normalizeBoard(saved.board), active, queue, bag, status,
      score: Math.max(0, Number(saved.score) || 0),
      lines: Math.max(0, Number(saved.lines) || 0),
      level: Math.max(1, Number(saved.level) || 1),
      best: rebuiltBest,
      message: status === "paused" ? "Paused" : typeof saved.message === "string" ? saved.message : "Press Start",
    };
  } catch { return null; }
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function settlePiece(state, piece, extraScore) {
  const mergedBoard = mergePiece(state.board, piece);
  const { board: clearedBoard, cleared } = clearFullLines(mergedBoard);

  const nextLines = state.lines + cleared;
  const nextLevel = getLevel(nextLines);
  const lineScore = LINE_POINTS[cleared] * state.level;
  const nextScore = state.score + extraScore + lineScore;
  const nextBest = Math.max(state.best, nextScore);

  const spawned = spawnPiece(state.queue, state.bag);
  const blocked = collides(clearedBoard, spawned.piece.matrix, spawned.piece.row, spawned.piece.col);

  if (blocked) {
    return {
      ...state, board: clearedBoard, active: null, queue: spawned.queue, bag: spawned.bag,
      score: nextScore, lines: nextLines, level: nextLevel, best: nextBest,
      status: "gameover", message: "Game Over",
    };
  }

  return {
    ...state, board: clearedBoard, active: spawned.piece, queue: spawned.queue, bag: spawned.bag,
    score: nextScore, lines: nextLines, level: nextLevel, best: nextBest,
    message: cleared > 0 ? (cleared === 4 ? "TETRIS!" : `Cleared ${cleared}`) : "",
  };
}

function createRun(best, status) {
  const spawned = spawnPiece([], []);
  return {
    board: createEmptyBoard(), active: spawned.piece, queue: spawned.queue,
    bag: spawned.bag, status, score: 0, lines: 0, level: 1, best,
    message: status === "ready" ? "Press Start" : "",
  };
}

function createInitialState() {
  const best = loadBest();
  const saved = loadSavedState(best);
  if (saved) return saved;
  return createRun(best, "ready");
}

function reducer(state, action) {
  switch (action.type) {
    case "SYNC_BEST": {
      const b = normalizeScore(action.best);
      return b === state.best ? state : { ...state, best: b };
    }
    case "START": {
      if (state.status === "ready" || state.status === "gameover") return createRun(state.best, "playing");
      if (state.status === "paused") return { ...state, status: "playing", message: "" };
      return state;
    }
    case "RESTART":
      return createRun(state.best, "playing");
    case "TOGGLE_PAUSE": {
      if (state.status === "playing") return { ...state, status: "paused", message: "Paused" };
      if (state.status === "paused") return { ...state, status: "playing", message: "" };
      return state;
    }
    case "TICK": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, row: state.active.row + 1 };
      if (!collides(state.board, moved.matrix, moved.row, moved.col)) return { ...state, active: moved };
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
      if (rotated.row === state.active.row && rotated.col === state.active.col && rotated.rotation === state.active.rotation) return state;
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
      while (!collides(state.board, state.active.matrix, row + 1, state.active.col)) row++;
      const distance = row - state.active.row;
      return settlePiece(state, { ...state.active, row }, distance * 2);
    }
    default:
      return state;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CELL_SIZE = 28; // px

const S = {
  page: {
    minHeight: "100vh",
    background: "#0a0a0f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Courier New', Courier, monospace",
    color: "#e0e0e0",
    padding: "16px",
  },
  shell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  header: { textAlign: "center", lineHeight: 1.1 },
  title: { margin: 0, fontSize: 32, letterSpacing: 6, color: "#fff", textTransform: "uppercase" },
  subtitle: { margin: "2px 0 0", fontSize: 11, letterSpacing: 3, color: "#555", textTransform: "uppercase" },
  layout: { display: "flex", gap: 12, alignItems: "flex-start" },
  sidebar: {
    display: "flex", flexDirection: "column", gap: 10,
    width: 100, padding: "8px 10px",
    background: "#111118", border: "1px solid #222", borderRadius: 4,
  },
  stat: { display: "flex", flexDirection: "column", gap: 1 },
  statLabel: { fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase" },
  statValue: { fontSize: 18, color: "#fff", letterSpacing: 1 },
  statGrid: { display: "flex", gap: 6 },
  chip: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
    background: "#0a0a0f", border: "1px solid #222", borderRadius: 3, padding: "4px 2px",
    fontSize: 10, color: "#888",
  },
  chipVal: { fontSize: 15, color: "#ddd" },
  nextSection: {},
  nextLabel: { margin: "0 0 6px", fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase" },
  nextList: { display: "flex", flexDirection: "column", gap: 4 },
  message: { margin: 0, fontSize: 10, color: "#ffb45f", letterSpacing: 1, textAlign: "center" },
  boardWrap: { position: "relative" },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(${BOARD_WIDTH}, ${CELL_SIZE}px)`,
    gridTemplateRows: `repeat(${BOARD_HEIGHT}, ${CELL_SIZE}px)`,
    border: "2px solid #2a2a3a",
    background: "#0d0d15",
    gap: 1,
    padding: 1,
  },
  cellEmpty: {
    width: CELL_SIZE - 2, height: CELL_SIZE - 2,
    background: "#111118",
  },
  cellFilled: (color) => ({
    width: CELL_SIZE - 2, height: CELL_SIZE - 2,
    background: color,
    boxShadow: `inset 2px 2px 0 rgba(255,255,255,0.25), inset -2px -2px 0 rgba(0,0,0,0.4)`,
  }),
  overlay: {
    position: "absolute", inset: 0,
    background: "rgba(5,5,10,0.88)",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 12, padding: 20,
    backdropFilter: "blur(2px)",
  },
  overlayTitle: { margin: 0, fontSize: 22, letterSpacing: 4, color: "#fff" },
  overlayHint: { margin: 0, fontSize: 10, color: "#666", textAlign: "center", lineHeight: 1.6, letterSpacing: 1 },
  overlayBtn: {
    padding: "8px 24px", fontSize: 13, letterSpacing: 3,
    background: "transparent", border: "1px solid #4a4a6a",
    color: "#ccc", cursor: "pointer", textTransform: "uppercase",
    transition: "all 0.15s",
  },
  howto: {
    display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center",
    padding: "8px 0", borderTop: "1px solid #1a1a2a",
  },
  howtoItem: { fontSize: 10, color: "#555", letterSpacing: 1 },
  // MiniPiece
  mini: { padding: "2px 0" },
  miniRow: { display: "flex" },
  miniCellOff: { width: 8, height: 8, margin: 1 },
  miniCellOn: (color) => ({ width: 8, height: 8, margin: 1, background: color }),
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function MiniPiece({ type }) {
  const { matrix, color } = PIECE_DEFS[type];
  return (
    <div style={S.mini}>
      {matrix.map((row, ri) => (
        <div key={ri} style={S.miniRow}>
          {row.map((cell, ci) => (
            <span key={ci} style={cell ? S.miniCellOn(color) : S.miniCellOff} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SysTrisGame() {
  const [state, dispatch] = useR
