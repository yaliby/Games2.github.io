import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { submitBlobBlastScore } from "../../services/scoreService";
import UserBox from "../UserBox/UserBox";
import "./BlobBlastGame.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "ready" | "playing" | "paused" | "gameover";
type PowerUpKind = "shield" | "rapid" | "multi";
type CollisionMode = "on" | "off";
type VisualMode = "neon" | "rainbow" | "sunset";
type ShipModel = "falcon" | "arrow" | "orb";

interface Bullet {
  x: number;
  y: number;
  prevX?: number;
  prevY?: number;
  vy: number;
  vx: number;
  r: number;
  hue: number; // for coloring (powerup tinted)
  kind?: "normal" | "laser" | "missile";
  pierce?: number;
}

interface Ball {
  id: number;
  x: number;
  y: number;
  laneY: number; // target apex Y for floor rebounds (field name kept for save compatibility)
  carrierKind?: PowerUpKind;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  trail: Array<{ x: number; y: number; age: number }>;
  flashTimer: number; // briefly flash white on hit
  wobble: number;     // deformation angle offset
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;       // 0..1 (1=fresh)
  maxLife: number;
  r: number;
  hue: number;
  kind: "spark" | "smoke" | "ring" | "debris";
  drag: number;
}

interface PowerUp {
  id: number;
  x: number;
  y: number;
  vy: number;
  kind: PowerUpKind;
  age: number;
  r: number;
  grounded: boolean;
  groundTimer: number;
}

interface World {
  phase: Phase;
  playerX: number;
  targetX: number;
  usePointer: boolean;
  safeTimer: number;
  bullets: Bullet[];
  balls: Ball[];
  particles: Particle[];
  powerUps: PowerUp[];
  shotCooldown: number;
  spawnCooldown: number;
  powerUpCooldown: number;
  score: number;
  elapsed: number;
  level: number;
  nextBallId: number;
  nextPowerUpId: number;
  shieldTimer: number;   // decay seconds remaining once shield is triggered
  shieldArmed: boolean;  // shield is waiting for first hit (no decay yet)
  rapidTimer: number;
  multiTimer: number;
  laserTimer: number;
  missileTimer: number;
  overdriveTimer: number;
  specialShotTick: number;
  combo: number;
  comboTimer: number;
  screenShake: number;
  playerBobTime: number;
}

interface KeyboardState {
  left: boolean;
  right: boolean;
}

interface LeaderboardRow {
  uid: string;
  username: string;
  score: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 430;
const HEIGHT = 720;
const GROUND_HEIGHT = 86;
const FLOOR_Y = HEIGHT - GROUND_HEIGHT;

const PLAYER_HALF_WIDTH = 30;
const PLAYER_SPEED = 420;
const POINTER_FOLLOW = 16;
const PHYSICS_STEP = 1 / 120;
const MAX_FRAME_DT = 0.05;
const MAX_ACCUMULATOR = 0.09;
const MAX_STEPS_PER_FRAME = 8;

const SHOOT_INTERVAL = 0.105;
const BULLET_SPEED = -720;
const BULLET_RADIUS = 5;
const MAX_BULLETS = 260;

const GRAVITY = 400;
// Strict cap — new spawns AND split children both honour this.
const MAX_BALLS = 20;
const BALL_CAP_START = 6;
const BALL_CAP_PER_LEVEL = 0.9;
const FRONTLINE_MIN_CAP = 2;
const FRONTLINE_MAX_CAP = 6;
const FRONTLINE_Y = FLOOR_Y - 230;
const FRONTLINE_X = 140;
const MIN_SIDE_SPEED = 28;
const DANGER_CORRIDOR_X = 118;
const DANGER_ZONE_TOP = FRONTLINE_Y - 30;
const DANGER_ZONE_BOTTOM = FLOOR_Y + 22;
const DANGER_ZONE_SOFT_CAP = 4;
const CONGESTION_COOLDOWN_BOOST = 0.72;
const LOCAL_REPULSION_MARGIN = 36;
const LOCAL_REPULSION_STRENGTH = 190;
const CROWD_PRESSURE_STRENGTH = 270;

// Ball Blast-like physics (2D, gravity + floor bounce)
const BALL_RESTITUTION_WALL = 0.92;
const BALL_RESTITUTION_FLOOR = 0.82;
const BALL_FLOOR_FRICTION = 0.985;   // applied while touching ground
const BALL_STOP_EPS = 22;            // px/s: small vertical bounces get clamped
const FLOOR_COLLISION_Y = FLOOR_Y - 6;
const BOUNCE_APEX_CENTER_Y = HEIGHT * 0.5;
const BOUNCE_APEX_UP_RELATIVE = 0.08; // relative to center->floor distance
const BOUNCE_APEX_UP_MIN = 6;
const BOUNCE_APEX_UP_MAX = 14;
const BOUNCE_ENERGY_BOOST = 0.98;
const POWERUP_FLOOR_STAY = 4;
const BONUS_BASE_COOLDOWN = 6.4;
const BONUS_COOLDOWN_MIN = 7;
const BONUS_COOLDOWN_MAX = 12;
const BONUS_EXTRA_SPAWN_CHANCE = 0.07;
const BONUS_PICKUP_RADIUS_GROUNDED = 16;
const BONUS_PICKUP_RADIUS_AIR = 8;
const BONUS_COLLECT_SCORE = 35;
const SHIELD_BREAK_DURATION = 3;
const RAPID_DURATION = 8;
const MULTI_DURATION = 9;
const LASER_DURATION = 6;
const MISSILE_DURATION = 6;
const OVERDRIVE_DURATION = 7;
const LASER_BASE_PIERCE = 4;
const MISSILE_HOMING_SPEED = 560;
const MISSILE_HOMING_STEER = 5.5;

const TRAIL_MAX = 9;

const BEST_STORAGE_KEY = "blob-blast-best-v2";
const BLOBBLAST_SAVE_VERSION = 1;
const BLOBBLAST_SAVE_KEY_PREFIX = "blob-blast-save-v1";
const SNAPSHOT_SAVE_INTERVAL_MS = 1200;
const REMOTE_SAVE_DEBOUNCE_MS = 1800;
const MAX_SAVED_PARTICLES = 180;
const MAX_SAVED_POWERUPS = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo: number, hi: number) { return lo + Math.random() * (hi - lo); }
function randInt(lo: number, hi: number) { return Math.floor(rand(lo, hi + 1)); }

function radiusFromHp(hp: number) { return clamp(13 + Math.sqrt(hp) * 3.6, 13, 74); }
function hueFromHp(hp: number)    { return clamp(210 - Math.sqrt(hp) * 7.5, 10, 210); }
function currentBallHue(ball: Pick<Ball, "hp">) { return hueFromHp(Math.max(1, ball.hp)); }

function readBest() {
  try { const n = Number(localStorage.getItem(BEST_STORAGE_KEY)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  catch { return 0; }
}
function writeBest(s: number) {
  try { localStorage.setItem(BEST_STORAGE_KEY, String(Math.max(0, Math.floor(s)))); } catch {}
}

interface BlobBlastSaveSettings {
  collisionMode: CollisionMode;
  visualMode: VisualMode;
  shipModel: ShipModel;
}

interface BlobBlastSaveSnapshot {
  v: number;
  savedAt: number;
  phase: Phase;
  settings: BlobBlastSaveSettings;
  world: World;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLeaderboardScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePhase(value: unknown): Phase {
  if (value === "ready" || value === "playing" || value === "paused" || value === "gameover") {
    return value;
  }
  return "ready";
}

function normalizeCollisionMode(value: unknown): CollisionMode {
  return value === "off" ? "off" : "on";
}

function normalizeVisualMode(value: unknown): VisualMode {
  if (value === "neon" || value === "rainbow" || value === "sunset") return value;
  return "rainbow";
}

function normalizeShipModel(value: unknown): ShipModel {
  if (value === "falcon" || value === "arrow" || value === "orb") return value;
  return "falcon";
}

function normalizePowerUpKind(value: unknown): PowerUpKind | undefined {
  if (value === "shield" || value === "rapid" || value === "multi") return value;
  return undefined;
}

function normalizeBullet(value: unknown): Bullet | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const vy = finiteNumber(value.vy, Number.NaN);
  const vx = finiteNumber(value.vx, Number.NaN);
  const r = finiteNumber(value.r, BULLET_RADIUS);
  const hue = finiteNumber(value.hue, 55);
  const kind =
    value.kind === "laser" || value.kind === "missile" || value.kind === "normal"
      ? value.kind
      : "normal";
  const rawPierce = Math.floor(finiteNumber(value.pierce, kind === "laser" ? LASER_BASE_PIERCE : 0));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(vx) || !Number.isFinite(vy)) return null;
  return {
    x,
    y,
    prevX: optionalFiniteNumber(value.prevX),
    prevY: optionalFiniteNumber(value.prevY),
    vy,
    vx,
    r: clamp(r, 1, 40),
    hue,
    kind,
    pierce: clamp(rawPierce, 0, 12),
  };
}

function normalizeBallTrailPoint(value: unknown): { x: number; y: number; age: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const age = Math.max(0, finiteNumber(value.age, 0));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, age };
}

function normalizeBall(value: unknown): Ball | null {
  if (!isRecord(value)) return null;
  const id = Math.max(1, Math.floor(finiteNumber(value.id, 0)));
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const r = clamp(finiteNumber(value.r, 18), 8, 120);
  const laneYCandidate = finiteNumber(value.laneY, Number.NaN);
  const laneY = Number.isFinite(laneYCandidate)
    && isValidBounceApexY(r, laneYCandidate)
    ? laneYCandidate
    : randomBounceApexY(r);
  const vx = finiteNumber(value.vx, Number.NaN);
  const vy = finiteNumber(value.vy, Number.NaN);
  const hp = Math.max(1, Math.floor(finiteNumber(value.hp, 1)));
  const maxHp = Math.max(hp, Math.floor(finiteNumber(value.maxHp, hp)));
  const flashTimer = Math.max(0, finiteNumber(value.flashTimer, 0));
  const wobble = finiteNumber(value.wobble, 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(vx) || !Number.isFinite(vy)) return null;

  const rawTrail = Array.isArray(value.trail) ? value.trail : [];
  const trail = rawTrail
    .map(normalizeBallTrailPoint)
    .filter((point): point is { x: number; y: number; age: number } => point !== null)
    .slice(-TRAIL_MAX);

  return {
    id,
    x,
    y,
    laneY,
    carrierKind: normalizePowerUpKind(value.carrierKind),
    vx,
    vy,
    r,
    hp,
    maxHp,
    trail,
    flashTimer,
    wobble,
  };
}

function normalizeParticle(value: unknown): Particle | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== "spark" && kind !== "smoke" && kind !== "ring" && kind !== "debris") return null;
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const vx = finiteNumber(value.vx, Number.NaN);
  const vy = finiteNumber(value.vy, Number.NaN);
  const life = finiteNumber(value.life, Number.NaN);
  const maxLife = finiteNumber(value.maxLife, Number.NaN);
  const r = finiteNumber(value.r, Number.NaN);
  const hue = finiteNumber(value.hue, 180);
  const drag = finiteNumber(value.drag, 0.92);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(vx) ||
    !Number.isFinite(vy) ||
    !Number.isFinite(life) ||
    !Number.isFinite(maxLife) ||
    !Number.isFinite(r)
  ) {
    return null;
  }
  return {
    x,
    y,
    vx,
    vy,
    life: clamp(life, 0, 1.2),
    maxLife: Math.max(0.05, maxLife),
    r: clamp(r, 0.5, 160),
    hue,
    kind,
    drag: clamp(drag, 0.6, 1),
  };
}

function normalizePowerUp(value: unknown): PowerUp | null {
  if (!isRecord(value)) return null;
  const kind = normalizePowerUpKind(value.kind);
  if (!kind) return null;
  const id = Math.max(1, Math.floor(finiteNumber(value.id, 0)));
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const vy = finiteNumber(value.vy, Number.NaN);
  const age = Math.max(0, finiteNumber(value.age, 0));
  const r = clamp(finiteNumber(value.r, 18), 8, 40);
  const grounded = Boolean(value.grounded);
  const groundTimer = Math.max(0, finiteNumber(value.groundTimer, POWERUP_FLOOR_STAY));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(vy)) return null;
  return {
    id,
    x,
    y,
    vy,
    kind,
    age,
    r,
    grounded,
    groundTimer,
  };
}

function cloneWorldForSave(source: World, phaseOverride?: Phase): World {
  const world: World = {
    ...source,
    phase: phaseOverride ?? source.phase,
    bullets: source.bullets.map((bullet) => ({ ...bullet })),
    balls: source.balls.map((ball) => ({
      ...ball,
      trail: ball.trail.map((point) => ({ ...point })),
    })),
    particles: source.particles.map((particle) => ({ ...particle })),
    powerUps: source.powerUps.map((powerUp) => ({ ...powerUp })),
  };
  world.particles = world.particles.slice(-MAX_SAVED_PARTICLES);
  world.powerUps = world.powerUps.slice(-MAX_SAVED_POWERUPS);
  return world;
}

