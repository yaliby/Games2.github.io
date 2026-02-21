import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allEnglishSounds,
  allRussianLetters,
  failMessages,
  formatRussianLetterPair,
  getRandomItem,
  getSoundLesson,
  learningTips,
  shuffle,
  similarLetterDistractors,
  similarSoundDistractors,
  soundQuestions,
  streakMilestones,
  successMessages,
  type SoundLesson,
  type SoundQuestion,
  type StreakMilestone,
} from "./soundData";

const NEXT_QUESTION_DELAY_MS = 640;
const RECENT_RESULTS_LIMIT = 10;
const MASTERY_STORAGE_KEY = "gameshub:sound-shooter:mastery:v2";
const QUICK_WINDOW_MS = 1800;

export type QuestionMode = "forward" | "reverse";
export type FeedbackTone = "success" | "fail";
export type MasteryStage = "new" | "learning" | "solid" | "mastered";
export type DifficultyTier = 0 | 1 | 2 | 3 | 4;

export type SoundRound = {
  id: number;
  mode: QuestionMode;
  prompt: string;
  promptLabel: string;
  correctOption: string;
  options: string[];
  sourceSound: string;
  lesson: SoundLesson;
  difficultyTier: DifficultyTier;
  difficultyLabel: string;
  reverseChance: number;
  isBossRound: boolean;
};

export type SoundFeedback = {
  tone: FeedbackTone;
  message: string;
  selectedOption: string;
  correctOption: string;
  explainer: string;
  mnemonic: string;
  anchor: string;
  milestone: StreakMilestone | null;
  isBossClear: boolean;
  speedBonus: number;
  awardedPoints: number;
};

export type ShotState = {
  id: number;
  tone: FeedbackTone;
};

export type RoundResult = {
  id: number;
  prompt: string;
  sourceSound: string;
  correctOption: string;
  selectedOption: string;
  isCorrect: boolean;
  mode: QuestionMode;
  isBossRound: boolean;
};

export type MasteryEntry = {
  sound: string;
  letter: string;
  hits: number;
  stage: MasteryStage;
};

type BuildRoundParams = {
  id: number;
  streak: number;
  totalAnswers: number;
  accuracy: number;
  previousSound: string | null;
};

type ResetOptions = {
  clearMastery?: boolean;
};

function loadMasteryHits(): Record<string, number> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(MASTERY_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && typeof value === "number")
      .map(([key, value]) => [key, Math.max(0, Math.floor(value as number))] as const);

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function computeDifficultyTier(streak: number, accuracy: number, totalAnswers: number): DifficultyTier {
  const streakBand = Math.min(3, Math.floor(streak / 3));
  const accuracyBand = accuracy >= 90 ? 2 : accuracy >= 76 ? 1 : 0;
  const progressionBand = totalAnswers >= 48 ? 2 : totalAnswers >= 24 ? 1 : 0;
  const tier = Math.min(4, streakBand + accuracyBand + progressionBand);
  return tier as DifficultyTier;
}

function getDifficultyLabel(tier: DifficultyTier): string {
  if (tier >= 4) return "Elite";
  if (tier === 3) return "Advanced";
  if (tier === 2) return "Focused";
  if (tier === 1) return "Normal";
  return "Warmup";
}

function getReverseChance(tier: DifficultyTier, streak: number): number {
  const baseByTier = [0.06, 0.14, 0.24, 0.38, 0.54] as const;
  const streakBoost = Math.min(0.16, streak * 0.012);
  return Math.min(0.78, baseByTier[tier] + streakBoost);
}

function shouldStartBossRound(id: number, tier: DifficultyTier, streak: number, totalAnswers: number): boolean {
  if (tier < 1) return false;
  if (streak < 4) return false;
  if (totalAnswers < 8) return false;

  const cadence = tier >= 4 ? 4 : tier >= 3 ? 5 : 6;
  return id % cadence === 0;
}

