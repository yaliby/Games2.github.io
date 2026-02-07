import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import "./WordGuessGame.css";
import { WORD_LIST, WORD_LIST_3, WORD_LIST_4 } from "./word-list";
import { auth, db } from "../../services/firebase";
import { checkWeeklyReset } from "../../services/resetService";
import { submitWordGuessScore } from "../../services/scoreService";
import UserBox from "../UserBox/UserBox";

type LetterState = "correct" | "present" | "absent";
type StatusTone = "default" | "error" | "success";

const WORD_LENGTHS = [3, 4, 5] as const;
type WordLength = (typeof WORD_LENGTHS)[number];
const MAX_GUESSES = 6;

const ANSWER_WORDS: Record<WordLength, string[]> = {
  3: WORD_LIST_3,
  4: WORD_LIST_4,
  5: WORD_LIST,
};

const VALID_WORDS: Record<WordLength, Set<string>> = {
  3: new Set(WORD_LIST_3),
  4: new Set(WORD_LIST_4),
  5: new Set(WORD_LIST),
};

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

function pickRandomLength(): WordLength {
  const index = Math.floor(Math.random() * WORD_LENGTHS.length);
  return WORD_LENGTHS[index];
}

function pickRandomWord(length: WordLength) {
  const list = ANSWER_WORDS[length];
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function createEmptyBoard(length: number) {
  return Array.from({ length: MAX_GUESSES }, () => Array(length).fill(""));
}

function createEmptyStates(length: number) {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array(length).fill(null as LetterState | null)
  );
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

export default function WordGuessGame() {
  const [wordLength, setWordLength] = useState<WordLength>(pickRandomLength);
  const [secretWord, setSecretWord] = useState(() => pickRandomWord(wordLength));
  const [board, setBoard] = useState(() => createEmptyBoard(wordLength));
  const [tileStates, setTileStates] = useState(() => createEmptyStates(wordLength));
  const [currentRow, setCurrentRow] = useState(0);
  const [currentCol, setCurrentCol] = useState(0);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [roundResult, setRoundResult] = useState<"WIN" | "LOSE" | null>(null);
  const [streak, setStreak] = useState(0);
  const [currentSeasonId, setCurrentSeasonId] = useState<number | null>(null);
  const [bestScoreUI, setBestScoreUI] = useState(0);
  const [leaderboard, setLeaderboard] = useState<Array<{ uid: string; score: number }>>([]);
  const [keyStates, setKeyStates] = useState<Record<string, LetterState>>({});
  const [status, setStatus] = useState({
    message: `Guess the ${wordLength}-letter word in 6 tries.`,
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
    const nextLength = pickRandomLength();
    setWordLength(nextLength);
    setSecretWord(pickRandomWord(nextLength));
    setBoard(createEmptyBoard(nextLength));
    setTileStates(createEmptyStates(nextLength));
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
    updateStatus(`Guess the ${nextLength}-letter word in 6 tries.`);
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
    if (currentCol >= wordLength) return;
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
    const result = evaluateGuess(guess, secretWord, wordLength);
    setTileStates((prev) => {
      const next = prev.map((row) => [...row]);
      next[currentRow] = result;
      return next;
    });

    setRevealRow(currentRow);
    setIsRevealing(true);

    result.forEach((state, index) => {
      const letter = guess[index];
      const timer = window.setTimeout(() => {
        updateKeyboardState(letter, state);
      }, index * 180);
      timeoutsRef.current.push(timer);
    });

    const revealDuration = (wordLength - 1) * 180 + 650;
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

      if (currentRow === MAX_GUESSES - 1) {
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
    if (currentCol < wordLength) {
      updateStatus("Not enough letters yet.", "error");
      triggerShake(currentRow);
      return;
    }

    const guess = board[currentRow].join("");
    if (!VALID_WORDS[wordLength].has(guess)) {
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "enter" || key === "backspace" || /^[a-z]$/.test(key)) {
        handleKeyInput(key);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isGameOver, isRevealing, currentCol, currentRow, board, secretWord, wordLength]);

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
      return;
    }

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
          })
          .filter((row) => row.seasonId === currentSeasonId)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ uid, score }) => ({ uid, score }));

        setLeaderboard(rows);
      },
      (err) => console.warn("leaderboard listener failed:", err)
    );

    return () => unsub();
  }, [currentSeasonId]);

  useEffect(() => () => clearTimers(), []);

  return (
    <main className="game-page wordle-page">
      <section className="home-hero wordle-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">Word Guess</span>
          </h2>
          <p className="home-hero__subtitle">
            Crack the hidden {wordLength}-letter word in six tries.
          </p>
        </div>
      </section>

      <section className="wordle">
        <header className="wordle__header">
          <div>
            <h3 className="wordle__title">Random length each round</h3>
          </div>
          <div className="wordle__header-actions">
            <div className="wordle__streak">
              <span>Streak</span>
              <strong>{streak}</strong>
            </div>
            <button className="wordle__restart" type="button" onClick={resetGame}>
              Restart
            </button>
          </div>
        </header>

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
              {roundResult === "WIN"
                ? "Streak continues! New word length incoming."
                : "Fresh start with a new word length."}
            </span>
          </div>
        )}

        <div
          className="wordle__board"
          role="grid"
          aria-label="Word board"
          style={{ ["--word-length" as any]: String(wordLength) }}
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
                return (
                  <div
                    key={`tile-${rowIndex}-${colIndex}`}
                    className={`wordle__tile ${letter ? "is-filled" : ""} ${
                      isRevealingTile ? "is-revealing" : ""
                    }`}
                    data-state={state || undefined}
                    style={{ animationDelay: `${colIndex * 0.18}s` }}
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

        <div className="wordle__footer">
          <div className="wordle__summary">
            <div className="wordle__summary-item">
              <span>Season</span>
              <strong>{currentSeasonId ? `#${currentSeasonId}` : "—"}</strong>
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

          <div className="wordle__leaderboard">
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
          </div>
        </div>
      </section>
    </main>
  );
}
