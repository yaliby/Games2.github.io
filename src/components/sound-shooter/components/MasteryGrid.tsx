import { formatRussianLetterPair } from "../soundData";
import type { MasteryEntry } from "../useSoundGame";

type MasteryGridProps = {
  entries: MasteryEntry[];
};

function stageLabel(stage: MasteryEntry["stage"]): string {
  if (stage === "mastered") return "Mastered";
  if (stage === "solid") return "Solid";
  if (stage === "learning") return "Learning";
  return "New";
}

export default function MasteryGrid({ entries }: MasteryGridProps) {
  return (
    <section className="sound-shooter__card sound-shooter__mastery-card" aria-label="Mastery progress">
      <header className="sound-shooter__card-header">
        <h3>Mastery Grid</h3>
      </header>

      <div className="sound-shooter__mastery-scroll">
        <div className="sound-shooter__mastery-grid">
          {entries.map((entry) => (
            <article key={entry.sound} className={`sound-shooter__mastery-cell is-${entry.stage}`}>
              <div className="sound-shooter__mastery-main">
                <strong>{entry.sound}</strong>
                <span>{formatRussianLetterPair(entry.letter)}</span>
              </div>
              <div className="sound-shooter__mastery-meta">
                <small className={`sound-shooter__mastery-stage is-${entry.stage}`}>
                  {stageLabel(entry.stage)}
                </small>
                <small className="sound-shooter__mastery-hits">{entry.hits} hits</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
