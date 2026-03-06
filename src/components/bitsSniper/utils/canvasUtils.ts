/**
 * Bits Sniper – canvas drawing helpers (HUD, bot labels, rounded rect).
 */

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Color for bot HP bar by ratio (green → yellow → red). */
export function getBotHudColor(ratio: number): string {
  if (ratio > 0.5) return "#2ee872";
  if (ratio > 0.25) return "#f0c038";
  return "#ee4038";
}
