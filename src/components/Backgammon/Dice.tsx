import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useBackgammon } from "./BackgammonContext";
import {
  createPhysicsEngine,
  type DiceFrame,
  type DicePhysicsEngine,
} from "./utils/physicsEngine";

const DIE_SIZE = 0.64;
const DICE_CAMERA_TARGET = new THREE.Vector3(0, 0.34, 0);
const CAMERA_MIN_RADIUS = 4.8;
const CAMERA_MAX_RADIUS = 12.5;
const CAMERA_MIN_POLAR = 0.35;
const CAMERA_MAX_POLAR = 1.5;
const ORBIT_SENSITIVITY = 0.0065;
const ZOOM_SENSITIVITY = 0.01;
const POST_SETTLE_DELAY_MS = 420;

type FacePips = Record<number, Array<[number, number]>>;

const FACE_LAYOUT: FacePips = {
  1: [[0, 0]],
  2: [[-0.23, -0.23], [0.23, 0.23]],
  3: [[-0.24, -0.24], [0, 0], [0.24, 0.24]],
  4: [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]],
  5: [[-0.24, -0.24], [0.24, -0.24], [0, 0], [-0.24, 0.24], [0.24, 0.24]],
  6: [[-0.24, -0.27], [0.24, -0.27], [-0.24, 0], [0.24, 0], [-0.24, 0.27], [0.24, 0.27]],
};