function normalizeWorldSnapshot(value: unknown): World | null {
  if (!isRecord(value)) return null;
  const world = createWorld();

  world.phase = normalizePhase(value.phase);
  world.playerX = clamp(
    finiteNumber(value.playerX, WIDTH / 2),
    PLAYER_HALF_WIDTH + 2,
    WIDTH - PLAYER_HALF_WIDTH - 2
  );
  world.targetX = clamp(
    finiteNumber(value.targetX, world.playerX),
    PLAYER_HALF_WIDTH + 2,
    WIDTH - PLAYER_HALF_WIDTH - 2
  );
  world.usePointer = Boolean(value.usePointer);
  world.safeTimer = Math.max(0, finiteNumber(value.safeTimer, 0));
  world.shotCooldown = Math.max(0, finiteNumber(value.shotCooldown, 0));
  world.spawnCooldown = Math.max(0, finiteNumber(value.spawnCooldown, 0.5));
  world.powerUpCooldown = Math.max(0, finiteNumber(value.powerUpCooldown, BONUS_BASE_COOLDOWN));
  world.score = Math.max(0, Math.floor(finiteNumber(value.score, 0)));
  world.elapsed = Math.max(0, finiteNumber(value.elapsed, 0));
  world.level = Math.max(1, Math.floor(finiteNumber(value.level, 1)));
  world.nextBallId = Math.max(1, Math.floor(finiteNumber(value.nextBallId, 1)));
  world.nextPowerUpId = Math.max(1, Math.floor(finiteNumber(value.nextPowerUpId, 1)));
  world.shieldTimer = Math.max(0, finiteNumber(value.shieldTimer, 0));
  world.shieldArmed = Boolean(value.shieldArmed);
  world.rapidTimer = Math.max(0, finiteNumber(value.rapidTimer, 0));
  world.multiTimer = Math.max(0, finiteNumber(value.multiTimer, 0));
  world.laserTimer = Math.max(0, finiteNumber(value.laserTimer, 0));
  world.missileTimer = Math.max(0, finiteNumber(value.missileTimer, 0));
  world.overdriveTimer = Math.max(0, finiteNumber(value.overdriveTimer, 0));
  world.specialShotTick = Math.max(0, Math.floor(finiteNumber(value.specialShotTick, 0)));
  world.combo = Math.max(0, Math.floor(finiteNumber(value.combo, 0)));
  world.comboTimer = Math.max(0, finiteNumber(value.comboTimer, 0));
  world.screenShake = Math.max(0, finiteNumber(value.screenShake, 0));
  world.playerBobTime = Math.max(0, finiteNumber(value.playerBobTime, 0));

  const rawBullets = Array.isArray(value.bullets) ? value.bullets : [];
  world.bullets = rawBullets
    .map(normalizeBullet)
    .filter((bullet): bullet is Bullet => bullet !== null)
    .slice(-MAX_BULLETS);

  const rawBalls = Array.isArray(value.balls) ? value.balls : [];
  world.balls = rawBalls
    .map(normalizeBall)
    .filter((ball): ball is Ball => ball !== null)
    .slice(-MAX_BALLS);

  const rawParticles = Array.isArray(value.particles) ? value.particles : [];
  world.particles = rawParticles
    .map(normalizeParticle)
    .filter((particle): particle is Particle => particle !== null)
    .slice(-MAX_SAVED_PARTICLES);

  const rawPowerUps = Array.isArray(value.powerUps) ? value.powerUps : [];
  world.powerUps = rawPowerUps
    .map(normalizePowerUp)
    .filter((powerUp): powerUp is PowerUp => powerUp !== null)
    .slice(-MAX_SAVED_POWERUPS);

  let maxBallId = 0;
  for (const ball of world.balls) {
    if (ball.id > maxBallId) maxBallId = ball.id;
  }
  if (world.nextBallId <= maxBallId) world.nextBallId = maxBallId + 1;

  let maxPowerUpId = 0;
  for (const powerUp of world.powerUps) {
    if (powerUp.id > maxPowerUpId) maxPowerUpId = powerUp.id;
  }
  if (world.nextPowerUpId <= maxPowerUpId) world.nextPowerUpId = maxPowerUpId + 1;

  return world;
}

function normalizeSaveSettings(value: unknown): BlobBlastSaveSettings {
  if (!isRecord(value)) {
    return { collisionMode: "on", visualMode: "rainbow", shipModel: "falcon" };
  }
  return {
    collisionMode: normalizeCollisionMode(value.collisionMode),
    visualMode: normalizeVisualMode(value.visualMode),
    shipModel: normalizeShipModel(value.shipModel),
  };
}

function normalizeSaveSnapshot(value: unknown): BlobBlastSaveSnapshot | null {
  if (!isRecord(value)) return null;
  const world = normalizeWorldSnapshot(value.world);
  if (!world) return null;
  const phase = normalizePhase(value.phase ?? world.phase);
  world.phase = phase;
  const savedAt = Math.max(0, Math.floor(finiteNumber(value.savedAt, 0)));
  return {
    v: Math.floor(finiteNumber(value.v, BLOBBLAST_SAVE_VERSION)),
    savedAt,
    phase,
    settings: normalizeSaveSettings(value.settings),
    world,
  };
}

function getSaveStorageKey(uid: string | null): string {
  return uid ? `${BLOBBLAST_SAVE_KEY_PREFIX}:${uid}` : `${BLOBBLAST_SAVE_KEY_PREFIX}:guest`;
}

function readLocalSnapshot(uid: string | null): BlobBlastSaveSnapshot | null {
  try {
    const raw = localStorage.getItem(getSaveStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const snapshot = normalizeSaveSnapshot(parsed);
    if (!snapshot) {
      localStorage.removeItem(getSaveStorageKey(uid));
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(uid: string | null, snapshot: BlobBlastSaveSnapshot): void {
  try {
    localStorage.setItem(getSaveStorageKey(uid), JSON.stringify(snapshot));
  } catch {
    // Ignore local storage failures.
  }
}

function buildRemoteSavePayload(snapshot: BlobBlastSaveSnapshot): Record<string, unknown> {
  const world = snapshot.world;
  return {
    v: snapshot.v,
    savedAt: snapshot.savedAt,
    phase: snapshot.phase,
    settings: snapshot.settings,
    world: {
      ...world,
      bullets: world.bullets.map((bullet) => ({
        ...bullet,
        prevX: bullet.prevX ?? null,
        prevY: bullet.prevY ?? null,
      })),
      balls: world.balls.map((ball) => ({
        ...ball,
        carrierKind: ball.carrierKind ?? null,
        trail: ball.trail.map((point) => ({ ...point })),
      })),
      particles: world.particles.map((particle) => ({ ...particle })),
      powerUps: world.powerUps.map((powerUp) => ({ ...powerUp })),
    },
    updatedAt: serverTimestamp(),
  };
}

async function readRemoteSnapshot(uid: string): Promise<BlobBlastSaveSnapshot | null> {
  try {
    const saveRef = doc(db, "gameStates", "blob-blast", "users", uid);
    const snap = await getDoc(saveRef);
    if (!snap.exists()) return null;
    return normalizeSaveSnapshot(snap.data());
  } catch (err) {
    console.warn("blob blast remote save read failed:", err);
    return null;
  }
}

async function writeRemoteSnapshot(uid: string, snapshot: BlobBlastSaveSnapshot): Promise<void> {
  try {
    const saveRef = doc(db, "gameStates", "blob-blast", "users", uid);
    await setDoc(saveRef, buildRemoteSavePayload(snapshot), { merge: true });
  } catch (err) {
    console.warn("blob blast remote save write failed:", err);
  }
}

function pickLatestSnapshot(
  localSnapshot: BlobBlastSaveSnapshot | null,
  remoteSnapshot: BlobBlastSaveSnapshot | null
): BlobBlastSaveSnapshot | null {
  if (!localSnapshot) return remoteSnapshot;
  if (!remoteSnapshot) return localSnapshot;
  return remoteSnapshot.savedAt >= localSnapshot.savedAt ? remoteSnapshot : localSnapshot;
}

interface BallQuota {
  total: number;
  frontline: number;
}

interface VisualTheme {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  glowRgb: [number, number, number];
  groundTop: string;
  groundBottom: string;
  lineA: string;
  lineB: string;
  lineC: string;
  groundGrid: string;
  groundAccent: string;
  shipPrimary: string;
  shipSecondary: string;
  cockpitA: string;
  cockpitB: string;
  thrusterA: string;
  thrusterB: string;
  shield: string;
}

function getVisualTheme(mode: VisualMode): VisualTheme {
  if (mode === "rainbow") {
    return {
      skyTop: "#14031f",
      skyMid: "#142852",
      skyBottom: "#1a0f2e",
      glowRgb: [255, 110, 200],
      groundTop: "#2e1550",
      groundBottom: "#120a22",
      lineA: "rgba(255,120,200,0)",
      lineB: "rgba(130,255,225,0.88)",
      lineC: "rgba(255,220,120,0.8)",
      groundGrid: "rgba(255,255,255,0.14)",
      groundAccent: "rgba(255,210,120,0.24)",
      shipPrimary: "#ff4fd8",
      shipSecondary: "#6df9ff",
      cockpitA: "#fff5d8",
      cockpitB: "#77c8ff",
      thrusterA: "rgba(255,125,236,0.92)",
      thrusterB: "rgba(118,255,234,0.6)",
      shield: "rgba(250,130,255,0.78)",
    };
  }

  if (mode === "sunset") {
    return {
      skyTop: "#220614",
      skyMid: "#53210f",
      skyBottom: "#321016",
      glowRgb: [255, 150, 75],
      groundTop: "#4a1f12",
      groundBottom: "#1f0f11",
      lineA: "rgba(255,180,110,0)",
      lineB: "rgba(255,120,80,0.95)",
      lineC: "rgba(255,220,150,0.85)",
      groundGrid: "rgba(255,188,140,0.2)",
      groundAccent: "rgba(255,230,170,0.28)",
      shipPrimary: "#ff8f4a",
      shipSecondary: "#ffd25f",
      cockpitA: "#ffe8b2",
      cockpitB: "#ffb06c",
      thrusterA: "rgba(255,214,120,0.95)",
      thrusterB: "rgba(255,105,65,0.62)",
      shield: "rgba(255,160,100,0.78)",
    };
  }

  return {
    skyTop: "#030812",
    skyMid: "#07122a",
    skyBottom: "#0c1e3a",
    glowRgb: [80, 190, 255],
    groundTop: "#0e2040",
    groundBottom: "#060f1e",
    lineA: "rgba(80,180,255,0)",
    lineB: "rgba(80,200,255,0.7)",
    lineC: "rgba(160,230,255,0.9)",
    groundGrid: "rgba(60,130,200,0.14)",
    groundAccent: "rgba(120,220,255,0.26)",
    shipPrimary: "#3a7cb8",
    shipSecondary: "#2a5a90",
    cockpitA: "#e0f8ff",
    cockpitB: "#88d4f8",
    thrusterA: "rgba(120,200,255,0.92)",
    thrusterB: "rgba(60,140,255,0.54)",
    shield: "rgba(120,230,255,0.78)",
  };
}

function getActiveBallQuota(level: number): BallQuota {
  const total = clamp(
    Math.floor(BALL_CAP_START + (level - 1) * BALL_CAP_PER_LEVEL),
    BALL_CAP_START,
    MAX_BALLS
  );

  const frontline = clamp(
    Math.floor(FRONTLINE_MIN_CAP + (level - 1) * 0.2),
    FRONTLINE_MIN_CAP,
    Math.min(FRONTLINE_MAX_CAP, total)
  );

  return { total, frontline };
}

function countFrontlineBalls(world: World): number {
  let count = 0;
  for (const ball of world.balls) {
    const isNearPlayerX = Math.abs(ball.x - world.playerX) <= FRONTLINE_X;
    const isNearPlayerY = ball.y + ball.r >= FRONTLINE_Y;
    if (isNearPlayerX && isNearPlayerY) count += 1;
  }
  return count;
}

function countDangerZoneBalls(world: World): number {
  let count = 0;
  for (const ball of world.balls) {
    const inDangerX = Math.abs(ball.x - world.playerX) <= DANGER_CORRIDOR_X;
    const inDangerY = ball.y + ball.r >= DANGER_ZONE_TOP && ball.y - ball.r <= DANGER_ZONE_BOTTOM;
    if (inDangerX && inDangerY) count += 1;
  }
  return count;
}

function applyAntiOvercrowdForces(world: World, dt: number): void {
  const balls = world.balls;
  if (balls.length < 2) return;

  const dangerCount = countDangerZoneBalls(world);
  if (dangerCount > DANGER_ZONE_SOFT_CAP) {
    const overload = dangerCount - DANGER_ZONE_SOFT_CAP;
    const sidePushBase = (CROWD_PRESSURE_STRENGTH + world.level * 12) * Math.min(2, 1 + overload * 0.3);
    for (const ball of balls) {
      const inDangerY = ball.y + ball.r >= DANGER_ZONE_TOP && ball.y - ball.r <= DANGER_ZONE_BOTTOM;
      if (!inDangerY) continue;
      const dxPlayer = ball.x - world.playerX;
      if (Math.abs(dxPlayer) > DANGER_CORRIDOR_X * 1.05) continue;

      const side = Math.abs(dxPlayer) < 0.8 ? (ball.id % 2 === 0 ? -1 : 1) : Math.sign(dxPlayer);
      const corridorRatio = 1 - clamp(Math.abs(dxPlayer) / DANGER_CORRIDOR_X, 0, 1);
      const sidePush = sidePushBase * corridorRatio;
      ball.vx += side * sidePush * dt;
      ball.vy -= (90 + overload * 26) * corridorRatio * dt;
    }
  }

  // Soft local repulsion to prevent "traffic jams" while keeping motion organic.
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i];
      const b = balls[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const range = a.r + b.r + LOCAL_REPULSION_MARGIN;
      const rangeSq = range * range;
      if (distSq >= rangeSq) continue;

      const dist = Math.sqrt(Math.max(0.0001, distSq));
      const nx = dx / dist;
      const ny = dy / dist;
      const proximity = 1 - dist / range;
      const impulse = LOCAL_REPULSION_STRENGTH * proximity * proximity;
      const groundBias = (a.y > FRONTLINE_Y || b.y > FRONTLINE_Y) ? 1.35 : 1;

      a.vx -= nx * impulse * dt;
      b.vx += nx * impulse * dt;
      const lift = Math.abs(ny) * impulse * 0.18 * groundBias * dt;
      a.vy -= lift;
      b.vy -= lift;
    }
  }

  for (const ball of balls) {
    ball.vx = clamp(ball.vx, -760, 760);
    ball.vy = clamp(ball.vy, -980, 980);
  }
}

function segmentIntersectsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = 0;
  if (abLenSq > 0.0001) {
    t = ((cx - ax) * abx + (cy - ay) * aby) / abLenSq;
    t = clamp(t, 0, 1);
  }
  const px = ax + abx * t;
  const py = ay + aby * t;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy <= radius * radius;
}

function pickSpawnY(radius: number): number {
  // Spawn above the visible area (Ball Blast style)
  return -radius - rand(30, 170);
}

function bounceApexBounds(ballRadius: number): { minY: number; maxY: number } {
  const floorCenterY = FLOOR_COLLISION_Y - ballRadius;
  const centerY = Math.min(BOUNCE_APEX_CENTER_Y, floorCenterY - 12);
  const centerToFloor = Math.max(24, floorCenterY - centerY);
  const upBand = clamp(
    centerToFloor * BOUNCE_APEX_UP_RELATIVE,
    BOUNCE_APEX_UP_MIN,
    BOUNCE_APEX_UP_MAX
  );
  // Apex range is from screen middle and slightly upward only.
  const minY = centerY - upBand;
  const maxY = centerY;
  return { minY, maxY };
}

function isValidBounceApexY(ballRadius: number, apexY: number): boolean {
  const { minY, maxY } = bounceApexBounds(ballRadius);
  return apexY >= minY && apexY <= maxY;
}

function randomBounceApexY(ballRadius: number): number {
  const { minY, maxY } = bounceApexBounds(ballRadius);
  return rand(minY, maxY);
}

function minBounceVyForApex(ballRadius: number, targetApexY: number): number {
  const floorCenterY = FLOOR_COLLISION_Y - ballRadius;
  const { minY, maxY } = bounceApexBounds(ballRadius);
  const clampedApexY = clamp(targetApexY, minY, maxY);
  const effectiveApexY = Math.min(clampedApexY, floorCenterY - 4);
  const travel = Math.max(8, floorCenterY - effectiveApexY);
  return -Math.sqrt(2 * GRAVITY * travel) * BOUNCE_ENERGY_BOOST;
}

function ensureBallBounceApexY(ball: Ball): number {
  if (!Number.isFinite(ball.laneY) || !isValidBounceApexY(ball.r, ball.laneY)) {
    ball.laneY = randomBounceApexY(ball.r);
  }
  return ball.laneY;
}

function pushBullet(world: World, bullet: Bullet): void {
  world.bullets.push(bullet);
  if (world.bullets.length > MAX_BULLETS) {
    world.bullets.splice(0, world.bullets.length - MAX_BULLETS);
  }
}

function randomPowerUpKind(): PowerUpKind {
  const kinds: PowerUpKind[] = ["shield", "rapid", "multi"];
  return kinds[Math.floor(Math.random() * kinds.length)];
}

function findClosestBall(balls: Ball[], x: number, y: number): Ball | null {
  let best: Ball | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const ball of balls) {
    const dx = ball.x - x;
    const dy = ball.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = ball;
    }
  }
  return best;
}

