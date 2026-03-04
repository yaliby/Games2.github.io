import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import "./RaidHeroGame.css";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, deleteDoc, query, orderBy, serverTimestamp } from "firebase/firestore";
import { RaidHeroPlaytestOverlay } from "./RaidHeroPlaytestOverlay";
import { analyzeAudioUrlToStage, getAnalysisFromAudioUrl, suggestAllNotesFrom, type SuggestedNote, type AudioAnalysis as AlguritemAudioAnalysis } from "./Alguritem";

/* ─────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────── */
type Judgment = "perfect" | "great" | "good" | "miss";
type DifficultyId = "easy" | "medium" | "normal" | "hard";

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

/* ════════════════════════════════════════════════════════════════
   DIFFICULTY ARCHITECTURE
   Difficulty = 4 axes: Density · Rhythmic Complexity · Spatial · Cognitive Load
   Each difficulty profile controls all four independently.
   "Hard" ≠ more notes — it means more information per second.
════════════════════════════════════════════════════════════════ */

type DifficultyCatalogEntry = {
  id:    DifficultyId;
  label: string;
  description: string;
  laneCount: number;

  // ── Timing windows ──────────────────────────────────────
  perfectWindow: number;
  greatWindow:   number;
  goodWindow:    number;
  missPenaltyMs: number;

  // ── Axis 1: Density ─────────────────────────────────────
  // Which onset bands are charted. Easy = bass only. Hard = all bands.
  chartBands: number[];         // 0=bass 1=mid 2=high — which bands to include
  densityScale: number;         // 0..1 multiplier on keep probability
  coreStrengthMin: number;      // onset strength to be "always charted" regardless

  // ── Axis 2: Rhythmic Complexity ─────────────────────────
  // maxSubdivision: 1=quarter, 2=eighth, 4=sixteenth
  maxSubdivision: number;
  syncopationAllowed: boolean;  // allow offbeat charting
  tripletAllowed: boolean;      // allow triplet-feel onsets
  minOnsetGapSec: number;       // absolute minimum between any two notes

  // ── Axis 3: Spatial Complexity ──────────────────────────
  maxLaneJump: number;          // max lane distance per step (1=adjacent, 3=full)
  chordAllowed: boolean;        // can chords appear at all?
  chordScale: number;           // multiplier on chord probability
  maxChordSize: number;         // 1=no chord, 2=two-note, etc.

  // ── Axis 4: Cognitive Load ───────────────────────────────
  sustainScale: number;         // sustain probability multiplier
  fakeoutAllowed: boolean;      // allow sudden silence after dense run
  patternBreakAllowed: boolean; // allow pattern discontinuities
  motifMutationRate: number;    // 0=always repeat, 1=always vary

  // ── Legacy compatibility (fallback chart uses these) ────
  beatStepScale: number;
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

/** Result of waveform analysis */
type AudioAnalysis = {
  // ── Per-band onset streams ────────────────────────────────────
  /** Bass-band onsets (20–300 Hz): kick drum, bass guitar hits */
  bassOnsets:   { time: number; strength: number }[];
  /** Mid-band onsets (300–3000 Hz): snare, rhythm guitar, chords */
  midOnsets:    { time: number; strength: number }[];
  /** High-band onsets (3000+ Hz): hi-hat, vocals, cymbals */
  highOnsets:   { time: number; strength: number }[];
  /** Merged, de-duplicated onset list across all bands */
  onsetTimes:   number[];
  onsetStrengths: number[];
  /** Source band for each merged onset: 0=bass, 1=mid, 2=high */
  onsetBands:   number[];
  /** IOI phrase-break midpoints */
  phraseBreaks: number[];
  /** Beat-grid times derived from tempo tracking */
  beatTimes:    number[];
  /** Downbeat times (every 4 beats) */
  downbeatTimes: number[];
  /** Section boundary times */
  sectionBoundaries: number[];
  /** Per-section normalised energy */
  sectionEnergy: number[];
  /** Detected BPM */
  estimatedBpm: number;
  /** Per-frame (10ms) RMS energy for real-time activity queries */
  frameEnergy:  Float32Array;
  /** Frames-per-second of frameEnergy (= 1 / HOP_SEC) */
  frameRate:    number;
};


/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */
const LANE_COUNT = 4;
const TRACK_HEIGHT = 460;
const HIT_LINE_Y = 400;
const NOTE_HEAD_HEIGHT = 24;
const NOTE_TRAVEL_SECONDS = 1.8;
const NOTE_VISIBLE_AFTER_MISS = 0.12;
const NOTE_SPAWN_LEAD = 0.5;
const SONG_END_GUARD = 0.8;
const MISS_DUCK_VOLUME = 0.3;
const SUSTAIN_SCORE_INTERVAL = 0.1;
const SUSTAIN_TICK_SCORE = 9;
const MIN_SUSTAIN_SECONDS = 0.45;
const FALLBACK_DURATION_SEC = 180;
const MIN_GAP_AFTER_SUSTAIN = 0.1; // seconds — no note can start this soon after a sustain ends
const RNG_MODULUS = 0x100000000;

const SONG_CATALOG: SongCatalogEntry[] = [
  {
    id: "stressed-out",
    title: "Stressed Out",
    artist: "Twenty One Pilots",
    fileName: "StressedOut.mp3",
    bpm: 85,
    beatOffset: 0,
    seed: 912_367,
  },
  {
    id: "devops-song",
    title: "DevOps Song",
    artist: "Raid Hero OST",
    fileName: "DevopsSong.mp3",
    bpm: 128,
    beatOffset: 0,
    seed: 744_521,
  },
];

const DIFFICULTY_CATALOG: DifficultyCatalogEntry[] = [
  /* ── EASY ──────────────────────────────────────────────────────
     Philosophy: Learn the song through the game.
     Only downbeats + strong bass hits. 2–3 lanes. No chords.
     Long sustains. Slow movement. Pattern repeats 3× before varying.
  ────────────────────────────────────────────────────────────── */
  {
    id: "easy", label: "Easy",
    description: "אתה שומע את השיר 🌱",
    laneCount: 3,

    perfectWindow: 0.120, greatWindow: 0.195, goodWindow: 0.270,
    missPenaltyMs: 55,

    chartBands:       [0],          // bass only
    densityScale:     0.32,
    coreStrengthMin:  0.55,         // only chart strong bass hits

    maxSubdivision:   1,            // quarter notes only
    syncopationAllowed: false,
    tripletAllowed:   false,
    minOnsetGapSec:   0.38,         // must be > ~quarter note at 120bpm

    maxLaneJump:      1,            // only adjacent lanes
    chordAllowed:     false,
    chordScale:       0,
    maxChordSize:     1,

    sustainScale:     1.4,          // long, clear sustains
    fakeoutAllowed:   false,
    patternBreakAllowed: false,
    motifMutationRate:  0.15,       // patterns repeat heavily

    beatStepScale: 1.8,
  },

  /* ── MEDIUM ─────────────────────────────────────────────────────
     Philosophy: Starting to dance with the song.
     Bass + some mid. 3 lanes. Rare chords on downbeats only.
     Quarter + eighth notes. Slow lane spread.
  ────────────────────────────────────────────────────────────── */
  {
    id: "medium", label: "Medium",
    description: "אתה זז עם השיר ✨",
    laneCount: 3,

    perfectWindow: 0.098, greatWindow: 0.160, goodWindow: 0.230,
    missPenaltyMs: 90,

    chartBands:       [0, 1],       // bass + mid
    densityScale:     0.50,
    coreStrengthMin:  0.45,

    maxSubdivision:   2,            // eighth notes allowed
    syncopationAllowed: false,
    tripletAllowed:   false,
    minOnsetGapSec:   0.22,

    maxLaneJump:      2,
    chordAllowed:     true,
    chordScale:       0.30,
    maxChordSize:     2,

    sustainScale:     1.0,
    fakeoutAllowed:   false,
    patternBreakAllowed: false,
    motifMutationRate: 0.30,

    beatStepScale: 1.3,
  },

  /* ── NORMAL ─────────────────────────────────────────────────────
     Philosophy: You move with the song.
     All bands. 4 lanes. Chords on beats. Eighth notes + light syncopation.
     Dynamic pattern per section. Short sustains.
  ────────────────────────────────────────────────────────────── */
  {
    id: "normal", label: "Normal",
    description: "אתה רוקד עם השיר 🎸",
    laneCount: 4,

    perfectWindow: 0.082, greatWindow: 0.138, goodWindow: 0.200,
    missPenaltyMs: 125,

    chartBands:       [0, 1, 2],
    densityScale:     0.64,
    coreStrengthMin:  0.35,

    maxSubdivision:   2,            // eighth notes; sixteenth only on runs
    syncopationAllowed: true,
    tripletAllowed:   false,
    minOnsetGapSec:   0.14,

    maxLaneJump:      3,            // full range but biased
    chordAllowed:     true,
    chordScale:       0.65,
    maxChordSize:     2,

    sustainScale:     0.85,
    fakeoutAllowed:   false,
    patternBreakAllowed: true,
    motifMutationRate: 0.50,

    beatStepScale: 1.1,
  },

  /* ── HARD ───────────────────────────────────────────────────────
     Philosophy: You ARE the song.
     All bands. 4 lanes. Full subdivision. Syncopation. Runs. Fakeouts.
     Chords on strong beats. Cross-lane jumps. Pattern breaks.
     Density is NOT the differentiator — complexity of information is.
  ────────────────────────────────────────────────────────────── */
  {
    id: "hard", label: "Hard",
    description: "אתה מנגן את השיר 🔥",
    laneCount: 4,

    perfectWindow: 0.062, greatWindow: 0.108, goodWindow: 0.158,
    missPenaltyMs: 180,

    chartBands:       [0, 1, 2],
    densityScale:     0.82,         // NOT 1.0 — density isn't the point
    coreStrengthMin:  0.25,

    maxSubdivision:   4,            // sixteenth notes
    syncopationAllowed: true,
    tripletAllowed:   true,
    minOnsetGapSec:   0.072,        // ~16th at 130bpm

    maxLaneJump:      3,            // full cross-lane jumps
    chordAllowed:     true,
    chordScale:       1.0,
    maxChordSize:     2,

    sustainScale:     0.65,         // short, tactical sustains
    fakeoutAllowed:   true,
    patternBreakAllowed: true,
    motifMutationRate: 0.75,

    beatStepScale: 0.88,
  },
];


/* ════════════════════════════════════════════════════════════════
   CHART GENERATION ENGINE v3
   Band-aware · Beat-aligned · Phrase-driven · Difficulty-architected
   
   Architecture:
     Song → Sections → Phrases (4 bars) → Patterns → Notes
   
   Per phrase:
     1. Detect phrase energy + section role (intro/verse/chorus/etc)
     2. Select pattern archetype (groove/fill/peak/breakdown)
     3. Walk onset stream, apply difficulty constraints per onset
     4. Lane = band affinity × motion bias × spatial constraint
════════════════════════════════════════════════════════════════ */

// ── Section role heuristic ────────────────────────────────────
// We infer "intro/verse/pre-chorus/chorus/bridge/outro" from the
// normalised position in the song and section energy.
const DIFFICULTY_SEED_OFFSET: Record<DifficultyId, number> = { easy: 97, medium: 157, normal: 211, hard: 389 };
const MIN_STEP_SECONDS_BY_DIFFICULTY: Record<DifficultyId, number> = { easy: 0.3, medium: 0.28, normal: 0.24, hard: 0.21 };

const BASE_STAGES: StageTemplate[] = [
  { id: "stage-1", label: "Stage 1 · Intro",       startRatio: 0,    endRatio: 0.2,  beatStep: 1.0,   density: 0.55, chordChance: 0.02, sustainChance: 0.14, sustainBeats: 2 },
  { id: "stage-2", label: "Stage 2 · Verse",        startRatio: 0.2,  endRatio: 0.42, beatStep: 0.875, density: 0.60, chordChance: 0.04, sustainChance: 0.16, sustainBeats: 2 },
  { id: "stage-3", label: "Stage 3 · Chorus Lift",  startRatio: 0.42, endRatio: 0.64, beatStep: 0.75,  density: 0.68, chordChance: 0.07, sustainChance: 0.17, sustainBeats: 2 },
  { id: "stage-4", label: "Stage 4 · Solo Pocket",  startRatio: 0.64, endRatio: 0.82, beatStep: 0.875, density: 0.62, chordChance: 0.05, sustainChance: 0.19, sustainBeats: 3 },
  { id: "stage-5", label: "Stage 5 · Finale Lift",  startRatio: 0.82, endRatio: 1,    beatStep: 0.75,  density: 0.70, chordChance: 0.08, sustainChance: 0.20, sustainBeats: 3 },
];

const DEFAULT_BINDINGS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
const LANE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6"] as const;
const LANE_GLOW   = ["rgba(34,197,94,0.8)", "rgba(239,68,68,0.8)", "rgba(234,179,8,0.8)", "rgba(59,130,246,0.8)"] as const;

const JUDGMENT_SCORE: Record<Exclude<Judgment, "miss">, number> = { perfect: 100, great: 78, good: 58 };
const JUDGMENT_ACCURACY: Record<Exclude<Judgment, "miss">, number> = { perfect: 1, great: 0.85, good: 0.64 };

/* ─────────────────────────────────────────────────────────────────
   ANALYSIS ENGINE — Multi-band filterbank + beat tracker
─────────────────────────────────────────────────────────────────── */
function analyzeAudioBuffer(buffer: AudioBuffer): AudioAnalysis {
  const sr    = buffer.sampleRate;
  const len   = buffer.length;
  const nCh   = buffer.numberOfChannels;

  // ── 1. Mix to mono ──────────────────────────────────────────
  const mono = new Float32Array(len);
  for (let c = 0; c < nCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i] / nCh;
  }

  // ── 2. Multi-band separation (IIR biquad coefficients) ──────
  // We use a simple 1st-order recursive IIR filter to split bands:
  //   low-pass  fc≈280 Hz  → bass band
  //   band-pass 280–3000 Hz → mid band  (= full - low - high)
  //   high-pass fc≈3000 Hz → high band
  //
  // 1st-order RC low-pass:  y[n] = alpha*x[n] + (1-alpha)*y[n-1]
  //   alpha = 2πfc / (2πfc + fs)

  function lpFilter(x: Float32Array, fc: number): Float32Array {
    const alpha = (2 * Math.PI * fc) / (2 * Math.PI * fc + sr);
    const y = new Float32Array(x.length);
    y[0] = alpha * x[0];
    for (let i = 1; i < x.length; i++) y[i] = alpha * x[i] + (1 - alpha) * y[i - 1];
    return y;
  }
  function hpFilter(x: Float32Array, fc: number): Float32Array {
    // HP = x - LP(x)
    const lp = lpFilter(x, fc);
    const y  = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] - lp[i]!;
    return y;
  }

  const bassSignal = lpFilter(mono, 280);
  const highSignal = hpFilter(mono, 3000);
  const midSignal  = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    midSignal[i] = mono[i]! - bassSignal[i]! - highSignal[i]!;
  }

  // ── 3. Short-time energy per band (10 ms hop, 25 ms win) ────
  const HOP_SEC = 0.010;
  const WIN_SEC = 0.025;
  const HOP = Math.max(1, Math.round(sr * HOP_SEC));
  const WIN = Math.max(2, Math.round(sr * WIN_SEC));
  const frames = Math.floor((len - WIN) / HOP);

  function frameRms(sig: Float32Array): Float32Array {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0; const off = i * HOP;
      for (let j = 0; j < WIN; j++) { const v = sig[off + j] ?? 0; s += v * v; }
      out[i] = Math.sqrt(s / WIN);
    }
    return out;
  }

  const bassEnergy = frameRms(bassSignal);
  const midEnergy  = frameRms(midSignal);
  const highEnergy = frameRms(highSignal);
  const fullEnergy = frameRms(mono);    // for section detection

  // ── 4. Onset Detection Function per band ────────────────────
  // Half-wave rectified 1st-order diff (spectral flux approximation)
  function computeOdf(eng: Float32Array): Float32Array {
    const odf = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      odf[i] = Math.max(0, eng[i]! - eng[i - 1]!);
    }
    return odf;
  }

  const bassOdf = computeOdf(bassEnergy);
  const midOdf  = computeOdf(midEnergy);
  const highOdf = computeOdf(highEnergy);

  // ── 5. Adaptive peak-picking per band ───────────────────────
  function pickPeaks(
    odf:     Float32Array,
    mult:    number,   // threshold multiplier
    minGapS: number,   // minimum seconds between peaks
    halfWin: number,   // neighbourhood frames for local average
    localMaxWin: number, // local max check ± frames
  ): { frame: number; strength: number }[] {
    const minGap = Math.max(1, Math.round(minGapS / HOP_SEC));
    const peaks: { frame: number; strength: number }[] = [];
    for (let i = halfWin; i < frames - halfWin; i++) {
      // Adaptive threshold = local mean × mult
      let sum = 0;
      for (let j = i - halfWin; j <= i + halfWin; j++) sum += odf[j]!;
      const thresh = (sum / (halfWin * 2 + 1)) * mult;
      if (odf[i]! <= thresh) continue;
      // Local maximum check
      let isMax = true;
      for (let j = Math.max(0, i - localMaxWin); j <= Math.min(frames - 1, i + localMaxWin); j++) {
        if (j !== i && odf[j]! >= odf[i]!) { isMax = false; break; }
      }
      if (!isMax) continue;
      if (peaks.length === 0 || i - peaks[peaks.length - 1]!.frame >= minGap) {
        peaks.push({ frame: i, strength: odf[i]! / (thresh + 1e-9) });
      }
    }
    return peaks;
  }

  // Bass: kick/bass — wider neighbourhood, moderate threshold
  // minGap 80ms → catch 16th-note bass runs at 180bpm
  const bassPeaks = pickPeaks(bassOdf, 1.25, 0.080, 45, 4);
  // Mid: snare/chord/guitar — tighter
  const midPeaks  = pickPeaks(midOdf,  1.15, 0.060, 35, 3);
  // High: hi-hat/vocal/cymbal — very tight, catches fast articulations
  const highPeaks = pickPeaks(highOdf, 1.10, 0.045, 25, 2);

  function normaliseStrengths(peaks: { frame: number; strength: number }[]) {
    const maxS = peaks.reduce((m, p) => Math.max(m, p.strength), 1e-9);
    return peaks.map(p => ({ time: (p.frame * HOP) / sr, strength: Math.min(1, p.strength / maxS) }));
  }

  const bassOnsets = normaliseStrengths(bassPeaks);
  const midOnsets  = normaliseStrengths(midPeaks);
  const highOnsets = normaliseStrengths(highPeaks);

  // ── 6. Merge all bands into one onset stream ─────────────────
  // Collect with source band tag, sort by time, suppress duplicates < 40ms
  type TaggedOnset = { time: number; strength: number; band: number };
  const merged: TaggedOnset[] = [
    ...bassOnsets.map(o => ({ ...o, band: 0 })),
    ...midOnsets .map(o => ({ ...o, band: 1 })),
    ...highOnsets.map(o => ({ ...o, band: 2 })),
  ].sort((a, b) => a.time - b.time);

  const DEDUP_SEC = 0.040;
  const deduped: TaggedOnset[] = [];
  for (const o of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && o.time - prev.time < DEDUP_SEC) {
      // Keep the stronger one; prefer bass > mid > high for band label
      if (o.strength > prev.strength) {
        deduped[deduped.length - 1] = { time: (prev.time + o.time) / 2, strength: o.strength, band: Math.min(prev.band, o.band) };
      }
    } else {
      deduped.push(o);
    }
  }

  const onsetTimes    = deduped.map(o => o.time);
  const onsetStrengths = deduped.map(o => o.strength);
  const onsetBands    = deduped.map(o => o.band);

  // ── 7. BPM + Beat Tracking ─────────────────────────────────────
  // Step A: IOI histogram on strength-weighted bass+mid onsets
  let estimatedBpm = 120;
  const ioi_onsets = [...bassOnsets, ...midOnsets].sort((a, b) => a.time - b.time);
  if (ioi_onsets.length >= 4) {
    // Fine bins (10ms) + coarser pass (20ms) combined for robustness
    const counts: Record<string, number> = {};
    for (const binSize of [0.010, 0.020]) {
      for (let i = 1; i < ioi_onsets.length; i++) {
        const ioi = ioi_onsets[i]!.time - ioi_onsets[i - 1]!.time;
        if (ioi < 0.18 || ioi > 2.8) continue;
        // Check multiple beat-fraction relationships
        for (const mult of [1, 0.5, 2, 0.333, 3, 0.25, 4]) {
          const scaled = ioi * mult;
          if (scaled < 0.18 || scaled > 2.8) continue;
          const bin = Math.round(scaled / binSize);
          // Weight: prefer x1 and x0.5 (direct beat and half-beat)
          const baseW = mult === 1 ? 4 : mult === 0.5 || mult === 2 ? 2.5 : 1;
          // Strength-weighted: strong onsets count more
          counts[`${binSize}_${bin}`] = ((counts[`${binSize}_${bin}`] ?? 0))
            + baseW * (ioi_onsets[i]!.strength * 0.7 + 0.3);
        }
      }
    }
    // Find best bin across all granularities → convert to BPM
    let bestBpm = 120, bestVal = 0;
    for (const [key, val] of Object.entries(counts)) {
      const [bsStr, binStr] = key.split("_");
      const bs = Number(bsStr), bin = Number(binStr);
      if (bin === 0) continue;
      const bpm = clamp(Math.round(60 / (bin * bs)), 55, 220);
      if (val > bestVal) { bestVal = val; bestBpm = bpm; }
    }
    estimatedBpm = bestBpm;
  }

  // Step B: Beat phase estimation — find the phase offset that maximises
  //         alignment between the beat grid and actual strong onsets.
  //         Try 8 phase candidates spaced beatSec/8 apart.
  const beatSec = 60 / estimatedBpm;
  const strongOnsets = [...bassOnsets, ...midOnsets]
    .filter(o => o.strength > 0.40)
    .map(o => o.time);

  function scoreBeatPhase(phase: number): number {
    // Score = sum of (1 - minDistToGrid/halfBeat) for each strong onset
    let score = 0;
    const halfBeat = beatSec / 2;
    for (const t of strongOnsets) {
      const distToNearestBeat = Math.abs(((t - phase) % beatSec + beatSec) % beatSec);
      const minDist = Math.min(distToNearestBeat, beatSec - distToNearestBeat);
      score += Math.max(0, 1 - minDist / halfBeat);
    }
    return score;
  }

  // Find anchor: first strong bass onset
  const rawAnchor = bassOnsets.find(o => o.strength > 0.45)?.time
    ?? bassOnsets[0]?.time
    ?? (onsetTimes[0] ?? 0);

  // Try 16 phases around the anchor
  let bestPhase = rawAnchor % beatSec;
  let bestPhaseScore = -1;
  for (let k = 0; k < 16; k++) {
    const candidate = (rawAnchor % beatSec) + (k / 16) * beatSec - beatSec / 2;
    const score = scoreBeatPhase(candidate);
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = candidate; }
  }

  // Generate beat grid, starting slightly before song start
  const beatTimes: number[] = [];
  const gridStart = bestPhase - Math.ceil((bestPhase + beatSec) / beatSec) * beatSec;
  for (let t = gridStart; t < buffer.duration + beatSec * 2; t += beatSec) {
    beatTimes.push(Math.round(t * 1000) / 1000);
  }

  // Downbeats = every 4th beat from phase
  const downbeatTimes = beatTimes.filter((_, i) => i % 4 === 0);

  // ── 8. Phrase breaks from IOI gaps ───────────────────────────
  // Use the merged onset stream; gap ≥ 280ms = phrase boundary
  const PHRASE_GAP = 0.22; // detect faster word/phrase gaps
  const phraseBreaks: number[] = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    const gap = onsetTimes[i]! - onsetTimes[i - 1]!;
    if (gap >= PHRASE_GAP) {
      phraseBreaks.push((onsetTimes[i - 1]! + onsetTimes[i]!) / 2);
    }
  }

  // ── 9. Section detection (long-term RMS novelty) ─────────────
  const L_WIN = Math.max(1, Math.round(2.0 / HOP_SEC));
  const L_HOP = Math.max(1, Math.round(0.5 / HOP_SEC));
  const lFrames = Math.max(1, Math.floor((frames - L_WIN) / L_HOP));
  const lEnergy  = new Float32Array(lFrames);
  for (let i = 0; i < lFrames; i++) {
    let s = 0;
    for (let j = 0; j < L_WIN; j++) { const e = fullEnergy[i * L_HOP + j] ?? 0; s += e * e; }
    lEnergy[i] = Math.sqrt(s / L_WIN);
  }
  let maxLE = 0;
  for (const v of lEnergy) if (v > maxLE) maxLE = v;
  if (maxLE > 0) for (let i = 0; i < lFrames; i++) lEnergy[i] /= maxLE;

  const sectionBoundaries: number[] = [0];
  for (let i = 4; i < lFrames - 4; i++) {
    const prev3 = (lEnergy[i - 1]! + lEnergy[i - 2]! + lEnergy[i - 3]! + lEnergy[i - 4]!) / 4;
    const next3 = (lEnergy[i]!     + lEnergy[i + 1]! + lEnergy[i + 2]! + lEnergy[i + 3]!) / 4;
    const eps = 0.01;
    const ratio = Math.abs(next3 - prev3) / (Math.min(prev3, next3) + eps);
    if (ratio > 0.28) { // lower threshold = more sensitive to energy changes
      const t = (i * L_HOP * HOP) / sr;
      // Snap to nearest beat for musically clean boundaries
      const nearestBeat = beatTimes.reduce((best, bt) => Math.abs(bt - t) < Math.abs(best - t) ? bt : best, t);
      const snapT = Math.abs(nearestBeat - t) < 1.0 ? nearestBeat : t;
      if (snapT - sectionBoundaries[sectionBoundaries.length - 1]! > 5) {
        sectionBoundaries.push(snapT);
      }
    }
  }
  sectionBoundaries.push(buffer.duration);

  // ── 10. Per-section energy ────────────────────────────────────
  const sectionEnergy: number[] = [];
  for (let s = 0; s < sectionBoundaries.length - 1; s++) {
    const f0 = Math.floor((sectionBoundaries[s]! * sr) / HOP);
    const f1 = Math.min(frames, Math.floor((sectionBoundaries[s + 1]! * sr) / HOP));
    let sum = 0, cnt = 0;
    for (let f = f0; f < f1; f++) { sum += fullEnergy[f]!; cnt++; }
    sectionEnergy.push(cnt > 0 ? sum / cnt : 0);
  }
  const maxSE = Math.max(...sectionEnergy, 1e-9);
  for (let i = 0; i < sectionEnergy.length; i++) sectionEnergy[i] /= maxSE;

  return {
    bassOnsets, midOnsets, highOnsets,
    onsetTimes, onsetStrengths, onsetBands,
    phraseBreaks, beatTimes, downbeatTimes,
    sectionBoundaries, sectionEnergy,
    estimatedBpm,
    frameEnergy: fullEnergy,
    frameRate: 1 / HOP_SEC,
  };
}

