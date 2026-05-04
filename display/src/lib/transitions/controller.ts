import type { SceneState } from '../types';
import type { StageState, TransitionDescriptor } from './types';

export type StageListener = (s: StageState) => void;

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
    if (!transition || !this.state.incomingScene) {
      // First scene of the session, OR an instant swap (no transition).
      this.set({ phase: 'idle', outgoingScene: null, incomingScene: scene, transition: null });
      return;
    }
    if (transition && this.shouldReduceMotion()) {
      transition = REDUCED_MOTION_TRANSITION;
    }
    // Begin Out phase: keep outgoing visible, animate it out
    this.cancelTimer();
    this.set({
      phase: 'out',
      outgoingScene: this.state.incomingScene,
      incomingScene: scene,
      transition,
    });
    this.timer = setTimeout(() => this.advanceToBridge(), transition.out.duration_ms);
  }

  private advanceToBridge(): void {
    if (!this.state.transition) return;
    this.set({ ...this.state, phase: 'bridge' });
    // Bridge is essentially zero-duration in v1; immediately advance to In.
    this.timer = setTimeout(() => this.advanceToIn(), 16);
  }

  private advanceToIn(): void {
    if (!this.state.transition) return;
    this.set({ ...this.state, phase: 'in' });
    this.timer = setTimeout(() => this.complete(), this.state.transition.in.duration_ms);
  }

  private complete(): void {
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

  private shouldReduceMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }
}

export const REDUCED_MOTION_TRANSITION: TransitionDescriptor = {
  id: 'reduced-motion-fallback',
  name: 'reduced-motion',
  out: { keyframes: 'cosmos-out-fade', duration_ms: 100, easing: 'linear' },
  bridge: { background_morph: false },
  in: { keyframes: 'cosmos-in-fade', duration_ms: 100, easing: 'linear' },
};
