/**
 * Bits Sniper – weapon definitions, recoil, reload anims, ADS FOV.
 */
import type { WeaponDef, ReloadAnimProfile, RecoilStep } from "../types/gameTypes";
import { HEADSHOT_MULT, DEG2RAD } from "../constants/gameConstants";
import { clamp } from "../utils/mathUtils";

export const ADS_FOV: Record<WeaponDef["viewModel"], number> = {
  pistol: 52,
  ak47: 48,
  shotgun: 58,
  sniper: 22,
};

export const RECOIL_PATTERNS: Record<string, RecoilStep[]> = {
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

export const WEAPONS: WeaponDef[] = [
  {
    id: "rifle",
    label: "Pistol",
    emoji: "P",
    viewModel: "pistol",
    damage: 20,
    damageMin: 14,
    falloffStart: 22,
    falloffEnd: 62,
    headshotMult: 1.65,
    fireRate: 4.2,
    spread: 0.0125,
    pellets: 1,
    range: 82,
    ammo: 16,
    maxAmmo: 16,
    reloadTime: 1.15,
    projColor: "#ffe8b0",
    projSpeed: 66,
    hitMode: "hitscan",
    speedMult: 3.25,
    splash: false,
    splashR: 0,
    splashDmg: 0,
    auto: false,
    bodyHex: "#6a9ab8",
    barrelLen: 0.72,
    barrelR: 0.038,
  },
  {
    id: "scrambler",
    label: "AK-47",
    emoji: "AK",
    viewModel: "ak47",
    damage: 18,
    damageMin: 14,
    falloffStart: 58,
    falloffEnd: 118,
    headshotMult: 1.6,
    fireRate: 7.6,
    spread: 0.025,
    pellets: 1,
    range: 130,
    ammo: 30,
    maxAmmo: 30,
    reloadTime: 1.95,
    projColor: "#ffe070",
    projSpeed: 57,
    hitMode: "hitscan",
    speedMult: 2.72,
    splash: false,
    splashR: 0,
    splashDmg: 0,
    auto: true,
    bodyHex: "#a87840",
    barrelLen: 0.5,
    barrelR: 0.048,
  },
  {
    id: "whipper",
    label: "Shotgun",
    emoji: "SG",
    viewModel: "shotgun",
    damage: 12.5,
    damageMin: 3.0,
    falloffStart: 7,
    falloffEnd: 16,
    headshotMult: 1.15,
    fireRate: 1.0,
    spread: 0.34,
    pellets: 9,
    range: 24,
    ammo: 6,
    maxAmmo: 6,
    reloadTime: 2.95,
    projColor: "#ffe066",
    projSpeed: 42,
    hitMode: "hitscan",
    speedMult: 2.0,
    splash: false,
    splashR: 0,
    splashDmg: 0,
    auto: false,
    bodyHex: "#996655",
    barrelLen: 0.36,
    barrelR: 0.068,
  },
  {
    id: "cracker",
    label: "Sniper",
    emoji: "SN",
    viewModel: "sniper",
    damage: 75,
    headshotMult: 2.35,
    fireRate: 0.65,
    spread: 0.0016,
    pellets: 1,
    range: 240,
    ammo: 5,
    maxAmmo: 5,
    reloadTime: 3.0,
    projColor: "#ff9944",
    projSpeed: 60,
    hitMode: "hitscan",
    speedMult: 3.55,
    splash: false,
    splashR: 0,
    splashDmg: 0,
    auto: false,
    bodyHex: "#c06030",
    barrelLen: 0.66,
    barrelR: 0.055,
  },
];

export function getWeaponHeadshotMult(wp: WeaponDef): number {
  return wp.headshotMult ?? HEADSHOT_MULT;
}

export function getWeaponDamageAtDistance(wp: WeaponDef, dist: number): number {
  const start = wp.falloffStart;
  const end = wp.falloffEnd;
  const min = wp.damageMin;
  if (typeof start !== "number" || typeof end !== "number" || typeof min !== "number") return wp.damage;
  if (end <= start) return wp.damage;
  const t = clamp((dist - start) / (end - start), 0, 1);
  return wp.damage + (min - wp.damage) * t;
}

export const RELOAD_ANIMS: Record<string, ReloadAnimProfile> = {
  rifle: {
    side: 0.07,
    down: 0.16,
    back: 0.22,
    pitch: 0.52,
    roll: 0.78,
    yaw: 0.085,
    wobble: 0.1,
    wobbleFreq: 4.1,
    settleSpeed: 5.4,
    tacticalTime: 0.86,
  },
  scrambler: {
    side: 0.035,
    down: 0.1,
    back: 0.14,
    pitch: 0.3,
    roll: 0.46,
    yaw: 0.055,
    wobble: 0.065,
    wobbleFreq: 5.2,
    settleSpeed: 6.2,
    tacticalTime: 0.64,
  },
  whipper: {
    side: 0.1,
    down: 0.2,
    back: 0.26,
    pitch: 0.6,
    roll: 1.22,
    yaw: 0.13,
    wobble: 0.15,
    wobbleFreq: 3.4,
    settleSpeed: 4.8,
    tacticalTime: 1.02,
  },
  cracker: {
    side: 0.13,
    down: 0.26,
    back: 0.34,
    pitch: 0.74,
    roll: 1.45,
    yaw: 0.17,
    wobble: 0.2,
    wobbleFreq: 2.8,
    settleSpeed: 4.1,
    tacticalTime: 1.2,
  },
};

export function getReloadAnimProfile(wpId: string): ReloadAnimProfile {
  return RELOAD_ANIMS[wpId] ?? RELOAD_ANIMS.rifle;
}
