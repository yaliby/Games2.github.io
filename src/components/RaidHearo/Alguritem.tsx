/**
 * Alguritem.tsx — ניתוח MP3/אודיו ויצירת JSON שלב בפורמט בונה השלבים (EditorStage).
 * מייצא: analyzeAudioBuffer, analyzeAudioBufferToStage, analyzeAudioUrlToStage.
 */

/* ═══════════════════════════════════════════════════════════════
   TYPES — פורמט ה-JSON כמו בבונה השלבים
════════════════════════════════════════════════════════════════ */
export type EditorNote = {
  id: string;
  lane: number;
  time: number;
  duration: number;
};

export type EditorStage = {
  title: string;
  artist: string;
  bpm: number;
  beatOffset: number;
  laneCount: number;
  audioName: string;
  notes: EditorNote[];
  firestoreId?: string;
  authorUid?: string;
  authorName?: string;
};

export type BuildStageOptions = {
  title?: string;
  artist?: string;
  audioName?: string;
  laneCount?: number;
  difficultyId?: DifficultyId;
  seed?: number;
};

/* ═══════════════════════════════════════════════════════════════
   AUDIO ANALYSIS RESULT
════════════════════════════════════════════════════════════════ */
export type AudioAnalysis = {
  bassOnsets:   { time: number; strength: number }[];
  midOnsets:    { time: number; strength: number }[];
  highOnsets:   { time: number; strength: number }[];
  onsetTimes:   number[];
  onsetStrengths: number[];
  onsetBands:   number[];
  phraseBreaks: number[];
  beatTimes:    number[];
  downbeatTimes: number[];
  sectionBoundaries: number[];
  sectionEnergy: number[];
  estimatedBpm: number;
  frameEnergy: Float32Array;
  frameRate: number;
};

/* ═══════════════════════════════════════════════════════════════
   DIFFICULTY (minimal for chart generation)
════════════════════════════════════════════════════════════════ */
export type DifficultyId = "easy" | "medium" | "normal" | "hard";

type DifficultyCatalogEntry = {
  id: DifficultyId;
  laneCount: number;
  chartBands: number[];
  densityScale: number;
  coreStrengthMin: number;
  maxSubdivision: number;
  syncopationAllowed: boolean;
  minOnsetGapSec: number;
  maxLaneJump: number;
  chordAllowed: boolean;
  chordScale: number;
  maxChordSize: number;
  sustainScale: number;
  fakeoutAllowed: boolean;
  patternBreakAllowed: boolean;
  beatStepScale: number;
};

const DIFFICULTY_CATALOG: DifficultyCatalogEntry[] = [
  { id: "easy", laneCount: 3, chartBands: [0], densityScale: 0.32, coreStrengthMin: 0.55, maxSubdivision: 1, syncopationAllowed: false, minOnsetGapSec: 0.38, maxLaneJump: 1, chordAllowed: false, chordScale: 0, maxChordSize: 1, sustainScale: 1.4, fakeoutAllowed: false, patternBreakAllowed: false, beatStepScale: 1.8 },
  { id: "medium", laneCount: 3, chartBands: [0, 1], densityScale: 0.50, coreStrengthMin: 0.45, maxSubdivision: 2, syncopationAllowed: false, minOnsetGapSec: 0.22, maxLaneJump: 2, chordAllowed: true, chordScale: 0.30, maxChordSize: 2, sustainScale: 1.0, fakeoutAllowed: false, patternBreakAllowed: false, beatStepScale: 1.3 },
  { id: "normal", laneCount: 4, chartBands: [0, 1, 2], densityScale: 0.64, coreStrengthMin: 0.35, maxSubdivision: 2, syncopationAllowed: true, minOnsetGapSec: 0.14, maxLaneJump: 3, chordAllowed: true, chordScale: 0.65, maxChordSize: 2, sustainScale: 0.85, fakeoutAllowed: false, patternBreakAllowed: true, beatStepScale: 1.1 },
  { id: "hard", laneCount: 4, chartBands: [0, 1, 2], densityScale: 0.82, coreStrengthMin: 0.25, maxSubdivision: 4, syncopationAllowed: true, minOnsetGapSec: 0.072, maxLaneJump: 3, chordAllowed: true, chordScale: 1.0, maxChordSize: 2, sustainScale: 0.65, fakeoutAllowed: true, patternBreakAllowed: true, beatStepScale: 0.88 },
];

const DIFFICULTY_SEED_OFFSET: Record<DifficultyId, number> = { easy: 97, medium: 157, normal: 211, hard: 389 };

