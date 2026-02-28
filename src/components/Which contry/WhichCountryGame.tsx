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
import {
  submitWhichCountryScore,
  submitWhichCountrySpeedRunTime,
} from "../../services/scoreService";
import UserBox from "../UserBox/UserBox";
import "./WhichCountryGame.css";

type Phase = "idle" | "playing" | "ended";
type GameMode = "classic" | "speedrun" | "learn";
type EndReason = "strikes" | "speedrun-complete" | "manual-stop" | "learn-complete";

type ToastTone = "good" | "bad" | "info";
type ToastState = {
  message: string;
  tone: ToastTone;
} | null;
type LeaderboardRow = { uid: string; score: number };
type SpeedRunLeaderboardRow = {
  uid: string;
  timeMs: number;
  countriesFound: number;
  countriesTotal: number;
  isComplete: boolean;
};
type LearnGeoHint = {
  guessName: string;
  targetName: string;
  directionLabel: string;
  distanceKm: number;
  region: string;
};

const QUICK_BONUS_WINDOW_SECONDS = 10;
const QUICK_ANSWER_BONUS = TIME_BONUS_POINTS * 5;
const LEARN_SESSION_SIZE = 24;
const LEARN_REQUIRED_HITS = 2;

function shuffleCountries(countries: PlayableCountry[]): PlayableCountry[] {
  const next = [...countries];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function formatRunTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((safeMs % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function normalizeTimeMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric);
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceKmBetweenCentroids(from: [number, number], to: [number, number]): number {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  if (!Number.isFinite(lon1) || !Number.isFinite(lat1) || !Number.isFinite(lon2) || !Number.isFinite(lat2)) {
    return 0;
  }

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const earthRadiusKm = 6371;
  return Math.round(earthRadiusKm * c);
}

function bearingDegrees(from: [number, number], to: [number, number]): number {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const dLonRad = toRad(lon2 - lon1);
  const y = Math.sin(dLonRad) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad)
    - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);
  const raw = (Math.atan2(y, x) * 180) / Math.PI;
  return (raw + 360) % 360;
}

function bearingToDirectionLabel(bearing: number): string {
  const compass = [
    "North",
    "North-East",
    "East",
    "South-East",
    "South",
    "South-West",
    "West",
    "North-West",
  ] as const;
  const index = Math.round(bearing / 45) % 8;
  return compass[index];
}

function buildLearnGeoHint(clicked: PlayableCountry, target: PlayableCountry): LearnGeoHint {
  const bearing = bearingDegrees(clicked.centroid, target.centroid);
  return {
    guessName: clicked.name,
    targetName: target.name,
    directionLabel: bearingToDirectionLabel(bearing),
    distanceKm: distanceKmBetweenCentroids(clicked.centroid, target.centroid),
    region: target.region || "Unknown",
  };
}

