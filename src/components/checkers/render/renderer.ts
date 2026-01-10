import type { Board, Cell, Winner, Pos } from '../engine/types';
import { ROWS, COLS } from '../engine/types';
import { EMPTY } from '../engine/rules_ai';

/* =========================================================
   Checkers Renderer - Fancy & Beautiful Animations
   ========================================================= */

type AnimState = {
  active: boolean;
  from: Pos;
  to: Pos;
  captures: Pos[];
  t01?: number;
  startTime?: number; // seconds
  durationSec?: number;
};

type DragState = {
  active: boolean;
  from: Pos;
  x: number;
  y: number;
};

export type RenderState = {
  hoveredPos?: Pos | null;
  selectedPos?: Pos | null;
  validMoves?: Pos[];

  // ✅ NEW: pieces that MUST capture this turn (green highlight)
  forcedCapturePieces?: Pos[];

  winner?: Winner | null;
  anim?: AnimState | null;
  time?: number; // Current time for animations (seconds)
  drag?: DragState | null;

  graveyard?: Array<{
    player: number; // 1=RED, 2=BLACK (owner of captured piece)
    cell: Cell;
    index: number;
  }>;
};

export type RenderConf = {
  tile?: number;
  animDurationMs?: number;
  graveyardWidth?: number;
};