const NOTE_SPAWN_LEAD = 0.5;
const SONG_END_GUARD = 0.8;
const MIN_SUSTAIN_SECONDS = 0.45;
const MIN_GAP_AFTER_SUSTAIN = 0.1;
const RNG_MODULUS = 0x100000000;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / RNG_MODULUS;
  };
}

function newEditorNoteId() {
  return `n${Math.random().toString(36).slice(2, 9)}`;
}

/* ═══════════════════════════════════════════════════════════════
   ANALYSIS ENGINE — Multi-band filterbank + beat tracker
════════════════════════════════════════════════════════════════ */
export function analyzeAudioBuffer(buffer: AudioBuffer): AudioAnalysis {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const nCh = buffer.numberOfChannels;

  const mono = new Float32Array(len);
  for (let c = 0; c < nCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i]! / nCh;
  }

  function lpFilter(x: Float32Array, fc: number): Float32Array {
    const alpha = (2 * Math.PI * fc) / (2 * Math.PI * fc + sr);
    const y = new Float32Array(x.length);
    y[0] = alpha * x[0]!;
    for (let i = 1; i < x.length; i++) y[i] = alpha * x[i]! + (1 - alpha) * y[i - 1]!;
    return y;
  }
  function hpFilter(x: Float32Array, fc: number): Float32Array {
    const lp = lpFilter(x, fc);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i]! - lp[i]!;
    return y;
  }

  const bassSignal = lpFilter(mono, 280);
  const highSignal = hpFilter(mono, 3000);
  const midSignal = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    midSignal[i] = mono[i]! - bassSignal[i]! - highSignal[i]!;
  }

  const HOP_SEC = 0.010;
  const WIN_SEC = 0.025;
  const HOP = Math.max(1, Math.round(sr * HOP_SEC));
  const WIN = Math.max(2, Math.round(sr * WIN_SEC));
  const frames = Math.floor((len - WIN) / HOP);

  function frameRms(sig: Float32Array): Float32Array {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0;
      const off = i * HOP;
      for (let j = 0; j < WIN; j++) {
        const v = sig[off + j] ?? 0;
        s += v * v;
      }
      out[i] = Math.sqrt(s / WIN);
    }
    return out;
  }

  const bassEnergy = frameRms(bassSignal);
  const midEnergy = frameRms(midSignal);
  const highEnergy = frameRms(highSignal);
  const fullEnergy = frameRms(mono);

  function computeOdf(eng: Float32Array): Float32Array {
    const odf = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      odf[i] = Math.max(0, eng[i]! - eng[i - 1]!);
    }
    return odf;
  }

  const bassOdf = computeOdf(bassEnergy);
  const midOdf = computeOdf(midEnergy);
  const highOdf = computeOdf(highEnergy);

  function pickPeaks(
    odf: Float32Array,
    mult: number,
    minGapS: number,
    halfWin: number,
    localMaxWin: number
  ): { frame: number; strength: number }[] {
    const minGap = Math.max(1, Math.round(minGapS / HOP_SEC));
    const peaks: { frame: number; strength: number }[] = [];
    for (let i = halfWin; i < frames - halfWin; i++) {
      let sum = 0;
      for (let j = i - halfWin; j <= i + halfWin; j++) sum += odf[j]!;
      const thresh = (sum / (halfWin * 2 + 1)) * mult;
      if (odf[i]! <= thresh) continue;
      let isMax = true;
      for (let j = Math.max(0, i - localMaxWin); j <= Math.min(frames - 1, i + localMaxWin); j++) {
        if (j !== i && odf[j]! >= odf[i]!) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      if (peaks.length === 0 || i - peaks[peaks.length - 1]!.frame >= minGap) {
        peaks.push({ frame: i, strength: odf[i]! / (thresh + 1e-9) });
      }
    }
    return peaks;
  }

  const bassPeaks = pickPeaks(bassOdf, 1.25, 0.080, 45, 4);
  const midPeaks = pickPeaks(midOdf, 1.15, 0.060, 35, 3);
  const highPeaks = pickPeaks(highOdf, 1.10, 0.045, 25, 2);

  function normaliseStrengths(peaks: { frame: number; strength: number }[]) {
    const maxS = peaks.reduce((m, p) => Math.max(m, p.strength), 1e-9);
    return peaks.map((p) => ({
      time: (p.frame * HOP) / sr,
      strength: Math.min(1, p.strength / maxS),
    }));
  }

  const bassOnsets = normaliseStrengths(bassPeaks);
  const midOnsets = normaliseStrengths(midPeaks);
  const highOnsets = normaliseStrengths(highPeaks);

  type TaggedOnset = { time: number; strength: number; band: number };
  const merged: TaggedOnset[] = [
    ...bassOnsets.map((o) => ({ ...o, band: 0 })),
    ...midOnsets.map((o) => ({ ...o, band: 1 })),
    ...highOnsets.map((o) => ({ ...o, band: 2 })),
  ].sort((a, b) => a.time - b.time);

  const DEDUP_SEC = 0.040;
  const deduped: TaggedOnset[] = [];
  for (const o of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && o.time - prev.time < DEDUP_SEC) {
      if (o.strength > prev.strength) {
        deduped[deduped.length - 1] = {
          time: (prev.time + o.time) / 2,
          strength: o.strength,
          band: Math.min(prev.band, o.band),
        };
      }
    } else {
      deduped.push(o);
    }
  }

  const onsetTimes = deduped.map((o) => o.time);
  const onsetStrengths = deduped.map((o) => o.strength);
  const onsetBands = deduped.map((o) => o.band);

  let estimatedBpm = 120;
  const ioi_onsets = [...bassOnsets, ...midOnsets].sort((a, b) => a.time - b.time);
  if (ioi_onsets.length >= 4) {
    const counts: Record<string, number> = {};
    for (const binSize of [0.01, 0.02]) {
      for (let i = 1; i < ioi_onsets.length; i++) {
        const ioi = ioi_onsets[i]!.time - ioi_onsets[i - 1]!.time;
        if (ioi < 0.18 || ioi > 2.8) continue;
        for (const mult of [1, 0.5, 2, 0.333, 3, 0.25, 4]) {
          const scaled = ioi * mult;
          if (scaled < 0.18 || scaled > 2.8) continue;
          const bin = Math.round(scaled / binSize);
          const baseW = mult === 1 ? 4 : mult === 0.5 || mult === 2 ? 2.5 : 1;
          counts[`${binSize}_${bin}`] =
            (counts[`${binSize}_${bin}`] ?? 0) +
            baseW * (ioi_onsets[i]!.strength * 0.7 + 0.3);
        }
      }
    }
    let bestBpm = 120,
      bestVal = 0;
    for (const [key, val] of Object.entries(counts)) {
      const [bsStr, binStr] = key.split("_");
      const bs = Number(bsStr),
        bin = Number(binStr);
      if (bin === 0) continue;
      const bpm = clamp(Math.round(60 / (bin * bs)), 55, 220);
      if (val > bestVal) {
        bestVal = val;
        bestBpm = bpm;
      }
    }
    estimatedBpm = bestBpm;
  }

  const beatSec = 60 / estimatedBpm;
  const strongOnsets = [...bassOnsets, ...midOnsets]
    .filter((o) => o.strength > 0.4)
    .map((o) => o.time);

  function scoreBeatPhase(phase: number): number {
    let score = 0;
    const halfBeat = beatSec / 2;
    for (const t of strongOnsets) {
      const distToNearestBeat = Math.abs(((t - phase) % beatSec + beatSec) % beatSec);
      const minDist = Math.min(distToNearestBeat, beatSec - distToNearestBeat);
      score += Math.max(0, 1 - minDist / halfBeat);
    }
    return score;
  }

  const rawAnchor =
    bassOnsets.find((o) => o.strength > 0.45)?.time ??
    bassOnsets[0]?.time ??
    (onsetTimes[0] ?? 0);

  let bestPhase = rawAnchor % beatSec;
  let bestPhaseScore = -1;
  for (let k = 0; k < 16; k++) {
    const candidate = (rawAnchor % beatSec) + (k / 16) * beatSec - beatSec / 2;
    const score = scoreBeatPhase(candidate);
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = candidate;
    }
  }

  const beatTimes: number[] = [];
  const gridStart = bestPhase - Math.ceil((bestPhase + beatSec) / beatSec) * beatSec;
  for (let t = gridStart; t < buffer.duration + beatSec * 2; t += beatSec) {
    beatTimes.push(Math.round(t * 1000) / 1000);
  }

  const downbeatTimes = beatTimes.filter((_, i) => i % 4 === 0);

  const PHRASE_GAP = 0.22;
  const phraseBreaks: number[] = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    const gap = onsetTimes[i]! - onsetTimes[i - 1]!;
    if (gap >= PHRASE_GAP) {
      phraseBreaks.push((onsetTimes[i - 1]! + onsetTimes[i]!) / 2);
    }
  }

  const L_WIN = Math.max(1, Math.round(2.0 / HOP_SEC));
  const L_HOP = Math.max(1, Math.round(0.5 / HOP_SEC));
  const lFrames = Math.max(1, Math.floor((frames - L_WIN) / L_HOP));
  const lEnergy = new Float32Array(lFrames);
  for (let i = 0; i < lFrames; i++) {
    let s = 0;
    for (let j = 0; j < L_WIN; j++) {
      const e = fullEnergy[i * L_HOP + j] ?? 0;
      s += e * e;
    }
    lEnergy[i] = Math.sqrt(s / L_WIN);
  }
  let maxLE = 0;
  for (const v of lEnergy) if (v > maxLE) maxLE = v;
  if (maxLE > 0) for (let i = 0; i < lFrames; i++) lEnergy[i]! /= maxLE;

  const sectionBoundaries: number[] = [0];
  for (let i = 4; i < lFrames - 4; i++) {
    const prev3 = (lEnergy[i - 1]! + lEnergy[i - 2]! + lEnergy[i - 3]! + lEnergy[i - 4]!) / 4;
    const next3 = (lEnergy[i]! + lEnergy[i + 1]! + lEnergy[i + 2]! + lEnergy[i + 3]!) / 4;
    const eps = 0.01;
    const ratio = Math.abs(next3 - prev3) / (Math.min(prev3, next3) + eps);
    if (ratio > 0.28) {
      const t = (i * L_HOP * HOP) / sr;
      const nearestBeat = beatTimes.reduce(
        (best, bt) => (Math.abs(bt - t) < Math.abs(best - t) ? bt : best),
        t
      );
      const snapT = Math.abs(nearestBeat - t) < 1.0 ? nearestBeat : t;
      if (snapT - sectionBoundaries[sectionBoundaries.length - 1]! > 5) {
        sectionBoundaries.push(snapT);
      }
    }
  }
  sectionBoundaries.push(buffer.duration);

  const sectionEnergy: number[] = [];
  for (let s = 0; s < sectionBoundaries.length - 1; s++) {
    const f0 = Math.floor((sectionBoundaries[s]! * sr) / HOP);
    const f1 = Math.min(frames, Math.floor((sectionBoundaries[s + 1]! * sr) / HOP));
    let sum = 0,
      cnt = 0;
    for (let f = f0; f < f1; f++) {
      sum += fullEnergy[f]!;
      cnt++;
    }
    sectionEnergy.push(cnt > 0 ? sum / cnt : 0);
  }
  const maxSE = Math.max(...sectionEnergy, 1e-9);
  for (let i = 0; i < sectionEnergy.length; i++) sectionEnergy[i]! /= maxSE;

  return {
    bassOnsets,
    midOnsets,
    highOnsets,
    onsetTimes,
    onsetStrengths,
    onsetBands,
    phraseBreaks,
    beatTimes,
    downbeatTimes,
    sectionBoundaries,
    sectionEnergy,
    estimatedBpm,
    frameEnergy: fullEnergy,
    frameRate: 1 / HOP_SEC,
  };
}

