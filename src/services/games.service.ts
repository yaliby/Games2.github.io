import type { Game } from '../types/Game';

export function getGames(): Game[] {
  return [
    { id: '1', title: 'ארבע בשורה' ,image: 'Screenshot 2026-01-02 152831.png',path: '/game/connect-four',},
    { id: '2', title: 'דמקה' ,image: 'Screenshot 2026-01-02 152420.png',path: '/game/checkers',},
    { id: '3', title: 'Slither (Bots)', image: 'Screenshot 2026-01-09 210512.png', path: '/game/slither' },
  ];
}
