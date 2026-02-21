import { createContext, useContext } from "react";
import type { BackgammonState, Move, MoveSource } from "./utils/gameLogic";

export type RollSource = "physics" | "fallback";
export type HomeQuadrant = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type BackgammonContextValue = {
  state: BackgammonState;
  legalMoves: Move[];
  statusText: string;
  isRolling: boolean;
  canRoll: boolean;
  rollRequestToken: number;
  aiEnabled: boolean;
  isAutomatedTurn: boolean;
  homeQuadrant: HomeQuadrant;
  canUndo: boolean;
  selectedSource: MoveSource | null;
  requestRoll: () => void;
  movePiece: (move: Move) => void;
  setSelectedSource: (source: MoveSource | null) => void;
  undoMove: () => void;
  newGame: () => void;
  toggleAi: () => void;
  onDiceRollStart: () => void;
  onDiceRollComplete: (values: [number, number], source: RollSource) => void;
};

const BackgammonContext = createContext<BackgammonContextValue | null>(null);

export function useBackgammon(): BackgammonContextValue {
  const value = useContext(BackgammonContext);
  if (!value) {
    throw new Error("useBackgammon must be used inside BackgammonContext.Provider");
  }

  return value;
}

export default BackgammonContext;
