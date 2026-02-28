import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Board from "./Board";
import Dice from "./Dice";
import OpeningRollOverlay from "./OpeningRollOverlay";
import BackgammonContext, {
  type BoardThemeId,
  type HomeQuadrant,
  type RollSource,
} from "./BackgammonContext";
import {
  applyMove,
  chooseAiMove,
  createInitialState,
  formatMove,
  getLegalMoves,
  getPlayerLabel,
  getWinTypeLabel,
  passTurn,
  rollDice,
  type BackgammonState,
  type Move,
  type MoveSource,
  type PlayerId,
} from "./utils/gameLogic";
import "./BackgammonGame.css";

const AI_ROLL_DELAY_MS = 500;
const AI_MOVE_DELAY_MS = 650;
const BACKGAMMON_STORAGE_KEY = "backgammon:session:v1";

type GameView = "lobby" | "opening" | "game";
type OpponentMode = "ai" | "local" | "bot-vs-bot";

type BackgammonSetup = {
  opponent: OpponentMode;
  homeQuadrant: HomeQuadrant;
  boardTheme: BoardThemeId;
};

type OpeningRolls = Record<PlayerId, number | null>;
type PersistedBackgammonSetup = Omit<BackgammonSetup, "boardTheme"> & { boardTheme?: BoardThemeId };
type PersistedBackgammonSession = {
  version: 1;
  view: GameView;
  setup: PersistedBackgammonSetup;
  state: BackgammonState;
  statusText: string;
  aiEnabled: boolean;
  whiteAiEnabled: boolean;
  openingRolls: OpeningRolls;
  openingRound: number;
  openingText: string;
};

const BOARD_THEME_OPTIONS: Array<{
  id: BoardThemeId;
  label: string;
  description: string;
}> = [
  { id: "classic", label: "קלאסי", description: "עץ חם ולבד ירוק מסורתי" },
  { id: "midnight", label: "Midnight", description: "לוח כהה עם ניגוד כחול קר" },
  { id: "emerald", label: "Emerald", description: "גווני אמרלד עם מסגרת ברונזה" },
  { id: "sunset", label: "Sunset", description: "גווני שקיעה עם תחושת ארקייד" },
  { id: "coyote", label: "Coyote", description: "גווני חול וקניון חמים" },
  { id: "devops", label: "DevOps", description: "סייבר טכני בירוק-כחול" },
];

