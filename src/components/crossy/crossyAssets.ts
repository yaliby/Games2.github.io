import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const BASE = `${import.meta.env.BASE_URL}crossy/models`;

const env = (path: string) => `${BASE}/environment/${path}`;
const vehicle = (path: string) => `${BASE}/vehicles/${path}`;
const character = (path: string) => `${BASE}/characters/${path}`;

type LoadOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  transparent?: boolean;
  rotateFor2D?: boolean;
};

const objLoader = new OBJLoader();
const textureLoader = new THREE.TextureLoader();

const applyShadow = (object: THREE.Object3D, castShadow: boolean, receiveShadow: boolean) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });
};

const normalizeObject = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);
  object.position.z -= box.min.z;
};

const scalePlane = (object: THREE.Object3D, width: number, depth: number) => {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const planeWidth = size.x || 1;
  const planeDepth = Math.max(size.y, size.z) || 1;
  const scaleX = width / planeWidth;
  const scaleY = depth / planeDepth;
  object.scale.set(scaleX, scaleY, scaleY);
  normalizeObject(object);
};

const alignLengthToX = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > size.x) {
    object.rotation.z += Math.PI / 2;
    normalizeObject(object);
  }
};

const scaleByUnit = (object: THREE.Object3D, unitScale: number) => {
  object.scale.setScalar(unitScale);
  normalizeObject(object);
};

const scaleLongestSideToSize = (object: THREE.Object3D, targetSize: number) => {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / longest;
  object.scale.setScalar(scale);
  normalizeObject(object);
};

const loadObjWithTexture = async (objUrl: string, textureUrl: string, options: LoadOptions = {}) => {
  const [object, texture] = await Promise.all([
    objLoader.loadAsync(objUrl),
    textureLoader.loadAsync(textureUrl),
  ]);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  const material = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: options.transparent ?? true,
  });

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = material;
    }
  });

  if (options.rotateFor2D ?? true) {
    object.rotation.x = Math.PI / 2;
  }

  applyShadow(object, options.castShadow ?? true, options.receiveShadow ?? true);
  normalizeObject(object);
  return object;
};

export type CrossyAssets = {
  grass: { light: THREE.Group; dark: THREE.Group };
  road: { striped: THREE.Group; blank: THREE.Group };
  river: THREE.Group;
  railroad: THREE.Group;
  lilyPad: THREE.Group;
  logs: THREE.Group[];
  trees: THREE.Group[];
  boulders: THREE.Group[];
  cars: THREE.Group[];
  trucks: THREE.Group[];
  train: { front: THREE.Group; middle: THREE.Group; back: THREE.Group };
  chicken: THREE.Group;
};

