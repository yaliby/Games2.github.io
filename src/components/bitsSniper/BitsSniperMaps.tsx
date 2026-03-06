import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

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

export function buildMap(scene: THREE.Scene, levelTemplate?: THREE.Group | null): MapBuildResult {
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