const COLORS = {
  lightSquare: '#f3f1ff',
  darkSquare: '#2b2b40',
  darkSquareHover: '#3a3a57',
  darkSquareSelected: '#4a3b8f',

  overlay: 'rgba(0,0,0,0.55)',
  text: '#f6f7ff',
  textSub: 'rgba(246,247,255,0.75)',
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function posToCenterPx(p: Pos, TILE: number) {
  return { x: p.c * TILE + TILE / 2, y: p.r * TILE + TILE / 2 };
}

function animProgress01(time: number, anim: AnimState, cfg?: RenderConf) {
  if (typeof anim.t01 === 'number') return clamp01(anim.t01);

  const start = anim.startTime ?? 0;
  const dur = anim.durationSec ?? ((cfg?.animDurationMs ?? 400) / 1000);
  if (dur <= 0) return 1;
  return clamp01((time - start) / dur);
}

function buildAnimPath(from: Pos, to: Pos, _captures: Pos[]) {
  const path: Pos[] = [from, to];
  return path;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: Cell,
  TILE: number,
  liftY: number
) {
  const isRed = cell === 1 || cell === 2;
  const isKing = cell === 2 || cell === 4;

  const r = TILE * 0.38;
  const y = cy + liftY;

  // shadow
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(cx, y + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fill();
  ctx.restore();

  // body gradient
  const g = ctx.createRadialGradient(
    cx - r * 0.35,
    y - r * 0.35,
    r * 0.2,
    cx,
    y,
    r * 1.3
  );
  if (isRed) {
    g.addColorStop(0, 'rgba(255,140,160,1)');
    g.addColorStop(1, 'rgba(190,40,85,1)');
  } else {
    g.addColorStop(0, 'rgba(195,205,225,1)');
    g.addColorStop(1, 'rgba(30,35,50,1)');
  }

  // disk
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // rim
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, TILE * 0.03);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();

  // highlight
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(cx - r * 0.25, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();
  ctx.restore();

  // king crown
  if (isKing) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = isRed
      ? 'rgba(255,230,120,0.95)'
      : 'rgba(255,230,180,0.75)';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(cx, y, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  state: RenderState = {},
  cfg?: RenderConf
) {
  const TILE = cfg?.tile ?? 90;

  const GRAVEYARD_WIDTH = cfg?.graveyardWidth ?? TILE * 1.15;

  const BOARD_W = COLS * TILE;
  const BOARD_H = ROWS * TILE;

  const W = BOARD_W + GRAVEYARD_WIDTH * 2;
  const H = BOARD_H;

  const BOARD_OFFSET_X = GRAVEYARD_WIDTH;

  const time = state.time ?? performance.now() / 1000;
  const anim = state.anim ?? null;
  const drag = state.drag ?? null;
  const animT01 = anim ? animProgress01(time, anim, cfg) : 0;

  ctx.clearRect(0, 0, W, H);

  // Subtle vignette
  {
    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.45,
      0,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.85
    );
    g.addColorStop(0, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- Board ---------- */
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isDark = (r + c) % 2 === 1;
      let color = isDark ? COLORS.darkSquare : COLORS.lightSquare;

      if (
        isDark &&
        state.hoveredPos &&
        state.hoveredPos.r === r &&
        state.hoveredPos.c === c
      ) {
        color = COLORS.darkSquareHover;
      }
      if (
        isDark &&
        state.selectedPos &&
        state.selectedPos.r === r &&
        state.selectedPos.c === c
      ) {
        color = COLORS.darkSquareSelected;
      }

      ctx.fillStyle = color;
      ctx.fillRect(BOARD_OFFSET_X + c * TILE, r * TILE, TILE, TILE);

      if (isDark) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          BOARD_OFFSET_X + c * TILE + 1,
          r * TILE + 1,
          TILE - 2,
          TILE - 2
        );
        ctx.restore();
      }
    }
  }

  /* ---------- Forced Capture Pieces (GREEN halo) ---------- */
  if (state.forcedCapturePieces && state.forcedCapturePieces.length) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5.5);

    for (const p of state.forcedCapturePieces) {
      const cx = BOARD_OFFSET_X + p.c * TILE + TILE / 2;
      const cy = p.r * TILE + TILE / 2;

      ctx.save();

      // soft glow
      ctx.strokeStyle = `rgba(60, 255, 140, ${0.10 + 0.18 * pulse})`;
      ctx.lineWidth = TILE * (0.14 + 0.02 * pulse);
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.44, 0, Math.PI * 2);
      ctx.stroke();

      // crisp ring
      ctx.strokeStyle = `rgba(60, 255, 140, ${0.65 + 0.25 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.46, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  /* ---------- Valid Moves (glowing rings) ---------- */
  if (state.validMoves && state.validMoves.length) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);

    for (const m of state.validMoves) {
      const cx = BOARD_OFFSET_X + m.c * TILE + TILE / 2;
      const cy = m.r * TILE + TILE / 2;

      ctx.save();

      ctx.strokeStyle = `rgba(46,200,255,${0.12 + 0.18 * pulse})`;
      ctx.lineWidth = TILE * (0.12 + 0.02 * pulse);
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.38, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(46,200,255,${0.7 + 0.25 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.40, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  /* ---------- Pieces (static) ---------- */
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r]?.[c] ?? EMPTY;
      if (cell === EMPTY) continue;

      if (anim) {
        const isFrom = r === anim.from.r && c === anim.from.c;
        const isTo = r === anim.to.r && c === anim.to.c;
        if (isFrom || isTo) continue;
      }
      if (drag?.active && r === drag.from.r && c === drag.from.c) continue;

      const { x: cx, y: cy } = posToCenterPx({ r, c }, TILE);
      drawPiece(ctx, BOARD_OFFSET_X + cx, cy, cell, TILE, 0);
    }
  }

  /* ---------- Graveyard ---------- */
  if (state.graveyard && state.graveyard.length > 0) {
    const gyTile = TILE * 0.6;
    const spacing = TILE * 0.5;
    const topPad = TILE * 0.8;
    const bottomPad = TILE * 0.8;

    const usableH = Math.max(1, H - topPad - bottomPad);
    const piecesPerColumn = Math.max(1, Math.floor(usableH / spacing));

    const redPile = state.graveyard.filter((p) => p.player === 1);
    const blackPile = state.graveyard.filter((p) => p.player === 2);

    const leftCenterX = GRAVEYARD_WIDTH * 0.3;
    const rightCenterX = BOARD_OFFSET_X + BOARD_W + GRAVEYARD_WIDTH * 0.7;

    const drawPile = (pile: typeof redPile, side: 'LEFT' | 'RIGHT') => {
      for (let i = 0; i < pile.length; i++) {
        const p = pile[i];
        const row = i % piecesPerColumn;
        const col = Math.floor(i / piecesPerColumn);

        const colShift = col * (gyTile * 0.62);
        const x =
          side === 'LEFT'
            ? leftCenterX + colShift
            : rightCenterX - colShift;

        const y = H - bottomPad - row * spacing;
        drawPiece(ctx, x, y, p.cell, gyTile, 0);
      }
    };

    drawPile(redPile, 'LEFT');
    drawPile(blackPile, 'RIGHT');
  }

  /* ---------- Animated Piece ---------- */
  if (anim) {
    const path = buildAnimPath(anim.from, anim.to, anim.captures);
    const segs = Math.max(1, path.length - 1);

    const scaled = animT01 * segs;
    const segIdx = Math.min(segs - 1, Math.floor(scaled));
    const localT = scaled - segIdx;

    const e = easeInOutCubic(localT);

    const a = posToCenterPx(path[segIdx], TILE);
    const b = posToCenterPx(path[segIdx + 1], TILE);

    const x = BOARD_OFFSET_X + lerp(a.x, b.x, e);

    const jumpH = TILE * 0.22;
    const jump = Math.sin(e * Math.PI) * jumpH;

    const y = lerp(a.y, b.y, e) - jump;

    const piece =
      board[anim.to.r]?.[anim.to.c] ??
      board[anim.from.r]?.[anim.from.c] ??
      EMPTY;

    const bounce =
      animT01 > 0.88
        ? Math.sin(((animT01 - 0.88) / 0.12) * Math.PI) * TILE * 0.04
        : 0;

    drawPiece(ctx, x, y, piece, TILE, bounce);
  }

  /* ---------- Dragged Piece ---------- */
  if (drag?.active) {
    const cell = board[drag.from.r]?.[drag.from.c] ?? EMPTY;
    if (cell !== EMPTY) {
      const lift = -TILE * 0.22;
      drawPiece(ctx, drag.x, drag.y, cell, TILE, lift);
    }
  }

  /* ---------- Winner Overlay ---------- */
  if (state.winner && state.winner.kind !== 'NONE') {
    ctx.save();
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COLORS.text;
    ctx.font = `800 ${Math.round(
      TILE * 0.55
    )}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const title =
      state.winner.kind === 'DRAW'
        ? 'Draw!'
        : state.winner.kind === 'WIN'
        ? state.winner.player === 1
          ? 'RED Wins!'
          : 'BLACK Wins!'
        : '';

    ctx.fillText(title, W / 2, H / 2 - TILE * 0.15);

    ctx.fillStyle = COLORS.textSub;
    ctx.font = `600 ${Math.round(
      TILE * 0.22
    )}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText('Press R to restart · ESC to menu', W / 2, H / 2 + TILE * 0.32);

    ctx.restore();
  }
}
