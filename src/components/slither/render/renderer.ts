import type { World, Snake, Pellet, Vec } from '../engine/types';

type View = { w: number; h: number; cam: Vec };

const TAU = Math.PI * 2;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, worldRadius: number) {
  const gridSize = 100;
  // Calculate visible world bounds
  const minX = view.cam.x - view.w / 2;
  const maxX = view.cam.x + view.w / 2;
  const minY = view.cam.y - view.h / 2;
  const maxY = view.cam.y + view.h / 2;

  // Snap to grid
  const startX = Math.floor(minX / gridSize) * gridSize;
  const startY = Math.floor(minY / gridSize) * gridSize;

  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';

  // Vertical lines
  for (let x = startX; x <= maxX; x += gridSize) {
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
  }
  // Horizontal lines
  for (let y = startY; y <= maxY; y += gridSize) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();

  // Circular World Border
  // Since context is already translated to world space, we draw at (0,0)
  ctx.beginPath();
  ctx.lineWidth = 20;
  ctx.strokeStyle = 'rgba(255, 0, 85, 0.3)';
  ctx.arc(0, 0, worldRadius, 0, TAU);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#FF0055';
  ctx.arc(0, 0, worldRadius, 0, TAU);
  ctx.stroke();
}

function drawPellet(ctx: CanvasRenderingContext2D, p: Pellet, time: number) {
  // Pulse effect
  let pulseSpeed = 6;
  let pulseSize = 0.15;

  // Make valuable pellets pulse faster/stronger
  if (p.kind === 'gold' || p.kind === 'large') {
    pulseSpeed = 10;
    pulseSize = 0.25;
  }

  const pulse = 1 + Math.sin(time * pulseSpeed + p.pos.x * 0.01 + p.pos.y * 0.01) * pulseSize;
  const r = p.r * pulse;

  ctx.fillStyle = p.color;
  
  // Stronger glow for valuable items
  ctx.shadowBlur = (p.kind === 'gold' || p.kind === 'large') ? r * 3 : r * 1.5;
  ctx.shadowColor = p.color;
  ctx.globalAlpha = 0.9;
  
  ctx.beginPath();
  ctx.arc(p.pos.x, p.pos.y, r, 0, TAU);
  ctx.fill();
  
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;
}

function getInterpolatedPoint(s: Snake, i: number, alpha: number): { x: number, y: number } {
  const curr = s.points[i];
  if (!curr) return { x: 0, y: 0 };

  // If we have history, interpolate
  if (s._prev && s._prevLen && i < s._prevLen) {
    const px = s._prev[i * 2];
    const py = s._prev[i * 2 + 1];
    return {
      x: lerp(px, curr.x, alpha),
      y: lerp(py, curr.y, alpha)
    };
  }
  return curr;
}

function drawSnake(ctx: CanvasRenderingContext2D, s: Snake, alpha: number) {
  if (s.points.length === 0) return;

  // Draw body as "tiles" (circles) from tail to head
  for (let i = s.points.length - 1; i >= 0; i--) {
    const p = getInterpolatedPoint(s, i, alpha);
    
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.radius, 0, TAU);
    ctx.fillStyle = s.color;
    ctx.fill();
  }

  // Boost indicator
  if (s.boosting) {
    const head = getInterpolatedPoint(s, 0, alpha);
    const time = performance.now() / 1000;
    
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    // 1. Large soft outer glow
    const glowRadius = s.radius * 3.0;
    const glow = ctx.createRadialGradient(head.x, head.y, s.radius * 0.5, head.x, head.y, glowRadius);
    glow.addColorStop(0, s.color); 
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(head.x, head.y, glowRadius, 0, TAU);
    ctx.fill();
    
    // 2. Intense inner core (pulsing slightly)
    const pulse = Math.sin(time * 6); 
    const coreRadius = s.radius * (1.2 + pulse * 0.1); 
    
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(head.x, head.y, coreRadius, 0, TAU);
    ctx.fill();
    
    // 3. Shockwave rings (expanding)
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const t = (time * 2 + i * 0.333) % 1; // 0 to 1 linear
      const r = s.radius * (1 + t * 1.5); // expand
      const a = Math.sin(t * Math.PI) * 0.5; // Smooth fade in/out
      
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, r, 0, TAU);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  // Draw Eyes on head
  const head = getInterpolatedPoint(s, 0, alpha);

  // 3. Draw Eyes
  const dir = s._prevDir !== undefined ? lerp(s._prevDir, s.dir, alpha) : s.dir;
  
  const eyeOff = s.radius * 0.6;
  const eyeR = s.radius * 0.35;
  
  const lx = head.x + Math.cos(dir - 0.6) * eyeOff;
  const ly = head.y + Math.sin(dir - 0.6) * eyeOff;
  const rx = head.x + Math.cos(dir + 0.6) * eyeOff;
  const ry = head.y + Math.sin(dir + 0.6) * eyeOff;

  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(lx, ly, eyeR, 0, TAU);
  ctx.arc(rx, ry, eyeR, 0, TAU);
  ctx.fill();

  ctx.fillStyle = 'black';
  const pupilR = eyeR * 0.5;
  ctx.beginPath();
  ctx.arc(lx + Math.cos(dir) * 2, ly + Math.sin(dir) * 2, pupilR, 0, TAU);
  ctx.arc(rx + Math.cos(dir) * 2, ry + Math.sin(dir) * 2, pupilR, 0, TAU);
  ctx.fill();

  // Name tag
  if (s.isPlayer || s.desiredLen > 100) {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillText(s.name, head.x, head.y - s.radius - 14);
    ctx.shadowBlur = 0;
  }
}

export function drawWorld(ctx: CanvasRenderingContext2D, world: World, view: View, alpha: number) {
  // Clear
  ctx.fillStyle = '#080810'; // Deep dark blue/black
  ctx.fillRect(0, 0, view.w, view.h);

  // Camera Transform
  ctx.save();
  ctx.translate(view.w / 2 - view.cam.x, view.h / 2 - view.cam.y);

  // Grid
  drawGrid(ctx, view, world.radius);

  // Pellets
  // Optimization: Only draw pellets inside view + padding
  const pad = 50;
  const minX = view.cam.x - view.w / 2 - pad;
  const maxX = view.cam.x + view.w / 2 + pad;
  const minY = view.cam.y - view.h / 2 - pad;
  const maxY = view.cam.y + view.h / 2 + pad;

  const time = performance.now() / 1000;

  for (const p of world.pellets) {
    if (p.pos.x >= minX && p.pos.x <= maxX && p.pos.y >= minY && p.pos.y <= maxY) {
      drawPellet(ctx, p, time);
    }
  }

  // Snakes
  // Draw dead/dying snakes first? (Not handled in state, they just vanish or turn to pellets)
  // Draw bots then player
  for (const s of world.snakes) {
    if (!s.alive) continue;
    drawSnake(ctx, s, alpha);
  }

  ctx.restore();

  // --- Minimap (Screen Space) ---
  const mapSize = 130;
  const margin = 100; // was 24, now 44 to move higher
  const r = mapSize / 2;
  const cx = view.w - r - margin;
  const cy = view.h - r - margin;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.clip();

  const scale = r / world.radius;

  for (const s of world.snakes) {
    if (!s.alive) continue;
    // Use interpolated head for smoothness
    const head = getInterpolatedPoint(s, 0, alpha);
    
    const mx = cx + head.x * scale;
    const my = cy + head.y * scale;

    ctx.fillStyle = s.isPlayer ? '#fff' : s.color;
    ctx.beginPath();
    ctx.arc(mx, my, s.isPlayer ? 3.5 : 2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}