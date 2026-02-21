import { useMemo } from "react";
import { useBackgammon } from "./BackgammonContext";
import {
  calculatePipCount,
  countPiecesInPlay,
  getPlayerLabel,
  type PlayerId,
} from "./utils/gameLogic";

function PlayerCard({ player, aiEnabled }: { player: PlayerId; aiEnabled: boolean }) {
  const { state } = useBackgammon();

  const isCurrent = !state.isOpeningPhase && state.currentPlayer === player;
  const isWinner = state.winner === player;
  const piecesInPlay = countPiecesInPlay(state, player);

  const pipCount = useMemo(() => calculatePipCount(state, player), [state, player]);
  const totalBorneOff = state.borneOff[player];

  return (
    <article
      className={`bgm-player-card${isCurrent ? " is-current" : ""}${isWinner ? " is-winner" : ""}`}
      aria-label={`${getPlayerLabel(player)} player details`}
    >
      <header className="bgm-player-card__header">
        <h3>{getPlayerLabel(player)}</h3>
        <span>{player === "black" && aiEnabled ? "AI" : "Human"}</span>
      </header>

      <div className="bgm-player-card__stats">
        <span>On board: {piecesInPlay}</span>
        <span>On bar: {state.bar[player]}</span>
        <span>Borne off: {totalBorneOff}</span>
        <span>Pip count: {pipCount}</span>
      </div>
    </article>
  );
}

export default function Player() {
  const { aiEnabled } = useBackgammon();

  return (
    <section className="bgm-players" aria-label="Players">
      <PlayerCard player="white" aiEnabled={aiEnabled} />
      <PlayerCard player="black" aiEnabled={aiEnabled} />
    </section>
  );
}
