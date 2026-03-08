/**
 * Bits Sniper – "Warehouse" combat map.
 *
 * A multi-level industrial warehouse with lots of cover, platforms to jump on,
 * catwalks, ramps, and open areas — designed for intense bot combat.
 *
 * Layout overview (top-down, ±68 boundary):
 *
 *   ┌──────────────────────────────────────┐
 *   │  NW tower   ·  catwalk  ·  NE tower  │
 *   │  ┌─────┐                 ┌─────┐     │
 *   │  │     │                 │     │     │
 *   │  └──┬──┘    UPPER MID    └──┬──┘     │
 *   │     │  ramp      ramp      │         │
 *   │  W corridor  ┌──────┐  E corridor    │
 *   │              │ PLAT │                │
 *   │              └──────┘                │
 *   │    crates    LOW MID    crates       │
 *   │  ┌─────┐                 ┌─────┐     │
 *   │  │     │                 │     │     │
 *   │  └─────┘    ┌──────┐    └─────┘     │
 *   │  SW yard    │ yard │   SE yard      │
 *   └──────────────────────────────────────┘
 */
import * as THREE from "three";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Warehouse boundary half-extent (symmetric ± on X and Z). */
export const WAREHOUSE_HALF = 68;

// ─── Texture helpers ────────────────────────────────────────────────────────

function makeConcreteFloorTex(size: number, base: string, repeat: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i]     = clamp(d[i]     + n, 0, 255);
    img.data[i + 1] = clamp(d[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  const tile = size / 6;
  for (let y = tile; y < size; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  for (let x = tile; x < size; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMetalTex(size: number, base: string, repeat: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i]     = clamp(img.data[i]     + n, 0, 255);
    img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Materials ──────────────────────────────────────────────────────────────

function createMaterials() {
  const floorTex = makeConcreteFloorTex(256, "#6b6558", 20);
  const metalTex = makeMetalTex(128, "#4a4e56", 4);

  return {
    floor:    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.94, metalness: 0.02 }),
    wall:     new THREE.MeshStandardMaterial({ color: "#8a7e6e", roughness: 0.88, metalness: 0.03 }),
    wallDark: new THREE.MeshStandardMaterial({ color: "#5e564c", roughness: 0.90, metalness: 0.04 }),
    metal:    new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.55, metalness: 0.35 }),
    crate:    new THREE.MeshStandardMaterial({ color: "#7a6840", roughness: 0.82, metalness: 0.06 }),
    crateDk:  new THREE.MeshStandardMaterial({ color: "#5c5030", roughness: 0.86, metalness: 0.04 }),
    concrete: new THREE.MeshStandardMaterial({ color: "#9a9286", roughness: 0.92, metalness: 0.02 }),
    accent1:  new THREE.MeshStandardMaterial({ color: "#c47832", roughness: 0.78, metalness: 0.08 }),
    accent2:  new THREE.MeshStandardMaterial({ color: "#3a6ea5", roughness: 0.78, metalness: 0.08 }),
    catwalk:  new THREE.MeshStandardMaterial({ color: "#3e4248", roughness: 0.60, metalness: 0.40 }),
    ramp:     new THREE.MeshStandardMaterial({ color: "#6a6a60", roughness: 0.75, metalness: 0.15 }),
    barrel:   new THREE.MeshStandardMaterial({ color: "#4a6648", roughness: 0.80, metalness: 0.10 }),
    pipe:     new THREE.MeshStandardMaterial({ color: "#8e8575", roughness: 0.60, metalness: 0.30 }),
  };
}

// ─── Main builder ───────────────────────────────────────────────────────────

