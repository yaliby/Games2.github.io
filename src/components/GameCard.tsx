import { Link } from 'react-router-dom';
import type { Game } from '../types/Game';

export default function GameCard({ game }: { game: Game }) {
  // Use base path for images to work with GitHub Pages
  // BASE_URL already includes trailing slash, so we don't need to add one
  //const baseUrl = import.meta.env.BASE_URL;
  const imagePath = `${import.meta.env.BASE_URL}${game.image}`;
  
  return (
    <Link to={game.path} className="game-card-wrapper">
      <article className="game-card">
        <div className="game-card__image">
          <img src={imagePath} alt={game.title} />
        </div>
      </article>

      <h3 className="game-card-title">{game.title}</h3>
    </Link>
  );
}
