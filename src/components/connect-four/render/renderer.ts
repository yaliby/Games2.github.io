﻿﻿﻿import type { Board, Cell, Winner } from '../engine/types';
import { ROWS, COLS } from '../engine/types';
import { EMPTY, RED } from '../engine/rules_ai';

/* =========================================================
   Renderer — FULLY COMPATIBLE + TS SAFE (NO SIGNATURE CHANGES)
   - Keeps: export drawBoard(ctx, board, state = {}, cfg?)
   - Keeps: state.anim fields + meaning
   - Enhanced: Dice instead of discs with 3D appearance
   - Enhanced: Tumbling/rotating dice during fall
   - Enhanced: Prominent winning dice animation with connecting lines
   ========================================================= */

type AnimState = {
  active: boolean;
  piece: Cell; // חשוב: Cell, לא Player
  col: number;
  fromY: number;
  toR: number;
  toC: number;
  t01: number;
  pop01: number;
};

export type RenderState = {
  hoveredCol?: number | null;
  winner?: Winner | null;
  anim?: AnimState | null;
};

type RenderConfig = {
  tile: number;
  /** Optional: controls the drop animation length (ms). */
  animDurationMs?: number;
  /** Optional: simple multiplier over animDurationMs (or default duration). */
  animSlowMo?: number;
  /** Optional: winner line animation progress (0..1). */
  winnerLine?: { progress?: number };
};

/* ---------- Visual constants (premium/arcade) --------- */
const COLORS = {
  bgTop: '#0a0f19',
  bgBottom: '#070a10',

  plateOuterA: '#121a2b',
  plateOuterB: '#0c1220',

  plateInnerA: '#2a3a66',
  plateInnerB: '#1f2a49',

  // hole "surface" + inner shadow
  holeSurfaceA: '#f7f9ff',
  holeSurfaceB: '#e6ebff',
  holeInnerShadow: 'rgba(0,0,0,0.40)',

  // rim & separators
  rim: 'rgba(10,12,18,0.70)',
  rimHi: 'rgba(255,255,255,0.10)',

  hover: 'rgba(255,255,255,0.03)',
  hoverEdge: 'rgba(108,124,255,0.25)',

  vignette: 'rgba(0,0,0,0.35)',
};

// ---------------------------------------------------------------------------
// Drop animation timing (renderer-controlled "true slow motion").
// Why: if upstream code feeds t01 in [0..1] over a fixed duration, scaling t01
// inside easing *cannot* make the animation longer — it only distorts it.
// We therefore keep a tiny internal timer that can extend the animation length,
// and we can keep rendering the last active animation for a short linger window.
// ---------------------------------------------------------------------------

const DEFAULT_DROP_MS = 650;
const VICTORY_ANIMATION_DELAY_MS = 500; // One second delay for entire victory animation
const VICTORY_LINE_DURATION_MS = 100; // Animation duration for drawing the line

let _lastAnimSig = '';
let _lastAnimStartMs = 0;
let _lastAnimEndMs = 0;
let _lastAnimSnapshot: AnimState | null = null;

// Victory line animation state
let _victoryRecognizedMs = 0;
let _lastPlacedDisc: { r: number; c: number } | null = null;
let _lastWinnerState: Winner | null = null;

function animSignature(a: AnimState): string {
  // Signature that changes when a *new* piece starts falling.
  return `${a.piece}:${a.col}:${a.toR}:${a.toC}:${a.fromY}`;
}

