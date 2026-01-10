import type { Pellet, Snake, StepInput, Vec, World, WorldConfig, SpatialGrid } from './types';

const TAU = Math.PI * 2;

// -------------------- Tuning --------------------

// Movement / body
const BASE_SPACING = 10;         // distance between points (like vertebrae)
const FOLLOW_ITERS = 2;          // constraint iterations (bigger = stiffer body)
const PLAYER_BASE_SPEED = 215;
const BOT_BASE_SPEED = 190;
const BOOST_MULT = 1.38;

// Boost costs length, but never below MIN_LEN.
const BOOST_LEN_DRAIN_PER_SEC = 4.2;
const MIN_LEN = 26;

// Steering
const PLAYER_TURN = 4.9; // rad/sec
const BOT_TURN = 4.2;

// World
const WORLD_SIZE = 3800;

// Pellets
const PELLET_R = 6.2;
const PELLET_VALUE = 1.0;
const DEATH_PELLET_R = 7.0;
const DEATH_PELLET_VALUE = 1.65;

// Combat
const KILL_SPILL_MIN = 22;
const KILL_SPILL_MAX = 110;

// Respawn
const RESPAWN_SECONDS = 1.15;

// HUD / leaderboard refresh
const LEADERBOARD_EVERY = 0.15; // seconds

const MIN_POINTS = 5;
const MAX_POINTS_LEN = 6000; // safety cap to prevent runaway lengths

// -------------------- Utils --------------------

function safeLen(v: number): number {
  if (!Number.isFinite(v)) return MIN_POINTS;
  // keep it sane even if something goes wrong
  const n = Math.floor(v);
  if (n < MIN_POINTS) return MIN_POINTS;
  if (n > MAX_POINTS_LEN) return MAX_POINTS_LEN;
  return n;
}

