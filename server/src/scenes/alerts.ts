import type { DisplaysRepo } from '../store/displays.js';

export type FireOpts = {
  /** Optional transition descriptor id to use when switching to the alert scene. */
  explicitTransitionId?: string | null;
};

export type AlertDeps = {
  displays: DisplaysRepo;
  /** Called for both the alert push and the auto-revert push. AlertManager
   *  always sets `skipHistory: true` so `scene/last` history isn't corrupted. */
  onSceneChanged: (
    displayId: string,
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }
  ) => void;
};

export type AlertManager = {
  fire(displayId: string, sceneId: string, dwellMs: number, opts?: FireOpts): void;
  /** Returns true if there was an active alert that got canceled. */
  cancel(displayId: string): boolean;
  isActive(displayId: string): boolean;
  /** Clear all pending alert timers (used during graceful shutdown). */
  clearAll(): void;
};

const MIN_DWELL_MS = 1_000;
const MAX_DWELL_MS = 24 * 60 * 60 * 1_000; // 24h

type Active = {
  /** The scene id to restore when the dwell elapses. May be null — falls
   *  back to the display's defaultSceneId on revert. */
  revertSceneId: string | null;
  timer: ReturnType<typeof setTimeout>;
};

// Note: alert timers are in-memory only. A server restart during an active
// alert loses the timer; the display will be stuck on the alert scene until
// a manual change. Persisting alert state to SQLite is deferred until users
// report it as a real problem.
export function createAlertManager(deps: AlertDeps): AlertManager {
  const active = new Map<string, Active>();

  function clearTimerOnly(displayId: string): Active | undefined {
    const a = active.get(displayId);
    if (!a) return undefined;
    clearTimeout(a.timer);
    return a;
  }

  function fire(displayId: string, sceneId: string, dwellMs: number, opts?: FireOpts) {
    const dwell = Math.max(MIN_DWELL_MS, Math.min(MAX_DWELL_MS, dwellMs));
    // If an alert is already active: reset the timer but keep the original
    // revertSceneId — chaining alerts must NOT trap the display by saving an
    // alert scene as a future revert target.
    const existing = clearTimerOnly(displayId);
    const revertSceneId = existing
      ? existing.revertSceneId
      : (deps.displays.getById(displayId)?.currentSceneId ?? null);

    deps.displays.setCurrentScene(displayId, sceneId);
    deps.onSceneChanged(displayId, {
      skipHistory: true,
      explicitTransitionId: opts?.explicitTransitionId,
    });

    const timer = setTimeout(() => {
      active.delete(displayId);
      deps.displays.setCurrentScene(displayId, revertSceneId);
      deps.onSceneChanged(displayId, { skipHistory: true });
    }, dwell);
    active.set(displayId, { revertSceneId, timer });
  }

  function cancel(displayId: string): boolean {
    const a = active.get(displayId);
    if (!a) return false;
    clearTimeout(a.timer);
    active.delete(displayId);
    return true;
  }

  return {
    fire,
    cancel,
    isActive: (displayId) => active.has(displayId),
    clearAll: () => {
      for (const a of active.values()) clearTimeout(a.timer);
      active.clear();
    },
  };
}
