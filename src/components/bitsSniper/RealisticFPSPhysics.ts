/**
 * RealisticFPSPhysics.ts
 * -----------------------------------------------------------------------------
 * A practical, "real-feeling" FPS physics module for Three.js (TypeScript).
 *
 * What it provides:
 *  - Kinematic capsule character controller (gravity, jump, air control)
 *  - Robust capsule vs AABB collision (static world boxes)
 *  - Grounding, slope handling, friction, and "skin" separation
 *  - Debug helpers to visualize colliders to prevent "invisible wall" issues
 *
 * What it intentionally does NOT try to be:
 *  - A full rigid-body physics engine (use Rapier/Ammo/Cannon for that)
 *
 * Why this solves "invisible walls":
 *  - Colliders are built/used in WORLD space
 *  - We force updateMatrixWorld before collider extraction
 *  - We provide debug rendering of the exact colliders used by physics
 *
 * Units:
 *  - Treat 1 world unit as 1 meter for sane tuning.
 */

import * as THREE from "three";

// =============================================================================
// Types
// =============================================================================

export type InputState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jumpPressed: boolean;   // edge-triggered recommended (true only on press)
};

export type StaticAABBCollider = {
  box: THREE.Box3;          // WORLD space AABB
  tag?: string;
  debug?: THREE.Box3Helper; // optional helper
};

// =============================================================================
// Tunables (defaults that feel "FPS-ish")
// =============================================================================

export type CharacterTuning = {
  // Size
  radius: number;
  halfHeight: number;   // capsule segment half-length (excluding radius)

  // Movement
  walkSpeed: number;    // m/s
  sprintSpeed: number;  // m/s
  acceleration: number; // m/s^2 on ground
  airAcceleration: number;

  // Jump/Gravity
  gravity: number;      // negative
  jumpSpeed: number;    // m/s upwards

  // Friction
  groundFriction: number; // 0..1  (velocity damping each second-ish)
  airFriction: number;

  // Slope/grounding
  maxSlopeDegrees: number; // e.g. 48 degrees
  groundSnapDistance: number; // meters: snap to ground if within distance

  // Collision robustness
  skin: number;         // small separation to avoid jitter/sticking
  solverIters: number;  // collision resolution iterations
  maxStep: number;      // max step height (stairs) in meters
};

export const DEFAULT_TUNING: CharacterTuning = {
  radius: 0.33,
  halfHeight: 0.55,

  walkSpeed: 5.2,
  sprintSpeed: 7.5,
  acceleration: 38,
  airAcceleration: 12,

  gravity: -9.81,
  jumpSpeed: 5.4,

  groundFriction: 10.5,
  airFriction: 0.35,

  maxSlopeDegrees: 48,
  groundSnapDistance: 0.18,

  skin: 0.0025,
  solverIters: 6,
  maxStep: 0.35,
};

// =============================================================================
// Character Controller
// =============================================================================

export class CapsuleCharacterController {
  public position = new THREE.Vector3(); // center of capsule
  public velocity = new THREE.Vector3(); // m/s
  public grounded = false;
  public groundNormal = new THREE.Vector3(0, 1, 0);

  public tuning: CharacterTuning;

  // For convenience:
  public get radius() { return this.tuning.radius; }
  public get halfHeight() { return this.tuning.halfHeight; }

