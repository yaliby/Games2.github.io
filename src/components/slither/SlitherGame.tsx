import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorld, stepWorld } from './engine/rules_ai';
import type { World } from './engine/types';
import { drawWorld } from './render/renderer';

// --- Configuration ---
const PHYSICS_RATE = 60; // Hz
const FIXED_DT = 1 / PHYSICS_RATE;
const CAM_DAMPING = 5.0; // Camera smoothness (higher = tighter)

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type GameState = 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export default function SlitherGame() {
  // --- React State for UI ---
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [playerColor, setPlayerColor] = useState('#00ff88');
  
  // --- Mutable Game State (Refs) ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastScoreRef = useRef(0);
  
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
  const startGame = (difficulty: number, botCount: number) => {
    worldRef.current = createWorld({ botCount, difficulty, playerColor });
    
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

    const onMouseDown = () => { inputRef.current.boosting = true; };
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
  }, [togglePause]);

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

      // Render
      const world = worldRef.current;
      if (world) {
        // Interpolation alpha for smoother rendering between physics steps
        const alpha = gameState === 'PAUSED' ? 1.0 : accumulator / FIXED_DT;
        
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
  }, [gameState]);

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

        {/* Exit Button */}
        {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
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
                onClick={() => setGameState('MENU')}
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
                        onClick={() => setGameState('MENU')}
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
