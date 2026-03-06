/**
 * Bits Sniper – ניהול מות האויב: פיזיקה ריאליסטית + Euler rotation equations.
 *
 * מה מיוחד כאן:
 *  - angular velocity מאוחסן ב-WORLD space
 *  - כל frame: המר ל-body space → הפעל Euler equations → המר חזרה
 *  - Euler equations: I·dω/dt = −(ω × I·ω)
 *    → פלטה שטוחה מסתובבת יציב סביב ציר הקצר,
 *      מוט ארוך מתכבל (tumble) בצורה אופיינית,
 *      קובייה מסתובבת בצורה פחות יציבה (chaos near intermediate axis)
 *  - inertia tensor נשמר ב-body space (diagonal, קירוב קופסה)
 *  - impulse hit גם מופעל ב-body space ומומר נכון
 */
import * as THREE from "three";
import type { BotState } from "./types/gameTypes";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DeathPart {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;         // world space, m/s
  angularVelocity: THREE.Vector3;  // world space, rad/s
  /** diagonal inertia tensor in BODY space: (Ixx, Iyy, Izz) */
  inertiaBody: THREE.Vector3;
  /** I⁻¹ in body space */
  inertiaBodyInv: THREE.Vector3;
  life: number;
  mass: number;
  restitution: number;
  linearDamping: number;
  sleeping: boolean;
  sleepTimer: number;
}

export interface DeathDebrisState {
  group: THREE.Group;
  list: DeathPart[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const GRAVITY             = -9.81 * 1.6;
const FADE_DURATION       = 1.4;
const PART_LIFE           = 7.0;

const MATERIAL_DENSITY    = 380;     // kg/m³  (פלסטיק/אלומיניום קל)
const RESTITUTION_DEFAULT = 0.35;
const FRICTION_DYNAMIC    = 0.45;
const COLLISION_ITERS     = 4;

const AIR_DENSITY         = 1.225;
const DRAG_COEFF          = 0.47;
const ANGULAR_DRAG_COEFF  = 0.012;

const SLEEP_VEL_SQ        = 0.003;
const SLEEP_ANG_SQ        = 0.08;
const SLEEP_DELAY         = 1.2;

const HIT_IMPULSE_BASE    = 18.0;
const MAX_EFFECTIVE_MASS  = 2.5;
const MAX_INERTIA_INV     = 120.0;

// sub-steps לEuler equations (יציבות נומרית)
const EULER_SUBSTEPS      = 4;

// ─── Inertia tensor (body space, קופסה מלאה) ──────────────────────────────
// I_xx = m/12*(h²+d²),  I_yy = m/12*(w²+d²),  I_zz = m/12*(w²+h²)

function computeBoxInertia(
  mass: number,
  size: THREE.Vector3,
  outI: THREE.Vector3,
  outIinv: THREE.Vector3,
): void {
  const w = size.x, h = size.y, d = size.z;
  const f = mass / 12;
  const Ixx = Math.max(1e-4, f * (h * h + d * d));
  const Iyy = Math.max(1e-4, f * (w * w + d * d));
  const Izz = Math.max(1e-4, f * (w * w + h * h));
  outI.set(Ixx, Iyy, Izz);
  outIinv.set(
    Math.min(MAX_INERTIA_INV, 1 / Ixx),
    Math.min(MAX_INERTIA_INV, 1 / Iyy),
    Math.min(MAX_INERTIA_INV, 1 / Izz),
  );
}

// ─── Scratch (module-level, zero allocations per frame) ───────────────────

const _worldPos   = new THREE.Vector3();
const _worldQuat  = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();
const _aabbSize   = new THREE.Vector3();

// Euler rotation equation scratch
const _quatInv      = new THREE.Quaternion();
const _omegaBody    = new THREE.Vector3();   // ω in body space
const _IomegaBody   = new THREE.Vector3();   // I·ω_body
const _cross        = new THREE.Vector3();   // ω × (I·ω)
const _dOmegaBody   = new THREE.Vector3();   // I⁻¹ · (−ω×Iω)
const _dOmegaWorld  = new THREE.Vector3();   // back to world

// Collision scratch
const _debrisBox    = new THREE.Box3();
const _debrisCenter = new THREE.Vector3();
const _boxCenter    = new THREE.Vector3();
const _contactPt    = new THREE.Vector3();
const _r            = new THREE.Vector3();
const _omegaCrossR  = new THREE.Vector3();
const _vRel         = new THREE.Vector3();
const _nVec         = new THREE.Vector3();
const _rCrossN      = new THREE.Vector3();
const _iiRcrossN    = new THREE.Vector3();
const _iiRcrossNxR  = new THREE.Vector3();
const _tangent      = new THREE.Vector3();
const _jN           = new THREE.Vector3();
const _deltaOmega   = new THREE.Vector3();
const _omegaDelta   = new THREE.Vector3();

// Rotation scratch
const _rotAxis      = new THREE.Vector3();
const _rotDelta     = new THREE.Quaternion();

// Hit scratch
const _raycaster    = new THREE.Raycaster();
const _impactOffset = new THREE.Vector3();
const _torqueWorld  = new THREE.Vector3();
const _torqueBody   = new THREE.Vector3();
const _torqueResult = new THREE.Vector3();

// ─── Spawn ─────────────────────────────────────────────────────────────────

export function spawnBotDeathParts(bot: BotState, state: DeathDebrisState): void {
  const root = bot.mesh;
  root.updateMatrixWorld(true);

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.Sprite) return;

    const clone = node.clone() as THREE.Mesh;
    clone.matrixAutoUpdate = true;  // חובה – גם אם המקור כיבה אותו

    node.getWorldPosition(_worldPos);
    node.getWorldQuaternion(_worldQuat);
    node.getWorldScale(_worldScale);
    clone.position.copy(_worldPos);
    clone.quaternion.copy(_worldQuat);
    clone.scale.copy(_worldScale);
    clone.updateMatrixWorld(true);

    // AABB → מסה ו-inertia
    const box = new THREE.Box3().setFromObject(clone);
    box.getSize(_aabbSize);
    const volume = Math.max(1e-6, _aabbSize.x * _aabbSize.y * _aabbSize.z);
    const mass   = Math.max(0.02, volume * MATERIAL_DENSITY);

    const inertiaBody    = new THREE.Vector3();
    const inertiaBodyInv = new THREE.Vector3();
    computeBoxInertia(mass, _aabbSize, inertiaBody, inertiaBodyInv);

    // מהירות לינארית זעירה
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 0.02,
      Math.random() * 0.01,
      (Math.random() - 0.5) * 0.02,
    );