/* =========================================================
   Public API
   ========================================================= */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  state: RenderState = {},
  cfg?: RenderConfig
) {
  const TILE = cfg?.tile ?? Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.087);;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  // Clear full intended board area (keeps prior expectations)
  ctx.clearRect(0, 0, W, H);

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const incomingAnim = state.anim?.active ? state.anim : null;

  // Decide which animation to render (incoming or lingered snapshot)
  const slowMo = Math.max(0.25, cfg?.animSlowMo ?? 1.0);
  const dropMs = Math.max(120, (cfg?.animDurationMs ?? DEFAULT_DROP_MS) * slowMo);

  if (incomingAnim) {
    const sig = animSignature(incomingAnim);
    if (sig !== _lastAnimSig) {
      _lastAnimSig = sig;
      _lastAnimStartMs = now;
      _lastAnimEndMs = now + dropMs;
      _lastAnimSnapshot = { ...incomingAnim };
    } else {
      // keep latest target info (in case upstream mutates toR/toC mid-flight)
      _lastAnimSnapshot = { ...incomingAnim };
      // if dropMs changed (config change), extend end accordingly
      _lastAnimEndMs = _lastAnimStartMs + dropMs;
    }
  } else if (_lastAnimSnapshot && now >= _lastAnimEndMs) {
    // past linger window
    _lastAnimSnapshot = null;
    _lastAnimSig = '';
  }

  const anim = incomingAnim ?? (_lastAnimSnapshot && now < _lastAnimEndMs ? _lastAnimSnapshot : null);

  // Local progress for the (possibly slowed) animation
  const animT01 = anim ? clamp01((now - _lastAnimStartMs) / (dropMs || 1)) : 0;

  // Track victory recognition and last placed disc
  const currentWinner = state.winner || null;
  const isNewVictory = currentWinner && currentWinner.kind === 'WIN' && 
                       (!_lastWinnerState || _lastWinnerState.kind !== 'WIN');
  
  if (isNewVictory && anim) {
    // Victory just recognized - store timestamp and last placed disc position
    _victoryRecognizedMs = now;
    _lastPlacedDisc = { r: anim.toR, c: anim.toC };
  } else if (!currentWinner || currentWinner.kind !== 'WIN') {
    // No victory - reset state
    _victoryRecognizedMs = 0;
    _lastPlacedDisc = null;
  }
  
  _lastWinnerState = currentWinner;

  const winSet = makeWinnerSet(state.winner);
  const winCells = winSet ? extractWinnerCells(state.winner) : null;
  
  // Calculate victory animation progress (both line and disc rotation)
  const victoryAnimationStart = _victoryRecognizedMs + VICTORY_ANIMATION_DELAY_MS;
  const lineAnimationStart = victoryAnimationStart;
  const lineProgress = _victoryRecognizedMs > 0 && now >= lineAnimationStart
    ? clamp01((now - lineAnimationStart) / VICTORY_LINE_DURATION_MS)
    : 0;
  
  // Calculate time since victory animation started (for disc rotation)
  const victoryAnimationTime = _victoryRecognizedMs > 0 && now >= victoryAnimationStart
    ? now - victoryAnimationStart
    : 0;

  /* ---------- Background (radial + vignette) ---------- */
  {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COLORS.bgTop);
    bg.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // subtle vignette
    const vg = ctx.createRadialGradient(
      W * 0.5,
      H * 0.35,
      Math.min(W, H) * 0.15,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.75
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, COLORS.vignette);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- Board plate (outer + inner) ---------- */
  drawPlate(ctx, W, H, TILE);

  /* ---------- Cells (holes + dice) ---------- */
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r]?.[c] ?? EMPTY;

      const cx = c * TILE + TILE / 2;
      const cy = r * TILE + TILE / 2;

      // hole
      drawHole(ctx, cx, cy, TILE);

      // Skip drawing dice in the target cell if there's an active animation targeting it
      const isAnimatingToThisCell = anim && anim.toR === r && anim.toC === c && animT01 < 1;
      
      if (cell !== EMPTY && !isAnimatingToThisCell) {
        const isWinner = !!winSet && winSet.has(`${r},${c}`);
        
        // Elegant, minimalist winner animation: subtle scale, gentle rotation, soft glow
        // Rotation only starts after victory animation delay
        const winScale = isWinner ? 1.03 : 1; // Very subtle 3% larger
        const winRotation = isWinner && victoryAnimationTime > 0
          ? ((victoryAnimationTime / 4000) % 1) * Math.PI * 2
          : 0; // Slow, elegant rotation (4 seconds) - starts after delay
        const winGlow = isWinner && victoryAnimationTime > 0
          ? 0.3 + Math.sin(victoryAnimationTime / 2000) * 0.1
          : 0; // Gentle, subtle pulsing glow - starts after delay

        drawDice(ctx, cx, cy, cell, TILE, winScale, isWinner, false, now, winRotation, winGlow, victoryAnimationTime);
      }
    }
  }

  /* ---------- Hover column highlight (drawn after board and cells) ---------- */
  const hovered = typeof state.hoveredCol === 'number' ? clampInt(state.hoveredCol, 0, COLS - 1) : null;
  if (hovered !== null) {
    const c = hovered;
    const leftX = c * TILE; // Left edge of the column
    const rightX = (c + 1) * TILE; // Right edge of the column

    ctx.save();
    
    // Very subtle background glow with smooth gradient
    const bgGradient = ctx.createLinearGradient(leftX, 0, rightX, 0);
    bgGradient.addColorStop(0, 'rgba(108,124,255,0)');
    bgGradient.addColorStop(0.3, 'rgba(108,124,255,0.03)');
    bgGradient.addColorStop(0.7, 'rgba(108,124,255,0.03)');
    bgGradient.addColorStop(1, 'rgba(108,124,255,0)');
    ctx.fillStyle = bgGradient;
    ctx.globalAlpha = 1;
    ctx.fillRect(leftX, 0, TILE, H);
    
    // Smooth vertical gradient lines on the sides (fade at top and bottom) - more subtle
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(108,124,255,0.3)';
    ctx.shadowBlur = 4;
    
    // Left edge line with smooth gradient and glow (only if not first column)
    if (c > 0) {
      const lineGradientLeft = ctx.createLinearGradient(0, 0, 0, H);
      lineGradientLeft.addColorStop(0, 'rgba(108,124,255,0)');
      lineGradientLeft.addColorStop(0.1, 'rgba(108,124,255,0.2)');
      lineGradientLeft.addColorStop(0.5, 'rgba(108,124,255,0.3)');
      lineGradientLeft.addColorStop(0.9, 'rgba(108,124,255,0.2)');
      lineGradientLeft.addColorStop(1, 'rgba(108,124,255,0)');
      
      ctx.strokeStyle = lineGradientLeft;
      ctx.beginPath();
      ctx.moveTo(leftX, 0);
      ctx.lineTo(leftX, H);
      ctx.stroke();
    }
    
    // Right edge line with smooth gradient and glow (only if not last column)
    if (c < COLS - 1) {
      const lineGradientRight = ctx.createLinearGradient(0, 0, 0, H);
      lineGradientRight.addColorStop(0, 'rgba(108,124,255,0)');
      lineGradientRight.addColorStop(0.1, 'rgba(108,124,255,0.2)');
      lineGradientRight.addColorStop(0.5, 'rgba(108,124,255,0.3)');
      lineGradientRight.addColorStop(0.9, 'rgba(108,124,255,0.2)');
      lineGradientRight.addColorStop(1, 'rgba(108,124,255,0)');
      
      ctx.strokeStyle = lineGradientRight;
      ctx.beginPath();
      ctx.moveTo(rightX, 0);
      ctx.lineTo(rightX, H);
      ctx.stroke();
    }
    
    // Reset shadow
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  /* ---------- Winner connecting lines (drawn above dice) ---------- */
  if (winCells && winCells.length >= 4 && _lastPlacedDisc) {
    drawWinnerLines(ctx, winCells, _lastPlacedDisc, { tile: TILE, winnerLine: { progress: lineProgress } });
  }

  /* ---------- Animated falling dice ---------- */
  if (anim) {
    const cx = anim.col * TILE + TILE / 2;
    const targetY = anim.toR * TILE + TILE / 2;

    const fall = easeOutBounce(animT01);
    const y = lerp(anim.fromY, targetY, fall);

    // No rotation, no pop, no impact effect - clean falling animation
    drawDice(ctx, cx, y, anim.piece, TILE, 1, false, false, now, 0, 0);
  }
}

