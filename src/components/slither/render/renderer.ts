// src/render/renderer.ts
import type { Vec, World, Snake, Pellet } from '../engine/types';

export type View = { w: number; h: number; cam: Vec };


function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function wrapAngle(a: number) {
  const TAU = Math.PI * 2;
  while (a <= -Math.PI) a += TAU;
  while (a > Math.PI) a -= TAU;
  return a;
}
function lerpAngle(a: number, b: number, t: number) {
  const d = wrapAngle(b - a);
  return a + d * t;
}

// --- Cache ---
type PelletSpriteKind = 'normal' | 'death';
const pelletSpriteCache = new Map<string, HTMLCanvasElement>();
function pelletKey(kind: PelletSpriteKind, r: number) { return `${kind}:${Math.round(r * 2) / 2}`; }

function makePelletSprite(kind: PelletSpriteKind, r: number): HTMLCanvasElement {
  const glowR = r * 5.5;
  const size = Math.ceil(glowR + 2) * 2;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const gctx = c.getContext('2d');
  if (!gctx) return c;

  const cx = size / 2, cy = size / 2;

  let glow: CanvasGradient | null = null;
  try {
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(glowR) && glowR > 0.001) {
      glow = gctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    }
  } catch {
    glow = null;
  }

  if (glow) {
    glow.addColorStop(0, kind === 'death' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.10)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = glow;
    gctx.beginPath(); gctx.arc(cx, cy, glowR, 0, Math.PI * 2); gctx.fill();
  } else {
    // Fallback: soft alpha circle (no gradient)
    gctx.fillStyle = kind === 'death' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
    gctx.beginPath(); gctx.arc(cx, cy, Math.max(r * 3.0, 1), 0, Math.PI * 2); gctx.fill();
  }

  gctx.fillStyle = kind === 'death' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.80)';
  gctx.beginPath(); gctx.arc(cx, cy, r, 0, Math.PI * 2); gctx.fill();

  return c;
}

function getPelletSprite(kind: PelletSpriteKind, r: number) {
  const k = pelletKey(kind, r);
  let s = pelletSpriteCache.get(k);
  if (!s) { s = makePelletSprite(kind, r); pelletSpriteCache.set(k, s); }
  return s;
}

function getPelletSpriteCachedOnPellet(p: Pellet): HTMLCanvasElement {
  // PERF: avoid building Map keys (strings) every frame.
  const anyP = p as any;
  const kind = (p.kind ?? 'normal') as PelletSpriteKind;
  let sprite: HTMLCanvasElement | undefined = anyP._sprite;
  if (!sprite || anyP._spriteKind !== kind || anyP._spriteR !== p.r) {
    sprite = getPelletSprite(kind, p.r);
    anyP._sprite = sprite;
    anyP._spriteKind = kind;
    anyP._spriteR = p.r;
  }
  return sprite;
}

