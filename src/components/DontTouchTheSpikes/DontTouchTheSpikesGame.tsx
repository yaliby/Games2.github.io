import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import UserBox from "../UserBox/UserBox";
import { auth, db } from "../../services/firebase";
import { submitDontTouchTheSpikesScore } from "../../services/scoreService";
import "./DontTouchTheSpikesGame.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const WORLD_W = 420;
const WORLD_H = 680;

const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.045;
const MAX_ACC = 0.12;

const ARENA_W = 420;
const ARENA_H = 680;

const TOP_SPIKE_BAND  = 28;
const SIDE_SPIKE_DEPTH = 26;
const SLOT_COUNT = 9;

const BIRD_W = 28;
const BIRD_H = 28;
const BIRD_HIT_W = 22;
const BIRD_HIT_H = 22;
const CANDY_DRAW_R = 9;
const CANDY_HIT_R  = 13;

const GRAVITY        = 1550;
const FLAP_VEL       = -540;
const MAX_FALL_SPEED = 800;
const H_SPEED_BASE   = 200;
const DUEL_OPPOSITE_SPIKE_DELAY_SEC = 0.5;
const WALL_SCORE_POINTS = 1;
const STAR_SCORE_POINTS = 1;

const STORAGE_KEY = "dtts-best-v3";

type ThemeKey = "solo" | "p1" | "p2";

type ArenaTheme = {
  body: string;
  wing: string;
  beak: string;
  highlight: string;
  candyGlowA: string;
  candyGlowB: string;
  candyFill: string;
  candyStroke: string;
  candyShine: string;
  pickupBurst: string;
  deathFlash: string;
  uiAccent: string;
};

const ARENA_THEMES: Record<ThemeKey, ArenaTheme> = {
  solo: {
    body: "#f07030",
    wing: "#e85f28",
    beak: "#ff9030",
    highlight: "rgba(255,200,160,0.35)",
    candyGlowA: "rgba(255, 200, 0, 0.55)",
    candyGlowB: "rgba(255, 180, 0, 0.22)",
    candyFill: "#ffd700",
    candyStroke: "#e8a800",
    candyShine: "rgba(255,255,220,0.6)",
    pickupBurst: "#ffcc00",
    deathFlash: "255, 60, 20",
    uiAccent: "#f07030",
  },
  p1: {
    body: "#4ec9ff",
    wing: "#3bb2ea",
    beak: "#9ce9ff",
    highlight: "rgba(190,240,255,0.38)",
    candyGlowA: "rgba(94, 213, 255, 0.58)",
    candyGlowB: "rgba(94, 213, 255, 0.24)",
    candyFill: "#5ed5ff",
    candyStroke: "#2fa6d8",
    candyShine: "rgba(230,248,255,0.68)",
    pickupBurst: "#5ed5ff",
    deathFlash: "70, 180, 255",
    uiAccent: "#5ed5ff",
  },
  p2: {
    body: "#ff7b58",
    wing: "#ef6642",
    beak: "#ffbf88",
    highlight: "rgba(255,214,194,0.34)",
    candyGlowA: "rgba(255, 128, 102, 0.58)",
    candyGlowB: "rgba(255, 128, 102, 0.24)",
    candyFill: "#ff8066",
    candyStroke: "#df5a40",
    candyShine: "rgba(255,236,224,0.66)",
    pickupBurst: "#ff8066",
    deathFlash: "255, 88, 65",
    uiAccent: "#ff8066",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = "menu" | "ready" | "playing" | "dead";
type Side  = "left" | "right";
type GameMode = "solo" | "duel";

type Candy = { active: boolean; x: number; y: number };

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  r: number; life: number; age: number;
  color: string; drag: number; gravity: number;
};

type Arena = {
  birdX: number;
  birdY: number;
  birdVy: number;
  birdDir: 1 | -1;
  birdAnim: number;  // wing flap timer

  score: number;
  candies: number;
  phase: Phase;
  shake: number;
  shakeT: number;
  spikeSide: Side;
  spikesLeft: boolean[];
  spikesRight: boolean[];
  candy: Candy;
  spikesLeftAlpha: number[];
  spikesRightAlpha: number[];

  particles: Particle[];
  deathFlash: number;
  flashWhite: number;
  bestScore: number;
  trackBest: boolean;
  theme: ThemeKey;
  duelOppositeSpikeSide: Side | null;
  duelOppositeSpikeDelaySec: number;
};

type HudState = {
  phase: Phase;
  score: number;
  candies: number;
  bestScore: number;
};

type LeaderboardRow = { uid: string; score: number };

type DuelWinner = 0 | 1 | -1 | null;

type DuelState = {
  shared: Arena;
  a: Arena;
  b: Arena;
  over: boolean;
  winner: DuelWinner;
};

type DuelHud = {
  a: { phase: Phase; score: number; candies: number };
  b: { phase: Phase; score: number; candies: number };
  over: boolean;
  winner: DuelWinner;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function randInt(lo: number, hi: number) {
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}
function randFloat(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo);
}
function expApproach(current: number, target: number, k: number, dt: number) {
  return target + (current - target) * Math.exp(-k * dt);
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function themeFor(arena: Arena): ArenaTheme {
  return ARENA_THEMES[arena.theme];
}

function readBest(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch { return 0; }
}
function writeBest(v: number) {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { }
}

// ─── Spike / Arena geometry ───────────────────────────────────────────────────
function sideFieldTop()    { return TOP_SPIKE_BAND + 6; }
function sideFieldBottom() { return ARENA_H - TOP_SPIKE_BAND - 6; }
function slotH()           { return (sideFieldBottom() - sideFieldTop()) / SLOT_COUNT; }
function slotCY(i: number) { return sideFieldTop() + slotH() * (i + 0.5); }
function nearestSlot(y: number) {
  return clamp(Math.floor((y - sideFieldTop()) / slotH()), 0, SLOT_COUNT - 1);
}
function emptySlots() { return Array.from({ length: SLOT_COUNT }, () => false); }
function emptyAlphas() { return Array.from({ length: SLOT_COUNT }, () => 0); }

function isSpikeHit(spikes: boolean[], birdY: number) {
  const slot = nearestSlot(birdY);
  for (let i = Math.max(0, slot - 1); i <= Math.min(SLOT_COUNT - 1, slot + 1); i++) {
    if (spikes[i]) {
      const cy = slotCY(i);
      if (Math.abs(cy - birdY) < slotH() * 0.52) return true;
    }
  }
  return false;
}

function buildWallSpikes(arena: Arena, safeY: number): boolean[] {
  const slots = emptySlots();
  // More spikes as score increases
  const wanted = clamp(1 + Math.floor(arena.score / 5), 1, Math.min(5, SLOT_COUNT - 2));
  const gapSize = Math.max(2, 4 - Math.floor(arena.score / 12));

  const safeSlot = nearestSlot(safeY);
  const gapCenter = clamp(safeSlot + randInt(-1, 1), 0, SLOT_COUNT - 1);
  const gapStart = clamp(gapCenter - Math.floor(gapSize / 2), 0, SLOT_COUNT - gapSize);

  const forbidden = new Set<number>();
  for (let i = gapStart; i < gapStart + gapSize; i++) forbidden.add(i);

  const allowed: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!forbidden.has(i)) allowed.push(i);
  }

  // Shuffle and pick
  const shuffled = allowed.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(wanted, shuffled.length); i++) {
    slots[shuffled[i]] = true;
  }
  return slots;
}

