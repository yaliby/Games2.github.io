import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import "./BitsSniperGame.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const PLAYER_HEIGHT    = 1.65;
const PLAYER_RADIUS    = 0.38;
const MOVE_SPEED       = 9.2;
const RUN_MULT         = 1.70;
const JUMP_VEL         = 8.8;
const GRAVITY          = 22;
const LOOK_SENS_BASE   = 0.0022;
const ARENA_HALF       = 72;
const BOT_COUNT        = 7;
const BOT_RADIUS       = 0.42;
const BOT_HEIGHT       = 0.72;
const BOT_EGG_R        = 0.54;
const RESPAWN_SECS     = 3.5;
const SPAWN_INVINCIBLE = 1.5;    // seconds of god-mode after spawn
const MAX_HEALTH       = 100;
const BOT_MAX_HEALTH   = 80;
const LOOK_SENS_MIN    = 0.0012;
const LOOK_SENS_MAX    = 0.0035;
const LOOK_SENS_STEP   = 0.0002;
const ADS_LOOK_SENS_MULT = 0.56;
const ADS_MOVE_MULT    = 0.76;
const ADS_SPREAD_MULT  = 0.52;
const GROUND_ACCEL     = 15.5;
const AIR_ACCEL        = 5.4;
const GROUND_BRAKE     = 18.5;
const AIR_BRAKE        = 3.2;
const AIR_DRAG         = 1.8;
const COYOTE_TIME_SECS = 0.12;
const JUMP_BUFFER_SECS = 0.11;
const JUMP_RELEASE_CUT = 0.56;
const PROJECTILE_SPEED_MULT = 5.8;
const SHOT_SPREAD_MULT = 0.62;
const BOT_INACCURACY   = 0.045;
const HP_REGEN_DELAY_SECS = 3.0;
const HP_REGEN_EXP_RATE = 0.05;
const LOW_HP_WARN_THRESHOLD = 34;
const POSTFX_BLOOM_STRENGTH = 0.78;
const POSTFX_BLOOM_RADIUS = 0.5;
const POSTFX_BLOOM_THRESHOLD = 0.65;
const POSTFX_EXPOSURE = 1.24;

// ─── Weapon definitions ───────────────────────────────────────────────────────
interface WeaponDef {
  id: string; label: string; emoji: string;
  damage: number; fireRate: number; spread: number;
  pellets: number; range: number;
  ammo: number; maxAmmo: number; reloadTime: number;
  projColor: string; projSpeed: number;
  speedMult: number;
  splash: boolean; splashR: number; splashDmg: number;
  auto: boolean;
  // viewmodel colours
  bodyHex: string; barrelLen: number; barrelR: number;
}

interface ReloadAnimProfile {
  side: number;
  down: number;
  back: number;
  pitch: number;
  roll: number;
  yaw: number;
  wobble: number;
  wobbleFreq: number;
  settleSpeed: number;
  tacticalTime: number;
}

const WEAPONS: WeaponDef[] = [
  {
    id:"rifle",    label:"Egg Rifle",  emoji:"🥚",
    damage:38, fireRate:2.6, spread:0.011, pellets:1, range:120,
    ammo:10, maxAmmo:10, reloadTime:1.8,
    projColor:"#ffe8b0", projSpeed:64, speedMult:3.6, splash:false, splashR:0, splashDmg:0,
    auto:false, bodyHex:"#6a9ab8", barrelLen:0.72, barrelR:0.038,
  },
  {
    id:"scrambler", label:"Scrambler", emoji:"🍳",
    damage:16, fireRate:7, spread:0.032, pellets:1, range:55,
    ammo:24, maxAmmo:24, reloadTime:1.3,
    projColor:"#ffe070", projSpeed:56, speedMult:2.6, splash:false, splashR:0, splashDmg:0,
    auto:true, bodyHex:"#a87840", barrelLen:0.50, barrelR:0.048,
  },
  {
    id:"whipper",  label:"Whipper",   emoji:"🍥",
    damage:14, fireRate:1.4, spread:0.15, pellets:7, range:20,
    ammo:6,  maxAmmo:6,  reloadTime:2.1,
    projColor:"#ffe066", projSpeed:44, speedMult:2.15, splash:false, splashR:0, splashDmg:0,
    auto:false, bodyHex:"#996655", barrelLen:0.36, barrelR:0.068,
  },
  {
    id:"cracker",  label:"Cracker",   emoji:"💥",
    damage:52, fireRate:0.85, spread:0.018, pellets:1, range:110,
    ammo:4,  maxAmmo:4,  reloadTime:2.5,
    projColor:"#ff9944", projSpeed:58, speedMult:4.0, splash:true, splashR:2.4, splashDmg:28,
    auto:false, bodyHex:"#c06030", barrelLen:0.66, barrelR:0.055,
  },
];

const RELOAD_ANIMS: Record<string, ReloadAnimProfile> = {
  rifle: {
    side: 0.07, down: 0.16, back: 0.22,
    pitch: 0.52, roll: 0.78, yaw: 0.085,
    wobble: 0.1, wobbleFreq: 4.1, settleSpeed: 5.4, tacticalTime: 0.86,
  },
  scrambler: {
    side: 0.035, down: 0.1, back: 0.14,
    pitch: 0.3, roll: 0.46, yaw: 0.055,
    wobble: 0.065, wobbleFreq: 5.2, settleSpeed: 6.2, tacticalTime: 0.64,
  },
  whipper: {
    side: 0.1, down: 0.2, back: 0.26,
    pitch: 0.6, roll: 1.22, yaw: 0.13,
    wobble: 0.15, wobbleFreq: 3.4, settleSpeed: 4.8, tacticalTime: 1.02,
  },
  cracker: {
    side: 0.13, down: 0.26, back: 0.34,
    pitch: 0.74, roll: 1.45, yaw: 0.17,
    wobble: 0.2, wobbleFreq: 2.8, settleSpeed: 4.1, tacticalTime: 1.2,
  },
};

function getReloadAnimProfile(wpId: string): ReloadAnimProfile {
  return RELOAD_ANIMS[wpId] ?? RELOAD_ANIMS.rifle;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BotState {
  id: number; mesh: THREE.Group; health: number; dead: boolean;
  respawnTimer: number; velY: number; onGround: boolean;
  yaw: number; wpIdx: number; fireTimer: number;
  strafeDir: number; strafeTimer: number; reloadTimer: number; ammo: number;
  label: string; lastHudHealth: number;
  animTime: number; animPhase: number;
}
interface Projectile {
  mesh: THREE.Mesh; vel: THREE.Vector3; fromBot: boolean;
  damage: number; range: number; traveled: number;
  splash: boolean; splashR: number; splashDmg: number;
}
interface HitInd { angle: number; opacity: number }

// ─── Small helpers ─────────────────────────────────────────────────────────────
function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)) }
function rng(lo:number,hi:number){ return lo+Math.random()*(hi-lo) }

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function getBotHudColor(ratio: number) {
  if (ratio > 0.5) return "#2ee872";
  if (ratio > 0.25) return "#f0c038";
  return "#ee4038";
}

function updateBotHpLabel(mesh: THREE.Group, label: string, health: number) {
  const ctx = mesh.userData.hpLabelCtx as CanvasRenderingContext2D | undefined;
  const texture = mesh.userData.hpLabelTexture as THREE.CanvasTexture | undefined;
  if (!ctx || !texture) return;

  const ratio = clamp(health / BOT_MAX_HEALTH, 0, 1);
  const hpValue = Math.max(0, Math.round(health));
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);

  drawRoundedRect(ctx, 8, 6, width - 16, height - 12, 14);
  ctx.fillStyle = "rgba(4, 12, 24, 0.88)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(126, 188, 244, 0.74)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8f4ff";
  ctx.font = "700 22px Oxanium, Segoe UI, sans-serif";
  ctx.fillText(label, width * 0.5, 30);

  const barX = 22;
  const barY = 44;
  const barW = width - 44;
  const barH = 20;
  drawRoundedRect(ctx, barX, barY, barW, barH, 8);
  ctx.fillStyle = "rgba(16, 26, 42, 0.92)";
  ctx.fill();

  const fillW = Math.max(8, Math.round(barW * ratio));
  drawRoundedRect(ctx, barX, barY, fillW, barH, 8);
  ctx.fillStyle = getBotHudColor(ratio);
  ctx.fill();

  ctx.fillStyle = "#d9e9f8";
  ctx.font = "700 16px Oxanium, Segoe UI, sans-serif";
  ctx.fillText(`${hpValue}/${BOT_MAX_HEALTH} HP`, width * 0.5, 81);
  texture.needsUpdate = true;
}
type SpawnZone = [number, number, number, number];

// Dedicated spawns inspired by Dust2 flow: player=CT side, enemies spread across T/B/Mid/A
const PLAYER_SPAWN_ZONES: SpawnZone[] = [
  [44, -8, 12, 10],
  [44, 16, 12, 10],
  [48, 34, 10, 8],
];

const BOT_SPAWN_ZONES: SpawnZone[] = [
  [-62, 44, 12, 10], // T spawn
  [-60, 24, 12, 10], // Long doors
  [-58, 2, 12, 10],  // Lower mid
  [-58, -22, 12, 10],// B tunnels
  [-56, -52, 12, 10],// B back
  [-28, 42, 10, 8],  // Long corner
  [-20, 10, 10, 8],  // Mid boxes
  [2, 16, 10, 8],    // Short/cat
  [16, -18, 10, 8],  // CT->B route
  [28, 32, 10, 8],   // A ramp
];

function pointInSpawnZone(zone: SpawnZone, y: number): THREE.Vector3 {
  const [zx, zz, zw, zd] = zone;
  return new THREE.Vector3(rng(zx, zx + zw), y, rng(zz, zz + zd));
}

const BOT_NAMES  = ["KoloBot","YoloEgg","SnipeHen","CrackBot","FryBot","Scrambles","Clucky"];
const BOT_COLORS = ["#e84a4a","#e87a40","#e8c44a","#40e880","#40b0e8","#a040e8","#e840b0"]
  .map(c => new THREE.Color(c));