/* ═══════════════════════════════════════════════════════════════
   CHART GENERATION — Band-aware, beat-aligned (same logic as game)
════════════════════════════════════════════════════════════════ */
type SectionRole = "intro" | "verse" | "pre-chorus" | "chorus" | "bridge" | "outro";
type PatternArchetype = "groove" | "fill" | "peak" | "breakdown" | "run";
type MotionBias = "spread" | "cluster" | "zigzag" | "ascend" | "descend" | "center";

type InternalNote = { id: number; lane: number; hitTime: number; duration: number };

function inferSectionRole(normPos: number, energy: number): SectionRole {
  if (normPos < 0.08) return "intro";
  if (normPos > 0.88) return "outro";
  if (energy > 0.78) return "chorus";
  if (energy > 0.58 && normPos > 0.3) return "pre-chorus";
  if (energy < 0.28) return "bridge";
  return "verse";
}

function selectArchetype(
  role: SectionRole,
  barInPhrase: number,
  energy: number,
  diff: DifficultyCatalogEntry,
  rng: () => number
): PatternArchetype {
  if (diff.id === "easy") {
    if (barInPhrase === 3) return "breakdown";
    return "groove";
  }
  if (barInPhrase === 3) {
    if (!diff.patternBreakAllowed) return "groove";
    return rng() < 0.45 ? "breakdown" : "peak";
  }
  if (barInPhrase === 2) {
    if (energy > 0.6 && diff.maxSubdivision >= 2) return rng() < 0.5 ? "peak" : "run";
    return "fill";
  }
  if (barInPhrase === 1) return energy > 0.5 ? "fill" : "groove";
  switch (role) {
    case "chorus":
      return "peak";
    case "pre-chorus":
      return energy > 0.5 ? "fill" : "groove";
    case "bridge":
    case "outro":
      return "breakdown";
    default:
      return "groove";
  }
}

