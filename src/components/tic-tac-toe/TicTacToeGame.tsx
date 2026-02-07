import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  3: { winLength: 3, label: "3×3 · יעד 3" },
  5: { winLength: 4, label: "5×5 · יעד 4" },
  7: { winLength: 5, label: "7×7 · יעד 5" },
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

function getGameResult(
  board: Cell[],
  size: number,
  winLength: number
): { winner: Player | "DRAW" | null; line: number[] | null } {
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const startIdx = r * size + c;
      const player = board[startIdx];
      if (!player) continue;

      for (const { dr, dc } of DIRECTIONS) {
        const endRow = r + (winLength - 1) * dr;
        const endCol = c + (winLength - 1) * dc;
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;

        const line: number[] = [startIdx];
        let valid = true;
        for (let k = 1; k < winLength; k += 1) {
          const idx = (r + k * dr) * size + (c + k * dc);
          if (board[idx] !== player) {
            valid = false;
            break;
          }
          line.push(idx);
        }
        if (valid) {
          return { winner: player, line };
        }
      }
    }
  }

  return board.every((cell) => cell)
    ? { winner: "DRAW", line: null }
    : { winner: null, line: null };
}

function getRandomMove(board: Cell[]): number | null {
  const empty = board
    .map((cell, idx) => (cell ? null : idx))
    .filter((idx): idx is number => idx !== null);
  if (empty.length === 0) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

function getImmediateMove(
  board: Cell[],
  size: number,
  winLength: number,
  player: Player
): number | null {
  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = player;
    if (getGameResult(next, size, winLength).winner === player) return i;
  }
  return null;
}

function getHeuristicMove(board: Cell[], size: number, winLength: number): number | null {
  const winMove = getImmediateMove(board, size, winLength, "O");
  if (winMove !== null) return winMove;

  const blockMove = getImmediateMove(board, size, winLength, "X");
  if (blockMove !== null) return blockMove;

  const center = Math.floor(size / 2);
  const centerIdx = center * size + center;
  if (!board[centerIdx]) return centerIdx;

  const corners = [0, size - 1, size * (size - 1), size * size - 1].filter(
    (idx) => !board[idx]
  );
  if (corners.length > 0) {
    return corners[Math.floor(Math.random() * corners.length)];
  }

  return getRandomMove(board);
}

function getBestMove(board: Cell[]): number | null {
  let bestScore = -Infinity;
  let bestMove: number | null = null;

  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = "O";
    const score = minimax(next, 0, false);
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }

  return bestMove;
}

function minimax(board: Cell[], depth: number, isMaximizing: boolean): number {
  const result = getGameResult(board, 3, 3).winner;
  if (result === "O") return 10 - depth;
  if (result === "X") return depth - 10;
  if (result === "DRAW") return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < board.length; i += 1) {
      if (board[i]) continue;
      const next = [...board];
      next[i] = "O";
      best = Math.max(best, minimax(next, depth + 1, false));
    }
    return best;
  }

  let best = Infinity;
  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = "X";
    best = Math.min(best, minimax(next, depth + 1, true));
  }
  return best;
}

function scorePotential(board: Cell[], size: number, winLength: number, player: Player) {
  const opponent: Player = player === "X" ? "O" : "X";
  let score = 0;

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      for (const { dr, dc } of DIRECTIONS) {
        const endRow = r + (winLength - 1) * dr;
        const endCol = c + (winLength - 1) * dc;
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;

        let playerCount = 0;
        let opponentCount = 0;
        for (let k = 0; k < winLength; k += 1) {
          const idx = (r + k * dr) * size + (c + k * dc);
          if (board[idx] === player) playerCount += 1;
          if (board[idx] === opponent) opponentCount += 1;
        }
        if (opponentCount === 0) {
          score += 1 + playerCount * playerCount;
        }
      }
    }
  }

  return score;
}

function getHeuristicPlusMove(board: Cell[], size: number, winLength: number): number | null {
  let bestScore = -Infinity;
  let bestMove: number | null = null;

  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = "O";
    const score =
      scorePotential(next, size, winLength, "O") -
      scorePotential(next, size, winLength, "X") * 0.6;
    if (score > bestScore) {
      bestScore = score;
      bestMove = i;
    }
  }

  return bestMove ?? getRandomMove(board);
}

