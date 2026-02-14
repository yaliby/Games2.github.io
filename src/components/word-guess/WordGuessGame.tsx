import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import "./WordGuessGame.css";
import { ANSWER_WORDS, VALID_GUESS_SET, WORD_LENGTH } from "./word-list";
import { auth, db } from "../../services/firebase";
import { checkWeeklyReset } from "../../services/resetService";
import { submitWordGuessScore } from "../../services/scoreService";
import UserBox from "../UserBox/UserBox";

type LetterState = "correct" | "present" | "absent";
type StatusTone = "default" | "error" | "success";

const MAX_GUESSES = 6;
const WORD_GUESS_SAVE_KEY = "gameshub:word-guess:state:v1";
const WORD_GUESS_SAVE_VERSION = 1;
const REVEAL_STEP_DELAY_MS = 180;
const FLIP_TOTAL_MS = 600;
const REVEAL_COLOR_DELAY_MS = Math.floor(FLIP_TOTAL_MS / 2);

const KEYBOARD_LAYOUT = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["enter", "z", "x", "c", "v", "b", "n", "m", "backspace"],
];

const STATE_PRIORITY: Record<LetterState, number> = {
  absent: 1,
  present: 2,
  correct: 3,
};

type WordGuessSnapshot = {
  v: number;
  secretWord: string;
  board: string[][];
  tileStates: Array<Array<LetterState | null>>;
  tileRevealMask: boolean[][];
  currentRow: number;
  currentCol: number;
  isGameOver: boolean;
  roundResult: "WIN" | "LOSE" | null;
  streak: number;
  keyStates: Record<string, LetterState>;
  status: { message: string; tone: StatusTone };
};

function pickRandomWord() {
  const index = Math.floor(Math.random() * ANSWER_WORDS.length);
  return ANSWER_WORDS[index];
}

function createEmptyBoard(length: number) {
  return Array.from({ length: MAX_GUESSES }, () => Array(length).fill(""));
}

function createEmptyStates(length: number) {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array(length).fill(null as LetterState | null)
  );
}

function createEmptyRevealMask(length: number) {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array(length).fill(false)
  );
}

function isLetterState(value: unknown): value is LetterState {
  return value === "correct" || value === "present" || value === "absent";
}

function isStatusTone(value: unknown): value is StatusTone {
  return value === "default" || value === "error" || value === "success";
}

function normalizeBoard(value: unknown) {
  if (!Array.isArray(value) || value.length !== MAX_GUESSES) return null;

  const board: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== WORD_LENGTH) return null;
    const normalizedRow = row.map((cell) => {
      if (typeof cell !== "string") return "";
      const next = cell.toLowerCase();
      return /^[a-z]$/.test(next) ? next : "";
    });
    board.push(normalizedRow);
  }
  return board;
}

function normalizeTileStates(value: unknown) {
  if (!Array.isArray(value) || value.length !== MAX_GUESSES) return null;

  const rows: Array<Array<LetterState | null>> = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== WORD_LENGTH) return null;
    const normalized = row.map((cell) => (isLetterState(cell) ? cell : null));
    rows.push(normalized);
  }
  return rows;
}

function normalizeRevealMask(value: unknown) {
  if (!Array.isArray(value) || value.length !== MAX_GUESSES) return null;

  const rows: boolean[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== WORD_LENGTH) return null;
    rows.push(row.map((cell) => Boolean(cell)));
  }
  return rows;
}

function evaluateGuess(guess: string, secret: string, length: number) {
  const result = Array(length).fill("absent") as LetterState[];
  const secretLetters = secret.split("");

  for (let i = 0; i < length; i += 1) {
    if (guess[i] === secretLetters[i]) {
      result[i] = "correct";
      secretLetters[i] = "";
    }
  }

  for (let i = 0; i < length; i += 1) {
    if (result[i] !== "absent") continue;
    const matchIndex = secretLetters.indexOf(guess[i]);
    if (matchIndex !== -1) {
      result[i] = "present";
      secretLetters[matchIndex] = "";
    }
  }

  return result;
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return true;
  return el.isContentEditable;
}

