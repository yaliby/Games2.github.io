import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ROWS, COLS } from './engine/types';
import type { Board, BlockShape, Pos } from './engine/types';

import { createBoard, canPlace, placeBlock, clearLines, anyMoveExists } from './engine/rules';
import { BLOCKS } from './engine/blocks';
import { drawBoard } from './render/renderer';

import { onAuthStateChanged } from 'firebase/auth';
import { auth, db  } from "../../services/firebase";
import { updateBlockBlastBestScoreIfHigher } from "../../services/scoreService";
import { doc, onSnapshot, collection, query, orderBy, limit } from "firebase/firestore";





/* ================= CONFIG ================= */

// Calculate responsive tile size
function calculateTileSize(): number {
  const maxWidth = window.innerWidth - 40;
  const maxHeight = window.innerHeight - 200;
  const baseTile = Math.floor(Math.min(maxWidth, maxHeight) * 0.055);
  const boardWidth = COLS * baseTile;
  const boardHeight = ROWS * baseTile;
  
  const scaleX = maxWidth / boardWidth;
  const scaleY = maxHeight / boardHeight;
  const scale = Math.min(scaleX, scaleY, 1);
  
  return Math.max(25, Math.floor(baseTile * scale));
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

type Screen = 'MENU' | 'GAME';

type TrayBlock = {
  shape: BlockShape;
  colorId: number; // 1..N
};

type DragState = {
  block: TrayBlock;
  index: number;
  boardPos: Pos | null;
  valid: boolean;
  pointerId: number;
  clientX: number;
  clientY: number;
} | null;

type FlashState = {
  rows: number[];
  cols: number[];
  cells: Array<{ r: number; c: number; colorId: number }>;
  start: number;
  duration: number;
} | null;

type ParticleDef = {
  vx: number;
  vy: number;
  color: string;
  size: number;
  type: 'circle' | 'rect';
  life: number;
};

type ComboAnim = {
  text: string;
  tier: number;
  start: number;
  duration: number;
  particles: ParticleDef[];
};

type GameState = {
  board: Board;
  tray: TrayBlock[];
  score: number;
  drag: DragState;
  flash: FlashState;
  comboAnim: ComboAnim | null;
  gameOver: boolean;
  scoreSubmitted: boolean;
};


/* ================= COMPONENT ================= */

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function generateComboParticles(tier: number, tileSize: number): ParticleDef[] {
  // More particles for higher tiers
  const count = Math.min(80, 15 + tier * 8);
  const particles: ParticleDef[] = [];
  // Vibrant palette
  const colors = ['#FFD34A', '#4DFFB5', '#4DA3FF', '#FF8A4D', '#B84DFF', '#FFFFFF', '#FF4D6D'];
  
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Speed increases with tier
    const speed = (0.1 + Math.random() * 0.4) * (1 + tier * 0.15) * (tileSize / 20);
    
    particles.push({
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: (2 + Math.random() * 4) * (tileSize / 30),
      type: Math.random() > 0.6 ? 'circle' : 'rect',
      life: 500 + Math.random() * 600,
    });
  }
  return particles;
}

function drawCombo(
  ctx: CanvasRenderingContext2D,
  anim: ComboAnim,
  boardW: number,
  boardH: number,
  tileSize: number
) {
  const { text, tier, start, duration, particles } = anim;
  const now = performance.now();
  const elapsed = now - start;
  const t = Math.min(1, elapsed / duration);

  // Colors based on tier (cycling palette)
  const colors = ['#FFFFFF', '#4DFFB5', '#4DA3FF', '#FFD34A', '#FF8A4D', '#B84DFF', '#FF4D6D'];
  const mainColor = colors[Math.min(tier, colors.length - 1)] || colors[colors.length - 1];

  const cx = boardW / 2;
  const cy = boardH / 2;

  // Animation Phases (2s total)
  // 0.0 - 0.15: Pop in (scale 0.8 -> 1.08 -> 1.0)
  // 0.0 - 0.40: Shock ring & Sparks
  // 0.15 - 0.70: Float up slightly
  // 0.70 - 1.00: Fade out

  let scale = 1;
  let alpha = 1;
  let yOffset = 0;

  // Pop in
  if (t < 0.12) {
    const tPop = t / 0.12;
    scale = 0.8 + (easeOutBack(tPop) * 0.2);
    // Extra scale punch for high tiers
    if (tier >= 5) scale *= 1.2;
  } else if (t > 0.7) {
    alpha = 1 - (t - 0.7) / 0.3;
  }

  // Float up
  yOffset = -tileSize * (t * 0.8);

  ctx.save();
  ctx.translate(cx, cy + yOffset);

  // --- 0. God Rays (High Tier) ---
  if (tier >= 5 && alpha > 0.1) {
    ctx.save();
    ctx.rotate(elapsed * 0.0015);
    ctx.globalAlpha = alpha * 0.25;
    const rayCount = Math.min(14, 6 + tier);
    for (let i = 0; i < rayCount; i++) {
      ctx.rotate((Math.PI * 2) / rayCount);
      ctx.fillStyle = mainColor;
      // Draw long ray
      ctx.fillRect(0, -tileSize * 0.1, boardW * 1.5, tileSize * 0.2);
    }
    ctx.restore();
  }

  // --- 1. Particles ---
  particles.forEach(p => {
    if (elapsed > p.life) return;
    const pT = elapsed / p.life;
    
    // Physics: velocity + gravity
    const x = p.vx * elapsed;
    const y = p.vy * elapsed + (0.0008 * elapsed * elapsed); 

    const pAlpha = (1 - Math.pow(pT, 3)) * alpha;
    const pScale = 1 - pT;

    ctx.globalAlpha = pAlpha;
    ctx.fillStyle = p.color;
    
    ctx.beginPath();
    if (p.type === 'circle') {
      ctx.arc(x, y, p.size * pScale, 0, Math.PI * 2);
    } else {
      const s = p.size * pScale;
      ctx.rect(x - s/2, y - s/2, s, s);
    }
    ctx.fill();
  });

  // --- 2. Shock Rings (Multiple) ---
  const numRings = tier >= 4 ? 2 : 1;
  for (let i = 0; i < numRings; i++) {
    const delay = i * 100;
    if (elapsed > delay && t < 0.6) {
      const rT = (elapsed - delay) / (duration * 0.5); // normalized ring time
      if (rT > 1) continue;
      
      const radius = tileSize * (1.5 + rT * (3 + tier * 0.5));
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = tileSize * 0.15 * (1 - rT);
      ctx.globalAlpha = (1 - rT) * alpha;
      ctx.stroke();
    }
  }

  // 3. Text
  ctx.globalAlpha = alpha;
  ctx.scale(scale, scale);
  // Rotate text slightly for impact
  if (t < 0.2) ctx.rotate((Math.random() - 0.5) * 0.1);

  const fontSize = tileSize * (3 + Math.min(tier, 10) * 0.15) * 0.7;
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Glow
  ctx.shadowColor = mainColor;
  ctx.shadowBlur = 20 + tier * 8;

  // Stroke
  ctx.lineWidth = tileSize * 0.1;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeText(text, 0, 0);

  // Fill (White core, colored glow)
  ctx.fillStyle = '#FFF';
  ctx.fillText(text, 0, 0);

  ctx.restore();
}