export function createWarehouseGroup(): THREE.Group {
  const g = new THREE.Group();
  g.name = "warehouse_combat";
  const A = WAREHOUSE_HALF;
  const mat = createMaterials();

  // Helpers
  const addBox = (
    name: string, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, m: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y + sy * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    g.add(mesh);
    return mesh;
  };

  const addCylinder = (
    name: string, x: number, y: number, z: number,
    rTop: number, rBot: number, h: number, seg: number, m: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
    mesh.position.set(x, y + h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    g.add(mesh);
    return mesh;
  };

  // ─── Floor ────────────────────────────────────────────────────────────────
  const floorThick = 0.6;
  addBox("floor", 0, -floorThick, 0, A * 2, floorThick, A * 2, mat.floor);

  // ─── Perimeter walls ──────────────────────────────────────────────────────
  const wallH = 7;
  const wallW = 2.4;
  addBox("wall_n", 0, 0, -A + wallW * 0.5, A * 2, wallH, wallW, mat.wall);
  addBox("wall_s", 0, 0,  A - wallW * 0.5, A * 2, wallH, wallW, mat.wall);
  addBox("wall_w", -A + wallW * 0.5, 0, 0, wallW, wallH, A * 2, mat.wall);
  addBox("wall_e",  A - wallW * 0.5, 0, 0, wallW, wallH, A * 2, mat.wall);

  // ─── Central elevated platform (jumpable – 2.2m high) ────────────────────
  const platH = 2.2;
  const platW = 18;
  addBox("mid_platform", 0, 0, 0, platW, platH, platW, mat.concrete);

  // Ramps to central platform – hitbox = סדרת תיבות לאורך השיפוע (לא AABB אחת מלבנית)
  const rampLen = 12;
  const rampW = 6;
  const RAMP_STEPS = 14; // ככל שיותר – ההיטבוקס דומה יותר לרמפה אמיתית

  const addRampSteps = (
    prefix: string,
    centerX: number,
    centerZ: number,
    dirX: number,
    dirZ: number,
  ) => {
    const stepD = rampLen / RAMP_STEPS;
    for (let i = 0; i < RAMP_STEPS; i++) {
      const t0 = i / RAMP_STEPS;
      const t1 = (i + 1) / RAMP_STEPS;
      const yBot = t0 * platH;
      const yTop = t1 * platH;
      const stepH = yTop - yBot;
      const tMid = (t0 + t1) * 0.5;
      const xC = centerX + dirX * rampLen * tMid;
      const zC = centerZ + dirZ * rampLen * tMid;
      // רוחב לאורך הרמפה = stepD, רוחב בניצב = rampW
      const along = stepD;
      const across = rampW;
      if (Math.abs(dirZ) >= 0.5) addBox(`${prefix}_step_${i}`, xC, yBot, zC, across, stepH, along, mat.ramp);
      else addBox(`${prefix}_step_${i}`, xC, yBot, zC, along, stepH, across, mat.ramp);
    }
  };

  const addRampVisual = (name: string, x: number, z: number, rotY: number) => {
    const rampGeo = new THREE.BoxGeometry(rampW, 0.12, rampLen);
    const ramp = new THREE.Mesh(rampGeo, mat.ramp);
    ramp.position.set(x, platH * 0.5, z);
    ramp.rotation.y = rotY;
    const angle = Math.atan2(platH, rampLen);
    if (Math.abs(rotY) < 0.01 || Math.abs(rotY - Math.PI) < 0.01) ramp.rotation.x = -angle * Math.sign(z);
    else ramp.rotation.z = angle * Math.sign(x);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    ramp.name = name; // נוודא שלא נוסיף ל-collidables (רמפה ויזואל בלבד)
    g.add(ramp);
  };

  // North: from low Z to platform
  addRampSteps("ramp_n", 0, -(platW * 0.5 + rampLen * 0.5), 0, 1);
  addRampVisual("ramp_n_visual", 0, -(platW * 0.5 + rampLen * 0.5), 0);
  // South
  addRampSteps("ramp_s", 0, (platW * 0.5 + rampLen * 0.5), 0, -1);
  addRampVisual("ramp_s_visual", 0, (platW * 0.5 + rampLen * 0.5), Math.PI);
  // West
  addRampSteps("ramp_w", -(platW * 0.5 + rampLen * 0.5), 0, 1, 0);
  addRampVisual("ramp_w_visual", -(platW * 0.5 + rampLen * 0.5), 0, Math.PI * 0.5);
  // East
  addRampSteps("ramp_e", (platW * 0.5 + rampLen * 0.5), 0, -1, 0);
  addRampVisual("ramp_e_visual", (platW * 0.5 + rampLen * 0.5), 0, -Math.PI * 0.5);

  // Stairs to platform (N and S)
  const buildStairs = (prefix: string, x0: number, z0: number, dz: number) => {
    const steps = 5;
    const stepH = platH / steps;
    const stepD = 2.2;
    const stepW = 8;
    for (let i = 0; i < steps; i++) {
      addBox(`${prefix}_s${i}`, x0, 0, z0 + dz * stepD * i, stepW, stepH * (i + 1), stepD, mat.concrete);
    }
  };
  buildStairs("stairs_n", -14, -(platW * 0.5 + 2.2), 1);
  buildStairs("stairs_s",  14,  (platW * 0.5 + 2.2), -1);

  // ─── NW Tower (elevated sniper perch – 4.5m) ─────────────────────────────
  const towerH = 4.5;
  const towerW = 10;
  addBox("tower_nw_base", -48, 0, -48, towerW, towerH, towerW, mat.wallDark);
  addBox("tower_nw_wall1", -48, towerH, -53.5, towerW, 1.5, 1, mat.wallDark);
  addBox("tower_nw_wall2", -53.5, towerH, -48, 1, 1.5, towerW, mat.wallDark);
  // Stairs to NW tower
  for (let i = 0; i < 6; i++) {
    addBox(`tower_nw_step${i}`, -43 + i * 1.5, 0, -44, 1.5, towerH / 6 * (i + 1), 4, mat.concrete);
  }

  // ─── NE Tower ─────────────────────────────────────────────────────────────
  addBox("tower_ne_base", 48, 0, -48, towerW, towerH, towerW, mat.wallDark);
  addBox("tower_ne_wall1", 48, towerH, -53.5, towerW, 1.5, 1, mat.wallDark);
  addBox("tower_ne_wall2", 53.5, towerH, -48, 1, 1.5, towerW, mat.wallDark);
  for (let i = 0; i < 6; i++) {
    addBox(`tower_ne_step${i}`, 43 - i * 1.5, 0, -44, 1.5, towerH / 6 * (i + 1), 4, mat.concrete);
  }

  // ─── Catwalk connecting towers (N side, high walkway) ─────────────────────
  const catwalkH = towerH;
  const catwalkThick = 0.25;
  const catwalkW = 4;
  addBox("catwalk_n", 0, catwalkH - catwalkThick, -50, 86, catwalkThick, catwalkW, mat.catwalk);
  // Railing
  addBox("catwalk_n_rail1", 0, catwalkH + 0.5, -52, 86, 0.12, 0.12, mat.metal);
  addBox("catwalk_n_rail2", 0, catwalkH + 0.5, -48, 86, 0.12, 0.12, mat.metal);

  // ─── South side elevated walkway ──────────────────────────────────────────
  addBox("catwalk_s", 0, 3.2 - catwalkThick, 52, 60, catwalkThick, 3.5, mat.catwalk);
  addBox("catwalk_s_rail", 0, 3.2 + 0.5, 53.75, 60, 0.12, 0.12, mat.metal);
  // Access stairs (SW and SE)
  for (let i = 0; i < 5; i++) {
    addBox(`catwalk_s_stepW${i}`, -32 + i * 1.8, 0, 50, 1.8, 3.2 / 5 * (i + 1), 3.5, mat.concrete);
    addBox(`catwalk_s_stepE${i}`,  32 - i * 1.8, 0, 50, 1.8, 3.2 / 5 * (i + 1), 3.5, mat.concrete);
  }

  // ─── Cover crates – west side ─────────────────────────────────────────────
  addBox("crate_w1", -34, 0, -10,  4, 2.0, 3, mat.crate);
  addBox("crate_w2", -34, 0,   4,  3, 1.4, 4, mat.crateDk);
  addBox("crate_w3", -38, 0,  -2,  2.5, 2.8, 2.5, mat.crate);
  addBox("crate_w4", -28, 0,  16,  5, 1.6, 3, mat.crateDk);
  addBox("crate_w5", -40, 0,  22,  4, 2.4, 4, mat.crate);
  addBox("crate_w6", -44, 0,  22,  2.5, 1.2, 2.5, mat.crateDk);

  // Stack: jump on lower crate then upper
  addBox("crate_w_stack1", -30, 0,   -28, 5, 1.6, 5, mat.crate);
  addBox("crate_w_stack2", -30, 1.6, -28, 3, 1.4, 3, mat.crateDk);

  // ─── Cover crates – east side ─────────────────────────────────────────────
  addBox("crate_e1",  34, 0,  10,  4, 2.0, 3, mat.crate);
  addBox("crate_e2",  34, 0,  -4,  3, 1.4, 4, mat.crateDk);
  addBox("crate_e3",  38, 0,   2,  2.5, 2.8, 2.5, mat.crate);
  addBox("crate_e4",  28, 0, -16,  5, 1.6, 3, mat.crateDk);
  addBox("crate_e5",  40, 0, -22,  4, 2.4, 4, mat.crate);
  addBox("crate_e6",  44, 0, -22,  2.5, 1.2, 2.5, mat.crateDk);

  addBox("crate_e_stack1", 30, 0,   28, 5, 1.6, 5, mat.crate);
  addBox("crate_e_stack2", 30, 1.6, 28, 3, 1.4, 3, mat.crateDk);

  // ─── Mid-field cover (around the central platform) ────────────────────────
  addBox("cover_mid_nw", -14, 0, -14, 3.5, 1.8, 3.5, mat.crate);
  addBox("cover_mid_ne",  14, 0, -14, 3.5, 1.8, 3.5, mat.crate);
  addBox("cover_mid_sw", -14, 0,  14, 3.5, 1.8, 3.5, mat.crate);
  addBox("cover_mid_se",  14, 0,  14, 3.5, 1.8, 3.5, mat.crate);

  // Smaller jump crates near mid
  addBox("jumpbox_n",   0, 0, -24, 3, 1.2, 3, mat.crateDk);
  addBox("jumpbox_s",   0, 0,  24, 3, 1.2, 3, mat.crateDk);
  addBox("jumpbox_w", -24, 0,   0, 3, 1.2, 3, mat.crateDk);
  addBox("jumpbox_e",  24, 0,   0, 3, 1.2, 3, mat.crateDk);

  // ─── West corridor structure ──────────────────────────────────────────────
  addBox("corridor_w_wall1", -54, 0, -20, 2, 5, 30, mat.wall);
  addBox("corridor_w_wall2", -54, 0,  20, 2, 5, 30, mat.wall);
  addBox("corridor_w_roof",  -54, 5, 0,   2, 0.3, 74, mat.metal);

  // ─── East corridor structure ──────────────────────────────────────────────
  addBox("corridor_e_wall1", 54, 0, -20, 2, 5, 30, mat.wall);
  addBox("corridor_e_wall2", 54, 0,  20, 2, 5, 30, mat.wall);
  addBox("corridor_e_roof",  54, 5, 0,   2, 0.3, 74, mat.metal);

  // ─── Barrels (cylindrical cover) ──────────────────────────────────────────
  addCylinder("barrel_1", -20, 0,  36, 0.6, 0.6, 1.4, 12, mat.barrel);
  addCylinder("barrel_2", -18, 0,  37, 0.6, 0.6, 1.4, 12, mat.barrel);
  addCylinder("barrel_3",  20, 0, -36, 0.6, 0.6, 1.4, 12, mat.barrel);
  addCylinder("barrel_4",  22, 0, -37, 0.6, 0.6, 1.4, 12, mat.barrel);
  addCylinder("barrel_5", -58, 0,   0, 0.6, 0.6, 1.4, 12, mat.barrel);
  addCylinder("barrel_6",  58, 0,   0, 0.6, 0.6, 1.4, 12, mat.barrel);

  // ─── Pipes / decorative beams ─────────────────────────────────────────────
  addBox("pipe_h1", 0, 5.8, -30, 80, 0.4, 0.4, mat.pipe);
  addBox("pipe_h2", 0, 5.8,  30, 80, 0.4, 0.4, mat.pipe);
  addBox("pipe_v1", -30, 5.8, 0, 0.4, 0.4, 80, mat.pipe);
  addBox("pipe_v2",  30, 5.8, 0, 0.4, 0.4, 80, mat.pipe);

  // ─── SW & SE yard shelters (small roof structures) ────────────────────────
  addBox("shelter_sw_pillar1", -50, 0,  36, 1, 3.5, 1, mat.metal);
  addBox("shelter_sw_pillar2", -40, 0,  36, 1, 3.5, 1, mat.metal);
  addBox("shelter_sw_pillar3", -50, 0,  44, 1, 3.5, 1, mat.metal);
  addBox("shelter_sw_pillar4", -40, 0,  44, 1, 3.5, 1, mat.metal);
  addBox("shelter_sw_roof",    -45, 3.5, 40, 12, 0.25, 10, mat.metal);

  addBox("shelter_se_pillar1", 50, 0,  36, 1, 3.5, 1, mat.metal);
  addBox("shelter_se_pillar2", 40, 0,  36, 1, 3.5, 1, mat.metal);
  addBox("shelter_se_pillar3", 50, 0,  44, 1, 3.5, 1, mat.metal);
  addBox("shelter_se_pillar4", 40, 0,  44, 1, 3.5, 1, mat.metal);
  addBox("shelter_se_roof",    45, 3.5, 40, 12, 0.25, 10, mat.metal);

  // ─── Jumpable containers (bigger, taller – need momentum jump) ────────────
  addBox("container_nw", -36, 0, -36, 8, 3.2, 4, mat.accent1);
  addBox("container_ne",  36, 0, -36, 8, 3.2, 4, mat.accent2);
  addBox("container_sw", -36, 0,  36, 4, 2.6, 8, mat.accent2);
  addBox("container_se",  36, 0,  36, 4, 2.6, 8, mat.accent1);

  // Mid-height containers for flanking paths
  addBox("container_w_mid", -46, 0,  0, 6, 3.0, 10, mat.accent1);
  addBox("container_e_mid",  46, 0,  0, 6, 3.0, 10, mat.accent2);

  // ─── Wall dividers (create lanes / sight-line blockers) ───────────────────
  addBox("divider_nw", -24, 0, -38, 2, 4, 14, mat.wallDark);
  addBox("divider_ne",  24, 0, -38, 2, 4, 14, mat.wallDark);
  addBox("divider_sw", -24, 0,  38, 2, 4, 14, mat.wallDark);
  addBox("divider_se",  24, 0,  38, 2, 4, 14, mat.wallDark);

  // ─── Accent banners (decorative, non-collidable) ──────────────────────────
  const addBanner = (name: string, x: number, y: number, z: number, w: number, h: number, col: string, rotY: number) => {
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.3,
        roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide,
      }),
    );
    b.position.set(x, y, z);
    b.rotation.y = rotY;
    b.name = name;
    g.add(b);
  };
  addBanner("banner_n", 0, 3, -64, 6, 3.5, "#e8a040", 0);
  addBanner("banner_s", 0, 3,  64, 6, 3.5, "#40a8e8", Math.PI);
  addBanner("banner_w", -64, 3, 0, 6, 3.5, "#e84040", Math.PI * 0.5);
  addBanner("banner_e",  64, 3, 0, 6, 3.5, "#40e880", -Math.PI * 0.5);

  return g;
}