export const loadCrossyAssets = async ({
  tileSize,
  tilesPerRow,
}: {
  tileSize: number;
  tilesPerRow: number;
}): Promise<CrossyAssets> => {
  const rowWidth = tilesPerRow * tileSize;

  const [
    grassLight,
    grassDark,
    roadStriped,
    roadBlank,
    river,
    railroad,
    lilyPad,
    log0,
    log1,
    log2,
    log3,
    tree0,
    tree1,
    tree2,
    tree3,
    boulder0,
    boulder1,
    carBlue,
    carGreen,
    carOrange,
    carPolice,
    carPurple,
    carTaxi,
    truckBlue,
    truckRed,
    trainFront,
    trainMiddle,
    trainBack,
    chicken,
  ] = await Promise.all([
    loadObjWithTexture(env('grass/model.obj'), env('grass/light-grass.png')),
    loadObjWithTexture(env('grass/model.obj'), env('grass/dark-grass.png')),
    loadObjWithTexture(env('road/model.obj'), env('road/stripes-texture.png')),
    loadObjWithTexture(env('road/model.obj'), env('road/blank-texture.png')),
    loadObjWithTexture(env('river/0.obj'), env('river/0.png')),
    loadObjWithTexture(env('railroad/0.obj'), env('railroad/0.png')),
    loadObjWithTexture(env('lily_pad/0.obj'), env('lily_pad/0.png')),
    loadObjWithTexture(env('log/0/0.obj'), env('log/0/0.png')),
    loadObjWithTexture(env('log/1/0.obj'), env('log/1/0.png')),
    loadObjWithTexture(env('log/2/0.obj'), env('log/2/0.png')),
    loadObjWithTexture(env('log/3/0.obj'), env('log/3/0.png')),
    loadObjWithTexture(env('tree/0/0.obj'), env('tree/0/0.png')),
    loadObjWithTexture(env('tree/1/0.obj'), env('tree/1/0.png')),
    loadObjWithTexture(env('tree/2/0.obj'), env('tree/2/0.png')),
    loadObjWithTexture(env('tree/3/0.obj'), env('tree/3/0.png')),
    loadObjWithTexture(env('boulder/0/0.obj'), env('boulder/0/0.png')),
    loadObjWithTexture(env('boulder/1/0.obj'), env('boulder/1/0.png')),
    loadObjWithTexture(vehicle('blue_car/0.obj'), vehicle('blue_car/0.png')),
    loadObjWithTexture(vehicle('green_car/0.obj'), vehicle('green_car/0.png')),
    loadObjWithTexture(vehicle('orange_car/0.obj'), vehicle('orange_car/0.png')),
    loadObjWithTexture(vehicle('police_car/0.obj'), vehicle('police_car/0.png')),
    loadObjWithTexture(vehicle('purple_car/0.obj'), vehicle('purple_car/0.png')),
    loadObjWithTexture(vehicle('taxi/0.obj'), vehicle('taxi/0.png')),
    loadObjWithTexture(vehicle('blue_truck/0.obj'), vehicle('blue_truck/0.png')),
    loadObjWithTexture(vehicle('red_truck/0.obj'), vehicle('red_truck/0.png')),
    loadObjWithTexture(vehicle('train/front/0.obj'), vehicle('train/front/0.png')),
    loadObjWithTexture(vehicle('train/middle/0.obj'), vehicle('train/middle/0.png')),
    loadObjWithTexture(vehicle('train/back/0.obj'), vehicle('train/back/0.png')),
    loadObjWithTexture(character('chicken/0.obj'), character('chicken/0.png')),
  ]);

  scalePlane(grassLight, rowWidth, tileSize);
  scalePlane(grassDark, rowWidth, tileSize);
  scalePlane(roadStriped, rowWidth, tileSize);
  scalePlane(roadBlank, rowWidth, tileSize);
  scalePlane(river, rowWidth, tileSize);
  scalePlane(railroad, rowWidth, tileSize);
  scaleByUnit(lilyPad, tileSize);

  [log0, log1, log2, log3].forEach((log) => scaleByUnit(log, tileSize));
  [tree0, tree1, tree2, tree3].forEach((tree) => scaleByUnit(tree, tileSize));
  [boulder0, boulder1].forEach((boulder) => scaleByUnit(boulder, tileSize));

  [carBlue, carGreen, carOrange, carPolice, carPurple, carTaxi].forEach((car) =>
    scaleByUnit(car, tileSize)
  );
  [carBlue, carGreen, carOrange, carPolice, carPurple, carTaxi].forEach((car) =>
    alignLengthToX(car)
  );
  [truckBlue, truckRed].forEach((truck) => {
    scaleByUnit(truck, tileSize);
    alignLengthToX(truck);
  });

  [trainFront, trainMiddle, trainBack].forEach((train) => scaleByUnit(train, tileSize));

  scaleLongestSideToSize(chicken, tileSize);

  return {
    grass: { light: grassLight, dark: grassDark },
    road: { striped: roadStriped, blank: roadBlank },
    river,
    railroad,
    lilyPad,
    logs: [log0, log1, log2, log3],
    trees: [tree0, tree1, tree2, tree3],
    boulders: [boulder0, boulder1],
    cars: [carBlue, carGreen, carOrange, carPolice, carPurple, carTaxi],
    trucks: [truckBlue, truckRed],
    train: { front: trainFront, middle: trainMiddle, back: trainBack },
    chicken,
  };
};