let bgCache: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;
function getBackground(w: number, h: number) {
  if (bgCache && bgCache.w === w && bgCache.h === h) return bgCache.canvas;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);

    let g: CanvasGradient | null = null;
    try {
      g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
    } catch {
      g = null;
    }
    if (g) {
      g.addColorStop(0, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  bgCache = { w, h, canvas: c };
  return c;
}

// --- Draw helpers ---
function drawGrid(ctx: CanvasRenderingContext2D, view: View, camX: number, camY: number) {
  const base = Math.min(view.w, view.h);
  const grid = clamp(base * 0.08, 28, 70);

  ctx.save();
  ctx.globalAlpha = 0.05;

  const ox = (view.w / 2 - (camX % grid));
  const oy = (view.h / 2 - (camY % grid));

  ctx.beginPath();
  for (let x = -grid; x <= view.w + grid; x += grid) { ctx.moveTo(x + ox, -grid); ctx.lineTo(x + ox, view.h + grid); }
  for (let y = -grid; y <= view.h + grid; y += grid) { ctx.moveTo(-grid, y + oy); ctx.lineTo(view.w + grid, y + oy); }

  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function buildSnakePath(ctx: CanvasRenderingContext2D, view: View, s: Snake, camX: number, camY: number, alpha: number) {
  const pts = s.points;
  const n = pts.length;
  if (!n) return false;

  const prev = s._prev;
  const prevLen = s._prevLen ?? 0;

  const halfW = view.w * 0.5;
  const halfH = view.h * 0.5;

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let x = p.x, y = p.y;

    if (prev && i < prevLen) {
      const j = i * 2;
      const px = prev[j];
      const py = prev[j + 1];
      x = px + (x - px) * alpha;
      y = py + (y - py) * alpha;
    }

    const sx = (x - camX) + halfW;
    const sy = (y - camY) + halfH;

    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  return true;
}

function drawSnakeBody(ctx: CanvasRenderingContext2D, view: View, s: Snake, camX: number, camY: number, alpha: number) {
  if (!s.points.length) return;

  // simple cull by head
  const head = s.points[0];
  const sx0 = (head.x - camX) + view.w * 0.5;
  const sy0 = (head.y - camY) + view.h * 0.5;
  const pad = 200;
  if (sx0 < -pad || sx0 > view.w + pad || sy0 < -pad || sy0 > view.h + pad) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (!buildSnakePath(ctx, view, s, camX, camY, alpha)) { ctx.restore(); return; }

  // outline then color stroke WITHOUT rebuilding path
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = s.radius * 1.65;
  ctx.stroke();

  // subtle player glow
  if (s.isPlayer) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = s.radius * 2.25;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.radius * 1.2;
  ctx.stroke();

  ctx.restore();
}

function drawSnakeHead(ctx: CanvasRenderingContext2D, view: View, s: Snake, camX: number, camY: number, alpha: number) {
  if (!s.points.length) return;

  const pts = s.points;
  const prev = s._prev;
  const prevLen = s._prevLen ?? 0;

  let x = pts[0].x, y = pts[0].y;
  if (prev && prevLen > 0) {
    const px = prev[0], py = prev[1];
    x = px + (x - px) * alpha;
    y = py + (y - py) * alpha;
  }

  const headX = (x - camX) + view.w * 0.5;
  const headY = (y - camY) + view.h * 0.5;

  // Guard against NaN/Infinity coming from simulation/interpolation
  if (!Number.isFinite(headX) || !Number.isFinite(headY) || !Number.isFinite(s.radius) || s.radius <= 0) return;

  const dir0 = (s._prevDir != null ? s._prevDir : s.dir);
  const dir = lerpAngle(dir0, s.dir, alpha);

  ctx.save();

  // head body
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(headX, headY, s.radius * 0.95, 0, Math.PI * 2);
  ctx.fill();  // specular highlight (guarded: createRadialGradient throws on non-finite args)
  const r = s.radius;
  if (Number.isFinite(r) && r > 0.001) {
    let g: CanvasGradient | null = null;
    try {
      g = ctx.createRadialGradient(headX - r * 0.35, headY - r * 0.35, 0, headX, headY, r * 1.2);
    } catch {
      g = null;
    }
    if (g) {
      g.addColorStop(0, 'rgba(255,255,255,0.30)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(headX, headY, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // eyes
  const ex = Math.cos(dir), ey = Math.sin(dir);
  const px2 = -ey, py2 = ex;
  const eoff = s.radius * 0.55;
  const eside = s.radius * 0.25;
  const er = s.radius * 0.18;

  const ex1 = headX + ex * eoff + px2 * eside;
  const ey1 = headY + ey * eoff + py2 * eside;
  const ex2 = headX + ex * eoff - px2 * eside;
  const ey2 = headY + ey * eoff - py2 * eside;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(ex1, ey1, er * 1.2, 0, Math.PI * 2);
  ctx.arc(ex2, ey2, er * 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath();
  ctx.arc(ex1, ey1, er, 0, Math.PI * 2);
  ctx.arc(ex2, ey2, er, 0, Math.PI * 2);
  ctx.fill();

  // tiny pupil
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.arc(ex1 + ex * er * 0.3, ey1 + ey * er * 0.3, er * 0.35, 0, Math.PI * 2);
  ctx.arc(ex2 + ex * er * 0.3, ey2 + ey * er * 0.3, er * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // boost trail hint
  if (s.boosting) {
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = s.radius * 0.6;
    ctx.beginPath();
    ctx.moveTo(headX - ex * s.radius * 2.4, headY - ey * s.radius * 2.4);
    ctx.lineTo(headX - ex * s.radius * 4.2, headY - ey * s.radius * 4.2);
    ctx.stroke();
  }

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawLeaderboard(ctx: CanvasRenderingContext2D, world: World) {
  const lb = world.leaderboard ?? [];
  if (!lb.length) return;

  const x = 12, y = 12, w = 220, rowH = 20, h = 12 + lb.length * rowH + 10;

  ctx.save();
  ctx.globalAlpha = 0.95;

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'white';
  ctx.font = '900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('LEADERBOARD', x + 14, y + 18);

  ctx.font = '700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  for (let i = 0; i < lb.length; i++) {
    const r = lb[i];
    const ry = y + 34 + i * rowH;

    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(x + 16, ry - 4, 4.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.fillText(`${i + 1}. ${r.name}`, x + 28, ry);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${Math.round(r.score)}`, x + w - 14, ry);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}

function drawToast(ctx: CanvasRenderingContext2D, world: World, view: View) {
  if (world.events?.playerDiedAt != null) {
    const t = (world.tick - world.events.playerDiedAt);
    if (t < 1.2) {
      ctx.save();
      ctx.globalAlpha = 1 - t / 1.2;
      ctx.fillStyle = 'white';
      ctx.font = '950 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('You Died — Respawning…', view.w / 2, view.h * 0.2);
      ctx.restore();
    }
  }
}

/**
 * Draw the world.
 * @param alpha Interpolation factor between previous fixed-step state (0) and current (1).
 */
export function drawWorld(ctx: CanvasRenderingContext2D, world: World, view: View, alpha = 1) {
  const camX = view.cam.x;
  const camY = view.cam.y;

  ctx.drawImage(getBackground(view.w, view.h), 0, 0);
  drawGrid(ctx, view, camX, camY);

  // Visible bounds (cull)
  const margin = 140;
  const minX = camX - view.w / 2 - margin, maxX = camX + view.w / 2 + margin;
  const minY = camY - view.h / 2 - margin, maxY = camY + view.h / 2 + margin;

  // Pellets
  const halfW = view.w * 0.5;
  const halfH = view.h * 0.5;

  for (let i = 0; i < world.pellets.length; i++) {
    const p = world.pellets[i];
    const wx = p.pos.x;
    const wy = p.pos.y;
    if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;

    const sprite = getPelletSpriteCachedOnPellet(p);
    ctx.drawImage(sprite, (wx - camX) + halfW - sprite.width / 2, (wy - camY) + halfH - sprite.height / 2);
  }

  // Snakes
  for (let i = 0; i < world.snakes.length; i++) {
    const s = world.snakes[i];
    if (s.alive && s.points.length) drawSnakeBody(ctx, view, s, camX, camY, alpha);
  }
  for (let i = 0; i < world.snakes.length; i++) {
    const s = world.snakes[i];
    if (s.alive && s.points.length) drawSnakeHead(ctx, view, s, camX, camY, alpha);
  }

  drawLeaderboard(ctx, world);
  drawToast(ctx, world, view);
}
