import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import UserBox from "../UserBox/UserBox";
import { auth, db } from "../../services/firebase";
import { submitCoyoteFlapyScore } from "../../services/scoreService";
import "./CoyoteFlapyGame.css";

/* ══════════════════════════════════════════════════════════════
   COYOTE FLAPY  v5  — "Desert Legend"
   ──────────────────────────────────────────────────────────────
   NEW IN v5:
   • 2 POWER-UPS: Shield 🛡  ·  Double Points ⚡
   • GEM collectibles  (sparkle +2 between pipes)
   • MOTION TRAIL  (8-frame ghost)
   • SCREEN FLASH  (red on hit · gold on powerup/milestone)
   • DUST PUFFS  on every flap
   • 5 STAGE SKY THEMES  (Dawn → Sunrise → Golden → Dusk → Boss)
   • 2 BOSSES: Road Runner (50) + Gal Shapiro hacker boss (100)
   • INTERPOLATED RENDER  (sub-frame smoothness)
   • PAUSE  (P key / button)
   • NEAR-MISS bonus detection
   • MOVING PIPES  (sine-wave vertical drift above score 12)
══════════════════════════════════════════════════════════════ */

/* ─────────────────── DIMENSIONS ─────────────────────────── */
const W = 420;
const H = 640;
const GH = 50; // ground height
const CX = 105; // coyote X (fixed)

/* ─────────────────── PHYSICS ─────────────────────────────── */
const FIXED_MS = 1000 / 60;
const MAX_DELTA = 100;
const G_UP = 0.27; // lighter on rise  → floaty feel
const G_DOWN = 0.55; // heavier on fall  → snappy drop
const TERM_VEL = 13;
const FLAP_VEL = -7.8;
const FLAP_DAMP = 7; // frames; prevents spam-boost
const GRACE_F = 5; // grace frames at pipe edge
const HIT_R = 11; // collision radius (forgiving)
const GAP_PAD = 6; // leniency at gap edges

/* ─────────────────── PIPES ───────────────────────────────── */
const PIPE_W = 66;
const PIPE_RIM = 7;
const BASE_GAP = 205;
const MIN_GAP = 118;
const BASE_SPEED = 2.3;
const MAX_SPEED = 7.8;
const BASE_SPAWN_F = 95;
const NEAR_MISS_D = 16; // px from edge counts as near-miss

/* ─────────────────── POWER-UPS ───────────────────────────── */
const PU_SPAWN_EVERY = 10; // every N pipe-passes
const PU_SHIELD_HITS = 2;
const PU_DBL_F = 500; // frames (≈8s)
const PU_R = 13;
const SHIELD_IFRAMES = 120; // 2s at 60fps after shield absorbs a hit
const SHIELD_SPAWN_CHANCE = 0.28; // shield is intentionally rarer than double
const RESUME_COUNTDOWN_F = 180; // 3s at 60fps before resuming from pause

/* ─────────────────── GEMS ────────────────────────────────── */
const GEM_CHANCE = 0.28;
const GEM_R = 8;
const GEM_VALUE = 2;

/* ─────────────────── BOSS ────────────────────────────────── */
const BOSS_AT = 50;
const BOSS2_AT = 100;
const BOSS_HP = 12;
const BOSS2_HP = 16;
const BOSS_SHOT_CD_BASE = 52;
const BOSS_SHOT_CD_MIN = 22;
const BOSS_SHOT_VX = -5.8;
const BOSS_SHOT_R = 9;

/* ─────────────────── STAGES (sky themes) ─────────────────── */
const STAGES = [
  { at: 0, name: "DAWN", top: "#0d0c2e", mid: "#7b3a72", bot: "#f5a278", sun: "#ffd0b0", starA: 0.75 },
  { at: 10, name: "SUNRISE", top: "#0a0820", mid: "#c84820", bot: "#f5c050", sun: "#ffe888", starA: 0.38 },
  { at: 25, name: "GOLDEN", top: "#1a0808", mid: "#d96a1e", bot: "#f5d460", sun: "#fff8a0", starA: 0.1 },
  { at: 40, name: "DUSK", top: "#08040e", mid: "#882060", bot: "#f59050", sun: "#ff9080", starA: 0.5 },
  { at: BOSS_AT, name: "BOSS!", top: "#000010", mid: "#180830", bot: "#3a186a", sun: "#7050ff", starA: 0.95 },
  { at: BOSS2_AT, name: "GAL", top: "#050511", mid: "#1a112e", bot: "#3f2a61", sun: "#f2f2f2", starA: 0.98 },
];

function getStage(score: number) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (score >= STAGES[i].at) return STAGES[i];
  }
  return STAGES[0];
}

/* ─────────────────── MILESTONES ──────────────────────────── */
const MILESTONES = new Set([5, 10, 20, 35, 50, 75, 100]);
const KEY_BEST_PREFIX = "cfp_v5_best";
const KEY_SAVE_PREFIX = "cfp_v5_save";

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type Phase = "ready" | "playing" | "paused" | "countdown" | "dead";
type PUType = "shield" | "double";
type LeaderboardRow = { uid: string; score: number };

interface Pipe {
  x: number;
  gapY: number;
  gap: number;
  scored: boolean;
  nearMissed: boolean;
  baseGapY: number;
  moveAmp: number;
  moveSpeed: number;
  movePhase: number;
}

interface PowerUp {
  x: number;
  y: number;
  kind: PUType;
  life: number;
}
interface Gem {
  x: number;
  y: number;
  taken: boolean;
  bobPhase: number;
}

interface BossShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spark: number;
}
type BossKind = "runner" | "gal";

interface Boss {
  kind: BossKind;
  active: boolean;
  defeated: boolean;
  x: number;
  y: number;
  targetY: number;
  hp: number;
  maxHp: number;
  introF: number;
  shotCD: number;
  shots: BossShot[];
  phase2: boolean; // entered at 50% HP
  hitFlash: number; // flash frame counter
}

interface TrailPoint {
  cy: number;
  tilt: number;
  alpha: number;
}

interface ScreenFlash {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface World {
  /* coyote */
  cy: number;
  prevCy: number;
  vel: number;
  tilt: number;
  prevTilt: number;
  scaleX: number;
  scaleY: number;
  sinceFlap: number;

  /* world */
  frames: number;
  score: number;
  phase: Phase;
  speed: number;
  mode: "normal" | "boss";

  /* pipes */
  pipes: Pipe[];
  spawnTimer: number;

  /* trail */
  trail: TrailPoint[];

  /* collectibles */
  powerUps: PowerUp[];
  gems: Gem[];
  pipesPassedSinceLastPU: number;

  /* active power-up effects */
  shieldHits: number;
  doubleFrames: number;
  invulnFrames: number;
  resumeCountdownFrames: number;

  graceFrames: number;

  /* death */
  deathFrames: number;

  /* parallax */
  groundOff: number;
  prevGroundOff: number;

  /* boss */
  boss: Boss;
  boss1Defeated: boolean;
  boss2Defeated: boolean;
  preBossKind: BossKind | null;
  preBossFrames: number;

  /* flash */
  flash: ScreenFlash;

  /* flags */
  newBest: boolean;
  lastMilestone: number;
  pipesTotal: number; // total pipes ever scored (for every-5 celebration)

