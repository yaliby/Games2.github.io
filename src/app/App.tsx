import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Home from '../pages/Home';
import Game from '../pages/Game';
import CheckersGame from '../components/checkers/CheckersGame';
import NotFound from '../pages/NotFound';
import SlitherGame from '../components/slither/SlitherGame';


export default function App() {
  // Use the same base as vite.config.ts for consistency
  const basename = import.meta.env.BASE_URL;
  
  return (
    <BrowserRouter basename={basename}>
      <div className="app-layout">
        <Header />

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/game/connect-four" element={<Game />} />
          <Route path="/game/checkers" element={<CheckersGame />} />
          <Route path="/game/slither" element={<SlitherGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>

        <Footer />
      </div>
    </BrowserRouter>
  );
}
