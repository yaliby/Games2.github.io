import type { Board, Cell, Player, PieceType, Pos, Move, MoveSequence, Winner } from './types';
import { ROWS, COLS } from './types';

export const EMPTY: Cell = 0;
export const RED_MAN: PieceType = 1;
export const RED_KING: PieceType = 2;
export const BLACK_MAN: PieceType = 3;
export const BLACK_KING: PieceType = 4;

export const RED: Player = 1;
export const BLACK: Player = 3;

export function otherPlayer(p: Player): Player {
  return p === RED ? BLACK : RED;
}

export function isPlayerPiece(cell: Cell, player: Player): boolean {
  if (cell === EMPTY) return false;
  if (player === RED) return cell === RED_MAN || cell === RED_KING;
  return cell === BLACK_MAN || cell === BLACK_KING;
}

export function isKing(cell: Cell): boolean {
  return cell === RED_KING || cell === BLACK_KING;
}

export function getPieceType(cell: Cell): PieceType | null {
  return cell === EMPTY ? null : (cell as PieceType);
}

export function createBoard(): Board {
  const board: Board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => EMPTY)
  );

  // 3 rows per player (remove 1 row per side compared to the 4-row setup)
  // Black at top: rows 0-2
  // Red at bottom: rows 7-9
  const START_ROWS = 3;
  const RED_START = ROWS - START_ROWS;

  for (let r = 0; r < START_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 1) {
        board[r][c] = BLACK_MAN;
      }
    }
  }

  for (let r = RED_START; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 1) {
        board[r][c] = RED_MAN;
      }
    }
  }

  return board;
}


export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function isDarkSquare(r: number, c: number): boolean {
  return (r + c) % 2 === 1;
}

// Get all possible moves for a piece
// If inChainCapture is true, allows backward captures for regular men
export function getMovesForPiece(
  board: Board,
  pos: Pos,
  player: Player,
  inChainCapture: boolean = false
): MoveSequence[] {
  const cell = board[pos.r][pos.c];
  if (!isPlayerPiece(cell, player)) return [];

  const sequences: MoveSequence[] = [];
  const isKingPiece = isKing(cell);

  // Check for captures first (mandatory in Israeli Checkers)
  const captureSequences = getCaptureSequences(board, pos, player, isKingPiece, inChainCapture);
  if (captureSequences.length > 0) {
    return captureSequences;
  }

  // If no captures, check regular moves
  if (isKingPiece) {
    // Kings can move multiple squares along diagonal
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of directions) {
      for (let dist = 1; dist < ROWS; dist++) {
        const newR = pos.r + dr * dist;
        const newC = pos.c + dc * dist;
        
        if (!inBounds(newR, newC) || !isDarkSquare(newR, newC)) break;
        if (board[newR][newC] !== EMPTY) break; // Blocked by piece
        
        sequences.push({
          moves: [
            {
              from: pos,
              to: { r: newR, c: newC },
              captures: [],
              promotes: false,
            },
          ],
          totalCaptures: 0,
        });
      }
    }
  } else {
    // Regular men move one square forward
    const directions = player === RED
      ? [[-1, -1], [-1, 1]] // Red moves up (toward row 0)
      : [[1, -1], [1, 1]];  // Black moves down (toward row 9)

    for (const [dr, dc] of directions) {
      const newR = pos.r + dr;
      const newC = pos.c + dc;

      if (inBounds(newR, newC) && board[newR][newC] === EMPTY && isDarkSquare(newR, newC)) {
        const promotes = player === RED
          ? newR === 0
          : newR === ROWS - 1;

        sequences.push({
          moves: [
            {
              from: pos,
              to: { r: newR, c: newC },
              captures: [],
              promotes,
            },
          ],
          totalCaptures: 0,
        });
      }
    }
  }

  return sequences;
}

