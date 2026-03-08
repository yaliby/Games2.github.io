/**
 * Bits Sniper – shared types and interfaces.
 */
import * as THREE from "three";

export type RecoilStep = { yaw: number; pitch: number };

export interface WeaponDef {
  id: string;
  label: string;
  emoji: string;
  viewModel: "pistol" | "ak47" | "shotgun" | "sniper";
  damage: number;
  fireRate: number;
  spread: number;
  headshotMult?: number;
  falloffStart?: number;
  falloffEnd?: number;
  damageMin?: number;
  pellets: number;
  range: number;
  ammo: number;
  maxAmmo: number;
  reloadTime: number;
  projColor: string;
  projSpeed: number;
  hitMode: "projectile" | "hitscan";
  speedMult: number;
  splash: boolean;
  splashR: number;
  splashDmg: number;
  auto: boolean;
  bodyHex: string;
  barrelLen: number;
  barrelR: number;
}

export interface ReloadAnimProfile {
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

export type BotAnimName = "idle" | "walk" | "run" | "attack" | "die";
export type VmAnimName = "idle" | "shoot" | "reload";
export type StageSizePreset = "small" | "medium" | "large" | "fluid" | "custom";
export type StageSize = { width: number; height: number };

export interface VmPose {
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRotY: number;
  muzzleX: number;
  muzzleY: number;
  muzzleZ: number;
}

export type MapId = "flat" | "warehouse" | "arena" | "dust2" | "levelGlb" | "colosseum" | "ctf";

/** "classic" = normal deathmatch; "ctf" = capture the flag 5v5. */
export type GameMode = "classic" | "ctf";

export interface ViewModelAsset {
  template: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface FpsAssetPack {
  mutantTemplate: THREE.Group | null;
  mutantAnims: Partial<Record<BotAnimName, THREE.AnimationClip>>;
  weaponModels: Partial<Record<WeaponDef["viewModel"], ViewModelAsset>>;
  levelTemplate: THREE.Group | null;
  muzzleFlashTemplate: THREE.Group | null;
  shotSoundBuffer: AudioBuffer | null;
  skyTexture: THREE.Texture | null;
}

export interface ImportedVmConfig {
  scale: number;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  pose: VmPose;
  flashOffsetX?: number;
  flashOffsetY?: number;
  flashOffsetZ?: number;
  staticScaleMul?: number;
  staticPositionOffset?: [number, number, number];
  staticRotationOffsetDeg?: [number, number, number];
  staticPose?: Partial<VmPose>;
}

export type MuzzleRatio = { x: number; y: number; z: number };
export interface ObjectBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
  size: THREE.Vector3;
}

export interface BotState {
  id: number;
  mesh: THREE.Group;
  health: number;
  dead: boolean;
  respawnTimer: number;
  velY: number;
  velX: number;
  velZ: number;
  onGround: boolean;
  yaw: number;
  targetYaw: number;
  wpIdx: number;
  fireTimer: number;
  strafeDir: number;
  strafeTimer: number;
  reloadTimer: number;
  ammo: number;
  label: string;
  lastHudHealth: number;
  animTime: number;
  animPhase: number;
  mixer?: THREE.AnimationMixer;
  animActions?: Partial<Record<BotAnimName, THREE.AnimationAction>>;
  activeAnim?: BotAnimName;
  /** Seconds of spawn invincibility remaining (no damage). */
  invincibleTimer?: number;
  /** When the bot last had target in range (for reaction delay before shooting). */
  lastTargetSeenAt?: number;
}

export interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  fromBot: boolean;
  sourceName: string;
  damage: number;
  range: number;
  traveled: number;
  splash: boolean;
  splashR: number;
  splashDmg: number;
}

export interface HitInd {
  angle: number;
  opacity: number;
}

export interface KillFeedEntry {
  id: number;
  text: string;
  ttl: number;
  headshot: boolean;
}
