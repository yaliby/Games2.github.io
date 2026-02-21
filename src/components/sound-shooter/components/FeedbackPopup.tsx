import type { StreakMilestone } from "../soundData";
import type { FeedbackTone } from "../useSoundGame";

type FeedbackPopupProps = {
  id: number;
  tone: FeedbackTone;
  message: string;
  milestone: StreakMilestone | null;
  isBossClear: boolean;
  speedBonus: number;
  awardedPoints: number;
};

export default function FeedbackPopup({
  id,
  tone,
  message,
  milestone,
  isBossClear,
  speedBonus,
  awardedPoints,
}: FeedbackPopupProps) {
  return (
    <div
      key={id}
      className={`sound-shooter__feedback is-${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="sound-shooter__feedback-main">{message}</span>
      {tone === "success" && (
        <span className="sound-shooter__feedback-sub sound-shooter__feedback-reward">
          +{awardedPoints} points
          {speedBonus > 0 ? ` | Quick bonus +${speedBonus}` : ""}
        </span>
      )}
      {milestone && (
        <span className="sound-shooter__feedback-sub">
          {milestone.title}: {milestone.message}
        </span>
      )}
      {isBossClear && (
        <span className="sound-shooter__feedback-sub">Boss cleared. Bonus points awarded.</span>
      )}
    </div>
  );
}
