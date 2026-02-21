import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Board, Player, Winner, Pos, MoveSequence, Move, Cell } from './engine/types';
import { ROWS, COLS } from './engine/types';
import {
  createBoard,
  getAllMoves,
  applyMove,
  getWinner,
  RED,
  BLACK,
  otherPlayer,
  getSingleCaptureMoves,
  isKing,
  EMPTY,
} from './engine/rules_ai';
import { drawBoard } from './render/renderer';
import { addAchievement } from '../../services/achievementService';
import { auth } from '../../services/firebase';

/* ================= CONFIG ================= */
const AI_DELAY = 0.5;

// Calculate responsive tile size
function calculateTileSize(): number {
  const maxWidth = window.innerWidth - 40; // Account for padding
  const maxHeight = window.innerHeight - 200; // Account for header/footer/UI
  const baseTile = Math.floor(Math.min(maxWidth, maxHeight) * 0.08);
  const boardWidth = COLS * baseTile;
  const boardHeight = ROWS * baseTile;
  const graveyardWidth = baseTile * 1.15 * 2;
  const totalWidth = boardWidth + graveyardWidth;
  
  // Ensure it fits on screen
  const scaleX = maxWidth / totalWidth;
  const scaleY = maxHeight / boardHeight;
  const scale = Math.min(scaleX, scaleY, 1);
  
  return Math.max(30, Math.floor(baseTile * scale));
}

// Click-vs-drag threshold (px)
const DRAG_THRESHOLD = 6;

type Screen = 'MENU' | 'GAME';

type Anim = {
  active: boolean;
  from: Pos;
  to: Pos;
  captures: Pos[];
  t: number;
  startTime: number;
};

