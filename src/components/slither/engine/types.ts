export type Vec = { x: number; y: number };

export type Pellet = {
  id: string;
  pos: Vec;
  r: number;
  value: number; // how much length it adds
  color: string;
  /** For nicer visuals / rules (e.g., death pellets). */
  kind?: 'small' | 'medium' | 'large' | 'gold' | 'death';
};

export type SnakeAI = {
  targetPelletId: string | null;
  wanderAngle: number;
  wanderTimer: number;
  reactionTimer: number;
  currentAim: number;

  // aggression / hunting
  targetSnakeId: string | null;

  // evasive memory
  evadeAngle?: number;
  steerMemory: number;
};

export type Snake = {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;

  dir: number;      // radians (current heading)
  speed: number;    // base px/sec
  turnRate: number; // rad/sec
  radius: number;   // body thickness

  // Smooth movement with inertia
  velX: number;     // velocity x component (px/sec)
  velY: number;     // velocity y component (px/sec)
  targetSpeed: number; // desired speed (for smooth acceleration)

  points: Vec[];      // points[0] = head
  desiredLen: number; // how many points we want (grows with pellets)
  /** Pending growth to apply smoothly (prevents visual popping). */
  growAcc: number;
  /** Smoothed length for rendering/physics to avoid popping. */
  renderLen: number;
  /** Mass used for thickness (can grow faster than tiles). */
  mass: number;

  alive: boolean;
  respawnTimer: number;
  /** Short spawn protection to prevent instant kill/respawn flicker. */
  spawnInvuln: number;

  // boost / stamina style (boost costs length slowly, like Slither)
  boosting: boolean;
  boostHeat: number;     // 0..1 (higher means recently boosted)
  boostCooldown: number; // seconds remaining until full boost allowed (soft)
  energy: number;        // 0..1, energy for boosting (recharges when not boosting)
  /** Accumulator for turning boost drain into dropped pellets. */
  boostDropAcc: number;

  // bot brain
  ai: SnakeAI;

  // stats
  score: number;
  kills: number;
  deaths: number;

  // --------------------
  // Render interpolation cache (filled by physics step; used by renderer)
  // --------------------
  /** Previous-step points as interleaved x,y in a typed array. Capacity grows as the snake grows (no per-frame alloc). */
  _prev?: Float32Array;
  /** Previous-step point count captured into _prev. */
  _prevLen?: number;
  /** Previous-step direction (for head visual interpolation). */
  _prevDir?: number;
};

export type SpatialGridBucket = {
  /** Segment endpoints (references to existing Vec objects from snake bodies). */
  a: Vec[];
  b: Vec[];
  /** Parallel array: segment belongs to snakeIdx[i] in world.snakes. */
  snakeIdx: number[];
  /** Segment radius (usually owner snake radius). */
  r: number[];
};

export type SpatialGrid = {
  cellSize: number;
  cols: number;
  rows: number;

  /** Map key = cx + cy*cols. */
  buckets: Map<number, SpatialGridBucket>;

  /** Which keys were used this frame (so we can clear buckets without re-alloc). */
  usedKeys: number[];
};

export type PelletGridBucket = {
  /** Indices into world.pellets */
  idx: number[];
};

export type PelletGrid = {
  cellSize: number;
  cols: number;
  rows: number;
  buckets: Map<number, PelletGridBucket>;
  usedKeys: number[];
};

export type World = {
  radius: number;
  tick: number;

  pellets: Pellet[];
  snakes: Snake[];

  maxPellets: number;

  // Optional spatial grid cache for collisions
  _grid?: SpatialGrid;

  /** Optional pellet spatial grid for nearby queries. */
  _pelletGrid?: PelletGrid;
  /** Internal: mark pellet grid dirty when pellets change. */
  _pelletGridDirty?: boolean;

  /** Optional: cached list of top snakes for HUD (updated periodically). */
  leaderboard?: { id: string; name: string; score: number; color: string }[];

  /** Difficulty 0.5..2, affects bot aggression & accuracy. */
  difficulty?: number;

  /** Internal: last dt (used by AI) */
  _dtLast?: number;
  /** Internal accumulator for leaderboard refresh */
  _leaderboardAcc?: number;
  /** Internal accumulator for pellet spawning */
  _pelletSpawnAcc?: number;
  /** Internal: reserve space for death pellets to avoid trimming them instantly. */
  _reservedDeathPellets?: number;

  /** Visual event flags (renderer can read and clear if desired). */
  events?: {
    playerDiedAt?: number; // world.tick timestamp
    lastKillAt?: number;
  };
};

export type StepInput = {
  aimWorld: Vec | null; // player aim in world coords
  boost: boolean;       // optional
};

export type WorldConfig = {
  botCount: number;
  difficulty?: number; // 1 = default
  playerColor?: string;
};