function bandLaneAffinity(band: number, laneCount: number): number[] {
  const w = new Array<number>(laneCount).fill(1.0);
  if (laneCount === 4) {
    if (band === 0) {
      w[0] = 3.5;
      w[1] = 2.0;
      w[2] = 0.8;
      w[3] = 0.4;
    }
    if (band === 1) {
      w[0] = 1.2;
      w[1] = 2.5;
      w[2] = 2.5;
      w[3] = 1.2;
    }
    if (band === 2) {
      w[0] = 0.4;
      w[1] = 0.8;
      w[2] = 2.0;
      w[3] = 3.5;
    }
  } else {
    if (band === 0) {
      w[0] = 3.0;
      w[1] = 1.5;
      w[2] = 0.5;
    }
    if (band === 1) {
      w[0] = 1.0;
      w[1] = 3.0;
      w[2] = 1.0;
    }
    if (band === 2) {
      w[0] = 0.5;
      w[1] = 1.5;
      w[2] = 3.0;
    }
  }
  return w;
}

function archetypeMotionBias(
  archetype: PatternArchetype,
  energy: number,
  rng: () => number
): MotionBias {
  switch (archetype) {
    case "groove":
      return energy < 0.35 ? "center" : rng() < 0.5 ? "cluster" : "zigzag";
    case "fill":
      return rng() < 0.5 ? "zigzag" : "spread";
    case "peak":
      return rng() < 0.5 ? "spread" : rng() < 0.5 ? "ascend" : "descend";
    case "run":
      return rng() < 0.5 ? "ascend" : "descend";
    case "breakdown":
      return "center";
  }
}