// ─── Build egg-bot mesh ───────────────────────────────────────────────────────
function makeBotMesh(color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  // base ring
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(BOT_EGG_R * 0.9, BOT_EGG_R * 0.9, 0.18, 14),
    new THREE.MeshStandardMaterial({ color: "#0b1724", roughness: 0.85, metalness: 0.25 }),
  );
  base.position.y = 0.09;
  base.receiveShadow = true;
  g.add(base);
  // egg body
  const bGeo = new THREE.SphereGeometry(BOT_EGG_R, 14, 10);
  bGeo.scale(1, 1.28, 1);
  const bMat = new THREE.MeshStandardMaterial({ color, roughness:0.38, metalness:0.12 });
  const body = new THREE.Mesh(bGeo, bMat); body.position.y = BOT_EGG_R*1.28; body.castShadow=true; g.add(body);
  // eyes
  for(const s of [-1,1]){
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8), new THREE.MeshStandardMaterial({color:"#fff"}));
    eye.position.set(s*0.22, BOT_EGG_R*2.12, BOT_EGG_R*0.88); g.add(eye);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.056,8,8), new THREE.MeshStandardMaterial({color:"#080818"}));
    pup.position.set(s*0.22, BOT_EGG_R*2.12, BOT_EGG_R*0.92+0.04); g.add(pup);
  }
  // gun nub
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.5,8),
    new THREE.MeshStandardMaterial({color:"#445",roughness:0.5}));
  gun.rotation.x=Math.PI/2; gun.position.set(0.26, BOT_EGG_R*1.9, BOT_EGG_R*0.84); g.add(gun);
  // hp bar bg
  const hbBg = new THREE.Mesh(new THREE.PlaneGeometry(1.12,0.14),
    new THREE.MeshBasicMaterial({color:"#330000",depthTest:false}));
  hbBg.position.y=BOT_EGG_R*3.02; hbBg.renderOrder=999; g.add(hbBg);
  // hp bar fg
  const hbFg = new THREE.Mesh(new THREE.PlaneGeometry(1.08,0.1),
    new THREE.MeshBasicMaterial({color:"#22ee44",depthTest:false}));
  hbFg.position.y=BOT_EGG_R*3.02+0.001; hbFg.renderOrder=1000; g.add(hbFg);

  const hpLabelCanvas = document.createElement("canvas");
  hpLabelCanvas.width = 256;
  hpLabelCanvas.height = 96;
  const hpLabelTexture = new THREE.CanvasTexture(hpLabelCanvas);
  hpLabelTexture.colorSpace = THREE.SRGBColorSpace;
  hpLabelTexture.minFilter = THREE.LinearFilter;
  hpLabelTexture.magFilter = THREE.LinearFilter;
  hpLabelTexture.generateMipmaps = false;

  const hpLabelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: hpLabelTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  hpLabelSprite.position.set(0, BOT_EGG_R * 3.42, 0);
  hpLabelSprite.scale.set(1.58, 0.59, 1);
  hpLabelSprite.renderOrder = 1001;
  g.add(hpLabelSprite);

  g.userData.hpBarBg = hbBg;
  g.userData.hpBarFg = hbFg;
  g.userData.hpLabelCtx = hpLabelCanvas.getContext("2d");
  g.userData.hpLabelTexture = hpLabelTexture;
  g.userData.hpLabelSprite = hpLabelSprite;
  g.userData.body = body;
  g.userData.base = base;
  g.userData.gun = gun;
  g.userData.bodyBaseY = body.position.y;
  g.userData.baseBaseY = base.position.y;
  g.userData.gunBaseRotZ = gun.rotation.z;
  // Recenter mesh around actor origin so y-position acts like body center.
  for(const child of g.children){
    child.position.y -= BOT_HEIGHT;
  }
  return g;
}

// ─── Build viewmodel (weapon seen in first person) ────────────────────────────
function makeViewmodel(wp: WeaponDef, vmScene: THREE.Scene): THREE.Group {
  const g = new THREE.Group();
  const bodyCol = new THREE.Color(wp.bodyHex);
  // body block
  const bMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13,0.10,0.36),
    new THREE.MeshStandardMaterial({color:bodyCol,roughness:0.42,metalness:0.32}));
  bMesh.position.set(0,0,-0.18); g.add(bMesh);
  // barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(wp.barrelR,wp.barrelR,wp.barrelLen,10),
    new THREE.MeshStandardMaterial({color:"#334455",roughness:0.38,metalness:0.7}));
  barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.015,-(0.36/2+wp.barrelLen/2)); g.add(barrel);
  // grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.16,0.13),
    new THREE.MeshStandardMaterial({color:bodyCol.clone().multiplyScalar(0.65),roughness:0.65}));
  grip.position.set(0,-0.12,0); g.add(grip);
  // muzzle ring detail
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(wp.barrelR*1.4,0.012,8,16),
    new THREE.MeshStandardMaterial({color:"#667788",metalness:0.8,roughness:0.3}));
  muzzle.rotation.x=Math.PI/2; muzzle.position.set(0,0.015,-(0.36/2+wp.barrelLen)); g.add(muzzle);
  vmScene.add(g);
  return g;
}

