import { useEffect, useMemo, useRef, useState } from 'react';
import { createWorld, stepWorld } from './engine/rules_ai';
import type { Vec, World, StepInput } from './engine/types';
import { drawWorld } from './render/renderer';

type Screen = 'menu' | 'game';

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function computeUiSize() {
  // Responsive canvas sizing (no scrollbars)
  const w = Math.max(320, Math.min(window.innerWidth, 1600));
  const h = Math.max(320, Math.min(window.innerHeight, 900));
  return { w, h };
}

export default function SlitherGame() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const [ui, setUi] = useState(() => computeUiSize());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);

  const mouseRef = useRef<Vec>({ x: 0, y: 0 });
  const boostRef = useRef(false);
  const shiftRef = useRef(false);

  const fpsRef = useRef({ fps: 0, frames: 0, acc: 0 });

  useEffect(() => {
    const onResize = () => setUi(computeUiSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const startGame = (botCount: number, difficulty: number) => {
    worldRef.current = createWorld({ botCount, difficulty });
    setPaused(false);
    setScreen('game');
  };

  const endGame = () => {
    worldRef.current = null;
    setPaused(false);
    setScreen('menu');
  };

  // Game loop
  useEffect(() => {
    if (screen !== 'game') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.floor(ui.w * dpr);
    canvas.height = Math.floor(ui.h * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dprScale = dpr; // stable unless resized

    let raf = 0;

    // --- Input handlers (no allocations in loop) ---
    const rectRef = { rect: canvas.getBoundingClientRect() as DOMRect };

    const refreshRect = () => { rectRef.rect = canvas.getBoundingClientRect(); };

    const onMouseMove = (e: MouseEvent) => {
      const rect = rectRef.rect;
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const onMouseDown = () => { boostRef.current = true; };
    const onMouseUp = () => { boostRef.current = false; };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endGame();
        return;
      }
      if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaused((p) => !p);
        return;
      }
      if (e.key === 'Shift') shiftRef.current = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftRef.current = false;
    };

    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('scroll', refreshRect, true);
    window.addEventListener('resize', refreshRect);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Fixed-timestep loop (stable & smooth under frame drops)
    const FIXED_DT = 1 / 120;
    const MAX_STEPS = 7;
    let acc = 0;
    let lastTs = performance.now();

    // Camera: keep previous + current for interpolation
    const camPrev: Vec = { x: 0, y: 0 };
    const camCurr: Vec = { x: 0, y: 0 };
    const camRender: Vec = { x: 0, y: 0 };
    const view = { w: ui.w, h: ui.h, cam: camRender };

    // Reused objects to avoid per-step allocations
    const aimWorld: Vec = { x: 0, y: 0 };
    const stepInput: StepInput = { aimWorld, boost: false };

    // Init camera on the player, if present
    {
      const w = worldRef.current;
      const p = w?.snakes?.[0];
      if (p?.points?.length) {
        camPrev.x = camCurr.x = p.points[0].x;
        camPrev.y = camCurr.y = p.points[0].y;
      }
    }

    // Camera tuning
    const CAM_FOLLOW = 12; // bigger = tighter follow (stable at 120Hz)
    const CAM_SNAP_DIST2 = 1700 * 1700;

    const step = (ts: number) => {
      const w = worldRef.current;
      if (!w) return;

      const frameDt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      const fps = 1 / Math.max(1e-6, frameDt);
      fpsRef.current.frames++;
      fpsRef.current.acc += fps;
      if (fpsRef.current.frames >= 12) {
        fpsRef.current.fps = fpsRef.current.acc / fpsRef.current.frames;
        fpsRef.current.frames = 0;
        fpsRef.current.acc = 0;
      }

      // Only advance simulation when not paused (prevents accumulator spikes on resume)
      if (!pausedRef.current) {
        acc += frameDt;

        let steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS) {
          // Update camera in fixed step (smooth, deterministic)
          const player = w.snakes[0];
          let tx = camCurr.x, ty = camCurr.y;
          if (player?.points?.length) {
            tx = player.points[0].x;
            ty = player.points[0].y;
          }

          const dxCam = tx - camCurr.x;
          const dyCam = ty - camCurr.y;

          if ((dxCam * dxCam + dyCam * dyCam) > CAM_SNAP_DIST2) {
            // big jump (respawn, etc.) → snap to avoid a long smear
            camPrev.x = camCurr.x = tx;
            camPrev.y = camCurr.y = ty;
          } else {
            camPrev.x = camCurr.x;
            camPrev.y = camCurr.y;

            const k = 1 - Math.exp(-CAM_FOLLOW * FIXED_DT);
            camCurr.x += dxCam * k;
            camCurr.y += dyCam * k;
          }

          // Mouse → world aim using *physics* camera (not render-interpolated camera)
          aimWorld.x = (mouseRef.current.x - ui.w / 2) + camCurr.x;
          aimWorld.y = (mouseRef.current.y - ui.h / 2) + camCurr.y;

          stepInput.boost = boostRef.current || shiftRef.current;

          stepWorld(w, stepInput, FIXED_DT);

          acc -= FIXED_DT;
          steps++;
        }

        // Prevent spiral-of-death under huge stalls
        if (steps === MAX_STEPS && acc >= FIXED_DT) acc = 0;
      }

      // Interpolation factor for rendering
      const alpha = pausedRef.current ? 1 : clamp(acc / FIXED_DT, 0, 1);

      // Render-interpolated camera (smooth visuals)
      camRender.x = camPrev.x + (camCurr.x - camPrev.x) * alpha;
      camRender.y = camPrev.y + (camCurr.y - camPrev.y) * alpha;

      // Keep view object stable; only mutate fields (no per-frame allocation)
      view.w = ui.w;
      view.h = ui.h;

      // HiDPI: draw in CSS pixels while canvas backing store is scaled.
      ctx.setTransform(dprScale, 0, 0, dprScale, 0, 0);
      drawWorld(ctx, w, view, alpha);

      // overlay FPS + paused
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '600 11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText(`FPS: ${Math.round(fpsRef.current.fps)}`, 16, ui.h - 12);
      if (pausedRef.current) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '800 14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('PAUSED (P)', 16, 26);
      }
      ctx.restore();

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('scroll', refreshRect, true);
      window.removeEventListener('resize', refreshRect);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [screen, ui.w, ui.h]);

  const Menu = useMemo(() => {
    const Card = (props: { title: string; desc: string; onClick: () => void }) => (
      <button
        onClick={props.onClick}
        style={{
          width: 'min(520px, 92vw)',
          padding: 18,
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.10)',
          background: 'rgba(0,0,0,0.35)',
          color: 'white',
          textAlign: 'left',
          cursor: 'pointer',
          boxShadow: '0 12px 50px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.3 }}>{props.title}</div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8, lineHeight: 1.35 }}>{props.desc}</div>
      </button>
    );

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: '70vh',
          display: 'grid',
          placeItems: 'center',
          padding: 18,
        }}
      >
        <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
          <div style={{ color: 'white', fontWeight: 950, fontSize: 28, letterSpacing: 0.5 }}>
            Slither vs Bots
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, maxWidth: 560, textAlign: 'center' }}>
            Mouse to steer. Hold click or Shift to boost (costs length). Head into bodies to kill. ESC to menu, P to pause.
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            <Card
              title="Easy — 6 bots"
              desc="More forgiving bots, lower aggression. Great for testing performance & feel."
              onClick={() => startGame(6, 0.85)}
            />
            <Card
              title="Normal — 10 bots"
              desc="Balanced aggression + speed, tries to cut you off sometimes."
              onClick={() => startGame(10, 1.0)}
            />
            <Card
              title="Hard — 14 bots"
              desc="Higher aggression and better intercepts. Boost management matters."
              onClick={() => startGame(14, 1.25)}
            />
          </div>

          <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
            Tip: keep your head safe — body is your shield.
          </div>
        </div>
      </div>
    );
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      {screen === 'menu' ? (
        Menu
      ) : (
        <div style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{
              width: ui.w,
              height: ui.h,
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#0b0e14',
              display: 'block',
              boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            }}
          />

          <div style={{ position: 'absolute', right: 14, top: 14, display: 'flex', gap: 10 }}>
            <button
              onClick={() => setPaused((p) => !p)}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(0,0,0,0.35)',
                color: 'white',
                padding: '8px 10px',
                borderRadius: 12,
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {paused ? 'Resume (P)' : 'Pause (P)'}
            </button>

            <button
              onClick={endGame}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(0,0,0,0.35)',
                color: 'white',
                padding: '8px 10px',
                borderRadius: 12,
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Menu (ESC)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
