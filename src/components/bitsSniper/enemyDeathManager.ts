/**
 * Bits Sniper – ניהול מות האויב עם מנוע Rigid-Body מלא (Rapier).
 *
 * כל פיזיקת המוות מרוכזת כאן: התפרקות לחלקים, כבידה, קוליז'ן עם המפה,
 * פגיעת ירייה (אימפולס ב־applyImpulseAtPoint). כשהרפייר לא טעון – fallback לינארי.
 */
import * as THREE from "three";
import type { BotState } from "./types/gameTypes";

type Rapier3D = typeof import("@dimforge/rapier3d");

// ─── Rapier טעינה אסינכרונית ─────────────────────────────────────────────────

let RAPIER: Rapier3D | null = null;
let initPromise: Promise<void> | null = null;

export function initDeathPhysicsEngine(): Promise<void> {
  if (RAPIER) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = import("@dimforge/rapier3d").then((r) => {
    RAPIER = r;
  });
  return initPromise;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DeathPart {
  mesh: THREE.Object3D;
  life: number;
  mass: number;
  /** כשמשתמשים ב-Rapier */
  rigidBody?: import("@dimforge/rapier3d").RigidBody;
  /** fallback כשאין Rapier */
  velocity?: THREE.Vector3;
  angularVelocity?: THREE.Vector3;
}

export interface DeathDebrisState {
  group: THREE.Group;
  list: DeathPart[];
  /** עולם Rapier (קיים רק אחרי טעינה) */
  world?: import("@dimforge/rapier3d").World;
}

// ─── Kill impact (הירייה ההורגת – כיוון ועוצמה) ─────────────────────────────

/**
 * נתוני הפגיעה שהורגת את האויב – משפיעים פיזיקלית על כל החלקים בעת ההתפרקות.
 * direction: כיוון הירייה/הפיצוץ (נורמלי).
 * impulseMultiplier: עוצמה יחסית (למשל headshot גבוה יותר, splash נמוך).
 * impactPoint: נקודת הפגיעה בעולם – משמשת לחישוב מומנט סיבוב (חלקים רחוקים מסתובבים יותר).
 */
export interface KillImpact {
  direction: THREE.Vector3;
  impulseMultiplier: number;
  impactPoint: THREE.Vector3;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const GRAVITY_Y = -14;
/** משך הדעיכה – החלקים מתחילים להיעלם בהדרגה ב־FADE_DURATION השניות האחרונות. */
const FADE_DURATION = 2.8;
const LIFE_SEC = 6;
const DENSITY = 0.35;
const FRICTION = 0.82;
const ANGULAR_FRICTION = 0.88;
const AIR_DRAG = 1.8;
const HIT_IMPULSE = 2.6;
const TORQUE_SCALE = 3.2;
const PROJ_IMPULSE_MULT = 0.92;
const MIN_HALF_EXT = 0.02;

/** אימפולס בסיס ליניארי בהתפרקות (הירייה ההורגת). */
const KILL_IMPULSE_BASE = 2.2;
/** סקלה למומנט סיבוב בהתפרקות – חלק רחוק מנקודת הפגיעה מקבל יותר סיבוב. */
const KILL_TORQUE_SCALE = 1.2;
/** פיזור ליניארי קטן (רנדום) מעבר לכיוון הראשי. */
const KILL_SPREAD_LINEAR = 0.2;
/** פיזור זוויתי קטן. */
const KILL_SPREAD_ANGULAR = 0.35;
/** מינימום אימפולס ליניארי גם לחלקים כבדים. */
const KILL_MIN_LINEAR_SPEED = 0.35;

// ─── Spawn ─────────────────────────────────────────────────────────────────

const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();
const _aabbSize = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();
const _impactToPart = new THREE.Vector3();
const _linearVel = new THREE.Vector3();
const _torqueAxis = new THREE.Vector3();
const _rnd = new THREE.Vector3();

/**
 * מחשב מהירות ליניארית וזוויתית התחלתית לחלק בהתבסס על הירייה ההורגת.
 * אימפולס בכיוון הפגיעה (מנורמל למסה), + מומנט סיבוב לפי (נקודת פגיעה → מרכז החלק) × כיוון.
 */
function computeKillInitialVelocities(
  partWorldPos: THREE.Vector3,
  mass: number,
  kill: KillImpact,
  outLinear: THREE.Vector3,
  outAngular: THREE.Vector3,
): void {
  const mult = kill.impulseMultiplier;
  const invMass = 1 / Math.max(0.01, mass);
  const linearMag = Math.max(KILL_MIN_LINEAR_SPEED, KILL_IMPULSE_BASE * mult * invMass);
  outLinear.copy(kill.direction).multiplyScalar(linearMag);
  outLinear.x += (Math.random() - 0.5) * KILL_SPREAD_LINEAR * 2;
  outLinear.y += (Math.random() - 0.5) * KILL_SPREAD_LINEAR * 2;
  outLinear.z += (Math.random() - 0.5) * KILL_SPREAD_LINEAR * 2;

  _impactToPart.subVectors(partWorldPos, kill.impactPoint);
  const dist = _impactToPart.length();
  if (dist > 0.01) {
    _rnd.crossVectors(_impactToPart, kill.direction).normalize();
    const torqueMag = KILL_TORQUE_SCALE * mult * invMass * Math.min(dist * 2, 3);
    outAngular.copy(_rnd).multiplyScalar(torqueMag);
  } else {
    outAngular.set(0, 0, 0);
  }
  outAngular.x += (Math.random() - 0.5) * KILL_SPREAD_ANGULAR * 2;
  outAngular.y += (Math.random() - 0.5) * KILL_SPREAD_ANGULAR * 2;
  outAngular.z += (Math.random() - 0.5) * KILL_SPREAD_ANGULAR * 2;
}

export function createDeathDebrisState(collidables: THREE.Box3[]): DeathDebrisState {
  const group = new THREE.Group();
  const list: DeathPart[] = [];
  if (!RAPIER) return { group, list };
  const world = makeRapierWorldWithStatics(collidables);
  return { group, list, world };
}

/** בונה עולם Rapier עם קולידרים סטטיים מהמפה. קוראים אחרי ש־init() הושלם. */
function makeRapierWorldWithStatics(collidables: THREE.Box3[]): import("@dimforge/rapier3d").World {
  if (!RAPIER) throw new Error("Rapier not loaded");
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  for (const box of collidables) {
    box.getCenter(_boxCenter);
    box.getSize(_aabbSize);
    const hx = Math.max(MIN_HALF_EXT, _aabbSize.x * 0.5);
    const hy = Math.max(MIN_HALF_EXT, _aabbSize.y * 0.5);
    const hz = Math.max(MIN_HALF_EXT, _aabbSize.z * 0.5);
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      _boxCenter.x,
      _boxCenter.y,
      _boxCenter.z,
    );
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    world.createCollider(colliderDesc, body);
  }
  return world;
}

/**
 * לשדרג state קיים ל־Rapier אחרי שהמנוע נטען.
 * קוראים: enemyDeathPhysics.init().then(() => enemyDeathPhysics.upgradeStateWithRapier(state, collidables))
 */
export function upgradeStateWithRapier(
  state: DeathDebrisState,
  collidables: THREE.Box3[],
): void {
  if (state.world || !RAPIER) return;
  state.world = makeRapierWorldWithStatics(collidables);
}

export function spawnBotDeathParts(
  bot: BotState,
  state: DeathDebrisState,
  killImpact?: KillImpact,
): void {
  const root = bot.mesh;
  root.updateMatrixWorld(true);

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.Sprite) return;

    const clone = node.clone() as THREE.Mesh;
    node.getWorldPosition(_worldPos);
    node.getWorldQuaternion(_worldQuat);
    node.getWorldScale(_worldScale);
    clone.position.copy(_worldPos);
    clone.quaternion.copy(_worldQuat);
    clone.scale.copy(_worldScale);
    clone.updateMatrixWorld(true);
    makeDebrisMaterialsFadeable(clone);

    const box = new THREE.Box3().setFromObject(clone);
    box.getSize(_aabbSize);
    const volume = Math.max(1e-6, _aabbSize.x * _aabbSize.y * _aabbSize.z);
    const mass = Math.max(0.01, volume * DENSITY);

    state.group.add(clone);

    if (state.world && RAPIER) {
      const hx = Math.max(MIN_HALF_EXT, _aabbSize.x * 0.5);
      const hy = Math.max(MIN_HALF_EXT, _aabbSize.y * 0.5);
      const hz = Math.max(MIN_HALF_EXT, _aabbSize.z * 0.5);
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_worldPos.x, _worldPos.y, _worldPos.z)
        .setRotation({ x: _worldQuat.x, y: _worldQuat.y, z: _worldQuat.z, w: _worldQuat.w });
      const body = state.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(DENSITY)
        .setFriction(FRICTION)
        .setRestitution(0.2);
      state.world.createCollider(colliderDesc, body);

      if (killImpact) {
        computeKillInitialVelocities(_worldPos, mass, killImpact, _linearVel, _torqueAxis);
        body.setLinvel({ x: _linearVel.x, y: _linearVel.y, z: _linearVel.z }, true);
        body.setAngvel({ x: _torqueAxis.x, y: _torqueAxis.y, z: _torqueAxis.z }, true);
      } else {
        body.setLinvel(
          {
            x: (Math.random() - 0.5) * 0.14,
            y: Math.random() * 0.06,
            z: (Math.random() - 0.5) * 0.14,
          },
          true,
        );
        body.setAngvel(
          {
            x: (Math.random() - 0.5) * 0.35,
            y: (Math.random() - 0.5) * 0.35,
            z: (Math.random() - 0.5) * 0.35,
          },
          true,
        );
      }
      body.setLinearDamping(AIR_DRAG * 0.5);
      body.setAngularDamping(ANGULAR_FRICTION);
      state.list.push({ mesh: clone, life: LIFE_SEC, mass, rigidBody: body });
    } else {
      let v: THREE.Vector3;
      let av: THREE.Vector3;
      if (killImpact) {
        v = new THREE.Vector3();
        av = new THREE.Vector3();
        computeKillInitialVelocities(_worldPos, mass, killImpact, v, av);
      } else {
        v = new THREE.Vector3(
          (Math.random() - 0.5) * 0.14,
          Math.random() * 0.06,
          (Math.random() - 0.5) * 0.14,
        );
        av = new THREE.Vector3(
          (Math.random() - 0.5) * 0.35,
          (Math.random() - 0.5) * 0.35,
          (Math.random() - 0.5) * 0.35,
        );
      }
      state.list.push({
        mesh: clone,
        life: LIFE_SEC,
        mass,
        velocity: v,
        angularVelocity: av,
      });
    }
  });
}

