import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadCrossyAssets } from './crossyAssets';
import type { CrossyAssets } from './crossyAssets';

type GameState = 'LOADING' | 'PLAYING' | 'GAME_OVER';
type Direction = 'forward' | 'backward' | 'left' | 'right';

type ObstacleMeta = { tileIndex: number; kind: 'tree' | 'boulder' };
type VehicleMeta = { initialTileIndex: number; ref?: THREE.Object3D };
type LogMeta = { initialTileIndex: number; ref?: THREE.Object3D; modelIndex?: number };
type TrainMeta = { initialTileIndex: number; ref?: THREE.Object3D; width?: number };

type RowData =
  | { type: 'forest'; obstacles: ObstacleMeta[] }
  | { type: 'car' | 'truck'; direction: boolean; speed: number; vehicles: VehicleMeta[] }
  | { type: 'rail'; direction: boolean; speed: number; trains: TrainMeta[] }
  | { type: 'water'; direction: boolean; speed: number; logs: LogMeta[] };

const minTileIndex = -12;
const maxTileIndex = 12;
const EXTRA_RENDER_TILES_X = 12;
const renderMinTileIndex = minTileIndex - EXTRA_RENDER_TILES_X;
const renderMaxTileIndex = maxTileIndex + EXTRA_RENDER_TILES_X;
const tilesPerRow = renderMaxTileIndex - renderMinTileIndex + 1;
const tileSize = 42;
const minRowIndex = -9;
const EXTRA_RENDER_ROWS_BELOW = 0;
const renderMinRowIndex = minRowIndex - EXTRA_RENDER_ROWS_BELOW;
const BACKDROP_TILES_X = tilesPerRow + 90;
const BACKDROP_TILES_Y = 190;
const BACKDROP_Z_OFFSET = -tileSize * 0.25;
const BACKDROP_COLOR = '#4d6f35';
const grassHeight = tileSize * 0.375;
const roadHeight = tileSize * 0.25;
const waterHeight = tileSize * 0.125;
const railHeight = tileSize * 0.5;
const playerBaseRotation = Math.PI;
const LOG_MODEL_INDICES = [0, 1];
const LOG_SINK_DEPTH = tileSize * 0.4;
const LOGS_PER_WATER_ROW = 6;
const LOG_GAP = tileSize * 0.6;
const WATER_ROW_SOFT_INTERVAL = 4;
const WATER_ROW_STREAK_MAX = 2;
const WATER_ROW_MIN_GAP = 1;
const SPEED_STEP_SCORE = 50;
const SPEED_STEP_MULT = 0.25;

// Manual per-model rotation overrides (degrees). Chicken is excluded.
// - Single number = rotate around Z (yaw).
// - Object = rotate around X/Y/Z (e.g. { y: 180 } to flip on Y).
const MODEL_ROTATION = {
  grass: 0,
  road: 0,
  river: 0,
  rail: 0,
  tree: 0,
  boulder: 0,
  log: 0,
  lilyPad: 0,
  car: { y: 90,z: -90 },   // Flip על Y
  truck: { y: 90, z: -90 },  // סיבוב ימינה על Z
  train: {z: 180 },
} as const;


type RotationOverride = number | { x?: number; y?: number; z?: number };

