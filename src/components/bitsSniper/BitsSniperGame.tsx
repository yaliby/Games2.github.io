import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import "./BitsSniperGame.css";
import { GameEventBus } from "./game/core/GameEventBus.ts";
import {
  GameStateManager,
  type GameStateSnapshot,
} from "./game/core/GameStateManager.ts";
import { PointerLockManager } from "./game/core/PointerLockManager.ts";
import {
  loadSettingsFromStorage,
  saveSettingsToStorage,
  type GameSettings,
} from "./game/settings/GameSettings.ts";
import { TacticalMapOverlay } from "./tactical/TacticalMapOverlay";
import { getTacticalConfig, worldToMapNormalized } from "./tactical/TacticalMapConfig";
import { MiniMapComponent } from "./minimap/MiniMapComponent";
import { SpawnSelectionMap, type SpawnPoint } from "./spawnSelection/SpawnSelectionMap";
import { createSpawnVisualGroup, disposeSpawnVisualGroup } from "./spawnSelection/SpawnVisuals";
import {
  ARENA_HALF,
  USE_FLAT_PLAYGROUND,
  buildMap,
  createFlatPlayground,
  createProceduralDust2Blockout,
  type MapKeyPoint,
} from "./BitsSniperMaps";

//  Constants 
const DEBUG_MINIMAP_POSITION = false;
/** Minimap zoom: 1 = full map, 2 = 2x zoom (less world visible). */
const MINIMAP_ZOOM = 1;
/** גודל המיני־מפה בפיקסלים (פינה ימנית עליונה, בסגנון COD/CS:GO). */
const MINIMAP_SIZE = 200;
const PLAYER_HEIGHT    = 1.65;
const PLAYER_SPAWN_LIFT = 0.9; // extra height above spawn point when spawning
const PLAYER_RADIUS    = 0.38;
const MOVE_SPEED       = 9.2;
const RUN_MULT         = 1.70;
const JUMP_VEL         = 8.8;
const GRAVITY          = 22;
const CROUCH_MOVE_MULT = 0.58;
const CROUCH_CAMERA_DROP = 0.38;
const SLIDE_DURATION_SECS = 0.72;
const SLIDE_COOLDOWN_SECS = 1.2;
const SLIDE_SPEED_MULT = 2.05;
const LANDING_KICK_MULT = 0.018;
const LOOK_SENS_BASE   = 0.0022;

const VCURSOR_SENS = 1.0; // virtual cursor sensitivity while pointer-locked menus are open

const BOT_COUNT        = 1;
const BOT_RADIUS       = 0.50;  // Bot capsule radius (gameplay)
const BOT_HEIGHT       = 0.95;  // Bot capsule half-height (full ≈ 1.9)
const BOT_EGG_R        = 0.62;  // Fallback procedural bot visual radius
const RESPAWN_SECS     = 3.5;
const SPAWN_INVINCIBLE = 1.5;    // seconds of god-mode after spawn
const MAX_HEALTH       = 100;
const BOT_MAX_HEALTH   = 80;
const LOOK_SENS_MIN    = 0.0012;
const LOOK_SENS_MAX    = 0.0035;
const LOOK_SENS_STEP   = 0.0002;
const ADS_SENS_MIN     = 0.4;
const ADS_SENS_MAX     = 1.6;
const ADS_SENS_STEP    = 0.05;
const MASTER_VOL_MIN   = 0;
const MASTER_VOL_MAX   = 1;
const MASTER_VOL_STEP  = 0.05;
const ADS_LOOK_SENS_MULT = 0.56;
const ADS_MOVE_MULT    = 0.76;
const ADS_SPREAD_MULT  = 0.52;
const HIP_SPREAD_MULT  = 1.38;
const ADS_FOV: Record<WeaponDef["viewModel"], number> = {
  pistol: 52,
  ak47: 48,
  shotgun: 58,
  // צלף – זום אגרסיבי הרבה יותר
  sniper: 22,
};
const GROUND_ACCEL     = 19;
const AIR_ACCEL        = 4.2;
const GROUND_BRAKE     = 15.5;
const AIR_BRAKE        = 2.8;
const AIR_DRAG         = 2.0;
const COYOTE_TIME_SECS = 0.12;
const JUMP_BUFFER_SECS = 0.11;
const JUMP_RELEASE_CUT = 0.56;
const PROJECTILE_SPEED_MULT = 5.8;
const SHOT_SPREAD_MULT = 0.62;
const BOT_INACCURACY   = 0.045;
const RECOIL_RESET_SECS = 0.32;
const DEG2RAD = Math.PI / 180;

type RecoilStep = { yaw: number; pitch: number };

// Very lightweight, CS-style recoil patterns per weapon.
// Values are in radians and describe how much the shot direction (and camera) drifts per consecutive shot.
const RECOIL_PATTERNS: Record<string, RecoilStep[]> = {
  rifle: [
    { yaw: 0 * DEG2RAD, pitch: -0.35 * DEG2RAD },
    { yaw: 0.08 * DEG2RAD, pitch: -0.4 * DEG2RAD },
    { yaw: 0.12 * DEG2RAD, pitch: -0.45 * DEG2RAD },
    { yaw: 0.16 * DEG2RAD, pitch: -0.5 * DEG2RAD },
    { yaw: 0.12 * DEG2RAD, pitch: -0.55 * DEG2RAD },
    { yaw: 0.06 * DEG2RAD, pitch: -0.6 * DEG2RAD },
    { yaw: 0 * DEG2RAD, pitch: -0.65 * DEG2RAD },
    { yaw: -0.06 * DEG2RAD, pitch: -0.7 * DEG2RAD },
    { yaw: -0.14 * DEG2RAD, pitch: -0.75 * DEG2RAD },
    { yaw: -0.18 * DEG2RAD, pitch: -0.8 * DEG2RAD },
    { yaw: -0.16 * DEG2RAD, pitch: -0.85 * DEG2RAD },
    { yaw: -0.1 * DEG2RAD, pitch: -0.88 * DEG2RAD },
  ],
  scrambler: [
    { yaw: 0 * DEG2RAD, pitch: -0.4 * DEG2RAD },
    { yaw: 0.1 * DEG2RAD, pitch: -0.45 * DEG2RAD },
    { yaw: 0.14 * DEG2RAD, pitch: -0.5 * DEG2RAD },
    { yaw: 0.18 * DEG2RAD, pitch: -0.52 * DEG2RAD },
    { yaw: 0.16 * DEG2RAD, pitch: -0.55 * DEG2RAD },
    { yaw: 0.08 * DEG2RAD, pitch: -0.6 * DEG2RAD },
    { yaw: 0 * DEG2RAD, pitch: -0.64 * DEG2RAD },
    { yaw: -0.06 * DEG2RAD, pitch: -0.68 * DEG2RAD },
    { yaw: -0.12 * DEG2RAD, pitch: -0.7 * DEG2RAD },
    { yaw: -0.18 * DEG2RAD, pitch: -0.74 * DEG2RAD },
    { yaw: -0.2 * DEG2RAD, pitch: -0.78 * DEG2RAD },
    { yaw: -0.16 * DEG2RAD, pitch: -0.82 * DEG2RAD },
    { yaw: -0.1 * DEG2RAD, pitch: -0.86 * DEG2RAD },
    { yaw: -0.04 * DEG2RAD, pitch: -0.9 * DEG2RAD },
  ],
  whipper: [
    { yaw: 0 * DEG2RAD, pitch: -0.5 * DEG2RAD },
    { yaw: 0.06 * DEG2RAD, pitch: -0.6 * DEG2RAD },
    { yaw: -0.06 * DEG2RAD, pitch: -0.7 * DEG2RAD },
    { yaw: 0.08 * DEG2RAD, pitch: -0.8 * DEG2RAD },
  ],
  sniper: [
    { yaw: 0 * DEG2RAD, pitch: -0.18 * DEG2RAD },
    { yaw: 0.02 * DEG2RAD, pitch: -0.22 * DEG2RAD },
  ],
};
const BOT_ACCEL        = 14;
const BOT_BRAKE        = 12;
const BOT_SPEED_WALK   = 2.8;
const BOT_SPEED_RUN    = 5.8;
const BOT_YAW_LERP     = 6.5;
const BOT_MODEL_FACING_OFFSET = 0;
const HP_REGEN_DELAY_SECS = 3.0;
const HP_REGEN_EXP_RATE = 0.05;
const LOW_HP_WARN_THRESHOLD = 34;
const POSTFX_BLOOM_STRENGTH = 0.78;
const POSTFX_BLOOM_RADIUS = 0.5;
const POSTFX_BLOOM_THRESHOLD = 0.65;
const POSTFX_EXPOSURE = 1.24;
const MATCH_DURATION_SECS = 180;
const KILL_FEED_TTL_SECS = 4.2;
const HEADSHOT_MULT = 1.65;
const BOT_HEAD_Y_OFFSET = BOT_HEIGHT * 0.34;
const FLAT_SPAWN_HALF = 46;
const STAGE_ASPECT = 16 / 9;
const STAGE_PRESET_WIDTHS = {
  small: 760,
  medium: 980,
  large: 1220,
} as const;
/** Padding of the shell (section) horizontally – used to compute shell width when stage has custom size (≈ 0.9rem × 2) */
const SHELL_PADDING_PX = 30;

//  Weapon definitions 
interface WeaponDef {
  id: string; label: string; emoji: string;
  viewModel: "pistol" | "ak47" | "shotgun" | "sniper";
  damage: number; fireRate: number; spread: number;
  pellets: number; range: number;
  ammo: number; maxAmmo: number; reloadTime: number;
  projColor: string; projSpeed: number;
  hitMode: "projectile" | "hitscan";
  speedMult: number;
  splash: boolean; splashR: number; splashDmg: number;
  auto: boolean;
  // viewmodel colours
  bodyHex: string; barrelLen: number; barrelR: number;
}

interface ReloadAnimProfile {
  side: number;
  down: number;
  back: number;
  pitch: number;
  roll: number;
  yaw: number;
  wobble: number;
  wobbleFreq: number;
  settleSpeed: number;
  tacticalTime: number;
}

const WEAPONS: WeaponDef[] = [
  {
    id:"rifle",    label:"Pistol",  emoji:"P",
    viewModel:"pistol",
    damage:24, fireRate:3.9, spread:0.0105, pellets:1, range:88,
    ammo:16, maxAmmo:16, reloadTime:1.15,
    projColor:"#ffe8b0", projSpeed:66, hitMode:"hitscan", speedMult:3.25, splash:false, splashR:0, splashDmg:0,
    auto:false, bodyHex:"#6a9ab8", barrelLen:0.72, barrelR:0.038,
  },
  {
    id:"scrambler", label:"AK-47", emoji:"AK",
    viewModel:"ak47",
    damage:17, fireRate:7.9, spread:0.026, pellets:1, range:110,
    ammo:30, maxAmmo:30, reloadTime:1.8,
    projColor:"#ffe070", projSpeed:57, hitMode:"hitscan", speedMult:2.72, splash:false, splashR:0, splashDmg:0,
    auto:true, bodyHex:"#a87840", barrelLen:0.50, barrelR:0.048,
  },
  {
    id:"whipper",  label:"Shotgun",   emoji:"SG",
    viewModel:"shotgun",
    // ספריי רחב יותר – פחות נזק לכל כדור, יותר פיזור
    damage:11, fireRate:1.08, spread:0.16, pellets:8, range:31,
    ammo:6,  maxAmmo:6,  reloadTime:2.8,
    projColor:"#ffe066", projSpeed:42, hitMode:"hitscan", speedMult:2.0, splash:false, splashR:0, splashDmg:0,
    auto:false, bodyHex:"#996655", barrelLen:0.36, barrelR:0.068,
  },
  {
    id:"cracker",  label:"Sniper",   emoji:"SN",
    viewModel:"sniper",
    damage:108, fireRate:0.7, spread:0.0018, pellets:1, range:220,
    ammo:5,  maxAmmo:5,  reloadTime:2.7,
    projColor:"#ff9944", projSpeed:60, hitMode:"hitscan", speedMult:3.55, splash:false, splashR:0, splashDmg:0,
    auto:false, bodyHex:"#c06030", barrelLen:0.66, barrelR:0.055,
  },
];

const RELOAD_ANIMS: Record<string, ReloadAnimProfile> = {
  rifle: {
    side: 0.07, down: 0.16, back: 0.22,
    pitch: 0.52, roll: 0.78, yaw: 0.085,
    wobble: 0.1, wobbleFreq: 4.1, settleSpeed: 5.4, tacticalTime: 0.86,
  },
  scrambler: {
    side: 0.035, down: 0.1, back: 0.14,
    pitch: 0.3, roll: 0.46, yaw: 0.055,
    wobble: 0.065, wobbleFreq: 5.2, settleSpeed: 6.2, tacticalTime: 0.64,
  },
  whipper: {
    side: 0.1, down: 0.2, back: 0.26,
    pitch: 0.6, roll: 1.22, yaw: 0.13,
    wobble: 0.15, wobbleFreq: 3.4, settleSpeed: 4.8, tacticalTime: 1.02,
  },
  cracker: {
    side: 0.13, down: 0.26, back: 0.34,
    pitch: 0.74, roll: 1.45, yaw: 0.17,
    wobble: 0.2, wobbleFreq: 2.8, settleSpeed: 4.1, tacticalTime: 1.2,
  },
};

function getReloadAnimProfile(wpId: string): ReloadAnimProfile {
  return RELOAD_ANIMS[wpId] ?? RELOAD_ANIMS.rifle;
}

type BotAnimName = "idle" | "walk" | "run" | "attack" | "die";
type VmAnimName = "idle" | "shoot" | "reload";
type StageSizePreset = "small" | "medium" | "large" | "fluid" | "custom";
type StageSize = { width: number; height: number };
type VmPose = {
  baseX: number; baseY: number; baseZ: number; baseRotY: number;
  muzzleX: number; muzzleY: number; muzzleZ: number;
};

type MapId = "flat" | "arena" | "dust2" | "levelGlb";

const MAPS: { id: MapId; label: string }[] = USE_FLAT_PLAYGROUND
  ? [
      { id: "flat", label: "Flat Playground (stable)" },
    ]
  : [
      { id: "arena",   label: "Shell Arena (built-in)" },
      { id: "dust2",   label: "Dust II (OBJ)" },
      { id: "levelGlb", label: "Custom Level (GLB)" },
    ];

type ViewModelAsset = {
  template: THREE.Group;
  animations: THREE.AnimationClip[];
};

type FpsAssetPack = {
  mutantTemplate: THREE.Group | null;
  mutantAnims: Partial<Record<BotAnimName, THREE.AnimationClip>>;
  weaponModels: Partial<Record<WeaponDef["viewModel"], ViewModelAsset>>;
  levelTemplate: THREE.Group | null;
  muzzleFlashTemplate: THREE.Group | null;
  shotSoundBuffer: AudioBuffer | null;
  skyTexture: THREE.Texture | null;
};

const EMPTY_FPS_ASSET_PACK: FpsAssetPack = {
  mutantTemplate: null,
  mutantAnims: {},
  weaponModels: {},
  levelTemplate: null,
  muzzleFlashTemplate: null,
  shotSoundBuffer: null,
  skyTexture: null,
};

const FPS_ASSET_PATHS = {
  sky: "bits-sniper-fps/assets/sky.jpg",
  mutantModel: "bits-sniper-fps/assets/animations/mutant.fbx",
  mutantIdle: "bits-sniper-fps/assets/animations/mutant breathing idle.fbx",
  mutantWalk: "bits-sniper-fps/assets/animations/mutant walking.fbx",
  mutantRun: "bits-sniper-fps/assets/animations/mutant run.fbx",
  mutantAttack: "bits-sniper-fps/assets/animations/mutant punch.fbx",
  mutantDie: "bits-sniper-fps/assets/animations/mutant dying.fbx",
  mapPackMtl: "bits-sniper-fps/assets/mapPack/source/de_dust2.mtl",
  mapPackObj: "bits-sniper-fps/assets/mapPack/source/de_dust2.obj",
  levelMap: "bits-sniper-fps/assets/level.glb",
  muzzleFlash: "bits-sniper-fps/assets/muzzle_flash.glb",
  ak47Shot: "bits-sniper-fps/assets/sounds/ak47_shot.wav",
} as const;

const VIEWMODEL_GLB_PATHS: Record<WeaponDef["viewModel"], string> = {
  pistol: "bits-sniper-fps/assets/guns/pistol/pistol.glb",
  ak47: "bits-sniper-fps/assets/guns/ak47/ak47.glb",
  shotgun: "bits-sniper-fps/assets/guns/shotgun/shotgun.glb",
  sniper: "bits-sniper-fps/assets/guns/sniper/sniper_animated.glb",
};

