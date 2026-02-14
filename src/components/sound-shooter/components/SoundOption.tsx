import { formatRussianLetterPair } from "../soundData";

export type OptionVisualState = "idle" | "correct" | "wrong" | "dimmed";

type SoundOptionProps = {
  label: string;
  disabled: boolean;
  state: OptionVisualState;
  onSelect: (option: string) => void;
  ariaLabel?: string;
};

export default function SoundOption({
  label,
  disabled,
  state,
  onSelect,
  ariaLabel,
}: SoundOptionProps) {
  const displayLabel = formatRussianLetterPair(label);

  return (
    <button
      type="button"
      className={`sound-shooter__option is-${state}`}
      disabled={disabled}
      onClick={() => onSelect(label)}
      aria-label={ariaLabel ?? `Option ${displayLabel}`}
    >
      <span>{displayLabel}</span>
    </button>
  );
}
