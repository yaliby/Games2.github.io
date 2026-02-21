import { useMemo } from "react";
import { useBackgammon } from "./BackgammonContext";
import { formatMove, getPlayerLabel, getUsedDiceCount, getWinTypeLabel } from "./utils/gameLogic";

export default function GameControls() {
  const {
    state,
    legalMoves,
    selectedSource,
    statusText,
    isRolling,
    canRoll,
    aiEnabled,
    canUndo,
    requestRoll,
    undoMove,
    newGame,
    toggleAi,
  } = useBackgammon();

  const diceSummary = useMemo(() => {
    if (state.isOpeningPhase) {
      if (state.openingRoll.white === null || state.openingRoll.black === null) {
        return "Opening roll not completed yet";
      }
      return `Opening roll: White ${state.openingRoll.white} vs Black ${state.openingRoll.black}`;
    }

    if (state.rolledDice.length === 0) return "No dice rolled yet";

    if (state.rolledDice[0] === state.rolledDice[1]) {
      return `Rolled ${state.rolledDice[0]}-${state.rolledDice[1]} (double)`;
    }

    return `Rolled ${state.rolledDice[0]} and ${state.rolledDice[1]}`;
  }, [state.isOpeningPhase, state.openingRoll.black, state.openingRoll.white, state.rolledDice]);

  const winnerLabel = state.winnerInfo
    ? `${getPlayerLabel(state.winnerInfo.player)} wins: ${getWinTypeLabel(state.winnerInfo.type)} (${state.winnerInfo.points})`
    : null;
  const movesUsed = getUsedDiceCount(state);

  const phaseLabel = useMemo(() => {
    if (state.winner) return "Game over";
    if (state.isOpeningPhase) return "Opening roll";
    if (isRolling) return "Rolling";
    if (state.dice.length === 0) return "Awaiting roll";
    if (legalMoves.length === 0) return "No legal move";
    if (selectedSource === null) return "Select source";
    return "Select destination";
  }, [isRolling, legalMoves.length, selectedSource, state.dice.length, state.isOpeningPhase, state.winner]);

  const lastMoveText = useMemo(() => {
    if (!state.lastMove) return "Last move: -";
    return `Last move: ${getPlayerLabel(state.lastMove.player)} ${formatMove(state.lastMove)}`;
  }, [state.lastMove]);

  return (
    <section className="bgm-controls" aria-label="Game controls">
      <div className="bgm-controls__row">
        <button
          type="button"
          className="bgm-btn bgm-btn--primary"
          onClick={requestRoll}
          disabled={!canRoll}
        >
          {isRolling ? "Rolling..." : "Roll Dice (Space)"}
        </button>

        <button
          type="button"
          className="bgm-btn"
          onClick={toggleAi}
          disabled={!!state.winner}
        >
          {aiEnabled ? "AI: ON" : "AI: OFF"}
        </button>

        <button
          type="button"
          className="bgm-btn"
          onClick={undoMove}
          disabled={!canUndo}
          title={aiEnabled ? "Undo is available in local 2-player mode." : undefined}
        >
          Undo
        </button>

        <button
          type="button"
          className="bgm-btn"
          onClick={newGame}
        >
          New Game
        </button>
      </div>

      <div className="bgm-controls__meta">
        <span>Phase: {phaseLabel}</span>
        <span>{state.isOpeningPhase ? "Turn: Opening" : `Turn ${state.turnNumber}`}</span>
        <span>Current: {state.isOpeningPhase ? "Opening roll" : getPlayerLabel(state.currentPlayer)}</span>
        <span>Dice left: {state.dice.length}</span>
        <span>Moves used: {movesUsed}</span>
      </div>

      <p className="bgm-controls__dice">{diceSummary}</p>
      <p className="bgm-controls__last">{lastMoveText}</p>

      <p className="bgm-controls__status" role="status" aria-live="polite">
        {winnerLabel ? `${winnerLabel} wins!` : statusText}
      </p>
    </section>
  );
}
