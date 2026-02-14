import { useEffect, useMemo, useState } from "react";
import { formatRussianLetterPair } from "../soundData";
import type { RoundResult } from "../useSoundGame";

type BattleTelemetryProps = {
  recentResults: RoundResult[];
};

type TrendPoint = {
  id: number;
  x: number;
  y: number;
  isCorrect: boolean;
};

function buildTrendPoints(results: RoundResult[]): TrendPoint[] {
  const size = results.length;
  if (size === 0) return [];

  return results.map((result, index) => {
    const x = size === 1 ? 50 : (index / (size - 1)) * 100;
    const y = result.isCorrect ? (result.isBossRound ? 16 : 24) : (result.isBossRound ? 88 : 78);
    return {
      id: result.id,
      x,
      y,
      isCorrect: result.isCorrect,
    };
  });
}

export default function BattleTelemetry({ recentResults }: BattleTelemetryProps) {
  const orderedResults = useMemo(() => [...recentResults].reverse(), [recentResults]);
  const trendPoints = useMemo(() => buildTrendPoints(orderedResults), [orderedResults]);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  useEffect(() => {
    if (orderedResults.length === 0) {
      if (selectedRoundId !== null) {
        setSelectedRoundId(null);
      }
      return;
    }

    const hasSelected = selectedRoundId !== null
      && orderedResults.some((result) => result.id === selectedRoundId);

    if (!hasSelected) {
      setSelectedRoundId(orderedResults[orderedResults.length - 1].id);
    }
  }, [orderedResults, selectedRoundId]);

  const selectedResult = useMemo(() => {
    if (orderedResults.length === 0) return null;
    return orderedResults.find((result) => result.id === selectedRoundId)
      ?? orderedResults[orderedResults.length - 1];
  }, [orderedResults, selectedRoundId]);

  const winCount = orderedResults.filter((result) => result.isCorrect).length;
  const failCount = orderedResults.length - winCount;
  const winRate = orderedResults.length === 0
    ? 0
    : Math.round((winCount / orderedResults.length) * 100);
  const failRate = orderedResults.length === 0 ? 0 : 100 - winRate;

  return (
    <section className="sound-shooter__telemetry" aria-label="Interactive progress display">
      <header className="sound-shooter__telemetry-head">
        <strong>Progress Reactor</strong>
        <span>
          {orderedResults.length === 0
            ? "No rounds yet"
            : `${winCount} wins | ${failCount} fails`}
        </span>
      </header>

      {orderedResults.length === 0 ? (
        <p className="sound-shooter__telemetry-empty">
          Take your first shot. This panel will draw your victory and failure pattern live.
        </p>
      ) : (
        <>
          <div className="sound-shooter__telemetry-chart" role="img" aria-label="Recent rounds trend">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="sound-shooter-telemetry-line" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#63a6d8" />
                  <stop offset="55%" stopColor="#9bc6e0" />
                  <stop offset="100%" stopColor="#dfb761" />
                </linearGradient>
              </defs>

              <line className="sound-shooter__telemetry-guide" x1="0" y1="24" x2="100" y2="24" />
              <line className="sound-shooter__telemetry-guide" x1="0" y1="51" x2="100" y2="51" />
              <line className="sound-shooter__telemetry-guide" x1="0" y1="78" x2="100" y2="78" />

              <polyline
                className="sound-shooter__telemetry-path"
                points={trendPoints.map((point) => `${point.x},${point.y}`).join(" ")}
              />

              {trendPoints.map((point) => (
                <circle
                  key={`telemetry-point-${point.id}`}
                  className={`sound-shooter__telemetry-point is-${point.isCorrect ? "correct" : "fail"} ${
                    point.id === selectedRoundId ? "is-active" : ""
                  }`}
                  cx={point.x}
                  cy={point.y}
                  r={point.id === selectedRoundId ? 3.8 : 2.7}
                />
              ))}
            </svg>
          </div>

          <div className="sound-shooter__telemetry-strip" aria-label="Recent rounds strip">
            {orderedResults.map((result) => (
              <button
                key={`telemetry-chip-${result.id}-${result.selectedOption}`}
                type="button"
                className={`sound-shooter__telemetry-chip is-${result.isCorrect ? "correct" : "fail"} ${
                  selectedRoundId === result.id ? "is-active" : ""
                }`}
                aria-pressed={selectedRoundId === result.id}
                aria-label={`Round ${result.id}: ${result.isCorrect ? "correct" : "wrong"} answer`}
                onClick={() => setSelectedRoundId(result.id)}
                onMouseEnter={() => setSelectedRoundId(result.id)}
                onFocus={() => setSelectedRoundId(result.id)}
              >
                <span>{result.isCorrect ? "Win" : "Miss"}</span>
                <small>#{result.id}</small>
              </button>
            ))}
          </div>

          <div className="sound-shooter__telemetry-meters">
            <div className="sound-shooter__telemetry-meter is-win">
              <span>Win rate {winRate}%</span>
              <div className="sound-shooter__telemetry-track">
                <i className="sound-shooter__telemetry-fill" style={{ width: `${winRate}%` }} />
              </div>
            </div>
            <div className="sound-shooter__telemetry-meter is-fail">
              <span>Failure pressure {failRate}%</span>
              <div className="sound-shooter__telemetry-track">
                <i className="sound-shooter__telemetry-fill" style={{ width: `${failRate}%` }} />
              </div>
            </div>
          </div>

          {selectedResult && (
            <article
              className={`sound-shooter__telemetry-detail is-${selectedResult.isCorrect ? "win" : "fail"}`}
              aria-live="polite"
            >
              <strong>{selectedResult.isCorrect ? "Victory Snapshot" : "Failure Review"}</strong>
              <span>
                Prompt {formatRussianLetterPair(selectedResult.prompt)} | Picked{" "}
                {formatRussianLetterPair(selectedResult.selectedOption)}
              </span>
              <small>
                Correct: {formatRussianLetterPair(selectedResult.correctOption)}
                {selectedResult.isBossRound ? " | Boss round" : ""}
              </small>
            </article>
          )}
        </>
      )}
    </section>
  );
}
