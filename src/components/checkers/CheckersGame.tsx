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

/* ================= CONFIG ================= */

const TILE = 60;
const AI_DELAY = 0.5;

type Screen = 'MENU' | 'GAME';

type Anim = {
  active: boolean;
  from: Pos;
  to: Pos;
  captures: Pos[];
  t: number;
  startTime: number;
};

/* ================= COMPONENT ================= */

export default function CheckersGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const navigate = useNavigate();

  /* ---------- UI STATE ---------- */
  const [screen, setScreen] = useState<Screen>('MENU');
  const [vsAI, setVsAI] = useState<boolean>(true);
  const [aiDepth, setAiDepth] = useState<number>(4);

  /* ---------- GAME STATE (REF) ---------- */
  const gameRef = useRef<{
    board: Board;
    turn: Player;
    winner: Winner;
    selectedPos: Pos | null;
    hoveredPos: Pos | null;
    validMoves: Pos[];
    drag: {
      active: boolean;
      from: Pos;
      cell: number;
      x: number;
      y: number;
      grabDx: number;
      grabDy: number;
    } | null;
    anim: Anim | null;
    lastMove: MoveSequence | null;
    aiPending: boolean;
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
  const GRAVEYARD_WIDTH = TILE * 1.15; // Matches renderer default

  const size = useMemo(
    () => ({
      w: COLS * TILE + GRAVEYARD_WIDTH * 2,
      h: ROWS * TILE,
    }),
    []
  );


  /* ================= RESET FUNCTION ================= */
  const resetGame = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.board = createBoard();
      gameRef.current.graveyard = [];
      gameRef.current.turn = RED;
      gameRef.current.winner = { kind: 'NONE' };
      gameRef.current.selectedPos = null;
      gameRef.current.hoveredPos = null;
      gameRef.current.validMoves = [];
      gameRef.current.anim = null;
      gameRef.current.lastMove = null;
      gameRef.current.aiPending = false;
      gameRef.current.aiTimer = 0;
      gameRef.current.msg = 'Hold left-click on a piece, drag, then release on a valid square.';
      gameRef.current.drag = null;
      gameRef.current.inChainCapture = false;
      gameRef.current.chainCaptureFrom = null;
    }
  }, []);

  /* ================= GAME LOOP ================= */

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
      drag: null,
      anim: null,
      lastMove: null,
      aiPending: false,
      aiTimer: 0,
      msg: 'Hold left-click on a piece, drag, then release on a valid square.',
      inChainCapture: false,
      chainCaptureFrom: null,
    };

    let lastTs = performance.now();
    const gameStartTime = performance.now();

    const tryMove = (from: Pos, to: Pos) => {
      const g = gameRef.current!;
      if (g.winner.kind !== 'NONE') return;
      if (g.anim?.active) return;

      // In vsAI mode, only allow RED (human) to move manually
      // In 1v1 mode, allow current player to move
      if (vsAI && g.turn !== RED) return;

      // If in chain capture, must move from chainCaptureFrom
      if (g.inChainCapture && g.chainCaptureFrom) {
        if (from.r !== g.chainCaptureFrom.r || from.c !== g.chainCaptureFrom.c) {
          g.msg = 'You must continue the chain capture from the current position.';
          return;
        }
      }

      const allMoves = getAllMoves(g.board, g.turn, g.chainCaptureFrom);

      // Find a move that matches from->to
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

      // Add captured pieces to graveyard and remove from board IMMEDIATELY
      if (matchingMove.captures.length > 0) {
        for (const cap of matchingMove.captures) {
          const capturedCell = g.board[cap.r][cap.c];
          
          // Determine owner of CAPTURED piece (not current player)
          // Renderer expects: 1 = RED, 2 = BLACK
          const capturedPlayer = (capturedCell === 1 || capturedCell === 2) ? 1 : 2;

          // Remove from board IMMEDIATELY (before applyMove)
          g.board[cap.r][cap.c] = EMPTY;

          // Add to graveyard with correct player value
          g.graveyard.push({
            player: capturedPlayer,
            cell: capturedCell,
            index: g.graveyard.length
          });
        }
      }

      // Apply move
      const result = applyMove(g.board, matchingMove, g.turn);

      if (!result.success) {
        g.anim = null;
        return;
      }

      // Check if chain capture continues
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
      } else {
        // Chain capture ended or no capture was made
        g.inChainCapture = false;
        g.chainCaptureFrom = null;
        g.selectedPos = null;
        g.validMoves = [];
      }
    };

    /* ===========================
       Input (Hold-to-move for humans)
       =========================== */

    const canHumanInteract = (g: NonNullable<typeof gameRef.current>) => {
      // In vsAI mode, only allow RED (human) to move manually.
      // In 1v1 mode, allow the current player to move manually.
      return !vsAI || g.turn === RED;
    };

    // Account for board offset (graveyard on sides)
    const GRAVEYARD_WIDTH = TILE * 2.5;
    const BOARD_OFFSET_X = GRAVEYARD_WIDTH;
    
    const posFromXY = (x: number, y: number): Pos | null => {
      const xBoard = x - BOARD_OFFSET_X;   // ✅ לתרגם לקואורדינטות לוח
      if (xBoard < 0 || xBoard >= COLS * TILE) return null;
    
      const c = Math.floor(xBoard / TILE);
      const r = Math.floor(y / TILE);
    
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
      return { r, c };
    };

    const isDarkSquare = (p: Pos) => (p.r + p.c) % 2 === 1;

    const pieceCenterPx = (p: Pos) => ({
      x: BOARD_OFFSET_X + p.c * TILE + TILE / 2,   // ✅ כולל אופסט
      y: p.r * TILE + TILE / 2,
    });

    const isOwnPiece = (g: NonNullable<typeof gameRef.current>, p: Pos) => {
      const cell = g.board[p.r]?.[p.c] ?? 0;
      const isRedPiece = cell === 1 || cell === 2;
      const isBlackPiece = cell === 3 || cell === 4;
      return (g.turn === RED && isRedPiece) || (g.turn === BLACK && isBlackPiece);
    };

    const startDragIfPossible = (g: NonNullable<typeof gameRef.current>, p: Pos, x: number, y: number) => {
      if (!isDarkSquare(p)) return;

      // If in chain capture, must drag from the current chain position.
      if (g.inChainCapture && g.chainCaptureFrom) {
        if (p.r !== g.chainCaptureFrom.r || p.c !== g.chainCaptureFrom.c) {
          g.msg = 'You must continue the chain capture from the current position.';
          return;
        }
      }

      if (!isOwnPiece(g, p)) return;

      // Compute valid moves for this piece (respecting forced capture rules inside getAllMoves).
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

      const hasCaptures = movesForPiece.some((seq) => seq.totalCaptures > 0);
      g.msg = hasCaptures
        ? 'Captures are mandatory! Drag and release on a highlighted square to capture.'
        : 'Drag and release on a highlighted square to move.';

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

    const cancelDrag = (g: NonNullable<typeof gameRef.current>, keepSelection: boolean) => {
      g.drag = null;
      if (!keepSelection && !g.inChainCapture) {
        g.selectedPos = null;
        g.validMoves = [];
        g.msg = g.turn === RED ? 'RED turn - Drag a piece to move' : 'BLACK turn - Drag a piece to move';
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

      // Only start drag if clicking on a piece (and a legal mover).
      const cell = g.board[p.r]?.[p.c] ?? 0;
      if (cell === 0) return;

      // Prevent text selection / unwanted dragging behavior
      e.preventDefault();

      startDragIfPossible(g, p, x, y);
    };

    const onMouseMove = (e: MouseEvent) => {
      const g = gameRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const p = posFromXY(x, y);

      // Hover highlight (kept as-is)
      if (p && p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS && isDarkSquare(p)) {
        g.hoveredPos = p;
      } else {
        g.hoveredPos = null;
      }

      // Drag tracking
      if (g.drag?.active) {
        g.drag.x = x - g.drag.grabDx;
        g.drag.y = y - g.drag.grabDy;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const g = gameRef.current!;
      if (!g.drag?.active) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const target = posFromXY(x, y);
      const from = g.drag.from;

      // Clear drag visual first (so we never show two pieces during the move animation).
      g.drag = null;

      // Must release on board + dark square.
      if (!target || !isDarkSquare(target)) {
        cancelDrag(g, true);
        return;
      }

      // Must release on highlighted valid target (derived from rules).
      const isAllowedTarget = g.validMoves.some((m) => m.r === target.r && m.c === target.c);

      if (!isAllowedTarget) {
        // If chain capture is active, keep selection & guidance so user can try again.
        cancelDrag(g, g.inChainCapture);
        return;
      }

      // Commit the move (this will start the usual animation + chain-capture logic).
      tryMove(from, target);
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
        !g.aiPending
      ) {
        g.aiPending = true;
        g.aiTimer = 0;
        g.msg = 'AI thinking…';
      }

      if (g.aiPending) {
        g.aiTimer += dt;
        if (g.aiTimer >= AI_DELAY && !g.anim?.active) {
          g.aiPending = false;

          // If in chain capture, continue from current position
          if (g.inChainCapture && g.chainCaptureFrom) {
            const captures = getSingleCaptureMoves(
              g.board,
              g.chainCaptureFrom,
              BLACK,
              isKing(g.board[g.chainCaptureFrom.r][g.chainCaptureFrom.c]),
              true
            );
            if (captures.length > 0) {
              // Continue chain - pick first available capture
              const move = captures[0];
              g.anim = {
                active: true,
                from: move.from,
                to: move.to,
                captures: move.captures,
                t: 0,
                startTime: performance.now(),
              };

              // ✅ IMPORTANT: add AI captures to graveyard and remove from board IMMEDIATELY
              if (move.captures.length > 0) {
                for (const cap of move.captures) {
                  const capturedCell = g.board[cap.r][cap.c];
                  
                  // Determine owner of CAPTURED piece (not current player)
                  // Renderer expects: 1 = RED, 2 = BLACK
                  const capturedPlayer = (capturedCell === 1 || capturedCell === 2) ? 1 : 2;

                  // Remove from board IMMEDIATELY (before applyMove)
                  g.board[cap.r][cap.c] = EMPTY;

                  // Add to graveyard with correct player value
                  g.graveyard.push({
                    player: capturedPlayer,
                    cell: capturedCell,
                    index: g.graveyard.length,
                  });
                }
              }

              const result = applyMove(g.board, move, BLACK);
              if (result.canContinueCapture) {
                g.chainCaptureFrom = move.to;
              } else {
                g.inChainCapture = false;
                g.chainCaptureFrom = null;
              }
            } else {
              // No more captures, end chain
              g.inChainCapture = false;
              g.chainCaptureFrom = null;
            }
          } else {
            // Normal AI move
            const allMoves = getAllMoves(g.board, BLACK, null);
            if (allMoves.length > 0) {
              // Prefer captures
              const captures = allMoves.filter((seq) => seq.totalCaptures > 0);
              const movesToUse = captures.length > 0 ? captures : allMoves;
              const chosen = movesToUse[Math.floor(Math.random() * movesToUse.length)];

              if (chosen && chosen.moves.length > 0) {
                const move = chosen.moves[0];
                g.anim = {
                  active: true,
                  from: move.from,
                  to: move.to,
                  captures: move.captures,
                  t: 0,
                  startTime: performance.now(),
                };

                // ✅ IMPORTANT: add AI captures to graveyard and remove from board IMMEDIATELY
                if (move.captures.length > 0) {
                  for (const cap of move.captures) {
                    const capturedCell = g.board[cap.r][cap.c];
                    
                    // Determine owner of CAPTURED piece (not current player)
                    // Renderer expects: 1 = RED, 2 = BLACK
                    const capturedPlayer = (capturedCell === 1 || capturedCell === 2) ? 1 : 2;

                    // Remove from board IMMEDIATELY (before applyMove)
                    g.board[cap.r][cap.c] = EMPTY;

                    // Add to graveyard with correct player value
                    g.graveyard.push({
                      player: capturedPlayer,
                      cell: capturedCell,
                      index: g.graveyard.length,
                    });
                  }
                }

                const result = applyMove(g.board, move, BLACK);
                // Only continue chain capture if this was a capture move
                if (result.canContinueCapture && move.captures.length > 0) {
                  g.inChainCapture = true;
                  g.chainCaptureFrom = move.to;
                } else {
                  g.inChainCapture = false;
                  g.chainCaptureFrom = null;
                }
              }
            }
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

          // If not in chain capture, check winner and switch turns
          if (!g.inChainCapture) {
            g.winner = getWinner(g.board, g.turn);
            if (g.winner.kind === 'WIN') {
              g.msg = g.winner.player === RED ? 'RED wins!' : 'BLACK wins!';
            } else {
              g.turn = otherPlayer(g.turn);
              g.selectedPos = null;
              g.validMoves = [];
              g.inChainCapture = false;
              g.chainCaptureFrom = null;
              if (vsAI && g.turn === BLACK) {
                g.aiPending = true;
                g.aiTimer = 0;
                g.msg = 'AI thinking…';
              } else {
                g.msg = g.turn === RED ? 'RED turn - Drag a piece to move' : 'BLACK turn - Drag a piece to move';
              }
            }
          }
          // If in chain capture, the message and valid moves are already set in tryMove
        }
      }

      // Calculate animation time (in seconds)
      const animTime = (ts - gameStartTime) / 1000;

      drawBoard(
        ctx,
        g.board,
        {
          hoveredPos: g.hoveredPos,
          selectedPos: g.selectedPos,
          validMoves: g.validMoves,
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
        { tile: TILE, graveyardWidth: GRAVEYARD_WIDTH }
      );

      rafRef.current = requestAnimationFrame(step);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScreen('MENU');
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        resetGame();
      }
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) {
        navigate('/');
      }
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
  }, [screen, vsAI, aiDepth, size.h, size.w, resetGame, navigate]);

  /* ================= MENU UI ================= */

  if (screen === 'MENU') {
    return (
      <div
        style={{
          minHeight: '100%',
          display: 'grid',
          placeItems: 'center',
          color: '#eef3ff',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
        }}
      >
        <div
          style={{
            marginTop: 100,
            width: 420,
            padding: '28px 30px 32px',
            borderRadius: 22,
            background: 'rgba(14,16,22,.92)',
            border: '1px solid rgba(255,255,255,.12)',
            boxShadow: '0 20px 50px rgba(0,0,0,.55)',
            display: 'grid',
            gap: 18,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                margin: 10,
                marginBottom: 20,
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: 0.4,
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
              marginTop: 4,
              padding: '14px 16px',
              borderRadius: 14,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div
              style={{
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
              max={6}
              value={aiDepth}
              onChange={(e) => setAiDepth(+e.target.value)}
              style={{
                accentColor: '#7bb7ff',
                cursor: 'pointer',
              }}
            />

            <div
              style={{
                fontSize: 12,
                opacity: 0.6,
                textAlign: 'center',
              }}
            >
              4–5 recommended
            </div>
          </div>

          <div
            style={{
              marginTop: 4,
              textAlign: 'center',
              fontSize: 12,
              opacity: 0.55,
            }}
          >
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
            maxWidth: COLS * TILE,
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
        padding: '14px 18px',
        borderRadius: 16,
        background:
          'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02))',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow:
          '0 10px 24px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)',
        display: 'grid',
        gap: 4,
        transition: 'transform .15s ease, box-shadow .15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow =
          '0 18px 40px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow =
          '0 10px 24px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)';
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
        background:
          'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.02))',
        border: '1px solid rgba(255,255,255,.12)',
        boxShadow:
          '0 8px 20px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)',
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
