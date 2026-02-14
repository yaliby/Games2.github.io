import type { HeadBustEvent, Pellet, Snake, StepInput, Vec, World, WorldConfig, SpatialGrid, PelletGrid } from './types';

const TAU = Math.PI * 2;

// -------------------- Tuning --------------------

// Movement / body
const BASE_SPACING = 10;         // distance between points (like vertebrae)
const FOLLOW_ITERS = 10;         // constraint iterations (bigger = stiffer body, more accurate)
const PLAYER_BASE_SPEED = 220;
const BOT_BASE_SPEED = 200;
const BOOST_MULT = 1.6;
const BOOST_SPEED_SMOOTH = 0.04; // soften boost transition
const BOOST_BRAKE_SMOOTH = 0.03; // extra smoothing when leaving boost

// Smooth acceleration/deceleration
const ACCEL_RATE = 1000;         // px/sec² acceleration
const DECEL_RATE = 1100;         // px/sec² deceleration
const TURN_DAMPING = 0.92;       // velocity damping when turning sharply

// Boost costs length + energy, but never below MIN_LEN.
const BOOST_LEN_DRAIN_PER_SEC = 5.2;
const MIN_LEN = 26;
const MIN_ENERGY_TO_BOOST = 0.0; // minimum energy needed to start boost

// Steering
const PLAYER_TURN = 3.2; // rad/sec
const BOT_TURN = 3.2;

// World
const WORLD_SIZE = 3800;

// Pellets
const PELLET_TYPES = {
  small:  { val: 1,  r: 5.8, prob: 0.93 },
  medium: { val: 4,  r: 8.2, prob: 0.06 },
  large:  { val: 10, r: 12.0, prob: 0.01 },
  gold:   { val: 30, r: 16.0, prob: 0.002 },
  death:  { val: 2.5, r: 7.5 } // Special case
};
const PELLET_SPAWN_RATE = 55;  // pellets per second to maintain
const PELLET_MIN_DISTANCE = 45;  // minimum distance from snakes when spawning
const PELLET_GRID_CELL = 120;
const PELLET_EAT_PAD = 10;       // extra "magnet" radius for eating like Slither.io

// Combat
const KILL_SPILL_MIN = 22;
const KILL_SPILL_MAX = 180;
const HEAD_COLLISION_RADIUS = 1.15; // head collision multiplier

// Respawn
const RESPAWN_SECONDS = 1.15;
const SPAWN_INVULN_SECONDS = 1.1;

// HUD / leaderboard refresh
const LEADERBOARD_EVERY = 0.15; // seconds

const MIN_POINTS = 5;
const MAX_POINTS_LEN = 6000; // safety cap to prevent runaway lengths

// -------------------- Utils --------------------

function safeLen(v: number): number {
  if (!Number.isFinite(v)) return MIN_POINTS;
  const n = Math.floor(v);
  if (n < MIN_POINTS) return MIN_POINTS;
  if (n > MAX_POINTS_LEN) return MAX_POINTS_LEN;
  return n;
}

function sanitizeSnakeInvariants(world: World, s: Snake) {
  if (!Number.isFinite(s.dir)) s.dir = 0;
  if (!Number.isFinite(s.radius) || s.radius <= 0) s.radius = s.isPlayer ? 14 : 13;
  if (!Number.isFinite(s.speed) || s.speed <= 0) s.speed = s.isPlayer ? PLAYER_BASE_SPEED : BOT_BASE_SPEED;
  if (!Number.isFinite(s.targetSpeed) || s.targetSpeed <= 0) s.targetSpeed = s.speed;
  if (!Number.isFinite(s.velX)) s.velX = 0;
  if (!Number.isFinite(s.velY)) s.velY = 0;
  if (!Number.isFinite(s.energy)) s.energy = 1.0;

  if (!Number.isFinite(s.desiredLen)) s.desiredLen = MIN_LEN;
  if (s.desiredLen < MIN_LEN) s.desiredLen = MIN_LEN;
  if (s.desiredLen > MAX_POINTS_LEN) s.desiredLen = MAX_POINTS_LEN;

  // Sanitize additional properties
  if (!Number.isFinite(s.boostHeat)) s.boostHeat = 0;
  if (!Number.isFinite(s.boostCooldown)) s.boostCooldown = 0;
  if (!Number.isFinite(s.spawnInvuln)) s.spawnInvuln = 0;
  if (!Number.isFinite(s.respawnTimer)) s.respawnTimer = 0;
  if (!Number.isFinite(s.boostDropAcc)) s.boostDropAcc = 0;

  const head = s.points[0];
  if (!head) {
    s.points.push({ x: 0, y: 0 });
    initBodyAt(s, s.points[0]);
  } else {
    if (!Number.isFinite(head.x)) head.x = 0;
    if (!Number.isFinite(head.y)) head.y = 0;

    // Clamp head position to world bounds
    const dist = Math.sqrt(head.x * head.x + head.y * head.y);
    if (dist > world.radius - 50) {
      const factor = (world.radius - 50) / dist;
      head.x *= factor;
      head.y *= factor;
    }

    if (s.points.length === 0) {
      initBodyAt(s, head);
    }
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

function dist(a: Vec, b: Vec) {
  return Math.sqrt(dist2(a, b));
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
  const hue = (i * 53) % 360; // spread colors evenly, avoid repeats
  return `hsl(${hue}, 85%, 58%)`;
}

function nextDistinctColor(startIndex: number, used: Set<string>) {
  let i = startIndex;
  let c = snakeColor(i);
  let guard = 0;
  while (used.has(c) && guard < 200) {
    i++;
    c = snakeColor(i);
    guard++;
  }
  return { color: c, index: i + 1 };
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
  const dir = s.dir;
  for (let i = 0; i < n; i++) {
    s.points.push({ 
      x: pos.x - Math.cos(dir) * BASE_SPACING * i, 
      y: pos.y - Math.sin(dir) * BASE_SPACING * i 
    });
  }
  // Initialize velocity
  s.velX = Math.cos(dir) * s.speed;
  s.velY = Math.sin(dir) * s.speed;
  s.targetSpeed = s.speed;
}

function ensureLength(s: Snake, spacing: number) {
  const desired = safeLen(s.renderLen ?? s.desiredLen);

  if (s.points.length < desired) {
    // Growth: Only add a new segment if the tail has moved far enough from the previous segment.
    // This prevents "stacking" or "instant extrusion". The snake grows as it moves.
    const tail = s.points[s.points.length - 1];
    const prev = s.points[s.points.length - 2];
    
    if (!tail || !prev) {
      // Initialize or edge case
      s.points.push({ x: tail?.x || 0, y: tail?.y || 0 });
    } else {
      const d2 = dist2(tail, prev);
      const minGap = spacing * 0.95;
      if (d2 >= minGap * minGap) {
        // There is room; duplicate the tail point to fill the gap
        s.points.push({ x: tail.x, y: tail.y });
      }
    }
  } else if (s.points.length > desired) {
    s.points.length = desired;
  }
}

function follow(points: Vec[], spacing: number) {
  // Improved follow-the-leader with better physics
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
      // Apply correction with damping for smoother movement
      const correction = err * 0.8;
      b.x -= nx * correction;
      b.y -= ny * correction;
    }
  }
}

