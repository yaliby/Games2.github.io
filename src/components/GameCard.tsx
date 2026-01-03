import { Link } from 'react-router-dom';
import type { Game } from '../types/Game';

export default function GameCard({ game }: { game: Game }) {
  return (
    <Link to={game.path} className="game-card-wrapper">
      <article className="game-card">
        <div className="game-card__image">
          <img src={`/${game.image}`} alt={game.title} />
        </div>
      </article>

      <h3 className="game-card-title">{game.title}</h3>
    </Link>
  );
}