function pickQuestion(previousSound: string | null): SoundQuestion {
  const candidates = previousSound
    ? soundQuestions.filter((question) => question.sound !== previousSound)
    : soundQuestions;
  const pool = candidates.length > 0 ? candidates : soundQuestions;
  return getRandomItem(pool);
}

function buildForwardOptions(
  question: SoundQuestion,
  tier: DifficultyTier,
  optionCount: number,
): string[] {
  const optionPool = new Set<string>(question.options);
  optionPool.add(question.correct);

  if (tier >= 1) {
    const similar = similarLetterDistractors[question.correct] ?? [];
    similar.forEach((option) => optionPool.add(option));
  }

  if (tier >= 2) {
    allRussianLetters.forEach((option) => optionPool.add(option));
  }

  const distractors = shuffle(
    [...optionPool].filter((option) => option !== question.correct),
  ).slice(0, Math.max(1, optionCount - 1));

  return shuffle([question.correct, ...distractors]);
}

function buildReverseOptions(
  question: SoundQuestion,
  tier: DifficultyTier,
  optionCount: number,
): string[] {
  const optionPool = new Set<string>([question.sound]);
  const similar = similarSoundDistractors[question.sound] ?? [];

  similar.forEach((option) => optionPool.add(option));

  if (tier >= 2) {
    allEnglishSounds.forEach((option) => optionPool.add(option));
  }

  const distractors = shuffle(
    [...optionPool].filter((option) => option !== question.sound),
  ).slice(0, Math.max(1, optionCount - 1));

  return shuffle([question.sound, ...distractors]);
}

function buildRound({
  id,
  streak,
  totalAnswers,
  accuracy,
  previousSound,
}: BuildRoundParams): SoundRound {
  const sourceQuestion = pickQuestion(previousSound);
  const lesson = getSoundLesson(sourceQuestion.sound);
  const difficultyTier = computeDifficultyTier(streak, accuracy, totalAnswers);
  const reverseChance = getReverseChance(difficultyTier, streak);
  const isBossRound = shouldStartBossRound(id, difficultyTier, streak, totalAnswers);

  let mode: QuestionMode = Math.random() < reverseChance ? "reverse" : "forward";
  if (isBossRound && difficultyTier >= 2) {
    mode = "reverse";
  }

  const optionCount = isBossRound ? 6 : 4;
  const difficultyLabel = getDifficultyLabel(difficultyTier);

  if (mode === "reverse") {
    return {
      id,
      mode,
      prompt: sourceQuestion.correct,
      promptLabel: isBossRound
        ? "Boss Round: Russian -> English"
        : "Russian -> English",
      correctOption: sourceQuestion.sound,
      options: buildReverseOptions(sourceQuestion, difficultyTier, optionCount),
      sourceSound: sourceQuestion.sound,
      lesson,
      difficultyTier,
      difficultyLabel,
      reverseChance,
      isBossRound,
    };
  }

  return {
    id,
    mode,
    prompt: sourceQuestion.sound,
    promptLabel: isBossRound
      ? "Boss Round: English -> Russian"
      : "English -> Russian",
    correctOption: sourceQuestion.correct,
    options: buildForwardOptions(sourceQuestion, difficultyTier, optionCount),
    sourceSound: sourceQuestion.sound,
    lesson,
    difficultyTier,
    difficultyLabel,
    reverseChance,
    isBossRound,
  };
}

function getAwardedPoints(round: SoundRound, streak: number): number {
  const base = round.mode === "reverse" ? 14 : 10;
  const streakBonus = Math.min(18, Math.floor(streak / 2));
  const tierBonus = round.difficultyTier * 2;
  const bossBonus = round.isBossRound ? 18 : 0;
  const multiplier = 1 + Math.min(0.5, Math.floor(streak / 4) * 0.1);
  return Math.round((base + streakBonus + tierBonus + bossBonus) * multiplier);
}

function getSpeedBonus(round: SoundRound, responseMs: number): number {
  const limit = round.isBossRound ? 2200 : QUICK_WINDOW_MS;
  const ratio = Math.max(0, 1 - responseMs / limit);
  const maxBonus = round.isBossRound ? 9 : 6;
  return Math.round(ratio * maxBonus);
}