/* =========================================================
   Drawing helpers
   ========================================================= */

function drawPlate(ctx: CanvasRenderingContext2D, W: number, H: number, TILE: number) {
  // Outer plate
  const outer = ctx.createLinearGradient(0, 0, 0, H);
  outer.addColorStop(0, COLORS.plateOuterA);
  outer.addColorStop(1, COLORS.plateOuterB);
  fillRoundRect(ctx, 0, 0, W, H, TILE * 0.18, outer);

  // Inner plate inset
  const inset = TILE * 0.07;
  const inner = ctx.createLinearGradient(0, inset, 0, H - inset);
  inner.addColorStop(0, COLORS.plateInnerA);
  inner.addColorStop(1, COLORS.plateInnerB);
  fillRoundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, TILE * 0.16, inner);

  // Rim lines
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.strokeStyle = COLORS.rimHi;
  ctx.lineWidth = 2;
  strokeRoundRect(ctx, inset + 1, inset + 1, W - inset * 2 - 2, H - inset * 2 - 2, TILE * 0.16);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = COLORS.rim;
  ctx.lineWidth = 1.5;
  strokeRoundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, TILE * 0.16);
  ctx.restore();
}

function drawHole(ctx: CanvasRenderingContext2D, cx: number, cy: number, TILE: number) {
  const r = TILE * 0.36;

  // surface gradient (bright rim)
  const g = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.15, r * 0.05, cx, cy, r);
  g.addColorStop(0, COLORS.holeSurfaceA);
  g.addColorStop(1, COLORS.holeSurfaceB);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // inner shadow
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.06, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.holeInnerShadow;
  ctx.fill();
  ctx.restore();
}

