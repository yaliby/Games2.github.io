import { useEffect, useMemo, useRef } from "react";
import { type BoardThemeId, useBackgammon } from "./BackgammonContext";
import {
  getMultiDieMovesForSourceTarget,
  getMultiDieTargetsForSource,
  type BackgammonState,
  type Move,
  type MultiDieTarget,
  type MoveSource,
  type MoveTarget,
  type PlayerId,
} from "./utils/gameLogic";

const MAX_DPR = 3;
const COYOTE_THEME_IMAGE_SRC = `${import.meta.env.BASE_URL}img/coyoteSmerk.png`;
const DEVOPS_TUX_IMAGE_SRC = `${import.meta.env.BASE_URL}img/babyTax.png`;
const DEVOPS_DOCKER_IMAGE_SRC = `${import.meta.env.BASE_URL}img/babyDocker.png`;
const DEVOPS_POST_IMAGE_SRC = `${import.meta.env.BASE_URL}img/babyPost.png`;
const DEVOPS_KUBA_IMAGE_SRC = `${import.meta.env.BASE_URL}img/kubagiraf.png`;
const coyoteThemeImage = typeof Image !== "undefined"
  ? (() => {
      const image = new Image();
      image.src = COYOTE_THEME_IMAGE_SRC;
      return image;
    })()
  : null;
const devopsTuxImage = typeof Image !== "undefined"
  ? (() => {
      const image = new Image();
      image.src = DEVOPS_TUX_IMAGE_SRC;
      return image;
    })()
  : null;
const devopsDockerImage = typeof Image !== "undefined"
  ? (() => {
      const image = new Image();
      image.src = DEVOPS_DOCKER_IMAGE_SRC;
      return image;
    })()
  : null;
const devopsPostImage = typeof Image !== "undefined"
  ? (() => {
      const image = new Image();
      image.src = DEVOPS_POST_IMAGE_SRC;
      return image;
    })()
  : null;
const devopsKubaImage = typeof Image !== "undefined"
  ? (() => {
      const image = new Image();
      image.src = DEVOPS_KUBA_IMAGE_SRC;
      return image;
    })()
  : null;

type Vec2 = { x: number; y: number };

type Layout = {
  width: number;
  height: number;
  pad: number;
  gutter: number;
  playX: number;
  playY: number;
  playW: number;
  playH: number;
  halfW: number;
  barW: number;
  cellW: number;
  centerY: number;
  topY: number;
  bottomY: number;
  topApex: number;
  bottomApex: number;
  checkerR: number;
  checkerStep: number;
  pointTravel: number;
  barTravel: number;
  offTravel: number;
  leftOffX: number;
  rightOffX: number;
};

type MoveAnim = {
  id: number;
  player: PlayerId;
  to: MoveTarget;
  start: Vec2;
  end: Vec2;
  startedAt: number;
  durationMs: number;
};

type SourceHandle = {
  source: MoveSource;
  moves: Move[];
  position: Vec2;
};

type BoardThemePalette = {
  sceneBgStart: string;
  sceneBgEnd: string;
  pointerAuraInner: string;
  pointerAuraMid: string;
  frameBase: string;
  frameGlossStart: string;
  frameGlossEnd: string;
  feltCenter: string;
  feltMid: string;
  feltEdge: string;
  barStart: string;
  barMid: string;
  barEnd: string;
  triangleWarmTop: string;
  triangleWarmBottom: string;
  triangleCoolTop: string;
  triangleCoolBottom: string;
  triangleStroke: string;
  centerLine: string;
  pointLabel: string;
  sideTray: string;
  offLabelBlack: string;
  offLabelWhite: string;
  barLabelBlack: string;
  barLabelWhite: string;
  vignetteEdge: string;
};

