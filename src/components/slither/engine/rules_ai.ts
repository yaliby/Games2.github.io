import type { Pellet, Snake, StepInput, Vec, World, WorldConfig, SpatialGrid, PelletGrid } from './types';

const TAU = Math.PI * 2;

// -------------------- Tuning --------------------

// Movement / body
const BASE_SPACING = 10;         // distance between points (like vertebrae)
const FOLLOW_ITERS = 10;         // constraint iterations (bigger = stiffer body, more accurate)
const PLAYER_BASE_SPEED = 240;
const BOT_BASE_SPEED = 210;
const BOOST_MULT = 1.38;

// Smooth acceleration/deceleration
const ACCEL_RATE = 850;          // px/sec² acceleration
const DECEL_RATE = 950;          // px/sec² deceleration
const TURN_DAMPING = 0.96;       // velocity damping when turning sharply

// Boost costs length + energy, but never below MIN_LEN.
const BOOST_LEN_DRAIN_PER_SEC = 4.2;
const BOOST_ENERGY_DRAIN_PER_SEC = 0.35;  // energy drain rate
const BOOST_ENERGY_RECHARGE_PER_SEC = 0.25; // energy recharge rate
const MIN_LEN = 26;
const MIN_ENERGY_TO_BOOST = 0.15; // minimum energy needed to start boost

// Steering
const PLAYER_TURN = 3.5; // rad/sec
const BOT_TURN = 3.5;
const BASE_TURN_RATE = 7.5; // rad/sec

// World
const WORLD_SIZE = 3800;

// Pellets
const PELLET_TYPES = {
  small:  { val: 1,  r: 6.2, prob: 0.80 },
  medium: { val: 5,  r: 9.0, prob: 0.15 },
  large:  { val: 12, r: 13.0, prob: 0.04 },
  gold:   { val: 40, r: 18.0, prob: 0.01 },
  death:  { val: 1.65, r: 7.0 } // Special case
};
const PELLET_SPAWN_RATE = 0.8;  // pellets per second to maintain
const PELLET_MIN_DISTANCE = 80;  // minimum distance from snakes when spawning
const PELLET_GRID_CELL = 120;
const PELLET_EAT_PAD = 4;        // extra "magnet" radius for eating like Slither.io