  /* anti-cheat: if player warped to boss via hotkeys, disable score counting */
  scoreDisabled: boolean;
}

/* ══════════════════════════════════════════════════════════════
   FACTORIES
══════════════════════════════════════════════════════════════ */
function mkBoss(kind: BossKind = "runner"): Boss {
  const hp = kind === "gal" ? BOSS2_HP : BOSS_HP;
  return {
    kind,
    active: false,
    defeated: false,
    x: W + 140,
    y: H * 0.3,
    targetY: H * 0.3,
    hp,
    maxHp: hp,
    introF: kind === "gal" ? 120 : 100,
    shotCD: kind === "gal" ? Math.max(BOSS_SHOT_CD_MIN, BOSS_SHOT_CD_BASE - 6) : BOSS_SHOT_CD_BASE,
    shots: [],
    phase2: false,
    hitFlash: 0,
  };
}

function mkWorld(): World {
  return {
    cy: H / 2,
    prevCy: H / 2,
    vel: 0,
    tilt: 0,
    prevTilt: 0,
    scaleX: 1,
    scaleY: 1,
    sinceFlap: 999,
    frames: 0,
    score: 0,
    phase: "ready",
    speed: BASE_SPEED,
    mode: "normal",
    pipes: [],
    spawnTimer: BASE_SPAWN_F,
    trail: [],
    powerUps: [],
    gems: [],
    pipesPassedSinceLastPU: 0,
    shieldHits: 0,
    doubleFrames: 0,
    invulnFrames: 0,
    resumeCountdownFrames: 0,
    graceFrames: 0,
    deathFrames: 0,
    groundOff: 0,
    prevGroundOff: 0,
    boss: mkBoss(),
    boss1Defeated: false,
    boss2Defeated: false,
    preBossKind: null,
    preBossFrames: 0,
    flash: { r: 255, g: 255, b: 255, alpha: 0 },
    newBest: false,
    lastMilestone: 0,
    pipesTotal: 0,
    scoreDisabled: false,
  };
}

function mkPipe(x: number, gap: number, score: number): Pipe {
  const canMove = score >= 12;
  const amp = canMove ? Math.min(48, ((score - 12) / 30) * 48) * Math.random() : 0;
  const spd = canMove ? 0.02 + Math.random() * 0.026 : 0;
  const margin = 100;
  const baseY = margin + Math.random() * (H - margin * 2 - GH - gap - amp * 2);
  return {
    x,
    gap,
    scored: false,
    nearMissed: false,
    gapY: baseY + gap / 2,
    baseGapY: baseY + gap / 2,
    moveAmp: amp,
    moveSpeed: spd,
    movePhase: Math.random() * Math.PI * 2,
  };
}

/* ══════════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════════ */
function getBestStorageKey(uid: string | null): string {
  return uid ? `${KEY_BEST_PREFIX}:${uid}` : `${KEY_BEST_PREFIX}:guest`;
}

function getSaveStorageKey(uid: string | null): string {
  return uid ? `${KEY_SAVE_PREFIX}:${uid}` : `${KEY_SAVE_PREFIX}:guest`;
}

function loadBest(uid: string | null): number {
  try {
    const v = Number(localStorage.getItem(getBestStorageKey(uid)));
    return isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}
function saveBest(uid: string | null, v: number) {
  try {
    localStorage.setItem(getBestStorageKey(uid), String(v));
  } catch {}
}
function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

type SavedGame = {
  v: 1;
  world: Partial<World>;
  best: number;
};

function hydrateWorld(raw: Partial<World>): World {
  const base = mkWorld();
  const rawBoss = (raw.boss ?? {}) as Partial<Boss>;
  const bossKind: BossKind = rawBoss.kind === "gal" ? "gal" : "runner";
  const bossBase = mkBoss(bossKind);
  const bossActive = rawBoss.active ?? base.boss.active;
  const legacyBossDefeated = Boolean(rawBoss.defeated);

  return {
    ...base,
    ...raw,
    phase: raw.phase ?? base.phase,
    mode: raw.mode ?? base.mode,
    pipes: Array.isArray(raw.pipes) ? raw.pipes : base.pipes,
    trail: Array.isArray(raw.trail) ? raw.trail : base.trail,
    powerUps: Array.isArray(raw.powerUps) ? raw.powerUps : base.powerUps,
    gems: Array.isArray(raw.gems) ? raw.gems : base.gems,
    boss1Defeated: raw.boss1Defeated ?? legacyBossDefeated ?? base.boss1Defeated,
    boss2Defeated: raw.boss2Defeated ?? base.boss2Defeated,
    preBossKind: raw.preBossKind === "gal" || raw.preBossKind === "runner" ? raw.preBossKind : base.preBossKind,
    preBossFrames: typeof raw.preBossFrames === "number" ? Math.max(0, raw.preBossFrames | 0) : base.preBossFrames,
    scoreDisabled: typeof (raw as any).scoreDisabled === "boolean" ? Boolean((raw as any).scoreDisabled) : base.scoreDisabled,
    boss: {
      ...bossBase,
      ...rawBoss,
      kind: bossKind,
      active: bossActive,
      hp: typeof rawBoss.hp === "number" ? rawBoss.hp : bossBase.hp,
      maxHp: typeof rawBoss.maxHp === "number" ? rawBoss.maxHp : bossBase.maxHp,
      shots: bossActive && Array.isArray(rawBoss.shots) ? rawBoss.shots : [],
    },
    flash: {
      ...base.flash,
      ...(raw.flash ?? {}),
    },
  };
}

function loadSavedGame(uid: string | null): SavedGame | null {
  try {
    const raw = localStorage.getItem(getSaveStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (!parsed || parsed.v !== 1 || !parsed.world) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSavedGame(uid: string | null) {
  try {
    localStorage.removeItem(getSaveStorageKey(uid));
  } catch {}
}

/* ══════════════════════════════════════════════════════════════
   DIFFICULTY  — smooth, balanced, score-driven only
══════════════════════════════════════════════════════════════ */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getDiffProgress(score: number): number {
  return Math.min(1, score / 45);
}

function getSpeed(score: number): number {
  if (score >= BOSS_AT) return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * 0.45;
  const p = easeInOutCubic(getDiffProgress(score));
  return BASE_SPEED + (6.1 - BASE_SPEED) * p;
}

function getGap(score: number): number {
  if (score >= BOSS_AT) return MIN_GAP + 30;
  const p = easeInOutCubic(getDiffProgress(score));
  return BASE_GAP - (BASE_GAP - 126) * p;
}

function getSpawnF(score: number): number {
  const p = Math.min(1, score / 45);
  return Math.round(95 - 29 * easeInOutCubic(p));
}

/* ══════════════════════════════════════════════════════════════
   PARTICLES & EFFECTS
══════════════════════════════════════════════════════════════ */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
  color: string;
}
interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  vy: number;
  color: string;
  size: number;
  bold?: boolean;
}

const FLAP_CLR = ["#f5c97a", "#ffb84a", "#ffe0a0", "#ff9a4a", "#fff0cc"];
const DEATH_CLR = ["#ff6b35", "#f5c97a", "#ff3322", "#fff5cc", "#ff8822"];
const DUST_CLR = ["#c8905a", "#a0703a", "#e0b880", "#d4a870"];
const GEM_CLR = ["#00eeff", "#44aaff", "#aaeeff", "#ffffff"];
const SPARK_CLR = ["#ffee44", "#ff8800", "#ffffff", "#ff4400"];

let parts: Particle[] = [];
let floats: FloatText[] = [];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function addParts(x: number, y: number, n: number, colors: string[], vSpread: number, vUp: number, rMin: number, rMax: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = vSpread * Math.random();
    parts.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - vUp,
      life: 1,
      r: rMin + Math.random() * (rMax - rMin),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}
function addFlapDust(x: number, y: number) {
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 0.7;
    const s = 1.5 + Math.random() * 3.5;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 1,
      r: 2 + Math.random() * 4,
      color: FLAP_CLR[Math.floor(Math.random() * 5)],
    });
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.3 + Math.random() * 0.4);
    const s = 0.8 + Math.random() * 2;
    parts.push({
      x: x - 10 + Math.random() * 20,
      y: y + 8 + Math.random() * 8,
      vx: Math.cos(a) * s * (Math.random() > 0.5 ? 1 : -1),
      vy: -0.5 - Math.random(),
      life: 0.85,
      r: 3 + Math.random() * 6,
      color: DUST_CLR[Math.floor(Math.random() * 4)],
    });
  }
}
function addDeathBurst(x: number, y: number) {
  addParts(x, y, 32, DEATH_CLR, 7, 3, 2, 7);
}
function addGemCollect(x: number, y: number) {
  addParts(x, y, 12, GEM_CLR, 4, 2, 2, 5);
}
function addSpark(x: number, y: number) {
  addParts(x, y, 6, SPARK_CLR, 3, 1, 1, 3);
}

function tickParts(speedFactor: number) {
  parts = parts.filter((p) => p.life > 0.03);
  for (const p of parts) {
    p.x += p.vx * speedFactor;
    p.y += p.vy * speedFactor;
    p.vy += 0.2 * speedFactor;
    p.vx *= 0.965;
    p.life -= 0.034;
  }
}

