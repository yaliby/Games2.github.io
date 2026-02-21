import { useEffect } from 'react';
import GameCard from '../components/GameCard';
import { getGames } from '../services/games.service';

export default function Home() {
  const games = getGames();

  useEffect(() => {
    const root = document.documentElement;
    let targetX = 50;
    let targetY = 50;
    let currentX = 50;
    let currentY = 50;
    let speed = 0;
    let speedTarget = 0;
    let lastPointerX: number | null = null;
    let lastPointerY: number | null = null;
    let lastPointerTime = performance.now();
    let rafId: number | null = null;

    const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const EASE = 0.14;
    const SPEED_EASE = 0.14;
    const SPEED_DECAY = 0.88;
    const EPSILON = 0.04;

    const commit = () => {
      root.style.setProperty('--mouse-x', `${currentX.toFixed(2)}%`);
      root.style.setProperty('--mouse-y', `${currentY.toFixed(2)}%`);
      root.style.setProperty('--mouse-speed', speed.toFixed(3));
    };

    const step = () => {
      rafId = null;
      currentX += (targetX - currentX) * EASE;
      currentY += (targetY - currentY) * EASE;
      speed += (speedTarget - speed) * SPEED_EASE;
      speedTarget *= SPEED_DECAY;

      if (speedTarget < 0.001) speedTarget = 0;
      if (speed < 0.001) speed = 0;
      commit();

      const moving =
        Math.abs(targetX - currentX) > EPSILON ||
        Math.abs(targetY - currentY) > EPSILON;

      const activeSpeed = speed > 0.004 || speedTarget > 0.004;

      if (moving || activeSpeed) {
        scheduleUpdate();
      }
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(step);
    };

    const updateTarget = (clientX: number, clientY: number, timeStamp: number) => {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      targetX = clampPercent((clientX / width) * 100);
      targetY = clampPercent((clientY / height) * 100);

      if (lastPointerX !== null && lastPointerY !== null) {
        const dx = clientX - lastPointerX;
        const dy = clientY - lastPointerY;
        const dt = Math.max(8, timeStamp - lastPointerTime);
        const pxPerMs = Math.hypot(dx, dy) / dt;
        const normalizedSpeed = clamp01((pxPerMs - 0.045) * 1.45);
        speedTarget = Math.max(speedTarget, normalizedSpeed);
      }

      lastPointerX = clientX;
      lastPointerY = clientY;
      lastPointerTime = timeStamp;
      scheduleUpdate();
    };

    const onPointerMove = (event: PointerEvent) => {
      updateTarget(event.clientX, event.clientY, event.timeStamp);
    };

    const onPointerIdle = () => {
      lastPointerX = null;
      lastPointerY = null;
      speedTarget = 0;
      scheduleUpdate();
    };

    const onViewportChange = () => {
      targetX = clampPercent(targetX);
      targetY = clampPercent(targetY);
      scheduleUpdate();
    };

    commit();
    scheduleUpdate();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerIdle);
    window.addEventListener('blur', onPointerIdle);
    window.addEventListener('resize', onViewportChange);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerIdle);
      window.removeEventListener('blur', onPointerIdle);
      window.removeEventListener('resize', onViewportChange);
    };
  }, []);

  return (
    <main className="home">
      <section className="home-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">Game Hub</span>
          </h2>
        </div>
      </section>

      <section className="home-content">
        <div className="games-grid">
          {games.map(game => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>
    </main>
  );
}