    // ─ angular velocity: 1.5–4.5 rad/s על ציר רנדומלי ─────────────────────
    // ציר הסיבוב ההתחלתי נבחר ב-WORLD space, אבל ה-Euler equations
    // ידאגו שהאובייקט יסתובב בהתאם לצורה שלו מרגע ראשון.
    const spinSpeed = 1.5 + Math.random() * 3.0;
    const av = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).normalize().multiplyScalar(spinSpeed);

    const radius        = Math.max(_aabbSize.x, _aabbSize.y, _aabbSize.z) * 0.5;
    const linearDamping = 0.5 * AIR_DENSITY * DRAG_COEFF * Math.PI * radius * radius;

    state.group.add(clone);
    state.list.push({
      mesh: clone,
      velocity: v,
      angularVelocity: av,
      inertiaBody,
      inertiaBodyInv,
      life: PART_LIFE,
      mass,
      restitution: RESTITUTION_DEFAULT + (Math.random() - 0.5) * 0.1,
      linearDamping,
      sleeping: false,
      sleepTimer: 0,
    });
  });
}

// ─── State factory ─────────────────────────────────────────────────────────

export function createDeathDebrisState(): DeathDebrisState {
  return { group: new THREE.Group(), list: [] };
}

// ─── Opacity helper ────────────────────────────────────────────────────────

function setDebrisOpacity(mesh: THREE.Object3D, opacity: number): void {
  mesh.traverse((node) => {
    const m = (node as THREE.Mesh).material;
    if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((mat) => {
      const base = mat as THREE.Material & { transparent?: boolean; opacity?: number };
      base.transparent = true;
      base.opacity     = opacity;
      base.depthWrite  = opacity >= 1;
    });
  });
}

