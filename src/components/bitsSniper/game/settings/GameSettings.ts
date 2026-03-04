export type GameSettings = {
  lookSensitivity: number;
  adsSensitivity: number;
  masterVolume: number;
  selectedMapId: string | null;
  /** Indices into WEAPONS array that bots are allowed to use (e.g. [0,1,2,3] = all). */
  botWeaponPool: number[];
  /** Spawn point index for bots (0–3). Must differ from player spawn. */
  botSpawnIdx: number;
};

const STORAGE_KEY = "shell-strikers:settings:v2";

export function getDefaultSettings(): GameSettings {
  return {
    lookSensitivity: 0.0022,
    adsSensitivity: 1.0,
    masterVolume: 1.0,
    selectedMapId: null,
    botWeaponPool: [0, 1, 2, 3],
    botSpawnIdx: 1,
  };
}

export function loadSettingsFromStorage(): GameSettings {
  if (typeof window === "undefined") return getDefaultSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultSettings();
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const merged = { ...getDefaultSettings(), ...parsed };
    if (!Array.isArray(merged.botWeaponPool) || merged.botWeaponPool.length === 0) merged.botWeaponPool = getDefaultSettings().botWeaponPool;
    if (typeof merged.botSpawnIdx !== "number" || merged.botSpawnIdx < 0 || merged.botSpawnIdx > 3) merged.botSpawnIdx = getDefaultSettings().botSpawnIdx;
    return merged;
  } catch {
    return getDefaultSettings();
  }
}

export function saveSettingsToStorage(settings: GameSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / privacy failures
  }
}

