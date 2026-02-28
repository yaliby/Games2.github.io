export type Vec3Like = {
  x: number;
  y: number;
  z: number;
};

export type QuaternionLike = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type DiceTransform = {
  position: Vec3Like;
  quaternion: QuaternionLike;
};

export type DiceFrame = {
  dice: [DiceTransform, DiceTransform];
};

export type DiceRollResult = {
  values: [number, number];
  final: [DiceTransform, DiceTransform];
  mode: "physics" | "fallback";
};

export type SingleDiceFrame = {
  die: DiceTransform;
};

export type SingleDieRollResult = {
  value: number;
  final: DiceTransform;
  mode: "physics" | "fallback";
};

export type DiceEngineStatus = {
  available: boolean;
  mode: "physics" | "fallback";
  detail: string;
};

export type DicePhysicsEngine = {
  throwDice: (onFrame: (frame: DiceFrame) => void) => Promise<DiceRollResult>;
  throwSingleDie: (onFrame: (frame: SingleDiceFrame) => void) => Promise<SingleDieRollResult>;
  getStatus: () => DiceEngineStatus;
};

type CannonVec3 = {
  x: number;
  y: number;
  z: number;
  set: (x: number, y: number, z: number) => void;
  lengthSquared: () => number;
  dot: (other: CannonVec3) => number;
};

type CannonQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
  setFromEuler: (x: number, y: number, z: number) => void;
  vmult: (vec: CannonVec3) => CannonVec3;
};

type CannonBody = {
  position: CannonVec3;
  quaternion: CannonQuaternion;
  velocity: CannonVec3;
  angularVelocity: CannonVec3;
  applyImpulse: (force: CannonVec3, worldPoint: CannonVec3) => void;
};

type CannonWorld = {
  gravity: CannonVec3;
  allowSleep: boolean;
  addBody: (body: CannonBody) => void;
  addContactMaterial: (material: unknown) => void;
  step: (dt: number) => void;
};

type CannonModule = {
  World: new () => CannonWorld;
  Vec3: new (x?: number, y?: number, z?: number) => CannonVec3;
  Body: new (opts: Record<string, unknown>) => CannonBody;
  Box: new (halfExtents: CannonVec3) => unknown;
  Plane: new () => unknown;
  Material: new (name?: string) => unknown;
  ContactMaterial: new (
    a: unknown,
    b: unknown,
    opts?: Record<string, unknown>
  ) => unknown;
};

const CANNON_CDN = "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
const DIE_HALF_SIZE = 0.32;
const FLOOR_Y = 0;
const ARENA_HALF_X = 3.2;
const ARENA_HALF_Z = 3.2;
const SIMULATION_DT = 1 / 120;
const SIMULATION_SUBSTEPS = 2;
const THROW_MAX_FRAMES = 60 * 8;
const SINGLE_THROW_MAX_FRAMES = 60 * 5;
const SETTLE_SPEED_SQ = 0.035;
const SETTLE_SPIN_SQ = 0.04;
const SETTLE_FRAMES_REQUIRED = 20;
const FACE_LOCK_FRAMES_REQUIRED = 10;
const FACE_LOCK_MIN_FRAME = 20;
const FACE_LOCK_NEAR_BOARD_Y = FLOOR_Y + DIE_HALF_SIZE + 0.14;
const VIEWPORT_SHORT_SIDE_BASE = 820;
const VIEWPORT_SHORT_SIDE_MIN = 320;
const VIEWPORT_SHORT_SIDE_MAX = 1440;

const FACE_NORMALS: Array<{ value: number; normal: [number, number, number] }> = [
  { value: 1, normal: [0, 1, 0] },
  { value: 6, normal: [0, -1, 0] },
  { value: 2, normal: [0, 0, 1] },
  { value: 5, normal: [0, 0, -1] },
  { value: 3, normal: [1, 0, 0] },
  { value: 4, normal: [-1, 0, 0] },
];

