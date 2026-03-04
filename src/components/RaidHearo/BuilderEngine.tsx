// BuilderEngine.tsx
// Lightweight, self‑contained engine for RAID HERO playtest / simulation.

export type Judgment = "perfect" | "great" | "good" | "miss";
export type DifficultyId = "easy" | "medium" | "normal" | "hard";

export type Note = {
  id: number;
  lane: number;
  hitTime: number;   // seconds from song start
  duration: number;  // sustain length in seconds; 0 = tap
  holdTicksScored: number;
  holdBroken: boolean;
  holdComplete: boolean;
  judged: boolean;
  judgment?: Judgment;
};

export type VisibleNote = {
  id: number;
  lane: number;
  y: number;
  height: number;
  isSustain: boolean;
};

export type PlayerStats = {
  score: number;
  combo: number;
  bestCombo: number;
  hits: number;
  misses: number;
  perfect: number;
  great: number;
  good: number;
  totalJudged: number;
  accuracyPoints: number;
};

export type StageConfig = {
  id: string;
  label: string;
  startRatio: number;
  endRatio: number;
  bpm: number;
  beatStep: number;
  density: number;
  chordChance: number;
  sustainChance: number;
  sustainBeats: number;
};

export type EngineState = {
  running: boolean;
  finished: boolean;
  elapsed: number;
  duration: number;
  notes: Note[];
  stageIndex: number;
  player: PlayerStats;
  totalNotes: number;
};

export type ViewState = {
  running: boolean;
  finished: boolean;
  elapsed: number;
  duration: number;
  stageIndex: number;
  visibleNotes: VisibleNote[];
  player: PlayerStats;
  totalNotes: number;
};

// Layout / timing constants (kept in sync with RaidHeroGame)
export const LANE_COUNT = 4;
export const TRACK_HEIGHT = 460;
export const HIT_LINE_Y = 400;
const NOTE_HEAD_HEIGHT = 24;
const NOTE_TRAVEL_SECONDS = 1.8;
const NOTE_VISIBLE_AFTER_MISS = 0.12;
const SUSTAIN_SCORE_INTERVAL = 0.1;
const SUSTAIN_TICK_SCORE = 9;

export const JUDGMENT_SCORE: Record<Exclude<Judgment, "miss">, number> = {
  perfect: 100,
  great: 78,
  good: 58,
};

export const JUDGMENT_ACCURACY: Record<Exclude<Judgment, "miss">, number> = {
  perfect: 1,
  great: 0.85,
  good: 0.64,
};

export type TimingWindows = {
  perfectWindow: number;
  greatWindow: number;
  goodWindow: number;
};

export function findClosestNote(
  notes: Note[],
  lane: number,
  elapsed: number,
  goodWindow: number,
): { note: Note; absDelta: number } | null {
  let best: { note: Note; absDelta: number } | null = null;
  for (const n of notes) {
    if (n.judged || n.lane !== lane) continue;
    const d = Math.abs(n.hitTime - elapsed);
    if (!best || d < best.absDelta) best = { note: n, absDelta: d };
  }
  return best && best.absDelta <= goodWindow ? best : null;
}

export function judgmentFromDelta(
  d: number,
  w: TimingWindows,
): Exclude<Judgment, "miss"> | null {
  if (d <= w.perfectWindow) return "perfect";
  if (d <= w.greatWindow) return "great";
  if (d <= w.goodWindow) return "good";
  return null;
}

