import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorld, resolveHeadBust, stepWorld } from './engine/rules_ai';
import type { HeadBustEvent, World } from './engine/types';
import { drawWorld } from './render/renderer';

// --- Configuration ---
const PHYSICS_RATE = 60; // Hz
const FIXED_DT = 1 / PHYSICS_RATE;
const CAM_DAMPING = 5.0; // Camera smoothness (higher = tighter)

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type GameState = 'MENU' | 'PLAYING' | 'PAUSED' | 'HEADBUST' | 'GAME_OVER';

type HeadBustFighter = {
  id: string;
  name: string;
  color: string;
  score: number;
};

type HeadBustFeedback = 'IDLE' | 'HIT' | 'PERFECT' | 'MISS';

type HeadBustDuel = {
  player: HeadBustFighter;
  bot: HeadBustFighter;
  phase: 'INTRO' | 'PLAY' | 'OUTRO';
  introStartAt: number;
  introDuration: number;
  outroStartAt: number | null;
  streak: number;
  goal: number;
  pointerAngle: number;
  pointerDirection: 1 | -1;
  zoneCenter: number;
  zoneWidth: number;
  minZoneWidth: number;
  zoneShrinkFactor: number;
  rotationPeriod: number;
  minRotationPeriod: number;
  timeoutLeft: number;
  feedback: HeadBustFeedback;
  feedbackUntil: number;
  arenaW: number;
  arenaH: number;
  winnerId: string | null;
  loserId: string | null;
  finishAt: number | null;
  status: string;
};

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const HEADBUST_RING_STROKE = 16;
const HEADBUST_OUTRO_FADE_MS = 450;
const HEADBUST_OUTRO_TIMER_MS = 1800;

function getHeadBustArenaRect(viewW: number, viewH: number, arenaW: number, arenaH: number) {
  const x = (viewW - arenaW) / 2;
  const y = (viewH - arenaH) / 2 + 36;
  return { x, y };
}

function normalizeAngle(angle: number) {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

function angleDistance(a: number, b: number) {
  const diff = Math.abs(normalizeAngle(a - b));
  return diff > Math.PI ? TAU - diff : diff;
}

function formatHeadBustTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const secs = Math.floor(safe);
  const tenths = Math.floor((safe - secs) * 10);
  return `${secs}.${tenths}`;
}

function easeOutCubic(t: number) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function pickNextZoneAngle(previous: number | null) {
  if (previous === null) return Math.random() * TAU;
  const minGap = 40 * DEG_TO_RAD;
  const farGap = 95 * DEG_TO_RAD;
  const preferFar = Math.random() < 0.7;
  for (let i = 0; i < 36; i++) {
    const candidate = Math.random() * TAU;
    const gap = angleDistance(candidate, previous);
    if (preferFar) {
      if (gap >= farGap) return candidate;
    } else if (gap >= minGap) {
      return candidate;
    }
  }
  return normalizeAngle(previous + minGap + Math.random() * (Math.PI - minGap));
}

function getHeadBustGaugeRadius(arenaW: number, arenaH: number) {
  return Math.max(76, Math.min(arenaW, arenaH) * 0.32);
}

function isPointerInsideZone(pointerAngle: number, zoneCenter: number, zoneWidth: number, extra = 0) {
  return angleDistance(pointerAngle, zoneCenter) <= zoneWidth / 2 + extra;
}

