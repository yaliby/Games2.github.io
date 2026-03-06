/**
 * Bits Sniper – small math helpers.
 */

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function rng(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
