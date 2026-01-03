import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Board, Player, Winner, Pos } from './engine/types';
import { ROWS, COLS } from './engine/types';
import {
  createBoard,
  canDrop,
  applyMove,
  getWinner,
  isDraw,
  RED,
  YELLOW,
  otherPlayer,
  aiBestMove,
} from './engine/rules_ai';
import { drawBoard } from './render/renderer';

/* ================= CONFIG ================= */

const TILE = 90;
const DROP_TIME = 0.28;
const POP_TIME = 0.22;
const AI_DELAY = 0.5;

type Screen = 'MENU' | 'GAME';

type Anim = {
  active: boolean;
  piece: Player;
  col: number;
  fromY: number;
  toR: number;
  toC: number;
  t: number;
  popT: number;
};

/* ================= COMPONENT ================= */

export default function ConnectFourGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const navigate = useNavigate();

  /* ---------- UI STATE ---------- */
  const [screen, setScreen] = useState<Screen>('MENU');
  const [vsAI, setVsAI] = useState<boolean>(true);
  const [aiDepth, setAiDepth] = useState<number>(6);

  /* ---------- GAME STATE (REF) ---------- */
  const gameRef = useRef<{
    board: Board;
    turn: Player;
    winner: Winner;
    hoverCol: number | null;
    anim: Anim | null;
    lastMove: Pos | null;
    aiPending: boolean;
    aiTimer: number;
    msg: string;
  } | null>(null);

  const size = useMemo(
    () => ({ w: COLS * TILE, h: ROWS * TILE }),
    []
  );

  /* ================= RESET FUNCTION ================= */
  const resetGame = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.board = createBoard();
      gameRef.current.turn = RED;
      gameRef.current.winner = { kind: 'NONE' };
      gameRef.current.hoverCol = null;
      gameRef.current.anim = null;
      gameRef.current.lastMove = null;
      gameRef.current.aiPending = false;
      gameRef.current.aiTimer = 0;
      gameRef.current.msg = 'Click a column to drop a disc.';
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
      turn: RED,
      winner: { kind: 'NONE' },
      hoverCol: null,
      anim: null,
      lastMove: null,
      aiPending: false,
      aiTimer: 0,
      msg: 'Click a column to drop a disc.',
    };

    let lastTs = performance.now();

    const tryDrop = (col: number) => {
    const g = gameRef.current!;
    if (g.winner.kind !== 'NONE') return;
    if (g.anim?.active) return;
    if (!canDrop(g.board, col)) return;

    const b2 = g.board.map(r => r.slice()) as Board;
    const res = applyMove(b2, col, g.turn);
    if (!res.ok || !res.pos) return;

    g.anim = {
      active: true,
      piece: g.turn,
      col,
      fromY: -TILE * 0.6,
      toR: res.pos.r,
      toC: res.pos.c,
      t: 0,
      popT: 0,
    };
  };


    const step = (ts: number) => {
      const g = gameRef.current!;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      /* ---------- AI ---------- */
      if (
        vsAI &&
        g.turn === YELLOW &&
        g.winner.kind === 'NONE' &&
        !g.anim?.active &&
        !g.aiPending
      ) {
        g.aiPending = true;
        g.aiTimer = 0;
      }

      if (g.aiPending) {
        g.aiTimer += dt;
        if (g.aiTimer >= AI_DELAY && !g.anim?.active) {
          g.aiPending = false;
          const col = aiBestMove(g.board, YELLOW, aiDepth);
          if (col != null) tryDrop(col);
        }
      }

      /* ---------- Animation ---------- */
      if (g.anim?.active) {
        g.anim.t += dt;
        g.anim.popT += dt;

        const t01 = Math.min(1, g.anim.t / DROP_TIME);
        const pop01 = Math.min(1, g.anim.popT / POP_TIME);

        if (t01 >= 1 && g.board[g.anim.toR][g.anim.toC] === 0) {
          g.board[g.anim.toR][g.anim.toC] = g.anim.piece;

          g.winner = getWinner(g.board);
          if (g.winner.kind === 'WIN') {
            g.msg =
              g.winner.player === RED
                ? 'RED wins!'
                : 'YELLOW wins!';
          } else if (isDraw(g.board)) {
            g.winner = { kind: 'DRAW' };
            g.msg = 'Draw!';
          } else {
            g.turn = otherPlayer(g.turn);
            if (vsAI && g.turn === YELLOW) {
              g.aiPending = true;
              g.aiTimer = 0;
              g.msg = 'AI thinking…';
            } else {
              g.msg = g.turn === RED ? 'RED turn' : 'YELLOW turn';
            }
          }
        }

        if (t01 >= 1 && pop01 >= 1) {
          g.anim = null;
        }
      }

      drawBoard(ctx, g.board, {
        hoveredCol: g.hoverCol,
        winner: g.winner,
        anim: g.anim
          ? {
              active: true,
              piece: g.anim.piece,
              col: g.anim.col,
              fromY: g.anim.fromY,
              toR: g.anim.toR,
              toC: g.anim.toC,
              t01: Math.min(1, g.anim.t / DROP_TIME),
              pop01: Math.min(1, g.anim.popT / POP_TIME),
            }
          : null,
      });

      rafRef.current = requestAnimationFrame(step);
    };

    const onMouseMove = (e: MouseEvent) => {
      const g = gameRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      g.hoverCol =
        y >= 0 && y <= size.h
          ? Math.floor(x / TILE)
          : null;
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      tryDrop(Math.floor((e.clientX - rect.left) / TILE));
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

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKeyDown);

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onClick);
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
        fontFamily:
          'system-ui, -apple-system, Segoe UI, Roboto, Arial',
      }}
    >
      {/* Menu Card */}
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
        {/* Title */}
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

        {/* Buttons */}
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

        {/* Difficulty */}
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
            max={9}
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
            6–7 recommended
          </div>
        </div>

        {/* Hint */}
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
            <span className="home-hero__title-gradient">ארבע בשורה</span>
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
      {/* Canvas */}
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            borderRadius: 22,
            boxShadow: '0 18px 55px rgba(0,0,0,.55)',
          }}
        />
      </div>

      {/* Bottom buttons */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          width: '100%',
          maxWidth: COLS * TILE,
        }}
      >
        <GameButton
          label="Reset Game"
          shortcut="R"
          onClick={resetGame}
        />
        <GameButton
          label="Home"
          shortcut="H"
          onClick={() => navigate('/')}
        />
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
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, opacity: 0.7 }}>
        {sub}
      </div>
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
