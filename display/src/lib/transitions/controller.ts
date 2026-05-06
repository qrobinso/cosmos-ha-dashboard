import type { SceneState } from '../types';
import type { StageState, TransitionDescriptor } from './types';

export type StageListener = (s: StageState) => void;

/**
 * Owns the scene-to-scene transition lifecycle.
 *
 * Design notes:
 * - Out and In animations run **simultaneously**. The two layers are mounted at
 *   the same time; CSS animations on each play in parallel. Sequential phases
 *   caused a mid-transition "snap back" where the outgoing layer would flash
 *   to its default state once its `data-phase` attribute changed.
 * - The outgoing layer holds `data-phase="out"` for its entire lifetime so the
 *   `animation-fill-mode: forwards` final state stays applied until unmount.
 * - Mid-transition reschedules: if a new scene arrives while a transition is
 *   in progress, the in-progress incoming becomes the new outgoing and a fresh
 *   transition starts. The previous outgoing is dropped — it was already on
 *   its way out, so visually the user sees: "old scene faded → new scene".
 */
export class TransitionController {
  private state: StageState = {
    phase: 'idle',
    outgoingScene: null,
    incomingScene: null,
    transition: null,
  };
  private listeners = new Set<StageListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: StageListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  current(): StageState {
    return this.state;
  }

  receive(scene: SceneState, transition: TransitionDescriptor | null): void {
    // First scene of the session, or an instant swap with no transition.
    if (!transition || !this.state.incomingScene) {
      this.cancelTimer();
      this.set({ phase: 'idle', outgoingScene: null, incomingScene: scene, transition: null });
      return;
    }
    this.cancelTimer();
    this.set({
      phase: 'transitioning',
      outgoingScene: this.state.incomingScene,
      incomingScene: scene,
      transition,
    });
    // Both animations play in parallel; finish when the longer of the two ends.
    const totalMs = Math.max(transition.out.duration_ms, transition.in.duration_ms);
    this.timer = setTimeout(() => this.complete(), totalMs);
  }

  private complete(): void {
    this.timer = null;
    this.set({
      phase: 'idle',
      outgoingScene: null,
      incomingScene: this.state.incomingScene,
      transition: null,
    });
  }

  private set(next: StageState): void {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
