export type Vec = { x: number; y: number };

export type Pellet = {
  id: string;
  pos: Vec;
  r: number;
  value: number; // how much length it adds
  color: string;
  /** For nicer visuals / rules (e.g., death pellets). */
  kind?: 'normal' | 'death';
};

export type SnakeAI = {
  targetPelletId: string | null;
  wanderAngle: number;
  wanderTimer: number;

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

  dir: number;      // radians
  speed: number;    // base px/sec
  turnRate: number; // rad/sec
  radius: number;   // body thickness

  points: Vec[];      // points[0] = head
  desiredLen: number; // how many points we want (grows with pellets)

  alive: boolean;
  respawnTimer: number;

  // boost / stamina style (boost costs length slowly, like Slither)
  boosting: boolean;
  boostHeat: number;     // 0..1 (higher means recently boosted)
  boostCooldown: number; // seconds remaining until full boost allowed (soft)

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

export type World = {
  W: number;
  H: number;
  tick: number;

  pellets: Pellet[];
  snakes: Snake[];

  maxPellets: number;

  // Optional spatial grid cache for collisions
  _grid?: SpatialGrid;

  /** Optional: cached list of top snakes for HUD (updated periodically). */
  leaderboard?: { id: string; name: string; score: number; color: string }[];

  /** Difficulty 0.5..2, affects bot aggression & accuracy. */
  difficulty?: number;

  /** Internal: last dt (used by AI) */
  _dtLast?: number;
  /** Internal accumulator for leaderboard refresh */
  _leaderboardAcc?: number;

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
};
