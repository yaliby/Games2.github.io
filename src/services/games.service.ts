import type { Game } from '../types/Game';

export function getGames(): Game[] {
  return [
    { id: '1', title: 'ארבע בשורה' ,image: 'Screenshot 2026-01-02 152831.png',path: '/game/connect-four'},
    { id: '2', title: 'דמקה' ,image: 'Screenshot 2026-01-02 152420.png',path: '/game/checkers',},
    { id: '3', title: 'Slither (Bots)', image: 'Screenshot 2026-01-09 210512.png', path: '/game/slither'},
    {id: '4',title: 'Block Blast',image: 'Screenshot 2026-01-23 151215.png',path: '/game/block-blast'},
    {id: '5',title: 'איקס עיגול',image: 'Screenshot 2026-02-06 183007.png',path: '/game/tic-tac-toe'},
    {id: '6',title: 'Word Guess',image: 'Cosmic word puzzle challenge.png',path: '/game/word-guess'},
    {id: '7',title: 'Crossy Dash',image: 'Screenshot 2026-02-07 134537.png',path: '/game/crossy-dash'},
  ];
}