// ─── Fallback: קוליז'ן ידני + opacity ──────────────────────────────────────

const _debrisBox = new THREE.Box3();
const _debrisCenter = new THREE.Vector3();
const _boxCenterFallback = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

function pushDebrisOutOfBoxes(d: DeathPart, collidables: THREE.Box3[]): void {
  if (!d.velocity) return;
  const pos = d.mesh.position;
  for (let iter = 0; iter < 6; iter++) {
    d.mesh.updateMatrixWorld(true);
    _debrisBox.setFromObject(d.mesh);
    let pushed = false;
    for (const box of collidables) {
      if (!_debrisBox.intersectsBox(box)) continue;
      box.getCenter(_boxCenterFallback);
      _debrisBox.getCenter(_debrisCenter);
      const overlapX = Math.min(_debrisBox.max.x - box.min.x, box.max.x - _debrisBox.min.x);
      const overlapY = Math.min(_debrisBox.max.y - box.min.y, box.max.y - _debrisBox.min.y);
      const overlapZ = Math.min(_debrisBox.max.z - box.min.z, box.max.z - _debrisBox.min.z);
      const minOverlap = Math.min(overlapX, overlapY, overlapZ);
      if (minOverlap <= 0) continue;
      if (minOverlap === overlapX) {
        pos.x += _debrisCenter.x < _boxCenterFallback.x ? -overlapX : overlapX;
        d.velocity.x = 0;
        d.velocity.y! *= FRICTION;
        d.velocity.z! *= FRICTION;
        d.angularVelocity?.multiplyScalar(ANGULAR_FRICTION);
      } else if (minOverlap === overlapY) {
        pos.y += _debrisCenter.y < _boxCenterFallback.y ? -overlapY : overlapY;
        d.velocity.y = 0;
        d.velocity.x! *= FRICTION;
        d.velocity.z! *= FRICTION;
        d.angularVelocity?.multiplyScalar(ANGULAR_FRICTION);
      } else {
        pos.z += _debrisCenter.z < _boxCenterFallback.z ? -overlapZ : overlapZ;
        d.velocity.z = 0;
        d.velocity.x! *= FRICTION;
        d.velocity.y! *= FRICTION;
        d.angularVelocity?.multiplyScalar(ANGULAR_FRICTION);
      }
      pushed = true;
      break;
    }
    if (!pushed) break;
  }
}