/** Apply a lane hit: find closest note, judge, update engine. Returns the judgment shown (or "miss"). */
export function registerLaneHitInEngine(
  engine: EngineState,
  lane: number,
  timing: TimingWindows,
): Judgment {
  if (!engine.running) return "miss";
  const stats = engine.player;
  const cand = findClosestNote(
    engine.notes,
    lane,
    engine.elapsed,
    timing.goodWindow,
  );
  if (!cand) {
    applyMiss(stats);
    return "miss";
  }
  const judgment = judgmentFromDelta(cand.absDelta, timing);
  if (!judgment) {
    applyMiss(stats);
    return "miss";
  }
  const { note } = cand;
  note.judged = true;
  note.judgment = judgment;
  note.holdBroken = false;
  note.holdTicksScored = 0;
  note.holdComplete = note.duration <= 0;
  stats.hits++;
  stats.combo++;
  stats.bestCombo = Math.max(stats.bestCombo, stats.combo);
  stats.totalJudged++;
  if (judgment === "perfect") stats.perfect++;
  if (judgment === "great") stats.great++;
  if (judgment === "good") stats.good++;
  stats.accuracyPoints += JUDGMENT_ACCURACY[judgment];
  stats.score += Math.round(
    JUDGMENT_SCORE[judgment] * getMultiplier(stats.combo),
  );
  return judgment;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function createStats(): PlayerStats {
  return {
    score: 0,
    combo: 0,
    bestCombo: 0,
    hits: 0,
    misses: 0,
    perfect: 0,
    great: 0,
    good: 0,
    totalJudged: 0,
    accuracyPoints: 0,
  };
}

export function createEngineState(): EngineState {
  return {
    running: false,
    finished: false,
    elapsed: 0,
    duration: 0,
    notes: [],
    stageIndex: 0,
    player: createStats(),
    totalNotes: 0,
  };
}

export function getMultiplier(combo: number) {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

export function getAccuracy(s: PlayerStats) {
  return s.totalJudged <= 0
    ? 0
    : Math.round((s.accuracyPoints / s.totalJudged) * 100);
}

export function getGrade(acc: number) {
  if (acc >= 97) return "SS";
  if (acc >= 93) return "S";
  if (acc >= 88) return "A";
  if (acc >= 80) return "B";
  if (acc >= 72) return "C";
  return "D";
}

export function formatClock(totalSeconds: number) {
  const w = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(w / 60)
    .toString()
    .padStart(2, "0")}:${(w % 60).toString().padStart(2, "0")}`;
}

function toTrackY(hitTime: number, elapsed: number, hitLineY: number) {
  return (
    ((elapsed - (hitTime - NOTE_TRAVEL_SECONDS)) / NOTE_TRAVEL_SECONDS) *
    hitLineY
  );
}

function getStageIndex(
  elapsed: number,
  duration: number,
  stages: StageConfig[],
) {
  if (duration <= 0 || stages.length === 0) return 0;
  const p = clamp(elapsed / duration, 0, 0.999999);
  for (let i = 0; i < stages.length; i++) {
    if (p < stages[i].endRatio) return i;
  }
  return stages.length - 1;
}

function applyMiss(s: PlayerStats) {
  s.misses++;
  s.combo = 0;
  s.totalJudged++;
}

function applySustainBreak(s: PlayerStats) {
  s.misses++;
  s.combo = 0;
}

export function stepEngineToTime(
  engine: EngineState,
  nextElapsed: number,
  stages: StageConfig[],
  goodWindow: number,
) {
  let misses = 0;
  const elapsed = clamp(
    nextElapsed,
    0,
    engine.duration > 0 ? engine.duration : Infinity,
  );
  engine.elapsed = elapsed;
  engine.stageIndex = getStageIndex(elapsed, engine.duration, stages);
  for (const n of engine.notes) {
    if (n.judged) continue;
    if (elapsed - n.hitTime > goodWindow) {
      n.judged = true;
      n.judgment = "miss";
      applyMiss(engine.player);
      misses++;
    }
  }
  return misses;
}

export function stepSustainToTime(
  engine: EngineState,
  prevElapsed: number,
  lanePressed: boolean[],
) {
  let misses = 0;
  const to = Math.max(prevElapsed, engine.elapsed);
  for (const n of engine.notes) {
    if (
      !n.judged ||
      n.judgment === "miss" ||
      n.duration <= 0 ||
      n.holdBroken ||
      n.holdComplete
    )
      continue;
    const holdEnd = n.hitTime + n.duration;
    if (to <= n.hitTime) continue;
    const progressed = clamp(
      Math.min(to, holdEnd) - n.hitTime,
      0,
      n.duration,
    );
    const totalTicks = Math.floor(progressed / SUSTAIN_SCORE_INTERVAL);
    if (totalTicks > n.holdTicksScored) {
      const delta = totalTicks - n.holdTicksScored;
      n.holdTicksScored = totalTicks;
      engine.player.score +=
        delta * SUSTAIN_TICK_SCORE * getMultiplier(engine.player.combo);
    }
    if (to >= holdEnd) {
      n.holdComplete = true;
      continue;
    }
    if (!lanePressed[n.lane]) {
      n.holdBroken = true;
      applySustainBreak(engine.player);
      misses++;
    }
  }
  return misses;
}

export function createViewState(
  engine: EngineState,
  goodWindow: number,
  trackHeight: number,
  hitLineY: number,
): ViewState {
  const visibleNotes: VisibleNote[] = [];
  for (const n of engine.notes) {
    // active sustain being held
    const isActiveHeld =
      n.duration > 0 &&
      n.judged &&
      n.judgment !== "miss" &&
      !n.holdComplete &&
      !n.holdBroken;
    if (isActiveHeld) {
      const holdEnd = n.hitTime + n.duration;
      const remaining = clamp(holdEnd - engine.elapsed, 0, n.duration);
      const tail = clamp(
        (remaining / NOTE_TRAVEL_SECONDS) * hitLineY,
        NOTE_HEAD_HEIGHT,
        trackHeight * 0.72,
      );
      visibleNotes.push({
        id: n.id,
        lane: n.lane,
        y: hitLineY - (tail - NOTE_HEAD_HEIGHT),
        height: tail,
        isSustain: true,
      });
      continue;
    }

    if (n.judged) continue;

    const timeUntil = n.hitTime - engine.elapsed;
    if (timeUntil > NOTE_TRAVEL_SECONDS + 0.2) continue;
    if (timeUntil < -goodWindow - NOTE_VISIBLE_AFTER_MISS) continue;

    const headY = toTrackY(n.hitTime, engine.elapsed, hitLineY);
    if (headY < -44 || headY > trackHeight + 36) continue;

    const tail =
      n.duration > 0
        ? clamp(
            (n.duration / NOTE_TRAVEL_SECONDS) * hitLineY,
            34,
            trackHeight * 0.72,
          )
        : NOTE_HEAD_HEIGHT;

    visibleNotes.push({
      id: n.id,
      lane: n.lane,
      y: headY - (tail - NOTE_HEAD_HEIGHT),
      height: tail,
      isSustain: n.duration > 0,
    });
  }

  return {
    running: engine.running,
    finished: engine.finished,
    elapsed: engine.elapsed,
    duration: engine.duration,
    stageIndex: engine.stageIndex,
    visibleNotes,
    player: { ...engine.player },
    totalNotes: engine.totalNotes,
  };
}