function applyCollectedPowerUp(world: World, kind: PowerUpKind): void {
  if (kind === "shield") {
    world.shieldArmed = true;
    world.shieldTimer = SHIELD_BREAK_DURATION;
    return;
  }

  if (kind === "rapid") {
    const hadRapid = world.rapidTimer > 0;
    const hadMulti = world.multiTimer > 0;
    world.rapidTimer = Math.max(world.rapidTimer, RAPID_DURATION);
    if (hadRapid) {
      world.laserTimer = Math.max(world.laserTimer, LASER_DURATION);
    }
    if (hadMulti) {
      world.overdriveTimer = Math.max(world.overdriveTimer, OVERDRIVE_DURATION);
    }
    return;
  }

  const hadRapid = world.rapidTimer > 0;
  const hadMulti = world.multiTimer > 0;
  world.multiTimer = Math.max(world.multiTimer, MULTI_DURATION);
  if (hadMulti) {
    world.missileTimer = Math.max(world.missileTimer, MISSILE_DURATION);
  }
  if (hadRapid) {
    world.overdriveTimer = Math.max(world.overdriveTimer, OVERDRIVE_DURATION);
  }
}

function countCarrierBalls(world: World): number {
  let count = 0;
  for (const ball of world.balls) {
    if (ball.carrierKind) count += 1;
  }
  return count;
}

// ─── World factory ────────────────────────────────────────────────────────────

function createWorld(): World {
  return {
    phase: "ready",
    playerX: WIDTH / 2, targetX: WIDTH / 2, usePointer: false, safeTimer: 0,
    bullets: [], balls: [], particles: [], powerUps: [],
    shotCooldown: 0, spawnCooldown: 1, powerUpCooldown: BONUS_BASE_COOLDOWN,
    score: 0, elapsed: 0, level: 1,
    nextBallId: 1, nextPowerUpId: 1,
    shieldTimer: 0, shieldArmed: false, rapidTimer: 0, multiTimer: 0,
    laserTimer: 0, missileTimer: 0, overdriveTimer: 0, specialShotTick: 0,
    combo: 0, comboTimer: 0,
    screenShake: 0, playerBobTime: 0,
  };
}

// ─── Particles ────────────────────────────────────────────────────────────────

function spawnExplosion(world: World, x: number, y: number, r: number, hue: number) {
  const count = Math.floor(r * 1.4) + 6;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(60, 260 + r * 1.5);
    world.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(0, 80),
      life: 1, maxLife: rand(0.45, 0.95),
      r: rand(2, Math.max(3, r * 0.22)),
      hue: hue + rand(-20, 20),
      kind: Math.random() < 0.65 ? "spark" : "debris",
      drag: rand(0.88, 0.96),
    });
  }
  // ring shockwave
  world.particles.push({
    x, y, vx: 0, vy: 0, life: 1, maxLife: 0.35,
    r: r * 0.5, hue, kind: "ring", drag: 1,
  });
  // smoke puffs
  for (let i = 0; i < 4; i++) {
    world.particles.push({
      x: x + rand(-r * 0.4, r * 0.4),
      y: y + rand(-r * 0.4, r * 0.4),
      vx: rand(-30, 30), vy: rand(-60, -10),
      life: 1, maxLife: rand(0.7, 1.2),
      r: rand(r * 0.4, r * 0.8),
      hue, kind: "smoke", drag: 0.97,
    });
  }
}

function spawnHitSpark(world: World, x: number, y: number, hue: number) {
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(80, 200);
    world.particles.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 1, maxLife: rand(0.18, 0.38),
      r: rand(1.5, 3.5), hue,
      kind: "spark", drag: 0.92,
    });
  }
}