/* ─────────────────────────────────────────────────────────────────
   CHART GENERATION ENGINE — Band-aware, beat-aligned, phrase-driven
─────────────────────────────────────────────────────────────────── */

type SectionRole = "intro" | "verse" | "pre-chorus" | "chorus" | "bridge" | "outro";

function inferSectionRole(normPos: number, energy: number): SectionRole {
  if (normPos < 0.08)                          return "intro";
  if (normPos > 0.88)                          return "outro";
  if (energy > 0.78)                           return "chorus";
  if (energy > 0.58 && normPos > 0.3)          return "pre-chorus";
  if (energy < 0.28)                           return "bridge";
  return "verse";
}

// ── Pattern archetype per phrase ─────────────────────────────
type PatternArchetype = "groove" | "fill" | "peak" | "breakdown" | "run";

function selectArchetype(
  role:     SectionRole,
  barInPhrase: number,   // 0..3 — which bar within the 4-bar phrase
  energy:   number,
  diff:     DifficultyCatalogEntry,
  rng:      () => number,
): PatternArchetype {
  // Easy: groove → groove → light-variation → sustain/pause (approx bar 3-4)
  if (diff.id === "easy") {
    if (barInPhrase === 3) return "breakdown";
    return "groove";
  }

  // Bar role within phrase:
  //   Bar 0: establish (groove/peak)
  //   Bar 1: develop  (groove+offbeat / fill)
  //   Bar 2: lift     (peak / run)
  //   Bar 3: resolve  (breakdown / chord-peak)
  if (barInPhrase === 3) {
    if (!diff.patternBreakAllowed) return "groove";
    return rng() < 0.45 ? "breakdown" : "peak";
  }
  if (barInPhrase === 2) {
    if (energy > 0.6 && diff.maxSubdivision >= 2) return rng() < 0.5 ? "peak" : "run";
    return "fill";
  }
  if (barInPhrase === 1) {
    return energy > 0.5 ? "fill" : "groove";
  }
  // Bar 0
  switch (role) {
    case "chorus":     return "peak";
    case "pre-chorus": return energy > 0.5 ? "fill" : "groove";
    case "bridge":     return "breakdown";
    case "outro":      return "breakdown";
    default:           return "groove";
  }
}

// ── Band-to-lane affinity ─────────────────────────────────────
function bandLaneAffinity(band: number, laneCount: number): number[] {
  const w = new Array<number>(laneCount).fill(1.0);
  if (laneCount === 4) {
    if (band === 0) { w[0] = 3.5; w[1] = 2.0; w[2] = 0.8; w[3] = 0.4; }
    if (band === 1) { w[0] = 1.2; w[1] = 2.5; w[2] = 2.5; w[3] = 1.2; }
    if (band === 2) { w[0] = 0.4; w[1] = 0.8; w[2] = 2.0; w[3] = 3.5; }
  } else { // 3 lanes
    if (band === 0) { w[0] = 3.0; w[1] = 1.5; w[2] = 0.5; }
    if (band === 1) { w[0] = 1.0; w[1] = 3.0; w[2] = 1.0; }
    if (band === 2) { w[0] = 0.5; w[1] = 1.5; w[2] = 3.0; }
  }
  return w;
}

// ── Motion bias ───────────────────────────────────────────────
type MotionBias = "spread" | "cluster" | "zigzag" | "ascend" | "descend" | "center";

function archetypeMotionBias(
  archetype: PatternArchetype,
  energy:    number,
  rng:       () => number,
): MotionBias {
  switch (archetype) {
    case "groove":    return energy < 0.35 ? "center" : rng() < 0.5 ? "cluster" : "zigzag";
    case "fill":      return rng() < 0.5 ? "zigzag" : "spread";
    case "peak":      return rng() < 0.5 ? "spread" : (rng() < 0.5 ? "ascend" : "descend");
    case "run":       return rng() < 0.5 ? "ascend" : "descend";
    case "breakdown": return "center";
  }
}

// ── Lane picker ───────────────────────────────────────────────
function pickNextLane(
  rng:             () => number,
  lastLane:        number,
  laneCount:       number,
  freeLanes:       number[],
  band:            number,
  motionBias:      MotionBias,
  consecutiveSame: number,
  energy:          number,
  maxJump:         number,
): number {
  if (freeLanes.length === 0) return lastLane;
  if (freeLanes.length === 1) return freeLanes[0]!;

  // Hard cap: never repeat same lane 3× in a row
  let pool = consecutiveSame >= 2
    ? freeLanes.filter(l => l !== lastLane)
    : freeLanes;
  if (pool.length === 0) pool = freeLanes;

  // Apply maxJump constraint (spatial complexity axis)
  if (lastLane >= 0 && maxJump < laneCount - 1) {
    const constrained = pool.filter(l => Math.abs(l - lastLane) <= maxJump);
    if (constrained.length > 0) pool = constrained;
  }

  const affinity = bandLaneAffinity(band, laneCount);
  const affinityW = clamp(1.0 - energy * 0.45, 0.3, 1.0); // weaker at high energy

  const scores = pool.map(lane => {
    const dist = Math.abs(lane - lastLane);
    let mot = 1.0;
    switch (motionBias) {
      case "spread":  mot = dist >= 2 ? 3.2 : dist === 1 ? 1.5 : 0.3; break;
      case "cluster": mot = dist === 1 ? 3.0 : dist === 0 ? 1.3 : 0.2; break;
      case "zigzag":  mot = (lastLane % 2 === 0 ? lane % 2 !== 0 : lane % 2 === 0) ? 3.5 : 0.4; break;
      case "ascend":  mot = lane > lastLane ? 2.5 + dist * 0.7 : 0.2; break;
      case "descend": mot = lane < lastLane ? 2.5 + dist * 0.7 : 0.2; break;
      case "center": {
        const mid = (laneCount - 1) / 2;
        mot = 1.0 + (1.0 - Math.abs(lane - mid) / (mid + 0.01)) * 2.5;
        break;
      }
    }
    return { lane, score: affinity[lane]! * affinityW + mot * (2 - affinityW) };
  });

  const total = scores.reduce((s, x) => s + x.score, 0);
  let pick = rng() * total;
  for (const { lane, score } of scores) { pick -= score; if (pick <= 0) return lane; }
  return scores[scores.length - 1]!.lane;
}

// ── Local energy query ────────────────────────────────────────
function localEnergy(fe: Float32Array, fps: number, t: number, win = 0.15): number {
  const f0 = Math.max(0, Math.floor((t - win) * fps));
  const f1 = Math.min(fe.length - 1, Math.ceil((t + win) * fps));
  let s = 0, n = 0;
  for (let f = f0; f <= f1; f++) { s += fe[f]!; n++; }
  return n > 0 ? s / n : 0;
}

// ═══════════════════════════════════════════════════════════════
//  buildChartFromAnalysis — main entry point
// ═══════════════════════════════════════════════════════════════
function buildChartFromAnalysis(
  duration:   number,
  analysis:   AudioAnalysis,
  seed:       number,
  laneCount:  number,
  difficulty: DifficultyCatalogEntry,
): { notes: Note[]; totalNotes: number } {
  const notes:  Note[] = [];
  const rng = createRng(seed + DIFFICULTY_SEED_OFFSET[difficulty.id]);
  let   noteId = 1;

  const playStart = NOTE_SPAWN_LEAD;
  const playEnd   = duration - SONG_END_GUARD;
  const beatSec   = 60 / analysis.estimatedBpm;
  const songLen   = playEnd - playStart;

  // ── Beat helpers ──────────────────────────────────────────
  // SNAP adapts to tempo: 28% of a beat, clamped 35ms..90ms
  const SNAP = clamp(beatSec * 0.28, 0.035, 0.090);
  function isDownbeat(t: number) { return analysis.downbeatTimes.some(d => Math.abs(d - t) < SNAP); }
  function isOnBeat(t: number)   { return analysis.beatTimes.some(b => Math.abs(b - t) < SNAP); }
  // isOnSubdiv(t, 2) = 8th note position; isOnSubdiv(t, 4) = 16th note
  function isOnSubdiv(t: number, subdiv: number): boolean {
    const subBeat = beatSec / subdiv;
    return analysis.beatTimes.some(b => {
      const rel = ((t - b) % (subBeat * subdiv) + subBeat * subdiv) % (subBeat * subdiv);
      const nearSub = Math.round(rel / subBeat) * subBeat;
      return Math.abs(rel - nearSub) < SNAP;
    });
  }

  // ── Section energy lookup ─────────────────────────────────
  function sectionEnergyAt(t: number): number {
    const sb = analysis.sectionBoundaries;
    for (let i = 0; i < sb.length - 1; i++) {
      if (t >= sb[i]! && t < sb[i + 1]!) return analysis.sectionEnergy[i] ?? 0.5;
    }
    return analysis.sectionEnergy[analysis.sectionEnergy.length - 1] ?? 0.5;
  }

  // ── Build phrase grid ────────────────────────────────────
  // 4-bar phrases aligned to beat grid; phrase boundaries also
  // snap to detected section changes and IOI breaks.
  const rawBounds = new Set<number>([playStart, playEnd]);
  for (const t of analysis.sectionBoundaries) if (t > playStart && t < playEnd) rawBounds.add(t);
  for (const t of analysis.phraseBreaks)      if (t > playStart && t < playEnd) rawBounds.add(t);

  const sortedBounds = Array.from(rawBounds).sort((a, b) => a - b);
  const pBounds: number[] = [];
  for (const t of sortedBounds) {
    if (pBounds.length === 0 || t - pBounds[pBounds.length - 1]! > 1.8) pBounds.push(t);
  }

  interface PhraseInfo {
    start: number; end: number; energy: number;
    role: SectionRole; normPos: number; index: number;
  }
  const phrases: PhraseInfo[] = pBounds.slice(0, -1).map((ps, i) => {
    const pe      = pBounds[i + 1]!;
    const mid     = (ps + pe) / 2;
    const secEng  = sectionEnergyAt(mid);
    const frmEng  = localEnergy(analysis.frameEnergy, analysis.frameRate, mid, (pe - ps) / 2);
    const energy  = clamp(secEng * 0.65 + frmEng * 2.0 * 0.35, 0, 1);
    const normPos = clamp((mid - playStart) / songLen, 0, 1);
    return { start: ps, end: pe, energy, role: inferSectionRole(normPos, energy), normPos, index: i };
  });

  // ── Filter onset stream by difficulty ─────────────────────
  // Easy = bass only. Medium = bass+mid. Normal/Hard = all bands.
  const allowedBands = new Set(difficulty.chartBands);
  const allOnsets = analysis.onsetTimes
    .map((t, i) => ({ time: t, strength: analysis.onsetStrengths[i]!, band: analysis.onsetBands[i]! }))
    .filter(o => o.time >= playStart && o.time < playEnd && allowedBands.has(o.band));

  if (allOnsets.length === 0) return { notes: [], totalNotes: 0 };

  // ── State ─────────────────────────────────────────────────
  const laneBusy = new Array<number>(laneCount).fill(-1);

  let lastLane         = Math.floor(laneCount / 2);
  let consecutiveSame  = 0;
  let currentPhraseIdx = -1;
  let currentArchetype: PatternArchetype = "groove";
  let currentBias: MotionBias = "zigzag";
  let currentEnergy   = 0.5;
  let currentBarInPhrase = 0;
  let lastNoteTime     = -999;

  // Fakeout state: after a run, occasionally silence a beat
  let fakeoutUntil = -1;

  // Motif memory: record first occurrence of each phrase index to allow motif recall
  const motifBias = new Map<number, MotionBias>();

  // ── Main loop ─────────────────────────────────────────────
  for (let oi = 0; oi < allOnsets.length; oi++) {
    const o       = allOnsets[oi]!;
    const hitTime = o.time;
    const strength = o.strength;
    const band    = o.band;

    // ── Phrase + bar context ──────────────────────────────
    const pi = phrases.findIndex(p => hitTime >= p.start && hitTime < p.end);
    const phrase = phrases[pi >= 0 ? pi : 0]!;

    if (pi >= 0 && pi !== currentPhraseIdx) {
      currentPhraseIdx = pi;
      currentEnergy    = phrase.energy;

      // Bar 0 of this phrase
      currentBarInPhrase = 0;

      // Motif recall: reuse bias from phrase (pi - 4) if available
      const recalled = motifBias.get(pi - 4);
      const archetype = selectArchetype(phrase.role, 0, phrase.energy, difficulty, rng);
      currentArchetype = archetype;
      currentBias = recalled ?? archetypeMotionBias(archetype, phrase.energy, rng);
      motifBias.set(pi, currentBias);
    }

    // ── Update bar position within phrase ────────────────
    const barDur = beatSec * 4;
    const newBar = Math.floor((hitTime - phrase.start) / barDur);
    if (newBar !== currentBarInPhrase && newBar < 4) {
      currentBarInPhrase = newBar;
      const newArch = selectArchetype(phrase.role, newBar, phrase.energy, difficulty, rng);
      currentArchetype = newArch;
      currentBias = archetypeMotionBias(newArch, phrase.energy, rng);
    }

    const pEnergy = currentEnergy;

    // ── Minimum gap enforcement (rhythmic axis) ───────────
    if (hitTime - lastNoteTime < difficulty.minOnsetGapSec) continue;

    // ── Fakeout: silence during a breakdown fakeout ───────
    if (difficulty.fakeoutAllowed && hitTime < fakeoutUntil) continue;

    // ── Syncopation filter (Easy/Medium: no offbeats) ─────
    if (!difficulty.syncopationAllowed) {
      // Only allow onsets that are close to a beat
      if (!isOnBeat(hitTime) && !isDownbeat(hitTime)) {
        // Hard skip for non-beat onsets in easy/medium
        if (rng() > 0.15) continue;
      }
    }

    // ── Subdivision depth gate ────────────────────────────
    // Easy: quarter notes only. Medium: 8th. Normal/Hard: 16th on runs.
    const minBeatFrac = beatSec / difficulty.maxSubdivision;
    if (hitTime - lastNoteTime < minBeatFrac * 0.75 && !isDownbeat(hitTime)) continue;
    // For Easy: require being on a beat grid position
    if (difficulty.maxSubdivision === 1 && !isOnBeat(hitTime) && !isDownbeat(hitTime)) {
      if (rng() > 0.12) continue;
    }
    // For Medium: allow 8th notes but reject pure offbeats
    if (difficulty.maxSubdivision === 2 && !isOnBeat(hitTime)) {
      if (!isOnSubdiv(hitTime, 2) && rng() > 0.22) continue;
    }

    // ── Density gate ──────────────────────────────────────
    // Core = always chart (strong bass / downbeat / very strong onset)
    const isCore = (band === 0 && strength > difficulty.coreStrengthMin)
      || isDownbeat(hitTime)
      || strength > 0.82;

    if (!isCore) {
      const keep = clamp(difficulty.densityScale * (0.45 + pEnergy * 0.55), 0.04, 0.92);
      if (rng() > keep) continue;
    }

    // Thin in near-silence
    const fEng = localEnergy(analysis.frameEnergy, analysis.frameRate, hitTime, 0.08);
    if (fEng < 0.004 && rng() > 0.25) continue;

    // ── Post-break breathing room ─────────────────────────
    const justAfterBreak = analysis.phraseBreaks.some(pb => pb < hitTime && hitTime - pb < 0.30);
    if (justAfterBreak && rng() > 0.55) continue;

    // ── Breakdown archetype: very sparse ─────────────────
    if (currentArchetype === "breakdown") {
      // Only chart downbeats + very strong onsets; thin everything else hard
      if (!isDownbeat(hitTime) && strength < 0.7) {
        if (rng() > 0.20) continue;
      }
      // Fakeout: if allowed, silence next beat after a peak in a breakdown
      if (difficulty.fakeoutAllowed && isDownbeat(hitTime) && rng() < 0.22) {
        fakeoutUntil = hitTime + beatSec * 1.5;
      }
    }

    // ── Free lanes ────────────────────────────────────────
    const freeLanes = Array.from({ length: laneCount }, (_, l) => l)
      .filter(l => laneBusy[l]! <= hitTime - difficulty.minOnsetGapSec);
    if (freeLanes.length === 0) continue;

    // ── Chord decision ────────────────────────────────────
    let didChord = false;
    if (difficulty.chordAllowed && freeLanes.length >= 2) {
      const onDB = isDownbeat(hitTime), onBeat = isOnBeat(hitTime);
      const chordP = onDB && strength > 0.60 && pEnergy > 0.50
        ? clamp(difficulty.chordScale * pEnergy * 0.32, 0, 0.44)
        : onBeat && strength > 0.72 && pEnergy > 0.62
          ? clamp(difficulty.chordScale * pEnergy * 0.16, 0, 0.28)
          : 0;

      if (rng() < chordP) {
        const ln1 = pickNextLane(rng, lastLane, laneCount, freeLanes, band, currentBias, consecutiveSame, pEnergy, difficulty.maxLaneJump);
        const other = freeLanes.filter(l => l !== ln1 && Math.abs(l - ln1) >= 1);
        if (other.length > 0) {
          const ln2 = other[Math.floor(rng() * other.length)]!;
          for (const ln of [ln1, ln2]) {
            notes.push({ id: noteId++, lane: ln, hitTime, duration: 0,
              holdTicksScored: 0, holdBroken: false, holdComplete: true, judged: false });
            laneBusy[ln] = hitTime + difficulty.minOnsetGapSec;
          }
          consecutiveSame = ln1 === lastLane ? consecutiveSame + 1 : 0;
          lastLane = ln1; lastNoteTime = hitTime;
          didChord = true;
        }
      }
    }
    if (didChord) continue;

    // ── Single note ───────────────────────────────────────
    const lane = pickNextLane(rng, lastLane, laneCount, freeLanes, band, currentBias, consecutiveSame, pEnergy, difficulty.maxLaneJump);
    consecutiveSame = lane === lastLane ? consecutiveSame + 1 : 0;
    lastLane = lane; lastNoteTime = hitTime;

    // ── Sustain decision ──────────────────────────────────
    // No sustain on hi-hat / breakdowns / high energy
    const next    = allOnsets[oi + 1];
    const gap     = next ? next.time - hitTime : beatSec * 2;
    const wantSustain =
      band !== 2 &&
      currentArchetype !== "run" &&
      gap >= MIN_SUSTAIN_SECONDS * 1.25 &&
      pEnergy < 0.78 &&
      !analysis.phraseBreaks.some(pb => pb > hitTime && pb < hitTime + gap * 0.7);
    const sustainP = wantSustain
      ? clamp(difficulty.sustainScale * 0.17 * (1.0 - pEnergy * 0.35), 0, 0.48)
      : 0;
    const isSustain  = rng() < sustainP;
    const sustainDur = isSustain
      ? clamp(gap * 0.60, MIN_SUSTAIN_SECONDS, beatSec * 2.5)
      : 0;

    notes.push({
      id: noteId++, lane, hitTime, duration: sustainDur,
      holdTicksScored: 0, holdBroken: false,
      holdComplete: sustainDur === 0, judged: false,
    });
    laneBusy[lane] = hitTime + sustainDur + MIN_GAP_AFTER_SUSTAIN;
  }

  notes.sort((a, b) => a.hitTime !== b.hitTime ? a.hitTime - b.hitTime : a.lane - b.lane);
  return { notes, totalNotes: notes.length };
}



