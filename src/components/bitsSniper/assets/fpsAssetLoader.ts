/**
 * Bits Sniper – load FPS asset pack (level, viewmodels, sounds, sky).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { FpsAssetPack, MapId } from "../types/gameTypes";
import { buildAssetUrl, FPS_ASSET_PATHS, VIEWMODEL_GLB_PATHS } from "./assetPaths";
import {
  createProceduralDust2Blockout,
} from "../BitsSniperMaps";

export const EMPTY_FPS_ASSET_PACK: FpsAssetPack = {
  mutantTemplate: null,
  mutantAnims: {},
  weaponModels: {},
  levelTemplate: null,
  muzzleFlashTemplate: null,
  shotSoundBuffer: null,
  skyTexture: null,
};

let currentMapId: MapId = "flat";

export async function loadFpsAssetPack(): Promise<FpsAssetPack> {
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

  const loadViewModel = async (
    viewModel: "pistol" | "ak47" | "shotgun" | "sniper",
    relativePath: string,
  ) => {
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
    }
  };

  const tasks: Promise<void>[] = [
    (async () => {})(),
    (async () => {
      // "flat" map: don't set levelTemplate – buildMap creates it directly
      // without rotation/scaling (which caused invisible walls).
      if (currentMapId === "flat") {
        return;
      }
      if (currentMapId === "arena") {
        pack.levelTemplate = createProceduralDust2Blockout();
        return;
      }
      const tryLoadDust2 = async () => {
        const sourceDir = buildAssetUrl("bits-sniper-fps/assets/mapPack/source/");
        mtlLoader.setPath(sourceDir);
        mtlLoader.setResourcePath(sourceDir);
        const materials = await mtlLoader.loadAsync(
          FPS_ASSET_PATHS.mapPackMtl.split("/").pop() as string,
        );
        materials.preload();
        objLoader.setMaterials(materials);
        objLoader.setPath(sourceDir);
        const mapObj = await objLoader.loadAsync(
          FPS_ASSET_PATHS.mapPackObj.split("/").pop() as string,
        );
        pack.levelTemplate = mapObj;
      };
      const tryLoadGlb = async () => {
        const gltf = await gltfLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.levelMap));
        pack.levelTemplate = gltf.scene;
      };
      try {
        if (currentMapId === "dust2") await tryLoadDust2();
        else await tryLoadGlb();
      } catch {
        try {
          if (currentMapId === "dust2") await tryLoadGlb();
          else await tryLoadDust2();
        } catch {
          // keep procedural fallback
        }
      }
    })(),
    ...(
      Object.entries(VIEWMODEL_GLB_PATHS) as Array<["pistol" | "ak47" | "shotgun" | "sniper", string]>
    ).map(([viewModel, relativePath]) => loadViewModel(viewModel, relativePath)),
    (async () => {
      try {
        const gltf = await gltfLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.muzzleFlash));
        pack.muzzleFlashTemplate = gltf.scene;
      } catch {
        // optional
      }
    })(),
    (async () => {
      try {
        pack.shotSoundBuffer = await audioLoader.loadAsync(
          buildAssetUrl(FPS_ASSET_PATHS.ak47Shot),
        );
      } catch {
        // optional
      }
    })(),
    (async () => {
      try {
        const sky = await textureLoader.loadAsync(buildAssetUrl(FPS_ASSET_PATHS.sky));
        sky.colorSpace = THREE.SRGBColorSpace;
        pack.skyTexture = sky;
      } catch {
        // fallback
      }
    })(),
  ];

  await Promise.all(tasks);
  return pack;
}

let fpsAssetPackPromise: Promise<FpsAssetPack> | null = null;

export function getFpsAssetPackOnce(mapId: MapId): Promise<FpsAssetPack> {
  currentMapId = mapId;
  if (!fpsAssetPackPromise) {
    fpsAssetPackPromise = loadFpsAssetPack();
  }
  return fpsAssetPackPromise;
}

/** Reset cached pack so next load uses the new map (e.g. after user changes map). */
export function resetFpsAssetPackPromise(): void {
  fpsAssetPackPromise = null;
}
