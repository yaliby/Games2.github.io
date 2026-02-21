import type { Game } from '../types/Game';

export function getGames(): Game[] {
  return [
    { id: '1', title: 'ארבע בשורה' ,image: 'Screenshot 2026-01-02 152831.png',path: '/game/connect-four'},
    { id: '2', title: 'דמקה' ,image: 'Screenshot 2026-01-02 152420.png',path: '/game/checkers',},
    { id: '3', title: 'Slither (Bots)', image: 'Screenshot 2026-01-09 210512.png', path: '/game/slither'},
    {id: '4',title: 'Block Blast',image: 'Screenshot 2026-01-23 151215.png',path: '/game/block-blast'},
    {id: '5',title: 'איקס עיגול',image: 'Screenshot 2026-02-06 183007.png',path: '/game/tic-tac-toe'},
    {id: '6',title: 'Word Guess',image: 'Cosmic word puzzle challenge.png',path: '/game/word-guess'},
    {id: '7',title: 'Crossy Dash',image: 'Screenshot 2026-02-07 134537.png',path: '/game/expo-crossy-road'},
    {id: '8',title: 'Which country',image: 'Screenshot 2026-02-14 191129.png',path: '/game/which-country'},
    {id: '9',title: 'Russian Shooter',image: 'Screenshot 2026-02-14 225050.png',path: '/game/sound-shooter'},
    {id: '10',title: 'שש בש',image: 'Screenshot_20260221_005227.png',path: '/game/backgammon'},
    {id: '11',title: 'Coyote Flapy',image: 'Screenshot 2026-02-20 140254.png',path: '/game/coyote-flapy'},
    {id: '12',title: 'SysTris',image: 'Screenshot_20260221_014939.png',path: '/game/systris'},
    {id: '13',title: '6767',image: 'Screenshot_20260221_165024.png',path: '/game/6767'},
    {id: '14',title: 'BlobBlast',image: 'Screenshot_20260221_223512.png',path: '/game/blob-blast'},
  ];
}
