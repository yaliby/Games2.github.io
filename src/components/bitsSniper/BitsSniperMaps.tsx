import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { createWarehouseGroup, WAREHOUSE_HALF } from "./maps/WarehouseMap";

export const ARENA_HALF = 72;
export const FORCE_PROCEDURAL_DUST2 = false;
/** When true, use a simple flat playground (no external level assets loaded). */
export const USE_FLAT_PLAYGROUND = true;

export type MapKeyPointKind = "heal" | "ammo" | "shield";

export type MapKeyPoint = {
  id: string;
  kind: MapKeyPointKind;
  position: THREE.Vector3;
  radius: number;
  cooldown: number;
  nextReadyAt: number;
  pulse: number;
  coreMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshStandardMaterial;
  marker: THREE.Object3D;
  light: THREE.PointLight;
};

export type MapBuildResult = {
  collidables: THREE.Box3[];
  keyPoints: MapKeyPoint[];
  levelRoot: THREE.Object3D | null;
  /** Half-extent of play boundary (symmetric ±boundaryHalf). Used for safety clamp so it matches this map's walls. */
  boundaryHalf: number;
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

type ObjectBounds = { min: THREE.Vector3; max: THREE.Vector3; size: THREE.Vector3 };

function getObjectBounds(root: THREE.Object3D): ObjectBounds | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.lengthSq() < 1e-8) return null;
  return { min: box.min.clone(), max: box.max.clone(), size };
}

function makeCheckerTexture(size: number, col1: string, col2: string, repeat = 1): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const tile = size / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? col1 : col2;
      ctx.fillRect(i * tile, j * tile, tile, tile);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Subtle concrete/plaster texture with fine noise – clean, smooth wall look. */
function makeConcreteTexture(size: number, baseCol: string, repeat = 4): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = baseCol;
  ctx.fillRect(0, 0, size, size);

  // Fine noise grain for a plaster/concrete feel
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const noise = (Math.random() - 0.5) * 18;
    d[i] = clamp(d[i] + noise, 0, 255);
    d[i + 1] = clamp(d[i + 1] + noise, 0, 255);
    d[i + 2] = clamp(d[i + 2] + noise, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);

  // Subtle horizontal mortar lines
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  const brickH = size / 8;
  for (let y = brickH; y < size; y += brickH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Simple flat world: one floor + four walls with textures for a more enjoyable look. */
export function createFlatPlayground(): THREE.Group {
  const g = new THREE.Group();
  g.name = "flat_playground";

  const A = ARENA_HALF;
  const floorThick = 0.6;
  const floorY = -floorThick * 0.5;
  const wallH = 6;
  const wallW = 2.4;

  const floorTex = makeCheckerTexture(128, "#7a7358", "#9a9270", 24);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: "#ffffff",
    roughness: 0.92,
    metalness: 0.02,
  });

  const wallTex = makeConcreteTexture(256, "#b0a48a", 6);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    color: "#ffffff",
    roughness: 0.92,
    metalness: 0.02,
  });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(A * 2, floorThick, A * 2),
    floorMat,
  );
  floor.position.set(0, floorY, 0);
  floor.receiveShadow = true;
  floor.castShadow = false;
  floor.name = "floor";
  g.add(floor);

  const addWall = (name: string, x: number, z: number, w: number, d: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat.clone());
    m.position.set(x, wallH * 0.5, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
  };

  addWall("wall_n", 0, -A + wallW * 0.5, A * 2, wallW);
  addWall("wall_s", 0, A - wallW * 0.5, A * 2, wallW);
  addWall("wall_w", -A + wallW * 0.5, 0, wallW, A * 2);
  addWall("wall_e", A - wallW * 0.5, 0, wallW, A * 2);

  return g;
}

/** Colosseum: circular gladiator arena with sand floor, stone walls, pillars, cover objects. */
export const COLOSSEUM_RADIUS = 36;

/** CTF dedicated map: half-extent (symmetric ±H on X and Z). */
export const CTF_MAP_HALF = 42;
export const CTF_BLUE_BASE_X = -34;
export const CTF_RED_BASE_X = 34;
export const COLOSSEUM_WALL_H = 8;
export const COLOSSEUM_WALL_THICK = 2.6;