/** משכפל חומרים של mesh כדי שכל שבר יהיה עם חומר משלו (לא משותף עם הבוט) ומאפשר דעיכה. */
function makeDebrisMaterialsFadeable(mesh: THREE.Object3D): void {
  mesh.traverse((node) => {
    const meshNode = node as THREE.Mesh;
    if (!meshNode.isMesh || !meshNode.material) return;
    const mats = Array.isArray(meshNode.material) ? meshNode.material : [meshNode.material];
    const cloned = mats.map((mat) => {
      const m = mat.clone();
      m.transparent = true;
      (m as THREE.Material & { opacity?: number }).opacity = 1;
      m.depthWrite = true;
      return m;
    });
    meshNode.material = cloned.length === 1 ? cloned[0] : cloned;
  });
}

function setDebrisOpacity(mesh: THREE.Object3D, opacity: number): void {
  mesh.traverse((node) => {
    const m = (node as THREE.Mesh).material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    mats.forEach((mat) => {
      const base = mat as THREE.Material & { transparent?: boolean; opacity?: number };
      if (typeof base.opacity === "undefined") return;
      base.transparent = true;
      base.opacity = Math.max(0, Math.min(1, opacity));
      base.depthWrite = opacity >= 0.99;
    });
  });
}

// ─── Update ─────────────────────────────────────────────────────────────────