function getMasteryStage(hits: number): MasteryStage {
  if (hits >= 6) return "mastered";
  if (hits >= 4) return "solid";
  if (hits >= 1) return "learning";
  return "new";
}

function buildExplainer(round: SoundRound, isCorrect: boolean, selectedOption: string): string {
  const displaySound = formatRussianLetterPair(round.lesson.sound);
  const displayLetter = formatRussianLetterPair(round.lesson.letter);
  const relation = round.mode === "reverse"
    ? `${displayLetter} -> ${displaySound}`
    : `${displaySound} -> ${displayLetter}`;

  if (isCorrect) {
    return `${relation}. ${round.lesson.englishAnchor}`;
  }

  const displaySelectedOption = formatRussianLetterPair(selectedOption);
  return `Correct pair is ${relation}. You selected ${displaySelectedOption}. ${round.lesson.englishAnchor}`;
}

function getLevelLabel(accuracy: number, bestStreak: number, bossClears: number): string {
  if (accuracy >= 92 && bestStreak >= 12 && bossClears >= 4) return "Phonetic Commander";
  if (accuracy >= 86 && bestStreak >= 9 && bossClears >= 2) return "Boss Decoder";
  if (accuracy >= 76 && bestStreak >= 6) return "Sound Tactician";
  if (accuracy >= 62 && bestStreak >= 4) return "Letter Hunter";
  if (accuracy >= 48) return "Cadet";
  return "Recruit";
}