// Get single capture moves from a position (for chain capture continuation)
// Returns only immediate next captures, not full sequences
export function getSingleCaptureMoves(
  board: Board,
  pos: Pos,
  player: Player,
  isKingPiece: boolean,
  inChainCapture: boolean
): Move[] {
  const captures: Move[] = [];
  
  // During chain capture, regular men can capture in all directions
  const directions = (isKingPiece || inChainCapture)
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : player === RED
    ? [[-1, -1], [-1, 1]]
    : [[1, -1], [1, 1]];

  for (const [dr, dc] of directions) {
    if (isKingPiece) {
      // King can jump over pieces at any distance along diagonal
      for (let dist = 1; dist < ROWS; dist++) {
        const jumpR = pos.r + dr * dist;
        const jumpC = pos.c + dc * dist;
        
        if (!inBounds(jumpR, jumpC)) break;
        if (board[jumpR][jumpC] === EMPTY) continue;
        if (!isPlayerPiece(board[jumpR][jumpC], otherPlayer(player))) break;
        
        // Check if landing square is empty
        const landR = pos.r + dr * (dist + 1);
        const landC = pos.c + dc * (dist + 1);
        
        if (inBounds(landR, landC) && isDarkSquare(landR, landC) && board[landR][landC] === EMPTY) {
          captures.push({
            from: pos,
            to: { r: landR, c: landC },
            captures: [{ r: jumpR, c: jumpC }],
            promotes: false,
          });
        }
        break; // Can only jump over one piece
      }
    } else {
      // Regular man jumps one square
      const jumpR = pos.r + dr;
      const jumpC = pos.c + dc;
      const landR = pos.r + dr * 2;
      const landC = pos.c + dc * 2;

      if (
        inBounds(jumpR, jumpC) &&
        inBounds(landR, landC) &&
        isDarkSquare(landR, landC) &&
        isPlayerPiece(board[jumpR][jumpC], otherPlayer(player)) &&
        board[landR][landC] === EMPTY
      ) {
        const promotes = player === RED
          ? landR === 0
          : landR === ROWS - 1;

        captures.push({
          from: pos,
          to: { r: landR, c: landC },
          captures: [{ r: jumpR, c: jumpC }],
          promotes,
        });
      }
    }
  }

  return captures;
}

// Get all capture sequences (for initial capture detection)
// Returns only the first jump in each sequence (chain continues manually)
function getCaptureSequences(
  board: Board,
  pos: Pos,
  player: Player,
  isKingPiece: boolean,
  inChainCapture: boolean
): MoveSequence[] {
  const singleCaptures = getSingleCaptureMoves(board, pos, player, isKingPiece, inChainCapture);
  
  // Return as sequences with single move each
  // Chain continuation will be handled separately
  return singleCaptures.map(move => ({
    moves: [move],
    totalCaptures: 1,
  }));
}

// Get all legal moves for a player
// If chainCaptureFrom is provided, only return moves from that position
export function getAllMoves(
  board: Board,
  player: Player,
  chainCaptureFrom: Pos | null = null
): MoveSequence[] {
  const allSequences: MoveSequence[] = [];
  const inChainCapture = chainCaptureFrom !== null;

  // If in chain capture, only check moves from that position
  if (inChainCapture) {
    const cell = board[chainCaptureFrom.r][chainCaptureFrom.c];
    const isKingPiece = isKing(cell);
    const captures = getSingleCaptureMoves(board, chainCaptureFrom, player, isKingPiece, true);
    return captures.map(move => ({
      moves: [move],
      totalCaptures: 1,
    }));
  }

  // First, check if any captures are available
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPlayerPiece(board[r][c], player)) {
        const sequences = getMovesForPiece(board, { r, c }, player, false);
        for (const seq of sequences) {
          if (seq.totalCaptures > 0) {
            allSequences.push(seq);
          }
        }
      }
    }
  }

  // If captures exist, they are mandatory
  if (allSequences.length > 0) {
    return allSequences;
  }

  // No captures, return all regular moves
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPlayerPiece(board[r][c], player)) {
        const sequences = getMovesForPiece(board, { r, c }, player, false);
        allSequences.push(...sequences);
      }
    }
  }

  return allSequences;
}