function makeSandTexture(size: number, repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c4a96a";
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    d[i]     = clamp(d[i]     + n + (Math.random() - 0.5) * 12, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n + (Math.random() - 0.5) * 8, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n * 0.6, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStoneTexture(size: number, baseCol: string, repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = baseCol;
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i]     = clamp(d[i]     + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);
  const brickH = size / 6;
  const brickW = size / 3;
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 2;
  for (let row = 0; row < 6; row++) {
    const y = row * brickH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    const offset = (row % 2) * (brickW * 0.5);
    for (let col = 0; col < 4; col++) {
      const x = offset + col * brickW;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + brickH); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWoodTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#6b4226";
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const row = Math.floor((i / 4) / size);
    const stripe = Math.sin(row * 0.3) * 8;
    const n = (Math.random() - 0.5) * 16 + stripe;
    d[i]     = clamp(d[i]     + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n * 0.7, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n * 0.4, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += size / 8) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMetalTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5a5a5e";
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i]     = clamp(d[i]     + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createColosseumArena(): THREE.Group {
  const g = new THREE.Group();
  g.name = "colosseum_arena";

  const R = COLOSSEUM_RADIUS;
  const floorThick = 0.8;
  const floorY = -floorThick * 0.5;
  const WH = COLOSSEUM_WALL_H;
  const WT = COLOSSEUM_WALL_THICK;

  const sandTex = makeSandTexture(256, 18);
  const floorMat = new THREE.MeshStandardMaterial({
    map: sandTex,
    color: "#ffffff",
    roughness: 0.95,
    metalness: 0.01,
  });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R - WT, R - WT, floorThick, 64), floorMat);
  floor.position.set(0, floorY, 0);
  floor.receiveShadow = true;
  floor.name = "floor";
  g.add(floor);

  const stoneTex = makeStoneTexture(256, "#8a7a5e", 8);
  const wallMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    color: "#ffffff",
    roughness: 0.88,
    metalness: 0.04,
  });

  const wallSegs = 48;
  const segAng = (Math.PI * 2) / wallSegs;
  for (let i = 0; i < wallSegs; i++) {
    const a = i * segAng;
    const cx = Math.cos(a) * (R - WT * 0.5);
    const cz = Math.sin(a) * (R - WT * 0.5);
    const d = (R * 2 * Math.PI) / wallSegs + 0.3;
    const m = new THREE.Mesh(new THREE.BoxGeometry(WT, WH, d), wallMat.clone());
    m.position.set(cx, WH * 0.5, cz);
    m.rotation.y = -a;
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `colosseum_wall_${i}`;
    g.add(m);
  }

  const upperStoneTex = makeStoneTexture(256, "#7a6e52", 10);
  const upperMat = new THREE.MeshStandardMaterial({
    map: upperStoneTex,
    color: "#ffffff",
    roughness: 0.82,
    metalness: 0.06,
  });
  const ledgeH = 1.2;
  for (let i = 0; i < wallSegs; i++) {
    const a = i * segAng;
    const cx = Math.cos(a) * (R - WT * 0.25);
    const cz = Math.sin(a) * (R - WT * 0.25);
    const d = (R * 2 * Math.PI) / wallSegs + 0.3;
    const m = new THREE.Mesh(new THREE.BoxGeometry(WT * 1.3, ledgeH, d), upperMat.clone());
    m.position.set(cx, WH + ledgeH * 0.5, cz);
    m.rotation.y = -a;
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `colosseum_ledge_${i}`;
    g.add(m);
  }

  const pillarMat = new THREE.MeshStandardMaterial({
    map: makeStoneTexture(128, "#968a6e", 2),
    color: "#ffffff",
    roughness: 0.78,
    metalness: 0.08,
  });
  const pillarCount = 12;
  const pillarH = WH + ledgeH + 0.5;
  const pillarR = 0.55;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2;
    const px = Math.cos(a) * (R - WT - 0.1);
    const pz = Math.sin(a) * (R - WT - 0.1);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(pillarR, pillarR * 1.15, pillarH, 10),
      pillarMat.clone(),
    );
    pillar.position.set(px, pillarH * 0.5, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    pillar.name = `colosseum_pillar_${i}`;
    g.add(pillar);
    const capR = pillarR * 1.4;
    const capH = 0.35;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR * 0.9, capH, 10), pillarMat.clone());
    cap.position.set(px, pillarH + capH * 0.5, pz);
    cap.castShadow = true;
    cap.name = `colosseum_pillar_cap_${i}`;
    g.add(cap);
  }

  const woodTex = makeWoodTexture(128);
  const crateMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85, metalness: 0.04 });
  const metalTex = makeMetalTexture(64);
  const barrelMat = new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.6, metalness: 0.35 });

  type CoverDef = { type: "crate" | "barrel" | "crate_stack"; x: number; z: number; rot?: number };
  const coverObjects: CoverDef[] = [
    { type: "crate", x: 8, z: 0 },
    { type: "crate", x: -8, z: 0 },
    { type: "barrel", x: 0, z: 10 },
    { type: "barrel", x: 0, z: -10 },
    { type: "crate_stack", x: 14, z: 14, rot: 0.4 },
    { type: "crate_stack", x: -14, z: -14, rot: -0.6 },
    { type: "barrel", x: 18, z: -6, rot: 0.2 },
    { type: "barrel", x: -18, z: 6, rot: -0.3 },
    { type: "crate", x: -6, z: 18, rot: 0.5 },
    { type: "crate", x: 6, z: -18, rot: -0.5 },
    { type: "barrel", x: -20, z: -16 },
    { type: "barrel", x: 20, z: 16 },
    { type: "crate_stack", x: -10, z: -22, rot: 0.3 },
    { type: "crate_stack", x: 10, z: 22, rot: -0.3 },
    { type: "crate", x: 22, z: -10, rot: 0.6 },
    { type: "crate", x: -22, z: 10, rot: -0.7 },
  ];

  for (const obj of coverObjects) {
    const rx = obj.x + (Math.sin(obj.x * 1.7 + obj.z * 0.9) * 1.2);
    const rz = obj.z + (Math.cos(obj.z * 1.3 + obj.x * 0.7) * 1.2);
    const distFromCenter = Math.sqrt(rx * rx + rz * rz);
    if (distFromCenter > R - WT - 2) continue;

    if (obj.type === "crate") {
      const s = 1.3 + Math.abs(Math.sin(obj.x + obj.z)) * 0.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat.clone());
      m.position.set(rx, s * 0.5, rz);
      m.rotation.y = obj.rot ?? 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = "cover_crate";
      g.add(m);
    } else if (obj.type === "barrel") {
      const bH = 1.4;
      const bR = 0.45;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(bR, bR * 0.95, bH, 12), barrelMat.clone());
      m.position.set(rx, bH * 0.5, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = "cover_barrel";
      g.add(m);
    } else if (obj.type === "crate_stack") {
      const s1 = 1.5;
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(s1, s1, s1), crateMat.clone());
      m1.position.set(rx, s1 * 0.5, rz);
      m1.rotation.y = obj.rot ?? 0;
      m1.castShadow = true;
      m1.receiveShadow = true;
      m1.name = "cover_crate_bottom";
      g.add(m1);
      const s2 = 1.1;
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(s2, s2, s2), crateMat.clone());
      m2.position.set(rx + 0.1, s1 + s2 * 0.5, rz - 0.1);
      m2.rotation.y = (obj.rot ?? 0) + 0.3;
      m2.castShadow = true;
      m2.receiveShadow = true;
      m2.name = "cover_crate_top";
      g.add(m2);
    }
  }

  const innerRingR = 5;
  const innerRingMat = new THREE.MeshStandardMaterial({
    map: makeStoneTexture(128, "#806e4e", 4),
    roughness: 0.9,
    metalness: 0.04,
  });
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(innerRingR, 0.25, 8, 32),
    innerRingMat,
  );
  innerRing.rotation.x = Math.PI * 0.5;
  innerRing.position.set(0, 0.02, 0);
  innerRing.receiveShadow = true;
  innerRing.name = "center_ring";
  g.add(innerRing);

  return g;
}

