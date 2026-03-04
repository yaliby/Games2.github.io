import * as THREE from "three";

export type SpawnPointKind = "player" | "bot";

export interface SpawnPoint {
  id: string;
  kind: SpawnPointKind;
  position: THREE.Vector3;
  yaw: number;
}

export interface SpawnManagerConfig {
  playerHeight: number;
  botHeight: number;
}

/**
 * Lightweight SpawnManager that owns spawn points and
 * exposes simple queries for initial spawns / respawns.
 * The concrete Player/Bot creation is handled by the caller.
 */
export class SpawnManager {
  private readonly cfg: SpawnManagerConfig;
  private points: SpawnPoint[] = [];

  constructor(config: SpawnManagerConfig) {
    this.cfg = config;
  }

  getConfig(): SpawnManagerConfig {
    return this.cfg;
  }

  setSpawnPoints(points: SpawnPoint[]) {
    this.points = points.slice();
  }

  clear() {
    this.points = [];
  }

  getInitialPlayerSpawn(): SpawnPoint | null {
    const playerPoints = this.points.filter((p) => p.kind === "player");
    if (playerPoints.length === 0) return null;
    return playerPoints[0];
  }

  getRespawnPlayerSpawn(seed: number): SpawnPoint | null {
    const playerPoints = this.points.filter((p) => p.kind === "player");
    if (playerPoints.length === 0) return null;
    const idx = Math.abs(seed) % playerPoints.length;
    return playerPoints[idx];
  }

  getBotSpawn(seed: number): SpawnPoint | null {
    const botPoints = this.points.filter((p) => p.kind === "bot");
    if (botPoints.length === 0) {
      // Fallback to player spawns if אין ספאונים יעודיים לבוטים.
      return this.getRespawnPlayerSpawn(seed);
    }
    const idx = Math.abs(seed) % botPoints.length;
    return botPoints[idx];
  }
}

