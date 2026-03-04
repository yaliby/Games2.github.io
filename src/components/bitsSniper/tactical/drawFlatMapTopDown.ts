/**
 * Draws the flat playground as a top-down image from the same layout as createFlatPlayground.
 * Used when no static map image is provided — generates the map from code.
 */

import type { WorldBounds } from "./TacticalMapConfig";

const FLOOR_COL1 = "#7a7358";
const FLOOR_COL2 = "#9a9270";
const WALL_COL = "#6e6848";
const WALL_EDGE_COL = "#8e8668";

const ARENA_HALF = 72;
const WALL_THICK = 2.4;

/**
 * Draws the flat playground (floor + 4 walls) onto a canvas and returns a data URL.
 * Matches createFlatPlayground: arena ±72, checker 24 tiles, wall thickness 2.4.
 */
export function drawFlatMapToDataURL(
  width: number,
  height: number,
  bounds: WorldBounds
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;

  // Floor: checker (same as makeCheckerTexture repeat 24 over 144 units → 6 units per tile)
  const numTiles = 24;
  const tileW = width / numTiles;
  const tileH = height / numTiles;
  for (let i = 0; i < numTiles; i++) {
    for (let j = 0; j < numTiles; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? FLOOR_COL1 : FLOOR_COL2;
      ctx.fillRect(i * tileW, j * tileH, tileW + 1, tileH + 1);
    }
  }

  // Wall strips (top-down): same positions as addWall in createFlatPlayground
  const wallPxW = (WALL_THICK / spanX) * width;
  const wallPxH = (WALL_THICK / spanZ) * height;

  ctx.fillStyle = WALL_EDGE_COL;
  ctx.fillRect(0, 0, width, wallPxH); // south (Z = +72) → top of image
  ctx.fillRect(0, height - wallPxH, width, wallPxH); // north (Z = -72)
  ctx.fillRect(0, 0, wallPxW, height); // west (X = -72)
  ctx.fillRect(width - wallPxW, 0, wallPxW, height); // east (X = +72)

  ctx.fillStyle = WALL_COL;
  const inset = 2;
  ctx.fillRect(inset, inset, width - 2 * inset, Math.max(0, wallPxH - inset));
  ctx.fillRect(inset, height - wallPxH + inset, width - 2 * inset, Math.max(0, wallPxH - inset));
  ctx.fillRect(inset, inset, Math.max(0, wallPxW - inset), height - 2 * inset);
  ctx.fillRect(width - wallPxW + inset, inset, Math.max(0, wallPxW - inset), height - 2 * inset);

  return canvas.toDataURL("image/png");
}

/** Optional: draw once and cache by size for flat map (e.g. 512 or 1024). */
const cache: Record<string, string> = {};
export function getFlatMapDataURL(
  width: number,
  height: number,
  bounds: WorldBounds
): string {
  const key = `${width}x${height}_${bounds.minX}_${bounds.maxX}_${bounds.minZ}_${bounds.maxZ}`;
  if (!cache[key]) cache[key] = drawFlatMapToDataURL(width, height, bounds);
  return cache[key];
}
