import type { GameEvent } from "./GameStateManager";

type Listener = (ev: GameEvent) => void;

/**
 * Simple in-memory event bus used to decouple UI, state manager and systems.
 */
export class GameEventBus {
  private listeners = new Set<Listener>();

  emit(ev: GameEvent) {
    for (const l of this.listeners) l(ev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