export function useSoundGame() {
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [roundId, setRoundId] = useState(1);
  const [round, setRound] = useState<SoundRound>(() =>
    buildRound({
      id: 1,
      streak: 0,
      totalAnswers: 0,
      accuracy: 0,
      previousSound: null,
    }),
  );
  const [feedback, setFeedback] = useState<SoundFeedback | null>(null);
  const [lastShot, setLastShot] = useState<ShotState | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [totalAnswers, setTotalAnswers] = useState(0);
  const [masteryHits, setMasteryHits] = useState<Record<string, number>>(() => loadMasteryHits());
  const [recentResults, setRecentResults] = useState<RoundResult[]>([]);
  const [activeTip, setActiveTip] = useState(() => getRandomItem(learningTips));
  const [bossClears, setBossClears] = useState(0);
  const [roundStartedAt, setRoundStartedAt] = useState(() => Date.now());

  const timersRef = useRef<number[]>([]);
  const lockRef = useRef(false);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(masteryHits));
    } catch {
      // ignore storage write failures
    }
  }, [masteryHits]);

  const accuracy = useMemo(() => {
    if (totalAnswers <= 0) return 0;
    return Math.round((correctAnswers / totalAnswers) * 100);
  }, [correctAnswers, totalAnswers]);

  const scheduleNextRound = useCallback(
    (
      nextStreak: number,
      answeredCount: number,
      nextAccuracy: number,
      currentRound: SoundRound,
    ) => {
      const timeoutId = window.setTimeout(() => {
        setRoundId((previous) => {
          const nextId = previous + 1;
          setRound(
            buildRound({
              id: nextId,
              streak: nextStreak,
              totalAnswers: answeredCount,
              accuracy: nextAccuracy,
              previousSound: currentRound.sourceSound,
            }),
          );
          setRoundStartedAt(Date.now());
          return nextId;
        });

        setActiveTip(getRandomItem(learningTips));
        setFeedback(null);
        lockRef.current = false;
        setIsLocked(false);
      }, NEXT_QUESTION_DELAY_MS);

      timersRef.current.push(timeoutId);
    },
    [],
  );

  const selectOption = useCallback(
    (option: string) => {
      if (lockRef.current || isLocked) return;

      const isCorrect = option === round.correctOption;
      const nextStreak = isCorrect ? streak + 1 : 0;
      const nextTotalAnswers = totalAnswers + 1;
      const nextCorrectAnswers = correctAnswers + (isCorrect ? 1 : 0);
      const nextAccuracy = Math.round((nextCorrectAnswers / nextTotalAnswers) * 100);
      const responseMs = Date.now() - roundStartedAt;
      const milestone = isCorrect
        ? streakMilestones.find((entry) => entry.streak === nextStreak) ?? null
        : null;
      const speedBonus = isCorrect ? getSpeedBonus(round, responseMs) : 0;
      const awardedPoints = isCorrect ? getAwardedPoints(round, streak) + speedBonus : 0;

      lockRef.current = true;
      setIsLocked(true);
      setFeedback({
        tone: isCorrect ? "success" : "fail",
        message: getRandomItem(isCorrect ? successMessages : failMessages),
        selectedOption: option,
        correctOption: round.correctOption,
        explainer: buildExplainer(round, isCorrect, option),
        mnemonic: round.lesson.mnemonic,
        anchor: round.lesson.englishAnchor,
        milestone,
        isBossClear: isCorrect && round.isBossRound,
        speedBonus,
        awardedPoints,
      });

      setLastShot((previous) => ({
        id: (previous?.id ?? 0) + 1,
        tone: isCorrect ? "success" : "fail",
      }));

      setTotalAnswers(nextTotalAnswers);
      setCorrectAnswers(nextCorrectAnswers);
      setRecentResults((previous) => [
        {
          id: round.id,
          prompt: round.prompt,
          sourceSound: round.sourceSound,
          correctOption: round.correctOption,
          selectedOption: option,
          isCorrect,
          mode: round.mode,
          isBossRound: round.isBossRound,
        },
        ...previous,
      ].slice(0, RECENT_RESULTS_LIMIT));

      if (isCorrect) {
        setScore((previous) => previous + awardedPoints);
        setStreak(nextStreak);
        setBestStreak((previous) => Math.max(previous, nextStreak));
        setMasteryHits((previous) => ({
          ...previous,
          [round.sourceSound]: (previous[round.sourceSound] ?? 0) + 1,
        }));

        if (round.isBossRound) {
          setBossClears((previous) => previous + 1);
        }
      } else {
        setStreak(0);
      }

      scheduleNextRound(nextStreak, nextTotalAnswers, nextAccuracy, round);
    },
    [correctAnswers, isLocked, round, roundStartedAt, scheduleNextRound, streak, totalAnswers],
  );

  const resetGame = useCallback(
    (options: ResetOptions = {}) => {
      clearAllTimers();
      const initialRound = buildRound({
        id: 1,
        streak: 0,
        totalAnswers: 0,
        accuracy: 0,
        previousSound: null,
      });

      setScore(0);
      setStreak(0);
      setBestStreak(0);
      setRoundId(1);
      setRound(initialRound);
      setFeedback(null);
      setLastShot(null);
      setCorrectAnswers(0);
      setTotalAnswers(0);
      setRecentResults([]);
      setActiveTip(getRandomItem(learningTips));
      setBossClears(0);
      setRoundStartedAt(Date.now());

      if (options.clearMastery) {
        setMasteryHits({});
      }

      lockRef.current = false;
      setIsLocked(false);
    },
    [clearAllTimers],
  );

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  const mastery = useMemo<MasteryEntry[]>(() => {
    return soundQuestions.map((question) => {
      const hits = masteryHits[question.sound] ?? 0;
      return {
        sound: question.sound,
        letter: question.correct,
        hits,
        stage: getMasteryStage(hits),
      };
    });
  }, [masteryHits]);

  const comboMeter = Math.min(100, streak * 10 + (round.isBossRound ? 8 : 0));
  const levelLabel = getLevelLabel(accuracy, bestStreak, bossClears);
  const streakMultiplier = 1 + Math.min(0.5, Math.floor(streak / 4) * 0.1);

  return {
    score,
    streak,
    bestStreak,
    round,
    roundId,
    isLocked,
    feedback,
    lastShot,
    selectOption,
    resetGame,
    totalAnswers,
    correctAnswers,
    accuracy,
    mastery,
    recentResults,
    activeTip,
    comboMeter,
    levelLabel,
    bossClears,
    streakMultiplier,
  };
}
