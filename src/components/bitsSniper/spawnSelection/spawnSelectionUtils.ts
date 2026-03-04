/**
 * Coordinate conversion for spawn selection map.
 * Map image: top = world minZ, bottom = world maxZ (matches top-down snapshot camera up = -Z).
 */

import type { WorldBounds } from "../tactical/TacticalMapConfig";

/** Map pixel click → world X,Z */
export function mapToWorld(
  clickX: number,
  clickY: number,
  mapWidth: number,
  mapHeight: number,
  bounds: WorldBounds
): { x: number; z: number } {
  if (mapWidth <= 0 || mapHeight <= 0) {
    return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  }
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const normX = clickX / mapWidth;
  const normY = clickY / mapHeight; // 0 = top = minZ, 1 = bottom = maxZ
  const x = bounds.minX + normX * spanX;
  const z = bounds.minZ + normY * spanZ;
  return { x, z };
}

/** World X,Z → map pixel position for drawing */
export function worldToMap(
  worldX: number,
  worldZ: number,
  mapWidth: number,
  mapHeight: number,
  bounds: WorldBounds
): { x: number; y: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  if (spanX <= 0 || spanZ <= 0) {
    return { x: mapWidth / 2, y: mapHeight / 2 };
  }
  const normX = (worldX - bounds.minX) / spanX;
  const normY = (worldZ - bounds.minZ) / spanZ; // minZ → 0 (top), maxZ → 1 (bottom)
  return { x: normX * mapWidth, y: normY * mapHeight };
}