/** CTF dedicated map: symmetric 3-lane arena, blue base left (-X), red base right (+X). */
export function createCtfArena(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ctf_arena";

  const H = CTF_MAP_HALF;
  const floorThick = 0.6;
  const floorY = -floorThick * 0.5;
  const wallH = 6;
  const wallThick = 2;
  const laneW = 10;

  function addSolid(
    name: string, x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    mat: THREE.Material,
  ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y + sy * 0.5, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
    return m;
  }

  // ─── Floor ─────────────────────────────────────────
  const floorTex = makeCheckerTexture(256, "#bfb490", "#a49570", 10);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: "#fff", roughness: 0.92, metalness: 0.02 });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(H * 2 + wallThick * 2, floorThick, H * 2 + wallThick * 2),
    floorMat,
  );
  floor.position.set(0, floorY, 0);
  floor.receiveShadow = true;
  floor.name = "ctf_floor";
  g.add(floor);

  // ─── Perimeter walls ──────────────────────────────
  const wallTex = makeConcreteTexture(256, "#9a8e76", 4);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, color: "#fff", roughness: 0.88, metalness: 0.04 });
  addSolid("ctf_wall_left",  -H - wallThick * 0.5, 0, 0, wallThick, wallH, H * 2 + wallThick * 2, wallMat.clone());
  addSolid("ctf_wall_right",  H + wallThick * 0.5, 0, 0, wallThick, wallH, H * 2 + wallThick * 2, wallMat.clone());
  addSolid("ctf_wall_back",   0, 0, -H - wallThick * 0.5, H * 2 + wallThick * 4, wallH, wallThick, wallMat.clone());
  addSolid("ctf_wall_front",  0, 0,  H + wallThick * 0.5, H * 2 + wallThick * 4, wallH, wallThick, wallMat.clone());

  // ─── 3-Lane divider walls (N/S walls with openings) ─
  const dividerMat = new THREE.MeshStandardMaterial({ map: makeConcreteTexture(128, "#7a7262", 2), color: "#fff", roughness: 0.85, metalness: 0.06 });
  const divWallH = 4;
  const gapZ = laneW * 0.5 + 1;
  const divLen = H * 2 * 0.55;
  // North divider (two segments with gap for middle lane)
  addSolid("ctf_div_n_l", -divLen * 0.25, 0, -gapZ, divLen * 0.5 - 3, divWallH, 1.2, dividerMat.clone());
  addSolid("ctf_div_n_r",  divLen * 0.25, 0, -gapZ, divLen * 0.5 - 3, divWallH, 1.2, dividerMat.clone());
  // South divider
  addSolid("ctf_div_s_l", -divLen * 0.25, 0,  gapZ, divLen * 0.5 - 3, divWallH, 1.2, dividerMat.clone());
  addSolid("ctf_div_s_r",  divLen * 0.25, 0,  gapZ, divLen * 0.5 - 3, divWallH, 1.2, dividerMat.clone());

  // ─── Middle lane obstacles ─────────────────────────
  const coverMat = new THREE.MeshStandardMaterial({ color: "#6b5c49", roughness: 0.78, metalness: 0.06 });
  addSolid("ctf_mid_cover1",  0, 0, 0, 3, 1.6, 3, coverMat.clone());
  addSolid("ctf_mid_cover2", -8, 0, 0, 2.5, 1.4, 2.5, coverMat.clone());
  addSolid("ctf_mid_cover3",  8, 0, 0, 2.5, 1.4, 2.5, coverMat.clone());

  // ─── North lane obstacles ─────────────────────────
  addSolid("ctf_n_cover1", -14, 0, -gapZ - 5, 2.2, 1.2, 2.2, coverMat.clone());
  addSolid("ctf_n_cover2",  14, 0, -gapZ - 5, 2.2, 1.2, 2.2, coverMat.clone());
  addSolid("ctf_n_cover3",   0, 0, -gapZ - 8, 3, 1.5, 1.5, coverMat.clone());

  // ─── South lane obstacles ─────────────────────────
  addSolid("ctf_s_cover1", -14, 0,  gapZ + 5, 2.2, 1.2, 2.2, coverMat.clone());
  addSolid("ctf_s_cover2",  14, 0,  gapZ + 5, 2.2, 1.2, 2.2, coverMat.clone());
  addSolid("ctf_s_cover3",   0, 0,  gapZ + 8, 3, 1.5, 1.5, coverMat.clone());

  // ─── Blue base structure (left side) ──────────────
  const blueBaseMat = new THREE.MeshStandardMaterial({ color: "#3a5a8a", roughness: 0.7, metalness: 0.12 });
  addSolid("ctf_blue_wall_back", CTF_BLUE_BASE_X - 6, 0, 0, 1.5, 3.5, 18, blueBaseMat.clone());
  addSolid("ctf_blue_wall_n", CTF_BLUE_BASE_X - 3, 0, -8, 8, 3.5, 1.5, blueBaseMat.clone());
  addSolid("ctf_blue_wall_s", CTF_BLUE_BASE_X - 3, 0,  8, 8, 3.5, 1.5, blueBaseMat.clone());
  addSolid("ctf_blue_cover1", CTF_BLUE_BASE_X + 4, 0, -4, 2, 1.2, 2, coverMat.clone());
  addSolid("ctf_blue_cover2", CTF_BLUE_BASE_X + 4, 0,  4, 2, 1.2, 2, coverMat.clone());

  // ─── Red base structure (right side, mirrored) ─────
  const redBaseMat = new THREE.MeshStandardMaterial({ color: "#8a3a3a", roughness: 0.7, metalness: 0.12 });
  addSolid("ctf_red_wall_back", CTF_RED_BASE_X + 6, 0, 0, 1.5, 3.5, 18, redBaseMat.clone());
  addSolid("ctf_red_wall_n", CTF_RED_BASE_X + 3, 0, -8, 8, 3.5, 1.5, redBaseMat.clone());
  addSolid("ctf_red_wall_s", CTF_RED_BASE_X + 3, 0,  8, 8, 3.5, 1.5, redBaseMat.clone());
  addSolid("ctf_red_cover1", CTF_RED_BASE_X - 4, 0, -4, 2, 1.2, 2, coverMat.clone());
  addSolid("ctf_red_cover2", CTF_RED_BASE_X - 4, 0,  4, 2, 1.2, 2, coverMat.clone());

  // ─── Base zone accent (colored ground markings) ────
  const blueAccent = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: "#2288ff", transparent: true, opacity: 0.22, roughness: 0.9 }),
  );
  blueAccent.position.set(CTF_BLUE_BASE_X, 0.04, 0);
  blueAccent.receiveShadow = true;
  blueAccent.name = "ctf_blue_zone";
  g.add(blueAccent);

  const redAccent = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: "#ff3333", transparent: true, opacity: 0.22, roughness: 0.9 }),
  );
  redAccent.position.set(CTF_RED_BASE_X, 0.04, 0);
  redAccent.receiveShadow = true;
  redAccent.name = "ctf_red_zone";
  g.add(redAccent);

  // ─── Additional flanking cover near bases ──────────
  addSolid("ctf_flank_bl", -22, 0, -16, 2, 1.4, 4, coverMat.clone());
  addSolid("ctf_flank_bl2", -22, 0,  16, 2, 1.4, 4, coverMat.clone());
  addSolid("ctf_flank_rl",  22, 0, -16, 2, 1.4, 4, coverMat.clone());
  addSolid("ctf_flank_rl2", 22, 0,  16, 2, 1.4, 4, coverMat.clone());

  return g;
}