  constructor(tuning: Partial<CharacterTuning> = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  /**
   * Step the controller.
   *
   * @param dt   Delta time in seconds (recommend fixed timestep like 1/60).
   * @param input Movement input
   * @param yawRadians Camera/player yaw for input direction (optional; 0 = +Z)
   * @param colliders Static AABB colliders
   */
  public step(
    dt: number,
    input: InputState,
    yawRadians: number,
    colliders: ReadonlyArray<StaticAABBCollider>,
  ) {
    // Clamp dt for stability on hiccups:
    dt = Math.min(dt, 1 / 20);

    // --- 1) Build desired move direction in world space (XZ plane) ----------
    const wishDir = computeWishDir(input, yawRadians, _wishDir);
    const wishSpeed = input.sprint ? this.tuning.sprintSpeed : this.tuning.walkSpeed;

    // --- 2) Acceleration ----------------------------------------------------
    // Split into horizontal + vertical
    const horizVel = _horiz.copy(this.velocity); horizVel.y = 0;

    if (wishDir.lengthSq() > 1e-8) {
      const accel = this.grounded ? this.tuning.acceleration : this.tuning.airAcceleration;
      const target = _tmpA.copy(wishDir).multiplyScalar(wishSpeed);
      // Smoothly approach target horizontal velocity
      const delta = target.sub(horizVel);
      const maxChange = accel * dt;
      const deltaLen = delta.length();
      if (deltaLen > maxChange) delta.multiplyScalar(maxChange / Math.max(1e-9, deltaLen));
      horizVel.add(delta);
    } else {
      // No input: apply friction to horizontal velocity
      const fr = this.grounded ? this.tuning.groundFriction : this.tuning.airFriction;
      const damp = Math.exp(-fr * dt);
      horizVel.multiplyScalar(damp);
    }

    // Reassemble velocity
    this.velocity.x = horizVel.x;
    this.velocity.z = horizVel.z;

    // --- 3) Jump ------------------------------------------------------------
    if (this.grounded && input.jumpPressed) {
      this.velocity.y = this.tuning.jumpSpeed;
      this.grounded = false;
    }

    // --- 4) Gravity ---------------------------------------------------------
    this.velocity.y += this.tuning.gravity * dt;

    // --- 5) Integrate position ---------------------------------------------
    _deltaPos.copy(this.velocity).multiplyScalar(dt);
    this.position.add(_deltaPos);

    // --- 6) Collisions (capsule vs AABB) -----------------------------------
    this.resolveCollisions(colliders);

    // --- 7) Ground snap (keeps feet glued without "hover") -----------------
    this.applyGroundSnap(colliders);
  }

  private resolveCollisions(colliders: ReadonlyArray<StaticAABBCollider>) {
    this.grounded = false;
    this.groundNormal.set(0, 1, 0);

    // Iterate a few times to resolve multiple contacts
    for (let iter = 0; iter < this.tuning.solverIters; iter++) {
      let any = false;

      // Get capsule segment endpoints in world space
      getCapsuleSegment(this.position, this.halfHeight, _segA, _segB);

      for (const c of colliders) {
        const box = c.box;

        // Find closest points between capsule segment and box
        const distSq = closestPointsSegmentAABB(_segA, _segB, box, _cpSeg, _cpBox);
        const r = this.radius;

        if (distSq >= (r * r)) continue;

        // Contact normal and penetration
        const dist = Math.sqrt(Math.max(0, distSq));
        let nx: number, ny: number, nz: number;
        if (dist > 1e-6) {
          _n.subVectors(_cpSeg, _cpBox).multiplyScalar(1 / dist);
          nx = _n.x; ny = _n.y; nz = _n.z;
        } else {
          // Segment point is inside box -> pick the best axis to push out
          computeInsideBoxNormal(_cpSeg, box, _n);
          nx = _n.x; ny = _n.y; nz = _n.z;
        }

        const penetration = (r - dist) + this.tuning.skin;

        // Move capsule center out along normal
        this.position.x += nx * penetration;
        this.position.y += ny * penetration;
        this.position.z += nz * penetration;

        // Velocity correction: remove component INTO the surface
        const vn = this.velocity.x * nx + this.velocity.y * ny + this.velocity.z * nz;
        if (vn < 0) {
          this.velocity.x -= vn * nx;
          this.velocity.y -= vn * ny;
          this.velocity.z -= vn * nz;
        }

        // Ground detection
        const maxSlopeCos = Math.cos(THREE.MathUtils.degToRad(this.tuning.maxSlopeDegrees));
        if (ny > maxSlopeCos) {
          this.grounded = true;
          this.groundNormal.set(nx, ny, nz);
        }

        any = true;
      }

      if (!any) break;
    }

    // If grounded, avoid slowly sinking due to gravity numerical drift
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
  }

  private applyGroundSnap(colliders: ReadonlyArray<StaticAABBCollider>) {
    // If moving upward, don't snap
    if (this.velocity.y > 0.5) return;

    // If not grounded, attempt a short snap downward
    if (!this.grounded) {
      const snapDist = this.tuning.groundSnapDistance;

      const originalY = this.position.y;

      // Temporarily shift down
      this.position.y -= snapDist;

      const prevVelY = this.velocity.y;
      this.resolveCollisions(colliders);

      if (!this.grounded) {
        // Revert if no ground found
        this.position.y = originalY;
        this.velocity.y = prevVelY;
      } else {
        // Grounded: stop vertical velocity
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }
  }
}

// =============================================================================
// Collider building / Debugging
// =============================================================================

/**
 * Build WORLD-space AABB colliders from a scene subtree.
 *
 * Recommended usage:
 *  - Tag collidable meshes with: mesh.userData.collidable = true
 *  - Or pass a predicate that selects walls/floors.
 */
export function buildStaticAABBsFromScene(
  root: THREE.Object3D,
  options?: {
    predicate?: (o: THREE.Object3D) => boolean;
    tag?: string;
  },
): StaticAABBCollider[] {
  const out: StaticAABBCollider[] = [];
  root.updateMatrixWorld(true);

  const predicate = options?.predicate ?? ((o) => (o as any).userData?.collidable === true);

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    if (!predicate(mesh)) return;

    // IMPORTANT: ensure world matrix is up-to-date before Box3 extraction
    mesh.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(mesh);
    out.push({ box, tag: options?.tag });
  });

