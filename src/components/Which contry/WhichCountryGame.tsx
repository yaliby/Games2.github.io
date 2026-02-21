import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import confetti from "canvas-confetti";
import { Heart, Play, RefreshCw, Sparkles, Timer, Trophy, XCircle } from "lucide-react";
import WhichCountryMap, { type MapFeedback } from "./WhichCountryMap";
import { loadPlayableCountries, type PlayableCountry } from "./whichCountryData";
import {
  BASE_CORRECT_POINTS,
  CORRECT_DELAY_MS,
  MAX_STRIKES,
  ROUND_TIME_SECONDS,
  TIME_BONUS_POINTS,
  WRONG_DELAY_MS,
  getDifficultyCountries,
  getFlagFallbackText,
  isCorrectGuess,
  loadBestScore,
  pickRandomCountry,
  saveBestScore,
} from "./whichCountryLogic";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../../services/firebase";
import { checkWeeklyReset } from "../../services/resetService";
import { submitWhichCountryScore } from "../../services/scoreService";
import UserBox from "../UserBox/UserBox";
import "./WhichCountryGame.css";

type Phase = "idle" | "playing" | "ended";

type ToastTone = "good" | "bad" | "info";
type ToastState = {
  message: string;
  tone: ToastTone;
} | null;
type LeaderboardRow = { uid: string; score: number };

const QUICK_BONUS_WINDOW_SECONDS = 10;
const QUICK_ANSWER_BONUS = TIME_BONUS_POINTS * 5;