function headRadius(s: Snake) {
  return s.radius * HEAD_COLLISION_RADIUS;
}

// -------------------- Pellets --------------------

let _pelletId = 0;

function ensurePelletGrid(world: World): PelletGrid {
  if (world._pelletGrid) return world._pelletGrid;
  const cellSize = PELLET_GRID_CELL;
  const cols = Math.ceil((world.radius * 2) / cellSize);
  const rows = Math.ceil((world.radius * 2) / cellSize);
  world._pelletGrid = {
    cellSize,
    cols,
    rows,
    buckets: new Map<number, { idx: number[] }>(),
    usedKeys: [],
  };
  world._pelletGridDirty = true;
  return world._pelletGrid;
}

function clearPelletGrid(grid: PelletGrid) {
  for (let i = 0; i < grid.usedKeys.length; i++) {
    const key = grid.usedKeys[i];
    const b = grid.buckets.get(key);
    if (!b) continue;
    b.idx.length = 0;
  }
  grid.usedKeys.length = 0;
}

function ensurePelletBucket(grid: PelletGrid, key: number) {
  let bucket = grid.buckets.get(key);
  if (!bucket) {
    bucket = { idx: [] };
    grid.buckets.set(key, bucket);
  }
  if (bucket.idx.length === 0) grid.usedKeys.push(key);
  return bucket;
}

function rebuildPelletGrid(world: World) {
  const grid = ensurePelletGrid(world);
  clearPelletGrid(grid);
  const cols = grid.cols;
  for (let i = 0; i < world.pellets.length; i++) {
    const p = world.pellets[i];
    const cx = clamp(Math.floor((p.pos.x + world.radius) / grid.cellSize), 0, grid.cols - 1);
    const cy = clamp(Math.floor((p.pos.y + world.radius) / grid.cellSize), 0, grid.rows - 1);
    const key = gridKey(cx, cy, cols);
    ensurePelletBucket(grid, key).idx.push(i);
  }
  world._pelletGridDirty = false;
}

function forNearbyPellets(
  world: World,
  x: number,
  y: number,
  radius: number,
  cb: (pelletIndex: number) => void,
) {
  const grid = ensurePelletGrid(world);
  if (world._pelletGridDirty) rebuildPelletGrid(world);
  const r = Math.max(1, radius);
  const cx0 = clamp(Math.floor((x - r + world.radius) / grid.cellSize), 0, grid.cols - 1);
  const cx1 = clamp(Math.floor((x + r + world.radius) / grid.cellSize), 0, grid.cols - 1);
  const cy0 = clamp(Math.floor((y - r + world.radius) / grid.cellSize), 0, grid.rows - 1);
  const cy1 = clamp(Math.floor((y + r + world.radius) / grid.cellSize), 0, grid.rows - 1);
  const cols = grid.cols;

  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const key = gridKey(cx, cy, cols);
      const b = grid.buckets.get(key);
      if (!b || b.idx.length === 0) continue;
      const arr = b.idx;
      for (let i = 0; i < arr.length; i++) cb(arr[i]);
    }
  }
}