// Get all legal full turn sequences (resolving chain captures)
export function getAllLegalSequences(
  board: Board,
  player: Player,
  chainCaptureFrom: Pos | null = null
): MoveSequence[] {
  const initialMoves = getAllMoves(board, player, chainCaptureFrom);
  const completedSequences: MoveSequence[] = [];

  for (const seq of initialMoves) {
    // seq.moves[0] is the next step.
    // We need to simulate this step and see if it continues.
    const bCopy = cloneBoard(board);
    const move = seq.moves[0];
    const result = applyMove(bCopy, move, player);

    if (result.canContinueCapture) {
      // Recursively find continuations
      const continuations = getCaptureContinuations(bCopy, move.to, player);
      for (const continuation of continuations) {
        completedSequences.push({
          moves: [move, ...continuation.moves],
          totalCaptures: seq.totalCaptures + continuation.totalCaptures
        });
      }
    } else {
      completedSequences.push(seq);
    }
  }
  
  return completedSequences;
}

function getCaptureContinuations(board: Board, pos: Pos, player: Player): MoveSequence[] {
  const cell = board[pos.r][pos.c];
  const isKingPiece = isKing(cell);
  const nextCaptures = getSingleCaptureMoves(board, pos, player, isKingPiece, true);
  
  if (nextCaptures.length === 0) return [];

  const sequences: MoveSequence[] = [];
  for (const move of nextCaptures) {
    const bCopy = cloneBoard(board);
    const result = applyMove(bCopy, move, player);
    
    if (result.canContinueCapture) {
      const subContinuations = getCaptureContinuations(bCopy, move.to, player);
      for (const sub of subContinuations) {
        sequences.push({
          moves: [move, ...sub.moves],
          totalCaptures: 1 + sub.totalCaptures
        });
      }
    } else {
      sequences.push({
        moves: [move],
        totalCaptures: 1
      });
    }
  }
  return sequences;
}

// Apply a single move to the board (mutates board)
// Returns true if more captures are possible from the new position
export function applyMove(
  board: Board,
  move: Move,
  player: Player
): { success: boolean; canContinueCapture: boolean } {
  if (!inBounds(move.from.r, move.from.c) || !inBounds(move.to.r, move.to.c)) {
    return { success: false, canContinueCapture: false };
  }

  const piece = board[move.from.r][move.from.c];
  if (!isPlayerPiece(piece, player)) {
    return { success: false, canContinueCapture: false };
  }

  // Apply the move
  board[move.to.r][move.to.c] = move.promotes
    ? (player === RED ? RED_KING : BLACK_KING)
    : piece;
  board[move.from.r][move.from.c] = EMPTY;

  // Remove captured pieces
  for (const cap of move.captures) {
    board[cap.r][cap.c] = EMPTY;
  }

  // Check if more captures are possible from new position
  // Chain capture only occurs if:
  // 1. The move just made was a capture (has captures)
  // 2. After that capture, there are more captures possible
  const wasCapture = move.captures.length > 0;
  let canContinueCapture = false;
  
  if (wasCapture) {
    const isKingPiece = isKing(board[move.to.r][move.to.c]);
    const nextCaptures = getSingleCaptureMoves(board, move.to, player, isKingPiece, true);
    canContinueCapture = nextCaptures.length > 0;
  }

  return { success: true, canContinueCapture };
}

// Check if game is over
export function getWinner(board: Board, currentPlayer: Player): Winner {
  const redPieces = countPieces(board, RED);
  const blackPieces = countPieces(board, BLACK);

  if (redPieces === 0) {
    return { kind: 'WIN', player: BLACK };
  }
  if (blackPieces === 0) {
    return { kind: 'WIN', player: RED };
  }

  // Check if current player has any legal moves
  const moves = getAllMoves(board, currentPlayer);
  if (moves.length === 0) {
    return { kind: 'WIN', player: otherPlayer(currentPlayer) };
  }

  // Check for draw (very rare in checkers, but possible)
  // For simplicity, we'll consider it a draw if both players have no moves
  // (though this is extremely unlikely)
  const otherMoves = getAllMoves(board, otherPlayer(currentPlayer));
  if (moves.length === 0 && otherMoves.length === 0) {
    return { kind: 'DRAW' };
  }

  return { kind: 'NONE' };
}

function countPieces(board: Board, player: Player): number {
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPlayerPiece(board[r][c], player)) {
        count++;
      }
    }
  }
  return count;
}

