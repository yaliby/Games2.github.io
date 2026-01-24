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

type GameState = {
  board: Board;
  tray: TrayBlock[];
  score: number;
  drag: DragState;
  flash: FlashState;
  gameOver: boolean;
  scoreSubmitted: boolean;
};


/* ================= COMPONENT ================= */

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

  const gameRef = useRef<GameState>({
  board: createBoard(),
  tray: pickRandomTray(),
  score: 0,
  drag: null,
  flash: null,
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

  const triggerShake = (strength: 'sm' | 'md' = 'sm') => {
    const el = boardWrapRef.current;
    if (!el) return;

    // restart animation reliably
    el.classList.remove('bb-shake-sm', 'bb-shake-md');
    // force reflow
    void el.offsetWidth;
    el.classList.add(strength === 'md' ? 'bb-shake-md' : 'bb-shake-sm');

    window.setTimeout(() => {
      el.classList.remove('bb-shake-sm', 'bb-shake-md');
    }, 220);
  };

  const resetGame = () => {
  gameRef.current = {
    board: createBoard(),
    tray: pickRandomTray(),
    score: 0,
    drag: null,
    flash: null,
    gameOver: false,
    scoreSubmitted: false,
  };
  setScoreUI(0);
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
        const cMinCell = Math.round(oxBoard / tileSize);
        const rMinCell = Math.round(oyBoard / tileSize);

        // anchor for rules placement
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

        if (res.cleared > 0) {
          g.flash = {
            rows: res.rows,
            cols: res.cols,
            cells: res.cells,
            start: performance.now(),
            duration: 420,
          };

          // subtle screen shake on clear
          triggerShake(res.cleared >= 2 ? 'md' : 'sm');
        }

        g.score += drag.block.shape.length * 12 + res.cleared * 140;
        setScoreUI(g.score);

        // ✅ עדכון UI מיידי (לא מחכה למסד)
        setBestScoreUI(prev => (g.score > prev ? g.score : prev));

        // ✅ ניסיון עדכון למסד (רק אם עקפנו)
        tryPushBestScore(g.score);

        // remove used tray block
        g.tray.splice(drag.index, 1);

        // refill
        if (g.tray.length === 0) g.tray = pickRandomTray();

        g.gameOver = !anyMoveExists(g.board, g.tray.map((b) => b.shape));
      }

      g.drag = null;
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

      drawTray();
      drawFloatingDrag();

      rafRef.current = requestAnimationFrame(loop);
    };

    trayCanvas.addEventListener('pointerdown', onPointerDownTray);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', resizeOverlay);

    loop();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      trayCanvas.removeEventListener('pointerdown', onPointerDownTray);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
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
          0% { transform: translate3d(0,0,0) rotate(0deg); }
          15% { transform: translate3d(-1px, 0px, 0) rotate(-0.15deg); }
          30% { transform: translate3d(1px, 0px, 0) rotate(0.15deg); }
          45% { transform: translate3d(-1px, 0px, 0) rotate(-0.10deg); }
          60% { transform: translate3d(1px, 0px, 0) rotate(0.10deg); }
          75% { transform: translate3d(-1px, 0px, 0) rotate(-0.06deg); }
          100% { transform: translate3d(0,0,0) rotate(0deg); }
        }
        @keyframes bbShakeMd {
          0% { transform: translate3d(0,0,0) rotate(0deg); }
          10% { transform: translate3d(-2px, -1px, 0) rotate(-0.25deg); }
          20% { transform: translate3d(2px, 1px, 0) rotate(0.25deg); }
          35% { transform: translate3d(-2px, 1px, 0) rotate(-0.18deg); }
          50% { transform: translate3d(2px, -1px, 0) rotate(0.18deg); }
          70% { transform: translate3d(-1px, 0px, 0) rotate(-0.10deg); }
          100% { transform: translate3d(0,0,0) rotate(0deg); }
        }
        .bb-shake-sm { animation: bbShakeSm 180ms ease-out both; }
        .bb-shake-md { animation: bbShakeMd 220ms ease-out both; }
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

function pickRandomTray(): TrayBlock[] {
  const bag = [...BLOCKS, ...BLOCKS, ...BLOCKS].sort(() => Math.random() - 0.5);

  // random color per block (Block Blast style)
  return bag.slice(0, 3).map((shape) => ({
    shape,
    colorId: 1 + Math.floor(Math.random() * PALETTE.length),
  }));
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