function isHeadBustHit(duel: HeadBustDuel) {
  const radius = getHeadBustGaugeRadius(duel.arenaW, duel.arenaH);
  const capTolerance = Math.asin(clamp((HEADBUST_RING_STROKE * 0.5) / radius, 0, 1));
  const latencyTolerance = (TAU / duel.rotationPeriod) * 0.008;
  const totalTolerance = capTolerance + latencyTolerance + 0.5 * DEG_TO_RAD;
  const previousFrameAngle = normalizeAngle(
    duel.pointerAngle - duel.pointerDirection * (TAU / duel.rotationPeriod) * (1 / 60)
  );

  return isPointerInsideZone(duel.pointerAngle, duel.zoneCenter, duel.zoneWidth, totalTolerance)
    || isPointerInsideZone(previousFrameAngle, duel.zoneCenter, duel.zoneWidth, totalTolerance);
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function buildArcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const s = polarPoint(cx, cy, radius, start);
  const e = polarPoint(cx, cy, radius, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

function getZoneArcSegments(center: number, width: number) {
  const half = width / 2;
  const start = normalizeAngle(center - half);
  const end = normalizeAngle(center + half);
  if (end < start) {
    return [
      { start, end: TAU },
      { start: 0, end },
    ];
  }
  return [{ start, end }];
}

export default function SlitherGame() {
  // --- React State for UI ---
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [playerColor, setPlayerColor] = useState('#00ff88');
  const [headBust, setHeadBust] = useState<HeadBustDuel | null>(null);
  
  // --- Mutable Game State (Refs) ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastScoreRef = useRef(0);
  const headBustRef = useRef<HeadBustDuel | null>(null);
  
  // Input state (Refs for performance)
  const inputRef = useRef({
    mouse: { x: 0, y: 0 },
    boosting: false,
    width: window.innerWidth,
    height: window.innerHeight
  });

  // Camera state
  const camRef = useRef({ x: 0, y: 0 });
  const prevCamRef = useRef({ x: 0, y: 0 });

  // --- Helpers ---
  const clearHeadBust = useCallback(() => {
    headBustRef.current = null;
    setHeadBust(null);
  }, []);

  const openHeadBust = useCallback((world: World, evt: HeadBustEvent) => {
    if (headBustRef.current) return;

    const snakeA = world.snakes.find((s) => s.id === evt.snakeAId && s.alive);
    const snakeB = world.snakes.find((s) => s.id === evt.snakeBId && s.alive);
    if (!snakeA || !snakeB) {
      world.events = world.events ?? {};
      world.events.headBust = undefined;
      return;
    }

    const playerSnake = snakeA.isPlayer ? snakeA : snakeB.isPlayer ? snakeB : null;
    const botSnake = playerSnake ? (playerSnake.id === snakeA.id ? snakeB : snakeA) : null;
    if (!playerSnake || !botSnake) {
      world.events = world.events ?? {};
      world.events.headBust = undefined;
      return;
    }

    const difficulty = world.difficulty ?? 1;
    const goal = 6;
    const duelDuration = 8;
    const introDuration = 1800;
    const startZoneWidth = (difficulty < 1.8 ? 28 : 26) * DEG_TO_RAD;
    const minZoneWidth = (difficulty < 1.8 ? 8 : 7) * DEG_TO_RAD;
    const startRotationPeriod = clamp(1.35 - difficulty * 0.08, 1.05, 1.35);
    const minRotationPeriod = 0.55;
    const arenaW = clamp(inputRef.current.width * 0.8, 300, 860);
    const arenaH = clamp(inputRef.current.height * 0.48, 220, 420);
    const now = performance.now();
    const duel: HeadBustDuel = {
      player: {
        id: playerSnake.id,
        name: playerSnake.name,
        color: playerSnake.color,
        score: playerSnake.score,
      },
      bot: {
        id: botSnake.id,
        name: botSnake.name,
        color: botSnake.color,
        score: botSnake.score,
      },
      phase: 'INTRO',
      introStartAt: now,
      introDuration,
      outroStartAt: null,
      streak: 0,
      goal,
      pointerAngle: Math.random() * TAU,
      pointerDirection: Math.random() < 0.5 ? 1 : -1,
      zoneCenter: pickNextZoneAngle(null),
      zoneWidth: startZoneWidth,
      minZoneWidth,
      zoneShrinkFactor: 0.9,
      rotationPeriod: startRotationPeriod,
      minRotationPeriod,
      timeoutLeft: duelDuration,
      feedback: 'IDLE',
      feedbackUntil: 0,
      arenaW,
      arenaH,
      winnerId: null,
      loserId: null,
      finishAt: null,
      status: 'HeadBust incoming...',
    };

    headBustRef.current = duel;
    setHeadBust(duel);
    inputRef.current.boosting = false;
    setGameState('HEADBUST');
  }, []);

  const shootHeadBust = useCallback(() => {
    const duel = headBustRef.current;
    if (!duel || duel.phase === 'OUTRO') return;
    if (duel.phase === 'INTRO') {
      return;
    }

    const now = performance.now();
    if (isHeadBustHit(duel)) {
      const perfect = angleDistance(duel.pointerAngle, duel.zoneCenter) <= duel.zoneWidth * 0.2;
      duel.streak++;
      duel.feedback = perfect ? 'PERFECT' : 'HIT';
      duel.feedbackUntil = now + 260;

      if (duel.streak >= duel.goal) {
        duel.winnerId = duel.player.id;
        duel.loserId = duel.bot.id;
        duel.phase = 'OUTRO';
        duel.outroStartAt = now;
        duel.finishAt = now + HEADBUST_OUTRO_FADE_MS + HEADBUST_OUTRO_TIMER_MS;
        duel.status = perfect ? 'Perfect run completed. You win.' : 'Run completed. You win.';
      } else {
        duel.zoneWidth = Math.max(duel.minZoneWidth, duel.zoneWidth * duel.zoneShrinkFactor);
        duel.pointerDirection = duel.pointerDirection === 1 ? -1 : 1;
        duel.rotationPeriod = Math.max(duel.minRotationPeriod, duel.rotationPeriod * 0.9);
        duel.zoneCenter = pickNextZoneAngle(duel.zoneCenter);
        duel.status = perfect
          ? `Perfect! Streak ${duel.streak}/${duel.goal}`
          : `Hit! Streak ${duel.streak}/${duel.goal}`;
      }
    } else {
      duel.feedback = 'MISS';
      duel.feedbackUntil = now + 420;
      duel.winnerId = duel.bot.id;
      duel.loserId = duel.player.id;
      duel.phase = 'OUTRO';
      duel.outroStartAt = now;
      duel.finishAt = now + HEADBUST_OUTRO_FADE_MS + HEADBUST_OUTRO_TIMER_MS;
      duel.status = 'Miss. Streak broken.';
    }

    setHeadBust({ ...duel });
  }, []);

  const exitToMenu = useCallback(() => {
    inputRef.current.boosting = false;
    clearHeadBust();
    setGameState('MENU');
  }, [clearHeadBust]);

  const startGame = (difficulty: number, botCount: number) => {
    worldRef.current = createWorld({ botCount, difficulty, playerColor });
    clearHeadBust();
    
    // Reset camera to player position immediately
    const player = worldRef.current.snakes[0];
    if (player && player.points.length > 0) {
      camRef.current = { x: player.points[0].x, y: player.points[0].y };
    } else {
      camRef.current = { x: 0, y: 0 };
    }
    prevCamRef.current = { ...camRef.current };
    
    lastScoreRef.current = 0;
    setScore(0);
    setFinalScore(0);
    setGameState('PLAYING');
  };

  const togglePause = useCallback(() => {
    setGameState(prev => {
      if (prev === 'PLAYING') return 'PAUSED';
      if (prev === 'PAUSED') return 'PLAYING';
      return prev;
    });
  }, []);

  // --- Event Listeners ---
  useEffect(() => {
    const onResize = () => {
      inputRef.current.width = window.innerWidth;
      inputRef.current.height = window.innerHeight;
    };
    
    const onKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'HEADBUST' && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        shootHeadBust();
        return;
      }
      if (e.code === 'KeyX') {
        const world = worldRef.current;
        if (!world || gameState !== 'PLAYING') return;
        const player = world.snakes[0];
        const bot = world.snakes.find((s, idx) => idx > 0 && s.alive);
        if (player && bot) {
          openHeadBust(world, { snakeAId: player.id, snakeBId: bot.id, atTick: world.tick });
        }
        return;
      }
      if (e.code === 'Space' || e.shiftKey) inputRef.current.boosting = true;
      if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    };
    
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || !e.shiftKey) inputRef.current.boosting = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      // Mouse relative to center of screen
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        inputRef.current.mouse.x = e.clientX - rect.left;
        inputRef.current.mouse.y = e.clientY - rect.top;
      }
    };

    const onMouseDown = () => {
      if (gameState === 'HEADBUST') {
        shootHeadBust();
        return;
      }
      inputRef.current.boosting = true;
    };
    const onMouseUp = () => { inputRef.current.boosting = false; };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [gameState, openHeadBust, shootHeadBust, togglePause]);

  // --- Game Loop ---
  useEffect(() => {
    if (gameState === 'MENU' || gameState === 'GAME_OVER') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let lastTime = performance.now();
    let accumulator = 0;

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1); // Cap dt to prevent spiral of death
      lastTime = time;

      // Handle Canvas Resize & HiDPI
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const displayWidth = inputRef.current.width;
      const displayHeight = inputRef.current.height;

      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
      }
      
      // Always reset transform before rendering
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (gameState === 'PLAYING') {
        accumulator += dt;
        const world = worldRef.current;

        if (world) {
          let openedHeadBust = false;

          // Physics Steps
          let steps = 0;
          while (accumulator >= FIXED_DT && steps < 10) {
            // 1. Calculate Input Aim (World Space) using CURRENT camera
            const screenCX = displayWidth / 2;
            const screenCY = displayHeight / 2;
            const aimWorld = {
              x: camRef.current.x + (inputRef.current.mouse.x - screenCX),
              y: camRef.current.y + (inputRef.current.mouse.y - screenCY)
            };

            const player = world.snakes[0];

            // 2. Step World (Updates snake position t -> t+1)
            stepWorld(world, {
              aimWorld,
              boost: inputRef.current.boosting
            }, FIXED_DT);

            if (world.events?.headBust) {
              openHeadBust(world, world.events.headBust);
              openedHeadBust = true;
              accumulator = 0;
              break;
            }

            // 3. Snapshot Camera (Save state t)
            prevCamRef.current.x = camRef.current.x;
            prevCamRef.current.y = camRef.current.y;

            // 4. Update Camera Target (Center on NEW player head t+1)
            let targetX = camRef.current.x;
            let targetY = camRef.current.y;
            
            if (player && player.points.length > 0) {
              targetX = player.points[0].x;
              targetY = player.points[0].y;
            }

            // 5. Smooth Camera Follow (Updates camera t -> t+1)
            const smoothFactor = 1 - Math.exp(-CAM_DAMPING * FIXED_DT * 1.5);
            camRef.current.x += (targetX - camRef.current.x) * smoothFactor;
            camRef.current.y += (targetY - camRef.current.y) * smoothFactor;

            accumulator -= FIXED_DT;
            steps++;
          }

          if (openedHeadBust) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }

          // Check Death / Score
          const player = world.snakes[0];
          if (!player || player.points.length === 0) {
            setFinalScore(lastScoreRef.current);
            setGameState('GAME_OVER');
          } else if (!player.alive) {
            if (lastScoreRef.current !== 0) {
              lastScoreRef.current = 0;
              setScore(0);
            }
          } else {
            const newScore = Math.floor(player.desiredLen * 10);
            if (newScore !== lastScoreRef.current) {
              lastScoreRef.current = newScore;
              setScore(newScore);
            }
          }
        }
      }

      if (gameState === 'HEADBUST') {
        const duel = headBustRef.current;
        if (duel) {
          const now = performance.now();
          const world = worldRef.current;
          if (duel.phase === 'INTRO') {
            const introElapsed = now - duel.introStartAt;
            if (introElapsed >= duel.introDuration) {
              duel.phase = 'PLAY';
              duel.status = 'Hit 6 times in a row within 8 seconds. One miss ends it.';
            }
          } else if (duel.phase === 'PLAY') {
            duel.pointerAngle = normalizeAngle(
              duel.pointerAngle + duel.pointerDirection * (dt / duel.rotationPeriod) * TAU
            );
            duel.timeoutLeft = Math.max(0, duel.timeoutLeft - dt);

            if (duel.feedback !== 'IDLE' && now >= duel.feedbackUntil) {
              duel.feedback = 'IDLE';
            }

            if (duel.timeoutLeft <= 0) {
              duel.winnerId = duel.bot.id;
              duel.loserId = duel.player.id;
              duel.phase = 'OUTRO';
              duel.outroStartAt = now;
              duel.finishAt = now + HEADBUST_OUTRO_FADE_MS + HEADBUST_OUTRO_TIMER_MS;
              duel.feedback = 'MISS';
              duel.feedbackUntil = now + 420;
              duel.status = 'Time up. You are eliminated.';
            }
          } else if (duel.phase === 'OUTRO' && duel.winnerId && duel.loserId && duel.finishAt !== null && now >= duel.finishAt) {
            if (world) {
              resolveHeadBust(world, duel.winnerId, duel.loserId);
            }
            clearHeadBust();
            setGameState('PLAYING');
          }

          if (headBustRef.current) {
            setHeadBust({ ...duel });
          }
        }
      }

      // Render
      const world = worldRef.current;
      if (world) {
        // Interpolation alpha for smoother rendering between physics steps
        const alpha = (gameState === 'PAUSED' || gameState === 'HEADBUST') ? 1.0 : accumulator / FIXED_DT;
        
        // Interpolate camera to match snake interpolation
        const camX = lerp(prevCamRef.current.x, camRef.current.x, alpha);
        const camY = lerp(prevCamRef.current.y, camRef.current.y, alpha);

        const view = {
          w: displayWidth,
          h: displayHeight,
          cam: { x: camX, y: camY }
        };

        drawWorld(ctx, world, view, alpha);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [clearHeadBust, gameState, openHeadBust]);

  const headBustArena = headBust
    ? getHeadBustArenaRect(inputRef.current.width, inputRef.current.height, headBust.arenaW, headBust.arenaH)
    : null;
  const headBustIntroProgress = headBust && headBust.phase === 'INTRO'
    ? clamp((performance.now() - headBust.introStartAt) / headBust.introDuration, 0, 1)
    : 0;
  const headBustIntroEase = easeOutCubic(headBustIntroProgress);
  const headBustIntroOpacity = headBustIntroProgress < 0.14
    ? headBustIntroProgress / 0.14
    : headBustIntroProgress > 0.9
    ? (1 - headBustIntroProgress) / 0.1
    : 1;
  const headBustOutroElapsed = headBust && headBust.phase === 'OUTRO' && headBust.outroStartAt !== null
    ? Math.max(0, performance.now() - headBust.outroStartAt)
    : 0;
  const headBustOutroFade = clamp(headBustOutroElapsed / HEADBUST_OUTRO_FADE_MS, 0, 1);
  const headBustOutroCountdown = headBust && headBust.phase === 'OUTRO'
    ? Math.max(0, Math.ceil((HEADBUST_OUTRO_TIMER_MS - Math.max(0, headBustOutroElapsed - HEADBUST_OUTRO_FADE_MS)) / 1000))
    : 0;
  const headBustPlayVisibility = headBust
    ? headBust.phase === 'INTRO'
      ? clamp((headBustIntroProgress - 0.24) / 0.76, 0, 1)
      : headBust.phase === 'OUTRO'
      ? clamp(1 - headBustOutroFade, 0, 1)
      : 1
    : 0;
  const headBustPlayLift = headBust
    ? headBust.phase === 'INTRO'
      ? (1 - headBustPlayVisibility) * 10
      : headBust.phase === 'OUTRO'
      ? -10 * headBustOutroFade
      : 0
    : 0;
  const headBustOverlayDim = headBust
    ? headBust.phase === 'INTRO'
      ? clamp(0.34 + (1 - headBustPlayVisibility) * 0.18, 0.34, 0.52)
      : headBust.phase === 'OUTRO'
      ? clamp(0.34 + headBustOutroFade * 0.28, 0.34, 0.62)
      : 0.36
    : 0.36;

  return (
    <div style={{ 
        width: '100vw', 
        height: '100vh', 
        overflow: 'hidden', 
        position: 'relative',
        backgroundColor: '#06070a',
        color: '#eef3ff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none'
    }}>
        {/* Game Canvas */}
        <canvas
            ref={canvasRef}
            style={{ display: 'block', width: '100%', height: '100%' }}
        />

        {/* HUD */}
        {gameState !== 'MENU' && (
            <div style={{
                position: 'absolute',
                bottom: 24,
                left: 24,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
            }}>
                <div style={{ 
                    fontSize: '32px', 
                    fontWeight: 900, 
                    color: '#fff',
                    textShadow: '0 2px 10px rgba(0,0,0,0.5)'
                }}>
                    {score}
                </div>
                <div style={{ fontSize: '13px', opacity: 0.7, fontWeight: 600 }}>
                    LENGTH
                </div>
            </div>
        )}

        {/* Leaderboard */}
        {gameState !== 'MENU' && worldRef.current?.leaderboard && (
            <div style={{
                position: 'absolute',
                top: 24,
                left: 24,
                width: 200,
                pointerEvents: 'none',
                fontFamily: 'system-ui, sans-serif',
                fontWeight: 700,
                fontSize: '14px'
            }}>
                <div style={{ marginBottom: 8, color: 'rgba(255,255,255,0.5)', fontSize: '12px', letterSpacing: '1px' }}>LEADERBOARD</div>
                {worldRef.current.leaderboard.map((entry, i) => (
                    <div key={entry.id} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        marginBottom: 4,
                        color: entry.id.startsWith('player') ? '#fff' : 'rgba(255,255,255,0.6)',
                        textShadow: entry.id.startsWith('player') ? '0 0 10px rgba(255,255,255,0.4)' : 'none'
                    }}>
                        <span>{i+1}. {entry.name.slice(0, 12)}</span>
                        <span>{Math.floor(entry.score)}</span>
                    </div>
                ))}
            </div>
        )}

        {/* Pause Overlay */}
        {gameState === 'PAUSED' && (
            <div style={{
                position: 'absolute',
                top: 24,
                right: 24,
                background: 'rgba(0,0,0,0.6)',
                padding: '8px 16px',
                borderRadius: '20px',
                fontWeight: 'bold',
                border: '1px solid rgba(255,255,255,0.1)'
            }}>
                PAUSED
            </div>
        )}

        {/* HeadBust Overlay */}
        {gameState === 'HEADBUST' && headBust && headBustArena && (
            <div style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(180deg, rgba(7, 12, 24, ${headBustOverlayDim}), rgba(7, 12, 24, ${Math.min(0.74, headBustOverlayDim + 0.2)}))`,
                backdropFilter: 'blur(2px)',
                zIndex: 20,
                pointerEvents: 'none'
            }}>
                <div style={{
                  opacity: headBustPlayVisibility,
                  transform: `translateY(${Math.round(headBustPlayLift)}px)`,
                  transition: 'opacity 0.2s cubic-bezier(0.22, 0.72, 0.22, 1), transform 0.2s cubic-bezier(0.22, 0.72, 0.22, 1)'
                }}>
                <div style={{
                    position: 'absolute',
                    left: '16%',
                    top: '17%',
                    width: 280,
                    height: 280,
                    borderRadius: 999,
                    background: 'radial-gradient(circle, rgba(109,188,255,0.14), rgba(109,188,255,0))'
                }} />
                <div style={{
                    position: 'absolute',
                    right: '14%',
                    bottom: '18%',
                    width: 320,
                    height: 320,
                    borderRadius: 999,
                    background: 'radial-gradient(circle, rgba(174,117,255,0.12), rgba(174,117,255,0))'
                }} />
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 12,
                    transform: 'translateX(-50%)',
                    width: 'min(980px, calc(100vw - 28px))',
                    background: 'linear-gradient(180deg, rgba(12, 23, 46, 0.82), rgba(8, 16, 32, 0.92))',
                    border: '1px solid rgba(145, 198, 255, 0.52)',
                    borderRadius: 14,
                    padding: '9px 14px',
                    boxShadow: '0 12px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)'
                }}>
                    <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.4, color: 'rgba(178,222,255,0.92)' }}>HEADBUST</div>
                    <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: 'rgba(226,241,255,0.92)' }}>{headBust.status}</div>
                </div>

                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 82,
                    transform: 'translateX(-50%)',
                    width: 'min(980px, calc(100vw - 28px))',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    gap: 14,
                    alignItems: 'stretch'
                }}>
                    <div style={{
                        background: 'linear-gradient(180deg, rgba(11, 20, 42, 0.86), rgba(8, 15, 31, 0.9))',
                        border: `1px solid ${headBust.player.color}aa`,
                        borderRadius: 12,
                        padding: '9px 12px',
                        boxShadow: `0 10px 22px rgba(0,0,0,0.28), inset 0 1px 0 ${headBust.player.color}22`
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.84, letterSpacing: 1 }}>YOU</div>
                        <div style={{ marginTop: 2, fontSize: 18, fontWeight: 900, color: headBust.player.color }}>{headBust.player.name}</div>
                        <div style={{ marginTop: 4, fontSize: 14, fontWeight: 800 }}>STREAK {headBust.streak} / {headBust.goal}</div>
                        <div style={{ marginTop: 3, fontSize: 11, opacity: 0.82 }}>Miss once and you lose</div>
                    </div>

                    <div style={{
                        minWidth: 220,
                        borderRadius: 16,
                        border: '2px solid rgba(255,255,255,0.32)',
                        background: headBust.timeoutLeft <= 1.1
                          ? 'linear-gradient(180deg, #ff5b5b, #d22a2a)'
                          : 'linear-gradient(180deg, #214379, #10284a)',
                        boxShadow: '0 12px 24px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.12)',
                        padding: '8px 18px',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, opacity: 0.85 }}>TIME LEFT</div>
                        <div style={{
                            marginTop: 2,
                            fontSize: 'clamp(34px, 8vw, 58px)',
                            lineHeight: 1,
                            fontWeight: 900,
                            color: '#ffffff',
                            textShadow: '0 0 14px rgba(255,255,255,0.35)'
                        }}>
                            {formatHeadBustTime(headBust.timeoutLeft)}
                        </div>
                    </div>

                    <div style={{
                        background: 'linear-gradient(180deg, rgba(11, 20, 42, 0.86), rgba(8, 15, 31, 0.9))',
                        border: `1px solid ${headBust.bot.color}aa`,
                        borderRadius: 12,
                        padding: '9px 12px',
                        textAlign: 'right',
                        boxShadow: `0 10px 22px rgba(0,0,0,0.28), inset 0 1px 0 ${headBust.bot.color}22`
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.84, letterSpacing: 1 }}>BOT</div>
                        <div style={{ marginTop: 2, fontSize: 18, fontWeight: 900, color: headBust.bot.color }}>{headBust.bot.name}</div>
                        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700 }}>
                          WINDOW {Math.max(1, Math.round(headBust.zoneWidth / DEG_TO_RAD))}deg
                        </div>
                        <div style={{ marginTop: 3, fontSize: 11, opacity: 0.82 }}>
                          TURN {headBust.rotationPeriod.toFixed(2)}s
                        </div>
                        <div style={{ marginTop: 3, fontSize: 11, opacity: 0.82 }}>
                          DIR {headBust.pointerDirection === 1 ? 'CW' : 'CCW'}
                        </div>
                    </div>
                </div>

                <div style={{
                    position: 'absolute',
                    left: headBustArena.x,
                    top: headBustArena.y,
                    width: headBust.arenaW,
                    height: headBust.arenaH,
                    borderRadius: 20,
                    border: '2px solid rgba(153, 208, 255, 0.86)',
                    background: headBust.feedback === 'MISS'
                      ? 'linear-gradient(180deg, rgba(98, 26, 45, 0.85), rgba(40, 12, 21, 0.92))'
                      : 'linear-gradient(180deg, rgba(24, 46, 88, 0.86), rgba(12, 24, 49, 0.94))',
                    boxShadow: '0 20px 42px rgba(0,0,0,0.46), inset 0 0 56px rgba(104, 170, 255, 0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
                    overflow: 'hidden'
                }}>
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      height: '42%',
                      background: 'linear-gradient(180deg, rgba(180, 219, 255, 0.12), rgba(180, 219, 255, 0))'
                    }} />
                    {(() => {
                      const cx = headBust.arenaW / 2;
                      const cy = headBust.arenaH / 2;
                      const radius = getHeadBustGaugeRadius(headBust.arenaW, headBust.arenaH);
                      const segments = getZoneArcSegments(headBust.zoneCenter, headBust.zoneWidth);
                      const tip = polarPoint(cx, cy, radius + 14, headBust.pointerAngle);
                      const tail = polarPoint(cx, cy, 22, headBust.pointerAngle + Math.PI);
                      const feedbackColor = headBust.feedback === 'MISS'
                        ? '#ff7a87'
                        : headBust.feedback === 'PERFECT'
                        ? '#ffe68e'
                        : '#9ad7ff';
                      const feedbackText = headBust.feedback === 'MISS'
                        ? 'MISS'
                        : headBust.feedback === 'PERFECT'
                        ? 'PERFECT!'
                        : headBust.feedback === 'HIT'
                        ? 'HIT'
                        : '';

                      return (
                        <>
                          <svg
                            width={headBust.arenaW}
                            height={headBust.arenaH}
                            viewBox={`0 0 ${headBust.arenaW} ${headBust.arenaH}`}
                            style={{ position: 'absolute', inset: 0 }}
                          >
                            <circle cx={cx} cy={cy} r={radius + 18} fill="rgba(15, 28, 53, 0.82)" />
                            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(131, 177, 255, 0.35)" strokeWidth={HEADBUST_RING_STROKE} />
                            {segments.map((segment, idx) => (
                              <path
                                key={idx}
                                d={buildArcPath(cx, cy, radius, segment.start, segment.end)}
                                fill="none"
                                stroke="#ffd46d"
                                strokeWidth={HEADBUST_RING_STROKE}
                                strokeLinecap="round"
                                style={{ filter: 'drop-shadow(0 0 10px rgba(255,212,109,0.8))' }}
                              />
                            ))}
                            <line
                              x1={tail.x}
                              y1={tail.y}
                              x2={tip.x}
                              y2={tip.y}
                              stroke={headBust.feedback === 'MISS' ? '#ff98a1' : '#d7ecff'}
                              strokeWidth={6}
                              strokeLinecap="round"
                            />
                            <circle cx={cx} cy={cy} r={10} fill="#f6fbff" />
                            <circle cx={cx} cy={cy} r={4} fill="#1a3258" />
                          </svg>
                          <div style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            marginTop: 58,
                            fontSize: 22,
                            fontWeight: 900,
                            letterSpacing: 1.2,
                            color: feedbackColor,
                            textShadow: '0 0 14px rgba(0,0,0,0.45)',
                            opacity: feedbackText ? 1 : 0,
                            transition: 'opacity 0.12s linear'
                          }}>
                            {feedbackText}
                          </div>
                        </>
                      );
                    })()}
                </div>

                <div style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 18,
                    transform: 'translateX(-50%)',
                    fontSize: 12,
                    letterSpacing: 0.8,
                    color: 'rgba(224,241,255,0.95)',
                    textAlign: 'center'
                }}>
                    Click, Space, or Enter when the needle passes through the target zone.
                </div>
                </div>

                {headBust.phase === 'INTRO' && (
                  <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: `linear-gradient(180deg, rgba(6, 8, 14, ${0.2 + headBustIntroOpacity * 0.38}), rgba(3, 4, 8, ${0.24 + headBustIntroOpacity * 0.44}))`
                  }}>
                      <div style={{
                          width: 'min(680px, calc(100vw - 48px))',
                          textAlign: 'center',
                          transform: `translateY(${Math.round(28 - 124 * headBustIntroEase)}px) scale(${(1.02 - headBustIntroEase * 0.06).toFixed(3)})`,
                          opacity: headBustIntroOpacity,
                          transition: 'transform 0.06s linear, opacity 0.06s linear'
                      }}>
                          <div style={{
                            width: 'min(240px, 44vw)',
                            height: 1,
                            margin: '0 auto 14px',
                            background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.26), rgba(255,255,255,0))'
                          }} />
                          <div style={{
                            fontSize: 'clamp(13px, 1.5vw, 16px)',
                            fontWeight: 700,
                            letterSpacing: 5,
                            color: 'rgba(228, 234, 246, 0.78)'
                          }}>
                            PERFECT RUN
                          </div>
                          <div style={{
                            marginTop: 8,
                            fontSize: 'clamp(46px, 8vw, 82px)',
                            fontWeight: 800,
                            lineHeight: 0.94,
                            letterSpacing: 1,
                            color: '#f0f3f9'
                          }}>
                            HEADBUST
                          </div>
                          <div style={{ marginTop: 11, fontSize: 12, fontWeight: 500, color: 'rgba(194, 203, 220, 0.84)' }}>
                            6 hits in a row. 8 seconds. One miss and you are out.
                          </div>
                          <div style={{
                            width: 'min(240px, 44vw)',
                            height: 1,
                            margin: '14px auto 0',
                            background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))'
                          }} />
                      </div>
                  </div>
                )}

                {headBust.phase === 'OUTRO' && (
                  <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: `rgba(5, 8, 14, ${clamp(0.05 + headBustOutroFade * 0.62, 0.05, 0.67)})`
                  }}>
                      <div style={{
                          textAlign: 'center',
                          opacity: headBustOutroFade,
                          transform: `translateY(${Math.round(16 - headBustOutroFade * 16)}px)`,
                          transition: 'opacity 0.08s linear, transform 0.08s linear'
                      }}>
                          <div style={{
                            fontSize: 12,
                            fontWeight: 800,
                            letterSpacing: 2.4,
                            color: 'rgba(208, 226, 255, 0.9)'
                          }}>
                            RETURNING TO ARENA
                          </div>
                          <div style={{
                            marginTop: 2,
                            fontSize: 'clamp(34px, 7vw, 72px)',
                            lineHeight: 1,
                            fontWeight: 900,
                            letterSpacing: 2.5,
                            color: headBust.winnerId === headBust.player.id ? '#50ff9e' : '#ff667a',
                            textShadow: headBust.winnerId === headBust.player.id
                              ? '0 10px 24px rgba(43, 214, 124, 0.45)'
                              : '0 10px 24px rgba(255, 83, 105, 0.45)'
                          }}>
                            {headBust.winnerId === headBust.player.id ? 'SUCCESS' : 'FAILED'}
                          </div>
                          <div style={{
                            marginTop: 4,
                            fontSize: 'clamp(52px, 10vw, 92px)',
                            lineHeight: 1,
                            fontWeight: 900,
                            color: '#f2f7ff',
                            textShadow: '0 8px 18px rgba(0, 0, 0, 0.35)'
                          }}>
                            {headBustOutroCountdown}
                          </div>
                          <div style={{
                            marginTop: 2,
                            fontSize: 12,
                            color: 'rgba(191, 210, 238, 0.88)'
                          }}>
                            {headBust.winnerId === headBust.player.id ? 'You won the clash' : 'You were eliminated'}
                          </div>
                      </div>
                  </div>
                )}
            </div>
        )}

        {/* Exit Button */}
        {(gameState === 'PLAYING' || gameState === 'PAUSED' || gameState === 'HEADBUST') && (
            <div
                style={{
                    position: 'absolute',
                    top: 64,
                    right: 24,
                    background: 'rgba(0,0,0,0.6)',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontWeight: 'bold',
                    border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    color: '#fff'
                }}
                onClick={exitToMenu}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = '#ff4444';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 5px 15px rgba(255, 68, 68, 0.3)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                }}
            >
                EXIT
            </div>
        )}

        {/* Main Menu */}
        {gameState === 'MENU' && (
            <div style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'radial-gradient(circle at center, rgba(20,30,50,0.9) 0%, #0b0e14 100%)',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
                    <div style={{ textAlign: 'center' }}>
                        <h1 style={{ 
                            fontSize: 'clamp(40px, 8vw, 80px)', 
                            fontWeight: 900, 
                            margin: 0,
                            background: 'linear-gradient(135deg, #00ff88 0%, #00aaff 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            filter: 'drop-shadow(0 0 30px rgba(0,255,136,0.3))'
                        }}>
                            SLITHER
                        </h1>
                        <p style={{ opacity: 0.6, marginTop: 10, fontSize: '16px' }}>
                            Eat or be eaten. Hold Space/Click to boost.
                        </p>
                    </div>

                    <SkinPicker selected={playerColor} onSelect={setPlayerColor} />

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <MenuButton 
                            label="Easy" 
                            sub="Chill pace"
                            color="#00ff88" 
                            onClick={() => startGame(0.8, 8)} 
                        />
                        <MenuButton 
                            label="Normal" 
                            sub="Standard challenge"
                            color="#00aaff" 
                            onClick={() => startGame(1.0, 12)} 
                        />
                        <MenuButton 
                            label="Hard" 
                            sub="Chaos mode"
                            color="#ff0055" 
                            onClick={() => startGame(2.7, 30)} 
                        />
                    </div>
                </div>
            </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'GAME_OVER' && (
            <div style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(11, 14, 20, 0.85)',
                backdropFilter: 'blur(8px)',
                animation: 'fadeIn 0.3s ease-out'
            }}>
                <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    gap: 24,
                    padding: '40px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '32px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#ff4444', letterSpacing: '2px' }}>
                        ELIMINATED
                    </div>
                    
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '64px', fontWeight: 900, lineHeight: 1 }}>
                            {finalScore}
                        </div>
                        <div style={{ opacity: 0.5, marginTop: 8 }}>FINAL SCORE</div>
                    </div>

                    <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.1)', margin: '10px 0' }} />

                    <button
                        onClick={exitToMenu}
                        style={{
                            background: 'white',
                            color: 'black',
                            border: 'none',
                            padding: '16px 32px',
                            borderRadius: '16px',
                            fontSize: '16px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'transform 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        Play Again
                    </button>
                </div>
            </div>
        )}
    </div>
  );
}

function MenuButton({ label, sub, color, onClick }: { label: string, sub: string, color: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${color}40`,
                borderRadius: '20px',
                padding: '20px 24px',
                minWidth: '140px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                position: 'relative',
                overflow: 'hidden'
            }}
            onMouseEnter={e => {
                e.currentTarget.style.background = `${color}15`;
                e.currentTarget.style.borderColor = color;
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = `0 10px 30px -10px ${color}60`;
            }}
            onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.borderColor = `${color}40`;
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
            }}
        >
            <div style={{ color: color, fontSize: '20px', fontWeight: 800, marginBottom: '4px' }}>
                {label}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                {sub}
            </div>
        </button>
    );
}

const SKINS = [
  '#00ff88', '#00aaff', '#ff0055', '#ffd700', '#ff9100', '#f7ff00',
  '#00ffea', '#ffffff', '#ff66cc', '#6dff6d', '#8b7bff', '#ff7b54'
];

function SkinPicker({ selected, onSelect }: { selected: string; onSelect: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>CHOOSE SKIN</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: 'rgba(162, 220, 255, 0.92)',
          textAlign: 'center',
          marginBottom: 20
        }}
      >
        Tip: in-game press <kbd style={{ fontFamily: 'inherit' }}>X</kbd> to practice HeadBust
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 360 }}>
        {SKINS.map((c) => {
          const active = c.toLowerCase() === selected.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
                background: c,
                boxShadow: active ? `0 0 0 2px ${c}55, 0 6px 16px ${c}55` : 'none',
                cursor: 'pointer',
                outline: 'none'
              }}
              aria-label={`Select ${c}`}
              title={c}
            />
          );
        })}
      </div>
    </div>
  );
}
