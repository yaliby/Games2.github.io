// components/BlockBlast/render/renderer.ts
import type { Board, BlockShape, Pos } from '../engine/types';
import { ROWS, COLS } from '../engine/types';
import type { ComboFxPayload } from "../engine/types";

type FxEvent =
  | { kind: "flash"; t0: number; dur: number; strength: number }
  | { kind: "shake"; t0: number; dur: number; amp: number }
  | { kind: "shockwave"; t0: number; dur: number; x: number; y: number; strength: number }
  | { kind: "particles"; t0: number; dur: number; parts: Array<{ x:number;y:number;vx:number;vy:number;life:number }> }
  | { kind: "glitch"; t0: number; dur: number; strength: number };

const fxQueue: FxEvent[] = [];

// helper: ms clock
const nowMs = () => performance.now();

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }


export function playComboFx(fx: ComboFxPayload, cellToPx: (r:number,c:number)=>{x:number;y:number}) {
  const t0 = nowMs();

  // בסיס: flash + shake
  fxQueue.push({ kind: "flash", t0, dur: 140 + fx.level*40, strength: 0.10 + fx.level*0.06 });
  fxQueue.push({ kind: "shake", t0, dur: 90 + fx.level*35, amp: 1.8 + fx.level*2.2 });

  // origin
  const o = fx.origin ?? (fx.clearedCells[0] ?? { r: 0, c: 0 });
  const p = cellToPx(o.r, o.c);

  // shockwave מרמה 2
  if (fx.level >= 2) {
    fxQueue.push({ kind: "shockwave", t0, dur: 260 + fx.level*60, x: p.x, y: p.y, strength: 0.55 + fx.level*0.25 });
  }

  // particles מרמה 2, מסלים עם כמות הניקוי
  if (fx.level >= 2 && fx.clearedCells.length > 0) {
    const parts: Array<{x:number;y:number;vx:number;vy:number;life:number}> = [];
    const count = clamp(30 + fx.level*35 + fx.clearedCount*18, 40, 260);

    for (let i=0;i<count;i++){
      const cell = fx.clearedCells[(Math.random()*fx.clearedCells.length)|0];
      const pt = cellToPx(cell.r, cell.c);
      const a = Math.random()*Math.PI*2;
      const sp = 0.35 + Math.random()*(0.65 + fx.level*0.22);
      parts.push({ x: pt.x, y: pt.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 180 + Math.random()*(260 + fx.level*120) });
    }
    fxQueue.push({ kind:"particles", t0, dur: 520 + fx.level*160, parts });
  }

  // glitch pulse מרמה 4+
  if (fx.level >= 4) {
    fxQueue.push({ kind: "glitch", t0, dur: 220 + fx.level*70, strength: 0.35 + fx.level*0.18 });
  }
}




