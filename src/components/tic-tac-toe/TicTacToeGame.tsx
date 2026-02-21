import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import "./TicTacToeGame.css";
import { addAchievement } from "../../services/achievementService";
import { auth } from "../../services/firebase";

type Player = "X" | "O";
type Cell = Player | null;
type Mode = "BOT" | "PVP";
type Difficulty = "EASY" | "MEDIUM" | "HARD";
type BoardSize = 3 | 5 | 7;

const BOARD_SETTINGS: Record<BoardSize, { winLength: number; label: string }> = {
  3: { winLength: 3, label: "3×3" },
  5: { winLength: 4, label: "5×5" },
  7: { winLength: 5, label: "7×7" },
};

const TTT_MEDAL_IDS: Record<BoardSize, string> = {
  3: "ttt_bot_master_3",
  5: "ttt_bot_master_5",
  7: "ttt_bot_master_7",
};

const DIRECTIONS = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

const WIN_SCORE = 1_000_000;
const LINE_CACHE = new Map<string, number[][]>();

function getWinningLines(size: number, winLength: number): number[][] {
  const cacheKey = `${size}x${size}-${winLength}`;
  const cached = LINE_CACHE.get(cacheKey);
  if (cached) return cached;

  const lines: number[][] = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      for (const { dr, dc } of DIRECTIONS) {
        const endRow = r + (winLength - 1) * dr;
        const endCol = c + (winLength - 1) * dc;
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;

        const line: number[] = [];
        for (let k = 0; k < winLength; k += 1) {
          line.push((r + k * dr) * size + (c + k * dc));
        }
        lines.push(line);
      }
    }
  }

  LINE_CACHE.set(cacheKey, lines);
  return lines;
}

function getGameResult(
  board: Cell[],
  size: number,
  winLength: number
): { winner: Player | "DRAW" | null; line: number[] | null } {
  const lines = getWinningLines(size, winLength);
  for (const line of lines) {
    const first = board[line[0]];
    if (!first) continue;

    let isWinningLine = true;
    for (let i = 1; i < line.length; i += 1) {
      if (board[line[i]] !== first) {
        isWinningLine = false;
        break;
      }
    }

    if (isWinningLine) {
      return { winner: first, line };
    }
  }

  return board.every((cell) => cell)
    ? { winner: "DRAW", line: null }
    : { winner: null, line: null };
}

function getEmptyCells(board: Cell[]): number[] {
  const empty: number[] = [];
  for (let i = 0; i < board.length; i += 1) {
    if (!board[i]) empty.push(i);
  }
  return empty;
}

function getRandomMove(board: Cell[]): number | null {
  const empty = getEmptyCells(board);
  if (empty.length === 0) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

function getImmediateMoves(
  board: Cell[],
  size: number,
  winLength: number,
  player: Player
): number[] {
  const immediate: number[] = [];
  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = player;
    if (getGameResult(next, size, winLength).winner === player) {
      immediate.push(i);
    }
  }
  return immediate;
}

function getImmediateMove(
  board: Cell[],
  size: number,
  winLength: number,
  player: Player
): number | null {
  const immediate = getImmediateMoves(board, size, winLength, player);
  return immediate.length > 0 ? immediate[0] : null;
}

function getCenterBias(index: number, size: number): number {
  const row = Math.floor(index / size);
  const col = index % size;
  const center = (size - 1) / 2;
  const distance = Math.abs(row - center) + Math.abs(col - center);
  return size - distance;
}

function getCandidateMoves(board: Cell[], size: number): number[] {
  if (size === 3) return getEmptyCells(board);

  const occupied: number[] = [];
  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) occupied.push(i);
  }

  if (occupied.length === 0) {
    const center = Math.floor(size / 2);
    return [center * size + center];
  }

  const candidateSet = new Set<number>();
  for (const idx of occupied) {
    const row = Math.floor(idx / size);
    const col = idx % size;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const nIdx = nr * size + nc;
        if (!board[nIdx]) candidateSet.add(nIdx);
      }
    }
  }

  if (candidateSet.size > 0) return [...candidateSet];
  return getEmptyCells(board);
}

function getLineWeight(stones: number, winLength: number): number {
  if (stones <= 0) return 0;
  if (stones >= winLength) return WIN_SCORE;
  if (stones === winLength - 1) return 12_000;
  return Math.pow(6, stones);
}