export default function BlockBlastGame() {
  const navigate = useNavigate();

  const boardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const trayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // NEW: overlay canvas for floating dragged block (above everything)
  const dragOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const rafRef = useRef<number | null>(null);

  const [screen, setScreen] = useState<Screen>('MENU');
  const [scoreUI, setScoreUI] = useState(0);
  const [bestScoreUI, setBestScoreUI] = useState(0);
  const [leaderboard, setLeaderboard] = useState<Array<{ name: string; score: number }>>([]);
  const [tileSize, setTileSize] = useState<number>(calculateTileSize());

  // Combo rules (new):
  const comboTierRef = useRef(1);          // Multiplier (starts at 1)
  const comboStreakTurnsRef = useRef(0);   // Consecutive turns with at least one clear
  const trayHadAnyClearRef = useRef(false); // did we clear at least once in the current tray?

  // We only show the combo anim when multiplier increases (prevents spam)
  const lastToastMultRef = useRef<number>(1);

  const gameRef = useRef<GameState>({
  board: createBoard(),
  tray: pickTrayGuaranteed(createBoard()),
  score: 0,
  drag: null,
  flash: null,
  comboAnim: null,
  gameOver: false,
  scoreSubmitted: false,
});

  

  const TRAY_HEIGHT = useMemo(() => Math.floor(tileSize * 3.2), [tileSize]);
  const boardPx = useMemo(() => ({ w: COLS * tileSize, h: ROWS * tileSize }), [tileSize]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setTileSize(calculateTileSize());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  useEffect(() => {
    let unsubDoc: null | (() => void) = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // נקה listener קודם אם היה
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      if (!user) {
        setBestScoreUI(0);
        return;
      }

      const ref = doc(db, "users", user.uid);

      // ✅ מאזין בזמן אמת לשינויים במסמך
      unsubDoc = onSnapshot(
        ref,
        (snap) => {
          const best = Number((snap.data() as any)?.bestScore ?? 0) || 0;
          setBestScoreUI(best);
        },
        (err) => {
          console.warn("bestScore listener failed:", err);
        }
      );
    });

  return () => {
    if (unsubDoc) unsubDoc();
    unsubAuth();
  };
}, []);

// ✅ Live leaderboard (Top players) – updates in realtime (from /users collection)
useEffect(() => {
  // לפי המבנה שלך במסד: users/{uid} -> { username, bestScore }
  const q = query(
    collection(db, "users"),
    orderBy("bestScore", "desc"),
    limit(10)
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          name: String(data?.username ?? data?.displayName ?? "Anonymous"),
          score: Number(data?.bestScore ?? 0) || 0,
        };
      });
      setLeaderboard(rows);
    },
    (err) => console.warn("leaderboard listener failed:", err)
  );

  return () => unsub();
}, []);
/* ================= GAME CONTROL ================= */

  const triggerShake = (strength: 'sm' | 'md' | 'lg' | 'xl' = 'sm') => {
    const el = boardWrapRef.current;
    if (!el) return;

    // restart animation reliably
    el.classList.remove('bb-shake-sm', 'bb-shake-md', 'bb-shake-lg', 'bb-shake-xl');
    // force reflow
    void el.offsetWidth;
    el.classList.add(
      strength === 'xl' ? 'bb-shake-xl' : strength === 'lg' ? 'bb-shake-lg' : strength === 'md' ? 'bb-shake-md' : 'bb-shake-sm'
    );

    window.setTimeout(() => {
      el.classList.remove('bb-shake-sm', 'bb-shake-md', 'bb-shake-lg', 'bb-shake-xl');
    }, strength === 'xl' ? 360 : strength === 'lg' ? 300 : 220);
  };