/* ─────────────────────────────────────────────────────────────────
   PURE HELPERS
───────────────────────────────────────────────────────────────── */
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function createStats(): PlayerStats {
  return { score: 0, combo: 0, bestCombo: 0, hits: 0, misses: 0, perfect: 0, great: 0, good: 0, totalJudged: 0, accuracyPoints: 0 };
}
function createEngineState(): EngineState {
  return { running: false, finished: false, elapsed: 0, duration: 0, notes: [], stageIndex: 0, player: createStats(), totalNotes: 0 };
}
function getMultiplier(combo: number) { return Math.min(4, 1 + Math.floor(combo / 10)); }
function getAccuracy(s: PlayerStats) { return s.totalJudged <= 0 ? 0 : Math.round((s.accuracyPoints / s.totalJudged) * 100); }
function getGrade(acc: number) {
  if (acc >= 97) return "SS"; if (acc >= 93) return "S"; if (acc >= 88) return "A";
  if (acc >= 80) return "B"; if (acc >= 72) return "C"; return "D";
}
function formatClock(totalSeconds: number) {
  const w = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(w / 60).toString().padStart(2, "0")}:${(w % 60).toString().padStart(2, "0")}`;
}
function formatKey(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num${code.slice(6)}`;
  return ({ Space: "SPC", ShiftLeft: "LSH", ShiftRight: "RSH", ControlLeft: "LCT", ControlRight: "RCT", AltLeft: "ALT", AltRight: "ALT", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[code] ?? code;
}
function toTrackY(hitTime: number, elapsed: number, hitLineY: number) {
  return ((elapsed - (hitTime - NOTE_TRAVEL_SECONDS)) / NOTE_TRAVEL_SECONDS) * hitLineY;
}
function createRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / RNG_MODULUS; };
}



/* ─────────────────────────────────────────────────────────────────
   CHART BUILDING — BPM FALLBACK (when analysis not available)
   Fixed-grid with overlap prevention.
───────────────────────────────────────────────────────────────── */
function resolveStages(songBpm: number, difficulty: DifficultyCatalogEntry) {
  const beatHz = songBpm / 60;
  const minStep = MIN_STEP_SECONDS_BY_DIFFICULTY[difficulty.id] * beatHz;
  return BASE_STAGES.map(stage => ({
    ...stage,
    bpm: songBpm,
    beatStep: clamp(Math.max(stage.beatStep * difficulty.beatStepScale, minStep), 0.25, 2.5),
    density: clamp(stage.density * difficulty.densityScale, 0.12, 1),
    chordChance: clamp(stage.chordChance * difficulty.chordScale, 0, 0.95),
    sustainChance: clamp(stage.sustainChance * difficulty.sustainScale, 0.04, 0.5),
  }));
}

function getStageIndex(elapsed: number, duration: number, stages: StageConfig[]) {
  if (duration <= 0) return 0;
  const p = clamp(elapsed / duration, 0, 0.999999);
  for (let i = 0; i < stages.length; i++) if (p < stages[i].endRatio) return i;
  return stages.length - 1;
}

function firstBeatAtOrAfter(time: number, step: number, offset: number) {
  return offset + Math.ceil((time - offset) / step) * step;
}

function buildChart(duration: number, stages: StageConfig[], beatOffset: number, seed: number, laneCount: number) {
  const notes: Note[] = [];
  const playableSpan = Math.max(12, duration - (NOTE_SPAWN_LEAD + SONG_END_GUARD));
  let noteId = 1;
  const rng = createRng(seed);
  let lastLane = -1;
  // Per-lane busy tracking
  const laneBusyUntil = new Array<number>(laneCount).fill(-1);

  for (const stage of stages) {
    const stageStart = NOTE_SPAWN_LEAD + playableSpan * stage.startRatio;
    const stageEnd   = NOTE_SPAWN_LEAD + playableSpan * stage.endRatio;
    const stageDuration = Math.max(0.001, stageEnd - stageStart);
    const beatHz     = stage.bpm / 60;
    const beatSec    = 1 / beatHz;
    const stepSec    = stage.beatStep / beatHz;
    const pressure   = clamp((0.24 - stepSec) / 0.11, 0, 1);
    const stageDensity  = clamp(stage.density * (1 - pressure * 0.52), 0.12, 1);
    const stageChord    = clamp(stage.chordChance * (1 - pressure * 0.9), 0, 0.95);
    const stageSustain  = clamp(stage.sustainChance * (1 - pressure * 0.62), 0.03, 0.5);

    for (let hitTime = firstBeatAtOrAfter(stageStart, stepSec, beatOffset); hitTime < stageEnd; hitTime += stepSec) {
      const bi       = Math.round((hitTime - beatOffset) / beatSec);
      const isStrong = bi % 2 === 0;
      const isDown   = bi % 4 === 0;
      const localP   = clamp((hitTime - stageStart) / stageDuration, 0, 1);
      const pulse    = 0.95 + Math.sin(localP * Math.PI * 2) * 0.06;
      const spawnC   = clamp(stageDensity * pulse * (isDown ? 1.08 : isStrong ? 1 : 0.92), 0.12, 1);

      if (rng() > spawnC) continue;

      // Find free lanes
      const freeLanes: number[] = [];
      for (let l = 0; l < laneCount; l++) if (laneBusyUntil[l] <= hitTime) freeLanes.push(l);
      if (freeLanes.length === 0) continue;

      const preferredLanes = freeLanes.filter(l => l !== lastLane);
      const pool = preferredLanes.length > 0 ? preferredLanes : freeLanes;
      const lane = pool[Math.floor(rng() * pool.length)];
      lastLane = lane;

      const sustainBeats = Math.max(1, stage.sustainBeats - (rng() < 0.45 ? 1 : 0));
      const sustainDuration = Math.max(MIN_SUSTAIN_SECONDS, sustainBeats * beatSec);
      const canFitSustain = hitTime + sustainDuration + stepSec * 0.4 < stageEnd;
      const isSustain = canFitSustain && rng() < stageSustain;

      notes.push({ id: noteId++, lane, hitTime, duration: isSustain ? sustainDuration : 0, holdTicksScored: 0, holdBroken: false, holdComplete: !isSustain, judged: false });
      laneBusyUntil[lane] = hitTime + (isSustain ? sustainDuration : 0) + MIN_GAP_AFTER_SUSTAIN;

      if (!isSustain && laneCount > 1 && rng() < stageChord) {
        const chordFree = freeLanes.filter(l => l !== lane && laneBusyUntil[l] <= hitTime);
        if (chordFree.length > 0) {
          const lane2 = chordFree[Math.floor(rng() * chordFree.length)];
          notes.push({ id: noteId++, lane: lane2, hitTime, duration: 0, holdTicksScored: 0, holdBroken: false, holdComplete: true, judged: false });
          laneBusyUntil[lane2] = hitTime + MIN_GAP_AFTER_SUSTAIN;
        }
      }
    }
  }

  notes.sort((a, b) => a.hitTime !== b.hitTime ? a.hitTime - b.hitTime : a.lane - b.lane);
  return { notes, totalNotes: notes.length };
}

/* ─────────────────────────────────────────────────────────────────
   ENGINE STEP FUNCTIONS
───────────────────────────────────────────────────────────────── */
function ensureChart(
  engine: EngineState,
  stages: StageConfig[],
  beatOffset: number,
  seed: number,
  laneCount: number,
  difficulty: DifficultyCatalogEntry,
  analysis: AudioAnalysis | null,
) {
  if (engine.duration <= 0 || engine.notes.length > 0) return;
  const chart = analysis && analysis.onsetTimes.length > 20
    ? buildChartFromAnalysis(engine.duration, analysis, seed, laneCount, difficulty)
    : buildChart(engine.duration, stages, beatOffset, seed, laneCount);
  engine.notes = chart.notes;
  engine.totalNotes = chart.totalNotes;
}

function applyMiss(s: PlayerStats)       { s.misses++; s.combo = 0; s.totalJudged++; }
function applySustainBreak(s: PlayerStats) { s.misses++; s.combo = 0; }

function stepEngineToTime(engine: EngineState, nextElapsed: number, stages: StageConfig[], goodWindow: number) {
  let misses = 0;
  const elapsed = clamp(nextElapsed, 0, engine.duration > 0 ? engine.duration : Infinity);
  engine.elapsed = elapsed;
  engine.stageIndex = getStageIndex(elapsed, engine.duration, stages);
  for (const n of engine.notes) {
    if (n.judged) continue;
    if (elapsed - n.hitTime > goodWindow) { n.judged = true; n.judgment = "miss"; applyMiss(engine.player); misses++; }
  }
  return misses;
}

function stepSustainToTime(engine: EngineState, prevElapsed: number, lanePressed: boolean[]) {
  let misses = 0;
  const to = Math.max(prevElapsed, engine.elapsed);
  for (const n of engine.notes) {
    if (!n.judged || n.judgment === "miss" || n.duration <= 0 || n.holdBroken || n.holdComplete) continue;
    const holdEnd = n.hitTime + n.duration;
    if (to <= n.hitTime) continue;
    const progressed = clamp(Math.min(to, holdEnd) - n.hitTime, 0, n.duration);
    const totalTicks = Math.floor(progressed / SUSTAIN_SCORE_INTERVAL);
    if (totalTicks > n.holdTicksScored) {
      const delta = totalTicks - n.holdTicksScored;
      n.holdTicksScored = totalTicks;
      engine.player.score += delta * SUSTAIN_TICK_SCORE * getMultiplier(engine.player.combo);
    }
    if (to >= holdEnd) { n.holdComplete = true; continue; }
    if (!lanePressed[n.lane]) { n.holdBroken = true; applySustainBreak(engine.player); misses++; }
  }
  return misses;
}

function createViewState(engine: EngineState, goodWindow: number, trackHeight: number, hitLineY: number): ViewState {
  const visibleNotes: VisibleNote[] = [];
  for (const n of engine.notes) {
    const isActiveHeld = n.duration > 0 && n.judged && n.judgment !== "miss" && !n.holdComplete && !n.holdBroken;
    if (isActiveHeld) {
      const holdEnd  = n.hitTime + n.duration;
      const remaining = clamp(holdEnd - engine.elapsed, 0, n.duration);
      const tail     = clamp((remaining / NOTE_TRAVEL_SECONDS) * hitLineY, NOTE_HEAD_HEIGHT, trackHeight * 0.72);
      visibleNotes.push({ id: n.id, lane: n.lane, y: hitLineY - (tail - NOTE_HEAD_HEIGHT), height: tail, isSustain: true });
      continue;
    }
    if (n.judged) continue;
    const timeUntil = n.hitTime - engine.elapsed;
    if (timeUntil > NOTE_TRAVEL_SECONDS + 0.2) continue;
    if (timeUntil < -goodWindow - NOTE_VISIBLE_AFTER_MISS) continue;
    const headY = toTrackY(n.hitTime, engine.elapsed, hitLineY);
    if (headY < -44 || headY > trackHeight + 36) continue;
    const tail  = n.duration > 0 ? clamp((n.duration / NOTE_TRAVEL_SECONDS) * hitLineY, 34, trackHeight * 0.72) : NOTE_HEAD_HEIGHT;
    visibleNotes.push({ id: n.id, lane: n.lane, y: headY - (tail - NOTE_HEAD_HEIGHT), height: tail, isSustain: n.duration > 0 });
  }
  return { running: engine.running, finished: engine.finished, elapsed: engine.elapsed, duration: engine.duration, stageIndex: engine.stageIndex, visibleNotes, player: { ...engine.player }, totalNotes: engine.totalNotes };
}

function findClosestNote(notes: Note[], lane: number, elapsed: number, goodWindow: number) {
  let best: { note: Note; absDelta: number } | null = null;
  for (const n of notes) {
    if (n.judged || n.lane !== lane) continue;
    const d = Math.abs(n.hitTime - elapsed);
    if (!best || d < best.absDelta) best = { note: n, absDelta: d };
  }
  return best && best.absDelta <= goodWindow ? best : null;
}

function judgmentFromDelta(d: number, w: TimingWindows): Exclude<Judgment, "miss"> | null {
  if (d <= w.perfectWindow) return "perfect";
  if (d <= w.greatWindow)   return "great";
  if (d <= w.goodWindow)    return "good";
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   VIDEO EXTENSIONS — try common extensions next to the audio file
───────────────────────────────────────────────────────────────── */
const VIDEO_EXTS = [".mp4", ".webm", ".mov"] as const;

function getVideoSrcCandidates(musicSrc: string): string[] {
  const base = musicSrc.replace(/\.[^.]+$/, "");
  return VIDEO_EXTS.map(ext => base + ext);
}

/* ─────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────── */
/* ════════════════════════════════════════════════════════════════
   FIREBASE BOOTSTRAP  (shared with game)
════════════════════════════════════════════════════════════════ */
const _FB = {
  apiKey: "AIzaSyBbdqsAsZ9PWW8LBgnyq1IOsYxSKtFyiGA",
  authDomain: "gameshub-99479.firebaseapp.com",
  projectId: "gameshub-99479",
  storageBucket: "gameshub-99479.firebasestorage.app",
  messagingSenderId: "225729897472",
  appId: "1:225729897472:web:b360048a54124778bb64e5",
};
const _fbApp  = getApps().length > 0 ? getApp() : initializeApp(_FB);
const _fbAuth = getAuth(_fbApp);
const _fbDb   = getFirestore(_fbApp);

/* ════════════════════════════════════════════════════════════════
   STAGE EDITOR — TYPES + CONSTANTS
════════════════════════════════════════════════════════════════ */
type EditorNote  = { id:string; lane:number; time:number; duration:number; };
type EditorStage = {
  firestoreId?:string; title:string; artist:string; bpm:number;
  beatOffset:number; laneCount:number; audioName:string; notes:EditorNote[];
  authorUid?:string; authorName?:string;
};
type EditorTool = "select"|"tap"|"hold"|"erase";

const SE_COLORS   = ["#22d07a","#ef4545","#f0b429","#3b9eff"] as const;
const SE_KEYS     = ["D","F","J","K"] as const;
const SE_WV_H     = 60;
const SE_RULER_H  = 22;
const SE_HDR_H    = SE_WV_H + SE_RULER_H;
const SE_LANE_H   = 52;
const SE_NOTE_W   = 32;
const SE_MIN_HOLD = 0.12;
const SE_PPS_BASE = 120;
const SE_SNAPS    = [{l:"Free",d:0},{l:"1/1",d:1},{l:"1/2",d:2},{l:"1/4",d:4},{l:"1/8",d:8},{l:"1/16",d:16}] as const;

/* ── helpers ── */
let _seId = 1;
const seNewId = () => `n${_seId++}${Math.random().toString(36).slice(2,5)}`;
const seClamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v));
function seSnap(raw:number,bpm:number,off:number,div:number):number {
  if(div===0) return Math.max(0,raw);
  const g=(60/bpm)/div;
  return Math.max(0,Math.round((raw-off)/g)*g+off);
}
function seFmt(s:number):string {
  return `${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,"0")}`;
}