function renderParts(ctx: CanvasRenderingContext2D) {
  for (const p of parts) {
    ctx.save();
    ctx.globalAlpha = p.life * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * Math.sqrt(p.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function addFloat(x: number, y: number, text: string, color = "#fff", size = 20, bold = false) {
  floats.push({ x, y, text, life: 1, vy: -1.1, color, size, bold });
}
function tickFloats() {
  floats = floats.filter((f) => f.life > 0.02);
  for (const f of floats) {
    f.y += f.vy;
    f.vy *= 0.95;
    f.life -= 0.025;
  }
}
function renderFloats(ctx: CanvasRenderingContext2D) {
  for (const f of floats) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life * 2.5);
    ctx.fillStyle = f.color;
    ctx.font = `${f.bold ? "bold " : ""}${f.size}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════
   DRAW — BACKGROUND  (5 stage themes + 3-layer parallax)
══════════════════════════════════════════════════════════════ */
const STAR_POS = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 137.508) % W,
  y: (i * 83.31) % (H * 0.28),
  r: 0.5 + (i % 3) * 0.5,
}));

function drawBg(ctx: CanvasRenderingContext2D, frames: number, score: number) {
  const st = getStage(score);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, st.top);
  sky.addColorStop(0.3, st.mid);
  sky.addColorStop(0.68, st.bot);
  sky.addColorStop(1, "#f5d890");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  if (st.starA > 0.05) {
    for (const s of STAR_POS) {
      const twinkle = 0.55 + 0.45 * Math.sin(frames * 0.05 + s.x);
      ctx.save();
      ctx.globalAlpha = st.starA * twinkle;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (Math.floor(frames) % 320 < 18) {
      const prog = (Math.floor(frames) % 320) / 18;
      ctx.save();
      ctx.globalAlpha = st.starA * (1 - prog) * 0.7;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W * 0.6 - prog * 90, H * 0.08 + prog * 30);
      ctx.lineTo(W * 0.6 - prog * 90 + 28, H * 0.08 + prog * 30 - 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  const sunX = W - 68,
    sunY = 88;
  if (score >= BOSS_AT) {
    const mg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 38);
    mg.addColorStop(0, "#c0c0ff");
    mg.addColorStop(0.5, "#7060ff");
    mg.addColorStop(1, "rgba(80,60,200,0)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 68);
    sg.addColorStop(0, st.sun);
    sg.addColorStop(0.45, st.bot + "cc");
    sg.addColorStop(1, "rgba(255,200,60,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 68, 0, Math.PI * 2);
    ctx.fill();
  }

  const fOff = (frames * BASE_SPEED * 0.12) % (W + 300);
  drawMesas(ctx, -fOff, 0.1, "#6b2f0e", 28);
  drawMesas(ctx, W - fOff, 0.1, "#6b2f0e", 28);

  const nOff = (frames * BASE_SPEED * 0.26) % (W + 350);
  drawMesas(ctx, -nOff, 0.2, "#8a3a14", 0);
  drawMesas(ctx, W - nOff, 0.2, "#8a3a14", 0);

  const c1 = (frames * 0.32) % (W + 145) - 72;
  const c2 = (frames * 0.18 + 210) % (W + 170) - 85;
  ctx.fillStyle = score >= BOSS_AT ? "rgba(120,80,255,0.10)" : "rgba(255,255,255,0.13)";
  ctx.beginPath();
  ctx.ellipse(c1, 60, 50, 20, 0, 0, Math.PI * 2);
  ctx.ellipse(c1 + 50, 57, 34, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = score >= BOSS_AT ? "rgba(100,60,255,0.08)" : "rgba(255,255,255,0.09)";
  ctx.beginPath();
  ctx.ellipse(c2, 106, 44, 18, 0, 0, Math.PI * 2);
  ctx.ellipse(c2 + 44, 104, 28, 13, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawMesas(ctx: CanvasRenderingContext2D, xOff: number, alpha: number, color: string, yOff: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(xOff, 320 + yOff);
  ctx.lineTo(xOff, 210 + yOff);
  ctx.lineTo(xOff + 52, 174 + yOff);
  ctx.lineTo(xOff + 112, 174 + yOff);
  ctx.lineTo(xOff + 136, 210 + yOff);
  ctx.lineTo(xOff + 192, 320 + yOff);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(xOff + W - 36, 314 + yOff);
  ctx.lineTo(xOff + W - 36, 198 + yOff);
  ctx.lineTo(xOff + W - 78, 162 + yOff);
  ctx.lineTo(xOff + W - 152, 162 + yOff);
  ctx.lineTo(xOff + W - 188, 198 + yOff);
  ctx.lineTo(xOff + W - 238, 314 + yOff);
  ctx.fill();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   DRAW — GROUND (scrolling)
══════════════════════════════════════════════════════════════ */
const ROCKS: [number, number, number, number][] = [
  [12, 8, 5.5, 0.15],
  [42, 7, 4, 0.22],
  [88, 6, 3.5, 0.1],
  [142, 9, 6, 0.18],
  [198, 7, 4, 0.25],
  [258, 8, 4.5, 0.12],
  [308, 9, 5, 0.2],
  [362, 6, 3, 0.16],
];

function drawGround(ctx: CanvasRenderingContext2D, off: number) {
  const gy = H - GH;
  ctx.fillStyle = "#7a3b10";
  ctx.fillRect(0, gy, W, GH);
  ctx.fillStyle = "#5e2b08";
  ctx.fillRect(0, gy, W, 8);
  ctx.strokeStyle = "#6a3010";
  ctx.lineWidth = 1.5;
  const sp = 52;
  for (let i = 0; i <= Math.ceil(W / sp) + 1; i++) {
    const cx = (((i * sp - (off % sp)) % W) + sp) % (W + sp) - sp * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, gy + 10);
    ctx.lineTo(cx + 7, gy + GH);
    ctx.stroke();
  }
  for (const [rx, ry, rw, angle] of ROCKS) {
    const sx = (((rx - off * 0.82) % W) + W) % W;
    ctx.fillStyle = "#6a3010";
    ctx.beginPath();
    ctx.ellipse(sx, gy + ry, rw, rw * 0.6, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ══════════════════════════════════════════════════════════════
   DRAW — PIPES  (terracotta columns, animated)
══════════════════════════════════════════════════════════════ */
function drawPipes(ctx: CanvasRenderingContext2D, pipes: Pipe[]) {
  for (const p of pipes) {
    const topH = p.gapY - p.gap / 2;
    const botY = p.gapY + p.gap / 2;
    const segs: [number, number][] = [
      [0, topH],
      [botY, H - botY],
    ];

    for (const [py, ph] of segs) {
      if (ph <= 0) continue;
      const bg = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
      bg.addColorStop(0, "#c05518");
      bg.addColorStop(0.18, "#da6e1e");
      bg.addColorStop(0.8, "#b04e14");
      bg.addColorStop(1, "#8a3a0e");
      ctx.fillStyle = bg;
      ctx.fillRect(p.x, py, PIPE_W, ph);
      ctx.fillStyle = "rgba(255,195,110,0.16)";
      ctx.fillRect(p.x + 2, py, 7, ph);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(p.x + PIPE_W - 10, py, 10, ph);
    }
    const rg = ctx.createLinearGradient(p.x - PIPE_RIM, 0, p.x + PIPE_W + PIPE_RIM, 0);
    rg.addColorStop(0, "#bf5215");
    rg.addColorStop(0.18, "#e07228");
    rg.addColorStop(0.85, "#c05215");
    rg.addColorStop(1, "#8a3a0e");
    ctx.fillStyle = rg;
    ctx.fillRect(p.x - PIPE_RIM, topH - 24, PIPE_W + PIPE_RIM * 2, 24);
    ctx.fillRect(p.x - PIPE_RIM, botY, PIPE_W + PIPE_RIM * 2, 24);
    ctx.fillStyle = "rgba(255,215,140,0.28)";
    ctx.fillRect(p.x - PIPE_RIM, topH - 24, PIPE_W + PIPE_RIM * 2, 5);
    ctx.fillRect(p.x - PIPE_RIM, botY, PIPE_W + PIPE_RIM * 2, 5);
    ctx.fillStyle = "#7b3209";
    for (let s = 0; s < 4; s++) {
      const sx = p.x + 4 + s * 15;
      ctx.beginPath();
      ctx.moveTo(sx, topH - 24);
      ctx.lineTo(sx + 4, topH - 37);
      ctx.lineTo(sx + 8, topH - 24);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx, botY + 24);
      ctx.lineTo(sx + 4, botY + 37);
      ctx.lineTo(sx + 8, botY + 24);
      ctx.fill();
    }
    if (p.moveAmp > 8) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.shadowColor = "#44aaff";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "#44aaff";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - PIPE_RIM, topH - 24, PIPE_W + PIPE_RIM * 2, 24);
      ctx.strokeRect(p.x - PIPE_RIM, botY, PIPE_W + PIPE_RIM * 2, 24);
      ctx.restore();
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   DRAW — COYOTE  (with trail + shield bubble + squash/stretch)
══════════════════════════════════════════════════════════════ */
function drawTrail(ctx: CanvasRenderingContext2D, trail: TrailPoint[]) {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    ctx.save();
    ctx.globalAlpha = t.alpha * 0.18;
    ctx.translate(CX, t.cy);
    ctx.rotate(t.tilt);
    ctx.fillStyle = "#ffaa55";
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCoyote(ctx: CanvasRenderingContext2D, w: World, cy: number, tilt: number) {
  const dead = w.phase === "dead";

  if (w.shieldHits > 0 && !dead) {
    ctx.save();
    const pulse = 0.8 + 0.2 * Math.sin(w.frames * 0.22);
    ctx.globalAlpha = 0.35 * pulse;
    ctx.strokeStyle = "#44aaff";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#44aaff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(CX, cy, (HIT_R + 12) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.08 * pulse;
    ctx.fillStyle = "#44aaff";
    ctx.beginPath();
    ctx.arc(CX, cy, (HIT_R + 12) * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const dblGlow = w.doubleFrames > 0;

  ctx.save();
  ctx.translate(CX, cy);
  ctx.rotate(tilt);
  ctx.scale(w.scaleX, w.scaleY);

  if (dblGlow && !dead) {
    ctx.save();
    ctx.globalAlpha = 0.22 * (0.7 + 0.3 * Math.sin(w.frames * 0.3));
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.1 * w.scaleX;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(0, 22, 17 / w.scaleX, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "#7b4c28";
  ctx.lineWidth = 5.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-14, 5);
  ctx.bezierCurveTo(-36, 0, -34, -20, -20, -26);
  ctx.stroke();
  ctx.fillStyle = "#f2ede5";
  ctx.beginPath();
  ctx.arc(-20, -26, 6, 0, Math.PI * 2);
  ctx.fill();

  const bg = ctx.createRadialGradient(-5, -5, 2, 0, 0, 20);
  bg.addColorStop(0, dead ? "#a06040" : "#d48a5a");
  bg.addColorStop(1, "#7b4c28");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = dead ? "#d0b090" : "#f0d0a8";
  ctx.beginPath();
  ctx.ellipse(5, 3, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#7b4c28";
  ctx.beginPath();
  ctx.moveTo(-10, -11);
  ctx.lineTo(-7, -30);
  ctx.lineTo(-1, -11);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(5, -11);
  ctx.lineTo(9, -30);
  ctx.lineTo(14, -11);
  ctx.fill();
  ctx.fillStyle = "#e8b0a0";
  ctx.beginPath();
  ctx.moveTo(-9, -12);
  ctx.lineTo(-7, -25);
  ctx.lineTo(-2, -12);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -12);
  ctx.lineTo(9, -25);
  ctx.lineTo(12, -12);
  ctx.fill();

  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.ellipse(15.5, 1.5, 2.8, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (dead) {
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(5, -5);
    ctx.lineTo(11, -1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, -1);
    ctx.lineTo(11, -5);
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#f5c97a";
    ctx.font = "10px serif";
    ctx.textAlign = "center";
    ctx.fillText("✦", 4, -10);
    ctx.fillText("✦", 13, -10);
    ctx.restore();
  } else {
    ctx.fillStyle = "#eee";
    ctx.beginPath();
    ctx.ellipse(8.5, -2.5, 3.8, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5a2a0a";
    ctx.beginPath();
    ctx.arc(8.8, -2.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(9, -2.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(9.8, -3.5, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }

  const swing = w.phase === "playing" ? Math.sin(w.frames * 0.44) * 9 : 0;
  const bounce = w.phase === "playing" ? Math.abs(Math.sin(w.frames * 0.44)) * 2 : 0;
  ctx.strokeStyle = "#7b4c28";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, 11);
  ctx.lineTo(-9 - bounce, 21 + swing);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 11);
  ctx.lineTo(7 + bounce, 21 - swing);
  ctx.stroke();

  if (!dead && w.vel > 5.5) {
    ctx.save();
    ctx.globalAlpha = 0.2 * Math.min(1, (w.vel - 5.5) / 6);
    ctx.strokeStyle = "#ffe0a0";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const lx = -24 - i * 9,
        ly = -4 + i * 6;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - 16, ly);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   DRAW — POWER-UPS & GEMS
══════════════════════════════════════════════════════════════ */
const PU_ICONS: Record<PUType, string> = { shield: "🛡", double: "⚡" };
const PU_COLORS: Record<PUType, string> = { shield: "#44aaff", double: "#ffd700" };

function drawCollectibles(ctx: CanvasRenderingContext2D, powerUps: PowerUp[], gems: Gem[], frames: number) {
  for (const g of gems) {
    if (g.taken) continue;
    const bob = Math.sin(g.bobPhase + frames * 0.08) * 4;
    ctx.save();
    ctx.translate(g.x, g.y + bob);
    ctx.globalAlpha = 0.6;
    ctx.shadowColor = "#00eeff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = GEM_CLR[Math.floor((frames * 0.1) % 4)];
    ctx.beginPath();
    ctx.moveTo(0, -GEM_R);
    ctx.lineTo(GEM_R * 0.7, 0);
    ctx.lineTo(0, GEM_R);
    ctx.lineTo(-GEM_R * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(-GEM_R * 0.2, -GEM_R * 0.6);
    ctx.lineTo(GEM_R * 0.2, -GEM_R * 0.2);
    ctx.lineTo(0, -GEM_R * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const pu of powerUps) {
    const bob = Math.sin(frames * 0.1) * 5;
    const pulse = 0.85 + 0.15 * Math.sin(frames * 0.18);
    ctx.save();
    ctx.translate(pu.x, pu.y + bob);
    ctx.globalAlpha = 0.3 * pulse;
    ctx.strokeStyle = PU_COLORS[pu.kind];
    ctx.lineWidth = 3;
    ctx.shadowColor = PU_COLORS[pu.kind];
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(0, 0, (PU_R + 6) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, PU_R + 2);
    pg.addColorStop(0, PU_COLORS[pu.kind] + "cc");
    pg.addColorStop(1, PU_COLORS[pu.kind] + "44");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, 0, PU_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = "13px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillText(PU_ICONS[pu.kind], 0, 1);
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════
   DRAW — BOSS + SHOTS + HP
══════════════════════════════════════════════════════════════ */
function drawBoss(ctx: CanvasRenderingContext2D, boss: Boss, frames: number) {
  if (!boss.active) return;

  if (boss.kind === "gal") {
    drawGalBoss(ctx, boss, frames);
    for (const s of boss.shots) drawShot(ctx, s, frames);
    drawBossHPBar(ctx, boss);
    return;
  }

  const { x, y, phase2, hitFlash } = boss;
  const shakeX = hitFlash > 0 ? (Math.random() - 0.5) * 5 : 0;

  ctx.save();
  ctx.translate(x + shakeX, y);

  if (phase2) {
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.12 * Math.sin(frames * 0.28);
    ctx.shadowColor = "#ff3300";
    ctx.shadowBlur = 36;
    ctx.fillStyle = "#ff2200";
    ctx.beginPath();
    ctx.ellipse(0, 8, 58, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const p2 = phase2;

  const tailColors = p2 ? ["#cc2200", "#ff4400", "#ff6600"] : ["#3344aa", "#4455cc", "#2233aa"];
  for (let t = 0; t < 5; t++) {
    const ta = -0.5 + t * 0.28;
    const tLen = 32 + (t === 2 ? 8 : 0);
    ctx.save();
    ctx.rotate(ta);
    ctx.fillStyle = tailColors[t % 3];
    ctx.beginPath();
    ctx.moveTo(28, -4);
    ctx.quadraticCurveTo(28 + tLen * 0.6, -8 + t * 3, 28 + tLen, -2 + t * 4);
    ctx.lineTo(28 + tLen - 4, 4 + t * 4);
    ctx.quadraticCurveTo(28 + tLen * 0.5, 2 + t * 3, 28, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const bodyG = ctx.createLinearGradient(-30, -24, 24, 24);
  bodyG.addColorStop(0, p2 ? "#cc3310" : "#4466dd");
  bodyG.addColorStop(0.5, p2 ? "#881100" : "#223388");
  bodyG.addColorStop(1, p2 ? "#550800" : "#112266");
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.bezierCurveTo(-30, -30, 20, -30, 24, -10);
  ctx.bezierCurveTo(28, 4, 20, 28, -8, 26);
  ctx.bezierCurveTo(-22, 24, -28, 14, -24, 0);
  ctx.fill();

  const wFlap = Math.sin(frames * 0.3) * 8;
  ctx.fillStyle = p2 ? "#aa1100" : "#334db3";
  ctx.beginPath();
  ctx.moveTo(2, -18);
  ctx.quadraticCurveTo(20, -32 + wFlap, 22, -18);
  ctx.quadraticCurveTo(16, -10, 2, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(4, -16);
  ctx.quadraticCurveTo(16, -28 + wFlap, 18, -16);
  ctx.quadraticCurveTo(12, -10, 4, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = p2 ? "#cc3310" : "#3a55bb";
  ctx.beginPath();
  ctx.ellipse(-20, -10, 10, 16, 0.3, 0, Math.PI * 2);
  ctx.fill();

  const headG = ctx.createRadialGradient(-24, -28, 3, -22, -26, 18);
  headG.addColorStop(0, p2 ? "#dd4422" : "#5577ee");
  headG.addColorStop(1, p2 ? "#991100" : "#223399");
  ctx.fillStyle = headG;
  ctx.beginPath();
  ctx.ellipse(-22, -26, 16, 14, 0.15, 0, Math.PI * 2);
  ctx.fill();

  const crestC = p2 ? ["#ff4400", "#ff6600", "#ffaa00"] : ["#4466ff", "#6688ff", "#44ccff"];
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = crestC[c];
    ctx.beginPath();
    ctx.moveTo(-18 + c * 3, -36);
    ctx.quadraticCurveTo(-10 + c * 6, -52 - c * 6, 2 + c * 8, -44 - c * 4);
    ctx.quadraticCurveTo(-6 + c * 4, -40 - c * 3, -20 + c * 3, -30);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#f0f0e0";
  ctx.beginPath();
  ctx.ellipse(-27, -24, 7, 6, 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-28, -30, 7, 8, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = p2 ? "#ff4400" : "#ffaa00";
  ctx.beginPath();
  ctx.arc(-28, -30, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(-27, -30, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-25, -33, 1.5, 0, Math.PI * 2);
  ctx.fill();

  if (p2) {
    ctx.fillStyle = p2 ? "#aa1100" : "#334db3";
    ctx.beginPath();
    ctx.ellipse(-28, -34, 7, 4, -0.2, 0, Math.PI);
    ctx.fill();
  }

  ctx.fillStyle = "#e89a00";
  ctx.beginPath();
  ctx.moveTo(-32, -26);
  ctx.lineTo(-52, -22);
  ctx.lineTo(-46, -18);
  ctx.lineTo(-32, -22);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#b87000";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-32, -24);
  ctx.lineTo(-50, -22);
  ctx.stroke();

  if (p2) {
    ctx.fillStyle = "#cc2244";
    ctx.beginPath();
    ctx.moveTo(-46, -22);
    ctx.lineTo(-56, -18);
    ctx.lineTo(-52, -16);
    ctx.lineTo(-44, -19);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = 0.22 + 0.08 * Math.sin(frames * 0.2);
  ctx.strokeStyle = p2 ? "#ff8844" : "#88aaff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    const lx = 30 + i * 10,
      ly = -8 + i * 7;
    const len = 18 - i * 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + len, ly);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = p2 ? "#cc3300" : "#2233aa";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, 20);
  ctx.lineTo(-4, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 18);
  ctx.lineTo(8, 38);
  ctx.stroke();

  ctx.strokeStyle = p2 ? "#aa2200" : "#1a2288";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-4, 40);
  ctx.lineTo(-14, 46);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-4, 40);
  ctx.lineTo(2, 48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8, 38);
  ctx.lineTo(-2, 44);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8, 38);
  ctx.lineTo(16, 46);
  ctx.stroke();

  const spinA = frames * 0.45;
  for (const [wx, wy] of [
    [-6, 47],
    [10, 45],
  ] as [number, number][]) {
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = "#aaaaaa";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 8, 4, spinA, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(wx, wy, 8, 4, spinA + Math.PI / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  if (Math.floor(frames / 40) % 4 === 0) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    rrect(ctx, -50, -52, 80, 20, 6);
    ctx.fill();
    ctx.fillStyle = p2 ? "#cc0000" : "#2244bb";
    ctx.font = `bold 11px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(p2 ? "MEEP MEEP!" : "Beep Beep!", -10, -36);
    ctx.restore();
  }

  ctx.restore();

  for (const s of boss.shots) drawShot(ctx, s, frames);
  drawBossHPBar(ctx, boss);
}

function drawGalBoss(ctx: CanvasRenderingContext2D, boss: Boss, frames: number) {
  const { x, y, phase2, hitFlash } = boss;
  const shakeX = hitFlash > 0 ? (Math.random() - 0.5) * 6 : 0;
  const pulse = 0.78 + 0.22 * Math.sin(frames * 0.22);

  ctx.save();
  ctx.translate(x + shakeX, y);

  ctx.save();
  ctx.globalAlpha = (phase2 ? 0.28 : 0.18) * pulse;
  ctx.shadowColor = phase2 ? "#ff2244" : "#5ee9ff";
  ctx.shadowBlur = phase2 ? 38 : 30;
  ctx.fillStyle = phase2 ? "#ff3355" : "#57d9ff";
  ctx.beginPath();
  ctx.ellipse(0, 8, phase2 ? 64 : 56, phase2 ? 56 : 48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const bodyG = ctx.createLinearGradient(-42, -10, 44, 56);
  bodyG.addColorStop(0, phase2 ? "#2b0b14" : "#151928");
  bodyG.addColorStop(1, phase2 ? "#120307" : "#05070d");
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(-38, 30);
  ctx.lineTo(-18, -8);
  ctx.quadraticCurveTo(0, -20, 18, -8);
  ctx.lineTo(38, 30);
  ctx.quadraticCurveTo(0, 52, -38, 30);
  ctx.closePath();
  ctx.fill();

  const hoodG = ctx.createRadialGradient(0, -22, 5, 0, -18, 42);
  hoodG.addColorStop(0, phase2 ? "#3a1620" : "#23293f");
  hoodG.addColorStop(1, phase2 ? "#120307" : "#070a12");
  ctx.fillStyle = hoodG;
  ctx.beginPath();
  ctx.ellipse(0, -14, 32, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.ellipse(0, -14, 18, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -14, 18, 21, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#101317";
  ctx.beginPath();
  ctx.ellipse(-7, -17, 3.2, 4.6, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(7, -17, 3.2, 4.6, 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1d1d1d";
  ctx.font = "bold 8px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("גל שיפרו", 0, -6);

  ctx.strokeStyle = phase2 ? "#ff5c7a" : "#8fc8ff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, 2);
  ctx.lineTo(-8, 16 + Math.sin(frames * 0.22) * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(5, 2);
  ctx.lineTo(8, 14 + Math.cos(frames * 0.2) * 2);
  ctx.stroke();

  ctx.strokeStyle = phase2 ? "#ff5570" : "#66f2ff";
  ctx.lineWidth = 3;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(22 * side, 8);
    ctx.lineTo(38 * side, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(38 * side, 20);
    ctx.lineTo(52 * side, 20 + side * 3);
    ctx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = phase2 ? "#ff8899" : "#8fe8ff";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const ox = -48 + i * 18;
    const oy = -40 + ((frames + i * 9) % 36);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + 6, oy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}

function drawShot(ctx: CanvasRenderingContext2D, s: BossShot, frames: number) {
  ctx.save();
  const sparkP = 0.75 + 0.25 * Math.sin(frames * 0.5 + s.x * 0.1);
  ctx.globalAlpha = sparkP;
  const sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
  sg.addColorStop(0, "#ffffff");
  sg.addColorStop(0.4, "#ffee44");
  sg.addColorStop(1, "rgba(255,100,0,0)");
  ctx.fillStyle = sg;
  ctx.shadowColor = "#ff8800";
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();

  const seed = Math.floor(frames / 3);
  ctx.strokeStyle = "#ffee44";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.45 * sparkP;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  let tx = s.x + 14,
    ty = s.y;
  for (let i = 0; i < 5; i++) {
    tx += 9;
    ty += (((seed * 7 + i * 13 + s.r * 3) % 11) - 5) * 1.6;
    ctx.lineTo(tx, ty);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBossHPBar(ctx: CanvasRenderingContext2D, boss: Boss) {
  const bx = W / 2 - 90,
    by = 14,
    bw = 180,
    bh = 12,
    r = 5;
  const ratio = boss.hp / boss.maxHp;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  rrect(ctx, bx - 2, by - 2, bw + 4, bh + 4, r + 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  rrect(ctx, bx, by, bw, bh, r);
  ctx.fill();

  const barG = ctx.createLinearGradient(bx, 0, bx + bw * ratio, 0);
  barG.addColorStop(0, boss.phase2 ? "#ff2200" : "#ff6600");
  barG.addColorStop(1, boss.phase2 ? "#ff8800" : "#ffcc00");
  ctx.fillStyle = barG;
  rrect(ctx, bx, by, bw * ratio, bh, r);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 1;
  for (let i = 1; i < boss.maxHp; i++) {
    const sx = bx + bw * (i / boss.maxHp);
    ctx.beginPath();
    ctx.moveTo(sx, by);
    ctx.lineTo(sx, by + bh);
    ctx.stroke();
  }

  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(boss.kind === "gal" ? "GAL SHAPIRO" : "BOSS", W / 2, by + bh + 12);
}

/* ══════════════════════════════════════════════════════════════
   DRAW — HUD  (score watermark + active PU timers)
══════════════════════════════════════════════════════════════ */
function drawHud(ctx: CanvasRenderingContext2D, w: World) {
  if (w.phase !== "playing") return;

  if (w.score > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px Georgia,serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8;
    ctx.fillText(String(w.score), W / 2, 54);
    ctx.restore();
  }

  let puY = 80;
  if (w.shieldHits > 0) {
    drawPuTimer(ctx, 14, puY, "🛡", "#44aaff", w.shieldHits / PU_SHIELD_HITS);
    puY += 28;
  }
  if (w.doubleFrames > 0) {
    drawPuTimer(ctx, 14, puY, "⚡", "#ffd700", w.doubleFrames / PU_DBL_F);
    puY += 28;
  }
}

function drawPuTimer(ctx: CanvasRenderingContext2D, x: number, y: number, icon: string, color: string, ratio: number) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "14px serif";
  ctx.fillText(icon, x, y + 4);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(x + 20, y - 6, 64, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x + 20, y - 6, 64 * ratio, 8);
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   DRAW — OVERLAYS
══════════════════════════════════════════════════════════════ */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function getMedal(score: number): { label: string; color: string } | null {
  if (score >= 75) return { label: "🏆 LEGENDARY", color: "#c8e8ff" };
  if (score >= 50) return { label: "🏆 PLATINUM", color: "#d0d8f8" };
  if (score >= 20) return { label: "🥇 GOLD", color: "#ffd700" };
  if (score >= 10) return { label: "🥈 SILVER", color: "#c8d8e8" };
  if (score >= 5) return { label: "🥉 BRONZE", color: "#cd8c52" };
  return null;
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: World, best: number) {
  if (w.phase === "ready") {
    ctx.save();
    ctx.fillStyle = "rgba(8,5,20,0.74)";
    rrect(ctx, W / 2 - 145, H / 2 - 78, 290, 156, 24);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5d78e";
    ctx.font = "bold 28px Georgia,serif";
    ctx.shadowColor = "rgba(245,166,35,0.6)";
    ctx.shadowBlur = 16;
    ctx.fillText("🐺  Coyote Flapy", W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,212,148,0.85)";
    ctx.font = "15px Georgia,serif";
    ctx.fillText("Tap · Space · ↑ to begin", W / 2, H / 2 + 8);
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.font = "12px system-ui,sans-serif";
    ctx.fillText("Collect 🛡⚡ for power-ups  ·  💎 for gems", W / 2, H / 2 + 36);
    if (best > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillText(`Best: ${best}`, W / 2, H / 2 + 58);
    }
    ctx.restore();
    return;
  }

  if (w.phase === "paused") {
    ctx.save();
    ctx.fillStyle = "rgba(8,5,20,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5d78e";
    ctx.font = "bold 30px Georgia,serif";
    ctx.fillText("⏸  PAUSED", W / 2, H / 2 - 10);
    ctx.fillStyle = "rgba(255,212,148,0.7)";
    ctx.font = "15px Georgia,serif";
    ctx.fillText("P or tap to resume", W / 2, H / 2 + 28);
    ctx.restore();
    return;
  }

  if (w.phase === "countdown") {
    const seconds = Math.max(1, Math.ceil(w.resumeCountdownFrames / 60));
    ctx.save();
    ctx.fillStyle = "rgba(8,5,20,0.58)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd78e";
    ctx.font = "bold 22px Georgia,serif";
    ctx.fillText("Get Ready", W / 2, H / 2 - 34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 72px Georgia,serif";
    ctx.shadowColor = "rgba(255,220,140,0.7)";
    ctx.shadowBlur = 16;
    ctx.fillText(String(seconds), W / 2, H / 2 + 28);
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  if (w.phase === "dead") {
    ctx.save();
    ctx.fillStyle = "rgba(8,5,20,0.80)";
    rrect(ctx, W / 2 - 152, H / 2 - 108, 304, 216, 26);
    ctx.fill();
    ctx.textAlign = "center";

    ctx.fillStyle = "#ff6b35";
    ctx.font = "bold 27px Georgia,serif";
    ctx.shadowColor = "rgba(255,80,20,0.6)";
    ctx.shadowBlur = 14;
    ctx.fillText("WILE E. CRASHED!", W / 2, H / 2 - 64);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#fff";
    ctx.font = "22px Georgia,serif";
    ctx.fillText(`Score:  ${w.score}`, W / 2, H / 2 - 24);

    const m = getMedal(w.score);
    if (m) {
      ctx.fillStyle = m.color;
      ctx.font = "bold 15px system-ui,sans-serif";
      ctx.fillText(m.label, W / 2, H / 2 + 6);
    }

    if (w.newBest) {
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 14px system-ui,sans-serif";
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 10;
      ctx.fillText("✦  NEW RECORD  ✦", W / 2, H / 2 + 32);
      ctx.shadowBlur = 0;
    }

    const st = getStage(w.score);
    ctx.fillStyle = "rgba(255,200,130,0.45)";
    ctx.font = "12px system-ui,sans-serif";
    ctx.fillText(`Reached: ${st.name}`, W / 2, H / 2 + 54);

    ctx.fillStyle = "rgba(255,205,132,0.62)";
    ctx.font = "14px Georgia,serif";
    ctx.fillText("Tap anywhere to try again", W / 2, H / 2 + 88);
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════
   SCREEN FLASH
══════════════════════════════════════════════════════════════ */
function triggerFlash(flash: ScreenFlash, r: number, g: number, b: number, alpha: number) {
  if (alpha > flash.alpha) {
    flash.r = r;
    flash.g = g;
    flash.b = b;
  }
  flash.alpha = Math.max(flash.alpha, alpha);
}
function tickFlash(flash: ScreenFlash) {
  flash.alpha = Math.max(0, flash.alpha - 0.055);
}
function renderFlash(ctx: CanvasRenderingContext2D, flash: ScreenFlash) {
  if (flash.alpha < 0.015) return;
  ctx.save();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, H * 0.8);
  vg.addColorStop(0, `rgba(${flash.r},${flash.g},${flash.b},0)`);
  vg.addColorStop(1, `rgba(${flash.r},${flash.g},${flash.b},${flash.alpha.toFixed(3)})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════════════════ */
export default function CoyoteFlapyGame() {
  const initialUid = auth.currentUser?.uid ?? null;
  const initialBest = initialUid ? 0 : loadBest(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const worldRef = useRef<World>(mkWorld());
  const bestRef = useRef<number>(initialBest);
  const actionRef = useRef<(() => void) | null>(null);
  const pauseActionRef = useRef<(() => void) | null>(null);
  const activeUidRef = useRef<string | null>(initialUid);
  const bestSyncReadyRef = useRef(initialUid === null);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);

  const [displayScore, setDisplayScore] = useState(0);
  const [displayBest, setDisplayBest] = useState(bestRef.current);
  const [phase, setPhase] = useState<Phase>("ready");
  const [newBest, setNewBest] = useState(false);
  const [mode, setMode] = useState<"normal" | "boss">("normal");
  const [activeUid, setActiveUid] = useState<string | null>(activeUidRef.current);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [dbBestScore, setDbBestScore] = useState<number | null>(initialUid ? null : initialBest);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      activeUidRef.current = uid;
      setActiveUid(uid);
      bestSyncReadyRef.current = uid === null;
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSubmitInFlightRef.current = false;
      if (uid) {
        bestRef.current = 0;
        setDisplayBest(0);
        setDbBestScore(null);
      } else {
        const guestBest = loadBest(null);
        bestRef.current = guestBest;
        setDisplayBest(guestBest);
        setDbBestScore(guestBest);
      }
    });
  }, []);

  useEffect(() => {
    const scoresRef = collection(db, "scores", "coyote-flapy", "users");
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown };
            return { uid: entry.id, score: normalizeScore(data?.score) };
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        setLeaderboardRows(rows);
      },
      (err) => console.warn("coyote leaderboard listener failed:", err)
    );
  }, []);

  useEffect(() => {
    if (!activeUid) {
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSyncReadyRef.current = true;
      return undefined;
    }

    const scoreRef = doc(db, "scores", "coyote-flapy", "users", activeUid);
    return onSnapshot(
      scoreRef,
      (snap) => {
        const dbBest = snap.exists() ? normalizeScore((snap.data() as { score?: unknown })?.score) : 0;
        bestSyncReadyRef.current = true;
        setDbBestScore(dbBest);
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, dbBest);
        if (pendingBestScoreRef.current <= dbBest) pendingBestScoreRef.current = 0;
        bestRef.current = dbBest;
        saveBest(activeUidRef.current, dbBest);
        setDisplayBest(dbBest);
      },
      (err) => console.warn("coyote best score listener failed:", err)
    );
  }, [activeUid]);

  useEffect(() => {
    const uid = activeUidRef.current;
    const best = normalizeScore(bestRef.current);
    if (!bestSyncReadyRef.current) return;
    if (!uid || best <= 0) return;
    if (best <= submittedBestScoreRef.current && best <= pendingBestScoreRef.current) return;

    pendingBestScoreRef.current = Math.max(pendingBestScoreRef.current, best);

    function flushBestScoreUpdate() {
      const targetUid = activeUidRef.current;
      if (!targetUid) {
        pendingBestScoreRef.current = 0;
        return;
      }
      if (bestSubmitInFlightRef.current) return;

      const targetScore = pendingBestScoreRef.current;
      if (targetScore <= submittedBestScoreRef.current) {
        pendingBestScoreRef.current = 0;
        return;
      }

      bestSubmitInFlightRef.current = true;
      submitCoyoteFlapyScore(targetUid, targetScore)
        .then(() => {
          submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, targetScore);
          if (pendingBestScoreRef.current <= targetScore) pendingBestScoreRef.current = 0;
        })
        .catch((err) => console.warn("coyote best score update failed:", err))
        .finally(() => {
          bestSubmitInFlightRef.current = false;
          if (pendingBestScoreRef.current > submittedBestScoreRef.current) flushBestScoreUpdate();
        });
    }

    flushBestScoreUpdate();
  }, [displayBest, activeUid]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let autosaveCounter = 0;

    function persistSnapshot() {
      try {
        const w = worldRef.current;
        const payload: SavedGame = { v: 1, world: w, best: bestRef.current };
        localStorage.setItem(getSaveStorageKey(activeUidRef.current), JSON.stringify(payload));
      } catch {}
    }

    const saved = loadSavedGame(activeUidRef.current);
    if (saved) {
      const restored = hydrateWorld(saved.world);
      worldRef.current = restored;
      if (!activeUidRef.current) bestRef.current = Math.max(bestRef.current, saved.best || 0);
      setDisplayScore(restored.score);
      setDisplayBest(bestRef.current);
      setNewBest(restored.newBest);
      setPhase(restored.phase);
      setMode(restored.mode);
    }

    function action() {
      const w = worldRef.current;
      if (w.phase === "dead") {
        parts = [];
        floats = [];
        worldRef.current = mkWorld();
        clearSavedGame(activeUidRef.current);
        setDisplayScore(0);
        setNewBest(false);
        setPhase("ready");
        setMode("normal");
        return;
      }
      if (w.phase === "paused") {
        w.phase = "countdown";
        w.resumeCountdownFrames = RESUME_COUNTDOWN_F;
        setPhase("countdown");
        persistSnapshot();
        return;
      }
      if (w.phase === "countdown") return;
      if (w.phase === "ready") {
        w.phase = "playing";
        setPhase("playing");
        persistSnapshot();
      }
      if (w.phase === "playing") {
        const damp = w.sinceFlap < FLAP_DAMP ? 0.55 + (w.sinceFlap / FLAP_DAMP) * 0.45 : 1;
        w.vel = FLAP_VEL * damp;
        w.sinceFlap = 0;
        w.scaleX = 0.7;
        w.scaleY = 1.38;
        addFlapDust(CX, w.cy);
      }
    }
    actionRef.current = action;

    function togglePauseState() {
      const w = worldRef.current;
      if (w.phase === "playing") {
        w.phase = "paused";
        setPhase("paused");
        persistSnapshot();
        return;
      }
      if (w.phase === "paused") {
        w.phase = "countdown";
        w.resumeCountdownFrames = RESUME_COUNTDOWN_F;
        setPhase("countdown");
        persistSnapshot();
        return;
      }
      if (w.phase === "countdown") {
        w.phase = "paused";
        setPhase("paused");
        persistSnapshot();
      }
    }
    pauseActionRef.current = togglePauseState;

    function activateBoss(w: World, kind: BossKind, banner: string) {
      w.graceFrames = 0;
      w.pipes = [];
      w.gems = [];
      w.powerUps = [];
      w.preBossKind = null;
      w.preBossFrames = 0;
      w.boss = mkBoss(kind);
      w.boss.active = true;
      w.boss.defeated = false;
      w.mode = "boss";
      setMode("boss");
      addFloat(W / 2, H / 2 - 110, banner, "#ffd700", 28, true);
      triggerFlash(w.flash, 255, 215, 0, 0.55);
    }

    function launchBossNow() {
      const w = worldRef.current;
      if (w.phase === "dead") return;

      if (w.phase === "ready" || w.phase === "paused" || w.phase === "countdown") {
        w.phase = "playing";
        w.resumeCountdownFrames = 0;
        setPhase("playing");
      }

      if (w.mode === "boss" && w.boss.active && w.boss.kind === "runner") return;

      w.scoreDisabled = true; // ✅ disable score counting after warp
      w.score = Math.max(w.score, BOSS_AT);
      setDisplayScore(w.score);

      w.boss1Defeated = false;
      w.boss2Defeated = false;
      activateBoss(w, "runner", "⚡ BOSS WARP! ⚡");
      persistSnapshot();
    }

    function launchGalBossNow() {
      const w = worldRef.current;
      if (w.phase === "dead") return;

      if (w.phase === "ready" || w.phase === "paused" || w.phase === "countdown") {
        w.phase = "playing";
        w.resumeCountdownFrames = 0;
        setPhase("playing");
      }

      if (w.mode === "boss" && w.boss.active && w.boss.kind === "gal") return;

      w.scoreDisabled = true; // ✅ disable score counting after warp
      w.score = Math.max(w.score, BOSS2_AT);
      setDisplayScore(w.score);

      w.boss1Defeated = true;
      w.boss2Defeated = false;
      activateBoss(w, "gal", "☠ GAL SHAPIRO WARP ☠");
      persistSnapshot();
    }

    function onKey(e: KeyboardEvent) {
      if (e.code === "Digit1" || e.code === "Numpad1" || e.key === "1") {
        e.preventDefault();
        launchGalBossNow();
        return;
      }
      if (e.code === "Semicolon" || e.key === ";") {
        e.preventDefault();
        launchBossNow();
        return;
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        togglePauseState();
        return;
      }
      if (e.code !== "Space" && e.code !== "ArrowUp") return;
      e.preventDefault();
      actionRef.current?.();
    }
    window.addEventListener("keydown", onKey, { passive: false });
    window.addEventListener("beforeunload", persistSnapshot);

    function die(w: World) {
      if (w.phase === "dead") return;
      w.phase = "dead";
      w.deathFrames = 0;
      w.graceFrames = 0;
      if (w.vel > -2) w.vel = -2;
      addDeathBurst(CX, w.cy);
      triggerFlash(w.flash, 255, 40, 10, 0.55);

      // ✅ don't allow warp-cheat to update best
      if (!w.scoreDisabled && w.score > bestRef.current) {
        bestRef.current = w.score;
        saveBest(activeUidRef.current, w.score);
        w.newBest = true;
        setDisplayBest(w.score);
        setNewBest(true);
      }

      setPhase("dead");
      persistSnapshot();
    }

    function collectPU(w: World, pu: PowerUp) {
      switch (pu.kind) {
        case "shield":
          w.shieldHits = PU_SHIELD_HITS;
          triggerFlash(w.flash, 68, 170, 255, 0.6);
          break;
        case "double":
          w.doubleFrames = PU_DBL_F;
          triggerFlash(w.flash, 255, 215, 0, 0.6);
          break;
      }
      addFloat(CX, w.cy - 40, `${PU_ICONS[pu.kind]} ${pu.kind.toUpperCase()}!`, PU_COLORS[pu.kind], 20, true);
      addParts(pu.x, pu.y, 15, [PU_COLORS[pu.kind], "#ffffff"], 4, 2, 2, 5);
    }

    function step() {
      const w = worldRef.current;

      w.scaleX += (1 - w.scaleX) * 0.2;
      w.scaleY += (1 - w.scaleY) * 0.2;

      tickFlash(w.flash);

      if (w.phase === "paused") return;

      if (w.phase === "countdown") {
        if (w.resumeCountdownFrames > 0) w.resumeCountdownFrames--;
        if (w.resumeCountdownFrames <= 0) {
          w.resumeCountdownFrames = 0;
          w.phase = "playing";
          setPhase("playing");
          persistSnapshot();
        }
        return;
      }

      if (w.phase === "playing") {
        w.frames++;
        w.sinceFlap++;

        if (w.doubleFrames > 0) w.doubleFrames--;
        if (w.invulnFrames > 0) w.invulnFrames--;

        const sf = 1;

        const g = w.vel < 0 ? G_UP : G_DOWN;
        w.vel += g * sf;
        if (w.vel > TERM_VEL) w.vel = TERM_VEL;
        w.prevCy = w.cy;
        w.cy += w.vel * sf;

        w.prevTilt = w.tilt;
        const targetTilt = Math.max(-0.52, Math.min(0.75, w.vel / 9.5));
        w.tilt += (targetTilt - w.tilt) * 0.16;

        w.trail.unshift({ cy: w.cy, tilt: w.tilt, alpha: 1 });
        if (w.trail.length > 8) w.trail.pop();
        for (let i = 0; i < w.trail.length; i++) w.trail[i].alpha = (1 - i / w.trail.length) * 0.7;

        const spd = getSpeed(w.score);
        const gap = getGap(w.score);
        w.speed = lerp(w.speed, spd, 0.02);

        w.prevGroundOff = w.groundOff;
        w.groundOff += w.speed * sf;

        if (w.preBossFrames > 0) {
          w.preBossFrames--;
          if (w.preBossFrames <= 0 && w.preBossKind) {
            activateBoss(w, w.preBossKind, w.preBossKind === "gal" ? "☠ GAL SHAPIRO INCOMING! ☠" : "⚡ BOSS INCOMING! ⚡");
          }
        }

        if (w.mode === "normal") {
          const candidateBossKind: BossKind | null =
            w.boss.active || w.preBossKind
              ? null
              : !w.boss1Defeated && w.score >= BOSS_AT
              ? "runner"
              : w.boss1Defeated && !w.boss2Defeated && w.score >= BOSS2_AT
              ? "gal"
              : null;
          const pendingBossKind: BossKind | null = w.preBossKind ?? candidateBossKind;

          if (!pendingBossKind) {
            w.spawnTimer--;
            if (w.spawnTimer <= 0) {
              w.pipes.push(mkPipe(W + 18, gap, w.score));
              w.spawnTimer = getSpawnF(w.score);

              if (Math.random() < GEM_CHANCE) {
                const lastP = w.pipes[w.pipes.length - 1];
                w.gems.push({
                  x: lastP.x + PIPE_W / 2 + 60 + Math.random() * 80,
                  y: lastP.gapY + (Math.random() - 0.5) * 40,
                  taken: false,
                  bobPhase: Math.random() * Math.PI * 2,
                });
              }

              w.pipesPassedSinceLastPU++;
              if (w.pipesPassedSinceLastPU >= PU_SPAWN_EVERY) {
                w.pipesPassedSinceLastPU = 0;
                const kind: PUType = Math.random() < SHIELD_SPAWN_CHANCE ? "shield" : "double";
                const lastP2 = w.pipes[w.pipes.length - 1];
                w.powerUps.push({
                  x: lastP2.x + 80 + Math.random() * 60,
                  y: lastP2.gapY + (Math.random() - 0.5) * 60,
                  kind,
                  life: 1,
                });
              }
            }
          }

          w.pipes = w.pipes.filter((p) => p.x + PIPE_W > -40);
          let inZone = false,
            hitPipe = false;

          for (const p of w.pipes) {
            p.x -= w.speed * sf;
            p.movePhase += p.moveSpeed * sf;
            p.gapY = p.baseGapY + Math.sin(p.movePhase) * p.moveAmp;

            if (!p.scored && p.x + PIPE_W < CX - HIT_R) {
              p.scored = true;
              w.pipesTotal++;

              // ✅ score counting disabled after warp
              if (!w.scoreDisabled) {
                const gain = w.doubleFrames > 0 ? 2 : 1;
                w.score += gain;
                setDisplayScore(w.score);
                addFloat(CX + 24, w.cy - 28, `+${gain}`, gain > 1 ? "#ffd700" : "#f5c97a", gain > 1 ? 22 : 18);

                if (w.pipesTotal % 5 === 0) {
                  triggerFlash(w.flash, 255, 200, 30, 0.55);
                  addParts(CX, w.cy, 18, ["#ffd700", "#fff0a0", "#ffaa00", "#ffffff"], 6, 3, 2, 6);
                  addFloat(W / 2, H / 2 - 70, `${w.pipesTotal} PIPES!`, "#ffd700", 26, true);
                }

                const topClear = w.cy - HIT_R - (p.gapY - p.gap / 2);
                const botClear = p.gapY + p.gap / 2 - (w.cy + HIT_R);
                if (!p.nearMissed && Math.min(topClear, botClear) <= NEAR_MISS_D) {
                  p.nearMissed = true;
                  w.score += 1;
                  setDisplayScore(w.score);
                  triggerFlash(w.flash, 80, 255, 120, 0.4);
                  addFloat(CX + 32, w.cy - 52, "NEAR MISS! +1", "#9fffb0", 15);
                }

                for (const ms of MILESTONES) {
                  if (w.score >= ms && ms > w.lastMilestone) {
                    w.lastMilestone = ms;
                    addFloat(W / 2, H / 2 - 100, `★ ${ms} ★`, "#ffd700", 32, true);
                    triggerFlash(w.flash, 255, 215, 0, 0.7);
                    addParts(W / 2, H / 2, 24, ["#ffd700", "#fff0a0", "#ffaa00", "#ff8800"], 8, 4, 2, 7);
                  }
                }
              }

              w.graceFrames = 0;
            }

            const pL = p.x - PIPE_RIM,
              pR = p.x + PIPE_W + PIPE_RIM;
            if (CX + HIT_R > pL && CX - HIT_R < pR) {
              inZone = true;
              const gTop = p.gapY - p.gap / 2 + GAP_PAD;
              const gBot = p.gapY + p.gap / 2 - GAP_PAD;
              if (!(w.cy - HIT_R > gTop && w.cy + HIT_R < gBot)) hitPipe = true;
            }
          }

          if (!inZone) w.graceFrames = 0;
          else if (hitPipe) {
            w.graceFrames++;
            if (w.graceFrames >= GRACE_F) {
              if (w.invulnFrames > 0) {
                w.graceFrames = 0;
              } else if (w.shieldHits > 0) {
                w.shieldHits--;
                w.invulnFrames = SHIELD_IFRAMES;
                w.graceFrames = 0;
                triggerFlash(w.flash, 68, 170, 255, 0.65);
                addFloat(CX, w.cy - 40, "SHIELD!", "#44aaff", 22, true);
              } else die(w);
            }
          } else w.graceFrames = 0;

          for (const g of w.gems) {
            if (g.taken) continue;
            g.x -= w.speed * sf;
            const dx = g.x - CX,
              dy = g.y - w.cy;
            if (dx * dx + dy * dy < (HIT_R + GEM_R) * (HIT_R + GEM_R)) {
              g.taken = true;
              addGemCollect(g.x, g.y);

              // ✅ score disabled after warp
              if (!w.scoreDisabled) {
                w.score += GEM_VALUE;
                setDisplayScore(w.score);
                addFloat(g.x, g.y - 20, `+${GEM_VALUE}`, "#00eeff", 18);
                triggerFlash(w.flash, 0, 220, 255, 0.45);
              }
            }
          }
          w.gems = w.gems.filter((g) => !g.taken && g.x > -GEM_R * 2);

          for (const pu of w.powerUps) {
            pu.x -= w.speed * sf;
            const dx = pu.x - CX,
              dy = pu.y - w.cy;
            if (dx * dx + dy * dy < (HIT_R + PU_R + 4) * (HIT_R + PU_R + 4)) {
              collectPU(w, pu);
              pu.life = 0;
            }
          }
          w.powerUps = w.powerUps.filter((p) => p.life > 0 && p.x > -PU_R * 2);

          if (candidateBossKind && w.pipes.length === 0) {
            if (candidateBossKind === "gal") {
              w.preBossKind = "gal";
              w.preBossFrames = 90;
              addFloat(W / 2, H / 2 - 120, "אוי לא זה גל שפירו!", "#ff9fb5", 34, true);
              triggerFlash(w.flash, 255, 70, 120, 0.55);
            } else {
              activateBoss(w, "runner", "⚡ BOSS INCOMING! ⚡");
            }
          }
        }

        if (w.mode === "boss" && w.boss.active) {
          const b = w.boss;
          const isGalBoss = b.kind === "gal";
          b.hitFlash = Math.max(0, b.hitFlash - 1);

          if (b.introF > 0) {
            const introTargetX = W - (isGalBoss ? 84 : 90);
            b.x += (introTargetX - b.x) * (isGalBoss ? 0.09 : 0.07);
            b.introF--;
          } else {
            const targetX = W - (isGalBoss ? 84 : 90);
            b.x += (targetX - b.x) * (isGalBoss ? 0.055 : 0.04);
            b.y += (b.targetY - b.y) * (isGalBoss ? 0.048 : 0.035);
            if (Math.abs(b.y - b.targetY) < 8) {
              const minY = 80;
              const maxY = isGalBoss ? 300 : H - GH - 70;
              b.targetY = minY + Math.random() * Math.max(10, maxY - minY);
            }
            b.shotCD -= sf;
            if (b.shotCD <= 0) {
              const toY = (w.cy - b.y) * (isGalBoss ? 0.033 : 0.025);
              const maxVy = b.phase2 ? (isGalBoss ? 3.8 : 3.2) : isGalBoss ? 2.8 : 2.2;
              const vy = Math.max(-maxVy, Math.min(maxVy, toY + (Math.random() - 0.5)));
              const sx = b.x - (isGalBoss ? 92 : 90);
              const sy = b.y + (Math.random() - 0.5) * (isGalBoss ? 36 : 28);
              const shots = b.phase2 ? (isGalBoss ? 4 : 3) : isGalBoss ? 2 : 1;
              for (let i = 0; i < shots; i++) {
                const spread = (i - (shots - 1) / 2) * (isGalBoss ? 12 : 10);
                b.shots.push({
                  x: sx,
                  y: sy + spread,
                  vx: BOSS_SHOT_VX - (b.phase2 ? (isGalBoss ? 1.2 : 0.8) : isGalBoss ? 0.6 : 0),
                  vy: vy + (Math.random() - 0.5) * 0.5,
                  r: BOSS_SHOT_R,
                  spark: 0,
                });
              }
              const cdBase = isGalBoss ? Math.max(BOSS_SHOT_CD_MIN, BOSS_SHOT_CD_BASE - 10) : BOSS_SHOT_CD_BASE;
              const cdMin = isGalBoss ? Math.max(16, BOSS_SHOT_CD_MIN - 6) : BOSS_SHOT_CD_MIN;
              b.shotCD = b.phase2 ? cdMin + Math.random() * (cdBase - cdMin) * 0.6 : cdMin + Math.random() * (cdBase - cdMin);
            }
          }

          const nextShots: BossShot[] = [];
          for (const s of b.shots) {
            s.x += s.vx * sf;
            s.y += s.vy * sf;
            const dx = s.x - CX,
              dy = s.y - w.cy;
            const hitD = HIT_R + s.r;

            if (dx * dx + dy * dy <= hitD * hitD) {
              if (w.invulnFrames > 0) {
                addSpark(CX, w.cy);
                continue;
              }
              if (w.shieldHits > 0) {
                w.shieldHits--;
                b.hp--;
                w.invulnFrames = SHIELD_IFRAMES;
                b.hitFlash = 8;
                addSpark(CX, w.cy);
                triggerFlash(w.flash, 68, 170, 255, 0.35);
                addFloat(CX, w.cy - 40, "DEFLECTED!", "#44aaff", 18, true);
              } else {
                die(w);
              }
              continue;
            }

            if (s.x < -40 || s.y < -40 || s.y > H + 40) {
              // ✅ score disabled after warp
              if (!w.scoreDisabled) {
                w.score++;
                setDisplayScore(w.score);
                addFloat(CX + 30, w.cy - 35, "DODGE +1", "#ffe094", 16);
              } else {
                addFloat(CX + 30, w.cy - 35, "DODGE", "#ffe094", 16);
              }

              b.hp--;
              b.hitFlash = 6;
              addSpark(s.x < -40 ? -10 : s.x, s.y);
              triggerFlash(w.flash, 255, 220, 80, 0.1);

              if (b.hp <= 0) {
                b.active = false;
                b.defeated = true;
                b.shots = [];
                w.mode = "normal";
                if (isGalBoss) w.boss2Defeated = true;
                else w.boss1Defeated = true;
                addDeathBurst(b.x, b.y);
                addFloat(W / 2, H / 2 - 130, isGalBoss ? "GAL SHAPIRO DEFEATED! ★" : "BOSS DEFEATED! ★", "#ffd700", 36, true);
                triggerFlash(w.flash, 255, 215, 0, 0.6);
                setMode("normal");
              }
              continue;
            }

            nextShots.push(s);
          }
          b.shots = nextShots;

          if (b.hp <= b.maxHp / 2 && !b.phase2) {
            b.phase2 = true;
            addFloat(W / 2, H / 2 - 80, isGalBoss ? "GAL PHASE 2!" : "PHASE 2!", "#ff3300", 30, true);
            triggerFlash(w.flash, 255, 50, 0, 0.4);
          }
        }

        if (w.cy + HIT_R >= H - GH) {
          w.cy = H - GH - HIT_R;
          die(w);
        }
        if (w.cy - HIT_R <= 0) {
          w.cy = HIT_R;
          die(w);
        }
      }

      if (w.phase === "dead") {
        w.deathFrames++;
        w.prevGroundOff = w.groundOff;
        w.groundOff += 1.4;
        w.prevTilt = w.tilt;
        w.tilt += 0.075;
        w.vel += G_DOWN;
        if (w.vel > TERM_VEL) w.vel = TERM_VEL;
        w.prevCy = w.cy;
        w.cy += w.vel;
        if (w.cy + HIT_R > H - GH) {
          w.cy = H - GH - HIT_R;
          w.vel = 0;
        }
      }

      if (w.phase === "playing") {
        autosaveCounter++;
        if (autosaveCounter >= 30) {
          autosaveCounter = 0;
          persistSnapshot();
        }
      }

      tickParts(1);
      tickFloats();
    }

    let lastTs = performance.now(),
      acc = 0;

    function loop(ts: number) {
      const delta = Math.min(MAX_DELTA, ts - lastTs);
      lastTs = ts;
      acc += delta;
      let iters = 0;
      while (acc >= FIXED_MS && iters < 8) {
        step();
        acc -= FIXED_MS;
        iters++;
      }

      const w = worldRef.current;
      const alpha = Math.max(0, Math.min(1, acc / FIXED_MS));
      const renderCy = lerp(w.prevCy, w.cy, alpha);
      const renderTilt = lerp(w.prevTilt, w.tilt, alpha);
      const renderGround = lerp(w.prevGroundOff, w.groundOff, alpha);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      drawBg(ctx, w.frames + alpha, w.score);

      ctx.save();
      drawPipes(ctx, w.pipes);
      drawCollectibles(ctx, w.powerUps, w.gems, w.frames);
      drawBoss(ctx, w.boss, w.frames);
      drawGround(ctx, renderGround);
      renderParts(ctx);
      drawTrail(ctx, w.trail);
      drawCoyote(ctx, w, renderCy, renderTilt);
      renderFloats(ctx);
      drawHud(ctx, w);
      drawOverlay(ctx, w, bestRef.current);
      renderFlash(ctx, w.flash);
      ctx.restore();

      rafRef.current = requestAnimationFrame(loop);
    }

    loop(lastTs);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", persistSnapshot);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const hint =
    phase === "ready"
      ? "Space · ↑ · tap to begin  •  1: Gal Boss"
      : phase === "playing"
      ? "Space · ↑ · tap to flap  •  P pause  •  1 Gal Boss"
      : phase === "countdown"
      ? "Resuming in 3..2..1"
      : phase === "paused"
      ? "Paused  •  P or tap to resume"
      : "Tap anywhere to restart";

  const shownBest = Math.max(displayBest, dbBestScore ?? 0);
  const topLeaderboardRows = leaderboardRows.slice(0, 6);
  const podiumSlots = [
    { rank: 2, row: leaderboardRows[1] ?? null, tone: "silver" as const, height: 92 },
    { rank: 1, row: leaderboardRows[0] ?? null, tone: "gold" as const, height: 124 },
    { rank: 3, row: leaderboardRows[2] ?? null, tone: "bronze" as const, height: 78 },
  ];

  return (
    <main className="cfp-page">
      <div className="cfp-layout">
        <section
          className="cfp-card"
          onPointerDown={(e) => {
            if (!e.isPrimary) return;
            e.preventDefault();
            actionRef.current?.();
          }}
          onContextMenu={(e) => e.preventDefault()}
          role="button"
          tabIndex={0}
          aria-label="Coyote Flapy game"
        >
          <header className="cfp-header">
            <div className="cfp-title-row">
              <span className="cfp-title">🐺 Coyote Flapy</span>
              {(phase === "playing" || phase === "paused" || phase === "countdown") && (
                <button
                  type="button"
                  className={`cfp-pause-btn${phase === "paused" ? " is-paused" : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    pauseActionRef.current?.();
                  }}
                  aria-label={phase === "paused" ? "Resume" : "Pause"}
                >
                  {phase === "paused" ? "▶ RESUME" : "⏸ PAUSE"}
                </button>
              )}
            </div>
            <div className="cfp-hint">{hint}</div>
          </header>

          <canvas ref={canvasRef} width={W} height={H} className="cfp-canvas" />

          <footer className="cfp-footer">
            <div className={`cfp-stat${phase === "playing" ? " cfp-stat--active" : ""}`}>
              <span className="cfp-stat-label">SCORE</span>
              <span className="cfp-stat-value">{displayScore}</span>
            </div>
            <div className={`cfp-stat${newBest && phase === "dead" ? " cfp-stat--best" : ""}`}>
              <span className="cfp-stat-label">BEST</span>
              <span className="cfp-stat-value">{shownBest}</span>
            </div>
            <div className={`cfp-stat cfp-stat--stage${mode === "boss" ? " cfp-stat--boss" : ""}`}>
              <span className="cfp-stat-label">{mode === "boss" ? "MODE" : "STAGE"}</span>
              <span className="cfp-stat-value cfp-stat-value--sm">{mode === "boss" ? "BOSS" : getStage(displayScore).name}</span>
            </div>
          </footer>
        </section>

        <aside className="cfp-leaderboard" aria-label="Coyote Flapy leaderboard">
          <div className="cfp-leaderboard-head">
            <h2>Leaderboard</h2>
            <span className="cfp-leaderboard-badge">Best score</span>
          </div>
          <div className="cfp-leaderboard-best">
            <span>Your Best</span>
            <strong>{shownBest.toLocaleString()}</strong>
          </div>
          <div className="cfp-leaderboard-list">
            {topLeaderboardRows.length === 0 ? (
              <p className="cfp-leaderboard-empty">No scores yet. Play to claim rank #1.</p>
            ) : (
              topLeaderboardRows.map((row, index) => (
                <div key={`${row.uid}-${index}`} className={`cfp-leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}>
                  <span className="cfp-leaderboard-rank">{index + 1}</span>
                  <div className="cfp-leaderboard-user">
                    <UserBox userId={row.uid} />
                  </div>
                  <strong className="cfp-leaderboard-score">{row.score.toLocaleString()}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <section className="cfp-podium-shell" aria-label="Coyote Flapy podium">
        <div className="cfp-podium-head">
          <h2>Podium</h2>
          <span>All-time top 3</span>
        </div>
        {leaderboardRows.length === 0 ? (
          <p className="cfp-podium-empty">No podium scores yet.</p>
        ) : (
          <div className="cfp-podium">
            {podiumSlots.map((slot) => (
              <article key={slot.rank} className={`cfp-podium-slot cfp-podium-slot--${slot.tone}`}>
                <div className="cfp-podium-user">{slot.row ? <UserBox userId={slot.row.uid} /> : <span>Waiting...</span>}</div>
                <div className="cfp-podium-pillar" style={{ height: `${slot.height}px` }}>
                  <strong>#{slot.rank}</strong>
                  <span>{slot.row ? slot.row.score.toLocaleString() : "0"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
