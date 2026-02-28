import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./RaidHeroGame.css";

type Judgment = "perfect" | "great" | "good" | "miss";
type DifficultyId = "easy" | "normal" | "hard";

type Note = {
  id: number;
  lane: number;
  hitTime: number;
  duration: number;
  holdTicksScored: number;
  holdBroken: boolean;
  holdComplete: boolean;
  judged: boolean;
  judgment?: Judgment;
};

type VisibleNote = {
  id: number;
  lane: number;
  y: number;
  height: number;
  isSustain: boolean;
};

type PlayerStats = {
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

type StageConfig = {
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

type StageTemplate = Omit<StageConfig, "bpm">;

type SongCatalogEntry = {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  bpm: number;
  beatOffset: number;
  seed: number;
};

type DifficultyCatalogEntry = {
  id: DifficultyId;
  label: string;
  description: string;
  laneCount: number;
  perfectWindow: number;
  greatWindow: number;
  goodWindow: number;
  beatStepScale: number;
  densityScale: number;
  chordScale: number;
  sustainScale: number;
  missPenaltyMs: number;
};

type TimingWindows = Pick<DifficultyCatalogEntry, "perfectWindow" | "greatWindow" | "goodWindow">;

type EngineState = {
  running: boolean;
  finished: boolean;
  elapsed: number;
  duration: number;
  notes: Note[];
  stageIndex: number;
  player: PlayerStats;
  totalNotes: number;
};

type ViewState = {
  running: boolean;
  finished: boolean;
  elapsed: number;
  duration: number;
  stageIndex: number;
  visibleNotes: VisibleNote[];
  player: PlayerStats;
  totalNotes: number;
};

const PLAYER_LABEL = "Player 1";
const LANE_COUNT = 4;
const TRACK_HEIGHT = 440;
const HIT_LINE_Y = 384;
const NOTE_HEAD_HEIGHT = 24;

const NOTE_TRAVEL_SECONDS = 1.35;
const NOTE_VISIBLE_AFTER_MISS = 0.08;
const NOTE_SPAWN_LEAD = 2.6;
const SONG_END_GUARD = 1.15;
const MISS_DUCK_VOLUME = 0.3;
const SUSTAIN_SCORE_INTERVAL = 0.1;
const SUSTAIN_TICK_SCORE = 9;
const MIN_SUSTAIN_SECONDS = 0.45;
/** When the song file fails to load, use this duration (seconds) so the chart can still be built and played with an internal timer. */
const FALLBACK_DURATION_SEC = 180;

const RNG_MODULUS = 0x100000000;

const SONG_CATALOG: SongCatalogEntry[] = [
  {
    id: "stressed-out",
    title: "Stressed Out",
    artist: "Twenty One Pilots",
    fileName: "SpotiDown.App - Stressed Out - Twenty One Pilots.mp3",
    bpm: 85,
    beatOffset: 0,
    seed: 912_367,
  },
];

const DIFFICULTY_CATALOG: DifficultyCatalogEntry[] = [
  {
    id: "easy",
    label: "Easy",
    description: "פחות תווים ומרווחים גדולים יותר.",
    laneCount: 3,
    perfectWindow: 0.075,
    greatWindow: 0.12,
    goodWindow: 0.17,
    beatStepScale: 1.3,
    densityScale: 0.72,
    chordScale: 0.45,
    sustainScale: 0.9,
    missPenaltyMs: 150,
  },
  {
    id: "normal",
    label: "Normal",
    description: "קצב מאוזן, בסגנון קלאסי.",
    laneCount: 4,
    perfectWindow: 0.055,
    greatWindow: 0.1,
    goodWindow: 0.15,
    beatStepScale: 1,
    densityScale: 1,
    chordScale: 1,
    sustainScale: 1,
    missPenaltyMs: 220,
  },
  {
    id: "hard",
    label: "Hard",
    description: "צפוף ומהיר יותר עם יותר chords.",
    laneCount: 4,
    perfectWindow: 0.045,
    greatWindow: 0.08,
    goodWindow: 0.115,
    beatStepScale: 0.78,
    densityScale: 1.2,
    chordScale: 1.45,
    sustainScale: 1.15,
    missPenaltyMs: 280,
  },
];

const DIFFICULTY_SEED_OFFSET: Record<DifficultyId, number> = {
  easy: 97,
  normal: 211,
  hard: 389,
};

const MIN_STEP_SECONDS_BY_DIFFICULTY: Record<DifficultyId, number> = {
  easy: 0.3,
  normal: 0.24,
  hard: 0.21,
};

const BASE_STAGES: StageTemplate[] = [
  {
    id: "stage-1",
    label: "Stage 1 · Intro",
    startRatio: 0,
    endRatio: 0.2,
    beatStep: 0.75,
    density: 0.74,
    chordChance: 0.04,
    sustainChance: 0.12,
    sustainBeats: 2,
  },
  {
    id: "stage-2",
    label: "Stage 2 · Verse",
    startRatio: 0.2,
    endRatio: 0.42,
    beatStep: 0.75,
    density: 0.79,
    chordChance: 0.06,
    sustainChance: 0.14,
    sustainBeats: 2,
  },
  {
    id: "stage-3",
    label: "Stage 3 · Chorus Lift",
    startRatio: 0.42,
    endRatio: 0.64,
    beatStep: 0.625,
    density: 0.86,
    chordChance: 0.1,
    sustainChance: 0.16,
    sustainBeats: 2,
  },
  {
    id: "stage-4",
    label: "Stage 4 · Solo Pocket",
    startRatio: 0.64,
    endRatio: 0.82,
    beatStep: 0.75,
    density: 0.77,
    chordChance: 0.07,
    sustainChance: 0.18,
    sustainBeats: 3,
  },
  {
    id: "stage-5",
    label: "Stage 5 · Finale Lift",
    startRatio: 0.82,
    endRatio: 1,
    beatStep: 0.625,
    density: 0.88,
    chordChance: 0.11,
    sustainChance: 0.2,
    sustainBeats: 3,
  },
];

const DEFAULT_BINDINGS = ["KeyD", "KeyF", "KeyJ", "KeyK"];

const JUDGMENT_SCORE: Record<Exclude<Judgment, "miss">, number> = {
  perfect: 100,
  great: 78,
  good: 58,
};

const JUDGMENT_ACCURACY: Record<Exclude<Judgment, "miss">, number> = {
  perfect: 1,
  great: 0.85,
  good: 0.64,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function createEngineState(): EngineState {
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

function getMultiplier(combo: number) {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

function getAccuracy(stats: PlayerStats) {
  if (stats.totalJudged <= 0) return 0;
  return Math.round((stats.accuracyPoints / stats.totalJudged) * 100);
}

function getGrade(accuracy: number) {
  if (accuracy >= 97) return "SS";
  if (accuracy >= 93) return "S";
  if (accuracy >= 88) return "A";
  if (accuracy >= 80) return "B";
  if (accuracy >= 72) return "C";
  return "D";
}

function formatClock(totalSeconds: number) {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(whole % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatKey(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;

  const labels: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "L Shift",
    ShiftRight: "R Shift",
    ControlLeft: "L Ctrl",
    ControlRight: "R Ctrl",
    AltLeft: "L Alt",
    AltRight: "R Alt",
    ArrowLeft: "<-",
    ArrowRight: "->",
    ArrowUp: "Up",
    ArrowDown: "Down",
  };
  return labels[code] ?? code;
}

function toTrackY(hitTime: number, elapsed: number) {
  const progress = (elapsed - (hitTime - NOTE_TRAVEL_SECONDS)) / NOTE_TRAVEL_SECONDS;
  return progress * HIT_LINE_Y;
}

function resolveStages(songBpm: number, difficulty: DifficultyCatalogEntry) {
  const beatFrequencyHz = songBpm / 60;
  const minStepSeconds = MIN_STEP_SECONDS_BY_DIFFICULTY[difficulty.id];
  const minBeatStepFromFrequency = minStepSeconds * beatFrequencyHz;
  return BASE_STAGES.map((stage) => ({
    ...stage,
    bpm: songBpm,
    beatStep: clamp(Math.max(stage.beatStep * difficulty.beatStepScale, minBeatStepFromFrequency), 0.25, 2.5),
    density: clamp(stage.density * difficulty.densityScale, 0.12, 1),
    chordChance: clamp(stage.chordChance * difficulty.chordScale, 0, 0.95),
    sustainChance: clamp(stage.sustainChance * difficulty.sustainScale, 0.04, 0.5),
  }));
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / RNG_MODULUS;
  };
}

function pickLane(rng: () => number, laneCount: number, lastLane: number) {
  let lane = Math.floor(rng() * laneCount);
  if (laneCount > 1 && lane === lastLane) {
    lane = (lane + 1 + Math.floor(rng() * (laneCount - 1))) % laneCount;
  }
  return lane;
}

function pickSecondLane(rng: () => number, laneCount: number, firstLane: number) {
  let lane = Math.floor(rng() * laneCount);
  if (lane === firstLane) {
    lane = (lane + 1 + Math.floor(rng() * (laneCount - 1))) % laneCount;
  }
  return lane;
}

function getStageIndex(elapsed: number, duration: number, stages: StageConfig[]) {
  if (duration <= 0) return 0;
  const progress = clamp(elapsed / duration, 0, 0.999999);
  for (let index = 0; index < stages.length; index += 1) {
    if (progress < stages[index].endRatio) return index;
  }
  return stages.length - 1;
}

function firstBeatAtOrAfter(time: number, stepSeconds: number, beatOffset: number) {
  const n = Math.ceil((time - beatOffset) / stepSeconds);
  return beatOffset + n * stepSeconds;
}

function buildChart(duration: number, stages: StageConfig[], beatOffset: number, seed: number, laneCount: number) {
  const notes: Note[] = [];
  const playableSpan = Math.max(12, duration - (NOTE_SPAWN_LEAD + SONG_END_GUARD));
  let noteId = 1;
  const rng = createRng(seed);
  let lastLane = -1;

  for (const stage of stages) {
    const stageStart = NOTE_SPAWN_LEAD + playableSpan * stage.startRatio;
    const stageEnd = NOTE_SPAWN_LEAD + playableSpan * stage.endRatio;
    const stageDuration = Math.max(0.001, stageEnd - stageStart);
    const beatFrequencyHz = stage.bpm / 60;
    const beatSeconds = 1 / beatFrequencyHz;
    const stepSeconds = stage.beatStep / beatFrequencyHz;
    const speedPressure = clamp((0.24 - stepSeconds) / 0.11, 0, 1);
    const stageDensity = clamp(stage.density * (1 - speedPressure * 0.52), 0.12, 1);
    const stageChordChance = clamp(stage.chordChance * (1 - speedPressure * 0.9), 0, 0.95);
    const stageSustainChance = clamp(stage.sustainChance * (1 - speedPressure * 0.62), 0.03, 0.5);

    for (let hitTime = firstBeatAtOrAfter(stageStart, stepSeconds, beatOffset); hitTime < stageEnd; hitTime += stepSeconds) {
      const beatIndex = Math.round((hitTime - beatOffset) / beatSeconds);
      const isStrongBeat = beatIndex % 2 === 0;
      const isDownBeat = beatIndex % 4 === 0;
      const localProgress = clamp((hitTime - stageStart) / stageDuration, 0, 1);
      const phrasePulse = 0.95 + Math.sin(localProgress * Math.PI * 2) * 0.06;
      const spawnChance = clamp(
        stageDensity * phrasePulse * (isDownBeat ? 1.08 : isStrongBeat ? 1 : 0.92),
        0.12,
        1,
      );
      const chordChance = clamp(stageChordChance * (isDownBeat ? 1.07 : 0.95), 0, 0.95);

      if (rng() > spawnChance) continue;

      const lane = pickLane(rng, laneCount, lastLane);
      lastLane = lane;
      const sustainBeats = Math.max(1, stage.sustainBeats - (rng() < 0.45 ? 1 : 0));
      const sustainDuration = Math.max(MIN_SUSTAIN_SECONDS, sustainBeats * beatSeconds);
      const canFitSustain = hitTime + sustainDuration + stepSeconds * 0.4 < stageEnd;
      const isSustain = canFitSustain && rng() < stageSustainChance;
      notes.push({
        id: noteId,
        lane,
        hitTime,
        duration: isSustain ? sustainDuration : 0,
        holdTicksScored: 0,
        holdBroken: false,
        holdComplete: !isSustain,
        judged: false,
      });
      noteId += 1;

      if (laneCount > 1 && !isSustain && rng() < chordChance) {
        const lane2 = pickSecondLane(rng, laneCount, lane);
        notes.push({
          id: noteId,
          lane: lane2,
          hitTime,
          duration: 0,
          holdTicksScored: 0,
          holdBroken: false,
          holdComplete: true,
          judged: false,
        });
        noteId += 1;
        lastLane = lane2;
      }
    }
  }

  notes.sort((a, b) => {
    if (a.hitTime !== b.hitTime) return a.hitTime - b.hitTime;
    return a.lane - b.lane;
  });

  return { notes, totalNotes: notes.length };
}

function ensureChart(engine: EngineState, stages: StageConfig[], beatOffset: number, seed: number, laneCount: number) {
  if (engine.duration <= 0 || engine.notes.length > 0) return;
  const chart = buildChart(engine.duration, stages, beatOffset, seed, laneCount);
  engine.notes = chart.notes;
  engine.totalNotes = chart.totalNotes;
}

function applyMiss(stats: PlayerStats) {
  stats.misses += 1;
  stats.combo = 0;
  stats.totalJudged += 1;
}

function applySustainBreak(stats: PlayerStats) {
  stats.misses += 1;
  stats.combo = 0;
}

function stepEngineToTime(engine: EngineState, nextElapsed: number, stages: StageConfig[], goodWindow: number) {
  let missCount = 0;
  const maxElapsed = engine.duration > 0 ? engine.duration : Number.POSITIVE_INFINITY;
  const elapsed = clamp(nextElapsed, 0, maxElapsed);
  engine.elapsed = elapsed;
  engine.stageIndex = getStageIndex(elapsed, engine.duration, stages);

  for (const note of engine.notes) {
    if (note.judged) continue;
    if (elapsed - note.hitTime > goodWindow) {
      note.judged = true;
      note.judgment = "miss";
      applyMiss(engine.player);
      missCount += 1;
    }
  }

  return missCount;
}

function createViewState(engine: EngineState, goodWindow: number): ViewState {
  const visibleNotes: VisibleNote[] = [];

  for (const note of engine.notes) {
    const isActiveHeldSustain = note.duration > 0 && note.judged && note.judgment !== "miss" && !note.holdComplete && !note.holdBroken;
    if (isActiveHeldSustain) {
      const holdEnd = note.hitTime + note.duration;
      const remaining = clamp(holdEnd - engine.elapsed, 0, note.duration);
      const sustainTail = clamp((remaining / NOTE_TRAVEL_SECONDS) * HIT_LINE_Y, NOTE_HEAD_HEIGHT, TRACK_HEIGHT * 0.7);
      visibleNotes.push({
        id: note.id,
        lane: note.lane,
        y: HIT_LINE_Y - (sustainTail - NOTE_HEAD_HEIGHT),
        height: sustainTail,
        isSustain: true,
      });
      continue;
    }

    if (note.judged) continue;
    const timeUntilHit = note.hitTime - engine.elapsed;
    if (timeUntilHit > NOTE_TRAVEL_SECONDS + 0.2) continue;
    if (timeUntilHit < -goodWindow - NOTE_VISIBLE_AFTER_MISS) continue;

    const headY = toTrackY(note.hitTime, engine.elapsed);
    if (headY < -44 || headY > TRACK_HEIGHT + 36) continue;

    const sustainTail = note.duration > 0 ? clamp((note.duration / NOTE_TRAVEL_SECONDS) * HIT_LINE_Y, 34, TRACK_HEIGHT * 0.7) : NOTE_HEAD_HEIGHT;
    const y = headY - (sustainTail - NOTE_HEAD_HEIGHT);

    visibleNotes.push({
      id: note.id,
      lane: note.lane,
      y,
      height: sustainTail,
      isSustain: note.duration > 0,
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

function findClosestNote(notes: Note[], lane: number, elapsed: number, goodWindow: number) {
  let best: { note: Note; absDelta: number } | null = null;

  for (const note of notes) {
    if (note.judged || note.lane !== lane) continue;
    const absDelta = Math.abs(note.hitTime - elapsed);
    if (best === null || absDelta < best.absDelta) {
      best = { note, absDelta };
    }
  }

  if (!best || best.absDelta > goodWindow) return null;
  return best;
}

function judgmentFromDelta(absDelta: number, windows: TimingWindows): Exclude<Judgment, "miss"> | null {
  if (absDelta <= windows.perfectWindow) return "perfect";
  if (absDelta <= windows.greatWindow) return "great";
  if (absDelta <= windows.goodWindow) return "good";
  return null;
}

function stepSustainToTime(engine: EngineState, previousElapsed: number, lanePressed: boolean[]) {
  let missCount = 0;
  const to = Math.max(previousElapsed, engine.elapsed);

  for (const note of engine.notes) {
    if (!note.judged || note.judgment === "miss" || note.duration <= 0 || note.holdBroken || note.holdComplete) continue;

    const holdStart = note.hitTime;
    const holdEnd = note.hitTime + note.duration;
    if (to <= holdStart) continue;

    const progressed = clamp(Math.min(to, holdEnd) - holdStart, 0, note.duration);
    const totalTicks = Math.floor(progressed / SUSTAIN_SCORE_INTERVAL);
    if (totalTicks > note.holdTicksScored) {
      const ticksToScore = totalTicks - note.holdTicksScored;
      note.holdTicksScored = totalTicks;
      const multiplier = getMultiplier(engine.player.combo);
      engine.player.score += ticksToScore * SUSTAIN_TICK_SCORE * multiplier;
    }

    if (to >= holdEnd) {
      note.holdComplete = true;
      continue;
    }

    if (!lanePressed[note.lane]) {
      note.holdBroken = true;
      applySustainBreak(engine.player);
      missCount += 1;
    }
  }

  return missCount;
}

export default function RaidHeroGame() {
  const initialSongId = SONG_CATALOG[0]?.id ?? "";
  const initialDifficultyId: DifficultyId = "normal";
  const initialGoodWindow = DIFFICULTY_CATALOG.find((difficulty) => difficulty.id === initialDifficultyId)?.goodWindow ?? 0.15;

  const engineRef = useRef<EngineState>(createEngineState());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const missAudioCtxRef = useRef<AudioContext | null>(null);
  const missDuckTimerRef = useRef<number | null>(null);
  const pressedLanesRef = useRef<boolean[]>(Array.from({ length: LANE_COUNT }, () => false));

  const [view, setView] = useState<ViewState>(() => createViewState(engineRef.current, initialGoodWindow));
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [useFallbackTimer, setUseFallbackTimer] = useState(false);
  const [showStartMenu, setShowStartMenu] = useState(true);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [selectedSongId, setSelectedSongId] = useState(initialSongId);
  const [selectedDifficultyId, setSelectedDifficultyId] = useState<DifficultyId>(initialDifficultyId);
  const [bindings, setBindings] = useState<string[]>(() => [...DEFAULT_BINDINGS]);
  const [captureLane, setCaptureLane] = useState<number | null>(null);
  const [activeLanes, setActiveLanes] = useState<boolean[]>(() => Array.from({ length: LANE_COUNT }, () => false));
  const [lastJudgment, setLastJudgment] = useState<Judgment | null>(null);

  const selectedSong = useMemo(
    () => SONG_CATALOG.find((song) => song.id === selectedSongId) ?? SONG_CATALOG[0],
    [selectedSongId],
  );

  const selectedDifficulty = useMemo(
    () =>
      DIFFICULTY_CATALOG.find((difficulty) => difficulty.id === selectedDifficultyId) ??
      DIFFICULTY_CATALOG[1],
    [selectedDifficultyId],
  );

  const stages = useMemo(
    () => resolveStages(selectedSong.bpm, selectedDifficulty),
    [selectedDifficulty, selectedSong.bpm],
  );

  const chartSeed = useMemo(
    () => selectedSong.seed + DIFFICULTY_SEED_OFFSET[selectedDifficulty.id],
    [selectedDifficulty.id, selectedSong.seed],
  );

  const activeLaneCount = selectedDifficulty.laneCount;
  const activeBindings = useMemo(() => bindings.slice(0, activeLaneCount), [activeLaneCount, bindings]);

  const musicSrc = useMemo(
    () => `${import.meta.env.BASE_URL}music/${encodeURIComponent(selectedSong.fileName)}`,
    [selectedSong.fileName],
  );

  const setLanePressed = useCallback((lane: number, pressed: boolean) => {
    pressedLanesRef.current[lane] = pressed;
    setActiveLanes((prev) => {
      if (prev[lane] === pressed) return prev;
      const next = [...prev];
      next[lane] = pressed;
      return next;
    });
  }, []);

  const clearPressedLanes = useCallback(() => {
    pressedLanesRef.current = Array.from({ length: LANE_COUNT }, () => false);
    setActiveLanes(Array.from({ length: LANE_COUNT }, () => false));
  }, []);

  const syncView = useCallback(() => {
    setView(createViewState(engineRef.current, selectedDifficulty.goodWindow));
  }, [selectedDifficulty.goodWindow]);

  const playMissSound = useCallback(() => {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      let ctx = missAudioCtxRef.current;
      if (!ctx) {
        ctx = new AudioContextCtor();
        missAudioCtxRef.current = ctx;
      }

      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();

      filter.type = "bandpass";
      filter.frequency.setValueAtTime(620, now);
      filter.Q.setValueAtTime(1.2, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.19, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      oscA.type = "sawtooth";
      oscA.frequency.setValueAtTime(260, now);
      oscA.frequency.exponentialRampToValueAtTime(85, now + 0.16);

      oscB.type = "triangle";
      oscB.frequency.setValueAtTime(130, now);
      oscB.frequency.exponentialRampToValueAtTime(68, now + 0.16);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      oscA.start(now);
      oscB.start(now);
      oscA.stop(now + 0.18);
      oscB.stop(now + 0.18);
    } catch {
      // Ignore miss-sfx failures.
    }
  }, []);

  const clearMissPenalty = useCallback(() => {
    if (missDuckTimerRef.current !== null) {
      window.clearTimeout(missDuckTimerRef.current);
      missDuckTimerRef.current = null;
    }

    const audio = audioRef.current;
    if (audio && Math.abs(audio.volume - 1) > 0.001) {
      audio.volume = 1;
    }
  }, []);

  const triggerMissPenalty = useCallback(() => {
    playMissSound();

    const engine = engineRef.current;
    const audio = audioRef.current;
    if (!audio || !engine.running || engine.finished) return;

    clearMissPenalty();
    audio.volume = Math.min(audio.volume, MISS_DUCK_VOLUME);

    missDuckTimerRef.current = window.setTimeout(() => {
      missDuckTimerRef.current = null;
      const currentAudio = audioRef.current;
      if (!currentAudio) return;
      currentAudio.volume = 1;
    }, selectedDifficulty.missPenaltyMs);
  }, [clearMissPenalty, playMissSound, selectedDifficulty.missPenaltyMs]);

  const resetGame = useCallback(() => {
    const previous = engineRef.current;
    const duration = previous.duration;
    const next = createEngineState();
    next.duration = duration;
    ensureChart(next, stages, selectedSong.beatOffset, chartSeed, activeLaneCount);
    engineRef.current = next;

    clearMissPenalty();

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    clearPressedLanes();
    syncView();
  }, [activeLaneCount, chartSeed, clearMissPenalty, clearPressedLanes, selectedSong.beatOffset, stages, syncView]);

  const togglePlayback = useCallback(async () => {
    if (showStartMenu) return;
    const audio = audioRef.current;
    const engine = engineRef.current;
    ensureChart(engine, stages, selectedSong.beatOffset, chartSeed, activeLaneCount);

    if (useFallbackTimer) {
      if (engine.finished) resetGame();
      if (engine.running) {
        engine.running = false;
        clearMissPenalty();
        syncView();
        return;
      }
      engine.running = true;
      engine.finished = false;
      syncView();
      return;
    }

    if (!audio) return;

    if (engine.finished) {
      resetGame();
    }

    if (engine.running) {
      engine.running = false;
      clearMissPenalty();
      audio.pause();
      syncView();
      return;
    }

    if (Math.abs(audio.currentTime - engine.elapsed) > 0.08) {
      audio.currentTime = engine.elapsed;
    }

    engine.running = true;
    engine.finished = false;

    try {
      await audio.play();
      setAudioError(null);
    } catch {
      engine.running = false;
      setAudioError("Browser blocked play. Click Start/Resume.");
    }
    syncView();
  }, [activeLaneCount, chartSeed, clearMissPenalty, resetGame, selectedSong.beatOffset, showStartMenu, stages, syncView, useFallbackTimer]);

  const openStartMenu = useCallback(() => {
    const engine = engineRef.current;
    engine.running = false;
    clearMissPenalty();
    clearPressedLanes();
    const audio = audioRef.current;
    if (audio) audio.pause();
    setShowStartMenu(true);
    syncView();
  }, [clearMissPenalty, clearPressedLanes, syncView]);

  const startFromMenu = useCallback(async () => {
    resetGame();
    setShowStartMenu(false);

    const engine = engineRef.current;
    if (useFallbackTimer) {
      engine.running = true;
      engine.finished = false;
      syncView();
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      syncView();
      return;
    }

    engine.running = true;
    engine.finished = false;
    try {
      await audio.play();
      setAudioError(null);
    } catch {
      engine.running = false;
      setAudioError("Browser blocked play. Click Start/Resume.");
    }
    syncView();
  }, [resetGame, syncView, useFallbackTimer]);

  const registerLaneHit = useCallback(
    (lane: number) => {
      const engine = engineRef.current;
      if (!engine.running) return;

      const stats = engine.player;
      const candidate = findClosestNote(engine.notes, lane, engine.elapsed, selectedDifficulty.goodWindow);
      if (!candidate) {
        applyMiss(stats);
        triggerMissPenalty();
        setLastJudgment("miss");
        window.setTimeout(() => {
          setLastJudgment((current) => (current === "miss" ? null : current));
        }, 140);
        syncView();
        return;
      }

      const judgment = judgmentFromDelta(candidate.absDelta, selectedDifficulty);
      if (!judgment) {
        applyMiss(stats);
        triggerMissPenalty();
        setLastJudgment("miss");
        window.setTimeout(() => {
          setLastJudgment((current) => (current === "miss" ? null : current));
        }, 140);
        syncView();
        return;
      }

      candidate.note.judged = true;
      candidate.note.judgment = judgment;
      candidate.note.holdBroken = false;
      candidate.note.holdTicksScored = 0;
      candidate.note.holdComplete = candidate.note.duration <= 0;

      stats.hits += 1;
      stats.combo += 1;
      stats.bestCombo = Math.max(stats.bestCombo, stats.combo);
      stats.totalJudged += 1;

      if (judgment === "perfect") stats.perfect += 1;
      if (judgment === "great") stats.great += 1;
      if (judgment === "good") stats.good += 1;

      stats.accuracyPoints += JUDGMENT_ACCURACY[judgment];
      const multiplier = getMultiplier(stats.combo);
      stats.score += Math.round(JUDGMENT_SCORE[judgment] * multiplier);

      setLastJudgment(judgment);
      window.setTimeout(() => {
        setLastJudgment((current) => (current === judgment ? null : current));
      }, 140);

      syncView();
    },
    [selectedDifficulty, setLastJudgment, syncView, triggerMissPenalty],
  );

  useEffect(() => {
    setAudioReady(false);
    setAudioError(null);
    setUseFallbackTimer(false);
  }, [musicSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const engine = engineRef.current;
      engine.duration = duration;
      ensureChart(engine, stages, selectedSong.beatOffset, chartSeed, activeLaneCount);
      setAudioReady(duration > 0);
      setAudioError(null);
      syncView();
    };

    const onEnded = () => {
      clearMissPenalty();
      const engine = engineRef.current;
      engine.running = false;
      engine.finished = true;
      stepEngineToTime(engine, (engine.duration || engine.elapsed) + selectedDifficulty.goodWindow + 0.03, stages, selectedDifficulty.goodWindow);
      syncView();
    };

    const onError = () => {
      const engine = engineRef.current;
      engine.duration = FALLBACK_DURATION_SEC;
      ensureChart(engine, stages, selectedSong.beatOffset, chartSeed, activeLaneCount);
      setAudioReady(true);
      setUseFallbackTimer(true);
      setAudioError("Unable to load song. Playing chart with internal timer.");
      syncView();
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    if (audio.readyState >= 1) {
      onLoadedMetadata();
    }

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [activeLaneCount, chartSeed, clearMissPenalty, selectedDifficulty.goodWindow, selectedSong.beatOffset, stages, syncView]);

  useEffect(() => {
    let rafId = 0;
    let previousTime = performance.now();

    const frame = (time: number) => {
      const dt = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;

      const engine = engineRef.current;
      if (engine.running) {
        const audio = audioRef.current;
        const previousElapsed = engine.elapsed;
        let songTime = engine.elapsed + dt;
        if (audio && audio.readyState >= 2 && Number.isFinite(audio.currentTime)) {
          songTime = audio.currentTime;
        }

        const misses = stepEngineToTime(engine, songTime, stages, selectedDifficulty.goodWindow);
        const sustainMisses = stepSustainToTime(engine, previousElapsed, pressedLanesRef.current);
        if (misses + sustainMisses > 0) {
          triggerMissPenalty();
        }

        if (engine.duration > 0 && engine.elapsed >= engine.duration) {
          engine.running = false;
          engine.finished = true;
          clearMissPenalty();
          if (audio) audio.pause();
          stepEngineToTime(engine, engine.duration + selectedDifficulty.goodWindow + 0.03, stages, selectedDifficulty.goodWindow);
        }

        syncView();
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(rafId);
  }, [clearMissPenalty, selectedDifficulty.goodWindow, stages, syncView, triggerMissPenalty]);

  useEffect(() => {
    if (captureLane !== null && captureLane >= activeLaneCount) {
      setCaptureLane(null);
    }
  }, [activeLaneCount, captureLane]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showStartMenu) return;

      if (captureLane !== null) {
        event.preventDefault();
        if (event.code === "Escape") {
          setCaptureLane(null);
          return;
        }

        setBindings((prev) => {
          const next = [...prev];
          const oldLane = next.findIndex((value, index) => value === event.code && index !== captureLane);
          if (oldLane >= 0) {
            next[oldLane] = next[captureLane];
          }
          next[captureLane] = event.code;
          return next;
        });
        setCaptureLane(null);
        return;
      }

      if (event.repeat) return;
      const lane = activeBindings.findIndex((value) => value === event.code);
      if (lane < 0) return;

      event.preventDefault();
      setLanePressed(lane, true);

      registerLaneHit(lane);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (showStartMenu || captureLane !== null) return;
      const lane = activeBindings.findIndex((value) => value === event.code);
      if (lane < 0) return;

      setLanePressed(lane, false);
    };

    const onBlur = () => {
      clearPressedLanes();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [activeBindings, captureLane, clearPressedLanes, registerLaneHit, setLanePressed, showStartMenu]);

  useEffect(() => {
    return () => {
      clearMissPenalty();
      clearPressedLanes();
    };
  }, [clearMissPenalty, clearPressedLanes]);

  const stage = stages[view.stageIndex] ?? stages[0];
  const progress = view.duration > 0 ? clamp((view.elapsed / view.duration) * 100, 0, 100) : 0;
  const stats = view.player;
  const accuracy = getAccuracy(stats);
  const multiplier = getMultiplier(stats.combo);
  const stageStyle = { "--track-height": `${TRACK_HEIGHT}px` } as CSSProperties & Record<string, string>;
  const buttonLabel = view.running ? "Pause" : view.finished ? "Restart" : view.elapsed > 0 ? "Resume" : "Start";
  const notesForTrack = useMemo(() => view.visibleNotes, [view.visibleNotes]);
  const notesRemaining = Math.max(view.totalNotes - stats.totalJudged, 0);
  const sectionIntensity = clamp((0.55 / stage.beatStep + stage.density + stage.chordChance * 1.35 + stage.sustainChance * 0.85) / 2.95, 0, 1);
  const flowMeter = clamp((stats.combo / 35) * 0.6 + (accuracy / 100) * 0.4, 0, 1);
  const activeLaneIndices = useMemo(() => Array.from({ length: activeLaneCount }, (_, lane) => lane), [activeLaneCount]);

  return (
    <main className="raid-hero-page">
      <audio key={selectedSong.id} ref={audioRef} src={musicSrc} preload="auto" />

      <section className="raid-hero-shell">
        {showDisclaimer ? (
          <div className="raid-disclaimer-overlay">
            <section className="raid-disclaimer-card" aria-label="דיסקליימר גרסת אלפה">
              <h3>⚠ גרסת אלפה מוקדמת</h3>
              <p>
                המשחק עדיין בשלב פיתוח מוקדם, ולכן ייתכנו באגים, חוסרים וחוויית משחק שעדיין לא מלוטשת.
              </p>
              <button
                type="button"
                className="raid-disclaimer-btn"
                onClick={() => setShowDisclaimer(false)}
              >
                אישור והמשך
              </button>
            </section>
          </div>
        ) : showStartMenu && (
          <div className="raid-start-overlay">
            <div className="raid-start-card">
              <header>
                <h2>Raid Hero Setup</h2>
                <p>בחר שיר ורמת קושי לפני התחלה.</p>
              </header>

              <div className="raid-start-group">
                <h3>Song Catalog</h3>
                <div className="raid-song-grid">
                  {SONG_CATALOG.map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      className={`raid-song-option${song.id === selectedSong.id ? " is-active" : ""}`}
                      onClick={() => setSelectedSongId(song.id)}
                    >
                      <strong>{song.title}</strong>
                      <span>{song.artist}</span>
                      <small>{song.bpm} BPM</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="raid-start-group">
                <h3>Difficulty</h3>
                <div className="raid-difficulty-grid">
                  {DIFFICULTY_CATALOG.map((difficulty) => (
                    <button
                      key={difficulty.id}
                      type="button"
                      className={`raid-difficulty-option${difficulty.id === selectedDifficulty.id ? " is-active" : ""}`}
                      onClick={() => setSelectedDifficultyId(difficulty.id)}
                    >
                      <strong>{difficulty.label}</strong>
                      <span>{difficulty.description}</span>
                      <small>
                        {difficulty.laneCount} lanes · {Math.round(difficulty.goodWindow * 1000)}ms window
                      </small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="raid-start-actions">
                <button type="button" className="raid-hero-btn raid-hero-btn--primary" onClick={() => void startFromMenu()}>
                  Start Run
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="raid-hero-header">
          <div>
            <h1>Raid Hero: Single Player</h1>
            <p>
              Song: <strong>{selectedSong.title} - {selectedSong.artist}</strong>
            </p>
            <div className="raid-hero-stage-meta">
              <span className="raid-stage-pill">{stage.label}</span>
              <span>Difficulty: {selectedDifficulty.label}</span>
              <span>Dynamic Flow ({selectedSong.bpm} BPM)</span>
              <span>{activeLaneCount} Lanes</span>
            </div>
          </div>

          <div className="raid-hero-controls">
            <div className="raid-hero-clock">
              {formatClock(view.elapsed)} / {view.duration > 0 ? formatClock(view.duration) : "--:--"}
            </div>
            <button type="button" className="raid-hero-btn raid-hero-btn--menu" onClick={openStartMenu}>
              Songs
            </button>
            <button type="button" className="raid-hero-btn raid-hero-btn--primary" onClick={() => void togglePlayback()}>
              {buttonLabel}
            </button>
            <button type="button" className="raid-hero-btn raid-hero-btn--reset" onClick={resetGame}>
              Reset
            </button>
          </div>
        </header>

        <div className="raid-song-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="raid-song-progress__bar" style={{ width: `${progress}%` }} />
        </div>

        <p className="raid-hero-status">
          {audioError
            ? audioError
            : audioReady
              ? `On Miss: harsh buzz + ${selectedDifficulty.missPenaltyMs}ms duck | Window: ${Math.round(selectedDifficulty.goodWindow * 1000)}ms`
              : "Loading song metadata..."}
        </p>

        <section className="raid-hero-hud">
          <article className="raid-hud-card">
            <span className="raid-hud-title">Section Energy</span>
            <strong className="raid-hud-value">{Math.round(sectionIntensity * 100)}%</strong>
            <div className="raid-hud-meter" aria-hidden>
              <i className="raid-hud-fill raid-hud-fill--energy" style={{ width: `${Math.round(sectionIntensity * 100)}%` }} />
            </div>
            <small className="raid-hud-sub">{stage.label}</small>
          </article>

          <article className="raid-hud-card">
            <span className="raid-hud-title">Flow Control</span>
            <strong className="raid-hud-value">{Math.round(flowMeter * 100)}%</strong>
            <div className="raid-hud-meter" aria-hidden>
              <i className="raid-hud-fill raid-hud-fill--flow" style={{ width: `${Math.round(flowMeter * 100)}%` }} />
            </div>
            <small className="raid-hud-sub">Combo + Accuracy balance</small>
          </article>

          <article className="raid-hud-card">
            <span className="raid-hud-title">Notes Left</span>
            <strong className="raid-hud-value">{notesRemaining}</strong>
            <small className="raid-hud-sub">
              {stats.totalJudged}/{view.totalNotes} judged
            </small>
          </article>
        </section>

        <section className="raid-hero-config">
          <article className="raid-hero-player raid-hero-player--p1">
            <h2>{PLAYER_LABEL}</h2>
            <div className="raid-hero-keys" style={{ gridTemplateColumns: `repeat(${activeLaneCount}, minmax(0, 1fr))` }}>
              {activeBindings.map((code, lane) => {
                const isCapture = captureLane === lane;
                return (
                  <button
                    type="button"
                    key={`lane-${lane}`}
                    className={`raid-hero-key-btn${isCapture ? " is-capture" : ""}`}
                    onClick={() => setCaptureLane(lane)}
                  >
                    <span>Lane {lane + 1}</span>
                    <strong>{isCapture ? "Press..." : formatKey(code)}</strong>
                  </button>
                );
              })}
            </div>
            <dl className="raid-hero-stats">
              <div>
                <dt>Score</dt>
                <dd>{stats.score}</dd>
              </div>
              <div>
                <dt>Combo</dt>
                <dd>{stats.combo}</dd>
              </div>
              <div>
                <dt>Multi</dt>
                <dd>x{multiplier}</dd>
              </div>
              <div>
                <dt>Best</dt>
                <dd>{stats.bestCombo}</dd>
              </div>
              <div>
                <dt>Hits</dt>
                <dd>{stats.hits}</dd>
              </div>
              <div>
                <dt>Miss</dt>
                <dd>{stats.misses}</dd>
              </div>
              <div>
                <dt>Perfect</dt>
                <dd>{stats.perfect}</dd>
              </div>
              <div>
                <dt>Great</dt>
                <dd>{stats.great}</dd>
              </div>
              <div>
                <dt>Good</dt>
                <dd>{stats.good}</dd>
              </div>
              <div>
                <dt>Acc</dt>
                <dd>{accuracy}%</dd>
              </div>
              <div>
                <dt>Grade</dt>
                <dd>{getGrade(accuracy)}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>
                  {stats.totalJudged}/{view.totalNotes}
                </dd>
              </div>
            </dl>
          </article>
        </section>

        {captureLane !== null && captureLane < activeLaneCount && (
          <p className="raid-hero-capture-hint">
            Press a key for Lane {captureLane + 1}. Press Esc to cancel.
          </p>
        )}

        <section className="raid-hero-stage" style={stageStyle}>
          <article className="raid-track raid-track--p1">
            <header className="raid-track-header">{PLAYER_LABEL}</header>
            <div className="raid-track-lanes">
              {activeLaneIndices.map((lane) => (
                <div
                  key={`lane-visual-${lane}`}
                  className={`raid-lane${activeLanes[lane] ? " is-active" : ""}`}
                  style={{
                    width: `calc(100% / ${activeLaneCount})`,
                    left: `${(lane / activeLaneCount) * 100}%`,
                  }}
                />
              ))}

              {notesForTrack.map((note) => (
                <div
                  key={note.id}
                  className={`raid-note raid-note--p1${note.isSustain ? " is-sustain" : ""}`}
                  style={{
                    left: `calc(${((note.lane + 0.5) / activeLaneCount) * 100}% - 26px)`,
                    transform: `translateY(${note.y}px)`,
                    height: `${note.height}px`,
                  }}
                />
              ))}

              <div
                className={`raid-hit-line${lastJudgment ? ` raid-hit-line--${lastJudgment}` : ""}`}
                style={{ top: `${HIT_LINE_Y}px` }}
              />
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