function updateParticles(world: World, dt: number) {
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life -= dt / p.maxLife;
    if (p.life <= 0) { world.particles.splice(i, 1); continue; }
    if (p.kind !== "ring") {
      p.vx *= p.drag;
      p.vy *= p.drag;
      if (p.kind !== "smoke") p.vy += GRAVITY * 0.18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    } else {
      // ring grows outward
      p.r += (160 + p.r * 0.5) * dt;
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const t = p.life;
    ctx.save();
    if (p.kind === "spark" || p.kind === "debris") {
      ctx.globalAlpha = Math.min(1, t * 2.2) * t;
      if (p.kind === "debris") {
        ctx.fillStyle = `hsla(${p.hue}, 80%, 68%, 1)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * t, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // elongated spark
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillStyle = `hsla(${p.hue + 30}, 100%, 88%, 1)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 2.8, p.r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.kind === "smoke") {
      ctx.globalAlpha = t * 0.22;
      ctx.fillStyle = `hsla(${p.hue}, 30%, 70%, 1)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (2 - t), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "ring") {
      ctx.globalAlpha = t * 0.7;
      ctx.strokeStyle = `hsla(${p.hue}, 100%, 75%, 1)`;
      ctx.lineWidth = Math.max(1, 5 * t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ─── Spawning ─────────────────────────────────────────────────────────────────

function spawnBall(world: World, carrierKind?: PowerUpKind) {
  // Similar to Ball Blast: balls enter from the top and fall under gravity.
  const lf = 1 + world.elapsed / 16;
  const minHp = 4 + Math.floor(lf * 1.3);
  const maxHp = 10 + Math.floor(lf * 4.2);
  const hp = Math.max(3, randInt(minHp, maxHp));
  const r = radiusFromHp(hp);

  const y = pickSpawnY(r);
  let x = rand(r + 6, WIDTH - r - 6);

  // Retry a few times to avoid unfair spawn stacks directly above the player.
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidateX = rand(r + 6, WIDTH - r - 6);
    let blocked = false;
    for (const other of world.balls) {
      const dx = other.x - candidateX;
      const dy = other.y - y;
      const minDist = (other.r + r) * 0.88;
      if (dx * dx + dy * dy < minDist * minDist) {
        blocked = true;
        break;
      }
    }
    if (!blocked && Math.abs(candidateX - world.playerX) < r + PLAYER_HALF_WIDTH + 14 && Math.random() < 0.75) {
      blocked = true;
    }
    if (!blocked) {
      x = candidateX;
      break;
    }
  }

  const vxBase = 60 + world.level * 10;
  const vx = rand(-vxBase, vxBase) * (Math.random() < 0.12 ? 1.6 : 1);
  const vy = rand(70, 140) + world.level * 6;

  world.balls.push({
    id: world.nextBallId++,
    x, y,
    laneY: randomBounceApexY(r),
    carrierKind,
    vx, vy,
    r, hp, maxHp: hp,
    trail: [],
    flashTimer: 0,
    wobble: Math.random() * Math.PI * 2,
  });
}

function splitBall(world: World, src: Ball, maxAllowedBalls: number): void {
  // Ball Blast: larger balls split into two smaller ones with an upward kick.
  if (src.maxHp < 8) return;

  const childHp = Math.floor(src.maxHp / 2);
  if (childHp < 3) return;

  const childR = radiusFromHp(childHp);

  const baseH = Math.max(120, Math.abs(src.vx) * 0.65 + 90);
  const baseUp = 240 + rand(0, 120);

  for (const dir of [-1, 1] as const) {
    if (world.balls.length >= maxAllowedBalls) break;

    world.balls.push({
      id: world.nextBallId++,
      x: clamp(src.x + dir * childR * 0.8, childR + 2, WIDTH - childR - 2),
      y: src.y - childR * 0.3,
      laneY: randomBounceApexY(childR),
      carrierKind: undefined,
      vx: dir * (baseH + rand(0, 55)),
      vy: -baseUp,
      r: childR,
      hp: childHp,
      maxHp: childHp,
      trail: [],
      flashTimer: 0,
      wobble: Math.random() * Math.PI * 2,
    });
  }
}

function spawnPowerUpDrop(world: World, kind: PowerUpKind, x: number, y: number): void {
  world.powerUps.push({
    id: world.nextPowerUpId++,
    x: clamp(x, 24, WIDTH - 24),
    y,
    vy: rand(110, 170),
    kind,
    age: 0,
    r: 18,
    grounded: false,
    groundTimer: POWERUP_FLOOR_STAY,
  });
}

// ─── Ball-ball collision ──────────────────────────────────────────────────────
// 2D circle collision response with iterative stabilization.

function resolveBallCollisions(balls: Ball[]) {
  // Run a couple passes for stable separation when many balls cluster.
  const restitution = 0.88;
  const slop = 0.6;
  const correctionPercent = 0.92;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.r + b.r;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(Math.max(0.000001, distSq));
        const nx = dist > 0.0001 ? dx / dist : 1;
        const ny = dist > 0.0001 ? dy / dist : 0;

        const massA = Math.max(1, a.r * a.r);
        const massB = Math.max(1, b.r * b.r);
        const invMassA = 1 / massA;
        const invMassB = 1 / massB;
        const invMassSum = invMassA + invMassB;
        if (invMassSum <= 0) continue;

        const overlap = minDist - dist;
        const correction = Math.max(overlap - slop, 0) * correctionPercent;
        const corrX = (correction * nx) / invMassSum;
        const corrY = (correction * ny) / invMassSum;

        a.x -= corrX * invMassA;
        a.y -= corrY * invMassA;
        b.x += corrX * invMassB;
        b.y += corrY * invMassB;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relAlongNormal = rvx * nx + rvy * ny;
        if (relAlongNormal >= -0.2) continue;

        const impulse = (-(1 + restitution) * relAlongNormal) / invMassSum;
        const ix = impulse * nx;
        const iy = impulse * ny;

        a.vx -= ix * invMassA;
        a.vy -= iy * invMassA;
        b.vx += ix * invMassB;
        b.vy += iy * invMassB;
      }
    }
  }
}

// ─── Player hit check ─────────────────────────────────────────────────────────

type PlayerHitShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "capsule"; x1: number; y1: number; x2: number; y2: number; r: number };

function playerBaseY(world: Pick<World, "playerBobTime">): number {
  return FLOOR_Y - 4 + Math.sin(world.playerBobTime * 4.5) * 1.5;
}

function getPlayerHitShapes(playerX: number, baseY: number, shipModel: ShipModel): PlayerHitShape[] {
  if (shipModel === "arrow") {
    return [
      { kind: "capsule", x1: playerX, y1: baseY - 50, x2: playerX, y2: baseY - 16, r: 8.5 },
      { kind: "circle", x: playerX - 12, y: baseY - 8, r: 7.2 },
      { kind: "circle", x: playerX + 12, y: baseY - 8, r: 7.2 },
      { kind: "capsule", x1: playerX, y1: baseY - 54, x2: playerX, y2: baseY - 50, r: 4.1 },
    ];
  }
  if (shipModel === "orb") {
    return [
      { kind: "capsule", x1: playerX - 9, y1: baseY - 10, x2: playerX + 9, y2: baseY - 10, r: 18.6 },
      { kind: "circle", x: playerX, y: baseY - 30, r: 8.6 },
      { kind: "capsule", x1: playerX, y1: baseY - 52, x2: playerX, y2: baseY - 22, r: 4.8 },
    ];
  }
  return [
    { kind: "capsule", x1: playerX - 22, y1: baseY - 7, x2: playerX + 22, y2: baseY - 7, r: 8.4 },
    { kind: "circle", x: playerX, y: baseY - 20, r: 11.2 },
    { kind: "circle", x: playerX - 16, y: baseY - 8, r: 5.5 },
    { kind: "circle", x: playerX + 16, y: baseY - 8, r: 5.5 },
    { kind: "circle", x: playerX, y: baseY - 30, r: 8.8 },
    { kind: "capsule", x1: playerX, y1: baseY - 52, x2: playerX, y2: baseY - 22, r: 5.1 },
  ];
}

function pointSegmentDistanceSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const segLenSq = sx * sx + sy * sy;
  if (segLenSq <= 1e-8) {
    const dx = px - x1;
    const dy = py - y1;
    return dx * dx + dy * dy;
  }
  const t = clamp(((px - x1) * sx + (py - y1) * sy) / segLenSq, 0, 1);
  const qx = x1 + sx * t;
  const qy = y1 + sy * t;
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

function ballIntersectsPlayerShape(ball: Ball, shape: PlayerHitShape): boolean {
  if (shape.kind === "circle") {
    const dx = ball.x - shape.x;
    const dy = ball.y - shape.y;
    const r = ball.r + shape.r;
    return dx * dx + dy * dy <= r * r;
  }
  const r = ball.r + shape.r;
  return pointSegmentDistanceSq(ball.x, ball.y, shape.x1, shape.y1, shape.x2, shape.y2) <= r * r;
}

function checkPlayerHit(world: World, shipModel: ShipModel): boolean {
  const hitShapes = getPlayerHitShapes(world.playerX, playerBaseY(world), shipModel);
  for (const ball of world.balls) {
    for (const shape of hitShapes) {
      if (ballIntersectsPlayerShape(ball, shape)) return true;
    }
  }
  return false;
}

// ─── Update ───────────────────────────────────────────────────────────────────

function updateWorld(
  world: World,
  dt: number,
  keys: KeyboardState,
  ballCollisionEnabled: boolean,
  shipModel: ShipModel
) {
  world.elapsed += dt;
  world.level = 1 + Math.floor(world.elapsed / 18);
  world.playerBobTime += dt;
  world.screenShake = Math.max(0, world.screenShake - dt * 18);

  // combo timeout
  world.comboTimer -= dt;
  if (world.comboTimer <= 0) world.combo = 0;

  // powerup timers
  world.safeTimer = Math.max(0, world.safeTimer - dt);
  if (!world.shieldArmed && world.shieldTimer > 0) {
    world.shieldTimer = Math.max(0, world.shieldTimer - dt);
    if (world.shieldTimer <= 0) {
      world.shieldArmed = false;
    }
  }
  world.rapidTimer = Math.max(0, world.rapidTimer - dt);
  world.multiTimer = Math.max(0, world.multiTimer - dt);
  world.laserTimer = Math.max(0, world.laserTimer - dt);
  world.missileTimer = Math.max(0, world.missileTimer - dt);
  world.overdriveTimer = Math.max(0, world.overdriveTimer - dt);

  // player movement
  if (!world.usePointer) {
    const dir = Number(keys.right) - Number(keys.left);
    if (dir !== 0) { world.playerX += dir * PLAYER_SPEED * dt; world.targetX = world.playerX; }
  }
  const lb = PLAYER_HALF_WIDTH + 2, rb = WIDTH - PLAYER_HALF_WIDTH - 2;
  world.targetX = clamp(world.targetX, lb, rb);
  world.playerX += (world.targetX - world.playerX) * Math.min(1, POINTER_FOLLOW * dt);
  world.playerX = clamp(world.playerX, lb, rb);

  // shooting
  world.shotCooldown -= dt;
  const rapidActive = world.rapidTimer > 0;
  const multiActive = world.multiTimer > 0;
  const laserActive = world.laserTimer > 0;
  const missileActive = world.missileTimer > 0;
  const overdriveActive = world.overdriveTimer > 0 || (rapidActive && multiActive);
  const baseInterval = Math.max(0.06, SHOOT_INTERVAL - (world.level - 1) * 0.003);
  let interval = rapidActive ? baseInterval * 0.38 : baseInterval;
  if (overdriveActive) interval *= 0.84;
  if (laserActive) interval *= 0.9;
  interval = Math.max(0.028, interval);
  const tripleShot = multiActive || overdriveActive;
  while (world.shotCooldown <= 0) {
    world.specialShotTick += 1;
    const bHue = laserActive
      ? 52
      : overdriveActive
        ? 330
        : rapidActive
          ? 45
          : multiActive
            ? 300
            : 55;
    pushBullet(world, {
      x: world.playerX,
      y: FLOOR_Y - 44,
      prevX: world.playerX,
      prevY: FLOOR_Y - 44,
      vy: laserActive ? BULLET_SPEED * 1.25 : BULLET_SPEED,
      vx: 0,
      r: laserActive ? BULLET_RADIUS + 2.3 : BULLET_RADIUS,
      hue: bHue,
      kind: laserActive ? "laser" : "normal",
      pierce: laserActive ? LASER_BASE_PIERCE : 0,
    });
    if (tripleShot) {
      const spread = overdriveActive ? 92 : 60;
      const sideRadius = laserActive ? BULLET_RADIUS + 1.1 : BULLET_RADIUS;
      pushBullet(world, {
        x: world.playerX - 16,
        y: FLOOR_Y - 36,
        prevX: world.playerX - 16,
        prevY: FLOOR_Y - 36,
        vy: laserActive ? BULLET_SPEED * 1.15 : BULLET_SPEED * 0.96,
        vx: -spread,
        r: sideRadius,
        hue: bHue,
        kind: laserActive ? "laser" : "normal",
        pierce: laserActive ? Math.max(1, LASER_BASE_PIERCE - 1) : 0,
      });
      pushBullet(world, {
        x: world.playerX + 16,
        y: FLOOR_Y - 36,
        prevX: world.playerX + 16,
        prevY: FLOOR_Y - 36,
        vy: laserActive ? BULLET_SPEED * 1.15 : BULLET_SPEED * 0.96,
        vx: spread,
        r: sideRadius,
        hue: bHue,
        kind: laserActive ? "laser" : "normal",
        pierce: laserActive ? Math.max(1, LASER_BASE_PIERCE - 1) : 0,
      });
    }

    if (missileActive && world.specialShotTick % 2 === 0) {
      for (const dir of [-1, 1] as const) {
        pushBullet(world, {
          x: world.playerX + dir * 18,
          y: FLOOR_Y - 34,
          prevX: world.playerX + dir * 18,
          prevY: FLOOR_Y - 34,
          vy: BULLET_SPEED * 0.55,
          vx: dir * 120,
          r: BULLET_RADIUS + 1.4,
          hue: 290,
          kind: "missile",
          pierce: 0,
        });
      }
    }
    world.shotCooldown += interval;
  }

  // spawn balls with dynamic quota (overall + frontline near player)
  const ballQuota = getActiveBallQuota(world.level);
  world.powerUpCooldown -= dt;
  world.spawnCooldown -= dt;
  if (world.balls.length < ballQuota.total) {
    while (world.spawnCooldown <= 0) {
      if (world.balls.length >= ballQuota.total) break;

      const frontlineCount = countFrontlineBalls(world);
      const dangerCount = countDangerZoneBalls(world);
      if (frontlineCount >= ballQuota.frontline) {
        world.spawnCooldown += rand(0.22, 0.48);
        break;
      }
      if (dangerCount > DANGER_ZONE_SOFT_CAP) {
        const overload = dangerCount - DANGER_ZONE_SOFT_CAP;
        world.spawnCooldown += rand(0.28, 0.56) * (1 + overload * 0.45);
        break;
      }

      let carrierKind: PowerUpKind | undefined;
      const carrierCount = countCarrierBalls(world);
      const extraRoll = Math.random() < BONUS_EXTRA_SPAWN_CHANCE;
      const shouldSpawnCarrier = carrierCount < 2 && (world.powerUpCooldown <= 0 || extraRoll);
      if (shouldSpawnCarrier) {
        carrierKind = randomPowerUpKind();
        world.powerUpCooldown = rand(BONUS_COOLDOWN_MIN, BONUS_COOLDOWN_MAX);
      }
      spawnBall(world, carrierKind);
      const pressure = world.balls.length / ballQuota.total;
      const frontlineRatio = frontlineCount / Math.max(1, ballQuota.frontline);
      const dangerRatio = dangerCount / Math.max(1, DANGER_ZONE_SOFT_CAP);
      const congestion = Math.max(0, frontlineRatio - 0.85) + Math.max(0, dangerRatio - 0.9);
      const base = Math.max(0.55, 1.7 - world.level * 0.05);
      world.spawnCooldown += rand(base * 0.82, base * 1.2) * (1 + pressure * 0.32 + congestion * CONGESTION_COOLDOWN_BOOST);
    }
  } else {
    world.spawnCooldown = Math.max(world.spawnCooldown, 0.22);
  }

  // update bullets
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    b.prevX = b.x;
    b.prevY = b.y;

    if (b.kind === "missile") {
      const target = findClosestBall(world.balls, b.x, b.y);
      if (target) {
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        const len = Math.hypot(dx, dy) || 1;
        const desiredVx = (dx / len) * MISSILE_HOMING_SPEED;
        const desiredVy = (dy / len) * MISSILE_HOMING_SPEED;
        const steer = Math.min(1, MISSILE_HOMING_STEER * dt);
        b.vx += (desiredVx - b.vx) * steer;
        b.vy += (desiredVy - b.vy) * steer;
      } else {
        b.vy = Math.min(b.vy + GRAVITY * 0.12 * dt, -140);
      }
    }

    b.y += b.vy * dt;
    b.x += b.vx * dt;
    if (b.y + b.r < -24 || b.y - b.r > HEIGHT + 40 || b.x < -28 || b.x > WIDTH + 28) {
      world.bullets.splice(i, 1);
    }
  }

  // update balls + trails (gravity + bounce)
  for (const ball of world.balls) {
    ball.flashTimer = Math.max(0, ball.flashTimer - dt);
    ball.wobble += dt * (2 + Math.abs(ball.vx) * 0.008);

    // integrate
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // trail
    ball.trail.push({ x: ball.x, y: ball.y, age: 0 });
    if (ball.trail.length > TRAIL_MAX) ball.trail.shift();
    for (const t of ball.trail) t.age += dt;

    // collide with arena walls (left/right)
    if (ball.x - ball.r <= 0) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx) * BALL_RESTITUTION_WALL;
    } else if (ball.x + ball.r >= WIDTH) {
      ball.x = WIDTH - ball.r;
      ball.vx = -Math.abs(ball.vx) * BALL_RESTITUTION_WALL;
    }

    // floor bounce / roll
    if (ball.y + ball.r >= FLOOR_COLLISION_Y) {
      ball.y = FLOOR_COLLISION_Y - ball.r;

      if (ball.vy > 0) {
        const dampedVy = -ball.vy * BALL_RESTITUTION_FLOOR;
        const minRequiredVy = Math.min(
          minBounceVyForApex(ball.r, ensureBallBounceApexY(ball)),
          -BALL_STOP_EPS
        );
        // Hard rule: rebounds stay energetic and don't decay too low.
        ball.vy = Math.min(dampedVy, minRequiredVy);
      }

      // friction on ground
      ball.vx *= BALL_FLOOR_FRICTION;

      // keep balls from getting "stuck" in place on the floor
      if (Math.abs(ball.vx) < MIN_SIDE_SPEED) {
        const direction = Math.abs(ball.vx) < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(ball.vx);
        ball.vx = direction * MIN_SIDE_SPEED;
      }
    }

    // keep extreme values sane (rare numeric blowups on stacked collisions)
    ball.vx = clamp(ball.vx, -760, 760);
    ball.vy = clamp(ball.vy, -980, 980);
  }

  // optional ball-ball collisions
  if (ballCollisionEnabled) {
    resolveBallCollisions(world.balls);
  }
  applyAntiOvercrowdForces(world, dt);

  // update power-ups
  for (let i = world.powerUps.length - 1; i >= 0; i--) {
    const pu = world.powerUps[i];
    pu.age += dt;

    if (!pu.grounded) {
      pu.vy += GRAVITY * 0.82 * dt;
      pu.y += pu.vy * dt;
      if (pu.y + pu.r >= FLOOR_COLLISION_Y) {
        pu.y = FLOOR_COLLISION_Y - pu.r;
        pu.vy = 0;
        pu.grounded = true;
        pu.groundTimer = POWERUP_FLOOR_STAY;
      } else if (pu.y > HEIGHT + 40) {
        world.powerUps.splice(i, 1);
        continue;
      }
    } else {
      pu.groundTimer -= dt;
      if (pu.groundTimer <= 0) {
        world.powerUps.splice(i, 1);
        continue;
      }
    }

    // player collects
    const pickupBonus = pu.grounded ? BONUS_PICKUP_RADIUS_GROUNDED : BONUS_PICKUP_RADIUS_AIR;
    const pickupRadius = PLAYER_HALF_WIDTH + pu.r + pickupBonus;
    const dx = world.playerX - pu.x, dy = (FLOOR_Y - 20) - pu.y;
    if (dx * dx + dy * dy < pickupRadius * pickupRadius) {
      world.powerUps.splice(i, 1);
      world.score += BONUS_COLLECT_SCORE;
      applyCollectedPowerUp(world, pu.kind);
    }
  }

  // bullet-ball collision
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const bullet = world.bullets[i];
    const kind = bullet.kind ?? "normal";
    const damage = kind === "laser" ? 2 : kind === "missile" ? 2 : 1;
    const fromX = bullet.prevX ?? bullet.x;
    const fromY = bullet.prevY ?? bullet.y;
    const toX = bullet.x;
    const toY = bullet.y;
    let removeBullet = false;
    for (let j = world.balls.length - 1; j >= 0; j--) {
      const ball = world.balls[j];
      const collisionRadius = bullet.r + ball.r;
      if (!segmentIntersectsCircle(fromX, fromY, toX, toY, ball.x, ball.y, collisionRadius)) {
        continue;
      }
      removeBullet = true;
      const impactHue = currentBallHue(ball);
      ball.hp -= damage;
      ball.flashTimer = 0.07;
      spawnHitSpark(world, toX, toY, impactHue);
      if (kind === "missile") {
        spawnExplosion(world, toX, toY, Math.max(10, bullet.r * 2.6), 292);
        world.screenShake = Math.min(world.screenShake + 0.16, 0.85);
      }
      if (ball.hp <= 0) {
        world.combo++;
        world.comboTimer = 2.2;
        const comboMul = 1 + Math.floor(world.combo / 3) * 0.5;
        world.score += Math.ceil(ball.maxHp * comboMul);
        spawnExplosion(world, ball.x, ball.y, ball.r, impactHue);
        world.screenShake = Math.min(world.screenShake + 0.25, 0.8);
        const destroyed = world.balls.splice(j, 1)[0];
        if (destroyed.carrierKind) {
          spawnPowerUpDrop(
            world,
            destroyed.carrierKind,
            destroyed.x,
            destroyed.y - destroyed.r * 0.2
          );
        }
        splitBall(world, destroyed, ballQuota.total);
      }

      if (kind === "laser" && (bullet.pierce ?? 0) > 0) {
        bullet.pierce = Math.max(0, (bullet.pierce ?? 0) - 1);
        removeBullet = false;
      }
      break;
    }
    if (removeBullet) world.bullets.splice(i, 1);
  }

  // player hit
  if (checkPlayerHit(world, shipModel) && world.safeTimer <= 0) {
    if (world.shieldTimer > 0) {
      if (world.shieldArmed) {
        // First impact consumes the shield and starts the 3s blinking decay.
        world.shieldArmed = false;
        world.screenShake = Math.min(world.screenShake + 0.22, 0.9);
        world.safeTimer = Math.max(world.safeTimer, 0.08);
      }
    } else {
      world.phase = "gameover";
    }
  }

  // update particles
  updateParticles(world, dt);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

const NEBULA_COLORS = [
  [180, 240, 255],
  [120, 180, 255],
  [220, 160, 255],
  [160, 220, 200],
];

function drawGroundTexture(
  ctx: CanvasRenderingContext2D,
  time: number,
  theme: VisualTheme,
  visualMode: VisualMode
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, FLOOR_Y, WIDTH, GROUND_HEIGHT);
  ctx.clip();

  if (visualMode === "rainbow") {
    ctx.strokeStyle = theme.groundGrid;
    ctx.lineWidth = 1.1;
    for (let x = -GROUND_HEIGHT; x < WIDTH + GROUND_HEIGHT; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y);
      ctx.lineTo(x + GROUND_HEIGHT, HEIGHT);
      ctx.stroke();
    }
    ctx.strokeStyle = theme.groundAccent;
    for (let x = 0; x < WIDTH + GROUND_HEIGHT; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y);
      ctx.lineTo(x - GROUND_HEIGHT * 0.75, HEIGHT);
      ctx.stroke();
    }
  } else if (visualMode === "sunset") {
    ctx.strokeStyle = theme.groundGrid;
    ctx.lineWidth = 1.2;
    for (let gy = FLOOR_Y + 10; gy < HEIGHT; gy += 12) {
      ctx.beginPath();
      for (let x = 0; x <= WIDTH; x += 14) {
        const y = gy + Math.sin(x * 0.035 + time * 0.9 + gy * 0.07) * 2.2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = theme.groundAccent;
    for (let gx = 0; gx <= WIDTH; gx += 36) {
      ctx.beginPath();
      ctx.moveTo(gx, FLOOR_Y + 4);
      ctx.lineTo(gx + 10, HEIGHT);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = theme.groundGrid;
    ctx.lineWidth = 1;
    for (let gx = 0; gx < WIDTH; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, FLOOR_Y);
      ctx.lineTo(gx + 20, HEIGHT);
      ctx.stroke();
    }
    for (let gy = FLOOR_Y + 18; gy < HEIGHT; gy += 20) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(WIDTH, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.3 + Math.sin(time * 2.2) * 0.08;
    ctx.strokeStyle = theme.groundAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y + 22);
    ctx.lineTo(WIDTH, FLOOR_Y + 22);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, time: number, visualMode: VisualMode) {
  const theme = getVisualTheme(visualMode);
  // deep space gradient
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, theme.skyTop);
  sky.addColorStop(0.35, theme.skyMid);
  sky.addColorStop(0.7, theme.skyMid);
  sky.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // aurora bands
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const y = 60 + i * 90;
    const offset = Math.sin(time * 0.28 + i * 2.1) * 30;
    const aurora = ctx.createLinearGradient(0, y + offset, 0, y + offset + 80);
    const [r, g, b] = NEBULA_COLORS[i % NEBULA_COLORS.length];
    aurora.addColorStop(0, `rgba(${r},${g},${b},0)`);
    aurora.addColorStop(0.5, `rgba(${r},${g},${b},0.045)`);
    aurora.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = aurora;
    ctx.fillRect(0, y + offset, WIDTH, 80);
  }
  ctx.restore();

  // stars
  ctx.fillStyle = "rgba(220,240,255,0.55)";
  for (let i = 0; i < 60; i++) {
    const x = (i * 97.3 + Math.sin(time * 0.01 + i) * 0.3) % WIDTH;
    const y = (i * 53.1) % (FLOOR_Y - 30);
    const twinkle = 0.4 + Math.sin(time * 1.1 + i * 1.7) * 0.25;
    ctx.globalAlpha = twinkle * 0.7;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  for (let i = 0; i < 28; i++) {
    const x = (i * 151.7) % WIDTH;
    const y = (i * 79.3) % (FLOOR_Y - 30);
    const twinkle = 0.5 + Math.sin(time * 0.7 + i * 2.3) * 0.35;
    const [r, g, b] = NEBULA_COLORS[i % NEBULA_COLORS.length];
    ctx.globalAlpha = twinkle * 0.5;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + Math.sin(i) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 12; i++) {
    const x = (i * 271.9) % WIDTH;
    const y = (i * 113.7) % (FLOOR_Y - 30);
    const pulse = 0.7 + Math.sin(time * 1.4 + i * 3.1) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ground glow
  ctx.fillStyle = `rgba(${theme.glowRgb[0]},${theme.glowRgb[1]},${theme.glowRgb[2]},0.42)`;
  ctx.fillRect(0, FLOOR_Y - 10, WIDTH, 10);

  const gLine = ctx.createLinearGradient(0, FLOOR_Y, WIDTH, FLOOR_Y);
  gLine.addColorStop(0, theme.lineA);
  gLine.addColorStop(0.2, theme.lineB);
  gLine.addColorStop(0.5, theme.lineC);
  gLine.addColorStop(0.8, theme.lineB);
  gLine.addColorStop(1, theme.lineA);
  ctx.strokeStyle = gLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y);
  ctx.lineTo(WIDTH, FLOOR_Y);
  ctx.stroke();

  const groundGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, HEIGHT);
  groundGrad.addColorStop(0, theme.groundTop);
  groundGrad.addColorStop(1, theme.groundBottom);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, FLOOR_Y, WIDTH, GROUND_HEIGHT);

  drawGroundTexture(ctx, time, theme, visualMode);
}

function drawCannonBarrel(
  ctx: CanvasRenderingContext2D,
  px: number,
  baseY: number,
  theme: VisualTheme,
  time: number,
  shipModel: ShipModel
): number {
  const halfW = shipModel === "arrow" ? 4.4 : shipModel === "orb" ? 4.8 : 5.2;
  const top = baseY - 52;
  const bottom = shipModel === "arrow" ? baseY - 20 : baseY - 22;
  const left = px - halfW;
  const width = halfW * 2;
  const height = bottom - top;

  const barrelGrad = ctx.createLinearGradient(left, top, left + width, bottom);
  barrelGrad.addColorStop(0, "rgba(240,252,255,0.95)");
  barrelGrad.addColorStop(0.35, theme.shipSecondary);
  barrelGrad.addColorStop(1, "#28486b");
  ctx.fillStyle = barrelGrad;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 3.5);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left + 0.5, top + 0.5, width - 1, height - 1, 3);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  const stripeOffset = (time * 36) % 6;
  for (let y = top + 4 + stripeOffset; y < bottom + 5; y += 6) {
    ctx.beginPath();
    ctx.moveTo(left - 2, y);
    ctx.lineTo(left + width + 2, y - 2.6);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(16,34,56,0.45)";
  ctx.fillRect(left + 0.7, top + 4.5, width - 1.4, 1.4);
  ctx.fillRect(left + 0.7, top + height * 0.58, width - 1.4, 1.4);

  ctx.strokeStyle = "rgba(255,255,255,0.46)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + 1.1, top + 1.6);
  ctx.lineTo(left + 1.1, bottom - 1.6);
  ctx.stroke();

  const muzzleY = top + 0.8;
  const rimGrad = ctx.createLinearGradient(px - halfW, muzzleY - 2, px + halfW, muzzleY + 2);
  rimGrad.addColorStop(0, "#f8fcff");
  rimGrad.addColorStop(0.55, theme.shipSecondary);
  rimGrad.addColorStop(1, "#355f8c");
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.ellipse(px, muzzleY, halfW + 1.5, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(10,16,26,0.8)";
  ctx.beginPath();
  ctx.ellipse(px, muzzleY, Math.max(1.4, halfW - 1.8), 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  return muzzleY;
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  world: World,
  time: number,
  shipModel: ShipModel,
  visualMode: VisualMode
) {
  const theme = getVisualTheme(visualMode);
  const px = world.playerX;
  const baseY = playerBaseY(world);

  // engine flame glow
  const flamePulse = 0.7 + Math.sin(time * 18) * 0.3;
  const flameGrad = ctx.createRadialGradient(px, baseY + 4, 0, px, baseY + 4, 22);
  flameGrad.addColorStop(0, theme.thrusterA.replace(/[\d.]+\)$/, `${0.55 * flamePulse})`));
  flameGrad.addColorStop(0.5, theme.thrusterB.replace(/[\d.]+\)$/, `${0.25 * flamePulse})`));
  flameGrad.addColorStop(1, "rgba(20,60,140,0)");
  ctx.fillStyle = flameGrad;
  ctx.beginPath();
  ctx.arc(px, baseY + 4, 22, 0, Math.PI * 2);
  ctx.fill();

  // thruster flames (left/right)
  for (const ox of [-18, 18]) {
    const fh = 10 + Math.sin(time * 22 + ox) * 5;
    const fg = ctx.createLinearGradient(px + ox, baseY + 2, px + ox, baseY + 2 + fh);
    fg.addColorStop(0, theme.thrusterA);
    fg.addColorStop(0.5, theme.thrusterB);
    fg.addColorStop(1, "rgba(40,80,200,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(px + ox, baseY + 2 + fh / 2, 4, fh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (shipModel === "arrow") {
    const arrowGrad = ctx.createLinearGradient(px, baseY - 52, px, baseY + 2);
    arrowGrad.addColorStop(0, theme.shipSecondary);
    arrowGrad.addColorStop(0.55, theme.shipPrimary);
    arrowGrad.addColorStop(1, "#1a1327");
    ctx.fillStyle = arrowGrad;
    ctx.beginPath();
    ctx.moveTo(px, baseY - 56);
    ctx.lineTo(px + 24, baseY - 8);
    ctx.lineTo(px + 14, baseY + 2);
    ctx.lineTo(px, baseY - 4);
    ctx.lineTo(px - 14, baseY + 2);
    ctx.lineTo(px - 24, baseY - 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px, baseY - 52);
    ctx.lineTo(px, baseY - 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(px - 14, baseY - 6);
    ctx.lineTo(px, baseY - 18);
    ctx.lineTo(px + 14, baseY - 6);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(24,8,34,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, baseY - 44);
    ctx.lineTo(px, baseY - 10);
    ctx.stroke();
    ctx.restore();
  } else if (shipModel === "orb") {
    const orbGrad = ctx.createRadialGradient(px - 8, baseY - 18, 3, px, baseY - 10, 27);
    orbGrad.addColorStop(0, theme.shipSecondary);
    orbGrad.addColorStop(0.55, theme.shipPrimary);
    orbGrad.addColorStop(1, "#180f24");
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.ellipse(px, baseY - 10, 28, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.33)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, baseY - 10, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    for (const y of [-8, -2, 4]) {
      ctx.beginPath();
      ctx.ellipse(px, baseY - 10 + y, 21 - Math.abs(y) * 0.8, 4.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const hullGrad = ctx.createLinearGradient(px - 30, baseY - 18, px + 30, baseY);
    hullGrad.addColorStop(0, theme.shipPrimary);
    hullGrad.addColorStop(0.5, theme.shipSecondary);
    hullGrad.addColorStop(1, "#1a3860");
    ctx.fillStyle = hullGrad;
    ctx.shadowColor = "rgba(80,180,255,0.4)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(px - 30, baseY);
    ctx.bezierCurveTo(px - 30, baseY - 8, px - 22, baseY - 18, px, baseY - 20);
    ctx.bezierCurveTo(px + 22, baseY - 18, px + 30, baseY - 8, px + 30, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(160,220,255,0.2)";
    ctx.beginPath();
    ctx.ellipse(px - 4, baseY - 13, 16, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(px - 20, baseY - 7);
    ctx.lineTo(px - 7, baseY - 16);
    ctx.moveTo(px + 20, baseY - 7);
    ctx.lineTo(px + 7, baseY - 16);
    ctx.stroke();

    ctx.strokeStyle = "rgba(18,46,72,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 23, baseY - 2);
    ctx.lineTo(px + 23, baseY - 2);
    ctx.stroke();
  }

  const muzzleY = drawCannonBarrel(ctx, px, baseY, theme, time, shipModel);

  const cockGrad = ctx.createRadialGradient(px - 3, baseY - 30, 2, px, baseY - 28, 10);
  cockGrad.addColorStop(0, theme.cockpitA);
  cockGrad.addColorStop(0.4, theme.cockpitB);
  cockGrad.addColorStop(1, "#2a6090");
  ctx.fillStyle = cockGrad;
  ctx.beginPath();
  ctx.ellipse(px, baseY - 30, 9, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // muzzle glow
  const muzzleGrad = ctx.createRadialGradient(px, muzzleY, 0, px, muzzleY, 10);
  muzzleGrad.addColorStop(0, "rgba(200,240,255,0.84)");
  muzzleGrad.addColorStop(1, "rgba(80,180,255,0)");
  ctx.fillStyle = muzzleGrad;
  ctx.beginPath();
  ctx.arc(px, muzzleY, 10, 0, Math.PI * 2);
  ctx.fill();

  // shield
  if (world.shieldTimer > 0) {
    const decayRatio = clamp(world.shieldTimer / SHIELD_BREAK_DURATION, 0, 1);
    const isDecaying = !world.shieldArmed;
    const blink = isDecaying ? (Math.sin(time * 24) > 0 ? 1 : 0.28) : 1;
    const sa = isDecaying ? (0.22 + decayRatio * 0.78) * blink : 0.85;
    ctx.save();
    ctx.globalAlpha = sa * (0.78 + Math.sin(time * 6) * 0.2);
    const sg = ctx.createRadialGradient(px, baseY - 18, 10, px, baseY - 18, 44);
    sg.addColorStop(0, "rgba(100,220,255,0)");
    sg.addColorStop(0.7, theme.shield.replace(/[\d.]+\)$/, "0.14)"));
    sg.addColorStop(1, theme.shield);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(px, baseY - 18, 44, 0, Math.PI * 2); ctx.fill();
    const shieldStroke = theme.shield.replace(/[\d.]+\)$/, `${sa * 0.8})`);
    ctx.strokeStyle = shieldStroke;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px, baseY - 18, 44, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, bullets: Bullet[], time: number) {
  for (const b of bullets) {
    const flicker = 0.78 + Math.sin(time * 26 + b.x * 0.05 + b.y * 0.08) * 0.22;
    const kind = b.kind ?? "normal";

    if (kind === "laser") {
      const lg = ctx.createLinearGradient(b.x, b.y + 18, b.x, b.y - 22);
      lg.addColorStop(0, `hsla(${b.hue - 6}, 100%, 62%, 0)`);
      lg.addColorStop(0.45, `hsla(${b.hue + 20}, 100%, 72%, ${0.32 + flicker * 0.28})`);
      lg.addColorStop(1, `hsla(${b.hue + 35}, 100%, 94%, ${0.88})`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = Math.max(2.4, b.r * 0.95);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + 16);
      ctx.lineTo(b.x, b.y - 20);
      ctx.stroke();

      ctx.fillStyle = `hsla(${b.hue + 36}, 100%, 95%, 1)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 1.5, Math.max(2.2, b.r * 0.55), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (kind === "missile") {
      ctx.save();
      ctx.translate(b.x, b.y);
      const angle = Math.atan2(b.vy, b.vx) + Math.PI / 2;
      ctx.rotate(angle);
      const bodyGrad = ctx.createLinearGradient(0, -b.r * 2.2, 0, b.r * 2.2);
      bodyGrad.addColorStop(0, "rgba(255,170,255,0.95)");
      bodyGrad.addColorStop(0.55, `hsla(${b.hue + 25}, 96%, 66%, 0.96)`);
      bodyGrad.addColorStop(1, "rgba(90,35,130,0.95)");
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(0, -b.r * 2.3);
      ctx.lineTo(b.r * 0.85, b.r * 1.15);
      ctx.lineTo(0, b.r * 0.75);
      ctx.lineTo(-b.r * 0.85, b.r * 1.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(0, -b.r * 1.25, b.r * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = `hsla(${b.hue}, 100%, 74%, ${0.44 + flicker * 0.2})`;
      ctx.lineWidth = Math.max(1.6, b.r * 0.7);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.r * 1.2);
      ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03 + 16);
      ctx.stroke();
      continue;
    }

    // normal bullet
    const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 3.5);
    glow.addColorStop(0, `hsla(${b.hue + 20}, 100%, 92%, ${0.85 * flicker})`);
    glow.addColorStop(1, `hsla(${b.hue}, 100%, 70%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsla(${b.hue + 30}, 100%, ${92 + flicker * 6}%, 1)`;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `hsla(${b.hue}, 100%, 80%, ${0.35 + flicker * 0.2})`;
    ctx.lineWidth = b.r * 0.8;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y + 14); ctx.stroke();
  }
}