const degToRad = (value: number) => (value * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const applyRotation = (object: THREE.Object3D, rotation?: RotationOverride) => {
  if (rotation == null) return;
  if (typeof rotation === 'number') {
    if (rotation !== 0) {
      object.rotation.z += degToRad(rotation);
    }
    return;
  }
  if (typeof rotation.x === 'number' && rotation.x !== 0) {
    object.rotation.x += degToRad(rotation.x);
  }
  if (typeof rotation.y === 'number' && rotation.y !== 0) {
    object.rotation.y += degToRad(rotation.y);
  }
  if (typeof rotation.z === 'number' && rotation.z !== 0) {
    object.rotation.z += degToRad(rotation.z);
  }
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function createCamera(width: number, height: number) {
  const size = tileSize * 10;
  const viewRatio = width / height;
  const w = viewRatio < 1 ? size : size * viewRatio;
  const h = viewRatio < 1 ? size / viewRatio : size;

  const camera = new THREE.OrthographicCamera(w / -2, w / 2, h / 2, h / -2, 1, 2000);
  camera.up.set(0, 0, 1);
  camera.zoom = 1.1;
  camera.updateProjectionMatrix();

  return camera;
}

function updateCamera(camera: THREE.OrthographicCamera, width: number, height: number) {
  const size = tileSize * 10;
  const viewRatio = width / height;
  const w = viewRatio < 1 ? size : size * viewRatio;
  const h = viewRatio < 1 ? size / viewRatio : size;
  camera.left = w / -2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = h / -2;
  camera.updateProjectionMatrix();
}

function createDirectionalLight() {
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(-100, -100, 200);
  dirLight.up.set(0, 0, 1);
  dirLight.castShadow = true;

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;

  dirLight.shadow.camera.up.set(0, 0, 1);
  dirLight.shadow.camera.left = -400;
  dirLight.shadow.camera.right = 400;
  dirLight.shadow.camera.top = 400;
  dirLight.shadow.camera.bottom = -400;
  dirLight.shadow.camera.near = 50;
  dirLight.shadow.camera.far = 400;

  return dirLight;
}

function randomElement<T>(array: T[]) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateForestMetadata(rowIndex: number): RowData {
  const occupiedTiles = new Set<number>();
  const obstacleCount = rowIndex < 3 ? 0 : 4;
  const obstacles = Array.from({ length: obstacleCount }, () => {
    let tileIndex: number;
    do {
      tileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(tileIndex));
    occupiedTiles.add(tileIndex);

    const kind: ObstacleMeta['kind'] = Math.random() < 0.25 ? 'boulder' : 'tree';
    return { tileIndex, kind };
  });

  return { type: 'forest', obstacles };
}

function generateCarLaneMetadata(): RowData {
  const direction = randomElement([true, false]);
  // Faster base speeds
  const speed = randomElement([90, 110, 125, 140]);

  const occupiedTiles = new Set<number>();
  const vehicles = Array.from({ length: 4 }, () => {
    let initialTileIndex: number;
    do {
      initialTileIndex = THREE.MathUtils.randInt(renderMinTileIndex, renderMaxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);

    return { initialTileIndex };
  });

  return { type: 'car', direction, speed, vehicles };
}

function generateTruckLaneMetadata(): RowData {
  const direction = randomElement([true, false]);
  // Faster base speeds
  const speed = randomElement([80, 95, 110, 125]);

  const occupiedTiles = new Set<number>();
  const vehicles = Array.from({ length: 3 }, () => {
    let initialTileIndex: number;
    do {
      initialTileIndex = THREE.MathUtils.randInt(renderMinTileIndex, renderMaxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 2);
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);
    occupiedTiles.add(initialTileIndex + 2);

    return { initialTileIndex };
  });

  return { type: 'truck', direction, speed, vehicles };
}

function generateRailLaneMetadata(): RowData {
  const direction = randomElement([true, false]);
  const speed = randomElement([150, 175, 200]);
  const trains: TrainMeta[] = [
    { initialTileIndex: direction ? renderMinTileIndex - 12 : renderMaxTileIndex + 12 },
  ];
  return { type: 'rail', direction, speed, trains };
}

function generateWaterLaneMetadata(): RowData {
  const direction = randomElement([true, false]);
  const speed = randomElement([60, 75, 90]);
  const logsCount = LOGS_PER_WATER_ROW;
  const spacing = randomElement([2, 3, 4]);
  const start = THREE.MathUtils.randInt(renderMinTileIndex, renderMaxTileIndex);
  const logs: LogMeta[] = Array.from({ length: logsCount }, (_, index) => {
    const offset = direction ? index * spacing : -index * spacing;
    return { initialTileIndex: start + offset };
  });

  return { type: 'water', direction, speed, logs };
}

function generateRow(
  rowIndex: number,
  previousRowType?: RowData['type'],
  waterStreak = 0,
  rowsSinceWater = 0
): RowData {
  if (rowIndex < 10) return generateForestMetadata(rowIndex);

  const roll = Math.random();
  let nextType: RowData['type'];

  if (roll < 0.15) nextType = 'forest';
  else if (roll < 0.35) nextType = 'car';
  else if (roll < 0.5) nextType = 'truck';
  else if (roll < 0.92) nextType = 'water';
  else nextType = 'rail';

  if (nextType === 'water') {
    if (waterStreak >= WATER_ROW_STREAK_MAX || rowsSinceWater <= WATER_ROW_MIN_GAP) {
      nextType = 'forest';
    }
  }
  if (previousRowType === 'rail' && nextType === 'rail') {
    nextType = 'forest';
  }
  if (rowsSinceWater >= WATER_ROW_SOFT_INTERVAL && nextType !== 'water') {
    nextType = 'water';
  }

  if (nextType === 'forest') return generateForestMetadata(rowIndex);
  if (nextType === 'car') return generateCarLaneMetadata();
  if (nextType === 'truck') return generateTruckLaneMetadata();
  if (nextType === 'rail') return generateRailLaneMetadata();
  return generateWaterLaneMetadata();
}

function generateRows(amount: number, startIndex: number, previousRowType?: RowData['type']) {
  const rows: RowData[] = [];
  let prevType = previousRowType;
  let waterStreak = prevType === 'water' ? 1 : 0;
  let rowsSinceWater = prevType === 'water' ? 0 : 2;

  for (let i = 0; i < amount; i += 1) {
    const rowIndex = startIndex + i + 1;
    const row = generateRow(rowIndex, prevType, waterStreak, rowsSinceWater);
    rows.push(row);

    if (row.type === 'water') {
      waterStreak += 1;
      rowsSinceWater = 0;
    } else {
      waterStreak = 0;
      rowsSinceWater += 1;
    }
    prevType = row.type;
  }
  return rows;
}

function calculateFinalPosition(currentPosition: { rowIndex: number; tileIndex: number }, moves: Direction[]) {
  return moves.reduce((position, direction) => {
    if (direction === 'forward')
      return {
        rowIndex: position.rowIndex + 1,
        tileIndex: position.tileIndex,
      };
    if (direction === 'backward')
      return {
        rowIndex: position.rowIndex - 1,
        tileIndex: position.tileIndex,
      };
    if (direction === 'left')
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex - 1,
      };
    if (direction === 'right')
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex + 1,
      };
    return position;
  }, currentPosition);
}

function endsUpInValidPosition(currentPosition: { rowIndex: number; tileIndex: number }, moves: Direction[], metadata: RowData[]) {
  const finalPosition = calculateFinalPosition(currentPosition, moves);

  if (
    finalPosition.rowIndex < minRowIndex ||
    finalPosition.tileIndex < minTileIndex ||
    finalPosition.tileIndex > maxTileIndex
  ) {
    return false;
  }

  const finalRow = metadata[finalPosition.rowIndex - 1];
  if (
    finalRow &&
    finalRow.type === 'forest' &&
    finalRow.obstacles.some((obstacle) => obstacle.tileIndex === finalPosition.tileIndex)
  ) {
    return false;
  }

  return true;
}

export default function CrossyRoadGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [gameState, setGameState] = useState<GameState>('LOADING');
  const [isLoading, setIsLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  const gameStateRef = useRef<GameState>('LOADING');
  const bestScoreRef = useRef(0);
  const scoreRef = useRef(0);
  const startGameRef = useRef<() => void>(() => {});
  const moveRef = useRef<(direction: Direction) => void>(() => {});
  const assetsRef = useRef<CrossyAssets | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const stored = Number(localStorage.getItem('crossyBestScore') ?? 0);
    if (!Number.isNaN(stored)) {
      bestScoreRef.current = stored;
      setBestScore(stored);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    setIsLoading(true);
    setGameState('LOADING');
    gameStateRef.current = 'LOADING';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1a2e');

    const backdropGeometry = new THREE.PlaneGeometry(
      BACKDROP_TILES_X * tileSize,
      BACKDROP_TILES_Y * tileSize
    );
    const backdropMaterial = new THREE.MeshLambertMaterial({ color: BACKDROP_COLOR });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.position.set(0, 0, BACKDROP_Z_OFFSET);
    backdrop.receiveShadow = true;
    scene.add(backdrop);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const map = new THREE.Group();
    scene.add(map);

    const player = new THREE.Group();
    const playerModel = new THREE.Group();
    player.add(playerModel);
    scene.add(player);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight = createDirectionalLight();
    dirLight.target = player;
    player.add(dirLight);

    const camera = createCamera(container.clientWidth, container.clientHeight);
    scene.add(camera);
    const cameraOffset = new THREE.Vector3(-tileSize * 1.2, -tileSize * 2.9, tileSize * 2.8);
    const cameraTargetOffset = new THREE.Vector3(0, tileSize * 2, 0);

    const metadata: RowData[] = [];
    const rowMeshes = new Map<number, THREE.Group>();
    const position = { currentRow: 0, currentTile: 0 };
    const movesQueue: Direction[] = [];
    const moveClock = new THREE.Clock(false);
    const clock = new THREE.Clock();
    let ridingLog: { rowIndex: number; log: THREE.Object3D; offset: number } | null = null;
    let activeMove:
      | {
          fromX: number;
          fromY: number;
          toX: number;
          toY: number;
          fromRotation: number;
          toRotation: number;
        }
      | null = null;
    let cancelled = false;

    const cloneAsset = <T extends THREE.Object3D>(asset: T) => {
      const clone = asset.clone(true) as T;
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry = child.geometry.clone();
          if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => material.clone());
          } else {
            child.material = child.material.clone();
          }
        }
      });
      return clone;
    };

    const buildPlayerModel = (assets: CrossyAssets) => {
      playerModel.clear();
      const model = cloneAsset(assets.chicken);
      playerModel.add(model);
    };

    const buildRoadBase = (assets: CrossyAssets, isFirstLane: boolean) => {
      return cloneAsset(isFirstLane ? assets.road.striped : assets.road.blank);
    };

    const buildTrain = (assets: CrossyAssets, middleCount: number) => {
      const train = new THREE.Group();
      const front = cloneAsset(assets.train.front);
      const middle = cloneAsset(assets.train.middle);
      const back = cloneAsset(assets.train.back);

      const getWidth = (object: THREE.Object3D) => {
        const box = new THREE.Box3().setFromObject(object);
        const size = new THREE.Vector3();
        box.getSize(size);
        return size.x;
      };

      const frontWidth = getWidth(front);
      const middleWidth = getWidth(middle);
      const backWidth = getWidth(back);

      let offset = 0;
      front.position.x = offset;
      train.add(front);
      offset += frontWidth;

      for (let i = 0; i < middleCount; i += 1) {
        const segment = cloneAsset(assets.train.middle);
        segment.position.x = offset;
        train.add(segment);
        offset += middleWidth;
      }

      back.position.x = offset;
      train.add(back);
      offset += backWidth;

      train.position.x = -offset / 2;
      return train;
    };

    const disposeMap = () => {
      map.children.forEach((child) => disposeObject(child));
      map.clear();
      rowMeshes.clear();
    };

    const createGrassRow = (rowIndex: number, assets: CrossyAssets) => {
      const row = new THREE.Group();
      row.position.y = rowIndex * tileSize;
      const base = rowIndex % 2 === 0 ? assets.grass.light : assets.grass.dark;
      const mesh = cloneAsset(base);
      applyRotation(mesh, MODEL_ROTATION.grass);
      row.add(mesh);
      return row;
    };

    const createRoadRow = (rowIndex: number, assets: CrossyAssets, isFirstLane: boolean) => {
      const row = new THREE.Group();
      row.position.y = rowIndex * tileSize;
      const mesh = buildRoadBase(assets, isFirstLane);
      applyRotation(mesh, MODEL_ROTATION.road);
      row.add(mesh);
      return row;
    };

    const createWaterRow = (rowIndex: number, assets: CrossyAssets) => {
      const row = new THREE.Group();
      row.position.y = rowIndex * tileSize;
      const mesh = cloneAsset(assets.river);
      applyRotation(mesh, MODEL_ROTATION.river);
      row.add(mesh);
      return row;
    };

    const createRailRow = (rowIndex: number, assets: CrossyAssets) => {
      const row = new THREE.Group();
      row.position.y = rowIndex * tileSize;
      const mesh = cloneAsset(assets.railroad);
      applyRotation(mesh, MODEL_ROTATION.rail);
      row.add(mesh);
      return row;
    };

    const initializeMap = () => {
      const assets = assetsRef.current;
      if (!assets) return;
      metadata.length = 0;
      disposeMap();

      for (let rowIndex = 0; rowIndex >= renderMinRowIndex; rowIndex -= 1) {
        const row = createGrassRow(rowIndex, assets);
        map.add(row);
        rowMeshes.set(rowIndex, row);
      }
      addRows();
    };

    const addRows = () => {
      const assets = assetsRef.current;
      if (!assets) return;
      const startIndex = metadata.length;
      const previousType = startIndex > 0 ? metadata[startIndex - 1].type : undefined;
      const newMetadata = generateRows(20, startIndex, previousType);
      metadata.push(...newMetadata);

      newMetadata.forEach((rowData, index) => {
        const rowIndex = startIndex + index + 1;
        const previousRowType = startIndex + index > 0 ? metadata[startIndex + index - 1].type : undefined;

        if (rowData.type === 'forest') {
          const row = createGrassRow(rowIndex, assets);
          rowData.obstacles.forEach((obstacle) => {
            const base = obstacle.kind === 'boulder' ? randomElement(assets.boulders) : randomElement(assets.trees);
            const mesh = cloneAsset(base);
            mesh.position.x = obstacle.tileIndex * tileSize;
            mesh.position.z = grassHeight;
            applyRotation(mesh, obstacle.kind === 'boulder' ? MODEL_ROTATION.boulder : MODEL_ROTATION.tree);
            row.add(mesh);
          });
          map.add(row);
          rowMeshes.set(rowIndex, row);
        }

        if (rowData.type === 'car') {
          const isFirstLane = previousRowType !== 'car' && previousRowType !== 'truck';
          const row = createRoadRow(rowIndex, assets, isFirstLane);
          rowData.vehicles.forEach((vehicle) => {
            const car = cloneAsset(assets.cars[0]);
            car.position.x = vehicle.initialTileIndex * tileSize;
            car.position.z = roadHeight;
            car.rotation.y = rowData.direction ? 0 : Math.PI;
            applyRotation(car, MODEL_ROTATION.car);
            vehicle.ref = car;
            row.add(car);
          });
          map.add(row);
          rowMeshes.set(rowIndex, row);
        }

        if (rowData.type === 'truck') {
          const isFirstLane = previousRowType !== 'car' && previousRowType !== 'truck';
          const row = createRoadRow(rowIndex, assets, isFirstLane);
          rowData.vehicles.forEach((vehicle) => {
            const truck = cloneAsset(assets.trucks[0]);
            truck.position.x = vehicle.initialTileIndex * tileSize;
            truck.position.z = roadHeight;
            truck.rotation.y = rowData.direction ? 0 : Math.PI;
            applyRotation(truck, MODEL_ROTATION.truck);
            vehicle.ref = truck;
            row.add(truck);
          });
          map.add(row);
          rowMeshes.set(rowIndex, row);
        }

        if (rowData.type === 'water') {
          const row = createWaterRow(rowIndex, assets);
          const availableLogIndices = LOG_MODEL_INDICES.filter(
            (index) => index >= 0 && index < assets.logs.length
          );
          let previousLength = 0;
          let cursorX = (rowData.logs[0]?.initialTileIndex ?? 0) * tileSize;
          const gap = LOG_GAP;

          rowData.logs.forEach((log, index) => {
            const logModelIndex =
              availableLogIndices.length > 0 ? randomElement(availableLogIndices) : 0;
            const mesh = cloneAsset(assets.logs[logModelIndex]);
            mesh.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(mesh);
            const size = new THREE.Vector3();
            box.getSize(size);
            const length = size.x || Math.max(size.x, size.y, size.z);

            if (index === 0) {
              cursorX = log.initialTileIndex * tileSize;
            } else {
              const distance = previousLength / 2 + length / 2 + gap;
              cursorX += rowData.direction ? distance : -distance;
            }

            mesh.position.x = cursorX;
            mesh.position.z = waterHeight - LOG_SINK_DEPTH;
            applyRotation(mesh, MODEL_ROTATION.log);
            log.ref = mesh;
            log.modelIndex = logModelIndex;
            row.add(mesh);
            previousLength = length;
          });
          map.add(row);
          rowMeshes.set(rowIndex, row);
        }

        if (rowData.type === 'rail') {
          const row = createRailRow(rowIndex, assets);
          rowData.trains.forEach((trainMeta) => {
            const train = buildTrain(assets, randomElement([1, 2]));
            const trainBox = new THREE.Box3().setFromObject(train);
            const size = new THREE.Vector3();
            trainBox.getSize(size);
            trainMeta.width = size.x;
            train.position.x = trainMeta.initialTileIndex * tileSize;
            train.position.z = railHeight;
            train.rotation.z = rowData.direction ? 0 : Math.PI;
            applyRotation(train, MODEL_ROTATION.train);
            trainMeta.ref = train;
            row.add(train);
          });
          map.add(row);
          rowMeshes.set(rowIndex, row);
        }
      });
    };

    const pruneRows = () => {
      const minKeep = position.currentRow - 30;
      rowMeshes.forEach((row, rowIndex) => {
        if (rowIndex < minKeep) {
          map.remove(row);
          disposeObject(row);
          rowMeshes.delete(rowIndex);
        }
      });
    };

    const initializePlayer = () => {
      player.position.set(0, 0, grassHeight + tileSize * 0.05);
      playerModel.position.set(0, 0, 0);
      playerModel.rotation.z = playerBaseRotation;
      position.currentRow = 0;
      position.currentTile = 0;
      movesQueue.length = 0;
      ridingLog = null;
      moveClock.stop();
      moveClock.elapsedTime = 0;
      activeMove = null;
    };

    const stepCompleted = () => {
      const direction = movesQueue.shift();
      if (!direction) return;

      if (direction === 'forward') position.currentRow += 1;
      if (direction === 'backward') position.currentRow -= 1;
      if (direction === 'left') position.currentTile -= 1;
      if (direction === 'right') position.currentTile += 1;

      player.position.x = position.currentTile * tileSize;
      player.position.y = position.currentRow * tileSize;

      if (position.currentRow > metadata.length - 10) addRows();
      pruneRows();

      if (position.currentRow > scoreRef.current) {
        scoreRef.current = position.currentRow;
        setScore(scoreRef.current);
      }
    };

    const setGameOver = () => {
      if (gameStateRef.current === 'GAME_OVER') return;
      gameStateRef.current = 'GAME_OVER';
      setGameState('GAME_OVER');
      setFinalScore(position.currentRow);

      if (position.currentRow > bestScoreRef.current) {
        bestScoreRef.current = position.currentRow;
        setBestScore(position.currentRow);
        localStorage.setItem('crossyBestScore', String(position.currentRow));
      }

      movesQueue.length = 0;
      ridingLog = null;
      activeMove = null;
      moveClock.stop();
    };

    const queueMove = (direction: Direction) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const isValid = endsUpInValidPosition(
        { rowIndex: position.currentRow, tileIndex: position.currentTile },
        [...movesQueue, direction],
        metadata
      );
      if (!isValid) return;
      movesQueue.push(direction);
    };

    moveRef.current = queueMove;

    const animatePlayer = () => {
      if (gameStateRef.current !== 'PLAYING') return;

      if (!movesQueue.length) {
        activeMove = null;
        if (moveClock.running) moveClock.stop();
        return;
      }

      if (!moveClock.running || !activeMove) {
        const direction = movesQueue[0];
        const fromX = player.position.x;
        const fromY = player.position.y;
        const snapTile = Math.round(fromX / tileSize);
        const snapX = snapTile * tileSize;
        let toX = fromX;
        let toY = fromY;
        let toRotation = playerBaseRotation;

        if (direction === 'left') {
          toX = snapX - tileSize;
          toRotation = playerBaseRotation + Math.PI / 2;
        }
        if (direction === 'right') {
          toX = snapX + tileSize;
          toRotation = playerBaseRotation - Math.PI / 2;
        }
        if (direction === 'forward') {
          toX = snapX;
          toY += tileSize;
          toRotation = playerBaseRotation;
        }
        if (direction === 'backward') {
          toX = snapX;
          toY -= tileSize;
          toRotation = playerBaseRotation + Math.PI;
        }

        activeMove = {
          fromX,
          fromY,
          toX,
          toY,
          fromRotation: playerModel.rotation.z,
          toRotation,
        };
        ridingLog = null;
        moveClock.start();
      }

      if (!activeMove) return;

      // IMPROVED: Faster animation (reduced from 0.2 to 0.14 for snappier movement)
      const stepTime = 0.14;
      const progress = Math.min(1, moveClock.getElapsedTime() / stepTime);

      player.position.x = THREE.MathUtils.lerp(activeMove.fromX, activeMove.toX, progress);
      player.position.y = THREE.MathUtils.lerp(activeMove.fromY, activeMove.toY, progress);
      playerModel.position.z = Math.sin(progress * Math.PI) * 8;
      playerModel.rotation.z = THREE.MathUtils.lerp(
        activeMove.fromRotation,
        activeMove.toRotation,
        progress
      );

      if (progress >= 1) {
        player.position.x = activeMove.toX;
        player.position.y = activeMove.toY;
        playerModel.position.z = 0;
        playerModel.rotation.z = activeMove.toRotation;
        activeMove = null;
        moveClock.stop();
        stepCompleted();
      }
    };

    const animateVehicles = (delta: number) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const speedTier = Math.floor(scoreRef.current / SPEED_STEP_SCORE);
      const difficulty = 1 + speedTier * SPEED_STEP_MULT;

      metadata.forEach((rowData) => {
        if (rowData.type === 'car' || rowData.type === 'truck') {
          const beginningOfRow = (renderMinTileIndex - 2) * tileSize;
          const endOfRow = (renderMaxTileIndex + 2) * tileSize;

          rowData.vehicles.forEach(({ ref }) => {
            if (!ref) return;
            const move = rowData.speed * difficulty * delta;
            if (rowData.direction) {
              ref.position.x = ref.position.x > endOfRow ? beginningOfRow : ref.position.x + move;
            } else {
              ref.position.x = ref.position.x < beginningOfRow ? endOfRow : ref.position.x - move;
            }
          });
        }

        if (rowData.type === 'water') {
          const beginningOfRow = (renderMinTileIndex - 2) * tileSize;
          const endOfRow = (renderMaxTileIndex + 2) * tileSize;
          rowData.logs.forEach(({ ref }) => {
            if (!ref) return;
            const move = rowData.speed * difficulty * delta;
            if (rowData.direction) {
              const nextX = ref.position.x + move;
              if (nextX > endOfRow) {
                if (ridingLog?.log === ref) {
                  setGameOver();
                }
                ref.position.x = beginningOfRow;
              } else {
                ref.position.x = nextX;
              }
            } else {
              const nextX = ref.position.x - move;
              if (nextX < beginningOfRow) {
                if (ridingLog?.log === ref) {
                  setGameOver();
                }
                ref.position.x = endOfRow;
              } else {
                ref.position.x = nextX;
              }
            }

            if (ridingLog?.log === ref && !moveClock.running) {
              player.position.x += rowData.direction ? move : -move;
            }
          });
        }

        if (rowData.type === 'rail') {
          rowData.trains.forEach(({ ref, width }) => {
            if (!ref) return;
            const trainWidth = width ?? tileSize * 6;
            const beginningOfRow = (renderMinTileIndex - 2) * tileSize - trainWidth;
            const endOfRow = (renderMaxTileIndex + 2) * tileSize + trainWidth;
            const move = rowData.speed * difficulty * delta;
            if (rowData.direction) {
              ref.position.x = ref.position.x > endOfRow ? beginningOfRow : ref.position.x + move;
            } else {
              ref.position.x = ref.position.x < beginningOfRow ? endOfRow : ref.position.x - move;
            }
          });
        }
      });

      if (ridingLog && !moveClock.running) {
        if (position.currentRow !== ridingLog.rowIndex) {
          ridingLog = null;
        } else {
          position.currentTile = Math.round(player.position.x / tileSize);
          const minX = (minTileIndex - 0.5) * tileSize;
          const maxX = (maxTileIndex + 0.5) * tileSize;
          if (player.position.x < minX || player.position.x > maxX) {
            setGameOver();
          }
        }
      }
    };

    const hitTest = () => {
      if (gameStateRef.current !== 'PLAYING') return;
      const row = metadata[position.currentRow - 1];
      if (!row || row.type !== 'water') {
        ridingLog = null;
      }
      if (!row) return;

      if (row.type === 'car' || row.type === 'truck') {
        // IMPROVED: More forgiving collision detection
        // Create a smaller player bounding box (70% of actual size)
        player.updateMatrixWorld(true);
        const playerBoundingBox = new THREE.Box3().setFromObject(playerModel);
        const playerSize = playerBoundingBox.getSize(new THREE.Vector3());
        const shrinkAmount = 0.15; // 15% shrink on each side = 30% total reduction
        
        playerBoundingBox.min.x += playerSize.x * shrinkAmount;
        playerBoundingBox.min.y += playerSize.y * shrinkAmount;
        playerBoundingBox.max.x -= playerSize.x * shrinkAmount;
        playerBoundingBox.max.y -= playerSize.y * shrinkAmount;

        row.vehicles.forEach(({ ref }) => {
          if (!ref) return;
          const vehicleBoundingBox = new THREE.Box3().setFromObject(ref);
          
          // Also shrink vehicle hitbox slightly for extra mercy
          const vehicleSize = vehicleBoundingBox.getSize(new THREE.Vector3());
          const vehicleShrink = 0.05; // 5% shrink
          
          vehicleBoundingBox.min.x += vehicleSize.x * vehicleShrink;
          vehicleBoundingBox.min.y += vehicleSize.y * vehicleShrink;
          vehicleBoundingBox.max.x -= vehicleSize.x * vehicleShrink;
          vehicleBoundingBox.max.y -= vehicleSize.y * vehicleShrink;
          
          if (playerBoundingBox.intersectsBox(vehicleBoundingBox)) {
            setGameOver();
          }
        });
      }

      if (row.type === 'rail') {
        player.updateMatrixWorld(true);
        const playerBoundingBox = new THREE.Box3().setFromObject(playerModel);
        const playerSize = playerBoundingBox.getSize(new THREE.Vector3());
        const shrinkAmount = 0.1;
        playerBoundingBox.min.x += playerSize.x * shrinkAmount;
        playerBoundingBox.min.y += playerSize.y * shrinkAmount;
        playerBoundingBox.max.x -= playerSize.x * shrinkAmount;
        playerBoundingBox.max.y -= playerSize.y * shrinkAmount;

        row.trains.forEach(({ ref }) => {
          if (!ref) return;
          const trainBoundingBox = new THREE.Box3().setFromObject(ref);
          if (playerBoundingBox.intersectsBox(trainBoundingBox)) {
            setGameOver();
          }
        });
      }

      if (row.type === 'water') {
        if (movesQueue.length || moveClock.running) return;
        const playerX = player.position.x;

        const hitLog = row.logs.find(({ ref }) => {
          if (!ref) return false;
          ref.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(ref);
          const size = new THREE.Vector3();
          box.getSize(size);
          const half = size.x / 2;
          return playerX > ref.position.x - half && playerX < ref.position.x + half;
        });

        if (hitLog?.ref) {
          ridingLog = {
            rowIndex: position.currentRow,
            log: hitLog.ref,
            offset: playerX - hitLog.ref.position.x,
          };
        } else {
          ridingLog = null;
          setGameOver();
        }
      }
    };

    const startGame = () => {
      if (!assetsRef.current) return;
      scoreRef.current = 0;
      setScore(0);
      setFinalScore(0);
      gameStateRef.current = 'PLAYING';
      setGameState('PLAYING');
      initializePlayer();
      initializeMap();
    };

    startGameRef.current = startGame;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && gameStateRef.current === 'GAME_OVER') {
        event.preventDefault();
        startGame();
        return;
      }

      if (gameStateRef.current !== 'PLAYING') return;

      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        queueMove('forward');
      } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault();
        queueMove('backward');
      } else if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault();
        queueMove('left');
      } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault();
        queueMove('right');
      }
    };

    window.addEventListener('keydown', onKeyDown);

    const applyContainerSize = () => {
      const header = document.querySelector('header');
      const footer = document.querySelector('footer');
      const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
      const footerHeight = footer instanceof HTMLElement ? footer.offsetHeight : 0;
      const availableHeight = window.innerHeight - headerHeight - footerHeight;
      if (availableHeight > 0) {
        container.style.height = `${availableHeight}px`;
      }
    };

    const resize = () => {
      applyContainerSize();
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      updateCamera(camera, rect.width, rect.height);
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver) {
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();

    const loadAssets = async () => {
      try {
        const assets = await loadCrossyAssets({ tileSize, tilesPerRow });
        if (cancelled) return;
        assetsRef.current = assets;
        buildPlayerModel(assets);
        setIsLoading(false);
        startGame();
      } catch (error) {
        console.error('Failed to load Crossy Road assets.', error);
        if (cancelled) return;
        setIsLoading(false);
        gameStateRef.current = 'GAME_OVER';
        setGameState('GAME_OVER');
      }
    };

    loadAssets();

    const updateCameraFollow = () => {
      let targetX = player.position.x + cameraTargetOffset.x;
      let targetY = player.position.y + cameraTargetOffset.y;
      let targetZ = player.position.z + cameraTargetOffset.z;

      const mapMinX = renderMinTileIndex * tileSize - tileSize / 2;
      const mapMaxX = renderMaxTileIndex * tileSize + tileSize / 2;
      const viewHalfWidth = (camera.right - camera.left) / (2 * camera.zoom);
      const minCameraX = mapMinX + viewHalfWidth;
      const maxCameraX = mapMaxX - viewHalfWidth;

      let cameraX = targetX + cameraOffset.x;
      if (minCameraX <= maxCameraX) {
        cameraX = clamp(cameraX, minCameraX, maxCameraX);
      } else {
        cameraX = (mapMinX + mapMaxX) / 2;
      }
      targetX = cameraX - cameraOffset.x;

      const mapMinY = renderMinRowIndex * tileSize - tileSize / 2;
      const viewHalfHeight = (camera.top - camera.bottom) / (2 * camera.zoom);
      const minCameraY = mapMinY + viewHalfHeight;

      let cameraY = targetY + cameraOffset.y;
      if (cameraY < minCameraY) {
        cameraY = minCameraY;
        targetY = cameraY - cameraOffset.y;
      }

      let cameraZ = targetZ + cameraOffset.z;
      const minCameraZ = viewHalfHeight;
      if (cameraZ < minCameraZ) {
        cameraZ = minCameraZ;
        targetZ = cameraZ - cameraOffset.z;
      }

      camera.position.set(cameraX, cameraY, cameraZ);
      camera.lookAt(targetX, targetY, targetZ);

      backdrop.position.x = targetX;
      backdrop.position.y = targetY;
    };

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      animatePlayer();
      animateVehicles(delta);
      hitTest();
      updateCameraFollow();
      renderer.render(scene, camera);
    });

    return () => {
      cancelled = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('keydown', onKeyDown);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', resize);
      }
      disposeMap();
      renderer.dispose();
      backdropGeometry.dispose();
      backdropMaterial.dispose();
    };
  }, []);

  const css = `
@import url("https://fonts.googleapis.com/css?family=Press+Start+2P");
.crossy-wrapper {
  position: relative;
  width: min(720px, 94vw);
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  background: #1a1a2e;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  border: 2px solid #0f3460;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Press Start 2P", cursive;
}
.crossy-wrapper canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.crossy-wrapper #score {
  position: absolute;
  top: 20px;
  left: 20px;
  font-size: 2em;
  color: white;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
  pointer-events: none;
}
.crossy-wrapper #result-container {
  position: absolute;
  min-width: 100%;
  min-height: 100%;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  visibility: hidden;
}
.crossy-wrapper #result-container.visible {
  visibility: visible;
}
.crossy-wrapper #result {
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: white;
  padding: 20px;
  color: #111;
  gap: 10px;
}
.crossy-wrapper #result h2 {
  margin: 0;
  color: #e94560;
}
.crossy-wrapper #result-container button {
  background-color: red;
  padding: 20px 50px;
  font-family: inherit;
  font-size: 0.9em;
  cursor: pointer;
  border: none;
  color: white;
}
.crossy-wrapper .loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 20, 0.75);
  color: white;
  font-size: 12px;
  letter-spacing: 1px;
  z-index: 5;
}
`;

  return (
    <div ref={containerRef} className={`crossy-wrapper${isLoading ? ' is-loading' : ''}`}>
      <style>{css}</style>
      <canvas ref={canvasRef} className="game" />

      <div id="score">Score: {score}</div>
      {isLoading ? <div className="loading">Loading assets...</div> : null}

      <div id="result-container" className={gameState === 'GAME_OVER' ? 'visible' : ''}>
        <div id="result">
          <h2>Game Over!</h2>
          <div>Score: {finalScore}</div>
          <div>Best: {bestScore}</div>
          <button onClick={() => startGameRef.current()}>Play Again</button>
        </div>
      </div>
    </div>
  );
}