// ─── Euler's rotation equations (torque-free rigid body) ──────────────────
/**
 * מחשב את השינוי ב-angular velocity בגלל צורת הגוף.
 *
 * משוואת אויילר (body space):
 *   I · dω/dt = τ − ω × (I·ω)
 * ללא מומנט חיצוני (τ=0, free flight):
 *   dω/dt = I⁻¹ · (−ω × (I·ω))
 *
 * זה מה שגורם לגוף שטוח לסובב בצורה שונה ממוט ארוך.
 * מחולק לsub-steps לגישה נומרית יציבה.
 */
function integrateEulerEquations(d: DeathPart, dt: number): void {
  const subDt = dt / EULER_SUBSTEPS;

  for (let s = 0; s < EULER_SUBSTEPS; s++) {
    // המר ω world → body: ω_body = Q⁻¹ · ω_world
    _quatInv.copy(d.mesh.quaternion).invert();
    _omegaBody.copy(d.angularVelocity).applyQuaternion(_quatInv);

    // I·ω_body (diagonal → כפל רכיב)
    _IomegaBody.set(
      d.inertiaBody.x * _omegaBody.x,
      d.inertiaBody.y * _omegaBody.y,
      d.inertiaBody.z * _omegaBody.z,
    );

    // dω_body/dt = I⁻¹ · (−(ω_body × I·ω_body))
    _cross.crossVectors(_omegaBody, _IomegaBody);   // ω × Iω
    _dOmegaBody.set(
      -d.inertiaBodyInv.x * _cross.x,
      -d.inertiaBodyInv.y * _cross.y,
      -d.inertiaBodyInv.z * _cross.z,
    );

    // עדכן ω_body
    _omegaBody.addScaledVector(_dOmegaBody, subDt);

    // המר חזרה ל-world: ω_world = Q · ω_body
    _dOmegaWorld.copy(_omegaBody).applyQuaternion(d.mesh.quaternion);
    d.angularVelocity.copy(_dOmegaWorld);
  }
}

// ─── Collision resolution (impulse-based, restitution + friction) ──────────

