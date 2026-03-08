/**
 * Bits Sniper – bot mesh, HUD attachment, HP label update.
 */
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { BOT_HEIGHT, BOT_MAX_HEALTH, BOT_COLORS_HEX, BOT_NAMES } from "../constants/gameConstants";
import { drawRoundedRect, getBotHudColor } from "../utils/canvasUtils";
import { clamp } from "../utils/mathUtils";

export const BOT_COLORS = BOT_COLORS_HEX.map((c) => new THREE.Color(c));

export function attachBotHud(g: THREE.Group, _hpBarY: number, hpLabelY: number): void {
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
  hpLabelSprite.position.set(0, hpLabelY, 0);
  hpLabelSprite.scale.set(1.58, 0.59, 1);
  hpLabelSprite.renderOrder = 1001;
  g.add(hpLabelSprite);

  g.userData.hpLabelCtx = hpLabelCanvas.getContext("2d");
  g.userData.hpLabelTexture = hpLabelTexture;
  g.userData.hpLabelSprite = hpLabelSprite;
}

export function updateBotHpLabel(mesh: THREE.Group, label: string, health: number): void {
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
  ctx.strokeStyle = "rgba(100, 120, 140, 0.5)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#8a9eb5";
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

  ctx.fillStyle = "#8a9eb5";
  ctx.font = "700 16px Oxanium, Segoe UI, sans-serif";
  ctx.fillText(`${hpValue}/${BOT_MAX_HEALTH} HP`, width * 0.5, 81);
  texture.needsUpdate = true;
}

export function makeBotMesh(
  color: THREE.Color,
  mutantTemplate: THREE.Group | null,
): THREE.Group {
  const g = new THREE.Group();
  g.userData.muzzleOffsetY = BOT_HEIGHT * 0.36;

  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();

  function fitToBotCapsule(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
    tmpBox.getSize(tmpSize);
    const currentH = Math.max(1e-4, tmpSize.y);
    const targetH = BOT_HEIGHT * 2;
    const s = targetH / currentH;
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
    tmpBox.getCenter(tmpCenter);
    root.position.x -= tmpCenter.x;
    root.position.z -= tmpCenter.z;
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
    root.position.y += -BOT_HEIGHT - tmpBox.min.y;
    root.updateMatrixWorld(true);
  }

  const hudBarY = BOT_HEIGHT + 0.42;
  const hudLabelY = BOT_HEIGHT + 0.74;

  if (mutantTemplate) {
    const mutant = SkeletonUtils.clone(mutantTemplate) as THREE.Group;
    mutant.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clonedMaterials = sourceMaterials.map((mat) => {
        const cloned = mat.clone();
        const maybeColor = cloned as THREE.Material & { color?: THREE.Color };
        if (maybeColor.color) maybeColor.color.lerp(color, 0.12);
        return cloned;
      });
      mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
    });
    fitToBotCapsule(mutant);
    g.add(mutant);
    g.userData.mutantRoot = mutant;
    attachBotHud(g, hudBarY, hudLabelY);
    return g;
  }

  const legH = 0.48;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, legH, 10),
    new THREE.MeshStandardMaterial({ color: "#1a1a2e", roughness: 0.8, metalness: 0.1 }),
  );
  base.position.y = legH * 0.5;
  base.receiveShadow = true;
  g.add(base);

  const torsoH = 0.88;
  const torsoR = 0.3;
  const bMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.15,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(torsoR * 1.02, torsoR, torsoH, 12),
    bMat,
  );
  body.position.y = legH + torsoH * 0.5;
  body.castShadow = true;
  g.add(body);

  const headR = 0.22;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headR, 12, 10),
    new THREE.MeshStandardMaterial({
      color: color.clone().lerp(new THREE.Color("#fff"), 0.15),
      roughness: 0.45,
    }),
  );
  head.position.y = legH + torsoH + headR;
  head.castShadow = true;
  g.add(head);

  const eyeY = head.position.y;
  const eyeZ = headR * 0.92;
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#fff" }),
    );
    eye.position.set(sx * 0.08, eyeY + 0.02, eyeZ);
    g.add(eye);
    const pup = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 6),
      new THREE.MeshStandardMaterial({ color: "#0a0a12" }),
    );
    pup.position.set(sx * 0.08, eyeY + 0.02, eyeZ + 0.04);
    g.add(pup);
  }

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.48, 8),
    new THREE.MeshStandardMaterial({ color: "#2a2a35", roughness: 0.5, metalness: 0.2 }),
  );
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, legH + torsoH * 0.35, torsoR + 0.2);
  g.add(gun);

  attachBotHud(g, hudBarY + BOT_HEIGHT, hudLabelY + BOT_HEIGHT);

  for (const child of g.children) {
    child.position.y -= BOT_HEIGHT;
  }

  g.userData.body = body;
  g.userData.base = base;
  g.userData.gun = gun;
  g.userData.bodyBaseY = body.position.y;
  g.userData.baseBaseY = base.position.y;
  g.userData.gunBaseRotZ = gun.rotation.z;

  return g;
}

export { BOT_NAMES };
