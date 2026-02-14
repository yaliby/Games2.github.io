import { useEffect } from 'react';
import GameCard from '../components/GameCard';
import { getGames } from '../services/games.service';

export default function Home() {
  const games = getGames();

  useEffect(() => {
    const root = document.documentElement;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

    const updateBackgroundPointer = () => {
      const docWidth = Math.max(root.scrollWidth, window.innerWidth);
      const docHeight = Math.max(root.scrollHeight, window.innerHeight);
      const pageX = window.scrollX + pointerX;
      const pageY = window.scrollY + pointerY;

      const x = clampPercent((pageX / docWidth) * 100);
      const y = clampPercent((pageY / docHeight) * 100);

      root.style.setProperty('--mouse-x', `${x}%`);
      root.style.setProperty('--mouse-y', `${y}%`);
    };

    const onMouseMove = (event: MouseEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      updateBackgroundPointer();
    };

    const onViewportChange = () => {
      updateBackgroundPointer();
    };

    updateBackgroundPointer();
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('scroll', onViewportChange);
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