function evaluateBoard(board: Cell[], size: number, winLength: number): number {
  const lines = getWinningLines(size, winLength);
  let score = 0;
  let oThreats = 0;
  let xThreats = 0;

  for (const line of lines) {
    let oCount = 0;
    let xCount = 0;

    for (const idx of line) {
      if (board[idx] === "O") oCount += 1;
      if (board[idx] === "X") xCount += 1;
    }

    if (oCount > 0 && xCount > 0) continue;

    if (oCount > 0) {
      if (oCount === winLength - 1) oThreats += 1;
      score += getLineWeight(oCount, winLength);
      continue;
    }

    if (xCount > 0) {
      if (xCount === winLength - 1) xThreats += 1;
      score -= getLineWeight(xCount, winLength) * 1.08;
    }
  }

  for (let i = 0; i < board.length; i += 1) {
    if (!board[i]) continue;
    const centerBonus = getCenterBias(i, size) * 3;
    score += board[i] === "O" ? centerBonus : -centerBonus;
  }

  score += oThreats * 3_500;
  score -= xThreats * 4_000;
  return score;
}

function getForkMove(
  board: Cell[],
  size: number,
  winLength: number,
  player: Player
): number | null {
  const candidates = getCandidateMoves(board, size);
  let bestMove: number | null = null;
  let bestThreatCount = 1;

  for (const move of candidates) {
    if (board[move]) continue;
    const next = [...board];
    next[move] = player;
    const threats = getImmediateMoves(next, size, winLength, player).length;
    if (threats > bestThreatCount) {
      bestThreatCount = threats;
      bestMove = move;
    }
  }

  return bestMove;
}

function getSearchDepth(size: number, emptyCells: number): number {
  if (size === 3) return emptyCells;
  if (size === 5) {
    if (emptyCells > 18) return 2;
    if (emptyCells > 10) return 3;
    return 4;
  }
  if (emptyCells > 32) return 2;
  if (emptyCells > 18) return 3;
  return 4;
}

function getMoveCap(size: number, depthRemaining: number): number {
  if (size === 3) return 9;
  if (size === 5) {
    if (depthRemaining >= 3) return 10;
    return 14;
  }
  if (depthRemaining >= 3) return 8;
  if (depthRemaining === 2) return 10;
  return 14;
}

function getOrderedMoves(
  board: Cell[],
  size: number,
  winLength: number,
  isMaximizing: boolean,
  depthRemaining: number
): number[] {
  const player: Player = isMaximizing ? "O" : "X";
  const opponent: Player = player === "O" ? "X" : "O";
  const tactical = getImmediateMoves(board, size, winLength, player);
  if (tactical.length > 0) return tactical;

  const mustBlock = getImmediateMoves(board, size, winLength, opponent);
  if (mustBlock.length > 0) return mustBlock;

  const moves = getCandidateMoves(board, size);
  const scored = moves
    .filter((move) => !board[move])
    .map((move) => {
      const next = [...board];
      next[move] = player;

      const result = getGameResult(next, size, winLength).winner;
      const immediateWin = result === player ? WIN_SCORE : 0;
      const evalScore = evaluateBoard(next, size, winLength);
      const centerBias = getCenterBias(move, size) * 2;
      const base = immediateWin + evalScore + centerBias;

      return {
        move,
        score: isMaximizing ? base : -base,
      };
    })
    .sort((a, b) => b.score - a.score);

  const cap = getMoveCap(size, depthRemaining);
  return scored.slice(0, cap).map((entry) => entry.move);
}

function boardKey(board: Cell[], isMaximizing: boolean): string {
  const turn = isMaximizing ? "O" : "X";
  let key = turn;
  for (let i = 0; i < board.length; i += 1) {
    key += board[i] ?? ".";
  }
  return key;
}

function minimaxAlphaBeta(
  board: Cell[],
  size: number,
  winLength: number,
  depthRemaining: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  transposition: Map<string, { depth: number; score: number }>
): number {
  const terminal = getGameResult(board, size, winLength).winner;
  if (terminal === "O") return WIN_SCORE + depthRemaining;
  if (terminal === "X") return -WIN_SCORE - depthRemaining;
  if (terminal === "DRAW") return 0;
  if (depthRemaining === 0) return evaluateBoard(board, size, winLength);

  const key = boardKey(board, isMaximizing);
  const cached = transposition.get(key);
  if (cached && cached.depth >= depthRemaining) return cached.score;

  const orderedMoves = getOrderedMoves(board, size, winLength, isMaximizing, depthRemaining);
  if (orderedMoves.length === 0) return evaluateBoard(board, size, winLength);

  let best = isMaximizing ? -Infinity : Infinity;
  const player: Player = isMaximizing ? "O" : "X";

  for (const move of orderedMoves) {
    if (board[move]) continue;
    const next = [...board];
    next[move] = player;

    const value = minimaxAlphaBeta(
      next,
      size,
      winLength,
      depthRemaining - 1,
      alpha,
      beta,
      !isMaximizing,
      transposition
    );

    if (isMaximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }

    if (beta <= alpha) break;
  }

  transposition.set(key, { depth: depthRemaining, score: best });
  return best;
}

