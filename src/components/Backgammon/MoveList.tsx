import { useMemo } from "react";
import { useBackgammon } from "./BackgammonContext";
import { formatMove, type Move, type MoveSource } from "./utils/gameLogic";

function sourceLabel(source: MoveSource): string {
  return source === "bar" ? "Bar" : `Point ${source + 1}`;
}

function targetLabel(target: Move["to"]): string {
  return target === "off" ? "Off" : `Point ${target + 1}`;
}

function sourceSortValue(source: MoveSource): number {
  if (source === "bar") return -1;
  return source;
}

type MoveGroup = {
  source: MoveSource;
  moves: Move[];
};

export default function MoveList() {
  const {
    state,
    legalMoves,
    selectedSource,
    aiEnabled,
    isRolling,
    movePiece,
  } = useBackgammon();

  const disableMoves = isRolling
    || !!state.winner
    || (aiEnabled && state.currentPlayer === "black");

  const visibleMoves = useMemo(() => {
    if (selectedSource === null) return [] as Move[];
    return legalMoves.filter((move) => move.from === selectedSource);
  }, [legalMoves, selectedSource]);

  const moveGroups = useMemo<MoveGroup[]>(() => {
    const sorted = [...visibleMoves].sort((a, b) => {
      const sourceDelta = sourceSortValue(a.from) - sourceSortValue(b.from);
      if (sourceDelta !== 0) return sourceDelta;

      if (a.die !== b.die) return b.die - a.die;

      const aTarget = a.to === "off" ? -1 : a.to;
      const bTarget = b.to === "off" ? -1 : b.to;
      return aTarget - bTarget;
    });

    const groupsBySource = new Map<string, MoveGroup>();

    for (const move of sorted) {
      const key = String(move.from);
      const existing = groupsBySource.get(key);

      if (existing) {
        existing.moves.push(move);
      } else {
        groupsBySource.set(key, {
          source: move.from,
          moves: [move],
        });
      }
    }

    return [...groupsBySource.values()];
  }, [visibleMoves]);

  return (
    <section className="bgm-moves" aria-label="Quick legal moves">
      <header className="bgm-moves__header">
        <h3>Quick Moves</h3>
        <span>{selectedSource === null ? "Pick source" : `${visibleMoves.length} legal`}</span>
      </header>

      {state.dice.length === 0 && (
        <p className="bgm-moves__empty">
          {state.isOpeningPhase ? "Complete opening roll first." : "Roll dice to reveal legal moves."}
        </p>
      )}

      {state.dice.length > 0 && legalMoves.length === 0 && (
        <p className="bgm-moves__empty">No legal move for this roll.</p>
      )}

      {state.dice.length > 0 && legalMoves.length > 0 && selectedSource === null && (
        <p className="bgm-moves__empty">Step 1: choose source on board. Step 2: moves appear here.</p>
      )}

      {state.dice.length > 0 && legalMoves.length > 0 && selectedSource !== null && visibleMoves.length === 0 && (
        <p className="bgm-moves__empty">No moves from selected source. Choose a different checker.</p>
      )}

      {state.dice.length > 0 && visibleMoves.length > 0 && (
        <div className="bgm-moves__groups">
          {moveGroups.map((group) => (
            <div className="bgm-moves__group" key={String(group.source)}>
              <div className="bgm-moves__source">{sourceLabel(group.source)}</div>
              <div className="bgm-moves__list">
                {group.moves.map((move, index) => (
                  <button
                    key={`${String(group.source)}:${move.die}:${String(move.to)}:${index}`}
                    type="button"
                    className="bgm-move-btn"
                    onClick={() => movePiece(move)}
                    disabled={disableMoves}
                    title={formatMove(move)}
                  >
                    <span>{targetLabel(move.to)}</span>
                    <span>d{move.die}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