/* ── waveform ── */
async function seDecodeWaveform(file:File,target=8000):Promise<{peaks:Float32Array;duration:number}> {
  const buf=await file.arrayBuffer();
  return seDecodeWaveformFromBuffer(buf,target);
}
async function seDecodeWaveformFromBuffer(buf:ArrayBuffer,target=8000):Promise<{peaks:Float32Array;duration:number}> {
  const Ctor=window.AudioContext??(window as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  const actx=new Ctor();
  const audio=await actx.decodeAudioData(buf);
  await actx.close();
  const ch=audio.getChannelData(0);
  const step=Math.max(1,Math.floor(ch.length/target));
  const peaks=new Float32Array(target);
  for(let i=0;i<target;i++){let mx=0;const s0=i*step;for(let j=0;j<step;j++)mx=Math.max(mx,Math.abs(ch[s0+j]??0));peaks[i]=mx;}
  return {peaks,duration:audio.duration};
}

/* ── IndexedDB for editor draft (audio/video blobs survive refresh) ── */
const SE_IDB_NAME="raidHeroStageEditor";
const SE_IDB_STORE="blobs";
function seIdbOpen():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(SE_IDB_NAME,1);
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>resolve(r.result);
    r.onupgradeneeded=()=>{ r.result.createObjectStore(SE_IDB_STORE); };
  });
}
async function seIdbPut(key:string,blob:Blob):Promise<void> {
  const db=await seIdbOpen();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(SE_IDB_STORE,"readwrite");
    t.objectStore(SE_IDB_STORE).put(blob,key);
    t.oncomplete=()=>{ db.close(); resolve(); };
    t.onerror=()=>{ db.close(); reject(t.error); };
  });
}
async function seIdbGet(key:string):Promise<Blob|undefined> {
  const db=await seIdbOpen();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(SE_IDB_STORE,"readonly");
    const r=t.objectStore(SE_IDB_STORE).get(key);
    t.oncomplete=()=>{ db.close(); resolve(r.result); };
    t.onerror=()=>{ db.close(); reject(t.error); };
  });
}

function sePaint(ctx:CanvasRenderingContext2D,peaks:Float32Array,w:number,h:number,scrollX:number,pps:number,dur:number) {
  ctx.clearRect(0,0,w,h); ctx.fillStyle="#080d16"; ctx.fillRect(0,0,w,h);
  if(!peaks.length||!dur) return;
  const totalPx=dur*pps;
  const i0=Math.floor((scrollX/totalPx)*peaks.length);
  const i1=Math.ceil(((scrollX+w)/totalPx)*peaks.length);
  const mid=h/2;
  const grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,"rgba(34,208,122,0.12)");
  grad.addColorStop(.5,"rgba(34,208,122,0.46)");
  grad.addColorStop(1,"rgba(34,208,122,0.12)");
  ctx.beginPath(); ctx.moveTo(0,mid);
  for(let px=0;px<w;px++){const si=i0+Math.floor((px/w)*(i1-i0));const a=(peaks[si]??0)*mid*.88;ctx.lineTo(px,mid-a);}
  for(let px=w-1;px>=0;px--){const si=i0+Math.floor((px/w)*(i1-i0));const a=(peaks[si]??0)*mid*.88;ctx.lineTo(px,mid+a);}
  ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
  ctx.beginPath();
  for(let px=0;px<w;px++){const si=i0+Math.floor((px/w)*(i1-i0));const a=(peaks[si]??0)*mid*.88;px===0?ctx.moveTo(px,mid-a):ctx.lineTo(px,mid-a);}
  ctx.strokeStyle="#22d07a"; ctx.lineWidth=1.4; ctx.globalAlpha=.88; ctx.stroke(); ctx.globalAlpha=1;
}

/* ── Firestore ── */
async function seFsSave(s:EditorStage):Promise<string> {
  const p={...s,savedAt:serverTimestamp(),authorUid:_fbAuth.currentUser?.uid??null,authorName:_fbAuth.currentUser?.displayName??"anonymous"};
  if(s.firestoreId){await updateDoc(doc(_fbDb,"raid-hero-stages",s.firestoreId),p);return s.firestoreId;}
  const ref=await addDoc(collection(_fbDb,"raid-hero-stages"),p); return ref.id;
}
async function seFsLoad():Promise<EditorStage[]> {
  const q=query(collection(_fbDb,"raid-hero-stages"),orderBy("savedAt","desc"));
  const snap=await getDocs(q);
  return snap.docs.map(d=>({firestoreId:d.id,...d.data()} as EditorStage));
}
async function seFsDel(id:string){await deleteDoc(doc(_fbDb,"raid-hero-stages",id));}