function spawnPos(world: World, avoidSnakes: boolean = true): Vec {
  let attempts = 0;
  while (attempts < 50) {
    // Random point in circle
    const r = Math.sqrt(rand()) * (world.radius - 100);
    const theta = rand(0, TAU);
    const pos = { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
    
    if (!avoidSnakes) return pos;
    
    // Check distance from all snake heads and some body points (cheap safe-spawn).
    let tooClose = false;
    for (const s of world.snakes) {
      if (!s.alive || s.points.length === 0) continue;
      const d = dist(pos, s.points[0]);
      if (d < PELLET_MIN_DISTANCE) {
        tooClose = true;
        break;
      }
      const pts = s.points;
      const step = pts.length > 260 ? 10 : (pts.length > 120 ? 6 : 4);
      const minD2 = (s.radius + PELLET_TYPES.small.r + 6) ** 2;
      for (let i = 6; i < pts.length; i += step) {
        const p = pts[i];
        const dx = pos.x - p.x;
        const dy = pos.y - p.y;
        if (dx * dx + dy * dy < minD2) { tooClose = true; break; }
      }
      if (tooClose) break;
    }
    
    if (!tooClose) return pos;
    attempts++;
  }
  
  // Fallback if can't find safe spot
  const r = Math.sqrt(rand()) * (world.radius - 100);
  const theta = rand(0, TAU);
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

function makePellet(world: World, kind: 'random' | 'death' = 'random', avoidSnakes: boolean = true): Pellet {
  const pos = spawnPos(world, avoidSnakes && kind === 'random');
  _pelletId++;
  
  if (kind === 'death') {
    return {
      id: `d-${_pelletId}`,
      pos,
      r: PELLET_TYPES.death.r,
      value: PELLET_TYPES.death.val,
      kind: 'death',
      color: '#FFD700', // Gold-ish for death pellets
    };
  }

  // Random generation based on probability
  const r = Math.random();
  let type: keyof typeof PELLET_TYPES = 'small';
  if (r < PELLET_TYPES.gold.prob) type = 'gold';
  else if (r < PELLET_TYPES.gold.prob + PELLET_TYPES.large.prob) type = 'large';
  else if (r < PELLET_TYPES.gold.prob + PELLET_TYPES.large.prob + PELLET_TYPES.medium.prob) type = 'medium';

  return {
    id: `pel-${_pelletId}`,
    pos,
    r: PELLET_TYPES[type].r,
    value: PELLET_TYPES[type].val,
    kind: type,
    color: type === 'gold' ? '#FFD700' : (type === 'large' ? '#00FFFF' : (type === 'medium' ? '#FF00FF' : `hsl(${rand(0,360)}, 80%, 60%)`)),
  };
}

function fillPellets(world: World) {
  const target = world.maxPellets;
  const current = world.pellets.length;
  const dt = world._dtLast ?? 0.016;

  if (current < target) {
    world._pelletSpawnAcc = (world._pelletSpawnAcc ?? 0) + PELLET_SPAWN_RATE * dt;
    const budget = Math.floor(world._pelletSpawnAcc);
    const minSpawn = Math.max(0, Math.ceil((target - current) * 0.08));
    const toSpawn = Math.min(Math.max(budget, minSpawn), target - current);
    if (toSpawn > 0) {
      world._pelletSpawnAcc = Math.max(0, (world._pelletSpawnAcc ?? 0) - toSpawn);
      for (let i = 0; i < toSpawn; i++) {
        world.pellets.push(makePellet(world, 'random', true));
      }
      world._pelletGridDirty = true;
    }
  } else {
    world._pelletSpawnAcc = 0;
  }
}

function checkPelletEat(world: World, s: Snake) {
  const head = s.points[0];
  const r = headRadius(s) + PELLET_EAT_PAD;
  const dt = world._dtLast ?? 0.016;
  let moved = false;

  // Query only nearby pellets (avoids O(N) scans).
  const toEat: number[] = [];
  forNearbyPellets(world, head.x, head.y, r + 18, (pi) => {
    const p = world.pellets[pi];
    if (!p) return;
    const dx = p.pos.x - head.x;
    const dy = p.pos.y - head.y;
    const rr = r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 <= rr * rr) {
      toEat.push(pi);
      return;
    }

    // Light magnet effect when very close (Slither-like suction)
    const magnetR = rr + 40;
    if (d2 <= magnetR * magnetR) {
      const d = Math.sqrt(d2) || 1;
      const pull = (1 - d / magnetR) * (120 * dt);
      p.pos.x -= (dx / d) * pull;
      p.pos.y -= (dy / d) * pull;
      moved = true;
    }
  });

  if (toEat.length === 0) return;

  // Eat highest indices first to keep swap-remove safe.
  toEat.sort((a, b) => b - a);
  for (let k = 0; k < toEat.length; k++) {
    const i = toEat[k];
    const p = world.pellets[i];
    if (!p) continue;

    // One tile per pellet; higher value only thickens.
    s.growAcc += 1;
    s.mass = (s.mass || s.desiredLen) + p.value;

    const last = world.pellets[world.pellets.length - 1];
    world.pellets[i] = last;
    world.pellets.pop();
  }
  if (toEat.length > 0 || moved) world._pelletGridDirty = true;
}

// -------------------- Bot AI (Human-like) --------------------

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
    threat += (1 / d) * (1 + s.desiredLen / 200);

    // Predicted position
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
  const head = bot.points[0];
  const difficulty = world.difficulty ?? 1;

  let bestIdx = -1;
  let bestScore = -1;

  // Nearby pellet search via grid (fast + more "human" because it doesn't see everything).
  const scanR = clamp(700 + difficulty * 600, 700, 2000);
  forNearbyPellets(world, head.x, head.y, scanR, (i) => {
    const p = world.pellets[i];
    if (!p) return;

    const dx = p.pos.x - head.x;
    const dy = p.pos.y - head.y;
    const d2 = dx * dx + dy * dy;

    if (d2 > scanR * scanR) return;

    const d = Math.sqrt(d2) || 1;

    // Prefer pellets ahead
    const toPel = Math.atan2(p.pos.y - head.y, p.pos.x - head.x);
    const ang = Math.abs(wrapAngle(toPel - bot.dir));
    const aheadBonus = 1.0 - clamp(ang / Math.PI, 0, 1) * 0.65;

    // Avoid dangerous pellets (human-like risk assessment)
    const t = threatAt(world, p.pos, 260);
    const safeMul = 1.05 - clamp(t, 0, 1) * (0.72 + 0.15 * difficulty);

    // Value preference
    const vMul = 1 + (p.value - 1) * 0.5;

    // Add some randomness for human-like imperfection (less on higher difficulty)
    const randBase = clamp(0.85 - (difficulty - 1) * 0.06, 0.72, 0.88);
    const randSpan = clamp(0.3 - (difficulty - 1) * 0.08, 0.12, 0.3);
    const randomness = randBase + rand(0, randSpan);
    const score = (1 / (d + 1)) * 1600 * aheadBonus * safeMul * vMul * randomness;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });

  const best = bestIdx >= 0 ? (world.pellets[bestIdx] ?? null) : null;
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
      const huntRange = clamp(900 + difficulty * 260, 900, 1650);
      if (d2 > huntRange * huntRange) continue;

    const d = Math.sqrt(d2) || 1;

    let score = (1 / (d + 1)) * 2000;
    score *= 1.2 - Math.min(0.9, s.desiredLen / 500);
      if (s.isPlayer) score *= 1.45 + 0.1 * difficulty;

    score *= 0.9 + 0.6 * difficulty;

    // Human-like: sometimes ignore good targets (less on higher difficulty)
      if (rand() < clamp(0.12 - difficulty * 0.035, 0.01, 0.12)) score *= 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  bot.ai.targetSnakeId = best ? best.id : null;
  return best;
}