// ─── Build map (Dust2-inspired lanes/sites/tunnels) ──────────────────────────
function buildMap(scene: THREE.Scene): { collidables: THREE.Box3[] } {
  const collidables: THREE.Box3[] = [];
  const A = ARENA_HALF;
  const WALL_H = 5.2;

  // collidable structure piece
  function solid(
    x:number, z:number, w:number, d:number, h=WALL_H,
    col="#726145", rough=0.74, metal=0.08
  ): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w,h,d),
      new THREE.MeshStandardMaterial({ color:col, roughness:rough, metalness:metal }),
    );
    m.position.set(x, h*0.5, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    collidables.push(new THREE.Box3().setFromObject(m));
    return m;
  }

  function cover(x:number, z:number, w:number, h:number, d:number, col="#6f5e49"): THREE.Mesh {
    return solid(x, z, w, d, h, col, 0.64, 0.1);
  }

  // ── Desert floor ───────────────────────────────────────────────────────────
  const floorSize = Math.max(220, (A*2)*1.45);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ color:"#3a3329", roughness:0.84, metalness:0.03 }),
  );
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  scene.add(floor);

  const lanePaint = new THREE.MeshStandardMaterial({
    color:"#5a503f", roughness:0.78, metalness:0.04, emissive:"#43382a", emissiveIntensity:0.38,
  });
  for (const [x, z, w, d] of [
    [-14, 41, 98, 10], // A-long lane
    [-50, -16, 24, 58], // B-tunnels lane
    [-4, 2, 30, 20], // Mid lane
    [46, 6, 26, 18], // CT lane
  ] as [number, number, number, number][]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lanePaint);
    strip.rotation.x = -Math.PI/2;
    strip.position.set(x, 0.03, z);
    scene.add(strip);
  }

  // Color identity patches so zones are readable at a glance
  for (const [x, z, w, d, color, emissive] of [
    [42, 38, 24, 18, "#b46a2a", "#7a3608"], // A site
    [-50, -50, 26, 18, "#2a8b93", "#0d4652"], // B site
    [-6, 4, 24, 16, "#a88d32", "#5f4e12"], // Mid
    [50, 4, 20, 14, "#2e5fb8", "#1c3166"], // CT spawn
  ] as [number, number, number, number, string, string][]) {
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.45,
        roughness: 0.66,
        metalness: 0.05,
      }),
    );
    patch.rotation.x = -Math.PI/2;
    patch.position.set(x, 0.045, z);
    scene.add(patch);
  }

  // ── Outer arena walls ──────────────────────────────────────────────────────
  solid(0, -(A+0.7), A*2+2, 1.6, 9.2, "#5b4a38", 0.8);
  solid(0,  (A+0.7), A*2+2, 1.6, 9.2, "#5b4a38", 0.8);
  solid(-(A+0.7), 0, 1.6, A*2+2, 9.2, "#5b4a38", 0.8);
  solid( (A+0.7), 0, 1.6, A*2+2, 9.2, "#5b4a38", 0.8);

  // ── Dust2-inspired macro layout ────────────────────────────────────────────
  // A-long corridor + A-site boundaries
  solid(-18, 27, 96, 2.2, WALL_H, "#62513e");
  solid(-10, 56, 104, 2.2, WALL_H, "#62513e");
  solid(-54, 18, 2.2, 32, WALL_H, "#594833");
  solid(-16, 12, 2.2, 28, WALL_H, "#594833");
  solid(30, 41, 2.2, 28, WALL_H, "#594833");
  solid(40, 42, 2.2, 24, WALL_H, "#5f4f3d");
  solid(52, 30, 24, 2.2, WALL_H, "#5f4f3d");

  // Mid split / door feeling
  solid(-6, -14, 2.2, 38, WALL_H, "#5b4b39");
  solid(-6, 27, 2.2, 22, WALL_H, "#5b4b39");
  solid(12, -23, 2.2, 34, WALL_H, "#5b4b39");
  solid(12, 10, 2.2, 18, WALL_H, "#5b4b39");

  // B tunnels + B site shell
  solid(-40, -8, 2.2, 74, WALL_H, "#5a4a38");
  solid(-60, -30, 14, 2.2, WALL_H, "#5a4a38");
  solid(-46, -30, 8, 2.2, WALL_H, "#5a4a38");
  solid(-54, -56, 30, 2.2, WALL_H, "#5a4a38");
  solid(-34, -45, 2.2, 24, WALL_H, "#5a4a38");

  // CT spawn pocket + CT-to-mid openings
  solid(40, -16, 2.2, 14, WALL_H, "#5f4f3d");
  solid(40, 16, 2.2, 14, WALL_H, "#5f4f3d");
  solid(52, -20, 18, 2.2, WALL_H, "#5f4f3d");
  solid(52, 18, 18, 2.2, WALL_H, "#5f4f3d");

  // Catwalk stairs to A-short
  for(let i=0;i<4;i++){
    cover(6+i*3.6, 16+i*3.2, 4.2, 0.85 + i*0.55, 4.2, "#725c46");
  }

  // ── Covers and jumpable objects ────────────────────────────────────────────
  const covers: [number,number,number,number,number,string][] = [
    [-56, 44, 5.0, 2.2, 5.0, "#7a664d"], // T spawn box
    [-49, 24, 3.8, 1.8, 3.8, "#7a664d"], // long corner
    [-21, 8, 5.2, 2.4, 4.2, "#7a664d"],  // mid box
    [-10, 40, 4.8, 2.2, 4.0, "#7a664d"], // long barrel
    [4, 6, 3.6, 1.9, 3.6, "#735f48"],    // mid right
    [24, 34, 5.0, 2.2, 5.0, "#735f48"],  // short entry
    [48, 40, 6.2, 2.6, 5.0, "#6c5a46"],  // A site cover
    [52, -8, 5.0, 2.2, 4.2, "#6c5a46"],  // CT cover
    [-50, -20, 5.2, 2.3, 4.6, "#6c5a46"],// tunnel cover
    [-52, -48, 6.6, 2.8, 5.2, "#6c5a46"],// B site cover
    [-40, -44, 4.6, 2.0, 4.0, "#6c5a46"],// B site side box
  ];
  for(const [x,z,w,h,d,c] of covers) cover(x, z, w, h, d, c);

  // ── Visual spawn pads (no collision) ───────────────────────────────────────
  function spawnPad(x:number, z:number, col:string){
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.8, 2.8, 0.06, 24),
      new THREE.MeshStandardMaterial({
        color: "#1a2230",
        emissive: col,
        emissiveIntensity: 0.9,
        roughness: 0.35,
        metalness: 0.2,
      }),
    );
    pad.position.set(x, 0.04, z);
    scene.add(pad);
  }
  spawnPad(50, 4, "#2a8bff");    // player/CT spawn
  spawnPad(-56, 46, "#ff5a3a");  // enemy/T spawn
  spawnPad(-52, -48, "#ff5a3a"); // enemy/B spawn

  function banner(x:number, y:number, z:number, w:number, h:number, col:string, rotY:number){
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.35,
        roughness: 0.44,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    b.position.set(x, y, z);
    b.rotation.y = rotY;
    scene.add(b);
  }
  banner(33, 2.8, 50, 5.2, 4.8, "#d37a2f", Math.PI * 0.5);     // A marker
  banner(-62, 2.6, -50, 5.2, 4.4, "#2f9ca6", Math.PI * 0.5);   // B marker
  banner(-18, 2.5, 0, 5.0, 4.2, "#c7b043", Math.PI * 0.5);      // Mid marker
  banner(59, 2.6, 2, 4.8, 4.2, "#3d72d7", Math.PI * 0.5);       // CT marker

  const zoneLightA = new THREE.PointLight("#ff9e48", 0.78, 62);
  zoneLightA.position.set(40, 4.8, 40);
  scene.add(zoneLightA);
  const zoneLightB = new THREE.PointLight("#42b9c8", 0.82, 62);
  zoneLightB.position.set(-52, 4.8, -48);
  scene.add(zoneLightB);
  const zoneLightMid = new THREE.PointLight("#d6be58", 0.62, 52);
  zoneLightMid.position.set(-6, 4.2, 4);
  scene.add(zoneLightMid);

  // ── Accent strips ──────────────────────────────────────────────────────────
  const accentMat = new THREE.MeshStandardMaterial({
    color:"#4b4132", emissive:"#6d5f4a", emissiveIntensity:0.3, roughness:0.78, metalness:0.04,
  });
  for(const [ax,az,aw,ad] of [
    [-14, 27, 96, 0.16],
    [-14, 56, 96, 0.16],
    [-50, -8, 0.16, 70],
    [46, 0, 0.16, 36],
  ] as [number,number,number,number][]){
    const strip = new THREE.Mesh(new THREE.BoxGeometry(aw,0.14,ad), accentMat);
    strip.position.set(ax,0.08,az);
    scene.add(strip);
  }

  return { collidables };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BitsSniperGame() {
  const mountRef    = useRef<HTMLDivElement|null>(null);
  const [isLocked,  setIsLocked]  = useState(false);
  const [playerHp,  setPlayerHp]  = useState(MAX_HEALTH);
  const [kills,     setKills]     = useState(0);
  const [deaths,    setDeaths]    = useState(0);
  const [ammo,      setAmmo]      = useState(WEAPONS[0].maxAmmo);
  const [maxAmmo,   setMaxAmmo]   = useState(WEAPONS[0].maxAmmo);
  const [reloading, setReloading] = useState(false);
  const [wpIdx,     setWpIdx]     = useState(0);
  const [hitFlash,  setHitFlash]  = useState(0);
  const [dead,      setDead]      = useState(false);
  const [respawnT,  setRespawnT]  = useState(0);
  const [shield,    setShield]    = useState(0);   // spawn invincibility timer
  const [hitInds,   setHitInds]   = useState<HitInd[]>([]);
  const [sessionKey,setSessionKey]= useState(0);
  const [lookSens,  setLookSens]  = useState(LOOK_SENS_BASE);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [hitMarker, setHitMarker] = useState(0);
  const stageWrapRef = useRef<HTMLDivElement|null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [crosshairBloom, setCrosshairBloom] = useState(0);
  const [lowHpFx, setLowHpFx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const sessionStartedRef = useRef(false);
  const showIntroRef = useRef(true);
  const isPausedRef = useRef(false);

  // Mutable state shared into RAF loop (avoids stale closures)
  const lookSensRef = useRef(LOOK_SENS_BASE);
  const st = useRef({
    hp: MAX_HEALTH, kills:0, deaths:0,
    ammo: WEAPONS[0].maxAmmo, reloading:false, wpIdx:0,
    dead:false, respawnTimer:0, fireTimer:0, reloadTimer:0,
    running:false, hitFlash:0, hitInds:[] as HitInd[],
    hitMark:0, aiming:false,
    lastDamageTs: 0,
    invincible: SPAWN_INVINCIBLE,
  });

  const requestLock = useCallback(()=>{
    const c = mountRef.current?.querySelector("canvas");
    if(c && document.pointerLockElement!==c) {
      sessionStartedRef.current = true;
      setSessionStarted(true);
      isPausedRef.current = false;
      setIsPaused(false);
      setShowSettings(false);
      c.requestPointerLock();
    }
  },[]);

  const toggleFullscreen = useCallback(()=>{
    const el = stageWrapRef.current;
    if(!el) return;
    if(!document.fullscreenElement){
      el.requestFullscreen?.().then(()=> setIsFullscreen(true)).catch(()=>{});
    } else {
      document.exitFullscreen?.().then(()=> setIsFullscreen(false)).catch(()=>{});
    }
  },[]);

  const applyLookSensitivity = useCallback((next: number)=>{
    const clamped = clamp(next, LOOK_SENS_MIN, LOOK_SENS_MAX);
    const snapped = Math.round(clamped / LOOK_SENS_STEP) * LOOK_SENS_STEP;
    const value = Number(snapped.toFixed(4));
    setLookSens(value);
    lookSensRef.current = value;
  },[]);

  const startFreshSession = useCallback(()=>{
    if(document.pointerLockElement) document.exitPointerLock();
    sessionStartedRef.current = false;
    showIntroRef.current = true;
    isPausedRef.current = false;
    setKills(0); setDeaths(0); setPlayerHp(MAX_HEALTH); setDead(false);
    setAmmo(WEAPONS[0].maxAmmo); setMaxAmmo(WEAPONS[0].maxAmmo);
    setWpIdx(0); setReloading(false); setHitFlash(0);
    setHitInds([]); setShield(0); setCrosshairBloom(0);
    setLowHpFx(0);
    setIsPaused(false);
    setShowSettings(false);
    setShowIntro(true);
    setSessionStarted(false);
    setSessionKey(k=>k+1);
  },[]);

  useEffect(()=>{
    const onFullscreenChange = ()=> setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return ()=> document.removeEventListener("fullscreenchange", onFullscreenChange);
  },[]);

  useEffect(()=>{ sessionStartedRef.current = sessionStarted; }, [sessionStarted]);
  useEffect(()=>{ showIntroRef.current = showIntro; }, [showIntro]);
  useEffect(()=>{ isPausedRef.current = isPaused; }, [isPaused]);

  useEffect(()=>{
    const mount = mountRef.current; if(!mount) return;
    const S = st.current;
    // reset mutable state
    Object.assign(S,{
      hp:MAX_HEALTH, kills:0, deaths:0,
      ammo:WEAPONS[0].maxAmmo, reloading:false, wpIdx:0,
      dead:false, respawnTimer:0, fireTimer:0, reloadTimer:0,
      running:false, hitFlash:0, hitInds:[], invincible:SPAWN_INVINCIBLE,
      lastDamageTs: performance.now()/1000,
    });
    isPausedRef.current = false;
    setIsPaused(false);
    setCrosshairBloom(0);
    setLowHpFx(0);

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = POSTFX_EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    mount.appendChild(renderer.domElement);

    // ── World scene ───────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101a2c");
    scene.fog = new THREE.FogExp2("#111b2e", 0.0078);

    // ── Camera rig ────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(72,1,0.05,300);
    const yawObj  = new THREE.Object3D();
    const pitchObj= new THREE.Object3D();
    pitchObj.add(camera); yawObj.add(pitchObj);
    yawObj.position.set(0, PLAYER_HEIGHT, 8);
    scene.add(yawObj);

    // ── Cinematic post-processing chain (engine-like rendering feel) ──────────
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      POSTFX_BLOOM_STRENGTH,
      POSTFX_BLOOM_RADIUS,
      POSTFX_BLOOM_THRESHOLD,
    );
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // ── Viewmodel (separate scene so it never clips through world) ────────────
    const vmScene  = new THREE.Scene();
    const vmCamera = new THREE.PerspectiveCamera(60,1,0.01,10);
    vmScene.add(new THREE.AmbientLight("#ffffff",0.9));
    const vmSun = new THREE.DirectionalLight("#ffffff",0.85);
    vmSun.position.set(1,2,1); vmScene.add(vmSun);

    const VM_BASE_X = 0.22;
    const VM_BASE_Y = -0.18;
    const VM_BASE_Z = -0.42;
    const VM_BASE_ROT_Y = -0.18;
    let vmGroup = makeViewmodel(WEAPONS[0], vmScene);
    vmGroup.position.set(VM_BASE_X, VM_BASE_Y, VM_BASE_Z);
    vmGroup.rotation.y = VM_BASE_ROT_Y;

    let vmBobT=0, vmKickT=0, vmRecoilY=0;
    let vmReloadT = 0;
    let vmReloadDur = WEAPONS[0].reloadTime;
    let vmReloadProfile = getReloadAnimProfile(WEAPONS[0].id);
    let vmReloadActive = false;
    let vmReloadFromEmpty = false;

    function triggerReloadAnim(wp: WeaponDef, fromEmpty: boolean){
      const profile = getReloadAnimProfile(wp.id);
      vmReloadDur = fromEmpty
        ? Math.max(0.18, wp.reloadTime)
        : Math.max(0.18, Math.min(profile.tacticalTime, wp.reloadTime * 0.82));
      vmReloadT = 0;
      vmReloadProfile = profile;
      vmReloadActive = true;
      vmReloadFromEmpty = fromEmpty;
    }

    // ── Lights ────────────────────────────────────────────────────────────────
    scene.add(new THREE.HemisphereLight("#f2e2bf", "#243550", 1.08));
    const sun = new THREE.DirectionalLight("#ffe8c0", 1.36);
    sun.position.set(16,30,12); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.far=140;
    const sc=sun.shadow.camera as THREE.OrthographicCamera;
    sc.left=sc.bottom=-70; sc.right=sc.top=70;
    scene.add(sun);
    const rim = new THREE.DirectionalLight("#6db6ff", 0.42);
    rim.position.set(-26, 11, -18);
    scene.add(rim);
    const ptA = new THREE.PointLight("#3f88ff",0.88,116); ptA.position.set(-20,8,-20); scene.add(ptA);
    const ptB = new THREE.PointLight("#ff7a30",0.74,116); ptB.position.set( 20,8, 20); scene.add(ptB);

    // ── Map ───────────────────────────────────────────────────────────────────
    const { collidables } = buildMap(scene);

    // ── Projectiles ───────────────────────────────────────────────────────────
    const projectiles: Projectile[] = [];
    const projGeo = new THREE.SphereGeometry(0.09,6,6);
    const projSegment = new THREE.Line3();
    const projClosest = new THREE.Vector3();
    const projImpact = new THREE.Vector3();
    const projRay = new THREE.Ray();
    const projDir = new THREE.Vector3();

    function spawnProj(
      origin: THREE.Vector3, dir: THREE.Vector3, wp: WeaponDef,
      fromBot: boolean
    ){
      const mat = new THREE.MeshBasicMaterial({color:wp.projColor});
      const m   = new THREE.Mesh(projGeo,mat);
      m.position.copy(origin); scene.add(m);
      projectiles.push({
        mesh:m, vel:dir.clone().normalize().multiplyScalar(wp.projSpeed * PROJECTILE_SPEED_MULT * wp.speedMult),
        fromBot, damage:wp.damage, range:wp.range, traveled:0,
        splash:wp.splash, splashR:wp.splashR, splashDmg:wp.splashDmg,
      });
    }

    // ── Spawns (player/CT and enemies distributed over the map) ────────────────
    let playerSpawnSeed = Math.floor(Math.random() * PLAYER_SPAWN_ZONES.length);
    let botSpawnSeed = Math.floor(Math.random() * BOT_SPAWN_ZONES.length);
    const spawnProbe = new THREE.Box3();
    const playerSpawnSize = new THREE.Vector3(PLAYER_RADIUS * 2, PLAYER_HEIGHT * 2, PLAYER_RADIUS * 2);
    const botSpawnSize = new THREE.Vector3(BOT_RADIUS * 2, BOT_HEIGHT * 2, BOT_RADIUS * 2);
    const bots: BotState[] = [];
    const lookCenter = new THREE.Vector3(0, PLAYER_HEIGHT, 0);

    function overlapsCollidable(pos: THREE.Vector3, size: THREE.Vector3) {
      spawnProbe.setFromCenterAndSize(pos, size);
      for (const box of collidables) {
        if (spawnProbe.intersectsBox(box)) return true;
      }
      return false;
    }

    function facePlayerTowardCenter() {
      const toMid = lookCenter.clone().sub(yawObj.position);
      yawObj.rotation.y = Math.atan2(toMid.x, toMid.z);
      pitchObj.rotation.x = 0;
    }

    function pickInitialPlayerSpawn(): THREE.Vector3 {
      let fallback = pointInSpawnZone(PLAYER_SPAWN_ZONES[playerSpawnSeed % PLAYER_SPAWN_ZONES.length], PLAYER_HEIGHT);
      for (let i = 0; i < 48; i++) {
        const idx = (playerSpawnSeed + i) % PLAYER_SPAWN_ZONES.length;
        const candidate = pointInSpawnZone(PLAYER_SPAWN_ZONES[idx], PLAYER_HEIGHT);
        if (overlapsCollidable(candidate, playerSpawnSize)) continue;
        playerSpawnSeed = idx;
        return candidate;
      }
      // If every spawn is blocked, fallback to best effort.
      if (overlapsCollidable(fallback, playerSpawnSize)) {
        fallback = new THREE.Vector3(50, PLAYER_HEIGHT, 4);
      }
      return fallback;
    }

    function pickPlayerSpawn(): THREE.Vector3 {
      playerSpawnSeed = (playerSpawnSeed + 1) % PLAYER_SPAWN_ZONES.length;
      let best = pointInSpawnZone(PLAYER_SPAWN_ZONES[playerSpawnSeed], PLAYER_HEIGHT);
      let bestScore = -Infinity;
      const avoidBots = bots.filter((b)=>!b.dead).map((b)=>b.mesh.position);
      for(let i=0;i<52;i++){
        const idx = (playerSpawnSeed + i) % PLAYER_SPAWN_ZONES.length;
        const candidate = pointInSpawnZone(PLAYER_SPAWN_ZONES[idx], PLAYER_HEIGHT);
        if (overlapsCollidable(candidate, playerSpawnSize)) continue;

        let nearestBot = Infinity;
        for (const p of avoidBots) nearestBot = Math.min(nearestBot, candidate.distanceTo(p));
        if (nearestBot >= 18) {
          playerSpawnSeed = idx;
          return candidate;
        }
        if (nearestBot > bestScore) {
          bestScore = nearestBot;
          best = candidate;
        }
      }
      return best;
    }

    function pickBotSpawn(botId:number): THREE.Vector3 {
      const otherBots = bots.filter((b)=>!b.dead && b.id!==botId).map((b)=>b.mesh.position);
      let best = pointInSpawnZone(BOT_SPAWN_ZONES[botSpawnSeed % BOT_SPAWN_ZONES.length], BOT_HEIGHT);
      let bestScore = -Infinity;

      for(let i=0;i<52;i++){
        const idx = (botSpawnSeed + botId + i) % BOT_SPAWN_ZONES.length;
        const candidate = pointInSpawnZone(BOT_SPAWN_ZONES[idx], BOT_HEIGHT);
        if (overlapsCollidable(candidate, botSpawnSize)) continue;
        const playerDist = candidate.distanceTo(yawObj.position);
        let nearestBot = Infinity;
        for(const p of otherBots) nearestBot = Math.min(nearestBot, candidate.distanceTo(p));

        if(playerDist >= 24 && nearestBot >= 10){
          botSpawnSeed = (idx + 1) % BOT_SPAWN_ZONES.length;
          return candidate;
        }

        const score = Math.min(playerDist * 0.8, nearestBot);
        if(score > bestScore){
          bestScore = score;
          best = candidate;
        }
      }
      botSpawnSeed = (botSpawnSeed + 1) % BOT_SPAWN_ZONES.length;
      return best;
    }

    const botCollideProbe = new THREE.Box3();
    const botCollidePos = new THREE.Vector3();
    const botCollideSize = new THREE.Vector3(BOT_RADIUS * 2, BOT_HEIGHT * 2, BOT_RADIUS * 2);
    function botCollidesAt(x:number, y:number, z:number){
      botCollidePos.set(x, y, z);
      botCollideProbe.setFromCenterAndSize(botCollidePos, botCollideSize);
      const feet = y - BOT_HEIGHT;
      const head = y + BOT_HEIGHT;
      for(const box of collidables){
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(botCollideProbe.intersectsBox(box)) return true;
      }
      return false;
    }

    function getBotGroundY(x:number, z:number, currentY:number){
      let best = BOT_HEIGHT;
      const feet = currentY - BOT_HEIGHT;
      for(const box of collidables){
        const withinX = x >= box.min.x - BOT_RADIUS*0.6 && x <= box.max.x + BOT_RADIUS*0.6;
        const withinZ = z >= box.min.z - BOT_RADIUS*0.6 && z <= box.max.z + BOT_RADIUS*0.6;
        if(!withinX || !withinZ) continue;

        const topY = box.max.y + BOT_HEIGHT;
        const canStepUp = topY <= currentY + 1.6;
        const notHugeDrop = topY >= feet - 4.2;
        if(canStepUp && notHugeDrop && topY > best){
          best = topY;
        }
      }
      return best;
    }

    yawObj.position.copy(pickInitialPlayerSpawn());
    facePlayerTowardCenter();

    // ── Bots ───────────────────────────────────────────────────────────────────
    for(let i=0;i<BOT_COUNT;i++){
      const mesh = makeBotMesh(BOT_COLORS[i%BOT_COLORS.length]);
      mesh.position.copy(pickBotSpawn(i));
      mesh.position.y = getBotGroundY(mesh.position.x, mesh.position.z, mesh.position.y);
      scene.add(mesh);
      const wIdx = Math.floor(Math.random()*WEAPONS.length);
      const botLabel = BOT_NAMES[i%BOT_NAMES.length];
      updateBotHpLabel(mesh, botLabel, BOT_MAX_HEALTH);
      bots.push({
        id:i, mesh, health:BOT_MAX_HEALTH, dead:false, respawnTimer:0,
        velY:0, onGround:true, yaw:Math.random()*Math.PI*2,
        wpIdx:wIdx,
        fireTimer:Math.random()*2,
        strafeDir:Math.random()<0.5?1:-1, strafeTimer:rng(0.5,1.8),
        reloadTimer:0, ammo:WEAPONS[wIdx].maxAmmo,
        label:botLabel, lastHudHealth:BOT_MAX_HEALTH,
        animTime:rng(0,Math.PI*2), animPhase:rng(0,Math.PI*2),
      });
    }

    // ── Player actions ────────────────────────────────────────────────────────
    const keys: Record<string,boolean> = {};
    let velX = 0, velY = 0, velZ = 0, onGround = false;
    let recoilBloom = 0;
    let crossBloom = 0;
    let coyoteTimer = 0;
    let jumpBufferTimer = 0;
    let headBobT = 0;
    let headBobY = 0;
    let landingKick = 0;

    function doFire(){
      if(S.dead||S.reloading||S.ammo<=0) return;
      const now = performance.now()/1000;
      const wp  = WEAPONS[S.wpIdx];
      if(S.fireTimer > now) return;
      S.fireTimer = now + 1/wp.fireRate;
      S.ammo = Math.max(0, S.ammo-1);
      setAmmo(S.ammo);
      if(S.ammo===0){
        S.reloading=true; S.reloadTimer=now+wp.reloadTime; setReloading(true);
        triggerReloadAnim(wp, true);
      }
      vmKickT = 0.14;   // trigger viewmodel recoil kick

      const horizontalSpeed = Math.hypot(velX, velZ);
      const moveRatio = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);
      const spreadScale =
        1
        + moveRatio * 0.85
        + (onGround ? 0 : 0.48)
        + recoilBloom * 0.74;
      const dynamicSpread = wp.spread * spreadScale * SHOT_SPREAD_MULT * (S.aiming ? ADS_SPREAD_MULT : 1);

      // Muzzle in view space: right 0.22, down 0.165, forward -0.6 - barrelLen (rifle tip)
      const muzzleOffset = new THREE.Vector3(0.22, -0.165, -0.6 - wp.barrelLen);
      muzzleOffset.applyEuler(new THREE.Euler(pitchObj.rotation.x, yawObj.rotation.y, 0, "YXZ"));
      const muzzleWorld = yawObj.position.clone().add(muzzleOffset);

      const fwd = new THREE.Vector3(0,0,-1)
        .applyEuler(new THREE.Euler(pitchObj.rotation.x, yawObj.rotation.y, 0,"YXZ"));
      for(let p=0;p<wp.pellets;p++){
        const d = fwd.clone().add(new THREE.Vector3(
          (Math.random()-0.5)*dynamicSpread*2,
          (Math.random()-0.5)*dynamicSpread*2,
          (Math.random()-0.5)*dynamicSpread*2,
        )).normalize();
        spawnProj(muzzleWorld.clone(), d, wp, false);
      }

      const bloomGain = 0.08 + wp.fireRate * 0.02 + (wp.pellets > 1 ? 0.1 : 0);
      recoilBloom = clamp(recoilBloom + bloomGain, 0, 1.35);
      const recoilKick = (S.aiming ? 0.0065 : 0.011) * (1 + recoilBloom * 0.28);
      pitchObj.rotation.x = clamp(pitchObj.rotation.x + recoilKick, -1.35, 1.35);
      yawObj.rotation.y += (Math.random() - 0.5) * recoilKick * 0.75;
    }

    function doReload(){
      if(S.dead||S.reloading) return;
      const wp=WEAPONS[S.wpIdx];
      if(S.ammo>=wp.maxAmmo){
        // Allow a tactical reload animation even on full mag for clear feedback on R.
        triggerReloadAnim(wp, false);
        return;
      }
      const now=performance.now()/1000;
      S.reloading=true; S.reloadTimer=now+wp.reloadTime; setReloading(true);
      triggerReloadAnim(wp, false);
    }

    function switchWeapon(idx:number){
      if(idx===S.wpIdx) return;
      S.wpIdx=idx; S.reloading=false; S.ammo=WEAPONS[idx].maxAmmo; S.reloadTimer=0;
      setWpIdx(idx); setAmmo(WEAPONS[idx].maxAmmo); setMaxAmmo(WEAPONS[idx].maxAmmo); setReloading(false);
      recoilBloom = 0;
      // swap viewmodel mesh
      vmScene.remove(vmGroup);
      vmGroup = makeViewmodel(WEAPONS[idx], vmScene);
      vmGroup.position.set(VM_BASE_X, VM_BASE_Y, VM_BASE_Z);
      vmGroup.rotation.y = VM_BASE_ROT_Y;
      vmReloadT = 0;
      vmReloadDur = WEAPONS[idx].reloadTime;
      vmReloadProfile = getReloadAnimProfile(WEAPONS[idx].id);
      vmReloadActive = false;
      vmReloadFromEmpty = false;
    }

    function respawnPlayer(){
      S.hp=MAX_HEALTH; S.dead=false; S.respawnTimer=0;
      S.ammo=WEAPONS[S.wpIdx].maxAmmo; S.reloading=false;
      S.invincible = SPAWN_INVINCIBLE;
      S.lastDamageTs = performance.now()/1000;
      yawObj.position.copy(pickPlayerSpawn());
      facePlayerTowardCenter();
      velX=0; velY=0; velZ=0; onGround=false;
      coyoteTimer=0; jumpBufferTimer=0;
      recoilBloom=0; crossBloom=0; headBobT=0; headBobY=0; landingKick=0;
      pitchObj.position.y = 0;
      vmReloadT = 0;
      vmReloadActive = false;
      vmReloadFromEmpty = false;
      setPlayerHp(MAX_HEALTH); setDead(false); setAmmo(S.ammo);
      setReloading(false); setShield(SPAWN_INVINCIBLE); setCrosshairBloom(0); setLowHpFx(0);
    }

    function killPlayer(){
      if(S.dead || S.invincible>0) return;
      S.lastDamageTs = performance.now()/1000;
      S.dead=true; S.deaths++;
      S.respawnTimer=RESPAWN_SECS;
      setDead(true); setDeaths(S.deaths); setRespawnT(RESPAWN_SECS);
    }

    // ── Input handlers ────────────────────────────────────────────────────────
    const onMouseDown = (e:MouseEvent)=>{
      if(e.button===2){
        if(document.pointerLockElement===renderer.domElement){
          S.aiming = true;
          setIsAiming(true);
        }
        return;
      }
      if(e.button!==0) return;
      if(document.pointerLockElement!==renderer.domElement){
        setSessionStarted(true);
        renderer.domElement.requestPointerLock(); return;
      }
      doFire();
    };
    const onMouseDownTrack = (e:MouseEvent)=>{ if(e.button===0) keys["MouseLeft"]=true; };
    const onMouseUpTrack   = (e:MouseEvent)=>{
      if(e.button===0) keys["MouseLeft"]=false;
      if(e.button===2){
        S.aiming = false;
        setIsAiming(false);
      }
    };

    const onMouseMove = (e:MouseEvent)=>{
      if(document.pointerLockElement!==renderer.domElement || S.dead) return;
      const sens = lookSensRef.current * (S.aiming ? ADS_LOOK_SENS_MULT : 1);
      yawObj.rotation.y   -= e.movementX * sens;
      pitchObj.rotation.x -= e.movementY * sens;
      pitchObj.rotation.x  = clamp(pitchObj.rotation.x, -1.35, 1.35);
    };

    const onKeyDown = (e:KeyboardEvent)=>{
      if((e.altKey && e.code==="Enter") || e.code==="KeyM"){
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if(e.code==="KeyP"){
        e.preventDefault();
        if(document.pointerLockElement===renderer.domElement){
          document.exitPointerLock();
        } else if(sessionStartedRef.current && !showIntroRef.current && !S.dead){
          isPausedRef.current = true;
          setIsPaused(true);
          setShowSettings(true);
        }
        return;
      }

      keys[e.code]=true;
      if((e.code==="Space"||e.code==="KeyF") && !e.repeat){
        e.preventDefault();
        jumpBufferTimer = JUMP_BUFFER_SECS;
      }
      if(e.code==="KeyR") doReload();
      if(e.code==="Digit1") switchWeapon(0);
      if(e.code==="Digit2") switchWeapon(1);
      if(e.code==="Digit3") switchWeapon(2);
      if(e.code==="Digit4") switchWeapon(3);
    };
    const onKeyUp   = (e:KeyboardEvent)=>{
      keys[e.code]=false;
      if((e.code==="Space"||e.code==="KeyF") && velY>0){
        velY *= JUMP_RELEASE_CUT;
      }
    };
    const onLockChg = ()=>{
      const locked = document.pointerLockElement===renderer.domElement;
      setIsLocked(locked);
      if(locked){
        setSessionStarted(true);
        isPausedRef.current = false;
        setIsPaused(false);
        setShowSettings(false);
      } else {
        S.aiming = false;
        setIsAiming(false);
        for(const k of Object.keys(keys)) keys[k]=false;
        if(sessionStartedRef.current && !showIntroRef.current && !S.dead){
          isPausedRef.current = true;
          setIsPaused(true);
          setShowSettings(true);
        }
      }
    };
    const onWheel = (e:WheelEvent)=>{
      if(document.pointerLockElement!==renderer.domElement || S.dead) return;
      e.preventDefault();
      const dir = e.deltaY>0 ? 1 : -1;
      const next = (S.wpIdx + dir + WEAPONS.length) % WEAPONS.length;
      switchWeapon(next);
    };

    const resize=()=>{
      const w=Math.max(1,mount.clientWidth), h=Math.max(1,mount.clientHeight);
      camera.aspect=w/h; camera.updateProjectionMatrix();
      vmCamera.aspect=w/h; vmCamera.updateProjectionMatrix();
      renderer.setSize(w,h,false);
      composer.setSize(w,h);
    };
    resize();
    const ro=new ResizeObserver(resize); ro.observe(mount);

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousedown", onMouseDownTrack);
    renderer.domElement.addEventListener("mouseup",   onMouseUpTrack);
    renderer.domElement.addEventListener("contextmenu", (ev)=>ev.preventDefault());
    document.addEventListener("pointerlockchange", onLockChg);
    document.addEventListener("wheel", onWheel, { passive:false });
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup",   onKeyUp);

    // ── Splash damage helper ──────────────────────────────────────────────────
    function applySplash(proj:Projectile, pos:THREE.Vector3){
      for(const bot of bots){
        if(bot.dead) continue;
        const d=bot.mesh.position.distanceTo(pos);
        if(d<proj.splashR){
          bot.health -= proj.splashDmg*(1-d/proj.splashR);
          if(bot.health<=0){
            bot.dead=true; bot.mesh.visible=false;
            bot.respawnTimer=RESPAWN_SECS;
            S.kills++; setKills(S.kills);
          }
        }
      }
      if(!S.dead && S.invincible<=0){
        const pd=yawObj.position.distanceTo(pos);
        if(pd<proj.splashR){
          S.hp -= proj.splashDmg*(1-pd/proj.splashR);
          S.lastDamageTs = performance.now()/1000;
          S.hitFlash=1; setHitFlash(1);
          if(S.hp<=0) killPlayer(); else setPlayerHp(Math.max(0,S.hp));
        }
      }
    }

    // ── Bot AI ────────────────────────────────────────────────────────────────
    const _tv = new THREE.Vector3();
    function updateBot(bot:BotState, dt:number){
      if(bot.dead){
        bot.respawnTimer-=dt;
        if(bot.respawnTimer<=0){
          bot.dead=false; bot.health=BOT_MAX_HEALTH; bot.mesh.visible=true;
          bot.ammo=WEAPONS[bot.wpIdx].maxAmmo;
          bot.mesh.position.copy(pickBotSpawn(bot.id));
          bot.mesh.position.y = getBotGroundY(bot.mesh.position.x, bot.mesh.position.z, bot.mesh.position.y);
          bot.onGround = true;
          bot.velY = 0;
          bot.animTime = rng(0, Math.PI*2);
          bot.lastHudHealth = BOT_MAX_HEALTH;
          updateBotHpLabel(bot.mesh, bot.label, BOT_MAX_HEALTH);
        }
        return;
      }
      const wp = WEAPONS[bot.wpIdx];
      const bp = bot.mesh.position, pp = yawObj.position;
      _tv.copy(pp).sub(bp);
      const dist = _tv.length();
      bot.yaw = Math.atan2(_tv.x, _tv.z);
      bot.mesh.rotation.y = bot.yaw;

      // strafe logic
      bot.strafeTimer-=dt;
      if(bot.strafeTimer<=0){ bot.strafeDir=-bot.strafeDir; bot.strafeTimer=rng(0.6,2.0); }
      const ideal=11+bot.id*1.1;
      const fwd = dist>ideal ? 1 : (dist<ideal*0.55 ? -0.6 : 0);
      const ms  = 4.8;
      // keep bots from stacking into one blob while pursuing player
      let sepX = 0;
      let sepZ = 0;
      for(const other of bots){
        if(other.id===bot.id || other.dead) continue;
        const ox = bp.x - other.mesh.position.x;
        const oz = bp.z - other.mesh.position.z;
        const dSq = ox*ox + oz*oz;
        if(dSq <= 0.0001 || dSq > 8.5*8.5) continue;
        const d = Math.sqrt(dSq);
        const push = (8.5 - d) / 8.5;
        sepX += (ox / d) * push;
        sepZ += (oz / d) * push;
      }
      const sepLen = Math.hypot(sepX, sepZ);
      if(sepLen > 0.0001){
        sepX /= sepLen;
        sepZ /= sepLen;
      }

      const moveX = (Math.sin(bot.yaw)*fwd + Math.cos(bot.yaw)*bot.strafeDir + sepX*0.75) * ms * dt;
      const moveZ = (Math.cos(bot.yaw)*fwd - Math.sin(bot.yaw)*bot.strafeDir + sepZ*0.75) * ms * dt;
      const nextX = clamp(bp.x + moveX, -ARENA_HALF + 1, ARENA_HALF - 1);
      const nextZ = clamp(bp.z + moveZ, -ARENA_HALF + 1, ARENA_HALF - 1);

      // axis-resolved collision to prevent tunneling through thin walls
      if(!botCollidesAt(nextX, bp.y, bp.z)){
        bp.x = nextX;
      } else {
        const nudgeX = clamp(bp.x + Math.sign(moveX || 1) * 0.08, -ARENA_HALF + 1, ARENA_HALF - 1);
        if(!botCollidesAt(nudgeX, bp.y, bp.z)) bp.x = nudgeX;
      }
      if(!botCollidesAt(bp.x, bp.y, nextZ)){
        bp.z = nextZ;
      } else {
        const nudgeZ = clamp(bp.z + Math.sign(moveZ || 1) * 0.08, -ARENA_HALF + 1, ARENA_HALF - 1);
        if(!botCollidesAt(bp.x, bp.y, nudgeZ)) bp.z = nudgeZ;
      }
      pushBotOutOfBoxes(bot);

      // Ground snap: keeps bots firmly attached to floors/platform tops.
      const groundY = getBotGroundY(bp.x, bp.z, bp.y);
      const dy = groundY - bp.y;
      if(dy > 0){
        bp.y += Math.min(dy, dt * 11.5);
      } else {
        bp.y += Math.max(dy, -dt * 13.5);
      }
      if(Math.abs(groundY - bp.y) < 0.04) bp.y = groundY;
      bot.onGround = Math.abs(groundY - bp.y) < 0.14;
      bot.velY = 0;
      pushBotOutOfBoxes(bot);

      // Bot animation (idle breathing + walk wobble).
      const moveSpeed = Math.hypot(moveX, moveZ) / Math.max(0.0001, dt);
      const move01 = clamp(moveSpeed / 5.2, 0, 1);
      const animIntensity = 0.24 + move01 * 0.76;
      bot.animTime += dt * (2.1 + move01 * 8.6);

      const bob = Math.sin(bot.animTime + bot.animPhase);
      const wobble = Math.sin(bot.animTime * 2.2 + bot.animPhase * 0.7);
      bot.mesh.rotation.x = Math.sin(bot.animTime * 1.65 + bot.animPhase) * 0.05 * animIntensity;
      bot.mesh.rotation.z = Math.cos(bot.animTime * 1.85 + bot.animPhase) * 0.045 * animIntensity;

      const body = bot.mesh.userData.body as THREE.Mesh | undefined;
      const base = bot.mesh.userData.base as THREE.Mesh | undefined;
      const gun = bot.mesh.userData.gun as THREE.Mesh | undefined;
      if(body){
        const bodyBaseY = (bot.mesh.userData.bodyBaseY as number | undefined) ?? (BOT_EGG_R * 1.28);
        body.position.y = bodyBaseY + bob * 0.065 * animIntensity;
        const sx = 1 + wobble * 0.035 * animIntensity;
        const sy = 1 - wobble * 0.055 * animIntensity;
        body.scale.set(sx, sy, sx);
      }
      if(base){
        const baseY = (bot.mesh.userData.baseBaseY as number | undefined) ?? 0.09;
        base.position.y = baseY + Math.sin(bot.animTime * 2.4 + bot.animPhase) * 0.01 * animIntensity;
      }
      if(gun){
        const gunBaseRotZ = (bot.mesh.userData.gunBaseRotZ as number | undefined) ?? 0;
        gun.rotation.z = gunBaseRotZ + Math.sin(bot.animTime * 3.1 + bot.animPhase) * 0.09 * animIntensity;
      }

      // hp bar
      const hbFg = bot.mesh.userData.hpBarFg as THREE.Mesh | undefined;
      const hbBg = bot.mesh.userData.hpBarBg as THREE.Mesh | undefined;
      const hpLabelSprite = bot.mesh.userData.hpLabelSprite as THREE.Sprite | undefined;
      const ratio=clamp(bot.health/BOT_MAX_HEALTH,0,1);
      if (hbFg && hbBg) {
        hbFg.scale.x=Math.max(0.01,ratio);
        hbFg.position.x=-(1-ratio)*0.54;
        (hbFg.material as THREE.MeshBasicMaterial).color.set(getBotHudColor(ratio));
        hbFg.lookAt(camera.position);
        hbBg.lookAt(camera.position);
      }
      if(hpLabelSprite){
        hpLabelSprite.lookAt(camera.position);
      }
      if(Math.abs(bot.lastHudHealth - bot.health) >= 0.5){
        bot.lastHudHealth = bot.health;
        updateBotHpLabel(bot.mesh, bot.label, bot.health);
      }

      // reload
      if(bot.reloadTimer>0){ bot.reloadTimer-=dt; if(bot.reloadTimer<=0){ bot.ammo=wp.maxAmmo; bot.reloadTimer=0; } }

      // fire
      bot.fireTimer-=dt;
      if(bot.fireTimer<=0 && dist<wp.range*1.5 && bot.ammo>0){
        bot.fireTimer = 1/(wp.fireRate*(0.48+Math.random()*0.54));
        const origin = bp.clone().add(new THREE.Vector3(0,BOT_EGG_R*2,0));
        const toP    = pp.clone().add(new THREE.Vector3(0,0.3,0)).sub(origin).normalize();
        const inac   = BOT_INACCURACY;
        for(let p=0;p<wp.pellets;p++){
          const d=toP.clone().add(new THREE.Vector3(
            (Math.random()-0.5)*(wp.spread+inac)*2,
            (Math.random()-0.5)*(wp.spread+inac)*2,
            (Math.random()-0.5)*(wp.spread+inac)*2,
          )).normalize();
          spawnProj(origin,d,wp,true);
        }
        bot.ammo=Math.max(0,bot.ammo-1);
        if(bot.ammo===0) bot.reloadTimer=wp.reloadTime;
      }
    }

    // ── Actor-vs-world collision push-out ──────────────────────────────────────
    const PBOX = new THREE.Box3();
    const BBOX = new THREE.Box3();
    const BOT_BOX_SIZE = new THREE.Vector3(BOT_RADIUS*2, BOT_HEIGHT*2, BOT_RADIUS*2);
    const _bc = new THREE.Vector3();
    const _hs = new THREE.Vector3();
    const _pd = new THREE.Vector3();

    function pushBotOutOfBoxes(bot: BotState){
      const pos = bot.mesh.position;
      BBOX.setFromCenterAndSize(pos, BOT_BOX_SIZE);
      for(const box of collidables){
        const feet = pos.y - BOT_HEIGHT;
        const head = pos.y + BOT_HEIGHT;
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(!BBOX.intersectsBox(box)) continue;

        box.getCenter(_bc);
        _pd.copy(pos).sub(_bc);
        _pd.y = 0;
        box.getSize(_hs).multiplyScalar(0.5);
        const ox = _hs.x + BOT_RADIUS - Math.abs(_pd.x);
        const oz = _hs.z + BOT_RADIUS - Math.abs(_pd.z);
        if(ox<=0 || oz<=0) continue;

        if(ox < oz){
          const sx = Math.abs(_pd.x) < 1e-4 ? (Math.random()<0.5 ? -1 : 1) : Math.sign(_pd.x);
          pos.x += sx * ox;
        } else {
          const sz = Math.abs(_pd.z) < 1e-4 ? (Math.random()<0.5 ? -1 : 1) : Math.sign(_pd.z);
          pos.z += sz * oz;
        }
        BBOX.setFromCenterAndSize(pos, BOT_BOX_SIZE);
      }
    }

    function pushOutOfBoxes(){
      PBOX.setFromCenterAndSize(yawObj.position,
        new THREE.Vector3(PLAYER_RADIUS*2, PLAYER_HEIGHT*2, PLAYER_RADIUS*2));
      for(const box of collidables){
        const feet = yawObj.position.y - PLAYER_HEIGHT;
        const head = yawObj.position.y + PLAYER_HEIGHT;
        if(feet >= box.max.y - 0.01 || head <= box.min.y + 0.01) continue;
        if(!PBOX.intersectsBox(box)) continue;
        box.getCenter(_bc);
        _pd.copy(yawObj.position).sub(_bc);
        _pd.y = 0;
        box.getSize(_hs).multiplyScalar(0.5);
        const ox=_hs.x+PLAYER_RADIUS-Math.abs(_pd.x);
        const oz=_hs.z+PLAYER_RADIUS-Math.abs(_pd.z);
        if(ox<oz) yawObj.position.x+=Math.sign(_pd.x||1)*ox;
        else       yawObj.position.z+=Math.sign(_pd.z||1)*oz;
      }
    }

    function resolveVerticalCollisions(prevY:number){
      const px = yawObj.position.x;
      const pz = yawObj.position.z;
      const feetNow = yawObj.position.y - PLAYER_HEIGHT;
      const feetPrev = prevY - PLAYER_HEIGHT;
      const headNow = yawObj.position.y + PLAYER_HEIGHT;
      const headPrev = prevY + PLAYER_HEIGHT;

      let bestLandingY = PLAYER_HEIGHT;
      let hasLanding = false;

      for(const box of collidables){
        const withinX = px >= box.min.x - PLAYER_RADIUS*0.9 && px <= box.max.x + PLAYER_RADIUS*0.9;
        const withinZ = pz >= box.min.z - PLAYER_RADIUS*0.9 && pz <= box.max.z + PLAYER_RADIUS*0.9;
        if(!withinX || !withinZ) continue;

        const top = box.max.y;
        const bottom = box.min.y;

        if(velY <= 0 && feetPrev >= top - 0.02 && feetNow <= top + 0.16){
          const landingY = top + PLAYER_HEIGHT;
          if(landingY > bestLandingY){
            bestLandingY = landingY;
            hasLanding = true;
          }
        }

        if(velY > 0 && headPrev <= bottom + 0.02 && headNow >= bottom - 0.02){
          yawObj.position.y = bottom - PLAYER_HEIGHT - 0.02;
          velY = Math.min(0, velY);
          onGround = false;
          return;
        }
      }

      if(hasLanding && yawObj.position.y <= bestLandingY + 0.24){
        yawObj.position.y = bestLandingY;
        velY = 0;
        onGround = true;
        return;
      }

      if(yawObj.position.y <= PLAYER_HEIGHT){
        yawObj.position.y = PLAYER_HEIGHT;
        velY = 0;
        onGround = true;
        return;
      }

      onGround = false;
    }

    // ── Main loop ─────────────────────────────────────────────────────────────
    let rafId=0, lastT=performance.now(), hudT=0;

    const animate=(now:number)=>{
      const dt=Math.min((now-lastT)/1000, 0.06); lastT=now; hudT+=dt;
      const nowSec=now/1000;

      // Respawn countdown
      if(S.dead){
        S.respawnTimer-=dt;
        if(hudT>0.12) setRespawnT(Math.max(0,S.respawnTimer));
        if(S.respawnTimer<=0) respawnPlayer();
        renderer.autoClear=true;
        composer.render();
        rafId=requestAnimationFrame(animate); return;
      }

      if(isPausedRef.current){
        renderer.autoClear=true;
        composer.render();
        renderer.autoClear=false;
        renderer.clearDepth();
        renderer.render(vmScene, vmCamera);
        rafId=requestAnimationFrame(animate); return;
      }

      // Spawn invincibility countdown
      if(S.invincible>0){
        S.invincible=Math.max(0,S.invincible-dt);
        if(hudT>0.05) setShield(S.invincible);
      }

      // Regen after a quiet period with no incoming damage (exponential recovery).
      if(S.hp < MAX_HEALTH && (nowSec - S.lastDamageTs) >= HP_REGEN_DELAY_SECS){
        const missing = MAX_HEALTH - S.hp;
        const gain = missing * (1 - Math.exp(-HP_REGEN_EXP_RATE * dt));
        if(gain > 0){
          S.hp = Math.min(MAX_HEALTH, S.hp + gain);
          if(S.hp > MAX_HEALTH - 0.12) S.hp = MAX_HEALTH;
        }
      }

      // Reload finish
      if(S.reloading && S.reloadTimer<=nowSec){
        S.ammo=WEAPONS[S.wpIdx].maxAmmo; S.reloading=false;
        setAmmo(S.ammo); setReloading(false);
      }

      // Auto-fire
      if(keys["MouseLeft"] && WEAPONS[S.wpIdx].auto) doFire();

      // ── Player movement (inertia + coyote jump + jump buffering) ──
      const wasGrounded = onGround;
      S.running = !!(keys["ShiftLeft"]||keys["ShiftRight"]);
      const speed = MOVE_SPEED * (S.running ? RUN_MULT : 1) * (S.aiming ? ADS_MOVE_MULT : 1);
      const fwdIn = (keys["KeyW"]?1:0) - (keys["KeyS"]?1:0);  // +1 = forward
      const sidIn = (keys["KeyD"]?1:0) - (keys["KeyA"]?1:0);  // +1 = right

      let wishX = 0;
      let wishZ = 0;
      if(fwdIn!==0 || sidIn!==0){
        const len = Math.sqrt(fwdIn*fwdIn+sidIn*sidIn);
        const nf=fwdIn/len, ns=sidIn/len;
        const sinY=Math.sin(yawObj.rotation.y), cosY=Math.cos(yawObj.rotation.y);
        // World space: forward = (-sinY, 0, -cosY), right = (cosY, 0, -sinY)
        wishX = -sinY*nf + cosY*ns;
        wishZ = -cosY*nf - sinY*ns;
      }

      const accel = clamp((onGround ? GROUND_ACCEL : AIR_ACCEL) * dt, 0, 1);
      const brake = clamp((onGround ? GROUND_BRAKE : AIR_BRAKE) * dt, 0, 1);
      if(wishX!==0 || wishZ!==0){
        velX += (wishX * speed - velX) * accel;
        velZ += (wishZ * speed - velZ) * accel;
      } else {
        velX += (0 - velX) * brake;
        velZ += (0 - velZ) * brake;
      }
      if(!onGround){
        const airDrag = clamp(1 - dt * AIR_DRAG, 0.85, 1);
        velX *= airDrag;
        velZ *= airDrag;
      }
      yawObj.position.x=clamp(yawObj.position.x+velX*dt,-ARENA_HALF+PLAYER_RADIUS,ARENA_HALF-PLAYER_RADIUS);
      yawObj.position.z=clamp(yawObj.position.z+velZ*dt,-ARENA_HALF+PLAYER_RADIUS,ARENA_HALF-PLAYER_RADIUS);

      // Jump + gravity
      if(onGround) coyoteTimer = COYOTE_TIME_SECS;
      else coyoteTimer = Math.max(0, coyoteTimer - dt);
      jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);
      if(jumpBufferTimer>0 && coyoteTimer>0){
        velY=JUMP_VEL;
        onGround=false;
        coyoteTimer=0;
        jumpBufferTimer=0;
      }
      const prevY = yawObj.position.y;
      velY -= GRAVITY*dt;
      const preResolveVelY = velY;
      yawObj.position.y += velY*dt;
      resolveVerticalCollisions(prevY);
      pushOutOfBoxes();
      if(!wasGrounded && onGround && preResolveVelY < -2.4){
        landingKick = clamp(Math.abs(preResolveVelY) * 0.011, 0.02, 0.09);
      }

      // Bot updates
      for(const bot of bots) updateBot(bot,dt);

      // Projectile updates
      const liveBots=bots.filter(b=>!b.dead);
      for(let i=projectiles.length-1;i>=0;i--){
        const pr=projectiles[i];
        const startPos = pr.mesh.position.clone();
        const step=pr.vel.clone().multiplyScalar(dt);
        const endPos = startPos.clone().add(step);
        const stepLen = step.length();
        pr.traveled+=stepLen;
        projSegment.set(startPos, endPos);
        const pp=endPos;
        let hit = pr.traveled>pr.range
          || Math.abs(pp.x)>ARENA_HALF+3
          || Math.abs(pp.z)>ARENA_HALF+3
          || pp.y<-1 || pp.y>20;
        let splashHandled = false;
        projImpact.copy(pp);

        if(!hit && stepLen > 1e-6){
          projDir.copy(step).multiplyScalar(1 / stepLen);
          projRay.set(startPos, projDir);
          for(const box of collidables){
            const structureHit = projRay.intersectBox(box, projImpact);
            if(structureHit && projImpact.distanceTo(startPos) <= stepLen + 1e-4){
              hit = true;
              break;
            }
          }
        }

        if(!hit && pr.fromBot && !S.dead && S.invincible<=0){
          projSegment.closestPointToPoint(yawObj.position, true, projClosest);
          if(projClosest.distanceTo(yawObj.position)<PLAYER_RADIUS+0.15){
            hit=true; S.hp-=pr.damage; S.hitFlash=1;
            S.lastDamageTs = nowSec;
            projImpact.copy(projClosest);
            const rel=projImpact.clone().sub(yawObj.position); rel.y=0;
            S.hitInds=[...S.hitInds,{angle:Math.atan2(rel.x,rel.z)-yawObj.rotation.y+Math.PI,opacity:1}];
            setHitFlash(1);
            if(S.hp<=0) killPlayer(); else setPlayerHp(Math.max(0,S.hp));
            if(pr.splash){
              applySplash(pr,projImpact.clone());
              splashHandled = true;
            }
          }
        }
        if(!hit && !pr.fromBot){
          for(const bot of liveBots){
            if(bot.dead) continue;
            projSegment.closestPointToPoint(bot.mesh.position, true, projClosest);
            if(projClosest.distanceTo(bot.mesh.position)<BOT_RADIUS+0.15){
              hit=true;
              projImpact.copy(projClosest);
              bot.health-=pr.damage;
              S.hitMark = 1;
              setHitMarker(1);
              if(bot.health<=0){
                bot.health=0; bot.dead=true; bot.mesh.visible=false;
                bot.respawnTimer=RESPAWN_SECS; S.kills++; setKills(S.kills);
              }
              if(pr.splash){
                applySplash(pr,projImpact.clone());
                splashHandled = true;
              }
              break;
            }
          }
        }
        if(hit){
          if(pr.splash && !splashHandled){
            applySplash(pr,projImpact.clone());
          }
          scene.remove(pr.mesh); (pr.mesh.material as THREE.Material).dispose(); projectiles.splice(i,1);
          continue;
        }
        pr.mesh.position.copy(endPos);
      }

      // Hit flash fade
      if(S.hitFlash>0){ S.hitFlash=Math.max(0,S.hitFlash-dt*3.5); if(hudT>0.04) setHitFlash(S.hitFlash); }
      if(S.hitMark>0){
        S.hitMark = Math.max(0, S.hitMark-dt*5);
        if(hudT>0.04) setHitMarker(S.hitMark);
      }
      if(S.hitInds.length>0){
        S.hitInds=S.hitInds.map(h=>({...h,opacity:h.opacity-dt*2})).filter(h=>h.opacity>0);
        setHitInds([...S.hitInds]);
      }

      const lowHpRatio = clamp((LOW_HP_WARN_THRESHOLD - S.hp) / LOW_HP_WARN_THRESHOLD, 0, 1);
      let lowHpTarget = 0;
      if(lowHpRatio > 0 && !S.dead){
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.0075);
        lowHpTarget = lowHpRatio * (0.3 + pulse * 0.7);
      }
      if(hudT>0.04) setLowHpFx(lowHpTarget);

      recoilBloom = Math.max(0, recoilBloom - dt * (S.aiming ? 2.7 : 2.2));
      const horizontalSpeed = Math.hypot(velX, velZ);
      const moveBloom = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);
      const targetCrossBloom = clamp(
        recoilBloom * 0.92 + moveBloom * 0.66 + (onGround ? 0 : 0.42) - (S.aiming ? 0.28 : 0),
        0,
        1.55,
      );
      crossBloom += (targetCrossBloom - crossBloom) * Math.min(1, dt * 14);
      if(hudT>0.04) setCrosshairBloom(crossBloom);

      // ── Viewmodel animation ───────────────────────────────────────────────
      const moving = horizontalSpeed > 0.5;
      if(moving && onGround) vmBobT+=dt*(S.running?11.6:7.4); else vmBobT*=0.90;
      const bobY=Math.sin(vmBobT)*0.006;
      const bobX=Math.sin(vmBobT*0.5)*0.003;
      if(vmKickT>0){ vmKickT=Math.max(0,vmKickT-dt); vmRecoilY=vmKickT*0.07; }
      else          { vmRecoilY*=0.80; }
      if(vmReloadActive){
        vmReloadT = Math.min(1, vmReloadT + dt / vmReloadDur);
        if(vmReloadT >= 0.999){
          vmReloadActive = false;
        }
      } else {
        vmReloadT = Math.max(0, vmReloadT - dt * vmReloadProfile.settleSpeed);
      }
      const reloadArc = Math.sin(vmReloadT * Math.PI);
      const wobbleEnvelope = Math.max(0, 1 - Math.abs(vmReloadT - 0.5) * 2);
      const reloadWobble = Math.sin(vmReloadT * Math.PI * vmReloadProfile.wobbleFreq) * wobbleEnvelope;
      const emptyBoost = vmReloadFromEmpty ? 1.14 : 1;
      vmGroup.position.set(
        VM_BASE_X + bobX + reloadArc * vmReloadProfile.side * emptyBoost + reloadWobble * vmReloadProfile.wobble * 0.24,
        VM_BASE_Y + bobY - vmRecoilY - (recoilBloom*0.01) - reloadArc * vmReloadProfile.down * emptyBoost,
        VM_BASE_Z + reloadArc * vmReloadProfile.back * emptyBoost,
      );
      vmGroup.rotation.set(
        reloadArc * vmReloadProfile.pitch * emptyBoost + reloadWobble * vmReloadProfile.wobble * 0.52,
        VM_BASE_ROT_Y + reloadWobble * vmReloadProfile.yaw * emptyBoost,
        -reloadArc * vmReloadProfile.roll * emptyBoost + reloadWobble * vmReloadProfile.wobble,
      );

      if(moving && onGround){
        headBobT += dt * (S.running ? 12.8 : 8.6);
      }
      const speedRatio = clamp(horizontalSpeed / (MOVE_SPEED * RUN_MULT), 0, 1);
      const targetHeadBobY = onGround ? Math.sin(headBobT) * 0.028 * speedRatio : 0;
      headBobY += (targetHeadBobY - headBobY) * Math.min(1, dt * 11);
      landingKick += (0 - landingKick) * Math.min(1, dt * 13);
      pitchObj.position.y = headBobY - landingKick;

      // ── Camera FOV for ADS (zoom on right-click) ─────────────────────────
      const fovBoost = S.aiming ? 0 : clamp((horizontalSpeed / MOVE_SPEED) * (S.running ? 4.5 : 2.1), 0, 5.8);
      const targetFov = (S.aiming ? 46 : 72) + fovBoost;
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }

      // ── Render world, then overlay viewmodel ──────────────────────────────
      renderer.autoClear=true;
      composer.render();
      renderer.autoClear=false;
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);

      if(hudT>0.1){ hudT=0; setPlayerHp(Math.max(0,S.hp)); setAmmo(S.ammo); }
      rafId=requestAnimationFrame(animate);
    };
    rafId=requestAnimationFrame(animate);

    return()=>{
      cancelAnimationFrame(rafId); ro.disconnect();
      renderer.domElement.removeEventListener("mousedown",onMouseDown);
      renderer.domElement.removeEventListener("mousedown",onMouseDownTrack);
      renderer.domElement.removeEventListener("mouseup",onMouseUpTrack);
      document.removeEventListener("pointerlockchange",onLockChg);
      document.removeEventListener("wheel", onWheel as any);
      document.removeEventListener("mousemove",onMouseMove);
      document.removeEventListener("keydown",onKeyDown);
      document.removeEventListener("keyup",onKeyUp);
      if(document.pointerLockElement===renderer.domElement) document.exitPointerLock();
      composer.dispose();
      bloomPass.dispose();
      for(const bot of bots){
        const hpTexture = bot.mesh.userData.hpLabelTexture as THREE.CanvasTexture | undefined;
        const hpSprite = bot.mesh.userData.hpLabelSprite as THREE.Sprite | undefined;
        hpTexture?.dispose();
        if(hpSprite){
          (hpSprite.material as THREE.Material).dispose();
        }
      }
      projGeo.dispose(); renderer.dispose();
      if(renderer.domElement.parentElement===mount) mount.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sessionKey]);

  const wp=WEAPONS[wpIdx];
  const crosshairScale = clamp((isAiming ? 0.84 : 1) + crosshairBloom * 0.42, 0.76, 1.68);

  return (
    <main className="bits-sniper-page">
      <section className="bits-sniper-shell">

        {showDisclaimer && (
          <div className="bits-sniper-disclaimer-overlay">
            <section className="bits-sniper-disclaimer-card" aria-label="דיסקליימר גרסת אלפה">
              <h3>⚠ גרסת אלפה מוקדמת</h3>
              <p>
                המשחק עדיין בשלבי פיתוח מוקדמים ולכן ייתכנו באגים, חוסר איזון וחוויית משחק לא סופית.
              </p>
              <button
                type="button"
                className="bits-sniper-disclaimer-btn"
                onClick={()=> setShowDisclaimer(false)}
              >
                הבנתי, להמשך
              </button>
            </section>
          </div>
        )}

        {!showDisclaimer && showIntro && (
          <div className="bits-sniper-intro-overlay">
            <div className="bits-sniper-intro-card">
              <h2>Shell Strikers</h2>
              <p>FPS מהיר בזירה צבעונית מלאה בבוטים רדיפת־שחקן. התחל משחק, לחץ למסך מלא, ונעול עכבר – ואז פשוט שרוד.</p>
              <ul>
                <li>W/A/S/D – תנועה · Space/F – קפיצה</li>
                <li>Shift – ריצה · עכבר – כוונת · לחיצה שמאלית – ירי</li>
                <li>קליק ימני – כוונת (Zoom) · R – טעינה · 1–4 או גלגלת – החלפת נשק</li>
                <li>Esc – שחרור עכבר · M או Alt+Enter – מסך מלא</li>
              </ul>
              <div className="bits-sniper-intro-setting">
                <span>🎚 רגישות עכבר</span>
                <input
                  type="range"
                  min={LOOK_SENS_MIN}
                  max={LOOK_SENS_MAX}
                  step={LOOK_SENS_STEP}
                  value={lookSens}
                  onChange={(e)=> applyLookSensitivity(Number(e.target.value))}
                />
                <strong>{lookSens.toFixed(4)}</strong>
              </div>
              <div className="bits-sniper-intro-actions">
                <button
                  type="button"
                  className="bits-sniper-intro-fullscreen"
                  onClick={(event)=>{
                    event.stopPropagation();
                    toggleFullscreen();
                  }}
                >
                  ⤢ מסך מלא
                </button>
                <button
                  type="button"
                  onClick={()=>{
                    setShowIntro(false);
                    setSessionStarted(true);
                    requestLock();
                  }}
                  className="bits-sniper-intro-start"
                >
                  🎯 התחל משחק
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Stage ───────────────────────────────────────────────────────── */}
        <div
          ref={stageWrapRef}
          className={`bits-sniper-stage-wrap bits-sniper-stage-wrap--${WEAPONS[wpIdx].id}`}
        >
          <div ref={mountRef} className="bits-sniper-stage"/>

          {sessionStarted && (
            <button
              type="button"
              className="bits-sniper-fs-fab"
              onClick={(event)=>{
                event.stopPropagation();
                toggleFullscreen();
              }}
              title={isFullscreen ? "יציאה ממסך מלא (Esc)" : "מסך מלא"}
              aria-label={isFullscreen ? "יציאה ממסך מלא" : "מסך מלא"}
            >
              {isFullscreen ? "⤓" : "⤢"}
            </button>
          )}

          {/* Crosshair (FPS-style center) */}
          {isLocked&&!dead&&(
            <div
              className={`bits-sniper-crosshair${isAiming ? " bits-sniper-crosshair--ads" : ""}`}
              style={{ transform: `translate(-50%, -50%) scale(${crosshairScale})` }}
              aria-hidden
            />
          )}

          {/* Damage flash */}
          {hitFlash>0&&(
            <div className="bits-sniper-damage-flash" style={{ opacity: hitFlash*0.42 }} aria-hidden/>
          )}

          {lowHpFx>0&&!dead&&(
            <div className="bits-sniper-lowhp-vignette" style={{ opacity: clamp(lowHpFx*0.8, 0, 0.82) }} aria-hidden/>
          )}

          {lowHpFx>0.16&&isLocked&&!dead&&(
            <div className="bits-sniper-lowhp-alert" style={{ opacity: clamp(lowHpFx*1.15, 0, 1) }} aria-hidden>
              ⚠ HP קריטי
            </div>
          )}

          {/* Hit marker when damaging bots */}
          {hitMarker>0&&isLocked&&!dead&&(
            <div className="bits-sniper-hitmarker" style={{ opacity: hitMarker }} aria-hidden/>
          )}

          {/* Spawn shield */}
          {shield>0&&!dead&&(
            <div className="bits-sniper-shield-wrap" style={{
              boxShadow: `inset 0 0 ${40*shield}px rgba(60,190,255,${0.32*Math.min(shield,1)})`,
              borderColor: `rgba(60,190,255,${0.5*Math.min(shield,1)})`,
            }}>
              <div className="bits-sniper-shield-label">🛡 מגן התחלה {shield.toFixed(1)}s</div>
            </div>
          )}

          {/* Hit direction indicators */}
          {hitInds.map((h,i)=>(
            <div key={i} className="bits-sniper-hit-ind" style={{ transform: `rotate(${h.angle}rad)` }}>
              <div className="bits-sniper-hit-ind-bar" style={{ opacity: h.opacity*0.95 }}/>
            </div>
          ))}

          {/* Death overlay */}
          {dead&&(
            <div className="bits-sniper-death-overlay">
              <div className="bits-sniper-death-title">💀 הושמדת</div>
              <div className="bits-sniper-death-timer">מתעורר מחדש בעוד {Math.ceil(respawnT)}s…</div>
            </div>
          )}

          {isPaused && !isLocked && !dead && !showIntro && (
            <div className="bits-sniper-paused-pill">⏸ המשחק מושהה</div>
          )}

          {/* Start prompt */}
          {!isLocked&&!dead&&(
            <button type="button" className="bits-sniper-lock-btn" onClick={requestLock}>
              {isPaused ? "▶ המשך משחק" : sessionStarted ? "▶ לחץ לחזור לקרב" : "🎯 לחץ להתחיל"}
            </button>
          )}

          {!isLocked && !dead && !showIntro && !showSettings && (
            <button
              type="button"
              className="bits-sniper-settings-mini"
              onClick={()=> setShowSettings(true)}
            >
              ⚙ הגדרות
            </button>
          )}

          {sessionStarted&&!isLocked&&!dead&&(
            <button
              type="button"
              className="bits-sniper-restart-mini"
              onClick={startFreshSession}
            >
              ↺ סשן חדש
            </button>
          )}

          {showSettings && !isLocked && (
            <div className="bits-sniper-settings-overlay">
              <section className="bits-sniper-settings-panel" aria-label="חלון הגדרות">
                <header className="bits-sniper-settings-head">
                  <h3>{isPaused ? "משחק מושהה • הגדרות" : "הגדרות משחק"}</h3>
                  <button type="button" onClick={()=> setShowSettings(false)} aria-label="סגור הגדרות">✕</button>
                </header>

                <div className="bits-sniper-settings-row">
                  <span>🎚 רגישות עכבר</span>
                  <input
                    type="range"
                    min={LOOK_SENS_MIN}
                    max={LOOK_SENS_MAX}
                    step={LOOK_SENS_STEP}
                    value={lookSens}
                    onChange={(e)=> applyLookSensitivity(Number(e.target.value))}
                  />
                  <strong>{lookSens.toFixed(4)}</strong>
                </div>

                <div className="bits-sniper-settings-actions">
                  <button type="button" className="bits-sniper-settings-btn" onClick={toggleFullscreen}>
                    {isFullscreen ? "⤓ יציאה ממסך מלא" : "⤢ מסך מלא"}
                  </button>
                  <button type="button" className="bits-sniper-settings-btn is-reset" onClick={startFreshSession}>
                    ↺ סשן חדש
                  </button>
                  <button type="button" className="bits-sniper-settings-btn is-primary" onClick={requestLock}>
                    ▶ חזרה למשחק
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* HUD – bottom left (HP, weapons, ammo) */}
          {isLocked&&!dead&&(
            <div className="bits-sniper-hud">
              <div className="bits-sniper-hp-row">
                <span className="bits-sniper-hp-icon" aria-hidden>❤️</span>
                <div className="bits-sniper-hp-track">
                  <div className="bits-sniper-hp-fill" style={{
                    width: `${clamp(playerHp,0,100)}%`,
                    background: playerHp>50 ? "linear-gradient(90deg,#2ee872,#38ef70)" : playerHp>25 ? "linear-gradient(90deg,#f0a830,#f0c038)" : "linear-gradient(90deg,#e83030,#f04040)",
                  }}/>
                </div>
                <span className="bits-sniper-hp-value">{Math.ceil(playerHp)}</span>
              </div>
              <div className="bits-sniper-weapon-slots">
                {WEAPONS.map((w,i)=>(
                  <div key={w.id} className={`bits-sniper-weapon-slot${i===wpIdx ? " is-active" : ""}`}>
                    <span className="bits-sniper-weapon-emoji">{w.emoji}</span>
                    <span className="bits-sniper-weapon-num">{i+1}</span>
                  </div>
                ))}
              </div>
              <div className="bits-sniper-ammo-row">
                <span className="bits-sniper-ammo-icon">🔫</span>
                <span className={`bits-sniper-ammo-count${reloading ? " is-reload" : ""}`}>
                  {reloading ? "טוען…" : `${ammo} / ${maxAmmo}`}
                </span>
                <span className="bits-sniper-ammo-weapon">{wp.emoji} {wp.label}{wp.auto ? " [אוטו]" : " [ידני]"}</span>
              </div>
            </div>
          )}

          {/* HUD – top right */}
          {isLocked&&!dead&&(
            <div className="bits-sniper-topright">
              <span className="bits-sniper-topright-bots">🤖 {BOT_COUNT} אויבים</span>
              <span className="bits-sniper-topright-kd">{kills} / {deaths}</span>
            </div>
          )}
        </div>

      </section>
    </main>
  );
}