function getBoardThemeLabel(theme: BoardThemeId): string {
  switch (theme) {
    case "classic":
      return "קלאסי";
    case "midnight":
      return "Midnight";
    case "emerald":
      return "Emerald";
    case "sunset":
      return "Sunset";
    case "coyote":
      return "Coyote";
    case "devops":
      return "DevOps";
    default:
      return "קלאסי";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDieValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

function isPlayerIdValue(value: unknown): value is PlayerId {
  return value === "white" || value === "black";
}

function isOpponentMode(value: unknown): value is OpponentMode {
  return value === "ai" || value === "local" || value === "bot-vs-bot";
}

function isHomeQuadrantValue(value: unknown): value is HomeQuadrant {
  return value === "top-left"
    || value === "top-right"
    || value === "bottom-left"
    || value === "bottom-right";
}

function isBoardThemeValue(value: unknown): value is BoardThemeId {
  return value === "classic"
    || value === "midnight"
    || value === "emerald"
    || value === "sunset"
    || value === "coyote"
    || value === "devops";
}

function isGameView(value: unknown): value is GameView {
  return value === "lobby" || value === "opening" || value === "game";
}

function isBoardPointIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isWinTypeValue(value: unknown): boolean {
  return value === "normal" || value === "mars" || value === "turkish-mars";
}

function isValidPointState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const owner = value.owner;
  const count = value.count;
  return (owner === null || isPlayerIdValue(owner)) && isNonNegativeInteger(count);
}

function isValidOpeningRolls(value: unknown): value is OpeningRolls {
  if (!isRecord(value)) return false;
  const white = value.white;
  const black = value.black;
  const isValidDieOrNull = (die: unknown) => die === null || isDieValue(die);
  return isValidDieOrNull(white) && isValidDieOrNull(black);
}

function isValidMoveSource(value: unknown): boolean {
  return value === "bar" || isBoardPointIndex(value);
}

function isValidMoveTarget(value: unknown): boolean {
  return value === "off" || isBoardPointIndex(value);
}

function isValidLastMove(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;

  const player = value.player;
  const from = value.from;
  const to = value.to;
  const die = value.die;
  const hit = value.hit;
  const id = value.id;

  if (!isPlayerIdValue(player)) return false;
  if (!isValidMoveSource(from)) return false;
  if (!isValidMoveTarget(to)) return false;
  if (!isDieValue(die)) return false;
  if (typeof hit !== "boolean") return false;
  if (id !== undefined && !isNonNegativeInteger(id)) return false;

  return true;
}

function isValidWinnerInfo(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;

  return isPlayerIdValue(value.player)
    && isWinTypeValue(value.type)
    && (value.points === 1 || value.points === 2 || value.points === 3);
}

function isValidBackgammonState(value: unknown): value is BackgammonState {
  if (!isRecord(value)) return false;

  const points = value.points;
  const bar = value.bar;
  const borneOff = value.borneOff;
  const currentPlayer = value.currentPlayer;
  const isOpeningPhase = value.isOpeningPhase;
  const openingRoll = value.openingRoll;
  const dice = value.dice;
  const rolledDice = value.rolledDice;
  const winner = value.winner;
  const winnerInfo = value.winnerInfo;
  const turnNumber = value.turnNumber;
  const moveCounter = value.moveCounter;
  const lastMove = value.lastMove;

  if (!Array.isArray(points) || points.length !== 24 || !points.every(isValidPointState)) return false;
  if (!isRecord(bar) || !isNonNegativeInteger(bar.white) || !isNonNegativeInteger(bar.black)) return false;
  if (!isRecord(borneOff) || !isNonNegativeInteger(borneOff.white) || !isNonNegativeInteger(borneOff.black)) return false;
  if (!isPlayerIdValue(currentPlayer)) return false;
  if (typeof isOpeningPhase !== "boolean") return false;
  if (!isValidOpeningRolls(openingRoll)) return false;
  if (!Array.isArray(dice) || !dice.every(isDieValue)) return false;
  if (!Array.isArray(rolledDice) || !rolledDice.every(isDieValue)) return false;
  if (winner !== null && !isPlayerIdValue(winner)) return false;
  if (!isValidWinnerInfo(winnerInfo)) return false;
  if (!isNonNegativeInteger(turnNumber)) return false;
  if (!isNonNegativeInteger(moveCounter)) return false;
  if (!isValidLastMove(lastMove)) return false;

  return true;
}

function isValidSetup(value: unknown): value is PersistedBackgammonSetup {
  if (!isRecord(value)) return false;
  return isOpponentMode(value.opponent)
    && isHomeQuadrantValue(value.homeQuadrant)
    && (value.boardTheme === undefined || isBoardThemeValue(value.boardTheme));
}

function isPersistedSession(value: unknown): value is PersistedBackgammonSession {
  if (!isRecord(value)) return false;
  return value.version === 1
    && isGameView(value.view)
    && isValidSetup(value.setup)
    && isValidBackgammonState(value.state)
    && typeof value.statusText === "string"
    && typeof value.aiEnabled === "boolean"
    && typeof value.whiteAiEnabled === "boolean"
    && isValidOpeningRolls(value.openingRolls)
    && isNonNegativeInteger(value.openingRound)
    && typeof value.openingText === "string";
}

function readPersistedSession(): PersistedBackgammonSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(BACKGAMMON_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSession(snapshot: PersistedBackgammonSession): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(BACKGAMMON_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures (quota/private mode).
  }
}

function normalizeRestoredView(view: GameView, restoredState: BackgammonState): GameView {
  if (view === "opening" && !restoredState.isOpeningPhase) return "game";
  if (view === "game" && restoredState.isOpeningPhase) return "opening";
  return view;
}

function describeRoll(values: [number, number]): string {
  if (values[0] === values[1]) {
    return `${values[0]}-${values[1]} (כפול)`;
  }

  return `${values[0]} ו-${values[1]}`;
}

function createEmptyOpeningRolls(): OpeningRolls {
  return { white: null, black: null };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (["input", "textarea", "select", "button"].includes(tag)) return true;
  return target.isContentEditable;
}

export default function BackgammonGame() {
  const [view, setView] = useState<GameView>("lobby");
  const [setup, setSetup] = useState<BackgammonSetup>({
    opponent: "ai",
    homeQuadrant: "bottom-left",
    boardTheme: "classic",
  });

  const [state, setState] = useState<BackgammonState>(() => createInitialState());
  const [statusText, setStatusText] = useState("גלגול פתיחה: כל שחקן מגלגל קובייה אחת.");
  const [isRolling, setIsRolling] = useState(false);
  const [rollRequestToken, setRollRequestToken] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [whiteAiEnabled, setWhiteAiEnabled] = useState(false);
  const [history, setHistory] = useState<BackgammonState[]>([]);
  const [selectedSource, setSelectedSource] = useState<MoveSource | null>(null);
  const [starterSplash, setStarterSplash] = useState<{
    player: PlayerId;
    white: number;
    black: number;
  } | null>(null);

  const [openingRolls, setOpeningRolls] = useState<OpeningRolls>(() => createEmptyOpeningRolls());
  const [openingRound, setOpeningRound] = useState(1);
  const [openingText, setOpeningText] = useState("סבב פתיחה 1: לחצו על כל צד מתי שתרצו להטיל.");
  const [hasLoadedPersistence, setHasLoadedPersistence] = useState(false);
  const openingRollsRef = useRef<OpeningRolls>(openingRolls);

  useEffect(() => {
    openingRollsRef.current = openingRolls;
  }, [openingRolls]);

  useEffect(() => {
    const persisted = readPersistedSession();

    if (persisted) {
      const restoredView = normalizeRestoredView(persisted.view, persisted.state);
      setView(restoredView);
      setSetup({
        opponent: persisted.setup.opponent,
        homeQuadrant: persisted.setup.homeQuadrant,
        boardTheme: persisted.setup.boardTheme ?? "classic",
      });
      setState(persisted.state);
      setStatusText(persisted.statusText);
      setAiEnabled(persisted.aiEnabled);
      setWhiteAiEnabled(persisted.whiteAiEnabled);
      openingRollsRef.current = persisted.openingRolls;
      setOpeningRolls(persisted.openingRolls);
      setOpeningRound(persisted.openingRound);
      setOpeningText(persisted.openingText);
      setHistory([]);
      setSelectedSource(null);
      setStarterSplash(null);
      setIsRolling(false);
      setRollRequestToken(0);
    }

    setHasLoadedPersistence(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistence) return;

    writePersistedSession({
      version: 1,
      view,
      setup,
      state,
      statusText,
      aiEnabled,
      whiteAiEnabled,
      openingRolls,
      openingRound,
      openingText,
    });
  }, [
    aiEnabled,
    hasLoadedPersistence,
    openingRolls,
    openingRound,
    openingText,
    setup,
    state,
    statusText,
    view,
    whiteAiEnabled,
  ]);

  const legalMoves = useMemo(() => getLegalMoves(state), [state]);
  const isAutomatedTurn = view === "game"
    && !state.isOpeningPhase
    && !state.winner
    && (
      (state.currentPlayer === "black" && aiEnabled)
      || (state.currentPlayer === "white" && whiteAiEnabled)
    );
  const canUndo = view === "game"
    && !aiEnabled
    && !whiteAiEnabled
    && !isRolling
    && !state.winner
    && history.length > 0;

  const canRoll = view === "game"
    && !isRolling
    && !state.winner
    && !state.isOpeningPhase
    && state.dice.length === 0
    && !isAutomatedTurn;

  const canRollOpeningWhite = view === "opening"
    && state.isOpeningPhase
    && openingRolls.white === null;

  const canRollOpeningBlack = view === "opening"
    && state.isOpeningPhase
    && openingRolls.black === null;

  const openingTie = state.isOpeningPhase
    && openingRolls.white !== null
    && openingRolls.black !== null
    && openingRolls.white === openingRolls.black;

  const resetMatch = useCallback((message: string) => {
    setState(createInitialState());
    setStatusText(message);
    setIsRolling(false);
    setRollRequestToken(0);
    setHistory([]);
    setSelectedSource(null);
    setStarterSplash(null);
  }, []);

  const resetOpeningFlow = useCallback((round: number, message: string) => {
    const empty = createEmptyOpeningRolls();
    openingRollsRef.current = empty;
    setOpeningRolls(empty);
    setOpeningRound(round);
    setOpeningText(message);
  }, []);

  const startConfiguredGame = useCallback(() => {
    setAiEnabled(setup.opponent === "ai" || setup.opponent === "bot-vs-bot");
    setWhiteAiEnabled(setup.opponent === "bot-vs-bot");
    resetMatch("המשחק מוכן. קודם גלגול פתיחה.");
    resetOpeningFlow(1, "סבב פתיחה 1: לחצו על כל צד מתי שתרצו להטיל.");
    setView("opening");
  }, [resetMatch, resetOpeningFlow, setup.opponent]);

  const backToSetup = useCallback(() => {
    setView("lobby");
    setSelectedSource(null);
    setIsRolling(false);
    setStarterSplash(null);
  }, []);

  const newGame = useCallback(() => {
    backToSetup();
  }, [backToSetup]);

  const onOpeningRollResult = useCallback((player: PlayerId, value: number, source: RollSource) => {
    if (view !== "opening") return;
    if (!state.isOpeningPhase) return;
    if (openingRollsRef.current[player] !== null) return;

    const sourceLabel = source === "physics" ? "פיזיקה" : "גיבוי";
    const rolledBy = getPlayerLabel(player);
    const waitingFor = getPlayerLabel(player === "white" ? "black" : "white");
    const nextRolls: OpeningRolls = {
      ...openingRollsRef.current,
      [player]: value,
    };
    openingRollsRef.current = nextRolls;
    setOpeningRolls(nextRolls);
    const nextWhite = nextRolls.white;
    const nextBlack = nextRolls.black;

    if (nextWhite === null || nextBlack === null) {
      setOpeningText(`${rolledBy} גלגל ${value} (${sourceLabel}). ממתינים ל-${waitingFor}.`);
      return;
    }

    if (nextWhite === nextBlack) {
      setOpeningText(`תיקו בגלגול פתיחה (${nextWhite}-${nextBlack}). מבוצע גלגול חוזר אוטומטי...`);
      return;
    }

    const starter: PlayerId = nextWhite > nextBlack ? "white" : "black";
    const seeded = createInitialState();
    seeded.isOpeningPhase = false;
    seeded.currentPlayer = starter;
    seeded.openingRoll = { white: nextWhite, black: nextBlack };
    seeded.rolledDice = [];
    seeded.dice = [];
    seeded.turnNumber = 1;

    setState(seeded);
    setHistory([]);
    setSelectedSource(null);
    setIsRolling(false);
    setRollRequestToken(0);
    setStarterSplash({
      player: starter,
      white: nextWhite,
      black: nextBlack,
    });
    setOpeningText(`לבן גלגל ${nextWhite}, שחור גלגל ${nextBlack}. ${getPlayerLabel(starter)} מתחיל.`);
    setStatusText(`גלגול פתיחה: לבן ${nextWhite}, שחור ${nextBlack}. ${getPlayerLabel(starter)} מתחיל. עכשיו צריך להטיל קוביות לתור הראשון.`);
  }, [state.isOpeningPhase, view]);

  const rerollOpening = useCallback(() => {
    const nextRound = openingRound + 1;
    resetOpeningFlow(nextRound, `סבב פתיחה ${nextRound}: לחצו על כל צד מתי שתרצו להטיל.`);
  }, [openingRound, resetOpeningFlow]);

  const requestRoll = useCallback(() => {
    if (!canRoll) return;

    setStatusText(`${getPlayerLabel(state.currentPlayer)} מגלגל...`);
    setRollRequestToken((token) => token + 1);
  }, [canRoll, state.currentPlayer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view !== "game") return;
      if (event.code !== "Space") return;
      if (isTypingTarget(event.target)) return;
      if (!canRoll) return;
      event.preventDefault();
      requestRoll();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRoll, requestRoll, view]);

  const movePiece = useCallback((move: Move) => {
    if (isRolling) return;

    let previousSnapshot: BackgammonState | null = null;
    let nextStatus = "";

    setState((previous) => {
      const next = applyMove(previous, move);
      if (next.moveCounter === previous.moveCounter) {
        return previous;
      }

      previousSnapshot = previous;

      const movedBy = previous.currentPlayer;
      const moveText = formatMove(move);

      if (next.winner) {
        const winnerInfo = next.winnerInfo;
        if (winnerInfo) {
          nextStatus = `${getPlayerLabel(next.winner)} ניצח: ${getWinTypeLabel(winnerInfo.type)} (${winnerInfo.points} נקודות).`;
        } else {
          nextStatus = `${getPlayerLabel(next.winner)} ניצח.`;
        }
      } else if (next.currentPlayer !== movedBy) {
        nextStatus = `${getPlayerLabel(movedBy)} שיחק ${moveText}. תור ${getPlayerLabel(next.currentPlayer)}.`;
      } else {
        nextStatus = `${getPlayerLabel(movedBy)} שיחק ${moveText}.`;
      }

      return next;
    });

    if (previousSnapshot && !aiEnabled) {
      setHistory((previous) => [...previous.slice(-79), previousSnapshot!]);
    }

    setSelectedSource(null);

    if (nextStatus) {
      setStatusText(nextStatus);
    }
  }, [aiEnabled, isRolling]);

  const undoMove = useCallback(() => {
    if (!canUndo) return;

    const snapshot = history[history.length - 1];
    if (!snapshot) return;

    setHistory((previous) => previous.slice(0, -1));
    setState(snapshot);
    setSelectedSource(null);
    setStatusText(`מהלך בוטל. ${getPlayerLabel(snapshot.currentPlayer)} בתור.`);
  }, [canUndo, history]);

  const toggleAi = useCallback(() => {
    setAiEnabled((enabled) => {
      const next = !enabled;
      setWhiteAiEnabled(false);
      setSetup((previous) => ({
        ...previous,
        opponent: next ? "ai" : "local",
      }));
      setStatusText(next ? "מצב נגד מחשב הופעל." : "מצב 2 שחקנים מקומי.");
      return next;
    });
    setHistory([]);
    setSelectedSource(null);
  }, []);

  const onDiceRollStart = useCallback(() => {
    setIsRolling(true);
  }, []);

  const onDiceRollComplete = useCallback((values: [number, number], source: RollSource) => {
    setIsRolling(false);
    setSelectedSource(null);

    let nextStatus = "";

    setState((previous) => {
      const openingRoll = previous.isOpeningPhase;
      const roller = previous.currentPlayer;
      const rolled = rollDice(previous, values);

      const sourceLabel = source === "physics" ? "פיזיקה" : "גיבוי";
      const rollText = describeRoll(values);

      if (openingRoll) {
        const openingWhite = rolled.openingRoll.white;
        const openingBlack = rolled.openingRoll.black;

        if (openingWhite === openingBlack) {
          nextStatus = `תיקו בגלגול פתיחה (${openingWhite}-${openingBlack}, ${sourceLabel}). צריך לגלגל שוב.`;
          return rolled;
        }

        const starter = rolled.currentPlayer;
        nextStatus = `גלגול פתיחה: לבן ${openingWhite}, שחור ${openingBlack} (${sourceLabel}). ${getPlayerLabel(starter)} מתחיל ומשחק ${rollText}.`;
        return rolled;
      }

      const moves = getLegalMoves(rolled);

      if (moves.length === 0) {
        const passed = passTurn(rolled);
        nextStatus = `${getPlayerLabel(roller)} גלגל ${rollText} (${sourceLabel}) ואין מהלך חוקי. התור עובר.`;
        return passed;
      }

      nextStatus = `${getPlayerLabel(roller)} גלגל ${rollText} (${sourceLabel}).`;
      return rolled;
    });

    if (nextStatus) {
      setStatusText(nextStatus);
    }
  }, []);

  useEffect(() => {
    if (view !== "game") return;
    if (!isAutomatedTurn) return;
    if (isRolling) return;

    if (state.dice.length === 0) {
      const timer = window.setTimeout(() => {
        setStatusText(`${getPlayerLabel(state.currentPlayer)} (מחשב) מגלגל...`);
        setRollRequestToken((token) => token + 1);
      }, AI_ROLL_DELAY_MS);

      return () => window.clearTimeout(timer);
    }

    const aiMove = chooseAiMove(state);
    if (!aiMove) {
      setStatusText(`ל-${getPlayerLabel(state.currentPlayer)} (מחשב) אין מהלכים חוקיים. התור עובר.`);
      setState((previous) => passTurn(previous));
      return;
    }

    const timer = window.setTimeout(() => {
      movePiece(aiMove);
    }, AI_MOVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isAutomatedTurn, isRolling, movePiece, state, view]);

  useEffect(() => {
    if (!starterSplash) return;
    if (view !== "opening") return;

    const timer = window.setTimeout(() => {
      setStarterSplash(null);
      setView("game");
    }, 1900);

    return () => window.clearTimeout(timer);
  }, [starterSplash, view]);

  useEffect(() => {
    if (view !== "opening") return;
    if (!openingTie) return;
    if (starterSplash) return;

    const timer = window.setTimeout(() => {
      rerollOpening();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [openingTie, rerollOpening, starterSplash, view]);

  const winnerSummary = state.winnerInfo
    ? `${getPlayerLabel(state.winnerInfo.player)}: ${getWinTypeLabel(state.winnerInfo.type)} (${state.winnerInfo.points} נק')`
    : null;
  const winnerSplashMeta = state.winnerInfo
    ? `${getWinTypeLabel(state.winnerInfo.type)} • ${state.winnerInfo.points} נקודות`
    : null;

  const phaseSummary = state.isOpeningPhase
    ? "גלגול פתיחה"
    : `תור ${state.turnNumber} - ${getPlayerLabel(state.currentPlayer)}`;

  const contextValue = useMemo(() => ({
    state,
    legalMoves,
    statusText,
    isRolling,
    canRoll,
    rollRequestToken,
    aiEnabled,
    isAutomatedTurn,
    homeQuadrant: setup.homeQuadrant,
    canUndo,
    selectedSource,
    requestRoll,
    movePiece,
    setSelectedSource,
    undoMove,
    newGame,
    toggleAi,
    onDiceRollStart,
    onDiceRollComplete,
  }), [
    aiEnabled,
    canRoll,
    canUndo,
    isAutomatedTurn,
    setup.homeQuadrant,
    isRolling,
    legalMoves,
    movePiece,
    newGame,
    onDiceRollComplete,
    onDiceRollStart,
    requestRoll,
    rollRequestToken,
    selectedSource,
    state,
    statusText,
    toggleAi,
    undoMove,
  ]);

  if (view === "lobby") {
    return (
      <main className="bgm-shell game-page">
        <section className="bgm-lobby">
          <article className="bgm-lobby__card">
            <h2>שש-בש</h2>
            <p>בחרו הגדרות משחק. גלגול הפתיחה יופיע בחלון מרכזי מעל המשחק.</p>

            <div className="bgm-lobby__group">
              <span>יריב</span>
              <div className="bgm-lobby__choices">
                <button
                  type="button"
                  className={`bgm-choice${setup.opponent === "ai" ? " is-active" : ""}`}
                  onClick={() => setSetup((previous) => ({ ...previous, opponent: "ai" }))}
                >
                  נגד מחשב
                </button>
                <button
                  type="button"
                  className={`bgm-choice${setup.opponent === "local" ? " is-active" : ""}`}
                  onClick={() => setSetup((previous) => ({ ...previous, opponent: "local" }))}
                >
                  2 שחקנים מקומי
                </button>
                <button
                  type="button"
                  className={`bgm-choice${setup.opponent === "bot-vs-bot" ? " is-active" : ""}`}
                  onClick={() => setSetup((previous) => ({ ...previous, opponent: "bot-vs-bot" }))}
                >
                  בוט נגד בוט
                </button>
              </div>
            </div>

            <div className="bgm-lobby__group">
              <span>מיקום הבית שלך</span>
              <div className="bgm-home-picker" role="radiogroup" aria-label="בחירת מיקום הבית">
                <div className="bgm-home-picker__board">
                  <div className="bgm-home-picker__felt" />
                  <div className="bgm-home-picker__bar" />
                  <div className="bgm-home-picker__cross" />
                  <button
                    type="button"
                    role="radio"
                    aria-checked={setup.homeQuadrant === "top-left"}
                    className={`bgm-home-picker__cell is-top-left${setup.homeQuadrant === "top-left" ? " is-active" : ""}`}
                    onClick={() => setSetup((previous) => ({ ...previous, homeQuadrant: "top-left" }))}
                  >
                    <span>שמאל למעלה</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={setup.homeQuadrant === "top-right"}
                    className={`bgm-home-picker__cell is-top-right${setup.homeQuadrant === "top-right" ? " is-active" : ""}`}
                    onClick={() => setSetup((previous) => ({ ...previous, homeQuadrant: "top-right" }))}
                  >
                    <span>ימין למעלה</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={setup.homeQuadrant === "bottom-left"}
                    className={`bgm-home-picker__cell is-bottom-left${setup.homeQuadrant === "bottom-left" ? " is-active" : ""}`}
                    onClick={() => setSetup((previous) => ({ ...previous, homeQuadrant: "bottom-left" }))}
                  >
                    <span>שמאל למטה</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={setup.homeQuadrant === "bottom-right"}
                    className={`bgm-home-picker__cell is-bottom-right${setup.homeQuadrant === "bottom-right" ? " is-active" : ""}`}
                    onClick={() => setSetup((previous) => ({ ...previous, homeQuadrant: "bottom-right" }))}
                  >
                    <span>ימין למטה</span>
                  </button>
                </div>
                <p className="bgm-home-picker__hint">לחצו על אחד מארבעת הרבעים בלוח כדי לבחור את הבית שלכם.</p>
              </div>
            </div>

            <div className="bgm-lobby__group">
              <span>ערכת נושא ללוח</span>
              <div className="bgm-lobby__choices bgm-lobby__choices--themes">
                {BOARD_THEME_OPTIONS.map((themeOption) => (
                  <button
                    key={themeOption.id}
                    type="button"
                    className={`bgm-choice bgm-choice--theme${setup.boardTheme === themeOption.id ? " is-active" : ""}`}
                    aria-pressed={setup.boardTheme === themeOption.id}
                    onClick={() => setSetup((previous) => ({ ...previous, boardTheme: themeOption.id }))}
                  >
                    <span className={`bgm-theme-preview is-${themeOption.id}`} aria-hidden="true">
                      <span className="bgm-theme-preview__felt" />
                      <span className="bgm-theme-preview__bar" />
                    </span>
                    <strong>{themeOption.label}</strong>
                    <small>{themeOption.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="bgm-lobby__start-row">
              <button
                type="button"
                className="bgm-btn bgm-btn--primary bgm-lobby__start"
                onClick={startConfiguredGame}
              >
                התחל משחק
              </button>
            </div>
          </article>
        </section>
      </main>
    );
  }

  if (view === "opening") {
    return (
      <main className="bgm-shell game-page">
        {starterSplash && (
          <div className="bgm-starter-splash" aria-live="polite">
            <article className={`bgm-starter-splash__badge is-${starterSplash.player}`}>
              <strong>{getPlayerLabel(starterSplash.player)} מתחיל לשחק</strong>
              <span>גלגול פתיחה: לבן {starterSplash.white}, שחור {starterSplash.black}</span>
            </article>
          </div>
        )}

        <OpeningRollOverlay
          rolls={openingRolls}
          round={openingRound}
          message={openingText}
          canRollWhite={canRollOpeningWhite}
          canRollBlack={canRollOpeningBlack}
          canReroll={openingTie}
          onRollResult={onOpeningRollResult}
          onReroll={rerollOpening}
          onBackToSetup={backToSetup}
        />
      </main>
    );
  }

  return (
    <main className="bgm-shell game-page">
      <BackgammonContext.Provider value={contextValue}>
        {state.winner && (
          <div className="bgm-winner-splash" aria-live="polite">
            <article className={`bgm-winner-splash__badge is-${state.winner}`}>
              <strong>{getPlayerLabel(state.winner)} ניצח</strong>
              <span>{winnerSplashMeta ?? "ניצחון במשחק"}</span>
            </article>
          </div>
        )}

        <section className="bgm-stage">
          <section className="bgm-quick-guide controls-only" aria-label="מדריך קליקים ואינדיקטורים">
            <div className="bgm-guide-chip is-left bgm-guide-chip--lmb">
              <strong>קליק שמאלי</strong>
              <span>בחירת יעד מודגש לתזוזה</span>
            </div>
            <div className="bgm-guide-chip is-right bgm-guide-chip--rmb">
              <strong>קליק ימני</strong>
              <span>בחירת חייל או מקור</span>
            </div>
            <div className="bgm-guide-chip is-purple bgm-guide-chip--sum">
              <strong>אינדיקטור סגול</strong>
              <span>יעד מצטבר לאותו חייל עם סכום 2 קוביות (ובדאבל גם 3/4)</span>
            </div>
          </section>

          <div className="bgm-stage__board bgm-stage__board-wrap">
            <Board theme={setup.boardTheme} />
          </div>

          <aside className="bgm-stage__side">
            <Dice />

            <section className="bgm-status-card" aria-label="סטטוס משחק">
              <p className="bgm-status-card__headline">{winnerSummary ?? statusText}</p>
              <p className="bgm-status-card__meta">{phaseSummary}</p>
              <p className="bgm-status-card__meta">
                מצב: {setup.opponent === "bot-vs-bot" ? "בוט נגד בוט" : (aiEnabled ? "נגד מחשב" : "2 שחקנים מקומי")}
              </p>
              <p className="bgm-status-card__meta">לוח: {getBoardThemeLabel(setup.boardTheme)}</p>

              <div className="bgm-status-card__actions">
                <button
                  type="button"
                  className="bgm-btn"
                  onClick={newGame}
                >
                  משחק חדש
                </button>
                <button
                  type="button"
                  className="bgm-btn"
                  onClick={backToSetup}
                >
                  הגדרות
                </button>
              </div>
            </section>
          </aside>
        </section>
      </BackgammonContext.Provider>
    </main>
  );
}