function resolveDebrisVsBoxes(d: DeathPart, collidables: THREE.Box3[]): void {
  for (let iter = 0; iter < COLLISION_ITERS; iter++) {
    d.mesh.updateMatrixWorld(true);
    _debrisBox.setFromObject(d.mesh);
    _debrisBox.getCenter(_debrisCenter);

    let resolved = false;

    for (const box of collidables) {
      if (!_debrisBox.intersectsBox(box)) continue;
      box.getCenter(_boxCenter);

      const overlapX = Math.min(_debrisBox.max.x - box.min.x, box.max.x - _debrisBox.min.x);
      const overlapY = Math.min(_debrisBox.max.y - box.min.y, box.max.y - _debrisBox.min.y);
      const overlapZ = Math.min(_debrisBox.max.z - box.min.z, box.max.z - _debrisBox.min.z);
      const minOv    = Math.min(overlapX, overlapY, overlapZ);
      if (minOv <= 0) continue;

      let nx = 0, ny = 0, nz = 0;
      if (minOv === overlapY) {
        ny = _debrisCenter.y < _boxCenter.y ? -1 : 1;
        d.mesh.position.y += ny * overlapY;
      } else if (minOv === overlapX) {
        nx = _debrisCenter.x < _boxCenter.x ? -1 : 1;
        d.mesh.position.x += nx * overlapX;
      } else {
        nz = _debrisCenter.z < _boxCenter.z ? -1 : 1;
        d.mesh.position.z += nz * overlapZ;
      }
      _nVec.set(nx, ny, nz);

      _contactPt.set(
        _debrisCenter.x - nx * (_debrisBox.max.x - _debrisBox.min.x) * 0.5,
        _debrisCenter.y - ny * (_debrisBox.max.y - _debrisBox.min.y) * 0.5,
        _debrisCenter.z - nz * (_debrisBox.max.z - _debrisBox.min.z) * 0.5,
      );

      _r.subVectors(_contactPt, _debrisCenter);

      // v_rel = v + ω×r
      _omegaCrossR.crossVectors(d.angularVelocity, _r);
      _vRel.copy(d.velocity).add(_omegaCrossR);
      const vRelN = _vRel.dot(_nVec);
      if (vRelN >= 0) continue;

      // ─ invInertia עבור collision: המר מ-body ל-world ─────────────────────
      // לצורך denominator משתמשים ב-I_world (מקורב) –
      // מחשבים (I⁻¹*(r×n)) ב-world ע"י:
      //   r×n  → body → I⁻¹ → world
      _rCrossN.crossVectors(_r, _nVec);
      _quatInv.copy(d.mesh.quaternion).invert();
      _iiRcrossN.copy(_rCrossN).applyQuaternion(_quatInv); // body space
      _iiRcrossN.set(                                       // I⁻¹ · (r×n)_body
        d.inertiaBodyInv.x * _iiRcrossN.x,
        d.inertiaBodyInv.y * _iiRcrossN.y,
        d.inertiaBodyInv.z * _iiRcrossN.z,
      );
      _iiRcrossN.applyQuaternion(d.mesh.quaternion);        // חזרה ל-world

      _iiRcrossNxR.crossVectors(_iiRcrossN, _r);
      const angularTerm = _iiRcrossNxR.dot(_nVec);
      const denom       = 1 / d.mass + angularTerm;
      const j           = -(1 + d.restitution) * vRelN / Math.max(1e-9, denom);

      // impulse לינארי
      d.velocity.addScaledVector(_nVec, j / d.mass);

      // impulse זוויתי (world space → body → apply I⁻¹ → world)
      _jN.copy(_nVec).multiplyScalar(j);
      _deltaOmega.crossVectors(_r, _jN);
      _deltaOmega.applyQuaternion(_quatInv);  // body
      _omegaDelta.set(
        d.inertiaBodyInv.x * _deltaOmega.x,
        d.inertiaBodyInv.y * _deltaOmega.y,
        d.inertiaBodyInv.z * _deltaOmega.z,
      );
      _omegaDelta.applyQuaternion(d.mesh.quaternion);  // world
      d.angularVelocity.add(_omegaDelta);

      // Friction משיק
      _tangent.copy(d.velocity).addScaledVector(_nVec, -d.velocity.dot(_nVec));
      const tangentSpeed = _tangent.length();
      if (tangentSpeed > 1e-5) {
        const fi = Math.min(FRICTION_DYNAMIC * Math.abs(j), tangentSpeed * d.mass);
        d.velocity.addScaledVector(_tangent.normalize(), -fi / d.mass);
      }

      resolved = true;
      break;
    }
    if (!resolved) break;
  }
}

// ─── Update ────────────────────────────────────────────────────────────────

export function updateDeathDebris(
  state: DeathDebrisState,
  collidables: THREE.Box3[],
  dt: number,
): void {
  const { group, list } = state;

  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.life -= dt;

    if (d.life <= 0 || d.mesh.position.y < -20) {
      group.remove(d.mesh);
      list.splice(i, 1);
      continue;
    }

    if (d.life < FADE_DURATION) {
      setDebrisOpacity(d.mesh, Math.max(0, d.life / FADE_DURATION));
    }

    // Sleep – רק כשגם תנועה וגם סיבוב עצרו
    if (d.velocity.lengthSq() < SLEEP_VEL_SQ && d.angularVelocity.lengthSq() < SLEEP_ANG_SQ) {
      d.sleepTimer += dt;
      if (d.sleepTimer > SLEEP_DELAY) d.sleeping = true;
    } else {
      d.sleepTimer = 0;
      d.sleeping   = false;
    }
    if (d.sleeping) continue;

    // כבידה
    d.velocity.y += GRAVITY * dt;

    // Drag לינארי ריבועי
    const speed = d.velocity.length();
    if (speed > 1e-6) {
      const dragAccel = (d.linearDamping * speed * speed) / d.mass;
      d.velocity.multiplyScalar(Math.max(0, 1 - (dragAccel / speed) * dt));
    }

    // Angular drag (מינימלי)
    const omega = d.angularVelocity.length();
    if (omega > 1e-6) {
      const angDrag = ANGULAR_DRAG_COEFF * omega * omega / d.mass;
      d.angularVelocity.multiplyScalar(Math.max(0, 1 - (angDrag / omega) * dt));
    }

    // ─── Euler rotation equations ──────────────────────────────────────────
    // מחשב את ההשפעה של צורת הגוף על הסיבוב (precession / tumbling)
    integrateEulerEquations(d, dt);

    // אינטגרציה מיקום
    d.mesh.position.addScaledVector(d.velocity, dt);

    // Collision
    resolveDebrisVsBoxes(d, collidables);

    // ─── עדכון quaternion ──────────────────────────────────────────────────
    const omegaLen = d.angularVelocity.length();
    if (omegaLen > 1e-7) {
      _rotAxis.copy(d.angularVelocity).multiplyScalar(1 / omegaLen);
      _rotDelta.setFromAxisAngle(_rotAxis, omegaLen * dt);
      d.mesh.quaternion.premultiply(_rotDelta);
      d.mesh.quaternion.normalize();
    }
  }
}

