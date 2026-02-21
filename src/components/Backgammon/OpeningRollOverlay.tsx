import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { type PlayerId } from "./utils/gameLogic";
import {
  createPhysicsEngine,
  type DicePhysicsEngine,
  type DiceTransform,
} from "./utils/physicsEngine";

const DIE_SIZE = 0.64;
const DICE_CAMERA_TARGET = new THREE.Vector3(0, 0.32, 0);

type FacePips = Record<number, Array<[number, number]>>;

type OpeningRollOverlayProps = {
  rolls: Record<PlayerId, number | null>;
  round: number;
  message: string;
  canRollWhite: boolean;
  canRollBlack: boolean;
  canReroll: boolean;
  onRollResult: (player: PlayerId, value: number, source: "physics" | "fallback") => void;
  onReroll: () => void;
  onBackToSetup: () => void;
};

type OpeningDiePanelProps = {
  player: PlayerId;
  title: string;
  value: number | null;
  canRoll: boolean;
  onRollResult: (player: PlayerId, value: number, source: "physics" | "fallback") => void;
};

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

function quaternionForTopValue(value: number): THREE.Quaternion {
  const euler = new THREE.Euler(0, 0, 0, "XYZ");

  if (value === 2) euler.x = -Math.PI / 2;
  if (value === 3) euler.z = Math.PI / 2;
  if (value === 4) euler.z = -Math.PI / 2;
  if (value === 5) euler.x = Math.PI / 2;
  if (value === 6) euler.x = Math.PI;

  return new THREE.Quaternion().setFromEuler(euler);
}

function applyTransform(mesh: THREE.Mesh, transform: DiceTransform) {
  mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
  mesh.quaternion.set(
    transform.quaternion.x,
    transform.quaternion.y,
    transform.quaternion.z,
    transform.quaternion.w
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function OpeningDiePanel({
  player,
  title,
  value,
  canRoll,
  onRollResult,
}: OpeningDiePanelProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const frameRef = useRef<number | null>(null);
  const engineRef = useRef<DicePhysicsEngine | null>(null);
  const mountedRef = useRef(true);

  const [isRolling, setIsRolling] = useState(false);
  const [engineDetail, setEngineDetail] = useState("טוען מנוע פיזיקה...");

  useEffect(() => {
    mountedRef.current = true;
    const mount = mountRef.current;
    if (!mount) return () => {
      mountedRef.current = false;
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#19130f");

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 3.9, 4.8);
    camera.lookAt(DICE_CAMERA_TARGET);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight("#ffd7a2", "#332118", 1.08);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight("#ffffff", 0.9);
    dir.position.set(3.8, 7.2, 4.1);
    dir.castShadow = true;
    scene.add(dir);

    const table = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 0.22, 6.8),
      new THREE.MeshStandardMaterial({ color: "#6b3f1e", roughness: 0.72, metalness: 0.03 })
    );
    table.position.y = -0.12;
    table.receiveShadow = true;
    scene.add(table);

    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 0.02, 6.2),
      new THREE.MeshStandardMaterial({ color: "#165a40", roughness: 0.95, metalness: 0.02 })
    );
    felt.position.y = 0.01;
    felt.receiveShadow = true;
    scene.add(felt);

    const dieGeometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    const die = new THREE.Mesh(dieGeometry, createDieMaterials());
    die.castShadow = true;
    die.receiveShadow = true;
    die.position.set(0, DIE_SIZE / 2, 0);
    scene.add(die);
    meshRef.current = die;

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const render = () => {
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    frameRef.current = window.requestAnimationFrame(render);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("resize", resize);

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }

      renderer.dispose();
      dieGeometry.dispose();
      if (Array.isArray(die.material)) {
        for (const material of die.material) {
          material.map?.dispose();
          material.dispose();
        }
      }

      mount.removeChild(renderer.domElement);
      meshRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (value === null) return;
    if (isRolling) return;

    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.set(0, DIE_SIZE / 2, 0);
    mesh.quaternion.copy(quaternionForTopValue(value));
  }, [isRolling, value]);

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;
    const engine = await createPhysicsEngine();
    engineRef.current = engine;
    if (mountedRef.current) {
      setEngineDetail(engine.getStatus().detail);
    }
    return engine;
  }, []);

  const handleRoll = useCallback(async () => {
    if (!canRoll || isRolling) return;

    setIsRolling(true);

    try {
      const engine = await ensureEngine();
      const result = await engine.throwSingleDie((frame) => {
        if (!mountedRef.current) return;
        const mesh = meshRef.current;
        if (!mesh) return;
        applyTransform(mesh, frame.die);
      });

      if (!mountedRef.current) return;
      const mesh = meshRef.current;
      if (mesh) {
        applyTransform(mesh, result.final);
      }

      await waitMs(1000);
      if (!mountedRef.current) return;
      onRollResult(player, result.value, result.mode);
    } catch {
      if (!mountedRef.current) return;
      const fallbackValue = Math.floor(Math.random() * 6) + 1;
      await waitMs(1000);
      if (!mountedRef.current) return;
      onRollResult(player, fallbackValue, "fallback");
    } finally {
      if (mountedRef.current) {
        setIsRolling(false);
      }
    }
  }, [canRoll, ensureEngine, isRolling, onRollResult, player]);

  return (
    <section className={`bgm-opening-panel is-${player}`}>
      <header className="bgm-opening-panel__header">
        <h4>{title}</h4>
        <span>תוצאה: {value ?? "-"}</span>
      </header>

      <div ref={mountRef} className="bgm-opening-panel__dice" />

      <button
        type="button"
        className="bgm-btn bgm-btn--primary"
        onClick={handleRoll}
        disabled={!canRoll || isRolling}
        title={engineDetail}
      >
        {isRolling ? "מגלגל..." : `הטל קובייה (${title})`}
      </button>
    </section>
  );
}

export default function OpeningRollOverlay({
  rolls,
  round,
  message,
  canRollWhite,
  canRollBlack,
  canReroll,
  onRollResult,
  onReroll,
  onBackToSetup,
}: OpeningRollOverlayProps) {
  return (
    <div className="bgm-opening-overlay" role="dialog" aria-modal="true" aria-label="חלון גלגול פתיחה">
      <article className="bgm-opening-overlay__card">
        <header className="bgm-opening-overlay__header">
          <h3>גלגול פתיחה</h3>
          <span>סבב {round}</span>
        </header>

        <div className="bgm-opening-overlay__split">
          <OpeningDiePanel
            player="white"
            title="לבן"
            value={rolls.white}
            canRoll={canRollWhite}
            onRollResult={onRollResult}
          />
          <OpeningDiePanel
            player="black"
            title="שחור"
            value={rolls.black}
            canRoll={canRollBlack}
            onRollResult={onRollResult}
          />
        </div>

        <p className="bgm-opening-overlay__status">{message}</p>

        <div className="bgm-opening-overlay__actions">
          <button
            type="button"
            className="bgm-btn"
            onClick={onReroll}
            disabled={!canReroll}
          >
            גלגול חוזר
          </button>
          <button
            type="button"
            className="bgm-btn"
            onClick={onBackToSetup}
          >
            הגדרות
          </button>
        </div>
      </article>
    </div>
  );
}
