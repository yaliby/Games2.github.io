import type { GameSettings } from "../settings/GameSettings.ts";

export type GameStateId =
  | "Boot"
  | "Loading"
  | "MainMenu"
  | "ModeSelect"
  | "MapSelect"
  | "MatchLoading"
  | "InGame"
  | "Paused"
  | "MatchEnd";

export type GameEvent =
  | { type: "BootCompleted" }
  | { type: "CoreAssetsLoaded" }
  | { type: "StartGameClicked" }
  | { type: "BackToMenuClicked" }
  | { type: "OpenSettings" }
  | { type: "CloseSettings" }
  | { type: "ModeChosen"; modeId: string }
  | { type: "MapChosen"; mapId: string }
  | { type: "StartMatch" }
  | { type: "MatchAssetsReady" }
  | { type: "PausePressed" }
  | { type: "ResumePressed" }
  | { type: "MatchEnded" }
  | { type: "Rematch" }
  | { type: "SettingsApplied"; settings: GameSettings };

export interface GameStateSnapshot {
  id: GameStateId;
  /** last non-transient menu state for "Back" navigations */
  lastMenuState: GameStateId | null;
  selectedModeId: string | null;
  selectedMapId: string | null;
  settings: GameSettings;
}

type Listener = (state: GameStateSnapshot) => void;

/**
 * Central finite-state-machine for the game flow.
 * No React, no Three.js – just pure state + events.
 */
export class GameStateManager {
  private state: GameStateSnapshot;
  private listeners = new Set<Listener>();

  constructor(initialSettings: GameSettings) {
    this.state = {
      id: "Boot",
      lastMenuState: null,
      selectedModeId: null,
      selectedMapId: null,
      settings: initialSettings,
    };
  }

  getSnapshot(): GameStateSnapshot {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dispatch(ev: GameEvent) {
    const prev = this.state;
    let next = prev;

    switch (prev.id) {
      case "Boot":
        if (ev.type === "BootCompleted") {
          next = { ...prev, id: "Loading" };
        }
        break;

      case "Loading":
        if (ev.type === "CoreAssetsLoaded") {
          next = { ...prev, id: "MainMenu", lastMenuState: "MainMenu" };
        }
        break;

      case "MainMenu":
        if (ev.type === "StartGameClicked") {
          next = { ...prev, id: "ModeSelect", lastMenuState: "MainMenu" };
        } else if (ev.type === "StartMatch") {
          next = { ...prev, id: "MatchLoading" };
        } else if (ev.type === "OpenSettings") {
          next = prev;
        }
        break;

      case "ModeSelect":
        if (ev.type === "ModeChosen") {
          next = { ...prev, selectedModeId: ev.modeId };
        }
        if (ev.type === "ModeChosen" || ev.type === "StartGameClicked") {
          // אחרי בחירת מוד אפשר לעבור למפת בחירה.
          next = { ...next, id: "MapSelect", lastMenuState: "ModeSelect" };
        } else if (ev.type === "BackToMenuClicked") {
          next = { ...prev, id: "MainMenu", lastMenuState: "MainMenu" };
        }
        break;

      case "MapSelect":
        if (ev.type === "MapChosen") {
          next = { ...prev, selectedMapId: ev.mapId };
        }
        if (ev.type === "StartMatch") {
          next = { ...prev, id: "MatchLoading" };
        } else if (ev.type === "BackToMenuClicked") {
          next = { ...prev, id: "ModeSelect", lastMenuState: "ModeSelect" };
        }
        break;

      case "MatchLoading":
        if (ev.type === "MatchAssetsReady") {
          next = { ...prev, id: "InGame" };
        } else if (ev.type === "BackToMenuClicked") {
          next = { ...prev, id: "MainMenu", lastMenuState: "MainMenu" };
        }
        break;

      case "InGame":
        if (ev.type === "PausePressed") {
          next = { ...prev, id: "Paused" };
        } else if (ev.type === "MatchEnded") {
          next = { ...prev, id: "MatchEnd" };
        }
        break;

      case "Paused":
        if (ev.type === "ResumePressed" || ev.type === "PausePressed") {
          next = { ...prev, id: "InGame" };
        } else if (ev.type === "BackToMenuClicked") {
          next = { ...prev, id: "MainMenu", lastMenuState: "MainMenu" };
        }
        break;

      case "MatchEnd":
        if (ev.type === "Rematch") {
          next = { ...prev, id: "MatchLoading" };
        } else if (ev.type === "BackToMenuClicked") {
          next = { ...prev, id: "MainMenu", lastMenuState: "MainMenu" };
        }
        break;
    }

    if (ev.type === "SettingsApplied") {
      next = { ...next, settings: ev.settings };
    }

    if (next !== prev) {
      this.state = next;
      for (const l of this.listeners) l(this.state);
    }
  }
}