  return out;
}

/**
 * Attach Box3Helpers to visualize exactly what physics uses.
 * This is the #1 tool to eliminate "invisible wall" bugs.
 */
export function attachColliderDebugHelpers(
  scene: THREE.Scene,
  colliders: StaticAABBCollider[],
  color: number = 0xffd000,
): void {
  for (const c of colliders) {
    const helper = new THREE.Box3Helper(c.box, color);
    helper.renderOrder = 9999;
    (helper.material as any).depthTest = false;
    c.debug = helper;
    scene.add(helper);
  }
}

/** When you rebuild colliders each map-load, remove old helpers. */
export function detachColliderDebugHelpers(scene: THREE.Scene, colliders: StaticAABBCollider[]) {
  for (const c of colliders) {
    if (!c.debug) continue;
    scene.remove(c.debug);
    c.debug.geometry.dispose();
    (c.debug.material as THREE.Material).dispose();
    c.debug = undefined;
  }
}

// =============================================================================
// Math helpers (capsule-segment vs AABB distance)
// =============================================================================

// Scratch (avoid allocations)
const _wishDir = new THREE.Vector3();
const _horiz = new THREE.Vector3();
const _tmpA = new THREE.Vector3();
const _deltaPos = new THREE.Vector3();

const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _cpSeg = new THREE.Vector3();
const _cpBox = new THREE.Vector3();
const _n = new THREE.Vector3();

const _pt = new THREE.Vector3();
const _clamped = new THREE.Vector3();

/** Convert input + yaw into a normalized wish direction on XZ plane. */
function computeWishDir(input: InputState, yaw: number, out: THREE.Vector3): THREE.Vector3 {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const z = (input.forward ? 1 : 0) - (input.back ? 1 : 0);

  out.set(x, 0, z);
  if (out.lengthSq() < 1e-8) return out.set(0, 0, 0);

  // rotate by yaw around Y:
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);

  const rx = out.x * c - out.z * s;
  const rz = out.x * s + out.z * c;

  out.set(rx, 0, rz).normalize();
  return out;
}

