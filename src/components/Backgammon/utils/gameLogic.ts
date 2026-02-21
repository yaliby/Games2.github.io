export type PlayerId = "white" | "black";
export type WinType = "normal" | "mars" | "turkish-mars";

export type WinnerInfo = {
  player: PlayerId;
  type: WinType;
  points: 1 | 2 | 3;
};

export type MoveSource = number | "bar";
export type MoveTarget = number | "off";

export type PointState = {
  owner: PlayerId | null;
  count: number;
};

export type Move = {
  id?: number;
  player: PlayerId;
  from: MoveSource;
  to: MoveTarget;
  die: number;
  hit: boolean;
};

export type BackgammonState = {
  points: PointState[];
  bar: Record<PlayerId, number>;
  borneOff: Record<PlayerId, number>;
  currentPlayer: PlayerId;
  isOpeningPhase: boolean;
  openingRoll: Record<PlayerId, number | null>;
  dice: number[];
  rolledDice: number[];
  winner: PlayerId | null;
  winnerInfo: WinnerInfo | null;
  turnNumber: number;
  moveCounter: number;
  lastMove: Move | null;
};

const TOTAL_CHECKERS = 15;
const BOARD_POINTS = 24;

const EMPTY_POINT: PointState = { owner: null, count: 0 };

const HOME_RANGE: Record<PlayerId, [number, number]> = {
  white: [0, 5],
  black: [18, 23],
};

export function getOpponent(player: PlayerId): PlayerId {
  return player === "white" ? "black" : "white";
}

function clonePoints(points: PointState[]): PointState[] {
  return points.map((point) => ({ ...point }));
}