export default function CheckersGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const medalAwardedRef = useRef<boolean>(false);
  const navigate = useNavigate();

  /* ---------- UI STATE ---------- */
  const [screen, setScreen] = useState<Screen>('MENU');
  const [vsAI, setVsAI] = useState<boolean>(true);
  const [aiDepth, setAiDepth] = useState<number>(6);
  const [tileSize, setTileSize] = useState<number>(calculateTileSize());

  /* ---------- GAME STATE (REF) ---------- */
  const gameRef = useRef<{
    board: Board;
    turn: Player;
    winner: Winner;
    selectedPos: Pos | null;
    hoveredPos: Pos | null;
    validMoves: Pos[];

    // ✅ NEW: pieces that MUST capture this turn (green highlight)
    forcedCaptures: Pos[];

    drag: {
      active: boolean;
      from: Pos;
      cell: number;
      x: number;
      y: number;
      grabDx: number;
      grabDy: number;
    } | null;

    // click candidate (click-to-select / click-to-move)
    clickCandidate: {
      pos: Pos;
      x: number;
      y: number;
      moved: boolean;
      isPiece: boolean;
    } | null;

    anim: Anim | null;
    lastMove: MoveSequence | null;
    aiPending: boolean;
    aiThinking: boolean; // True when worker is calculating
    aiResult: MoveSequence | null; // Stores result from worker
    aiTimer: number;
    msg: string;
    inChainCapture: boolean;
    chainCaptureFrom: Pos | null;
    graveyard: {
      player: number; // 1 = RED, 2 = BLACK (for renderer compatibility)
      cell: Cell;
      index: number;
    }[];
  } | null>(null);

  // Canvas size includes side margins for graveyard
  const GRAVEYARD_WIDTH = tileSize * 1.15; // Matches renderer default

  const size = useMemo(
    () => ({
      w: COLS * tileSize + GRAVEYARD_WIDTH * 2,
      h: ROWS * tileSize,
    }),
    [tileSize]
  );

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setTileSize(calculateTileSize());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* ================= WORKER SETUP ================= */
  useEffect(() => {
    // Initialize the Web Worker
    const worker = new Worker(new URL('./engine/ai.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (gameRef.current && e.data.type === 'SUCCESS') {
        gameRef.current.aiResult = e.data.move;
        gameRef.current.aiThinking = false;
      }
    };

    return () => worker.terminate();
  }, []);

  /* ================= RESET FUNCTION ================= */
  const resetGame = useCallback(() => {
    if (gameRef.current) {
      const g = gameRef.current;
      g.board = createBoard();
      g.graveyard = [];
      g.turn = RED;
      g.winner = { kind: 'NONE' };
      g.selectedPos = null;
      g.hoveredPos = null;
      g.validMoves = [];
      g.anim = null;
      g.lastMove = null;
      g.aiPending = false;
      g.aiThinking = false;
      g.aiResult = null;
      g.aiTimer = 0;
      g.msg = 'Hold left-click on a piece, drag, then release on a valid square.';
      g.drag = null;
      g.clickCandidate = null;
      g.inChainCapture = false;
      g.chainCaptureFrom = null;
      g.forcedCaptures = [];
    }
    medalAwardedRef.current = false;
  }, []);

  useEffect(() => {
    if (screen !== 'GAME') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /* HiDPI */
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Init game */
    gameRef.current = {
      board: createBoard(),
      graveyard: [],
      turn: RED,
      winner: { kind: 'NONE' },
      selectedPos: null,
      hoveredPos: null,
      validMoves: [],
      forcedCaptures: [],

      drag: null,
      clickCandidate: null,

      anim: null,
      lastMove: null,
      aiPending: false,
      aiThinking: false,
      aiResult: null,
      aiTimer: 0,
      msg: 'Hold left-click on a piece, drag, then release on a valid square.',
      inChainCapture: false,
      chainCaptureFrom: null,
    };
    medalAwardedRef.current = false;

    let lastTs = performance.now();
    const gameStartTime = performance.now();

    const canHumanInteract = (g: NonNullable<typeof gameRef.current>) => {
      return !vsAI || g.turn === RED;
    };

    // Account for board offset (graveyard on sides)
    const GRAVEYARD_WIDTH = tileSize * 1.15;
    const BOARD_OFFSET_X = GRAVEYARD_WIDTH;

    const posFromXY = (x: number, y: number): Pos | null => {
      const xBoard = x - BOARD_OFFSET_X;
      if (xBoard < 0 || xBoard >= COLS * tileSize) return null;

      const c = Math.floor(xBoard / tileSize);
      const r = Math.floor(y / tileSize);

      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
      return { r, c };
    };

    const isDarkSquare = (p: Pos) => (p.r + p.c) % 2 === 1;

    const pieceCenterPx = (p: Pos) => ({
      x: BOARD_OFFSET_X + p.c * tileSize + tileSize / 2,
      y: p.r * tileSize + tileSize / 2,
    });

    const isOwnPiece = (g: NonNullable<typeof gameRef.current>, p: Pos) => {
      const cell = g.board[p.r]?.[p.c] ?? 0;
      const isRedPiece = cell === 1 || cell === 2;
      const isBlackPiece = cell === 3 || cell === 4;
      return (g.turn === RED && isRedPiece) || (g.turn === BLACK && isBlackPiece);
    };

    // ✅ NEW: compute which pieces must capture (green highlight), and keep until turn ends
    const recomputeForcedCaptures = (g: NonNullable<typeof gameRef.current>) => {
      // If vsAI and it's AI turn, don't show green for AI (keeps UI clean)
      if (vsAI && g.turn === BLACK) {
        g.forcedCaptures = [];
        return;
      }

      // During chain capture, only the chain piece is mandatory
      if (g.inChainCapture && g.chainCaptureFrom) {
        g.forcedCaptures = [g.chainCaptureFrom];
        return;
      }

      const all = getAllMoves(g.board, g.turn, null);
      const caps = all.filter((seq) => (seq as any).totalCaptures > 0) as MoveSequence[];

      const uniq: Pos[] = [];
      for (const seq of caps) {
        const m0 = seq.moves[0];
        if (!m0) continue;
        const f = m0.from;
        if (!uniq.some((p) => p.r === f.r && p.c === f.c)) uniq.push(f);
      }
      g.forcedCaptures = uniq;
    };

    // initial computation
    recomputeForcedCaptures(gameRef.current);

    const tryMove = (from: Pos, to: Pos) => {
      const g = gameRef.current!;
      if (g.winner.kind !== 'NONE') return;
      if (g.anim?.active) return;

      if (vsAI && g.turn !== RED) return;

      if (g.inChainCapture && g.chainCaptureFrom) {
        if (from.r !== g.chainCaptureFrom.r || from.c !== g.chainCaptureFrom.c) {
          g.msg = 'You must continue the chain capture from the current position.';
          return;
        }
      }

      const allMoves = getAllMoves(g.board, g.turn, g.chainCaptureFrom);

      let matchingMove: Move | null = null;
      for (const seq of allMoves) {
        if (seq.moves.length > 0) {
          const move = seq.moves[0];
          if (
            move.from.r === from.r &&
            move.from.c === from.c &&
            move.to.r === to.r &&
            move.to.c === to.c
          ) {
            matchingMove = move;
            break;
          }
        }
      }

      if (!matchingMove) return;

      // Start animation
      g.anim = {
        active: true,
        from: matchingMove.from,
        to: matchingMove.to,
        captures: matchingMove.captures,
        t: 0,
        startTime: performance.now(),
      };

      // Since move is committed, clear global forced markers for this turn (until turn/chain dictates again)
      g.forcedCaptures = [];

      // Add captured pieces to graveyard and remove from board IMMEDIATELY
      if (matchingMove.captures.length > 0) {
        for (const cap of matchingMove.captures) {
          const capturedCell = g.board[cap.r][cap.c];
          const capturedPlayer = (capturedCell === 1 || capturedCell === 2) ? 1 : 2;

          g.board[cap.r][cap.c] = EMPTY;

          g.graveyard.push({
            player: capturedPlayer,
            cell: capturedCell,
            index: g.graveyard.length,
          });
        }
      }

      const result = applyMove(g.board, matchingMove, g.turn);

      if (!result.success) {
        g.anim = null;
        return;
      }

      if (result.canContinueCapture) {
        g.inChainCapture = true;
        g.chainCaptureFrom = matchingMove.to;
        g.selectedPos = matchingMove.to;

        const nextCaptures = getSingleCaptureMoves(
          g.board,
          matchingMove.to,
          g.turn,
          isKing(g.board[matchingMove.to.r][matchingMove.to.c]),
          true
        );
        g.validMoves = nextCaptures.map((m) => m.to);
        g.msg = 'Continue chain capture - release on a highlighted square.';

        // ✅ keep green highlight on the mandatory chain piece
        g.forcedCaptures = [matchingMove.to];
      } else {
        g.inChainCapture = false;
        g.chainCaptureFrom = null;
        g.selectedPos = null;
        g.validMoves = [];
      }
    };

    const startDragIfPossible = (g: NonNullable<typeof gameRef.current>, p: Pos, x: number, y: number) => {
      if (!isDarkSquare(p)) return;

      if (g.inChainCapture && g.chainCaptureFrom) {
        if (p.r !== g.chainCaptureFrom.r || p.c !== g.chainCaptureFrom.c) {
          g.msg = 'You must continue the chain capture from the current position.';
          return;
        }
      }

      if (!isOwnPiece(g, p)) return;

      const allMoves = getAllMoves(g.board, g.turn, g.inChainCapture ? g.chainCaptureFrom : null);
      const movesForPiece = allMoves.filter(
        (seq) =>
          seq.moves.length > 0 &&
          seq.moves[0].from.r === p.r &&
          seq.moves[0].from.c === p.c
      );

      if (movesForPiece.length === 0) return;

      g.selectedPos = p;
      g.validMoves = movesForPiece.map((seq) => seq.moves[0].to);

      const hasCaptures = movesForPiece.some((seq) => (seq as any).totalCaptures > 0);
      g.msg = hasCaptures
        ? 'Captures are mandatory! Drag/release or click a highlighted square to capture.'
        : 'Drag/release or click a highlighted square to move.';

      const center = pieceCenterPx(p);
      const grabDx = x - center.x;
      const grabDy = y - center.y;

      const cell = g.board[p.r]?.[p.c] ?? 0;
      g.drag = {
        active: true,
        from: p,
        cell,
        x: center.x,
        y: center.y,
        grabDx,
        grabDy,
      };
    };

    // ✅ indicators should NOT disappear on invalid attempts
    const cancelDrag = (g: NonNullable<typeof gameRef.current>, _keepSelection: boolean) => {
      g.drag = null;

      if (g.selectedPos && g.validMoves.length > 0) {
        g.msg = 'Choose a highlighted square, or select another piece.';
      } else {
        g.msg = g.turn === RED ? 'RED turn - Select or drag a piece' : 'BLACK turn - Select or drag a piece';
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const g = gameRef.current!;
      if (g.winner.kind !== 'NONE') return;
      if (g.anim?.active) return;
      if (!canHumanInteract(g)) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const p = posFromXY(x, y);
      if (!p) return;

      e.preventDefault();

      const cell = g.board[p.r]?.[p.c] ?? EMPTY;
      const isPiece = cell !== EMPTY;

      // store click candidate even if empty (for click-to-move)
      g.clickCandidate = { pos: p, x, y, moved: false, isPiece };
    };

    const onMouseMove = (e: MouseEvent) => {
      const g = gameRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const p = posFromXY(x, y);

      if (p && p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS && isDarkSquare(p)) {
        g.hoveredPos = p;
      } else {
        g.hoveredPos = null;
      }

      if (g.clickCandidate && !g.drag?.active) {
        const dx = x - g.clickCandidate.x;
        const dy = y - g.clickCandidate.y;

        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          g.clickCandidate.moved = true;

          // start real drag only if press began on a piece
          if (g.clickCandidate.isPiece) {
            startDragIfPossible(g, g.clickCandidate.pos, x, y);
          }

          g.clickCandidate = null;
        }
      }

      if (g.drag?.active) {
        g.drag.x = x - g.drag.grabDx;
        g.drag.y = y - g.drag.grabDy;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const g = gameRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const target = posFromXY(x, y);

      // ---- DRAG FLOW ----
      if (g.drag?.active) {
        const from = g.drag.from;
        g.drag = null;

        if (!target || !isDarkSquare(target)) {
          cancelDrag(g, true);
          return;
        }

        const isAllowedTarget = g.validMoves.some((m) => m.r === target.r && m.c === target.c);

        if (!isAllowedTarget) {
          cancelDrag(g, true);
          return;
        }

        tryMove(from, target);
        return;
      }

      // ---- CLICK FLOW ----
      if (g.clickCandidate && !g.clickCandidate.moved) {
        const clickedPos = g.clickCandidate.pos;

        // click on your own piece -> select it
        if (g.clickCandidate.isPiece && isOwnPiece(g, clickedPos)) {
          startDragIfPossible(g, clickedPos, x, y);
          g.drag = null; // keep selection, no drag visual
          g.clickCandidate = null;
          return;
        }

        // click on a square while a piece is selected -> move if valid
        if (g.selectedPos && isDarkSquare(clickedPos)) {
          const isAllowedTarget = g.validMoves.some(
            (m) => m.r === clickedPos.r && m.c === clickedPos.c
          );
          if (isAllowedTarget) {
            tryMove(g.selectedPos, clickedPos);
          }
        }

        g.clickCandidate = null;
      }
    };

    const step = (ts: number) => {
      const g = gameRef.current!;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      /* ---------- AI ---------- */
      if (
        vsAI &&
        g.turn === BLACK &&
        g.winner.kind === 'NONE' &&
        !g.anim?.active &&
        !g.aiPending &&
        !g.aiThinking &&
        !g.aiResult
      ) {
        g.aiPending = true;
        g.aiTimer = 0;
        g.msg = 'AI thinking…';
        // keep green markers hidden during AI turn (handled by recomputeForcedCaptures)
        g.forcedCaptures = [];
      }

      // Increment timer if AI is busy
      if (g.aiPending || g.aiThinking) {
        g.aiTimer += dt;
      }

      // Wait for delay, then trigger worker
      if (g.aiPending && !g.aiThinking) {
        if (g.aiTimer >= AI_DELAY) {
          g.aiPending = false;
          g.aiThinking = true;

          const chainFrom = g.inChainCapture ? g.chainCaptureFrom : null;
          
          // Send to worker
          workerRef.current?.postMessage({
            board: g.board,
            player: BLACK,
            depth: aiDepth,
            chainCaptureFrom: chainFrom
          });
        }
      }

      // Handle Worker Result
      if (g.aiResult) {
        const bestSequence = g.aiResult;
        g.aiResult = null; // Consume result

        if (!g.anim?.active) {
          if (bestSequence && bestSequence.moves.length > 0) {
            const move = bestSequence.moves[0];
            g.anim = {
              active: true,
              from: move.from,
              to: move.to,
              captures: move.captures,
              t: 0,
              startTime: performance.now(),
            };

            if (move.captures.length > 0) {
              for (const cap of move.captures) {
                const capturedCell = g.board[cap.r][cap.c];
                const capturedPlayer = (capturedCell === 1 || capturedCell === 2) ? 1 : 2;
                g.board[cap.r][cap.c] = EMPTY;
                g.graveyard.push({
                  player: capturedPlayer,
                  cell: capturedCell,
                  index: g.graveyard.length,
                });
              }
            }

            const result = applyMove(g.board, move, BLACK);
            if (result.canContinueCapture && move.captures.length > 0) {
              g.inChainCapture = true;
              g.chainCaptureFrom = move.to;
            } else {
              g.inChainCapture = false;
              g.chainCaptureFrom = null;
            }
          } else {
            // No moves available (should be loss, but handle gracefully)
            g.inChainCapture = false;
            g.chainCaptureFrom = null;
          }
        }
      }

      /* ---------- Animation ---------- */
      if (g.anim?.active) {
        const now = performance.now();
        const elapsed = now - g.anim.startTime;
        const animDuration = 400; // ms
        g.anim.t = elapsed / animDuration;

        if (g.anim.t >= 1) {
          g.anim.active = false;

          if (!g.inChainCapture) {
            g.winner = getWinner(g.board, g.turn);
            if (g.winner.kind === 'WIN') {
              g.msg = g.winner.player === RED ? 'RED wins!' : 'BLACK wins!';
              if (
                vsAI &&
                aiDepth >= 9 &&
                g.winner.player === RED &&
                !medalAwardedRef.current
              ) {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  medalAwardedRef.current = true;
                  addAchievement(uid, 'checkers_bot_master').catch((err) => {
                    console.warn('checkers medal grant failed:', err);
                  });
                }
              }
            } else {
              g.turn = otherPlayer(g.turn);
              g.selectedPos = null;
              g.validMoves = [];
              g.inChainCapture = false;
              g.chainCaptureFrom = null;

              // ✅ NEW: recompute forced capture markers for the NEW turn
              recomputeForcedCaptures(g);

              if (vsAI && g.turn === BLACK) {
                g.aiPending = true;
                g.aiTimer = 0;
                g.msg = 'AI thinking…';
              } else {
                g.msg = g.turn === RED ? 'RED turn - Select/drag a piece' : 'BLACK turn - Select/drag a piece';
              }
            }
          } else {
            // still in chain capture - keep green on that piece
            recomputeForcedCaptures(g);
          }
        }
      }

      const animTime = (ts - gameStartTime) / 1000;

      drawBoard(
        ctx,
        g.board,
        {
          hoveredPos: g.hoveredPos,
          selectedPos: g.selectedPos,
          validMoves: g.validMoves,

          // ✅ pass to renderer
          forcedCapturePieces: g.forcedCaptures,

          winner: g.winner,
          graveyard: g.graveyard,
          anim: g.anim
            ? {
                active: true,
                from: g.anim.from,
                to: g.anim.to,
                captures: g.anim.captures,
                t01: Math.min(1, g.anim.t),
              }
            : null,
          drag: g.drag?.active
            ? {
                active: true,
                from: g.drag.from,
                x: g.drag.x,
                y: g.drag.y,
              }
            : null,
          time: animTime,
        },
        { tile: tileSize, graveyardWidth: GRAVEYARD_WIDTH }
      );

      /* ---------- AI Indicator ---------- */
      if ((g.aiPending || g.aiThinking) && g.aiTimer > 0.7) {
        const cx = size.w / 2;
        const cy = size.h / 2;
        const w = 180;
        const h = 54;
        const r = 27;
        const x = cx - w / 2;
        const y = cy - h / 2;

        // Smooth fade-in animation (0.5s)
        const fadeInTime = Math.min(1, (g.aiTimer - 0.7) / 0.5);
        const fadeAlpha = fadeInTime;

        ctx.save();
        ctx.globalAlpha = fadeAlpha;

        // 1. Animated Glow Pulse
        const pulse = (Math.sin(ts / 200) + 1) / 2; // 0..1
        const glowSize = 15 + pulse * 10;
        
        ctx.shadowColor = 'rgba(100, 180, 255, 0.6)';
        ctx.shadowBlur = glowSize;
        ctx.shadowOffsetY = 0;

        // 2. Glassmorphism Background
        // Dark semi-transparent fill
        ctx.fillStyle = 'rgba(15, 20, 35, 0.85)';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();

        // 3. Border Gradient
        ctx.shadowColor = 'transparent';
        const grad = ctx.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 4. Fancy Spinner (Orbiting dots)
        const spinX = x + 32;
        const spinY = cy;
        const orbitR = 10;
        const time = ts / 150;
        
        for (let i = 0; i < 3; i++) {
          const angle = time + (i * (Math.PI * 2) / 3);
          const dotX = spinX + Math.cos(angle) * orbitR;
          const dotY = spinY + Math.sin(angle) * orbitR;
          
          ctx.beginPath();
          ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(100, 200, 255, ${0.6 + pulse * 0.4})`;
          ctx.fill();
        }
        
        // Center dot
        ctx.beginPath();
        ctx.arc(spinX, spinY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // 5. Text with slight shimmer
        ctx.fillStyle = '#fff';
        ctx.font = '600 16px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('AI Thinking...', spinX + 24, cy + 1);

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(step);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScreen('MENU');
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) resetGame();
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) navigate('/');
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [screen, vsAI, aiDepth, size.h, size.w, tileSize, resetGame, navigate]);

  /* ================= MENU UI ================= */

  if (screen === 'MENU') {
    return (
      <div
        style={{
          direction: 'rtl',
          minHeight: '100%',
          display: 'grid',
          placeItems: 'center',
          color: '#eef3ff',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
        }}
      >
        <div
          style={{
            marginTop: 'clamp(4rem, 12vh, 9rem)',
            width: 'min(92vw, 32rem)',
            padding: 'clamp(2rem, 4vw, 2.8rem)',
            borderRadius: '1.8rem',
            background: 'rgba(14,16,22,.92)',
            border: '1px solid rgba(255,255,255,.12)',
            boxShadow: '0 2.2rem 4.5rem rgba(0,0,0,.6)',
            display: 'grid',
            gap: '1.5rem',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                margin: 0,
                marginBottom: '1.5rem',
                fontSize: 'clamp(2.2rem, 4vw, 2.8rem)',
                fontWeight: 800,
                letterSpacing: '0.04em',
              }}
            >
              בחר מצב משחק
            </h1>
          </div>

          <MenuButton
            label="🎮  שחק 1 על 1"
            sub="שני שחקנים על אותו המחשב"
            onClick={() => {
              setVsAI(false);
              setScreen('GAME');
            }}
          />

          <MenuButton
            label="🤖  שחק נגד המחשב"
            sub="! נסה להביס את המחשב"
            onClick={() => {
              setVsAI(true);
              setScreen('GAME');
            }}
          />

          <div
            style={{
              marginTop: '0.5rem',
              padding: 'clamp(1.2rem, 3vw, 1.6rem)',
              borderRadius: '1.2rem',
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              display: 'grid',
              gap: '0.8rem',
            }}
          >
            <div
              style={{
                direction: 'ltr',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 14,
              }}
            >
              <span>AI Difficulty</span>
              <b>{aiDepth}</b>
            </div>

            <input
              type="range"
              min={2}
              max={9}
              value={aiDepth}
              onChange={(e) => setAiDepth(+e.target.value)}
              style={{ accentColor: '#7bb7ff', cursor: 'pointer' }}
            />

            <div style={{ fontSize: 12, opacity: 0.6, textAlign: 'center' }}>
              6–7 recommended
            </div>
          </div>

          <div style={{ marginTop: '0.5rem', textAlign: 'center', fontSize: '0.85rem', opacity: 0.6 }}>
            ESC to return to menu · R to restart · H to go home
          </div>
        </div>
      </div>
    );
  }

  /* ================= GAME UI ================= */

  return (
    <>
      <section className="home-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">דמקה</span>
          </h2>
        </div>
      </section>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          padding: '20px',
        }}
      >
        <div style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{
              borderRadius: 22,
              boxShadow: '0 18px 55px rgba(0,0,0,.55)',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            width: '100%',
            maxWidth: COLS * tileSize,
          }}
        >
          <GameButton label="Reset Game" shortcut="R" onClick={resetGame} />
          <GameButton label="Home" shortcut="H" onClick={() => navigate('/')} />
        </div>
      </div>
    </>
  );
}

function MenuButton({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        width: '90%',
        padding: '0.9em 1.2em',
        borderRadius: '0.9em',
        background: 'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02))',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow: '0 0.8em 1.8em rgba(0,0,0,.45), inset 0 0.08em 0 rgba(255,255,255,.06)',
        display: 'grid',
        gap: '0.4em',
        transition: 'transform .15s ease, box-shadow .15s ease',
        direction: 'rtl',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, opacity: 0.7 }}>{sub}</div>
    </button>
  );
}

function GameButton({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '12px 20px',
        borderRadius: 14,
        background: 'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02))',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow: '0 8px 20px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        transition: 'transform .15s ease, box-shadow .15s ease',
        color: '#eef3ff',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
        fontSize: 15,
        fontWeight: 600,
        minWidth: 140,
        justifyContent: 'center',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow =
          '0 12px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow =
          '0 8px 20px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)';
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 11,
          opacity: 0.6,
          padding: '2px 6px',
          borderRadius: 6,
          background: 'rgba(255,255,255,.08)',
          border: '1px solid rgba(255,255,255,.1)',
          fontFamily: 'monospace',
          fontWeight: 500,
        }}
      >
        {shortcut}
      </span>
    </button>
  );
}