export function createProceduralDust2Blockout(): THREE.Group {
  const g = new THREE.Group();
  g.name = "native_skirmish_arena";

  const A = ARENA_HALF;
  const floorY = -0.35;
  const floorT = 0.7;

  const floorMat = new THREE.MeshStandardMaterial({ color: "#7f7a6a", roughness: 0.96, metalness: 0.02 });
  const wallMat  = new THREE.MeshStandardMaterial({ color: "#c9b68e", roughness: 0.92, metalness: 0.02 });
  const wallMat2 = new THREE.MeshStandardMaterial({ color: "#7aa0c6", roughness: 0.92, metalness: 0.02 });
  const coverMat = new THREE.MeshStandardMaterial({ color: "#6a6f78", roughness: 0.85, metalness: 0.08 });
  const accentMat= new THREE.MeshStandardMaterial({ color: "#9a6a3a", roughness: 0.9,  metalness: 0.03 });

  const addBox = (
    name: string,
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    mat: THREE.Material,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y + sy * 0.5, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
    return m;
  };

  // Floor tiles
  const tile = 8;
  const span = A * 2;
  const n = Math.ceil(span / tile);
  const start = -A + tile * 0.5;
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const x = start + ix * tile;
      const z = start + iz * tile;
      const m = new THREE.Mesh(new THREE.BoxGeometry(tile, floorT, tile), floorMat);
      m.position.set(x, floorY, z);
      m.receiveShadow = true;
      m.castShadow = false;
      m.name = "floor_tile";
      g.add(m);
    }
  }

  // Walls
  const W = 2.6;
  const H = 6.0;
  addBox("perim_n", 0, 0, -A + W * 0.5, span, H, W, wallMat);
  addBox("perim_s", 0, 0,  A - W * 0.5, span, H, W, wallMat);
  addBox("perim_w", -A + W * 0.5, 0, 0, W, H, span, wallMat);
  addBox("perim_e",  A - W * 0.5, 0, 0, W, H, span, wallMat);

  // Mid
  addBox("mid_left_wall",  -14, 0,  0,  4, H, 54, wallMat);
  addBox("mid_right_wall",  14, 0,  0,  4, H, 54, wallMat);

  // Long/Tunnels blockers
  addBox("west_long_block", -36, 0,  10, 18, H, 4, wallMat2);
  addBox("west_long_block2",-42, 0, -18,  6, H, 28, wallMat2);
  addBox("east_long_block",  36, 0, -10, 18, H, 4, wallMat2);
  addBox("east_long_block2", 42, 0,  18,  6, H, 28, wallMat2);

  // Bases
  addBox("base_sw_back", -50, 0,  44, 44, H, 4, accentMat);
  addBox("base_sw_side", -70, 0,  24, 4, H, 36, accentMat);
  addBox("base_ne_back",  50, 0, -44, 44, H, 4, wallMat2);
  addBox("base_ne_side",  70, 0, -24, 4, H, 36, wallMat2);

  // Platform
  const platY = 0.0;
  const platH = 2.4;
  addBox("mid_platform", 0, platY, 0, 22, platH, 22, coverMat);

  const makeStairs = (name: string, x0: number, z0: number, dirX: number, dirZ: number) => {
    const steps = 6;
    const stepH = platH / steps;
    const stepD = 3.0;
    const stepW = 10.0;
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const x = x0 + dirX * stepD * i;
      const z = z0 + dirZ * stepD * i;
      addBox(`${name}_s${i}`, x, 0, z, dirZ !== 0 ? stepW : stepD, h, dirZ !== 0 ? stepD : stepW, coverMat);
    }
  };

  makeStairs("stairs_n", 0, -18, 0, 1);
  makeStairs("stairs_s", 0,  18, 0, -1);
  makeStairs("stairs_w",-18, 0, 1, 0);
  makeStairs("stairs_e", 18, 0, -1, 0);

  // Cover
  addBox("mid_pillar1", -6, 0, -6, 2.2, 4.6, 2.2, coverMat);
  addBox("mid_pillar2",  6, 0,  6, 2.2, 4.6, 2.2, coverMat);
  addBox("mid_crateA",   0, 0,  10, 4.2, 2.2, 3.4, coverMat);
  addBox("mid_crateB",   0, 0, -10, 4.2, 2.2, 3.4, coverMat);

  // Tunnels
  const tunH = 2.3;
  addBox("west_tunnel_roof", -56, 0.0, 0, 24, tunH, 12, wallMat);
  addBox("west_tunnel_wall1", -56, 0,  6, 24, H, 2, wallMat);
  addBox("west_tunnel_wall2", -56, 0, -6, 24, H, 2, wallMat);
  addBox("west_tunnel_cap1", -68, 0, 0, 2, H, 12, wallMat);
  addBox("west_tunnel_cap2", -44, 0, 0, 2, H, 12, wallMat);

  addBox("east_tunnel_roof",  56, 0.0, 0, 24, tunH, 12, wallMat2);
  addBox("east_tunnel_wall1",  56, 0,  6, 24, H, 2, wallMat2);
  addBox("east_tunnel_wall2",  56, 0, -6, 24, H, 2, wallMat2);
  addBox("east_tunnel_cap1",  68, 0, 0, 2, H, 12, wallMat2);
  addBox("east_tunnel_cap2",  44, 0, 0, 2, H, 12, wallMat2);

  // Long cover
  addBox("west_long_cover1", -52, 0,  28, 10, 2.2, 4, coverMat);
  addBox("west_long_cover2", -36, 0,  34, 10, 2.2, 4, coverMat);
  addBox("east_long_cover1",  52, 0, -28, 10, 2.2, 4, coverMat);
  addBox("east_long_cover2",  36, 0, -34, 10, 2.2, 4, coverMat);

  // Boosts
  addBox("boost_sw", -30, 0,  40, 3.2, 1.2, 3.2, coverMat);
  addBox("boost_ne",  30, 0, -40, 3.2, 1.2, 3.2, coverMat);

  // Beams
  addBox("beam_mid_1", 0, 4.6, 0, 60, 0.6, 0.8, new THREE.MeshStandardMaterial({ color: "#30343a", roughness: 0.8, metalness: 0.2 }));
  addBox("beam_mid_2", 0, 4.6, 8, 60, 0.6, 0.8, new THREE.MeshStandardMaterial({ color: "#30343a", roughness: 0.8, metalness: 0.2 }));

  g.position.y = 0.0;
  return g;
}