function sanitizeSnakeInvariants(world: World, s: Snake) {
  // Prevent NaN/Infinity from cascading into physics/AI and crashing renderer.
  if (!Number.isFinite(s.dir)) s.dir = 0;
  if (!Number.isFinite(s.radius) || s.radius <= 0) s.radius = s.isPlayer ? 14 : 13;
  if (!Number.isFinite(s.speed) || s.speed <= 0) s.speed = s.isPlayer ? PLAYER_BASE_SPEED : BOT_BASE_SPEED;

  if (!Number.isFinite(s.desiredLen)) s.desiredLen = MIN_LEN;
  if (s.desiredLen < MIN_LEN) s.desiredLen = MIN_LEN;
  if (s.desiredLen > MAX_POINTS_LEN) s.desiredLen = MAX_POINTS_LEN;

  // Ensure head position is finite; if corrupted, snap to center and rebuild body.
  const head = s.points[0];
  if (!head || !Number.isFinite(head.x) || !Number.isFinite(head.y)) {
    const cx = world.W * 0.5;
    const cy = world.H * 0.5;
    if (s.points.length === 0) s.points.push({ x: cx, y: cy });
    s.points[0].x = cx;
    s.points[0].y = cy;
    initBodyAt(s, s.points[0]);
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function rand(a = 0, b = 1) {
  return a + Math.random() * (b - a);
}

function randInt(a: number, b: number) {
  return Math.floor(rand(a, b + 1));
}

function dist2(a: Vec, b: Vec) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}



function angleTo(a: Vec, b: Vec) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function wrapAngle(a: number) {
  while (a <= -Math.PI) a += TAU;
  while (a > Math.PI) a -= TAU;
  return a;
}

function rotateToward(current: number, target: number, maxDelta: number) {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

// -------------------- Render snapshot (for interpolation) --------------------
// We capture previous-step positions into a typed array on each fixed physics step.
// This enables smooth render interpolation WITHOUT allocating in the render loop.
function ensurePrevCapacity(s: Snake, pointsCount: number): Float32Array {
  const need = pointsCount * 2;
  let buf = s._prev;
  if (!buf || buf.length < need) {
    const newCap = buf ? Math.max(need, buf.length * 2) : Math.max(need, 64);
    buf = new Float32Array(newCap);
    s._prev = buf;
  }
  return buf;
}

function snapshotSnake(s: Snake) {
  const pts = s.points;
  const n = pts.length;
  if (n <= 0) {
    s._prevLen = 0;
    s._prevDir = s.dir;
    return;
  }
  const buf = ensurePrevCapacity(s, n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const j = i * 2;
    buf[j] = p.x;
    buf[j + 1] = p.y;
  }
  s._prevLen = n;
  s._prevDir = s.dir;
}

function snakeColor(i: number) {
  const palette = [
    '#7C5CFF', '#3DD9A4', '#FF6B6B', '#FFC15E', '#4CC9F0',
    '#A7F432', '#FF4DCC', '#F7B801', '#00D1FF', '#B5179E',
  ];
  return palette[i % palette.length];
}

let _idCounter = 0;
function makeId(prefix: string) {
  _idCounter++;
  return `${prefix}-${_idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// -------------------- Snake body --------------------

function initBodyAt(s: Snake, pos: Vec) {
  s.points.length = 0;
  const n = safeLen(s.desiredLen);
  for (let i = 0; i < n; i++) {
    // allocate ONLY on spawn/respawn (ok)
    s.points.push({ x: pos.x - Math.cos(s.dir) * BASE_SPACING * i, y: pos.y - Math.sin(s.dir) * BASE_SPACING * i });
  }
}

function ensureLength(s: Snake) {
  const desired = safeLen(s.desiredLen);
  if (s.points.length < desired) {
    // Extend by cloning tail point objects (rare growth)
    const tail = s.points[s.points.length - 1] ?? s.points[0] ?? { x: 0, y: 0 };
    while (s.points.length < desired) {
      s.points.push({ x: tail.x, y: tail.y });
    }
  } else if (s.points.length > desired) {
    // Shrink safely
    s.points.length = desired;
  }
}

function follow(points: Vec[], spacing: number) {
  for (let iter = 0; iter < FOLLOW_ITERS; iter++) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 === 0) continue;
      const d = Math.sqrt(d2);
      const err = (d - spacing);
      const nx = dx / d;
      const ny = dy / d;
      b.x -= nx * err;
      b.y -= ny * err;
    }
  }
}

function headRadius(s: Snake) {
  // slightly larger head for readability
  return s.radius * 1.06;
}

// -------------------- Pellets --------------------

let _pelletId = 0;

function spawnPos(world: World): Vec {
  return { x: rand(160, world.W - 160), y: rand(160, world.H - 160) };
}

function makePellet(world: World, kind: 'normal' | 'death' = 'normal'): Pellet {
  const pos = spawnPos(world);
  _pelletId++;
  const isDeath = kind === 'death';
  return {
    id: `pel-${_pelletId}`,
    pos,
    r: isDeath ? DEATH_PELLET_R : PELLET_R,
    value: isDeath ? DEATH_PELLET_VALUE : PELLET_VALUE,
    kind,
    color: isDeath ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.80)',
  };
}

function fillPellets(world: World) {
  while (world.pellets.length < world.maxPellets) {
    world.pellets.push(makePellet(world, 'normal'));
  }
}

function checkPelletEat(world: World, s: Snake) {
  const head = s.points[0];
  const r = headRadius(s) + 4;
  const r2 = r * r;

  // Iterate backwards so we can swap-remove without allocating
  for (let i = world.pellets.length - 1; i >= 0; i--) {
    const p = world.pellets[i];
    const dx = p.pos.x - head.x;
    const dy = p.pos.y - head.y;
    if (dx * dx + dy * dy > r2) continue;

    // Eat
    s.desiredLen += p.value;
    s.score += p.value;

    // swap-remove
    const last = world.pellets[world.pellets.length - 1];
    world.pellets[i] = last;
    world.pellets.pop();
  }
}

// -------------------- Bot AI --------------------

function threatAt(world: World, pos: Vec, radius = 260) {
  let threat = 0;
  const r2 = radius * radius;

  for (const s of world.snakes) {
    if (!s.alive) continue;

    const h = s.points[0];
    const dx = pos.x - h.x;
    const dy = pos.y - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    const d = Math.sqrt(d2) || 1;
    // closer and bigger snakes are more threatening
    threat += (1 / d) * (1 + s.desiredLen / 200);

    // also consider predicted head position (no object alloc)
    const px = h.x + Math.cos(s.dir) * s.speed * 0.3;
    const py = h.y + Math.sin(s.dir) * s.speed * 0.3;
    const pdx = pos.x - px;
    const pdy = pos.y - py;
    const pd2 = pdx * pdx + pdy * pdy;
    if (pd2 < r2 * 0.6) {
      const pd = Math.sqrt(pd2) || 1;
      threat += (1 / pd) * 0.6;
    }
  }

  return threat;
}

function botPickTarget(world: World, bot: Snake) {
  // Weighted pellet target: prefer close, prefer ahead, avoid threats.
  const head = bot.points[0];
  const difficulty = world.difficulty ?? 1;

  let best: Pellet | null = null;
  let bestScore = -1;

  // Scan some pellets (not all) for perf
  const step = world.pellets.length > 700 ? 3 : 2;

  for (let i = 0; i < world.pellets.length; i += step) {
    const p = world.pellets[i];

    const dx = p.pos.x - head.x;
    const dy = p.pos.y - head.y;
    const d2 = dx * dx + dy * dy;

    // prefer within a working distance
    if (d2 > 900 * 900) continue;

    const d = Math.sqrt(d2) || 1;

    // prefer pellets that are roughly ahead of our current heading (avoid sharp turns)
    const toPel = Math.atan2(p.pos.y - head.y, p.pos.x - head.x);
    const ang = Math.abs(wrapAngle(toPel - bot.dir));
    const aheadBonus = 1.0 - clamp(ang / Math.PI, 0, 1) * 0.65;

    // avoid dangerous pellets
    const t = threatAt(world, p.pos, 260);
    const safeMul = 1.05 - clamp(t, 0, 1) * (0.72 + 0.15 * difficulty);

    // bigger value matters
    const vMul = 1 + (p.value - 1) * 0.5;

    const score = (1 / (d + 1)) * 1600 * aheadBonus * safeMul * vMul;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  bot.ai.targetPelletId = best ? best.id : null;
  return best;
}

function botPickVictim(world: World, bot: Snake) {
  const difficulty = world.difficulty ?? 1;
  const head = bot.points[0];

  let best: Snake | null = null;
  let bestScore = 0;

  for (const s of world.snakes) {
    if (!s.alive || s.id === bot.id) continue;

    const d2 = dist2(head, s.points[0]);
    if (d2 > 1100 * 1100) continue;

    const d = Math.sqrt(d2) || 1;

    // prefer smaller (easier kill), prefer player
    let score = (1 / (d + 1)) * 2000;
    score *= 1.2 - Math.min(0.9, s.desiredLen / 500);
    if (s.isPlayer) score *= 1.35;

    // difficulty increases aggression range
    score *= 0.8 + 0.4 * difficulty;

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  bot.ai.targetSnakeId = best ? best.id : null;
  return best;
}

function botComputeThreat(world: World, bot: Snake) {
  // Compute a simple "avoid" vector away from nearby snake points.
  // If a big snake is close, that increases threat.
  const head = bot.points[0];

  let ax = 0;
  let ay = 0;
  let threat = 0;

  for (const s of world.snakes) {
    if (!s.alive || s.id === bot.id) continue;

    // only sample some points for perf
    const pts = s.points;
    const step = pts.length > 140 ? 3 : 2;

    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const dx = head.x - p.x;
      const dy = head.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 320 * 320) continue;

      const d = Math.sqrt(d2) || 1;

      // weight by proximity and size
      const w = (1 / d) * (1 + (s.desiredLen / 90) * 0.18);

      ax += (dx / d) * w;
      ay += (dy / d) * w;

      threat = Math.max(threat, w);
    }

    // Lookahead: consider where the other snake head will be shortly and increase threat if headed towards us
    const otherHead = pts[0];
    const lookSecs = 0.35; // small lookahead
    const px = otherHead.x + Math.cos(s.dir) * s.speed * lookSecs;
    const py = otherHead.y + Math.sin(s.dir) * s.speed * lookSecs;

    const pdx = head.x - px;
    const pdy = head.y - py;
    const pd2 = pdx * pdx + pdy * pdy;
    if (pd2 < 220 * 220) {
      const pd = Math.sqrt(pd2) || 1;
      const bonus = (1 / pd) * (0.8 + Math.min(1.2, s.desiredLen / 200));
      ax += (pdx / pd) * bonus * 1.2;
      ay += (pdy / pd) * bonus * 1.2;
      threat = Math.max(threat, bonus * 0.9);
    }
  }

  return { ax, ay, threat };
}

function botDesired(world: World, bot: Snake): { aim: number; boost: boolean } {
  const head = bot.points[0];
  const difficulty = world.difficulty ?? 1;

  // Wander timer
  bot.ai.wanderTimer -= world._dtLast ?? 0;
  if (bot.ai.wanderTimer <= 0) {
    bot.ai.wanderTimer = rand(0.6, 1.6);
    bot.ai.wanderAngle = rand(-Math.PI, Math.PI);
  }

  const targetPellet = botPickTarget(world, bot);
  const threat = botComputeThreat(world, bot);

  // Occasionally attempt intercept
  let victim: Snake | null = null;
  if (rand() < 0.23 * difficulty) {
    victim = botPickVictim(world, bot);
  }

  // Combine steering vectors (no allocations)
  let dx = 0;
  let dy = 0;

  // Pellet attraction
  if (targetPellet) {
    const a = angleTo(head, targetPellet.pos);
    // compute pellet safety and prefer ahead
    const pelletThreat = threatAt(world, targetPellet.pos, 260);
    const pelletWeight = pelletThreat > 0.7 ? 0.3 : 1.0;

    dx += Math.cos(a) * (1.0 * pelletWeight);
    dy += Math.sin(a) * (1.0 * pelletWeight);
  }

  if (victim && victim.alive) {
    // Aim ahead of victim head with improved lead based on distance and speeds
    const vHead = victim.points[0];
    const d2 = dist2(head, vHead);
    const d = Math.sqrt(d2) || 1;
    // dynamic lead: more lead if close and faster
    const baseLead = clamp(0.25 + (difficulty - 1) * 0.18, 0.2, 0.55);
    const speedFactor = Math.min(1.5, (bot.speed + 40) / (victim.speed + 20));
    const lead = clamp(baseLead * speedFactor * (1 + Math.max(0, 600 - d) / 900), 0.2, 0.9);

    const ax2 = vHead.x + Math.cos(victim.dir) * victim.speed * lead;
    const ay2 = vHead.y + Math.sin(victim.dir) * victim.speed * lead;
    const a = Math.atan2(ay2 - head.y, ax2 - head.x);

    dx += Math.cos(a) * 1.25;
    dy += Math.sin(a) * 1.25;
  }

  // Avoid threats (repulsion)
  dx += threat.ax * 1.7;
  dy += threat.ay * 1.7;

  // Evasive memory: if threatened, pick an evade angle and bias steering for a short duration
  const threatLevel = threat.threat;
  if (threatLevel > 0.06) {
    if (bot.ai.evadeAngle === undefined) {
      const away = Math.atan2(-threat.ay, -threat.ax);
      bot.ai.evadeAngle = away + rand(-0.6, 0.6);
      bot.ai.steerMemory = rand(0.25, 0.55);
    }
  }

  if (bot.ai.steerMemory > 0 && bot.ai.evadeAngle !== undefined) {
    bot.ai.steerMemory -= world._dtLast ?? 0;
    dx += Math.cos(bot.ai.evadeAngle) * 0.9;
    dy += Math.sin(bot.ai.evadeAngle) * 0.9;
    if (bot.ai.steerMemory <= 0) bot.ai.evadeAngle = undefined;
  }

  // Soft wall avoidance
  const wallPad = 220;
  if (head.x < wallPad) dx += (wallPad - head.x) / wallPad;
  if (head.x > world.W - wallPad) dx -= (head.x - (world.W - wallPad)) / wallPad;
  if (head.y < wallPad) dy += (wallPad - head.y) / wallPad;
  if (head.y > world.H - wallPad) dy -= (head.y - (world.H - wallPad)) / wallPad;

  const aim = Math.atan2(dy, dx);

  // Boost logic: use boost when chasing and safe, or when escaping.
  const safe = threat.threat < 0.035 * (2 - clamp(difficulty, 0.6, 1.8));
  const chasing = !!victim && dist2(head, victim.points[0]) < (420 * 420);
  const escaping = threat.threat > 0.06;

  let boost = false;
  if (escaping) boost = true;
  else if (chasing && safe && rand() < 0.75) boost = true;
  else if (safe && rand() < 0.03 * difficulty) boost = true;

  return { aim, boost };
}

// -------------------- Death / scoring --------------------

function spillDeathPellets(world: World, s: Snake) {
  // Convert some body segments into pellets.
  // Keep it bounded for perf.
  const pts = s.points;
  const count = clamp(Math.floor(pts.length * 0.6), KILL_SPILL_MIN, KILL_SPILL_MAX);

  for (let i = 0; i < count; i++) {
    const p = pts[Math.floor((i / count) * pts.length)];
    if (!p) continue;

    world.pellets.push({
      id: `d-${_pelletId++}`,
      pos: { x: p.x + rand(-10, 10), y: p.y + rand(-10, 10) },
      r: DEATH_PELLET_R,
      value: DEATH_PELLET_VALUE,
      kind: 'death',
      color: 'rgba(255,255,255,0.92)',
    });
  }
}

function killSnake(world: World, victim: Snake, killer: Snake | null) {
  if (!victim.alive) return;

  victim.alive = false;
  victim.deaths++;
  victim.respawnTimer = RESPAWN_SECONDS;

  // Spawn death pellets
  spillDeathPellets(world, victim);

  if (killer) {
    killer.kills++;
    killer.score += Math.max(10, victim.desiredLen * 0.08);
    world.events = world.events ?? {};
    world.events.lastKillAt = world.tick;
  }

  if (victim.isPlayer) {
    world.events = world.events ?? {};
    world.events.playerDiedAt = world.tick;
  }
}

// -------------------- Collisions (spatial grid) --------------------

function gridKey(cx: number, cy: number, cols: number) {
  return cx + cy * cols;
}

function ensureGrid(world: World): SpatialGrid {
  if (world._grid) return world._grid;

  const cellSize = 42;
  const cols = Math.ceil(world.W / cellSize);
  const rows = Math.ceil(world.H / cellSize);

  world._grid = {
    cellSize,
    cols,
    rows,
    buckets: new Map<number, { a: Vec[]; b: Vec[]; snakeIdx: number[]; r: number[] }>(),
    usedKeys: [],
  };

  return world._grid;
}

function clearGrid(grid: SpatialGrid) {
  // Clear only buckets used last frame (no Map re-allocation)
  for (let i = 0; i < grid.usedKeys.length; i++) {
    const key = grid.usedKeys[i];
    const b = grid.buckets.get(key);
    if (!b) continue;
    b.a.length = 0;
    b.b.length = 0;
    b.snakeIdx.length = 0;
    b.r.length = 0;
  }
  grid.usedKeys.length = 0;
}

function ensureBucket(grid: SpatialGrid, key: number) {
  let bucket = grid.buckets.get(key);
  if (!bucket) {
    bucket = { a: [], b: [], snakeIdx: [], r: [] };
    grid.buckets.set(key, bucket);
  }
  if (bucket.a.length === 0) {
    // First use this frame
    grid.usedKeys.push(key);
  }
  return bucket;
}

function addSegmentToGrid(grid: SpatialGrid, a: Vec, b: Vec, snakeIdx: number, radius: number) {
  // Insert the segment into every cell overlapped by its AABB expanded by radius.
  // Segments are short (BASE_SPACING), so this is typically 1–4 cells.
  const r = Number.isFinite(radius) ? radius : 0;
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minY = Math.min(a.y, b.y) - r;
  const maxY = Math.max(a.y, b.y) + r;

  const cx0 = clamp(Math.floor(minX / grid.cellSize), 0, grid.cols - 1);
  const cx1 = clamp(Math.floor(maxX / grid.cellSize), 0, grid.cols - 1);
  const cy0 = clamp(Math.floor(minY / grid.cellSize), 0, grid.rows - 1);
  const cy1 = clamp(Math.floor(maxY / grid.cellSize), 0, grid.rows - 1);

  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const key = gridKey(cx, cy, grid.cols);
      const bucket = ensureBucket(grid, key);
      bucket.a.push(a);
      bucket.b.push(b);
      bucket.snakeIdx.push(snakeIdx);
      bucket.r.push(r);
    }
  }
}

function dist2PointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  // Squared distance from point P to segment AB.
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-12) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function rebuildCollisionGrid(world: World) {
  const grid = ensureGrid(world);
  clearGrid(grid);

  // Store BODY as segments (capsules), not just points, so collisions don't miss gaps between samples.
  for (let si = 0; si < world.snakes.length; si++) {
    const s = world.snakes[si];
    if (!s.alive) continue;

    const pts = s.points;
    // Skip head + a few early segments to avoid instant 'head-head' accidental kills.
    const start = Math.min(6, pts.length - 1);

    for (let i = start; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      addSegmentToGrid(grid, a, b, si, s.radius);
    }
  }
}

function checkSnakeCollisions(world: World) {
  const grid = ensureGrid(world);

  for (let si = 0; si < world.snakes.length; si++) {
    const s = world.snakes[si];
    if (!s.alive) continue;

    const head = s.points[0];
    if (!head) continue;

    const hr = headRadius(s);
    const hr2Base = hr * hr;

    const cx = clamp(Math.floor(head.x / grid.cellSize), 0, grid.cols - 1);
    const cy = clamp(Math.floor(head.y / grid.cellSize), 0, grid.rows - 1);

    let died = false;

    // Check neighbors (3x3)
    for (let oy = -1; oy <= 1 && !died; oy++) {
      const ny = cy + oy;
      if (ny < 0 || ny >= grid.rows) continue;

      for (let ox = -1; ox <= 1 && !died; ox++) {
        const nx = cx + ox;
        if (nx < 0 || nx >= grid.cols) continue;

        const key = gridKey(nx, ny, grid.cols);
        const bucket = grid.buckets.get(key);
        if (!bucket || bucket.a.length === 0) continue;

        const A = bucket.a;
        const B = bucket.b;
        const owner = bucket.snakeIdx;
        const R = bucket.r;

        for (let k = 0; k < A.length; k++) {
          const otherIdx = owner[k];
          if (otherIdx === si) continue; // ignore own body (prevents glitchy self-kills)

          const a = A[k];
          const b = B[k];
          const br = R[k];
          const rr = hr + (Number.isFinite(br) ? br : 0);
          const rr2 = Number.isFinite(rr) ? (rr * rr) : hr2Base;

          const d2 = dist2PointSegment(head.x, head.y, a.x, a.y, b.x, b.y);
          if (d2 <= rr2) {
            const killer = world.snakes[otherIdx] ?? null;
            killSnake(world, s, killer);
            died = true;
            break;
          }
        }
      }
    }
  }
}

// -------------------- Main step --------------------

function makeSnake(index: number, isPlayer: boolean): Snake {
  const id = makeId(isPlayer ? 'player' : 'bot');
  const color = snakeColor(index);
  const baseSpeed = isPlayer ? PLAYER_BASE_SPEED : BOT_BASE_SPEED;

  const s: Snake = {
    id,
    name: isPlayer ? 'You' : `Bot ${index}`,
    color,
    isPlayer,

    dir: rand(-Math.PI, Math.PI),
    speed: baseSpeed,
    turnRate: isPlayer ? PLAYER_TURN : BOT_TURN,
    radius: isPlayer ? 14 : randInt(12, 14),

    points: [],
    desiredLen: randInt(36, 46),

    alive: true,
    respawnTimer: 0,

    boosting: false,
    boostHeat: 0,
    boostCooldown: 0,

    ai: {
      targetPelletId: null,
      wanderAngle: rand(-Math.PI, Math.PI),
      wanderTimer: rand(0.4, 1.2),
      targetSnakeId: null,
      evadeAngle: undefined,
      steerMemory: 0,
    },

    score: 0,
    kills: 0,
    deaths: 0,
  };

  return s;
}

export function createWorld(cfg: WorldConfig): World {
  const world: World = {
    W: WORLD_SIZE,
    H: WORLD_SIZE,
    tick: 0,
    pellets: [],
    snakes: [],
    maxPellets: 520,
    difficulty: clamp(cfg.difficulty ?? 1, 0.55, 2.0),
  };

  // Player first
  const player = makeSnake(0, true);
  initBodyAt(player, spawnPos(world));
  world.snakes.push(player);

  // Bots
  const bots = clamp(cfg.botCount | 0, 0, 28);
  for (let i = 0; i < bots; i++) {
    const b = makeSnake(i + 1, false);
    // speed + aggression scaling
    b.speed *= 0.9 + 0.16 * (world.difficulty ?? 1);
    initBodyAt(b, spawnPos(world));
    world.snakes.push(b);
  }

  fillPellets(world);

  // initial snapshot so first render doesn't smear
  for (const s of world.snakes) snapshotSnake(s);

  return world;
}

export function stepWorld(world: World, input: StepInput, dt: number) {
  world.tick += dt;
  world._dtLast = dt;

  // Keep pellet count stable (including death pellets)
  fillPellets(world);
  // Hard cap to avoid infinite growth from many deaths
  if (world.pellets.length > world.maxPellets * 1.6) {
    world.pellets.length = Math.floor(world.maxPellets * 1.6);
  }

  for (const s of world.snakes) {
    if (!s.alive) {
      s.respawnTimer -= dt;
      if (s.respawnTimer <= 0) {
        // Respawn
        s.alive = true;
        s.boostHeat = 0;
        s.boostCooldown = 0;
        s.desiredLen = randInt(36, 46);
        const pos = spawnPos(world);
        initBodyAt(s, pos);
        // Avoid a huge interpolation line from the death location → new spawn.
        snapshotSnake(s);
      }
      continue;
    }

    // Validate invariants once per tick (prevents NaN cascades)
    sanitizeSnakeInvariants(world, s);

    // Snapshot previous positions for render interpolation
    snapshotSnake(s);

    // Decide aim + boost
    let desiredDir: number | null = null;
    let wantBoost = false;

    if (s.isPlayer) {
      if (input.aimWorld) {
        desiredDir = angleTo(s.points[0], input.aimWorld);
      }
      wantBoost = !!input.boost;
    } else {
      const d = botDesired(world, s);
      desiredDir = d.aim;
      wantBoost = d.boost;
    }

    if (desiredDir != null) {
      // Smooth turning (clamped per dt)
      s.dir = rotateToward(s.dir, desiredDir, s.turnRate * dt);
    }

    // Speed depends on size (big snakes slightly slower)
    const sizeSlow = 1 / (1 + s.desiredLen / 520);
    const base = s.speed * (0.88 + 0.55 * sizeSlow);

    // Boost rules
    const canBoost = s.desiredLen > MIN_LEN + 2 && s.boostCooldown <= 0;
    s.boosting = wantBoost && canBoost;

    if (s.boosting) {
      // drain length slowly
      s.desiredLen -= BOOST_LEN_DRAIN_PER_SEC * dt;
      if (s.desiredLen < MIN_LEN) s.desiredLen = MIN_LEN;
      s.boostHeat = clamp(s.boostHeat + dt * 0.9, 0, 1);
    } else {
      s.boostHeat = clamp(s.boostHeat - dt * 0.8, 0, 1);
    }

    // if overheated, add small cooldown
    if (s.boostHeat >= 1 && wantBoost) {
      s.boostCooldown = clamp(s.boostCooldown + dt * 0.7, 0, 0.6);
    } else {
      s.boostCooldown = Math.max(0, s.boostCooldown - dt * 0.9);
    }

    const speed = base * (s.boosting ? BOOST_MULT : 1);

    // Move head
    const head = s.points[0];
    head.x += Math.cos(s.dir) * speed * dt;
    head.y += Math.sin(s.dir) * speed * dt;

    // Keep inside world bounds (soft clamp)
    head.x = clamp(head.x, 20, world.W - 20);
    head.y = clamp(head.y, 20, world.H - 20);

    // Keep body length in sync (boost drain / growth)
    ensureLength(s);

    // Follow body constraints
    follow(s.points, BASE_SPACING);

    // Eat pellets
    checkPelletEat(world, s);
  }

  // Collisions between snakes (after everyone moved)
  rebuildCollisionGrid(world);
  checkSnakeCollisions(world);

  // Leaderboard cache (for renderer) - not every frame
  world._leaderboardAcc = (world._leaderboardAcc ?? 0) + dt;
  if (world._leaderboardAcc >= LEADERBOARD_EVERY) {
    world._leaderboardAcc = 0;

    // Build a small top-N list without sorting whole arrays (keeps cost stable)
    const N = 6;
    const top: { id: string; name: string; score: number; color: string }[] = [];
    for (let i = 0; i < world.snakes.length; i++) {
      const s = world.snakes[i];
      if (!s.alive) continue;
      const item = { id: s.id, name: s.name, score: s.score, color: s.color };

      // insert into top (descending)
      let j = top.length;
      if (j < N) {
        top.push(item);
      } else if (item.score <= top[j - 1].score) {
        continue;
      } else {
        top[j - 1] = item;
      }

      // bubble item up (N is tiny, this is cheap)
      while (j > 0) {
        const a = top[j - 1];
        const b = top[j];
        if (!b || a.score >= b.score) break;
        top[j - 1] = b;
        top[j] = a;
        j--;
      }

      if (top.length > N) top.length = N;
    }

    world.leaderboard = top;
  }
}