function buildAssetUrl(relativePath: string) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${normalizedBase}${encodedPath}`;
}

let currentMapId: MapId = USE_FLAT_PLAYGROUND ? "flat" : "arena";

async function loadFpsAssetPack(): Promise<FpsAssetPack> {
  const pack: FpsAssetPack = {
    ...EMPTY_FPS_ASSET_PACK,
    mutantAnims: {},
    weaponModels: {},
    muzzleFlashTemplate: null,
  };
  const textureLoader = new THREE.TextureLoader();
  const audioLoader = new THREE.AudioLoader();
  const mtlLoader = new MTLLoader();
  const objLoader = new OBJLoader();
  const gltfLoader = new GLTFLoader();

  const loadViewModel = async (viewModel: WeaponDef["viewModel"], relativePath: string) => {
    try {
      const gltf = await gltfLoader.loadAsync(buildAssetUrl(relativePath));
      pack.weaponModels[viewModel] = {
        template: gltf.scene,
        animations: gltf.animations ?? [],
      };
    } catch (err) {
      if (viewModel === "ak47") {
        console.warn("Failed loading AK47 model:", err);
      }
      // Optional weapon model; we fallback to procedural mesh for that slot.
    }
  };

  const tasks: Promise<void>[] = [
    // Bots use our procedural model only (no mutant FBX loaded).
    (async () => {})(),
    (async () => {
      if (USE_FLAT_PLAYGROUND) {
        // Fully flat, built-in playground (no external level files at all).
        pack.levelTemplate = createFlatPlayground();
        return;
      }

      if (currentMapId === "arena") {
        // Procedural arena, still internal (no external level files).
        pack.levelTemplate = createProceduralDust2Blockout();
        return;
      }

      const tryLoadDust2 = async () => {
        const sourceDir = buildAssetUrl("bits-sniper-fps/assets/mapPack/source/");
        mtlLoader.setPath(sourceDir);
        mtlLoader.setResourcePath(sourceDir);
        const materials = await mtlLoader.loadAsync(FPS_ASSET_PATHS.mapPackMtl.split("/").pop() as string);
        materials.preload();
        objLoader.setMaterials(materials);
        objLoader.setPath(sourceDir);
        const mapObj = await objLoader.loadAsync(FPS_ASSET_PATHS.mapPackObj.split("/").pop() as string);
        pack.levelTemplate = mapObj;
      };

      const tryLoadGlb = async () => {
        const gltf = await gltfLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.levelMap));
        pack.levelTemplate = gltf.scene;
      };

      try {
        if (currentMapId === "dust2") {
          await tryLoadDust2();
        } else {
          await tryLoadGlb();
        }
      } catch {
        try {
          if (currentMapId === "dust2") {
            await tryLoadGlb();
          } else {
            await tryLoadDust2();
          }
        } catch {
          // Keep procedural fallback map when external level files are missing.
        }
      }
    })(),
    // No mutant clips; procedural bot uses code-driven wobble.
    ...((Object.entries(VIEWMODEL_GLB_PATHS) as Array<[WeaponDef["viewModel"], string]>)
      .map(([viewModel, relativePath]) => loadViewModel(viewModel, relativePath))),
    (async () => {
      try {
        const gltf = await gltfLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.muzzleFlash));
        pack.muzzleFlashTemplate = gltf.scene;
      } catch {
        // Optional. A procedural flash fallback is used when missing.
      }
    })(),
    (async () => {
      try {
        pack.shotSoundBuffer = await audioLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.ak47Shot));
      } catch {
        // Sound is optional.
      }
    })(),
    (async () => {
      try {
        const sky = await textureLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.sky));
        sky.colorSpace = THREE.SRGBColorSpace;
        pack.skyTexture = sky;
      } catch {
        // Keep fallback background if texture is unavailable.
      }
    })(),
  ];

  await Promise.all(tasks);
  return pack;
}

let fpsAssetPackPromise: Promise<FpsAssetPack> | null = null;
function getFpsAssetPackOnce(mapId: MapId) {
  currentMapId = mapId;
  if (!fpsAssetPackPromise) {
    fpsAssetPackPromise = loadFpsAssetPack();
  }
  return fpsAssetPackPromise;
}

//  Types 
interface BotState {
  id: number; mesh: THREE.Group; health: number; dead: boolean;
  respawnTimer: number; velY: number; velX: number; velZ: number; onGround: boolean;
  yaw: number; targetYaw: number; wpIdx: number; fireTimer: number;
  strafeDir: number; strafeTimer: number; reloadTimer: number; ammo: number;
  label: string; lastHudHealth: number;
  animTime: number; animPhase: number;
  mixer?: THREE.AnimationMixer;
  animActions?: Partial<Record<BotAnimName, THREE.AnimationAction>>;
  activeAnim?: BotAnimName;
}
interface Projectile {
  mesh: THREE.Mesh; vel: THREE.Vector3; fromBot: boolean;
  sourceName: string;
  damage: number; range: number; traveled: number;
  splash: boolean; splashR: number; splashDmg: number;
}
interface HitInd { angle: number; opacity: number }
interface KillFeedEntry {
  id: number;
  text: string;
  ttl: number;
  headshot: boolean;
}

//  Small helpers 
function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)) }
function rng(lo:number,hi:number){ return lo+Math.random()*(hi-lo) }


// ─────────────────────────────────────────────────────────────
// Capsule math helpers (fast + allocation-free)
// Used for smoother, more accurate hits than simple spheres.
// ─────────────────────────────────────────────────────────────
const _ssD1 = new THREE.Vector3();
const _ssD2 = new THREE.Vector3();
const _ssR  = new THREE.Vector3();
const _ssC1 = new THREE.Vector3();
const _ssC2 = new THREE.Vector3();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();

function segmentSegmentClosestParams(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outC1?: THREE.Vector3,
  outC2?: THREE.Vector3,
): { distSq: number; s: number; t: number } {
  // Christer Ericson, Real-Time Collision Detection (adapted)
  _ssD1.copy(q1).sub(p1);
  _ssD2.copy(q2).sub(p2);
  _ssR.copy(p1).sub(p2);

  const a = _ssD1.dot(_ssD1);
  const e = _ssD2.dot(_ssD2);
  const f = _ssD2.dot(_ssR);

  let s = 0;
  let t = 0;
  const EPS = 1e-8;

  if (a <= EPS && e <= EPS) {
    if (outC1) outC1.copy(p1);
    if (outC2) outC2.copy(p2);
    return { distSq: p1.distanceToSquared(p2), s: 0, t: 0 };
  }

  if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _ssD1.dot(_ssR);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _ssD1.dot(_ssD2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  if (outC1) outC1.copy(p1).addScaledVector(_ssD1, s);
  if (outC2) outC2.copy(p2).addScaledVector(_ssD2, t);

  return { distSq: outC1 && outC2 ? outC1.distanceToSquared(outC2) : 0, s, t };
}

function segmentHitsCapsule(
  segA: THREE.Vector3,
  segB: THREE.Vector3,
  center: THREE.Vector3,
  halfHeight: number,
  radius: number,
  outHitPoint: THREE.Vector3,
): { hit: boolean; segS: number; axisT: number } {
  _capA.set(center.x, center.y - halfHeight + radius, center.z);
  _capB.set(center.x, center.y + halfHeight - radius, center.z);

  const { distSq, s, t } = segmentSegmentClosestParams(segA, segB, _capA, _capB, _ssC1, _ssC2);
  if (distSq <= radius * radius) {
    outHitPoint.copy(_ssC1);
    return { hit: true, segS: s, axisT: t };
  }
  return { hit: false, segS: 0, axisT: 0 };
}

function getStageWidthBounds(_aspect = STAGE_ASPECT) {
  const minW = 320;
  const maxW = 4096;
  return { minW, maxW };
}

function makeStageSize(width: number, aspect = STAGE_ASPECT): StageSize {
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

function getPresetStageSize(preset: Exclude<StageSizePreset, "custom" | "fluid">): StageSize {
  const { minW, maxW } = getStageWidthBounds();
  const width = clamp(STAGE_PRESET_WIDTHS[preset], minW, maxW);
  return makeStageSize(width);
}

function getInitialStagePreset(): StageSizePreset {
  if (typeof window !== "undefined" && window.innerWidth < 720) return "fluid";
  return "medium";
}

function getInitialStageSize(): StageSize | null {
  if (typeof window !== "undefined" && window.innerWidth < 720) return null;
  return getPresetStageSize("medium");
}

function formatTimer(totalSeconds: number) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function getBotHudColor(ratio: number) {
  if (ratio > 0.5) return "#2ee872";
  if (ratio > 0.25) return "#f0c038";
  return "#ee4038";
}

function updateBotHpLabel(mesh: THREE.Group, label: string, health: number) {
  const ctx = mesh.userData.hpLabelCtx as CanvasRenderingContext2D | undefined;
  const texture = mesh.userData.hpLabelTexture as THREE.CanvasTexture | undefined;
  if (!ctx || !texture) return;

  const ratio = clamp(health / BOT_MAX_HEALTH, 0, 1);
  const hpValue = Math.max(0, Math.round(health));
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);

  drawRoundedRect(ctx, 8, 6, width - 16, height - 12, 14);
  ctx.fillStyle = "rgba(4, 12, 24, 0.88)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(126, 188, 244, 0.74)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8f4ff";
  ctx.font = "700 22px Oxanium, Segoe UI, sans-serif";
  ctx.fillText(label, width * 0.5, 30);

  const barX = 22;
  const barY = 44;
  const barW = width - 44;
  const barH = 20;
  drawRoundedRect(ctx, barX, barY, barW, barH, 8);
  ctx.fillStyle = "rgba(16, 26, 42, 0.92)";
  ctx.fill();

  const fillW = Math.max(8, Math.round(barW * ratio));
  drawRoundedRect(ctx, barX, barY, fillW, barH, 8);
  ctx.fillStyle = getBotHudColor(ratio);
  ctx.fill();

  ctx.fillStyle = "#d9e9f8";
  ctx.font = "700 16px Oxanium, Segoe UI, sans-serif";
  ctx.fillText(`${hpValue}/${BOT_MAX_HEALTH} HP`, width * 0.5, 81);
  texture.needsUpdate = true;
}
type SpawnZone = [number, number, number, number];

// Competitive symmetric spawns: each side has a protected exit + risky fast exit.
const PLAYER_SPAWN_ZONES: SpawnZone[] = [
  // Procedural Dust2-style blockout: safe spawn near Base A (SW)
  [-64,  52, 12, 12],
  [-58,  40, 12, 12],
  [-44,  52, 12, 10],
];

const BOT_SPAWN_ZONES: SpawnZone[] = [
  // Enemy spawns: Base B (NE) + mid-lanes
  [ 52, -64, 12, 12],
  [ 40, -58, 12, 12],
  [-12, -40, 24, 20],
  [-18, -10, 12, 20],
  [  6, -10, 12, 20],
  [-12,  26, 24, 18],
];

const BOT_NAMES  = ["KoloBot","YoloEgg","SnipeHen","CrackBot","FryBot","Scrambles","Clucky"];
const BOT_COLORS = ["#e84a4a","#e87a40","#e8c44a","#40e880","#40b0e8","#a040e8","#e840b0"]
  .map(c => new THREE.Color(c));

//  Build egg-bot mesh 
function attachBotHud(g: THREE.Group, hpBarY: number, hpLabelY: number) {
  const hbBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.14),
    new THREE.MeshBasicMaterial({ color: "#330000", depthTest: false }),
  );
  hbBg.position.y = hpBarY;
  hbBg.renderOrder = 999;
  g.add(hbBg);

  const hbFg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 0.1),
    new THREE.MeshBasicMaterial({ color: "#22ee44", depthTest: false }),
  );
  hbFg.position.y = hpBarY + 0.001;
  hbFg.renderOrder = 1000;
  g.add(hbFg);

  const hpLabelCanvas = document.createElement("canvas");
  hpLabelCanvas.width = 256;
  hpLabelCanvas.height = 96;
  const hpLabelTexture = new THREE.CanvasTexture(hpLabelCanvas);
  hpLabelTexture.colorSpace = THREE.SRGBColorSpace;
  hpLabelTexture.minFilter = THREE.LinearFilter;
  hpLabelTexture.magFilter = THREE.LinearFilter;
  hpLabelTexture.generateMipmaps = false;

  const hpLabelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: hpLabelTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  hpLabelSprite.position.set(0, hpLabelY, 0);
  hpLabelSprite.scale.set(1.58, 0.59, 1);
  hpLabelSprite.renderOrder = 1001;
  g.add(hpLabelSprite);

  g.userData.hpBarBg = hbBg;
  g.userData.hpBarFg = hbFg;
  g.userData.hpLabelCtx = hpLabelCanvas.getContext("2d");
  g.userData.hpLabelTexture = hpLabelTexture;
  g.userData.hpLabelSprite = hpLabelSprite;
}

function makeBotMesh(color: THREE.Color, mutantTemplate: THREE.Group | null): THREE.Group {
  const g = new THREE.Group();

  // Unified muzzle/origin tuning (offset from capsule center).
  g.userData.muzzleOffsetY = BOT_HEIGHT * 0.36;

  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();

  function fitToBotCapsule(root: THREE.Object3D) {
    // Scale imported model to match our gameplay capsule, then align feet to y=-BOT_HEIGHT.
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
    tmpBox.getSize(tmpSize);

    const currentH = Math.max(1e-4, tmpSize.y);
    const targetH = BOT_HEIGHT * 2;
    const s = targetH / currentH;

    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);

    tmpBox.setFromObject(root);
    tmpBox.getCenter(tmpCenter);

    // Center on X/Z so gameplay capsule matches the model.
    root.position.x -= tmpCenter.x;
    root.position.z -= tmpCenter.z;

    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);

    // Align model feet to capsule bottom.
    root.position.y += (-BOT_HEIGHT - tmpBox.min.y);
    root.updateMatrixWorld(true);
  }

  const hudBarY = BOT_HEIGHT + 0.42;
  const hudLabelY = BOT_HEIGHT + 0.74;

  if (mutantTemplate) {
    const mutant = SkeletonUtils.clone(mutantTemplate) as THREE.Group;

    // Clone materials + slight tint for readable targets.
    mutant.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clonedMaterials = sourceMaterials.map((mat) => {
        const cloned = mat.clone();
        const maybeColor = cloned as THREE.Material & { color?: THREE.Color };
        if (maybeColor.color) {
          maybeColor.color.lerp(color, 0.12);
        }
        return cloned;
      });
      mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
    });

    fitToBotCapsule(mutant);

    g.add(mutant);
    g.userData.mutantRoot = mutant;

    attachBotHud(g, hudBarY, hudLabelY);
    return g;
  }

  // Our own procedural bot: simple humanoid, all in code (feet y=0, head ≈ 2*BOT_HEIGHT).
  const legH = 0.48;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, legH, 10),
    new THREE.MeshStandardMaterial({ color: "#1a1a2e", roughness: 0.8, metalness: 0.1 }),
  );
  base.position.y = legH * 0.5;
  base.receiveShadow = true;
  g.add(base);

  const torsoH = 0.88;
  const torsoR = 0.3;
  const bMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.15 });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(torsoR * 1.02, torsoR, torsoH, 12),
    bMat,
  );
  body.position.y = legH + torsoH * 0.5;
  body.castShadow = true;
  g.add(body);

  const headR = 0.22;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headR, 12, 10),
    new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color("#fff"), 0.15), roughness: 0.45 }),
  );
  head.position.y = legH + torsoH + headR;
  head.castShadow = true;
  g.add(head);

  const eyeY = head.position.y;
  const eyeZ = headR * 0.92;
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#fff" }),
    );
    eye.position.set(sx * 0.08, eyeY + 0.02, eyeZ);
    g.add(eye);
    const pup = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 6),
      new THREE.MeshStandardMaterial({ color: "#0a0a12" }),
    );
    pup.position.set(sx * 0.08, eyeY + 0.02, eyeZ + 0.04);
    g.add(pup);
  }

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.48, 8),
    new THREE.MeshStandardMaterial({ color: "#2a2a35", roughness: 0.5, metalness: 0.2 }),
  );
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, legH + torsoH * 0.35, torsoR + 0.2);
  g.add(gun);

  attachBotHud(g, hudBarY + BOT_HEIGHT, hudLabelY + BOT_HEIGHT);

  for (const child of g.children) {
    child.position.y -= BOT_HEIGHT;
  }

  g.userData.body = body;
  g.userData.base = base;
  g.userData.gun = gun;
  g.userData.bodyBaseY = body.position.y;
  g.userData.baseBaseY = base.position.y;
  g.userData.gunBaseRotZ = gun.rotation.z;

  return g;
}

// Build viewmodel (weapon seen in first person)
function setVmPose(group: THREE.Group, pose: VmPose, isAk47 = false) {
  group.userData.vmPose = pose;
  group.userData.isAk47Viewmodel = isAk47;
}

function addSimpleHands(
  group: THREE.Group,
  opts: { scale?: number; offsetX?: number; offsetY?: number; offsetZ?: number } = {},
) {
  const scale = opts.scale ?? 1;
  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;
  const offsetZ = opts.offsetZ ?? 0;
  const handsRoot = new THREE.Group();
  handsRoot.scale.setScalar(scale);
  handsRoot.position.set(offsetX, offsetY, offsetZ);
  group.add(handsRoot);

  const handMat = new THREE.MeshStandardMaterial({ color: "#e7bea0", roughness: 0.66, metalness: 0.05 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: "#1e2a44", roughness: 0.62, metalness: 0.18 });

  const rightSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), sleeveMat);
  rightSleeve.position.set(0.12, -0.11, 0.04);
  handsRoot.add(rightSleeve);
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.12), handMat);
  rightHand.position.set(0.12, -0.11, -0.08);
  handsRoot.add(rightHand);

  const leftSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), sleeveMat);
  leftSleeve.position.set(-0.14, -0.09, -0.08);
  handsRoot.add(leftSleeve);
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.12), handMat);
  leftHand.position.set(-0.14, -0.09, -0.2);
  handsRoot.add(leftHand);
}

type ImportedVmConfig = {
  scale: number;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  pose: VmPose;
  // Muzzle-flash visual offset (view-space), independent from bullet origin.
  flashOffsetX?: number;
  flashOffsetY?: number;
  flashOffsetZ?: number;
  // Optional tuning for simple static models (no rig/animations).
  staticScaleMul?: number;
  staticPositionOffset?: [number, number, number];
  staticRotationOffsetDeg?: [number, number, number];
  staticPose?: VmPose;
};

type MergedClipSplit = {
  idle: [number, number];
  shoot: [number, number];
  reload: [number, number];
};

const IMPORTED_VM_CONFIG: Record<WeaponDef["viewModel"], ImportedVmConfig> = {
  pistol: {
    scale: 0.013,
    position: [0.04, -0.02, -0.4],
    rotationDeg: [5, 185, 0],
    flashOffsetX: 0.22,
    flashOffsetY: -0.04,
    flashOffsetZ: -0.3,
    pose: {
      baseX: 0.24, baseY: -0.18, baseZ: -0.36, baseRotY: -0.12,
      muzzleX: 0.22, muzzleY: -0.165, muzzleZ: -0.58,
    },
    staticScaleMul: 2.35,
    staticPositionOffset: [-0.04, -0.04, 0.03],
    // Static Sketchfab-like pistol: tilt + yaw correction so barrel points forward in POV.
    staticRotationOffsetDeg: [18, -90, 0],
    staticPose: {
      baseX: 0.17, baseY: -0.22, baseZ: -0.34, baseRotY: -0.08,
      muzzleX: 1, muzzleY: 1, muzzleZ: 1,
    },
  },
  ak47: {
    scale: 0.05,
    position: [0.04, -0.02, 0.0],
    rotationDeg: [5, 185, 0],
    pose: {
      baseX: 0,
      baseY: 0,
      baseZ: 0,
      baseRotY: 0,
      muzzleX: 0.025,
      muzzleY: 0,
      muzzleZ: -0.415,
    },
  },
  shotgun: {
    scale: 0.009,
    position: [0.04, -0.13, -0.03],
    rotationDeg: [5, 185, 0],
    flashOffsetX: 0.25,
    flashOffsetY: -0.15,
    flashOffsetZ:-1,
    pose: {
      baseX: 0.23, baseY: -0.19, baseZ: -0.44, baseRotY: -0.18,
      muzzleX: 0.22, muzzleY: -0.16, muzzleZ: -0.92,
    },
  },
  sniper: {
    scale: 0.016,
    // bringing the sniper even closer into the player's POV
    // and slightly lower relative to the camera
    position: [0.04, -0.07, 0.05],
    rotationDeg: [5, 185, 0],
    pose: {
      baseX: 0.22, baseY: -0.25, baseZ: -0.32, baseRotY: -0.21,
      muzzleX: 0.22, muzzleY: -0.16, muzzleZ: -1.08,
    },
  },
};

// Some downloaded assets export one long "all anims" clip.
// Split normalized [0..1] ranges into idle/fire/reload subclips.
const MERGED_CLIP_SPLITS: Partial<Record<WeaponDef["viewModel"], MergedClipSplit>> = {
  pistol: {
    idle: [0.0, 0.32],
    shoot: [0.32, 0.44],
    reload: [0.44, 0.98],
  },
  // Shotgun model uses one merged "allanims" clip:
  // idle + per-shot cycle + magazine reload.
  shotgun: {
    // allanims clip duration ~= 6.0s
    // per-shell insertion segment provided: 1.10s -> 2.50s
    idle: [0.02, 0.03],      // short near-static hold pose for default hands
    shoot: [0.03, 0.1817],   // 0.18s -> 1.09s  (per-shot cycle)
    reload: [0.1833, 0.4167],// 1.10s -> 2.50s  (single-shell insert)
  },
};

// טווחי שניות יעודיים לאנימציות הסנייפר (על ציר זמן הקליפ המקורי)
const SNIPER_CLIP_SECONDS = {
  idle:   { start: 0, end: 0.20 },   // פוזה כמעט סטטית בתחילת הקליפ
  shoot:  { start: 0, end: 1.53 },   // ירייה בודדת
  reload: { start: 0, end: 3.24 },   // רילואד מלא
} as const;

// כמה שניקח את הסנייפר עוד קצת "קדימה" בעומק התמונה בזמן רילואד (רחוק מהשחקן)
const SNIPER_RELOAD_BACK_EXTRA = -0.3;

function normalizeClipName(name: string) {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

function findClipByAliases(clips: THREE.AnimationClip[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeClipName);
  return clips.find((clip) => {
    const normalized = normalizeClipName(clip.name);
    return normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias));
  });
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function buildSubclipFromNormalizedRange(
  source: THREE.AnimationClip,
  name: string,
  range: [number, number],
  fps = 30,
) {
  const start = clamp01(range[0]);
  const end = clamp01(range[1]);
  if (end - start < 0.01) return undefined;
  const duration = Math.max(0.001, source.duration);
  const startFrame = Math.floor(start * duration * fps);
  const endFrame = Math.max(startFrame + 2, Math.ceil(end * duration * fps));
  return THREE.AnimationUtils.subclip(source, `${source.name}_${name}`, startFrame, endFrame, fps);
}

function trimClipTailSeconds(
  source: THREE.AnimationClip,
  name: string,
  tailSecondsToTrim: number,
  fps = 30,
) {
  const duration = Math.max(0.001, source.duration);
  const trim = Math.max(0, tailSecondsToTrim);
  if (duration - trim < 0.08) return undefined;
  const endFrame = Math.max(2, Math.floor((duration - trim) * fps));
  return THREE.AnimationUtils.subclip(source, `${source.name}_${name}`, 0, endFrame, fps);
}

type MuzzleRatio = { x: number; y: number; z: number };
type ObjectBounds = { min: THREE.Vector3; max: THREE.Vector3; size: THREE.Vector3 };
let cachedAkMuzzleRatio: MuzzleRatio | null = null;

function applyImportedTransform(root: THREE.Object3D, config: ImportedVmConfig) {
  root.scale.setScalar(config.scale);
  root.position.set(...config.position);
  root.setRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(config.rotationDeg[0]),
      THREE.MathUtils.degToRad(config.rotationDeg[1]),
      THREE.MathUtils.degToRad(config.rotationDeg[2]),
    ),
  );
}

function getObjectBounds(root: THREE.Object3D): ObjectBounds | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.lengthSq() < 1e-8) return null;
  return { min: box.min.clone(), max: box.max.clone(), size };
}

function toMuzzleRatio(pose: VmPose, bounds: ObjectBounds): MuzzleRatio {
  return {
    x: (pose.muzzleX - bounds.min.x) / Math.max(1e-6, bounds.size.x),
    y: (pose.muzzleY - bounds.min.y) / Math.max(1e-6, bounds.size.y),
    z: (pose.muzzleZ - bounds.min.z) / Math.max(1e-6, bounds.size.z),
  };
}

function fromMuzzleRatio(ratio: MuzzleRatio, bounds: ObjectBounds) {
  return {
    x: bounds.min.x + bounds.size.x * ratio.x,
    y: bounds.min.y + bounds.size.y * ratio.y,
    z: bounds.min.z + bounds.size.z * ratio.z,
  };
}

function ensureAkMuzzleRatio(akAsset: ViewModelAsset | undefined) {
  if (cachedAkMuzzleRatio) return cachedAkMuzzleRatio;
  if (!akAsset?.template) return null;
  const probe = SkeletonUtils.clone(akAsset.template) as THREE.Group;
  const config = IMPORTED_VM_CONFIG.ak47;
  applyImportedTransform(probe, config);
  const bounds = getObjectBounds(probe);
  if (!bounds) return null;
  cachedAkMuzzleRatio = toMuzzleRatio(config.pose, bounds);
  return cachedAkMuzzleRatio;
}

function makeViewmodel(
  wp: WeaponDef,
  vmScene: THREE.Scene,
  weaponAsset: ViewModelAsset | undefined,
  akReferenceAsset: ViewModelAsset | undefined,
): THREE.Group {
  const g = new THREE.Group();
  g.userData.viewModel = wp.viewModel;
  g.userData.vmFlashOffsetX = IMPORTED_VM_CONFIG[wp.viewModel].flashOffsetX ?? 0;
  g.userData.vmFlashOffsetY = IMPORTED_VM_CONFIG[wp.viewModel].flashOffsetY ?? 0;
  g.userData.vmFlashOffsetZ = IMPORTED_VM_CONFIG[wp.viewModel].flashOffsetZ ?? 0;
  const metalMat = new THREE.MeshStandardMaterial({ color: "#526277", roughness: 0.34, metalness: 0.72 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#262c36", roughness: 0.52, metalness: 0.36 });
  const woodMat = new THREE.MeshStandardMaterial({ color: "#7d5537", roughness: 0.74, metalness: 0.07 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: wp.bodyHex, roughness: 0.48, metalness: 0.22 });

  if (weaponAsset?.template) {
    const imported = SkeletonUtils.clone(weaponAsset.template) as THREE.Group;
    const config = IMPORTED_VM_CONFIG[wp.viewModel];
    let hasEmbeddedHands = false;
    applyImportedTransform(imported, config);
    imported.traverse((node) => {
      const nodeName = (node.name ?? "").toLowerCase();
      if (!hasEmbeddedHands && /(upper_arm|forearm|hand|finger|thumb|palm)/.test(nodeName)) {
        hasEmbeddedHands = true;
      }
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        mesh.frustumCulled = false;
      }
    });

    const clips = weaponAsset.animations;
    const isStaticModel = clips.length === 0;
    if (isStaticModel) {
      imported.scale.multiplyScalar(config.staticScaleMul ?? 1);
      if (config.staticPositionOffset) {
        imported.position.x += config.staticPositionOffset[0];
        imported.position.y += config.staticPositionOffset[1];
        imported.position.z += config.staticPositionOffset[2];
      }
      if (config.staticRotationOffsetDeg) {
        imported.rotation.x += THREE.MathUtils.degToRad(config.staticRotationOffsetDeg[0]);
        imported.rotation.y += THREE.MathUtils.degToRad(config.staticRotationOffsetDeg[1]);
        imported.rotation.z += THREE.MathUtils.degToRad(config.staticRotationOffsetDeg[2]);
      }
    }
    const importedBounds = getObjectBounds(imported);
    if (wp.viewModel === "ak47" && importedBounds) {
      cachedAkMuzzleRatio = toMuzzleRatio(config.pose, importedBounds);
    }
    const akMuzzleRatio = wp.viewModel === "ak47"
      ? cachedAkMuzzleRatio
      : (cachedAkMuzzleRatio ?? ensureAkMuzzleRatio(akReferenceAsset));
    const resolvedPose: VmPose = {
      ...(isStaticModel && config.staticPose ? config.staticPose : config.pose),
    };
    if (wp.viewModel !== "ak47" && importedBounds && akMuzzleRatio) {
      // Derive muzzle from AK's proven ratio inside its model bounds.
      const relativeMuzzle = fromMuzzleRatio(akMuzzleRatio, importedBounds);
      resolvedPose.muzzleX = relativeMuzzle.x;
      resolvedPose.muzzleY = relativeMuzzle.y;
      resolvedPose.muzzleZ = relativeMuzzle.z;
    }

    const actions: Partial<Record<VmAnimName, THREE.AnimationAction>> = {};
    if (clips.length > 0) {
      const mixer = new THREE.AnimationMixer(imported);
      let shootClip = findClipByAliases(clips, ["fire", "shoot", "shot", "pump", "cycle", "cock", "chamber"]);
      let idleClip = findClipByAliases(clips, ["idle"]);
      let reloadClip = findClipByAliases(clips, [
        "reloadempty",
        "reloadmag",
        "magreload",
        "magazine",
        "reload",
      ]);
      let reloadOnlyMerged = false;
      let freezeIdlePose = false;

      if (clips.length === 1 && (!shootClip || !idleClip || !reloadClip)) {
        const single = clips[0];
        const singleName = normalizeClipName(single.name);
        const looksMerged =
          singleName.includes("all") || singleName.includes("combo") || singleName.includes("anims");
        if (looksMerged) {
          const split = MERGED_CLIP_SPLITS[wp.viewModel];
          if (split) {
            idleClip = idleClip ?? buildSubclipFromNormalizedRange(single, "idle", split.idle);
            shootClip = shootClip ?? buildSubclipFromNormalizedRange(single, "fire", split.shoot);
            reloadClip = reloadClip ?? buildSubclipFromNormalizedRange(single, "reload", split.reload);
          }
          // Sniper: ב-all-anims לוקחים רק טווחים מוגדרים לפי SNIPER_CLIP_SECONDS
          if (wp.viewModel === "sniper") {
            const dur = Math.max(0.001, single.duration);
            const shootEndNorm  = clamp01(SNIPER_CLIP_SECONDS.shoot.end / dur);
            const reloadEndNorm = clamp01(SNIPER_CLIP_SECONDS.reload.end / dur);
            const idleEndNorm   = clamp01(SNIPER_CLIP_SECONDS.idle.end / dur);
            // Idle: קטע קצר מאוד בהתחלה, כמעט סטטי
            idleClip = idleClip ?? buildSubclipFromNormalizedRange(
              single,
              "idle",
              [0, idleEndNorm],
            );
            // Shoot: כל האנימציה הרלוונטית מ-0 ועד סוף טווח הירי
            shootClip = shootClip ?? buildSubclipFromNormalizedRange(
              single,
              "fire",
              [0, shootEndNorm],
            );
            // Reload: 0–3.24s
            reloadClip = reloadClip ?? buildSubclipFromNormalizedRange(
              single,
              "reload",
              [0, reloadEndNorm],
            );
          }
          if (wp.viewModel === "shotgun") {
            // Keep shotgun hands in a static hold pose between triggers.
            freezeIdlePose = true;
          }
          // For single merged clips (like "allanims"), keep animation only for explicit reload.
          if (wp.viewModel === "pistol") {
            reloadOnlyMerged = true;
            idleClip = undefined;
            shootClip = undefined;
            reloadClip = reloadClip ?? single;
          }
        }
      }

      // לסנייפר: גם אם יש קליפים מופרדים, נשמור על idle כ-pose קפוא (ללא לולאת אנימציה מתמדת)
      if (wp.viewModel === "sniper") {
        freezeIdlePose = true;
      }

      // Last-resort fallbacks so imported weapon always animates somehow.
      if (!reloadOnlyMerged) {
        idleClip = idleClip ?? clips[0];
        shootClip = shootClip ?? idleClip ?? clips[0];
        reloadClip = reloadClip ?? idleClip ?? clips[0];
      }
      if (wp.viewModel === "ak47" && reloadClip) {
        // Speed up AK magazine reload by trimming dead tail at the clip end.
        reloadClip = trimClipTailSeconds(reloadClip, "trimTailFast", 1.8) ?? reloadClip;
      }
      if (wp.viewModel === "pistol" && reloadClip) {
        // Cut the pistol reload 1.5 seconds before the original clip end.
        reloadClip = trimClipTailSeconds(reloadClip, "trimTail", 1.5) ?? reloadClip;
      }
      if (shootClip) actions.shoot = mixer.clipAction(shootClip);
      if (idleClip) actions.idle = mixer.clipAction(idleClip);
      if (reloadClip) actions.reload = mixer.clipAction(reloadClip);

      for (const name of ["shoot", "reload"] as const) {
        const action = actions[name];
        if (!action) continue;
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
      }
      const idle = actions.idle;
      if (idle) {
        if (freezeIdlePose) {
          idle.setLoop(THREE.LoopOnce, 1);
          idle.clampWhenFinished = true;
          idle.play();
          idle.time = idle.getClip().duration * 0.5;
          idle.paused = true;
          mixer.update(0);
        } else {
          idle.setLoop(THREE.LoopRepeat, Infinity);
          idle.play();
        }
      }

      g.userData.vmAnimRig = {
        mixer,
        actions,
        active: idle ? "idle" : null,
        returnToIdleAt: 0,
        freezeIdlePose,
      };
    }
    setVmPose(g, resolvedPose, wp.viewModel === "ak47");
    if (!hasEmbeddedHands) {
      // Fallback hands if a model variant was exported without visible arms.
      addSimpleHands(g, { scale: 0.82, offsetX: 0.0, offsetY: -0.01, offsetZ: 0.03 });
    }

    g.add(imported);
    vmScene.add(g);
    return g;
  }

  addSimpleHands(g);
  if (wp.viewModel === "pistol") {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.28), metalMat);
    slide.position.set(0.02, 0.03, -0.2);
    g.add(slide);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.23), darkMat);
    frame.position.set(0.02, -0.005, -0.17);
    g.add(frame);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.16, 0.13), bodyMat);
    grip.position.set(0.03, -0.12, -0.045);
    grip.rotation.x = -0.2;
    g.add(grip);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 10), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.02, 0.025, -0.39);
    g.add(barrel);
    setVmPose(g, {
      baseX: 0.24, baseY: -0.18, baseZ: -0.36, baseRotY: -0.12,
      muzzleX: 0.22, muzzleY: -0.165, muzzleZ: -0.58,
    });
  } else if (wp.viewModel === "ak47") {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.34), darkMat);
    receiver.position.set(0.01, 0.0, -0.24);
    g.add(receiver);
    const handGuard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.28), woodMat);
    handGuard.position.set(0.01, -0.015, -0.49);
    g.add(handGuard);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 12), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.01, 0.012, -0.74);
    g.add(barrel);
    const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.37, 10), metalMat);
    gasTube.rotation.x = Math.PI / 2;
    gasTube.position.set(0.01, 0.04, -0.59);
    g.add(gasTube);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.24), woodMat);
    stock.position.set(0.01, -0.02, -0.03);
    g.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.11), darkMat);
    mag.position.set(0.03, -0.12, -0.25);
    mag.rotation.x = 0.28;
    g.add(mag);
    setVmPose(g, {
      baseX: 0.225, baseY: -0.185, baseZ: -0.45, baseRotY: -0.18,
      muzzleX: 0.22, muzzleY: -0.16, muzzleZ: -0.9,
    });
  } else if (wp.viewModel === "shotgun") {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.3), darkMat);
    receiver.position.set(0.01, 0.0, -0.21);
    g.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 12), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.01, 0.02, -0.72);
    g.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.72, 10), metalMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0.01, -0.022, -0.62);
    g.add(tube);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10), woodMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0.01, -0.03, -0.48);
    g.add(pump);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.22), woodMat);
    stock.position.set(0.01, -0.03, -0.03);
    g.add(stock);
    setVmPose(g, {
      baseX: 0.23, baseY: -0.19, baseZ: -0.44, baseRotY: -0.18,
      muzzleX: 0.22, muzzleY: -0.16, muzzleZ: -0.92,
    });
  } else {
    // Sniper
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.48), darkMat);
    body.position.set(0.0, -0.005, -0.28);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.2, 12), metalMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.0, 0.016, -0.94);
    g.add(barrel);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12), metalMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0.0, 0.07, -0.38);
    g.add(scope);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.25), bodyMat);
    stock.position.set(0.0, -0.02, -0.04);
    g.add(stock);
    setVmPose(g, {
      baseX: 0.22, baseY: -0.205, baseZ: -0.52, baseRotY: -0.21,
      muzzleX: 0.22, muzzleY: -0.16, muzzleZ: -1.08,
    });
  }

  vmScene.add(g);
  return g;
}

//  Component 
export default function BitsSniperGame() {
  // ─────────────────────────────────────────────────────────────
  // Game-level singletons (state manager + event bus + settings)
  // ─────────────────────────────────────────────────────────────
  const [_gameState, setGameState] = useState<GameStateSnapshot | null>(null);
  const gameBusRef = useRef<GameEventBus | null>(null);
  const gsmRef = useRef<GameStateManager | null>(null);
  const plmRef = useRef<PointerLockManager | null>(null);
  const matchReadyDispatchedRef = useRef(false);

  if (!gameBusRef.current) {
    const initialSettings: GameSettings = loadSettingsFromStorage();
    const bus = new GameEventBus();
    const gsm = new GameStateManager(initialSettings);
    const plm = new PointerLockManager();
    plmRef.current = plm;
    gsm.subscribe((snap) => {
      setGameState(snap);
      saveSettingsToStorage(snap.settings);
      // PointerLockManager no longer syncs or drives pause by game state ID.
    });
    bus.subscribe((ev) => gsm.dispatch(ev));
    gsm.dispatch({ type: "BootCompleted" });
    gsm.dispatch({ type: "CoreAssetsLoaded" });
    gameBusRef.current = bus;
    gsmRef.current = gsm;
  }

  const gameBus = gameBusRef.current!;

  type GameRunState = "playing" | "paused";
  const [runState, setRunState] = useState<GameRunState>("playing");
  const runStateRef = useRef<GameRunState>("playing");
  const lastLockedRef = useRef(false);

  const mountRef    = useRef<HTMLDivElement|null>(null);
  const [isLocked,  setIsLocked]  = useState(false);
  const [playerHp,  setPlayerHp]  = useState(MAX_HEALTH);
  const [kills,     setKills]     = useState(0);
  const [deaths,    setDeaths]    = useState(0);
  const [ammo,      setAmmo]      = useState(WEAPONS[0].maxAmmo);
  const [maxAmmo,   setMaxAmmo]   = useState(WEAPONS[0].maxAmmo);
  const [reloading, setReloading] = useState(false);
  const [wpIdx,     setWpIdx]     = useState(0);
  const [hitFlash,  setHitFlash]  = useState(0);
  const [dead,      setDead]      = useState(false);
  const [respawnT,  setRespawnT]  = useState(0);
  const [shield,    setShield]    = useState(0);   // spawn invincibility timer
  const [hitInds,   setHitInds]   = useState<HitInd[]>([]);
  const [sessionKey,setSessionKey]= useState(0);
  const [lookSens,  setLookSens]  = useState(LOOK_SENS_BASE);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [hitMarker, setHitMarker] = useState(0);
  const stageWrapRef = useRef<HTMLDivElement|null>(null);
  const [stageSize, setStageSize] = useState<StageSize | null>(()=>getInitialStageSize());
  const [stageSizePreset, setStageSizePreset] = useState<StageSizePreset>(()=>getInitialStagePreset());
  const [stageAnchor, setStageAnchor] = useState<"left" | "right" | "center">("left");
  const isStageResizingRef = useRef(false);
  const stageResizeStopRef = useRef<(() => void) | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  /** When set, shell is position:fixed and draggable like a window. */
  const [shellPosition, setShellPosition] = useState<{ x: number; y: number } | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [introPage, setIntroPage] = useState<"basic" | "enemy">("basic");
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flatSpawnIdx, _setFlatSpawnIdx] = useState(0);
  const [botSpawnIdx, _setBotSpawnIdx] = useState(() => {
    const s = loadSettingsFromStorage();
    return typeof s.botSpawnIdx === "number" && s.botSpawnIdx >= 0 && s.botSpawnIdx <= 3 ? s.botSpawnIdx : 1;
  });
  const [botWeaponPool, setBotWeaponPool] = useState<number[]>(() => {
    const s = loadSettingsFromStorage();
    return Array.isArray(s.botWeaponPool) && s.botWeaponPool.length > 0 ? s.botWeaponPool : [0, 1, 2, 3];
  });
  /** Custom spawns from graphical map (world coords). Set when user uses SpawnSelectionMap. */
  const [customPlayerSpawn, setCustomPlayerSpawn] = useState<{ x: number; z: number } | null>(null);
  const [customEnemySpawns, setCustomEnemySpawns] = useState<SpawnPoint[]>([]);
  /** Ref set on Start Match so the game effect uses these spawns for this session. */
  const customSpawnsForSessionRef = useRef<{ player: { x: number; z: number } | null; enemies: { x: number; z: number }[] }>({ player: null, enemies: [] });
  const [adsSens, setAdsSens] = useState(1);
  const [masterVolume, setMasterVolume] = useState(1);
  const [selectedMapId, setSelectedMapId] = useState<MapId>(USE_FLAT_PLAYGROUND ? "flat" : "arena");
  const [crosshairBloom, setCrosshairBloom] = useState(0);
  /** טריגר לאפקט כיווץ/שחרור בכוונת (אקדח + AK) – מוגדר ב־performance.now() בירי */
  const [crosshairSqueezeAt, setCrosshairSqueezeAt] = useState(0);
  const setCrosshairSqueezeAtRef = useRef<(t: number) => void>(() => {});
  setCrosshairSqueezeAtRef.current = setCrosshairSqueezeAt;
  const [lowHpFx, setLowHpFx] = useState(0);
  const [isCrouching, setIsCrouching] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [roundTime, setRoundTime] = useState(MATCH_DURATION_SECS);
  const [playerCoords, setPlayerCoords] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [botPositionsForTactical, setBotPositionsForTactical] = useState<{ x: number; z: number; forwardX: number; forwardZ: number }[]>([]);
  const [tacticalMapOpen, setTacticalMapOpen] = useState(false);
  const [tacticalMapImage, setTacticalMapImage] = useState<string | null>(null);
  /** H – הצגת אווטליין של היטבוקסים (אויבים + אלמנטים של המפה) */
  const showHitboxOutlinesRef = useRef(false);
  const [_playerYaw, setPlayerYaw] = useState(0);
  const [playerForward, setPlayerForward] = useState<{ x: number; z: number }>({ x: 0, z: -1 });
  const [debugEnemyMap, setDebugEnemyMap] = useState<{
    worldX: number;
    worldZ: number;
    mapX: number;
    mapY: number;
    forwardX: number;
    forwardZ: number;
  } | null>(null);
  const [_matchEnded, setMatchEnded] = useState(false);
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);
  const sessionStartedRef = useRef(false);
  const showIntroRef = useRef(true);
  const selectedMapIdRef = useRef<MapId>(USE_FLAT_PLAYGROUND ? "flat" : "arena");
  const [fpsAssets, setFpsAssets] = useState<FpsAssetPack | null>(null);

  // Mutable state shared into RAF loop (avoids stale closures)
  const lookSensRef = useRef(LOOK_SENS_BASE);
  const adsSensRef = useRef(1);
  const masterVolRef = useRef(1);
  const st = useRef({
    hp: MAX_HEALTH, kills:0, deaths:0,
    ammo: WEAPONS[0].maxAmmo, reloading:false, wpIdx:0,
    dead:false, respawnTimer:0, fireTimer:0, reloadTimer:0,
    running:false, hitFlash:0, hitInds:[] as HitInd[],
    hitMark:0, aiming:false,
    crouching:false, sliding:false, slideTimer:0, slideCooldown:0,
    slideDirX:0, slideDirZ:0,
    roundTimer:MATCH_DURATION_SECS, matchEnded:false,
    killFeed:[] as KillFeedEntry[], killFeedSeq:0,
    lastDamageTs: 0,
    invincible: SPAWN_INVINCIBLE,
    sprayIndex: 0,
    lastShotTs: 0,
  });

  const settingsOverlayRef = useRef<HTMLDivElement | null>(null);
  const pausedAtRef = useRef(0);

  // ─────────────────────────────────────────────────────────────
  // Virtual cursor for in-pointer-lock menus (Pause on P)
  // ─────────────────────────────────────────────────────────────
  const pauseOverlayRootRef = useRef<HTMLDivElement | null>(null);
  const vCursorElRef = useRef<HTMLDivElement | null>(null);
  const vCursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const vHoveredRef = useRef<HTMLElement | null>(null);
  const inputModeRef = useRef<"game" | "menu">("game");

  const clearVirtualHover = useCallback(() => {
    const prev = vHoveredRef.current;
    if (prev) {
      prev.removeAttribute("data-vhover");
      prev.classList.remove("vcursor-hover");
    }
    vHoveredRef.current = null;
  }, []);

  const syncVirtualCursorDom = useCallback(() => {
    const el = vCursorElRef.current;
    if (!el) return;
    const { x, y } = vCursorRef.current;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }, []);

  const updateVirtualHover = useCallback(() => {
    const root = pauseOverlayRootRef.current;
    if (!root) return;

    const r = root.getBoundingClientRect();
    const { x, y } = vCursorRef.current;
    const clientX = r.left + x;
    const clientY = r.top + y;

    const under = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!under || !root.contains(under)) {
      if (vHoveredRef.current) clearVirtualHover();
      return;
    }

    const clickable = (under.closest?.("[data-vclick]") as HTMLElement | null) ?? null;

    if (vHoveredRef.current !== clickable) {
      clearVirtualHover();
      vHoveredRef.current = clickable;
      if (clickable) {
        clickable.setAttribute("data-vhover", "1");
        clickable.classList.add("vcursor-hover");
      }
    }
  }, [clearVirtualHover]);

  const centerVirtualCursor = useCallback(() => {
    const root = pauseOverlayRootRef.current;
    if (!root) return false;
    const r = root.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    vCursorRef.current.x = r.width * 0.5;
    vCursorRef.current.y = r.height * 0.5;
    syncVirtualCursorDom();
    updateVirtualHover();
    return true;
  }, [syncVirtualCursorDom, updateVirtualHover]);

  const queueCenterVirtualCursor = useCallback(() => {
    let tries = 0;
    const tick = () => {
      tries++;
      if (centerVirtualCursor()) return;
      if (tries < 3) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [centerVirtualCursor]);

  const moveVirtualCursor = useCallback((dx: number, dy: number) => {
    const root = pauseOverlayRootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;

    vCursorRef.current.x = clamp(vCursorRef.current.x + dx * VCURSOR_SENS, 0, r.width);
    vCursorRef.current.y = clamp(vCursorRef.current.y + dy * VCURSOR_SENS, 0, r.height);
    syncVirtualCursorDom();
    updateVirtualHover();
  }, [syncVirtualCursorDom, updateVirtualHover]);

  const virtualClick = useCallback(() => {
    const target = vHoveredRef.current;
    if (target) target.click();
  }, []);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  const pauseGame = useCallback((opts?: { keepLock?: boolean }) => {
    if (runStateRef.current === "paused") return;
    runStateRef.current = "paused";
    pausedAtRef.current = performance.now();
    setRunState("paused");

    const plm = plmRef.current;
    const lockedNow = !!plm && plm.isLocked();
    const keepLock = !!opts?.keepLock && lockedNow;

    inputModeRef.current = "menu";
    clearVirtualHover();

    // "Soft pause": keep pointer lock and use a virtual cursor for menu navigation.
    if (keepLock) {
      queueCenterVirtualCursor();
      return;
    }

    // "Hard pause": release pointer lock (e.g. lock lost via ESC), user navigates with real cursor.
    plm?.releaseLock();
  }, [clearVirtualHover, queueCenterVirtualCursor]);

  const resumeGame = useCallback(() => {
    if (runStateRef.current === "playing") return;

    runStateRef.current = "playing";
    setRunState("playing");

    inputModeRef.current = "game";
    clearVirtualHover();

    // If we somehow don't have pointer lock (e.g. ESC released it), request it from the Resume gesture.
    const plm = plmRef.current;
    if (plm && !plm.isLocked()) {
      plm.requestLock();
    }
  }, [clearVirtualHover]);

  /** Subscribe to pointer lock state (single source: PointerLockManager). */
  useEffect(() => {
    const plm = plmRef.current;
    if (!plm) return;
    return plm.subscribe((locked) => {
      const wasLocked = lastLockedRef.current;
      setIsLocked(locked);
      lastLockedRef.current = locked;

      if (locked) {
        sessionStartedRef.current = true;
        setSessionStarted(true);
        setShowSettings(false);
      } else if (wasLocked && runStateRef.current === "playing" && !dead) {
        pauseGame({ keepLock: false });
      }
    });
  }, [pauseGame, dead]);

  /**
   * Request pointer lock. Must be called from a user gesture (e.g. click on stage/canvas).
   * All lock/release goes through PointerLockManager.
   */
  const requestLock = useCallback(() => {
    const plm = plmRef.current;
    if (!plm) return;
    if (plm.isLocked()) {
      setShowSettings(false);
      return;
    }
    const overlay = settingsOverlayRef.current;
    if (overlay) {
      overlay.style.visibility = "hidden";
      overlay.style.pointerEvents = "none";
    }
    plm.requestLock();
  }, []);

  const toggleFullscreen = useCallback(()=>{
    const el = stageWrapRef.current;
    if(!el) return;
    if(!document.fullscreenElement){
      el.requestFullscreen?.().then(()=> setIsFullscreen(true)).catch(()=>{});
    } else {
      document.exitFullscreen?.().then(()=> setIsFullscreen(false)).catch(()=>{});
    }
  },[]);

  const applyLookSensitivity = useCallback((next: number)=>{
    const clamped = clamp(next, LOOK_SENS_MIN, LOOK_SENS_MAX);
    const snapped = Math.round(clamped / LOOK_SENS_STEP) * LOOK_SENS_STEP;
    const value = Number(snapped.toFixed(4));
    setLookSens(value);
    lookSensRef.current = value;
  },[]);

  const applyAdsSensitivity = useCallback((next: number)=>{
    const clamped = clamp(next, ADS_SENS_MIN, ADS_SENS_MAX);
    const snapped = Math.round(clamped / ADS_SENS_STEP) * ADS_SENS_STEP;
    const value = Number(snapped.toFixed(2));
    setAdsSens(value);
    adsSensRef.current = value;
  },[]);

  const applyMasterVolume = useCallback((next: number)=>{
    const clamped = clamp(next, MASTER_VOL_MIN, MASTER_VOL_MAX);
    const snapped = Math.round(clamped / MASTER_VOL_STEP) * MASTER_VOL_STEP;
    const value = Number(snapped.toFixed(2));
    setMasterVolume(value);
    masterVolRef.current = value;
  },[]);

  const applySelectedMap = useCallback((next: MapId)=>{
    setSelectedMapId(next);
    // reset asset pack so בחירת המפה תשפיע על הטעינה הבאה
    fpsAssetPackPromise = null;
  },[]);

  const applyStagePreset = useCallback((preset: Exclude<StageSizePreset, "custom">)=>{
    if(preset === "fluid"){
      setStageSize(null);
      setStageAnchor("left");
      setStageSizePreset("fluid");
      return;
    }
    setStageAnchor("left");
    setStageSize(getPresetStageSize(preset));
    setStageSizePreset(preset);
  },[]);

  const beginStageResize = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    horizontalSign = 1,
    anchor: "left" | "right" | "center" = "left",
  )=>{
    event.preventDefault();
    event.stopPropagation();
    const wrap = stageWrapRef.current;
    if(!wrap) return;
    plmRef.current?.releaseLock();
    setStageSizePreset("custom");
    const rect = wrap.getBoundingClientRect();
    const startLeft = rect.left;
    const startRight = rect.right;
    const startW = rect.width;
    const startCenterX = (rect.left + rect.right) * 0.5;
    const aspect = STAGE_ASPECT;
    const prevUserSelect = document.body.style.userSelect;
    const prevTouchAction = document.body.style.touchAction;

    isStageResizingRef.current = true;
    setStageAnchor(anchor);
    setStageSize(makeStageSize(startW, aspect));
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
    stageResizeStopRef.current?.();

    const stopResize = () => {
      isStageResizingRef.current = false;
      document.body.style.userSelect = prevUserSelect;
      document.body.style.touchAction = prevTouchAction;
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      if (stageResizeStopRef.current === stopResize) stageResizeStopRef.current = null;
    };

    const onResizeMove = (moveEvent: PointerEvent) => {
      const { minW, maxW } = getStageWidthBounds(aspect);

      let widthFromPointer: number;
      if (anchor === "center") {
        const halfW = Math.abs(moveEvent.clientX - startCenterX);
        widthFromPointer = halfW * 2;
      } else {
        widthFromPointer = horizontalSign === 1
          ? (moveEvent.clientX - startLeft)
          : (startRight - moveEvent.clientX);
      }
      const width = clamp(widthFromPointer, minW, maxW);
      setStageSize(makeStageSize(width, aspect));
    };

    stageResizeStopRef.current = stopResize;
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  },[]);

  const beginShellDrag = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = shellPosition ?? { x: rect.left, y: rect.top };
    const prevUserSelect = document.body.style.userSelect;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";

    const onMove = (moveEvent: PointerEvent) => {
      setShellPosition({
        x: startPos.x + (moveEvent.clientX - startX),
        y: startPos.y + (moveEvent.clientY - startY),
      });
    };
    const stop = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.touchAction = prevTouchAction;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, [shellPosition]);

  useEffect(()=>{
    return ()=>{
      stageResizeStopRef.current?.();
    };
  },[]);

  useEffect(()=>{
    const onViewportResize = () => {
      if(window.innerWidth < 720){
        setStageSize(null);
        setStageSizePreset("fluid");
        return;
      }
      setStageSize((prev)=>{
        if(!prev) return prev;
        const { minW, maxW } = getStageWidthBounds();
        const width = clamp(prev.width, minW, maxW);
        if(width === prev.width) return prev;
        return makeStageSize(width);
      });
    };
    onViewportResize();
    window.addEventListener("resize", onViewportResize);
    return ()=> window.removeEventListener("resize", onViewportResize);
  },[]);

  const startFreshSession = useCallback(()=>{
    matchReadyDispatchedRef.current = false;
    // מתחילים סשן חדש; אם היינו ב-Pause, נחזור למשחק ונסגור את המסכים.
    runStateRef.current = "playing";
    setRunState("playing");
    plmRef.current?.requestLock();
    gameBus.emit({ type: "Rematch" });
    sessionStartedRef.current = false;
    showIntroRef.current = true;
    setKills(0); setDeaths(0); setPlayerHp(MAX_HEALTH); setDead(false);
    setAmmo(WEAPONS[0].maxAmmo); setMaxAmmo(WEAPONS[0].maxAmmo);
    setWpIdx(0); setReloading(false); setHitFlash(0);
    setHitInds([]); setShield(0); setCrosshairBloom(0);
    setLowHpFx(0);
    setIsCrouching(false);
    setIsSliding(false);
    setRoundTime(MATCH_DURATION_SECS);
    setMatchEnded(false);
    setKillFeed([]);
    setTacticalMapImage(null);
    setShowSettings(false);
    setShowIntro(true);
    setIntroPage("basic");
    setSessionStarted(false);
    setSessionKey(k=>k+1);
  },[]);

  // טוען את ה-asset pack (מפה, מודלים וכו') רק אחרי שהשחקן סיים בחירה ולחץ Start.
  useEffect(() => {
    if (!sessionStarted || showIntro) return;
    let cancelled = false;
    void getFpsAssetPackOnce(selectedMapId)
      .then((pack) => {
        if (cancelled) return;
        setFpsAssets(pack);
      })
      .catch(() => {
        if (cancelled) return;
        setFpsAssets(EMPTY_FPS_ASSET_PACK);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionStarted, showIntro, selectedMapId]);

  useEffect(()=>{
    const onFullscreenChange = ()=> setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return ()=> document.removeEventListener("fullscreenchange", onFullscreenChange);
  },[]);

  useEffect(()=>{ sessionStartedRef.current = sessionStarted; }, [sessionStarted]);
  useEffect(()=>{ showIntroRef.current = showIntro; }, [showIntro]);
  useEffect(()=>{ selectedMapIdRef.current = selectedMapId; }, [selectedMapId]);

  // מקים את סצנת ה-THREE רק אחרי שיש assets ושאנחנו באמת במשחק (לא במסך ה-intro).
  useEffect(()=>{
    const mount = mountRef.current; if(!mount || !fpsAssets) return;
    // משתמשים בערכי ה-React state ישירות כדי שהאפקט ירוץ מחדש
    // כשנכנסים לסשן חדש מאותו מסך.
    if (!sessionStarted || showIntro) return;
    const assets = fpsAssets;
    const S = st.current;
    // reset mutable state
    Object.assign(S,{
      hp:MAX_HEALTH, kills:0, deaths:0,
      ammo:WEAPONS[0].maxAmmo, reloading:false, wpIdx:0,
      dead:false, respawnTimer:0, fireTimer:0, reloadTimer:0,
      running:false, hitFlash:0, hitInds:[], invincible:SPAWN_INVINCIBLE,
      crouching:false, sliding:false, slideTimer:0, slideCooldown:0, slideDirX:0, slideDirZ:0,
      roundTimer:MATCH_DURATION_SECS, matchEnded:false,
      killFeed:[], killFeedSeq:0,
      lastDamageTs: performance.now()/1000,
      sprayIndex: 0,
      lastShotTs: 0,
    });
    setCrosshairBloom(0);
    setLowHpFx(0);
    setIsCrouching(false);
    setIsSliding(false);
    setRoundTime(MATCH_DURATION_SECS);
    setMatchEnded(false);
    setKillFeed([]);

    //  Renderer 
    const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = POSTFX_EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    mount.appendChild(renderer.domElement);
    plmRef.current?.setCanvas(renderer.domElement);

    //  World scene 
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2("#a8d3f5", 0.0024);

    //  Camera rig 
    const camera = new THREE.PerspectiveCamera(72,1,0.05,300);
    const yawObj  = new THREE.Object3D();
    const pitchObj= new THREE.Object3D();
    pitchObj.add(camera); yawObj.add(pitchObj);
    scene.add(yawObj);
    const audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    const shotBuffer = assets.shotSoundBuffer;
    const shotAudio = shotBuffer ? new THREE.Audio(audioListener) : null;
    if (shotAudio && shotBuffer) {
      shotAudio.setBuffer(shotBuffer);
      shotAudio.setLoop(false);
      shotAudio.setVolume(0.32);
    }

    //  Cinematic post-processing chain (engine-like rendering feel) 
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      POSTFX_BLOOM_STRENGTH,
      POSTFX_BLOOM_RADIUS,
      POSTFX_BLOOM_THRESHOLD,
    );
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // Minimap camera (top-down orthographic view of the arena)
    const minimapHalf = USE_FLAT_PLAYGROUND ? FLAT_SPAWN_HALF : ARENA_HALF;
    const minimapCamera = new THREE.OrthographicCamera(
      -minimapHalf, minimapHalf,
      minimapHalf, -minimapHalf,
      0.1, 400,
    );
    minimapCamera.position.set(0, minimapHalf * 1.6, 0);
    minimapCamera.up.set(0, 0, -1);
    minimapCamera.lookAt(0, 0, 0);
    const TACTICAL_RT_SIZE = 1024;
    let tacticalRt: THREE.WebGLRenderTarget | null = null;

    //  Viewmodel (separate scene so it never clips through world) 
    const vmScene  = new THREE.Scene();
    const vmCamera = new THREE.PerspectiveCamera(60,1,0.01,10);
    vmScene.add(new THREE.AmbientLight("#ffffff",0.9));
    const vmSun = new THREE.DirectionalLight("#ffffff",0.85);
    vmSun.position.set(1,2,1); vmScene.add(vmSun);

    let vmBaseX = 0.22;
    let vmBaseY = -0.18;
    let vmBaseZ = -0.42;
    let vmBaseRotY = -0.18;
    let vmMuzzleX = 0.22;
    let vmMuzzleY = -0.165;
    let vmMuzzleZ = -0.6;
    let vmMuzzleFlash: THREE.Group | null = null;
    let vmMuzzleFlashLight: THREE.PointLight | null = null;
    let vmMuzzleFlashT = 0;
    let vmMuzzleFlashDur = 0.05;
    let vmMuzzleFlashPeak = 1.8;
    let vmCurrentFlashOffsetX = 0;
    let vmCurrentFlashOffsetY = 0;
    let vmCurrentFlashOffsetZ = 0;

    function createFallbackMuzzleFlash() {
      const root = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: "#ffcc7a",
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const planeA = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat);
      const planeB = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat.clone());
      planeB.rotation.z = Math.PI * 0.5;
      root.add(planeA, planeB);
      return root;
    }

    function styleMuzzleFlash(root: THREE.Object3D) {
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const mat = material as THREE.MeshStandardMaterial;
          mat.transparent = true;
          mat.blending = THREE.AdditiveBlending;
          mat.depthWrite = false;
          if ("opacity" in mat) mat.opacity = 0.9;
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = 2.1;
        }
      });
    }

    function updateVmMuzzleFlashPlacement() {
      if (!vmMuzzleFlash) return;
      vmMuzzleFlash.position.set(
        vmMuzzleX - vmBaseX + vmCurrentFlashOffsetX,
        vmMuzzleY - vmBaseY + vmCurrentFlashOffsetY,
        vmMuzzleZ - vmBaseZ + vmCurrentFlashOffsetZ,
      );
      vmMuzzleFlash.rotation.y = Math.PI;
    }

    function attachVmMuzzleFlash(group: THREE.Group) {
      if (!vmMuzzleFlash) {
        vmMuzzleFlash = assets.muzzleFlashTemplate
          ? (SkeletonUtils.clone(assets.muzzleFlashTemplate) as THREE.Group)
          : createFallbackMuzzleFlash();
        styleMuzzleFlash(vmMuzzleFlash);
        vmMuzzleFlash.visible = false;
        vmMuzzleFlash.scale.setScalar(0.024);
        vmMuzzleFlashLight = new THREE.PointLight("#ffc16b", 0, 2.2, 2.0);
        vmMuzzleFlashLight.position.set(0, 0, 0);
        vmMuzzleFlash.add(vmMuzzleFlashLight);
      }
      if (vmMuzzleFlash.parent) {
        vmMuzzleFlash.parent.remove(vmMuzzleFlash);
      }
      group.add(vmMuzzleFlash);
      updateVmMuzzleFlashPlacement();
    }

    function applyVmBasePose(group: THREE.Group) {
      const flashOffsetX = group.userData.vmFlashOffsetX as number | undefined;
      const flashOffsetY = group.userData.vmFlashOffsetY as number | undefined;
      const flashOffsetZ = group.userData.vmFlashOffsetZ as number | undefined;
      vmCurrentFlashOffsetX = flashOffsetX ?? 0;
      vmCurrentFlashOffsetY = flashOffsetY ?? 0;
      vmCurrentFlashOffsetZ = flashOffsetZ ?? 0;
      const pose = group.userData.vmPose as VmPose | undefined;
      if (pose) {
        vmBaseX = pose.baseX;
        vmBaseY = pose.baseY;
        vmBaseZ = pose.baseZ;
        vmBaseRotY = pose.baseRotY;
        vmMuzzleX = pose.muzzleX;
        vmMuzzleY = pose.muzzleY;
        vmMuzzleZ = pose.muzzleZ;
      }
      group.position.set(vmBaseX, vmBaseY, vmBaseZ);
      group.rotation.y = vmBaseRotY;
      updateVmMuzzleFlashPlacement();
    }

    let vmGroup = makeViewmodel(
      WEAPONS[0],
      vmScene,
      assets.weaponModels[WEAPONS[0].viewModel],
      assets.weaponModels.ak47,
    );
    applyVmBasePose(vmGroup);
    attachVmMuzzleFlash(vmGroup);
    type VmAnimRig = {
      mixer: THREE.AnimationMixer;
      actions: Partial<Record<VmAnimName, THREE.AnimationAction>>;
      active: VmAnimName | null;
      returnToIdleAt: number;
      freezeIdlePose?: boolean;
    };
    const getVmAnimRig = () => (vmGroup.userData.vmAnimRig as VmAnimRig | undefined);
    function getShotgunShellInsertDuration() {
      const clipDur = getVmAnimRig()?.actions.reload?.getClip().duration ?? 1.4;
      // Snappier per-shell insert with readable hand motion.
      return clamp(clipDur * 0.58, 0.26, 0.9);
    }
    function getEffectiveReloadDuration(wp: WeaponDef) {
      const base = wp.reloadTime;
      if (wp.viewModel === "ak47") {
        const clipDur = getVmAnimRig()?.actions.reload?.getClip().duration ?? base;
        return clamp(Math.max(base * 1.15, clipDur * 0.52), base, 3.3);
      }
      if (wp.viewModel !== "pistol") return base;
      const clipDur = getVmAnimRig()?.actions.reload?.getClip().duration ?? base;
      return clamp(Math.max(base * 1.25, clipDur * 0.5), base, 2.2);
    }
    function getShootPlaybackDuration(wp: WeaponDef) {
      if (wp.viewModel === "sniper") {
        // הארכת האנימציה הקיימת של הסנייפר כך שתתנגן יותר לאט (כ~2.0 שניות)
        const clipDur = getVmAnimRig()?.actions.shoot?.getClip().duration ?? 1.53;
        return Math.max(2.0, clipDur);
      }
      if (wp.viewModel === "shotgun") {
        const clipDur = getVmAnimRig()?.actions.shoot?.getClip().duration ?? 0.72;
        return clamp(clipDur * 0.92, 0.72, 1.28);
      }
      if (wp.viewModel !== "pistol") return undefined;
      const clipDur = getVmAnimRig()?.actions.shoot?.getClip().duration ?? 0.35;
      return clamp(clipDur * 0.78, 0.24, 0.42);
    }
    function playVmAnim(
      name: VmAnimName,
      nowSec: number,
      fadeSeconds = 0.06,
      playbackDurationSec?: number,
    ) {
      const rig = getVmAnimRig();
      if (!rig) return;

      const next = rig.actions[name];
      if (!next) return;
      const prev = rig.active ? rig.actions[rig.active] : undefined;

      if (name === "idle" && rig.freezeIdlePose) {
        if (prev && prev !== next) prev.stop();
        next.enabled = true;
        next.paused = false;
        next.reset();
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        next.setEffectiveTimeScale(1);
        next.play();
        next.time = next.getClip().duration * 0.5;
        next.paused = true;
        rig.mixer.update(0);
        rig.active = "idle";
        rig.returnToIdleAt = 0;
        return;
      }

      next.reset();
      next.enabled = true;
      next.paused = false;
      if (prev && prev !== next) {
        next.crossFadeFrom(prev, fadeSeconds, true);
      }
      const clipDuration = next.getClip().duration || 0.0001;
      if (playbackDurationSec && playbackDurationSec > 0) {
        next.setEffectiveTimeScale(clipDuration / playbackDurationSec);
      } else if (name === "shoot") {
        next.setEffectiveTimeScale(2.25);
      } else {
        next.setEffectiveTimeScale(1);
      }
      next.play();
      rig.active = name;

      if (name === "shoot" || name === "reload") {
        const animDuration = playbackDurationSec && playbackDurationSec > 0
          ? playbackDurationSec
          : clipDuration;
        rig.returnToIdleAt = nowSec + Math.max(animDuration * 0.98, 0.08);
      }
    }
    function updateVmAnim(dt: number, nowSec: number) {
      const rig = getVmAnimRig();
      if (!rig) return;
      rig.mixer.update(dt);
      if (rig.active !== "idle" && nowSec >= rig.returnToIdleAt) {
        if (rig.actions.idle) {
          playVmAnim("idle", nowSec, 0.08);
        } else {
          rig.active = null;
        }
        rig.returnToIdleAt = 0;
      }
    }

    let vmBobT=0, vmKickT=0, vmRecoilY=0, vmRecoilBack=0, vmRecoilPitch=0, vmRecoilRoll=0;
    let vmSwitchDrawT = 0;
    const VM_SWITCH_DRAW_DURATION = 0.4;
    let vmReloadT = 0;
    let vmReloadDur = getEffectiveReloadDuration(WEAPONS[0]);
    let vmReloadProfile = getReloadAnimProfile(WEAPONS[0].id);
    let vmReloadActive = false;
    let vmReloadFromEmpty = false;
    let pendingVmReload: {
      wpIdx: number;
      fromEmpty: boolean;
      triggerAt: number;
      durationSec?: number;
    } | null = null;

    function triggerReloadAnim(
      wp: WeaponDef,
      fromEmpty: boolean,
      reloadDurationSec = getEffectiveReloadDuration(wp),
      nowSec = performance.now() / 1000,
    ){
      const profile = getReloadAnimProfile(wp.id);
      vmReloadDur = Math.max(0.18, reloadDurationSec);
      vmReloadT = 0;
      vmReloadProfile = profile;
      vmReloadActive = true;
      vmReloadFromEmpty = fromEmpty;
      playVmAnim("reload", nowSec, 0.1, vmReloadDur);
    }

    //  Sunny lighting setup 
    const ambient = new THREE.AmbientLight(0xfff4d6, 0.4);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight("#fff8de", "#bcd2df", 0.36);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.00008;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -110;
    sc.right = 110;
    sc.top = 110;
    sc.bottom = -110;
    scene.add(sun);
    const bounce = new THREE.DirectionalLight("#ffe3b3", 0.28);
    bounce.position.set(-42, 36, -24);
    scene.add(bounce);

    //  Map 
    const { collidables, keyPoints, levelRoot } = buildMap(scene, assets.levelTemplate ?? null);
    if (levelRoot) levelRoot.updateMatrixWorld(true);

    //  Projectiles 
    const projectiles: Projectile[] = [];
    const projGeo = new THREE.CylinderGeometry(0.03,0.03,0.5,6);
    const projImpact = new THREE.Vector3();
    const projRay = new THREE.Ray();
    const projDir = new THREE.Vector3();
    const rayHitPoint = new THREE.Vector3();
    const rayPointTmp = new THREE.Vector3();
    const hsRayEnd = new THREE.Vector3();
    const hsTmpHit = new THREE.Vector3();
    const prStart = new THREE.Vector3();
    const prStep = new THREE.Vector3();
    const prEnd = new THREE.Vector3();
    const _botWorldPos = new THREE.Vector3();
    const _playerWorldPos = new THREE.Vector3();
    const _playerWorldQuat = new THREE.Quaternion();
    const _playerForward = new THREE.Vector3();
    const _hitIndForward = new THREE.Vector3();
    const _hitIndToEnemy = new THREE.Vector3();

    /** Hit direction indicator: angle in radians relative to camera forward (0 = enemy in front). */
    function getHitIndicatorAngle(toEnemyXZ: THREE.Vector3): number {
      _hitIndForward.set(0, 0, -1).applyEuler(new THREE.Euler(pitchObj.rotation.x, yawObj.rotation.y, 0, "YXZ"));
      _hitIndForward.y = 0;
      if (_hitIndForward.x === 0 && _hitIndForward.z === 0) return 0;
      _hitIndForward.normalize();
      const crossY = _hitIndForward.x * toEnemyXZ.z - _hitIndForward.z * toEnemyXZ.x;
      const dot = _hitIndForward.x * toEnemyXZ.x + _hitIndForward.z * toEnemyXZ.z;
      return Math.atan2(crossY, dot);
    }

    const HIT_IND_SIMILAR_ANGLE = 0.35;
    const HIT_IND_FADE_RATE = 1.8;

    function pushHitIndicator(angle: number) {
      const existing = S.hitInds.find((h) => Math.abs(h.angle - angle) < HIT_IND_SIMILAR_ANGLE);
      if (existing) {
        existing.opacity = 1;
        S.hitInds = [...S.hitInds];
      } else {
        S.hitInds = [...S.hitInds, { angle, opacity: 1 }].slice(-6);
      }
      setHitInds([...S.hitInds]);
    }

    function pushKillFeed(text: string, headshot = false){
      const entry: KillFeedEntry = {
        id: ++S.killFeedSeq,
        text,
        ttl: KILL_FEED_TTL_SECS,
        headshot,
      };
      S.killFeed = [entry, ...S.killFeed].slice(0, 5);
      setKillFeed([...S.killFeed]);
    }

    function spawnProj(
      origin: THREE.Vector3, dir: THREE.Vector3, wp: WeaponDef,
      fromBot: boolean, sourceName: string
    ){
      const mat = new THREE.MeshBasicMaterial({
        color: wp.projColor,
        transparent: true,
        opacity: 0.9,
      });
      const m   = new THREE.Mesh(projGeo,mat);
      m.position.copy(origin);
      // לייצר "טרייסר" – גליל מיושר לכיוון התנועה
      const forward = dir.clone().normalize();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), forward);
      scene.add(m);
      projectiles.push({
        mesh:m,
        vel:forward.multiplyScalar(wp.projSpeed * PROJECTILE_SPEED_MULT * wp.speedMult),
        fromBot, sourceName, damage:wp.damage, range:wp.range, traveled:0,
        splash:wp.splash, splashR:wp.splashR, splashDmg:wp.splashDmg,
      });
    }

    //  Spawns (player/CT and enemies distributed over the map) 
    let playerSpawnSeed = Math.floor(Math.random() * PLAYER_SPAWN_ZONES.length);
    let botSpawnSeed = Math.floor(Math.random() * BOT_SPAWN_ZONES.length);
    const spawnProbe = new THREE.Box3();
    const playerSpawnSize = new THREE.Vector3(PLAYER_RADIUS * 2, PLAYER_HEIGHT * 2, PLAYER_RADIUS * 2);
    const botSpawnSize = new THREE.Vector3(BOT_RADIUS * 2, BOT_HEIGHT * 2, BOT_RADIUS * 2);
    const bots: BotState[] = [];
    const lookCenter = new THREE.Vector3(0, PLAYER_HEIGHT, 0);
    const levelPlayerSpawns: THREE.Vector3[] = [];
    const levelBotSpawns: THREE.Vector3[] = [];
    const spawnRay = new THREE.Raycaster();
    const spawnRayOrigin = new THREE.Vector3();
    const spawnRayDir = new THREE.Vector3(0, -1, 0);

    function snapPlayerToSafeSpawn() {
      // ב-flat playground תמיד מצמידים למרכז ולגובה הרצפה בלי ריי-קאסטים כדי למנוע מצבים לא צפויים.
      if (USE_FLAT_PLAYGROUND) {
        yawObj.position.x = clamp(yawObj.position.x, -FLAT_SPAWN_HALF + PLAYER_RADIUS, FLAT_SPAWN_HALF - PLAYER_RADIUS);
        yawObj.position.z = clamp(yawObj.position.z, -FLAT_SPAWN_HALF + PLAYER_RADIUS, FLAT_SPAWN_HALF - PLAYER_RADIUS);
        yawObj.position.y = PLAYER_HEIGHT;
        return;
      }

      // ברירת מחדל: מצמידים לגבולות הארנה ומנסים להצמיד לגובה הרצפה של המפה.
      yawObj.position.x = clamp(yawObj.position.x, -ARENA_HALF + PLAYER_RADIUS, ARENA_HALF - PLAYER_RADIUS);
      yawObj.position.z = clamp(yawObj.position.z, -ARENA_HALF + PLAYER_RADIUS, ARENA_HALF - PLAYER_RADIUS);
      if (levelRoot) {
        spawnRayOrigin.set(yawObj.position.x, yawObj.position.y + 40, yawObj.position.z);
        spawnRay.set(spawnRayOrigin, spawnRayDir);
        const hits = spawnRay.intersectObject(levelRoot, true);
        if (hits.length > 0) {
          yawObj.position.y = hits[0].point.y + PLAYER_HEIGHT;
        } else {
          yawObj.position.y = PLAYER_HEIGHT;
        }
      } else {
        yawObj.position.y = Math.max(yawObj.position.y, PLAYER_HEIGHT);
      }
    }

    function overlapsCollidable(pos: THREE.Vector3, size: THREE.Vector3) {
      spawnProbe.setFromCenterAndSize(pos, size);
      for (const box of collidables) {
        if (spawnProbe.intersectsBox(box)) return true;
      }
      return false;
    }

    function buildDynamicLevelSpawns() {
      if (USE_FLAT_PLAYGROUND) return;
      if (!levelRoot) return;
      const bounds = getObjectBounds(levelRoot);
      if (!bounds) return;

      const insetX = Math.max(2.2, bounds.size.x * 0.06);
      const insetZ = Math.max(2.2, bounds.size.z * 0.06);
      const fromY = bounds.max.y + Math.max(18, bounds.size.y * 0.35);
      const groundSamples: THREE.Vector3[] = [];

      for (let i = 0; i < 520 && groundSamples.length < 140; i++) {
        const x = rng(bounds.min.x + insetX, bounds.max.x - insetX);
        const z = rng(bounds.min.z + insetZ, bounds.max.z - insetZ);
        spawnRayOrigin.set(x, fromY, z);
        spawnRay.set(spawnRayOrigin, spawnRayDir);
        const hits = spawnRay.intersectObject(levelRoot, true);
        const hit = hits.find((h) => !!h.face && h.face.normal.y > 0.42);
        if (!hit) continue;

        const p = hit.point;
        if (p.y < bounds.min.y + 0.04) continue;
        if (groundSamples.some((s) => {
          const dx = s.x - p.x;
          const dz = s.z - p.z;
          return dx * dx + dz * dz < 20;
        })) continue;

        const candidatePlayer = new THREE.Vector3(p.x, p.y + PLAYER_HEIGHT + 0.04, p.z);
        if (overlapsCollidable(candidatePlayer, playerSpawnSize)) continue;
        groundSamples.push(new THREE.Vector3(p.x, p.y, p.z));
      }

      if (groundSamples.length < 6) {
        // Flat playground: ensure we always have spawn points (raycast can miss on first frames)
        const rootName = (levelRoot as THREE.Group).name || "";
        if (rootName === "flat_playground" && bounds) {
          const step = Math.max(8, Math.min(20, bounds.size.x * 0.12));
          const floorY = bounds.min.y + 0.6;
          for (let gx = bounds.min.x + step; gx <= bounds.max.x - step; gx += step) {
            for (let gz = bounds.min.z + step; gz <= bounds.max.z - step; gz += step) {
              groundSamples.push(new THREE.Vector3(gx, floorY, gz));
              if (groundSamples.length >= 60) break;
            }
            if (groundSamples.length >= 60) break;
          }
        }
        if (groundSamples.length < 6) return;
      }

      const sortedByX = [...groundSamples].sort((a, b) => a.x - b.x);
      const edgeCount = Math.max(3, Math.floor(sortedByX.length * 0.2));
      const leftEdge = sortedByX.slice(0, edgeCount);
      const rightEdge = sortedByX.slice(sortedByX.length - edgeCount);

      for (const p of rightEdge) {
        if (levelPlayerSpawns.length >= 10) break;
        const spawnPos = new THREE.Vector3(p.x, p.y + PLAYER_HEIGHT + 0.04, p.z);
        if (overlapsCollidable(spawnPos, playerSpawnSize)) continue;
        levelPlayerSpawns.push(spawnPos);
      }

      for (const p of leftEdge) {
        if (levelBotSpawns.length >= 16) break;
        const spawnPos = new THREE.Vector3(p.x, p.y + BOT_HEIGHT + 0.03, p.z);
        if (overlapsCollidable(spawnPos, botSpawnSize)) continue;
        levelBotSpawns.push(spawnPos);
      }

      if (levelBotSpawns.length < 8) {
        const backupBand = sortedByX.slice(0, Math.max(edgeCount + 8, Math.floor(sortedByX.length * 0.45)));
        for (const p of backupBand) {
          if (levelBotSpawns.length >= 16) break;
          const spawnPos = new THREE.Vector3(p.x, p.y + BOT_HEIGHT + 0.03, p.z);
          if (overlapsCollidable(spawnPos, botSpawnSize)) continue;
          if (levelBotSpawns.some((s) => s.distanceToSquared(spawnPos) < 9)) continue;
          levelBotSpawns.push(spawnPos);
        }
      }
    }
    buildDynamicLevelSpawns();

    const customSpawns = customSpawnsForSessionRef.current;
    if (customSpawns.enemies?.length) {
      levelBotSpawns.length = 0;
      customSpawns.enemies.forEach(({ x, z }) => levelBotSpawns.push(new THREE.Vector3(x, BOT_HEIGHT, z)));
    }
    if (customSpawns.player) {
      levelPlayerSpawns.length = 0;
      levelPlayerSpawns.push(new THREE.Vector3(customSpawns.player.x, PLAYER_HEIGHT, customSpawns.player.z));
    }

    function captureTopDownMapSnapshot(): string | null {
      if (!renderer || !scene || !minimapCamera) return null;

      if (!tacticalRt) {
        tacticalRt = new THREE.WebGLRenderTarget(
          TACTICAL_RT_SIZE,
          TACTICAL_RT_SIZE,
          { samples: 1 },
        );
      }

      // Hide dynamic actors (player rig + bots) for the snapshot.
      const oldYawVisible = yawObj.visible;
      yawObj.visible = false;
      const botOldVisible: boolean[] = [];
      for (let i = 0; i < bots.length; i++) {
        botOldVisible[i] = bots[i].mesh.visible;
        bots[i].mesh.visible = false;
      }

      const oldTarget = renderer.getRenderTarget();
      const oldClearColor = renderer.getClearColor(new THREE.Color());
      const oldClearAlpha = renderer.getClearAlpha();

      renderer.setRenderTarget(tacticalRt);
      renderer.setClearColor(new THREE.Color("#050811"), 1);
      renderer.clear(true, true, true);
      renderer.render(scene, minimapCamera);
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(oldClearColor, oldClearAlpha);

      // Restore visibility
      yawObj.visible = oldYawVisible;
      for (let i = 0; i < bots.length; i++) {
        bots[i].mesh.visible = botOldVisible[i];
      }

      // Read back pixels into a canvas and convert to data URL
      const pixels = new Uint8Array(TACTICAL_RT_SIZE * TACTICAL_RT_SIZE * 4);
      renderer.readRenderTargetPixels(
        tacticalRt,
        0, 0,
        TACTICAL_RT_SIZE,
        TACTICAL_RT_SIZE,
        pixels,
      );

      const canvas = document.createElement("canvas");
      canvas.width = TACTICAL_RT_SIZE;
      canvas.height = TACTICAL_RT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const imageData = new ImageData(
        new Uint8ClampedArray(pixels.buffer),
        TACTICAL_RT_SIZE,
        TACTICAL_RT_SIZE,
      );
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    }

    // Capture tactical map snapshot once after map and spawns are ready.
    {
      const snapshot = captureTopDownMapSnapshot();
      if (snapshot) setTacticalMapImage(snapshot);
    }

    function getFloorY(x: number, z: number): number {
      let top = 0;
      for (const box of collidables) {
        if (x >= box.min.x - 0.1 && x <= box.max.x + 0.1 && z >= box.min.z - 0.1 && z <= box.max.z + 0.1) {
          if (box.max.y > top) top = box.max.y;
        }
      }
      return top;
    }

    const spawnVisualGroup = createSpawnVisualGroup(
      levelPlayerSpawns,
      levelBotSpawns,
      getFloorY,
      { debug: typeof import.meta !== "undefined" && import.meta.env?.DEV }
    );
    scene.add(spawnVisualGroup);

    const BOT_FIXED_SPAWN    = new THREE.Vector3( 10, BOT_HEIGHT, 0);
    const PLAYER_FLAT_SPAWNS: THREE.Vector3[] = [
      new THREE.Vector3(-10, PLAYER_HEIGHT,   0),
      new THREE.Vector3( 10, PLAYER_HEIGHT,   0),
      new THREE.Vector3(  0, PLAYER_HEIGHT,  12),
      new THREE.Vector3(  0, PLAYER_HEIGHT, -12),
    ];
    const BOT_FLAT_SPAWNS: THREE.Vector3[] = [
      new THREE.Vector3( 14, BOT_HEIGHT,   6),
      new THREE.Vector3( 14, BOT_HEIGHT, -6),
      new THREE.Vector3(-14, BOT_HEIGHT,  10),
      new THREE.Vector3(-14, BOT_HEIGHT, -10),
    ];

    function pickFlatPlayerSpawn(): THREE.Vector3 {
      const idx = Math.max(0, Math.min(flatSpawnIdx, PLAYER_FLAT_SPAWNS.length - 1));
      return PLAYER_FLAT_SPAWNS[idx].clone();
    }
    /** Chosen player spawn: from levelPlayerSpawns (custom or level) when set, else fallback to pickFlatPlayerSpawn. Never overrides user choice. */
    function getChosenPlayerSpawnPosition(): THREE.Vector3 {
      if (levelPlayerSpawns.length > 0) return levelPlayerSpawns[0].clone();
      return pickFlatPlayerSpawn();
    }
    function pickFlatBotSpawn(): THREE.Vector3 {
      const list = BOT_FLAT_SPAWNS.length ? BOT_FLAT_SPAWNS : [BOT_FIXED_SPAWN];
      const idx = Math.max(0, Math.min(botSpawnIdx, list.length - 1));
      return list[idx].clone();
    }

    if (USE_FLAT_PLAYGROUND) {
      // בפלט־ורלד: אם יש Spawn מותאם אישית – נשתמש בו, אחרת נשתמש בספאון שנבחר (levelPlayerSpawns/דיפולט).
      const custom = customSpawnsForSessionRef.current;
      const initialSafe = custom.player
        ? new THREE.Vector3(custom.player.x, PLAYER_HEIGHT, custom.player.z)
        : getChosenPlayerSpawnPosition();
      yawObj.position.copy(initialSafe);
      snapPlayerToSafeSpawn();
    } else {
      yawObj.position.copy(pickInitialPlayerSpawn());
      snapPlayerToSafeSpawn();
    }
    // Raise initial spawn slightly so the player appears above the ring
    yawObj.position.y += PLAYER_SPAWN_LIFT;

    function getPlayerSpawnCandidate(idx: number): THREE.Vector3 {
      if (levelPlayerSpawns.length > 0) {
        return levelPlayerSpawns[idx % levelPlayerSpawns.length].clone();
      }
      if (USE_FLAT_PLAYGROUND) {
        return pickFlatPlayerSpawn();
      }
      const fallback = new THREE.Vector3(
        rng(-FLAT_SPAWN_HALF, FLAT_SPAWN_HALF),
        PLAYER_HEIGHT,
        rng(-FLAT_SPAWN_HALF, FLAT_SPAWN_HALF),
      );
      return fallback;
    }

    function getBotSpawnCandidate(idx: number): THREE.Vector3 {
      if (levelBotSpawns.length > 0) {
        return levelBotSpawns[idx % levelBotSpawns.length].clone();
      }
      if (USE_FLAT_PLAYGROUND) {
        return pickFlatBotSpawn();
      }
      const fallback = new THREE.Vector3(
        rng(-FLAT_SPAWN_HALF, FLAT_SPAWN_HALF),
        BOT_HEIGHT,
        rng(-FLAT_SPAWN_HALF, FLAT_SPAWN_HALF),
      );
      return fallback;
    }

    function facePlayerTowardCenter() {
      const toMid = lookCenter.clone().sub(yawObj.position);
      yawObj.rotation.y = Math.atan2(toMid.x, toMid.z);
      pitchObj.rotation.x = 0;
    }

    function pickInitialPlayerSpawn(): THREE.Vector3 {
      if (USE_FLAT_PLAYGROUND) {
        // בפלייגראונד – ספאון ראשוני זהה למה שנחשב כ-\"chosen\" (כולל Spawn מותאם אישית אם הוגדר).
        return getChosenPlayerSpawnPosition();
      }
      let fallback = getPlayerSpawnCandidate(playerSpawnSeed);
      for (let i = 0; i < 48; i++) {
        const idx = playerSpawnSeed + i;
        const candidate = getPlayerSpawnCandidate(idx);
        if (overlapsCollidable(candidate, playerSpawnSize)) continue;
        if (levelPlayerSpawns.length > 0) {
          playerSpawnSeed = idx % levelPlayerSpawns.length;
        } else {
          playerSpawnSeed = idx % PLAYER_SPAWN_ZONES.length;
        }
        return candidate;
      }
      if (overlapsCollidable(fallback, playerSpawnSize)) {
        if (levelPlayerSpawns.length > 0) fallback.copy(levelPlayerSpawns[0]); else fallback.set(0, PLAYER_HEIGHT, 0);
      }
      fallback.x = clamp(fallback.x, -FLAT_SPAWN_HALF, FLAT_SPAWN_HALF);
      fallback.z = clamp(fallback.z, -FLAT_SPAWN_HALF, FLAT_SPAWN_HALF);
      return fallback;
    }

    function pickPlayerSpawn(): THREE.Vector3 {
      if (USE_FLAT_PLAYGROUND) {
        if (levelPlayerSpawns.length > 0) return getPlayerSpawnCandidate(playerSpawnSeed);
        return pickFlatPlayerSpawn();
      }
      if (levelPlayerSpawns.length > 0) {
        playerSpawnSeed = (playerSpawnSeed + 1) % levelPlayerSpawns.length;
      } else {
        playerSpawnSeed = (playerSpawnSeed + 1) % PLAYER_SPAWN_ZONES.length;
      }
      let best = getPlayerSpawnCandidate(playerSpawnSeed);
      let bestScore = -Infinity;
      const avoidBots = bots.filter((b)=>!b.dead).map((b)=>b.mesh.position);
      for(let i=0;i<52;i++){
        const idx = playerSpawnSeed + i;
        const candidate = getPlayerSpawnCandidate(idx);
        if (overlapsCollidable(candidate, playerSpawnSize)) continue;

        let nearestBot = Infinity;
        for (const p of avoidBots) nearestBot = Math.min(nearestBot, candidate.distanceTo(p));
        if (nearestBot >= 18) {
          if (levelPlayerSpawns.length > 0) {
            playerSpawnSeed = idx % levelPlayerSpawns.length;
          } else {
            playerSpawnSeed = idx % PLAYER_SPAWN_ZONES.length;
          }
          return candidate;
        }
        if (nearestBot > bestScore) {
          bestScore = nearestBot;
          best = candidate;
        }
      }
      return best;
    }

    function pickBotSpawn(botId:number): THREE.Vector3 {
      const otherBots = bots.filter((b)=>!b.dead && b.id!==botId).map((b)=>b.mesh.position);
      let best = getBotSpawnCandidate(botSpawnSeed);
      let bestScore = -Infinity;

      for(let i=0;i<52;i++){
        const idx = botSpawnSeed + botId + i;
        const candidate = getBotSpawnCandidate(idx);
        if (overlapsCollidable(candidate, botSpawnSize)) continue;
        const playerDist = candidate.distanceTo(yawObj.position);
        let nearestBot = Infinity;
        for(const p of otherBots) nearestBot = Math.min(nearestBot, candidate.distanceTo(p));

        if(playerDist >= 24 && nearestBot >= 10){
          if (levelBotSpawns.length > 0) {
            botSpawnSeed = (idx + 1) % levelBotSpawns.length;
          } else {
            botSpawnSeed = (idx + 1) % BOT_SPAWN_ZONES.length;
          }
          return candidate;
        }

        const score = Math.min(playerDist * 0.8, nearestBot);
        if(score > bestScore){
          bestScore = score;
          best = candidate;
        }
      }
      if (levelBotSpawns.length > 0) {
        botSpawnSeed = (botSpawnSeed + 1) % levelBotSpawns.length;
      } else {
        botSpawnSeed = (botSpawnSeed + 1) % BOT_SPAWN_ZONES.length;
      }
      return best;
    }

    const botCollideProbe = new THREE.Box3();
    const botCollidePos = new THREE.Vector3();
    const botCollideSize = new THREE.Vector3(BOT_RADIUS * 2, BOT_HEIGHT * 2, BOT_RADIUS * 2);
    function botCollidesAt(x:number, y:number, z:number){
      botCollidePos.set(x, y, z);
      botCollideProbe.setFromCenterAndSize(botCollidePos, botCollideSize);
      const feet = y - BOT_HEIGHT;
      const head = y + BOT_HEIGHT;
      for(const box of collidables){
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(botCollideProbe.intersectsBox(box)) return true;
      }
      return false;
    }

    function getBotGroundY(x:number, z:number, currentY:number){
      let best = BOT_HEIGHT;
      const feet = currentY - BOT_HEIGHT;
      for(const box of collidables){
        const withinX = x >= box.min.x - BOT_RADIUS*0.6 && x <= box.max.x + BOT_RADIUS*0.6;
        const withinZ = z >= box.min.z - BOT_RADIUS*0.6 && z <= box.max.z + BOT_RADIUS*0.6;
        if(!withinX || !withinZ) continue;

        const topY = box.max.y + BOT_HEIGHT;
        const canStepUp = topY <= currentY + 1.6;
        const notHugeDrop = topY >= feet - 4.2;
        if(canStepUp && notHugeDrop && topY > best){
          best = topY;
        }
      }
      return best;
    }

    facePlayerTowardCenter();

    //  Bots 
    const botAnimKeys: BotAnimName[] = ["idle", "walk", "run", "attack", "die"];
    function bindBotAnimationRig(mesh: THREE.Group) {
      const mutantRoot = mesh.userData.mutantRoot as THREE.Object3D | undefined;
      if (!mutantRoot) return {};

      const mixer = new THREE.AnimationMixer(mutantRoot);
      const animActions: Partial<Record<BotAnimName, THREE.AnimationAction>> = {};
      for (const key of botAnimKeys) {
        const clip = assets.mutantAnims[key];
        if (!clip) continue;
        animActions[key] = mixer.clipAction(clip);
      }

      let activeAnim: BotAnimName | undefined;
      const idleAction = animActions.idle ?? animActions.walk ?? animActions.run;
      if (idleAction) {
        idleAction.reset();
        idleAction.play();
        activeAnim = animActions.idle ? "idle" : animActions.walk ? "walk" : "run";
      }

      return { mixer, animActions, activeAnim };
    }

    function setBotAnimState(bot: BotState, next: BotAnimName, fadeSeconds = 0.16) {
      const actions = bot.animActions;
      if (!actions || bot.activeAnim === next) return;

      let nextAction = actions[next];
      if (!nextAction) {
        nextAction = actions.run ?? actions.walk ?? actions.idle;
        if (!nextAction) return;
      }

      const prevAction = bot.activeAnim ? actions[bot.activeAnim] : undefined;
      nextAction.reset();
      nextAction.enabled = true;
      nextAction.clampWhenFinished = false;
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
      if (prevAction && prevAction !== nextAction) {
        nextAction.crossFadeFrom(prevAction, fadeSeconds, true);
      }
      nextAction.play();
      bot.activeAnim = next;
    }

    const weaponPool = Array.isArray(botWeaponPool) && botWeaponPool.length > 0 ? botWeaponPool : [0, 1, 2, 3];
    for(let i=0;i<BOT_COUNT;i++){
      const mesh = makeBotMesh(BOT_COLORS[i%BOT_COLORS.length], null);
      mesh.position.copy(pickBotSpawn(i));
      mesh.position.y = getBotGroundY(mesh.position.x, mesh.position.z, mesh.position.y);
      scene.add(mesh);
      const wIdx = weaponPool[Math.floor(Math.random() * weaponPool.length)];
      const botLabel = BOT_NAMES[i%BOT_NAMES.length];
      updateBotHpLabel(mesh, botLabel, BOT_MAX_HEALTH);
      const bot: BotState = {
        id:i, mesh, health:BOT_MAX_HEALTH, dead:false, respawnTimer:0,
        velY:0, velX:0, velZ:0, onGround:true,
        yaw:Math.random()*Math.PI*2, targetYaw:0,
        wpIdx:wIdx,
        fireTimer:Math.random()*2,
        strafeDir:Math.random()<0.5?1:-1, strafeTimer:rng(0.5,1.8),
        reloadTimer:0, ammo:WEAPONS[wIdx].maxAmmo,
        label:botLabel, lastHudHealth:BOT_MAX_HEALTH,
        animTime:rng(0,Math.PI*2), animPhase:rng(0,Math.PI*2),
      };
      Object.assign(bot, bindBotAnimationRig(mesh));
      bots.push(bot);
    }

    //  Hitbox outline overlay (H) – אווטליין היטבוקסים לאויבים ואלמנטי מפה
    const outlineGroup = new THREE.Group();
    outlineGroup.visible = false;
    const botOutlineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false });
    const mapOutlineMat = new THREE.LineBasicMaterial({ color: 0xff8822, depthTest: false });
    const botOutlineMeshes: THREE.LineSegments[] = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const capGeo = new THREE.CylinderGeometry(BOT_RADIUS, BOT_RADIUS, BOT_HEIGHT * 2, 12);
      const edgeGeo = new THREE.EdgesGeometry(capGeo);
      capGeo.dispose();
      const line = new THREE.LineSegments(edgeGeo, botOutlineMat.clone());
      outlineGroup.add(line);
      botOutlineMeshes.push(line);
    }
    const boxSize = new THREE.Vector3();
    const boxCenter = new THREE.Vector3();
    for (const box of collidables) {
      box.getSize(boxSize);
      box.getCenter(boxCenter);
      const g = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const eg = new THREE.EdgesGeometry(g);
      g.dispose();
      const line = new THREE.LineSegments(eg, mapOutlineMat.clone());
      line.position.copy(boxCenter);
      outlineGroup.add(line);
    }
    const keyPointOutlineMat = new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false });
    for (const kp of keyPoints) {
      const sg = new THREE.SphereGeometry(kp.radius, 10, 8);
      const seg = new THREE.EdgesGeometry(sg);
      sg.dispose();
      const line = new THREE.LineSegments(seg, keyPointOutlineMat.clone());
      line.position.copy(kp.position);
      outlineGroup.add(line);
    }
    scene.add(outlineGroup);

    //  Player actions 
    function traceWorldHitDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number){
      let best = maxDist;
      projRay.set(origin, dir);
      for(const box of collidables){
        const wallHit = projRay.intersectBox(box, rayPointTmp);
        if(!wallHit) continue;
        const dist = wallHit.distanceTo(origin);
        if(dist < best) best = dist;
      }
      return best;
    }
    function hitBotByRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, wp: WeaponDef){
      let bestDist = maxDist;
      let bestBot: BotState | null = null;
      let headshot = false;

      hsRayEnd.copy(dir).multiplyScalar(maxDist).add(origin);

      for(const bot of bots){
        if(bot.dead) continue;

        const hit = segmentHitsCapsule(origin, hsRayEnd, bot.mesh.position, BOT_HEIGHT, BOT_RADIUS + 0.05, hsTmpHit);
        if(!hit.hit) continue;

        const tDist = hit.segS * maxDist;
        if(tDist <= 0 || tDist >= bestDist) continue;

        bestDist = tDist;
        bestBot = bot;
        rayHitPoint.copy(hsTmpHit);

        // Headshots are the top ~30% of the capsule axis.
        headshot = hit.axisT >= 0.70 || rayHitPoint.y > bot.mesh.position.y + BOT_HEAD_Y_OFFSET;
      }

      if(!bestBot) return false;

      const damage = wp.damage * (headshot ? HEADSHOT_MULT : 1);
      bestBot.health -= damage;
      S.hitMark = 1;
      setHitMarker(1);
      if(bestBot.health <= 0){
        bestBot.health = 0;
        bestBot.dead = true;
        bestBot.mesh.visible = false;
        bestBot.respawnTimer = RESPAWN_SECS;
        S.kills++;
        setKills(S.kills);
        pushKillFeed(`You eliminated ${bestBot.label}${headshot ? " (Headshot)" : ""}`, headshot);
      }

      return true;
    }

    function hitPlayerByRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, sourceName: string, wp: WeaponDef){
      if(S.dead || S.invincible > 0) return false;

      hsRayEnd.copy(dir).multiplyScalar(maxDist).add(origin);

      const hit = segmentHitsCapsule(origin, hsRayEnd, yawObj.position, PLAYER_HEIGHT, PLAYER_RADIUS + 0.06, hsTmpHit);
      if(!hit.hit) return false;

      rayHitPoint.copy(hsTmpHit);

      S.hp -= wp.damage;
      S.hitFlash = 1;
      S.lastDamageTs = performance.now()/1000;

      _hitIndToEnemy.copy(origin).sub(yawObj.position);
      _hitIndToEnemy.y = 0;
      if (_hitIndToEnemy.x !== 0 || _hitIndToEnemy.z !== 0) {
        _hitIndToEnemy.normalize();
        pushHitIndicator(getHitIndicatorAngle(_hitIndToEnemy));
      }
      setHitFlash(1);

      if(S.hp <= 0){
        killPlayer(sourceName);
      } else {
        setPlayerHp(Math.max(0, S.hp));
      }
      return true;
    }

    function doHitscan(origin: THREE.Vector3, dir: THREE.Vector3, wp: WeaponDef, fromBot: boolean, sourceName: string){
      const maxDist = traceWorldHitDistance(origin, dir, wp.range);
      if(fromBot){
        return hitPlayerByRay(origin, dir, maxDist, sourceName, wp);
      }
      return hitBotByRay(origin, dir, maxDist, wp);
    }

    const keys: Record<string,boolean> = {};
    let rightMouseHeld = false;
    let sniperAimLockUntil = 0;
    const playerAmmoByWeapon = WEAPONS.map((wp)=>wp.maxAmmo);
    let velX = 0, velY = 0, velZ = 0, onGround = USE_FLAT_PLAYGROUND;
    let flyMode = false;
    let recoilBloom = 0;
    let crossBloom = 0;
    let coyoteTimer = 0;
    let jumpBufferTimer = 0;
    let headBobT = 0;
    let headBobY = 0;
    let headBobX = 0;
    let landingKick = 0;
    let crouchLerp = 0;

    function triggerKeyPoint(point: MapKeyPoint, nowSec: number) {
      let activated = false;
      if (point.kind === "heal") {
        const nextHp = Math.min(MAX_HEALTH, S.hp + 38);
        if (nextHp > S.hp + 0.01) {
          S.hp = nextHp;
          setPlayerHp(Math.max(0, Math.round(S.hp)));
          activated = true;
          pushKillFeed("Keypoint: +HP");
        }
      } else if (point.kind === "ammo") {
        const wp = WEAPONS[S.wpIdx];
        const refill = Math.max(1, Math.ceil(wp.maxAmmo * 0.55));
        const nextAmmo = Math.min(wp.maxAmmo, S.ammo + refill);
        if (nextAmmo > S.ammo) {
          S.ammo = nextAmmo;
          playerAmmoByWeapon[S.wpIdx] = S.ammo;
          setAmmo(S.ammo);
          activated = true;
          pushKillFeed("Keypoint: +Ammo");
        }
      } else if (point.kind === "shield") {
        const before = S.invincible;
        S.invincible = Math.max(S.invincible, 3.2);
        if (S.invincible > before + 0.02) {
          setShield(S.invincible);
          activated = true;
          pushKillFeed("Keypoint: Shield 3.2s");
        }
      }

      point.nextReadyAt = nowSec + (activated ? point.cooldown : 0.8);
    }

    function updateKeyPoints(nowSec: number, dt: number) {
      if (keyPoints.length === 0) return;
      for (const point of keyPoints) {
        point.pulse += dt * 2.2;
        const pulse = 0.5 + Math.sin(point.pulse) * 0.5;
        const ready = nowSec >= point.nextReadyAt;
        point.marker.position.y = point.position.y + 0.02 + pulse * 0.11;
        point.marker.rotation.y += dt * 0.85;
        point.light.intensity = ready ? 0.66 + pulse * 0.52 : 0.18 + pulse * 0.08;
        point.coreMat.emissiveIntensity += ((ready ? 0.78 + pulse * 0.35 : 0.2) - point.coreMat.emissiveIntensity) * Math.min(1, dt * 10);
        point.ringMat.emissiveIntensity += ((ready ? 0.58 + pulse * 0.36 : 0.14) - point.ringMat.emissiveIntensity) * Math.min(1, dt * 10);
        if (!ready) continue;
        const dx = yawObj.position.x - point.position.x;
        const dz = yawObj.position.z - point.position.z;
        if (dx * dx + dz * dz <= point.radius * point.radius) {
          triggerKeyPoint(point, nowSec);
        }
      }
    }

    function doFire(){
      if(S.dead) return;
      const now = performance.now()/1000;
      const wp  = WEAPONS[S.wpIdx];
      const isPistolVm = wp.viewModel === "pistol";
      const isShotgunVm = wp.viewModel === "shotgun";
      const isSniperVm = wp.viewModel === "sniper";
      if(S.reloading){
        if(isShotgunVm && S.ammo > 0){
          // Shotgun-style tactical interrupt: fire cancels per-shell reload.
          S.reloading = false;
          S.reloadTimer = 0;
          pendingVmReload = null;
          vmReloadActive = false;
          setReloading(false);
        } else {
          return;
        }
      }
      if(S.ammo<=0) return;
      const shootPlaybackDuration = getShootPlaybackDuration(wp);
      const useFireCooldown = !isPistolVm;
      if(useFireCooldown){
        if(S.fireTimer > now) return;
        const baseInterval = 1 / wp.fireRate;
        const animInterval = (isShotgunVm && shootPlaybackDuration)
          ? shootPlaybackDuration * 0.95
          : (isSniperVm && shootPlaybackDuration ? shootPlaybackDuration : 0);
        S.fireTimer = now + Math.max(baseInterval, animInterval);
      }
      S.ammo = Math.max(0, S.ammo-1);
      playerAmmoByWeapon[S.wpIdx] = S.ammo;
      setAmmo(S.ammo);
      // Sniper: יוצא ממצב כוונת בזמן הירייה עד סוף האנימציה
      if (isSniperVm) {
        S.aiming = false;
        setIsAiming(false);
        const fallbackShootWindow = Math.max(0.12, 1 / Math.max(0.001, wp.fireRate) * 0.85);
        const shootWindow = shootPlaybackDuration ?? fallbackShootWindow;
        sniperAimLockUntil = now + shootWindow;
      }
      if(S.ammo===0){
        const fallbackShootWindow = Math.max(0.12, 1 / Math.max(0.001, wp.fireRate) * 0.85);
        const shootWindow = shootPlaybackDuration ?? fallbackShootWindow;
        const delay = clamp(shootWindow * 0.92, 0.08, 0.95);
        if(isShotgunVm){
          const shellDuration = getShotgunShellInsertDuration();
          S.reloading=true;
          // First shell insert starts only after shoot cycle finishes.
          S.reloadTimer = now + delay + shellDuration;
          setReloading(true);
          pendingVmReload = {
            wpIdx: S.wpIdx,
            fromEmpty: true,
            triggerAt: now + delay,
            durationSec: shellDuration,
          };
        } else {
          let reloadDuration = getEffectiveReloadDuration(wp);
          if (isSniperVm) {
            // רילואד מלא של סנייפר – ארוך ואיטי יותר
            const clipDur = getVmAnimRig()?.actions.reload?.getClip().duration ?? reloadDuration;
            reloadDuration = clamp(Math.max(reloadDuration * 1.5, clipDur * 1.1), reloadDuration, 4.2);
          }
          S.reloading=true; S.reloadTimer=now+reloadDuration; setReloading(true);
          pendingVmReload = { wpIdx: S.wpIdx, fromEmpty: true, triggerAt: now + delay, durationSec: reloadDuration };
        }
      }
      // --- CS-style deterministic recoil state ---------------------------------
      const timeSinceLastShot = now - (S.lastShotTs || 0);
      if (timeSinceLastShot > RECOIL_RESET_SECS) {
        S.sprayIndex = 0;
      }
      const pattern = RECOIL_PATTERNS[wp.id] ?? RECOIL_PATTERNS.rifle;
      const patternIdx = Math.min(S.sprayIndex, pattern.length - 1);
      const recoilStep = pattern[patternIdx] ?? { yaw: 0, pitch: 0 };
      S.sprayIndex = Math.min(S.sprayIndex + 1, pattern.length - 1);
      S.lastShotTs = now;
      if (isPistolVm || wp.viewModel === "ak47") setCrosshairSqueezeAtRef.current(performance.now());

      vmKickT = isPistolVm ? 0.2 : isShotgunVm ? 0.24 : isSniperVm ? 0.32 : 0.14;   // trigger viewmodel recoil kick
      // Recoil animation steps – מחוזק במיוחד עבור הסנייפר (אנימציה בלבד, לא פיזיקה/פגיעה)
      const recoilBackStep = isPistolVm ? 0.046 : isShotgunVm ? 0.072 : isSniperVm ? 0.12 : 0.024;
      const recoilPitchStep = isPistolVm ? 0.1 : isShotgunVm ? 0.155 : isSniperVm ? 0.26 : 0.055;
      const recoilRollStep = isPistolVm ? 0.095 : isShotgunVm ? 0.12 : isSniperVm ? 0.11 : 0.05;
      const recoilBackCap = isShotgunVm ? 0.16 : isSniperVm ? 0.22 : 0.11;
      const recoilPitchCap = isShotgunVm ? 0.36 : isSniperVm ? 0.6 : 0.28;
      vmRecoilBack = clamp(vmRecoilBack + recoilBackStep, 0, recoilBackCap);
      vmRecoilPitch = clamp(vmRecoilPitch + recoilPitchStep, 0, recoilPitchCap);
      vmRecoilRoll = clamp(
        vmRecoilRoll + (Math.random() - 0.5) * recoilRollStep,
        -0.2,
        0.2,
      );
      vmMuzzleFlashDur = isPistolVm ? 0.062 : isShotgunVm ? 0.072 : isSniperVm ? 0.064 : 0.045;
      vmMuzzleFlashPeak = isPistolVm ? 2.45 : isShotgunVm ? 3.1 : isSniperVm ? 2.55 : 1.75;
      vmMuzzleFlashT = Math.max(vmMuzzleFlashT, vmMuzzleFlashDur);
      if (vmMuzzleFlash) {
        vmMuzzleFlash.visible = true;
        const flashScale = isPistolVm
          ? 0.03 + Math.random() * 0.006
          : isShotgunVm
            ? 0.038 + Math.random() * 0.009
            : isSniperVm
              ? 0.032 + Math.random() * 0.007
              : 0.022 + Math.random() * 0.005;
        vmMuzzleFlash.scale.setScalar(flashScale);
        vmMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
      }

      const horizontalSpeed = Math.hypot(velX, velZ);
      const moveRatio = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);

      // 3) CS-style inaccuracy: very small cone around deterministic recoil direction.
      const baseInaccuracy =
        wp.spread * SHOT_SPREAD_MULT *
        (S.aiming ? ADS_SPREAD_MULT : HIP_SPREAD_MULT);
      let inac = baseInaccuracy;
      // לצלף: ללא כוונת (no ADS) הירי הרבה פחות מדויק
      if (!S.aiming && isSniperVm) {
        inac *= 2.4;
      }
      inac *= 0.25; // shrink from legacy bloom values
      if (!onGround) {
        inac *= 3.3;
      } else {
        inac *= 1 + moveRatio * 1.7;
      }
      if (S.crouching) inac *= 0.5;
      const sprayFactor = clamp(S.sprayIndex / 10, 0, 1.2);
      inac *= 1 + sprayFactor * 0.6;
      if (isShotgunVm) inac *= 2.2;

      const sampleInaccuracy = () => {
        const r = inac * Math.sqrt(Math.random());
        const ang = Math.random() * Math.PI * 2;
        return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
      };

      // Muzzle in view space comes from the currently equipped weapon model pose.
      const muzzleOffset = new THREE.Vector3(vmMuzzleX, vmMuzzleY, vmMuzzleZ);
      muzzleOffset.applyEuler(new THREE.Euler(pitchObj.rotation.x, yawObj.rotation.y, 0, "YXZ"));
      const muzzleWorld = yawObj.position.clone().add(muzzleOffset);

      const basePitch = pitchObj.rotation.x;
      const baseYaw = yawObj.rotation.y;
      const shotEuler = new THREE.Euler(
        basePitch + recoilStep.pitch,
        baseYaw + recoilStep.yaw,
        0,
        "YXZ",
      );

      // Final deterministic direction (CS-style): camera forward + recoil offset.
      const fwd = new THREE.Vector3(0,0,-1).applyEuler(shotEuler);
      const right = new THREE.Vector3(1,0,0).applyEuler(shotEuler).normalize();
      const up = new THREE.Vector3(0,1,0).applyEuler(shotEuler).normalize();

      for(let p=0;p<wp.pellets;p++){
        const jitter = sampleInaccuracy();
        const d = fwd.clone()
          .add(right.clone().multiplyScalar(jitter.x))
          .add(up.clone().multiplyScalar(jitter.y))
          .normalize();
        if(wp.hitMode === "hitscan"){
          doHitscan(muzzleWorld, d, wp, false, "You");
        } else {
          spawnProj(muzzleWorld.clone(), d, wp, false, "You");
        }
      }

      const bloomBase = (isShotgunVm ? 0.19 : isSniperVm ? 0.14 : 0.08) + wp.fireRate * 0.02 + (wp.pellets > 1 ? 0.08 : 0);
      const patternIntensity = clamp((patternIdx + 1) / pattern.length, 0, 1);
      const bloomGain = bloomBase * (0.7 + patternIntensity * 0.8);
      recoilBloom = clamp(recoilBloom + bloomGain, 0, 1.35);
      const recoilMult = isShotgunVm ? 1.42 : isSniperVm ? 1.6 : isPistolVm ? 0.9 : 1;
      const recoilKickPitch = (S.aiming ? 0.0065 : 0.011) * recoilMult * (1 + recoilBloom * 0.28);
      // Camera recoil follows the same deterministic pattern (player can learn & counter).
      pitchObj.rotation.x = clamp(pitchObj.rotation.x + recoilKickPitch - recoilStep.pitch * 0.65, -1.35, 1.35);
      yawObj.rotation.y += recoilStep.yaw * 0.7;
      playVmAnim("shoot", now, 0.03, shootPlaybackDuration);
      if (shotAudio) {
        const shotPlaybackRate = isPistolVm ? 1.08 : isShotgunVm ? 0.84 : isSniperVm ? 0.78 : 0.96;
        const shotVolume = isPistolVm ? 0.24 : isShotgunVm ? 0.46 : isSniperVm ? 0.42 : 0.32;
        shotAudio.setPlaybackRate(shotPlaybackRate);
        shotAudio.setVolume(shotVolume * masterVolRef.current);
        if (shotAudio.isPlaying) shotAudio.stop();
        shotAudio.play();
      }
    }

    function doReload(){
      if(S.dead||S.reloading) return;
      const wp=WEAPONS[S.wpIdx];
      if(S.ammo>=wp.maxAmmo){
        // Ignore reload on full magazine.
        return;
      }
      const now=performance.now()/1000;
      pendingVmReload = null;
      if(wp.viewModel === "shotgun"){
        const shellDuration = getShotgunShellInsertDuration();
        S.reloading=true;
        S.reloadTimer=now+shellDuration;
        setReloading(true);
        triggerReloadAnim(wp, false, shellDuration, now);
        return;
      }
      const reloadDuration = getEffectiveReloadDuration(wp);
      S.reloading=true; S.reloadTimer=now+reloadDuration; setReloading(true);
      triggerReloadAnim(wp, false, reloadDuration, now);
    }

    function switchWeapon(idx:number){
      if(idx===S.wpIdx) return;
      playerAmmoByWeapon[S.wpIdx] = S.ammo;
      S.wpIdx=idx; S.reloading=false; S.reloadTimer=0;
      pendingVmReload = null;
      S.ammo = playerAmmoByWeapon[idx];
      setWpIdx(idx); setAmmo(S.ammo); setMaxAmmo(WEAPONS[idx].maxAmmo); setReloading(false);
      recoilBloom = 0;
      // swap viewmodel mesh
      vmScene.remove(vmGroup);
      vmGroup = makeViewmodel(
        WEAPONS[idx],
        vmScene,
        assets.weaponModels[WEAPONS[idx].viewModel],
        assets.weaponModels.ak47,
      );
      applyVmBasePose(vmGroup);
      attachVmMuzzleFlash(vmGroup);
      playVmAnim("idle", performance.now() / 1000, 0.01);
      vmReloadT = 0;
      vmReloadDur = getEffectiveReloadDuration(WEAPONS[idx]);
      vmReloadProfile = getReloadAnimProfile(WEAPONS[idx].id);
      vmReloadActive = false;
      vmReloadFromEmpty = false;
      vmMuzzleFlashT = 0;
      vmRecoilBack = 0;
      vmRecoilPitch = 0;
      vmRecoilRoll = 0;
      vmSwitchDrawT = 1;
      if (vmMuzzleFlash) vmMuzzleFlash.visible = false;
      if (vmMuzzleFlashLight) vmMuzzleFlashLight.intensity = 0;
      if (S.ammo === 0) {
        requestAnimationFrame(() => {
          if (S.wpIdx === idx && S.ammo === 0 && !S.reloading) doReload();
        });
      }
    }

    function respawnPlayer(){
      S.hp=MAX_HEALTH; S.dead=false; S.respawnTimer=0;
      for(let i=0;i<WEAPONS.length;i++) playerAmmoByWeapon[i]=WEAPONS[i].maxAmmo;
      S.ammo=WEAPONS[S.wpIdx].maxAmmo; S.reloading=false;
      playerAmmoByWeapon[S.wpIdx] = S.ammo;
      pendingVmReload = null;
      S.invincible = SPAWN_INVINCIBLE;
      S.crouching = false;
      S.sliding = false;
      S.slideTimer = 0;
      S.slideCooldown = 0;
      S.lastDamageTs = performance.now()/1000;
      yawObj.position.copy(pickPlayerSpawn());
      yawObj.position.y += PLAYER_SPAWN_LIFT;
      facePlayerTowardCenter();
      velX=0; velY=0; velZ=0; onGround=false;
      coyoteTimer=0; jumpBufferTimer=0;
      recoilBloom=0; crossBloom=0; headBobT=0; headBobY=0; landingKick=0;
      pitchObj.position.y = 0;
      vmReloadT = 0;
      vmReloadActive = false;
      vmReloadFromEmpty = false;
      vmMuzzleFlashT = 0;
      vmRecoilBack = 0;
      vmRecoilPitch = 0;
      vmRecoilRoll = 0;
      vmSwitchDrawT = 0;
      if (vmMuzzleFlash) vmMuzzleFlash.visible = false;
      if (vmMuzzleFlashLight) vmMuzzleFlashLight.intensity = 0;
      setPlayerHp(MAX_HEALTH); setDead(false); setAmmo(S.ammo);
      setReloading(false); setShield(SPAWN_INVINCIBLE); setCrosshairBloom(0); setLowHpFx(0);
      setIsCrouching(false);
      setIsSliding(false);
    }

    function killPlayer(killer = "Enemy"){
      if(S.dead || S.invincible>0) return;
      S.lastDamageTs = performance.now()/1000;
      S.crouching = false;
      S.sliding = false;
      S.slideTimer = 0;
      S.dead=true; S.deaths++;
      S.respawnTimer=RESPAWN_SECS;
      setDead(true); setDeaths(S.deaths); setRespawnT(RESPAWN_SECS);
      setIsCrouching(false);
      setIsSliding(false);
      pushKillFeed(`${killer} eliminated you`);
    }

    //  Input handlers 
    const onMouseDown = (e:MouseEvent)=>{
      if (runStateRef.current === "paused") {
        if (inputModeRef.current === "menu" && document.pointerLockElement === renderer.domElement && e.button === 0) {
          e.preventDefault();
          virtualClick();
        }
        return;
      }
      if(isStageResizingRef.current) return;
      if(e.button===2){
        rightMouseHeld = true;
        // בזמן רילואד של הצלף לא נכנסים למצב כוונת
        if(document.pointerLockElement===renderer.domElement && !S.reloading){
          S.aiming = true;
          setIsAiming(true);
        }
        return;
      }
      if(e.button!==0) return;
      if(document.pointerLockElement!==renderer.domElement){
        setSessionStarted(true);
        plmRef.current?.requestLock(); return;
      }
      doFire();
    };
    const onMouseDownTrack = (e:MouseEvent)=>{ if(e.button===0) keys["MouseLeft"]=true; };
    const onMouseUpTrack   = (e:MouseEvent)=>{
      if(e.button===0) keys["MouseLeft"]=false;
      if(e.button===2){
        rightMouseHeld = false;
        S.aiming = false;
        setIsAiming(false);
      }
    };

    const onMouseMove = (e:MouseEvent)=>{
      if (runStateRef.current === "paused") {
        // While soft-paused (P) we keep pointer lock and drive a virtual cursor for menu navigation.
        if (inputModeRef.current === "menu" && document.pointerLockElement === renderer.domElement) {
          const maxDelta = 80;
          const dx = clamp(e.movementX, -maxDelta, maxDelta);
          const dy = clamp(e.movementY, -maxDelta, maxDelta);
          moveVirtualCursor(dx, dy);
        }
        return;
      }
      if(document.pointerLockElement!==renderer.domElement || S.dead) return;
      const sens = lookSensRef.current * (S.aiming ? ADS_LOOK_SENS_MULT * adsSensRef.current : 1);
      // יש לעיתים movementX/Y קיצוני בפריים יחיד – נחתוך לדלתא סבירה כדי למנוע "טלקפורט" במבט.
      const maxDelta = 50;
      const dx = clamp(e.movementX, -maxDelta, maxDelta);
      const dy = clamp(e.movementY, -maxDelta, maxDelta);
      yawObj.rotation.y   -= dx * sens;
      pitchObj.rotation.x -= dy * sens;
      pitchObj.rotation.x  = clamp(pitchObj.rotation.x, -1.35, 1.35);
    };

    const onKeyDown = (e:KeyboardEvent)=>{
      if(e.code==="KeyH" && !e.repeat){
        e.preventDefault();
        showHitboxOutlinesRef.current = !showHitboxOutlinesRef.current;
        return;
      }
      if(e.code==="KeyM" && !e.repeat){
        e.preventDefault();
        setTacticalMapOpen((open)=> !open);
        return;
      }
      if(e.altKey && e.code==="Enter"){
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if(e.code==="KeyP" && !e.repeat){
        // אין Pause במסך האלימיניישן (כשמתים)
        if (S.dead) return;
        // P toggles a "soft pause" that keeps pointer lock; menu is navigated with a virtual cursor.
        e.preventDefault();
        if (runStateRef.current === "playing") {
          for (const k of Object.keys(keys)) keys[k] = false;
          pauseGame({ keepLock: true });
        } else if (runStateRef.current === "paused" && (performance.now() - pausedAtRef.current) > 350) {
          resumeGame();
        }
        return;
      }
      if(e.code==="Escape" && !e.repeat){
        e.preventDefault();
        if (runStateRef.current === "paused" && (performance.now() - pausedAtRef.current) > 350) {
          resumeGame();
        }
        return;
      }

      // While paused with pointer lock kept, allow Enter/Space to activate the hovered menu item.
      if (runStateRef.current === "paused") {
        if (!e.repeat && (e.code === "Enter" || e.code === "Space") && inputModeRef.current === "menu" && document.pointerLockElement === renderer.domElement) {
          e.preventDefault();
          virtualClick();
        }
        return;
      }

      if(e.code==="F8" && !e.repeat){
        e.preventDefault();
        flyMode = !flyMode;
        // When enabling fly, clear vertical velocity & ground state so physics doesn't snap.
        velY = 0;
        onGround = false;
        S.sliding = false;
        S.slideTimer = 0;
        S.crouching = false;
        setIsCrouching(false);
        setIsSliding(false);
        return;
      }

      keys[e.code]=true;
      if((e.code==="Space"||e.code==="KeyF") && !e.repeat){
        e.preventDefault();
        jumpBufferTimer = JUMP_BUFFER_SECS;
      }
      if(e.code==="KeyR") doReload();
      if(e.code==="Digit1") switchWeapon(0);
      if(e.code==="Digit2") switchWeapon(1);
      if(e.code==="Digit3") switchWeapon(2);
      if(e.code==="Digit4") switchWeapon(3);
    };
    const onKeyUp   = (e:KeyboardEvent)=>{
      keys[e.code]=false;
      if((e.code==="Space"||e.code==="KeyF") && velY>0){
        velY *= JUMP_RELEASE_CUT;
      }
    };
    const unsubPlm = plmRef.current?.subscribe((locked) => {
      if (locked) return;
      S.aiming = false;
      S.crouching = false;
      S.sliding = false;
      S.slideTimer = 0;
      setIsAiming(false);
      setIsCrouching(false);
      setIsSliding(false);
      for (const k of Object.keys(keys)) keys[k] = false;
    });
    const onWheel = (e:WheelEvent)=>{
      if(document.pointerLockElement!==renderer.domElement || S.dead || runStateRef.current === "paused") return;
      e.preventDefault();
      const dir = e.deltaY>0 ? 1 : -1;
      const next = (S.wpIdx + dir + WEAPONS.length) % WEAPONS.length;
      switchWeapon(next);
    };

    const resize=()=>{
      const w=Math.max(1,mount.clientWidth), h=Math.max(1,mount.clientHeight);
      camera.aspect=w/h; camera.updateProjectionMatrix();
      vmCamera.aspect=w/h; vmCamera.updateProjectionMatrix();
      renderer.setSize(w,h,false);
      composer.setSize(w,h);
    };
    resize();
    const ro=new ResizeObserver(resize); ro.observe(mount);

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousedown", onMouseDownTrack);
    renderer.domElement.addEventListener("mouseup",   onMouseUpTrack);
    renderer.domElement.addEventListener("contextmenu", (ev)=>ev.preventDefault());
    document.addEventListener("wheel", onWheel, { passive:false });
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup",   onKeyUp);

    //  Splash damage helper 
    function applySplash(proj:Projectile, pos:THREE.Vector3){
      for(const bot of bots){
        if(bot.dead) continue;
        const d=bot.mesh.position.distanceTo(pos);
        if(d<proj.splashR){
          bot.health -= proj.splashDmg*(1-d/proj.splashR);
          if(bot.health<=0){
            bot.health=0;
            bot.dead=true; bot.mesh.visible=false;
            bot.respawnTimer=RESPAWN_SECS;
            if(!proj.fromBot){
              S.kills++;
              setKills(S.kills);
              pushKillFeed(`You eliminated ${bot.label} (Splash)`);
            }
          }
        }
      }
      if(!S.dead && S.invincible<=0){
        const pd=yawObj.position.distanceTo(pos);
        if(pd<proj.splashR){
          S.hp -= proj.splashDmg*(1-pd/proj.splashR);
          S.lastDamageTs = performance.now()/1000;
          S.hitFlash=1; setHitFlash(1);
          if(S.hp<=0) killPlayer(proj.sourceName); else setPlayerHp(Math.max(0,S.hp));
        }
      }
    }

    //  Bot AI 
    const _tv = new THREE.Vector3();
    const _botOrigin = new THREE.Vector3();
    const _botAim = new THREE.Vector3();
    const _botShotDir = new THREE.Vector3();
    const _botJitter = new THREE.Vector3();
    function updateBot(bot:BotState, dt:number){
      if(bot.dead){
        bot.respawnTimer-=dt;
        if(bot.respawnTimer<=0){
          bot.dead=false; bot.health=BOT_MAX_HEALTH; bot.mesh.visible=true;
          bot.ammo=WEAPONS[bot.wpIdx].maxAmmo;
          bot.mesh.position.copy(pickBotSpawn(bot.id));
          bot.mesh.position.y = getBotGroundY(bot.mesh.position.x, bot.mesh.position.z, bot.mesh.position.y);
          bot.onGround = true;
          bot.velY = 0; bot.velX = 0; bot.velZ = 0;
          bot.targetYaw = bot.yaw;
          bot.animTime = rng(0, Math.PI*2);
          bot.lastHudHealth = BOT_MAX_HEALTH;
          updateBotHpLabel(bot.mesh, bot.label, BOT_MAX_HEALTH);
          if (bot.mixer) {
            bot.mixer.stopAllAction();
          }
          if (bot.animActions) {
            bot.activeAnim = undefined;
            setBotAnimState(bot, "idle", 0.08);
          }
        }
        return;
      }
      const wp = WEAPONS[bot.wpIdx];
      const bp = bot.mesh.position, pp = yawObj.position;
      _tv.copy(pp).sub(bp);
      const dist = _tv.length();

      // Face player (smooth yaw + model forward offset)
      bot.targetYaw = Math.atan2(_tv.x, _tv.z);
      let yawDiff = bot.targetYaw - bot.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      bot.yaw += yawDiff * Math.min(1, dt * BOT_YAW_LERP);
      bot.mesh.rotation.y = bot.yaw + BOT_MODEL_FACING_OFFSET;

      // Strafe: intentional direction changes, longer segments
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeDir = -bot.strafeDir;
        bot.strafeTimer = rng(0.8, 2.4);
      }
      const ideal = 14 + bot.id * 1.1;
      const fwd = dist > ideal ? 1 : (dist < ideal * 0.55 ? -0.55 : 0);
      const maxSpeed = dist > ideal * 1.2 ? BOT_SPEED_RUN : (dist < ideal * 0.6 ? BOT_SPEED_RUN * 0.6 : BOT_SPEED_WALK);

      let sepX = 0, sepZ = 0;
      for (const other of bots) {
        if (other.id === bot.id || other.dead) continue;
        const ox = bp.x - other.mesh.position.x;
        const oz = bp.z - other.mesh.position.z;
        const dSq = ox * ox + oz * oz;
        if (dSq <= 0.0001 || dSq > 8.5 * 8.5) continue;
        const d = Math.sqrt(dSq);
        const push = (8.5 - d) / 8.5;
        sepX += (ox / d) * push;
        sepZ += (oz / d) * push;
      }
      const sepLen = Math.hypot(sepX, sepZ);
      if (sepLen > 0.0001) { sepX /= sepLen; sepZ /= sepLen; }

      const wishX = Math.sin(bot.yaw) * fwd + Math.cos(bot.yaw) * bot.strafeDir * 0.7 + sepX * 0.6;
      const wishZ = Math.cos(bot.yaw) * fwd - Math.sin(bot.yaw) * bot.strafeDir * 0.7 + sepZ * 0.6;
      const wishLen = Math.hypot(wishX, wishZ);
      const wishNormX = wishLen > 1e-4 ? wishX / wishLen : 0;
      const wishNormZ = wishLen > 1e-4 ? wishZ / wishLen : 0;

      const accel = Math.min(1, dt * BOT_ACCEL);
      const brake = Math.min(1, dt * BOT_BRAKE);
      if (wishLen > 0.01) {
        const targetVx = wishNormX * maxSpeed;
        const targetVz = wishNormZ * maxSpeed;
        bot.velX += (targetVx - bot.velX) * accel;
        bot.velZ += (targetVz - bot.velZ) * accel;
      } else {
        bot.velX += (0 - bot.velX) * brake;
        bot.velZ += (0 - bot.velZ) * brake;
      }
      const currentSpeed = Math.hypot(bot.velX, bot.velZ);
      if (currentSpeed > maxSpeed && maxSpeed > 0.001) {
        const scale = maxSpeed / currentSpeed;
        bot.velX *= scale;
        bot.velZ *= scale;
      }

      // Lean into movement (pitch forward when running, roll when strafing) – no change to facing
      const moveX = bot.velX * dt;
      const moveZ = bot.velZ * dt;
      const nextX = clamp(bp.x + moveX, -ARENA_HALF + 1, ARENA_HALF - 1);
      const nextZ = clamp(bp.z + moveZ, -ARENA_HALF + 1, ARENA_HALF - 1);

      if (!botCollidesAt(nextX, bp.y, bp.z)) {
        bp.x = nextX;
      } else {
        bot.velX = 0;
        const nudgeX = clamp(bp.x + Math.sign(moveX || 1) * 0.08, -ARENA_HALF + 1, ARENA_HALF - 1);
        if (!botCollidesAt(nudgeX, bp.y, bp.z)) bp.x = nudgeX;
      }
      if (!botCollidesAt(bp.x, bp.y, nextZ)) {
        bp.z = nextZ;
      } else {
        bot.velZ = 0;
        const nudgeZ = clamp(bp.z + Math.sign(moveZ || 1) * 0.08, -ARENA_HALF + 1, ARENA_HALF - 1);
        if (!botCollidesAt(bp.x, bp.y, nudgeZ)) bp.z = nudgeZ;
      }
      pushBotOutOfBoxes(bot);

      // Ground snap: keeps bots firmly attached to floors/platform tops.
      const groundY = getBotGroundY(bp.x, bp.z, bp.y);
      const dy = groundY - bp.y;
      if(dy > 0){
        bp.y += Math.min(dy, dt * 11.5);
      } else {
        bp.y += Math.max(dy, -dt * 13.5);
      }
      if(Math.abs(groundY - bp.y) < 0.04) bp.y = groundY;
      bot.onGround = Math.abs(groundY - bp.y) < 0.14;
      bot.velY = 0;
      pushBotOutOfBoxes(bot);

      // Bot animation: use imported mutant clips when available, otherwise fallback wobble.
      const moveSpeed = Math.hypot(bot.velX, bot.velZ);
      const move01 = clamp(moveSpeed / BOT_SPEED_RUN, 0, 1);
      if (bot.mixer && bot.animActions) {
        const desiredAnim: BotAnimName =
          move01 > 0.72 ? "run" :
          move01 > 0.12 ? "walk" :
          "idle";
        setBotAnimState(bot, desiredAnim);
        bot.mixer.update(dt);
      } else {
        const animIntensity = 0.24 + move01 * 0.76;
        bot.animTime += dt * (2.1 + move01 * 8.6);

        const bob = Math.sin(bot.animTime + bot.animPhase);
        const wobble = Math.sin(bot.animTime * 2.2 + bot.animPhase * 0.7);
        bot.mesh.rotation.x = Math.sin(bot.animTime * 1.65 + bot.animPhase) * 0.05 * animIntensity;
        bot.mesh.rotation.z = Math.cos(bot.animTime * 1.85 + bot.animPhase) * 0.045 * animIntensity;

        const body = bot.mesh.userData.body as THREE.Mesh | undefined;
        const base = bot.mesh.userData.base as THREE.Mesh | undefined;
        const gun = bot.mesh.userData.gun as THREE.Mesh | undefined;
        if(body){
          const bodyBaseY = (bot.mesh.userData.bodyBaseY as number | undefined) ?? (BOT_EGG_R * 1.28 - BOT_HEIGHT);
          body.position.y = bodyBaseY + bob * 0.065 * animIntensity;
          const sx = 1 + wobble * 0.035 * animIntensity;
          const sy = 1 - wobble * 0.055 * animIntensity;
          body.scale.set(sx, sy, sx);
        }
        if(base){
          const baseY = (bot.mesh.userData.baseBaseY as number | undefined) ?? (0.09 - BOT_HEIGHT);
          base.position.y = baseY + Math.sin(bot.animTime * 2.4 + bot.animPhase) * 0.01 * animIntensity;
        }
        if(gun){
          const gunBaseRotZ = (bot.mesh.userData.gunBaseRotZ as number | undefined) ?? 0;
          gun.rotation.z = gunBaseRotZ + Math.sin(bot.animTime * 3.1 + bot.animPhase) * 0.09 * animIntensity;
        }
      }

      // Lean into movement: pitch forward when running, roll when strafing (graphical only, still faces player)
      const spd = Math.max(0.001, Math.hypot(bot.velX, bot.velZ));
      const forwardRun = (bot.velX * Math.sin(bot.yaw) + bot.velZ * Math.cos(bot.yaw)) / spd;
      const strafeRight = (bot.velX * Math.cos(bot.yaw) - bot.velZ * Math.sin(bot.yaw)) / spd;
      const leanPitch = -forwardRun * 0.12 * Math.min(1, spd / BOT_SPEED_RUN);
      const leanRoll = -strafeRight * 0.08 * Math.min(1, spd / BOT_SPEED_RUN);
      bot.mesh.rotation.x += leanPitch;
      bot.mesh.rotation.z += leanRoll;

      // hp bar
      const hbFg = bot.mesh.userData.hpBarFg as THREE.Mesh | undefined;
      const hbBg = bot.mesh.userData.hpBarBg as THREE.Mesh | undefined;
      const hpLabelSprite = bot.mesh.userData.hpLabelSprite as THREE.Sprite | undefined;
      const ratio=clamp(bot.health/BOT_MAX_HEALTH,0,1);
      if (hbFg && hbBg) {
        hbFg.scale.x=Math.max(0.01,ratio);
        hbFg.position.x=-(1-ratio)*0.54;
        (hbFg.material as THREE.MeshBasicMaterial).color.set(getBotHudColor(ratio));
        hbFg.lookAt(camera.position);
        hbBg.lookAt(camera.position);
      }
      if(hpLabelSprite){
        hpLabelSprite.lookAt(camera.position);
      }
      if(Math.abs(bot.lastHudHealth - bot.health) >= 0.5){
        bot.lastHudHealth = bot.health;
        updateBotHpLabel(bot.mesh, bot.label, bot.health);
      }

      // reload
      if(bot.reloadTimer>0){ bot.reloadTimer-=dt; if(bot.reloadTimer<=0){ bot.ammo=wp.maxAmmo; bot.reloadTimer=0; } }
      // fire
      bot.fireTimer-=dt;
      if(bot.fireTimer<=0 && dist<wp.range*1.5 && bot.ammo>0){
        bot.fireTimer = 1/(wp.fireRate*(0.48+Math.random()*0.54));

        const muzzleOffsetY = (bot.mesh.userData.muzzleOffsetY as number | undefined) ?? (BOT_HEIGHT * 0.36);
        _botOrigin.copy(bp);
        _botOrigin.y += muzzleOffsetY;

        _botAim.copy(pp);
        _botAim.y += 0.3;
        _botAim.sub(_botOrigin).normalize();

        const inac = BOT_INACCURACY;
        for(let p=0;p<wp.pellets;p++){
          _botJitter.set(
            (Math.random()-0.5)*(wp.spread+inac)*2,
            (Math.random()-0.5)*(wp.spread+inac)*2,
            (Math.random()-0.5)*(wp.spread+inac)*2,
          );
          _botShotDir.copy(_botAim).add(_botJitter).normalize();
          if(wp.hitMode === "hitscan"){
            doHitscan(_botOrigin, _botShotDir, wp, true, bot.label);
          } else {
            spawnProj(_botOrigin, _botShotDir, wp, true, bot.label);
          }
        }
        bot.ammo=Math.max(0,bot.ammo-1);
        if(bot.ammo===0) bot.reloadTimer=wp.reloadTime;
      }
    }

    //  Actor-vs-world collision push-out 
    const PBOX = new THREE.Box3();
    const BBOX = new THREE.Box3();
    const BOT_BOX_SIZE = new THREE.Vector3(BOT_RADIUS*2, BOT_HEIGHT*2, BOT_RADIUS*2);
    const PLAYER_BOX_SIZE = new THREE.Vector3(PLAYER_RADIUS*2, PLAYER_HEIGHT*2, PLAYER_RADIUS*2);
    const _bc = new THREE.Vector3();
    const _hs = new THREE.Vector3();
    const _pd = new THREE.Vector3();

    // Ground snapping for triangle-only maps (e.g., OBJ floors): raycast against the level mesh.
    const _groundRay = new THREE.Raycaster();
    const _groundDir = new THREE.Vector3(0, -1, 0);


    function pushBotOutOfBoxes(bot: BotState){
      const pos = bot.mesh.position;
      BBOX.setFromCenterAndSize(pos, BOT_BOX_SIZE);
      for(const box of collidables){
        const feet = pos.y - BOT_HEIGHT;
        const head = pos.y + BOT_HEIGHT;
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(!BBOX.intersectsBox(box)) continue;

        box.getCenter(_bc);
        _pd.copy(pos).sub(_bc);
        _pd.y = 0;
        box.getSize(_hs).multiplyScalar(0.5);
        const ox = _hs.x + BOT_RADIUS - Math.abs(_pd.x);
        const oz = _hs.z + BOT_RADIUS - Math.abs(_pd.z);
        if(ox<=0 || oz<=0) continue;

        if(ox < oz){
          const sx = Math.abs(_pd.x) < 1e-4 ? (Math.random()<0.5 ? -1 : 1) : Math.sign(_pd.x);
          pos.x += sx * ox;
        } else {
          const sz = Math.abs(_pd.z) < 1e-4 ? (Math.random()<0.5 ? -1 : 1) : Math.sign(_pd.z);
          pos.z += sz * oz;
        }
        BBOX.setFromCenterAndSize(pos, BOT_BOX_SIZE);
      }
    }

    function pushOutOfBoxes(){
      for(const box of collidables){
        PBOX.setFromCenterAndSize(yawObj.position, PLAYER_BOX_SIZE);

        const feet = yawObj.position.y - PLAYER_HEIGHT;
        const head = yawObj.position.y + PLAYER_HEIGHT;
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(!PBOX.intersectsBox(box)) continue;

        // Step-up assist: lets you glide over low ledges/stairs instead of hard-stopping/jittering.
        // Only applies when grounded and the obstacle top is within a small step height above your feet.
        if(onGround && velY <= 0){
          const top = box.max.y;
          const step = top - feet;
          if(step > 0.001 && step <= 0.85){
            const px = yawObj.position.x, pz = yawObj.position.z;
            const withinX = px >= box.min.x - PLAYER_RADIUS*0.9 && px <= box.max.x + PLAYER_RADIUS*0.9;
            const withinZ = pz >= box.min.z - PLAYER_RADIUS*0.9 && pz <= box.max.z + PLAYER_RADIUS*0.9;
            if(withinX && withinZ){
              yawObj.position.y = top + PLAYER_HEIGHT;
              continue;
            }
          }
        }

        box.getCenter(_bc);
        _pd.copy(yawObj.position).sub(_bc);
        _pd.y = 0;
        box.getSize(_hs).multiplyScalar(0.5);
        const ox=_hs.x+PLAYER_RADIUS-Math.abs(_pd.x);
        const oz=_hs.z+PLAYER_RADIUS-Math.abs(_pd.z);
        if(ox<oz) {
          const sign = Math.sign(_pd.x||1);
          yawObj.position.x += sign * ox;
          if(velX * sign < 0) velX = 0;
        } else {
          const sign = Math.sign(_pd.z||1);
          yawObj.position.z += sign * oz;
          if(velZ * sign < 0) velZ = 0;
        }
      }
    }


    function resolveVerticalCollisions(prevY:number){
      const px = yawObj.position.x;
      const pz = yawObj.position.z;
      const feetNow = yawObj.position.y - PLAYER_HEIGHT;
      const feetPrev = prevY - PLAYER_HEIGHT;
      const headNow = yawObj.position.y + PLAYER_HEIGHT;
      const headPrev = prevY + PLAYER_HEIGHT;

      let bestLandingY = -Infinity;
      let hasLanding = false;

      // 1) Box-based landings / head bonks (fast path for chunky geometry).
      for(const box of collidables){
        const withinX = px >= box.min.x - PLAYER_RADIUS*0.9 && px <= box.max.x + PLAYER_RADIUS*0.9;
        const withinZ = pz >= box.min.z - PLAYER_RADIUS*0.9 && pz <= box.max.z + PLAYER_RADIUS*0.9;
        if(!withinX || !withinZ) continue;

        const top = box.max.y;
        const bottom = box.min.y;

        // Landing: only when we actually reach the surface (no early snap = natural fall)
        if(velY <= 0 && feetPrev >= top - 0.02 && feetNow <= top + 0.03){
          const landingY = top + PLAYER_HEIGHT;
          if(landingY > bestLandingY){
            bestLandingY = landingY;
            hasLanding = true;
          }
        }

        // Ceiling: crossed the bottom surface while moving up.
        if(velY > 0 && headPrev <= bottom + 0.02 && headNow >= bottom - 0.02){
          yawObj.position.y = bottom - PLAYER_HEIGHT - 0.02;
          velY = Math.min(0, velY);
          onGround = false;
          return;
        }
      }

      // 2) Triangle-floor support (OBJ / thin floors): raycast down into the actual level mesh.
      // Important: OBJ maps often have double-sided / flipped triangles. We only accept "up-facing" hits
      // (world-space normal.y > 0.5) to avoid snapping UNDER the floor.
      if(levelRoot && velY <= 0){
        // Cast from ABOVE the player so we can recover even if we spawned slightly under a thin floor.
        const castY = yawObj.position.y + PLAYER_HEIGHT + 2.2;
        _groundRay.ray.origin.set(px, castY, pz);
        _groundRay.ray.direction.copy(_groundDir);
        _groundRay.near = 0;
        _groundRay.far = PLAYER_HEIGHT + 6.5;

        const hits = _groundRay.intersectObject(levelRoot, true);

        let bestUpHitY = -Infinity;
        for(const h of hits){
          if(!h.face) continue;

          // Face normals are in local space; convert to world space.
          const n = h.face.normal.clone();
          n.transformDirection(h.object.matrixWorld);

          // Only accept "ground-like" surfaces.
          if(n.y <= 0.5) continue;

          const candidateY = h.point.y + PLAYER_HEIGHT;
          if(candidateY > bestUpHitY){
            bestUpHitY = candidateY;
          }
        }

        if(bestUpHitY > bestLandingY){
          // Only snap when we're at or just above the surface (natural fall, no mid-air stick)
          if(yawObj.position.y <= bestUpHitY + 0.06){
            bestLandingY = bestUpHitY;
            hasLanding = true;
          }
        }
      }

// Apply landing if we found one.
      if(hasLanding){
        yawObj.position.y = bestLandingY;
        velY = 0;
        onGround = true;
        return;
      }

      // Safety floor only for the procedural map (no level mesh).
      if(!levelRoot && yawObj.position.y <= PLAYER_HEIGHT){
        yawObj.position.y = PLAYER_HEIGHT;
        velY = 0;
        onGround = true;
        return;
      }

      onGround = false;
    }


    //  Main loop 
    let rafId=0, lastT=performance.now(), hudT=0, minimapDebugAccum=0;
    let adsBlend = 0;
    let didFlatSpawnSnap = false;

    const animate=(now:number)=>{
      const dt=Math.min((now-lastT)/1000, 0.06); lastT=now; hudT+=dt;
      const nowSec=now/1000;

      if (sessionStartedRef.current && !matchReadyDispatchedRef.current) {
        gameBus.emit({ type: "MatchAssetsReady" });
        matchReadyDispatchedRef.current = true;
      }

      if(S.killFeed.length>0){
        let changed = false;
        S.killFeed = S.killFeed
          .map((entry)=>{
            const ttl = entry.ttl - dt;
            if(Math.abs(ttl - entry.ttl) > 1e-4) changed = true;
            return { ...entry, ttl };
          })
          .filter((entry)=>entry.ttl > 0);
        if(changed && hudT > 0.05){
          setKillFeed([...S.killFeed]);
        }
      }

      // When paused: keep rendering the scene (so pause overlay looks good) but skip all physics / input.
      if(runStateRef.current === "paused"){
        renderer.autoClear=true;
        composer.render();
        renderer.autoClear=false;
        renderer.clearDepth();
        renderer.render(vmScene, vmCamera);
        rafId=requestAnimationFrame(animate); return;
      }

      S.roundTimer = Math.max(0, S.roundTimer - dt);
      if(hudT>0.08){
        setRoundTime(S.roundTimer);
      }

      // Respawn countdown
      if(S.dead){
        S.respawnTimer-=dt;
        if(hudT>0.12) setRespawnT(Math.max(0,S.respawnTimer));
        if(S.respawnTimer<=0) respawnPlayer();
        renderer.autoClear=true;
        composer.render();
        rafId=requestAnimationFrame(animate); return;
      }

      // H – אווטליין היטבוקסים (אויבים + מפה)
      outlineGroup.visible = showHitboxOutlinesRef.current;
      if (showHitboxOutlinesRef.current) {
        for (let i = 0; i < bots.length; i++) {
          botOutlineMeshes[i].position.copy(bots[i].mesh.position);
          botOutlineMeshes[i].visible = !bots[i].dead;
        }
      }

      // תיקון ספאון ראשוני בפלאט ורלד – לפני כל פיזיקה/גרביטציה.
      // אם הוגדר Spawn ידני במפת הספאונים, משתמשים בו; אחרת נופלים חזרה לספאון שנבחר (levelPlayerSpawns).
      if (USE_FLAT_PLAYGROUND && !didFlatSpawnSnap && !S.dead) {
        const custom = customSpawnsForSessionRef.current;
        const safe = custom.player
          ? new THREE.Vector3(custom.player.x, PLAYER_HEIGHT, custom.player.z)
          : getChosenPlayerSpawnPosition();
        yawObj.position.set(safe.x, safe.y, safe.z);
        snapPlayerToSafeSpawn();
        yawObj.position.y += PLAYER_SPAWN_LIFT;
        velX = 0; velY = 0; velZ = 0;
        onGround = true;
        didFlatSpawnSnap = true;
      }

      // Spawn invincibility countdown
      if(S.invincible>0){
        S.invincible=Math.max(0,S.invincible-dt);
        if(hudT>0.05) setShield(S.invincible);
      }
      updateKeyPoints(nowSec, dt);

      // Regen after a quiet period with no incoming damage (exponential recovery).
      if(S.hp < MAX_HEALTH && (nowSec - S.lastDamageTs) >= HP_REGEN_DELAY_SECS){
        const missing = MAX_HEALTH - S.hp;
        const gain = missing * (1 - Math.exp(-HP_REGEN_EXP_RATE * dt));
        if(gain > 0){
          S.hp = Math.min(MAX_HEALTH, S.hp + gain);
          if(S.hp > MAX_HEALTH - 0.12) S.hp = MAX_HEALTH;
        }
      }

      // אם על נשק עם 0 כדורים ולא ברילוד (למשל חזרנו מנשק אחר) – מתחיל רילוד אוטומטי
      if (!S.dead && !S.reloading && S.ammo === 0 && WEAPONS[S.wpIdx].maxAmmo > 0) {
        doReload();
      }

      // Reload finish
      if(S.reloading && S.reloadTimer<=nowSec){
        const wp = WEAPONS[S.wpIdx];
        if(wp.viewModel === "shotgun"){
          S.ammo = Math.min(wp.maxAmmo, S.ammo + 1);
          playerAmmoByWeapon[S.wpIdx] = S.ammo;
          setAmmo(S.ammo);
          if(S.ammo < wp.maxAmmo){
            const shellDuration = getShotgunShellInsertDuration();
            S.reloadTimer = nowSec + shellDuration;
            triggerReloadAnim(wp, false, shellDuration, nowSec);
          } else {
            S.reloading=false;
            pendingVmReload = null;
            setReloading(false);
          }
        } else {
          S.ammo=wp.maxAmmo; S.reloading=false;
          pendingVmReload = null;
          playerAmmoByWeapon[S.wpIdx] = S.ammo;
          setAmmo(S.ammo); setReloading(false);
        }
      }
      if(pendingVmReload){
        const pendingCancelled = !S.reloading || S.wpIdx !== pendingVmReload.wpIdx;
        if(pendingCancelled){
          pendingVmReload = null;
        } else if(nowSec >= pendingVmReload.triggerAt){
          const wp = WEAPONS[S.wpIdx];
          const remainingReload = Math.max(0.18, S.reloadTimer - nowSec);
          const animDuration = pendingVmReload.durationSec ?? remainingReload;
          triggerReloadAnim(wp, pendingVmReload.fromEmpty, animDuration, nowSec);
          pendingVmReload = null;
        }
      }

      // Auto-fire
      if(keys["MouseLeft"] && WEAPONS[S.wpIdx].auto) doFire();

      //  Player movement (inertia + coyote jump + jump buffering) 
      const wasGrounded = onGround;
      const sprintHeld = !!(keys["ShiftLeft"]||keys["ShiftRight"]);
      const crouchHeld = !!(keys["ControlLeft"]||keys["ControlRight"]||keys["KeyC"]);
      if(flyMode){
        // Fly mode: disable all gravity/collision resolution and move freely.
        onGround = false;
        velX = 0; velY = 0; velZ = 0;

        S.sliding = false;
        S.slideTimer = 0;
        S.crouching = false;
        S.running = false;
        if(hudT > 0.05){
          setIsCrouching(false);
          setIsSliding(false);
        }

        const flySpeed =
          MOVE_SPEED
          * (sprintHeld ? RUN_MULT : 1)
          * (S.aiming ? ADS_MOVE_MULT : 1);

        const fwdIn = (keys["KeyW"]?1:0) - (keys["KeyS"]?1:0);
        const sidIn = (keys["KeyD"]?1:0) - (keys["KeyA"]?1:0);

        let wishX = 0;
        let wishZ = 0;
        if(fwdIn!==0 || sidIn!==0){
          const len = Math.sqrt(fwdIn*fwdIn+sidIn*sidIn);
          const nf=fwdIn/len, ns=sidIn/len;
          const sinY=Math.sin(yawObj.rotation.y), cosY=Math.cos(yawObj.rotation.y);
          wishX = -sinY*nf + cosY*ns;
          wishZ = -cosY*nf - sinY*ns;
        }

        yawObj.position.x = clamp(
          yawObj.position.x + wishX * flySpeed * dt,
          USE_FLAT_PLAYGROUND ? -FLAT_SPAWN_HALF + PLAYER_RADIUS : -ARENA_HALF + PLAYER_RADIUS,
          USE_FLAT_PLAYGROUND ?  FLAT_SPAWN_HALF - PLAYER_RADIUS :  ARENA_HALF - PLAYER_RADIUS,
        );
        yawObj.position.z = clamp(
          yawObj.position.z + wishZ * flySpeed * dt,
          USE_FLAT_PLAYGROUND ? -FLAT_SPAWN_HALF + PLAYER_RADIUS : -ARENA_HALF + PLAYER_RADIUS,
          USE_FLAT_PLAYGROUND ?  FLAT_SPAWN_HALF - PLAYER_RADIUS :  ARENA_HALF - PLAYER_RADIUS,
        );

        const upIn = (keys["Space"]?1:0) - ((keys["ShiftLeft"]||keys["ShiftRight"])?1:0);
        if(upIn!==0){
          yawObj.position.y += upIn * flySpeed * dt;
        }
        // Keep within a sane vertical band.
        yawObj.position.y = clamp(yawObj.position.y, -2, 48);
      } else {
      const horizontalSpeedBefore = Math.hypot(velX, velZ);
      if(S.slideCooldown > 0){
        S.slideCooldown = Math.max(0, S.slideCooldown - dt);
      }
      if(
        !S.sliding
        && onGround
        && crouchHeld
        && sprintHeld
        && horizontalSpeedBefore > MOVE_SPEED * 1.1
        && S.slideCooldown <= 0
      ){
        S.sliding = true;
        S.slideTimer = SLIDE_DURATION_SECS;
        S.slideCooldown = SLIDE_COOLDOWN_SECS;
        const slideLen = Math.hypot(velX, velZ);
        if(slideLen > 1e-4){
          S.slideDirX = velX / slideLen;
          S.slideDirZ = velZ / slideLen;
        } else {
          S.slideDirX = -Math.sin(yawObj.rotation.y);
          S.slideDirZ = -Math.cos(yawObj.rotation.y);
        }
      }
      if(S.sliding){
        S.slideTimer -= dt;
        if(S.slideTimer <= 0 || !onGround){
          S.sliding = false;
          S.slideTimer = 0;
        }
      }

      S.crouching = crouchHeld || S.sliding;
      S.running = sprintHeld && !S.crouching;
      if(hudT > 0.05){
        setIsCrouching(S.crouching);
        setIsSliding(S.sliding);
      }

      const crouchMult = S.crouching ? CROUCH_MOVE_MULT : 1;
      const speed = MOVE_SPEED * (S.running ? RUN_MULT : 1) * (S.aiming ? ADS_MOVE_MULT : 1) * crouchMult;
      const fwdIn = (keys["KeyW"]?1:0) - (keys["KeyS"]?1:0);  // +1 = forward
      const sidIn = (keys["KeyD"]?1:0) - (keys["KeyA"]?1:0);  // +1 = right

      let wishX = 0;
      let wishZ = 0;
      if(fwdIn!==0 || sidIn!==0){
        const len = Math.sqrt(fwdIn*fwdIn+sidIn*sidIn);
        const nf=fwdIn/len, ns=sidIn/len;
        const sinY=Math.sin(yawObj.rotation.y), cosY=Math.cos(yawObj.rotation.y);
        // World space: forward = (-sinY, 0, -cosY), right = (cosY, 0, -sinY)
        wishX = -sinY*nf + cosY*ns;
        wishZ = -cosY*nf - sinY*ns;
      }

      const accel = clamp((onGround ? GROUND_ACCEL : AIR_ACCEL) * dt, 0, 1);
      const brake = clamp((onGround ? GROUND_BRAKE : AIR_BRAKE) * dt, 0, 1);
      if(wishX!==0 || wishZ!==0){
        velX += (wishX * speed - velX) * accel;
        velZ += (wishZ * speed - velZ) * accel;
      } else {
        velX += (0 - velX) * brake;
        velZ += (0 - velZ) * brake;
      }
      if(S.sliding){
        const slide01 = clamp(S.slideTimer / SLIDE_DURATION_SECS, 0, 1);
        const slideSpeed = MOVE_SPEED * SLIDE_SPEED_MULT * (0.56 + 0.44 * slide01);
        const slideAccel = clamp(dt * 9.4, 0, 1);
        velX += (S.slideDirX * slideSpeed - velX) * slideAccel;
        velZ += (S.slideDirZ * slideSpeed - velZ) * slideAccel;
      }
      if(!onGround){
        const airDrag = clamp(1 - dt * AIR_DRAG, 0.85, 1);
        velX *= airDrag;
        velZ *= airDrag;
      }
      yawObj.position.x=clamp(yawObj.position.x+velX*dt,-ARENA_HALF+PLAYER_RADIUS,ARENA_HALF-PLAYER_RADIUS);
      yawObj.position.z=clamp(yawObj.position.z+velZ*dt,-ARENA_HALF+PLAYER_RADIUS,ARENA_HALF-PLAYER_RADIUS);

      // Jump + gravity
      if(onGround) coyoteTimer = COYOTE_TIME_SECS;
      else coyoteTimer = Math.max(0, coyoteTimer - dt);
      jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);
      if(jumpBufferTimer>0 && coyoteTimer>0 && !S.crouching){
        velY=JUMP_VEL;
        onGround=false;
        coyoteTimer=0;
        jumpBufferTimer=0;
      }
      const prevY = yawObj.position.y;
      velY -= GRAVITY*dt;
      const preResolveVelY = velY;
      yawObj.position.y += velY*dt;
      resolveVerticalCollisions(prevY);
      pushOutOfBoxes();
      if(!wasGrounded && onGround && preResolveVelY < -2.4){
        landingKick = clamp(Math.abs(preResolveVelY) * LANDING_KICK_MULT, 0.03, 0.12);
      }

      // בפלאט וורלד – לא משנה מה קרה בפיזיקה או בקוליז'נים,
      // מכריחים את השחקן להישאר בתוך ריבוע בטוח במרכז המפה.
      if (USE_FLAT_PLAYGROUND && !S.dead){
        yawObj.position.x = clamp(
          yawObj.position.x,
          -FLAT_SPAWN_HALF + PLAYER_RADIUS,
          FLAT_SPAWN_HALF - PLAYER_RADIUS,
        );
        yawObj.position.z = clamp(
          yawObj.position.z,
          -FLAT_SPAWN_HALF + PLAYER_RADIUS,
          FLAT_SPAWN_HALF - PLAYER_RADIUS,
        );
      }

      // Safety when השחקן יוצא לגמרי מהארנה.
      const outOfArena =
        Math.abs(yawObj.position.x) > ARENA_HALF + 4 ||
        Math.abs(yawObj.position.z) > ARENA_HALF + 4 ||
        yawObj.position.y < -10;
      if(outOfArena && !S.dead){
        if (USE_FLAT_PLAYGROUND) {
          const safe = getChosenPlayerSpawnPosition();
          yawObj.position.set(safe.x, safe.y, safe.z);
          velX = 0; velY = 0; velZ = 0;
          onGround = false;
          S.invincible = SPAWN_INVINCIBLE;
        } else if (S.invincible <= 0) {
          killPlayer("Out of bounds");
        }
      }
      }


      // Bot updates
      for(const bot of bots) updateBot(bot,dt);

      // Projectile updates
      for(let i=projectiles.length-1;i>=0;i--){
        const pr=projectiles[i];

        prStart.copy(pr.mesh.position);
        prStep.copy(pr.vel).multiplyScalar(dt);
        prEnd.copy(prStart).add(prStep);

        const stepLen = prStep.length();
        pr.traveled += stepLen;

        let hit = pr.traveled>pr.range
          || Math.abs(prEnd.x)>ARENA_HALF+3
          || Math.abs(prEnd.z)>ARENA_HALF+3
          || prEnd.y<-1 || prEnd.y>20;

        let splashHandled = false;
        projImpact.copy(prEnd);

        // World collision (ray-against-boxes), keeping the nearest impact.
        if(!hit && stepLen > 1e-6){
          projDir.copy(prStep).multiplyScalar(1 / stepLen);
          projRay.set(prStart, projDir);

          let bestWallDist = stepLen + 1e-4;
          let found = false;
          for(const box of collidables){
            const structureHit = projRay.intersectBox(box, rayPointTmp);
            if(!structureHit) continue;
            const d = rayPointTmp.distanceTo(prStart);
            if(d <= bestWallDist){
              bestWallDist = d;
              projImpact.copy(rayPointTmp);
              found = true;
            }
          }
          if(found) hit = true;
        }

        // Actor collision (capsule vs segment).
        if(!hit && pr.fromBot && !S.dead && S.invincible<=0){
          const capHit = segmentHitsCapsule(prStart, prEnd, yawObj.position, PLAYER_HEIGHT, PLAYER_RADIUS + 0.06, hsTmpHit);
          if(capHit.hit){
            hit=true;
            projImpact.copy(hsTmpHit);
            S.hp-=pr.damage; S.hitFlash=1;
            S.lastDamageTs = nowSec;

            _hitIndToEnemy.copy(pr.vel).negate();
            _hitIndToEnemy.y = 0;
            if (_hitIndToEnemy.x !== 0 || _hitIndToEnemy.z !== 0) {
              _hitIndToEnemy.normalize();
              pushHitIndicator(getHitIndicatorAngle(_hitIndToEnemy));
            }
            setHitFlash(1);

            if(S.hp<=0) killPlayer(pr.sourceName); else setPlayerHp(Math.max(0,S.hp));
            if(pr.splash){
              applySplash(pr,projImpact);
              splashHandled = true;
            }
          }
        }

        if(!hit && !pr.fromBot){
          for(const bot of bots){
            if(bot.dead) continue;
            const capHit = segmentHitsCapsule(prStart, prEnd, bot.mesh.position, BOT_HEIGHT, BOT_RADIUS + 0.05, hsTmpHit);
            if(!capHit.hit) continue;

            hit=true;
            projImpact.copy(hsTmpHit);

            const headshot = capHit.axisT >= 0.70 || projImpact.y > bot.mesh.position.y + BOT_HEAD_Y_OFFSET;
            const dealtDamage = pr.damage * (headshot ? HEADSHOT_MULT : 1);
            bot.health-=dealtDamage;
            S.hitMark = 1;
            setHitMarker(1);
            if(bot.health<=0){
              bot.health=0; bot.dead=true; bot.mesh.visible=false;
              bot.respawnTimer=RESPAWN_SECS; S.kills++; setKills(S.kills);
              pushKillFeed(`You eliminated ${bot.label}${headshot ? " (Headshot)" : ""}`, headshot);
            }
            if(pr.splash){
              applySplash(pr,projImpact);
              splashHandled = true;
            }
            break;
          }
        }

        if(hit){
          if(pr.splash && !splashHandled){
            applySplash(pr,projImpact);
          }
          scene.remove(pr.mesh); (pr.mesh.material as THREE.Material).dispose(); projectiles.splice(i,1);
          continue;
        }

        pr.mesh.position.copy(prEnd);
      }


      // Hit flash fade
      if(S.hitFlash>0){ S.hitFlash=Math.max(0,S.hitFlash-dt*3.5); if(hudT>0.04) setHitFlash(S.hitFlash); }
      if(S.hitMark>0){
        S.hitMark = Math.max(0, S.hitMark-dt*5);
        if(hudT>0.04) setHitMarker(S.hitMark);
      }
      if(S.hitInds.length>0){
        S.hitInds=S.hitInds.map(h=>({...h,opacity:h.opacity-dt*HIT_IND_FADE_RATE})).filter(h=>h.opacity>0);
        setHitInds([...S.hitInds]);
      }

      const lowHpRatio = clamp((LOW_HP_WARN_THRESHOLD - S.hp) / LOW_HP_WARN_THRESHOLD, 0, 1);
      let lowHpTarget = 0;
      if(lowHpRatio > 0 && !S.dead){
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.0075);
        lowHpTarget = lowHpRatio * (0.3 + pulse * 0.7);
      }
      if(hudT>0.04) setLowHpFx(lowHpTarget);

      recoilBloom = Math.max(0, recoilBloom - dt * (S.aiming ? 2.7 : 2.2));
      const horizontalSpeed = Math.hypot(velX, velZ);
      const moveBloom = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);
      const targetCrossBloom = clamp(
        recoilBloom * 0.92
        + moveBloom * 0.66
        + (onGround ? 0 : 0.42)
        + (S.sliding ? 0.26 : 0)
        - (S.aiming ? 0.28 : 0)
        - (S.crouching ? 0.12 : 0),
        0,
        1.55,
      );
      crossBloom += (targetCrossBloom - crossBloom) * Math.min(1, dt * 14);
      if(hudT>0.04) setCrosshairBloom(crossBloom);

      //  Viewmodel animation 
      const moving = horizontalSpeed > 0.5;
      if(moving && onGround) vmBobT+=dt*(S.running?12.4:7.8); else vmBobT*=0.88;
      const bobY=Math.sin(vmBobT)* (S.running ? 0.009 : 0.006);
      const bobX=Math.sin(vmBobT*0.5)* (S.running ? 0.005 : 0.003);
      if(vmKickT>0){ vmKickT=Math.max(0,vmKickT-dt); vmRecoilY=vmKickT*0.07; }
      else          { vmRecoilY*=0.80; }
      if(vmSwitchDrawT>0){
        vmSwitchDrawT = Math.max(0, vmSwitchDrawT - dt / VM_SWITCH_DRAW_DURATION);
      }
      const drawProgress = clamp(1 - vmSwitchDrawT, 0, 1);
      const drawEase = drawProgress < 0.5
        ? 4 * Math.pow(drawProgress, 3)
        : 1 - Math.pow(-2 * drawProgress + 2, 3) / 2;
      const drawAmount = 1 - drawEase;
      const vmDrawYOffset = -0.32 * drawAmount;
      const vmDrawZOffset = 0.07 * drawAmount;
      const vmDrawPitch = 0.18 * drawAmount;
      const vmDrawRoll = -0.055 * drawAmount;
      const recoilDamp = WEAPONS[S.wpIdx].viewModel === "pistol" ? 11.2 : 13.6;
      vmRecoilBack += (0 - vmRecoilBack) * Math.min(1, dt * recoilDamp);
      vmRecoilPitch += (0 - vmRecoilPitch) * Math.min(1, dt * (recoilDamp * 1.15));
      vmRecoilRoll += (0 - vmRecoilRoll) * Math.min(1, dt * (recoilDamp * 1.35));
      if(vmMuzzleFlashT > 0){
        vmMuzzleFlashT = Math.max(0, vmMuzzleFlashT - dt);
        const flash01 = clamp(vmMuzzleFlashT / Math.max(0.0001, vmMuzzleFlashDur), 0, 1);
        if(vmMuzzleFlash) vmMuzzleFlash.visible = true;
        if(vmMuzzleFlashLight) vmMuzzleFlashLight.intensity = vmMuzzleFlashPeak * flash01;
      } else {
        if(vmMuzzleFlash) vmMuzzleFlash.visible = false;
        if(vmMuzzleFlashLight) vmMuzzleFlashLight.intensity = 0;
      }
      if(vmReloadActive){
        vmReloadT = Math.min(1, vmReloadT + dt / vmReloadDur);
        if(vmReloadT >= 0.999){
          vmReloadActive = false;
        }
      } else {
        vmReloadT = Math.max(0, vmReloadT - dt * vmReloadProfile.settleSpeed);
      }
      const reloadArc = Math.sin(vmReloadT * Math.PI);
      const isSniperVm = WEAPONS[S.wpIdx].viewModel === "sniper";
      const wobbleEnvelope = Math.max(0, 1 - Math.abs(vmReloadT - 0.5) * 2);
      const reloadWobble = Math.sin(vmReloadT * Math.PI * vmReloadProfile.wobbleFreq) * wobbleEnvelope;
      const emptyBoost = vmReloadFromEmpty ? 1.14 : 1;
      // בזמן רילואד של סנייפר – המודל "נשאב" טיפה פנימה בעומק (רחוק מהשחקן),
      // וברגע שהאנימציה מסתיימת הוא חוזר למיקום הבסיסי (reloadArc חוזר ל־0).
      const sniperReloadZOffset =
        isSniperVm
          ? reloadArc * SNIPER_RELOAD_BACK_EXTRA
          : 0;
      if (isSniperVm) {
        // לצלף: בזמן רילואד מזיזים את המודל כמעט רק קדימה/אחורה בעומק,
        // בלי סיבוב גדול של כל הנשק (אין roll/yaw/pitch אגרסיביים).
        vmGroup.position.set(
          vmBaseX + bobX,
          vmBaseY + bobY - vmRecoilY - (recoilBloom * 0.01) + vmDrawYOffset,
          vmBaseZ
            + reloadArc * vmReloadProfile.back * emptyBoost
            + sniperReloadZOffset
            + vmRecoilBack
            + vmDrawZOffset,
        );
        vmGroup.rotation.set(
          vmRecoilPitch + vmDrawPitch,
          vmBaseRotY,
          vmRecoilRoll + vmDrawRoll,
        );
      } else {
        vmGroup.position.set(
          vmBaseX + bobX + reloadArc * vmReloadProfile.side * emptyBoost + reloadWobble * vmReloadProfile.wobble * 0.24,
          vmBaseY + bobY - vmRecoilY - (recoilBloom*0.01) - reloadArc * vmReloadProfile.down * emptyBoost + vmDrawYOffset,
          vmBaseZ
            + reloadArc * vmReloadProfile.back * emptyBoost
            + sniperReloadZOffset
            + vmRecoilBack
            + vmDrawZOffset,
        );
        vmGroup.rotation.set(
          reloadArc * vmReloadProfile.pitch * emptyBoost + reloadWobble * vmReloadProfile.wobble * 0.52 + vmRecoilPitch + vmDrawPitch,
          vmBaseRotY + reloadWobble * vmReloadProfile.yaw * emptyBoost,
          -reloadArc * vmReloadProfile.roll * emptyBoost + reloadWobble * vmReloadProfile.wobble + vmRecoilRoll + vmDrawRoll,
        );
      }
      updateVmAnim(dt, nowSec);

      if(moving && onGround){
        headBobT += dt * (S.running ? 13.2 : 8.8);
      }
      const speedRatio = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);
      const headBobVert = onGround ? Math.sin(headBobT) * 0.032 * speedRatio : 0;
      const headBobHoriz = onGround ? Math.sin(headBobT * 0.5 + 0.3) * 0.012 * speedRatio : 0;
      headBobY += (headBobVert - headBobY) * Math.min(1, dt * 12);
      headBobX += (headBobHoriz - headBobX) * Math.min(1, dt * 12);
      landingKick += (0 - landingKick) * Math.min(1, dt * 11);
      const targetCrouch = S.crouching ? 1 : 0;
      crouchLerp += (targetCrouch - crouchLerp) * Math.min(1, dt * (S.sliding ? 18 : 12));
      pitchObj.position.y = headBobY - landingKick - crouchLerp * CROUCH_CAMERA_DROP;
      pitchObj.position.x = headBobX;

      //  Camera FOV for ADS (zoom on right-click) 
      const fovBoost = S.aiming ? 0 : clamp((horizontalSpeed / MOVE_SPEED) * (S.running ? 4.5 : 2.1), 0, 5.8);
      // מעבר חלק יותר בין FOV רגיל ל-ADS – תחושה שהכוונת מתקרבת לפנים
      const adsFov = ADS_FOV[WEAPONS[S.wpIdx].viewModel];
      const baseFov = 72 + fovBoost;
      const targetAdsFov = adsFov + fovBoost;
      const targetAdsBlend = S.aiming ? 1 : 0;
      // מעבר חלק מאוד בין מצב רגיל ל-ADS (ease-in-out)
      adsBlend += (targetAdsBlend - adsBlend) * Math.min(1, dt * 6);
      const easedAdsBlend = adsBlend * adsBlend * (3 - 2 * adsBlend); // smoothstep
      const targetFov = baseFov + (targetAdsFov - baseFov) * easedAdsBlend;
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }

      //  Render world, then overlay viewmodel (no extra minimap render; MiniMap uses same texture)
      renderer.autoClear = true;
      composer.render();
      renderer.autoClear = false;
      renderer.clearDepth();
      // בזמן כוונת צלף (ADS עם sniper) לא מציירים את מודל הנשק – רק את העולם
      const suppressViewmodel = S.aiming && WEAPONS[S.wpIdx].viewModel === "sniper";
      if (!suppressViewmodel) {
        renderer.render(vmScene, vmCamera);
      }

      // החזרה אוטומטית למצב כוונת לסנייפר – רק אחרי סוף אנימציית הירי,
      // אם השחקן עדיין מחזיק קליק ימני, ורק כשלא ברילואד.
      if (
        WEAPONS[S.wpIdx].viewModel === "sniper" &&
        !S.dead &&
        !S.reloading &&
        rightMouseHeld &&
        !S.aiming &&
        nowSec >= sniperAimLockUntil
      ) {
        S.aiming = true;
        setIsAiming(true);
      }

      // עדכון נתוני HUD ומפות – בתדירות גבוהה יותר כדי לסנכרן חצים (שחקן+בוטים)
      if (hudT > 0.04) {
        hudT = 0;
        setPlayerHp(Math.max(0, S.hp));
        setAmmo(S.ammo);
        yawObj.getWorldPosition(_playerWorldPos);
        yawObj.getWorldQuaternion(_playerWorldQuat);
        _playerForward.set(0, 0, -1).applyQuaternion(_playerWorldQuat);
        setPlayerCoords({
          x: _playerWorldPos.x,
          y: _playerWorldPos.y,
          z: _playerWorldPos.z,
        });
        setPlayerYaw(yawObj.rotation.y);
        setPlayerForward({ x: _playerForward.x, z: _playerForward.z });
        setBotPositionsForTactical(
          bots.map((b) => {
            b.mesh.getWorldPosition(_botWorldPos);
            // כמו לשחקן: כיוון הבוט נלקח מה-quaternion העולמי של המודל
            b.mesh.getWorldQuaternion(_playerWorldQuat);
            _playerForward.set(0, 0, -1).applyQuaternion(_playerWorldQuat);
            const fwdX = _playerForward.x;
            const fwdZ = _playerForward.z;
            return { x: _botWorldPos.x, z: _botWorldPos.z, forwardX: fwdX, forwardZ: fwdZ };
          }),
        );
        if (DEBUG_MINIMAP_POSITION) {
          minimapDebugAccum += 0.1;
          if (minimapDebugAccum >= 2) {
            minimapDebugAccum = 0;
            const first = bots.find((b) => !b.dead);
            if (first) {
              first.mesh.getWorldPosition(_botWorldPos);
              const bounds = getTacticalConfig(selectedMapId).worldBounds;
              const mapNorm = worldToMapNormalized(_botWorldPos.x, _botWorldPos.z, bounds);
              const fwdX = Math.sin(first.yaw);
              const fwdZ = -Math.cos(first.yaw);
              console.log("[Minimap debug] enemy getWorldPosition():", { x: _botWorldPos.x, z: _botWorldPos.z }, "| map normalized (0-1):", mapNorm);
              setDebugEnemyMap({
                worldX: _botWorldPos.x,
                worldZ: _botWorldPos.z,
                mapX: mapNorm.x,
                mapY: mapNorm.y,
                forwardX: fwdX,
                forwardZ: fwdZ,
              });
            } else {
              setDebugEnemyMap(null);
            }
          }
        }
      }
      rafId=requestAnimationFrame(animate);
    };
    rafId=requestAnimationFrame(animate);

    return()=>{
      cancelAnimationFrame(rafId); ro.disconnect();
      unsubPlm?.();
      plmRef.current?.setCanvas(null);
      plmRef.current?.releaseLock();
      renderer.domElement.removeEventListener("mousedown",onMouseDown);
      renderer.domElement.removeEventListener("mousedown",onMouseDownTrack);
      renderer.domElement.removeEventListener("mouseup",onMouseUpTrack);
      document.removeEventListener("wheel", onWheel as any);
      document.removeEventListener("mousemove",onMouseMove);
      document.removeEventListener("keydown",onKeyDown);
      document.removeEventListener("keyup",onKeyUp);
      composer.dispose();
      bloomPass.dispose();
      shotAudio?.stop();
      for(const bot of bots){
        bot.mixer?.stopAllAction();
        const hpTexture = bot.mesh.userData.hpLabelTexture as THREE.CanvasTexture | undefined;
        const hpSprite = bot.mesh.userData.hpLabelSprite as THREE.Sprite | undefined;
        hpTexture?.dispose();
        if(hpSprite){
          (hpSprite.material as THREE.Material).dispose();
        }
      }
      if (spawnVisualGroup.parent) spawnVisualGroup.parent.remove(spawnVisualGroup);
      disposeSpawnVisualGroup(spawnVisualGroup);
      projGeo.dispose(); renderer.dispose();
      if(renderer.domElement.parentElement===mount) mount.removeChild(renderer.domElement);
    };
  },[sessionKey, fpsAssets, flatSpawnIdx, botSpawnIdx, botWeaponPool, sessionStarted, showIntro]);

  const wp=WEAPONS[wpIdx];
  // Crosshair gap tuning per weapon (CS-style). Scale drives the gap and arm length.
  const baseCrosshair =
    wp.viewModel === "pistol"  ? 0.8  :
    wp.viewModel === "ak47"    ? 1.0  :
    // שוטגן – כוונת בסיסית רחבה יותר כדי לשקף את הספריי
    wp.viewModel === "shotgun" ? 1.4  :
    /* sniper */                 0.7;
  const bloomMult =
    wp.viewModel === "pistol"  ? 0.46 :
    wp.viewModel === "ak47"    ? 0.62 :
    // שוטגן – הגאפ של הכוונת מגיב חזק יותר ל-bloom
    wp.viewModel === "shotgun" ? 0.95 :
    /* sniper */                 0.5;
  const crosshairScale = clamp(
    (isAiming && wp.viewModel === "sniper" ? 0.6 : baseCrosshair) + crosshairBloom * bloomMult,
    0.45,
    wp.viewModel === "shotgun" ? 2.6 : 2.1,
  );
  // הכוונת תמיד מוצגת לכל הנשקים חוץ מהסנייפר (שיש לו סקופ ייעודי),
  // ללא תלות בפוינטר-לוק כדי למנוע מצבים "רנדומליים" שבהם הכוונת נעלמת בשוטגן/אקדח.
  const showCrosshair = !dead && wp.viewModel !== "sniper";
  const roundClock = formatTimer(roundTime);

  // HUD scale – מתאים את גודל ה-HP/אינוונטורי לרוחב חלון המשחק (S/M/L)
  const HUD_BASE_WIDTH = 960;
  const hudScale =
    stageSizePreset === "small"  ? 0.7  :
    stageSizePreset === "medium" ? 1.0  :
    stageSizePreset === "large"  ? 1.15 :
    stageSize && stageSize.width
      ? clamp(stageSize.width / HUD_BASE_WIDTH, 0.7, 1.2)
      : 1;

  const introTacticalConfig = getTacticalConfig(selectedMapId || "flat");
  const introBounds = introTacticalConfig.worldBounds;

  return (
    <main className="bits-sniper-page">
      <style>{`
        .bits-sniper-vcursor{
          position:absolute;
          left:0; top:0;
          width:14px; height:14px;
          border:2px solid rgba(255,255,255,0.95);
          border-radius:999px;
          pointer-events:none;
          z-index:80;
          box-shadow: 0 0 14px rgba(0,0,0,0.45), 0 0 24px rgba(255,70,70,0.12);
        }
        .bits-sniper-pause-overlay [data-vhover="1"]{
          outline: 2px solid rgba(255,255,255,0.65);
          box-shadow: 0 0 0 4px rgba(90,200,255,0.18);
        }
      `}</style>
      <section
        ref={shellRef}
        className={`bits-sniper-shell${stageSize ? "" : " bits-sniper-shell--fluid"}${shellPosition ? " bits-sniper-shell--floating" : ""}${!isFullscreen ? " bits-sniper-shell--has-drag" : ""}`}
        style={{
          ...( { "--bits-sniper-hud-scale": hudScale } as React.CSSProperties ),
          ...(shellPosition ? { left: shellPosition.x, top: shellPosition.y } : {}),
          ...(stageSize
            ? {
                width: stageSize.width + SHELL_PADDING_PX,
                maxWidth: "none",
                marginLeft: "auto",
                marginRight: "auto",
              }
            : {}),
        }}
      >
        {!isFullscreen && (
          <div
            className="bits-sniper-shell-drag"
            onPointerDown={beginShellDrag}
            role="presentation"
            title="גרור להזזת חלון המשחק"
            aria-label="גרור להזזת חלון"
          >
            <span className="bits-sniper-shell-drag-dots" aria-hidden>⋮⋮</span>
          </div>
        )}

        {showDisclaimer && (
          <div className="bits-sniper-disclaimer-overlay">
            <section className="bits-sniper-disclaimer-card" aria-label="Alpha disclaimer">
              <h3>Warning - Early Alpha Build</h3>
              <p>
                This game is still in early development. You may encounter bugs, balance issues, and unfinished gameplay.
              </p>
              <button
                type="button"
                className="bits-sniper-disclaimer-btn"
                onClick={()=> setShowDisclaimer(false)}
              >
                Understood, continue
              </button>
            </section>
          </div>
        )}

        <div
          ref={stageWrapRef}
          className={`bits-sniper-stage-wrap bits-sniper-stage-wrap--${WEAPONS[wpIdx].id}${stageSize ? " bits-sniper-stage-wrap--custom-size" : ""}${sessionStarted && !isLocked && !dead && !showSettings ? " bits-sniper-stage-wrap--click-to-lock" : ""}`}
          style={stageSize ? {
            width: `${stageSize.width}px`,
            height: `${stageSize.height}px`,
            marginLeft: stageAnchor === "right" ? "auto" : stageAnchor === "center" ? "auto" : "0",
            marginRight: stageAnchor === "left" ? "auto" : stageAnchor === "center" ? "auto" : "0",
          } : undefined}
          onClick={sessionStarted && !isLocked && !dead && !showSettings ? requestLock : undefined}
          role={sessionStarted && !isLocked && !dead && !showSettings ? "button" : undefined}
          aria-label={sessionStarted && !isLocked && !dead && !showSettings ? "Click to lock mouse and play" : undefined}
        >
          <div ref={mountRef} className="bits-sniper-stage"/>

          {!showDisclaimer && showIntro && (
            <div className="bits-sniper-intro-overlay">
              <div className="bits-sniper-intro-card">
                <h2>Shell Strikers</h2>
                <p>Fast FPS in a colorful arena full of bots. Start the match, go fullscreen, lock the mouse, and survive.</p>
                <ul>
                  <li>W/A/S/D - Move | Space/F - Jump</li>
                  <li>Shift - Sprint | Mouse - Aim | Left click - Fire</li>
                  <li>Right click - ADS (Zoom) | R - Reload | 1-4 or Wheel - Switch weapon</li>
                  <li>Esc - Pause menu (in-game) | P - Pause | M or Alt+Enter - Fullscreen</li>
                </ul>
                <div className="bits-sniper-intro-tabs" role="tablist" aria-label="Intro pages">
                  <button
                    type="button"
                    className={`bits-sniper-intro-tab${introPage === "basic" ? " is-active" : ""}`}
                    onClick={()=> setIntroPage("basic")}
                    role="tab"
                    aria-selected={introPage === "basic"}
                  >
                    Basic settings
                  </button>
                  <button
                    type="button"
                    className={`bits-sniper-intro-tab${introPage === "enemy" ? " is-active" : ""}`}
                    onClick={()=> setIntroPage("enemy")}
                    role="tab"
                    aria-selected={introPage === "enemy"}
                  >
                    Enemy & bots
                  </button>
                </div>
                {introPage === "basic" && (
                  <>
                    <div className="bits-sniper-intro-setting">
                      <span>Mouse sensitivity</span>
                      <input
                        type="range"
                        min={LOOK_SENS_MIN}
                        max={LOOK_SENS_MAX}
                        step={LOOK_SENS_STEP}
                        value={lookSens}
                        onChange={(e)=> applyLookSensitivity(Number(e.target.value))}
                      />
                      <strong>{lookSens.toFixed(4)}</strong>
                    </div>
                    <div className="bits-sniper-intro-setting">
                      <span>Select map</span>
                      <div className="bits-sniper-map-choices">
                        {MAPS.map((m)=>(
                          <button key={m.id} type="button" className={selectedMapId===m.id ? "is-active" : ""} onClick={()=> applySelectedMap(m.id)}>{m.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="bits-sniper-intro-setting">
                      <span>ADS sensitivity (while aiming)</span>
                      <input type="range" min={ADS_SENS_MIN} max={ADS_SENS_MAX} step={ADS_SENS_STEP} value={adsSens} onChange={(e)=> applyAdsSensitivity(Number(e.target.value))} />
                      <strong>{adsSens.toFixed(2)}x</strong>
                    </div>
                    <div className="bits-sniper-intro-setting">
                      <span>Master volume</span>
                      <input type="range" min={MASTER_VOL_MIN} max={MASTER_VOL_MAX} step={MASTER_VOL_STEP} value={masterVolume} onChange={(e)=> applyMasterVolume(Number(e.target.value))} />
                      <strong>{Math.round(masterVolume * 100)}%</strong>
                    </div>
                  </>
                )}
                {introPage === "enemy" && (
                  <>
                    <div className="bits-sniper-intro-setting bits-sniper-intro-setting--spawn-map">
                      <span>Spawn points – click on the map</span>
                      <p className="bits-sniper-intro-spawn-hint">
                        <strong>Left click</strong> → add Enemy spawn · <strong>Right click</strong> → set Your spawn · <strong>Click on a point again</strong> → delete
                      </p>
                      <SpawnSelectionMap
                        mapImageUrl={tacticalMapImage}
                        bounds={introBounds}
                        value={{
                          player: customPlayerSpawn ? { id: "player", type: "player", worldPosition: customPlayerSpawn } : null,
                          enemies: customEnemySpawns,
                        }}
                        onChange={(player, enemies) => {
                          setCustomPlayerSpawn(player?.worldPosition ?? null);
                          setCustomEnemySpawns(enemies);
                        }}
                      />
                      <p className="bits-sniper-intro-spawn-legend" aria-hidden>
                        <span className="bits-sniper-legend-dot is-player" /> Your spawn · <span className="bits-sniper-legend-dot is-enemy" /> Enemy spawn
                      </p>
                    </div>
                    <div className="bits-sniper-intro-setting">
                      <span>Bot weapon pool (weapons enemies can use)</span>
                      <div className="bits-sniper-weapon-pool">
                        {WEAPONS.map((w, idx)=>(
                          <label key={w.id} className="bits-sniper-weapon-pool-item">
                            <input type="checkbox" checked={botWeaponPool.includes(idx)} onChange={()=>{ if(botWeaponPool.includes(idx)){ if(botWeaponPool.length<=1) return; setBotWeaponPool(botWeaponPool.filter(i=>i!==idx)); } else { setBotWeaponPool([...botWeaponPool, idx].sort((a,b)=>a-b)); } }} />
                            <span>{w.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <div className="bits-sniper-intro-actions">
                  {introPage === "basic" && <button type="button" className="bits-sniper-intro-step" onClick={()=> setIntroPage("enemy")}>Enemy settings →</button>}
                  {introPage === "enemy" && <button type="button" className="bits-sniper-intro-step" onClick={()=> setIntroPage("basic")}>← Basic settings</button>}
                  <button type="button" className="bits-sniper-intro-fullscreen" onClick={(e)=>{ e.stopPropagation(); toggleFullscreen(); }}>Fullscreen</button>
                  <button type="button" className="bits-sniper-intro-start" onClick={()=>{ customSpawnsForSessionRef.current = { player: customPlayerSpawn, enemies: customEnemySpawns.map((p) => p.worldPosition) }; const settings: GameSettings = { ...loadSettingsFromStorage(), botSpawnIdx, botWeaponPool }; saveSettingsToStorage(settings); gameBus.emit({ type: "SettingsApplied", settings }); gameBus.emit({ type: "StartMatch" }); setShowIntro(false); setSessionStarted(true); requestLock(); }}>Start Match</button>
                </div>
              </div>
            </div>
          )}

          {!isFullscreen && (
            <div className="bits-sniper-game-resize-ui" aria-hidden>
              <button
                type="button"
                className="bits-sniper-resize-handle bits-sniper-resize-handle--left"
                onPointerDown={(event)=>beginStageResize(event, 1, "center")}
                title="גרור מהקצה השמאלי לשינוי גודל"
                aria-label="שינוי גודל חלון המשחק מהצד השמאלי"
              />
              <button
                type="button"
                className="bits-sniper-resize-handle bits-sniper-resize-handle--right"
                onPointerDown={(event)=>beginStageResize(event, 1, "center")}
                title="גרור מהקצה הימני לשינוי גודל"
                aria-label="שינוי גודל חלון המשחק מהצד הימני"
              />
              <button
                type="button"
                className="bits-sniper-resize-handle bits-sniper-resize-handle--bottom-left"
                onPointerDown={(event)=>beginStageResize(event, 1, "center")}
                title="גרור מהפינה השמאלית-תחתונה לשינוי גודל"
                aria-label="שינוי גודל מהפינה השמאלית-תחתונה"
              />
              <button
                type="button"
                className="bits-sniper-resize-handle bits-sniper-resize-handle--bottom-right"
                onPointerDown={(event)=>beginStageResize(event, 1, "center")}
                title="גרור מהפינה הימנית-תחתונה לשינוי גודל"
                aria-label="שינוי גודל מהפינה הימנית-תחתונה"
              />
              <div className="bits-sniper-size-controls" role="group" aria-label="גודל חלון המשחק">
                <button
                  type="button"
                  className={`bits-sniper-size-chip${stageSizePreset==="small" ? " is-active" : ""}`}
                  onClick={(e)=>{ e.stopPropagation(); applyStagePreset("small"); }}
                >
                  S
                </button>
                <button
                  type="button"
                  className={`bits-sniper-size-chip${stageSizePreset==="medium" ? " is-active" : ""}`}
                  onClick={(e)=>{ e.stopPropagation(); applyStagePreset("medium"); }}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`bits-sniper-size-chip${stageSizePreset==="large" ? " is-active" : ""}`}
                  onClick={(e)=>{ e.stopPropagation(); applyStagePreset("large"); }}
                >
                  L
                </button>
              </div>
            </div>
          )}
          {!fpsAssets && (
            <div className="bits-sniper-paused-pill">Loading FPS assets...</div>
          )}

          {/* Fullscreen FAB הוסר – המיני-מפה תופסת את הפינה הימנית-עליונה */}

          {/* Player coordinates (debug) */}
          {isLocked && !dead && (
            <div className="bits-sniper-coords" aria-hidden>
              X {playerCoords.x.toFixed(1)} | Y {playerCoords.y.toFixed(1)} | Z {playerCoords.z.toFixed(1)}
            </div>
          )}

          {/* Crosshair (FPS-style center); אפקט כיווץ/שחרור באקדח ו-AK */}
          {showCrosshair && (
            <div
              key={crosshairSqueezeAt}
              className={`bits-sniper-crosshair${
                isAiming && wp.viewModel === "sniper"
                  ? " bits-sniper-crosshair--sniper-ads"
                  : isAiming && wp.viewModel !== "shotgun"
                    ? " bits-sniper-crosshair--ads"
                    : ""
              }${crosshairSqueezeAt > 0 && (wp.id === "rifle" || wp.id === "scrambler") ? " bits-sniper-crosshair--squeeze" : ""}`}
              style={{ ["--crosshair-scale" as string]: crosshairScale } as React.CSSProperties}
              aria-hidden
            />
          )}

          {/* Sniper scope overlay – טבעת צלף מלאה עם השחרה מסביב (נכנסת ויוצאת באנימציית fade) */}
          {isLocked && !dead && wp.viewModel === "sniper" && (
            <div
              className={`bits-sniper-scope-overlay${isAiming ? " bits-sniper-scope-overlay--on" : ""}`}
              aria-hidden
            >
              <div className="bits-sniper-scope-ring">
                <div className="bits-sniper-scope-line bits-sniper-scope-line--vert" />
                <div className="bits-sniper-scope-line bits-sniper-scope-line--horiz" />
              </div>
            </div>
          )}

          {/* Damage flash */}
          {hitFlash>0&&(
            <div className="bits-sniper-damage-flash" style={{ opacity: hitFlash*0.42 }} aria-hidden/>
          )}

          {lowHpFx>0&&!dead&&(
            <div className="bits-sniper-lowhp-vignette" style={{ opacity: clamp(lowHpFx*0.8, 0, 0.82) }} aria-hidden/>
          )}

          {lowHpFx>0.16&&isLocked&&!dead&&(
            <div className="bits-sniper-lowhp-alert" style={{ opacity: clamp(lowHpFx*1.15, 0, 1) }} aria-hidden>
              LOW HP
            </div>
          )}

          {/* Hit marker when damaging bots */}
          {hitMarker>0&&isLocked&&!dead&&(
            <div className="bits-sniper-hitmarker" style={{ opacity: hitMarker }} aria-hidden/>
          )}

          {/* Spawn shield */}
          {shield>0&&!dead&&(
            <div className="bits-sniper-shield-wrap" style={{
              boxShadow: `inset 0 0 ${40*shield}px rgba(60,190,255,${0.32*Math.min(shield,1)})`,
              borderColor: `rgba(60,190,255,${0.5*Math.min(shield,1)})`,
            }}>
              <div className="bits-sniper-shield-label">Spawn Shield {shield.toFixed(1)}s</div>
            </div>
          )}

          {/* Hit direction indicators */}
          {hitInds.map((h,i)=>(
            <div key={i} className="bits-sniper-hit-ind" style={{ transform: `rotate(${h.angle}rad)` }}>
              <div className="bits-sniper-hit-ind-bar" style={{ opacity: h.opacity*0.95 }}/>
            </div>
          ))}

          {killFeed.length>0&&(
            <div className="bits-sniper-kill-feed" aria-live="polite">
              {killFeed.map((entry)=>(
                <div
                  key={entry.id}
                  className={`bits-sniper-kill-feed-item${entry.headshot ? " is-headshot" : ""}`}
                  style={{ opacity: clamp(entry.ttl / KILL_FEED_TTL_SECS, 0, 1) }}
                >
                  {entry.text}
                </div>
              ))}
            </div>
          )}

          {/* Death overlay */}
          {dead&&(
            <div className="bits-sniper-death-overlay">
              <div className="bits-sniper-death-title">Eliminated</div>
              <div className="bits-sniper-death-timer">Respawn in {Math.ceil(respawnT)}s...</div>
            </div>
          )}

          {/* Tactical Map (Top-Down) – M toggles */}
          {tacticalMapOpen && sessionStarted && (
            <TacticalMapOverlay
              mapId={selectedMapId}
              mapImageOverride={tacticalMapImage ?? undefined}
              player={{ x: playerCoords.x, z: playerCoords.z, forwardX: playerForward.x, forwardZ: playerForward.z }}
              enemies={botPositionsForTactical}
              showSpawnPoints
              onClose={()=> setTacticalMapOpen(false)}
            />
          )}

          {runState === "paused" && !dead && (
            <div
              ref={pauseOverlayRootRef}
              className="bits-sniper-pause-overlay"
              role="dialog"
              aria-label="Pause menu"
              onContextMenu={(e)=> e.preventDefault()}
            >
              <div className="bits-sniper-pause-card">
                <h3>Paused</h3>
                {isLocked ? (
                  <p>
                    Soft pause (pointer lock kept). Move mouse to move the virtual cursor, left click to select. Press <b>P</b> to resume.
                  </p>
                ) : (
                  <p>
                    Pointer lock is released (ESC / focus loss). Click Resume to re-lock and return.
                  </p>
                )}
                <button data-vclick type="button" onClick={resumeGame}>Resume</button>
                <button data-vclick type="button" onClick={toggleFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
                <button data-vclick type="button" onClick={startFreshSession}>New Session</button>
              </div>

              {/* Virtual cursor rendered only when pointer lock is kept */}
              {isLocked && <div ref={vCursorElRef} className="bits-sniper-vcursor" aria-hidden />}
            </div>
          )}

          {/* Single start prompt only before first start; after that, stage is click-to-lock with no intermediate menu */}
          {!isLocked && !dead && showIntro && (
            <button type="button" className="bits-sniper-lock-btn" onClick={requestLock}>
              Click to start
            </button>
          )}

          {showSettings && !isLocked && (
            <div ref={settingsOverlayRef} className="bits-sniper-settings-overlay">
              <section className="bits-sniper-settings-panel" aria-label="Settings panel">
                <header className="bits-sniper-settings-head">
                  <h3>Game Settings</h3>
                  <button type="button" onClick={()=> setShowSettings(false)} aria-label="Close settings">X</button>
                </header>

                <div className="bits-sniper-settings-row">
                  <span>Mouse sensitivity</span>
                  <input
                    type="range"
                    min={LOOK_SENS_MIN}
                    max={LOOK_SENS_MAX}
                    step={LOOK_SENS_STEP}
                    value={lookSens}
                    onChange={(e)=> applyLookSensitivity(Number(e.target.value))}
                  />
                  <strong>{lookSens.toFixed(4)}</strong>
                </div>
                <div className="bits-sniper-settings-row">
                  <span>ADS sensitivity (while aiming)</span>
                  <input
                    type="range"
                    min={ADS_SENS_MIN}
                    max={ADS_SENS_MAX}
                    step={ADS_SENS_STEP}
                    value={adsSens}
                    onChange={(e)=> applyAdsSensitivity(Number(e.target.value))}
                  />
                  <strong>{adsSens.toFixed(2)}x</strong>
                </div>
                <div className="bits-sniper-settings-row">
                  <span>Master volume</span>
                  <input
                    type="range"
                    min={MASTER_VOL_MIN}
                    max={MASTER_VOL_MAX}
                    step={MASTER_VOL_STEP}
                    value={masterVolume}
                    onChange={(e)=> applyMasterVolume(Number(e.target.value))}
                  />
                  <strong>{Math.round(masterVolume * 100)}%</strong>
                </div>
                <div className="bits-sniper-settings-row">
                  <span>Select map</span>
                  <div className="bits-sniper-map-choices">
                    {MAPS.map((m)=>(
                      <button
                        key={m.id}
                        type="button"
                        className={selectedMapId===m.id ? "is-active" : ""}
                        onClick={()=> applySelectedMap(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bits-sniper-settings-actions">
                  <button type="button" className="bits-sniper-settings-btn" onClick={toggleFullscreen}>
                    {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  </button>
                  <button type="button" className="bits-sniper-settings-btn is-reset" onClick={startFreshSession}>
                    New Session
                  </button>
                  <button type="button" className="bits-sniper-settings-btn is-primary" onClick={requestLock}>
                    Back to Match
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* HUD - bottom left (HP, weapons, ammo) */}
          {isLocked && !dead && !(isAiming && wp.viewModel === "sniper") && (
            <>
            <div className={`bits-sniper-hud${stageSizePreset==="small" ? " bits-sniper-hud--small" : ""}`}>
              <div className="bits-sniper-hp-row">
                <span className="bits-sniper-hp-icon" aria-hidden>HP</span>
                <div className="bits-sniper-hp-track">
                  <div className="bits-sniper-hp-fill" style={{
                    width: `${clamp(playerHp,0,100)}%`,
                    background: playerHp>50 ? "linear-gradient(90deg,#2ee872,#38ef70)" : playerHp>25 ? "linear-gradient(90deg,#f0a830,#f0c038)" : "linear-gradient(90deg,#e83030,#f04040)",
                  }}/>
                </div>
                <span className="bits-sniper-hp-value">{Math.ceil(playerHp)}</span>
              </div>
              <div className="bits-sniper-weapon-slots">
                {WEAPONS.map((w,i)=>(
                  <div key={w.id} className={`bits-sniper-weapon-slot${i===wpIdx ? " is-active" : ""}`}>
                    <span className="bits-sniper-weapon-emoji">{w.emoji}</span>
                    <span className="bits-sniper-weapon-num">{i+1}</span>
                  </div>
                ))}
              </div>
              <div className="bits-sniper-ammo-row">
                <span className="bits-sniper-ammo-icon">AMMO</span>
                <span className={`bits-sniper-ammo-count${reloading ? " is-reload" : ""}`}>
                  {ammo} / {maxAmmo}
                </span>
                <span className="bits-sniper-ammo-weapon">{wp.emoji} {wp.label}{wp.auto ? " [AUTO]" : " [SEMI]"}</span>
              </div>
              <div className="bits-sniper-move-state">
                {isSliding ? "SLIDE" : isCrouching ? "CROUCH" : "STAND"} | {wp.hitMode.toUpperCase()}
              </div>
            </div>
            <div className="bits-sniper-coords">
              X: {playerCoords.x.toFixed(1)} | Y: {playerCoords.y.toFixed(1)} | Z: {playerCoords.z.toFixed(1)}
            </div>
            </>
          )}

          {/* HUD - פינה ימנית עליונה בסגנון COD/CS:GO: מיני־מפה + TIME/K/D */}
          {isLocked&&!dead&&(
            <div className="bits-sniper-corner-minimap">
              <div className="bits-sniper-topright">
                <span className="bits-sniper-topright-timer">TIME {roundClock}</span>
                <span className="bits-sniper-topright-bots">BOTS {BOT_COUNT}</span>
                <span className="bits-sniper-topright-kd">{kills} / {deaths}</span>
              </div>
              {sessionStarted && (
                <div className="bits-sniper-minimap-wrap">
                  <MiniMapComponent
                    mapImage={tacticalMapImage}
                    mapId={selectedMapId}
                    player={{
                      x: playerCoords.x,
                      z: playerCoords.z,
                      forwardX: playerForward.x,
                      forwardZ: playerForward.z,
                    }}
                    teammates={[]}
                    objectives={[]}
                    showEnemies
                    enemies={botPositionsForTactical}
                    size={MINIMAP_SIZE}
                    zoom={MINIMAP_ZOOM}
                    debugPosition={DEBUG_MINIMAP_POSITION}
                    debugEnemy={debugEnemyMap ?? undefined}
                  />
                </div>
              )}
            </div>
          )}
        </div>

      </section>
    </main>
  );
}