// ─── Shared hit impulse ────────────────────────────────────────────────────

function applyHitImpulse(
  part: DeathPart,
  hitPoint: THREE.Vector3,
  dir: THREE.Vector3,
  strength: number,
): void {
  const effMass = Math.min(part.mass, MAX_EFFECTIVE_MASS);

  part.sleeping   = false;
  part.sleepTimer = 0;

  // impulse לינארי
  part.velocity.addScaledVector(dir, strength / effMass);

  // r = hitPoint − CoM
  _impactOffset.subVectors(hitPoint, part.mesh.position);
  if (_impactOffset.length() < 0.05) {
    _impactOffset
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize().multiplyScalar(0.07);
  }

  // τ = r × F  (world) → המר ל-body → I⁻¹ → חזר ל-world
  _torqueWorld.crossVectors(_impactOffset, dir).multiplyScalar(strength);
  _quatInv.copy(part.mesh.quaternion).invert();
  _torqueBody.copy(_torqueWorld).applyQuaternion(_quatInv);
  _torqueResult.set(
    part.inertiaBodyInv.x * _torqueBody.x,
    part.inertiaBodyInv.y * _torqueBody.y,
    part.inertiaBodyInv.z * _torqueBody.z,
  );
  _torqueResult.applyQuaternion(part.mesh.quaternion);
  part.angularVelocity.add(_torqueResult);
}

// ─── Hitscan ───────────────────────────────────────────────────────────────

export function hitDebrisByRay(
  state: DeathDebrisState,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  impulseStrength: number = HIT_IMPULSE_BASE,
): boolean {
  const { list } = state;
  if (list.length === 0) return false;
  _raycaster.set(origin, dir);
  _raycaster.far = maxDist;
  const hits = _raycaster.intersectObjects(list.map((d) => d.mesh), true);
  if (hits.length === 0) return false;
  const hit  = hits[0];
  const part = list.find((d) => d.mesh === hit.object || d.mesh === hit.object.parent);
  if (!part) return false;
  applyHitImpulse(part, hit.point, dir, impulseStrength);
  return true;
}

// ─── Projectile ────────────────────────────────────────────────────────────

export function tryHitDebrisWithProjectile(
  state: DeathDebrisState,
  prStart: THREE.Vector3,
  projDir: THREE.Vector3,
  stepLen: number,
  closestWallDist: number,
): { hit: boolean; impactPoint: THREE.Vector3 | null } {
  const { list } = state;
  if (list.length === 0 || stepLen <= 1e-6)
    return { hit: false, impactPoint: null };
  _raycaster.set(prStart, projDir);
  _raycaster.far = stepLen;
  const hits = _raycaster.intersectObjects(list.map((d) => d.mesh), true);
  if (hits.length === 0 || hits[0].distance >= closestWallDist)
    return { hit: false, impactPoint: null };
  const dHit = hits[0];
  const part = list.find((d) => d.mesh === dHit.object || d.mesh === dHit.object.parent);
  if (!part) return { hit: false, impactPoint: null };
  applyHitImpulse(part, dHit.point, projDir, HIT_IMPULSE_BASE);
  return { hit: true, impactPoint: dHit.point.clone() };
}