export type DiceAnimationTiming = {
  twoDiceFallbackDurationMs: number;
  singleDieFallbackDurationMs: number;
  postSettleDelayMs: number;
  openingResultDelayMs: number;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getViewportShortSide(): number {
  if (typeof window === "undefined") {
    return VIEWPORT_SHORT_SIDE_BASE;
  }

  const doc = typeof document !== "undefined" ? document.documentElement : null;
  const width = Math.max(window.innerWidth || 0, doc?.clientWidth || 0);
  const height = Math.max(window.innerHeight || 0, doc?.clientHeight || 0);

  if (width <= 0 || height <= 0) {
    return VIEWPORT_SHORT_SIDE_BASE;
  }

  return clampNumber(Math.min(width, height), VIEWPORT_SHORT_SIDE_MIN, VIEWPORT_SHORT_SIDE_MAX);
}

export function getDiceAnimationTiming(): DiceAnimationTiming {
  const shortSide = getViewportShortSide();
  const scale = clampNumber(shortSide / VIEWPORT_SHORT_SIDE_BASE, 0.78, 1.22);

  return {
    twoDiceFallbackDurationMs: Math.round(clampNumber(1100 * scale, 850, 1450)),
    singleDieFallbackDurationMs: Math.round(clampNumber(860 * scale, 650, 1150)),
    postSettleDelayMs: Math.round(clampNumber(400 * scale, 260, 540)),
    openingResultDelayMs: Math.round(clampNumber(920 * scale, 700, 1180)),
  };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function toTransform(body: CannonBody): DiceTransform {
  return {
    position: {
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
    },
    quaternion: {
      x: body.quaternion.x,
      y: body.quaternion.y,
      z: body.quaternion.z,
      w: body.quaternion.w,
    },
  };
}

function copyTransform(transform: DiceTransform): DiceTransform {
  return {
    position: { ...transform.position },
    quaternion: { ...transform.quaternion },
  };
}

function waitNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function stepWorld(world: CannonWorld) {
  for (let i = 0; i < SIMULATION_SUBSTEPS; i += 1) {
    world.step(SIMULATION_DT);
  }
}

function isNearBoard(body: CannonBody): boolean {
  return body.position.y <= FACE_LOCK_NEAR_BOARD_Y;
}

function getDieValue(cannon: CannonModule, body: CannonBody): number {
  const up = new cannon.Vec3(0, 1, 0);

  let bestValue = 1;
  let bestDot = Number.NEGATIVE_INFINITY;

  for (const face of FACE_NORMALS) {
    const localNormal = new cannon.Vec3(face.normal[0], face.normal[1], face.normal[2]);
    const worldNormal = body.quaternion.vmult(localNormal);
    const dot = worldNormal.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = face.value;
    }
  }

  return bestValue;
}

function createWalls(cannon: CannonModule, world: CannonWorld, material: unknown) {
  const addWall = (
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    halfZ: number
  ) => {
    const shape = new cannon.Box(new cannon.Vec3(halfX, halfY, halfZ));
    const body = new cannon.Body({
      mass: 0,
      material,
      shape,
    });
    body.position.set(x, y, z);
    world.addBody(body);
  };

  const wallHeight = 2.1;
  const wallThickness = 0.45;

  addWall(0, wallHeight, -ARENA_HALF_Z - wallThickness, ARENA_HALF_X + wallThickness, wallHeight, wallThickness);
  addWall(0, wallHeight, ARENA_HALF_Z + wallThickness, ARENA_HALF_X + wallThickness, wallHeight, wallThickness);
  addWall(-ARENA_HALF_X - wallThickness, wallHeight, 0, wallThickness, wallHeight, ARENA_HALF_Z + wallThickness);
  addWall(ARENA_HALF_X + wallThickness, wallHeight, 0, wallThickness, wallHeight, ARENA_HALF_Z + wallThickness);
}

function confineDieBody(body: CannonBody) {
  const minX = -ARENA_HALF_X + DIE_HALF_SIZE;
  const maxX = ARENA_HALF_X - DIE_HALF_SIZE;
  const minZ = -ARENA_HALF_Z + DIE_HALF_SIZE;
  const maxZ = ARENA_HALF_Z - DIE_HALF_SIZE;
  const minY = FLOOR_Y + DIE_HALF_SIZE;

  if (body.position.x < minX) {
    body.position.x = minX;
    body.velocity.x = Math.abs(body.velocity.x) * 0.54;
  } else if (body.position.x > maxX) {
    body.position.x = maxX;
    body.velocity.x = -Math.abs(body.velocity.x) * 0.54;
  }

  if (body.position.z < minZ) {
    body.position.z = minZ;
    body.velocity.z = Math.abs(body.velocity.z) * 0.54;
  } else if (body.position.z > maxZ) {
    body.position.z = maxZ;
    body.velocity.z = -Math.abs(body.velocity.z) * 0.54;
  }

  if (body.position.y < minY) {
    body.position.y = minY;
    body.velocity.y = Math.abs(body.velocity.y) * 0.28;
  }
}

async function throwWithFallback(onFrame: (frame: DiceFrame) => void): Promise<DiceRollResult> {
  const durationMs = getDiceAnimationTiming().twoDiceFallbackDurationMs;
  const start = performance.now();

  const values: [number, number] = [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ];

  const startTransforms: [DiceTransform, DiceTransform] = [
    {
      position: { x: -1.2, y: 1.2, z: 0.6 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    {
      position: { x: 1.2, y: 1.25, z: -0.6 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
  ];

  const targetTransforms: [DiceTransform, DiceTransform] = [
    {
      position: { x: -0.85, y: DIE_HALF_SIZE + FLOOR_Y, z: 0.4 },
      quaternion: { x: 0.22, y: 0.44, z: 0.1, w: 0.86 },
    },
    {
      position: { x: 1.05, y: DIE_HALF_SIZE + FLOOR_Y, z: -0.35 },
      quaternion: { x: -0.15, y: 0.38, z: 0.22, w: 0.88 },
    },
  ];

  while (true) {
    const now = performance.now();
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const arc = (1 - t) * t * 0.9;

    const frame: DiceFrame = {
      dice: [
        {
          position: {
            x: startTransforms[0].position.x + (targetTransforms[0].position.x - startTransforms[0].position.x) * t,
            y: startTransforms[0].position.y + (targetTransforms[0].position.y - startTransforms[0].position.y) * t + arc,
            z: startTransforms[0].position.z + (targetTransforms[0].position.z - startTransforms[0].position.z) * t,
          },
          quaternion: {
            x: targetTransforms[0].quaternion.x * t,
            y: targetTransforms[0].quaternion.y * t,
            z: targetTransforms[0].quaternion.z * t,
            w: 1 - (1 - targetTransforms[0].quaternion.w) * t,
          },
        },
        {
          position: {
            x: startTransforms[1].position.x + (targetTransforms[1].position.x - startTransforms[1].position.x) * t,
            y: startTransforms[1].position.y + (targetTransforms[1].position.y - startTransforms[1].position.y) * t + arc * 0.82,
            z: startTransforms[1].position.z + (targetTransforms[1].position.z - startTransforms[1].position.z) * t,
          },
          quaternion: {
            x: targetTransforms[1].quaternion.x * t,
            y: targetTransforms[1].quaternion.y * t,
            z: targetTransforms[1].quaternion.z * t,
            w: 1 - (1 - targetTransforms[1].quaternion.w) * t,
          },
        },
      ],
    };

    onFrame(frame);
    if (t >= 1) break;
    await waitNextFrame();
  }

  return {
    values,
    final: [copyTransform(targetTransforms[0]), copyTransform(targetTransforms[1])],
    mode: "fallback",
  };
}

async function throwSingleWithFallback(
  onFrame: (frame: SingleDiceFrame) => void
): Promise<SingleDieRollResult> {
  const durationMs = getDiceAnimationTiming().singleDieFallbackDurationMs;
  const start = performance.now();

  const value = Math.floor(Math.random() * 6) + 1;

  const startTransform: DiceTransform = {
    position: { x: 0, y: 1.3, z: 0.55 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };

  const targetTransform: DiceTransform = {
    position: { x: 0, y: DIE_HALF_SIZE + FLOOR_Y, z: 0 },
    quaternion: { x: 0.18, y: 0.33, z: 0.22, w: 0.9 },
  };

  while (true) {
    const now = performance.now();
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const arc = (1 - t) * t * 0.82;

    const frame: SingleDiceFrame = {
      die: {
        position: {
          x: startTransform.position.x + (targetTransform.position.x - startTransform.position.x) * t,
          y: startTransform.position.y + (targetTransform.position.y - startTransform.position.y) * t + arc,
          z: startTransform.position.z + (targetTransform.position.z - startTransform.position.z) * t,
        },
        quaternion: {
          x: targetTransform.quaternion.x * t,
          y: targetTransform.quaternion.y * t,
          z: targetTransform.quaternion.z * t,
          w: 1 - (1 - targetTransform.quaternion.w) * t,
        },
      },
    };

    onFrame(frame);
    if (t >= 1) break;
    await waitNextFrame();
  }

  return {
    value,
    final: copyTransform(targetTransform),
    mode: "fallback",
  };
}

async function loadCannonModule(): Promise<CannonModule | null> {
  try {
    const cannonUnknown = await import(/* @vite-ignore */ CANNON_CDN);
    return cannonUnknown as CannonModule;
  } catch {
    return null;
  }
}

export async function createPhysicsEngine(): Promise<DicePhysicsEngine> {
  const cannon = await loadCannonModule();

  if (!cannon) {
    return {
      throwDice: throwWithFallback,
      throwSingleDie: throwSingleWithFallback,
      getStatus: () => ({
        available: false,
        mode: "fallback",
        detail: "Cannon could not be loaded from CDN. Using fallback animation.",
      }),
    };
  }

  const createWorld = () => {
    const world = new cannon.World();
    world.gravity.set(0, -25, 0);
    world.allowSleep = true;

    const diceMaterial = new cannon.Material("dice");
    const boardMaterial = new cannon.Material("board");

    world.addContactMaterial(
      new cannon.ContactMaterial(diceMaterial, boardMaterial, {
        friction: 0.43,
        restitution: 0.44,
      })
    );

    world.addContactMaterial(
      new cannon.ContactMaterial(diceMaterial, diceMaterial, {
        friction: 0.24,
        restitution: 0.48,
      })
    );

    const floorBody = new cannon.Body({
      mass: 0,
      shape: new cannon.Plane(),
      material: boardMaterial,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floorBody.position.set(0, FLOOR_Y, 0);
    world.addBody(floorBody);

    createWalls(cannon, world, boardMaterial);

    const dieShape = new cannon.Box(new cannon.Vec3(DIE_HALF_SIZE, DIE_HALF_SIZE, DIE_HALF_SIZE));

    const createDieBody = (x: number, z: number): CannonBody => {
      const body = new cannon.Body({
        mass: 1,
        shape: dieShape,
        material: diceMaterial,
        linearDamping: 0.19,
        angularDamping: 0.16,
        allowSleep: true,
        sleepSpeedLimit: 0.08,
        sleepTimeLimit: 0.6,
      });

      body.position.set(x, randomBetween(1.3, 1.95), z);
      body.quaternion.setFromEuler(
        randomBetween(0, Math.PI * 2),
        randomBetween(0, Math.PI * 2),
        randomBetween(0, Math.PI * 2)
      );
      body.velocity.set(
        randomBetween(-0.95, 0.95),
        randomBetween(0.38, 1.05),
        randomBetween(-0.95, 0.95)
      );
      body.angularVelocity.set(
        randomBetween(-10.5, 10.5),
        randomBetween(-11.5, 11.5),
        randomBetween(-10.5, 10.5)
      );

      const impulse = new cannon.Vec3(
        randomBetween(-4.8, 4.8),
        randomBetween(7.2, 10.8),
        randomBetween(-4.8, 4.8)
      );
      body.applyImpulse(impulse, body.position);

      world.addBody(body);
      return body;
    };

    return {
      world,
      createDieBody,
    };
  };

  const throwDice = async (onFrame: (frame: DiceFrame) => void): Promise<DiceRollResult> => {
    const { world, createDieBody } = createWorld();

    const dieA = createDieBody(-1.1, 0.6);
    const dieB = createDieBody(1.1, -0.6);

    let settledFrames = 0;
    let stableTopA = getDieValue(cannon, dieA);
    let stableTopB = getDieValue(cannon, dieB);
    let stableTopFramesA = 0;
    let stableTopFramesB = 0;

    for (let frame = 0; frame < THROW_MAX_FRAMES; frame += 1) {
      stepWorld(world);
      confineDieBody(dieA);
      confineDieBody(dieB);

      const frameData: DiceFrame = {
        dice: [toTransform(dieA), toTransform(dieB)],
      };
      onFrame(frameData);

      const speedASq = dieA.velocity.lengthSquared();
      const speedBSq = dieB.velocity.lengthSquared();
      const spinASq = dieA.angularVelocity.lengthSquared();
      const spinBSq = dieB.angularVelocity.lengthSquared();

      const currentTopA = getDieValue(cannon, dieA);
      const currentTopB = getDieValue(cannon, dieB);
      if (currentTopA === stableTopA) stableTopFramesA += 1;
      else {
        stableTopA = currentTopA;
        stableTopFramesA = 0;
      }
      if (currentTopB === stableTopB) stableTopFramesB += 1;
      else {
        stableTopB = currentTopB;
        stableTopFramesB = 0;
      }

      const dieASettled = speedASq < SETTLE_SPEED_SQ && spinASq < SETTLE_SPIN_SQ;
      const dieBSettled = speedBSq < SETTLE_SPEED_SQ && spinBSq < SETTLE_SPIN_SQ;

      if (dieASettled && dieBSettled) {
        settledFrames += 1;
      } else {
        settledFrames = 0;
      }

      const faceLocked = frame >= FACE_LOCK_MIN_FRAME
        && isNearBoard(dieA)
        && isNearBoard(dieB)
        && stableTopFramesA >= FACE_LOCK_FRAMES_REQUIRED
        && stableTopFramesB >= FACE_LOCK_FRAMES_REQUIRED
        && speedASq < 0.16
        && speedBSq < 0.16
        && spinASq < 0.2
        && spinBSq < 0.2;

      if (settledFrames >= SETTLE_FRAMES_REQUIRED || faceLocked) {
        break;
      }

      await waitNextFrame();
    }

    const finalA = toTransform(dieA);
    const finalB = toTransform(dieB);

    const values: [number, number] = [
      getDieValue(cannon, dieA),
      getDieValue(cannon, dieB),
    ];

    return {
      values,
      final: [finalA, finalB],
      mode: "physics",
    };
  };

  const throwSingleDie = async (
    onFrame: (frame: SingleDiceFrame) => void
  ): Promise<SingleDieRollResult> => {
    const { world, createDieBody } = createWorld();

    const die = createDieBody(0, 0.12);
    let settledFrames = 0;
    let stableTopValue = getDieValue(cannon, die);
    let stableTopFrames = 0;

    for (let frame = 0; frame < SINGLE_THROW_MAX_FRAMES; frame += 1) {
      stepWorld(world);
      confineDieBody(die);

      onFrame({
        die: toTransform(die),
      });

      const speedSq = die.velocity.lengthSquared();
      const spinSq = die.angularVelocity.lengthSquared();

      const topValue = getDieValue(cannon, die);
      if (topValue === stableTopValue) {
        stableTopFrames += 1;
      } else {
        stableTopValue = topValue;
        stableTopFrames = 0;
      }

      const dieSettled = speedSq < 0.065 && spinSq < 0.11;
      if (dieSettled) {
        settledFrames += 1;
      } else {
        settledFrames = 0;
      }

      const faceLocked = frame >= FACE_LOCK_MIN_FRAME
        && isNearBoard(die)
        && stableTopFrames >= FACE_LOCK_FRAMES_REQUIRED
        && speedSq < 0.16
        && spinSq < 0.22;

      if (settledFrames >= 9 || faceLocked) {
        break;
      }

      await waitNextFrame();
    }

    const final = toTransform(die);
    const value = getDieValue(cannon, die);

    return {
      value,
      final,
      mode: "physics",
    };
  };

  return {
    throwDice,
    throwSingleDie,
    getStatus: () => ({
      available: true,
      mode: "physics",
      detail: "Cannon physics loaded from CDN.",
    }),
  };
}