function makeFaceTexture(value: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  ctx.fillStyle = "#f8f4e9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#101215";
  for (const [x, y] of FACE_LAYOUT[value]) {
    const px = canvas.width / 2 + x * canvas.width * 0.7;
    const py = canvas.height / 2 + y * canvas.height * 0.7;

    ctx.beginPath();
    ctx.arc(px, py, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createDieMaterials(): THREE.MeshStandardMaterial[] {
  // +X, -X, +Y, -Y, +Z, -Z
  const faceToValue = [3, 4, 1, 6, 2, 5];

  return faceToValue.map((value) => (
    new THREE.MeshStandardMaterial({
      map: makeFaceTexture(value),
      roughness: 0.45,
      metalness: 0.08,
      color: "#ffffff",
    })
  ));
}

function quaternionForTopValue(value: number, yaw = 0): THREE.Quaternion {
  const euler = new THREE.Euler(0, 0, 0, "XYZ");

  if (value === 2) euler.x = -Math.PI / 2;
  if (value === 3) euler.z = Math.PI / 2;
  if (value === 4) euler.z = -Math.PI / 2;
  if (value === 5) euler.x = Math.PI / 2;
  if (value === 6) euler.x = Math.PI;

  const base = new THREE.Quaternion().setFromEuler(euler);
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return yawQuat.multiply(base);
}

function applyFrameToMeshes(frame: DiceFrame, meshes: [THREE.Mesh, THREE.Mesh]) {
  for (let i = 0; i < meshes.length; i += 1) {
    const transform = frame.dice[i];
    meshes[i].position.set(transform.position.x, transform.position.y, transform.position.z);
    meshes[i].quaternion.set(
      transform.quaternion.x,
      transform.quaternion.y,
      transform.quaternion.z,
      transform.quaternion.w
    );
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function Dice() {
  const {
    state,
    rollRequestToken,
    isRolling,
    canRoll,
    requestRoll,
    onDiceRollStart,
    onDiceRollComplete,
  } = useBackgammon();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const diceMeshesRef = useRef<[THREE.Mesh, THREE.Mesh] | null>(null);
  const frameRef = useRef<number | null>(null);

  const engineRef = useRef<DicePhysicsEngine | null>(null);
  const handledRollRef = useRef(0);
  const inFlightRollRef = useRef<number | null>(null);
  const activeRollRef = useRef(0);
  const mountedRef = useRef(true);

  const [engineDetail, setEngineDetail] = useState("טוען מנוע פיזיקה...");

  const diceReadout = state.rolledDice.length === 2
    ? `${state.rolledDice[0]} ו-${state.rolledDice[1]}`
    : "עדיין אין הטלה";

  const rollLabel = state.isOpeningPhase ? "גלגול פתיחה" : "הטל קוביות (Space)";

  useEffect(() => {
    mountedRef.current = true;
    const mount = mountRef.current;
    if (!mount) return () => {
      mountedRef.current = false;
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#19130f");

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 4.9, 6.1);
    camera.lookAt(DICE_CAMERA_TARGET);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;

    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight("#ffd7a2", "#332118", 1.05);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight("#ffffff", 0.9);
    dir.position.set(4, 8, 5);
    dir.castShadow = true;
    scene.add(dir);

    const table = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.22, 8.6),
      new THREE.MeshStandardMaterial({ color: "#6b3f1e", roughness: 0.72, metalness: 0.03 })
    );
    table.position.y = -0.12;
    table.receiveShadow = true;
    scene.add(table);

    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.02, 8),
      new THREE.MeshStandardMaterial({ color: "#165a40", roughness: 0.95, metalness: 0.02 })
    );
    felt.position.y = 0.01;
    felt.receiveShadow = true;
    scene.add(felt);

    const dieGeometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);

    const createDieMesh = () => {
      const die = new THREE.Mesh(dieGeometry, createDieMaterials());
      die.castShadow = true;
      die.receiveShadow = true;
      return die;
    };

    const dieA = createDieMesh();
    const dieB = createDieMesh();

    dieA.position.set(-1.2, DIE_SIZE / 2, 0.45);
    dieB.position.set(1.2, DIE_SIZE / 2, -0.45);
    scene.add(dieA);
    scene.add(dieB);

    diceMeshesRef.current = [dieA, dieB];

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      if (width === 0 || height === 0) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const orbit = {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
      radius: 10,
      theta: 0,
      phi: 1,
    };

    {
      const offset = new THREE.Vector3().subVectors(camera.position, DICE_CAMERA_TARGET);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      orbit.radius = spherical.radius;
      orbit.theta = spherical.theta;
      orbit.phi = spherical.phi;
    }

    const updateOrbitCamera = () => {
      orbit.radius = THREE.MathUtils.clamp(orbit.radius, CAMERA_MIN_RADIUS, CAMERA_MAX_RADIUS);
      orbit.phi = THREE.MathUtils.clamp(orbit.phi, CAMERA_MIN_POLAR, CAMERA_MAX_POLAR);

      const offset = new THREE.Vector3().setFromSpherical(
        new THREE.Spherical(orbit.radius, orbit.phi, orbit.theta)
      );

      camera.position.copy(DICE_CAMERA_TARGET).add(offset);
      camera.lookAt(DICE_CAMERA_TARGET);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      orbit.active = true;
      orbit.pointerId = event.pointerId;
      orbit.lastX = event.clientX;
      orbit.lastY = event.clientY;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!orbit.active || event.pointerId !== orbit.pointerId) return;

      const deltaX = event.clientX - orbit.lastX;
      const deltaY = event.clientY - orbit.lastY;
      orbit.lastX = event.clientX;
      orbit.lastY = event.clientY;

      orbit.theta -= deltaX * ORBIT_SENSITIVITY;
      orbit.phi -= deltaY * ORBIT_SENSITIVITY;
      updateOrbitCamera();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!orbit.active || event.pointerId !== orbit.pointerId) return;

      orbit.active = false;
      orbit.pointerId = -1;
      renderer.domElement.style.cursor = "grab";

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      orbit.radius += event.deltaY * ZOOM_SENSITIVITY;
      updateOrbitCamera();
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    updateOrbitCamera();
    resize();
    window.addEventListener("resize", resize);
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(render);
    };
    frameRef.current = window.requestAnimationFrame(render);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    return () => {
      mountedRef.current = false;
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }

      renderer.dispose();
      dieGeometry.dispose();
      if (Array.isArray(dieA.material)) {
        for (const material of dieA.material) {
          material.map?.dispose();
          material.dispose();
        }
      }
      if (Array.isArray(dieB.material)) {
        for (const material of dieB.material) {
          material.map?.dispose();
          material.dispose();
        }
      }

      mount.removeChild(renderer.domElement);

      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      diceMeshesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ensureEngine = async () => {
      if (engineRef.current) return engineRef.current;
      const engine = await createPhysicsEngine();
      engineRef.current = engine;
      if (mountedRef.current) {
        setEngineDetail(engine.getStatus().detail);
      }
      return engine;
    };

    const triggerRoll = async () => {
      const requestToken = rollRequestToken;
      if (requestToken === 0) return;
      if (requestToken === handledRollRef.current) return;
      if (requestToken === inFlightRollRef.current) return;
      if (state.winner) return;
      if (state.dice.length > 0 || isRolling) return;

      inFlightRollRef.current = requestToken;
      const currentRollId = activeRollRef.current + 1;
      activeRollRef.current = currentRollId;

      onDiceRollStart();

      try {
        const engine = await ensureEngine();
        const result = await engine.throwDice((frame) => {
          if (!mountedRef.current || activeRollRef.current !== currentRollId) return;

          const meshes = diceMeshesRef.current;
          if (!meshes) return;
          applyFrameToMeshes(frame, meshes);
        });

        if (!mountedRef.current || activeRollRef.current !== currentRollId) return;

        const meshes = diceMeshesRef.current;
        if (meshes) {
          applyFrameToMeshes({ dice: result.final }, meshes);
        }

        await waitMs(POST_SETTLE_DELAY_MS);
        if (!mountedRef.current || activeRollRef.current !== currentRollId) return;

        handledRollRef.current = requestToken;
        inFlightRollRef.current = null;
        onDiceRollComplete(result.values, result.mode);
      } catch {
        if (!mountedRef.current || activeRollRef.current !== currentRollId) return;

        const fallback: [number, number] = [
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1,
        ];

        await waitMs(POST_SETTLE_DELAY_MS);
        if (!mountedRef.current || activeRollRef.current !== currentRollId) return;

        handledRollRef.current = requestToken;
        inFlightRollRef.current = null;
        onDiceRollComplete(fallback, "fallback");
      }
    };

    void triggerRoll();
  }, [isRolling, onDiceRollComplete, onDiceRollStart, rollRequestToken, state.dice.length, state.winner]);

  useEffect(() => {
    if (state.rolledDice.length !== 2) return;

    const meshes = diceMeshesRef.current;
    if (!meshes) return;

    const [dieA, dieB] = state.rolledDice;
    meshes[0].position.set(-1.2, DIE_SIZE / 2, 0.45);
    meshes[1].position.set(1.2, DIE_SIZE / 2, -0.45);

    meshes[0].quaternion.copy(quaternionForTopValue(dieA, 0.25));
    meshes[1].quaternion.copy(quaternionForTopValue(dieB, -0.35));
  }, [state.rolledDice]);

  return (
    <section className="bgm-dice" aria-label="אזור הטלת קוביות">
      <div ref={mountRef} className="bgm-dice__viewport" />
      <div className="bgm-dice__footer">
        <span className="bgm-dice__readout">קוביות: {diceReadout}</span>
        <button
          type="button"
          className="bgm-btn bgm-btn--primary bgm-dice__roll"
          onClick={requestRoll}
          disabled={!canRoll}
          title={engineDetail}
        >
          {isRolling ? "מגלגל..." : rollLabel}
        </button>
      </div>
    </section>
  );
}