export function updateDeathDebris(
  state: DeathDebrisState,
  collidables: THREE.Box3[],
  dt: number,
): void {
  const { group, list, world } = state;

  if (world && RAPIER) {
    world.step();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life -= dt;
      if (d.life <= 0 || (d.rigidBody ? d.rigidBody.translation().y < -15 : d.mesh.position.y < -15)) {
        if (d.rigidBody) world.removeRigidBody(d.rigidBody);
        group.remove(d.mesh);
        list.splice(i, 1);
        continue;
      }
      if (d.rigidBody) {
        const t = d.rigidBody.translation();
        d.mesh.position.set(t.x, t.y, t.z);
        const r = d.rigidBody.rotation();
        d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      } else if (d.velocity && d.angularVelocity) {
        d.mesh.position.x += d.velocity.x * dt;
        d.mesh.position.y += d.velocity.y * dt;
        d.mesh.position.z += d.velocity.z * dt;
        d.velocity.y += GRAVITY_Y * dt;
        const drag = 1 - AIR_DRAG * dt;
        d.velocity.multiplyScalar(Math.max(0, drag));
        d.angularVelocity.multiplyScalar(Math.max(0, drag));
        pushDebrisOutOfBoxes(d, collidables);
        _euler.set(
          d.mesh.rotation.x + d.angularVelocity.x * dt,
          d.mesh.rotation.y + d.angularVelocity.y * dt,
          d.mesh.rotation.z + d.angularVelocity.z * dt,
        );
        d.mesh.rotation.x = _euler.x;
        d.mesh.rotation.y = _euler.y;
        d.mesh.rotation.z = _euler.z;
      }
      if (d.life < FADE_DURATION) {
        const opacity = Math.max(0, d.life / FADE_DURATION);
        setDebrisOpacity(d.mesh, opacity);
      }
    }
    return;
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.life -= dt;
    if (d.life <= 0 || d.mesh.position.y < -15) {
      group.remove(d.mesh);
      list.splice(i, 1);
      continue;
    }
    if (d.velocity && d.angularVelocity) {
      d.mesh.position.x += d.velocity.x * dt;
      d.mesh.position.y += d.velocity.y * dt;
      d.mesh.position.z += d.velocity.z * dt;
      d.velocity.y += GRAVITY_Y * dt;
      const drag = 1 - AIR_DRAG * dt;
      d.velocity.multiplyScalar(Math.max(0, drag));
      d.angularVelocity.multiplyScalar(Math.max(0, drag));
      pushDebrisOutOfBoxes(d, collidables);
      _euler.set(
        d.mesh.rotation.x + d.angularVelocity.x * dt,
        d.mesh.rotation.y + d.angularVelocity.y * dt,
        d.mesh.rotation.z + d.angularVelocity.z * dt,
      );
      d.mesh.rotation.x = _euler.x;
      d.mesh.rotation.y = _euler.y;
      d.mesh.rotation.z = _euler.z;
    }
    if (d.life < FADE_DURATION) {
      const opacity = Math.max(0, d.life / FADE_DURATION);
      setDebrisOpacity(d.mesh, opacity);
    }
  }
}