function getStrategicMove(board: Cell[], size: number, winLength: number): number | null {
  const emptyCells = getEmptyCells(board).length;
  if (emptyCells === 0) return null;

  const depth = getSearchDepth(size, emptyCells);
  const transposition = new Map<string, { depth: number; score: number }>();
  const rootMoves = getOrderedMoves(board, size, winLength, true, depth);

  let bestScore = -Infinity;
  let bestMoves: number[] = [];
  for (const move of rootMoves) {
    if (board[move]) continue;
    const next = [...board];
    next[move] = "O";

    const score = minimaxAlphaBeta(
      next,
      size,
      winLength,
      depth - 1,
      -Infinity,
      Infinity,
      false,
      transposition
    );

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
      continue;
    }
    if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  if (bestMoves.length === 0) return getRandomMove(board);
  bestMoves.sort((a, b) => getCenterBias(b, size) - getCenterBias(a, size));
  const topMoves = bestMoves.slice(0, Math.min(2, bestMoves.length));
  return topMoves[Math.floor(Math.random() * topMoves.length)];
}

function getHeuristicMove(board: Cell[], size: number, winLength: number): number | null {
  const winMove = getImmediateMove(board, size, winLength, "O");
  if (winMove !== null) return winMove;

  const blockMove = getImmediateMove(board, size, winLength, "X");
  if (blockMove !== null) return blockMove;

  const attackFork = getForkMove(board, size, winLength, "O");
  if (attackFork !== null) return attackFork;

  const defendFork = getForkMove(board, size, winLength, "X");
  if (defendFork !== null) return defendFork;

  const candidates = getCandidateMoves(board, size);
  if (candidates.length === 0) return null;

  const scored = candidates
    .filter((move) => !board[move])
    .map((move) => {
      const next = [...board];
      next[move] = "O";
      return {
        move,
        score: evaluateBoard(next, size, winLength) + getCenterBias(move, size),
      };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return getRandomMove(board);
  const choicePool = scored.slice(0, Math.min(3, scored.length));
  return choicePool[Math.floor(Math.random() * choicePool.length)].move;
}

function getHardMove(board: Cell[], size: number, winLength: number): number | null {
  const immediateWin = getImmediateMove(board, size, winLength, "O");
  if (immediateWin !== null) return immediateWin;

  const immediateBlock = getImmediateMove(board, size, winLength, "X");
  if (immediateBlock !== null) return immediateBlock;

  const forkAttack = getForkMove(board, size, winLength, "O");
  if (forkAttack !== null) return forkAttack;

  const forkDefense = getForkMove(board, size, winLength, "X");
  if (forkDefense !== null) return forkDefense;

  return getStrategicMove(board, size, winLength);
}

function getHeuristicPlusMove(board: Cell[], size: number, winLength: number): number | null {
  const candidates = getCandidateMoves(board, size);
  if (candidates.length === 0) return getRandomMove(board);

  const scored = candidates
    .filter((move) => !board[move])
    .map((move) => {
      const next = [...board];
      next[move] = "O";
      return {
        move,
        score: evaluateBoard(next, size, winLength) + getCenterBias(move, size) * 2,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return getRandomMove(board);
  const choicePool = scored.slice(0, Math.min(4, scored.length));
  return choicePool[Math.floor(Math.random() * choicePool.length)].move;
}

function getBotMove(
  board: Cell[],
  size: number,
  winLength: number,
  difficulty: Difficulty
): number | null {
  if (difficulty === "EASY") return getRandomMove(board);

  if (difficulty === "HARD") {
    return getHardMove(board, size, winLength);
  }

  return getHeuristicMove(board, size, winLength) ?? getHeuristicPlusMove(board, size, winLength);
}

// ── Ghost Mark (hover preview) ──────────────────────────────────────────────
function GhostMark({ player }: { player: Player }) {
  if (player === "X") {
    return (
      <svg className="ttt__ghost ttt__ghost--x" viewBox="0 0 100 100" aria-hidden="true">
        <line x1="20" y1="20" x2="80" y2="80" />
        <line x1="80" y1="20" x2="20" y2="80" />
      </svg>
    );
  }
  return (
    <svg className="ttt__ghost ttt__ghost--o" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="28" />
    </svg>
  );
}

export default function TicTacToeGame() {
  const [mode, setMode] = useState<Mode>("BOT");
  const [difficulty, setDifficulty] = useState<Difficulty>("MEDIUM");
  const [boardSize, setBoardSize] = useState<BoardSize>(3);
  const winLength = useMemo(() => BOARD_SETTINGS[boardSize].winLength, [boardSize]);
  const [board, setBoard] = useState<Cell[]>(
    () => Array(boardSize * boardSize).fill(null)
  );
  const [xIsNext, setXIsNext] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [moveCount, setMoveCount] = useState(0);

  const result = useMemo(
    () => getGameResult(board, boardSize, winLength),
    [board, boardSize, winLength]
  );
  const winner = result.winner;
  const winningLine = result.line;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [lineCoords, setLineCoords] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [stats, setStats] = useState({ x: 0, o: 0, draws: 0 });
  const [lastWinner, setLastWinner] = useState<Player | "DRAW" | null>(null);

  const currentPlayer: Player = xIsNext ? "X" : "O";
  const isBotTurn = mode === "BOT" && !xIsNext && !winner;

  useEffect(() => {
    if (mode !== "BOT") return;
    if (winner) return;
    if (!xIsNext) {
      setIsThinking(true);
      const move = getBotMove(board, boardSize, winLength, difficulty);
      if (move === null) {
        setIsThinking(false);
        return;
      }
      const timer = window.setTimeout(() => {
        setBoard((prev) => {
          if (prev[move] || getGameResult(prev, boardSize, winLength).winner) return prev;
          const next = [...prev];
          next[move] = "O";
          return next;
        });
        setXIsNext(true);
        setIsThinking(false);
        setMoveCount((c) => c + 1);
      }, 450);
      return () => {
        window.clearTimeout(timer);
        setIsThinking(false);
      };
    }
  }, [board, boardSize, difficulty, mode, winLength, winner, xIsNext]);

  useLayoutEffect(() => {
    const compute = () => {
      if (!winningLine) {
        setLineCoords(null);
        return;
      }

      const boardEl = boardRef.current;
      const startEl = cellRefs.current[winningLine[0]];
      const endEl = cellRefs.current[winningLine[winningLine.length - 1]];

      if (!boardEl || !startEl || !endEl) {
        setLineCoords(null);
        return;
      }

      const boardRect = boardEl.getBoundingClientRect();
      const startRect = startEl.getBoundingClientRect();
      const endRect = endEl.getBoundingClientRect();

      const toPercent = (rect: DOMRect) => ({
        x: ((rect.left + rect.width / 2 - boardRect.left) / boardRect.width) * 100,
        y: ((rect.top + rect.height / 2 - boardRect.top) / boardRect.height) * 100,
      });

      const start = toPercent(startRect);
      const end = toPercent(endRect);

      setLineCoords({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
      });
    };

    compute();

    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [board, boardSize, winningLine]);

  useEffect(() => {
    if (!winner || winner === lastWinner) return;
    setLastWinner(winner);
    if (winner === "DRAW") {
      setStats((prev) => ({ ...prev, draws: prev.draws + 1 }));
      return;
    }
    if (winner === "X") {
      setStats((prev) => ({ ...prev, x: prev.x + 1 }));
    } else {
      setStats((prev) => ({ ...prev, o: prev.o + 1 }));
    }

    if (mode !== "BOT" || difficulty !== "HARD" || winner !== "X") return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const medalId = TTT_MEDAL_IDS[boardSize];
    addAchievement(uid, medalId).catch((err) => {
      console.warn("tic-tac-toe medal grant failed:", err);
    });
  }, [boardSize, difficulty, lastWinner, mode, winner]);

  const handleCellClick = useCallback((index: number) => {
    if (winner) return;
    if (board[index]) return;
    if (mode === "BOT" && !xIsNext) return;

    const next = [...board];
    next[index] = currentPlayer;
    setBoard(next);
    setXIsNext(!xIsNext);
    setMoveCount((c) => c + 1);
  }, [winner, board, mode, xIsNext, currentPlayer]);

  function resetGame(nextSize: number = boardSize) {
    setBoard(Array(nextSize * nextSize).fill(null));
    setXIsNext(true);
    setLastWinner(null);
    setMoveCount(0);
    setHoveredCell(null);
    setIsThinking(false);
  }

  function changeBoardSize(nextSize: BoardSize) {
    setBoardSize(nextSize);
    resetGame(nextSize);
    setStats({ x: 0, o: 0, draws: 0 });
  }

  function renderMark(cell: Cell) {
    if (!cell) return null;
    if (cell === "X") {
      return (
        <svg
          className="ttt__mark ttt__mark--x"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <line className="ttt__mark-line ttt__mark-line--a" x1="20" y1="20" x2="80" y2="80" />
          <line className="ttt__mark-line ttt__mark-line--b" x1="80" y1="20" x2="20" y2="80" />
        </svg>
      );
    }
    return (
      <svg
        className="ttt__mark ttt__mark--o"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <circle className="ttt__mark-circle" cx="50" cy="50" r="28" />
      </svg>
    );
  }

  const difficultyLabel =
    difficulty === "EASY" ? "קל" : difficulty === "MEDIUM" ? "בינוני" : "קשה";

  const boardStyle = useMemo<CSSProperties>(() => {
    const gap = boardSize === 3 ? "0.6rem" : boardSize === 5 ? "0.45rem" : "0.35rem";
    const padding = boardSize === 3 ? "1.1rem" : boardSize === 5 ? "0.85rem" : "0.65rem";
    const width = boardSize === 3 ? "min(24rem, 90vw)" : boardSize === 5 ? "min(31rem, 92vw)" : "min(36rem, 94vw)";
    const markScale = boardSize === 3 ? "1" : boardSize === 5 ? "0.85" : "0.7";
    const winLineWidth = boardSize === 7 ? "2.4" : boardSize === 5 ? "3" : "3.5";

    return {
      gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
      gap,
      padding,
      width,
      ["--mark-scale" as any]: markScale,
      ["--win-line-width" as any]: winLineWidth,
    };
  }, [boardSize]);

  const medalLabel =
    boardSize === 3
      ? "מדליית בוט־סלייר 3×3"
      : boardSize === 5
        ? "מדליית בוט־סלייר 5×5"
        : "מדליית בוט־סלייר 7×7";

  const medalSubtitle =
    boardSize === 3
      ? "ניצחת את הבוט הקשה בלוח 3×3."
      : boardSize === 5
        ? `ניצחת את הבוט הקשה בלוח 5×5 (${winLength} ברצף).`
        : `ניצחת את הבוט הקשה בלוח 7×7 (${winLength} ברצף).`;

  // Build status message
  let statusText: string;
  if (winner) {
    statusText = winner === "DRAW" ? "תיקו! 🤝" : `${winner} ניצח! 🎉`;
  } else if (isThinking) {
    statusText = "הבוט חושב...";
  } else if (mode === "BOT") {
    statusText = `התור שלך (X) · ${difficultyLabel} · ${winLength} ברצף`;
  } else {
    statusText = `תור: ${currentPlayer} · יעד: ${winLength} ברצף`;
  }

  const canInteract = !winner && !isBotTurn;

  return (
    <section className={`ttt ${winner ? "has-result" : ""} ${isThinking ? "is-thinking" : ""}`}>
      <div className="ttt__aura" aria-hidden="true" />

      {/* ── Header Controls ── */}
      <header className="ttt__header">
        <div className="ttt__controls">
          <button
            className={mode === "BOT" ? "is-active" : ""}
            onClick={() => { setMode("BOT"); resetGame(); }}
          >
            🤖 נגד בוט
          </button>
          <button
            className={mode === "PVP" ? "is-active" : ""}
            onClick={() => { setMode("PVP"); resetGame(); }}
          >
            👥 שני שחקנים
          </button>
          <button className="ttt__reset" onClick={() => resetGame()} title="משחק חדש">
            ↺ איפוס
          </button>
        </div>

        {mode === "BOT" && (
          <div className="ttt__difficulty">
            {(["EASY", "MEDIUM", "HARD"] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={difficulty === d ? "is-active" : ""}
                onClick={() => { setDifficulty(d); resetGame(); }}
              >
                {d === "EASY" ? "קל" : d === "MEDIUM" ? "בינוני" : "קשה"}
              </button>
            ))}
          </div>
        )}

        <div className="ttt__size">
          {([3, 5, 7] as BoardSize[]).map((s) => (
            <button
              key={s}
              className={boardSize === s ? "is-active" : ""}
              onClick={() => changeBoardSize(s)}
            >
              {BOARD_SETTINGS[s].label}
              <span className="ttt__size-hint">יעד {BOARD_SETTINGS[s].winLength}</span>
            </button>
          ))}
        </div>
      </header>

      {/* ── Turn Indicator + Status ── */}
      <div className="ttt__turn-row">
        <div className={`ttt__player-chip ttt__player-chip--x ${xIsNext && !winner && !isThinking ? "is-active" : ""}`}>
          <svg className="ttt__chip-mark ttt__chip-mark--x" viewBox="0 0 100 100" aria-hidden="true">
            <line x1="20" y1="20" x2="80" y2="80" />
            <line x1="80" y1="20" x2="20" y2="80" />
          </svg>
          <span>{stats.x}</span>
        </div>

        <div className="ttt__status" aria-live="polite" aria-atomic="true">
          {isThinking ? (
            <span className="ttt__thinking-dots">
              <span>●</span><span>●</span><span>●</span>
            </span>
          ) : (
            statusText
          )}
        </div>

        <div className={`ttt__player-chip ttt__player-chip--o ${!xIsNext && !winner ? "is-active" : ""}`}>
          <svg className="ttt__chip-mark ttt__chip-mark--o" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="28" />
          </svg>
          <span>{stats.o}</span>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div className="ttt__stats">
        <div className="ttt__stat">
          <span className="ttt__stat-badge ttt__stat-badge--x">X</span>
          <strong>{stats.x}</strong>
          <small>נצחונות X</small>
        </div>
        <div className="ttt__stat ttt__stat--draws">
          <span className="ttt__stat-badge">=</span>
          <strong>{stats.draws}</strong>
          <small>תיקו</small>
        </div>
        <div className="ttt__stat">
          <span className="ttt__stat-badge ttt__stat-badge--o">O</span>
          <strong>{stats.o}</strong>
          <small>נצחונות O</small>
        </div>
      </div>

      {/* ── Medal ── */}
      {mode === "BOT" && difficulty === "HARD" && winner === "X" && (
        <div className="ttt__medal" role="status" aria-live="polite">
          <span className="ttt__medal-icon">★</span>
          <div>
            <div className="ttt__medal-title">{medalLabel}</div>
            <div className="ttt__medal-subtitle">{medalSubtitle}</div>
          </div>
        </div>
      )}

      {/* ── Board ── */}
      <div
        className="ttt__board"
        role="grid"
        aria-label="Tic Tac Toe board"
        ref={boardRef}
        style={boardStyle}
      >
        {lineCoords && winner && winner !== "DRAW" && (
          <svg
            className={`ttt__win-line ${winner === "X" ? "is-x" : "is-o"}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1={lineCoords.x1}
              y1={lineCoords.y1}
              x2={lineCoords.x2}
              y2={lineCoords.y2}
            />
          </svg>
        )}
        {board.map((cell, index) => {
          const isWinning = winningLine?.includes(index) ?? false;
          const winIdx = winningLine ? winningLine.indexOf(index) : -1;
          const showGhost = !cell && hoveredCell === index && canInteract;

          return (
            <button
              key={index}
              className={`ttt__cell ${cell ? "is-filled" : ""} ${isWinning ? "is-winning" : ""} ${showGhost ? "is-hovered" : ""}`}
              style={isWinning ? { "--win-delay": `${winIdx * 60}ms` } as CSSProperties : undefined}
              onClick={() => handleCellClick(index)}
              onMouseEnter={() => !cell && canInteract && setHoveredCell(index)}
              onMouseLeave={() => setHoveredCell(null)}
              disabled={!!cell || !!winner || isBotTurn}
              aria-label={
                cell
                  ? `תא ${index + 1}: ${cell}`
                  : isWinning
                    ? `תא ${index + 1}: מנצח`
                    : `תא ${index + 1}: ריק`
              }
              ref={(el) => {
                cellRefs.current[index] = el;
              }}
            >
              {renderMark(cell)}
              {showGhost && <GhostMark player={currentPlayer} />}
            </button>
          );
        })}
      </div>

      {/* ── Game-over overlay prompt ── */}
      {winner && (
        <button
          className="ttt__play-again"
          onClick={() => resetGame()}
          aria-label="משחק חדש"
        >
          ↺ משחק חדש
        </button>
      )}

      {/* ── Move counter ── */}
      {moveCount > 0 && !winner && (
        <div className="ttt__move-count" aria-label={`מהלך ${moveCount}`}>
          מהלך {moveCount}
        </div>
      )}
    </section>
  );
}