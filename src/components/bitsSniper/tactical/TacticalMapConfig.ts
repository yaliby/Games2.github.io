/**
 * Per-map Tactical Map configuration.
 * Each 3D map has one top-down image and world bounds for coordinate mapping.
 */
export type WorldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type TacticalMapConfig = {
  mapId: string;
  /** URL to top-down texture (optional: overlay can use placeholder if empty) */
  mapImage: string;
  worldBounds: WorldBounds;
  /** Spawn points for debug overlay */
  spawnPoints: { x: number; z: number; label?: string }[];
};

/**
 * World → map uses only X and Z (Y is ignored). Top-down: world X → map X, world Z → map Y (with flip).
 * mapX = (worldX - minX) / (maxX - minX)
 * mapY = 1 - (worldZ - minZ) / (maxZ - minZ)  so world +Z = top of image.
 */
export function worldToMap(
  worldX: number,
  worldZ: number,
  bounds: WorldBounds,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  if (spanX <= 0 || spanZ <= 0) return { x: imageWidth / 2, y: imageHeight / 2 };
  const t = (worldX - bounds.minX) / spanX;
  const s = (worldZ - bounds.minZ) / spanZ;
  const x = t * imageWidth;
  const y = (1 - s) * imageHeight;
  return { x, y };
}

/** Normalized 0–1. Input: world X/Z only. Map Y flip: world +Z → y=0 (top). */
export function worldToMapNormalized(
  worldX: number,
  worldZ: number,
  bounds: WorldBounds
): { x: number; y: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  if (spanX <= 0 || spanZ <= 0) return { x: 0.5, y: 0.5 };
  const x = (worldX - bounds.minX) / spanX;
  const y = 1 - (worldZ - bounds.minZ) / spanZ;
  return { x, y };
}

const ARENA = 72;
// Flat playground: walls at ±ARENA (72) – minimap bounds must match so player position is correct.
const FLAT_ARENA_HALF = ARENA;

export const TACTICAL_MAP_CONFIGS: Record<string, TacticalMapConfig> = {
  flat: {
    mapId: "flat",
    mapImage: "", // placeholder / generated from code
    worldBounds: {
      minX: -FLAT_ARENA_HALF,
      maxX: FLAT_ARENA_HALF,
      minZ: -FLAT_ARENA_HALF,
      maxZ: FLAT_ARENA_HALF,
    },
    spawnPoints: [
      { x: -10, z: 0, label: "L" },
      { x: 10, z: 0, label: "R" },
      { x: 0, z: 12, label: "F" },
      { x: 0, z: -12, label: "B" },
    ],
  },
  arena: {
    mapId: "arena",
    mapImage: "",
    worldBounds: { minX: -ARENA, maxX: ARENA, minZ: -ARENA, maxZ: ARENA },
    spawnPoints: [],
  },
  dust2: {
    mapId: "dust2",
    mapImage: "", // add "bits-sniper-fps/assets/tactical/dust2_topdown.png" when available
    worldBounds: { minX: -ARENA, maxX: ARENA, minZ: -ARENA, maxZ: ARENA },
    spawnPoints: [],
  },
  levelGlb: {
    mapId: "levelGlb",
    mapImage: "",
    worldBounds: { minX: -ARENA, maxX: ARENA, minZ: -ARENA, maxZ: ARENA },
    spawnPoints: [],
  },
};

export function getTacticalConfig(mapId: string): TacticalMapConfig {
  return TACTICAL_MAP_CONFIGS[mapId] ?? TACTICAL_MAP_CONFIGS.flat;
}
