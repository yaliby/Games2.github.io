import { AnimatePresence, motion } from "framer-motion";

type LevelUpModalProps = {
  isOpen: boolean;
  levelLabel: string;
  streak: number;
  accuracy: number;
  onClose: () => void;
};

export default function LevelUpModal({
  isOpen,
  levelLabel,
  streak,
  accuracy,
  onClose,
}: LevelUpModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="sound-shooter__levelup-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Level up"
        >
          <motion.section
            className="sound-shooter__levelup-modal"
            initial={{ opacity: 0, y: 20, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <p className="sound-shooter__levelup-kicker">Level Up</p>
            <h3>{levelLabel}</h3>
            <p>
              Streak: <strong>{streak}</strong> | Accuracy: <strong>{accuracy}%</strong>
            </p>
            <button type="button" onClick={onClose}>
              Continue
            </button>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