/** Get capsule segment endpoints from center position. */
function getCapsuleSegment(center: THREE.Vector3, halfHeight: number, outA: THREE.Vector3, outB: THREE.Vector3) {
  outA.set(center.x, center.y - halfHeight, center.z);
  outB.set(center.x, center.y + halfHeight, center.z);
}

/**
 * Distance^2 from a point to an AABB, and the closest point on the AABB.
 */
function pointToAABBDistSq(point: THREE.Vector3, box: THREE.Box3, outClosest: THREE.Vector3): number {
  const x = THREE.MathUtils.clamp(point.x, box.min.x, box.max.x);
  const y = THREE.MathUtils.clamp(point.y, box.min.y, box.max.y);
  const z = THREE.MathUtils.clamp(point.z, box.min.z, box.max.z);
  outClosest.set(x, y, z);

  const dx = point.x - x;
  const dy = point.y - y;
  const dz = point.z - z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Find closest points between a segment [a,b] and an AABB 'box'.
 * Returns the minimum distance^2, writing:
 *   outSeg = closest point on segment
 *   outBox = closest point on box
 *
 * Implementation note:
 * - distance(point, convex) is convex; squared distance remains convex along a segment.
 * - So we can use ternary search on t ∈ [0,1] reliably.
 */
function closestPointsSegmentAABB(
  a: THREE.Vector3,
  b: THREE.Vector3,
  box: THREE.Box3,
  outSeg: THREE.Vector3,
  outBox: THREE.Vector3,
): number {
  let lo = 0.0, hi = 1.0;

  for (let i = 0; i < 24; i++) {
    const t1 = lo + (hi - lo) / 3;
    const t2 = hi - (hi - lo) / 3;

    _pt.copy(a).lerp(b, t1);
    const f1 = pointToAABBDistSq(_pt, box, _clamped);

    _pt.copy(a).lerp(b, t2);
    const f2 = pointToAABBDistSq(_pt, box, _clamped);

    if (f1 < f2) hi = t2;
    else lo = t1;
  }

  const t = (lo + hi) * 0.5;
  outSeg.copy(a).lerp(b, t);

  const distSq = pointToAABBDistSq(outSeg, box, outBox);
  return distSq;
}

/**
 * If the closest point lies inside the AABB (distance ~ 0),
 * choose a stable normal that pushes out through the nearest face.
 */
function computeInsideBoxNormal(p: THREE.Vector3, box: THREE.Box3, outNormal: THREE.Vector3) {
  const dxMin = p.x - box.min.x;
  const dxMax = box.max.x - p.x;
  const dyMin = p.y - box.min.y;
  const dyMax = box.max.y - p.y;
  const dzMin = p.z - box.min.z;
  const dzMax = box.max.z - p.z;

  let min = dxMin; outNormal.set(-1, 0, 0);

  if (dxMax < min) { min = dxMax; outNormal.set(1, 0, 0); }
  if (dyMin < min) { min = dyMin; outNormal.set(0, -1, 0); }
  if (dyMax < min) { min = dyMax; outNormal.set(0, 1, 0); }
  if (dzMin < min) { min = dzMin; outNormal.set(0, 0, -1); }
  if (dzMax < min) { outNormal.set(0, 0, 1); }
}

// =============================================================================
// Optional: Convert THREE meshes to "collidable" automatically
// =============================================================================

/**
 * Convenience helper:
 * Mark meshes as collidable if their name contains certain tokens.
 */
export function markCollidablesByName(
  root: THREE.Object3D,
  tokens: string[] = ["wall", "floor", "map", "collider"],
) {
  const lowerTokens = tokens.map((t) => t.toLowerCase());
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    const nm = (mesh.name || "").toLowerCase();
    if (lowerTokens.some((t) => nm.includes(t))) {
      (mesh as any).userData = (mesh as any).userData || {};
      (mesh as any).userData.collidable = true;
    }
  });
}