export function isDraw(board: Board): boolean {
  // Check if both players have pieces but no moves (very rare)
  const redMoves = getAllMoves(board, RED);
  const blackMoves = getAllMoves(board, BLACK);
  return redMoves.length === 0 && blackMoves.length === 0;
}

/* =========================
   AI — Minimax with Alpha-Beta
   ========================= */

interface TTEntry {
  depth: number;
  flag: 'EXACT' | 'LOWER' | 'UPPER';
  value: number;
  bestSeq: MoveSequence | null;
}

// Zobrist Hashing Setup
// We use BigInt for 64-bit hash keys to minimize collisions
const ZOBRIST_TABLE = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () =>
    Array.from({ length: 5 }, () => BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)))
  )
);
const ZOBRIST_TURN = {
  [RED]: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
  [BLACK]: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
};

function computeZobristHash(board: Board, turn: Player): bigint {
  let h = ZOBRIST_TURN[turn];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (cell !== EMPTY) {
        h ^= ZOBRIST_TABLE[r][c][cell];
      }
    }
  }
  return h;
}

type EvalResult = { value: number; bestSequence: MoveSequence | null };

const WIN_SCORE = 1_000_000;
const KING_VALUE = 5;  // Increased from 3 - kings are very powerful
const MAN_VALUE = 1;
const INF = 10_000_000;
const QUIESCENCE_DEPTH = 4;
const CAPTURE_PRESSURE_WEIGHT = 0.22;
const THREAT_WEIGHT = 0.3;
const CENTER_MAN_WEIGHT = 0.05;
const MOVE_PROMOTE_BONUS = 3.0;
const MOVE_CAPTURE_WEIGHT = 1.6;
const MOVE_CAPTURE_VALUE_WEIGHT = 0.6;
const MOVE_FORWARD_WEIGHT = 0.25;
const MOVE_CENTER_WEIGHT = 0.08;

function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice()) as Board;
}

function pieceValue(cell: Cell): number {
  if (cell === EMPTY) return 0;
  return isKing(cell) ? KING_VALUE : MAN_VALUE;
}

function hasCaptureMoves(moves: MoveSequence[]): boolean {
  return moves.length > 0 && moves[0].totalCaptures > 0;
}