function parseWordGuessSnapshot(raw: string): WordGuessSnapshot | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed as Partial<WordGuessSnapshot>;
  const version = Number(source.v ?? 0);
  if (!Number.isFinite(version) || Math.floor(version) !== WORD_GUESS_SAVE_VERSION) return null;

  if (typeof source.secretWord !== "string") return null;
  const secretWord = source.secretWord.toLowerCase();
  if (secretWord.length !== WORD_LENGTH || !ANSWER_WORDS.includes(secretWord)) return null;

  const board = normalizeBoard(source.board);
  const tileStates = normalizeTileStates(source.tileStates);
  const tileRevealMask = normalizeRevealMask(source.tileRevealMask);
  if (!board || !tileStates || !tileRevealMask) return null;

  const currentRow = Math.max(0, Math.min(MAX_GUESSES - 1, Number(source.currentRow ?? 0) | 0));
  const currentCol = Math.max(0, Math.min(WORD_LENGTH, Number(source.currentCol ?? 0) | 0));
  const streak = Math.max(0, Number(source.streak ?? 0) | 0);

  const roundResult =
    source.roundResult === "WIN" || source.roundResult === "LOSE" ? source.roundResult : null;

  const keyStatesSource = source.keyStates && typeof source.keyStates === "object"
    ? source.keyStates
    : {};
  const keyStates: Record<string, LetterState> = {};
  for (const [key, value] of Object.entries(keyStatesSource)) {
    if (/^[a-z]$/.test(key) && isLetterState(value)) {
      keyStates[key] = value;
    }
  }

  const statusSource = source.status && typeof source.status === "object"
    ? source.status
    : {};
  const statusMessage = typeof (statusSource as any).message === "string"
    ? (statusSource as any).message
    : `Guess the ${WORD_LENGTH}-letter word in 6 tries.`;
  const statusTone = isStatusTone((statusSource as any).tone)
    ? (statusSource as any).tone
    : "default";

  return {
    v: WORD_GUESS_SAVE_VERSION,
    secretWord,
    board,
    tileStates,
    tileRevealMask,
    currentRow,
    currentCol,
    isGameOver: Boolean(source.isGameOver),
    roundResult,
    streak,
    keyStates,
    status: {
      message: statusMessage,
      tone: statusTone,
    },
  };
}