// ─── Hit: ray + projectile ──────────────────────────────────────────────────

const _raycaster = new THREE.Raycaster();
const _impactOffset = new THREE.Vector3();
const _torque = new THREE.Vector3();

function applyHitImpulseFallback(
  part: DeathPart,
  hitPoint: THREE.Vector3,
  dir: THREE.Vector3,
  strength: number,
): void {
  if (!part.velocity || !part.angularVelocity) return;
  const invMass = 1 / Math.max(0.01, part.mass);
  part.velocity.addScaledVector(dir, strength * invMass);
  _impactOffset.copy(hitPoint).sub(part.mesh.position);
  _torque.crossVectors(_impactOffset, dir);
  part.angularVelocity.addScaledVector(_torque, TORQUE_SCALE * invMass);
}

export function hitDebrisByRay(
  state: DeathDebrisState,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  impulseStrength: number = HIT_IMPULSE,
): boolean {
  const { list } = state;
  if (list.length === 0) return false;
  _raycaster.set(origin, dir);
  _raycaster.far = maxDist;
  const hits = _raycaster.intersectObjects(list.map((d) => d.mesh), false);
  if (hits.length === 0) return false;
  const hit = hits[0];
  const part = list.find((d) => d.mesh === hit.object);
  if (!part) return false;
  if (part.rigidBody && RAPIER) {
    const impulse = impulseStrength / Math.max(0.01, part.mass);
    part.rigidBody.applyImpulseAtPoint(
      { x: dir.x * impulse, y: dir.y * impulse, z: dir.z * impulse },
      { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      true,
    );
  } else {
    applyHitImpulseFallback(part, hit.point, dir, impulseStrength);
  }
  return true;
}

export function tryHitDebrisWithProjectile(
  state: DeathDebrisState,
  prStart: THREE.Vector3,
  projDir: THREE.Vector3,
  stepLen: number,
  closestWallDist: number,
): { hit: boolean; impactPoint: THREE.Vector3 | null } {
  const { list } = state;
  if (list.length === 0 || stepLen <= 1e-6) return { hit: false, impactPoint: null };
  _raycaster.set(prStart, projDir);
  _raycaster.far = stepLen;
  const hits = _raycaster.intersectObjects(list.map((d) => d.mesh), false);
  if (hits.length === 0 || hits[0].distance >= closestWallDist)
    return { hit: false, impactPoint: null };
  const dHit = hits[0];
  const part = list.find((d) => d.mesh === dHit.object);
  if (!part) return { hit: false, impactPoint: null };
  const strength = HIT_IMPULSE * PROJ_IMPULSE_MULT;
  if (part.rigidBody && RAPIER) {
    const impulse = strength / Math.max(0.01, part.mass);
    part.rigidBody.applyImpulseAtPoint(
      {
        x: projDir.x * impulse,
        y: projDir.y * impulse,
        z: projDir.z * impulse,
      },
      { x: dHit.point.x, y: dHit.point.y, z: dHit.point.z },
      true,
    );
  } else {
    applyHitImpulseFallback(part, dHit.point, projDir, strength);
  }
  return { hit: true, impactPoint: dHit.point.clone() };
}

// ─── API ───────────────────────────────────────────────────────────────────

export const enemyDeathPhysics = {
  init: initDeathPhysicsEngine,
  createState: createDeathDebrisState,
  upgradeStateWithRapier,
  spawn: spawnBotDeathParts,
  update: updateDeathDebris,
  hitByRay: hitDebrisByRay,
  tryHitByProjectile: tryHitDebrisWithProjectile,
} as const;