/* ════════════════════════════════════════════════════════════════
   STAGE EDITOR — COMPONENT
════════════════════════════════════════════════════════════════ */
function StageEditor({onClose}:{onClose:()=>void}) {
  /* ── audio ─────────────────────────────────────────────────── */
  const [audioFile,setAudioFile] = useState<File|null>(null);
  const [audioUrl, setAudioUrl]  = useState("");
  const [peaks,    setPeaks]     = useState<Float32Array>(new Float32Array());
  const [dur,      setDur]       = useState(0);
  const [playing,  setPlaying]   = useState(false);
  const seAudioEl  = useRef<HTMLAudioElement|null>(null);
  const seRaf      = useRef(0);
  /* ── video ──────────────────────────────────────────────────── */
  const [videoFile,setVideoFile]       = useState<File|null>(null);
  const [videoUrl, setVideoUrl]        = useState("");
  const [videoOffset,setVideoOffset]   = useState(() => {
    try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return typeof s.videoOffset === "number" ? s.videoOffset : 0; } catch { return 0; }
  });
  const [showVideo,setShowVideo]       = useState(true);
  const [videoDockHeight, setVideoDockHeight] = useState(200);
  const seVideoEl  = useRef<HTMLVideoElement|null>(null);

  /* ── stage data (initial from draft so refresh restores) ──────── */
  const [sTitle,  setSTitle]  = useState(() => { try { const m = JSON.parse(localStorage.getItem("raidHero:stageEditor:meta") ?? "{}") as Record<string, unknown>; return (m.title as string) ?? ""; } catch { return ""; } });
  const [sArtist, setSArtist] = useState(() => { try { const m = JSON.parse(localStorage.getItem("raidHero:stageEditor:meta") ?? "{}") as Record<string, unknown>; return (m.artist as string) ?? ""; } catch { return ""; } });
  const [sBpm,    setSBpm]    = useState(() => { try { const m = JSON.parse(localStorage.getItem("raidHero:stageEditor:meta") ?? "{}") as Record<string, unknown>; return typeof m.bpm === "number" ? m.bpm : 120; } catch { return 120; } });
  const [sOff,    setSOff]    = useState(() => { try { const m = JSON.parse(localStorage.getItem("raidHero:stageEditor:meta") ?? "{}") as Record<string, unknown>; return typeof m.offset === "number" ? m.offset : 0; } catch { return 0; } });
  const [sLanes,  setSLanes]  = useState(() => { try { const m = JSON.parse(localStorage.getItem("raidHero:stageEditor:meta") ?? "{}") as Record<string, unknown>; return typeof m.lanes === "number" ? m.lanes : 4; } catch { return 4; } });
  const [sNotes,  setSNotes]  = useState<EditorNote[]>(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; const n = s.notes; return Array.isArray(n) ? (n as EditorNote[]) : []; } catch { return []; } });
  const [sFsId,   setSFsId]   = useState<string|undefined>();
  const [playtestOffsetSec, setPlaytestOffsetSec] = useState(0);
  const [showPlaytest, setShowPlaytest] = useState(false);
  const [audioFileName, setAudioFileName] = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return (s.audioFileName as string) ?? ""; } catch { return ""; } });
  const [videoFileName, setVideoFileName] = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return (s.videoFileName as string) ?? ""; } catch { return ""; } });

  /* ── refs for hot values (avoid stale closures) ─────────────── */
  const sNotesRef = useRef<EditorNote[]>([]);
  const sBpmRef   = useRef(120);
  const sOffRef   = useRef(0);
  const sLanesRef = useRef(4);
  const snapRef   = useRef(4);
  const ppsRef    = useRef(SE_PPS_BASE);

  // Keep refs in sync
  useEffect(()=>{ sNotesRef.current=sNotes; },[sNotes]);
  useEffect(()=>{ sBpmRef.current=sBpm; },[sBpm]);
  useEffect(()=>{ sOffRef.current=sOff; },[sOff]);
  useEffect(()=>{ sLanesRef.current=sLanes; },[sLanes]);

  /* ── editor ui state (zoom/snap/playhead/scroll restored from draft) ── */
  const [tool,    setTool]    = useState<EditorTool>("tap");
  const [zoom,    setZoom]    = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return typeof s.zoom === "number" ? s.zoom : 1; } catch { return 1; } });
  const [snap,    setSnap]    = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return typeof s.snap === "number" ? s.snap : 4; } catch { return 4; } });
  const [selId,   setSelId]   = useState<string|null>(null);
  const toolRef   = useRef<EditorTool>("tap");
  const selIdRef  = useRef<string|null>(null);
  useEffect(()=>{ toolRef.current=tool; },[tool]);
  useEffect(()=>{ selIdRef.current=selId; },[selId]);

  /* ── multi-select ─────────────────────────────────────────────── */
  const [selIds,   setSelIds]   = useState<Set<string>>(new Set());
  const selIdsRef  = useRef<Set<string>>(new Set());
  const clipboard  = useRef<EditorNote[]>([]);   // copy buffer
  const [clipCount,setClipCount] = useState(0);  // for UI hint

  /* ── playhead (restored from draft) ───────────────────────────── */
  const [playhead,  setPlayhead] = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return typeof s.playhead === "number" ? s.playhead : 0; } catch { return 0; } });
  const playheadRef = useRef(0);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  const [timelineScrollLeft, setTimelineScrollLeft] = useState(() => { try { const s = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>; return typeof s.timelineScrollLeft === "number" ? s.timelineScrollLeft : 0; } catch { return 0; } });
  const [tlVisibleWidth, setTlVisibleWidth] = useState(0);
  const restoredScrollAppliedRef = useRef(false);

  /* ── history (sync from restored notes on mount) ──────────────── */
  const seHst  = useRef<EditorNote[][]>([[]]);
  const seHIdx = useRef(0);
  useEffect(() => {
    const initial = JSON.parse(localStorage.getItem("raidHero:stageEditor:state") ?? "{}") as Record<string, unknown>;
    const n = initial.notes;
    if (Array.isArray(n) && (n as EditorNote[]).length > 0) {
      const notes = n as EditorNote[];
      seHst.current = [notes.map(x => ({ ...x }))];
      seHIdx.current = 0;
    }
  }, []);
  const sePush = useCallback((next:EditorNote[])=>{
    seHst.current=seHst.current.slice(0,seHIdx.current+1);
    seHst.current.push(next.map(n=>({...n})));
    if(seHst.current.length>80) seHst.current.shift();
    seHIdx.current=seHst.current.length-1;
  },[]);
  const seUndo=useCallback(()=>{
    if(seHIdx.current<=0) return;
    seHIdx.current--;
    const notes=seHst.current[seHIdx.current]!.map(n=>({...n}));
    setSNotes(notes); sNotesRef.current=notes;
  },[]);
  const seRedo=useCallback(()=>{
    if(seHIdx.current>=seHst.current.length-1) return;
    seHIdx.current++;
    const notes=seHst.current[seHIdx.current]!.map(n=>({...n}));
    setSNotes(notes); sNotesRef.current=notes;
  },[]);

  /* ── save/library ────────────────────────────────────────────── */
  const [saveSt,  setSaveSt]  = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [library, setLibrary] = useState<EditorStage[]|null>(null);
  const [libLoad, setLibLoad] = useState(false);
  const [genSt, setGenSt] = useState<"idle"|"generating"|"done"|"error">("idle");
  const analysisCacheRef = useRef<{ url: string; analysis: AlguritemAudioAnalysis; duration: number } | null>(null);
  const [suggestion, setSuggestion] = useState<{ status: "idle" | "loading" | "showing" | "error"; notes: SuggestedNote[] }>({ status: "idle", notes: [] });

  /* ── DOM refs ────────────────────────────────────────────────── */
  const seTlRef   = useRef<HTMLDivElement>(null);   // timeline scroller
  const seWvRef   = useRef<HTMLCanvasElement>(null); // waveform canvas
  const seOvRef   = useRef<HTMLCanvasElement>(null); // overlay canvas (playhead + drag preview)
  const sePhRef   = useRef<HTMLDivElement>(null);    // playhead DOM element (for dragging)
  const scrollXRef= useRef(0);

  /* computed */
  const pps    = SE_PPS_BASE * zoom;
  const totalW = Math.max(1200, dur*pps+300);
  const tlH    = SE_HDR_H + sLanes*SE_LANE_H;
  const scrollMax = Math.max(0, totalW - tlVisibleWidth);
  useEffect(()=>{ ppsRef.current=pps; },[pps]);
  useEffect(()=>{ snapRef.current=snap; },[snap]);

  /* apply restored scroll position once when timeline is ready */
  useEffect(() => {
    if (restoredScrollAppliedRef.current) return;
    const tl = seTlRef.current;
    if (!tl) return;
    tl.scrollLeft = timelineScrollLeft;
    scrollXRef.current = timelineScrollLeft;
    restoredScrollAppliedRef.current = true;
  }, [dur, timelineScrollLeft]);

  // Persist full draft (meta + state) so refresh restores exactly
  const saveDraft = useCallback(() => {
    try {
      const meta = { title: sTitle, artist: sArtist, bpm: sBpm, offset: sOff, lanes: sLanes };
      localStorage.setItem("raidHero:stageEditor:meta", JSON.stringify(meta));
      const state: Record<string, unknown> = {
        notes: sNotesRef.current,
        zoom,
        snap,
        playhead,
        timelineScrollLeft,
        audioFileName,
        videoFileName,
        videoOffset,
      };
      localStorage.setItem("raidHero:stageEditor:state", JSON.stringify(state));
      localStorage.setItem("raidHero:stageEditor:open", "1");
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }, [sTitle, sArtist, sBpm, sOff, sLanes, sNotes, zoom, snap, playhead, timelineScrollLeft, audioFileName, videoFileName, videoOffset]);

  useEffect(() => {
    saveDraft();
    const onBeforeUnload = () => {
      try {
        const stateRaw = localStorage.getItem("raidHero:stageEditor:state");
        const state = stateRaw ? (JSON.parse(stateRaw) as Record<string, unknown>) : {};
        state.playhead = playheadRef.current;
        state.timelineScrollLeft = scrollXRef.current;
        localStorage.setItem("raidHero:stageEditor:state", JSON.stringify(state));
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      try {
        const stateRaw = localStorage.getItem("raidHero:stageEditor:state");
        const state = stateRaw ? (JSON.parse(stateRaw) as Record<string, unknown>) : {};
        state.playhead = playheadRef.current;
        state.timelineScrollLeft = scrollXRef.current;
        localStorage.setItem("raidHero:stageEditor:state", JSON.stringify(state));
        localStorage.setItem("raidHero:stageEditor:open", "0");
      } catch {
        // ignore
      }
    };
  }, [saveDraft]);

  /* ══════════════════════════════════════════════════════════════
     OVERLAY CANVAS — paint playhead + drag ghosts, zero React renders
  ═══════════════════════════════════════════════════════════════ */
  type DragState =
    | {kind:"hold-create";lane:number;startT:number;curT:number}
    | {kind:"note-move";id:string;lane:number;curT:number}
    | {kind:"note-resize";id:string;startDur:number;curDur:number}
    | {kind:"playhead"}
    | {kind:"box-select";startX:number;startY:number;curX:number;curY:number}
    | {kind:"multi-move";ids:string[];startX:number;offsets:Record<string,{t:number;lane:number}>}
    | null;

  const activeDrag = useRef<DragState>(null);

  const repaintOverlay = useCallback(()=>{
    const canvas=seOvRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d"); if(!ctx) return;
    const w=canvas.width, h=canvas.height;
    ctx.clearRect(0,0,w,h);

    const ph=playheadRef.current;
    const _pps=ppsRef.current;
    const d=activeDrag.current;

    // ── hold-create ghost ──────────────────────────────────────
    if(d?.kind==="hold-create") {
      const color=SE_COLORS[d.lane]??"#888";
      const x0=d.startT*_pps; const x1=d.curT*_pps;
      const xL=Math.min(x0,x1); const xR=Math.max(x0,x1);
      const y=SE_HDR_H+d.lane*SE_LANE_H+5;
      ctx.globalAlpha=0.65;
      ctx.fillStyle=color; ctx.strokeStyle=color; ctx.lineWidth=1.5;
      const rw=Math.max(xR-xL,SE_NOTE_W);
      roundRect(ctx,xL,y,rw,SE_LANE_H-10,5);
      ctx.fill(); ctx.globalAlpha=1; ctx.stroke();
      ctx.fillStyle="#fff"; ctx.font="bold 10px monospace"; ctx.globalAlpha=0.7;
      ctx.fillText(Math.abs(d.curT-d.startT).toFixed(2)+"s",xL+6,y+(SE_LANE_H-10)/2+4);
      ctx.globalAlpha=1;
    }

    // ── box-select marquee ─────────────────────────────────────
    if(d?.kind==="box-select") {
      const rx=Math.min(d.startX,d.curX), ry=Math.min(d.startY,d.curY);
      const rw=Math.abs(d.curX-d.startX),  rh=Math.abs(d.curY-d.startY);
      ctx.fillStyle="rgba(59,158,255,0.08)";
      ctx.fillRect(rx,ry,rw,rh);
      ctx.strokeStyle="rgba(59,158,255,0.75)";
      ctx.lineWidth=1.5;
      ctx.setLineDash([4,3]);
      ctx.strokeRect(rx,ry,rw,rh);
      ctx.setLineDash([]);
    }

    // ── playhead ───────────────────────────────────────────────
    const phX=ph*_pps;
    ctx.beginPath(); ctx.moveTo(phX,0); ctx.lineTo(phX,h);
    ctx.strokeStyle="#ef4545"; ctx.lineWidth=1.5; ctx.globalAlpha=0.88;
    ctx.stroke(); ctx.globalAlpha=1;
    ctx.beginPath();
    ctx.moveTo(phX-6,0); ctx.lineTo(phX+6,0); ctx.lineTo(phX,9);
    ctx.closePath(); ctx.fillStyle="#ef4545"; ctx.fill();
  },[]);

  // helper: roundRect polyfill
  function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  /* ── repaint on every RAF when playing (אופטימיזציה: setState רק כל ~100ms) ── */
  const playheadUpdateRef=useRef(0);
  const seStartRaf=useCallback(()=>{
    const tick=(now:number)=>{
      const el=seAudioEl.current;
      if(el){
        playheadRef.current=el.currentTime;
        repaintOverlay();
        if(now-playheadUpdateRef.current>=100){
          playheadUpdateRef.current=now;
          setPlayhead(el.currentTime);
        }
        const tl=seTlRef.current;
        if(tl){
          const cx=el.currentTime*ppsRef.current;
          if(cx>tl.scrollLeft+tl.clientWidth-80||cx<tl.scrollLeft) tl.scrollLeft=cx-tl.clientWidth/3;
        }
      }
      seRaf.current=requestAnimationFrame(tick);
    };
    playheadUpdateRef.current=performance.now();
    seRaf.current=requestAnimationFrame(tick);
  },[repaintOverlay]);

  /* ══════════════════════════════════════════════════════════════
     AUDIO
  ═══════════════════════════════════════════════════════════════ */
  const seLoad=useCallback(async(file:File)=>{
    setAudioFile(file);
    setAudioFileName(file.name);
    if(audioUrl) URL.revokeObjectURL(audioUrl);
    const url=URL.createObjectURL(file); setAudioUrl(url);
    if(!sTitle) setSTitle(file.name.replace(/\.[^.]+$/,""));
    try{ const r=await seDecodeWaveform(file); setPeaks(r.peaks); setDur(r.duration); }catch{}
    try{ await seIdbPut("audio",file); }catch{ /* ignore */ }
  },[audioUrl,sTitle]);

  const seLoadVideo=useCallback((file:File)=>{
    setVideoFile(file);
    setVideoFileName(file.name);
    if(videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setShowVideo(true);
    try{ seIdbPut("video",file).then(()=>{}).catch(()=>{}); }catch{ /* ignore */ }
  },[videoUrl]);

  /* Restore audio/video from IndexedDB after refresh */
  const idbRestoredRef = useRef(false);
  useEffect(() => {
    if (idbRestoredRef.current || audioUrl) return;
    idbRestoredRef.current = true;
    (async () => {
      try {
        const audioBlob = await seIdbGet("audio");
        if (audioBlob && audioBlob.size > 0) {
          const url = URL.createObjectURL(audioBlob);
          setAudioUrl(url);
          try {
            const buf = await audioBlob.arrayBuffer();
            const r = await seDecodeWaveformFromBuffer(buf);
            setPeaks(r.peaks);
            setDur(r.duration);
          } catch {
            // ignore decode errors
          }
        }
        const videoBlob = await seIdbGet("video");
        if (videoBlob && videoBlob.size > 0) {
          setVideoUrl(URL.createObjectURL(videoBlob));
          setShowVideo(true);
        }
      } catch {
        // ignore IDB errors
      }
    })();
  }, [audioUrl]);

  useEffect(()=>{
    if(!audioUrl) return;
    const el=new Audio(audioUrl); seAudioEl.current=el;
    el.addEventListener("ended",()=>{setPlaying(false);cancelAnimationFrame(seRaf.current);});
    return()=>{el.pause();el.src="";};
  },[audioUrl]);

  /* sync video to audio playhead */
  useEffect(()=>{
    const vid=seVideoEl.current; if(!vid||!videoUrl) return;
    const syncV=()=>{
      const t=(seAudioEl.current?.currentTime??playheadRef.current)-videoOffset;
      if(Math.abs(vid.currentTime-Math.max(0,t))>0.15) vid.currentTime=Math.max(0,t);
    };
    if(playing){ void vid.play().catch(()=>{}); syncV(); }
    else { vid.pause(); syncV(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,videoUrl,videoOffset]);

  const seTogglePlay=useCallback(async()=>{
    const el=seAudioEl.current; if(!el) return;
    if(playing){el.pause();setPlaying(false);cancelAnimationFrame(seRaf.current);}
    else{await el.play();setPlaying(true);seStartRaf();}
  },[playing,seStartRaf]);

  /* ── waveform paint ────────────────────────────────────────── */
  useEffect(()=>{
    const c=seWvRef.current; if(!c) return;
    const ctx=c.getContext("2d"); if(!ctx) return;
    sePaint(ctx,peaks,c.width,c.height,scrollXRef.current,pps,dur);
  },[peaks,pps,dur]);

  /* repaint overlay when zoom/notes change */
  useEffect(()=>{ repaintOverlay(); },[repaintOverlay,pps,sNotes]);

  /* ══════════════════════════════════════════════════════════════
     POINTER UTILITIES
  ═══════════════════════════════════════════════════════════════ */
  /* raw x → snapped time (uses refs, no closure staleness) */
  const rawXToTime=(rawX:number)=>Math.max(0,seSnap(rawX/ppsRef.current,sBpmRef.current,sOffRef.current,snapRef.current));

  /* pointer event → {time, lane} relative to timeline */
  const ptrToTL=(e:{clientX:number;clientY:number}):{time:number;lane:number}|null=>{
    const tl=seTlRef.current; if(!tl) return null;
    const rect=tl.getBoundingClientRect();
    const time=rawXToTime(e.clientX-rect.left+tl.scrollLeft);
    const lane=Math.floor((e.clientY-rect.top-SE_HDR_H)/SE_LANE_H);
    if(lane<0||lane>=sLanesRef.current) return null;
    return {time,lane};
  };

  const hitNote=(time:number,lane:number)=>
    sNotesRef.current.find(n=>n.lane===lane&&time>=n.time&&time<=n.time+Math.max(n.duration,0.1));

  /* ══════════════════════════════════════════════════════════════
     PLAYHEAD DRAG  (direct DOM, zero React renders during drag)
  ═══════════════════════════════════════════════════════════════ */
  const startPlayheadDrag=useCallback((startE:React.PointerEvent<HTMLDivElement>)=>{
    startE.stopPropagation();
    const tl=seTlRef.current; if(!tl) return;
    activeDrag.current={kind:"playhead"};

    const onMove=(e:PointerEvent)=>{
      const rect=tl.getBoundingClientRect();
      const t=seClamp((e.clientX-rect.left+tl.scrollLeft)/ppsRef.current,0,dur);
      playheadRef.current=t;
      setPlayhead(t);
      if(seAudioEl.current) seAudioEl.current.currentTime=t;
      repaintOverlay();
    };
    const onUp=()=>{
      activeDrag.current=null;
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp);
    };
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp);
  },[dur,repaintOverlay]);

  /* ══════════════════════════════════════════════════════════════
     TIMELINE POINTER EVENTS
  ═══════════════════════════════════════════════════════════════ */
  const sePDown=useCallback((e:RPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0) return;
    const tl=seTlRef.current; if(!tl) return;
    const tlRect=tl.getBoundingClientRect();
    const rawX=e.clientX-tlRect.left+tl.scrollLeft;
    const rawY=e.clientY-tlRect.top;
    const pos=ptrToTL(e);
    const currentTool=toolRef.current;

    /* ── erase ─────────────────────────────────────────────────── */
    if(currentTool==="erase"){
      if(!pos) return;
      const hit=hitNote(pos.time,pos.lane);
      if(hit){
        const next=sNotesRef.current.filter(n=>n.id!==hit.id);
        setSNotes(next); sNotesRef.current=next; sePush(next);
        setSelIds(new Set()); selIdsRef.current=new Set();
        setSelId(null); selIdRef.current=null;
      }
      return;
    }

    /* ── select tool ────────────────────────────────────────────── */
    if(currentTool==="select"){
      const hit=pos?hitNote(pos.time,pos.lane):null;

      if(hit) {
        // ── clicked a note ───────────────────────────────────────
        // Shift-click = toggle in multi-selection
        if(e.shiftKey) {
          const next=new Set(selIdsRef.current);
          if(next.has(hit.id)) next.delete(hit.id); else next.add(hit.id);
          setSelIds(next); selIdsRef.current=next;
          setSelId(null); selIdRef.current=null;
          return;
        }

        // resize zone — only when NOT in multi-selection
        const noteEndX=hit.time*ppsRef.current + Math.max(hit.duration*ppsRef.current,SE_NOTE_W);
        const nearEdge=hit.duration>0 && (noteEndX-rawX)<14 && selIdsRef.current.size===0;
        if(nearEdge){
          setSelId(hit.id); selIdRef.current=hit.id;
          activeDrag.current={kind:"note-resize",id:hit.id,startDur:hit.duration,curDur:hit.duration};
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }

        // Multi-move: if note already in multi-sel, move all; else clear & move just this one
        const inMulti=selIdsRef.current.has(hit.id)&&selIdsRef.current.size>1;
        const movingIds=inMulti ? [...selIdsRef.current] : [hit.id];
        if(!inMulti){
          setSelIds(new Set()); selIdsRef.current=new Set();
          setSelId(hit.id); selIdRef.current=hit.id;
        }
        const offsets:Record<string,{t:number;lane:number}>={};
        for(const id of movingIds){
          const n=sNotesRef.current.find(x=>x.id===id);
          if(n) offsets[id]={t:n.time,lane:n.lane};
        }
        activeDrag.current={kind:"multi-move",ids:movingIds,startX:rawX,offsets};
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      // ── clicked empty space → start box-select ────────────────
      // clear selection unless shift held
      if(!e.shiftKey){
        setSelIds(new Set()); selIdsRef.current=new Set();
        setSelId(null); selIdRef.current=null;
      }
      activeDrag.current={kind:"box-select",startX:rawX,startY:rawY,curX:rawX,curY:rawY};
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    /* ── tap ────────────────────────────────────────────────────── */
    if(currentTool==="tap"){
      if(!pos) return;
      if(!hitNote(pos.time,pos.lane)){
        const nn:EditorNote={id:seNewId(),lane:pos.lane,time:pos.time,duration:0};
        const next=[...sNotesRef.current,nn];
        setSNotes(next); sNotesRef.current=next; sePush(next);
        setSelIds(new Set()); selIdsRef.current=new Set();
        setSelId(nn.id); selIdRef.current=nn.id;
      }
      return;
    }

    /* ── hold ───────────────────────────────────────────────────── */
    if(currentTool==="hold"&&pos){
      activeDrag.current={kind:"hold-create",lane:pos.lane,startT:pos.time,curT:pos.time};
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sePush,repaintOverlay]);

  const sePMove=useCallback((e:RPointerEvent<HTMLDivElement>)=>{
    const d=activeDrag.current; if(!d) return;
    const tl=seTlRef.current; if(!tl) return;
    const rect=tl.getBoundingClientRect();
    const rawX=e.clientX-rect.left+tl.scrollLeft;
    const rawY=e.clientY-rect.top;

    if(d.kind==="hold-create"){
      d.curT=rawXToTime(rawX); repaintOverlay(); return;
    }

    if(d.kind==="box-select"){
      d.curX=rawX; d.curY=rawY;
      // compute which notes fall inside the marquee and highlight them live
      const x0=Math.min(d.startX,d.curX), x1=Math.max(d.startX,d.curX);
      const y0=Math.min(d.startY,d.curY), y1=Math.max(d.startY,d.curY);
      const hit=new Set<string>();
      for(const n of sNotesRef.current){
        const nx=n.time*ppsRef.current;
        const nw=n.duration>0?Math.max(SE_NOTE_W,n.duration*ppsRef.current):SE_NOTE_W;
        const ny=SE_HDR_H+n.lane*SE_LANE_H;
        // overlap check
        if(nx<x1&&nx+nw>x0&&ny<y1&&ny+SE_LANE_H>y0) hit.add(n.id);
      }
      setSelIds(hit); selIdsRef.current=hit;
      repaintOverlay(); return;
    }

    if(d.kind==="note-move"){
      const newT=rawXToTime(rawX);
      d.curT=newT;
      setSNotes(prev=>{ const arr=prev.map(n=>n.id===d.id?{...n,time:newT}:n); sNotesRef.current=arr; return arr; });
      return;
    }

    if(d.kind==="multi-move"){
      const dx=rawX-d.startX;
      const dt=dx/ppsRef.current;
      setSNotes(prev=>{
        const arr=prev.map(n=>{
          const off=d.offsets[n.id]; if(!off) return n;
          return {...n, time:Math.max(0, seSnap(off.t+dt, sBpmRef.current, sOffRef.current, snapRef.current))};
        });
        sNotesRef.current=arr; return arr;
      }); return;
    }

    if(d.kind==="note-resize"){
      const note=sNotesRef.current.find(n=>n.id===d.id); if(!note) return;
      const newDur=Math.max(SE_MIN_HOLD, rawXToTime(rawX)-note.time);
      d.curDur=newDur;
      setSNotes(prev=>{ const arr=prev.map(n=>n.id===d.id?{...n,duration:newDur}:n); sNotesRef.current=arr; return arr; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[repaintOverlay]);

  const sePUp=useCallback((_e:RPointerEvent<HTMLDivElement>)=>{
    const d=activeDrag.current; activeDrag.current=null;
    if(!d) return;

    if(d.kind==="hold-create"){
      const endT=Math.max(d.curT,d.startT+SE_MIN_HOLD);
      const nn:EditorNote={id:seNewId(),lane:d.lane,time:Math.min(d.startT,d.curT),duration:Math.abs(endT-d.startT)};
      const next=[...sNotesRef.current,nn];
      setSNotes(next); sNotesRef.current=next; sePush(next);
      setSelIds(new Set()); selIdsRef.current=new Set();
      setSelId(nn.id); selIdRef.current=nn.id;
      repaintOverlay(); return;
    }

    if(d.kind==="box-select"){
      // selection already updated live in PMove — just commit
      repaintOverlay(); return;
    }

    if(d.kind==="multi-move"||d.kind==="note-move"||d.kind==="note-resize"){
      sePush([...sNotesRef.current]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sePush,repaintOverlay]);

  /* ── delete selected (single or multi) ───────────────────────── */
  const seDelSel=useCallback(()=>{
    const ids=selIdsRef.current.size>0 ? selIdsRef.current : selIdRef.current ? new Set([selIdRef.current]) : new Set<string>();
    if(ids.size===0) return;
    const next=sNotesRef.current.filter(n=>!ids.has(n.id));
    setSNotes(next); sNotesRef.current=next; sePush(next);
    setSelIds(new Set()); selIdsRef.current=new Set();
    setSelId(null); selIdRef.current=null;
  },[sePush]);

  /* ── copy / cut / paste ───────────────────────────────────────── */
  const seCopy=useCallback((cut=false)=>{
    const ids=selIdsRef.current.size>0 ? selIdsRef.current : selIdRef.current ? new Set([selIdRef.current]) : new Set<string>();
    if(ids.size===0) return;
    clipboard.current=sNotesRef.current.filter(n=>ids.has(n.id)).map(n=>({...n}));
    setClipCount(clipboard.current.length);
    if(cut){
      const next=sNotesRef.current.filter(n=>!ids.has(n.id));
      setSNotes(next); sNotesRef.current=next; sePush(next);
      setSelIds(new Set()); selIdsRef.current=new Set();
      setSelId(null); selIdRef.current=null;
    }
  },[sePush]);

  const sePaste=useCallback(()=>{
    if(!clipboard.current.length) return;
    // paste at playhead: shift so earliest note aligns to playhead
    const earliest=Math.min(...clipboard.current.map(n=>n.time));
    const shift=playheadRef.current - earliest;
    const pasted=clipboard.current.map(n=>({...n, id:seNewId(), time:Math.max(0,n.time+shift)}));
    const next=[...sNotesRef.current,...pasted];
    setSNotes(next); sNotesRef.current=next; sePush(next);
    // select pasted notes
    const pastedIds=new Set(pasted.map(n=>n.id));
    setSelIds(pastedIds); selIdsRef.current=pastedIds;
    setSelId(null); selIdRef.current=null;
  },[sePush]);

  /* ── select all ───────────────────────────────────────────────── */
  const seSelectAll=useCallback(()=>{
    const all=new Set(sNotesRef.current.map(n=>n.id));
    setSelIds(all); selIdsRef.current=all;
    setSelId(null); selIdRef.current=null;
  },[]);

  /* ── waveform seek — לחיצה על גל הקול (גם אחרי גלילה ימינה/שמאלה) ───── */
  const seSeekClick=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const tl=seTlRef.current; if(!tl||!dur) return;
    const rect=tl.getBoundingClientRect();
    const xInView=e.clientX-rect.left;
    const globalX=xInView+tl.scrollLeft;
    const t=seClamp(globalX/ppsRef.current,0,dur);
    playheadRef.current=t; setPlayhead(t);
    if(seAudioEl.current) seAudioEl.current.currentTime=t;
    scrollXRef.current=tl.scrollLeft;
    repaintOverlay();
  },[dur,repaintOverlay]);

  /* ── scroll (אופטימיזציה: עדכון state פעם per frame) ───────────────────── */
  const scrollRafRef=useRef<number|null>(null);
  const onTlScroll=useCallback((e:React.UIEvent<HTMLDivElement>)=>{
    const el=e.currentTarget;
    scrollXRef.current=el.scrollLeft;
    const c=seWvRef.current;
    if(c){ const ctx=c.getContext("2d"); if(ctx) sePaint(ctx,peaks,c.width,c.height,el.scrollLeft,ppsRef.current,dur); }
    repaintOverlay();
    if(scrollRafRef.current==null){
      scrollRafRef.current=requestAnimationFrame(()=>{
        scrollRafRef.current=null;
        const tl=seTlRef.current;
        if(tl){ setTimelineScrollLeft(tl.scrollLeft); setTlVisibleWidth(tl.clientWidth); }
      });
    }
  },[peaks,dur,repaintOverlay]);

  useEffect(()=>()=>{
    if(scrollRafRef.current!=null) cancelAnimationFrame(scrollRafRef.current);
  },[]);

  /* sync timeline size for slider max */
  useEffect(()=>{
    const el=seTlRef.current; if(!el) return;
    const sync=()=>{ setTlVisibleWidth(el.clientWidth); setTimelineScrollLeft(el.scrollLeft); scrollXRef.current=el.scrollLeft; };
    sync();
    const ro=new ResizeObserver(sync);
    ro.observe(el);
    return ()=>ro.disconnect();
  },[totalW,dur]);

  const onTimelineSliderChange=useCallback((v:number)=>{
    setTimelineScrollLeft(v);
    scrollXRef.current=v;
    const tl=seTlRef.current;
    if(tl) tl.scrollLeft=v;
    const c=seWvRef.current;
    if(c){ const ctx=c.getContext("2d"); if(ctx) sePaint(ctx,peaks,c.width,c.height,v,ppsRef.current,dur); }
    repaintOverlay();
  },[peaks,dur,repaintOverlay]);

  /* ── keyboard ────────────────────────────────────────────────── */
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      const tag=(e.target as HTMLElement).tagName;
      if(tag==="INPUT"||tag==="TEXTAREA") return;
      if((e.ctrlKey||e.metaKey)&&e.key==="z"){e.preventDefault();seUndo();}
      if((e.ctrlKey||e.metaKey)&&e.key==="y"){e.preventDefault();seRedo();}
      if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();void seSaveNow();}
      if(e.key===" "){e.preventDefault();void seTogglePlay();}
      if(e.key==="Escape"){setTool("select");setSelId(null);selIdRef.current=null;}
      if(e.key==="1") setTool("select"); if(e.key==="2") setTool("tap");
      if(e.key==="3") setTool("hold");   if(e.key==="4") setTool("erase");
      if(e.key==="Delete"||e.key==="Backspace") seDelSel();
      if((e.ctrlKey||e.metaKey)&&e.key==="a"){e.preventDefault();seSelectAll();}
      if((e.ctrlKey||e.metaKey)&&e.key==="c"){e.preventDefault();seCopy(false);}
      if((e.ctrlKey||e.metaKey)&&e.key==="x"){e.preventDefault();seCopy(true);}
      if((e.ctrlKey||e.metaKey)&&e.key==="v"){e.preventDefault();sePaste();}
      if((e.ctrlKey||e.metaKey)&&e.key==="d"){e.preventDefault();seCopy(false);sePaste();}
    };
    window.addEventListener("keydown",h); return ()=>window.removeEventListener("keydown",h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[seUndo,seRedo,seTogglePlay,seDelSel,seCopy,sePaste,seSelectAll]);

  /* ── beat grid ───────────────────────────────────────────────── */
  const beatLines=useMemo(()=>{
    if(!dur||!sBpm) return [];
    const lines:{x:number;measure:boolean;label?:string}[]=[];
    const bs=60/sBpm; let beat=0;
    for(let t=sOff;t<=dur+bs;t+=bs,beat++)
      lines.push({x:t*pps,measure:beat%4===0,label:beat%4===0?String(Math.floor(beat/4)+1):undefined});
    return lines;
  },[dur,sBpm,sOff,pps]);

  /* ── ruler ───────────────────────────────────────────────────── */
  const rulerMarks=useMemo(()=>{
    if(!dur) return [];
    const iv=pps>=240?1:pps>=80?5:10;
    const m:{x:number;label:string}[]=[];
    for(let t=0;t<=dur;t+=iv) m.push({x:t*pps,label:seFmt(t)});
    return m;
  },[dur,pps]);

  /* ── note rects (כולם) ─────────────────────────────────────────── */
  const noteRects=useMemo(()=>sNotes.map(n=>({
    ...n, x:n.time*pps, y:SE_HDR_H+n.lane*SE_LANE_H,
    w:n.duration>0?Math.max(SE_NOTE_W,n.duration*pps):SE_NOTE_W, h:SE_LANE_H-10,
  })),[sNotes,pps]);

  /* אופטימיזציה: רק נוטות בחלון הנראה (+ margin); אם רוחב 0 מציגים הכל */
  const VIEW_MARGIN=200;
  const noteRectsInView=useMemo(()=>{
    if(tlVisibleWidth<=0) return noteRects;
    const left=timelineScrollLeft-VIEW_MARGIN;
    const right=timelineScrollLeft+tlVisibleWidth+VIEW_MARGIN;
    return noteRects.filter(n=>n.x+n.w>=left&&n.x<=right);
  },[noteRects,timelineScrollLeft,tlVisibleWidth]);

  const beatLinesInView=useMemo(()=>{
    if(tlVisibleWidth<=0) return beatLines;
    const left=timelineScrollLeft-VIEW_MARGIN;
    const right=timelineScrollLeft+tlVisibleWidth+VIEW_MARGIN;
    return beatLines.filter(l=>l.x>=left&&l.x<=right);
  },[beatLines,timelineScrollLeft,tlVisibleWidth]);

  const rulerMarksInView=useMemo(()=>{
    if(tlVisibleWidth<=0) return rulerMarks;
    const left=timelineScrollLeft-VIEW_MARGIN;
    const right=timelineScrollLeft+tlVisibleWidth+VIEW_MARGIN;
    return rulerMarks.filter(m=>m.x>=left&&m.x<=right);
  },[rulerMarks,timelineScrollLeft,tlVisibleWidth]);

  /* ── save ────────────────────────────────────────────────────── */
  const seSaveNow=useCallback(async()=>{
    setSaveSt("saving");
    try{
      const stage:EditorStage={firestoreId:sFsId,title:sTitle,artist:sArtist,bpm:sBpm,beatOffset:sOff,laneCount:sLanes,audioName:audioFile?.name??audioFileName??"",notes:sNotesRef.current};
      const id=await seFsSave(stage); setSFsId(id);
      setSaveSt("saved"); setTimeout(()=>setSaveSt("idle"),2500);
    }catch(err){console.error(err);setSaveSt("error");setTimeout(()=>setSaveSt("idle"),3000);}
  },[sFsId,sTitle,sArtist,sBpm,sOff,sLanes,audioFile,audioFileName]);

  /* ── export/import ────────────────────────────────────────────── */
  const seExport=useCallback(()=>{
    const s:EditorStage={title:sTitle,artist:sArtist,bpm:sBpm,beatOffset:sOff,laneCount:sLanes,audioName:audioFile?.name??audioFileName??"",notes:sNotesRef.current};
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([JSON.stringify(s,null,2)],{type:"application/json"}));
    a.download=`${sTitle||"stage"}.json`; a.click();
  },[sTitle,sArtist,sBpm,sOff,sLanes,audioFile,audioFileName]);

  const seImport=useCallback((file:File)=>{
    const r=new FileReader(); r.onload=ev=>{
      try{
        const d=JSON.parse(ev.target?.result as string) as EditorStage;
        setSTitle(d.title??""); setSArtist(d.artist??""); setSBpm(d.bpm??120);
        setSOff(d.beatOffset??0); setSLanes(d.laneCount??4);
        const notes=d.notes??[]; setSNotes(notes); sNotesRef.current=notes; sePush(notes);
      }catch{alert("Invalid JSON");}
    }; r.readAsText(file);
  },[sePush]);

  /* ── library ──────────────────────────────────────────────────── */
  const seOpenLib=useCallback(async()=>{
    setLibLoad(true); setLibrary([]);
    try{setLibrary(await seFsLoad());}catch{setLibrary([]);}
    setLibLoad(false);
  },[]);
  const seGenerateFromAudio=useCallback(async()=>{
    if(!audioUrl) return;
    setGenSt("generating");
    try{
      const stage=await analyzeAudioUrlToStage(audioUrl,{
        title:sTitle||undefined,
        artist:sArtist||undefined,
        laneCount:sLanes,
        audioName:audioFile?.name??"",
        difficultyId:"normal",
      });
      setSBpm(stage.bpm);
      setSLanes(stage.laneCount);
      const notes=stage.notes??[];
      setSNotes(notes);
      sNotesRef.current=notes;
      sePush(notes);
      setGenSt("done");
      setTimeout(()=>setGenSt("idle"),2000);
    }catch{
      setGenSt("error");
      setTimeout(()=>setGenSt("idle"),3000);
    }
  },[audioUrl,sTitle,sArtist,sLanes,audioFile?.name,sePush]);

  const seSuggestNext=useCallback(async()=>{
    if(!audioUrl) return;
    setSuggestion({ status: "loading", notes: [] });
    try {
      if(!analysisCacheRef.current||analysisCacheRef.current.url!==audioUrl){
        const data=await getAnalysisFromAudioUrl(audioUrl);
        analysisCacheRef.current={ url: audioUrl, analysis: data.analysis, duration: data.duration };
      }
      const { analysis }=analysisCacheRef.current;
      const notes=suggestAllNotesFrom(analysis,playheadRef.current,sLanes);
      setSuggestion({ status: "showing", notes });
    } catch {
      setSuggestion({ status: "error", notes: [] });
      setTimeout(()=>setSuggestion({ status: "idle", notes: [] }), 2000);
    }
  },[audioUrl,sLanes]);

  const seAcceptSuggestionNote=useCallback((note: SuggestedNote)=>{
    if(hitNote(note.time,note.lane)) return;
    const nn:EditorNote={ id: seNewId(), lane: note.lane, time: note.time, duration: note.duration };
    const next=[...sNotesRef.current,nn];
    setSNotes(next); sNotesRef.current=next; sePush(next);
    setSelIds(new Set()); setSelId(nn.id); selIdRef.current=nn.id;
    repaintOverlay();
  },[sePush,repaintOverlay]);

  const seCloseSuggestions=useCallback(()=>{
    setSuggestion({ status: "idle", notes: [] });
  },[]);

  const seLoadFromLib=useCallback((s:EditorStage)=>{
    setSTitle(s.title); setSArtist(s.artist); setSBpm(s.bpm); setSOff(s.beatOffset);
    setSLanes(s.laneCount); const notes=s.notes??[]; setSNotes(notes); sNotesRef.current=notes;
    setSFsId(s.firestoreId); sePush(notes); setLibrary(null);
  },[sePush]);

  /* ── tap beat ─────────────────────────────────────────────────── */
  const seTapBeat=useCallback(()=>{
    setSOff(parseFloat((seAudioEl.current?.currentTime??playheadRef.current).toFixed(3)));
  },[]);

  const saveLbl=saveSt==="saving"?"⏳ Saving…":saveSt==="saved"?"✓ Saved!":saveSt==="error"?"✗ Error":"☁ Upload";

  /* ══════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="se-root" onContextMenu={e=>e.preventDefault()}>

      {/* SITE HEADER CONTEXT + PLAYTEST */}
      <header className="raid-hero-header" style={{ borderRadius: 18, margin: "10px auto 6px", maxWidth: 1180 }}>
        <div className="raid-header-left">
          <span className="raid-hero-logo">🎸</span>
          <div>
            <h1>RAID HERO</h1>
            <p>
              Stage Builder <span className="raid-artist">— edit custom charts</span>
            </p>
          </div>
        </div>
        <div className="raid-hero-controls">
          <label className="raid-hero-btn raid-hero-btn--file" title="Start playtest from this time (seconds)">
            At (sec)
            <input
              type="number"
              min={0}
              step={0.1}
              value={playtestOffsetSec}
              onChange={(e)=> setPlaytestOffsetSec(Number(e.target.value) || 0)}
              style={{ width: 72, marginInlineStart: 6, background: "transparent", border: "none", color: "inherit" }}
            />
          </label>
          <button
            type="button"
            className="raid-hero-btn raid-hero-btn--primary"
            onClick={() => setShowPlaytest(true)}
          >
            Playtest from offset
          </button>
          <button
            type="button"
            className="raid-hero-btn raid-hero-btn--menu"
            onClick={onClose}
          >
            Back to Game
          </button>
        </div>
      </header>

      {/* TOP BAR */}
      <header className="se-topbar">
        <div className="se-tbl">
          <button className="se-icon-btn" onClick={onClose} title="Back to game">✕</button>
          <div className="se-brand"><span className="se-hex">⬡</span><span>STAGE EDITOR</span></div>
        </div>
        <div className="se-tbc">
          <div className="se-tool-row">
            {(["select","tap","hold","erase"] as EditorTool[]).map((t,i)=>(
              <button key={t} className={`se-tool${tool===t?" active":""}`} onClick={()=>setTool(t)} title={`${t} [${i+1}]`}>
                <span className="se-ti">{t==="select"?"↖":t==="tap"?"◉":t==="hold"?"━":"⌫"}</span>
                <small>{t}</small>
              </button>
            ))}
          </div>
          <span className="se-vsep"/>
          <div className="se-snap-row">
            <span className="se-chip">SNAP</span>
            {SE_SNAPS.map(s=>(
              <button key={s.d} className={`se-snap${snap===s.d?" active":""}`} onClick={()=>setSnap(s.d)}>{s.l}</button>
            ))}
          </div>
          <span className="se-vsep"/>
          <div className="se-zoom-row">
            <span className="se-chip">ZOOM</span>
            <input type="range" min={0.25} max={6} step={0.25} value={zoom} onChange={e=>setZoom(Number(e.target.value))} className="se-range"/>
            <span className="se-zlbl">{zoom.toFixed(2)}×</span>
          </div>
        </div>
        <div className="se-tbr">
          <button className="se-icon-btn" onClick={seUndo} title="Undo [Ctrl+Z]">↩</button>
          <button className="se-icon-btn" onClick={seRedo} title="Redo [Ctrl+Y]">↪</button>
          <span className="se-vsep"/>
          <button className="se-abtn" onClick={()=>void seOpenLib()}>☁ Library</button>
          <button className="se-abtn" onClick={seExport}>⬇ Export</button>
          <label className="se-abtn">⬆ Import<input type="file" accept=".json" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&seImport(e.target.files[0])}/></label>
          <button className={`se-abtn se-save${saveSt==="saved"?" ok":saveSt==="error"?" err":""}`} onClick={()=>void seSaveNow()} disabled={saveSt==="saving"}>{saveLbl}</button>
        </div>
      </header>

      <div className="se-body">

        {/* SIDEBAR */}
        <aside className="se-sidebar">
          <div className="se-panel">
            <div className="se-phd">🎵 Audio</div>
            {!audioUrl?(
              <label className="se-dropzone">
                <input type="file" accept="audio/*" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&void seLoad(e.target.files[0])}/>
                <div className="se-dzi">♫</div>
                <div>Upload MP3<br/><small>click to browse</small></div>
              </label>
            ):(
              <div className="se-ainfo">
                <div className="se-afn" title={audioFile?.name ?? audioFileName}>{audioFile?.name || audioFileName || ""}</div>
                <div className="se-adur">{seFmt(dur)}</div>
                <label className="se-ibtn">Change<input type="file" accept="audio/*" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&void seLoad(e.target.files[0])}/></label>
              </div>
            )}
          </div>

          <div className="se-panel">
            <div className="se-phd">🎬 Video (optional)</div>
            <label className="se-dropzone se-dz-video">
              <input type="file" accept="video/mp4,video/*" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&seLoadVideo(e.target.files[0])}/>
              <div className="se-dzi" style={{color:"#3b9eff55",fontSize:22}}>▶</div>
              <div>{(videoFile?.name || videoFileName) || "Upload MP4"}<br/><small>{(videoFile || videoUrl) ? "click to replace" : "syncs below timeline"}</small></div>
            </label>
          </div>

          <div className="se-panel">
            <div className="se-phd">📄 Metadata</div>
            <div className="se-fields">
              <label className="se-lbl">Title</label>
              <input className="se-inp" value={sTitle} onChange={e=>setSTitle(e.target.value)} placeholder="Song title"/>
              <label className="se-lbl">Artist</label>
              <input className="se-inp" value={sArtist} onChange={e=>setSArtist(e.target.value)} placeholder="Artist"/>
              <label className="se-lbl">BPM</label>
              <input className="se-inp se-num" type="number" min={40} max={320} value={sBpm} onChange={e=>setSBpm(Number(e.target.value))}/>
              <label className="se-lbl">Beat 1 Offset (s)</label>
              <div className="se-frow">
                <input className="se-inp se-num" type="number" step="0.001" value={sOff} onChange={e=>setSOff(Number(e.target.value))}/>
                <button className="se-ibtn se-tapbtn" onClick={seTapBeat} title="Tap while playing to mark beat 1">🥁</button>
              </div>
              <label className="se-lbl">Lanes</label>
              <div className="se-lprow">
                {[3,4].map(n=>(
                  <button key={n} className={`se-lpbtn${sLanes===n?" active":""}`} onClick={()=>setSLanes(n)}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="se-panel">
            <div className="se-phd">📊 Chart</div>
            <div className="se-stats">
              <div className="se-stat"><span>Total</span><strong>{sNotes.length}</strong></div>
              <div className="se-stat"><span>Taps</span><strong>{sNotes.filter(n=>n.duration===0).length}</strong></div>
              <div className="se-stat"><span>Holds</span><strong>{sNotes.filter(n=>n.duration>0).length}</strong></div>
              <div className="se-stat"><span>Length</span><strong>{seFmt(dur)}</strong></div>
            </div>
            {audioUrl&&(
              <button type="button" className="se-abtn se-genbtn" disabled={genSt==="generating"} onClick={()=>void seGenerateFromAudio()} title="ניתוח MP3 ויצירת שלב אוטומטי (אותו אלגוריתם כמו במשחק)">
                {genSt==="generating"?"⏳ יוצר שלב…":genSt==="done"?"✓ נוצר":genSt==="error"?"❌ שגיאה":"🎵 יצר שלב מאודיו"}
              </button>
            )}
          </div>

          <div className="se-panel">
            <div className="se-phd">⌨ Keys</div>
            <div className="se-kgrid">
              <code>Space</code><span>Play/Pause</span>
              <code>1</code><span>Select</span>
              <code>2</code><span>Tap</span>
              <code>3</code><span>Hold</span>
              <code>4</code><span>Erase</span>
              <code>Del</code><span>Delete sel.</span>
              <code>Ctrl A</code><span>Select all</span>
              <code>Ctrl C/X</code><span>Copy / Cut</span>
              <code>Ctrl V</code><span>Paste at ▶</span>
              <code>Ctrl D</code><span>Duplicate</span>
              <code>Ctrl Z/Y</code><span>Undo/Redo</span>
              <code>Ctrl S</code><span>Save</span>
              <code>Shift+click</code><span>Add to sel.</span>
              <code>🥁 Tap</code><span>Set beat 1</span>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="se-main">
          <div className="se-transport">
            <button className="se-playbtn" onClick={()=>void seTogglePlay()}>{playing?"⏸":"▶"}</button>
            <button className="se-icon-btn" title="Return to start" onClick={()=>{
              if(seAudioEl.current){seAudioEl.current.currentTime=0;}
              playheadRef.current=0; setPlayhead(0); repaintOverlay();
            }}>⏮</button>
            <span className="se-timedisp">{seFmt(playhead)}</span>
            <div style={{flex:1}}/>
            {(selIds.size>0||selId)&&(
              <div className="se-sel-actions">
                <span className="se-sel-count">{selIds.size>0?selIds.size:1} selected</span>
                <button className="se-abtn se-sel-btn" onClick={()=>seCopy(false)} title="Copy [Ctrl+C]">⎘ Copy</button>
                <button className="se-abtn se-sel-btn" onClick={()=>seCopy(true)} title="Cut [Ctrl+X]">✂ Cut</button>
                <button className="se-abtn se-delbtn" onClick={seDelSel} title="Delete [Del]">✕ Delete</button>
              </div>
            )}
            {clipCount>0&&<button className="se-abtn se-sel-btn" onClick={sePaste} title="Paste [Ctrl+V]">⎗ Paste {clipCount}</button>}
            {audioUrl&&(
              <button type="button" className="se-abtn se-suggest-btn" disabled={suggestion.status==="loading"} onClick={()=>void seSuggestNext()} title="הצעה: התו הבא מהסמן לפי האלגוריתם">
                {suggestion.status==="loading"?"⏳":"💡 הצעה"}
              </button>
            )}
            {suggestion.status==="showing"&&suggestion.notes.length>0&&(
              <div className="se-suggestion-card">
                <span className="se-suggestion-text">
                  {suggestion.notes.filter(n=>!hitNote(n.time,n.lane)).length} הצעות — לחץ על תו בגריד לאשר
                </span>
                <button type="button" className="se-abtn se-reject-btn" onClick={seCloseSuggestions}>סגור</button>
              </div>
            )}
            {suggestion.status==="error"&&<span className="se-suggestion-err">שגיאה בהצעה</span>}
            <span className="se-ntally">{sNotes.length} notes</span>
          </div>

          {!audioUrl&&(
            <div className="se-empty">
              <div className="se-empty-ico">♫</div>
              <p>Upload an MP3 from the sidebar to start building your stage</p>
              <label className="se-abtn se-abtn-lg">Choose Audio File
                <input type="file" accept="audio/*" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&void seLoad(e.target.files[0])}/>
              </label>
            </div>
          )}

          {audioUrl&&(
            <div className="se-editor-area">
            <div className="se-timeline" ref={seTlRef}
              onScroll={onTlScroll}
              onPointerDown={sePDown} onPointerMove={sePMove} onPointerUp={sePUp}
              style={{cursor:tool==="tap"?"crosshair":tool==="hold"?"cell":tool==="erase"?"not-allowed":"default"}}>

              <div style={{width:totalW,height:tlH,position:"relative",flexShrink:0}}>

                {/* Waveform */}
                <div style={{position:"absolute",top:0,left:0,width:totalW,height:SE_HDR_H,pointerEvents:"none"}}>
                  <canvas ref={seWvRef} width={totalW} height={SE_WV_H}
                    style={{display:"block",width:totalW,height:SE_WV_H,pointerEvents:"auto",cursor:"pointer"}}
                    onClick={seSeekClick}/>
                  <div className="se-ruler" style={{width:totalW,height:SE_RULER_H,position:"relative"}}>
                    {rulerMarksInView.map((m)=>(
                      <div key={`${m.x}-${m.label}`} className="se-rtick" style={{left:m.x}}>{m.label}</div>
                    ))}
                  </div>
                </div>

                {/* Lanes */}
                {Array.from({length:sLanes},(_,li)=>(
                  <div key={li} style={{
                    position:"absolute",top:SE_HDR_H+li*SE_LANE_H,left:0,width:totalW,height:SE_LANE_H,
                    borderBottom:`1px solid ${SE_COLORS[li]}1e`,
                    background:`${SE_COLORS[li]}07`,
                    pointerEvents:"none",
                  }}>
                    <div className="se-lanekey" style={{color:SE_COLORS[li],borderColor:`${SE_COLORS[li]}50`}}>
                      {SE_KEYS[li]}
                    </div>
                  </div>
                ))}

                {/* Beat grid (מסונן לחלון נראה) */}
                {beatLinesInView.map((l)=>(
                  <div key={`beat-${l.x}`} style={{
                    position:"absolute",left:l.x,top:SE_HDR_H-SE_RULER_H,
                    width:l.measure?1.5:.5,height:SE_RULER_H+sLanes*SE_LANE_H,
                    background:l.measure?"rgba(255,255,255,.18)":"rgba(255,255,255,.055)",
                    pointerEvents:"none",
                  }}>
                    {l.label&&<span className="se-mnum">{l.label}</span>}
                  </div>
                ))}

                {/* Notes — רק בחלון הנראה (אופטימיזציה) */}
                {noteRectsInView.map(n=>{
                  const color=SE_COLORS[n.lane]??"#888";
                  const isHold=n.duration>0;
                  const isSel=selId===n.id||selIds.has(n.id);
                  return(
                    <div key={n.id} style={{
                      position:"absolute",left:n.x,top:n.y+5,width:n.w,height:n.h,
                      background:isHold?`linear-gradient(90deg,${color}dd,${color}55)`:`radial-gradient(circle at 36% 36%,${color}ff,${color}aa)`,
                      border:`${isSel?2:1.5}px solid ${isSel?"#fff":color}`,
                      borderRadius:isHold?"5px":"50% 50% 50% 50% / 42% 42% 58% 58%",
                      boxShadow:`0 0 ${isSel?18:7}px ${color}${isSel?"bb":"44"}`,
                      cursor:tool==="select"?isHold?"ew-resize":"grab":undefined,
                      zIndex:isSel?10:5,
                    } as CSSProperties}
                      onPointerDown={e=>{
                        if(tool!=="select"&&tool!=="erase") return;
                        e.stopPropagation();
                        if(tool==="erase"){
                          const next=sNotesRef.current.filter(x=>x.id!==n.id);
                          setSNotes(next);sNotesRef.current=next;sePush(next);
                          setSelIds(new Set());selIdsRef.current=new Set();
                          setSelId(null);selIdRef.current=null;
                          return;
                        }
                        // shift-click = toggle in multi-sel
                        if(e.shiftKey){
                          const next=new Set(selIdsRef.current);
                          if(next.has(n.id)) next.delete(n.id); else next.add(n.id);
                          setSelIds(next); selIdsRef.current=next;
                          setSelId(null); selIdRef.current=null;
                          return;
                        }
                        // resize zone — only for single-selected hold
                        const noteEl=e.currentTarget;
                        const noteRect=noteEl.getBoundingClientRect();
                        const nearEdge=isHold&&(noteRect.right-e.clientX)<14&&selIdsRef.current.size===0;
                        if(nearEdge){
                          setSelId(n.id); selIdRef.current=n.id;
                          activeDrag.current={kind:"note-resize",id:n.id,startDur:n.duration,curDur:n.duration};
                          (e.currentTarget.closest(".se-timeline") as HTMLElement)?.setPointerCapture(e.pointerId);
                          return;
                        }
                        // multi-move: if this note is already in multi-sel, move all of them
                        // if NOT, clear multi-sel and move just this one
                        const tl=seTlRef.current!;
                        const tlRect=tl.getBoundingClientRect();
                        const rawX=e.clientX-tlRect.left+tl.scrollLeft;
                        const inMulti=selIdsRef.current.has(n.id)&&selIdsRef.current.size>1;
                        const movingIds=inMulti ? [...selIdsRef.current] : [n.id];
                        if(!inMulti){
                          setSelIds(new Set()); selIdsRef.current=new Set();
                          setSelId(n.id); selIdRef.current=n.id;
                        }
                        const offsets:Record<string,{t:number;lane:number}>={};
                        for(const id of movingIds){
                          const mn=sNotesRef.current.find(x=>x.id===id);
                          if(mn) offsets[id]={t:mn.time,lane:mn.lane};
                        }
                        activeDrag.current={kind:"multi-move",ids:movingIds,startX:rawX,offsets};
                        (e.currentTarget.closest(".se-timeline") as HTMLElement)?.setPointerCapture(e.pointerId);
                      }}
                    >
                      {/* resize handle — visible on selected hold notes */}
                      {isHold&&isSel&&(
                        <div className="se-resize-handle" style={{background:color}}/>
                      )}
                    </div>
                  );
                })}

                {/* Suggestion ghosts — רק בחלון הנראה; לחיצה = אשר */}
                {suggestion.status==="showing"&&
                  suggestion.notes
                    .filter(n=>!hitNote(n.time,n.lane))
                    .filter(n=>{ const x=n.time*pps; return x>=timelineScrollLeft-VIEW_MARGIN&&x<=timelineScrollLeft+tlVisibleWidth+VIEW_MARGIN; })
                    .map((n,i)=>(
                      <div
                        key={`${n.time}-${n.lane}-${i}`}
                        className="se-suggestion-ghost"
                        style={{
                          position:"absolute",
                          left:n.time*pps,
                          top:SE_HDR_H+n.lane*SE_LANE_H+5,
                          width:SE_NOTE_W,
                          height:SE_LANE_H-10,
                          cursor:"pointer",
                          zIndex:15,
                        } as CSSProperties}
                        title={`תו ב־${seFmt(n.time)}, מסלול ${n.lane+1} — לחץ לאשר`}
                        onClick={e=>{ e.stopPropagation(); e.preventDefault(); seAcceptSuggestionNote(n); }}
                        onPointerDown={e=>e.stopPropagation()}
                      >
                        <span className="se-suggestion-ghost-label">הצעה</span>
                      </div>
                    ))}

                {/* OVERLAY CANVAS — playhead + hold-create preview, painted via canvas API */}
                <canvas
                  ref={seOvRef}
                  width={totalW}
                  height={tlH}
                  style={{position:"absolute",top:0,left:0,width:totalW,height:tlH,pointerEvents:"none",zIndex:25}}
                />

                {/* Draggable playhead hit zone (sits on top of overlay) */}
                <div
                  ref={sePhRef}
                  className="se-ph-handle"
                  style={{
                    position:"absolute",top:0,left:playhead*pps-8,
                    width:16,height:16,zIndex:30,
                    cursor:"ew-resize",
                  }}
                  onPointerDown={startPlayheadDrag}
                />

              </div>
            </div>

            {/* סליידר גלילה אופקי — ניוד חופשי ימינה/שמאלה */}
            {audioUrl&&totalW>0&&(
              <div className="se-scroll-slider-wrap">
                <span className="se-scroll-slider-label">גלילה</span>
                <input
                  type="range"
                  className="se-scroll-slider"
                  min={0}
                  max={scrollMax}
                  step={1}
                  value={Math.min(timelineScrollLeft, scrollMax)}
                  onChange={e=>onTimelineSliderChange(Number(e.target.value))}
                  title="הזז ימינה/שמאלה לניווט בטיימליין"
                />
                <span className="se-scroll-slider-time">
                  {seFmt(scrollMax>0 ? timelineScrollLeft/pps : 0)} — {seFmt(dur)}
                </span>
              </div>
            )}

            {/* ── Video panel — docked below lanes, scrolls with timeline ── */}
            {videoUrl&&(
              <div className="se-vid-dock" style={{ height: `${videoDockHeight}px` }}>
                <div className="se-vid-dock-hd">
                  <span>🎬 {videoFile?.name??""}</span>
                  <div className="se-vid-dock-controls">
                    <label className="se-chip">Offset</label>
                    <input className="se-inp se-num" type="number" step="0.1" value={videoOffset}
                      style={{width:60}} onChange={e=>setVideoOffset(Number(e.target.value))}/>
                    <span className="se-chip">s</span>
                    <button className="se-icon-btn" onClick={()=>setVideoUrl("")} title="Remove video">✕</button>
                  </div>
                </div>
                {/* drag bar to resize video dock */}
                <div
                  style={{
                    height: 6,
                    cursor: "row-resize",
                    background: "linear-gradient(90deg, rgba(59,158,255,0.45), rgba(34,208,122,0.45))",
                  }}
                  onPointerDown={(e) => {
                    const startY = e.clientY;
                    const startH = videoDockHeight;
                    const onMove = (ev: PointerEvent) => {
                      const delta = ev.clientY - startY;
                      // Dragging up should increase height without an upper cap; dragging down shrinks but not below 120px
                      const next = Math.max(startH - delta, 120);
                      setVideoDockHeight(next);
                    };
                    const onUp = () => {
                      window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                    };
                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                  }}
                />
                <video
                  ref={seVideoEl}
                  src={videoUrl}
                  className="se-vid-dock-el"
                  muted
                  playsInline
                  preload="metadata"
                />
              </div>
            )}
            </div>
          )}
        </main>
      </div>

      {/* LIBRARY MODAL */}
      {library!==null&&(
        <div className="se-modal-bg" onClick={()=>setLibrary(null)}>
          <div className="se-modal" onClick={e=>e.stopPropagation()}>
            <div className="se-mhd"><h3>☁ Stage Library</h3><button className="se-icon-btn" onClick={()=>setLibrary(null)}>✕</button></div>
            <div className="se-mbody">
              {libLoad&&<div className="se-libmsg">Loading…</div>}
              {!libLoad&&library.length===0&&<div className="se-libmsg">No stages saved yet.</div>}
              {library.map(s=>(
                <div key={s.firestoreId} className="se-libitem">
                  <div className="se-libmeta">
                    <strong>{s.title||"Untitled"}</strong>
                    <span>{s.artist}</span>
                    <small>{s.notes.length} notes · {s.laneCount} lanes · {s.bpm} BPM</small>
                  </div>
                  <div className="se-libbtns">
                    <button className="se-abtn" onClick={()=>seLoadFromLib(s)}>Load</button>
                    <button className="se-abtn se-delbtn" onClick={async()=>{
                      if(!s.firestoreId) return;
                      await seFsDel(s.firestoreId);
                      setLibrary(prev=>prev?.filter(x=>x.firestoreId!==s.firestoreId)??null);
                    }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PLAYTEST OVERLAY */}
      {showPlaytest && audioUrl && (
        <RaidHeroPlaytestOverlay
          stage={{
            title: sTitle || "Custom Stage",
            artist: sArtist || "Editor",
            bpm: sBpm,
            beatOffset: sOff,
            laneCount: sLanes,
            notes: sNotesRef.current,
          }}
          audioUrl={audioUrl}
          videoUrl={showVideo ? videoUrl : undefined}
          startTimeSec={playtestOffsetSec}
          onClose={() => setShowPlaytest(false)}
        />
      )}
    </div>
  );
}


export default function RaidHeroGame() {
  const initialSongId       = SONG_CATALOG[0]?.id ?? "";
  const initialDifficultyId: DifficultyId = "medium";
  const initialGoodWindow   = DIFFICULTY_CATALOG.find(d => d.id === initialDifficultyId)?.goodWindow ?? 0.15;

  // Core refs
  const engineRef        = useRef<EngineState>(createEngineState());
  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const videoRef         = useRef<HTMLVideoElement | null>(null);
  const missCtxRef       = useRef<AudioContext | null>(null);
  const duckTimerRef     = useRef<number | null>(null);
  const pressedLanesRef  = useRef<boolean[]>(Array.from({ length: LANE_COUNT }, () => false));
  const analysisRef      = useRef<AudioAnalysis | null>(null);
  // Manual file override
  const manualAudioUrlRef = useRef<string | null>(null);

  // State
  const [view, setView]                       = useState<ViewState>(() => createViewState(engineRef.current, initialGoodWindow, TRACK_HEIGHT, HIT_LINE_Y));
  const [_audioReady, setAudioReady]           = useState(false);
  const [audioError, setAudioError]           = useState<string | null>(null);
  const [useFallback, setUseFallback]         = useState(false);
  const [showStartMenu, setShowStartMenu]     = useState(true);
  const [showDisclaimer, setShowDisclaimer]   = useState(true);
  const [selectedSongId, setSelectedSongId]   = useState(initialSongId);
  const [selectedDiffId, setSelectedDiffId]   = useState<DifficultyId>(initialDifficultyId);
  const [bindings, setBindings]               = useState(() => [...DEFAULT_BINDINGS]);
  const [captureLane, setCaptureLane]         = useState<number | null>(null);
  const [activeLanes, setActiveLanes]         = useState<boolean[]>(() => Array.from({ length: LANE_COUNT }, () => false));
  const [lastJudgment, setLastJudgment]       = useState<Judgment | null>(null);
  const [analysisStatus, setAnalysisStatus]   = useState<"idle" | "analyzing" | "done" | "failed">("idle");
  const [videoSrc, setVideoSrc]               = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions]  = useState<{ w: number; h: number } | null>(null);
  const [trackHeightPx, setTrackHeightPx]       = useState(TRACK_HEIGHT);
  const highwayWrapRef                         = useRef<HTMLDivElement | null>(null);
  const [manualAudioSrc, setManualAudioSrc]   = useState<string | null>(null);
  const [showEditor, setShowEditor]           = useState(() => {
    try {
      return localStorage.getItem("raidHero:stageEditor:open") === "1";
    } catch {
      return false;
    }
  });

  // Derived state
  const selectedSong = useMemo(() => SONG_CATALOG.find(s => s.id === selectedSongId) ?? SONG_CATALOG[0]!, [selectedSongId]);
  const selectedDiff = useMemo(() => DIFFICULTY_CATALOG.find(d => d.id === selectedDiffId) ?? DIFFICULTY_CATALOG[1]!, [selectedDiffId]);
  const stages       = useMemo(() => resolveStages(selectedSong.bpm, selectedDiff), [selectedDiff, selectedSong.bpm]);
  const chartSeed    = useMemo(() => selectedSong.seed + DIFFICULTY_SEED_OFFSET[selectedDiff.id], [selectedDiff.id, selectedSong.seed]);
  const activeLaneCount  = selectedDiff.laneCount;
  const activeBindings   = useMemo(() => bindings.slice(0, activeLaneCount), [activeLaneCount, bindings]);

  const musicSrc = useMemo(() => {
    if (manualAudioSrc) return manualAudioSrc;
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    return `${base}music/${encodeURIComponent(selectedSong.fileName)}`;
  }, [selectedSong.fileName, manualAudioSrc]);

  /* ── Lane utilities ─────────────────────────────────────────── */
  const setLanePressed = useCallback((lane: number, pressed: boolean) => {
    pressedLanesRef.current[lane] = pressed;
    setActiveLanes(prev => { if (prev[lane] === pressed) return prev; const n = [...prev]; n[lane] = pressed; return n; });
  }, []);
  const clearPressedLanes = useCallback(() => {
    pressedLanesRef.current = Array.from({ length: LANE_COUNT }, () => false);
    setActiveLanes(Array.from({ length: LANE_COUNT }, () => false));
  }, []);
  const hitLineY = Math.round(trackHeightPx * (HIT_LINE_Y / TRACK_HEIGHT));
  const syncView = useCallback(() => setView(createViewState(engineRef.current, selectedDiff.goodWindow, trackHeightPx, hitLineY)), [selectedDiff.goodWindow, trackHeightPx, hitLineY]);

  /* ── Miss SFX ───────────────────────────────────────────────── */
  const playMissSound = useCallback(() => {
    try {
      const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      let ctx = missCtxRef.current;
      if (!ctx) { ctx = new Ctor(); missCtxRef.current = ctx; }
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const gain = ctx.createGain(); const filt = ctx.createBiquadFilter();
      const oscA = ctx.createOscillator(); const oscB = ctx.createOscillator();
      filt.type = "bandpass"; filt.frequency.value = 620; filt.Q.value = 1.2;
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscA.type = "sawtooth"; oscA.frequency.setValueAtTime(260, now); oscA.frequency.exponentialRampToValueAtTime(85, now + 0.16);
      oscB.type = "triangle"; oscB.frequency.setValueAtTime(130, now); oscB.frequency.exponentialRampToValueAtTime(68, now + 0.16);
      oscA.connect(filt); oscB.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
      oscA.start(now); oscB.start(now); oscA.stop(now + 0.18); oscB.stop(now + 0.18);
    } catch { /* ignore */ }
  }, []);

  /* ── Miss penalty ───────────────────────────────────────────── */
  const clearMissPenalty = useCallback(() => {
    if (duckTimerRef.current !== null) { window.clearTimeout(duckTimerRef.current); duckTimerRef.current = null; }
    if (audioRef.current && Math.abs(audioRef.current.volume - 1) > 0.001) audioRef.current.volume = 1;
  }, []);

  const triggerMissPenalty = useCallback(() => {
    playMissSound();
    const audio = audioRef.current;
    const engine = engineRef.current;
    if (!audio || !engine.running || engine.finished) return;
    clearMissPenalty();
    audio.volume = Math.min(audio.volume, MISS_DUCK_VOLUME);
    duckTimerRef.current = window.setTimeout(() => { duckTimerRef.current = null; if (audioRef.current) audioRef.current.volume = 1; }, selectedDiff.missPenaltyMs);
  }, [clearMissPenalty, playMissSound, selectedDiff.missPenaltyMs]);

  /* ── Chart helpers that use analysisRef ─────────────────────── */
  const doEnsureChart = useCallback((engine: EngineState) => {
    ensureChart(engine, stages, selectedSong.beatOffset, chartSeed, activeLaneCount, selectedDiff, analysisRef.current);
  }, [stages, selectedSong.beatOffset, chartSeed, activeLaneCount, selectedDiff]);

  /* ── Reset ──────────────────────────────────────────────────── */
  const resetGame = useCallback(() => {
    const prev = engineRef.current;
    const duration = prev.duration;
    const next = createEngineState();
    next.duration = duration;
    doEnsureChart(next);
    engineRef.current = next;
    clearMissPenalty();
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    const video = videoRef.current;
    if (video) { video.pause(); video.currentTime = 0; }
    clearPressedLanes();
    syncView();
  }, [doEnsureChart, clearMissPenalty, clearPressedLanes, syncView]);

  /* ── Playback toggle ────────────────────────────────────────── */
  const togglePlayback = useCallback(async () => {
    if (showStartMenu) return;
    const audio = audioRef.current;
    const engine = engineRef.current;
    doEnsureChart(engine);

    if (useFallback) {
      if (engine.finished) resetGame();
      if (engine.running) { engine.running = false; clearMissPenalty(); syncView(); return; }
      engine.running = true; engine.finished = false; syncView(); return;
    }

    if (!audio) return;
    if (engine.finished) resetGame();
    if (engine.running) { engine.running = false; clearMissPenalty(); audio.pause(); videoRef.current?.pause(); syncView(); return; }
    if (Math.abs(audio.currentTime - engine.elapsed) > 0.08) audio.currentTime = engine.elapsed;
    engine.running = true; engine.finished = false;
    try {
      await audio.play();
      setAudioError(null);
      // Sync video if present
      const video = videoRef.current;
      if (video) { video.currentTime = audio.currentTime; video.play().catch(() => {}); }
    } catch {
      engine.running = false;
      setAudioError("Browser blocked play. Click Start/Resume.");
    }
    syncView();
  }, [doEnsureChart, clearMissPenalty, resetGame, showStartMenu, syncView, useFallback]);

  /* ── Open start menu ────────────────────────────────────────── */
  const openStartMenu = useCallback(() => {
    const engine = engineRef.current;
    engine.running = false;
    clearMissPenalty(); clearPressedLanes();
    audioRef.current?.pause(); videoRef.current?.pause();
    setShowStartMenu(true); syncView();
  }, [clearMissPenalty, clearPressedLanes, syncView]);

  /* ── Start from menu ────────────────────────────────────────── */
  const startFromMenu = useCallback(async () => {
    resetGame(); setShowStartMenu(false);
    const engine = engineRef.current;
    if (useFallback) { engine.running = true; engine.finished = false; syncView(); return; }
    const audio = audioRef.current;
    if (!audio) { syncView(); return; }
    engine.running = true; engine.finished = false;
    try {
      await audio.play(); setAudioError(null);
      const video = videoRef.current;
      if (video) { video.currentTime = audio.currentTime; video.play().catch(() => {}); }
    } catch { engine.running = false; setAudioError("Browser blocked play. Click Start/Resume."); }
    syncView();
  }, [resetGame, syncView, useFallback]);

  /* ── Lane hit ───────────────────────────────────────────────── */
  const registerLaneHit = useCallback((lane: number) => {
    const engine = engineRef.current;
    if (!engine.running) return;
    const stats = engine.player;
    const cand  = findClosestNote(engine.notes, lane, engine.elapsed, selectedDiff.goodWindow);
    if (!cand) {
      applyMiss(stats); triggerMissPenalty(); setLastJudgment("miss");
      window.setTimeout(() => setLastJudgment(cur => cur === "miss" ? null : cur), 140);
      syncView(); return;
    }
    const judgment = judgmentFromDelta(cand.absDelta, selectedDiff);
    if (!judgment) {
      applyMiss(stats); triggerMissPenalty(); setLastJudgment("miss");
      window.setTimeout(() => setLastJudgment(cur => cur === "miss" ? null : cur), 140);
      syncView(); return;
    }
    cand.note.judged = true; cand.note.judgment = judgment; cand.note.holdBroken = false; cand.note.holdTicksScored = 0; cand.note.holdComplete = cand.note.duration <= 0;
    stats.hits++; stats.combo++; stats.bestCombo = Math.max(stats.bestCombo, stats.combo); stats.totalJudged++;
    if (judgment === "perfect") stats.perfect++;
    if (judgment === "great")   stats.great++;
    if (judgment === "good")    stats.good++;
    stats.accuracyPoints += JUDGMENT_ACCURACY[judgment];
    stats.score += Math.round(JUDGMENT_SCORE[judgment] * getMultiplier(stats.combo));
    setLastJudgment(judgment);
    window.setTimeout(() => setLastJudgment(cur => cur === judgment ? null : cur), 180);
    syncView();
  }, [selectedDiff, syncView, triggerMissPenalty]);

  /* ── Reset analysis when song changes ─────────────────────────── */
  useEffect(() => {
    analysisRef.current = null;
    setAnalysisStatus("idle");
    setAudioReady(false); setAudioError(null); setUseFallback(false);
    setVideoSrc(null);
  }, [musicSrc]);

  /* ── Probe for video file ──────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    const candidates = getVideoSrcCandidates(musicSrc);
    let idx = 0;
    const tryNext = () => {
      if (!alive || idx >= candidates.length) return;
      const url = candidates[idx++];
      fetch(url, { method: "HEAD" })
        .then(r => { if (alive && r.ok) setVideoSrc(url); else tryNext(); })
        .catch(tryNext);
    };
    tryNext();
    return () => { alive = false; };
  }, [musicSrc]);

  /* ── Clear video dimensions when no video ──────────────────────── */
  useEffect(() => {
    if (!videoSrc) setVideoDimensions(null);
  }, [videoSrc]);

  /* ── Measure highway height (for dynamic track size from MP4) ─── */
  useEffect(() => {
    const el = highwayWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h > 0) setTrackHeightPx(h);
    });
    ro.observe(el);
    if (el.clientHeight > 0) setTrackHeightPx(el.clientHeight);
    return () => ro.disconnect();
  }, [videoSrc, videoDimensions]);

  /* ── Audio analysis via Web Audio ─────────────────────────────── */
  useEffect(() => {
    let alive = true;
    setAnalysisStatus("analyzing");
    const analysisUrl = musicSrc;

    const run = async () => {
      try {
        const resp = await fetch(analysisUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (!alive) return;

        const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx  = new Ctor();
        const decoded = await ctx.decodeAudioData(buf);
        ctx.close().catch(() => {});
        if (!alive) return;

        const analysis = analyzeAudioBuffer(decoded);
        analysisRef.current = analysis;
        setAnalysisStatus("done");
      } catch {
        if (alive) { setAnalysisStatus("failed"); }
      }
    };

    void run();
    return () => { alive = false; };
  }, [musicSrc]);

  /* ── Audio element events ──────────────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      const engine = engineRef.current;
      engine.duration = dur;
      doEnsureChart(engine);
      setAudioReady(dur > 0); setAudioError(null); syncView();
    };
    const onEnded = () => {
      clearMissPenalty();
      const engine = engineRef.current;
      engine.running = false; engine.finished = true;
      stepEngineToTime(engine, (engine.duration || engine.elapsed) + selectedDiff.goodWindow + 0.03, stages, selectedDiff.goodWindow);
      syncView();
    };
    const onError = () => {
      const engine = engineRef.current;
      engine.duration = FALLBACK_DURATION_SEC;
      doEnsureChart(engine);
      setAudioReady(true); setUseFallback(true);
      setAudioError(`⚠ Song file not found at the expected path. Place "${selectedSong.fileName}" in /public/music/ — or use the 📂 button to load it manually.`);
      syncView();
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    if (audio.readyState >= 1) onLoaded();
    return () => { audio.removeEventListener("loadedmetadata", onLoaded); audio.removeEventListener("ended", onEnded); audio.removeEventListener("error", onError); };
  }, [doEnsureChart, musicSrc, clearMissPenalty, selectedDiff.goodWindow, syncView, stages, selectedSong.fileName]);

  /* ── When analysis finishes, rebuild chart if already loaded ──── */
  useEffect(() => {
    if (analysisStatus === "done" || analysisStatus === "failed") {
      const engine = engineRef.current;
      if (engine.duration > 0 && engine.notes.length === 0) {
        doEnsureChart(engine);
        syncView();
      }
    }
  }, [analysisStatus, doEnsureChart, syncView]);

  // Listen for playtest requests coming from the StageEditor
  // (no external playtest wiring – editor playtest happens inside the StageEditor timeline)

  /* ── RAF game loop ─────────────────────────────────────────────── */
  useEffect(() => {
    let rafId = 0;
    let prevTime = performance.now();
    const frame = (t: number) => {
      const dt = Math.min((t - prevTime) / 1000, 0.05);
      prevTime = t;
      const engine = engineRef.current;
      if (engine.running) {
        const audio = audioRef.current;
        const prevElapsed = engine.elapsed;
        let songTime = engine.elapsed + dt;
        if (audio && audio.readyState >= 2 && Number.isFinite(audio.currentTime)) songTime = audio.currentTime;
        const misses = stepEngineToTime(engine, songTime, stages, selectedDiff.goodWindow);
        const sMisses = stepSustainToTime(engine, prevElapsed, pressedLanesRef.current);
        if (misses + sMisses > 0) triggerMissPenalty();
        if (engine.duration > 0 && engine.elapsed >= engine.duration) {
          engine.running = false; engine.finished = true;
          clearMissPenalty();
          audioRef.current?.pause(); videoRef.current?.pause();
          stepEngineToTime(engine, engine.duration + selectedDiff.goodWindow + 0.03, stages, selectedDiff.goodWindow);
        }
        syncView();
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [clearMissPenalty, selectedDiff.goodWindow, stages, syncView, triggerMissPenalty]);

  /* ── Keyboard ──────────────────────────────────────────────────── */
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (showStartMenu) return;
      if (captureLane !== null) {
        e.preventDefault();
        if (e.code === "Escape") { setCaptureLane(null); return; }
        setBindings(prev => { const n = [...prev]; const old = n.findIndex((v, i) => v === e.code && i !== captureLane); if (old >= 0) n[old] = n[captureLane]; n[captureLane] = e.code; return n; });
        setCaptureLane(null); return;
      }
      if (e.repeat) return;
      const lane = activeBindings.findIndex(v => v === e.code);
      if (lane < 0) return;
      e.preventDefault(); setLanePressed(lane, true); registerLaneHit(lane);
    };
    const onUp = (e: KeyboardEvent) => {
      if (showStartMenu || captureLane !== null) return;
      const lane = activeBindings.findIndex(v => v === e.code);
      if (lane >= 0) setLanePressed(lane, false);
    };
    const onBlur = () => clearPressedLanes();
    document.addEventListener("keydown", onDown); document.addEventListener("keyup", onUp); window.addEventListener("blur", onBlur);
    return () => { document.removeEventListener("keydown", onDown); document.removeEventListener("keyup", onUp); window.removeEventListener("blur", onBlur); };
  }, [activeBindings, captureLane, clearPressedLanes, registerLaneHit, setLanePressed, showStartMenu]);

  /* ── Cleanup ────────────────────────────────────────────────────── */
  useEffect(() => () => { clearMissPenalty(); clearPressedLanes(); }, [clearMissPenalty, clearPressedLanes]);
  useEffect(() => { if (captureLane !== null && captureLane >= activeLaneCount) setCaptureLane(null); }, [activeLaneCount, captureLane]);

  /* ── Manual file load ───────────────────────────────────────────── */
  const handleManualAudioLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (manualAudioUrlRef.current) URL.revokeObjectURL(manualAudioUrlRef.current);
    const url = URL.createObjectURL(file);
    manualAudioUrlRef.current = url;
    setManualAudioSrc(url);
    setAudioError(null);
  }, []);

  /* ── Derived render values ────────────────────────────────────── */
  const stage         = stages[view.stageIndex] ?? stages[0]!;
  const progress      = view.duration > 0 ? clamp((view.elapsed / view.duration) * 100, 0, 100) : 0;
  const stats         = view.player;
  const accuracy      = getAccuracy(stats);
  const multiplier    = getMultiplier(stats.combo);
  const stageStyle = useMemo(() => {
    const base: CSSProperties & Record<string, string> = { "--track-height": `${trackHeightPx}px` };
    if (videoDimensions && videoDimensions.w > 0 && videoDimensions.h > 0) {
      base.aspectRatio = `${videoDimensions.w} / ${videoDimensions.h}`;
      base.height = "auto";
      base.minHeight = "200px";
      base.maxHeight = "min(85vh, 900px)";
    } else {
      base.height = `${TRACK_HEIGHT}px`;
      base.minHeight = `${TRACK_HEIGHT}px`;
    }
    return base;
  }, [trackHeightPx, videoDimensions]);
  const buttonLabel   = view.running ? "Pause" : view.finished ? "Restart" : view.elapsed > 0 ? "Resume" : "Start";
  const notesForTrack = useMemo(() => view.visibleNotes, [view.visibleNotes]);
  const notesLeft     = Math.max(view.totalNotes - stats.totalJudged, 0);
  const sectionIntensity = clamp((0.55 / stage.beatStep + stage.density + stage.chordChance * 1.35 + stage.sustainChance * 0.85) / 2.95, 0, 1);
  const flowMeter        = clamp((stats.combo / 35) * 0.6 + (accuracy / 100) * 0.4, 0, 1);
  const activeLaneIndices = useMemo(() => Array.from({ length: activeLaneCount }, (_, l) => l), [activeLaneCount]);
  const analysisLabel    = analysisStatus === "analyzing" ? "🔍 Analysing waveform…" : analysisStatus === "done" ? `🎵 Onset chart (${analysisRef.current?.onsetTimes.length ?? 0} beats / ~${analysisRef.current?.estimatedBpm ?? 0} BPM)` : "";

  /* ─────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────── */
  if (showEditor) {
    return <StageEditor onClose={() => { setShowEditor(false); setShowStartMenu(true); }} />;
  }

  return (
    <main className="raid-hero-page">
      {/* Audio element — hidden; we try multiple URL patterns via key change */}
      <audio key={`${selectedSong.id}-${manualAudioSrc ?? "auto"}`} ref={audioRef} src={musicSrc} preload="auto" crossOrigin="anonymous" />

      <section className="raid-hero-shell">

        {/* ── DISCLAIMER ── */}
        {showDisclaimer && (
          <div className="raid-disclaimer-overlay">
            <section className="raid-disclaimer-card">
              <h3>⚠ גרסת אלפה מוקדמת</h3>
              <p>המשחק עדיין בשלב פיתוח מוקדם. ייתכנו באגים וחוויה שעדיין לא מלוטשת לחלוטין.</p>
              <button type="button" className="raid-disclaimer-btn" onClick={() => setShowDisclaimer(false)}>אישור והמשך</button>
            </section>
          </div>
        )}

        {/* ── END SCREEN ── */}
        {view.finished && !showStartMenu && (
          <div className="raid-end-overlay">
            <div className="raid-end-card">
              {/* Animated background particles */}
              <div className="raid-end-particles" aria-hidden="true">
                {Array.from({ length: 18 }, (_, i) => (
                  <span key={i} className="raid-end-particle" style={{ "--i": i } as React.CSSProperties} />
                ))}
              </div>

              {/* Grade badge */}
              <div className="raid-end-grade-wrap">
                <div className="raid-end-grade" data-grade={getGrade(accuracy)}>
                  {getGrade(accuracy)}
                </div>
                <div className="raid-end-accuracy">{accuracy}%</div>
              </div>

              {/* Song info */}
              <div className="raid-end-song">
                <span className="raid-end-song-title">{selectedSong.title}</span>
                <span className="raid-end-song-artist">— {selectedSong.artist}</span>
                <span className="raid-end-diff-badge">{selectedDiff.label}</span>
              </div>

              {/* Score */}
              <div className="raid-end-score">
                <span className="raid-end-score-label">SCORE</span>
                <span className="raid-end-score-value">{stats.score.toLocaleString()}</span>
              </div>

              {/* Stats grid */}
              <div className="raid-end-stats-grid">
                <div className="raid-end-stat raid-end-stat--perfect">
                  <div className="raid-end-stat-icon">✦</div>
                  <div className="raid-end-stat-label">PERFECT</div>
                  <div className="raid-end-stat-value">{stats.perfect}</div>
                </div>
                <div className="raid-end-stat raid-end-stat--great">
                  <div className="raid-end-stat-icon">★</div>
                  <div className="raid-end-stat-label">GREAT</div>
                  <div className="raid-end-stat-value">{stats.great}</div>
                </div>
                <div className="raid-end-stat raid-end-stat--good">
                  <div className="raid-end-stat-icon">◆</div>
                  <div className="raid-end-stat-label">GOOD</div>
                  <div className="raid-end-stat-value">{stats.good}</div>
                </div>
                <div className="raid-end-stat raid-end-stat--miss">
                  <div className="raid-end-stat-icon">✕</div>
                  <div className="raid-end-stat-label">MISS</div>
                  <div className="raid-end-stat-value">{stats.misses}</div>
                </div>
              </div>

              {/* Extra fun stats */}
              <div className="raid-end-extras">
                <div className="raid-end-extra">
                  <span className="raid-end-extra-label">🔥 Best Combo</span>
                  <span className="raid-end-extra-value">{stats.bestCombo}×</span>
                </div>
                <div className="raid-end-extra">
                  <span className="raid-end-extra-label">🎯 Hit Rate</span>
                  <span className="raid-end-extra-value">
                    {stats.totalJudged > 0 ? Math.round((stats.hits / stats.totalJudged) * 100) : 0}%
                  </span>
                </div>
                <div className="raid-end-extra">
                  <span className="raid-end-extra-label">📝 Total Notes</span>
                  <span className="raid-end-extra-value">{view.totalNotes}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="raid-end-actions">
                <button type="button" className="raid-hero-btn raid-hero-btn--primary raid-end-btn" onClick={resetGame}>
                  🔄 שחק שוב
                </button>
                <button type="button" className="raid-hero-btn raid-end-btn raid-end-btn--menu" onClick={openStartMenu}>
                  🎵 בחר שיר
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── START MENU ── */}
        {!showDisclaimer && showStartMenu && (
          <div className="raid-start-overlay">
            <div className="raid-start-card">
              <header className="raid-start-header">
                <div className="raid-start-logo">🎸</div>
                <h2>RAID HERO</h2>
                <p>בחר שיר ורמת קושי לפני התחלה</p>
              </header>

              <div className="raid-start-group">
                <h3>🎵 Song Catalog</h3>
                <div className="raid-song-grid">
                  {SONG_CATALOG.map(song => (
                    <button key={song.id} type="button" className={`raid-song-option${song.id === selectedSong.id ? " is-active" : ""}`} onClick={() => setSelectedSongId(song.id)}>
                      <strong>{song.title}</strong>
                      <span>{song.artist}</span>
                      <small>{song.bpm} BPM</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="raid-start-group">
                <h3>⚡ Difficulty</h3>
                <div className="raid-difficulty-grid">
                  {DIFFICULTY_CATALOG.map(diff => (
                    <button key={diff.id} type="button" className={`raid-difficulty-option${diff.id === selectedDiff.id ? " is-active" : ""}`} onClick={() => setSelectedDiffId(diff.id)}>
                      <strong>{diff.label}</strong>
                      <span>{diff.description}</span>
                      <small>{diff.laneCount} lanes · {Math.round(diff.goodWindow * 1000)}ms</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="raid-start-actions">
                <button type="button" className="raid-hero-btn raid-hero-btn--primary raid-start-play-btn" onClick={() => void startFromMenu()}>
                  🎸 START PLAYING
                </button>
                <button type="button" className="raid-hero-btn raid-hero-btn--editor" onClick={() => { setShowStartMenu(false); setShowEditor(true); }}>
                  ✏️ Stage Editor
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── HEADER ── */}
        <header className="raid-hero-header">
          <div className="raid-header-left">
            <span className="raid-hero-logo">🎸</span>
            <div>
              <h1>RAID HERO</h1>
              <p>{selectedSong.title} <span className="raid-artist">— {selectedSong.artist}</span></p>
            </div>
          </div>
          <div className="raid-hero-controls">
            <div className="raid-hero-clock">{formatClock(view.elapsed)} / {view.duration > 0 ? formatClock(view.duration) : "--:--"}</div>
            {/* Manual file load button */}
            <label className="raid-hero-btn raid-hero-btn--file" title="Load audio file manually">
              📂
              <input type="file" accept="audio/*" style={{ display: "none" }} onChange={handleManualAudioLoad} />
            </label>
            <button type="button" className="raid-hero-btn raid-hero-btn--menu" onClick={openStartMenu}>Songs</button>
            <button type="button" className="raid-hero-btn raid-hero-btn--primary" onClick={() => void togglePlayback()}>{buttonLabel}</button>
            <button type="button" className="raid-hero-btn raid-hero-btn--reset" onClick={resetGame}>Reset</button>
          </div>
        </header>

        {/* ── PROGRESS ── */}
        <div className="raid-song-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="raid-song-progress__bar" style={{ width: `${progress}%` }} />
        </div>

        {/* ── STATUS LINE ── */}
        {(audioError || analysisLabel) && (
          <div className={`raid-status-bar${audioError ? " raid-status-bar--error" : ""}`}>
            {audioError ?? analysisLabel}
          </div>
        )}

        {/* ── MAIN LAYOUT ── */}
        <div className="raid-game-layout">

          {/* LEFT: Score / Combo / Grade / Stats */}
          <aside className="raid-left-panel">
            <div className="raid-score-block">
              <div className="raid-score-label">SCORE</div>
              <div className="raid-score-value">{stats.score.toLocaleString()}</div>
            </div>
            <div className="raid-combo-block">
              <div className="raid-combo-num">{stats.combo}</div>
              <div className="raid-combo-label">COMBO</div>
              <div className="raid-multiplier">×{multiplier}</div>
            </div>
            <div className="raid-grade-block">
              <div className="raid-grade-letter" data-grade={getGrade(accuracy)}>{getGrade(accuracy)}</div>
              <div className="raid-accuracy">{accuracy}%</div>
            </div>
            <div className="raid-mini-stats">
              <div className="raid-mini-stat raid-mini-stat--perfect"><span>PERFECT</span><strong>{stats.perfect}</strong></div>
              <div className="raid-mini-stat raid-mini-stat--great"><span>GREAT</span><strong>{stats.great}</strong></div>
              <div className="raid-mini-stat raid-mini-stat--good"><span>GOOD</span><strong>{stats.good}</strong></div>
              <div className="raid-mini-stat raid-mini-stat--miss"><span>MISS</span><strong>{stats.misses}</strong></div>
            </div>
          </aside>

          {/* CENTER: Highway — size matches MP4 when video is present */}
          <div ref={highwayWrapRef} className="raid-highway-wrap" style={stageStyle}>
            {/* Section badge */}
            <div className="raid-stage-badge">
              <span className="raid-stage-pill">{stage.label}</span>
              <span className="raid-diff-badge">{selectedDiff.label}</span>
              {videoSrc && <span className="raid-video-badge">🎬 Video</span>}
            </div>

            {/* Judgment popup */}
            {lastJudgment && (
              <div className={`raid-judgment-popup raid-judgment-popup--${lastJudgment}`} key={`${lastJudgment}-${stats.totalJudged}`}>
                {lastJudgment === "perfect" ? "✦ PERFECT ✦" : lastJudgment === "great" ? "GREAT!" : lastJudgment === "good" ? "GOOD" : "MISS"}
              </div>
            )}

            {/* Combo in track (>= 10) */}
            {stats.combo >= 10 && (
              <div className="raid-track-combo"><span>{stats.combo}×</span></div>
            )}

            <div className="raid-track-lanes">

              {/* ── VIDEO BACKGROUND ── */}
              {videoSrc && (
                <video
                  ref={videoRef}
                  className="raid-bg-video"
                  src={videoSrc}
                  muted
                  playsInline
                  loop={false}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (v.videoWidth > 0 && v.videoHeight > 0) setVideoDimensions({ w: v.videoWidth, h: v.videoHeight });
                  }}
                />
              )}

              {/* Lane backgrounds */}
              {activeLaneIndices.map(lane => (
                <div key={`lane-${lane}`}
                  className={`raid-lane${activeLanes[lane] ? " is-active" : ""}`}
                  style={{ width: `calc(100% / ${activeLaneCount})`, left: `${(lane / activeLaneCount) * 100}%`, "--lane-color": LANE_COLORS[lane % LANE_COLORS.length], "--lane-glow": LANE_GLOW[lane % LANE_GLOW.length] } as React.CSSProperties}
                />
              ))}

              {/* Notes */}
              {notesForTrack.map(note => (
                <div key={note.id}
                  className={`raid-note raid-note--p1 raid-note--lane-${note.lane % LANE_COLORS.length}${note.isSustain ? " is-sustain" : ""}`}
                  style={{
                    left: `calc(${((note.lane + 0.5) / activeLaneCount) * 100}% - 26px)`,
                    transform: `translateY(${note.y}px)`,
                    height: `${note.height}px`,
                    "--lane-color": LANE_COLORS[note.lane % LANE_COLORS.length],
                    "--lane-glow": LANE_GLOW[note.lane % LANE_GLOW.length],
                  } as React.CSSProperties}
                />
              ))}

              {/* Hit line */}
              <div className={`raid-hit-line${lastJudgment ? ` raid-hit-line--${lastJudgment}` : ""}`} style={{ top: `${hitLineY}px` }} />

              {/* Hit buttons */}
              <div className="raid-hit-buttons" style={{ top: `${hitLineY - 20}px` }}>
                {activeLaneIndices.map(lane => (
                  <div key={`hbtn-${lane}`}
                    className={`raid-hit-btn${activeLanes[lane] ? " is-pressed" : ""}`}
                    style={{ width: `calc(100% / ${activeLaneCount})`, "--lane-color": LANE_COLORS[lane % LANE_COLORS.length], "--lane-glow": LANE_GLOW[lane % LANE_GLOW.length] } as React.CSSProperties}
                  >
                    <div className="raid-hit-btn-inner">
                      <span className="raid-hit-btn-key">{formatKey(activeBindings[lane] ?? "")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Key rebind row */}
            <div className="raid-key-rebind-row" style={{ gridTemplateColumns: `repeat(${activeLaneCount}, minmax(0, 1fr))` }}>
              {activeBindings.map((code, lane) => (
                <button type="button" key={`rb-${lane}`}
                  className={`raid-rebind-btn${captureLane === lane ? " is-capture" : ""}`}
                  style={{ "--lane-color": LANE_COLORS[lane % LANE_COLORS.length] } as React.CSSProperties}
                  onClick={() => setCaptureLane(lane)}
                >
                  {captureLane === lane ? "Press…" : formatKey(code)}
                </button>
              ))}
            </div>
            {captureLane !== null && captureLane < activeLaneCount && (
              <p className="raid-hero-capture-hint">Press a key for Lane {captureLane + 1} · Esc to cancel</p>
            )}
          </div>

          {/* RIGHT: HUD */}
          <aside className="raid-right-panel">
            <div className="raid-hud-card">
              <span className="raid-hud-title">Section Energy</span>
              <strong className="raid-hud-value">{Math.round(sectionIntensity * 100)}%</strong>
              <div className="raid-hud-meter"><i className="raid-hud-fill raid-hud-fill--energy" style={{ width: `${Math.round(sectionIntensity * 100)}%` }} /></div>
            </div>
            <div className="raid-hud-card">
              <span className="raid-hud-title">Flow Control</span>
              <strong className="raid-hud-value">{Math.round(flowMeter * 100)}%</strong>
              <div className="raid-hud-meter"><i className="raid-hud-fill raid-hud-fill--flow" style={{ width: `${Math.round(flowMeter * 100)}%` }} /></div>
            </div>
            <div className="raid-hud-card">
              <span className="raid-hud-title">Notes Left</span>
              <strong className="raid-hud-value">{notesLeft}</strong>
              <small className="raid-hud-sub">{stats.totalJudged}/{view.totalNotes}</small>
            </div>
            <div className="raid-hud-card">
              <span className="raid-hud-title">Best Combo</span>
              <strong className="raid-hud-value">{stats.bestCombo}</strong>
            </div>
            <div className="raid-hud-card">
              <span className="raid-hud-title">Est. BPM</span>
              <strong className="raid-hud-value">{analysisRef.current?.estimatedBpm ?? selectedSong.bpm}</strong>
              <small className="raid-hud-sub">{analysisStatus === "analyzing" ? "analysing…" : analysisStatus === "done" ? "from waveform" : "fallback BPM"}</small>
            </div>
          </aside>

        </div>
      </section>
    </main>
  );
}