function botComputeThreat(world: World, bot: Snake) {
  const head = bot.points[0];
  const dt = world._dtLast || 0.016;

  let ax = 0;
  let ay = 0;
  let threat = 0;

  const diff = world.difficulty ?? 1;
  for (const s of world.snakes) {
    if (!s.alive || s.id === bot.id) continue;

    const pts = s.points;
    const isPlayer = s.isPlayer;
    const step = isPlayer ? 1 : (diff >= 2.2 ? 1 : (pts.length > 140 ? 3 : 2));
    const playerMul = isPlayer ? (1.6 + diff * 0.35) : (1 + diff * 0.05);
    const rangeMul = 1 + (diff - 1) * 0.25;

    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const dx = head.x - p.x;
      const dy = head.y - p.y;
      const d2 = dx * dx + dy * dy;
      const bodyRange = (isPlayer ? 420 : 320) * rangeMul;
      if (d2 > bodyRange * bodyRange) continue;

      const d = Math.sqrt(d2) || 1;
      const w = (1 / d) * (1 + (s.desiredLen / 90) * 0.18) * playerMul;

      ax += (dx / d) * w;
      ay += (dy / d) * w;

      threat = Math.max(threat, w);
    }

    // Lookahead
    const otherHead = pts[0];
    const lookSecs = 0.5;
    
    // Predict position considering turn (angular velocity)
    const turnRate = wrapAngle(s.dir - (s._prevDir ?? s.dir)) / dt;
    let px, py;

    if (Math.abs(turnRate) < 0.1) {
      px = otherHead.x + Math.cos(s.dir) * s.speed * lookSecs;
      py = otherHead.y + Math.sin(s.dir) * s.speed * lookSecs;
    } else {
      const r = s.speed / turnRate;
      const cx = otherHead.x - Math.sin(s.dir) * r;
      const cy = otherHead.y + Math.cos(s.dir) * r;
      const nextDir = s.dir + turnRate * lookSecs;
      px = cx + Math.sin(nextDir) * r;
      py = cy - Math.cos(nextDir) * r;
    }

    const pdx = head.x - px;
    const pdy = head.y - py;
    const pd2 = pdx * pdx + pdy * pdy;
    const headRange = (isPlayer ? 320 : 220) * rangeMul;
    if (pd2 < headRange * headRange) {
      const pd = Math.sqrt(pd2) || 1;
      const bonus = (1 / pd) * (0.8 + Math.min(1.2, s.desiredLen / 200)) * playerMul;
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

  // Reaction delay simulation
  bot.ai.reactionTimer -= world._dtLast ?? 0;
  if (bot.ai.reactionTimer > 0) {
    return { aim: bot.ai.currentAim, boost: bot.boosting };
  }
    const reactMin = clamp(0.02 + (1.4 - difficulty) * 0.015, 0.01, 0.06);
    const reactMax = clamp(0.08 + (1.2 - difficulty) * 0.04, 0.03, 0.12);
    bot.ai.reactionTimer = rand(reactMin, reactMax); // Faster reaction on higher difficulty

  // Wander timer (human-like exploration)
  bot.ai.wanderTimer -= world._dtLast ?? 0;
  if (bot.ai.wanderTimer <= 0) {
    const wanderMax = clamp(2.8 - difficulty * 0.6, 1.0, 2.8);
    const wanderMin = clamp(1.2 - difficulty * 0.25, 0.4, 1.2);
    bot.ai.wanderTimer = rand(wanderMin, wanderMax);
    bot.ai.wanderAngle = rand(-Math.PI, Math.PI);
  }

  const targetPellet: Pellet | null = botPickTarget(world, bot);
  const threat = botComputeThreat(world, bot);

  // Occasionally attempt intercept (with human-like hesitation)
  let victim: Snake | null = null;
  if (rand() < 0.32 * difficulty) {
    victim = botPickVictim(world, bot);
    // Sometimes change mind (human-like)
    if (victim && rand() < 0.05) victim = null;
  }

  // Combine steering vectors
  let dx = 0;
  let dy = 0;

  // Pellet attraction
  if (targetPellet) {
    const a = angleTo(head, targetPellet.pos);
    const pelletThreat = threatAt(world, targetPellet.pos, 260);
    const pelletWeight = pelletThreat > 0.7 ? (0.25 + 0.1 * difficulty) : (1.0 + 0.15 * difficulty);

    dx += Math.cos(a) * (1.0 * pelletWeight);
    dy += Math.sin(a) * (1.0 * pelletWeight);
  }

  if (victim && victim.alive) {
    // Aim ahead with improved lead
    const vHead = victim.points[0];
    const d2 = dist2(head, vHead);
    const d = Math.sqrt(d2) || 1;
    const baseLead = clamp(0.28 + (difficulty - 1) * 0.22, 0.25, 0.7);
    const speedFactor = Math.min(1.5, (bot.speed + 40) / (victim.speed + 20));
    const lead = clamp(baseLead * speedFactor * (1 + Math.max(0, 600 - d) / 900), 0.2, 0.9);

    const ax2 = vHead.x + Math.cos(victim.dir) * victim.speed * lead;
    const ay2 = vHead.y + Math.sin(victim.dir) * victim.speed * lead;
    const a = Math.atan2(ay2 - head.y, ax2 - head.x);

    dx += Math.cos(a) * 1.25;
    dy += Math.sin(a) * 1.25;
  }

  // Avoid threats
    dx += threat.ax * (1.6 + 0.2 * difficulty);
    dy += threat.ay * (1.6 + 0.2 * difficulty);

  // Evasive memory (human-like panic response)
  const threatLevel = threat.threat;
    if (threatLevel > 0.055) {
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
  const distFromCenter = Math.sqrt(head.x * head.x + head.y * head.y);
  const distToWall = world.radius - distFromCenter;
    if (distToWall < 420) {
      const angleToCenter = Math.atan2(-head.y, -head.x);
      const urgency = 1 - (distToWall / 420);
      dx += Math.cos(angleToCenter) * (4.5 + 0.6 * difficulty) * urgency;
      dy += Math.sin(angleToCenter) * (4.5 + 0.6 * difficulty) * urgency;
    }

  const aim = Math.atan2(dy, dx);

  // Boost logic (human-like: sometimes boost when shouldn't, sometimes don't when should)
  const safe = threat.threat < 0.04 * (2 - clamp(difficulty, 0.7, 2.0));
  const chasing = !!victim && dist2(head, victim.points[0]) < (420 * 420);
  const escaping = threat.threat > 0.06;
  const closePellet = targetPellet ? dist2(head, targetPellet.pos) < (200 * 200) : false;
  const attackAngle = victim ? Math.abs(wrapAngle(aim - bot.dir)) : Math.PI;
  const aimDiff = Math.abs(wrapAngle(aim - bot.dir));

  let boost = false;
  if (escaping) {
    boost = rand() < (0.98 + 0.03 * difficulty);
  } else if (chasing) {
    boost = rand() < (0.92 + 0.18 * difficulty);
    // If aiming well at victim, boost more aggressively to cut off.
    if (attackAngle < 0.6) boost = true;
  } else if (closePellet && safe) {
    boost = rand() < (0.4 + 0.15 * difficulty);
  } else if (safe) {
    boost = rand() < (0.2 * difficulty);
  }

  // Don't waste boost while turning hard (unless escaping)
  if (!escaping && aimDiff > 0.9) boost = false;

  bot.ai.currentAim = aim;
  return { aim, boost };
}

// -------------------- Death / scoring --------------------

function spillDeathPellets(world: World, s: Snake) {
  // Convert body segments into pellets (like Slither.io)
  const pts = s.points;
  const baseLen = Math.max(pts.length, s.renderLen ?? 0, s.mass ?? 0, MIN_LEN);
  const count = clamp(Math.floor(baseLen * 0.7), KILL_SPILL_MIN, KILL_SPILL_MAX);
  const head = pts[0] ?? spawnPos(world, false);

  // Reserve capacity for death pellets so they are not trimmed immediately.
  world._reservedDeathPellets = (world._reservedDeathPellets ?? 0) + count;

  for (let i = 0; i < count; i++) {
    let px = head.x;
    let py = head.y;
    if (pts.length > 0) {
      const idx = Math.floor((i / count) * Math.max(1, pts.length));
      const p = pts[idx];
      if (p) {
        px = p.x;
        py = p.y;
      }
    }

    // Add slight randomness for natural spread
    world.pellets.push({
      id: `d-${_pelletId++}`,
      pos: { x: px + rand(-12, 12), y: py + rand(-12, 12) },
      r: PELLET_TYPES.death.r,
      value: PELLET_TYPES.death.val,
      kind: 'death',
      color: s.color, // Drop body color
    });
  }
  world._pelletGridDirty = true;
}

function trimPellets(world: World, limit: number) {
  if (world.pellets.length <= limit) return;

  // Prefer removing non-death pellets first, so death drops stay visible.
  let i = 0;
  while (world.pellets.length > limit && i < world.pellets.length) {
    const p = world.pellets[i];
    if (p && p.kind !== 'death') {
      world.pellets[i] = world.pellets[world.pellets.length - 1];
      world.pellets.pop();
      continue;
    }
    i++;
  }

  while (world.pellets.length > limit) {
    world.pellets.pop();
  }

  world._pelletGridDirty = true;
}

function killSnake(world: World, victim: Snake, killer: Snake | null) {
  if (!victim.alive) return;
  // Already protected (fresh spawn) → ignore kills.
  if ((victim.spawnInvuln ?? 0) > 0) return;

  victim.alive = false;
  victim.deaths++;
  victim.respawnTimer = RESPAWN_SECONDS;
  victim.spawnInvuln = 0;
  victim.score = 0;
  victim.desiredLen = MIN_LEN;
  victim.boostDropAcc = 0;
  victim.growAcc = 0;
  victim.renderLen = MIN_LEN;
  victim.mass = MIN_LEN;

  // Spawn death pellets
  spillDeathPellets(world, victim);

  if (killer) {
    killer.kills++;
    world.events = world.events ?? {};
    world.events.lastKillAt = world.tick;
  }

  if (victim.isPlayer) {
    world.events = world.events ?? {};
    world.events.playerDiedAt = world.tick;
  }
}

function queueHeadBust(world: World, a: Snake, b: Snake) {
  world.events = world.events ?? {};
  if (world.events.headBust) return;

  const evt: HeadBustEvent = {
    snakeAId: a.id,
    snakeBId: b.id,
    atTick: world.tick,
  };
  world.events.headBust = evt;
}

function resolveBotHeadBust(world: World, a: Snake, b: Snake) {
  const aPower = (a.score || a.desiredLen) + a.kills * 4 + rand(-16, 16);
  const bPower = (b.score || b.desiredLen) + b.kills * 4 + rand(-16, 16);
  if (aPower >= bPower) {
    killSnake(world, b, a);
  } else {
    killSnake(world, a, b);
  }
}

// -------------------- Collisions (spatial grid) --------------------

function gridKey(cx: number, cy: number, cols: number) {
  return cx + cy * cols;
}

function ensureGrid(world: World): SpatialGrid {
  if (world._grid) return world._grid;

  const cellSize = 42;
  const cols = Math.ceil((world.radius * 2) / cellSize);
  const rows = Math.ceil((world.radius * 2) / cellSize);

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
    grid.usedKeys.push(key);
  }
  return bucket;
}

function addSegmentToGrid(grid: SpatialGrid, a: Vec, b: Vec, snakeIdx: number, radius: number, world: World) {
  const r = Number.isFinite(radius) ? radius : 0;
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minY = Math.min(a.y, b.y) - r;
  const maxY = Math.max(a.y, b.y) + r;

  const cx0 = clamp(Math.floor((minX + world.radius) / grid.cellSize), 0, grid.cols - 1);
  const cx1 = clamp(Math.floor((maxX + world.radius) / grid.cellSize), 0, grid.cols - 1);
  const cy0 = clamp(Math.floor((minY + world.radius) / grid.cellSize), 0, grid.rows - 1);
  const cy1 = clamp(Math.floor((maxY + world.radius) / grid.cellSize), 0, grid.rows - 1);

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

function dist2SegmentSegment(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
) {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = dx - cx;
  const vy = dy - cy;
  const wx = ax - cx;
  const wy = ay - cy;

  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const D = a * c - b * b;

  let sN = 0;
  let tN = 0;
  let sD = D;
  let tD = D;

  if (D < 1e-8) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = (b * e - c * d);
    tN = (a * e - b * d);
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0) {
    tN = 0;
    if (-d < 0) {
      sN = 0;
    } else if (-d > a) {
      sN = sD;
    } else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) {
      sN = 0;
    } else if (-d + b > a) {
      sN = sD;
    } else {
      sN = -d + b;
      sD = a;
    }
  }

  const sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;

  const dx2 = wx + sc * ux - tc * vx;
  const dy2 = wy + sc * uy - tc * vy;
  return dx2 * dx2 + dy2 * dy2;
}