function getBotMove(
  board: Cell[],
  size: number,
  winLength: number,
  difficulty: Difficulty
): number | null {
  if (difficulty === "EASY") return getRandomMove(board);

  if (size === 3 && difficulty === "HARD") {
    return getBestMove(board);
  }

  if (difficulty === "HARD") {
    const winMove = getImmediateMove(board, size, winLength, "O");
    if (winMove !== null) return winMove;
    const blockMove = getImmediateMove(board, size, winLength, "X");
    if (blockMove !== null) return blockMove;
    return getHeuristicPlusMove(board, size, winLength);
  }

  return getHeuristicMove(board, size, winLength);
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

  useEffect(() => {
    if (mode !== "BOT") return;
    if (winner) return;
    if (!xIsNext) {
      const move = getBotMove(board, boardSize, winLength, difficulty);
      if (move === null) return;
      const timer = window.setTimeout(() => {
        setBoard((prev) => {
          if (prev[move] || getGameResult(prev, boardSize, winLength).winner) return prev;
          const next = [...prev];
          next[move] = "O";
          return next;
        });
        setXIsNext(true);
      }, 250);
      return () => window.clearTimeout(timer);
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
    addAchievement(uid, medalId).catch(() => {});
  }, [boardSize, difficulty, lastWinner, mode, winner]);

  function handleCellClick(index: number) {
    if (winner) return;
    if (board[index]) return;
    if (mode === "BOT" && !xIsNext) return;

    const next = [...board];
    next[index] = currentPlayer;
    setBoard(next);
    setXIsNext(!xIsNext);
  }

  function resetGame(nextSize: number = boardSize) {
    setBoard(Array(nextSize * nextSize).fill(null));
    setXIsNext(true);
    setLastWinner(null);
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
    const gap = boardSize === 3 ? "0.65rem" : boardSize === 5 ? "0.5rem" : "0.4rem";
    const padding = boardSize === 3 ? "1.2rem" : boardSize === 5 ? "0.9rem" : "0.7rem";
    const width = boardSize === 3 ? "min(26rem, 90vw)" : boardSize === 5 ? "min(32rem, 92vw)" : "min(36rem, 94vw)";
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

  const status = winner
    ? winner === "DRAW"
      ? "תיקו!"
      : `המנצח: ${winner}`
    : mode === "BOT"
      ? xIsNext
        ? `התור שלך (X) · רמה: ${difficultyLabel} · יעד: ${winLength} ברצף`
        : "הבוט חושב..."
      : `תור: ${currentPlayer} · יעד: ${winLength} ברצף`;

  return (
    <section className={`ttt ${winner ? "has-result" : ""}`}>
      <div className="ttt__aura" aria-hidden="true" />
      <header className="ttt__header">
        <div className="ttt__controls">
          <button
            className={mode === "BOT" ? "is-active" : ""}
            onClick={() => {
              setMode("BOT");
              resetGame();
            }}
          >
            נגד בוט
          </button>
          <button
            className={mode === "PVP" ? "is-active" : ""}
            onClick={() => {
              setMode("PVP");
              resetGame();
            }}
          >
            שני שחקנים
          </button>
        </div>
        {mode === "BOT" && (
          <div className="ttt__difficulty">
            <button
              className={difficulty === "EASY" ? "is-active" : ""}
              onClick={() => {
                setDifficulty("EASY");
                resetGame();
              }}
            >
              קל
            </button>
            <button
              className={difficulty === "MEDIUM" ? "is-active" : ""}
              onClick={() => {
                setDifficulty("MEDIUM");
                resetGame();
              }}
            >
              בינוני
            </button>
            <button
              className={difficulty === "HARD" ? "is-active" : ""}
              onClick={() => {
                setDifficulty("HARD");
                resetGame();
              }}
            >
              קשה
            </button>
          </div>
        )}
        <div className="ttt__size">
          <button
            className={boardSize === 3 ? "is-active" : ""}
            onClick={() => changeBoardSize(3)}
          >
            {BOARD_SETTINGS[3].label}
          </button>
          <button
            className={boardSize === 5 ? "is-active" : ""}
            onClick={() => changeBoardSize(5)}
          >
            {BOARD_SETTINGS[5].label}
          </button>
          <button
            className={boardSize === 7 ? "is-active" : ""}
            onClick={() => changeBoardSize(7)}
          >
            {BOARD_SETTINGS[7].label}
          </button>
        </div>
      </header>

      <div className="ttt__status">{status}</div>

      <div className="ttt__stats">
        <div className="ttt__stat">
          <span className="ttt__stat-badge ttt__stat-badge--x">X</span>
          <strong>{stats.x}</strong>
          <small>נצחונות X</small>
        </div>
        <div className="ttt__stat">
          <span className="ttt__stat-badge ttt__stat-badge--o">O</span>
          <strong>{stats.o}</strong>
          <small>נצחונות O</small>
        </div>
        <div className="ttt__stat">
          <span className="ttt__stat-badge">=</span>
          <strong>{stats.draws}</strong>
          <small>תיקו</small>
        </div>
      </div>

      {mode === "BOT" && difficulty === "HARD" && winner === "X" && (
        <div className="ttt__medal" role="status" aria-live="polite">
          <span className="ttt__medal-icon">★</span>
          <div>
            <div className="ttt__medal-title">{medalLabel}</div>
            <div className="ttt__medal-subtitle">{medalSubtitle}</div>
          </div>
        </div>
      )}

      <div
        className="ttt__board"
        role="grid"
        aria-label="Tic Tac Toe"
        ref={boardRef}
        onClick={() => {
          if (winner) resetGame();
        }}
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
        {board.map((cell, index) => (
          <button
            key={index}
            className={`ttt__cell ${cell ? "is-filled" : ""} ${
              winningLine?.includes(index) ? "is-winning" : ""
            }`}
            onClick={() => handleCellClick(index)}
            aria-label={`cell-${index}`}
            ref={(el) => {
              cellRefs.current[index] = el;
            }}
          >
            {renderMark(cell)}
          </button>
        ))}
      </div>
    </section>
  );
}
