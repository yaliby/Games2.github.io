// components/BlockBlast/render/renderer.ts
import type { Board, BlockShape, Pos } from '../engine/types';
import { ROWS, COLS } from '../engine/types';

const PALETTE = [
  '#ff4df9', // pink-red
  '#4DFFB5', // mint
  '#4DA3FF', // blue
  '#FFD34A', // yellow
  '#B84DFF', // purple
  '#FF8A4D', // orange
  '#4DFFF3', // cyan
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