// Quick board pulse (CSS only) – stronger with higher combo level (no React re-render)
const pulseBoard = (level: number) => {
  const el = boardWrapRef.current;
  if (!el || level <= 0) return;

  for (let i = 1; i <= 5; i++) el.classList.remove(`bb-pulse-lvl${i}`);
  void el.offsetWidth;

  const cls = `bb-pulse-lvl${Math.min(5, Math.max(1, level))}`;
  el.classList.add(cls);

  window.setTimeout(() => {
    el.classList.remove(cls);
  }, 520);
};

  const resetGame = () => {
  const fresh = createBoard();
  gameRef.current = {
    board: fresh,
    tray: pickTrayGuaranteed(fresh),
    score: 0,
    drag: null,
    flash: null,
    comboAnim: null,
    gameOver: false,
    scoreSubmitted: false,
  };

  setScoreUI(0);

  // reset combo refs + hide toast instantly (no React re-render needed)
  comboTierRef.current = 1;
  comboStreakTurnsRef.current = 0;
  trayHadAnyClearRef.current = false;
  lastToastMultRef.current = 1;
};




  /* ================= DRAW TRAY (FIXED DPR + PROPORTIONS) ================= */

  const drawTray = () => {
    const canvas = trayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const g = gameRef.current;

    // IMPORTANT: draw in CSS pixels, not canvas.width (which is DPR scaled)
    const W = boardPx.w;
    const H = TRAY_HEIGHT;

    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0A1020');
    bg.addColorStop(1, '#070A12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const slotW = W / 3;

    for (let i = 0; i < 3; i++) {
      const x0 = i * slotW;

      // slot frame
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = 'rgba(140,170,255,.20)';
      ctx.lineWidth = 2;
      roundRect(ctx, x0 + 10, 10, slotW - 20, H - 20, 18);
      ctx.stroke();
      ctx.restore();

      const block = g.tray[i];
      if (!block) continue;

      // Hide block if it's being dragged (so it looks like we picked it up)
      if (g.drag && g.drag.index === i) continue;

      const shape = block.shape;
      const color = PALETTE[(block.colorId - 1) % PALETTE.length];

      // bounds
      const minR = Math.min(...shape.map((p) => p.r));
      const maxR = Math.max(...shape.map((p) => p.r));
      const minC = Math.min(...shape.map((p) => p.c));
      const maxC = Math.max(...shape.map((p) => p.c));

      const shapeW = maxC - minC + 1;
      const shapeH = maxR - minR + 1;

      const MAX_DIM = 5; // we allow up to 5x5 shapes
        const mini = Math.floor(
        Math.min((slotW - 44) / MAX_DIM, (H - 44) / MAX_DIM)
        );

      const ox = x0 + slotW / 2 - (shapeW * mini) / 2;
      const oy = H / 2 - (shapeH * mini) / 2;

      // draw
      for (const p of shape) {
        const rr = p.r - minR;
        const cc = p.c - minC;

        const x = ox + cc * mini;
        const y = oy + rr * mini;

        ctx.save();
        // shadow
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        roundRect(ctx, x + 2, y + 3, mini - 4, mini - 4, Math.max(6, mini * 0.25));
        ctx.fill();

        // body color
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        roundRect(ctx, x + 1, y + 1, mini - 4, mini - 4, Math.max(6, mini * 0.25));
        ctx.fill();

        // highlight
        ctx.globalAlpha = 0.22;
        const gg = ctx.createLinearGradient(x, y, x + mini, y + mini);
        gg.addColorStop(0, '#FFFFFF');
        gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg;
        roundRect(ctx, x + 1, y + 1, mini - 4, mini - 4, Math.max(6, mini * 0.25));
        ctx.fill();

        // glow
        ctx.globalAlpha = 0.22;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = color;
        roundRect(ctx, x + 1, y + 1, mini - 4, mini - 4, Math.max(6, mini * 0.25));
        ctx.fill();

        ctx.restore();
      }
    }
  };

  /* ================= OVERLAY DRAG DRAW ================= */

  const drawFloatingDrag = () => {
    const overlay = dragOverlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d')!;
    const g = gameRef.current;

    const W = overlay.clientWidth;
    const H = overlay.clientHeight;

    ctx.clearRect(0, 0, W, H);

    if (!g.drag) return;

    const { block, clientX, clientY, valid } = g.drag;
    const shape = block.shape;
    const color = PALETTE[(block.colorId - 1) % PALETTE.length];

    // find shape bounds to center it on pointer
    const minR = Math.min(...shape.map((p) => p.r));
    const maxR = Math.max(...shape.map((p) => p.r));
    const minC = Math.min(...shape.map((p) => p.c));
    const maxC = Math.max(...shape.map((p) => p.c));

    const shapeW = maxC - minC + 1;
    const shapeH = maxR - minR + 1;

    const pxW = shapeW * tileSize;
    const pxH = shapeH * tileSize;

    const ox = clientX - pxW / 2;
    const oy = clientY - pxH / 2;

    ctx.save();
    ctx.globalAlpha = 0.95;

    // stronger glow while dragging
    ctx.shadowColor = valid ? color : '#FF4D6D';
    ctx.shadowBlur = valid ? 28 : 18;

    for (const p of shape) {
      const rr = p.r - minR;
      const cc = p.c - minC;

      const x = ox + cc * tileSize;
      const y = oy + rr * tileSize;

      // shadow
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      roundRect(ctx, x + 3, y + 5, tileSize - 6, tileSize - 6, Math.max(8, tileSize * 0.20));
      ctx.fill();

      // body
      ctx.globalAlpha = 1;
      ctx.fillStyle = valid ? color : '#FF4D6D';
      roundRect(ctx, x + 1, y + 1, tileSize - 6, tileSize - 6, Math.max(8, tileSize * 0.20));
      ctx.fill();

      // highlight
      ctx.globalAlpha = 0.22;
      const gg = ctx.createLinearGradient(x, y, x + tileSize, y + tileSize);
      gg.addColorStop(0, '#FFFFFF');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      roundRect(ctx, x + 1, y + 1, tileSize - 6, tileSize - 6, Math.max(8, tileSize * 0.20));
      ctx.fill();

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };

  /* ================= EFFECT (INIT CANVASES + INPUT) ================= */

  useEffect(() => {
    if (screen !== 'GAME') return;

    const boardCanvas = boardCanvasRef.current!;
    const trayCanvas = trayCanvasRef.current!;
    const overlayCanvas = dragOverlayCanvasRef.current!;

    const bctx = boardCanvas.getContext('2d')!;
    const tctx = trayCanvas.getContext('2d')!;
    const octx = overlayCanvas.getContext('2d')!;

    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // board canvas
    boardCanvas.width = boardPx.w * dpr;
    boardCanvas.height = boardPx.h * dpr;
    boardCanvas.style.width = `${boardPx.w}px`;
    boardCanvas.style.height = `${boardPx.h}px`;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // tray canvas
    trayCanvas.width = boardPx.w * dpr;
    trayCanvas.height = TRAY_HEIGHT * dpr;
    trayCanvas.style.width = `${boardPx.w}px`;
    trayCanvas.style.height = `${TRAY_HEIGHT}px`;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // overlay full screen canvas
    const resizeOverlay = () => {
      overlayCanvas.width = window.innerWidth * dpr;
      overlayCanvas.height = window.innerHeight * dpr;
      overlayCanvas.style.width = `${window.innerWidth}px`;
      overlayCanvas.style.height = `${window.innerHeight}px`;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeOverlay();

    const boardRect = () => boardCanvas.getBoundingClientRect();
    const trayRect = () => trayCanvas.getBoundingClientRect();


    const pickBlockFromTray = (x: number, y: number): number | null => {
      if (y < 0 || y > TRAY_HEIGHT) return null;
      const slotW = boardPx.w / 3;
      const idx = Math.floor(x / slotW);
      if (idx < 0 || idx > 2) return null;
      const g = gameRef.current;
      if (!g.tray[idx]) return null;
      return idx;
    };

    const onPointerDownTray = (e: PointerEvent) => {
      const g = gameRef.current;
      if (g.gameOver) return;

      const r = trayRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      const idx = pickBlockFromTray(x, y);
      if (idx === null) return;

      trayCanvas.setPointerCapture(e.pointerId);

      g.drag = {
        block: g.tray[idx],
        index: idx,
        boardPos: null,
        valid: false,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const g = gameRef.current;
      if (!g.drag || g.drag.pointerId !== e.pointerId) return;

      // floating position
      g.drag.clientX = e.clientX;
      g.drag.clientY = e.clientY;

      // board snap preview
      const r = boardRect();

      const shape = g.drag.block.shape;

        // bounds
        const minR = Math.min(...shape.map((p) => p.r));
        const maxR = Math.max(...shape.map((p) => p.r));
        const minC = Math.min(...shape.map((p) => p.c));
        const maxC = Math.max(...shape.map((p) => p.c));

        const shapeW = maxC - minC + 1;
        const shapeH = maxR - minR + 1;

        const pxW = shapeW * tileSize;
        const pxH = shapeH * tileSize;

        // top-left of the visual dragged block (same as drawFloatingDrag)
        const oxClient = e.clientX - pxW / 2;
        const oyClient = e.clientY - pxH / 2;

        // convert to board-local
        const oxBoard = oxClient - r.left;
        const oyBoard = oyClient - r.top;

        // snap to nearest cell so it feels "magnetic"
        // snap to nearest cell (top-left of the shape's bounding box)
        let cMinCell = Math.round(oxBoard / tileSize);
        let rMinCell = Math.round(oyBoard / tileSize);

        // clamp so the bounding box can't drift outside the board (prevents jitter at edges)
        const maxCMin = COLS - shapeW;
        const maxRMin = ROWS - shapeH;

        // Don't snap if too far from board (allow dragging back to tray)
        const SNAP_MARGIN = 1.5;
        if (
          cMinCell < -SNAP_MARGIN || cMinCell > maxCMin + SNAP_MARGIN ||
          rMinCell < -SNAP_MARGIN || rMinCell > maxRMin + SNAP_MARGIN
        ) {
          g.drag.boardPos = null;
          g.drag.valid = false;
          return;
        }

        cMinCell = Math.max(0, Math.min(maxCMin, cMinCell));
        rMinCell = Math.max(0, Math.min(maxRMin, rMinCell));

        // anchor for rules placement (shape cells are defined relative to minR/minC)
        const c0 = cMinCell - minC;
        const r0 = rMinCell - minR;

        const anchor = { r: r0, c: c0 };

        g.drag.boardPos = anchor;
        g.drag.valid = canPlace(g.board, shape, anchor.r, anchor.c);

    };

    const onPointerUp = (e: PointerEvent) => {
      const g = gameRef.current;
      if (!g.drag || g.drag.pointerId !== e.pointerId) return;

      const drag = g.drag;

      if (drag.boardPos && drag.valid) {
placeBlock(g.board, drag.block.shape, drag.boardPos.r, drag.boardPos.c, drag.block.colorId);

const res = clearLines(g.board);
g.board = res.board;

const cleared = res.cleared;

// --- COMBO LOGIC ---
if (cleared > 0) {
  trayHadAnyClearRef.current = true;
}

if (cleared > 0) {
  const startTier = comboTierRef.current;
  comboTierRef.current += cleared; // +1 per line cleared

  // Animate increments sequentially ("tata-tata" effect)
  for (let i = 1; i <= cleared; i++) {
    setTimeout(() => {
      const tier = startTier + i;
      g.comboAnim = { 
        text: `×${tier}`, 
        tier, 
        start: performance.now(), 
        duration: 2000,
        particles: generateComboParticles(tier, tileSize)
      };
    }, (i - 1) * 600);
  }
  lastToastMultRef.current = comboTierRef.current;
}

if (cleared > 0) {
  g.flash = {
    rows: res.rows,
    cols: res.cols,
    cells: res.cells,
    start: performance.now(),
    duration: 520 + comboTierRef.current * 100,
  };

  // shake + pulse scale with combo strength (CSS only) — make low levels still feel good
  const strength =
    (cleared >= 4 || comboTierRef.current >= 5) ? 'xl'
  : (cleared >= 3 || comboTierRef.current >= 4) ? 'xl'
  : (cleared >= 2 || comboTierRef.current >= 3) ? 'lg'
  : 'md';

  triggerShake(strength);
  pulseBoard(comboTierRef.current);

  if (TRAY_CONFIG.debugLogs) {
    console.log(
      `[BB][Combo] cleared=${cleared} tier=${comboTierRef.current} streakTurns=${comboStreakTurnsRef.current}`
    );
  }
}

// scoring (keep your feel, but apply multiplier)
const placedCells = drag.block.shape.length;
const placementScore = placedCells * 12;
const clearScore = res.cleared * 140;
const gained = Math.round(placementScore + (clearScore * comboTierRef.current));

g.score += gained;
setScoreUI(g.score);

// ✅ עדכון UI מיידי (לא מחכה למסד)
setBestScoreUI((prev) => (g.score > prev ? g.score : prev));

// ✅ ניסיון עדכון למסד (רק אם עקפנו)
tryPushBestScore(g.score);

// remove used tray block
g.tray.splice(drag.index, 1);

// refill (tray boundary)
if (g.tray.length === 0) {
  if (trayHadAnyClearRef.current) {
    // Continue streak
    comboStreakTurnsRef.current++;
    // No extra +1 for turn completion, only per-line
  } else {
    // Reset
    comboStreakTurnsRef.current = 0;
    comboTierRef.current = 1;
    lastToastMultRef.current = 1;
  }
  trayHadAnyClearRef.current = false;
  g.tray = pickTrayGuaranteed(g.board);
}

g.gameOver = !anyMoveExists(g.board, g.tray.map((b) => b.shape));

      }

      try { trayCanvas.releasePointerCapture(e.pointerId); } catch {}
      g.drag = null;
    };

    const cancelDrag = () => {
      const g = gameRef.current;
      if (!g.drag) return;
      g.drag = null;
    };

    const onPointerCancel = (e: PointerEvent) => {
      const g = gameRef.current;
      if (!g.drag || g.drag.pointerId !== e.pointerId) return;
      cancelDrag();
    };

    const onWindowBlur = () => {
      cancelDrag();
    };


    // LOOP
    const loop = () => {
      const g = gameRef.current;

      drawBoard(
        bctx,
        g.board,
        tileSize,
        g.drag && g.drag.boardPos
          ? {
              shape: g.drag.block.shape,
              pos: g.drag.boardPos,
              valid: g.drag.valid,
              colorId: g.drag.block.colorId,
            }
          : null,
        g.flash
      );

      // Draw combo animation on top of board
      if (g.comboAnim) {
        if (performance.now() - g.comboAnim.start > g.comboAnim.duration) {
          g.comboAnim = null;
        } else {
          drawCombo(bctx, g.comboAnim, boardPx.w, boardPx.h, tileSize);
        }
      }

      drawTray();
      drawFloatingDrag();

      rafRef.current = requestAnimationFrame(loop);
    };

    trayCanvas.addEventListener('pointerdown', onPointerDownTray);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', resizeOverlay);

    loop();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      trayCanvas.removeEventListener('pointerdown', onPointerDownTray);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', resizeOverlay);
    };
  }, [screen, boardPx.h, boardPx.w, tileSize]);

const bestScoreRef = useRef(0);
useEffect(() => { bestScoreRef.current = bestScoreUI; }, [bestScoreUI]);

const bestUpdateInFlight = useRef(false);
const lastBestUpdateAt = useRef(0);
const BEST_UPDATE_COOLDOWN_MS = 1200;


const tryPushBestScore = (score: number) => {
  const user = auth.currentUser;
  if (!user) return;

  // ✅ לא שולחים אם לא עקפנו את הבסט הידוע כרגע
  if (score <= bestScoreRef.current) return;

  // ✅ throttle כדי לא לירות למסד בכל פריים/מהלך
  const now = Date.now();
  if (bestUpdateInFlight.current) return;
  if (now - lastBestUpdateAt.current < BEST_UPDATE_COOLDOWN_MS) return;

  bestUpdateInFlight.current = true;
  lastBestUpdateAt.current = now;

  updateBlockBlastBestScoreIfHigher(user.uid, score)
    .catch((e) => console.warn("bestScore update failed:", e))
    .finally(() => {
      bestUpdateInFlight.current = false;
    });
};




/* ================= MENU ================= */

if (screen === 'MENU') {
  return (
    <div className="bb-menu">
      <style>{`
        .bb-menu{
          min-height:83vh;
          display:grid;
          place-items:center;
          position:relative;
          overflow:hidden;
          color:#eef3ff;
          animation: bbBgShift 10s ease-in-out infinite alternate;
        }

        @keyframes bbBgShift {
          from { filter: hue-rotate(0deg) saturate(1); transform: scale(1); }
          to   { filter: hue-rotate(10deg) saturate(1.05); transform: scale(1.01); }
        }

        /* Soft glowing orbs */
        .bb-orb{
          position:absolute;
          width:520px;
          height:520px;
          border-radius:999px;
          filter: blur(50px);
          opacity:.35;
          pointer-events:none;
          animation: bbFloat 7.5s ease-in-out infinite;
          transform: translate3d(0,0,0);
          mix-blend-mode: screen;
        }

        .bb-orb--a{
          left:-140px; top:-180px;
          background: radial-gradient(circle at 30% 30%, rgba(120,170,255,.65), transparent 60%);
        }
        .bb-orb--b{
          right:-180px; bottom:-220px;
          background: radial-gradient(circle at 30% 30%, rgba(255,211,74,.55), transparent 60%);
          animation-delay: -2.8s;
        }

        @keyframes bbFloat{
          0%   { transform: translate(0px, 0px) scale(1); }
          50%  { transform: translate(18px, 10px) scale(1.05); }
          100% { transform: translate(-10px, 18px) scale(1); }
        }

        /* Card */
        .bb-card{
          width:min(560px, 94vw);
          border-radius:24px;
          padding:22px;
          background: rgba(10,14,28,.62);
          border:1px solid rgba(140,170,255,.16);
          box-shadow:
            0 28px 90px rgba(0,0,0,.65),
            inset 0 1px 0 rgba(255,255,255,.04);
          backdrop-filter: blur(10px);
          position:relative;
          animation: bbEnter .55s ease-out both;
          text-align:center;
        }

        @keyframes bbEnter{
          from { opacity:0; transform: translateY(14px) scale(.98); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }

        .bb-title{
          margin:0;
          font-size: clamp(30px, 4vw, 40px);
          font-weight: 900;
          letter-spacing: .6px;
          line-height: 1.05;
        }

        .bb-title span{
          background: linear-gradient(90deg, #EAF0FF, rgba(180,200,255,.85), #FFD34A);
          -webkit-background-clip:text;
          background-clip:text;
          color: transparent;
          text-shadow: 0 0 18px rgba(140,170,255,.10);
        }

        .bb-sub{
          margin:10px 0 0 0;
          opacity:.86;
          line-height:1.5;
          font-size: 14px;
          text-align:center;
        }

        .bb-actions{
          display:flex;
          gap:12px;
          flex-wrap:wrap;
          margin-top:18px;
          justify-content:center;
        }

        .bb-btn{
          appearance:none;
          border:none;
          cursor:pointer;
          padding: 12px 16px;
          border-radius: 14px;
          font-weight: 900;
          letter-spacing: .2px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          transition: transform .16s ease, box-shadow .16s ease, filter .16s ease, background .16s ease;
          user-select:none;
        }

        .bb-btn:active{ transform: translateY(1px) scale(.99); }

        .bb-btn--primary{
          color:#0B0E14;
          background: linear-gradient(180deg, rgba(255,211,74,.98), rgba(255,170,30,.92));
          box-shadow: 0 18px 50px rgba(255,211,74,.18);
          border: 1px solid rgba(255,211,74,.42);
        }
        .bb-btn--primary:hover{
          transform: translateY(-1px);
          filter: brightness(1.02);
          box-shadow: 0 22px 70px rgba(255,211,74,.22);
        }

        .bb-btn--ghost{
          background: rgba(10,14,28,.55);
          color:#EAF0FF;
          border:1px solid rgba(140,170,255,.18);
          box-shadow: 0 18px 55px rgba(0,0,0,.35);
        }
        .bb-btn--ghost:hover{
          transform: translateY(-1px);
          background: rgba(12,16,34,.62);
          box-shadow: 0 22px 70px rgba(0,0,0,.42);
        }

        /* tiny divider glow line */
        .bb-divider{
          height:1px;
          width:100%;
          margin-top:16px;
          opacity:.9;
        }

        /* bottom hint */
        .bb-hint{
          margin-top:14px;
          opacity:.55;
          font-size:12px;
        }
      
/* ---- Stronger shakes (CSS only) ---- */
@keyframes bbShakeLg {
  0% { transform: translate3d(0,0,0) rotate(0deg); }
  10% { transform: translate3d(-4px, -2px, 0) rotate(-0.45deg); }
  20% { transform: translate3d(4px, 2px, 0) rotate(0.45deg); }
  35% { transform: translate3d(-3px, 2px, 0) rotate(-0.30deg); }
  50% { transform: translate3d(3px, -2px, 0) rotate(0.30deg); }
  70% { transform: translate3d(-2px, 1px, 0) rotate(-0.18deg); }
  100% { transform: translate3d(0,0,0) rotate(0deg); }
}
@keyframes bbShakeXl {
  0% { transform: translate3d(0,0,0) rotate(0deg); }
  8% { transform: translate3d(-6px, -3px, 0) rotate(-0.70deg); }
  16% { transform: translate3d(6px, 3px, 0) rotate(0.70deg); }
  28% { transform: translate3d(-5px, 3px, 0) rotate(-0.55deg); }
  42% { transform: translate3d(5px, -3px, 0) rotate(0.55deg); }
  60% { transform: translate3d(-4px, 2px, 0) rotate(-0.35deg); }
  78% { transform: translate3d(3px, -2px, 0) rotate(0.25deg); }
  100% { transform: translate3d(0,0,0) rotate(0deg); }
}
.bb-shake-lg { animation: bbShakeLg 260ms ease-out both; }
.bb-shake-xl { animation: bbShakeXl 340ms ease-out both; }

/* ---- Board pulse ring (CSS only) ---- */
@keyframes bbPulseRing {
  0% { opacity: 0; transform: scale(0.985); }
  18% { opacity: 1; transform: scale(1.01); }
  45% { opacity: 0.65; transform: scale(1.015); }
  100% { opacity: 0; transform: scale(1.02); }
}
@keyframes bbPulsePop {
  0% { transform: scale(1); filter: brightness(1) saturate(1); }
  22% { transform: scale(1.008); filter: brightness(1.18) saturate(1.18); }
  100% { transform: scale(1); filter: brightness(1) saturate(1); }
}

.bb-pulse-lvl1 { animation: bbPulsePop 520ms ease-out both; filter: brightness(1.06) saturate(1.06); }
.bb-pulse-lvl2 { animation: bbPulsePop 520ms ease-out both; filter: brightness(1.05) saturate(1.05); }
.bb-pulse-lvl3 { animation: bbPulsePop 520ms ease-out both; filter: brightness(1.10) saturate(1.10); }
.bb-pulse-lvl4 { animation: bbPulsePop 520ms ease-out both; filter: brightness(1.16) saturate(1.16); }
.bb-pulse-lvl5 { animation: bbPulsePop 520ms ease-out both; filter: brightness(1.22) saturate(1.22); }

.bb-pulse-lvl1::after,
.bb-pulse-lvl2::after,
.bb-pulse-lvl3::after,
.bb-pulse-lvl4::after,
.bb-pulse-lvl5::after{
  content: '';
  position: absolute;
  inset: -14px;
  border-radius: 30px;
  pointer-events: none;
  border: 2px solid rgba(200, 220, 255, .50);
  box-shadow: 0 0 26px rgba(255,255,255,.12);
  opacity: 0;
  animation: bbPulseRing 520ms ease-out both;
}
.bb-pulse-lvl3::after{ border-color: rgba(255, 211, 74, .40); }
.bb-pulse-lvl4::after{ border-color: rgba(77, 255, 181, .42); }
.bb-pulse-lvl5::after{ border-color: rgba(184, 77, 255, .48); }

`}</style>

      <div className="bb-card">
        <h1 className="bb-title">
          <span>Block Blast</span>
        </h1>

        <p className="bb-sub">
          גרור בלוקים מה־Tray אל הלוח, נקה שורות ועמודות, ותנסה לשבור שיא 🔥
        </p>

        <div className="bb-divider" />

        <div className="bb-actions">
          <button
            className="bb-btn bb-btn--primary"
            onClick={() => {
              resetGame();
              setScreen('GAME');
            }}
          >
            ▶ Start Game
          </button>

          <button className="bb-btn bb-btn--ghost" onClick={() => navigate('/')}>
            🏠 Home
          </button>
        </div>

        <div className="bb-hint">Tip: Try clearing both rows and columns for big score.</div>
      </div>
    </div>
  );
}


  /* ================= GAME UI ================= */

  const g = gameRef.current;

  return (
    <>
      <style>{`
        @keyframes bbShakeSm {
  0%   { transform: translate3d(0,0,0) rotate(0deg); }
  12%  { transform: translate3d(-2px, -1px, 0) rotate(-0.22deg); }
  24%  { transform: translate3d(2px,  1px, 0) rotate(0.22deg); }
  40%  { transform: translate3d(-2px,  1px, 0) rotate(-0.16deg); }
  56%  { transform: translate3d(2px, -1px, 0) rotate(0.16deg); }
  74%  { transform: translate3d(-1px, 0px, 0) rotate(-0.10deg); }
  100% { transform: translate3d(0,0,0) rotate(0deg); }
}

@keyframes bbShakeMd {
  0%   { transform: translate3d(0,0,0) rotate(0deg); }
  10%  { transform: translate3d(-3px, -2px, 0) rotate(-0.32deg); }
  20%  { transform: translate3d(3px,  2px, 0) rotate(0.32deg); }
  34%  { transform: translate3d(-3px,  2px, 0) rotate(-0.22deg); }
  48%  { transform: translate3d(3px, -2px, 0) rotate(0.22deg); }
  68%  { transform: translate3d(-2px, 1px, 0) rotate(-0.14deg); }
  100% { transform: translate3d(0,0,0) rotate(0deg); }
}

@keyframes bbShakeLg {
          0% { transform: translate3d(0,0,0) rotate(0deg); }
          8% { transform: translate3d(-3px, -2px, 0) rotate(-0.45deg); }
          16% { transform: translate3d(3px, 2px, 0) rotate(0.45deg); }
          28% { transform: translate3d(-3px, 2px, 0) rotate(-0.30deg); }
          40% { transform: translate3d(3px, -2px, 0) rotate(0.30deg); }
          58% { transform: translate3d(-2px, 1px, 0) rotate(-0.18deg); }
          78% { transform: translate3d(2px, -1px, 0) rotate(0.18deg); }
          100% { transform: translate3d(0,0,0) rotate(0deg); }
        }
        @keyframes bbShakeXl {
          0% { transform: translate3d(0,0,0) rotate(0deg); }
          6% { transform: translate3d(-5px, -3px, 0) rotate(-0.7deg); }
          12% { transform: translate3d(5px, 3px, 0) rotate(0.7deg); }
          22% { transform: translate3d(-5px, 3px, 0) rotate(-0.5deg); }
          34% { transform: translate3d(5px, -3px, 0) rotate(0.5deg); }
          50% { transform: translate3d(-4px, 2px, 0) rotate(-0.35deg); }
          70% { transform: translate3d(4px, -2px, 0) rotate(0.35deg); }
          100% { transform: translate3d(0,0,0) rotate(0deg); }
        }
        .bb-shake-sm { animation: bbShakeSm 180ms ease-out both; }
        .bb-shake-md { animation: bbShakeMd 220ms ease-out both; }
        .bb-shake-lg { animation: bbShakeLg 300ms ease-out both; }
        .bb-shake-xl { animation: bbShakeXl 360ms cubic-bezier(.12,.85,.23,1) both; }

        /* Combo banner */
        .bb-combo{
          position:absolute;
          left:50%;
          top:18px;
          transform: translateX(-50%);
          z-index: 5;
          padding: 10px 14px;
          border-radius: 16px;
          background: rgba(6,10,20,.68);
          border: 1px solid rgba(140,170,255,.18);
          box-shadow: 0 18px 55px rgba(0,0,0,.55);
          backdrop-filter: blur(8px);
          text-align:center;
          pointer-events:none;
          animation: bbComboPop 420ms cubic-bezier(.16,.85,.23,1) both;
        }
        @keyframes bbComboPop{
          from { opacity:0; transform: translateX(-50%) translateY(-8px) scale(.92); filter: blur(1px); }
          to   { opacity:1; transform: translateX(-50%) translateY(0) scale(1); filter: blur(0); }
        }
        .bb-combo__top{
          font-weight: 900;
          letter-spacing: .5px;
          font-size: 13px;
          color: rgba(230,240,255,.92);
          text-shadow: 0 0 18px rgba(140,170,255,.15);
        }
        .bb-combo__mid{
          margin-top: 2px;
          font-weight: 950;
          font-size: 18px;
          color: #FFD34A;
          text-shadow: 0 0 24px rgba(255,211,74,.28);
        }
        .bb-combo--lvl1{ border-color: rgba(140,170,255,.16); }
        .bb-combo--lvl2{ border-color: rgba(77,255,181,.22); box-shadow: 0 18px 60px rgba(77,255,181,.10), 0 18px 55px rgba(0,0,0,.55); }
        .bb-combo--lvl3{ border-color: rgba(77,163,255,.28); box-shadow: 0 18px 70px rgba(77,163,255,.14), 0 18px 55px rgba(0,0,0,.55); }
        .bb-combo--lvl4{ border-color: rgba(184,77,255,.30); box-shadow: 0 18px 80px rgba(184,77,255,.18), 0 18px 55px rgba(0,0,0,.55); }
        .bb-combo--lvl5{ border-color: rgba(255,77,249,.34); box-shadow: 0 18px 95px rgba(255,77,249,.22), 0 18px 55px rgba(0,0,0,.55); }

        .bb-combo__ring{
          position:absolute;
          inset:-10px;
                  border: 1px solid rgba(255,255,255,.10);
          box-shadow: 0 0 0 1px rgba(140,170,255,.08) inset;
          animation: bbRing 900ms ease-out infinite;
          pointer-events:none;
        }
        @keyframes bbRing{
          0% { opacity:.0; transform: scale(.92); }
          20% { opacity:.26; }
          100%{ opacity:0; transform: scale(1.12); }
        }

        @keyframes bbComboBounce {
          0% { transform: scale(0.6); opacity: 0.5; }
          50% { transform: scale(1.4); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

      `}</style>

      <section className="home-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">Block Blast</span>
          </h2>
        </div>
      </section>

      {/* overlay canvas ABOVE EVERYTHING */}
      <canvas
        ref={dragOverlayCanvasRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(10px, 2vw, 22px)', padding: 'clamp(12px, 3vw, 30px)', alignItems: 'flex-start' }}>
        {/* Controls Panel */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(8px, 1.5vw, 16px)',
            padding: 'clamp(12px, 2vw, 20px)',
            borderRadius: 18,
            background: 'rgba(8,10,18,.70)',
            border: '1px solid rgba(120,150,255,.14)',
            boxShadow: '0 18px 55px rgba(0,0,0,.45)',
            backdropFilter: 'blur(8px)',
            minWidth: 'clamp(160px, 18vw, 200px)',
          }}
        >
          <div style={{ color: '#BFD2FF', fontWeight: 800, fontSize: 13, opacity: 0.9 }}>
            SCORE
          </div>

<div style={{ fontWeight: 900, fontSize: 28, color: '#EAF0FF' ,fontSizeAdjust: '0.45'}}>
  <span style={{ color: '#FFD34A', textShadow: '0 0 18px rgba(255,211,74,.25)' }}>
    {scoreUI}
  </span>
</div>

<div style={{ height: 1, background: 'rgba(140,170,255,.14)' }} />

<div style={{ color: '#BFD2FF', fontWeight: 800, fontSize: 12, opacity: 0.85 }}>
  YOUR BEST
</div>

<div style={{ fontWeight: 900, fontSize: 20, color: '#EAF0FF' }}>
  <span style={{ color: '#4DFFB5', textShadow: '0 0 16px rgba(77,255,181,.18)' }}>
    {bestScoreUI}
  </span>
</div>

<div style={{ height: 1, background: 'rgba(140,170,255,.14)' }} />

          <button style={btnGhost} onClick={resetGame}>
            🔁 Restart
          </button>

          <button style={btnGhost} onClick={() => setScreen('MENU')}>
            ☰ Menu
          </button>

          <button style={btnGhost} onClick={() => navigate('/')}>
            🏠 Home
          </button>

          {/* Fancy Combo Indicator */}
          <div style={{
            marginTop: 10,
            padding: '12px 0',
            background: 'rgba(0,0,0,0.25)',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.06)',
            textAlign: 'center',
            transition: 'all 0.3s ease',
            opacity: comboTierRef.current > 1 ? 1 : 0.5,
            transform: comboTierRef.current > 1 ? 'scale(1.02)' : 'scale(1)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8CA6DB', letterSpacing: 1.5, marginBottom: 4 }}>
              COMBO
            </div>
            <div
              key={comboTierRef.current}
              style={{
                fontSize: 32,
                fontWeight: 900,
                lineHeight: 1,
                display: 'inline-block',
                background: comboTierRef.current > 1 ? 'linear-gradient(180deg, #FFF 20%, #FFD34A 100%)' : undefined,
                WebkitBackgroundClip: comboTierRef.current > 1 ? 'text' : undefined,
                WebkitTextFillColor: comboTierRef.current > 1 ? 'transparent' : undefined,
                color: comboTierRef.current > 1 ? undefined : '#5A6B8C',
                filter: comboTierRef.current > 1 ? 'drop-shadow(0 0 16px rgba(255,211,74,0.6))' : 'none',
                animation: comboTierRef.current > 1 ? 'bbComboBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
              }}
            >
              ×{comboTierRef.current}
            </div>
          </div>
        </div>



        <div style={{ display: 'flex', flexDirection: 'column', placeItems: 'center', gap: 14, alignItems: 'center' }}>
          <div
            ref={boardWrapRef}
            style={{
              position: 'relative',
              width: boardPx.w,
              borderRadius: 24,
              background: 'rgba(8,10,18,.7)',
              border: '1px solid rgba(120,150,255,.14)',
              boxShadow: '0 28px 90px rgba(0,0,0,.65)',
              padding: 14,
            }}
          >
            
            <canvas ref={boardCanvasRef} style={{ borderRadius: 22, display: 'block' }} />


          {g.gameOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                marginRight: -15,
                borderRadius: 22,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0,0,0,.55)',
                backdropFilter: 'blur(6px)',
                color: '#fff',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, fontWeight: 900 }}>Game Over</div>
                <div style={{ opacity: 0.85, marginTop: 6 }}>אין יותר מהלכים אפשריים</div>
                <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button style={btnPrimary} onClick={resetGame}>
                    🔁 Restart
                  </button>
                  <button style={btnGhost} onClick={() => navigate("/")}>
                    ☰ Home
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>

          <div
            style={{
              width: boardPx.w,
              borderRadius: 22,
              background: 'rgba(8,10,18,.65)',
              border: '1px solid rgba(120,150,255,.14)',
              boxShadow: '0 22px 70px rgba(0,0,0,.55)',
              padding: 10,
            }}
          >
            <div style={{ color: '#BFD2FF', fontWeight: 700, margin: '4px 8px 10px' }}>
              Pick a block (drag to board)
            </div>

            <canvas
              ref={trayCanvasRef}
              style={{
                borderRadius: 18,
                width: boardPx.w,
                height: TRAY_HEIGHT,
                display: 'block',
                touchAction: 'none',
                cursor: 'grab',
              }}
            />
          </div>
        </div>

        {/* Leaderboard Panel */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 'clamp(12px, 2vw, 18px)',
            borderRadius: 18,
            background: 'rgba(8,10,18,.70)',
            border: '1px solid rgba(120,150,255,.14)',
            boxShadow: '0 18px 55px rgba(0,0,0,.45)',
            backdropFilter: 'blur(8px)',
            minWidth: 'clamp(200px, 20vw, 260px)',
            maxWidth: 320,
            height: 'fit-content',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ color: '#EAF0FF', fontWeight: 900, letterSpacing: 0.2 }}>
              🏆 Leaderboard
            </div>
            <div style={{ color: '#BFD2FF', fontSize: 12, opacity: 0.75 }}>Top 10</div>
          </div>

          <div style={{ height: 1, background: 'rgba(140,170,255,.14)' }} />

          <div style={{ display: 'grid', gap: 6 }}>
            {leaderboard.length === 0 ? (
              <div style={{ opacity: 0.7, color: '#BFD2FF', fontSize: 13 }}>Loading…</div>
            ) : (
              leaderboard.map((row, i) => (
                <div
                  key={`${row.name}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '26px 1fr auto',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 14,
                    border: '1px solid rgba(140,170,255,.12)',
                    background:
                      i === 0
                        ? 'rgba(255,211,74,.10)'
                        : i === 1
                        ? 'rgba(160,180,255,.08)'
                        : i === 2
                        ? 'rgba(77,255,181,.07)'
                        : 'rgba(10,14,28,.38)',
                  }}
                >
                  <div style={{ fontWeight: 900, color: '#BFD2FF', opacity: 0.9 }}>
                    {i + 1}
                  </div>

                  <div
                    style={{
                      color: '#EAF0FF',
                      fontWeight: 800,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={row.name}
                  >
                    {row.name}
                  </div>

                  <div style={{ color: '#FFD34A', fontWeight: 900 }}>
                    {row.score}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ height: 1, background: 'rgba(140,170,255,.14)' }} />

          <div style={{ opacity: 0.65, color: '#BFD2FF', fontSize: 12, lineHeight: 1.35 }}>
            השיאים מתעדכנים בזמן אמת 🔥
          </div>
        </div>
      </div>
    </>
  );
}

/* ================= HELPERS ================= */

/* ================= TRAY GENERATION (Block Blast-style) =================
   Goals:
   1) Player should never receive a fresh tray of 3 blocks that is immediately impossible.
   2) Distribution: VERY easy blocks and VERY hard blocks are both rarer than "medium" blocks.
   3) Easy to tune: tweak TRAY_CONFIG only.
*/

const TRAY_CONFIG = {
  // How many candidate trays we are willing to try before falling back.
  maxTries: 500,

  // If true: require that ALL 3 blocks can be placed (in some order), including line clears in between.
  // If false: only require that at least ONE of the 3 blocks has a legal placement right now.
  requireAllThreeSolvable: true,

  // Base weights by cell-count (tune these!)
  // "Very easy" (1-2) and "very hard" (6,9) are intentionally lower than medium sizes.
  weightBySize: {
    1: 0.22,
    2: 0.45,
    3: 1.00,
    4: 1.12,
    5: 0.78,
    6: 0.52,
    9: 0.22,
  } as Record<number, number>,

  // Extra penalty/bonus multipliers (tune these!)
  extra: {
    // long thin lines (often too "swingy" on small boards)
    thinLinePenalty: 0.88,

    // slightly discourage 1x1 specifically (too easy)
    singlePenalty: 0.80,

    // slightly discourage the 3x3 block (very hard on 8x8)
    square3x3Penalty: 0.75,
  },

  // Debug: log why candidate trays were rejected
  debugLogs: true,
  logEveryNFailures: 50,
};

function shapeMeta(shape: BlockShape) {
  let maxR = 0, maxC = 0;
  for (const p of shape) { if (p.r > maxR) maxR = p.r; if (p.c > maxC) maxC = p.c; }
  const h = maxR + 1;
  const w = maxC + 1;
  const cells = shape.length;
  const area = w * h;
  const thin = (w === 1 || h === 1);
  const is3x3 = (w === 3 && h === 3 && cells === 9);
  return { w, h, cells, area, thin, is3x3 };
}

function shapeWeight(shape: BlockShape): number {
  const m = shapeMeta(shape);
  let w = TRAY_CONFIG.weightBySize[m.cells] ?? 1.0;

  if (m.thin && m.cells >= 4) w *= TRAY_CONFIG.extra.thinLinePenalty;
  if (m.cells === 1) w *= TRAY_CONFIG.extra.singlePenalty;
  if (m.is3x3) w *= TRAY_CONFIG.extra.square3x3Penalty;

  // Mild preference for "denser" shapes (less empty area inside bounding box)
  // Density in [0..1]. Pushes weight by ~ ±10%.
  const density = m.cells / Math.max(1, m.area);
  w *= (0.9 + 0.2 * density);

  return Math.max(0.0001, w);
}

const SHAPE_WEIGHTS = BLOCKS.map((shape, idx) => ({
  idx,
  w: shapeWeight(shape),
}));

const SHAPE_WEIGHT_SUM = SHAPE_WEIGHTS.reduce((s, x) => s + x.w, 0);

function weightedPickShapeIndex(): number {
  let r = Math.random() * SHAPE_WEIGHT_SUM;
  for (const x of SHAPE_WEIGHTS) {
    r -= x.w;
    if (r <= 0) return x.idx;
  }
  return SHAPE_WEIGHTS[SHAPE_WEIGHTS.length - 1].idx;
}

function pickWeightedTray(): { shapeIdxs: number[]; tray: TrayBlock[] } {
  const shapeIdxs: number[] = [];
  const tray: TrayBlock[] = [];

  while (shapeIdxs.length < 3) {
    const idx = weightedPickShapeIndex();
    shapeIdxs.push(idx);
    tray.push({
      shape: BLOCKS[idx],
      colorId: 1 + Math.floor(Math.random() * PALETTE.length),
    });
  }

  return { shapeIdxs, tray };
}

function cloneBoardLocal(board: Board): Board {
  return board.map((row) => row.slice()) as Board;
}

function boardKey(board: Board): string {
  // occupancy-only key (colors irrelevant for legality/clears)
  return board.map((row) => row.map((v) => (v ? '1' : '0')).join('')).join('|');
}


function traySolveAllThree(
  board: Board,
  shapeIdxs: number[]
): { ok: boolean; path: Array<{ shapeIdx: number; r: number; c: number }> } {
  // DFS with memo: can we place ALL remaining shapes (in some order), allowing clears in between?
  // Returns a concrete path when solvable (useful for debugging).
  const memo = new Set<string>();

  function key(b: Board, remaining: number[]): string {
    const rem = remaining.slice().sort((a, b2) => a - b2).join(',');
    return boardKey(b) + '::' + rem;
  }

  function dfs(
    b: Board,
    remaining: number[],
    path: Array<{ shapeIdx: number; r: number; c: number }>
  ): { ok: boolean; path: Array<{ shapeIdx: number; r: number; c: number }> } {
    if (remaining.length === 0) return { ok: true, path };

    const k = key(b, remaining);
    if (memo.has(k)) return { ok: false, path: [] };
    memo.add(k);

    for (let i = 0; i < remaining.length; i++) {
      const shapeIdx = remaining[i];
      const shape = BLOCKS[shapeIdx];

      // Try all placements for this shape
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!canPlace(b, shape, r, c)) continue;

          const b2 = cloneBoardLocal(b);
          placeBlock(b2, shape, r, c, 1); // color doesn't matter for legality/clears
          const cleared = clearLines(b2).board;

          const next = remaining.slice(0, i).concat(remaining.slice(i + 1));
          const res = dfs(cleared, next, path.concat([{ shapeIdx, r, c }]));
          if (res.ok) return res;
        }
      }
    }

    return { ok: false, path: [] };
  }

  // Work on a snapshot board (we never mutate the input, but this avoids accidental shared refs)
  return dfs(cloneBoardLocal(board), shapeIdxs.slice(), []);
}




function pickTrayGuaranteed(board: Board): TrayBlock[] {
  // Try many random weighted candidates. If none pass, fall back to a "rescue" tray.
  let failNoMove = 0;
  let failNotSolvable = 0;

  for (let t = 0; t < TRAY_CONFIG.maxTries; t++) {
    const { shapeIdxs, tray } = pickWeightedTray();

    if (TRAY_CONFIG.requireAllThreeSolvable) {
      const solved = traySolveAllThree(board, shapeIdxs);
      if (solved.ok) {
        if (TRAY_CONFIG.debugLogs && (failNoMove + failNotSolvable) > 0) {
          console.log(
            `[BB][TrayGen] accepted after ${t + 1} tries (fails: noMove=${failNoMove}, notSolvable=${failNotSolvable})`,
            { shapeIdxs, path: solved.path }
          );
        }
        return tray;
      }
      failNotSolvable++;
    } else {
      if (anyMoveExists(board, tray.map((b) => b.shape))) return tray;
      failNoMove++;
    }

    // Periodic progress log (so you can see it working without spamming)
    if (TRAY_CONFIG.debugLogs && TRAY_CONFIG.logEveryNFailures > 0) {
      const fails = failNoMove + failNotSolvable;
      if (fails > 0 && fails % TRAY_CONFIG.logEveryNFailures === 0) {
        console.log(
          `[BB][TrayGen] still searching... tries=${t + 1}/${TRAY_CONFIG.maxTries} (noMove=${failNoMove}, notSolvable=${failNotSolvable})`
        );
      }
    }
  }

  // ---------------- Rescue fallback ----------------
  // We try a few curated "easy-ish" trays and still require solvability when requireAllThreeSolvable=true.
  const EASY_CANDIDATES: number[][] = [
    [0, 1, 11],   // 1x1, 1x2, 2x2
    [0, 2, 11],   // 1x1, 2-vertical, 2x2
    [1, 2, 11],   // 1x2 both orientations + 2x2
    [0, 5, 11],   // 1x1 + small L(3) + 2x2
    [0, 3, 4],    // 1x1 + 3-line H/V
    [11, 11, 0],  // two 2x2 + 1x1
    [0, 0, 11],   // two 1x1 + 2x2
    [0, 0, 0],    // last resort: all singles
  ];

  for (const idxs of EASY_CANDIDATES) {
    const tray = idxs.map((idx) => ({
      shape: BLOCKS[idx],
      colorId: 1 + Math.floor(Math.random() * PALETTE.length),
    }));

    if (TRAY_CONFIG.requireAllThreeSolvable) {
      if (traySolveAllThree(board, idxs).ok) {
        if (TRAY_CONFIG.debugLogs) {
          console.warn("[BB][TrayGen] using RESCUE tray (solvable)", { idxs });
        }
        return tray;
      }
    } else {
      if (anyMoveExists(board, tray.map((b) => b.shape))) {
        if (TRAY_CONFIG.debugLogs) {
          console.warn("[BB][TrayGen] using RESCUE tray (has at least one move)", { idxs });
        }
        return tray;
      }
    }
  }

  // Absolute fallback (should never happen)
  if (TRAY_CONFIG.debugLogs) {
    console.error("[BB][TrayGen] RESCUE failed; returning 3 singles");
  }
  return [
    { shape: BLOCKS[0], colorId: 1 + Math.floor(Math.random() * PALETTE.length) },
    { shape: BLOCKS[0], colorId: 1 + Math.floor(Math.random() * PALETTE.length) },
    { shape: BLOCKS[0], colorId: 1 + Math.floor(Math.random() * PALETTE.length) },
  ];
}


const btnPrimary: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid rgba(255,211,74,.45)',
  background: 'linear-gradient(180deg, rgba(255,211,74,.98), rgba(255,170,30,.92))',
  color: '#0B0E14',
  fontWeight: 900,
  boxShadow: '0 18px 50px rgba(255,211,74,.22)',
};

const btnGhost: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid rgba(140,170,255,.18)',
  background: 'rgba(10,14,28,.55)',
  color: '#EAF0FF',
  fontWeight: 800,
  boxShadow: '0 18px 55px rgba(0,0,0,.35)',
};

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
























// ====================== DEBUG DUMP (copy/paste) ======================

type AnyBoard = any; // כדי שלא תיתקע על טיפוסים אם הם שונים אצלך
type AnyShape = any;
type AnyTrayItem = any;

// ממפה ערך תא (0/undefined = ריק) לתו נוח
function cellToChar(v: any): string {
  if (!v) return ".";
  // אם זה מספר צבעים 1..N
  if (typeof v === "number") {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return alphabet[(v - 1) % alphabet.length] ?? "#";
  }
  // אם זה אובייקט (לפעמים שומרים {colorId,...})
  if (typeof v === "object" && v !== null) {
    const n = (v.colorId ?? v.color ?? v.id ?? 1) as number;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return alphabet[(Number(n) - 1) % alphabet.length] ?? "#";
  }
  return "#";
}

// מצייר לוח (Board) ל-ASCII
export function boardToAscii(board: AnyBoard, rows = 8, cols = 8): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v = board?.[r]?.[c];
      line += cellToChar(v);
    }
    out.push(line);
  }
  return out.join("\n");
}

// ממיר Shape לרשימת תאים יחסיים
// תומך בכמה מבנים נפוצים: shape.cells או shape (מערך של {r,c} / {x,y})
function shapeCells(shape: AnyShape): Array<{ r: number; c: number }> {
  const cells =
    shape?.cells ??
    shape?.pos ??
    shape?.positions ??
    shape?.blocks ??
    shape; // אם shape עצמו הוא array

  if (!Array.isArray(cells)) return [];

  return cells
    .map((p: any) => {
      if (p == null) return null;
      if (typeof p === "object") {
        const r = p.r ?? p.row ?? p.y;
        const c = p.c ?? p.col ?? p.x;
        if (Number.isFinite(r) && Number.isFinite(c)) return { r: Number(r), c: Number(c) };
      }
      return null;
    })
    .filter(Boolean) as Array<{ r: number; c: number }>;
}

// מצייר צורה ל-ASCII (מנורמל ל-bounding box שלה)
export function shapeToAscii(shape: AnyShape): string {
  const cells = shapeCells(shape);
  if (cells.length === 0) return "(empty shape)";

  const minR = Math.min(...cells.map((p) => p.r));
  const minC = Math.min(...cells.map((p) => p.c));
  const maxR = Math.max(...cells.map((p) => p.r));
  const maxC = Math.max(...cells.map((p) => p.c));

  const h = maxR - minR + 1;
  const w = maxC - minC + 1;

  const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => "·"));
  for (const { r, c } of cells) {
    grid[r - minR][c - minC] = "■";
  }
  return grid.map((row) => row.join(" ")).join("\n");
}

export function trayToAscii(tray: AnyTrayItem[]): string {
  if (!tray || tray.length === 0) return "(tray empty)";
  return tray
    .map((t, i) => {
      const shape = t?.shape ?? t;
      const colorId = t?.colorId ?? t?.color ?? t?.id ?? "";
      const cells = shapeCells(shape);
      const size = cells.length;
      return [
        `#${i + 1} color=${colorId} size=${size}`,
        shapeToAscii(shape),
      ].join("\n");
    })
    .join("\n\n");
}

// דמפ מלא: ASCII + JSON קטן לשחזור
export function dumpBlockBlastState(args: {
  board: AnyBoard;
  tray: AnyTrayItem[];
  score?: number;
  rows?: number;
  cols?: number;
}): string {
  const rows = args.rows ?? 8;
  const cols = args.cols ?? 8;

  const payload = {
    rows,
    cols,
    score: args.score ?? 0,
    // שומרים לוח כ-0/1..n כדי שיהיה קומפקטי
    board: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const v = args.board?.[r]?.[c];
        if (!v) return 0;
        if (typeof v === "number") return v;
        if (typeof v === "object" && v !== null) return Number(v.colorId ?? v.color ?? v.id ?? 1);
        return 1;
      })
    ),
    // שומרים tray כסט תאים + colorId
    tray: (args.tray ?? []).map((t: any) => ({
      colorId: t?.colorId ?? t?.color ?? t?.id ?? 1,
      cells: shapeCells(t?.shape ?? t),
    })),
  };

  return [
    "=== BLOCKBLAST STATE v1 ===",
    `rows=${rows} cols=${cols} score=${payload.score}`,
    "",
    "BOARD:",
    boardToAscii(payload.board, rows, cols),
    "",
    "TRAY:",
    trayToAscii(payload.tray),
    "",
    "JSON:",
    JSON.stringify(payload),
    "=== END ===",
  ].join("\n");
}

// עוזר: להעתיק לקליפבורד
export async function copyDumpToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    console.log("[BB] dump copied to clipboard ✅");
  } catch {
    console.log("[BB] clipboard failed; dump printed below:");
    console.log(text);
  }
}
