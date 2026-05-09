import type { DisplaysRepo } from '../store/displays.js';
import type { Scene, ScenesRepo } from '../store/scenes.js';
import type { CanvasExtrasStore } from '../api/canvases.js';

/** Entities a scene reads beyond its widgets — used to decide whether an
 *  HA state change should trigger a reactive re-push. Currently:
 *   - `sun.sun`: read by the mood engine's time strategy AND by sun-adaptive
 *     gradient backgrounds.
 *   - the configured weather entity: read by the mood engine's weather
 *     strategy.
 */
export function sceneAmbientEntityIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  if (scene.mood?.enabled) {
    if (scene.mood.strategy === 'time') ids.add('sun.sun');
    if (scene.mood.strategy === 'weather' && scene.mood.weatherEntity) ids.add(scene.mood.weatherEntity);
  }
  if (scene.background.type === 'gradient' && scene.background.sun_adaptive) {
    ids.add('sun.sun');
  }
  return ids;
}

export interface InterestSetDeps {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  canvasExtras: CanvasExtrasStore;
}

export interface InterestSet {
  has(entityId: string): boolean;
  recompute(): void;
  size(): number;
}

export function createInterestSet(deps: InterestSetDeps): InterestSet {
  let set = new Set<string>();

  function recompute(): void {
    const next = new Set<string>();
    for (const d of deps.displays.list()) {
      const activeId = d.currentSceneId ?? d.defaultSceneId;
      if (!activeId) continue;
      const scene = deps.scenes.get(activeId);
      if (!scene) continue;
      for (const w of scene.widgets) {
        const id = (w.config as { entity_id?: string }).entity_id;
        if (typeof id === 'string') next.add(id);
      }
      for (const id of sceneAmbientEntityIds(scene)) next.add(id);
      const sceneHasCanvas = scene.widgets.some((w) => w.kind === 'canvas');
      if (sceneHasCanvas) {
        for (const id of deps.canvasExtras.entitiesForDisplay(d.name)) next.add(id);
      }
    }
    set = next;
  }

  return {
    has: (entityId) => set.has(entityId),
    recompute,
    size: () => set.size,
  };
}