export default function WhichCountryGame() {
  const navigate = useNavigate();
  const [allCountries, setAllCountries] = useState<PlayableCountry[]>([]);
  const [loadError, setLoadError] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [targetCountry, setTargetCountry] = useState<PlayableCountry | null>(null);

  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [strikes, setStrikes] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME_SECONDS);
  const [bestScore, setBestScore] = useState(() => loadBestScore());
  const [isNewBest, setIsNewBest] = useState(false);
  const [currentSeasonId, setCurrentSeasonId] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [previousSeasonWinners, setPreviousSeasonWinners] = useState<LeaderboardRow[]>([]);

  const [feedback, setFeedback] = useState<MapFeedback>(null);
  const [revealCorrectIso3, setRevealCorrectIso3] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [inputLocked, setInputLocked] = useState(false);

  const [flagLoadFailed, setFlagLoadFailed] = useState(false);
  const actionTimerRef = useRef<number | null>(null);
  const bestScoreRef = useRef(bestScore);
  const shakeControls = useAnimationControls();

  const playableCountries = useMemo(() => getDifficultyCountries(allCountries, "hard"), [allCountries]);

  const clearActionTimer = useCallback(() => {
    if (actionTimerRef.current !== null) {
      window.clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
  }, []);

  const clearTransient = useCallback(() => {
    setFeedback(null);
    setRevealCorrectIso3(null);
    setToast(null);
    setInputLocked(false);
  }, []);

  const triggerConfetti = useCallback((intensity: number) => {
    const particleCount = Math.max(18, Math.round(90 * intensity));
    void confetti({
      particleCount,
      spread: 74,
      startVelocity: 34,
      origin: { y: 0.63 },
      colors: ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24"],
    });
  }, []);

  const advanceRound = useCallback(() => {
    setFeedback(null);
    setRevealCorrectIso3(null);
    setToast(null);
    setInputLocked(false);
    setTargetCountry((previousTarget) =>
      pickRandomCountry(playableCountries, previousTarget?.iso3),
    );
    setRound((prev) => prev + 1);
    setTimeLeft(ROUND_TIME_SECONDS);
  }, [playableCountries]);

  const finishGame = useCallback(() => {
    clearActionTimer();
    setPhase("ended");
    setInputLocked(true);
    setFeedback(null);
    setRevealCorrectIso3(null);
    setToast(null);
    setTargetCountry(null);
    setTimeLeft(0);

    const achievedNewBest = score > bestScoreRef.current;
    setIsNewBest(achievedNewBest);
    if (achievedNewBest) {
      triggerConfetti(1.2);
    }

    const uid = auth.currentUser?.uid;
    if (uid && score > 0) {
      void submitWhichCountryScore(uid, score).catch((err) => {
        console.warn("which-country score submit failed:", err);
      });
    }

    setBestScore((previous) => {
      const nextBest = Math.max(previous, score);
      bestScoreRef.current = nextBest;
      saveBestScore(nextBest);
      return nextBest;
    });
  }, [clearActionTimer, score, triggerConfetti]);

  const startGame = useCallback(() => {
    if (!playableCountries.length) {
      return;
    }
    const firstTarget = pickRandomCountry(playableCountries);
    if (!firstTarget) {
      return;
    }

    clearActionTimer();
    clearTransient();
    setScore(0);
    setRound(1);
    setStrikes(0);
    setTimeLeft(ROUND_TIME_SECONDS);
    setIsNewBest(false);
    setTargetCountry(firstTarget);
    setPhase("playing");
  }, [clearActionTimer, clearTransient, playableCountries]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const countries = await loadPlayableCountries();
        if (!active) {
          return;
        }
        setAllCountries(countries);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setFlagLoadFailed(false);
  }, [targetCountry?.iso2, targetCountry?.iso3]);

  useEffect(() => () => clearActionTimer(), [clearActionTimer]);

  useEffect(() => {
    bestScoreRef.current = bestScore;
  }, [bestScore]);

  const runShake = useCallback(() => {
    void shakeControls.start({
      x: [0, -10, 10, -7, 7, 0],
      transition: { duration: 0.34, ease: "easeOut" },
    });
  }, [shakeControls]);

  useEffect(() => {
    if (phase !== "playing" || inputLocked || !targetCountry || timeLeft <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [inputLocked, phase, targetCountry, timeLeft]);

  useEffect(() => {
    const weeklyRef = doc(db, "system", "weekly");
    const unsub = onSnapshot(
      weeklyRef,
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
      (err) => console.warn("weekly doc listener failed:", err),
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
        const fallbackBest = loadBestScore();
        bestScoreRef.current = fallbackBest;
        setBestScore(fallbackBest);
        return;
      }

      const scoreRef = doc(db, "scores", "which-country", "users", user.uid);
      unsubDoc = onSnapshot(
        scoreRef,
        (snap) => {
          if (!snap.exists()) {
            bestScoreRef.current = 0;
            setBestScore(0);
            return;
          }

          const data = snap.data() as any;
          const seasonId = Number(data?.seasonId ?? 0) || 0;
          const scoreValue = Number(data?.score ?? 0) || 0;
          const nextBest = seasonId === currentSeasonId ? Math.max(0, scoreValue) : 0;

          bestScoreRef.current = nextBest;
          setBestScore(nextBest);
        },
        (err) => {
          console.warn("which-country best score listener failed:", err);
        },
      );
    });

    return () => {
      if (unsubDoc) {
        unsubDoc();
      }
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
    const scoresRef = collection(db, "scores", "which-country", "users");

    const unsub = onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: d.id,
            score: Number(data?.score ?? 0) || 0,
            seasonId: Number(data?.seasonId ?? 0) || 0,
          };
        });

        const currentRows = rows
          .filter((row) => row.seasonId === currentSeasonId && row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(({ uid, score }) => ({ uid, score }));

        const previousRows =
          previousSeasonId >= 1
            ? rows
                .filter((row) => row.seasonId === previousSeasonId && row.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map(({ uid, score }) => ({ uid, score }))
            : [];

        setLeaderboard(currentRows);
        setPreviousSeasonWinners(previousRows);
      },
      (err) => console.warn("which-country leaderboard listener failed:", err),
    );

    return () => unsub();
  }, [currentSeasonId]);

  const handleCountryClick = useCallback(
    (country: PlayableCountry) => {
      if (phase !== "playing" || !targetCountry || inputLocked) {
        return;
      }

      clearActionTimer();

      if (isCorrectGuess(country.iso3, targetCountry.iso3)) {
        const answeredWithinBonusWindow =
          ROUND_TIME_SECONDS - timeLeft <= QUICK_BONUS_WINDOW_SECONDS;
        const quickBonus = answeredWithinBonusWindow ? QUICK_ANSWER_BONUS : 0;
        const points = BASE_CORRECT_POINTS + quickBonus;

        setScore((prev) => prev + points);
        setFeedback({ type: "correct", clickedIso3: country.iso3 });
        setToast({ message: `Correct! +${points}`, tone: "good" });
        setInputLocked(true);
        triggerConfetti(quickBonus > 0 ? 0.55 : 0.34);

        actionTimerRef.current = window.setTimeout(() => {
          advanceRound();
          actionTimerRef.current = null;
        }, CORRECT_DELAY_MS);
        return;
      }

      setFeedback({ type: "wrong", clickedIso3: country.iso3 });
      setRevealCorrectIso3(targetCountry.iso3);
      setInputLocked(true);
      runShake();

      const nextStrikes = strikes + 1;
      setStrikes(nextStrikes);

      if (nextStrikes >= MAX_STRIKES) {
        setToast({ message: `Wrong! Strike ${nextStrikes}/${MAX_STRIKES}`, tone: "bad" });
        actionTimerRef.current = window.setTimeout(() => {
          finishGame();
          actionTimerRef.current = null;
        }, WRONG_DELAY_MS);
        return;
      }

      setToast({ message: `Wrong! Strike ${nextStrikes}/${MAX_STRIKES}`, tone: "bad" });
      actionTimerRef.current = window.setTimeout(() => {
        advanceRound();
        actionTimerRef.current = null;
      }, WRONG_DELAY_MS);
    },
    [
      advanceRound,
      clearActionTimer,
      finishGame,
      inputLocked,
      phase,
      runShake,
      strikes,
      targetCountry,
      timeLeft,
      triggerConfetti,
    ],
  );

  if (loadError) {
    return (
      <main className="which-country">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="which-country__panel"
        >
          <h2>Which country?</h2>
          <p>Could not load map data.</p>
          <pre className="which-country__error">{loadError}</pre>
        </motion.section>
      </main>
    );
  }

  if (!allCountries.length) {
    return (
      <main className="which-country">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="which-country__panel"
        >
          <h2>Which country?</h2>
          <p>Loading world map...</p>
        </motion.section>
      </main>
    );
  }

  const showBoard = phase === "playing" || phase === "ended";
  const flagUrl = targetCountry ? `https://flagcdn.com/h80/${targetCountry.iso2}.png` : "";
  const mistakesLeft = Math.max(0, MAX_STRIKES - strikes);
  const timerPercent = Math.max(0, Math.min(100, (timeLeft / ROUND_TIME_SECONDS) * 100));
  const previousSeasonId =
    currentSeasonId !== null && currentSeasonId > 1 ? currentSeasonId - 1 : null;
  const previousSeasonPodium = [
    { rank: 2, tone: "silver", row: previousSeasonWinners[1] ?? null },
    { rank: 1, tone: "gold", row: previousSeasonWinners[0] ?? null },
    { rank: 3, tone: "bronze", row: previousSeasonWinners[2] ?? null },
  ] as const;

  return (
    <main className={`which-country${showBoard ? " is-board" : ""}${phase === "ended" ? " is-ended" : ""}`}>
      <div className="which-country__backdrop" aria-hidden="true" />
      <header className="which-country__title">
        <span className="which-country__hero-pill">Geo Sprint</span>
        <h2>Which country?</h2>
      </header>

      <AnimatePresence mode="wait">
        {!showBoard && (
          <motion.section
            key="start"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="which-country__panel which-country__start"
          >
            <div className="which-country__start-hero">
              <div className="which-country__start-icon">
                <Trophy size={30} />
              </div>
              <div className="which-country__start-copy">
                <h3 className="which-country__start-title">
                  Match the flag to the correct country on the map
                </h3>
                <p className="which-country__count">{playableCountries.length} playable countries</p>
                <div className="which-country__rules">
                  <span>{BASE_CORRECT_POINTS} base points per correct answer</span>
                  <span>Answer in first {QUICK_BONUS_WINDOW_SECONDS}s: +{QUICK_ANSWER_BONUS}</span>
                  <span>Round timer: {ROUND_TIME_SECONDS}s</span>
                  <span>Timer is bonus-only (no auto skip / no penalty)</span>
                  <span>{MAX_STRIKES} strikes and the run ends</span>
                </div>
              </div>
            </div>
            <div className="which-country__start-actions">
              <button className="which-country__primary-btn" type="button" onClick={startGame}>
                <Play size={18} />
                Start Run
              </button>
              <p className="which-country__best">
                Season {currentSeasonId ? `#${currentSeasonId}` : "..."} best: {bestScore}
              </p>
            </div>

            <div className="which-country__start-meta">
              <section className="which-country__season-board" aria-label="Which Country leaderboard">
                <div className="which-country__season-head">
                  <span>Season leaderboard</span>
                  <strong>{currentSeasonId ? `#${currentSeasonId}` : "..."}</strong>
                </div>
                {leaderboard.length === 0 ? (
                  <p className="which-country__season-empty">No scores yet.</p>
                ) : (
                  leaderboard.map((row, index) => (
                    <div key={`${row.uid}-${index}`} className="which-country__season-row">
                      <span className="which-country__season-rank">{index + 1}</span>
                      <div className="which-country__season-user">
                        <UserBox userId={row.uid} />
                      </div>
                      <strong className="which-country__season-score">{row.score}</strong>
                    </div>
                  ))
                )}
              </section>

              <section className="which-country__podium-shell" aria-label="Previous season podium">
                <div className="which-country__season-head">
                  <span>Previous season podium</span>
                  <strong>{previousSeasonId ? `#${previousSeasonId}` : "—"}</strong>
                </div>
                {previousSeasonWinners.length === 0 ? (
                  <p className="which-country__season-empty">
                    {previousSeasonId ? "No podium data yet." : "No previous season yet."}
                  </p>
                ) : (
                  <div className="which-country__podium">
                    {previousSeasonPodium.map((slot) => (
                      <article
                        key={slot.rank}
                        className={`which-country__podium-slot tone-${slot.tone}`}
                      >
                        <div className="which-country__podium-user">
                          {slot.row ? <UserBox userId={slot.row.uid} /> : <span>Waiting...</span>}
                        </div>
                        <div className={`which-country__podium-pillar tone-${slot.tone}`}>
                          <strong>#{slot.rank}</strong>
                          <span>{slot.row ? slot.row.score.toLocaleString() : "0"}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </motion.section>
        )}

        {showBoard && (
          <motion.div
            key="board"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="which-country__play-shell"
          >
            <motion.section
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="which-country__panel which-country__top-bar"
            >
              <div className="which-country__flag-wrap">
                <span className="which-country__meta-label">Find this flag</span>
                <AnimatePresence mode="wait">
                  <motion.div
                    className="which-country__flag-display"
                    key={targetCountry?.iso3 ?? "flag-empty"}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.22 }}
                  >
                    {targetCountry && !flagLoadFailed ? (
                      <img
                        className="which-country__flag"
                        src={flagUrl}
                        alt={`Flag of ${targetCountry.name}`}
                        onError={() => setFlagLoadFailed(true)}
                      />
                    ) : (
                      <div className="which-country__flag-fallback">
                        <span>{getFlagFallbackText(targetCountry?.iso2)}</span>
                        <strong>No flag available</strong>
                      </div>
                    )}
                    {targetCountry && <p className="which-country__target-name">{targetCountry.name}</p>}
                  </motion.div>
                </AnimatePresence>

                <div className="which-country__chip-row">
                  <span className="which-country__chip">
                    <Timer size={14} />
                    {timeLeft}s
                  </span>
                  <span className="which-country__chip">
                    <Heart size={14} />
                    {mistakesLeft} lives
                  </span>
                </div>

                <div className="which-country__timer-track" aria-hidden="true">
                  <motion.div
                    className={`which-country__timer-fill ${timeLeft <= 10 ? "is-danger" : ""}`}
                    animate={{ width: `${timerPercent}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 18 }}
                  />
                </div>
              </div>

              <div className="which-country__stats">
                <div className="which-country__stat-card is-score">
                  <span className="which-country__meta-label">Score</span>
                  <strong>{score}</strong>
                </div>
                <div className="which-country__stat-card is-best">
                  <span className="which-country__meta-label">Best</span>
                  <strong>{bestScore}</strong>
                </div>
                <div className="which-country__stat-card is-round">
                  <span className="which-country__meta-label">Round</span>
                  <strong>{round}</strong>
                </div>
                <div className="which-country__stat-card is-strikes">
                  <span className="which-country__meta-label">Strikes</span>
                  <strong>{strikes}/{MAX_STRIKES}</strong>
                </div>
              </div>
            </motion.section>

            <section className="which-country__panel which-country__status-strip">
              <p className="which-country__status-text" aria-live="polite">
                {inputLocked
                  ? "Checking answer..."
                  : `Round ${round}: ${mistakesLeft} life${mistakesLeft === 1 ? "" : "s"} left`}
              </p>
              <div className="which-country__strike-track" aria-hidden="true">
                {Array.from({ length: MAX_STRIKES }).map((_, index) => (
                  <span
                    key={`strike-${index}`}
                    className={`which-country__strike-dot ${index < strikes ? "is-hit" : ""}`}
                  >
                    {index < strikes ? "X" : "O"}
                  </span>
                ))}
              </div>
            </section>

            <motion.div animate={shakeControls} className="which-country__map-stage">
              <AnimatePresence mode="wait">
                <motion.div
                  key={targetCountry?.iso3 ?? "map-empty"}
                  className="which-country__map-motion"
                  initial={{ x: 26, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -26, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                >
                  <WhichCountryMap
                    countries={playableCountries}
                    feedback={feedback}
                    revealCorrectIso3={revealCorrectIso3}
                    disabled={phase !== "playing" || inputLocked}
                    onCountryClick={handleCountryClick}
                  />
                </motion.div>
              </AnimatePresence>
            </motion.div>

            <AnimatePresence>
              {toast && (
                <motion.div
                  key={`${toast.message}-${toast.tone}-${round}`}
                  initial={{ opacity: 0, y: 10, x: "-50%" }}
                  animate={{ opacity: 1, y: 0, x: "-50%" }}
                  exit={{ opacity: 0, y: 10, x: "-50%" }}
                  className={`which-country__toast is-${toast.tone}`}
                >
                  {toast.tone === "good" && <Sparkles size={16} />}
                  {toast.message}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {phase === "ended" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="which-country__end-overlay"
                >
                  <motion.section
                    initial={{ opacity: 0, y: 18, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.97 }}
                    transition={{ duration: 0.24 }}
                    className="which-country__panel which-country__end"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Run ended"
                  >
                    <p className="which-country__end-kicker">
                      <XCircle size={14} />
                      Eliminated
                    </p>
                    <h3>Run over</h3>
                    {isNewBest && (
                      <p className="which-country__best-badge">
                        <Trophy size={14} />
                        New personal best
                      </p>
                    )}
                    <p className="which-country__end-summary">
                      You reached the strike limit and the run ended.
                    </p>
                    <div className="which-country__end-stats">
                      <article className="which-country__end-stat">
                        <span>Final score</span>
                        <strong>{score}</strong>
                      </article>
                      <article className="which-country__end-stat">
                        <span>Season</span>
                        <strong>{currentSeasonId ? `#${currentSeasonId}` : "..."}</strong>
                      </article>
                      <article className="which-country__end-stat">
                        <span>Strikes</span>
                        <strong>
                          {strikes}/{MAX_STRIKES}
                        </strong>
                      </article>
                    </div>
                    <div className="which-country__end-actions">
                      <button className="which-country__primary-btn" type="button" onClick={startGame}>
                        <RefreshCw size={16} />
                        Play again
                      </button>
                      <button
                        className="which-country__ghost-btn"
                        type="button"
                        onClick={() => {
                          clearActionTimer();
                          clearTransient();
                          navigate("/");
                        }}
                      >
                        Back home
                      </button>
                    </div>
                  </motion.section>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
