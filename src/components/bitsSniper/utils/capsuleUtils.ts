/**
 * Bits Sniper – capsule math helpers (segment–segment, segment–capsule).
 * Allocation-free for hot paths.
 */
import * as THREE from "three";
import { clamp } from "./mathUtils";

const _ssD1 = new THREE.Vector3();
const _ssD2 = new THREE.Vector3();
const _ssR = new THREE.Vector3();
const _ssC1 = new THREE.Vector3();
const _ssC2 = new THREE.Vector3();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();

export function segmentSegmentClosestParams(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outC1?: THREE.Vector3,
  outC2?: THREE.Vector3,
): { distSq: number; s: number; t: number } {
  _ssD1.copy(q1).sub(p1);
  _ssD2.copy(q2).sub(p2);
  _ssR.copy(p1).sub(p2);

  const a = _ssD1.dot(_ssD1);
  const e = _ssD2.dot(_ssD2);
  const f = _ssD2.dot(_ssR);

  let s = 0;
  let t = 0;
  const EPS = 1e-8;

  if (a <= EPS && e <= EPS) {
    if (outC1) outC1.copy(p1);
    if (outC2) outC2.copy(p2);
    return { distSq: p1.distanceToSquared(p2), s: 0, t: 0 };
  }

  if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _ssD1.dot(_ssR);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _ssD1.dot(_ssD2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  if (outC1) outC1.copy(p1).addScaledVector(_ssD1, s);
  if (outC2) outC2.copy(p2).addScaledVector(_ssD2, t);

  return { distSq: outC1 && outC2 ? outC1.distanceToSquared(outC2) : 0, s, t };
}

export function segmentHitsCapsule(
  segA: THREE.Vector3,
  segB: THREE.Vector3,
  center: THREE.Vector3,
  halfHeight: number,
  radius: number,
  outHitPoint: THREE.Vector3,
): { hit: boolean; segS: number; axisT: number } {
  _capA.set(center.x, center.y - halfHeight + radius, center.z);
  _capB.set(center.x, center.y + halfHeight - radius, center.z);

  const { distSq, s, t } = segmentSegmentClosestParams(segA, segB, _capA, _capB, _ssC1, _ssC2);
  if (distSq <= radius * radius) {
    outHitPoint.copy(_ssC1);
    return { hit: true, segS: s, axisT: t };
  }
  return { hit: false, segS: 0, axisT: 0 };
}
