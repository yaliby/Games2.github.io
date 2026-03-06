/**
 * Bits Sniper – asset path constants and URL builder.
 */
import type { WeaponDef } from "../types/gameTypes";

export const FPS_ASSET_PATHS = {
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

export const VIEWMODEL_GLB_PATHS: Record<WeaponDef["viewModel"], string> = {
  pistol: "bits-sniper-fps/assets/guns/pistol/pistol.glb",
  ak47: "bits-sniper-fps/assets/guns/ak47/ak47.glb",
  shotgun: "bits-sniper-fps/assets/guns/shotgun/shotgun.glb",
  sniper: "bits-sniper-fps/assets/guns/sniper/sniper_animated.glb",
};

export function buildAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${normalizedBase}${encodedPath}`;
}