function cloneState(state: BackgammonState): BackgammonState {
  return {
    points: clonePoints(state.points),
    bar: { ...state.bar },
    borneOff: { ...state.borneOff },
    currentPlayer: state.currentPlayer,
    isOpeningPhase: state.isOpeningPhase,
    openingRoll: { ...state.openingRoll },
    dice: [...state.dice],
    rolledDice: [...state.rolledDice],
    winner: state.winner,
    winnerInfo: state.winnerInfo ? { ...state.winnerInfo } : null,
    turnNumber: state.turnNumber,
    moveCounter: state.moveCounter,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}

function createEmptyPoints(): PointState[] {
  return Array.from({ length: BOARD_POINTS }, () => ({ ...EMPTY_POINT }));
}

function setPoint(points: PointState[], index: number, owner: PlayerId, count: number) {
  points[index] = { owner, count };
}

export function createInitialState(): BackgammonState {
  const points = createEmptyPoints();

  // Standard backgammon setup, indexed for white moving 23 -> 0.
  setPoint(points, 23, "white", 2);
  setPoint(points, 12, "white", 5);
  setPoint(points, 7, "white", 3);
  setPoint(points, 5, "white", 5);

  setPoint(points, 0, "black", 2);
  setPoint(points, 11, "black", 5);
  setPoint(points, 16, "black", 3);
  setPoint(points, 18, "black", 5);

  return {
    points,
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
    currentPlayer: "white",
    isOpeningPhase: true,
    openingRoll: { white: null, black: null },
    dice: [],
    rolledDice: [],
    winner: null,
    winnerInfo: null,
    turnNumber: 0,
    moveCounter: 0,
    lastMove: null,
  };
}

export function hasDice(state: BackgammonState): boolean {
  return state.dice.length > 0;
}

function isPointBlockedByOpponent(point: PointState, player: PlayerId): boolean {
  return point.owner !== null && point.owner !== player && point.count >= 2;
}

function isHomePoint(player: PlayerId, point: number): boolean {
  const [minPoint, maxPoint] = HOME_RANGE[player];
  return point >= minPoint && point <= maxPoint;
}

export function canBearOff(state: BackgammonState, player: PlayerId): boolean {
  if (state.bar[player] > 0) return false;

  const [homeMin, homeMax] = HOME_RANGE[player];

  for (let point = 0; point < BOARD_POINTS; point += 1) {
    if (point >= homeMin && point <= homeMax) continue;

    const pointState = state.points[point];
    if (pointState.owner === player && pointState.count > 0) {
      return false;
    }
  }

  return true;
}

function hasCheckerBehind(state: BackgammonState, player: PlayerId, fromPoint: number): boolean {
  if (player === "white") {
    for (let point = fromPoint + 1; point <= HOME_RANGE.white[1]; point += 1) {
      const pointState = state.points[point];
      if (pointState.owner === player && pointState.count > 0) {
        return true;
      }
    }
    return false;
  }

  for (let point = HOME_RANGE.black[0]; point < fromPoint; point += 1) {
    const pointState = state.points[point];
    if (pointState.owner === player && pointState.count > 0) {
      return true;
    }
  }

  return false;
}

function canBearOffFromPoint(
  state: BackgammonState,
  player: PlayerId,
  fromPoint: number,
  die: number
): boolean {
  if (!canBearOff(state, player)) return false;
  if (!isHomePoint(player, fromPoint)) return false;

  if (player === "white") {
    const exactDistance = fromPoint + 1;
    if (die === exactDistance) return true;
    if (die > exactDistance) {
      return !hasCheckerBehind(state, player, fromPoint);
    }
    return false;
  }

  const exactDistance = BOARD_POINTS - fromPoint;
  if (die === exactDistance) return true;
  if (die > exactDistance) {
    return !hasCheckerBehind(state, player, fromPoint);
  }
  return false;
}

function targetPointFromBar(player: PlayerId, die: number): number {
  return player === "white" ? BOARD_POINTS - die : die - 1;
}

function targetPointFromBoard(player: PlayerId, fromPoint: number, die: number): number {
  return player === "white" ? fromPoint - die : fromPoint + die;
}

function addMove(
  moves: Move[],
  player: PlayerId,
  from: MoveSource,
  to: MoveTarget,
  die: number,
  hit: boolean
) {
  moves.push({ player, from, to, die, hit });
}

function generateMovesForDie(
  state: BackgammonState,
  player: PlayerId,
  die: number
): Move[] {
  const moves: Move[] = [];

  if (state.bar[player] > 0) {
    const target = targetPointFromBar(player, die);
    const targetPoint = state.points[target];

    if (!isPointBlockedByOpponent(targetPoint, player)) {
      const hit = targetPoint.owner === getOpponent(player) && targetPoint.count === 1;
      addMove(moves, player, "bar", target, die, hit);
    }

    return moves;
  }

  for (let point = 0; point < BOARD_POINTS; point += 1) {
    const pointState = state.points[point];
    if (pointState.owner !== player || pointState.count === 0) continue;

    const target = targetPointFromBoard(player, point, die);

    if (target >= 0 && target < BOARD_POINTS) {
      const targetPoint = state.points[target];
      if (isPointBlockedByOpponent(targetPoint, player)) continue;

      const hit = targetPoint.owner === getOpponent(player) && targetPoint.count === 1;
      addMove(moves, player, point, target, die, hit);
      continue;
    }

    if (canBearOffFromPoint(state, player, point, die)) {
      addMove(moves, player, point, "off", die, false);
    }
  }

  return moves;
}

function removeCheckerFromPoint(point: PointState) {
  point.count -= 1;
  if (point.count <= 0) {
    point.owner = null;
    point.count = 0;
  }
}

function addCheckerToPoint(point: PointState, player: PlayerId) {
  if (point.owner === null) {
    point.owner = player;
    point.count = 1;
    return;
  }

  if (point.owner === player) {
    point.count += 1;
    return;
  }

  // A non-blocked opponent point can only contain one checker; it is hit.
  point.owner = player;
  point.count = 1;
}

function hasCheckerInWinnerHome(
  state: BackgammonState,
  loser: PlayerId,
  winner: PlayerId
): boolean {
  const [homeMin, homeMax] = HOME_RANGE[winner];

  for (let point = homeMin; point <= homeMax; point += 1) {
    const pointState = state.points[point];
    if (pointState.owner === loser && pointState.count > 0) {
      return true;
    }
  }

  return false;
}

function evaluateWinnerInfo(state: BackgammonState, winner: PlayerId): WinnerInfo {
  const loser = getOpponent(winner);

  if (state.borneOff[loser] > 0) {
    return {
      player: winner,
      type: "normal",
      points: 1,
    };
  }

  if (state.bar[loser] > 0 || hasCheckerInWinnerHome(state, loser, winner)) {
    return {
      player: winner,
      type: "turkish-mars",
      points: 3,
    };
  }

  return {
    player: winner,
    type: "mars",
    points: 2,
  };
}

function consumeDie(dice: number[], die: number): number[] {
  const dieIndex = dice.indexOf(die);
  if (dieIndex < 0) return [...dice];

  return [...dice.slice(0, dieIndex), ...dice.slice(dieIndex + 1)];
}

function applyMoveUnchecked(state: BackgammonState, move: Move): BackgammonState {
  const next = cloneState(state);
  const { player } = move;

  if (move.from === "bar") {
    next.bar[player] = Math.max(0, next.bar[player] - 1);
  } else {
    removeCheckerFromPoint(next.points[move.from]);
  }

  if (move.to === "off") {
    next.borneOff[player] += 1;
  } else {
    const targetPoint = next.points[move.to];

    if (targetPoint.owner === getOpponent(player) && targetPoint.count === 1) {
      const opponent = getOpponent(player);
      targetPoint.owner = null;
      targetPoint.count = 0;
      next.bar[opponent] += 1;
    }

    addCheckerToPoint(targetPoint, player);
  }

  next.dice = consumeDie(next.dice, move.die);
  next.moveCounter += 1;
  next.lastMove = {
    ...move,
    id: next.moveCounter,
  };

  if (next.borneOff[player] >= TOTAL_CHECKERS) {
    next.winner = player;
    next.winnerInfo = evaluateWinnerInfo(next, player);
    next.dice = [];
    next.rolledDice = [];
  }

  return next;
}

function uniqueDiceValues(dice: number[]): number[] {
  return [...new Set(dice)];
}

function moveKey(move: Move): string {
  return `${move.player}:${move.from}->${move.to}|${move.die}`;
}

function collectMoveSequences(state: BackgammonState): Move[][] {
  if (state.winner || state.dice.length === 0) return [];

  const sequences: Move[][] = [];

  const dfs = (node: BackgammonState, path: Move[]) => {
    if (node.dice.length === 0) {
      sequences.push(path);
      return;
    }

    let expanded = false;

    for (const die of uniqueDiceValues(node.dice)) {
      const movesForDie = generateMovesForDie(node, node.currentPlayer, die);
      if (movesForDie.length === 0) continue;

      expanded = true;
      for (const move of movesForDie) {
        const child = applyMoveUnchecked(node, move);
        dfs(child, [...path, move]);
      }
    }

    if (!expanded) {
      sequences.push(path);
    }
  };

  dfs(state, []);

  if (sequences.length === 0) return [];

  const maxLength = Math.max(...sequences.map((sequence) => sequence.length));
  let filtered = sequences.filter((sequence) => sequence.length === maxLength);

  // Special rule: when only one die can be played and dice differ, the higher die must be used.
  if (maxLength === 1 && state.dice.length === 2 && state.dice[0] !== state.dice[1]) {
    const higherDie = Math.max(state.dice[0], state.dice[1]);
    const higherOnly = filtered.filter((sequence) => sequence[0]?.die === higherDie);
    if (higherOnly.length > 0) {
      filtered = higherOnly;
    }
  }

  return filtered;
}

export function getLegalMoves(state: BackgammonState): Move[] {
  if (state.winner || state.isOpeningPhase || state.dice.length === 0) return [];

  const sequences = collectMoveSequences(state);
  const deduped = new Map<string, Move>();

  for (const sequence of sequences) {
    const firstMove = sequence[0];
    if (!firstMove) continue;
    deduped.set(moveKey(firstMove), firstMove);
  }

  return [...deduped.values()];
}

export function rollDice(
  state: BackgammonState,
  forcedValues?: [number, number]
): BackgammonState {
  if (state.winner) return state;
  if (state.dice.length > 0) return state;

  const [dieA, dieB] = forcedValues ?? [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ];

  const next = cloneState(state);
  next.rolledDice = [dieA, dieB];
  next.lastMove = null;

  if (state.isOpeningPhase) {
    next.openingRoll = {
      white: dieA,
      black: dieB,
    };

    if (dieA === dieB) {
      next.dice = [];
      return next;
    }

    next.isOpeningPhase = false;
    next.currentPlayer = dieA > dieB ? "white" : "black";
    next.turnNumber = 1;
    next.dice = [dieA, dieB];
    return next;
  }

  next.dice = dieA === dieB ? [dieA, dieA, dieA, dieA] : [dieA, dieB];

  return next;
}

export function passTurn(state: BackgammonState): BackgammonState {
  if (state.winner) return state;
  if (state.isOpeningPhase) return state;

  const next = cloneState(state);
  next.currentPlayer = getOpponent(state.currentPlayer);
  next.turnNumber += 1;
  next.dice = [];
  next.rolledDice = [];

  return next;
}

function sameMove(a: Move, b: Move): boolean {
  return (
    a.player === b.player
    && a.from === b.from
    && a.to === b.to
    && a.die === b.die
  );
}

export function applyMove(state: BackgammonState, attemptedMove: Move): BackgammonState {
  if (state.winner || state.isOpeningPhase) return state;

  const legalMoves = getLegalMoves(state);
  const legalMove = legalMoves.find((move) => sameMove(move, attemptedMove));
  if (!legalMove) return state;

  let next = applyMoveUnchecked(state, legalMove);
  if (next.winner) return next;

  if (next.dice.length === 0) {
    next = passTurn(next);
    return next;
  }

  const remainingMoves = getLegalMoves(next);
  if (remainingMoves.length === 0) {
    next = passTurn(next);
  }

  return next;
}

export function countCheckersOnBoard(state: BackgammonState, player: PlayerId): number {
  let count = 0;
  for (const point of state.points) {
    if (point.owner === player) {
      count += point.count;
    }
  }
  return count;
}

export function countPiecesInPlay(state: BackgammonState, player: PlayerId): number {
  return countCheckersOnBoard(state, player) + state.bar[player];
}

export function calculatePipCount(state: BackgammonState, player: PlayerId): number {
  let pips = 0;

  for (let point = 0; point < BOARD_POINTS; point += 1) {
    const pointState = state.points[point];
    if (pointState.owner !== player || pointState.count <= 0) continue;

    const distance = player === "white" ? point + 1 : BOARD_POINTS - point;
    pips += distance * pointState.count;
  }

  const barDistance = 25;
  pips += state.bar[player] * barDistance;

  return pips;
}

export function getPlayerLabel(player: PlayerId): string {
  return player === "white" ? "לבן" : "שחור";
}

export function getWinTypeLabel(type: WinType): string {
  if (type === "normal") return "ניצחון רגיל";
  if (type === "mars") return "מארס";
  return "מארס טורקי";
}

function moveProgressScore(move: Move): number {
  if (move.to === "off") return 100;
  if (move.from === "bar") return 24;

  if (move.player === "white") {
    return move.from - move.to;
  }

  return move.to - move.from;
}

function countBlots(state: BackgammonState, player: PlayerId): number {
  let blots = 0;

  for (const point of state.points) {
    if (point.owner === player && point.count === 1) {
      blots += 1;
    }
  }

  return blots;
}

function countMadePoints(state: BackgammonState, player: PlayerId): number {
  let points = 0;

  for (const point of state.points) {
    if (point.owner === player && point.count >= 2) {
      points += 1;
    }
  }

  return points;
}

function countHomeMadePoints(state: BackgammonState, player: PlayerId): number {
  const [homeMin, homeMax] = HOME_RANGE[player];
  let points = 0;

  for (let point = homeMin; point <= homeMax; point += 1) {
    const pointState = state.points[point];
    if (pointState.owner === player && pointState.count >= 2) {
      points += 1;
    }
  }

  return points;
}

function evaluateBoardForPlayer(state: BackgammonState, player: PlayerId): number {
  const opponent = getOpponent(player);

  const pipAdvantage =
    calculatePipCount(state, opponent) - calculatePipCount(state, player);
  const barAdvantage = state.bar[opponent] - state.bar[player];
  const borneOffAdvantage = state.borneOff[player] - state.borneOff[opponent];
  const madePointAdvantage =
    countMadePoints(state, player) - countMadePoints(state, opponent);
  const homeControlAdvantage =
    countHomeMadePoints(state, player) - countHomeMadePoints(state, opponent);
  const blotAdvantage =
    countBlots(state, opponent) - countBlots(state, player);

  return (
    pipAdvantage * 0.82
    + barAdvantage * 23
    + borneOffAdvantage * 58
    + madePointAdvantage * 9
    + homeControlAdvantage * 11
    + blotAdvantage * 6
  );
}

export function chooseAiMove(state: BackgammonState): Move | null {
  const sequences = collectMoveSequences(state);
  if (sequences.length === 0) return null;

  let bestMove = sequences[0][0] ?? null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const player = state.currentPlayer;

  for (const sequence of sequences) {
    const firstMove = sequence[0];
    if (!firstMove) continue;

    let score = 0;
    let simulated = state;

    for (const move of sequence) {
      score += moveProgressScore(move);
      if (move.hit) score += 52;
      if (move.to === "off") score += 88;
      if (move.from === "bar") score += 22;
      simulated = applyMoveUnchecked(simulated, move);
    }

    score += evaluateBoardForPlayer(simulated, player);

    if (score > bestScore) {
      bestMove = firstMove;
      bestScore = score;
    }
  }

  return bestMove;
}

export function isAiTurn(state: BackgammonState, aiEnabled: boolean): boolean {
  return aiEnabled && !state.isOpeningPhase && state.currentPlayer === "black" && !state.winner;
}

export function getUsedDiceCount(state: BackgammonState): number {
  if (state.isOpeningPhase) return 0;
  if (state.rolledDice.length === 0) return 0;

  if (state.rolledDice[0] === state.rolledDice[1]) {
    return 4 - state.dice.length;
  }

  return 2 - state.dice.length;
}

export function formatMove(move: Move): string {
  const from = move.from === "bar" ? "בר" : `נקודה ${move.from + 1}`;
  const to = move.to === "off" ? "יציאה" : `נקודה ${move.to + 1}`;
  const suffix = move.hit ? " (אכילה)" : "";
  return `${from} אל ${to} [${move.die}]${suffix}`;
}