function pickNextLane(
  rng: () => number,
  lastLane: number,
  laneCount: number,
  freeLanes: number[],
  band: number,
  motionBias: MotionBias,
  consecutiveSame: number,
  energy: number,
  maxJump: number
): number {
  if (freeLanes.length === 0) return lastLane;
  if (freeLanes.length === 1) return freeLanes[0]!;
  let pool =
    consecutiveSame >= 2 ? freeLanes.filter((l) => l !== lastLane) : freeLanes;
  if (pool.length === 0) pool = freeLanes;
  if (lastLane >= 0 && maxJump < laneCount - 1) {
    const constrained = pool.filter((l) => Math.abs(l - lastLane) <= maxJump);
    if (constrained.length > 0) pool = constrained;
  }
  const affinity = bandLaneAffinity(band, laneCount);
  const affinityW = clamp(1.0 - energy * 0.45, 0.3, 1.0);
  const scores = pool.map((lane) => {
    const dist = Math.abs(lane - lastLane);
    let mot = 1.0;
    switch (motionBias) {
      case "spread":
        mot = dist >= 2 ? 3.2 : dist === 1 ? 1.5 : 0.3;
        break;
      case "cluster":
        mot = dist === 1 ? 3.0 : dist === 0 ? 1.3 : 0.2;
        break;
      case "zigzag":
        mot =
          (lastLane % 2 === 0 ? lane % 2 !== 0 : lane % 2 === 0) ? 3.5 : 0.4;
        break;
      case "ascend":
        mot = lane > lastLane ? 2.5 + dist * 0.7 : 0.2;
        break;
      case "descend":
        mot = lane < lastLane ? 2.5 + dist * 0.7 : 0.2;
        break;
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
  for (const { lane, score } of scores) {
    pick -= score;
    if (pick <= 0) return lane;
  }
  return scores[scores.length - 1]!.lane;
}

function localEnergy(
  fe: Float32Array,
  fps: number,
  t: number,
  win = 0.15
): number {
  const f0 = Math.max(0, Math.floor((t - win) * fps));
  const f1 = Math.min(fe.length - 1, Math.ceil((t + win) * fps));
  let s = 0,
    n = 0;
  for (let f = f0; f <= f1; f++) {
    s += fe[f]!;
    n++;
  }
  return n > 0 ? s / n : 0;
}

function buildChartFromAnalysis(
  duration: number,
  analysis: AudioAnalysis,
  seed: number,
  laneCount: number,
  difficulty: DifficultyCatalogEntry
): InternalNote[] {
  const notes: InternalNote[] = [];
  const rng = createRng(seed + DIFFICULTY_SEED_OFFSET[difficulty.id]);
  let noteId = 1;

  const playStart = NOTE_SPAWN_LEAD;
  const playEnd = duration - SONG_END_GUARD;
  const beatSec = 60 / analysis.estimatedBpm;
  const songLen = playEnd - playStart;

  const SNAP = clamp(beatSec * 0.28, 0.035, 0.09);
  function isDownbeat(t: number) {
    return analysis.downbeatTimes.some((d) => Math.abs(d - t) < SNAP);
  }
  function isOnBeat(t: number) {
    return analysis.beatTimes.some((b) => Math.abs(b - t) < SNAP);
  }
  function isOnSubdiv(t: number, subdiv: number): boolean {
    const subBeat = beatSec / subdiv;
    return analysis.beatTimes.some((b) => {
      const rel =
        ((t - b) % (subBeat * subdiv) + subBeat * subdiv) % (subBeat * subdiv);
      const nearSub = Math.round(rel / subBeat) * subBeat;
      return Math.abs(rel - nearSub) < SNAP;
    });
  }

  function sectionEnergyAt(t: number): number {
    const sb = analysis.sectionBoundaries;
    for (let i = 0; i < sb.length - 1; i++) {
      if (t >= sb[i]! && t < sb[i + 1]!)
        return analysis.sectionEnergy[i] ?? 0.5;
    }
    return analysis.sectionEnergy[analysis.sectionEnergy.length - 1] ?? 0.5;
  }

  const rawBounds = new Set<number>([playStart, playEnd]);
  for (const t of analysis.sectionBoundaries)
    if (t > playStart && t < playEnd) rawBounds.add(t);
  for (const t of analysis.phraseBreaks)
    if (t > playStart && t < playEnd) rawBounds.add(t);

  const sortedBounds = Array.from(rawBounds).sort((a, b) => a - b);
  const pBounds: number[] = [];
  for (const t of sortedBounds) {
    if (pBounds.length === 0 || t - pBounds[pBounds.length - 1]! > 1.8)
      pBounds.push(t);
  }

  interface PhraseInfo {
    start: number;
    end: number;
    energy: number;
    role: SectionRole;
    normPos: number;
    index: number;
  }
  const phrases: PhraseInfo[] = pBounds.slice(0, -1).map((ps, i) => {
    const pe = pBounds[i + 1]!;
    const mid = (ps + pe) / 2;
    const secEng = sectionEnergyAt(mid);
    const frmEng = localEnergy(
      analysis.frameEnergy,
      analysis.frameRate,
      mid,
      (pe - ps) / 2
    );
    const energy = clamp(secEng * 0.65 + frmEng * 2.0 * 0.35, 0, 1);
    const normPos = clamp((mid - playStart) / songLen, 0, 1);
    return {
      start: ps,
      end: pe,
      energy,
      role: inferSectionRole(normPos, energy),
      normPos,
      index: i,
    };
  });

  const allowedBands = new Set(difficulty.chartBands);
  const allOnsets = analysis.onsetTimes
    .map((t, i) => ({
      time: t,
      strength: analysis.onsetStrengths[i]!,
      band: analysis.onsetBands[i]!,
    }))
    .filter(
      (o) =>
        o.time >= playStart &&
        o.time < playEnd &&
        allowedBands.has(o.band)
    );

  if (allOnsets.length === 0) return [];

  const laneBusy = new Array<number>(laneCount).fill(-1);
  let lastLane = Math.floor(laneCount / 2);
  let consecutiveSame = 0;
  let currentPhraseIdx = -1;
  let currentArchetype: PatternArchetype = "groove";
  let currentBias: MotionBias = "zigzag";
  let currentEnergy = 0.5;
  let currentBarInPhrase = 0;
  let lastNoteTime = -999;
  let fakeoutUntil = -1;
  const motifBias = new Map<number, MotionBias>();

  for (let oi = 0; oi < allOnsets.length; oi++) {
    const o = allOnsets[oi]!;
    const hitTime = o.time;
    const strength = o.strength;
    const band = o.band;

    const pi = phrases.findIndex((p) => hitTime >= p.start && hitTime < p.end);
    const phrase = phrases[pi >= 0 ? pi : 0]!;

    if (pi >= 0 && pi !== currentPhraseIdx) {
      currentPhraseIdx = pi;
      currentEnergy = phrase.energy;
      currentBarInPhrase = 0;
      const recalled = motifBias.get(pi - 4);
      const archetype = selectArchetype(
        phrase.role,
        0,
        phrase.energy,
        difficulty,
        rng
      );
      currentArchetype = archetype;
      currentBias =
        recalled ?? archetypeMotionBias(archetype, phrase.energy, rng);
      motifBias.set(pi, currentBias);
    }

    const barDur = beatSec * 4;
    const newBar = Math.floor((hitTime - phrase.start) / barDur);
    if (newBar !== currentBarInPhrase && newBar < 4) {
      currentBarInPhrase = newBar;
      const newArch = selectArchetype(
        phrase.role,
        newBar,
        phrase.energy,
        difficulty,
        rng
      );
      currentArchetype = newArch;
      currentBias = archetypeMotionBias(newArch, phrase.energy, rng);
    }

    const pEnergy = currentEnergy;

    if (hitTime - lastNoteTime < difficulty.minOnsetGapSec) continue;
    if (difficulty.fakeoutAllowed && hitTime < fakeoutUntil) continue;

    if (!difficulty.syncopationAllowed) {
      if (!isOnBeat(hitTime) && !isDownbeat(hitTime)) {
        if (rng() > 0.15) continue;
      }
    }

    const minBeatFrac = beatSec / difficulty.maxSubdivision;
    if (
      hitTime - lastNoteTime < minBeatFrac * 0.75 &&
      !isDownbeat(hitTime)
    )
      continue;
    if (
      difficulty.maxSubdivision === 1 &&
      !isOnBeat(hitTime) &&
      !isDownbeat(hitTime)
    ) {
      if (rng() > 0.12) continue;
    }
    if (
      difficulty.maxSubdivision === 2 &&
      !isOnBeat(hitTime) &&
      !isOnSubdiv(hitTime, 2) &&
      rng() > 0.22
    )
      continue;

    const isCore =
      (band === 0 && strength > difficulty.coreStrengthMin) ||
      isDownbeat(hitTime) ||
      strength > 0.82;

    if (!isCore) {
      const keep = clamp(
        difficulty.densityScale * (0.45 + pEnergy * 0.55),
        0.04,
        0.92
      );
      if (rng() > keep) continue;
    }

    const fEng = localEnergy(
      analysis.frameEnergy,
      analysis.frameRate,
      hitTime,
      0.08
    );
    if (fEng < 0.004 && rng() > 0.25) continue;

    const justAfterBreak = analysis.phraseBreaks.some(
      (pb) => pb < hitTime && hitTime - pb < 0.3
    );
    if (justAfterBreak && rng() > 0.55) continue;

    if (currentArchetype === "breakdown") {
      if (!isDownbeat(hitTime) && strength < 0.7) {
        if (rng() > 0.2) continue;
      }
      if (
        difficulty.fakeoutAllowed &&
        isDownbeat(hitTime) &&
        rng() < 0.22
      ) {
        fakeoutUntil = hitTime + beatSec * 1.5;
      }
    }

    const freeLanes = Array.from({ length: laneCount }, (_, l) => l).filter(
      (l) => laneBusy[l]! <= hitTime - difficulty.minOnsetGapSec
    );
    if (freeLanes.length === 0) continue;

    let didChord = false;
    if (difficulty.chordAllowed && freeLanes.length >= 2) {
      const onDB = isDownbeat(hitTime),
        onBeat = isOnBeat(hitTime);
      const chordP =
        onDB && strength > 0.6 && pEnergy > 0.5
          ? clamp(difficulty.chordScale * pEnergy * 0.32, 0, 0.44)
          : onBeat && strength > 0.72 && pEnergy > 0.62
            ? clamp(difficulty.chordScale * pEnergy * 0.16, 0, 0.28)
            : 0;

      if (rng() < chordP) {
        const ln1 = pickNextLane(
          rng,
          lastLane,
          laneCount,
          freeLanes,
          band,
          currentBias,
          consecutiveSame,
          pEnergy,
          difficulty.maxLaneJump
        );
        const other = freeLanes.filter(
          (l) => l !== ln1 && Math.abs(l - ln1) >= 1
        );
        if (other.length > 0) {
          const ln2 = other[Math.floor(rng() * other.length)]!;
          for (const ln of [ln1, ln2]) {
            notes.push({
              id: noteId++,
              lane: ln,
              hitTime,
              duration: 0,
            });
            laneBusy[ln] = hitTime + difficulty.minOnsetGapSec;
          }
          consecutiveSame = ln1 === lastLane ? consecutiveSame + 1 : 0;
          lastLane = ln1;
          lastNoteTime = hitTime;
          didChord = true;
        }
      }
    }
    if (didChord) continue;

    const lane = pickNextLane(
      rng,
      lastLane,
      laneCount,
      freeLanes,
      band,
      currentBias,
      consecutiveSame,
      pEnergy,
      difficulty.maxLaneJump
    );
    consecutiveSame = lane === lastLane ? consecutiveSame + 1 : 0;
    lastLane = lane;
    lastNoteTime = hitTime;

    const next = allOnsets[oi + 1];
    const gap = next ? next.time - hitTime : beatSec * 2;
    const wantSustain =
      band !== 2 &&
      currentArchetype !== "run" &&
      gap >= MIN_SUSTAIN_SECONDS * 1.25 &&
      pEnergy < 0.78 &&
      !analysis.phraseBreaks.some(
        (pb) => pb > hitTime && pb < hitTime + gap * 0.7
      );
    const sustainP = wantSustain
      ? clamp(
          difficulty.sustainScale * 0.17 * (1.0 - pEnergy * 0.35),
          0,
          0.48
        )
      : 0;
    const isSustain = rng() < sustainP;
    const sustainDur = isSustain
      ? clamp(gap * 0.6, MIN_SUSTAIN_SECONDS, beatSec * 2.5)
      : 0;

    notes.push({
      id: noteId++,
      lane,
      hitTime,
      duration: sustainDur,
    });
    laneBusy[lane] = hitTime + sustainDur + MIN_GAP_AFTER_SUSTAIN;
  }

  notes.sort(
    (a, b) =>
      a.hitTime !== b.hitTime ? a.hitTime - b.hitTime : a.lane - b.lane
  );
  return notes;
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API — ניתוח ל־JSON שלב (פורמט בונה השלבים)
════════════════════════════════════════════════════════════════ */

/**
 * ממיר ניתוח אודיו + אופציות ל־EditorStage (JSON כמו בבונה השלבים).
 */
export function analysisToEditorStage(
  analysis: AudioAnalysis,
  duration: number,
  options: BuildStageOptions = {}
): EditorStage {
  const difficultyId = options.difficultyId ?? "normal";
  const difficulty =
    DIFFICULTY_CATALOG.find((d) => d.id === difficultyId) ??
    DIFFICULTY_CATALOG[2]!;
  const laneCount = options.laneCount ?? difficulty.laneCount;
  const seed = options.seed ?? 0;

  const internalNotes = buildChartFromAnalysis(
    duration,
    analysis,
    seed,
    laneCount,
    difficulty
  );

  const notes: EditorNote[] = internalNotes.map((n) => ({
    id: newEditorNoteId(),
    lane: n.lane,
    time: Math.round(n.hitTime * 1000) / 1000,
    duration: Math.round(n.duration * 1000) / 1000,
  }));

  return {
    title: options.title ?? "Generated Stage",
    artist: options.artist ?? "Algorithm",
    bpm: analysis.estimatedBpm,
    beatOffset: 0,
    laneCount,
    audioName: options.audioName ?? "",
    notes,
  };
}

/**
 * ניתוח buffer אודיו ויצירת EditorStage JSON.
 */
export function analyzeAudioBufferToStage(
  buffer: AudioBuffer,
  options: BuildStageOptions = {}
): EditorStage {
  const analysis = analyzeAudioBuffer(buffer);
  return analysisToEditorStage(analysis, buffer.duration, options);
}

/**
 * טעינת MP3/אודיו מ-URL, ניתוח, ויצירת EditorStage JSON.
 */
export async function analyzeAudioUrlToStage(
  url: string,
  options: BuildStageOptions = {}
): Promise<EditorStage> {
  const { analysis, duration } = await getAnalysisFromAudioUrl(url);
  return analysisToEditorStage(analysis, duration, options);
}

/**
 * טעינת אודיו מ-URL וקבלת ניתוח בלבד (לשימוש בהצעות תו הבא).
 */
export async function getAnalysisFromAudioUrl(
  url: string
): Promise<{ analysis: AudioAnalysis; duration: number }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();
  const Ctor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor!();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close().catch(() => {});
  const analysis = analyzeAudioBuffer(buffer);
  return { analysis, duration: buffer.duration };
}

export type SuggestedNote = { time: number; lane: number; duration: number };

function bandToLane(band: number, laneCount: number): number {
  if (laneCount === 4)
    return band === 0 ? 0 : band === 1 ? 1 : laneCount - 1;
  return Math.min(band, laneCount - 1);
}

/**
 * מציע את התו הבא אחרי הזמן שנתון (לשימוש יחיד).
 */
export function suggestNextNote(
  analysis: AudioAnalysis,
  afterTimeSec: number,
  laneCount: number
): SuggestedNote | null {
  const arr = suggestAllNotesFrom(analysis, afterTimeSec, laneCount);
  return arr.length > 0 ? arr[0]! : null;
}

/**
 * מציע את כל התווים מהנקודה שנתונה עד סוף השיר — להצגה גרפית על הגריד.
 * המשתמש לוחץ על תו מוצע כדי לאשר (להוסיף) אותו.
 */
export function suggestAllNotesFrom(
  analysis: AudioAnalysis,
  afterTimeSec: number,
  laneCount: number
): SuggestedNote[] {
  const margin = 0.02;
  const from = afterTimeSec + margin;
  const out: SuggestedNote[] = [];
  for (let i = 0; i < analysis.onsetTimes.length; i++) {
    const t = analysis.onsetTimes[i]!;
    if (t < from) continue;
    const band = analysis.onsetBands[i] ?? 0;
    const lane = bandToLane(band, laneCount);
    out.push({
      time: Math.round(t * 1000) / 1000,
      lane,
      duration: 0,
    });
  }
  return out;
}