function populateSpikes(arena: Arena, side: Side, safeY: number) {
  const slots = buildWallSpikes(arena, safeY);
  if (side === "left")  { arena.spikesLeft = slots; arena.spikesRight = emptySlots(); }
  else                  { arena.spikesRight = slots; arena.spikesLeft = emptySlots(); }
  arena.spikeSide = side;
}

function resolveDuelSafeY(primary: Arena, secondary: Arena, side: Side): number {
  if (side === "left") {
    if (primary.birdDir === -1) return primary.birdY;
    if (secondary.birdDir === -1) return secondary.birdY;
  } else {
    if (primary.birdDir === 1) return primary.birdY;
    if (secondary.birdDir === 1) return secondary.birdY;
  }
  return (primary.birdY + secondary.birdY) * 0.5;
}

function populateDuelSpikes(arena: Arena, primary: Arena, secondary: Arena) {
  const safeLeftY = resolveDuelSafeY(primary, secondary, "left");
  const safeRightY = resolveDuelSafeY(primary, secondary, "right");
  arena.spikesLeft = buildWallSpikes(arena, safeLeftY);
  arena.spikesRight = buildWallSpikes(arena, safeRightY);
}

function wallBounceX(side: Side) {
  return side === "left"
    ? SIDE_SPIKE_DEPTH + BIRD_W * 0.5 + 2
    : ARENA_W - SIDE_SPIKE_DEPTH - BIRD_W * 0.5 - 2;
}

function spawnCandy(arena: Arena) {
  const yMin = sideFieldTop() + slotH();
  const yMax = sideFieldBottom() - slotH();

  for (let attempt = 0; attempt < 40; attempt++) {
    const x = ARENA_W * 0.5 + randFloat(-ARENA_W * 0.22, ARENA_W * 0.22);
    const y = randFloat(yMin, yMax);
    const dx = x - arena.birdX, dy = y - arena.birdY;
    if (dx * dx + dy * dy < 50 * 50) continue;
    arena.candy = { active: true, x, y };
    return;
  }
  arena.candy = { active: true, x: ARENA_W * 0.5, y: ARENA_H * 0.5 };
}

function stepSpikeAlphas(arena: Arena, dt: number) {
  for (let i = 0; i < SLOT_COUNT; i++) {
    arena.spikesLeftAlpha[i]  = expApproach(arena.spikesLeftAlpha[i]  ?? 0, arena.spikesLeft[i]  ? 1 : 0, 16, dt);
    arena.spikesRightAlpha[i] = expApproach(arena.spikesRightAlpha[i] ?? 0, arena.spikesRight[i] ? 1 : 0, 16, dt);
  }
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }

  // Fallback for environments without Canvas roundRect support.
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function emitBurst(arena: Arena, x: number, y: number, color: string, count = 14) {
  for (let i = 0; i < count; i++) {
    const a = randFloat(0, Math.PI * 2);
    const sp = randFloat(60, 220);
    arena.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.8 - randFloat(10, 50),
      r: randFloat(2, 4),
      life: randFloat(0.3, 0.55),
      age: 0, color,
      drag: 4, gravity: randFloat(260, 380),
    });
  }
}

function makeArena(best: number, trackBest = true, theme: ThemeKey = "solo"): Arena {
  const arena: Arena = {
    birdX: wallBounceX("left"),
    birdY: ARENA_H * 0.5,
    birdVy: 0,
    birdDir: 1,
    birdAnim: 0,
    score: 0,
    candies: 0,
    phase: "menu",
    shake: 0,
    shakeT: 0,
    spikeSide: "right",
    spikesLeft: emptySlots(),
    spikesRight: emptySlots(),
    candy: { active: false, x: 0, y: 0 },
    spikesLeftAlpha: emptyAlphas(),
    spikesRightAlpha: emptyAlphas(),
    particles: [],
    deathFlash: 0,
    flashWhite: 0,
    bestScore: best,
    trackBest,
    theme,
    duelOppositeSpikeSide: null,
    duelOppositeSpikeDelaySec: 0,
  };
  // Place initial spikes on right side
  arena.spikesRight = buildWallSpikes(arena, arena.birdY);
  arena.spikeSide = "right";
  return arena;
}

function resetArena(arena: Arena) {
  const best = arena.bestScore;
  const fresh = makeArena(best, arena.trackBest, arena.theme);
  Object.assign(arena, fresh);
  arena.phase = "ready";
  arena.birdVy = FLAP_VEL * 0.5;
}

function killArena(arena: Arena) {
  arena.phase = "dead";
  if (arena.trackBest && arena.score > arena.bestScore) {
    arena.bestScore = arena.score;
    writeBest(arena.bestScore);
  }
  arena.deathFlash = 1;
  arena.shake = 8;
  emitBurst(arena, arena.birdX, arena.birdY, themeFor(arena).pickupBurst, 22);
}

function makeDuelState(): DuelState {
  const shared = makeArena(0, false, "solo");
  shared.phase = "ready";
  shared.birdVy = 0;
  shared.birdAnim = 0;
  shared.birdX = ARENA_W * 0.5;
  shared.birdY = ARENA_H * 0.5;
  shared.candy = { active: false, x: 0, y: 0 };
  shared.particles = [];

  const a = makeArena(0, false, "p1");
  const b = makeArena(0, false, "p2");
  a.birdX = wallBounceX("left");
  a.birdDir = 1;
  a.phase = "menu";
  a.candy = { active: false, x: 0, y: 0 };

  b.birdX = wallBounceX("right");
  b.birdDir = -1;
  b.phase = "menu";
  b.candy = { active: false, x: 0, y: 0 };

  return { shared, a, b, over: false, winner: null };
}

