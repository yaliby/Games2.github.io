import { AnimatePresence, motion } from "framer-motion";
import { formatRussianLetterPair } from "../soundData";
import type { SoundFeedback, SoundRound } from "../useSoundGame";

type LearningPanelProps = {
  round: SoundRound;
  feedback: SoundFeedback | null;
  activeTip: string;
};

const familyLabelMap = {
  sibilant: "Sibilant family",
  hard: "Hard consonants",
  vowel: "Vowel cluster",
  marker: "Marker signs",
} as const;

export default function LearningPanel({ round, feedback, activeTip }: LearningPanelProps) {
  const isRevealed = Boolean(feedback);

  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={`lesson-${round.id}-${round.lesson.sound}`}
        className="sound-shooter__card sound-shooter__learning-card"
        aria-label="Learning panel"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <header className="sound-shooter__card-header">
          <h3>Phonetic Briefing</h3>
          <span className={`sound-shooter__family is-${round.lesson.family}`}>
            {familyLabelMap[round.lesson.family]}
          </span>
        </header>

        {!isRevealed && (
          <p className="sound-shooter__lesson-lock">
            Shoot first to unlock the full explanation and exact letter mapping.
          </p>
        )}

        {isRevealed && (
          <>
            <p className="sound-shooter__lesson-name">
              {round.lesson.russianName} <span>{round.lesson.ipa}</span>
            </p>
            <p className="sound-shooter__lesson-anchor">{round.lesson.englishAnchor}</p>
            <p className="sound-shooter__lesson-letter">
              Letter pair: <strong>{formatRussianLetterPair(round.lesson.letter)}</strong>
            </p>

            <div className="sound-shooter__examples">
              {round.lesson.examples.map((example) => (
                <span key={example} className="sound-shooter__example-chip">{example}</span>
              ))}
            </div>

            <p className="sound-shooter__mnemonic">{round.lesson.mnemonic}</p>
          </>
        )}

        <div className="sound-shooter__tip">
          <strong>Coach tip:</strong> {activeTip}
        </div>

        {feedback && (
          <div className={`sound-shooter__explain is-${feedback.tone}`}>
            <strong>Round debrief:</strong> {feedback.explainer}
          </div>
        )}
      </motion.section>
    </AnimatePresence>
  );
}
