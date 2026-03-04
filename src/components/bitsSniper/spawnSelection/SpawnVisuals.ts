/**
 * In-game floor indicators for spawn points (world positions from spawn selection UI).
 * Creates a SpawnVisualGroup with rings on the floor; exact 1:1 world coordinates.
 */
import * as THREE from "three";

const FLOOR_OFFSET = 0.02;
const RING_INNER = 0.4;
const RING_OUTER = 1.0;
const PLAYER_COLOR = 0x22c0e8;
const ENEMY_COLOR = 0xe84a4a;

export type GetFloorY = (x: number, z: number) => number;

export interface CreateSpawnVisualsOptions {
  debug?: boolean;
}

/**
 * Creates a group containing floor rings for each player and enemy spawn.
 * Uses world coordinates only. Caller must add group to scene and dispose on cleanup.
 */
export function createSpawnVisualGroup(
  playerSpawns: THREE.Vector3[],
  botSpawns: THREE.Vector3[],
  getFloorY: GetFloorY,
  options: CreateSpawnVisualsOptions = {}
): THREE.Group {
  const { debug = false } = options;
  const group = new THREE.Group();
  group.name = "SpawnVisualGroup";

  const playerMat = new THREE.MeshBasicMaterial({
    color: PLAYER_COLOR,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const enemyMat = new THREE.MeshBasicMaterial({
    color: ENEMY_COLOR,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 32);

  playerSpawns.forEach((pos, i) => {
    const floorY = getFloorY(pos.x, pos.z);
    const y = floorY + FLOOR_OFFSET;

    const mesh = new THREE.Mesh(ringGeo, playerMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, y, pos.z);
    mesh.name = `spawn-player-${i}`;
    group.add(mesh);

    if (debug) {
      const axes = new THREE.AxesHelper(1.2);
      axes.position.set(pos.x, y + 0.5, pos.z);
      group.add(axes);
      console.log(`[SpawnVisual] Player ${i} world position:`, { x: pos.x, y: floorY, z: pos.z });
    }
  });

  botSpawns.forEach((pos, i) => {
    const floorY = getFloorY(pos.x, pos.z);
    const y = floorY + FLOOR_OFFSET;

    const mesh = new THREE.Mesh(ringGeo, enemyMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, y, pos.z);
    mesh.name = `spawn-enemy-${i}`;
    group.add(mesh);

    if (debug) {
      const axes = new THREE.AxesHelper(1.2);
      axes.position.set(pos.x, y + 0.5, pos.z);
      group.add(axes);
      console.log(`[SpawnVisual] Enemy ${i} world position:`, { x: pos.x, y: floorY, z: pos.z });
    }
  });

  group.userData.ringGeo = ringGeo;
  group.userData.playerMat = playerMat;
  group.userData.enemyMat = enemyMat;

  return group;
}

/** Call when removing the group from scene to dispose geometry and materials. */
export function disposeSpawnVisualGroup(group: THREE.Group): void {
  const geo = group.userData.ringGeo as THREE.BufferGeometry | undefined;
  const playerMat = group.userData.playerMat as THREE.Material | undefined;
  const enemyMat = group.userData.enemyMat as THREE.Material | undefined;
  geo?.dispose();
  playerMat?.dispose();
  enemyMat?.dispose();
  group.clear();
}