// ─── Step arena ───────────────────────────────────────────────────────────────
function stepArena(arena: Arena, dt: number) {
  const palette = themeFor(arena);
  // Always update particles and alphas
  stepSpikeAlphas(arena, dt);
  arena.shakeT += dt;

  // Update particles
  for (let i = arena.particles.length - 1; i >= 0; i--) {
    const p = arena.particles[i];
    p.age += dt;
    if (p.age >= p.life) { arena.particles.splice(i, 1); continue; }
    const drag = Math.exp(-p.drag * dt);
    p.vx *= drag; p.vy *= drag;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  if (arena.phase !== "playing") {
    arena.deathFlash = Math.max(0, arena.deathFlash - dt * 2.5);
    arena.shake = Math.max(0, arena.shake - dt * 30);
    arena.flashWhite = Math.max(0, arena.flashWhite - dt * 3);
    return;
  }

  arena.deathFlash = Math.max(0, arena.deathFlash - dt * 2.5);
  arena.shake = Math.max(0, arena.shake - dt * 30);
  arena.flashWhite = Math.max(0, arena.flashWhite - dt * 3);

  // Physics
  arena.birdVy = clamp(arena.birdVy + GRAVITY * dt, -9999, MAX_FALL_SPEED);
  arena.birdY += arena.birdVy * dt;
  // Horizontal movement is constant by design: no damping / no speed drop.
  arena.birdX += arena.birdDir * H_SPEED_BASE * dt;
  arena.birdAnim += dt;

  // Candy pickup
  if (arena.candy.active) {
    const dx = arena.birdX - arena.candy.x;
    const dy = arena.birdY - arena.candy.y;
    if (dx * dx + dy * dy <= (BIRD_HIT_W * 0.5 + CANDY_HIT_R) ** 2) {
      arena.candy.active = false;
      arena.candies += 1;
      arena.score += STAR_SCORE_POINTS;
      arena.flashWhite = 0.5;
      emitBurst(arena, arena.candy.x, arena.candy.y, palette.pickupBurst, 14);
    }
  }

  // Top / bottom collision
  if (arena.birdY - BIRD_HIT_H * 0.5 <= TOP_SPIKE_BAND ||
      arena.birdY + BIRD_HIT_H * 0.5 >= ARENA_H - TOP_SPIKE_BAND) {
    killArena(arena);
    return;
  }

  // Side spike collision
  if (arena.spikeSide === "left" && arena.birdX - BIRD_HIT_W * 0.5 <= SIDE_SPIKE_DEPTH) {
    if (isSpikeHit(arena.spikesLeft, arena.birdY)) { killArena(arena); return; }
  }
  if (arena.spikeSide === "right" && arena.birdX + BIRD_HIT_W * 0.5 >= ARENA_W - SIDE_SPIKE_DEPTH) {
    if (isSpikeHit(arena.spikesRight, arena.birdY)) { killArena(arena); return; }
  }

  // Wall bounce
  let bounced = false;
  if (arena.birdX - BIRD_W * 0.5 <= 0) {
    arena.birdX = BIRD_W * 0.5;
    if (arena.birdDir !== 1) { arena.birdDir = 1; bounced = true; }
  } else if (arena.birdX + BIRD_W * 0.5 >= ARENA_W) {
    arena.birdX = ARENA_W - BIRD_W * 0.5;
    if (arena.birdDir !== -1) { arena.birdDir = -1; bounced = true; }
  }

  if (!bounced) return;

  arena.score += WALL_SCORE_POINTS;
  arena.shake = Math.max(arena.shake, 5);
  arena.shakeT = 0;
  arena.flashWhite = Math.max(arena.flashWhite, 0.12);

  const wallSide: Side = arena.birdDir === 1 ? "right" : "left";
  populateSpikes(arena, wallSide, arena.birdY);
  if (!arena.candy.active) spawnCandy(arena);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawTopBottomSpikes(ctx: CanvasRenderingContext2D) {
  const count = 14;
  const dx = ARENA_W / count;
  ctx.fillStyle = "#1a1a1a";

  for (let i = 0; i < count; i++) {
    const x0 = i * dx;
    // Top spikes (pointing down)
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + dx * 0.5, TOP_SPIKE_BAND);
    ctx.lineTo(x0 + dx, 0);
    ctx.closePath();
    ctx.fill();

    // Bottom spikes (pointing up)
    ctx.beginPath();
    ctx.moveTo(x0, ARENA_H);
    ctx.lineTo(x0 + dx * 0.5, ARENA_H - TOP_SPIKE_BAND);
    ctx.lineTo(x0 + dx, ARENA_H);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSideSpikes(
  ctx: CanvasRenderingContext2D,
  side: Side,
  alphas: number[],
) {
  const tip    = side === "left" ? SIDE_SPIKE_DEPTH : ARENA_W - SIDE_SPIKE_DEPTH;
  const origin = side === "left" ? 0 : ARENA_W;

  for (let i = 0; i < SLOT_COUNT; i++) {
    const a = alphas[i] ?? 0;
    if (a <= 0.02) continue;

    const cy = slotCY(i);
    const hh = slotH() * 0.44;

    ctx.globalAlpha = a;
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(origin, cy - hh);
    ctx.lineTo(tip, cy);
    ctx.lineTo(origin, cy + hh);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCandy(ctx: CanvasRenderingContext2D, candy: Candy, nowSec: number, palette: ArenaTheme) {
  if (!candy.active) return;
  const pulse = 1 + Math.sin(nowSec * 7) * 0.1;
  const r = CANDY_DRAW_R * pulse;

  ctx.save();
  ctx.translate(candy.x, candy.y);

  // Outer glow
  const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.8);
  grd.addColorStop(0,   palette.candyGlowA);
  grd.addColorStop(0.5, palette.candyGlowB);
  grd.addColorStop(1,   "rgba(255, 180, 0, 0)");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Coin body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = palette.candyFill;
  ctx.fill();
  ctx.strokeStyle = palette.candyStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner shine
  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 0.2, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = palette.candyShine;
  ctx.fill();

  ctx.restore();
}

function drawBird(ctx: CanvasRenderingContext2D, arena: Arena, _nowSec: number) {
  const { birdX, birdY, birdDir, birdAnim, birdVy } = arena;
  const palette = themeFor(arena);

  const tilt = clamp(birdVy / 900, -0.55, 0.7);
  const wingFlap = Math.sin(birdAnim * 16) * 0.35;

  ctx.save();
  ctx.translate(birdX, birdY);
  ctx.rotate(tilt);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.ellipse(2, BIRD_H * 0.5 + 4, BIRD_W * 0.4, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing
  ctx.save();
  ctx.globalAlpha = 0.7;
  const wingX = -birdDir * (BIRD_W * 0.25);
  ctx.translate(wingX, wingFlap * 8);
  ctx.rotate(wingFlap * birdDir);
  ctx.fillStyle = palette.wing;
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_W * 0.42, BIRD_H * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  // Body (square-ish with rounded corners - like original)
  const bw = BIRD_W;
  const bh = BIRD_H;
  const r = 6;
  ctx.fillStyle = palette.body;
  drawRoundedRectPath(ctx, -bw / 2, -bh / 2, bw, bh, r);
  ctx.fill();

  // Body highlight
  ctx.fillStyle = palette.highlight;
  drawRoundedRectPath(ctx, -bw / 2 + 3, -bh / 2 + 3, bw * 0.55, bh * 0.45, 3);
  ctx.fill();

  // Beak
  ctx.fillStyle = palette.beak;
  if (birdDir === 1) {
    ctx.beginPath();
    ctx.moveTo(bw / 2, -3);
    ctx.lineTo(bw / 2 + 9, 0);
    ctx.lineTo(bw / 2, 4);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-bw / 2, -3);
    ctx.lineTo(-bw / 2 - 9, 0);
    ctx.lineTo(-bw / 2, 4);
    ctx.closePath();
    ctx.fill();
  }

  // Eye
  const eyeX = birdDir === 1 ? bw * 0.25 : -bw * 0.25;
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(eyeX, -bh * 0.1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(eyeX + birdDir * 1.2, -bh * 0.1 - 1.5, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, arena: Arena) {
  for (const p of arena.particles) {
    const k = 1 - clamp(p.age / p.life, 0, 1);
    if (k <= 0.001) continue;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.5 + 0.5 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawArena(ctx: CanvasRenderingContext2D, arena: Arena, nowSec: number) {
  const palette = themeFor(arena);
  ctx.save();

  // Shake offset
  let sx = 0, sy = 0;
  if (arena.shake > 0) {
    sx = Math.sin(arena.shakeT * 58) * arena.shake * 0.7;
    sy = Math.cos(arena.shakeT * 53) * arena.shake * 0.4;
  }
  ctx.translate(sx, sy);

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Subtle grid lines for retro feel
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
  }
  for (let y = 0; y < ARENA_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
  }

  // Death flash
  if (arena.deathFlash > 0) {
    ctx.fillStyle = `rgba(${palette.deathFlash}, ${arena.deathFlash * 0.22})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }
  if (arena.flashWhite > 0) {
    ctx.fillStyle = `rgba(255, 230, 100, ${arena.flashWhite * 0.25})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  // Spikes
  drawTopBottomSpikes(ctx);
  drawSideSpikes(ctx, "left",  arena.spikesLeftAlpha);
  drawSideSpikes(ctx, "right", arena.spikesRightAlpha);

  // Candy
  drawCandy(ctx, arena.candy, nowSec, palette);

  // Particles
  drawParticles(ctx, arena);

  // Bird (blinking when dead)
  if (arena.phase !== "dead" || Math.floor(nowSec * 7) % 2 === 0) {
    drawBird(ctx, arena, nowSec);
  }

  // Score (big, centered, dark)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 80px 'Arial Rounded MT Bold', Arial, sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillText(String(arena.score), ARENA_W * 0.5, ARENA_H * 0.42);

  ctx.restore();
}

function drawMenuScreen(ctx: CanvasRenderingContext2D, nowSec: number) {
  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Grid
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
  }
  for (let y = 0; y < ARENA_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
  }

  // Title
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 28px 'Arial Rounded MT Bold', Arial, sans-serif";
  ctx.fillText("DON'T TOUCH", ARENA_W * 0.5, ARENA_H * 0.3);
  ctx.font = "bold 36px 'Arial Rounded MT Bold', Arial, sans-serif";
  ctx.fillStyle = "#f07030";
  ctx.fillText("THE SPIKES", ARENA_W * 0.5, ARENA_H * 0.38);

  // Animated bird preview
  const bx = ARENA_W * 0.5 + Math.sin(nowSec * 1.5) * 60;
  const by = ARENA_H * 0.58 + Math.cos(nowSec * 2.2) * 18;
  const fakeBird: Arena = {
    birdX: bx, birdY: by, birdVy: -100, birdDir: 1,
    birdAnim: nowSec, score: 0, candies: 0, phase: "playing",
    shake: 0, shakeT: 0, spikeSide: "right",
    spikesLeft: emptySlots(), spikesRight: emptySlots(),
    candy: { active: false, x: 0, y: 0 },
    spikesLeftAlpha: emptyAlphas(), spikesRightAlpha: emptyAlphas(),
    particles: [],
    deathFlash: 0,
    flashWhite: 0,
    bestScore: 0,
    trackBest: false,
    theme: "solo",
    duelOppositeSpikeSide: null,
    duelOppositeSpikeDelaySec: 0,
  };
  drawBird(ctx, fakeBird, nowSec);

  // Tap instruction
  const tapAlpha = 0.5 + Math.sin(nowSec * 3) * 0.5;
  ctx.globalAlpha = tapAlpha;
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.fillText("TAP  TO  START", ARENA_W * 0.5, ARENA_H * 0.77);
  ctx.globalAlpha = 1;
}

function drawGameOverScreen(ctx: CanvasRenderingContext2D, arena: Arena, nowSec: number) {
  // White bg
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Score panel
  const panelW = 280, panelH = 180;
  const px = ARENA_W * 0.5 - panelW * 0.5;
  const py = ARENA_H * 0.5 - panelH * 0.5 - 20;

  ctx.fillStyle = "#1a1a1a";
  drawRoundedRectPath(ctx, px, py, panelW, panelH, 14);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px Arial, sans-serif";
  ctx.fillText("GAME OVER", ARENA_W * 0.5, py + 30);

  ctx.font = "bold 56px 'Arial Rounded MT Bold', Arial, sans-serif";
  ctx.fillStyle = "#f07030";
  ctx.fillText(String(arena.score), ARENA_W * 0.5, py + 88);

  ctx.font = "14px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText("SCORE", ARENA_W * 0.5, py + 125);

  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillStyle = "#ffd700";
  ctx.fillText(`⭐ BEST: ${arena.bestScore}`, ARENA_W * 0.5, py + 150);

  // Tap to restart
  const tapAlpha = 0.5 + Math.sin(nowSec * 3) * 0.5;
  ctx.globalAlpha = tapAlpha;
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 16px Arial, sans-serif";
  ctx.fillText("TAP  TO  RESTART", ARENA_W * 0.5, py + panelH + 48);
  ctx.globalAlpha = 1;

  // Coins
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 15px Arial, sans-serif";
  ctx.fillText(`🪙 x${arena.candies}`, ARENA_W * 0.5, py + panelH + 78);
}

function resetDuelRound(duel: DuelState) {
  const fresh = makeDuelState();
  Object.assign(duel, fresh);
}

function spawnDuelCandy(owner: Arena, other: Arena) {
  const target = owner.candy;
  const blocker = other.candy;
  const yMin = sideFieldTop() + slotH();
  const yMax = sideFieldBottom() - slotH();
  const towardSide: Side = owner.birdDir === 1 ? "right" : "left";
  const wall = wallBounceX(towardSide);

  for (let attempt = 0; attempt < 45; attempt++) {
    const baseOffset = randFloat(22, 76);
    const xRaw = towardSide === "right" ? wall - baseOffset : wall + baseOffset;
    const x = clamp(xRaw, SIDE_SPIKE_DEPTH + 22, ARENA_W - SIDE_SPIKE_DEPTH - 22);
    const y = randFloat(yMin, yMax);
    if (blocker.active && (x - blocker.x) ** 2 + (y - blocker.y) ** 2 < 34 * 34) continue;
    if ((x - owner.birdX) ** 2 + (y - owner.birdY) ** 2 < 44 * 44) continue;
    if ((x - other.birdX) ** 2 + (y - other.birdY) ** 2 < 34 * 34) continue;
    target.active = true;
    target.x = x;
    target.y = y;
    return;
  }

  target.active = true;
  target.x = towardSide === "right" ? wall - 48 : wall + 48;
  target.y = ARENA_H * 0.5;
}

function startDuelFromInput(duel: DuelState, starter: 0 | 1) {
  const birds = [duel.a, duel.b] as const;
  const starterBird = starter === 0 ? duel.a : duel.b;
  const otherBird = starter === 0 ? duel.b : duel.a;
  for (const bird of birds) {
    if (bird.phase === "menu" || bird.phase === "dead") {
      resetArena(bird);
    }
    bird.phase = "playing";
  }
  duel.a.birdX = wallBounceX("left");
  duel.b.birdX = wallBounceX("right");
  duel.a.birdDir = 1;
  duel.b.birdDir = -1;
  duel.shared.score = 0;
  populateDuelSpikes(duel.shared, duel.a, duel.b);
  duel.shared.spikesLeftAlpha = emptyAlphas();
  duel.shared.spikesRightAlpha = emptyAlphas();
  duel.shared.spikeSide = "right";
  duel.shared.duelOppositeSpikeSide = null;
  duel.shared.duelOppositeSpikeDelaySec = 0;
  duel.shared.shake = 0;
  duel.shared.flashWhite = 0;
  duel.shared.deathFlash = 0;
  duel.a.candy = { active: false, x: 0, y: 0 };
  duel.b.candy = { active: false, x: 0, y: 0 };
  spawnDuelCandy(starterBird, otherBird);
  spawnDuelCandy(otherBird, starterBird);
  duel.over = false;
  duel.winner = null;
  // Starting one bird launches both, so both keep moving immediately.
  duel.a.birdVy = starter === 0 ? FLAP_VEL : FLAP_VEL * 0.82;
  duel.b.birdVy = starter === 1 ? FLAP_VEL : FLAP_VEL * 0.82;
}

function flapDuelBird(duel: DuelState, player: 0 | 1) {
  if (duel.over) {
    resetDuelRound(duel);
  }

  const aPlaying = duel.a.phase === "playing";
  const bPlaying = duel.b.phase === "playing";
  if (!aPlaying || !bPlaying) {
    startDuelFromInput(duel, player);
    return;
  }

  const target = player === 0 ? duel.a : duel.b;
  if (target.phase === "playing") {
    target.birdVy = FLAP_VEL;
  }
}

function stepDuelBird(shared: Arena, bird: Arena, other: Arena, dt: number) {
  const palette = themeFor(bird);

  for (let i = bird.particles.length - 1; i >= 0; i--) {
    const p = bird.particles[i];
    p.age += dt;
    if (p.age >= p.life) { bird.particles.splice(i, 1); continue; }
    const drag = Math.exp(-p.drag * dt);
    p.vx *= drag; p.vy *= drag;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  bird.deathFlash = Math.max(0, bird.deathFlash - dt * 2.5);
  bird.shake = Math.max(0, bird.shake - dt * 30);
  bird.flashWhite = Math.max(0, bird.flashWhite - dt * 3);
  if (bird.phase !== "playing") return;

  bird.birdVy = clamp(bird.birdVy + GRAVITY * dt, -9999, MAX_FALL_SPEED);
  bird.birdY += bird.birdVy * dt;
  // Horizontal movement is constant by design: no damping / no speed drop.
  bird.birdX += bird.birdDir * H_SPEED_BASE * dt;
  bird.birdAnim += dt;

  if (bird.candy.active) {
    const dx = bird.birdX - bird.candy.x;
    const dy = bird.birdY - bird.candy.y;
    if (dx * dx + dy * dy <= (BIRD_HIT_W * 0.5 + CANDY_HIT_R) ** 2) {
      bird.candy.active = false;
      bird.candies += 1;
      bird.score += STAR_SCORE_POINTS;
      shared.score = Math.max(shared.score, bird.score, other.score);
      bird.flashWhite = 0.5;
      emitBurst(bird, bird.candy.x, bird.candy.y, palette.pickupBurst, 14);
      spawnDuelCandy(bird, other);
    }
  }

  if (
    bird.birdY - BIRD_HIT_H * 0.5 <= TOP_SPIKE_BAND ||
    bird.birdY + BIRD_HIT_H * 0.5 >= ARENA_H - TOP_SPIKE_BAND
  ) {
    killArena(bird);
    shared.deathFlash = 1;
    return;
  }

  if (bird.birdX - BIRD_HIT_W * 0.5 <= SIDE_SPIKE_DEPTH) {
    if (isSpikeHit(shared.spikesLeft, bird.birdY)) { killArena(bird); shared.deathFlash = 1; return; }
  }
  if (bird.birdX + BIRD_HIT_W * 0.5 >= ARENA_W - SIDE_SPIKE_DEPTH) {
    if (isSpikeHit(shared.spikesRight, bird.birdY)) { killArena(bird); shared.deathFlash = 1; return; }
  }

  let bounced = false;
  let touchedSide: Side | null = null;
  if (bird.birdX - BIRD_W * 0.5 <= 0) {
    bird.birdX = BIRD_W * 0.5;
    if (bird.birdDir !== 1) {
      bird.birdDir = 1;
      bounced = true;
      touchedSide = "left";
    }
  } else if (bird.birdX + BIRD_W * 0.5 >= ARENA_W) {
    bird.birdX = ARENA_W - BIRD_W * 0.5;
    if (bird.birdDir !== -1) {
      bird.birdDir = -1;
      bounced = true;
      touchedSide = "right";
    }
  }

  if (!bounced) return;

  bird.score += WALL_SCORE_POINTS;
  bird.shake = Math.max(bird.shake, 5);
  bird.shakeT = 0;
  bird.flashWhite = Math.max(bird.flashWhite, 0.12);

  shared.score = Math.max(shared.score, bird.score, other.score);
  if (touchedSide) {
    // Keep both walls clean for one full second before regenerating duel spikes.
    shared.spikesLeft = emptySlots();
    shared.spikesRight = emptySlots();
    shared.spikesLeftAlpha = emptyAlphas();
    shared.spikesRightAlpha = emptyAlphas();
    shared.duelOppositeSpikeSide = touchedSide;
    shared.duelOppositeSpikeDelaySec = DUEL_OPPOSITE_SPIKE_DELAY_SEC;
  }
  shared.shake = Math.max(shared.shake, 4.5);
  shared.flashWhite = Math.max(shared.flashWhite, 0.18);
}

function stepDuel(duel: DuelState, dt: number) {
  const shared = duel.shared;

  if (shared.duelOppositeSpikeSide && shared.duelOppositeSpikeDelaySec > 0) {
    shared.duelOppositeSpikeDelaySec = Math.max(0, shared.duelOppositeSpikeDelaySec - dt);
    if (shared.duelOppositeSpikeDelaySec === 0) {
      populateDuelSpikes(shared, duel.a, duel.b);
      shared.duelOppositeSpikeSide = null;
    }
  }

  stepSpikeAlphas(shared, dt);
  shared.shakeT += dt;
  shared.shake = Math.max(0, shared.shake - dt * 28);
  shared.flashWhite = Math.max(0, shared.flashWhite - dt * 3);
  shared.deathFlash = Math.max(0, shared.deathFlash - dt * 2.2);

  stepDuelBird(shared, duel.a, duel.b, dt);
  stepDuelBird(shared, duel.b, duel.a, dt);

  if (duel.over) return;

  const aDead = duel.a.phase === "dead";
  const bDead = duel.b.phase === "dead";
  if (!aDead && !bDead) return;

  duel.over = true;
  duel.winner = aDead && bDead ? -1 : aDead ? 1 : 0;
  if (!aDead) duel.a.phase = "dead";
  if (!bDead) duel.b.phase = "dead";
}

function drawDuelWorld(ctx: CanvasRenderingContext2D, duel: DuelState, nowSec: number) {
  const shared = duel.shared;
  ctx.save();
  let sx = 0, sy = 0;
  if (shared.shake > 0) {
    sx = Math.sin(shared.shakeT * 58) * shared.shake * 0.7;
    sy = Math.cos(shared.shakeT * 53) * shared.shake * 0.4;
  }
  ctx.translate(sx, sy);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
  }
  for (let y = 0; y < ARENA_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
  }

  if (shared.deathFlash > 0) {
    ctx.fillStyle = `rgba(255, 70, 40, ${shared.deathFlash * 0.18})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }
  if (shared.flashWhite > 0) {
    ctx.fillStyle = `rgba(255, 230, 100, ${shared.flashWhite * 0.25})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  drawTopBottomSpikes(ctx);
  drawSideSpikes(ctx, "left", shared.spikesLeftAlpha);
  drawSideSpikes(ctx, "right", shared.spikesRightAlpha);

  drawCandy(ctx, duel.a.candy, nowSec, ARENA_THEMES.p1);
  drawCandy(ctx, duel.b.candy, nowSec, ARENA_THEMES.p2);
  drawParticles(ctx, duel.a);
  drawParticles(ctx, duel.b);
  if (duel.a.phase !== "dead" || Math.floor(nowSec * 7) % 2 === 0) drawBird(ctx, duel.a, nowSec);
  if (duel.b.phase !== "dead" || Math.floor(nowSec * 7) % 2 === 0) drawBird(ctx, duel.b, nowSec);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ARENA_THEMES.p1.uiAccent;
  ctx.font = "700 14px 'Rajdhani', 'Segoe UI', sans-serif";
  ctx.fillText(`P1 ${duel.a.score}  ·  Power ${duel.a.candies}`, 12, TOP_SPIKE_BAND + 14);
  ctx.textAlign = "right";
  ctx.fillStyle = ARENA_THEMES.p2.uiAccent;
  ctx.fillText(`P2 ${duel.b.score}  ·  Power ${duel.b.candies}`, ARENA_W - 12, TOP_SPIKE_BAND + 14);
  ctx.restore();

  const notStarted = !duel.over && duel.a.phase !== "playing" && duel.b.phase !== "playing";
  if (notStarted) {
    ctx.fillStyle = "rgba(6, 14, 28, 0.78)";
    drawRoundedRectPath(ctx, 58, WORLD_H * 0.76, WORLD_W - 116, 60, 12);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(215, 236, 255, 0.95)";
    ctx.font = "700 15px 'Rajdhani', 'Segoe UI', sans-serif";
    ctx.fillText("1V1 READY • Any player starts both birds", WORLD_W * 0.5, WORLD_H * 0.79);
    ctx.font = "700 12px 'Rajdhani', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(186, 219, 250, 0.9)";
    ctx.fillText("P1: W / SPACE    P2: ↑ / ENTER", WORLD_W * 0.5, WORLD_H * 0.82);
  }

  if (duel.over) {
    ctx.fillStyle = "rgba(5, 12, 24, 0.86)";
    drawRoundedRectPath(ctx, 90, WORLD_H * 0.42, WORLD_W - 180, 92, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(160, 214, 255, 0.42)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const title =
      duel.winner === -1 ? "DRAW" :
      duel.winner === 0 ? "PLAYER 1 WINS" :
      "PLAYER 2 WINS";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(235, 246, 255, 0.96)";
    ctx.font = "700 24px 'Rajdhani', 'Segoe UI', sans-serif";
    ctx.fillText(title, WORLD_W * 0.5, WORLD_H * 0.46);
    ctx.font = "600 14px 'Rajdhani', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(180, 216, 250, 0.9)";
    ctx.fillText("Tap or press flap key to restart duel", WORLD_W * 0.5, WORLD_H * 0.51);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DontTouchTheSpikesGame() {
  const initialUid = auth.currentUser?.uid ?? null;
  const initialBest = initialUid ? 0 : readBest();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arenaRef  = useRef<Arena>(makeArena(initialBest));
  const duelRef = useRef<DuelState>(makeDuelState());
  const activeUidRef = useRef<string | null>(initialUid);
  const bestSyncReadyRef = useRef(initialUid === null);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);
  const [mode, setMode] = useState<GameMode>("solo");
  const [hud, setHud] = useState<HudState>(() => ({
    phase: arenaRef.current.phase,
    score: 0,
    candies: 0,
    bestScore: arenaRef.current.bestScore,
  }));
  const [duelHud, setDuelHud] = useState<DuelHud>(() => ({
    a: {
      phase: duelRef.current.a.phase,
      score: duelRef.current.a.score,
      candies: duelRef.current.a.candies,
    },
    b: {
      phase: duelRef.current.b.phase,
      score: duelRef.current.b.score,
      candies: duelRef.current.b.candies,
    },
    over: duelRef.current.over,
    winner: duelRef.current.winner,
  }));
  const accRef = useRef(0);
  const [activeUid, setActiveUid] = useState<string | null>(activeUidRef.current);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [dbBestScore, setDbBestScore] = useState<number | null>(initialUid ? null : initialBest);

  const syncHud = useCallback(() => {
    const a = arenaRef.current;
    setHud(prev => {
      if (prev.phase === a.phase && prev.score === a.score &&
          prev.candies === a.candies && prev.bestScore === a.bestScore) return prev;
      return { phase: a.phase, score: a.score, candies: a.candies, bestScore: a.bestScore };
    });
  }, []);

  const syncDuelHud = useCallback(() => {
    const duel = duelRef.current;
    setDuelHud((prev) => {
      const next: DuelHud = {
        a: { phase: duel.a.phase, score: duel.a.score, candies: duel.a.candies },
        b: { phase: duel.b.phase, score: duel.b.score, candies: duel.b.candies },
        over: duel.over,
        winner: duel.winner,
      };
      if (
        prev.a.phase === next.a.phase &&
        prev.a.score === next.a.score &&
        prev.a.candies === next.a.candies &&
        prev.b.phase === next.b.phase &&
        prev.b.score === next.b.score &&
        prev.b.candies === next.b.candies &&
        prev.over === next.over &&
        prev.winner === next.winner
      ) {
        return prev;
      }
      return next;
    });
  }, []);

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
        arenaRef.current.bestScore = 0;
        setDbBestScore(null);
      } else {
        const guestBest = readBest();
        arenaRef.current.bestScore = guestBest;
        setDbBestScore(guestBest);
      }
      syncHud();
    });
  }, [syncHud]);

  useEffect(() => {
    const scoresRef = collection(db, "scores", "dont-touch-the-spikes", "users");
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown };
            return {
              uid: entry.id,
              score: normalizeScore(data?.score),
            };
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        setLeaderboardRows(rows);
      },
      (err) => console.warn("dtts leaderboard listener failed:", err)
    );
  }, []);

  useEffect(() => {
    if (!activeUid) {
      submittedBestScoreRef.current = 0;
      pendingBestScoreRef.current = 0;
      bestSyncReadyRef.current = true;
      return undefined;
    }

    const scoreRef = doc(db, "scores", "dont-touch-the-spikes", "users", activeUid);
    return onSnapshot(
      scoreRef,
      (snap) => {
        const dbBest = snap.exists() ? normalizeScore((snap.data() as { score?: unknown })?.score) : 0;
        bestSyncReadyRef.current = true;
        setDbBestScore(dbBest);
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, dbBest);
        if (pendingBestScoreRef.current <= dbBest) {
          pendingBestScoreRef.current = 0;
        }
        arenaRef.current.bestScore = Math.max(arenaRef.current.bestScore, dbBest);
        syncHud();
      },
      (err) => console.warn("dtts best score listener failed:", err)
    );
  }, [activeUid, syncHud]);

  useEffect(() => {
    const uid = activeUidRef.current;
    const best = normalizeScore(arenaRef.current.bestScore);
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
      submitDontTouchTheSpikesScore(targetUid, targetScore)
        .then(() => {
          submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, targetScore);
          if (pendingBestScoreRef.current <= targetScore) {
            pendingBestScoreRef.current = 0;
          }
        })
        .catch((err) => console.warn("dtts best score update failed:", err))
        .finally(() => {
          bestSubmitInFlightRef.current = false;
          if (pendingBestScoreRef.current > submittedBestScoreRef.current) {
            flushBestScoreUpdate();
          }
        });
    }

    flushBestScoreUpdate();
  }, [hud.bestScore, activeUid]);

  const flapSolo = useCallback(() => {
    const arena = arenaRef.current;
    if (arena.phase === "menu") {
      arena.phase = "ready";
      resetArena(arena);
      arena.phase = "playing";
      arena.birdVy = FLAP_VEL;
      syncHud();
      return;
    }
    if (arena.phase === "dead") {
      resetArena(arena);
      arena.birdVy = FLAP_VEL;
      syncHud();
      return;
    }
    if (arena.phase === "ready") arena.phase = "playing";
    if (arena.phase === "playing") {
      arena.birdVy = FLAP_VEL;
    }
  }, [syncHud]);

  const flapDuel = useCallback((player: 0 | 1) => {
    const duel = duelRef.current;
    flapDuelBird(duel, player);
    syncDuelHud();
  }, [syncDuelHud]);

  const hardReset = useCallback(() => {
    if (mode === "solo") {
      resetArena(arenaRef.current);
      syncHud();
      return;
    }
    resetDuelRound(duelRef.current);
    syncDuelHud();
  }, [mode, syncHud, syncDuelHud]);

  const switchMode = useCallback((nextMode: GameMode) => {
    setMode(nextMode);
    if (nextMode === "solo") {
      const best = arenaRef.current.bestScore;
      arenaRef.current = makeArena(best, true, "solo");
      arenaRef.current.phase = "menu";
      arenaRef.current.birdVy = 0;
      syncHud();
      return;
    }
    resetDuelRound(duelRef.current);
    syncDuelHud();
  }, [syncHud, syncDuelHud]);

  const handlePointer = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === "solo") {
      flapSolo();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    flapDuel(x < rect.width * 0.5 ? 0 : 1);
  }, [mode, flapSolo, flapDuel]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (key === "1") {
        e.preventDefault();
        if (mode !== "solo") switchMode("solo");
        return;
      }
      if (key === "2") {
        e.preventDefault();
        if (mode !== "duel") switchMode("duel");
        return;
      }
      if (key === "m") {
        e.preventDefault();
        switchMode(mode === "solo" ? "duel" : "solo");
        return;
      }

      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        hardReset();
        return;
      }
      if (mode === "solo") {
        if (e.key === " " || e.key === "w" || e.key === "W" ||
            e.key === "ArrowUp" || e.key === "Enter") {
          e.preventDefault();
          flapSolo();
        }
        return;
      }
      if (e.key === " " || e.key === "w" || e.key === "W") {
        e.preventDefault();
        flapDuel(0);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        flapDuel(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, flapSolo, flapDuel, hardReset, switchMode]);

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const configureCanvas = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width  = Math.round(WORLD_W * dpr);
      canvas.height = Math.round(WORLD_H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    configureCanvas();
    window.addEventListener("resize", configureCanvas);

    let rafId = 0;
    let lastMs = performance.now();
    let hudTimer = 0;

    const loop = (nowMs: number) => {
      const dt = Math.min((nowMs - lastMs) / 1000, MAX_FRAME_DT);
      lastMs = nowMs;
      const nowSec = nowMs / 1000;

      accRef.current = Math.min(MAX_ACC, accRef.current + dt);
      while (accRef.current >= FIXED_DT) {
        if (mode === "solo") {
          stepArena(arenaRef.current, FIXED_DT);
        } else {
          stepDuel(duelRef.current, FIXED_DT);
        }
        accRef.current -= FIXED_DT;
      }

      // Draw
      ctx.clearRect(0, 0, WORLD_W, WORLD_H);
      if (mode === "solo") {
        const arena = arenaRef.current;
        if (arena.phase === "menu") {
          drawMenuScreen(ctx, nowSec);
        } else if (arena.phase === "dead" && arena.particles.length < 2 && arena.deathFlash < 0.05) {
          drawGameOverScreen(ctx, arena, nowSec);
        } else {
          drawArena(ctx, arena, nowSec);
          // If dead but still animating, show score overlay
          if (arena.phase === "dead") {
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillRect(0, 0, WORLD_W, WORLD_H);
          }
        }
      } else {
        drawDuelWorld(ctx, duelRef.current, nowSec);
      }

      hudTimer += dt;
      if (hudTimer >= 0.08) {
        hudTimer = 0;
        if (mode === "solo") syncHud();
        else syncDuelHud();
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", configureCanvas);
    };
  }, [mode, syncHud, syncDuelHud]);

  const phaseLabel =
    hud.phase === "menu" ? "Menu" :
    hud.phase === "ready" ? "Ready" :
    hud.phase === "playing" ? "Playing" :
    "Game Over";
  const duelResultLabel =
    duelHud.winner === -1 ? "Draw" :
    duelHud.winner === 0 ? "Player 1 wins" :
    duelHud.winner === 1 ? "Player 2 wins" :
    "Round active";
  const shownBest = Math.max(hud.bestScore, dbBestScore ?? 0);
  const topLeaderboardRows = leaderboardRows.slice(0, 6);
  const engineStatusText = mode === "solo"
    ? `State: ${phaseLabel}`
    : (duelHud.over ? `Result: ${duelResultLabel}` : "Duel in progress");

  return (
    <main className="game-page dtts-page">
      <div className="dtts-layout">
        <section className="dtts-card dtts-card--single dtts-card--engine">
          <header className="dtts-header dtts-header--single">
            <div>
              <h1>Don&apos;t Touch The Spikes</h1>
              <p>{mode === "solo" ? "Classic mode with the current engine and models" : "1v1 duel: two birds, synced start, fixed horizontal speed"}</p>
            </div>
            <div className="dtts-inline-stats" aria-live="polite">
              <div className="dtts-pill">
                <span>{mode === "solo" ? "Score" : "P1 Score"}</span>
                <strong>{mode === "solo" ? hud.score : duelHud.a.score}</strong>
              </div>
              <div className="dtts-pill">
                <span>{mode === "solo" ? "Stars" : "P2 Score"}</span>
                <strong>{mode === "solo" ? hud.candies : duelHud.b.score}</strong>
              </div>
              <div className="dtts-pill">
                <span>{mode === "solo" ? "Best" : "Result"}</span>
                <strong>{mode === "solo" ? shownBest : duelHud.over ? duelResultLabel : "Live"}</strong>
              </div>
            </div>
          </header>

          <div className="dtts-mode-strip" role="group" aria-label="Game mode and controls">
            <button
              type="button"
              className={`dtts-mode-btn${mode === "solo" ? " is-active" : ""}`}
              onClick={() => switchMode("solo")}
              disabled={mode === "solo"}
            >
              Solo
              {" "}
              <kbd>1</kbd>
            </button>
            <button
              type="button"
              className={`dtts-mode-btn${mode === "duel" ? " is-active" : ""}`}
              onClick={() => switchMode("duel")}
              disabled={mode === "duel"}
            >
              1v1
              {" "}
              <kbd>2</kbd>
            </button>
            <button
              type="button"
              className="dtts-mode-btn dtts-mode-btn--reset"
              onClick={hardReset}
            >
              Reset
              {" "}
              <kbd>R</kbd>
            </button>
          </div>

          <div className="dtts-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={WORLD_W}
              height={WORLD_H}
              className="dtts-canvas dtts-canvas--single"
              onPointerDown={handlePointer}
            />

            <div className="dtts-engine-ui">
              <div className="dtts-engine-ui-top">
                <div className="dtts-engine-chip">{engineStatusText}</div>
                <div className="dtts-engine-chip dtts-engine-chip--ghost">
                  {mode === "solo"
                    ? (<><kbd>Tap</kbd> / <kbd>Space</kbd> / <kbd>W</kbd> / <kbd>↑</kbd> flap</>)
                    : (<><kbd>P1</kbd> <kbd>W</kbd>/<kbd>Space</kbd> · <kbd>P2</kbd> <kbd>↑</kbd>/<kbd>Enter</kbd></>)
                  }
                </div>
              </div>

              <div className="dtts-engine-ui-main" />

              <div className="dtts-engine-ui-bottom">
              </div>
            </div>
          </div>
        </section>

        <aside className="dtts-leaderboard" aria-label="Dont Touch The Spikes leaderboard">
          <div className="dtts-leaderboard-head">
            <h2>Leaderboard</h2>
            <span className="dtts-leaderboard-badge">Best score</span>
          </div>
          <div className="dtts-leaderboard-best">
            <span>Your Best</span>
            <strong>{shownBest.toLocaleString()}</strong>
          </div>
          <div className="dtts-leaderboard-list">
            {topLeaderboardRows.length === 0 ? (
              <p className="dtts-leaderboard-empty">No scores yet. Play to claim rank #1.</p>
            ) : (
              topLeaderboardRows.map((row, index) => (
                <div
                  key={`${row.uid}-${index}`}
                  className={`dtts-leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}
                >
                  <span className="dtts-leaderboard-rank">{index + 1}</span>
                  <div className="dtts-leaderboard-user">
                    <UserBox userId={row.uid} />
                  </div>
                  <strong className="dtts-leaderboard-score">{row.score.toLocaleString()}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
