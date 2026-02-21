import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "../../services/firebase";
import { submitSoundShooterScore } from "../../services/scoreService";
import { formatRussianLetterPair } from "./soundData";
import FeedbackPopup from "./components/FeedbackPopup";
import BattleTelemetry from "./components/BattleTelemetry";
import LevelUpModal from "./components/LevelUpModal";
import MasteryGrid from "./components/MasteryGrid";
import SoundOption, { type OptionVisualState } from "./components/SoundOption";
import { useSoundGame } from "./useSoundGame";
import "./SoundShooter.styles.css";

export type SoundShooterProps = {
  onGameEnd?: (score: number) => void;
};

export default function SoundShooter({ onGameEnd }: SoundShooterProps) {
  const {
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
    comboMeter,
    levelLabel,
    bossClears,
    streakMultiplier,
  } = useSoundGame();

  const scoreRef = useRef(score);
  const previousLevelRef = useRef(levelLabel);
  const [levelUpLabel, setLevelUpLabel] = useState<string | null>(null);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || score <= 0) return;

    void submitSoundShooterScore(uid, score).catch((error) => {
      console.warn("sound-shooter score submit failed:", error);
    });
  }, [score]);

  useEffect(
    () => () => {
      if (!onGameEnd || scoreRef.current <= 0) return;
      onGameEnd(scoreRef.current);
    },
    [onGameEnd],
  );

  useEffect(() => {
    if (totalAnswers <= 0) {
      previousLevelRef.current = levelLabel;
      return;
    }

    if (previousLevelRef.current !== levelLabel) {
      setLevelUpLabel(levelLabel);
    }

    previousLevelRef.current = levelLabel;
  }, [levelLabel, totalAnswers]);

  useEffect(() => {
    if (!levelUpLabel) return;
    const timeoutId = window.setTimeout(() => setLevelUpLabel(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [levelUpLabel]);

  const handleSelectOption = useCallback((option: string) => {
    selectOption(option);
  }, [selectOption]);

  useEffect(() => {
    if (isLocked) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const optionIndex = Number(event.key) - 1;
      if (!Number.isInteger(optionIndex)) return;
      if (optionIndex < 0 || optionIndex >= round.options.length) return;
      event.preventDefault();
      selectOption(round.options[optionIndex]);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLocked, round.options, selectOption]);

  function handleResetRun() {
    if (onGameEnd && score > 0) {
      onGameEnd(score);
    }
    resetGame();
  }

  const arenaToneClass =
    feedback?.tone === "success"
      ? "is-hit-good"
      : feedback?.tone === "fail"
        ? "is-hit-bad"
        : "";

  const optionStates = useMemo<Record<string, OptionVisualState>>(() => {
    const states: Record<string, OptionVisualState> = {};

    round.options.forEach((option) => {
      if (!feedback) {
        states[option] = "idle";
        return;
      }

      if (option === feedback.correctOption) {
        states[option] = "correct";
        return;
      }

      if (option === feedback.selectedOption && feedback.tone === "fail") {
        states[option] = "wrong";
        return;
      }

      states[option] = "dimmed";
    });

    return states;
  }, [feedback, round.options]);

  return (
    <main className="game-page sound-shooter-page" aria-label="Sound Shooter game">
      <section className="sound-shooter" aria-live="polite">
        <header className="sound-shooter__hud" aria-label="Run stats">
          <div className="sound-shooter__metric">
            <span>Score</span>
            <strong>{score}</strong>
          </div>
          <div className="sound-shooter__metric">
            <span>Streak</span>
            <strong>{streak}</strong>
          </div>
          <div className="sound-shooter__metric">
            <span>Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div className="sound-shooter__metric">
            <span>Best Streak</span>
            <strong>{bestStreak}</strong>
          </div>
          <div className="sound-shooter__metric">
            <span>Boss Clears</span>
            <strong>{bossClears}</strong>
          </div>
          <button
            type="button"
            className="sound-shooter__reset"
            onClick={handleResetRun}
            aria-label="Reset current run"
          >
            Reset run
          </button>
        </header>

        <section className="sound-shooter__layout">
          <section className={`sound-shooter__arena ${arenaToneClass}`} aria-label="Question arena">
            {lastShot && (
              <div key={`shot-${lastShot.id}`} className="sound-shooter__shot-layer" aria-hidden="true">
                <span className={`sound-shooter__laser is-${lastShot.tone}`} />
                <span className={`sound-shooter__impact is-${lastShot.tone}`} />
              </div>
            )}

            <div className="sound-shooter__arena-head">
              <p className="sound-shooter__subtitle">{round.promptLabel}</p>
              <p className="sound-shooter__subtitle">Answered: {totalAnswers} | Correct: {correctAnswers}</p>
            </div>

            <div className="sound-shooter__tags" aria-hidden="true">
              <span className="sound-shooter__tag">Difficulty {round.difficultyLabel}</span>
              <span className="sound-shooter__tag">Reverse chance {Math.round(round.reverseChance * 100)}%</span>
              <span className="sound-shooter__tag">x{streakMultiplier.toFixed(1)} score multiplier</span>
              {round.isBossRound && <span className="sound-shooter__tag is-boss">Boss round</span>}
            </div>

            <div className="sound-shooter__prompt-wrap">
              <AnimatePresence mode="wait">
                <motion.h2
                  className="sound-shooter__prompt"
                  key={`prompt-${roundId}`}
                  initial={{ opacity: 0, y: 10, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.93 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {formatRussianLetterPair(round.prompt)}
                </motion.h2>
              </AnimatePresence>
            </div>

            <div
              className={`sound-shooter__options ${feedback?.tone === "fail" ? "is-shake" : ""}`}
              role="group"
              aria-label="Answer options"
            >
              {round.options.map((option, index) => (
                <SoundOption
                  key={`${roundId}-${option}`}
                  label={option}
                  state={optionStates[option] ?? "idle"}
                  disabled={isLocked}
                  onSelect={handleSelectOption}
                  ariaLabel={`Option ${index + 1}: ${formatRussianLetterPair(option)}`}
                />
              ))}
            </div>
            <p className="sound-shooter__option-hint">
              Quick keys: {Array.from({ length: round.options.length }, (_, i) => i + 1).join(" ")}
            </p>

            <div className="sound-shooter__combo" aria-label="Combo meter">
              <div className="sound-shooter__combo-head">
                <span>Combo charge</span>
                <strong>{comboMeter}%</strong>
              </div>
              <div className="sound-shooter__combo-track" aria-hidden="true">
                <span className="sound-shooter__combo-fill" style={{ width: `${comboMeter}%` }} />
              </div>
            </div>

            <BattleTelemetry recentResults={recentResults} />

            {feedback && (
              <FeedbackPopup
                id={lastShot?.id ?? roundId}
                tone={feedback.tone}
                message={feedback.message}
                milestone={feedback.milestone}
                isBossClear={feedback.isBossClear}
                speedBonus={feedback.speedBonus}
                awardedPoints={feedback.awardedPoints}
              />
            )}
          </section>

          <aside className="sound-shooter__sidebar" aria-label="Progress panels">
            <MasteryGrid entries={mastery} />
          </aside>
        </section>

        <section className="sound-shooter__card sound-shooter__timeline" aria-label="Recent attempts">
          <header className="sound-shooter__card-header">
            <h3>Recent shots</h3>
          </header>

          {recentResults.length === 0 ? (
            <p className="sound-shooter__empty">No shots yet. Start firing to build your learning trail.</p>
          ) : (
            <div className="sound-shooter__trail">
              {recentResults.map((result) => (
                <article
                  key={`${result.id}-${result.selectedOption}`}
                  className={`sound-shooter__trail-item ${result.isCorrect ? "is-correct" : "is-wrong"}`}
                >
                  <strong>{formatRussianLetterPair(result.prompt)}</strong>
                  <span>
                    {formatRussianLetterPair(result.selectedOption)} / {formatRussianLetterPair(result.correctOption)}
                  </span>
                  {result.isBossRound && <span className="sound-shooter__trail-boss">Boss</span>}
                </article>
              ))}
            </div>
          )}
        </section>

        <LevelUpModal
          isOpen={Boolean(levelUpLabel)}
          levelLabel={levelUpLabel ?? levelLabel}
          streak={streak}
          accuracy={accuracy}
          onClose={() => setLevelUpLabel(null)}
        />
      </section>
    </main>
  );
}