function rebuildCollisionGrid(world: World) {
  const grid = ensureGrid(world);
  clearGrid(grid);

  for (let si = 0; si < world.snakes.length; si++) {
    const s = world.snakes[si];
    if (!s.alive) continue;
    // Spawn shield: while protected, don't make this snake lethal to others yet.
    if ((s.spawnInvuln ?? 0) > 0) continue;

    const pts = s.points;
    const start = Math.min(6, pts.length - 1);

    for (let i = start; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      addSegmentToGrid(grid, a, b, si, s.radius, world);
    }
  }
}

function checkSnakeCollisions(world: World) {
  // During a headbust duel, collisions are temporarily frozen.
  if (world.events?.headBust) return;

  const grid = ensureGrid(world);

  // First check head-to-head collisions
  for (let i = 0; i < world.snakes.length; i++) {
    const s1 = world.snakes[i];
    if (!s1.alive || s1.points.length === 0) continue;
    if ((s1.spawnInvuln ?? 0) > 0) continue;

      const h1 = s1.points[0];
      const r1 = s1.radius * 0.9;
      const h1px = s1._prev && s1._prevLen ? s1._prev[0] : h1.x;
      const h1py = s1._prev && s1._prevLen ? s1._prev[1] : h1.y;

    for (let j = i + 1; j < world.snakes.length; j++) {
      const s2 = world.snakes[j];
      if (!s2.alive || s2.points.length === 0) continue;
      if ((s2.spawnInvuln ?? 0) > 0) continue;

        const h2 = s2.points[0];
        const r2 = s2.radius * 0.9;
        const h2px = s2._prev && s2._prevLen ? s2._prev[0] : h2.x;
        const h2py = s2._prev && s2._prevLen ? s2._prev[1] : h2.y;
        const rSum = r1 + r2;

        const d2Now = dist2(h1, h2);
        const d2Swept = dist2SegmentSegment(h1px, h1py, h1.x, h1.y, h2px, h2py, h2.x, h2.y);
        if (d2Now <= rSum * rSum || d2Swept <= rSum * rSum) {
          // Player-involved head clash is resolved in the HEADBUST screen.
          if (s1.isPlayer || s2.isPlayer) {
            queueHeadBust(world, s1, s2);
            return;
          }

          // Bot-vs-bot clashes no longer kill both; one wins and survives.
          resolveBotHeadBust(world, s1, s2);
        }
      }
  }

  // Then check head-to-body collisions
  for (let si = 0; si < world.snakes.length; si++) {
    const s = world.snakes[si];
    if (!s.alive) continue;
    if ((s.spawnInvuln ?? 0) > 0) continue;

    const head = s.points[0];
    if (!head) continue;

    const hr = headRadius(s);
    const hr2Base = hr * hr;

    const cx = clamp(Math.floor((head.x + world.radius) / grid.cellSize), 0, grid.cols - 1);
    const cy = clamp(Math.floor((head.y + world.radius) / grid.cellSize), 0, grid.rows - 1);

    let died = false;

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
          if (otherIdx === si) continue;

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

function makeSnake(index: number, isPlayer: boolean, colorOverride?: string): Snake {
  const id = makeId(isPlayer ? 'player' : 'bot');
  const color = colorOverride ?? snakeColor(index);
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

    velX: 0,
    velY: 0,
    targetSpeed: baseSpeed,

    points: [],
    desiredLen: randInt(36, 46),
    growAcc: 0,
    renderLen: 0,
    mass: 0,

    alive: true,
    respawnTimer: 0,
    spawnInvuln: SPAWN_INVULN_SECONDS,

    boosting: false,
    boostHeat: 0,
    boostCooldown: 0,
    energy: 1.0,
    boostDropAcc: 0,

    ai: {
      targetPelletId: null,
      wanderAngle: rand(-Math.PI, Math.PI),
      wanderTimer: rand(0.4, 1.2),
      targetSnakeId: null,
      evadeAngle: undefined,
      steerMemory: 0,
      reactionTimer: 0,
      currentAim: 0,
    },

    score: 0,
    kills: 0,
    deaths: 0,
  };

  return s;
}

function spawnPosFarFrom(world: World, avoidSnakes: boolean, avoidPos: Vec | null, minDist: number): Vec {
  if (!avoidPos) return spawnPos(world, avoidSnakes);
  let attempts = 0;
  while (attempts < 80) {
    const pos = spawnPos(world, avoidSnakes);
    const dx = pos.x - avoidPos.x;
    const dy = pos.y - avoidPos.y;
    if (dx * dx + dy * dy >= minDist * minDist) return pos;
    attempts++;
  }
  return spawnPos(world, avoidSnakes);
}

export function createWorld(cfg: WorldConfig): World {
  const world: World = {
    radius: WORLD_SIZE,
    tick: 0,
    pellets: [],
    snakes: [],
    maxPellets: 1100,
    difficulty: clamp(cfg.difficulty ?? 1, 0.55, 3.0),
  };

  const usedColors = new Set<string>();
  const playerColor = cfg.playerColor?.trim() || snakeColor(0);
  usedColors.add(playerColor);

  const player = makeSnake(0, true, playerColor);
  initBodyAt(player, spawnPos(world, false));
  player.renderLen = player.desiredLen;
  player.mass = player.desiredLen;
  world.snakes.push(player);

  const bots = clamp(cfg.botCount | 0, 0, 36);
  const cameraSafeRadius = Math.min(1200, world.radius * 0.35);
  let colorIndex = 1;
  for (let i = 0; i < bots; i++) {
    const next = nextDistinctColor(colorIndex, usedColors);
    colorIndex = next.index;
    usedColors.add(next.color);
    const b = makeSnake(i + 1, false, next.color);
    b.speed *= 0.9 + 0.2 * (world.difficulty ?? 1);
    b.targetSpeed = b.speed;
    const farPos = spawnPosFarFrom(world, true, player.points[0] ?? null, cameraSafeRadius);
    initBodyAt(b, farPos);
    b.renderLen = b.desiredLen;
    b.mass = b.desiredLen;
    world.snakes.push(b);
  }

  for (let i = 0; i < world.maxPellets; i++) {
    world.pellets.push(makePellet(world, 'random', true));
  }
  world._pelletGridDirty = true;

  for (const s of world.snakes) snapshotSnake(s);

  return world;
}

export function resolveHeadBust(world: World, winnerId: string, loserId: string) {
  if (winnerId === loserId) {
    world.events = world.events ?? {};
    world.events.headBust = undefined;
    world.events.headBustResolvedAt = world.tick;
    return false;
  }

  const winner = world.snakes.find((s) => s.id === winnerId) ?? null;
  const loser = world.snakes.find((s) => s.id === loserId) ?? null;

  if (!winner || !loser) {
    world.events = world.events ?? {};
    world.events.headBust = undefined;
    world.events.headBustResolvedAt = world.tick;
    return false;
  }

  if (loser.alive) {
    killSnake(world, loser, winner.alive ? winner : null);
  }

  world.events = world.events ?? {};
  world.events.headBust = undefined;
  world.events.headBustResolvedAt = world.tick;
  return true;
}

export function stepWorld(world: World, input: StepInput, dt: number) {
  if (world.events?.headBust) {
    world._dtLast = 0;
    return;
  }

  world.tick += dt;
  world._dtLast = dt;

  fillPellets(world);
  const reserve = Math.min(world.maxPellets * 0.8, world._reservedDeathPellets ?? 0);
  const maxAllowed = Math.floor(world.maxPellets * 2.0 + reserve);
  if (world.pellets.length > maxAllowed) {
    trimPellets(world, maxAllowed);
  }
  world._reservedDeathPellets = Math.max(0, (world._reservedDeathPellets ?? 0) - dt * 80);

  for (const s of world.snakes) {
    if (!s.alive) {
      s.respawnTimer -= dt;
      if (s.respawnTimer <= 0) {
        s.alive = true;
        s.boostHeat = 0;
        s.boostCooldown = 0;
        s.energy = 1.0;
        s.spawnInvuln = SPAWN_INVULN_SECONDS;
        s.desiredLen = randInt(36, 46);
        s.growAcc = 0;
        s.renderLen = s.desiredLen;
        s.mass = s.desiredLen;
        // Safer respawn to avoid instant collisions.
        const playerHead = world.snakes[0]?.points[0] ?? null;
        const cameraSafeRadius = Math.min(1200, world.radius * 0.35);
        const pos = s.isPlayer
          ? spawnPos(world, true)
          : spawnPosFarFrom(world, true, playerHead, cameraSafeRadius);
        initBodyAt(s, pos);
        snapshotSnake(s);
      }
      continue;
    }

    sanitizeSnakeInvariants(world, s);
    snapshotSnake(s);
    if ((s.spawnInvuln ?? 0) > 0) s.spawnInvuln = Math.max(0, s.spawnInvuln - dt);

    // Check pellets early so growth happens this frame (instant visual feedback)
    checkPelletEat(world, s);

    // Smooth visible length to avoid popping on growth.
    s.renderLen = s.renderLen || s.desiredLen;
    const lenLerp = 1 - Math.exp(-6 * dt);
    s.renderLen += (s.desiredLen - s.renderLen) * lenLerp;

    // --- Dynamic Size & Speed ---
    // Calculate scale based on mass (thickness can grow faster than tiles).
    const mass = Math.max(s.renderLen, s.mass || s.renderLen);
    const scale = 1 + Math.sqrt(Math.max(0, mass - MIN_LEN)) * 0.035;

    // 1. Thicker: Radius grows with scale
    s.radius = 12.5 * scale;

    // 2. Slower: Speed decreases with scale
    const baseSpeed = s.isPlayer ? PLAYER_BASE_SPEED : BOT_BASE_SPEED;
    const speedScale = 1 / Math.pow(scale, 0.25);
    s.speed = baseSpeed * speedScale;

    // 3. Tile Spacing: Overlap based on radius
    const spacing = s.radius * 0.55;

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

    // Smooth turning
    if (desiredDir != null) {
      // Turn rate: Slower when big
      const baseTurn = s.isPlayer ? PLAYER_TURN : BOT_TURN;
      s.turnRate = baseTurn / Math.pow(scale, 0.3);
      s.dir = rotateToward(s.dir, desiredDir, s.turnRate * dt);
    }

    // Boost rules with energy system
    const canBoost = s.desiredLen > MIN_LEN + 2 && s.boostCooldown <= 0 && s.energy >= MIN_ENERGY_TO_BOOST;
    s.boosting = wantBoost && canBoost;

    if (s.boosting) {
      const drain = BOOST_LEN_DRAIN_PER_SEC * dt;
      s.desiredLen -= drain;
      if (s.desiredLen < MIN_LEN) s.desiredLen = MIN_LEN;
      s.mass = Math.max(MIN_LEN, (s.mass || s.desiredLen) - drain);
      s.energy = 1.0;
      s.boostHeat = 0;

      // Slither-style mass shedding: drop small pellets behind while boosting.
      s.boostDropAcc = (s.boostDropAcc ?? 0) + drain;
      const tail = s.points[s.points.length - 1] ?? s.points[0];
      while (s.boostDropAcc >= 1.0 && s.desiredLen > MIN_LEN + 1) {
        s.boostDropAcc -= 1.0;
        if (tail) {
          world.pellets.push({
            id: `b-${_pelletId++}`,
            pos: { x: tail.x + rand(-8, 8), y: tail.y + rand(-8, 8) },
            r: 5.6,
            value: 0.9,
            kind: 'small',
            color: s.color, // Trail matches snake color
          });
          world._pelletGridDirty = true;
        }
      }
    } else {
      s.energy = 1.0;
      s.boostHeat = 0;
    }

    s.boostCooldown = 0;

    // Smooth growth (prevents visual popping of segments)
    if (s.growAcc > 0) {
      const growRate = 10; // segments per second
      const add = Math.min(s.growAcc, growRate * dt);
      s.growAcc -= add;
      s.desiredLen += add;
      if (s.desiredLen > MAX_POINTS_LEN) s.desiredLen = MAX_POINTS_LEN;
    }

    // Target speed
    const sizeMul = clamp(1.7 - (scale - 1) * 0.4, 1.1, 1.7);
    const targetSpeed = s.speed * (s.boosting ? (BOOST_MULT * sizeMul) : 1);
    s.targetSpeed = targetSpeed;

    // Smooth acceleration/deceleration
    const currentSpeed = Math.sqrt(s.velX * s.velX + s.velY * s.velY);
    const smooth = s.boosting ? BOOST_SPEED_SMOOTH : BOOST_BRAKE_SMOOTH;
    const desiredSpeed = currentSpeed + (targetSpeed - currentSpeed) * smooth;
    const speedDiff = desiredSpeed - currentSpeed;
    
    if (Math.abs(speedDiff) > 0.1) {
      const accel = speedDiff > 0 ? ACCEL_RATE : DECEL_RATE;
      const speedChange = Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), accel * dt);
      const newSpeed = currentSpeed + speedChange;
      
      if (currentSpeed > 0.1) {
        s.velX = (s.velX / currentSpeed) * newSpeed;
        s.velY = (s.velY / currentSpeed) * newSpeed;
      } else {
        s.velX = Math.cos(s.dir) * newSpeed;
        s.velY = Math.sin(s.dir) * newSpeed;
      }
    }

    // Apply velocity damping when turning sharply (more realistic)
    const velDir = Math.atan2(s.velY, s.velX);
    const turnAngle = Math.abs(wrapAngle(s.dir - velDir));
    if (turnAngle > 0.3) {
      const damping = 1 - (turnAngle / Math.PI) * TURN_DAMPING;
      s.velX *= damping;
      s.velY *= damping;
    }

    // Rotate velocity toward desired direction
    const targetVelX = Math.cos(s.dir) * s.targetSpeed;
    const targetVelY = Math.sin(s.dir) * s.targetSpeed;
    
    const velLerp = 0.15; // Smooth velocity rotation
    s.velX += (targetVelX - s.velX) * velLerp;
    s.velY += (targetVelY - s.velY) * velLerp;

    // Move head with velocity
    const head = s.points[0];
    head.x += s.velX * dt;
    head.y += s.velY * dt;

    // Circular world bounds check
    const distFromCenter = Math.sqrt(head.x * head.x + head.y * head.y);
    if (distFromCenter > world.radius) {
      // Hit the wall -> die
      killSnake(world, s, null);
    }

    // Score is mass (Slither-like)
    s.score = s.mass || s.desiredLen;

    ensureLength(s, spacing);
    follow(s.points, spacing);
  }

  rebuildCollisionGrid(world);
  checkSnakeCollisions(world);

  world._leaderboardAcc = (world._leaderboardAcc ?? 0) + dt;
  if (world._leaderboardAcc >= LEADERBOARD_EVERY) {
    world._leaderboardAcc = 0;

    const N = 6;
    world.leaderboard = world.snakes
      .filter((s) => s.alive)
      .map((s) => ({ id: s.id, name: s.name, score: s.score, color: s.color }))
      .sort((a, b) => b.score - a.score)
      .slice(0, N);
  }
}