// ─── Ball tier palette ─────────────────────────────────────────────────────────
// Each tier (by current HP) gets a distinct texture identity.
// This means the ball visual style changes in real time as the number drops.

interface BallTier {
  name: string;
  // 3-stop radial gradient: highlight, mid, shadow
  hi: string; mid: string; lo: string;
  glow: string;         // outer glow color
  rim: string;          // rim stroke color
  trailColor: string;
  // optional surface pattern function
  pattern?: (ctx: CanvasRenderingContext2D, r: number, time: number, ball: Ball) => void;
}

function getTier(hpValue: number): BallTier {
  // ── Tier 1: NEON LIME — acid slime, bubbling spots ──────────────────────────
  if (hpValue <= 4) return {
    name: "slime",
    hi: "#e8ff80", mid: "#a0f000", lo: "#2a6600",
    glow: "rgba(160,255,0,0.55)",
    rim: "rgba(200,255,60,0.85)",
    trailColor: "140,255,0",
    pattern: (ctx, r, time) => {
      // 4 orbiting bright bubbles
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + time * 1.1;
        const bx = Math.cos(a) * r * 0.48, by = Math.sin(a) * r * 0.48;
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, r * 0.2);
        bg.addColorStop(0, "rgba(230,255,100,0.7)");
        bg.addColorStop(1, "rgba(80,180,0,0)");
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(bx, by, r * 0.2, 0, Math.PI * 2); ctx.fill();
      }
      // centre dark nucleus
      ctx.fillStyle = "rgba(20,60,0,0.35)";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ── Tier 2: ELECTRIC CYAN — plasma ball, crackling arcs ─────────────────────
  if (hpValue <= 8) return {
    name: "plasma",
    hi: "#ccffff", mid: "#00e8ff", lo: "#003860",
    glow: "rgba(0,230,255,0.6)",
    rim: "rgba(100,245,255,0.9)",
    trailColor: "0,220,255",
    pattern: (ctx, r, time) => {
      // 3 lightning arcs rotating
      ctx.strokeStyle = "rgba(180,255,255,0.55)";
      ctx.lineWidth = Math.max(1, r * 0.06);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + time * 2.2;
        const mid1x = Math.cos(a + 0.5) * r * 0.4;
        const mid1y = Math.sin(a + 0.5) * r * 0.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(mid1x, mid1y, Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        ctx.stroke();
      }
      // pulsing core
      const p = 0.4 + Math.sin(time * 8) * 0.25;
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3);
      core.addColorStop(0, `rgba(200,255,255,${p})`);
      core.addColorStop(1, "rgba(0,200,255,0)");
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ── Tier 3: MAGMA ORANGE — lava rock, glowing cracks ────────────────────────
  if (hpValue <= 14) return {
    name: "magma",
    hi: "#ffee60", mid: "#ff5500", lo: "#4a0800",
    glow: "rgba(255,100,0,0.6)",
    rim: "rgba(255,180,20,0.9)",
    trailColor: "255,90,0",
    pattern: (ctx, r) => {
      // glowing crack network
      const cracks: [number,number,number,number][] = [
        [0.05,-0.35,0.45,0.15], [-0.1,-0.35,-0.5,0.15],
        [0.05,-0.35,-0.1,0.1], [0.45,0.15,0.2,0.55],
        [-0.5,0.15,-0.25,0.5], [-0.1,0.1,0.05,0.55],
      ];
      ctx.strokeStyle = "rgba(255,230,80,0.55)";
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      ctx.shadowColor = "rgba(255,160,0,0.8)";
      ctx.shadowBlur = 6;
      for (const [x1,y1,x2,y2] of cracks) {
        ctx.beginPath(); ctx.moveTo(x1*r, y1*r); ctx.lineTo(x2*r, y2*r); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // molten pools
      for (const [cx, cy] of [[0.15,0.15],[-0.2,-0.1],[0.1,-0.3]]) {
        ctx.fillStyle = "rgba(255,220,60,0.3)";
        ctx.beginPath(); ctx.arc(cx*r, cy*r, r * 0.15, 0, Math.PI * 2); ctx.fill();
      }
    },
  };

  // ── Tier 4: HOT PINK — candy/bubblegum, sparkle stars ──────────────────────
  if (hpValue <= 22) return {
    name: "candy",
    hi: "#ffe0f8", mid: "#ff20c0", lo: "#600040",
    glow: "rgba(255,30,200,0.55)",
    rim: "rgba(255,140,240,0.9)",
    trailColor: "255,20,180",
    pattern: (ctx, r, time) => {
      // 5 spinning star points
      ctx.save();
      ctx.rotate(time * 0.8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const ox = Math.cos(a) * r * 0.55, oy = Math.sin(a) * r * 0.55;
        const sg = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 0.18);
        sg.addColorStop(0, "rgba(255,240,255,0.7)");
        sg.addColorStop(1, "rgba(255,100,220,0)");
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(ox, oy, r * 0.18, 0, Math.PI * 2); ctx.fill();
      }
      // inner swirl
      ctx.strokeStyle = "rgba(255,200,255,0.35)";
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 1.5; t += 0.15) {
        const rr = r * 0.55 * (t / (Math.PI * 1.5));
        const px = Math.cos(t + time) * rr, py = Math.sin(t + time) * rr;
        t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    },
  };

  // ── Tier 5: ROYAL PURPLE — void crystal, hexagon lattice ────────────────────
  if (hpValue <= 33) return {
    name: "crystal",
    hi: "#e8c0ff", mid: "#8800ff", lo: "#1a0035",
    glow: "rgba(140,0,255,0.6)",
    rim: "rgba(200,100,255,0.9)",
    trailColor: "150,0,255",
    pattern: (ctx, r, time) => {
      // rotating hexagonal lattice
      ctx.save();
      ctx.rotate(time * 0.35);
      ctx.strokeStyle = "rgba(220,150,255,0.3)";
      ctx.lineWidth = Math.max(1, r * 0.05);
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const hx = col * r * 0.55 + (row % 2) * r * 0.28;
          const hy = row * r * 0.48;
          if (hx*hx + hy*hy > r*r*0.85) continue;
          ctx.beginPath();
          for (let v = 0; v < 6; v++) {
            const va = (v / 6) * Math.PI * 2;
            const vx = hx + Math.cos(va) * r * 0.22;
            const vy = hy + Math.sin(va) * r * 0.22;
            v === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
          }
          ctx.closePath(); ctx.stroke();
        }
      }
      ctx.restore();
      // inner gem facets
      ctx.strokeStyle = "rgba(255,200,255,0.22)";
      ctx.lineWidth = Math.max(1, r * 0.04);
      for (let f = 0; f < 4; f++) {
        const fa = (f / 4) * Math.PI * 2 + time * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(fa) * r * 0.7, Math.sin(fa) * r * 0.7);
        ctx.stroke();
      }
    },
  };

  // ── Tier 6: TOXIC GREEN — radioactive, bubbling waste ───────────────────────
  if (hpValue <= 48) return {
    name: "toxic",
    hi: "#c8ff40", mid: "#40c800", lo: "#0a2800",
    glow: "rgba(80,220,0,0.65)",
    rim: "rgba(160,255,40,0.9)",
    trailColor: "60,200,0",
    pattern: (ctx, r, time) => {
      // radioactive symbol segments
      ctx.save();
      ctx.rotate(time * 0.25);
      for (let seg = 0; seg < 3; seg++) {
        const sa = (seg / 3) * Math.PI * 2 + Math.PI / 6;
        ctx.fillStyle = "rgba(160,255,0,0.22)";
        ctx.beginPath();
        ctx.moveTo(Math.cos(sa) * r * 0.28, Math.sin(sa) * r * 0.28);
        ctx.arc(0, 0, r * 0.28, sa, sa + Math.PI * 0.52);
        ctx.arc(0, 0, r * 0.62, sa + Math.PI * 0.52, sa, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // toxic bubbles rising
      for (let b = 0; b < 5; b++) {
        const bAngle = (b / 5) * Math.PI * 2 + time * 0.7;
        const bDist = r * (0.3 + (b % 3) * 0.2);
        const bx = Math.cos(bAngle) * bDist * 0.6;
        const by = Math.sin(bAngle) * bDist * 0.6;
        ctx.strokeStyle = "rgba(180,255,80,0.35)";
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.beginPath(); ctx.arc(bx, by, r * 0.1, 0, Math.PI * 2); ctx.stroke();
      }
    },
  };

  // ── Tier 7: SOLAR GOLD — burning sun, corona rays ───────────────────────────
  if (hpValue <= 70) return {
    name: "solar",
    hi: "#ffffff", mid: "#ffcc00", lo: "#a03000",
    glow: "rgba(255,200,0,0.7)",
    rim: "rgba(255,240,100,1.0)",
    trailColor: "255,200,0",
    pattern: (ctx, r, time) => {
      // corona rays
      const rayCount = 12;
      for (let i = 0; i < rayCount; i++) {
        const a = (i / rayCount) * Math.PI * 2 + time * 0.4;
        const len = r * (0.55 + Math.sin(time * 3 + i * 0.9) * 0.18);
        const rg = ctx.createLinearGradient(
          Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4,
          Math.cos(a) * len, Math.sin(a) * len
        );
        rg.addColorStop(0, "rgba(255,255,180,0.5)");
        rg.addColorStop(1, "rgba(255,160,0,0)");
        ctx.strokeStyle = rg;
        ctx.lineWidth = Math.max(1.5, r * 0.07);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.stroke();
      }
      // solar core glow
      const sc = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
      sc.addColorStop(0, `rgba(255,255,220,${0.6 + Math.sin(time * 5) * 0.2})`);
      sc.addColorStop(1, "rgba(255,180,0,0)");
      ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    },
  };

  // ── Tier 8+: VOID DARK — black hole, event horizon ──────────────────────────
  return {
    name: "void",
    hi: "#a0ffd8", mid: "#004848", lo: "#000205",
    glow: "rgba(0,200,160,0.7)",
    rim: "rgba(0,255,200,1.0)",
    trailColor: "0,200,150",
    pattern: (ctx, r, time) => {
      // accretion disk — orbiting bright ring
      ctx.save();
      ctx.rotate(time * 1.5);
      for (let seg = 0; seg < 16; seg++) {
        const sa = (seg / 16) * Math.PI * 2;
        const ea = sa + Math.PI / 16;
        const brightness = 0.1 + ((seg % 4) / 4) * 0.45;
        ctx.strokeStyle = `rgba(0,255,180,${brightness})`;
        ctx.lineWidth = Math.max(2, r * 0.1);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.72, sa, ea);
        ctx.stroke();
      }
      ctx.restore();
      // event horizon — dark absorbing centre
      const eh = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
      eh.addColorStop(0, "rgba(0,0,0,0.95)");
      eh.addColorStop(0.7, "rgba(0,20,20,0.6)");
      eh.addColorStop(1, "rgba(0,40,40,0)");
      ctx.fillStyle = eh; ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
      // gravitational lensing arcs
      ctx.strokeStyle = `rgba(0,255,180,${0.2 + Math.sin(time * 4) * 0.1})`;
      ctx.lineWidth = Math.max(1, r * 0.04);
      for (let arc = 0; arc < 3; arc++) {
        const aa = (arc / 3) * Math.PI * 2 + time * 0.8;
        ctx.beginPath();
        ctx.arc(Math.cos(aa) * r * 0.2, Math.sin(aa) * r * 0.2, r * 0.25, aa, aa + Math.PI * 0.8);
        ctx.stroke();
      }
    },
  };
}

