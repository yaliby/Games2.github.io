/**
 * Single authority for pointer lock. All lock/release goes through here.
 * - `requestLock` / `releaseLock` must be called from user gestures where required.
 * - `pointerlockchange` only reports the current lock state; it does NOT drive pause/game state.
 */

export type PointerLockListener = (locked: boolean) => void;

export class PointerLockManager {
  private canvas: HTMLCanvasElement | null = null;
  private listeners = new Set<PointerLockListener>();
  private boundHandler: (() => void) | null = null;

  setCanvas(canvas: HTMLCanvasElement | null) {
    if (this.canvas === canvas) return;
    this.removeListener();
    this.canvas = canvas;
    if (canvas) this.addListener();
  }

  private addListener() {
    this.boundHandler = () => this.onPointerLockChange();
    document.addEventListener("pointerlockchange", this.boundHandler);
  }

  private removeListener() {
    if (this.boundHandler) {
      document.removeEventListener("pointerlockchange", this.boundHandler);
      this.boundHandler = null;
    }
  }

  subscribe(fn: PointerLockListener): () => void {
    this.listeners.add(fn);
    fn(this.isLocked());
    return () => this.listeners.delete(fn);
  }

  private notify(locked: boolean) {
    for (const l of this.listeners) l(locked);
  }

  isLocked(): boolean {
    if (!this.canvas) return false;
    return document.pointerLockElement === this.canvas;
  }

  /**
   * Request pointer lock. Must be called directly from a user gesture (e.g. click on canvas).
   */
  requestLock(): void {
    if (!this.canvas) return;
    if (document.pointerLockElement === this.canvas) {
      this.notify(true);
      return;
    }
    this.canvas.requestPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Programmatically release pointer lock (e.g. when opening menus or resizing stage).
   */
  private onPointerLockChange(): void {
    const locked = this.isLocked();
    this.notify(locked);
  }

  destroy(): void {
    this.removeListener();
    this.canvas = null;
    this.listeners.clear();
  }
}