const BOARD_THEME_PALETTES: Record<BoardThemeId, BoardThemePalette> = {
  classic: {
    sceneBgStart: "#080c13",
    sceneBgEnd: "#120c0f",
    pointerAuraInner: "rgba(132,211,255,0.2)",
    pointerAuraMid: "rgba(255,177,124,0.1)",
    frameBase: "#5b3319",
    frameGlossStart: "rgba(255,210,162,0.28)",
    frameGlossEnd: "rgba(0,0,0,0.36)",
    feltCenter: "#227050",
    feltMid: "#174f3b",
    feltEdge: "#123a2c",
    barStart: "#3c2414",
    barMid: "#29160c",
    barEnd: "#3c2414",
    triangleWarmTop: "#e7a970",
    triangleWarmBottom: "#b95d27",
    triangleCoolTop: "#f4d8b9",
    triangleCoolBottom: "#c58c59",
    triangleStroke: "rgba(57,31,18,0.42)",
    centerLine: "rgba(255,248,235,0.28)",
    pointLabel: "rgba(255, 234, 210, 0.76)",
    sideTray: "rgba(18,15,13,0.28)",
    offLabelBlack: "rgba(212, 228, 255, 0.82)",
    offLabelWhite: "rgba(255, 241, 222, 0.82)",
    barLabelBlack: "rgba(206, 225, 255, 0.82)",
    barLabelWhite: "rgba(255, 240, 221, 0.82)",
    vignetteEdge: "rgba(0,0,0,0.32)",
  },
  midnight: {
    sceneBgStart: "#050b17",
    sceneBgEnd: "#120a20",
    pointerAuraInner: "rgba(116,208,255,0.22)",
    pointerAuraMid: "rgba(171,118,255,0.12)",
    frameBase: "#2b3550",
    frameGlossStart: "rgba(201,226,255,0.2)",
    frameGlossEnd: "rgba(0,0,0,0.4)",
    feltCenter: "#255d8f",
    feltMid: "#183f67",
    feltEdge: "#0f2945",
    barStart: "#1f2438",
    barMid: "#121829",
    barEnd: "#1f2438",
    triangleWarmTop: "#8fc8ff",
    triangleWarmBottom: "#3b79bf",
    triangleCoolTop: "#d7ecff",
    triangleCoolBottom: "#7fb2de",
    triangleStroke: "rgba(18,35,64,0.45)",
    centerLine: "rgba(213,234,255,0.27)",
    pointLabel: "rgba(226,242,255,0.82)",
    sideTray: "rgba(7,14,27,0.36)",
    offLabelBlack: "rgba(202,224,255,0.84)",
    offLabelWhite: "rgba(240,247,255,0.88)",
    barLabelBlack: "rgba(198,223,255,0.84)",
    barLabelWhite: "rgba(236,246,255,0.88)",
    vignetteEdge: "rgba(0,0,0,0.36)",
  },
  emerald: {
    sceneBgStart: "#07120d",
    sceneBgEnd: "#13140e",
    pointerAuraInner: "rgba(147,241,188,0.2)",
    pointerAuraMid: "rgba(255,210,136,0.12)",
    frameBase: "#5e4224",
    frameGlossStart: "rgba(255,228,182,0.24)",
    frameGlossEnd: "rgba(0,0,0,0.37)",
    feltCenter: "#2f8f68",
    feltMid: "#1f6d52",
    feltEdge: "#154739",
    barStart: "#3d2f1e",
    barMid: "#281d12",
    barEnd: "#3d2f1e",
    triangleWarmTop: "#ffd08d",
    triangleWarmBottom: "#d3892f",
    triangleCoolTop: "#e9f5df",
    triangleCoolBottom: "#8cb36a",
    triangleStroke: "rgba(54,41,25,0.42)",
    centerLine: "rgba(237,248,224,0.24)",
    pointLabel: "rgba(255,238,210,0.78)",
    sideTray: "rgba(24,17,12,0.28)",
    offLabelBlack: "rgba(214,236,219,0.86)",
    offLabelWhite: "rgba(255,245,229,0.88)",
    barLabelBlack: "rgba(206,234,214,0.86)",
    barLabelWhite: "rgba(255,244,224,0.88)",
    vignetteEdge: "rgba(0,0,0,0.34)",
  },
  sunset: {
    sceneBgStart: "#1a0906",
    sceneBgEnd: "#2a0d12",
    pointerAuraInner: "rgba(255,190,130,0.22)",
    pointerAuraMid: "rgba(255,119,160,0.14)",
    frameBase: "#73311e",
    frameGlossStart: "rgba(255,220,166,0.24)",
    frameGlossEnd: "rgba(0,0,0,0.38)",
    feltCenter: "#9c3f2c",
    feltMid: "#6f2a2c",
    feltEdge: "#4c1f2c",
    barStart: "#4b1f1a",
    barMid: "#33110f",
    barEnd: "#4b1f1a",
    triangleWarmTop: "#ffce84",
    triangleWarmBottom: "#e16a3e",
    triangleCoolTop: "#ffe8c3",
    triangleCoolBottom: "#f2a165",
    triangleStroke: "rgba(70,28,20,0.44)",
    centerLine: "rgba(255,232,206,0.27)",
    pointLabel: "rgba(255,236,214,0.8)",
    sideTray: "rgba(30,11,11,0.3)",
    offLabelBlack: "rgba(252,223,206,0.86)",
    offLabelWhite: "rgba(255,239,222,0.9)",
    barLabelBlack: "rgba(247,220,207,0.84)",
    barLabelWhite: "rgba(255,242,224,0.9)",
    vignetteEdge: "rgba(0,0,0,0.38)",
  },
  coyote: {
    sceneBgStart: "#15110b",
    sceneBgEnd: "#2a1d14",
    pointerAuraInner: "rgba(255,214,143,0.2)",
    pointerAuraMid: "rgba(227,142,85,0.14)",
    frameBase: "#7a4f2f",
    frameGlossStart: "rgba(255,225,178,0.24)",
    frameGlossEnd: "rgba(0,0,0,0.38)",
    feltCenter: "#8d6a3d",
    feltMid: "#6a4f31",
    feltEdge: "#4b3825",
    barStart: "#5f432a",
    barMid: "#3f2c1c",
    barEnd: "#5f432a",
    triangleWarmTop: "#ffcc8f",
    triangleWarmBottom: "#c97737",
    triangleCoolTop: "#f2dfc0",
    triangleCoolBottom: "#b79563",
    triangleStroke: "rgba(68,44,24,0.44)",
    centerLine: "rgba(255,235,205,0.24)",
    pointLabel: "rgba(255,236,210,0.8)",
    sideTray: "rgba(34,24,16,0.3)",
    offLabelBlack: "rgba(236,220,194,0.84)",
    offLabelWhite: "rgba(255,242,223,0.9)",
    barLabelBlack: "rgba(233,216,191,0.84)",
    barLabelWhite: "rgba(255,241,220,0.88)",
    vignetteEdge: "rgba(0,0,0,0.37)",
  },
  devops: {
    sceneBgStart: "#061018",
    sceneBgEnd: "#0a1722",
    pointerAuraInner: "rgba(87,255,173,0.2)",
    pointerAuraMid: "rgba(79,190,255,0.14)",
    frameBase: "#16424d",
    frameGlossStart: "rgba(160,255,225,0.2)",
    frameGlossEnd: "rgba(0,0,0,0.4)",
    feltCenter: "#0f5d57",
    feltMid: "#0c474a",
    feltEdge: "#0a2f3a",
    barStart: "#12313a",
    barMid: "#0a1f27",
    barEnd: "#12313a",
    triangleWarmTop: "#61ffb2",
    triangleWarmBottom: "#1f9f7f",
    triangleCoolTop: "#baf2ff",
    triangleCoolBottom: "#4bb5c9",
    triangleStroke: "rgba(13,60,70,0.46)",
    centerLine: "rgba(199,255,246,0.26)",
    pointLabel: "rgba(215,255,244,0.82)",
    sideTray: "rgba(4,22,28,0.33)",
    offLabelBlack: "rgba(189,255,236,0.85)",
    offLabelWhite: "rgba(224,255,249,0.9)",
    barLabelBlack: "rgba(176,255,231,0.84)",
    barLabelWhite: "rgba(217,255,247,0.9)",
    vignetteEdge: "rgba(0,0,0,0.4)",
  },
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function sourceKey(source: MoveSource): string {
  return typeof source === "number" ? `p:${source}` : "bar";
}

function parseSourceKey(key: string): MoveSource | null {
  if (key === "bar") return "bar";
  if (!key.startsWith("p:")) return null;
  const parsed = Number.parseInt(key.slice(2), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null;
  return parsed;
}

function makeLayout(width: number, height: number): Layout {
  const pad = Math.min(width, height) * 0.04;
  const gutter = Math.max(52, width * 0.1);
  const playX = pad + gutter;
  const playY = pad;
  const playW = Math.max(260, width - pad * 2 - gutter * 2);
  const playH = Math.max(180, height - pad * 2);
  const barW = Math.max(20, playW * 0.075);
  const halfW = (playW - barW) / 2;
  const cellW = halfW / 6;
  const centerY = playY + playH / 2;
  const checkerR = clamp(Math.min(cellW, playH * 0.085) * 0.43, 10, 28);

  return {
    width,
    height,
    pad,
    gutter,
    playX,
    playY,
    playW,
    playH,
    halfW,
    barW,
    cellW,
    centerY,
    topY: playY + playH * 0.055,
    bottomY: playY + playH * 0.945,
    topApex: centerY - playH * 0.055,
    bottomApex: centerY + playH * 0.055,
    checkerR,
    checkerStep: checkerR * 1.6,
    pointTravel: playH * 0.37,
    barTravel: playH * 0.36,
    offTravel: playH * 0.34,
    leftOffX: pad + gutter * 0.52,
    rightOffX: width - pad - gutter * 0.52,
  };
}

function columnOfPoint(point: number, mirroredX: boolean): number {
  const canonical = point < 12 ? 11 - point : point - 12;
  return mirroredX ? 11 - canonical : canonical;
}

function columnX(layout: Layout, column: number): number {
  if (column < 6) return layout.playX + layout.cellW * (column + 0.5);
  return layout.playX + layout.halfW + layout.barW + layout.cellW * (column - 6 + 0.5);
}

function stackStep(base: number, travel: number, count: number): number {
  if (count <= 1) return base;
  return Math.min(base, travel / (count - 1));
}

function pointPos(
  layout: Layout,
  point: number,
  idx: number,
  count: number,
  mirroredX: boolean,
  mirroredY: boolean
): Vec2 {
  const col = columnOfPoint(point, mirroredX);
  const x = columnX(layout, col);
  const canonicalTop = point >= 12;
  const top = mirroredY ? !canonicalTop : canonicalTop;
  const dir = top ? 1 : -1;
  const baseY = top ? layout.topY + layout.checkerR * 1.06 : layout.bottomY - layout.checkerR * 1.06;
  const step = stackStep(layout.checkerStep, layout.pointTravel, count);
  return { x, y: baseY + dir * idx * step };
}

function barPos(layout: Layout, player: PlayerId, idx: number, count: number, mirroredY: boolean): Vec2 {
  const x = layout.playX + layout.halfW + layout.barW * 0.5;
  const canonicalTop = player === "black";
  const top = mirroredY ? !canonicalTop : canonicalTop;
  const dir = top ? 1 : -1;
  const baseY = top ? layout.topY + layout.checkerR * 1.25 : layout.bottomY - layout.checkerR * 1.25;
  const step = stackStep(layout.checkerStep, layout.barTravel, count);
  return { x, y: baseY + dir * idx * step };
}

function offPos(
  layout: Layout,
  player: PlayerId,
  idx: number,
  count: number,
  mirroredX: boolean,
  mirroredY: boolean
): Vec2 {
  const x = mirroredX
    ? (player === "black" ? layout.rightOffX : layout.leftOffX)
    : (player === "black" ? layout.leftOffX : layout.rightOffX);
  const canonicalTop = player === "black";
  const top = mirroredY ? !canonicalTop : canonicalTop;
  const dir = top ? 1 : -1;
  const baseY = top ? layout.topY + layout.checkerR * 1.2 : layout.bottomY - layout.checkerR * 1.2;
  const step = stackStep(layout.checkerStep * 0.9, layout.offTravel, count);
  return { x, y: baseY + dir * idx * step };
}

function sourcePosBeforeMove(
  prev: BackgammonState,
  layout: Layout,
  player: PlayerId,
  source: MoveSource,
  mirroredX: boolean,
  mirroredY: boolean
): Vec2 {
  if (source === "bar") {
    const count = Math.max(1, prev.bar[player]);
    return barPos(layout, player, Math.max(0, count - 1), count, mirroredY);
  }
  const count = Math.max(1, prev.points[source].count);
  return pointPos(layout, source, Math.max(0, count - 1), count, mirroredX, mirroredY);
}

function targetPos(
  state: BackgammonState,
  layout: Layout,
  player: PlayerId,
  target: MoveTarget,
  mirroredX: boolean,
  mirroredY: boolean
): Vec2 {
  if (target === "off") {
    const count = Math.max(1, state.borneOff[player]);
    return offPos(layout, player, Math.max(0, count - 1), count, mirroredX, mirroredY);
  }

  const p = state.points[target];
  let count = 0;
  if (p.owner === player) count = p.count;
  else if (p.owner === null) count = 0;
  else count = 1;

  const normalized = Math.max(1, count);
  return pointPos(layout, target, Math.max(0, count - 1), normalized, mirroredX, mirroredY);
}

function pointFromPointer(layout: Layout, pointer: Vec2, mirroredX: boolean, mirroredY: boolean): number | null {
  const withinY = pointer.y >= layout.playY && pointer.y <= layout.playY + layout.playH;
  if (!withinY) return null;

  if (pointer.x < layout.playX || pointer.x > layout.playX + layout.playW) {
    return null;
  }

  const barStart = layout.playX + layout.halfW;
  const barEnd = barStart + layout.barW;
  if (pointer.x >= barStart && pointer.x <= barEnd) {
    return null;
  }

  let column = -1;
  if (pointer.x < barStart) {
    column = clamp(Math.floor((pointer.x - layout.playX) / layout.cellW), 0, 5);
  } else {
    column = 6 + clamp(Math.floor((pointer.x - barEnd) / layout.cellW), 0, 5);
  }

  const canonicalColumn = mirroredX ? 11 - column : column;
  const topSide = pointer.y < layout.centerY;
  const canonicalTop = mirroredY ? !topSide : topSide;
  return canonicalTop ? (12 + canonicalColumn) : (11 - canonicalColumn);
}

function pointerInPointTriangle(
  layout: Layout,
  pointer: Vec2,
  point: number,
  mirroredX: boolean,
  mirroredY: boolean
): boolean {
  const centerX = columnX(layout, columnOfPoint(point, mirroredX));
  const halfBase = layout.cellW * 0.48;
  const canonicalTop = point >= 12;
  const top = mirroredY ? !canonicalTop : canonicalTop;
  const baseY = top ? layout.topY : layout.bottomY;
  const apexY = top ? layout.topApex : layout.bottomApex;
  const tolerance = 1.5;
  const minY = Math.min(baseY, apexY) - tolerance;
  const maxY = Math.max(baseY, apexY) + tolerance;
  if (pointer.y < minY || pointer.y > maxY) return false;

  const height = Math.abs(baseY - apexY);
  if (height <= 0.001) return false;
  const progressToBase = clamp(Math.abs(pointer.y - apexY) / height, 0, 1);
  const allowedHalfWidth = halfBase * progressToBase + tolerance;
  return Math.abs(pointer.x - centerX) <= allowedHalfWidth;
}

function pointerInBar(layout: Layout, pointer: Vec2): boolean {
  const barStart = layout.playX + layout.halfW;
  const barEnd = barStart + layout.barW;
  const withinX = pointer.x >= barStart && pointer.x <= barEnd;
  const withinY = pointer.y >= layout.playY && pointer.y <= layout.playY + layout.playH;
  return withinX && withinY;
}

function targetFromPointer(
  layout: Layout,
  pointer: Vec2,
  player: PlayerId,
  mirroredX: boolean,
  mirroredY: boolean
): MoveTarget | null {
  const withinY = pointer.y >= layout.playY && pointer.y <= layout.playY + layout.playH;
  if (!withinY) return null;

  if (player === "black") {
    if (!mirroredX && pointer.x < layout.playX) return "off";
    if (mirroredX && pointer.x > layout.playX + layout.playW) return "off";
  } else {
    if (!mirroredX && pointer.x > layout.playX + layout.playW) return "off";
    if (mirroredX && pointer.x < layout.playX) return "off";
  }

  return pointFromPointer(layout, pointer, mirroredX, mirroredY);
}

function sourceFromPointer(
  layout: Layout,
  pointer: Vec2,
  sourceMovesMap: Map<string, Move[]>,
  mirroredX: boolean,
  mirroredY: boolean,
  strictPointTriangle = false
): MoveSource | null {
  if (pointerInBar(layout, pointer) && sourceMovesMap.has("bar")) {
    return "bar";
  }

  const point = pointFromPointer(layout, pointer, mirroredX, mirroredY);
  if (
    point !== null &&
    sourceMovesMap.has(sourceKey(point)) &&
    (!strictPointTriangle || pointerInPointTriangle(layout, pointer, point, mirroredX, mirroredY))
  ) {
    return point;
  }

  return null;
}

function pickMoveByTarget(moves: Move[], target: MoveTarget): Move | null {
  return moves.find((move) => move.to === target) ?? null;
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawReadableText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  stroke = "rgba(0, 0, 0, 0.5)"
) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 2;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawChecker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, player: PlayerId, ghost = false) {
  const base = player === "white" ? "#efe6d2" : "#1d2332";
  const edge = player === "white" ? "#c9b596" : "#6678a8";
  const highlight = player === "white" ? "#fffaf0" : "#a2b8f0";

  ctx.save();
  ctx.globalAlpha = ghost ? 0.68 : 1;

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.78, r * 0.9, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(x - r * 0.36, y - r * 0.46, r * 0.12, x, y, r * 1.05);
  grad.addColorStop(0, highlight);
  grad.addColorStop(0.48, base);
  grad.addColorStop(1, edge);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ghost ? "rgba(138,214,255,0.85)" : edge;
  ctx.lineWidth = Math.max(1.2, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = ghost ? "rgba(180,241,255,0.75)" : "rgba(255,255,255,0.56)";
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(x - r * 0.1, y - r * 0.08, r * 0.43, Math.PI * 1.18, Math.PI * 1.87);
  ctx.stroke();

  ctx.restore();
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  now: number,
  intensity = 1,
  role: "source" | "target" = "target"
) {
  const pulse = 0.7 + Math.sin((x + y) * 0.03 + now * 0.006) * 0.3;
  const isSource = role === "source";

  ctx.save();

  ctx.shadowColor = color;
  ctx.shadowBlur = r * (1.1 + intensity * 0.8);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.1 + pulse * 0.14 * intensity;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.06 + intensity * 0.22), 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = color;
  ctx.shadowBlur = r * (0.75 + intensity * 0.35);
  ctx.strokeStyle = color;
  ctx.globalAlpha = (isSource ? 0.65 : 0.55) + pulse * 0.35;
  ctx.lineWidth = Math.max(2.2, r * (0.16 + intensity * 0.05));
  ctx.beginPath();
  ctx.arc(x, y, r * (0.75 + intensity * 0.08), 0, Math.PI * 2);
  ctx.stroke();

  if (isSource) {
    ctx.globalAlpha = 0.32 + pulse * 0.2;
    ctx.lineWidth = Math.max(2.4, r * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.08 + intensity * 0.1), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.setLineDash([Math.max(3, r * 0.18), Math.max(2, r * 0.12)]);
    ctx.lineDashOffset = -now * 0.015;
    ctx.globalAlpha = 0.35 + pulse * 0.22;
    ctx.lineWidth = Math.max(1.3, r * 0.1);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.02 + intensity * 0.12), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = 0.55 + pulse * 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * (0.26 + intensity * 0.08), 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCoyoteThemeImage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  mirrored = false
) {
  const image = coyoteThemeImage;
  if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

  const cropX = 0;
  const cropY = image.naturalHeight * 0.18;
  const cropW = image.naturalWidth;
  const cropH = image.naturalHeight * 0.64;
  const cropAspect = cropW / cropH;
  const preferredW = Math.max(58, maxWidth);
  const constrainedW = Math.min(preferredW, Math.max(58, maxHeight * cropAspect));
  const drawW = constrainedW;
  const drawH = drawW / cropAspect;

  ctx.save();
  ctx.translate(x, y);
  if (mirrored) {
    ctx.scale(-1, 1);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = Math.max(6, drawH * 0.18);
  ctx.shadowOffsetY = Math.max(2, drawH * 0.05);
  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropW,
    cropH,
    -drawW * 0.5,
    -drawH * 0.5,
    drawW,
    drawH
  );

  ctx.restore();
}

function drawCoyoteCenterMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  variant: "tongue" | "wink",
  mirrored = false
) {
  ctx.save();
  ctx.translate(x, y);
  if (mirrored) {
    ctx.scale(-1, 1);
  }

  const glow = ctx.createRadialGradient(0, 0, size * 0.12, 0, 0, size * 1.45);
  glow.addColorStop(0, "rgba(255, 214, 142, 0.34)");
  glow.addColorStop(0.75, "rgba(201, 132, 74, 0.16)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.45, 0, Math.PI * 2);
  ctx.fill();

  const fur = ctx.createLinearGradient(0, -size * 0.95, 0, size * 0.82);
  fur.addColorStop(0, "rgba(255, 214, 145, 0.86)");
  fur.addColorStop(0.55, "rgba(219, 150, 87, 0.8)");
  fur.addColorStop(1, "rgba(132, 82, 47, 0.8)");
  ctx.fillStyle = fur;
  ctx.strokeStyle = "rgba(70, 45, 25, 0.62)";
  ctx.lineWidth = Math.max(1.1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(-size * 0.72, size * 0.1);
  ctx.lineTo(-size * 0.54, -size * 0.64);
  ctx.lineTo(-size * 0.19, -size * 0.26);
  ctx.lineTo(0, -size * 0.74);
  ctx.lineTo(size * 0.2, -size * 0.26);
  ctx.lineTo(size * 0.55, -size * 0.64);
  ctx.lineTo(size * 0.74, size * 0.1);
  ctx.lineTo(size * 0.2, size * 0.66);
  ctx.lineTo(0, size * 0.46);
  ctx.lineTo(-size * 0.2, size * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(70, 45, 25, 0.62)";
  ctx.lineWidth = Math.max(1, size * 0.07);
  ctx.beginPath();
  ctx.moveTo(-size * 0.42, -size * 0.28);
  ctx.lineTo(-size * 0.2, -size * 0.2);
  ctx.moveTo(size * 0.42, -size * 0.28);
  ctx.lineTo(size * 0.2, -size * 0.2);
  ctx.stroke();

  ctx.fillStyle = "rgba(43, 25, 14, 0.74)";
  if (variant === "wink") {
    ctx.beginPath();
    ctx.ellipse(-size * 0.22, -size * 0.04, size * 0.07, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(43, 25, 14, 0.78)";
    ctx.lineWidth = Math.max(1.4, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(size * 0.16, -size * 0.02);
    ctx.lineTo(size * 0.32, -size * 0.06);
    ctx.stroke();

    ctx.strokeStyle = "rgba(28, 16, 10, 0.76)";
    ctx.lineWidth = Math.max(1.1, size * 0.06);
    ctx.beginPath();
    ctx.arc(0, size * 0.2, size * 0.18, 0.2, Math.PI - 0.18);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(-size * 0.22, -size * 0.06, size * 0.07, size * 0.09, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.22, -size * 0.06, size * 0.07, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(48, 20, 12, 0.8)";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.24, size * 0.2, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(232, 116, 128, 0.88)";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.3, size * 0.1, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(28, 16, 10, 0.74)";
  ctx.beginPath();
  ctx.moveTo(-size * 0.08, size * 0.18);
  ctx.lineTo(size * 0.08, size * 0.18);
  ctx.lineTo(0, size * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawDevopsCenterMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  label: "Dev" | "Ops",
  now: number
) {
  const pulse = 0.68 + Math.sin(now * 0.006 + x * 0.01) * 0.32;
  ctx.save();
  ctx.translate(x, y);

  const w = size * 1.9;
  const h = size * 0.95;
  const r = Math.min(h * 0.5, size * 0.42);
  const pillGrad = ctx.createLinearGradient(-w * 0.5, -h * 0.5, w * 0.5, h * 0.5);
  pillGrad.addColorStop(0, "rgba(10, 51, 60, 0.76)");
  pillGrad.addColorStop(1, "rgba(8, 30, 37, 0.7)");
  roundedPath(ctx, -w * 0.5, -h * 0.5, w, h, r);
  ctx.fillStyle = pillGrad;
  ctx.fill();

  ctx.strokeStyle = `rgba(133, 255, 229, ${0.72 + pulse * 0.16})`;
  ctx.lineWidth = Math.max(1.1, size * 0.09);
  roundedPath(ctx, -w * 0.5, -h * 0.5, w, h, r);
  ctx.stroke();

  ctx.strokeStyle = "rgba(93, 218, 255, 0.55)";
  ctx.lineWidth = Math.max(0.9, size * 0.05);
  ctx.beginPath();
  ctx.moveTo(-w * 0.36, 0);
  ctx.lineTo(-w * 0.2, 0);
  ctx.moveTo(w * 0.2, 0);
  ctx.lineTo(w * 0.36, 0);
  ctx.stroke();

  ctx.fillStyle = "rgba(194, 255, 240, 0.88)";
  ctx.beginPath();
  ctx.arc(-w * 0.41, 0, Math.max(1.1, size * 0.07), 0, Math.PI * 2);
  ctx.arc(w * 0.41, 0, Math.max(1.1, size * 0.07), 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `800 ${Math.max(11, size * 0.74)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawReadableText(
    ctx,
    label,
    0,
    size * 0.03,
    "rgba(211, 255, 244, 0.95)",
    "rgba(6, 32, 39, 0.86)"
  );

  ctx.restore();
}

function drawDevopsSticker(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  angleRad: number
) {
  if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

  const cropX = image.naturalWidth * 0.12;
  const cropY = image.naturalHeight * 0.1;
  const cropW = image.naturalWidth * 0.76;
  const cropH = image.naturalHeight * 0.8;

  const drawW = Math.max(42, size);
  const drawH = drawW * (cropH / cropW);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropW,
    cropH,
    -drawW * 0.5,
    -drawH * 0.5,
    drawW,
    drawH
  );

  ctx.restore();
}

function drawThemeCenterArt(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  theme: BoardThemeId,
  now: number
) {
  if (theme !== "coyote" && theme !== "devops") return;

  const centerY = layout.centerY;
  const leftX = layout.playX + layout.halfW * 0.44;
  const rightX = layout.playX + layout.halfW + layout.barW + layout.halfW * 0.56;
  const baseSize = Math.max(22, Math.min(layout.playH * 0.09, layout.cellW * 1.56));

  if (theme === "coyote") {
    const artWidth = clamp(layout.halfW * 0.62, baseSize * 3.1, layout.playW * 0.39);
    const artHeight = artWidth * 1.02;
    const hasCoyoteImage = !!(
      coyoteThemeImage &&
      coyoteThemeImage.complete &&
      coyoteThemeImage.naturalWidth > 0 &&
      coyoteThemeImage.naturalHeight > 0
    );

    if (hasCoyoteImage) {
      drawCoyoteThemeImage(ctx, leftX, centerY, artWidth, artHeight, false);
      drawCoyoteThemeImage(ctx, rightX, centerY, artWidth, artHeight, true);
    } else {
      drawCoyoteCenterMark(ctx, leftX, centerY, baseSize, "tongue", false);
      drawCoyoteCenterMark(ctx, rightX, centerY, baseSize, "wink", true);
    }
    return;
  }

  const kubaX = leftX - baseSize * 2.35;
  const dockerX = (columnX(layout, 4) + columnX(layout, 5)) * 0.5;
  const tuxX = (columnX(layout, 6) + columnX(layout, 7)) * 0.5;
  const postX = (columnX(layout, 10) + columnX(layout, 11)) * 0.5;
  const devX = (kubaX + dockerX) * 0.5;
  const opsX = (tuxX + postX) * 0.5;
  drawDevopsCenterMark(ctx, devX, centerY, baseSize * 1.1, "Dev", now);
  drawDevopsCenterMark(ctx, opsX, centerY, baseSize * 1.1, "Ops", now);
  const stickerY = centerY + baseSize * 0.1;
  const stickerSize = clamp(layout.playW * 0.122, 62, 88);
  drawDevopsSticker(ctx, devopsKubaImage, kubaX, stickerY, stickerSize, -0.2);
  drawDevopsSticker(ctx, devopsDockerImage, dockerX, stickerY, stickerSize, -0.22);
  drawDevopsSticker(ctx, devopsTuxImage, tuxX, stickerY, stickerSize, 0.24);
  drawDevopsSticker(ctx, devopsPostImage, postX, stickerY, stickerSize, -0.16);
}

function collectSourceHandles(
  state: BackgammonState,
  sourceMovesMap: Map<string, Move[]>,
  layout: Layout,
  mirroredX: boolean,
  mirroredY: boolean
): SourceHandle[] {
  const handles: SourceHandle[] = [];
  const player = state.currentPlayer;

  for (const [key, moves] of sourceMovesMap) {
    const source = parseSourceKey(key);
    if (source === null || moves.length === 0) continue;

    if (source === "bar") {
      if (state.bar[player] <= 0) continue;
      const count = Math.max(1, state.bar[player]);
      handles.push({ source, moves, position: barPos(layout, player, count - 1, count, mirroredY) });
      continue;
    }

    const point = state.points[source];
    if (point.owner !== player || point.count <= 0) continue;
    handles.push({
      source,
      moves,
      position: pointPos(layout, source, point.count - 1, point.count, mirroredX, mirroredY),
    });
  }

  return handles;
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  now: number,
  state: BackgammonState,
  sourceMovesMap: Map<string, Move[]>,
  disableInput: boolean,
  selectedSource: MoveSource | null,
  multiDieTargets: MultiDieTarget[],
  pointer: { x: number; y: number; inside: boolean },
  animationRef: React.MutableRefObject<MoveAnim | null>,
  theme: BoardThemeId,
  mirroredX: boolean,
  mirroredY: boolean
) {
  const palette = BOARD_THEME_PALETTES[theme] ?? BOARD_THEME_PALETTES.classic;
  const bg = ctx.createLinearGradient(0, 0, layout.width, layout.height);
  bg.addColorStop(0, palette.sceneBgStart);
  bg.addColorStop(1, palette.sceneBgEnd);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (pointer.inside) {
    const aura = ctx.createRadialGradient(pointer.x, pointer.y, 16, pointer.x, pointer.y, layout.width * 0.52);
    aura.addColorStop(0, palette.pointerAuraInner);
    aura.addColorStop(0.45, palette.pointerAuraMid);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  const frameX = layout.playX - 15;
  const frameY = layout.playY - 15;
  const frameW = layout.playW + 30;
  const frameH = layout.playH + 30;

  roundedPath(ctx, frameX, frameY, frameW, frameH, 22);
  ctx.fillStyle = palette.frameBase;
  ctx.fill();

  const gloss = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  gloss.addColorStop(0, palette.frameGlossStart);
  gloss.addColorStop(0.48, "rgba(0,0,0,0)");
  gloss.addColorStop(1, palette.frameGlossEnd);
  roundedPath(ctx, frameX, frameY, frameW, frameH, 22);
  ctx.fillStyle = gloss;
  ctx.fill();

  roundedPath(ctx, layout.playX, layout.playY, layout.playW, layout.playH, 14);
  const felt = ctx.createRadialGradient(
    layout.playX + layout.playW * 0.55,
    layout.playY + layout.playH * 0.42,
    layout.playW * 0.1,
    layout.playX + layout.playW * 0.5,
    layout.playY + layout.playH * 0.5,
    layout.playW * 0.85
  );
  felt.addColorStop(0, palette.feltCenter);
  felt.addColorStop(0.7, palette.feltMid);
  felt.addColorStop(1, palette.feltEdge);
  ctx.fillStyle = felt;
  ctx.fill();

  const barX = layout.playX + layout.halfW;
  roundedPath(ctx, barX, layout.playY, layout.barW, layout.playH, 8);
  const bar = ctx.createLinearGradient(barX, layout.playY, barX + layout.barW, layout.playY + layout.playH);
  bar.addColorStop(0, palette.barStart);
  bar.addColorStop(0.5, palette.barMid);
  bar.addColorStop(1, palette.barEnd);
  ctx.fillStyle = bar;
  ctx.fill();

  const shimmerX = layout.playX + (Math.sin(now * 0.0007) * 0.5 + 0.5) * layout.playW;
  const shimmer = ctx.createLinearGradient(shimmerX - 70, layout.playY, shimmerX + 70, layout.playY + layout.playH);
  shimmer.addColorStop(0, "rgba(255,255,255,0)");
  shimmer.addColorStop(0.5, "rgba(255,255,255,0.06)");
  shimmer.addColorStop(1, "rgba(255,255,255,0)");
  roundedPath(ctx, layout.playX, layout.playY, layout.playW, layout.playH, 14);
  ctx.fillStyle = shimmer;
  ctx.fill();

  for (let point = 0; point < 24; point += 1) {
    const x = columnX(layout, columnOfPoint(point, mirroredX));
    const half = layout.cellW * 0.48;
    const canonicalTop = point >= 12;
    const top = mirroredY ? !canonicalTop : canonicalTop;
    const baseY = top ? layout.topY : layout.bottomY;
    const apexY = top ? layout.topApex : layout.bottomApex;

    const tri = ctx.createLinearGradient(x, baseY, x, apexY);
    const warm = point % 2 === 0;
    if (warm) {
      tri.addColorStop(0, palette.triangleWarmTop);
      tri.addColorStop(1, palette.triangleWarmBottom);
    } else {
      tri.addColorStop(0, palette.triangleCoolTop);
      tri.addColorStop(1, palette.triangleCoolBottom);
    }

    ctx.beginPath();
    ctx.moveTo(x - half, baseY);
    ctx.lineTo(x + half, baseY);
    ctx.lineTo(x, apexY);
    ctx.closePath();
    ctx.fillStyle = tri;
    ctx.fill();
    ctx.strokeStyle = palette.triangleStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw center-theme art above board triangles.
  drawThemeCenterArt(ctx, layout, theme, now);

  ctx.strokeStyle = palette.centerLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(layout.playX, layout.centerY);
  ctx.lineTo(layout.playX + layout.playW, layout.centerY);
  ctx.stroke();

  ctx.font = `700 ${Math.max(10, layout.cellW * 0.24)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let point = 0; point < 24; point += 1) {
    const x = columnX(layout, columnOfPoint(point, mirroredX));
    const canonicalTop = point >= 12;
    const top = mirroredY ? !canonicalTop : canonicalTop;
    const y = top ? layout.topY - 13 : layout.bottomY + 13;
    drawReadableText(ctx, String(point + 1), x, y, palette.pointLabel);
  }

  roundedPath(ctx, layout.pad + 4, layout.playY + 8, layout.gutter - 8, layout.playH - 16, 10);
  ctx.fillStyle = palette.sideTray;
  ctx.fill();
  roundedPath(ctx, layout.width - layout.pad - layout.gutter + 4, layout.playY + 8, layout.gutter - 8, layout.playH - 16, 10);
  ctx.fill();

  const activeMoves = selectedSource !== null
    ? sourceMovesMap.get(sourceKey(selectedSource)) ?? []
    : [];

  const targetHighlights: Array<{
    x: number;
    y: number;
    radius: number;
    color: string;
    intensity: number;
  }> = [];

  const highlightedTargets = new Set<string>();
  for (const move of activeMoves) {
    const key = `${move.player}:${String(move.to)}`;
    if (highlightedTargets.has(key)) continue;
    highlightedTargets.add(key);
    const p = targetPos(state, layout, move.player, move.to, mirroredX, mirroredY);
    targetHighlights.push({
      x: p.x,
      y: p.y,
      radius: layout.checkerR,
      color: "#6fd6ff",
      intensity: 1.32,
    });
  }

  const multiDieHighlights: Array<{
    x: number;
    y: number;
    radius: number;
    color: string;
    intensity: number;
  }> = [];

  const strongestMultiDiePerTarget = new Map<string, MultiDieTarget>();
  for (const multiDieTarget of multiDieTargets) {
    const key = String(multiDieTarget.to);
    const existing = strongestMultiDiePerTarget.get(key);
    if (!existing || multiDieTarget.usedDice > existing.usedDice) {
      strongestMultiDiePerTarget.set(key, multiDieTarget);
    }
  }

  for (const multiDieTarget of strongestMultiDiePerTarget.values()) {
    const p = targetPos(state, layout, state.currentPlayer, multiDieTarget.to, mirroredX, mirroredY);
    multiDieHighlights.push({
      x: p.x,
      y: p.y,
      radius: layout.checkerR * 1.04,
      color: "#b86cff",
      intensity: 1.45 + (multiDieTarget.usedDice - 2) * 0.2,
    });
  }

  const sourceHighlights: Array<{
    x: number;
    y: number;
    radius: number;
    color: string;
    intensity: number;
  }> = [];

  const handles = disableInput ? [] : collectSourceHandles(state, sourceMovesMap, layout, mirroredX, mirroredY);
  for (const handle of handles) {
    const selected = selectedSource === handle.source;
    sourceHighlights.push({
      x: handle.position.x,
      y: handle.position.y,
      radius: layout.checkerR * (selected ? 0.95 : 0.8),
      color: selected ? "#ff5b5b" : "#ffe1bf",
      intensity: selected ? 1.6 : 1.05,
    });
  }

  const anim = animationRef.current;
  let animChecker: { player: PlayerId; pos: Vec2 } | null = null;
  let suppressPoint: { player: PlayerId; point: number } | null = null;
  let suppressOff: PlayerId | null = null;

  if (anim) {
    const t = clamp((now - anim.startedAt) / anim.durationMs, 0, 1);
    if (t >= 1) {
      animationRef.current = null;
    } else {
      const eased = 1 - Math.pow(1 - t, 3);
      animChecker = {
        player: anim.player,
        pos: {
          x: anim.start.x + (anim.end.x - anim.start.x) * eased,
          y: anim.start.y + (anim.end.y - anim.start.y) * eased - Math.sin(eased * Math.PI) * 16,
        },
      };
      if (anim.to === "off") suppressOff = anim.player;
      else suppressPoint = { player: anim.player, point: anim.to };
    }
  }

  for (const player of ["white", "black"] as PlayerId[]) {
    for (let point = 0; point < 24; point += 1) {
      const p = state.points[point];
      if (p.owner !== player || p.count <= 0) continue;

      let count = p.count;
      if (suppressPoint && suppressPoint.player === player && suppressPoint.point === point) count -= 1;
      count = Math.max(0, count);

      for (let i = 0; i < count; i += 1) {
        const pos = pointPos(layout, point, i, count || 1, mirroredX, mirroredY);
        drawChecker(ctx, pos.x, pos.y, layout.checkerR, player);
      }
    }

    let barCount = state.bar[player];
    barCount = Math.max(0, barCount);
    for (let i = 0; i < barCount; i += 1) {
      const pos = barPos(layout, player, i, barCount || 1, mirroredY);
      drawChecker(ctx, pos.x, pos.y, layout.checkerR, player);
    }

    let offCount = state.borneOff[player];
    if (suppressOff === player) offCount -= 1;
    offCount = Math.max(0, offCount);
    for (let i = 0; i < offCount; i += 1) {
      const pos = offPos(layout, player, i, offCount || 1, mirroredX, mirroredY);
      drawChecker(ctx, pos.x, pos.y, layout.checkerR * 0.95, player);
    }
  }

  if (animChecker) {
    drawChecker(ctx, animChecker.pos.x, animChecker.pos.y, layout.checkerR * 1.03, animChecker.player);
  }

  for (const ring of targetHighlights) {
    drawRing(ctx, ring.x, ring.y, ring.radius, ring.color, now, ring.intensity, "target");
  }

  for (const ring of multiDieHighlights) {
    drawRing(ctx, ring.x, ring.y, ring.radius, ring.color, now, ring.intensity, "target");
  }

  for (const ring of sourceHighlights) {
    drawRing(ctx, ring.x, ring.y, ring.radius, ring.color, now, ring.intensity, "source");
  }
  const blackOffX = mirroredX ? layout.rightOffX : layout.leftOffX;
  const whiteOffX = mirroredX ? layout.leftOffX : layout.rightOffX;
  const blackTop = mirroredY ? false : true;
  const whiteTop = !blackTop;
  ctx.font = `600 ${Math.max(10, layout.playH * 0.022)}px ui-sans-serif, system-ui, sans-serif`;
  drawReadableText(ctx, `יצא: ${state.borneOff.black}`, blackOffX, blackTop ? layout.centerY - 14 : layout.centerY + 14, palette.offLabelBlack);
  drawReadableText(ctx, `יצא: ${state.borneOff.white}`, whiteOffX, whiteTop ? layout.centerY - 14 : layout.centerY + 14, palette.offLabelWhite);
  if (state.bar.black > 0) {
    drawReadableText(
      ctx,
      `בר: ${state.bar.black}`,
      layout.playX + layout.halfW + layout.barW * 0.5,
      blackTop ? layout.topY - 24 : layout.bottomY + 24,
      palette.barLabelBlack
    );
  }
  if (state.bar.white > 0) {
    drawReadableText(
      ctx,
      `בר: ${state.bar.white}`,
      layout.playX + layout.halfW + layout.barW * 0.5,
      whiteTop ? layout.topY - 24 : layout.bottomY + 24,
      palette.barLabelWhite
    );
  }

  const vignette = ctx.createRadialGradient(
    layout.width * 0.5,
    layout.height * 0.5,
    layout.width * 0.2,
    layout.width * 0.5,
    layout.height * 0.5,
    layout.width * 0.72
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, palette.vignetteEdge);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, layout.width, layout.height);
}

type BoardProps = {
  theme: BoardThemeId;
};

export default function Board({ theme }: BoardProps) {
  const {
    state,
    legalMoves,
    isRolling,
    isAutomatedTurn,
    homeQuadrant,
    movePiece,
    selectedSource,
    setSelectedSource,
  } = useBackgammon();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const layoutRef = useRef<Layout | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  const movePieceRef = useRef(movePiece);
  const stateRef = useRef(state);
  const sourceMovesRef = useRef<Map<string, Move[]>>(new Map());
  const multiDieTargetsRef = useRef<MultiDieTarget[]>([]);
  const disableInputRef = useRef(false);
  const selectedSourceRef = useRef<MoveSource | null>(selectedSource);
  const mirroredRef = useRef({ x: false, y: false });
  const themeRef = useRef<BoardThemeId>(theme);

  const animRef = useRef<MoveAnim | null>(null);
  const prevStateRef = useRef<BackgammonState>(state);
  const animatedMoveIdRef = useRef(0);

  const disableInput = isRolling || !!state.winner || isAutomatedTurn;
  const mirroredX = homeQuadrant === "bottom-left" || homeQuadrant === "top-left";
  const mirroredY = homeQuadrant === "top-left" || homeQuadrant === "top-right";
  const sideClass = mirroredX ? "is-left" : "is-right";
  const blackVerticalClass = mirroredY ? "is-bottom" : "is-top";
  const whiteVerticalClass = mirroredY ? "is-top" : "is-bottom";

  const sourceMovesMap = useMemo(() => {
    const map = new Map<string, Move[]>();
    for (const move of legalMoves) {
      const key = sourceKey(move.from);
      const arr = map.get(key);
      if (arr) arr.push(move);
      else map.set(key, [move]);
    }
    return map;
  }, [legalMoves]);

  const multiDieTargets = useMemo(() => {
    if (selectedSource === null) return [];
    return getMultiDieTargetsForSource(state, selectedSource);
  }, [selectedSource, state]);

  useEffect(() => {
    movePieceRef.current = movePiece;
  }, [movePiece]);

  useEffect(() => {
    mirroredRef.current = { x: mirroredX, y: mirroredY };
  }, [mirroredX, mirroredY]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    stateRef.current = state;
    sourceMovesRef.current = sourceMovesMap;
    multiDieTargetsRef.current = multiDieTargets;
    disableInputRef.current = disableInput;
    selectedSourceRef.current = selectedSource;
  }, [disableInput, multiDieTargets, selectedSource, sourceMovesMap, state]);

  useEffect(() => {
    if (selectedSource === null) return;
    if (!sourceMovesMap.has(sourceKey(selectedSource))) setSelectedSource(null);
  }, [selectedSource, sourceMovesMap]);

  useEffect(() => {
    if (disableInput) {
      setSelectedSource(null);
    }
  }, [disableInput]);

  useEffect(() => {
    const lastMove = state.lastMove;
    if (!lastMove?.id) {
      prevStateRef.current = state;
      return;
    }

    if (lastMove.id === animatedMoveIdRef.current) {
      prevStateRef.current = state;
      return;
    }

    const layout = layoutRef.current;
    if (!layout) {
      prevStateRef.current = state;
      return;
    }

    const prev = prevStateRef.current;
    animRef.current = {
      id: lastMove.id,
      player: lastMove.player,
      to: lastMove.to,
      start: sourcePosBeforeMove(prev, layout, lastMove.player, lastMove.from, mirroredX, mirroredY),
      end: targetPos(state, layout, lastMove.player, lastMove.to, mirroredX, mirroredY),
      startedAt: performance.now(),
      durationMs: 280,
    };

    animatedMoveIdRef.current = lastMove.id;
    prevStateRef.current = state;
  }, [mirroredX, mirroredY, state]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const canvas = document.createElement("canvas");
    canvas.className = "bgm-board__canvas";
    mount.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      mount.removeChild(canvas);
      return;
    }

    canvasRef.current = canvas;
    ctxRef.current = ctx;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      dprRef.current = dpr;

      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      layoutRef.current = makeLayout(rect.width, rect.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const toPoint = (event: PointerEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onDown = (event: PointerEvent) => {
      if (disableInputRef.current) return;
      const layout = layoutRef.current;
      if (!layout) return;

      const p = toPoint(event);
      pointerRef.current = { ...p, inside: true };

      const isRightClick = event.button === 2;
      const isLeftClick = event.button === 0;
      if (!isRightClick && !isLeftClick) {
        return;
      }

      const sourceMovesMap = sourceMovesRef.current;
      const mirror = mirroredRef.current;
      const mappedSource = sourceFromPointer(layout, p, sourceMovesMap, mirror.x, mirror.y, isRightClick);
      const selected = selectedSourceRef.current;

      if (isRightClick) {
        event.preventDefault();
        if (mappedSource !== null) {
          setSelectedSource(mappedSource === selected ? null : mappedSource);
        } else {
          setSelectedSource(null);
        }
        return;
      }

      if (selected === null) {
        return;
      }

      const selectedMoves = sourceMovesMap.get(sourceKey(selected)) ?? [];
      const mappedTarget = targetFromPointer(layout, p, stateRef.current.currentPlayer, mirror.x, mirror.y);
      if (mappedTarget === null) {
        return;
      }

      const chosen = pickMoveByTarget(selectedMoves, mappedTarget);
      if (chosen) {
        movePieceRef.current(chosen);
        setSelectedSource(null);
        return;
      }

      const combinedMoves = getMultiDieMovesForSourceTarget(stateRef.current, selected, mappedTarget);
      if (combinedMoves.length > 0) {
        for (const move of combinedMoves) {
          movePieceRef.current(move);
        }
        setSelectedSource(null);
      }
    };

    const onMove = (event: PointerEvent) => {
      const p = toPoint(event);
      pointerRef.current = { ...p, inside: true };
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const onLeave = () => {
      pointerRef.current.inside = false;
      canvas.style.cursor = "grab";
    };

    const render = () => {
      const activeCtx = ctxRef.current;
      const activeCanvas = canvasRef.current;
      const layout = layoutRef.current;

      if (activeCtx && activeCanvas && layout) {
        activeCtx.setTransform(1, 0, 0, 1, 0, 0);
        activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
        activeCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);

        drawScene(
          activeCtx,
          layout,
          performance.now(),
          stateRef.current,
          sourceMovesRef.current,
          disableInputRef.current,
          selectedSourceRef.current,
          multiDieTargetsRef.current,
          pointerRef.current,
          animRef,
          themeRef.current,
          mirroredRef.current.x,
          mirroredRef.current.y
        );
      }

      frameRef.current = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.style.cursor = "grab";

    frameRef.current = window.requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }

      if (mount.contains(canvas)) {
        mount.removeChild(canvas);
      }

      canvasRef.current = null;
      ctxRef.current = null;
      layoutRef.current = null;
      animRef.current = null;
    };
  }, []);

  return (
    <section className="bgm-board" aria-label="לוח שש-בש">
      <div className={`bgm-board-home-label is-black ${sideClass} ${blackVerticalClass}`}>בית שחור</div>
      <div className={`bgm-board-home-label is-white ${sideClass} ${whiteVerticalClass}`}>בית לבן</div>
      <div ref={mountRef} className="bgm-board__viewport" />
    </section>
  );
}
