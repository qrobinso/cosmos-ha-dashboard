import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAlertManager, type AlertDeps } from '../src/scenes/alerts.js';
import type { Display, DisplaysRepo, Orientation, Rotation } from '../src/store/displays.js';

// Fake displays repo backed by a Map — only the methods AlertManager uses.
function fakeDisplays(): DisplaysRepo & { _set(id: string, sceneId: string | null): void } {
  const byId = new Map<string, Display>();
  byId.set('disp1', {
    id: 'disp1',
    name: 'Living',
    lastSeen: null,
    defaultSceneId: 'default-scene',
    currentSceneId: 'sceneA',
    rotation: null,
    orientation: 'landscape',
  });
  return {
    registerByName: () => { throw new Error('unused'); },
    list: () => Array.from(byId.values()),
    touch: () => undefined,
    getByName: (n) => Array.from(byId.values()).find((d) => d.name === n) ?? null,
    getById: (id) => byId.get(id) ?? null,
    setDefaultScene: () => undefined,
    setCurrentScene: (id, sceneId) => {
      const d = byId.get(id);
      if (d) byId.set(id, { ...d, currentSceneId: sceneId });
    },
    setRotation: (_id, _r: Rotation | null) => undefined,
    setOrientation: (_id, _o: Orientation) => undefined,
    delete: () => undefined,
    _set: (id, sceneId) => {
      const d = byId.get(id);
      if (d) byId.set(id, { ...d, currentSceneId: sceneId });
    },
  };
}

describe('AlertManager', () => {
  let displays: ReturnType<typeof fakeDisplays>;
  let onSceneChangedCalls: {
    displayId: string;
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null };
  }[];
  let deps: AlertDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    displays = fakeDisplays();
    onSceneChangedCalls = [];
    deps = {
      displays,
      onSceneChanged: (displayId, opts) => { onSceneChangedCalls.push({ displayId, opts }); },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snapshots current scene as the revert target and pushes the alert scene', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 5000);
    expect(displays.getById('disp1')?.currentSceneId).toBe('alertScene');
    expect(onSceneChangedCalls).toEqual([
      { displayId: 'disp1', opts: { skipHistory: true, explicitTransitionId: undefined } },
    ]);
    expect(m.isActive('disp1')).toBe(true);
  });

  it('reverts to the saved scene when dwell expires', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 5000);
    onSceneChangedCalls.length = 0;
    vi.advanceTimersByTime(5000);
    expect(displays.getById('disp1')?.currentSceneId).toBe('sceneA');
    expect(onSceneChangedCalls).toEqual([
      { displayId: 'disp1', opts: { skipHistory: true } },
    ]);
    expect(m.isActive('disp1')).toBe(false);
  });

  it('chained fire while active resets timer but preserves original revert target', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertA', 10_000);
    vi.advanceTimersByTime(3000);
    m.fire('disp1', 'alertB', 4000); // should NOT capture alertA as the new revert
    expect(displays.getById('disp1')?.currentSceneId).toBe('alertB');
    vi.advanceTimersByTime(4000);
    expect(displays.getById('disp1')?.currentSceneId).toBe('sceneA');
  });

  it('reverts to null when no scene was set at fire time', () => {
    displays._set('disp1', null);
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 1000);
    vi.advanceTimersByTime(1000);
    expect(displays.getById('disp1')?.currentSceneId).toBeNull();
  });

  it('cancel clears timer and returns true when an alert was active', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 5000);
    onSceneChangedCalls.length = 0;
    expect(m.cancel('disp1')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(onSceneChangedCalls).toEqual([]); // no revert
    expect(m.isActive('disp1')).toBe(false);
  });

  it('cancel returns false when nothing was active', () => {
    const m = createAlertManager(deps);
    expect(m.cancel('disp1')).toBe(false);
  });

  it('clamps dwellMs below floor to 1000', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 100); // below 1000 floor
    vi.advanceTimersByTime(999);
    expect(m.isActive('disp1')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(m.isActive('disp1')).toBe(false);
  });

  it('passes explicitTransitionId to the alert push', () => {
    const m = createAlertManager(deps);
    m.fire('disp1', 'alertScene', 5000, { explicitTransitionId: 'cross-fade' });
    expect(onSceneChangedCalls[0]?.opts?.explicitTransitionId).toBe('cross-fade');
  });
});