function captureValueFromMoves(board: Board, moves: MoveSequence[]): number {
  if (!hasCaptureMoves(moves)) return 0;
  const seen = new Set<string>();
  let value = 0;
  for (const seq of moves) {
    for (const move of seq.moves) {
      for (const cap of move.captures) {
        const key = `${cap.r},${cap.c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        value += pieceValue(board[cap.r][cap.c]);
      }
    }
  }
  return value;
}

function threatenedPiecesCount(moves: MoveSequence[]): number {
  if (!hasCaptureMoves(moves)) return 0;
  const seen = new Set<string>();
  for (const seq of moves) {
    for (const move of seq.moves) {
      for (const cap of move.captures) {
        const key = `${cap.r},${cap.c}`;
        if (!seen.has(key)) seen.add(key);
      }
    }
  }
  return seen.size;
}

function sequenceCaptureValue(board: Board, seq: MoveSequence): number {
  let value = 0;
  for (const move of seq.moves) {
    for (const cap of move.captures) {
      value += pieceValue(board[cap.r][cap.c]);
    }
  }
  return value;
}

function sequenceScore(board: Board, seq: MoveSequence, player: Player): number {
  if (seq.moves.length === 0) return 0;
  const first = seq.moves[0];
  const last = seq.moves[seq.moves.length - 1];
  let score = 0;

  score += seq.totalCaptures * MOVE_CAPTURE_WEIGHT;
  score += sequenceCaptureValue(board, seq) * MOVE_CAPTURE_VALUE_WEIGHT;
  if (last.promotes) score += MOVE_PROMOTE_BONUS;

  const startCell = board[first.from.r][first.from.c];
  if (startCell !== EMPTY && !isKing(startCell)) {
    const dir = player === RED ? -1 : 1;
    score += (last.to.r - first.from.r) * dir * MOVE_FORWARD_WEIGHT;
  }

  const centerR = (ROWS - 1) / 2;
  const centerC = (COLS - 1) / 2;
  const dist = Math.abs(last.to.r - centerR) + Math.abs(last.to.c - centerC);
  score += (4 - dist) * MOVE_CENTER_WEIGHT;

  return score;
}

function orderMoves(
  board: Board,
  moves: MoveSequence[],
  player: Player,
  ttBestSeq?: MoveSequence | null
): MoveSequence[] {
  if (moves.length <= 1) return moves;
  const scored = moves.map((seq) => {
    let score = sequenceScore(board, seq, player);
    if (ttBestSeq && areSequencesEqual(seq, ttBestSeq)) {
      score += 10_000;
    }
    return { seq, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.seq);
}

function evaluate(board: Board, me: Player): number {
  const w = getWinner(board, me);
  if (w.kind === 'WIN') {
    return w.player === me ? WIN_SCORE : -WIN_SCORE;
  }
  if (w.kind === 'DRAW') return 0;

  let score = 0;
  const opp = otherPlayer(me);

  // Material count (most important)
  let myPieces = 0;
  let oppPieces = 0;
  let myKings = 0;
  let oppKings = 0;
  
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (isPlayerPiece(cell, me)) {
        if (isKing(cell)) {
          myKings++;
          score += KING_VALUE;
        } else {
          myPieces++;
          score += MAN_VALUE;
        }
      } else if (isPlayerPiece(cell, opp)) {
        if (isKing(cell)) {
          oppKings++;
          score -= KING_VALUE;
        } else {
          oppPieces++;
          score -= MAN_VALUE;
        }
      }
    }
  }

  // Endgame: material advantage is more important
  const totalPieces = myPieces + oppPieces + myKings + oppKings;
  if (totalPieces <= 8) {
    // Endgame - material is even more critical
    score *= 1.2;
  }

  const centerR = (ROWS - 1) / 2;
  const centerC = (COLS - 1) / 2;

  // Positional: pieces closer to promotion are better
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (isPlayerPiece(cell, me) && !isKing(cell)) {
        const promotionRow = me === RED ? 0 : ROWS - 1;
        const distance = Math.abs(r - promotionRow);
        score += (ROWS - distance) * 0.15; // Increased from 0.1
        const centerDist = Math.abs(r - centerR) + Math.abs(c - centerC);
        score += Math.max(0, 4 - centerDist) * CENTER_MAN_WEIGHT;
      } else if (isPlayerPiece(cell, opp) && !isKing(cell)) {
        const promotionRow = opp === RED ? 0 : ROWS - 1;
        const distance = Math.abs(r - promotionRow);
        score -= (ROWS - distance) * 0.15;
        const centerDist = Math.abs(r - centerR) + Math.abs(c - centerC);
        score -= Math.max(0, 4 - centerDist) * CENTER_MAN_WEIGHT;
      }
    }
  }

  // Center control (kings) - more valuable
  for (let r = 2; r < ROWS - 2; r++) {
    for (let c = 2; c < COLS - 2; c++) {
      if (isKing(board[r][c])) {
        if (isPlayerPiece(board[r][c], me)) {
          score += 0.3; // Increased from 0.2
        } else {
          score -= 0.3;
        }
      }
    }
  }

  // Piece safety: pieces on back row are safer
  const backRow = me === RED ? ROWS - 1 : 0;
  const oppBackRow = opp === RED ? ROWS - 1 : 0;
  for (let c = 0; c < COLS; c++) {
    if (isDarkSquare(backRow, c) && isPlayerPiece(board[backRow][c], me)) {
      score += 0.2;
    }
    if (isDarkSquare(oppBackRow, c) && isPlayerPiece(board[oppBackRow][c], opp)) {
      score -= 0.2;
    }
  }

  // Mobility and capture pressure
  const myMoves = getAllMoves(board, me);
  const oppMoves = getAllMoves(board, opp);
  score += (myMoves.length - oppMoves.length) * 0.05;

  const myCaptureValue = captureValueFromMoves(board, myMoves);
  const oppCaptureValue = captureValueFromMoves(board, oppMoves);
  score += (myCaptureValue - oppCaptureValue) * CAPTURE_PRESSURE_WEIGHT;

  const myThreatened = threatenedPiecesCount(oppMoves);
  const oppThreatened = threatenedPiecesCount(myMoves);
  score += (oppThreatened - myThreatened) * THREAT_WEIGHT;

  // Double corner control (strong defensive position)
  const corners = [
    { r: 0, c: 0 }, { r: 0, c: COLS - 1 },
    { r: ROWS - 1, c: 0 }, { r: ROWS - 1, c: COLS - 1 }
  ];
  for (const corner of corners) {
    if (isDarkSquare(corner.r, corner.c)) {
      if (isPlayerPiece(board[corner.r][corner.c], me)) {
        score += 0.15;
      } else if (isPlayerPiece(board[corner.r][corner.c], opp)) {
        score -= 0.15;
      }
    }
  }

  return score;
}

function quiescence(
  board: Board,
  alpha: number,
  beta: number,
  toMove: Player,
  me: Player,
  depth: number
): number {
  const standPat = evaluate(board, me);
  if (depth <= 0) return standPat;

  const moves = getAllLegalSequences(board, toMove, null);
  if (moves.length === 0 || moves[0].totalCaptures === 0) {
    return standPat;
  }

  const ordered = orderMoves(board, moves, toMove);

  if (toMove === me) {
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    for (const move of ordered) {
      const b2 = cloneBoard(board);
      for (const m of move.moves) {
        applyMove(b2, m, toMove);
      }
      const val = quiescence(b2, alpha, beta, otherPlayer(toMove), me, depth - 1);
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return alpha;
  }

  if (standPat <= alpha) return standPat;
  if (standPat < beta) beta = standPat;

  for (const move of ordered) {
    const b2 = cloneBoard(board);
    for (const m of move.moves) {
      applyMove(b2, m, toMove);
    }
    const val = quiescence(b2, alpha, beta, otherPlayer(toMove), me, depth - 1);
    if (val < beta) beta = val;
    if (beta <= alpha) break;
  }
  return beta;
}

function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  toMove: Player,
  me: Player,
  tt: Map<bigint, TTEntry>
): EvalResult {
  const key = computeZobristHash(board, toMove);
  const ttEntry = tt.get(key);

  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 'EXACT') {
      return { value: ttEntry.value, bestSequence: ttEntry.bestSeq };
    } else if (ttEntry.flag === 'LOWER') {
      alpha = Math.max(alpha, ttEntry.value);
    } else if (ttEntry.flag === 'UPPER') {
      beta = Math.min(beta, ttEntry.value);
    }
    if (alpha >= beta) {
      return { value: ttEntry.value, bestSequence: ttEntry.bestSeq };
    }
  }

  const evalNow = evaluate(board, me);
  const winner = getWinner(board, toMove);

  if (winner.kind === 'WIN') {
    const winVal = winner.player === me ? WIN_SCORE : -WIN_SCORE;
    return { value: winVal + Math.sign(winVal) * depth, bestSequence: null };
  }
  if (winner.kind === 'DRAW') {
    return { value: 0, bestSequence: null };
  }
  if (Math.abs(evalNow) >= WIN_SCORE) {
    return { value: evalNow + Math.sign(evalNow) * depth, bestSequence: null };
  }
  if (depth <= 0) {
    const q = quiescence(board, alpha, beta, toMove, me, QUIESCENCE_DEPTH);
    return { value: q, bestSequence: null };
  }

  // Use getAllLegalSequences to evaluate full turns (including chain captures)
  const moves = getAllLegalSequences(board, toMove, null);
  if (moves.length === 0) {
    return { value: evalNow, bestSequence: null };
  }

  // Move Ordering: TT Best Move > captures/promotions/positional heuristics
  const ttBestSeq = ttEntry?.bestSeq;
  const orderedMoves = orderMoves(board, moves, toMove, ttBestSeq);

  const maximizing = toMove === me;
  let bestSequence: MoveSequence | null = null;
  let originalAlpha = alpha;
  let bestVal = maximizing ? -INF : INF;

  if (maximizing) {
    for (const move of orderedMoves) {
      const b2 = cloneBoard(board);
      // Apply ALL moves in the sequence
      for (const m of move.moves) {
        applyMove(b2, m, toMove);
      }

      const res = minimax(b2, depth - 1, alpha, beta, otherPlayer(toMove), me, tt);
      if (res.value > bestVal) {
        bestVal = res.value;
        bestSequence = move;
      }

      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) break;
    }
  } else {
    for (const move of orderedMoves) {
      const b2 = cloneBoard(board);
      // Apply ALL moves in the sequence
      for (const m of move.moves) {
        applyMove(b2, m, toMove);
      }

      const res = minimax(b2, depth - 1, alpha, beta, otherPlayer(toMove), me, tt);
      if (res.value < bestVal) {
        bestVal = res.value;
        bestSequence = move;
      }

      beta = Math.min(beta, bestVal);
      if (beta <= alpha) break;
    }
  }

  let flag: 'EXACT' | 'LOWER' | 'UPPER' = 'EXACT';
  if (bestVal <= originalAlpha) flag = 'UPPER';
  else if (bestVal >= beta) flag = 'LOWER';

  tt.set(key, {
    depth,
    flag,
    value: bestVal,
    bestSeq: bestSequence
  });

  return { value: bestVal, bestSequence };
}

function areSequencesEqual(a: MoveSequence, b: MoveSequence): boolean {
  if (a.moves.length !== b.moves.length) return false;
  if (a.totalCaptures !== b.totalCaptures) return false;
  if (a.moves.length === 0) return true;
  
  // Compare start and end of the sequence
  const aFirst = a.moves[0];
  const bFirst = b.moves[0];
  if (aFirst.from.r !== bFirst.from.r || aFirst.from.c !== bFirst.from.c) return false;
  
  const aLast = a.moves[a.moves.length - 1];
  const bLast = b.moves[b.moves.length - 1];
  if (aLast.to.r !== bLast.to.r || aLast.to.c !== bLast.to.c) return false;
  
  return true;
}

/**
 * AI best move for player "me".
 * Uses iterative deepening for better performance and time management
 * depth: 5-8 is good for strong play
 */
export function aiBestMove(
  board: Board,
  me: Player,
  depth = 6,
  chainCaptureFrom: Pos | null = null
): MoveSequence | null {
  const moves = getAllLegalSequences(board, me, chainCaptureFrom);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const tt = new Map<bigint, TTEntry>();

  // Iterative deepening: start shallow and go deeper
  // This allows us to get a good move quickly and improve if time permits
  let bestMove: MoveSequence | null = null;
  let searchDepth = Math.max(3, depth - 2); // Start 2 levels shallower
  
  try {
    // Quick search first
    // We must manually iterate root moves because minimax assumes start of turn (null chainCaptureFrom)
    // but we might be in the middle of a chain capture.
    bestMove = findBestMoveRoot(board, moves, searchDepth, me, tt);
    
    // If we have time, search deeper
    if (depth > searchDepth) {
      const deepMove = findBestMoveRoot(board, moves, depth, me, tt);
      if (deepMove) bestMove = deepMove;
    }
  } catch (e) {
    // Fallback on error
    bestMove = moves[0];
  }

  return bestMove || moves[0];
}

function findBestMoveRoot(
  board: Board,
  moves: MoveSequence[],
  depth: number,
  me: Player,
  tt: Map<bigint, TTEntry>
): MoveSequence | null {
  let bestVal = -INF;
  let bestSeq: MoveSequence | null = null;
  const alpha = -INF;
  const beta = INF;

  // Check if we have a best move from previous iteration in TT
  const key = computeZobristHash(board, me);
  const ttEntry = tt.get(key);
  const ttBestSeq = ttEntry?.bestSeq;

  // Sort moves for better pruning
  const orderedMoves = orderMoves(board, moves, me, ttBestSeq);

  for (const seq of orderedMoves) {
    const b2 = cloneBoard(board);
    for (const m of seq.moves) {
      applyMove(b2, m, me);
    }
    
    // After my full turn, it's opponent's turn
    const res = minimax(b2, depth - 1, alpha, beta, otherPlayer(me), me, tt);
    
    if (res.value > bestVal) {
      bestVal = res.value;
      bestSeq = seq;
    }
  }
  return bestSeq;
}