export default function WhichCountryGame() {
  const navigate = useNavigate();
  const [allCountries, setAllCountries] = useState<PlayableCountry[]>([]);
  const [loadError, setLoadError] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedMode, setSelectedMode] = useState<GameMode>("classic");
  const [activeMode, setActiveMode] = useState<GameMode>("classic");
  const [endReason, setEndReason] = useState<EndReason>("strikes");
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
  const [speedRunLeaderboard, setSpeedRunLeaderboard] = useState<SpeedRunLeaderboardRow[]>([]);
  const [speedRunBestMs, setSpeedRunBestMs] = useState<number | null>(null);
  const [speedRunQueue, setSpeedRunQueue] = useState<PlayableCountry[]>([]);
  const [speedRunIndex, setSpeedRunIndex] = useState(0);
  const [speedRunStartedAtMs, setSpeedRunStartedAtMs] = useState<number | null>(null);
  const [speedRunTickMs, setSpeedRunTickMs] = useState<number>(0);
  const [speedRunMistakes, setSpeedRunMistakes] = useState(0);
  const [speedRunFinalMs, setSpeedRunFinalMs] = useState<number | null>(null);
  const [learnQueue, setLearnQueue] = useState<PlayableCountry[]>([]);
  const [learnSessionTotal, setLearnSessionTotal] = useState(0);
  const [learnMasteryByIso3, setLearnMasteryByIso3] = useState<Record<string, number>>({});
  const [learnMasteredCount, setLearnMasteredCount] = useState(0);
  const [learnAttempts, setLearnAttempts] = useState(0);
  const [learnMistakes, setLearnMistakes] = useState(0);

  const [feedback, setFeedback] = useState<MapFeedback>(null);
  const [revealCorrectIso3, setRevealCorrectIso3] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [inputLocked, setInputLocked] = useState(false);
  const [learnGeoHint, setLearnGeoHint] = useState<LearnGeoHint | null>(null);

  const [flagLoadFailed, setFlagLoadFailed] = useState(false);
  const actionTimerRef = useRef<number | null>(null);
  const bestScoreRef = useRef(bestScore);
  const shakeControls = useAnimationControls();

  const playableCountries = useMemo(() => getDifficultyCountries(allCountries, "hard"), [allCountries]);
  const isClassicMode = activeMode === "classic";
  const isSpeedRunMode = activeMode === "speedrun";
  const isLearnMode = activeMode === "learn";
  const speedRunTotal = speedRunQueue.length;
  const speedRunFound = Math.min(speedRunIndex, speedRunTotal);
  const speedRunAttempts = speedRunFound + speedRunMistakes;
  const speedRunAccuracy =
    speedRunAttempts > 0 ? Math.round((speedRunFound / speedRunAttempts) * 100) : 100;
  const speedRunCompletedIso3 = useMemo(
    () => new Set(speedRunQueue.slice(0, speedRunFound).map((country) => country.iso3)),
    [speedRunQueue, speedRunFound],
  );
  const speedRunRawElapsedMs = speedRunStartedAtMs === null ? 0 : Math.max(0, speedRunTickMs - speedRunStartedAtMs);
  const speedRunElapsedMs = speedRunFinalMs ?? speedRunRawElapsedMs;
  const learnRemaining = Math.max(0, learnSessionTotal - learnMasteredCount);
  const learnCorrectAnswers = Math.max(0, learnAttempts - learnMistakes);
  const learnAccuracy = learnAttempts > 0 ? Math.round((learnCorrectAnswers / learnAttempts) * 100) : 100;
  const currentLearnMastery = targetCountry
    ? Math.min(LEARN_REQUIRED_HITS, learnMasteryByIso3[targetCountry.iso3] ?? 0)
    : 0;

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
    setLearnGeoHint(null);
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

  const finishGame = useCallback((reason: EndReason = "strikes") => {
    const now = Date.now();
    clearActionTimer();
    setEndReason(reason);
    setPhase("ended");
    setInputLocked(true);
    setFeedback(null);
    setRevealCorrectIso3(null);
    setToast(null);
    setTargetCountry(null);
    setTimeLeft(0);
    setSpeedRunTickMs(now);

    const isSpeedRunSession = activeMode === "speedrun" || reason === "speedrun-complete";
    if (isSpeedRunSession) {
      const rawElapsed = speedRunStartedAtMs === null ? 0 : Math.max(0, now - speedRunStartedAtMs);
      const finalTimeMs = Math.max(0, rawElapsed);
      setSpeedRunFinalMs(finalTimeMs);
      setIsNewBest(false);

      const uid = auth.currentUser?.uid;
      if (uid && finalTimeMs > 0 && (reason === "speedrun-complete" || reason === "manual-stop")) {
        void submitWhichCountrySpeedRunTime(uid, finalTimeMs, {
          countriesFound: speedRunFound,
          countriesTotal: speedRunTotal,
        }).catch((err) => {
          console.warn("which-country speedrun score submit failed:", err);
        });
      }

      if (reason === "speedrun-complete") {
        triggerConfetti(1);
      }
      return;
    }

    const isLearnSession = activeMode === "learn" || reason === "learn-complete";
    if (isLearnSession) {
      setIsNewBest(false);
      if (reason === "learn-complete") {
        triggerConfetti(0.9);
      }
      return;
    }

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
  }, [activeMode, clearActionTimer, score, speedRunFound, speedRunStartedAtMs, speedRunTotal, triggerConfetti]);

  const startGame = useCallback((mode: GameMode = selectedMode) => {
    if (!playableCountries.length) {
      return;
    }

    clearActionTimer();
    clearTransient();
    setSelectedMode(mode);
    setActiveMode(mode);
    setEndReason("strikes");
    setScore(0);
    setRound(1);
    setStrikes(0);
    setTimeLeft(ROUND_TIME_SECONDS);
    setIsNewBest(false);
    setSpeedRunFinalMs(null);
    setSpeedRunMistakes(0);
    setSpeedRunIndex(0);
    setSpeedRunQueue([]);
    setSpeedRunStartedAtMs(null);
    setSpeedRunTickMs(0);
    setLearnQueue([]);
    setLearnSessionTotal(0);
    setLearnMasteryByIso3({});
    setLearnMasteredCount(0);
    setLearnAttempts(0);
    setLearnMistakes(0);
    setLearnGeoHint(null);

    if (mode === "speedrun") {
      const queue = shuffleCountries(playableCountries);
      const firstTarget = queue[0];
      if (!firstTarget) {
        return;
      }
      const now = Date.now();
      setSpeedRunQueue(queue);
      setSpeedRunStartedAtMs(now);
      setSpeedRunTickMs(now);
      setTargetCountry(firstTarget);
      setPhase("playing");
      return;
    }

    if (mode === "learn") {
      const queue = shuffleCountries(playableCountries).slice(0, Math.min(LEARN_SESSION_SIZE, playableCountries.length));
      const firstTarget = queue[0];
      if (!firstTarget) {
        return;
      }
      setLearnQueue(queue);
      setLearnSessionTotal(queue.length);
      setTargetCountry(firstTarget);
      setPhase("playing");
      return;
    }

    const firstTarget = pickRandomCountry(playableCountries);
    if (!firstTarget) {
      return;
    }
    setPhase("playing");
    setTargetCountry(firstTarget);
  }, [clearActionTimer, clearTransient, playableCountries, selectedMode]);

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

  useEffect(() => {
    if (phase !== "playing" || !isSpeedRunMode || speedRunStartedAtMs === null) {
      return;
    }

    const timerId = window.setInterval(() => {
      setSpeedRunTickMs(Date.now());
    }, 80);

    return () => window.clearInterval(timerId);
  }, [isSpeedRunMode, phase, speedRunStartedAtMs]);

  const runShake = useCallback(() => {
    void shakeControls.start({
      x: [0, -10, 10, -7, 7, 0],
      transition: { duration: 0.34, ease: "easeOut" },
    });
  }, [shakeControls]);

  useEffect(() => {
    if (!isClassicMode || phase !== "playing" || inputLocked || !targetCountry || timeLeft <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [inputLocked, isClassicMode, phase, targetCountry, timeLeft]);

  useEffect(() => {
    if (!isClassicMode || phase !== "playing" || inputLocked || !targetCountry || timeLeft > 0) {
      return;
    }

    const nextStrikes = strikes + 1;
    clearActionTimer();
    setStrikes(nextStrikes);
    setRevealCorrectIso3(targetCountry.iso3);
    setInputLocked(true);
    setToast({ message: `Time is up! Strike ${nextStrikes}/${MAX_STRIKES}`, tone: "bad" });
    runShake();

    if (nextStrikes >= MAX_STRIKES) {
      actionTimerRef.current = window.setTimeout(() => {
        finishGame();
        actionTimerRef.current = null;
      }, WRONG_DELAY_MS);
      return;
    }

    actionTimerRef.current = window.setTimeout(() => {
      advanceRound();
      actionTimerRef.current = null;
    }, WRONG_DELAY_MS);
  }, [advanceRound, clearActionTimer, finishGame, inputLocked, isClassicMode, phase, runShake, strikes, targetCountry, timeLeft]);

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

  useEffect(() => {
    const speedRunScoresRef = collection(db, "scores", "which-country-speedrun", "users");

    const unsub = onSnapshot(
      speedRunScoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as any;
            const rawTotal = normalizeTimeMs(data?.countriesTotal);
            const rawFound = normalizeTimeMs(data?.countriesFound);
            const countriesTotal = rawTotal > 0 ? rawTotal : 1;
            const countriesFound = rawTotal > 0 ? Math.min(rawFound, countriesTotal) : countriesTotal;
            const isComplete = countriesFound >= countriesTotal;
            return {
              uid: entry.id,
              timeMs: normalizeTimeMs(data?.timeMs),
              countriesFound,
              countriesTotal,
              isComplete,
            };
          })
          .filter((row) => row.timeMs > 0)
          .sort((a, b) => {
            if (a.isComplete !== b.isComplete) {
              return a.isComplete ? -1 : 1;
            }
            if (!a.isComplete && a.countriesFound !== b.countriesFound) {
              return b.countriesFound - a.countriesFound;
            }
            return a.timeMs - b.timeMs;
          })
          .slice(0, 5);

        setSpeedRunLeaderboard(rows);
      },
      (err) => console.warn("which-country speedrun leaderboard listener failed:", err),
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

      if (!user) {
        setSpeedRunBestMs(null);
        return;
      }

      const scoreRef = doc(db, "scores", "which-country-speedrun", "users", user.uid);
      unsubDoc = onSnapshot(
        scoreRef,
        (snap) => {
          if (!snap.exists()) {
            setSpeedRunBestMs(null);
            return;
          }
          const data = snap.data() as any;
          const nextBest = normalizeTimeMs(data?.timeMs);
          setSpeedRunBestMs(nextBest > 0 ? nextBest : null);
        },
        (err) => {
          console.warn("which-country speedrun best listener failed:", err);
        },
      );
    });

    return () => {
      if (unsubDoc) {
        unsubDoc();
      }
      unsubAuth();
    };
  }, []);

  const advanceLearnRound = useCallback((outcome: "correct" | "wrong" | "hint") => {
    if (!learnQueue.length) {
      return;
    }

    const current = learnQueue[0];
    const masteryNext = { ...learnMasteryByIso3 };
    let nextQueue: PlayableCountry[];
    let nextMasteredCount = learnMasteredCount;

    if (outcome === "correct") {
      const nextHits = Math.min(LEARN_REQUIRED_HITS, (masteryNext[current.iso3] ?? 0) + 1);
      masteryNext[current.iso3] = nextHits;
      if (nextHits >= LEARN_REQUIRED_HITS) {
        nextMasteredCount += 1;
        nextQueue = learnQueue.slice(1);
        triggerConfetti(0.22);
      } else {
        nextQueue = [...learnQueue.slice(1), current];
      }
    } else {
      masteryNext[current.iso3] = 0;
      nextQueue = [...learnQueue.slice(1), current];
    }

    const nextAttempts = learnAttempts + 1;
    const nextMistakes = learnMistakes + (outcome === "correct" ? 0 : 1);

    setLearnMasteryByIso3(masteryNext);
    setLearnQueue(nextQueue);
    setLearnMasteredCount(nextMasteredCount);
    setLearnAttempts(nextAttempts);
    setLearnMistakes(nextMistakes);

    if (nextMasteredCount >= learnSessionTotal || nextQueue.length === 0) {
      finishGame("learn-complete");
      return;
    }

    setFeedback(null);
    setRevealCorrectIso3(null);
    setToast(null);
    setInputLocked(false);
    setLearnGeoHint(null);
    setRound(nextAttempts + 1);
    setTargetCountry(nextQueue[0] ?? null);
  }, [
    finishGame,
    learnAttempts,
    learnMasteredCount,
    learnMasteryByIso3,
    learnMistakes,
    learnQueue,
    learnSessionTotal,
    triggerConfetti,
  ]);

  const handleLearnReveal = useCallback(() => {
    if (phase !== "playing" || !isLearnMode || !targetCountry || inputLocked) {
      return;
    }

    clearActionTimer();
    setInputLocked(true);
    setFeedback(null);
    setRevealCorrectIso3(targetCountry.iso3);
    setToast({
      message: `Target location: ${targetCountry.name}. Added to review.`,
      tone: "info",
    });

    actionTimerRef.current = window.setTimeout(() => {
      advanceLearnRound("hint");
      actionTimerRef.current = null;
    }, WRONG_DELAY_MS);
  }, [advanceLearnRound, clearActionTimer, inputLocked, isLearnMode, phase, targetCountry]);

  const handleCountryClick = useCallback(
    (country: PlayableCountry) => {
      if (phase !== "playing" || !targetCountry || inputLocked) {
        return;
      }

      clearActionTimer();

      if (isSpeedRunMode && speedRunCompletedIso3.has(country.iso3)) {
        return;
      }

      if (isCorrectGuess(country.iso3, targetCountry.iso3)) {
        if (isSpeedRunMode) {
          const completedCount = speedRunIndex + 1;
          const totalCountries = speedRunQueue.length;
          const hasCompletedRun = completedCount >= totalCountries;

          setFeedback({ type: "correct", clickedIso3: country.iso3 });
          setInputLocked(true);
          setToast({
            message: hasCompletedRun
              ? `All ${totalCountries} countries found!`
              : `Correct! ${completedCount}/${totalCountries}`,
            tone: "good",
          });
          triggerConfetti(hasCompletedRun ? 1 : 0.28);

          actionTimerRef.current = window.setTimeout(() => {
            if (hasCompletedRun) {
              setSpeedRunIndex(completedCount);
              setRound(completedCount);
              finishGame("speedrun-complete");
              actionTimerRef.current = null;
              return;
            }

            const nextTarget = speedRunQueue[completedCount] ?? null;
            if (!nextTarget) {
              finishGame("speedrun-complete");
              actionTimerRef.current = null;
              return;
            }

            setFeedback(null);
            setRevealCorrectIso3(null);
            setToast(null);
            setInputLocked(false);
            setSpeedRunIndex(completedCount);
            setRound(completedCount + 1);
            setTargetCountry(nextTarget);
            actionTimerRef.current = null;
          }, CORRECT_DELAY_MS);
          return;
        }

        if (isLearnMode) {
          const nextHits = Math.min(
            LEARN_REQUIRED_HITS,
            (learnMasteryByIso3[targetCountry.iso3] ?? 0) + 1,
          );
          const willMasterCountry = nextHits >= LEARN_REQUIRED_HITS;

          setFeedback({ type: "correct", clickedIso3: country.iso3 });
          setInputLocked(true);
          setToast({
            message: willMasterCountry
              ? `Mastered: ${targetCountry.name}`
              : `Correct: ${targetCountry.name} (${nextHits}/${LEARN_REQUIRED_HITS})`,
            tone: "good",
          });
          triggerConfetti(willMasterCountry ? 0.45 : 0.24);

          actionTimerRef.current = window.setTimeout(() => {
            advanceLearnRound("correct");
            actionTimerRef.current = null;
          }, CORRECT_DELAY_MS);
          return;
        }

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

      if (isSpeedRunMode) {
        setFeedback({ type: "wrong", clickedIso3: country.iso3 });
        runShake();
        setSpeedRunMistakes((previous) => previous + 1);
        setToast({
          message: `Wrong country: ${country.name}`,
          tone: "bad",
        });

        actionTimerRef.current = window.setTimeout(() => {
          setFeedback(null);
          setRevealCorrectIso3(null);
          setToast(null);
          actionTimerRef.current = null;
        }, 350);
        return;
      }

      if (isLearnMode) {
        const geoHint = buildLearnGeoHint(country, targetCountry);
        setFeedback({ type: "wrong", clickedIso3: country.iso3 });
        setRevealCorrectIso3(targetCountry.iso3);
        setInputLocked(true);
        setLearnGeoHint(geoHint);
        setLearnAttempts((previous) => previous + 1);
        setLearnMistakes((previous) => previous + 1);
        setRound((previous) => previous + 1);
        setLearnMasteryByIso3((previous) => {
          const currentHits = previous[targetCountry.iso3] ?? 0;
          if (currentHits === 0) {
            return previous;
          }
          return {
            ...previous,
            [targetCountry.iso3]: 0,
          };
        });
        runShake();
        setToast({
          message: `Geo Coach: ${targetCountry.name} is ${geoHint.directionLabel}, ~${geoHint.distanceKm} km (${geoHint.region})`,
          tone: "info",
        });

        actionTimerRef.current = window.setTimeout(() => {
          setFeedback(null);
          setRevealCorrectIso3(null);
          setInputLocked(false);
          setToast(null);
          actionTimerRef.current = null;
        }, WRONG_DELAY_MS);
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
      isLearnMode,
      isSpeedRunMode,
      learnMasteryByIso3,
      phase,
      runShake,
      speedRunCompletedIso3,
      speedRunIndex,
      speedRunQueue,
      strikes,
      targetCountry,
      timeLeft,
      triggerConfetti,
      advanceLearnRound,
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
  const modeTitle =
    selectedMode === "classic"
      ? "Classic Run"
      : selectedMode === "speedrun"
        ? "Speed Run"
        : "Learning Mode";
  const modeDescription =
    selectedMode === "classic"
      ? "Score points, survive strikes, and keep the run alive."
      : selectedMode === "speedrun"
        ? "Find every country once, in random order, as fast as possible."
        : "Interactive drill with Geo Coach hints: each country needs two correct finds to be mastered.";
  const speedRunBestLabel = speedRunBestMs === null ? "—" : formatRunTime(speedRunBestMs);
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
                  Choose your mode, then match each flag on the map
                </h3>
                <p className="which-country__count">{playableCountries.length} playable countries</p>
                <div className="which-country__mode-grid">
                  <button
                    type="button"
                    className={`which-country__mode-btn ${selectedMode === "classic" ? "is-active" : ""}`}
                    onClick={() => setSelectedMode("classic")}
                    aria-pressed={selectedMode === "classic"}
                  >
                    <span className="which-country__mode-title">Classic</span>
                    <span className="which-country__mode-desc">Score run, strikes, and per-round timer</span>
                  </button>
                  <button
                    type="button"
                    className={`which-country__mode-btn ${selectedMode === "speedrun" ? "is-active" : ""}`}
                    onClick={() => setSelectedMode("speedrun")}
                    aria-pressed={selectedMode === "speedrun"}
                  >
                    <span className="which-country__mode-title">Speed Run</span>
                    <span className="which-country__mode-desc">All countries once, random order, fastest time</span>
                  </button>
                  <button
                    type="button"
                    className={`which-country__mode-btn ${selectedMode === "learn" ? "is-active" : ""}`}
                    onClick={() => setSelectedMode("learn")}
                    aria-pressed={selectedMode === "learn"}
                  >
                    <span className="which-country__mode-title">Learning</span>
                    <span className="which-country__mode-desc">Interactive drill with mastery + review queue</span>
                  </button>
                </div>
                <p className="which-country__mode-description">
                  <strong>{modeTitle}:</strong> {modeDescription}
                </p>
                <div className="which-country__rules">
                  {selectedMode === "classic" ? (
                    <>
                      <span>{BASE_CORRECT_POINTS} base points per correct answer</span>
                      <span>Answer in first {QUICK_BONUS_WINDOW_SECONDS}s: +{QUICK_ANSWER_BONUS}</span>
                      <span>Round timer: {ROUND_TIME_SECONDS}s (timeout = +1 strike)</span>
                      <span>{MAX_STRIKES} strikes and the run ends</span>
                    </>
                  ) : selectedMode === "speedrun" ? (
                    <>
                      <span>{playableCountries.length} countries in one shuffled run</span>
                      <span>Wrong clicks do not add time penalty</span>
                      <span>No strike limit, finish all countries</span>
                      <span>Ranking is pure speed with visible accuracy</span>
                    </>
                  ) : (
                    <>
                      <span>{Math.min(LEARN_SESSION_SIZE, playableCountries.length)} random countries per session</span>
                      <span>{LEARN_REQUIRED_HITS} correct finds are needed to master each country</span>
                      <span>Geo Coach gives direction + distance hints after wrong picks</span>
                      <span>Wrong picks and reveals move countries into review</span>
                      <span>Measured on mastery, mistakes, and accuracy</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="which-country__start-actions">
              <button
                className="which-country__primary-btn"
                type="button"
                onClick={() => startGame(selectedMode)}
              >
                <Play size={18} />
                {selectedMode === "classic"
                  ? "Start Classic Run"
                  : selectedMode === "speedrun"
                    ? "Start Speed Run"
                    : "Start Learning Session"}
              </button>
              <p className="which-country__best">
                {selectedMode === "classic"
                  ? `Season ${currentSeasonId ? `#${currentSeasonId}` : "..."} best: ${bestScore}`
                  : selectedMode === "speedrun"
                    ? `Personal best: ${speedRunBestLabel} • Goal: ${playableCountries.length} countries`
                    : `${Math.min(LEARN_SESSION_SIZE, playableCountries.length)} random countries • ${LEARN_REQUIRED_HITS}x mastery`}
              </p>
            </div>

            <div className="which-country__start-meta">
              {selectedMode === "speedrun" ? (
                <>
                  <section className="which-country__season-board" aria-label="Which Country speed run leaderboard">
                    <div className="which-country__season-head">
                      <span>Speed Run Leaders</span>
                      <strong>All Time</strong>
                    </div>
                    {speedRunLeaderboard.length === 0 ? (
                      <p className="which-country__season-empty">No speed run records yet.</p>
                    ) : (
                      speedRunLeaderboard.map((row, index) => (
                        <div key={`${row.uid}-${index}`} className="which-country__season-row">
                          <span className="which-country__season-rank">{index + 1}</span>
                          <div className="which-country__season-user">
                            <UserBox userId={row.uid} />
                          </div>
                          <strong className="which-country__season-score">
                            {row.isComplete
                              ? formatRunTime(row.timeMs)
                              : `${row.countriesFound}/${row.countriesTotal} • ${formatRunTime(row.timeMs)}`}
                          </strong>
                        </div>
                      ))
                    )}
                  </section>

                  <section className="which-country__podium-shell" aria-label="Which Country speed run details">
                    <div className="which-country__season-head">
                      <span>Your Speed Run Best</span>
                      <strong>{speedRunBestLabel}</strong>
                    </div>
                    <p className="which-country__season-empty">
                      Use Finish/Reset in-run controls to manage attempts.
                    </p>
                    <p className="which-country__season-empty">
                      Wrong clicks affect your accuracy, not your timer.
                    </p>
                  </section>
                </>
              ) : selectedMode === "learn" ? (
                <>
                  <section className="which-country__season-board" aria-label="Which Country learning flow">
                    <div className="which-country__season-head">
                      <span>Learning Session</span>
                      <strong>Interactive</strong>
                    </div>
                    <p className="which-country__season-empty">
                      You get {Math.min(LEARN_SESSION_SIZE, playableCountries.length)} random countries.
                    </p>
                    <p className="which-country__season-empty">
                      Every country must be found correctly {LEARN_REQUIRED_HITS} times to be mastered.
                    </p>
                    <p className="which-country__season-empty">
                      Wrong answer or reveal resets mastery for that country and sends it to review.
                    </p>
                    <p className="which-country__season-empty">
                      Geo Coach: after mistakes you get direction + distance + target region.
                    </p>
                  </section>

                  <section className="which-country__podium-shell" aria-label="Which Country learning tips">
                    <div className="which-country__season-head">
                      <span>In-run Controls</span>
                      <strong>Tips</strong>
                    </div>
                    <p className="which-country__season-empty">
                      Use <strong>Show Location</strong> if you are stuck.
                    </p>
                    <p className="which-country__season-empty">
                      Progress uses mastery, not score, so focus on retention.
                    </p>
                  </section>
                </>
              ) : (
                <>
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
                </>
              )}
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
                <span className="which-country__meta-label">
                  {isLearnMode ? "Find this country" : "Find this flag"}
                </span>
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
                  {isClassicMode ? (
                    <>
                      <span className="which-country__chip">
                        <Timer size={14} />
                        {timeLeft}s
                      </span>
                      <span className="which-country__chip">
                        <Heart size={14} />
                        {mistakesLeft} lives
                      </span>
                    </>
                  ) : isSpeedRunMode ? (
                    <>
                      <span className="which-country__chip">
                        <Timer size={14} />
                        {formatRunTime(speedRunElapsedMs)}
                      </span>
                      <span className="which-country__chip">
                        <Trophy size={14} />
                        {speedRunFound}/{speedRunTotal}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="which-country__chip">
                        <Trophy size={14} />
                        {learnMasteredCount}/{learnSessionTotal} mastered
                      </span>
                      <span className="which-country__chip">
                        <Sparkles size={14} />
                        {learnAccuracy}% accuracy
                      </span>
                    </>
                  )}
                </div>

                {isClassicMode ? (
                  <div className="which-country__timer-track" aria-hidden="true">
                    <motion.div
                      className={`which-country__timer-fill ${timeLeft <= 10 ? "is-danger" : ""}`}
                      animate={{ width: `${timerPercent}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 18 }}
                    />
                  </div>
                ) : null}
              </div>

              <div className="which-country__stats">
                {isClassicMode ? (
                  <>
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
                  </>
                ) : isSpeedRunMode ? (
                  <>
                    <div className="which-country__stat-card is-score">
                      <span className="which-country__meta-label">Elapsed</span>
                      <strong>{formatRunTime(speedRunElapsedMs)}</strong>
                    </div>
                    <div className="which-country__stat-card is-best">
                      <span className="which-country__meta-label">Accuracy</span>
                      <strong>{speedRunAccuracy}%</strong>
                    </div>
                    <div className="which-country__stat-card is-round">
                      <span className="which-country__meta-label">Found</span>
                      <strong>{speedRunFound}</strong>
                    </div>
                    <div className="which-country__stat-card is-strikes">
                      <span className="which-country__meta-label">Mistakes</span>
                      <strong>{speedRunMistakes}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="which-country__stat-card is-score">
                      <span className="which-country__meta-label">Mastered</span>
                      <strong>{learnMasteredCount}/{learnSessionTotal}</strong>
                    </div>
                    <div className="which-country__stat-card is-best">
                      <span className="which-country__meta-label">Review Left</span>
                      <strong>{learnRemaining}</strong>
                    </div>
                    <div className="which-country__stat-card is-round">
                      <span className="which-country__meta-label">Accuracy</span>
                      <strong>{learnAccuracy}%</strong>
                    </div>
                    <div className="which-country__stat-card is-strikes">
                      <span className="which-country__meta-label">Mistakes</span>
                      <strong>{learnMistakes}</strong>
                    </div>
                  </>
                )}
              </div>

              <div className="which-country__run-controls">
                {isLearnMode && (
                  <button
                    className="which-country__ghost-btn"
                    type="button"
                    onClick={handleLearnReveal}
                  >
                    <Sparkles size={15} />
                    Show Location
                  </button>
                )}
                <button
                  className="which-country__ghost-btn"
                  type="button"
                  onClick={() => startGame(activeMode)}
                >
                  <RefreshCw size={15} />
                  {isLearnMode ? "Reset Session" : "Reset Run"}
                </button>
                <button
                  className="which-country__ghost-btn which-country__ghost-btn-danger"
                  type="button"
                  onClick={() => finishGame("manual-stop")}
                >
                  <XCircle size={15} />
                  {isLearnMode ? "Finish Session" : "Finish Run"}
                </button>
              </div>
            </motion.section>

            <section className="which-country__panel which-country__status-strip">
              <div className="which-country__status-copy">
                <p className="which-country__status-text" aria-live="polite">
                  {isClassicMode
                    ? (
                      inputLocked
                        ? "Checking answer..."
                        : `Round ${round}: ${mistakesLeft} life${mistakesLeft === 1 ? "" : "s"} left`
                    )
                    : isSpeedRunMode ? (
                      inputLocked
                        ? "Validating target..."
                        : `Speed Run progress: ${speedRunFound}/${speedRunTotal} countries found`
                    ) : (
                      inputLocked
                        ? "Reviewing..."
                        : `Learning ${learnMasteredCount}/${learnSessionTotal}: find ${targetCountry?.name ?? "the target"}`
                    )}
                </p>
                {isLearnMode && learnGeoHint && (
                  <p className="which-country__status-tip">
                    Geo Coach: {learnGeoHint.targetName} is {learnGeoHint.directionLabel} of {learnGeoHint.guessName} (~{learnGeoHint.distanceKm} km) • Region: {learnGeoHint.region}
                  </p>
                )}
              </div>
              {isClassicMode ? (
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
              ) : isSpeedRunMode ? (
                <div className="which-country__strike-track" aria-hidden="true">
                  <span className="which-country__strike-dot which-country__strike-dot--wide">
                    Left: {Math.max(0, speedRunTotal - speedRunFound)}
                  </span>
                </div>
              ) : (
                <div className="which-country__strike-track" aria-hidden="true">
                  <span className="which-country__strike-dot which-country__strike-dot--wide">
                    Mastery this country: {currentLearnMastery}/{LEARN_REQUIRED_HITS}
                  </span>
                </div>
              )}
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
                    completedIso3Set={isSpeedRunMode ? speedRunCompletedIso3 : undefined}
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
                      {endReason === "speedrun-complete" || endReason === "learn-complete"
                        ? <Trophy size={14} />
                        : <XCircle size={14} />}
                      {endReason === "speedrun-complete" || endReason === "learn-complete"
                        ? "Completed"
                        : endReason === "manual-stop"
                          ? "Stopped"
                          : "Eliminated"}
                    </p>
                    <h3>
                      {endReason === "speedrun-complete"
                        ? "Speed Run complete"
                        : endReason === "learn-complete"
                          ? "Learning session complete"
                        : endReason === "manual-stop"
                          ? "Run stopped"
                          : "Run over"}
                    </h3>
                    {isClassicMode && isNewBest && (
                      <p className="which-country__best-badge">
                        <Trophy size={14} />
                        New personal best
                      </p>
                    )}
                    <p className="which-country__end-summary">
                      {activeMode === "speedrun"
                        ? (
                          endReason === "speedrun-complete"
                            ? `You found all ${speedRunTotal} countries in ${formatRunTime(speedRunElapsedMs)}.`
                            : `Run stopped at ${speedRunFound}/${speedRunTotal} countries in ${formatRunTime(speedRunElapsedMs)}.`
                        )
                        : activeMode === "learn"
                          ? (
                            endReason === "learn-complete"
                              ? `You mastered all ${learnSessionTotal} countries with ${learnAccuracy}% accuracy.`
                              : `Session stopped at ${learnMasteredCount}/${learnSessionTotal} mastered countries.`
                          )
                        : (
                          endReason === "manual-stop"
                            ? "You ended the run manually."
                            : "You reached the strike limit and the run ended."
                        )}
                    </p>
                    <div className="which-country__end-stats">
                      {activeMode === "speedrun" ? (
                        <>
                          <article className="which-country__end-stat">
                            <span>{endReason === "speedrun-complete" ? "Final time" : "Run time"}</span>
                            <strong>{formatRunTime(speedRunElapsedMs)}</strong>
                          </article>
                          <article className="which-country__end-stat">
                            <span>Accuracy</span>
                            <strong>{speedRunAccuracy}%</strong>
                          </article>
                          <article className="which-country__end-stat">
                            <span>Progress</span>
                            <strong>{speedRunFound}/{speedRunTotal} • {speedRunMistakes} mistakes</strong>
                          </article>
                        </>
                      ) : activeMode === "learn" ? (
                        <>
                          <article className="which-country__end-stat">
                            <span>Mastered</span>
                            <strong>{learnMasteredCount}/{learnSessionTotal}</strong>
                          </article>
                          <article className="which-country__end-stat">
                            <span>Accuracy</span>
                            <strong>{learnAccuracy}%</strong>
                          </article>
                          <article className="which-country__end-stat">
                            <span>Attempts</span>
                            <strong>{learnAttempts} • {learnMistakes} mistakes</strong>
                          </article>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                    <div className="which-country__end-actions">
                      <button
                        className="which-country__primary-btn"
                        type="button"
                        onClick={() => startGame(activeMode)}
                      >
                        <RefreshCw size={16} />
                        {activeMode === "speedrun"
                          ? "Run again"
                          : activeMode === "learn"
                            ? "New session"
                            : "Play again"}
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