export function drawFxLayer(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const t = nowMs();

  // נקה expired
  for (let i = fxQueue.length - 1; i >= 0; i--) {
    const e = fxQueue[i];
    if (t > e.t0 + e.dur) fxQueue.splice(i, 1);
  }

  // shake: מחושב כ-offset, תיישם אותו מחוץ לפונקציה אם יש לך כבר shake system.
  // כאן אנחנו עושים "cheap shake": translate ואז restore.
  let sx = 0, sy = 0;
  for (const e of fxQueue) {
    if (e.kind !== "shake") continue;
    const k = 1 - clamp((t - e.t0) / e.dur, 0, 1);
    sx += (Math.random()*2 - 1) * e.amp * k;
    sy += (Math.random()*2 - 1) * e.amp * k;
  }
  if (sx || sy) ctx.translate(sx, sy);

  // flash overlay
  for (const e of fxQueue) {
    if (e.kind !== "flash") continue;
    const k = 1 - clamp((t - e.t0) / e.dur, 0, 1);
    ctx.save();
    ctx.globalAlpha = e.strength * k;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // shockwave ring
  for (const e of fxQueue) {
    if (e.kind !== "shockwave") continue;
    const u = clamp((t - e.t0) / e.dur, 0, 1);
    const r = (Math.min(w, h) * 0.08) + u * (Math.min(w, h) * 0.55);
    const a = (1 - u) * 0.55 * e.strength;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineWidth = 6 * (1 - u) + 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  // particles
  for (const e of fxQueue) {
    if (e.kind !== "particles") continue;
    const dt = (t - e.t0);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";
    for (const p of e.parts) {
      const lifeLeft = clamp(1 - dt / p.life, 0, 1);
      const x = p.x + p.vx * dt;
      const y = p.y + p.vy * dt;
      const s = 3.2 * lifeLeft + 0.6;
      ctx.globalAlpha = 0.9 * lifeLeft;
      ctx.fillRect(x - s/2, y - s/2, s, s);
    }
    ctx.restore();
  }

  // glitch (cheap): כמה פסי noise לבנים
  for (const e of fxQueue) {
    if (e.kind !== "glitch") continue;
    const u = clamp((t - e.t0) / e.dur, 0, 1);
    const k = (1 - u) * e.strength;
    ctx.save();
    ctx.globalAlpha = 0.28 * k;
    ctx.fillStyle = "#ffffff";
    const bars = 8 + ((18 * k) | 0);
    for (let i=0;i<bars;i++){
      const y = (Math.random()*h)|0;
      const hh = 2 + ((8*Math.random()*k)|0);
      ctx.fillRect(0, y, w, hh);
    }
    ctx.restore();
  }

  if (sx || sy) ctx.translate(-sx, -sy);
}
















const PALETTE = [
  '#009e378f',
  '#4DFFB5',
  '#4DA3FF',
  '#FFD34A',
  '#B84DFF',
  '#FF8A4D',
  '#4DFFF3',
];

type Preview = {
  shape: BlockShape;
  pos: Pos;
  valid: boolean;
  colorId: number;
} | null;

type Flash = {
  rows: number[];
  cols: number[];
  cells: Array<{ r: number; c: number; colorId: number }>;
  start: number;
  duration: number;
} | null;

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  tile: number,
  preview: Preview = null,
  flash: Flash = null
) {
  const W = COLS * tile;
  const H = ROWS * tile;

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#070A12');
  bg.addColorStop(1, '#0B1222');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // grid + tiles
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * tile;
      const y = r * tile;

      ctx.save();
      const cell = board[r][c];

      const baseEmpty = (r + c) % 2 === 0 ? '#141A2A' : '#101628';

      // shadow
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      roundRect(ctx, x + 2, y + 3, tile - 4, tile - 4, Math.max(6, tile * 0.18));
      ctx.fill();

      // body
      ctx.globalAlpha = 1;

      if (cell === 0) {
        ctx.fillStyle = baseEmpty;
        roundRect(ctx, x + 1, y + 1, tile - 4, tile - 4, Math.max(6, tile * 0.18));
        ctx.fill();
      } else {
        const color = PALETTE[(cell - 1) % PALETTE.length];

        ctx.fillStyle = color;
        roundRect(ctx, x + 1, y + 1, tile - 4, tile - 4, Math.max(6, tile * 0.18));
        ctx.fill();

        // glossy highlight
        ctx.globalAlpha = 0.22;
        const g = ctx.createLinearGradient(x, y, x + tile, y + tile);
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        roundRect(ctx, x + 1, y + 1, tile - 4, tile - 4, Math.max(6, tile * 0.18));
        ctx.fill();

        // glow
        ctx.globalAlpha = 0.22;
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = color;
        roundRect(ctx, x + 1, y + 1, tile - 4, tile - 4, Math.max(6, tile * 0.18));
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // preview ghost
  if (preview) {
    const { shape, pos, valid, colorId } = preview;
    const color = PALETTE[(colorId - 1) % PALETTE.length];

    ctx.save();
    ctx.globalAlpha = valid ? 0.35 : 0.22;
    ctx.fillStyle = valid ? color : '#FF4D6D';
    ctx.shadowColor = valid ? color : '#FF4D6D';
    ctx.shadowBlur = 14;

    for (const p of shape) {
      const rr = pos.r + p.r;
      const cc = pos.c + p.c;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;

      const x = cc * tile;
      const y = rr * tile;
      roundRect(ctx, x + 2, y + 2, tile - 6, tile - 6, Math.max(6, tile * 0.18));
      ctx.fill();
    }
    ctx.restore();
  }

  // flash cleared lines (break animation + beam)
  if (flash) {
    const now = performance.now();
    const p = (now - flash.start) / flash.duration;

    if (p >= 0 && p <= 1.15) {
      // eased progress (snappy at start, smooth at end)
      const t = Math.max(0, Math.min(1, p));
      const easeOutCubic = 1 - Math.pow(1 - t, 3);

      ctx.save();

      // 1) sweeping beam across cleared rows/cols
      const beamAlpha = (1 - t) * 0.55;
      if (beamAlpha > 0.001) {
        ctx.globalAlpha = beamAlpha;

        // rows
        for (const r of flash.rows) {
          const y = r * tile;
          const g = ctx.createLinearGradient(0, y, W, y + tile);
          g.addColorStop(0, 'rgba(138,180,255,0)');
          g.addColorStop(0.35, 'rgba(138,180,255,0.9)');
          g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
          g.addColorStop(1, 'rgba(138,180,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, y, W, tile);
        }

        // cols
        for (const c of flash.cols) {
          const x = c * tile;
          const g = ctx.createLinearGradient(x, 0, x + tile, H);
          g.addColorStop(0, 'rgba(138,180,255,0)');
          g.addColorStop(0.35, 'rgba(138,180,255,0.9)');
          g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
          g.addColorStop(1, 'rgba(138,180,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, tile, H);
        }
      }

      // 2) tile "shatter" (shrink + fade + glow) using saved cells
      const fade = 1 - t;
      const shrink = 1 - easeOutCubic * 0.75;

      for (const cell of flash.cells) {
        const x0 = cell.c * tile;
        const y0 = cell.r * tile;

        // subtle jitter that dies out
        const j = (1 - t) * 1.6;
        const jx = Math.sin((cell.r * 37 + cell.c * 11 + now * 0.04)) * j;
        const jy = Math.cos((cell.r * 19 + cell.c * 23 + now * 0.05)) * j;

        const cx = x0 + tile / 2 + jx;
        const cy = y0 + tile / 2 + jy;

        const w = Math.max(1, (tile - 6) * shrink);
        const h = Math.max(1, (tile - 6) * shrink);

        const color = PALETTE[(cell.colorId - 1) % PALETTE.length];

        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.95 * fade;
        ctx.shadowColor = color;
        ctx.shadowBlur = 22 * fade;

        // outer pop
        ctx.fillStyle = color;
        roundRect(ctx, -w / 2, -h / 2, w, h, Math.max(6, tile * 0.18));
        ctx.fill();

        // white core flash (quick)
        const core = Math.max(0, 1 - t * 2.2);
        if (core > 0) {
          ctx.globalAlpha = 0.55 * core;
          ctx.shadowColor = '#FFFFFF';
          ctx.shadowBlur = 18 * core;
          ctx.fillStyle = '#FFFFFF';
          roundRect(ctx, -w / 2 + 2, -h / 2 + 2, Math.max(1, w - 4), Math.max(1, h - 4), Math.max(6, tile * 0.18));
          ctx.fill();
        }

        ctx.restore();
      }

      ctx.restore();
    }
  }
  drawFxLayer(ctx, W, H);
}

function roundRect(
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
}