function drawBalls(ctx: CanvasRenderingContext2D, balls: Ball[], time: number) {
  for (const ball of balls) {
    const hpNow = Math.max(1, ball.hp);
    const tier = getTier(hpNow);
    const hpRatio = clamp(hpNow / Math.max(1, ball.maxHp), 0, 1);
    const danger = 1 - hpRatio;
    const hpHue = currentBallHue(ball);
    const pulse = 0.5 + Math.sin(time * 6 + ball.id * 0.41) * 0.5;
    const flash = ball.flashTimer > 0;

    // ── trail — use tier's own vivid color ──
    if (ball.trail.length > 1) {
      ctx.lineCap = "round";
      for (let i = 1; i < ball.trail.length; i++) {
        const prev = ball.trail[i - 1];
        const curr = ball.trail[i];
        const progress = i / ball.trail.length;
        ctx.globalAlpha = progress * progress * 0.38;
        ctx.strokeStyle = `rgba(${tier.trailColor},1)`;
        ctx.lineWidth = ball.r * (1.4 + hpRatio * 0.8) * progress;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ── outer glow — vivid, generous ──
    const glowAlpha = flash ? 0.75 : 0.35 + danger * 0.2 + pulse * 0.12;
    const outerGlow = ctx.createRadialGradient(ball.x, ball.y, ball.r * 0.3, ball.x, ball.y, ball.r * 2.0);
    outerGlow.addColorStop(0, flash ? "rgba(255,255,255,0.7)" : tier.glow.replace(/[\d.]+\)$/, `${glowAlpha})`));
    outerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = outerGlow;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 2.0, 0, Math.PI * 2); ctx.fill();

    // ── wobble ──
    const wob = Math.sin(ball.wobble) * 0.065;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(1 + wob, 1 - wob * 0.55);

    // ── body: use tier's own hi/mid/lo palette for maximum vibrancy ──
    const body = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.36, ball.r * 0.08, 0, 0, ball.r);
    if (flash) {
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.35, tier.hi);
      body.addColorStop(1, tier.mid);
    } else {
      body.addColorStop(0, tier.hi);
      body.addColorStop(0.48, tier.mid);
      body.addColorStop(1, tier.lo);
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();

    // (no generic hue tint — tier body gradient is the authoritative color)

    // ── tier-specific surface pattern ──
    if (tier.pattern && !flash) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.clip();
      tier.pattern(ctx, ball.r, time, ball);
      ctx.restore();
    }

    // ── hp contour rings (texture that follows current number) ──
    if (!flash) {
      const ringCount = clamp(Math.ceil(Math.log2(hpNow + 1)), 2, 8);
      ctx.strokeStyle = `hsla(${hpHue + 18}, 95%, ${70 - danger * 18}%, ${0.08 + hpRatio * 0.16})`;
      ctx.lineWidth = Math.max(0.8, ball.r * 0.048);
      for (let ring = 0; ring < ringCount; ring++) {
        const ringRatio = (ring + 1) / (ringCount + 1);
        const ringRadius = ball.r * (0.22 + ringRatio * 0.65);
        const wobbleOffset = Math.sin(time * 2.8 + ball.id * 0.33 + ring * 1.2) * ball.r * 0.02;
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius + wobbleOffset, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── rim stroke — use tier's vivid rim color ──
    ctx.strokeStyle = flash ? "rgba(255,255,255,0.9)" : tier.rim;
    ctx.lineWidth = Math.max(1.8, ball.r * 0.1);
    ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.stroke();

    // special carrier mark: this ball holds a powerup drop.
    if (ball.carrierKind) {
      const markerColors: Record<PowerUpKind, string> = {
        shield: "#66e4ff",
        rapid: "#ffd85a",
        multi: "#d886ff",
      };
      const markerGlyph: Record<PowerUpKind, string> = {
        shield: "S",
        rapid: "R",
        multi: "M",
      };
      ctx.save();
      ctx.strokeStyle = markerColors[ball.carrierKind];
      ctx.lineWidth = Math.max(1.4, ball.r * 0.07);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, ball.r * 0.72, time * 2, time * 2 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = markerColors[ball.carrierKind];
      ctx.beginPath();
      ctx.arc(0, -ball.r * 0.62, Math.max(6, ball.r * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#140a08";
      ctx.font = `700 ${Math.max(8, Math.floor(ball.r * 0.18))}px 'Exo 2', system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(markerGlyph[ball.carrierKind], 0, -ball.r * 0.62);
      ctx.restore();
    }

    // ── specular highlight (top-left) ──
    if (!flash) {
      const spec = ctx.createRadialGradient(-ball.r * 0.28, -ball.r * 0.33, 0, -ball.r * 0.28, -ball.r * 0.33, ball.r * 0.42);
      spec.addColorStop(0, "rgba(255,255,255,0.58)");
      spec.addColorStop(0.6, "rgba(255,255,255,0.12)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();

      // small secondary sheen (bottom-right for depth)
      const sheen = ctx.createRadialGradient(ball.r * 0.35, ball.r * 0.4, 0, ball.r * 0.35, ball.r * 0.4, ball.r * 0.28);
      sheen.addColorStop(0, "rgba(255,255,255,0.14)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();
    }

    // ── hp text ──
    const fontSize = Math.max(10, Math.floor(ball.r * 0.60));
    const textFill = flash
      ? "rgba(0,0,0,0.92)"
      : hpRatio < 0.32
        ? "rgba(255,244,214,0.97)"
        : "rgba(245,252,255,0.96)";
    ctx.fillStyle = textFill;
    ctx.strokeStyle = flash
      ? "rgba(255,255,255,0.35)"
      : `hsla(${hpHue + 220}, 70%, 8%, 0.72)`;
    ctx.lineWidth = Math.max(1, fontSize * 0.13);
    ctx.shadowColor = flash ? "transparent" : `hsla(${hpHue}, 90%, 40%, 0.32)`;
    ctx.shadowBlur = 6;
    ctx.font = `800 ${fontSize}px 'Exo 2', system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const hpLabel = String(ball.hp);
    ctx.strokeText(hpLabel, 0, 1);
    ctx.fillText(hpLabel, 0, 1);
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

function drawPowerUps(ctx: CanvasRenderingContext2D, powerUps: PowerUp[], time: number) {
  const icons: Record<PowerUpKind, string> = { shield: "🛡", rapid: "⚡", multi: "✳" };
  const colors: Record<PowerUpKind, string> = {
    shield: "80,200,255", rapid: "255,200,40", multi: "200,100,255",
  };
  for (const pu of powerUps) {
    const pulse = 1 + Math.sin(time * 4 + pu.age * 3) * (pu.grounded ? 0.07 : 0.12);
    const [r, g, b] = colors[pu.kind].split(",").map(Number);
    const glow = ctx.createRadialGradient(pu.x, pu.y, 0, pu.x, pu.y, pu.r * 2.4);
    glow.addColorStop(0, `rgba(${r},${g},${b},${pu.grounded ? 0.52 : 0.4})`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r * 2.4, 0, Math.PI * 2); ctx.fill();

    if (pu.grounded) {
      ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
      ctx.beginPath();
      ctx.ellipse(pu.x, FLOOR_COLLISION_Y + 1, pu.r * 1.5, pu.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.scale(pulse, pulse);
    const bg = ctx.createRadialGradient(0, -pu.r * 0.2, 0, 0, 0, pu.r);
    bg.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
    bg.addColorStop(1, `rgba(${r * 0.4},${g * 0.4},${b * 0.4},0.8)`);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, pu.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `${pu.r}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icons[pu.kind], 0, 1);

    if (pu.grounded) {
      const ratio = clamp(pu.groundTimer / POWERUP_FLOOR_STAY, 0, 1);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, pu.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, world: World) {
  // active powerup indicators at top
  const active: string[] = [];
  if (world.shieldTimer > 0) {
    active.push(world.shieldArmed ? "🛡 READY" : `🛡 ${world.shieldTimer.toFixed(1)}s`);
  }
  if (world.rapidTimer > 0) active.push(`⚡ ${world.rapidTimer.toFixed(1)}s`);
  if (world.multiTimer > 0) active.push(`✳ ${world.multiTimer.toFixed(1)}s`);
  if (world.laserTimer > 0) active.push(`🔆 LASER ${world.laserTimer.toFixed(1)}s`);
  if (world.missileTimer > 0) active.push(`🚀 MISSILES ${world.missileTimer.toFixed(1)}s`);
  if (world.overdriveTimer > 0) active.push(`⚡✳ OVERDRIVE ${world.overdriveTimer.toFixed(1)}s`);
  if (active.length > 0) {
    ctx.font = "bold 13px 'Exo 2', system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    active.forEach((txt, i) => {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(10, 10 + i * 24, txt.length * 8 + 12, 20);
      ctx.fillStyle = "#d0f0ff";
      ctx.fillText(txt, 16, 13 + i * 24);
    });
  }

  // combo counter
  if (world.combo >= 3) {
    const mult = 1 + Math.floor(world.combo / 3) * 0.5;
    const comboY = FLOOR_Y - 80;
    ctx.save();
    ctx.globalAlpha = Math.min(1, world.comboTimer / 0.5);
    ctx.font = `bold ${Math.min(28, 14 + world.combo)}px 'Exo 2', system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `hsl(${45 + world.combo * 5}, 100%, 65%)`;
    ctx.shadowColor = `hsl(${45 + world.combo * 5}, 100%, 50%)`;
    ctx.shadowBlur = 14;
    ctx.fillText(`COMBO x${world.combo}  ×${mult.toFixed(1)}`, WIDTH / 2, comboY);
    ctx.restore();
  }
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  time: number,
  visualMode: VisualMode,
  shipModel: ShipModel
) {
  ctx.save();
  // screen shake
  if (world.screenShake > 0.01) {
    const sx = (Math.random() - 0.5) * world.screenShake * 14;
    const sy = (Math.random() - 0.5) * world.screenShake * 8;
    ctx.translate(sx, sy);
  }
  drawBackground(ctx, time, visualMode);
  drawParticles(ctx, world.particles);
  drawPowerUps(ctx, world.powerUps, time);
  drawBalls(ctx, world.balls, time);
  drawBullets(ctx, world.bullets, time);
  drawPlayer(ctx, world, time, shipModel, visualMode);
  drawHUD(ctx, world);
  ctx.restore();
}

function toCanvasX(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return WIDTH / 2;
  return clamp((clientX - rect.left) / rect.width * WIDTH, PLAYER_HALF_WIDTH + 2, WIDTH - PLAYER_HALF_WIDTH - 2);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlobBlastGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const worldRef = useRef<World>(createWorld());
  const keyboardRef = useRef<KeyboardState>({ left: false, right: false });
  const bestRef = useRef<number>(readBest());
  const hudRef = useRef<{ score: number; level: number }>({ score: 0, level: 1 });
  const activeUidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const saveRestoreTokenRef = useRef(0);
  const remoteSaveTimerRef = useRef<number | null>(null);
  const remoteSaveInFlightRef = useRef(false);
  const pendingRemoteSnapshotRef = useRef<BlobBlastSaveSnapshot | null>(null);
  const lastSnapshotSignatureRef = useRef("");

  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [bestScore, setBestScore] = useState(bestRef.current);
  const [collisionMode, setCollisionMode] = useState<CollisionMode>("on");
  const [visualMode, setVisualMode] = useState<VisualMode>("rainbow");
  const [shipModel, setShipModel] = useState<ShipModel>("falcon");
  const [activeUid, setActiveUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [cloudBest, setCloudBest] = useState(0);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [leaderboardMaxHeight, setLeaderboardMaxHeight] = useState<number | null>(null);

  const buildSnapshotSignature = useCallback(
    (targetPhase: Phase, settings: BlobBlastSaveSettings, world: World) => JSON.stringify({
      phase: targetPhase,
      settings,
      world,
    }),
    []
  );

  const syncHud = useCallback((world: World) => {
    if (world.score !== hudRef.current.score) { hudRef.current.score = world.score; setScore(world.score); }
    if (world.level !== hudRef.current.level) { hudRef.current.level = world.level; setLevel(world.level); }
  }, []);

  const flushRemoteSave = useCallback(async () => {
    const uid = activeUidRef.current;
    const snapshot = pendingRemoteSnapshotRef.current;
    if (!uid || !snapshot || remoteSaveInFlightRef.current) return;
    remoteSaveInFlightRef.current = true;
    pendingRemoteSnapshotRef.current = null;
    await writeRemoteSnapshot(uid, snapshot);
    remoteSaveInFlightRef.current = false;
    if (pendingRemoteSnapshotRef.current) {
      void flushRemoteSave();
    }
  }, []);

  const queueRemoteSave = useCallback((snapshot: BlobBlastSaveSnapshot, immediate = false) => {
    const uid = activeUidRef.current;
    if (!uid) return;

    pendingRemoteSnapshotRef.current = snapshot;
    if (remoteSaveTimerRef.current !== null) {
      window.clearTimeout(remoteSaveTimerRef.current);
      remoteSaveTimerRef.current = null;
    }

    if (immediate) {
      void flushRemoteSave();
      return;
    }

    remoteSaveTimerRef.current = window.setTimeout(() => {
      remoteSaveTimerRef.current = null;
      void flushRemoteSave();
    }, REMOTE_SAVE_DEBOUNCE_MS);
  }, [flushRemoteSave]);

  const persistSnapshot = useCallback((options?: { pauseIfPlaying?: boolean; flushRemote?: boolean }) => {
    const pauseIfPlaying = options?.pauseIfPlaying ?? false;
    const flushRemote = options?.flushRemote ?? false;
    const phaseForSave: Phase =
      pauseIfPlaying && worldRef.current.phase === "playing" ? "paused" : worldRef.current.phase;

    const clonedWorld = cloneWorldForSave(worldRef.current, phaseForSave);
    const settings: BlobBlastSaveSettings = { collisionMode, visualMode, shipModel };
    const signature = buildSnapshotSignature(phaseForSave, settings, clonedWorld);
    const hasChanged = signature !== lastSnapshotSignatureRef.current;

    if (!hasChanged && !flushRemote) return;

    lastSnapshotSignatureRef.current = signature;
    const snapshot: BlobBlastSaveSnapshot = {
      v: BLOBBLAST_SAVE_VERSION,
      savedAt: Date.now(),
      phase: phaseForSave,
      settings,
      world: clonedWorld,
    };

    writeLocalSnapshot(activeUidRef.current, snapshot);
    if (hasChanged || flushRemote) {
      queueRemoteSave(snapshot, flushRemote);
    }
  }, [buildSnapshotSignature, collisionMode, queueRemoteSave, shipModel, visualMode]);

  const applySnapshot = useCallback((snapshot: BlobBlastSaveSnapshot, forcePause = true) => {
    const restoredPhase: Phase =
      forcePause && snapshot.phase === "playing" ? "paused" : snapshot.phase;
    const restoredWorld = cloneWorldForSave(snapshot.world, restoredPhase);
    restoredWorld.phase = restoredPhase;
    worldRef.current = restoredWorld;

    const normalizedSettings: BlobBlastSaveSettings = {
      collisionMode: normalizeCollisionMode(snapshot.settings.collisionMode),
      visualMode: normalizeVisualMode(snapshot.settings.visualMode),
      shipModel: normalizeShipModel(snapshot.settings.shipModel),
    };

    setCollisionMode(normalizedSettings.collisionMode);
    setVisualMode(normalizedSettings.visualMode);
    setShipModel(normalizedSettings.shipModel);
    hudRef.current = { score: restoredWorld.score, level: restoredWorld.level };
    setScore(restoredWorld.score);
    setLevel(restoredWorld.level);
    setPhase(restoredWorld.phase);

    lastSnapshotSignatureRef.current = buildSnapshotSignature(
      restoredPhase,
      normalizedSettings,
      restoredWorld
    );
  }, [buildSnapshotSignature]);

  const pauseGame = useCallback(() => {
    const world = worldRef.current;
    if (world.phase !== "playing") return;
    world.phase = "paused";
    setPhase("paused");
    syncHud(world);
    persistSnapshot({ pauseIfPlaying: true, flushRemote: true });
  }, [persistSnapshot, syncHud]);

  const resumeGame = useCallback(() => {
    const world = worldRef.current;
    if (world.phase !== "paused") return;
    world.phase = "playing";
    setPhase("playing");
    persistSnapshot({ flushRemote: true });
  }, [persistSnapshot]);

  const finishRun = useCallback((finalScore: number) => {
    worldRef.current.phase = "gameover";
    setPhase("gameover");
    if (finalScore > bestRef.current) {
      bestRef.current = finalScore;
      setBestScore(finalScore);
      writeBest(finalScore);
    }
    const uid = activeUidRef.current;
    if (uid && finalScore > 0) {
      void submitBlobBlastScore(uid, finalScore).catch((err) => {
        console.warn("blob blast score submit failed:", err);
      });
    }
    persistSnapshot({ flushRemote: true });
  }, [persistSnapshot]);

  const startGame = useCallback(() => {
    const world = createWorld();
    world.phase = "playing";
    world.spawnCooldown = 0.5;
    world.safeTimer = 1.15;
    worldRef.current = world;
    hudRef.current = { score: 0, level: 1 };
    setScore(0);
    setLevel(1);
    setPhase("playing");
    persistSnapshot({ flushRemote: true });
  }, [persistSnapshot]);

  const updatePointerTarget = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    worldRef.current.targetX = toCanvasX(canvas, clientX);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      activeUidRef.current = uid;
      setActiveUid(uid);
      const token = ++saveRestoreTokenRef.current;

      void (async () => {
        const localSnapshot = readLocalSnapshot(uid);
        const remoteSnapshot = uid ? await readRemoteSnapshot(uid) : null;
        if (disposed || token !== saveRestoreTokenRef.current) return;
        const snapshot = pickLatestSnapshot(localSnapshot, remoteSnapshot);
        if (!snapshot) return;
        if (worldRef.current.phase !== "ready") return;
        applySnapshot(snapshot, true);
      })();
    });

    return () => {
      disposed = true;
      saveRestoreTokenRef.current += 1;
      unsub();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;

    const measure = () => {
      const h = Math.max(0, Math.floor(card.getBoundingClientRect().height));
      setLeaderboardMaxHeight(h > 0 ? h : null);
    };

    measure();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(card);
    }
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const scoresRef = query(
      collection(db, "scores", "blob-blast", "users"),
      orderBy("score", "desc"),
      limit(80)
    );
    return onSnapshot(
      scoresRef,
      (snap) => {
        const rows = snap.docs
          .map((entry) => {
            const data = entry.data() as { score?: unknown; username?: unknown };
            return {
              uid: entry.id,
              username: typeof data.username === "string" && data.username.trim().length > 0
                ? data.username.trim()
                : entry.id.slice(0, 8),
              score: normalizeLeaderboardScore(data.score),
            };
          })
          .filter((row) => row.score > 0);
        setLeaderboardRows(rows);
      },
      (err) => console.warn("blob blast leaderboard listener failed:", err)
    );
  }, []);

  useEffect(() => {
    if (!activeUid) {
      setCloudBest(0);
      return undefined;
    }

    const scoreRef = doc(db, "scores", "blob-blast", "users", activeUid);
    return onSnapshot(
      scoreRef,
      (snap) => {
        const dbBest = snap.exists()
          ? normalizeLeaderboardScore((snap.data() as { score?: unknown })?.score)
          : 0;
        setCloudBest(dbBest);
        if (dbBest > bestRef.current) {
          bestRef.current = dbBest;
          setBestScore(dbBest);
          writeBest(dbBest);
        }
      },
      (err) => console.warn("blob blast best score listener failed:", err)
    );
  }, [activeUid]);

  useEffect(() => {
    return () => {
      if (remoteSaveTimerRef.current !== null) {
        window.clearTimeout(remoteSaveTimerRef.current);
        remoteSaveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;

    const frame = (now: number) => {
      const frameDt = Math.min(MAX_FRAME_DT, (now - last) / 1000 || PHYSICS_STEP);
      last = now;
      accumulator = Math.min(MAX_ACCUMULATOR, accumulator + frameDt);
      const world = worldRef.current;
      if (world.phase === "playing") {
        let steps = 0;
        while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME && world.phase === "playing") {
          updateWorld(world, PHYSICS_STEP, keyboardRef.current, collisionMode === "on", shipModel);
          accumulator -= PHYSICS_STEP;
          steps++;
        }
        if (steps > 0) {
          syncHud(world);
          if (world.phase !== "playing") finishRun(world.score);
        }
      } else {
        accumulator = 0;
      }
      drawWorld(ctx, world, now / 1000, visualMode, shipModel);
      raf = requestAnimationFrame(frame);
    };

    drawWorld(ctx, worldRef.current, performance.now() / 1000, visualMode, shipModel);
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [collisionMode, finishRun, shipModel, syncHud, visualMode]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") { keyboardRef.current.left = true; worldRef.current.usePointer = false; e.preventDefault(); }
      else if (e.code === "ArrowRight" || e.code === "KeyD") { keyboardRef.current.right = true; worldRef.current.usePointer = false; e.preventDefault(); }
      else if (e.code === "Space") {
        if (worldRef.current.phase === "paused") resumeGame();
        else if (worldRef.current.phase !== "playing") startGame();
        e.preventDefault();
      } else if (e.code === "KeyP") {
        if (worldRef.current.phase === "playing") pauseGame();
        else if (worldRef.current.phase === "paused") resumeGame();
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") keyboardRef.current.left = false;
      else if (e.code === "ArrowRight" || e.code === "KeyD") keyboardRef.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pauseGame, resumeGame, startGame]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      persistSnapshot();
    }, SNAPSHOT_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [persistSnapshot]);

  useEffect(() => {
    const persistPaused = () => {
      const world = worldRef.current;
      if (world.phase === "playing") {
        world.phase = "paused";
        setPhase("paused");
      }
      persistSnapshot({ pauseIfPlaying: true, flushRemote: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistPaused();
    };

    window.addEventListener("beforeunload", persistPaused);
    window.addEventListener("pagehide", persistPaused);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", persistPaused);
      window.removeEventListener("pagehide", persistPaused);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [persistSnapshot]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    worldRef.current.usePointer = true;
    updatePointerTarget(e.clientX);
    if (worldRef.current.phase === "paused") resumeGame();
    else if (worldRef.current.phase !== "playing") startGame();
  }, [resumeGame, startGame, updatePointerTarget]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    worldRef.current.usePointer = true;
    updatePointerTarget(e.clientX);
  }, [updatePointerTarget]);

  const handlePointerLeave = useCallback(() => { worldRef.current.usePointer = false; }, []);
  const visibleLeaderboardRows = leaderboardRows;

  return (
    <main className="bb-page">
      <div className="bb-layout">
        <section className="bb-card" ref={cardRef}>
          <header className="bb-head">
            <div className="bb-title-group">
              <h2 className="bb-title">
                <span className="bb-title-blob">Blob</span>
                <span className="bb-title-blast">Blast</span>
              </h2>
              <p className="bb-subtitle">Shoot · Split · Survive · P to pash</p>
            </div>
            <div className="bb-head-actions">
              {(phase === "playing" || phase === "paused") && (
                <button className="bb-btn" onClick={phase === "playing" ? pauseGame : resumeGame} type="button">
                  {phase === "playing" ? "⏸ Pause" : "▶ Resume"}
                </button>
              )}
              <button className="bb-btn" onClick={startGame} type="button">
                {phase === "playing" || phase === "paused" ? "↺ Restart" : "▶ Start"}
              </button>
            </div>
          </header>

          <div className="bb-stats">
            <article className="bb-stat bb-stat--score">
              <span>Score</span>
              <strong>{score.toLocaleString()}</strong>
            </article>
            <article className="bb-stat bb-stat--best">
              <span>Best</span>
              <strong>{bestScore.toLocaleString()}</strong>
            </article>
            <article className="bb-stat bb-stat--cloud">
              <span>Cloud Best</span>
              <strong>{cloudBest.toLocaleString()}</strong>
            </article>
            <article className="bb-stat bb-stat--level">
              <span>Level</span>
              <strong>{level}</strong>
            </article>
          </div>

          <div className="bb-stage">
            <canvas
              ref={canvasRef}
              className="bb-canvas"
              width={WIDTH}
              height={HEIGHT}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />

            {phase !== "playing" && (
              <div className="bb-overlay">
                <div className="bb-overlay-inner">
                  {phase === "gameover" ? (
                    <>
                      <div className="bb-overlay-icon">💥</div>
                      <h3 className="bb-overlay-title">Game Over</h3>
                      <p className="bb-overlay-score">Score: <strong>{score.toLocaleString()}</strong></p>
                      {score >= bestScore && score > 0 && <p className="bb-overlay-record">🏆 New Record!</p>}
                    </>
                  ) : phase === "paused" ? (
                    <>
                      <div className="bb-overlay-icon">⏸️</div>
                      <h3 className="bb-overlay-title">Paused</h3>
                      <p className="bb-overlay-score">Run saved in {activeUidRef.current ? "Local + Firebase" : "Local storage"}</p>
                    </>
                  ) : (
                    <>
                      <div className="bb-overlay-icon">🚀</div>
                      <h3 className="bb-overlay-title">Blob<span>Blast</span></h3>
                      <ul className="bb-tips">
                        <li>🖱 Move mouse or touch to aim</li>
                        <li>← → Arrow keys also work</li>
                        <li>🔮 Special balls drop effects</li>
                        <li>🛡 Shield protects from hits</li>
                        <li>⚡ Rapid fire increases rate</li>
                        <li>✳ Multi fires 3 bullets</li>
                      </ul>
                    </>
                  )}

                  {phase !== "paused" && (
                    <section className="bb-options-panel" aria-label="Match setup">
                      <p className="bb-options-title">Match Setup</p>

                      <div className="bb-options-row">
                        <span className="bb-options-label">Ball Collision</span>
                        <div className="bb-options-pills">
                          <button
                            type="button"
                            className={`bb-pill${collisionMode === "on" ? " is-active" : ""}`}
                            onClick={() => setCollisionMode("on")}
                          >
                            On
                          </button>
                          <button
                            type="button"
                            className={`bb-pill${collisionMode === "off" ? " is-active" : ""}`}
                            onClick={() => setCollisionMode("off")}
                          >
                            Off
                          </button>
                        </div>
                      </div>

                      <div className="bb-options-row">
                        <span className="bb-options-label">Visual Theme</span>
                        <div className="bb-options-pills">
                          <button
                            type="button"
                            className={`bb-pill${visualMode === "rainbow" ? " is-active" : ""}`}
                            onClick={() => setVisualMode("rainbow")}
                          >
                            Rainbow
                          </button>
                          <button
                            type="button"
                            className={`bb-pill${visualMode === "neon" ? " is-active" : ""}`}
                            onClick={() => setVisualMode("neon")}
                          >
                            Neon
                          </button>
                          <button
                            type="button"
                            className={`bb-pill${visualMode === "sunset" ? " is-active" : ""}`}
                            onClick={() => setVisualMode("sunset")}
                          >
                            Sunset
                          </button>
                        </div>
                      </div>

                      <div className="bb-options-row">
                        <span className="bb-options-label">Ship Model</span>
                        <div className="bb-options-pills">
                          <button
                            type="button"
                            className={`bb-pill${shipModel === "falcon" ? " is-active" : ""}`}
                            onClick={() => setShipModel("falcon")}
                          >
                            Falcon
                          </button>
                          <button
                            type="button"
                            className={`bb-pill${shipModel === "arrow" ? " is-active" : ""}`}
                            onClick={() => setShipModel("arrow")}
                          >
                            Arrow
                          </button>
                          <button
                            type="button"
                            className={`bb-pill${shipModel === "orb" ? " is-active" : ""}`}
                            onClick={() => setShipModel("orb")}
                          >
                            Orb
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {phase === "paused" ? (
                    <div className="bb-overlay-actions">
                      <button className="bb-btn bb-btn--big" onClick={resumeGame} type="button">
                        Resume
                      </button>
                      <button className="bb-btn" onClick={startGame} type="button">
                        Restart
                      </button>
                    </div>
                  ) : (
                    <button className="bb-btn bb-btn--big" onClick={startGame} type="button">
                      {phase === "gameover" ? "Play Again" : "Launch"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside
          className="bb-leaderboard bb-leaderboard--side"
          aria-label="BlobBlast leaderboard"
          style={leaderboardMaxHeight ? { maxHeight: `${leaderboardMaxHeight}px` } : undefined}
        >
          <div className="bb-leaderboard-head">
            <span>Leaderboard</span>
            <strong>Top Players</strong>
          </div>
          <div className="bb-leaderboard-list">
            {visibleLeaderboardRows.length === 0 ? (
              <p className="bb-leaderboard-empty">No scores yet. Play and claim rank #1.</p>
            ) : (
              visibleLeaderboardRows.map((row, index) => (
                <article
                  key={row.uid}
                  className={`bb-leaderboard-row${row.uid === activeUid ? " is-self" : ""}`}
                >
                  <span className="bb-leaderboard-rank">#{index + 1}</span>
                  <div className="bb-leaderboard-userbox">
                    <UserBox userId={row.uid} />
                  </div>
                  <strong className="bb-leaderboard-score">{row.score.toLocaleString()}</strong>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