function drawDice(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: Cell,
  TILE: number,
  scale: number,
  isWinner: boolean,
  impact: boolean,
  _now: number,
  rotation: number = 0,
  glowIntensity: number = 0,
  victoryAnimationTime: number = 0
) {
  // Match the hole radius precisely: TILE * 0.36
  const holeRadius = TILE * 0.36;
  const discRadius = holeRadius * 0.92 * scale; // Slightly smaller to show inlay gap, scaled for animation

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  // Retro neon colors (red vs yellow/cyan)
  const isRed = cell === RED;
  let neonColor = isRed ? '#ff4b4b' : '#ffd54a';
  let brightColor = isRed ? '#d61f2b' : '#f3b41a';
  let darkColor = isRed ? '#7a0f19' : '#8a5a00';
  
  // Aggressive color shift for winning discs
  if (isWinner && victoryAnimationTime > 0) {
    const colorShift = Math.sin(victoryAnimationTime / 1000) * 0.6; // More aggressive color shift
    if (isRed) {
      // Shift red towards orange/pink more dramatically
      const hueShift = colorShift * 30; // Shift hue by up to 30 degrees
      neonColor = shiftColorHue('#ff4b4b', hueShift);
      brightColor = shiftColorHue('#d61f2b', hueShift * 0.8);
      darkColor = shiftColorHue('#7a0f19', hueShift * 0.6);
    } else {
      // Shift yellow towards gold/amber more dramatically
      const hueShift = colorShift * -25; // Shift hue by up to -25 degrees
      neonColor = shiftColorHue('#ffd54a', hueShift);
      brightColor = shiftColorHue('#f3b41a', hueShift * 0.8);
      darkColor = shiftColorHue('#8a5a00', hueShift * 0.6);
    }
  }

  // Draw smooth retro neon disc
  drawDiceDisc(ctx, discRadius, holeRadius, neonColor, brightColor, darkColor, isWinner, TILE);

  // Elegant, minimalist additional glow (very subtle)
  if (isWinner && glowIntensity > 0) {
    const depthOffset = TILE * 0.02;
    const glowSize = discRadius * 1.12; // Smaller, more subtle
    const glowAlpha = glowIntensity * 0.4; // Much more subtle
    
    // Soft, gentle outer glow
    ctx.save();
    const winnerGlowGradient = ctx.createRadialGradient(0, 0, discRadius, 0, 0, glowSize);
    // Convert hex to rgba for opacity
    const r = parseInt(neonColor.slice(1, 3), 16);
    const g = parseInt(neonColor.slice(3, 5), 16);
    const b = parseInt(neonColor.slice(5, 7), 16);
    winnerGlowGradient.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
    winnerGlowGradient.addColorStop(0.6, `rgba(${r},${g},${b},${glowAlpha * 0.6})`);
    winnerGlowGradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = winnerGlowGradient;
    ctx.beginPath();
    ctx.arc(0, depthOffset, glowSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Shadow drop (stronger on impact)
  if (impact) {
    ctx.save();
    ctx.resetTransform();
    const depthOffset = TILE * 0.02;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    ctx.arc(cx, cy + depthOffset, discRadius * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawDiceDisc(
  ctx: CanvasRenderingContext2D,
  discRadius: number,
  holeRadius: number,
  neonColor: string,
  brightColor: string,
  darkColor: string,
  isWinner: boolean,
  TILE: number
) {
  const r = discRadius;
  const depthOffset = TILE * 0.02;

  // Retro neon glow - outer glow effect
  ctx.save();
  const glowGradient = ctx.createRadialGradient(0, 0, r, 0, 0, holeRadius);
  glowGradient.addColorStop(0, neonColor + '80'); // 50% opacity
  glowGradient.addColorStop(0.7, neonColor + '40');
  glowGradient.addColorStop(1, neonColor + '00');
  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(0, depthOffset, holeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inlay shadow - simple dark ring
  ctx.save();
  const inlayShadow = ctx.createRadialGradient(0, 0, r, 0, 0, holeRadius);
  inlayShadow.addColorStop(0, 'rgba(0,0,0,0)');
  inlayShadow.addColorStop(0.9, 'rgba(0,0,0,0)');
  inlayShadow.addColorStop(0.97, 'rgba(0,0,0,0.6)');
  inlayShadow.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = inlayShadow;
  ctx.beginPath();
  ctx.arc(0, depthOffset, holeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Main disc - smooth retro neon gradient
  const mainGradient = ctx.createRadialGradient(
    -r * 0.25,
    -r * 0.25,
    r * 0.2,
    0,
    0,
    r
  );
  mainGradient.addColorStop(0, brightColor);
  mainGradient.addColorStop(0.5, neonColor);
  mainGradient.addColorStop(0.85, darkColor);
  mainGradient.addColorStop(1, darkColor + 'cc'); // 80% opacity

  ctx.fillStyle = mainGradient;
  ctx.beginPath();
  ctx.arc(0, depthOffset, r, 0, Math.PI * 2);
  ctx.fill();

  // Retro neon edge glow
  ctx.save();
  ctx.strokeStyle = brightColor;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = neonColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, depthOffset, r * 0.98, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Simple bottom shadow for depth
  ctx.save();
  const bottomShadow = ctx.createRadialGradient(
    0,
    depthOffset + r * 0.25,
    0,
    0,
    depthOffset + r * 0.25,
    r * 0.85
  );
  bottomShadow.addColorStop(0, 'rgba(0,0,0,0.5)');
  bottomShadow.addColorStop(0.7, 'rgba(0,0,0,0.2)');
  bottomShadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bottomShadow;
  ctx.beginPath();
  ctx.arc(0, depthOffset + r * 0.12, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Elegant, minimalist winner glow effect
  if (isWinner) {
    ctx.save();
    // Soft, subtle outer glow
    const winnerGlow = ctx.createRadialGradient(0, 0, r, 0, 0, r * 1.15);
    winnerGlow.addColorStop(0, neonColor + '40'); // Very subtle
    winnerGlow.addColorStop(0.7, neonColor + '20');
    winnerGlow.addColorStop(1, neonColor + '00');
    ctx.fillStyle = winnerGlow;
    ctx.beginPath();
    ctx.arc(0, depthOffset, r * 1.15, 0, Math.PI * 2);
    ctx.fill();
    
    // Subtle edge highlight
    ctx.strokeStyle = brightColor + '60'; // 40% opacity
    ctx.lineWidth = 1.5;
    ctx.shadowColor = neonColor + '30';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, depthOffset, r * 0.99, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Simple inlay rim
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, depthOffset, r * 1.01, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWinnerLines(
  ctx: CanvasRenderingContext2D,
  cells: Array<[number, number]>,
  _lastPlacedDisc: { r: number; c: number } | null,
  cfg: RenderConfig
) {
  if (!cells || cells.length === 0) return;

  // ✅ Always draw from the left-most winning disc to the right-most.
  // Primary: column (c) ascending. Secondary: row (r) ascending.
  const orderedCells = [...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

  const winnerCoords = orderedCells.map(([r, c]) => ({
    x: c * cfg.tile + cfg.tile / 2,
    y: r * cfg.tile + cfg.tile / 2,
  }));

  const lineProgress = cfg.winnerLine?.progress ?? 1;
  const glowW = cfg.tile * 0.13;

  // Total polyline length (used for progressive drawing)
  let totalLen = 0;
  for (let i = 0; i < winnerCoords.length - 1; i++) {
    totalLen += Math.hypot(
      winnerCoords[i + 1].x - winnerCoords[i].x,
      winnerCoords[i + 1].y - winnerCoords[i].y
    );
  }
  if (totalLen <= 0) return;

  let remaining = totalLen * clamp01(lineProgress);

  let tipX: number | null = null;
  let tipY: number | null = null;

  for (let i = 0; i < winnerCoords.length - 1; i++) {
    if (remaining <= 0) break;

    const a = winnerCoords[i];
    const b = winnerCoords[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= 0) continue;

    const drawLen = Math.min(segLen, remaining);
    const t = drawLen / segLen;

    const endX = a.x + (b.x - a.x) * t;
    const endY = a.y + (b.y - a.y) * t;

    // Outer glow
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(endX, endY);
    ctx.lineWidth = glowW;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.shadowBlur = glowW * 2.2;
    ctx.shadowColor = 'rgba(255,255,255,0.22)';
    ctx.stroke();
    ctx.restore();

    // Inner bright line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(endX, endY);
    ctx.lineWidth = glowW * 0.45;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowBlur = glowW * 1.2;
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();

    tipX = endX;
    tipY = endY;

    remaining -= drawLen;
  }

  // Tip dot (at the current end of the animated line)
  if (tipX != null && tipY != null) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(tipX, tipY, glowW * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.shadowBlur = glowW * 1.2;
    ctx.shadowColor = 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.restore();
  }
}


function makeWinnerSet(winner?: Winner | null): Set<string> | null {
  if (!winner || winner.kind !== 'WIN') return null;
  // Try both 'line' and 'cells' properties for compatibility
  const cells = (winner as any).line || (winner as any).cells;
  if (!Array.isArray(cells)) return null;
  const s = new Set<string>();
  for (const pos of cells) {
    if (Array.isArray(pos)) {
      s.add(`${pos[0]},${pos[1]}`);
    } else if (pos && typeof pos.r === 'number' && typeof pos.c === 'number') {
      s.add(`${pos.r},${pos.c}`);
    }
  }
  return s;
}

function extractWinnerCells(winner?: Winner | null): Array<[number, number]> | null {
  if (!winner || winner.kind !== 'WIN') return null;
  // Try both 'line' and 'cells' properties for compatibility
  const cells = (winner as any).line || (winner as any).cells;
  if (!Array.isArray(cells)) return null;
  return cells.map((pos: any) => {
    if (Array.isArray(pos)) return [pos[0], pos[1]] as [number, number];
    if (pos && typeof pos.r === 'number' && typeof pos.c === 'number') {
      return [pos.r, pos.c] as [number, number];
    }
    return null;
  }).filter((x: any): x is [number, number] => x !== null);
}

/* =========================================================
   Low-level shapes
   ========================================================= */

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.stroke();
}

/* =========================================================
   Math
   ========================================================= */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v | 0));
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function shiftColorHue(hex: string, hueShift: number): string {
  // Parse hex color
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  // Convert RGB to HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  // Shift hue
  h = (h * 360 + hueShift) % 360;
  if (h < 0) h += 360;
  h = h / 360;
  
  // Convert HSL back to RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  
  let newR = 0, newG = 0, newB = 0;
  if (h < 1/6) {
    newR = c; newG = x; newB = 0;
  } else if (h < 2/6) {
    newR = x; newG = c; newB = 0;
  } else if (h < 3/6) {
    newR = 0; newG = c; newB = x;
  } else if (h < 4/6) {
    newR = 0; newG = x; newB = c;
  } else if (h < 5/6) {
    newR = x; newG = 0; newB = c;
  } else {
    newR = c; newG = 0; newB = x;
  }
  
  newR = Math.round((newR + m) * 255);
  newG = Math.round((newG + m) * 255);
  newB = Math.round((newB + m) * 255);
  
  // Convert back to hex
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}