// Combat
const KILL_SPILL_MIN = 22;
const KILL_SPILL_MAX = 110;
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

  const head = s.points[0];
  if (!head || !Number.isFinite(head.x) || !Number.isFinite(head.y)) {
    const cx = 0;
    const cy = 0;
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
  const palette = [
    '#00FF9F', '#00B8FF', '#001EFF', '#BD00FF', '#FF0055',
    '#FF9100', '#F7FF00', '#FFFFFF'
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

function ensureLength(s: Snake) {
  const desired = safeLen(s.desiredLen);
  const spacing = s.radius * 0.4;

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
      if (d2 >= spacing * spacing) {
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
  const dt = world._dtLast ?? 0.008;
  
  // Spawn pellets gradually to maintain count
  if (current < target) {
    const toSpawn = Math.min(Math.ceil(PELLET_SPAWN_RATE * dt), target - current);
    for (let i = 0; i < toSpawn; i++) {
      world.pellets.push(makePellet(world, 'random', true));
    }
    if (toSpawn > 0) world._pelletGridDirty = true;
  }
}

function checkPelletEat(world: World, s: Snake) {
  const head = s.points[0];
  const r = headRadius(s) + PELLET_EAT_PAD;
  const r2 = r * r;

  // Query only nearby pellets (avoids O(N) scans).
  const toEat: number[] = [];
  forNearbyPellets(world, head.x, head.y, r + 18, (pi) => {
    const p = world.pellets[pi];
    if (!p) return;
    const dx = p.pos.x - head.x;
    const dy = p.pos.y - head.y;
    if (dx * dx + dy * dy <= r2) toEat.push(pi);
  });

  if (toEat.length === 0) return;

  // Eat highest indices first to keep swap-remove safe.
  toEat.sort((a, b) => b - a);
  for (let k = 0; k < toEat.length; k++) {
    const i = toEat[k];
    const p = world.pellets[i];
    if (!p) continue;

    // Eat (gradual growth: pellets are small, but many over time)
    s.desiredLen += p.value;
    s.score += p.value;

    const last = world.pellets[world.pellets.length - 1];
    world.pellets[i] = last;
    world.pellets.pop();
  }
  world._pelletGridDirty = true;
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
  const scanR = 900;
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

    // Add some randomness for human-like imperfection
    const randomness = 0.85 + rand(0, 0.3);
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
    if (d2 > 1100 * 1100) continue;

    const d = Math.sqrt(d2) || 1;

    let score = (1 / (d + 1)) * 2000;
    score *= 1.2 - Math.min(0.9, s.desiredLen / 500);
    if (s.isPlayer) score *= 1.35;

    score *= 0.8 + 0.4 * difficulty;

    // Human-like: sometimes ignore good targets (hesitation)
    if (rand() < 0.15) score *= 0.3;

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

  for (const s of world.snakes) {
    if (!s.alive || s.id === bot.id) continue;

    const pts = s.points;
    const step = pts.length > 140 ? 3 : 2;

    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const dx = head.x - p.x;
      const dy = head.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 320 * 320) continue;

      const d = Math.sqrt(d2) || 1;
      const w = (1 / d) * (1 + (s.desiredLen / 90) * 0.18);

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

  // Reaction delay simulation
  bot.ai.reactionTimer -= world._dtLast ?? 0;
  if (bot.ai.reactionTimer > 0) {
    return { aim: bot.ai.currentAim, boost: bot.boosting };
  }
  bot.ai.reactionTimer = rand(0.05, 0.15); // Faster reaction

  // Wander timer (human-like exploration)
  bot.ai.wanderTimer -= world._dtLast ?? 0;
  if (bot.ai.wanderTimer <= 0) {
    bot.ai.wanderTimer = rand(1.0, 3.0);
    bot.ai.wanderAngle = rand(-Math.PI, Math.PI);
  }

  const targetPellet: Pellet | null = botPickTarget(world, bot);
  const threat = botComputeThreat(world, bot);

  // Occasionally attempt intercept (with human-like hesitation)
  let victim: Snake | null = null;
  if (rand() < 0.23 * difficulty) {
    victim = botPickVictim(world, bot);
    // Sometimes change mind (human-like)
    if (victim && rand() < 0.12) victim = null;
  }

  // Combine steering vectors
  let dx = 0;
  let dy = 0;

  // Pellet attraction
  if (targetPellet) {
    const a = angleTo(head, targetPellet.pos);
    const pelletThreat = threatAt(world, targetPellet.pos, 260);
    const pelletWeight = pelletThreat > 0.7 ? 0.3 : 1.0;

    dx += Math.cos(a) * (1.0 * pelletWeight);
    dy += Math.sin(a) * (1.0 * pelletWeight);
  }

  if (victim && victim.alive) {
    // Aim ahead with improved lead
    const vHead = victim.points[0];
    const d2 = dist2(head, vHead);
    const d = Math.sqrt(d2) || 1;
    const baseLead = clamp(0.25 + (difficulty - 1) * 0.18, 0.2, 0.55);
    const speedFactor = Math.min(1.5, (bot.speed + 40) / (victim.speed + 20));
    const lead = clamp(baseLead * speedFactor * (1 + Math.max(0, 600 - d) / 900), 0.2, 0.9);

    const ax2 = vHead.x + Math.cos(victim.dir) * victim.speed * lead;
    const ay2 = vHead.y + Math.sin(victim.dir) * victim.speed * lead;
    const a = Math.atan2(ay2 - head.y, ax2 - head.x);

    dx += Math.cos(a) * 1.25;
    dy += Math.sin(a) * 1.25;
  }

  // Avoid threats
  dx += threat.ax * 1.7;
  dy += threat.ay * 1.7;

  // Evasive memory (human-like panic response)
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
  const distFromCenter = Math.sqrt(head.x * head.x + head.y * head.y);
  const distToWall = world.radius - distFromCenter;
  if (distToWall < 400) {
    const angleToCenter = Math.atan2(-head.y, -head.x);
    const urgency = 1 - (distToWall / 400);
    dx += Math.cos(angleToCenter) * 4 * urgency;
    dy += Math.sin(angleToCenter) * 4 * urgency;
  }

  const aim = Math.atan2(dy, dx);

  // Boost logic (human-like: sometimes boost when shouldn't, sometimes don't when should)
  const safe = threat.threat < 0.035 * (2 - clamp(difficulty, 0.6, 1.8));
  const chasing = !!victim && dist2(head, victim.points[0]) < (420 * 420);
  const escaping = threat.threat > 0.06;

  let boost = false;
  if (escaping) {
    boost = rand() < 0.85; // Sometimes panic and forget to boost
  } else if (chasing && safe) {
    boost = rand() < (0.75 + 0.1 * difficulty); // More likely to boost on higher difficulty
  } else if (safe) {
    boost = rand() < (0.03 * difficulty); // Occasional random boost
  }

  bot.ai.currentAim = aim;
  return { aim, boost };
}

// -------------------- Death / scoring --------------------

function spillDeathPellets(world: World, s: Snake) {
  // Convert body segments into pellets (like Slither.io)
  const pts = s.points;
  const count = clamp(Math.floor(pts.length * 0.95), KILL_SPILL_MIN, Math.max(KILL_SPILL_MAX, Math.floor(pts.length * 0.35)));

  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i / count) * pts.length);
    const p = pts[idx];
    if (!p) continue;

    // Add slight randomness for natural spread
    world.pellets.push({
      id: `d-${_pelletId++}`,
      pos: { x: p.x + rand(-12, 12), y: p.y + rand(-12, 12) },
      r: PELLET_TYPES.death.r,
      value: PELLET_TYPES.death.val,
      kind: 'death',
      color: s.color, // Drop body color
    });
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
  const grid = ensureGrid(world);

  // First check head-to-head collisions
  for (let i = 0; i < world.snakes.length; i++) {
    const s1 = world.snakes[i];
    if (!s1.alive || s1.points.length === 0) continue;
    if ((s1.spawnInvuln ?? 0) > 0) continue;

    const h1 = s1.points[0];
    const r1 = headRadius(s1);

    for (let j = i + 1; j < world.snakes.length; j++) {
      const s2 = world.snakes[j];
      if (!s2.alive || s2.points.length === 0) continue;
      if ((s2.spawnInvuln ?? 0) > 0) continue;

      const h2 = s2.points[0];
      const r2 = headRadius(s2);
      const d2 = dist2(h1, h2);
      const rSum = r1 + r2;

      if (d2 <= rSum * rSum) {
        // Head-to-head collision: make it less "random mass extinction".
        // Only kill if there's a meaningful size advantage; otherwise treat as a bump (no death).
        const a = s1.desiredLen;
        const b = s2.desiredLen;
        const bigger = Math.max(a, b);
        const smaller = Math.min(a, b);
        const ratio = smaller > 0 ? bigger / smaller : 9;
        if (ratio >= 1.12) {
          if (a > b) killSnake(world, s2, s1);
          else killSnake(world, s1, s2);
        }
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

    velX: 0,
    velY: 0,
    targetSpeed: baseSpeed,

    points: [],
    desiredLen: randInt(36, 46),

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

export function createWorld(cfg: WorldConfig): World {
  const world: World = {
    radius: WORLD_SIZE,
    tick: 0,
    pellets: [],
    snakes: [],
    maxPellets: 520,
    difficulty: clamp(cfg.difficulty ?? 1, 0.55, 2.0),
  };

  const player = makeSnake(0, true);
  initBodyAt(player, spawnPos(world, false));
  world.snakes.push(player);

  const bots = clamp(cfg.botCount | 0, 0, 28);
  for (let i = 0; i < bots; i++) {
    const b = makeSnake(i + 1, false);
    b.speed *= 0.9 + 0.16 * (world.difficulty ?? 1);
    b.targetSpeed = b.speed;
    initBodyAt(b, spawnPos(world, false));
    world.snakes.push(b);
  }

  fillPellets(world);

  for (const s of world.snakes) snapshotSnake(s);

  return world;
}

export function stepWorld(world: World, input: StepInput, dt: number) {
  world.tick += dt;
  world._dtLast = dt;

  fillPellets(world);
  if (world.pellets.length > world.maxPellets * 1.6) {
    world.pellets.length = Math.floor(world.maxPellets * 1.6);
    world._pelletGridDirty = true;
  }

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
        // Safer respawn to avoid instant collisions.
        const pos = spawnPos(world, true);
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

    // --- Dynamic Size & Speed ---
    // Calculate scale based on mass (desiredLen). Grows with food.
    const mass = s.desiredLen;
    const scale = 1 + Math.sqrt(Math.max(0, mass - MIN_LEN)) * 0.05;

    // 1. Thicker: Radius grows with scale
    s.radius = 13 * scale;

    // 2. Slower: Speed decreases with scale
    const baseSpeed = s.isPlayer ? PLAYER_BASE_SPEED : BOT_BASE_SPEED;
    const speedScale = 1 / Math.pow(scale, 0.5);
    s.speed = baseSpeed * speedScale;

    // 3. Tile Spacing: Overlap based on radius
    const spacing = s.radius * 0.4;

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
      s.energy = clamp(s.energy - BOOST_ENERGY_DRAIN_PER_SEC * dt, 0, 1);
      s.boostHeat = clamp(s.boostHeat + dt * 0.9, 0, 1);

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
      s.energy = clamp(s.energy + BOOST_ENERGY_RECHARGE_PER_SEC * dt, 0, 1);
      s.boostHeat = clamp(s.boostHeat - dt * 0.8, 0, 1);
    }

    if (s.boostHeat >= 1 && wantBoost) {
      s.boostCooldown = clamp(s.boostCooldown + dt * 0.7, 0, 0.6);
    } else {
      s.boostCooldown = Math.max(0, s.boostCooldown - dt * 0.9);
    }

    // Target speed
    const targetSpeed = s.speed * (s.boosting ? BOOST_MULT : 1);
    s.targetSpeed = targetSpeed;

    // Smooth acceleration/deceleration
    const currentSpeed = Math.sqrt(s.velX * s.velX + s.velY * s.velY);
    const speedDiff = targetSpeed - currentSpeed;
    
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

    ensureLength(s);
    follow(s.points, spacing);
  }

  rebuildCollisionGrid(world);
  checkSnakeCollisions(world);

  world._leaderboardAcc = (world._leaderboardAcc ?? 0) + dt;
  if (world._leaderboardAcc >= LEADERBOARD_EVERY) {
    world._leaderboardAcc = 0;

    const N = 6;
    const top: { id: string; name: string; score: number; color: string }[] = [];
    for (let i = 0; i < world.snakes.length; i++) {
      const s = world.snakes[i];
      if (!s.alive) continue;
      const item = { id: s.id, name: s.name, score: s.score, color: s.color };

      let j = top.length;
      if (j < N) {
        top.push(item);
      } else if (item.score <= top[j - 1].score) {
        continue;
      } else {
        top[j - 1] = item;
      }

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