export function buildMap(scene: THREE.Scene, levelTemplate?: THREE.Group | null, mapId?: string): MapBuildResult {
  const collidables: THREE.Box3[] = [];
  const keyPoints: MapKeyPoint[] = [];
  const A = ARENA_HALF;

  function addKeyPoint(
    id: string,
    kind: MapKeyPointKind,
    x: number,
    y: number,
    z: number,
    color: string,
    radius: number,
    cooldown: number,
  ) {
    const marker = new THREE.Group();
    marker.position.set(x, y, z);

    const coreMat = new THREE.MeshStandardMaterial({
      color: "#172337",
      emissive: color,
      emissiveIntensity: 0.82,
      roughness: 0.34,
      metalness: 0.16,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: "#0f1726",
      emissive: color,
      emissiveIntensity: 0.56,
      roughness: 0.36,
      metalness: 0.22,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.38, 0.16, 24), coreMat);
    base.position.y = 0.08;
    marker.add(base);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.11, 12, 32), ringMat);
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.14;
    marker.add(ring);

    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), ringMat);
    beacon.position.y = 0.9;
    marker.add(beacon);

    scene.add(marker);

    const light = new THREE.PointLight(color, 0.9, 18);
    light.position.set(x, y + 1.2, z);
    scene.add(light);

    keyPoints.push({
      id,
      kind,
      position: new THREE.Vector3(x, y, z),
      radius,
      cooldown,
      nextReadyAt: 0,
      pulse: Math.random() * Math.PI * 2,
      coreMat,
      ringMat,
      marker,
      light,
    });
  }

  if (levelTemplate) {
    const levelRoot = SkeletonUtils.clone(levelTemplate) as THREE.Group;
    levelRoot.rotation.y = Math.PI / 2;
    levelRoot.position.x = 0;
    levelRoot.updateMatrixWorld(true);

    const baseBounds = getObjectBounds(levelRoot);
    if (baseBounds) {
      const span = Math.max(1, Math.max(baseBounds.size.x, baseBounds.size.z));
      const targetSpan = A * 1.42;
      const scale = clamp(targetSpan / span, 0.22, 9);
      levelRoot.scale.setScalar(scale);
    }
    levelRoot.updateMatrixWorld(true);

    const scaledBounds = getObjectBounds(levelRoot);
    if (scaledBounds) {
      const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
      const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;
      levelRoot.position.x -= centerX;
      levelRoot.position.y -= scaledBounds.min.y;
      levelRoot.position.z -= centerZ;
    }
    levelRoot.updateMatrixWorld(true);

    const warmTint = new THREE.Color("#f2a65a");
    const coolTint = new THREE.Color("#5aa2d8");
    levelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const meshName = (mesh.name || "").toLowerCase();
      const tuneOne = (material: THREE.Material) => {
        const mat = material as THREE.MeshStandardMaterial;
        if (!("color" in mat) || !mat.color) return material;
        const clone = mat.clone();
        clone.roughness = clamp((clone.roughness ?? 0.75) * 1.1, 0.35, 1);
        clone.metalness = clamp((clone.metalness ?? 0.08) * 0.4, 0, 0.18);
        if (meshName.includes("a") || meshName.includes("long") || meshName.includes("t")) {
          clone.color.lerp(warmTint, 0.06);
        } else if (meshName.includes("b") || meshName.includes("ct")) {
          clone.color.lerp(coolTint, 0.06);
        }
        return clone;
      };
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => tuneOne(material));
      } else if (mesh.material) {
        mesh.material = tuneOne(mesh.material);
      }
    });

    scene.add(levelRoot);

    // מקור אמת אחד: קולידרים ב־world space אחרי שכל המטריצות מעודכנות
    levelRoot.updateMatrixWorld(true);

    const boxSize = new THREE.Vector3();
    const addMeshCollider = (box: THREE.Box3, mesh?: THREE.Mesh) => {
      box.getSize(boxSize);
      if (boxSize.y < 0.02) return;
      const isFloor = (mesh?.name || "").toLowerCase() === "floor";
      if (!isFloor && boxSize.x * boxSize.z > A * A * 1.5 && boxSize.y < 4.2) return;
      collidables.push(box.clone());
    };

    levelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const b = new THREE.Box3().setFromObject(mesh);
      addMeshCollider(b, mesh);
    });

    const levelBounds = getObjectBounds(levelRoot);
    if (levelBounds) {
      const spanX = Math.max(1, levelBounds.size.x);
      const spanZ = Math.max(1, levelBounds.size.z);
      const minX = levelBounds.min.x;
      const maxX = levelBounds.max.x;
      const minZ = levelBounds.min.z;
      const maxZ = levelBounds.max.z;

      addKeyPoint("KP-HEAL", "heal", minX + spanX * 0.22, 0.02, maxZ - spanZ * 0.2, "#59dc9f", 2.1, 15);
      addKeyPoint("KP-AMMO", "ammo", minX + spanX * 0.5, 0.02, minZ + spanZ * 0.5, "#66b8ff", 2.1, 14);
      addKeyPoint("KP-SHIELD", "shield", maxX - spanX * 0.22, 0.02, minZ + spanZ * 0.22, "#d28cff", 2.1, 18);

      const lightA = new THREE.PointLight("#ffb25f", 0.84, 54);
      lightA.position.set(minX + spanX * 0.22, 5.6, maxZ - spanZ * 0.2);
      scene.add(lightA);
      const lightMid = new THREE.PointLight("#d8c36a", 0.56, 48);
      lightMid.position.set(minX + spanX * 0.5, 5, minZ + spanZ * 0.5);
      scene.add(lightMid);
      const lightB = new THREE.PointLight("#6fc4ff", 0.82, 54);
      lightB.position.set(maxX - spanX * 0.22, 5.4, minZ + spanZ * 0.22);
      scene.add(lightB);
    }

    const boundaryHalf = levelBounds
      ? Math.max(
          Math.abs(levelBounds.min.x),
          Math.abs(levelBounds.max.x),
          Math.abs(levelBounds.min.z),
          Math.abs(levelBounds.max.z),
        ) + 1
      : A;
    return { collidables, keyPoints, levelRoot, boundaryHalf };
  }

  // ─── Warehouse map ─────────────────────────────────────────────────────────
  if (mapId === "warehouse") {
    const whGroup = createWarehouseGroup();
    scene.add(whGroup);
    whGroup.updateMatrixWorld(true);

    whGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const b = new THREE.Box3().setFromObject(mesh);
      const sz = b.getSize(new THREE.Vector3());
      if (sz.x < 0.01 || sz.y < 0.01 || sz.z < 0.01) return;
      if (mesh.name.startsWith("banner")) return;
      // רמפה ויזואלית בלבד – הקולידר הוא ramp_*_step_* (תיבות לאורך השיפוע)
      if (mesh.name.includes("ramp_") && mesh.name.endsWith("_visual")) return;
      collidables.push(b.clone());
    });

    addKeyPoint("KP-HEAL",   "heal",   -40, 0.02,  40, "#59dc9f", 2.4, 12);
    addKeyPoint("KP-AMMO",   "ammo",     0, 2.22,   0, "#66b8ff", 2.4, 10);
    addKeyPoint("KP-SHIELD", "shield",  40, 0.02, -40, "#d28cff", 2.4, 16);

    { // Warehouse lighting – warm industrial feel
      const lCenter = new THREE.PointLight("#ffe0a0", 0.8, 100); lCenter.position.set(0, 8, 0);    scene.add(lCenter);
      const lNW     = new THREE.PointLight("#ffb25f", 0.6, 80);  lNW.position.set(-44, 7, -44);    scene.add(lNW);
      const lNE     = new THREE.PointLight("#6fc4ff", 0.6, 80);  lNE.position.set( 44, 7, -44);    scene.add(lNE);
      const lSW     = new THREE.PointLight("#ff9060", 0.5, 70);  lSW.position.set(-44, 6, 44);     scene.add(lSW);
      const lSE     = new THREE.PointLight("#60c0ff", 0.5, 70);  lSE.position.set( 44, 6, 44);     scene.add(lSE);
      const lWCorr  = new THREE.PointLight("#ffd080", 0.45, 60); lWCorr.position.set(-54, 4.5, 0); scene.add(lWCorr);
      const lECorr  = new THREE.PointLight("#ffd080", 0.45, 60); lECorr.position.set( 54, 4.5, 0); scene.add(lECorr);
    }

    return { collidables, keyPoints, levelRoot: whGroup, boundaryHalf: WAREHOUSE_HALF };
  }

  // ─── CTF dedicated map (two-sided arena, blue left / red right) ──────────────
  if (mapId === "ctf") {
    const ctfGroup = createCtfArena();
    scene.add(ctfGroup);
    ctfGroup.updateMatrixWorld(true);

    ctfGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const n = (mesh.name || "").toLowerCase();
      if (n.includes("zone") || n.includes("accent")) return;
      const b = new THREE.Box3().setFromObject(mesh);
      const sz = b.getSize(new THREE.Vector3());
      if (sz.x < 0.01 || sz.y < 0.01 || sz.z < 0.01) return;
      collidables.push(b.clone());
    });

    addKeyPoint("KP-HEAL", "heal", 0, 0.02, -20, "#59dc9f", 2.2, 14);
    addKeyPoint("KP-AMMO", "ammo", 0, 0.02, 20, "#66b8ff", 2.2, 12);
    addKeyPoint("KP-SHIELD", "shield", 0, 0.02, 0, "#d28cff", 2.2, 18);

    const lBlue = new THREE.PointLight("#88bbff", 0.8, 70);
    lBlue.position.set(CTF_BLUE_BASE_X, 7, 0);
    scene.add(lBlue);
    const lRed = new THREE.PointLight("#ff8888", 0.8, 70);
    lRed.position.set(CTF_RED_BASE_X, 7, 0);
    scene.add(lRed);
    const lMid = new THREE.PointLight("#e8e0c8", 0.6, 90);
    lMid.position.set(0, 9, 0);
    scene.add(lMid);
    const lN = new THREE.PointLight("#c8c0a8", 0.4, 50);
    lN.position.set(0, 6, -25);
    scene.add(lN);
    const lS = new THREE.PointLight("#c8c0a8", 0.4, 50);
    lS.position.set(0, 6, 25);
    scene.add(lS);

    return { collidables, keyPoints, levelRoot: ctfGroup, boundaryHalf: CTF_MAP_HALF };
  }

  // ─── Colosseum ──────────────────────────────────────────────────────────────
  if (mapId === "colosseum") {
    const colosseumGroup = createColosseumArena();
    scene.add(colosseumGroup);
    colosseumGroup.updateMatrixWorld(true);

    colosseumGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const n = (mesh.name || "").toLowerCase();
      if (n === "center_ring") return;
      const b = new THREE.Box3().setFromObject(mesh);
      const sz = b.getSize(new THREE.Vector3());
      if (sz.x < 0.01 || sz.y < 0.01 || sz.z < 0.01) return;
      collidables.push(b.clone());
    });

    addKeyPoint("KP-HEAL", "heal", -14, 0.02, 8, "#59dc9f", 2.4, 12);
    addKeyPoint("KP-AMMO", "ammo", 0, 0.02, -12, "#66b8ff", 2.4, 10);
    addKeyPoint("KP-SHIELD", "shield", 14, 0.02, 8, "#d28cff", 2.4, 16);

    const lCenter = new THREE.PointLight("#ffe0a0", 1.0, 100);
    lCenter.position.set(0, 12, 0);
    scene.add(lCenter);
    const lNW = new THREE.PointLight("#ffb25f", 0.65, 70);
    lNW.position.set(-22, 8, -22);
    scene.add(lNW);
    const lNE = new THREE.PointLight("#6fc4ff", 0.65, 70);
    lNE.position.set(22, 8, -22);
    scene.add(lNE);
    const lSW = new THREE.PointLight("#ff9060", 0.55, 60);
    lSW.position.set(-22, 7, 22);
    scene.add(lSW);
    const lSE = new THREE.PointLight("#60c0ff", 0.55, 60);
    lSE.position.set(22, 7, 22);
    scene.add(lSE);

    const boundaryHalf = COLOSSEUM_RADIUS + 2;
    return { collidables, keyPoints, levelRoot: colosseumGroup, boundaryHalf };
  }

  // ─── USE_FLAT_PLAYGROUND path ───────────────────────────────────────────────
  // When no levelTemplate is provided AND we are in flat-playground mode,
  // build the flat playground, register its walls + floor as collidables, and
  // return the group as levelRoot.  This is the ONLY authoritative boundary;
  // the FLAT_SPAWN_HALF clamp in the game loop has been removed so that the
  // player walks up to (and is stopped by) the actual visible wall meshes.
  if (USE_FLAT_PLAYGROUND) {
    const flatGroup = createFlatPlayground();
    scene.add(flatGroup);
    flatGroup.updateMatrixWorld(true);

    flatGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const b = new THREE.Box3().setFromObject(mesh);
      const sz = b.getSize(new THREE.Vector3());
      // Skip degenerate geometry
      if (sz.x < 0.01 || sz.y < 0.01 || sz.z < 0.01) return;
      collidables.push(b.clone());
    });

    // Key points spread across the flat arena
    addKeyPoint("KP-HEAL",   "heal",   -32, 0.02,   0, "#59dc9f", 2.1, 15);
    addKeyPoint("KP-AMMO",   "ammo",     0, 0.02,   0, "#66b8ff", 2.1, 14);
    addKeyPoint("KP-SHIELD", "shield",  32, 0.02,   0, "#d28cff", 2.1, 18);

    { // Ambient lights
      const lA = new THREE.PointLight("#ffb25f", 0.7, 96); lA.position.set(-32, 8, 0);  scene.add(lA);
      const lM = new THREE.PointLight("#d8c36a", 0.6, 120); lM.position.set(0,  9, 0);  scene.add(lM);
      const lB = new THREE.PointLight("#6fc4ff", 0.7, 96); lB.position.set( 32, 8, 0);  scene.add(lB);
    }

    return { collidables, keyPoints, levelRoot: flatGroup, boundaryHalf: A };
  }

  // ─── Fallback map (procedural skirmish arena, non-flat) ──────────────────
  const MAP_HALF = 70;
  const FLOOR_Y_TOP = 0;
  const FLOOR_THICK = 6;
  const WALL_H = 16;
  const WALL_THICK = 4;

  function solidAt(
    x:number, y:number, z:number,
    w:number, h:number, d:number,
    col="#726145", rough=0.78, metal=0.05,
  ): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w,h,d),
      new THREE.MeshStandardMaterial({ color:col, roughness:rough, metalness:metal }),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    collidables.push(new THREE.Box3().setFromObject(m));
    return m;
  }

  function floorTile(x:number, z:number, w:number, d:number, col="#d8c9a7"){
    return solidAt(x, FLOOR_Y_TOP - FLOOR_THICK*0.5, z, w, FLOOR_THICK, d, col, 0.9, 0.02);
  }

  function wallXZ(x:number, z:number, w:number, d:number, h=WALL_H, col="#8a7a63"){
    return solidAt(x, h*0.5, z, w, h, d, col, 0.82, 0.03);
  }

  function coverBox(x:number, z:number, w:number, d:number, h:number, col="#6b5c49"){
    return solidAt(x, h*0.5, z, w, h, d, col, 0.72, 0.06);
  }

  const tileS = 14;
  for(let x=-MAP_HALF; x<MAP_HALF; x+=tileS){
    for(let z=-MAP_HALF; z<MAP_HALF; z+=tileS){
      floorTile(x + tileS*0.5, z + tileS*0.5, tileS, tileS);
    }
  }

  wallXZ(0,  MAP_HALF, MAP_HALF*2, WALL_THICK);
  wallXZ(0, -MAP_HALF, MAP_HALF*2, WALL_THICK);
  wallXZ( MAP_HALF, 0, WALL_THICK, MAP_HALF*2);
  wallXZ(-MAP_HALF, 0, WALL_THICK, MAP_HALF*2);

  wallXZ(0,  11, 120, WALL_THICK, 12, "#7f705d");
  wallXZ(0, -11, 120, WALL_THICK, 12, "#7f705d");

  coverBox(-18, 0, 10, 10, 8, "#6f5e49");
  coverBox(18, 0, 10, 10, 8, "#6f5e49");

  wallXZ(-10, 56, 92, WALL_THICK, 14);
  wallXZ(-56, 44, WALL_THICK, 38, 14);
  wallXZ(26, 44, WALL_THICK, 38, 14);

  wallXZ(10, 62, 44, WALL_THICK, 14, "#8b7a62");
  coverBox(-8, 52, 10, 14, 6, "#6b5c49");
  coverBox(10, 50, 14, 10, 6, "#6b5c49");

  wallXZ(-20, 28, 4, 44, 12, "#7a6c58");
  wallXZ(-8,  28, 4, 44, 12, "#7a6c58");
  coverBox(-14, 18, 10, 8, 6, "#665a49");
  coverBox(-14, 34, 10, 8, 6, "#665a49");

  const TUNNEL_H = 6.3;
  wallXZ(10, -52, 110, WALL_THICK, 12, "#6a5c4a");
  wallXZ(-26, -44, WALL_THICK, 26, 12, "#6a5c4a");
  wallXZ( 26, -44, WALL_THICK, 26, 12, "#6a5c4a");
  solidAt(0, TUNNEL_H + 0.9, -44, 56, 2.4, 22, "#5b4f40", 0.86, 0.02);

  wallXZ(34, -22, WALL_THICK, 34, 12, "#7a6c58");
  coverBox(28, -18, 10, 10, 7, "#6b5c49");

  wallXZ(56, -2, 34, WALL_THICK, 14, "#8b7a62");
  wallXZ(68, -18, WALL_THICK, 38, 14, "#8b7a62");
  coverBox(52, -8, 12, 14, 6, "#6b5c49");
  coverBox(60,  8, 10, 10, 6, "#6b5c49");

  wallXZ(44, 22, 50, WALL_THICK, 12, "#6f6355");
  wallXZ(34, 10, WALL_THICK, 34, 12, "#6f6355");

  wallXZ(-54, -46, 54, WALL_THICK, 12, "#6f6355");
  wallXZ(-42, -34, WALL_THICK, 38, 12, "#6f6355");

  function banner(x: number, y: number, z: number, w: number, h: number, col: string, rotY: number) {
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.34,
        roughness: 0.44,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    b.position.set(x, y, z);
    b.rotation.y = rotY;
    scene.add(b);
  }
  banner(-14, 3.2, 60, 5.2, 4.4, "#d97838", 0);
  banner(66,  3.2, -4, 5.2, 4.4, "#4ea8de", -Math.PI * 0.5);
  banner(0,   3.2, 0,  5.2, 4.4, "#c4b060", 0);

  addKeyPoint("KP-HEAL",   "heal",   -10, 0.02, 54, "#59dc9f", 2.1, 15);
  addKeyPoint("KP-AMMO",   "ammo",     0, 0.02,  0, "#66b8ff", 2.1, 14);
  addKeyPoint("KP-SHIELD", "shield",  56, 0.02, -6, "#d28cff", 2.1, 18);

  {
    const lA = new THREE.PointLight("#ffb25f", 0.7, 78); lA.position.set(-14, 8, 56); scene.add(lA);
    const lM = new THREE.PointLight("#d8c36a", 0.58, 88); lM.position.set(0, 9, 0); scene.add(lM);
    const lB = new THREE.PointLight("#6fc4ff", 0.72, 78); lB.position.set(56, 8, -6); scene.add(lB);
    const lT = new THREE.PointLight("#ffb56a", 0.55, 74); lT.position.set(-54, 7, -46); scene.add(lT);
    const lCT = new THREE.PointLight("#6d9eff", 0.55, 74); lCT.position.set(38, 7, 16); scene.add(lCT);
  }

  return { collidables, keyPoints, levelRoot: null, boundaryHalf: MAP_HALF };
}