export default function WordGuessGame() {
  const [secretWord, setSecretWord] = useState(() => pickRandomWord());
  const [board, setBoard] = useState(() => createEmptyBoard(WORD_LENGTH));
  const [tileStates, setTileStates] = useState(() => createEmptyStates(WORD_LENGTH));
  const [tileRevealMask, setTileRevealMask] = useState(() => createEmptyRevealMask(WORD_LENGTH));
  const [currentRow, setCurrentRow] = useState(0);
  const [currentCol, setCurrentCol] = useState(0);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [roundResult, setRoundResult] = useState<"WIN" | "LOSE" | null>(null);
  const [streak, setStreak] = useState(0);
  const [currentSeasonId, setCurrentSeasonId] = useState<number | null>(null);
  const [bestScoreUI, setBestScoreUI] = useState(0);
  const [leaderboard, setLeaderboard] = useState<Array<{ uid: string; score: number }>>([]);
  const [previousSeasonWinners, setPreviousSeasonWinners] = useState<
    Array<{ uid: string; score: number }>
  >([]);
  const [keyStates, setKeyStates] = useState<Record<string, LetterState>>({});
  const [status, setStatus] = useState({
    message: `Guess the ${WORD_LENGTH}-letter word in 6 tries.`,
    tone: "default" as StatusTone,
  });

  const timeoutsRef = useRef<number[]>([]);
  const bestScoreRef = useRef(0);

  function updateStatus(message: string, tone: StatusTone = "default") {
    setStatus({ message, tone });
  }

  function clearTimers() {
    timeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
    timeoutsRef.current = [];
  }

  function tryPushBestScore(score: number) {
    const user = auth.currentUser;
    if (!user) return;
    if (score <= bestScoreRef.current) return;
    bestScoreRef.current = score;
    submitWordGuessScore(user.uid, score).catch(() => {});
  }

  function startRound({ keepStreak }: { keepStreak: boolean }) {
    clearTimers();
    setSecretWord(pickRandomWord());
    setBoard(createEmptyBoard(WORD_LENGTH));
    setTileStates(createEmptyStates(WORD_LENGTH));
    setTileRevealMask(createEmptyRevealMask(WORD_LENGTH));
    setCurrentRow(0);
    setCurrentCol(0);
    setRevealRow(null);
    setShakeRow(null);
    setIsGameOver(false);
    setIsRevealing(false);
    setRoundResult(null);
    setKeyStates({});
    if (!keepStreak) {
      setStreak(0);
    }
    updateStatus(`Guess the ${WORD_LENGTH}-letter word in 6 tries.`);
  }

  function resetGame() {
    startRound({ keepStreak: false });
  }

  function triggerShake(rowIndex: number) {
    setShakeRow(rowIndex);
    const timer = window.setTimeout(() => setShakeRow(null), 400);
    timeoutsRef.current.push(timer);
  }

  function updateKeyboardState(letter: string, nextState: LetterState) {
    setKeyStates((prev) => {
      const currentState = prev[letter];
      if (currentState && STATE_PRIORITY[currentState] >= STATE_PRIORITY[nextState]) {
        return prev;
      }
      return { ...prev, [letter]: nextState };
    });
  }

  function addLetter(letter: string) {
    if (currentCol >= WORD_LENGTH) return;
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[currentRow][currentCol] = letter;
      return next;
    });
    setCurrentCol((prev) => prev + 1);
  }

  function removeLetter() {
    if (currentCol === 0) return;
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[currentRow][currentCol - 1] = "";
      return next;
    });
    setCurrentCol((prev) => prev - 1);
  }

  function revealGuess(guess: string) {
    const rowIndex = currentRow;
    const result = evaluateGuess(guess, secretWord, WORD_LENGTH);
    setTileStates((prev) => {
      const next = prev.map((row) => [...row]);
      next[rowIndex] = result;
      return next;
    });

    setRevealRow(rowIndex);
    setIsRevealing(true);

    result.forEach((state, index) => {
      const letter = guess[index];
      const timer = window.setTimeout(() => {
        setTileRevealMask((prev) => {
          const next = prev.map((row) => [...row]);
          next[rowIndex][index] = true;
          return next;
        });
        updateKeyboardState(letter, state);
      }, index * REVEAL_STEP_DELAY_MS + REVEAL_COLOR_DELAY_MS);
      timeoutsRef.current.push(timer);
    });

    const revealDuration = (WORD_LENGTH - 1) * REVEAL_STEP_DELAY_MS + FLIP_TOTAL_MS + 40;
    const timer = window.setTimeout(() => {
      setIsRevealing(false);
      setRevealRow(null);

      if (guess === secretWord) {
        setIsGameOver(true);
        setRoundResult("WIN");
        setStreak((prev) => {
          const next = prev + 1;
          tryPushBestScore(next);
          return next;
        });
        updateStatus("You nailed it! Play again?", "success");
        return;
      }

      if (rowIndex === MAX_GUESSES - 1) {
        setIsGameOver(true);
        setRoundResult("LOSE");
        setStreak(0);
        updateStatus(`Out of tries. The word was ${secretWord.toUpperCase()}.`, "error");
        return;
      }

      setCurrentRow((prev) => prev + 1);
      setCurrentCol(0);
      updateStatus("Keep going!");
    }, revealDuration);
    timeoutsRef.current.push(timer);
  }

  function submitGuess() {
    if (currentCol < WORD_LENGTH) {
      updateStatus("Not enough letters yet.", "error");
      triggerShake(currentRow);
      return;
    }

    const guess = board[currentRow].join("");
    if (!VALID_GUESS_SET.has(guess)) {
      updateStatus("Not in word list.", "error");
      triggerShake(currentRow);
      return;
    }

    updateStatus("");
    revealGuess(guess);
  }

  function handleKeyInput(key: string) {
    if (isGameOver || isRevealing) return;

    if (key === "enter") {
      submitGuess();
      return;
    }

    if (key === "backspace") {
      removeLetter();
      return;
    }

    if (/^[a-z]$/.test(key)) {
      addLetter(key);
    }
  }

  useEffect(() => {
    try {
      let snapshot: WordGuessSnapshot | null = null;
      const raw = window.localStorage.getItem(WORD_GUESS_SAVE_KEY);
      if (raw) {
        snapshot = parseWordGuessSnapshot(raw);
        if (!snapshot) {
          window.localStorage.removeItem(WORD_GUESS_SAVE_KEY);
        }
      }

      if (snapshot) {
        clearTimers();
        setSecretWord(snapshot.secretWord);
        setBoard(snapshot.board);
        setTileStates(snapshot.tileStates);
        setTileRevealMask(snapshot.tileRevealMask);
        setCurrentRow(snapshot.currentRow);
        setCurrentCol(snapshot.currentCol);
        setRevealRow(null);
        setShakeRow(null);
        setIsGameOver(snapshot.isGameOver);
        setIsRevealing(false);
        setRoundResult(snapshot.roundResult);
        setStreak(snapshot.streak);
        setKeyStates(snapshot.keyStates);
        setStatus(snapshot.status);
      }
    } catch (err) {
      console.warn("word guess restore failed:", err);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || isRevealing) return;

    const snapshot: WordGuessSnapshot = {
      v: WORD_GUESS_SAVE_VERSION,
      secretWord,
      board,
      tileStates,
      tileRevealMask,
      currentRow,
      currentCol,
      isGameOver,
      roundResult,
      streak,
      keyStates,
      status,
    };

    try {
      window.localStorage.setItem(WORD_GUESS_SAVE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn("word guess local save failed:", err);
    }
  }, [
    isHydrated,
    secretWord,
    board,
    tileStates,
    tileRevealMask,
    currentRow,
    currentCol,
    isGameOver,
    isRevealing,
    roundResult,
    streak,
    keyStates,
    status,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "enter" || key === "backspace" || /^[a-z]$/.test(key)) {
        handleKeyInput(key);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isGameOver, isRevealing, currentCol, currentRow, board, secretWord]);

  useEffect(() => {
    const ref = doc(db, "system", "weekly");
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (!snap.exists()) {
          try {
            await checkWeeklyReset();
          } catch (err) {
            console.warn("weekly reset check failed:", err);
          }
          return;
        }

        const seasonId = Number((snap.data() as any)?.seasonId ?? 1) || 1;
        setCurrentSeasonId(seasonId);
      },
      (err) => console.warn("weekly doc listener failed:", err)
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    let unsubDoc: null | (() => void) = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      if (!user || currentSeasonId === null) {
        bestScoreRef.current = 0;
        setBestScoreUI(0);
        return;
      }

      const ref = doc(db, "scores", "word-guess", "users", user.uid);
      unsubDoc = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            bestScoreRef.current = 0;
            setBestScoreUI(0);
            return;
          }

          const data = snap.data() as any;
          const seasonId = Number(data?.seasonId ?? 0) || 0;
          const score = Number(data?.score ?? 0) || 0;
          const best = seasonId === currentSeasonId ? score : 0;

          bestScoreRef.current = best;
          setBestScoreUI(best);
        },
        (err) => {
          console.warn("bestScore listener failed:", err);
        }
      );
    });

    return () => {
      if (unsubDoc) unsubDoc();
      unsubAuth();
    };
  }, [currentSeasonId]);

  useEffect(() => {
    if (currentSeasonId === null) {
      setLeaderboard([]);
      setPreviousSeasonWinners([]);
      return;
    }

    const previousSeasonId = currentSeasonId - 1;
    const q = collection(db, "scores", "word-guess", "users");
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              score: Number(data?.score ?? 0) || 0,
              seasonId: Number(data?.seasonId ?? 0) || 0,
            };
          });

        const currentRows = rows
          .filter((row) => row.seasonId === currentSeasonId)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ uid, score }) => ({ uid, score }));

        const previousRows =
          previousSeasonId >= 1
            ? rows
                .filter((row) => row.seasonId === previousSeasonId)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map(({ uid, score }) => ({ uid, score }))
            : [];

        setLeaderboard(currentRows);
        setPreviousSeasonWinners(previousRows);
      },
      (err) => console.warn("leaderboard listener failed:", err)
    );

    return () => unsub();
  }, [currentSeasonId]);

  useEffect(() => () => clearTimers(), []);

  const previousSeasonId = currentSeasonId !== null && currentSeasonId > 1
    ? currentSeasonId - 1
    : null;

  const previousSeasonPodium = [
    { rank: 2, tone: "silver", row: previousSeasonWinners[1] ?? null },
    { rank: 1, tone: "gold", row: previousSeasonWinners[0] ?? null },
    { rank: 3, tone: "bronze", row: previousSeasonWinners[2] ?? null },
  ] as const;

  return (
    <main className="game-page wordle-page">
      <section className="home-hero wordle-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">Word Guess</span>
          </h2>
          <p className="home-hero__subtitle">
            Crack the hidden {WORD_LENGTH}-letter word in six tries.
          </p>
        </div>
      </section>

      <section className="wordle-shell">
        <aside className="wordle__stats">
          <div className="wordle__summary">
            <div className="wordle__summary-item">
              <span>Season</span>
              <strong>{currentSeasonId ? `#${currentSeasonId}` : "-"}</strong>
            </div>
            <div className="wordle__summary-item">
              <span>Best</span>
              <strong>{bestScoreUI}</strong>
            </div>
            <div className="wordle__summary-item">
              <span>Streak</span>
              <strong>{streak}</strong>
            </div>
          </div>

          <button className="wordle__restart" type="button" onClick={resetGame}>
            Restart
          </button>
        </aside>

        <section className="wordle">
          <header className="wordle__header">
            <div>
              <h3 className="wordle__title">Five-letter challenge</h3>
              <p className="wordle__subtitle">Build your streak and climb the season ranking.</p>
            </div>
          </header>

          <div className="wordle__play-area">
            <div
              className={`wordle__status wordle__status--${status.tone}`}
              aria-live="polite"
              aria-atomic="true"
            >
              {status.message || " "}
            </div>

            {isGameOver && (
              <div className="wordle__next">
                <button
                  className="wordle__next-button"
                  type="button"
                  onClick={() => startRound({ keepStreak: true })}
                >
                  Next Round
                </button>
                <span className="wordle__next-hint">
                  {roundResult === "WIN" ? "Streak continues with a new word." : "Fresh start."}
                </span>
              </div>
            )}

            <div
              className="wordle__board"
              role="grid"
              aria-label="Word board"
              style={{ ["--word-length" as any]: String(WORD_LENGTH) }}
            >
              {board.map((row, rowIndex) => (
                <div
                  key={`row-${rowIndex}`}
                  className={`wordle__row ${shakeRow === rowIndex ? "is-shake" : ""}`}
                  role="row"
                >
                  {row.map((letter, colIndex) => {
                    const state = tileStates[rowIndex][colIndex];
                    const isRevealingTile = revealRow === rowIndex && state;
                    const isStateVisible =
                      state !== null && (revealRow !== rowIndex || tileRevealMask[rowIndex][colIndex]);
                    return (
                      <div
                        key={`tile-${rowIndex}-${colIndex}`}
                        className={`wordle__tile ${letter ? "is-filled" : ""} ${
                          isRevealingTile ? "is-revealing" : ""
                        }`}
                        data-state={isStateVisible ? state : undefined}
                        style={{ animationDelay: `${(colIndex * REVEAL_STEP_DELAY_MS) / 1000}s` }}
                        role="gridcell"
                        aria-label={`row ${rowIndex + 1} column ${colIndex + 1}`}
                      >
                        {letter.toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="wordle__keyboard" role="group" aria-label="On-screen keyboard">
            {KEYBOARD_LAYOUT.map((row, rowIndex) => (
              <div key={`key-row-${rowIndex}`} className="wordle__keyboard-row">
                {row.map((key) => {
                  const label =
                    key === "enter" ? "Enter" : key === "backspace" ? "Del" : key;
                  const keyState = keyStates[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`wordle__key ${
                        key === "enter" || key === "backspace" ? "wordle__key--wide" : ""
                      }`}
                      data-state={keyState || undefined}
                      onClick={() => handleKeyInput(key)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <aside className="wordle__leaderboard">
          <div className="wordle__leaderboard-title">Top Players</div>
          {leaderboard.length === 0 ? (
            <div className="wordle__leaderboard-empty">Loading...</div>
          ) : (
            leaderboard.map((row, i) => (
              <div key={`${row.uid}-${i}`} className="wordle__leaderboard-row">
                <span className="wordle__leaderboard-rank">{i + 1}</span>
                <div className="wordle__leaderboard-user">
                  <UserBox userId={row.uid} />
                </div>
                <span className="wordle__leaderboard-score">{row.score}</span>
              </div>
            ))
          )}
        </aside>
      </section>

      <section className="wordle-hof" aria-label="Word Guess previous season winners">
        <div className="wordle-hof__header">
          <h3 className="wordle-hof__title">Previous Season Winners</h3>
          <span className="wordle-hof__badge">
            {previousSeasonId ? `Season #${previousSeasonId}` : "No previous season"}
          </span>
        </div>

        {previousSeasonWinners.length === 0 ? (
          <div className="wordle-hof__empty">
            {previousSeasonId ? "No winners recorded for the previous season." : "No previous season yet."}
          </div>
        ) : (
          <div className="wordle-hof__podium">
            {previousSeasonPodium.map((slot) => (
              <article
                key={slot.rank}
                className={`wordle-hof__slot wordle-hof__slot--${slot.tone}`}
              >
                <div className="wordle-hof__user">
                  {slot.row ? (
                    <UserBox userId={slot.row.uid} />
                  ) : (
                    <span className="wordle-hof__user-empty">Waiting...</span>
                  )}
                </div>

                <div className={`wordle-hof__pillar wordle-hof__pillar--${slot.tone}`}>
                  <strong className="wordle-hof__rank">#{slot.rank}</strong>
                  <span className="wordle-hof__score">
                    {slot.row ? slot.row.score.toLocaleString() : "0"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}


