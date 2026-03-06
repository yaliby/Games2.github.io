/**
 * Bits Sniper – stage size and timer helpers.
 */
import { clamp } from "./mathUtils";
import type { StageSize, StageSizePreset } from "../types/gameTypes";
import { STAGE_ASPECT, STAGE_PRESET_WIDTHS } from "../constants/gameConstants";

export function getStageWidthBounds(_aspect = STAGE_ASPECT) {
  const minW = 320;
  const maxW = 4096;
  return { minW, maxW };
}

export function makeStageSize(width: number, aspect = STAGE_ASPECT): StageSize {
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

export function getPresetStageSize(preset: Exclude<StageSizePreset, "custom" | "fluid">): StageSize {
  const { minW, maxW } = getStageWidthBounds();
  const width = clamp(STAGE_PRESET_WIDTHS[preset], minW, maxW);
  return makeStageSize(width);
}

export function getInitialStagePreset(): StageSizePreset {
  if (typeof window !== "undefined" && window.innerWidth < 720) return "fluid";
  return "medium";
}

export function getInitialStageSize(): StageSize | null {
  if (typeof window !== "undefined" && window.innerWidth < 720) return null;
  return getPresetStageSize("medium");
}

export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
