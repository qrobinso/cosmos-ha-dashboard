import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData, ScenePushPayload } from './types.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { MOCK_WEATHER, mockEntity } from './mockData.js';

function dataFor(widget: Widget): WidgetData {
  switch (widget.kind) {
    case 'clock':
      return null;
    case 'weather':
      return MOCK_WEATHER;
    case 'entity_tile': {
      const entityId = String((widget.config as { entity_id?: string }).entity_id ?? '');
      return mockEntity(entityId);
    }
  }
}

export function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number }
): SceneState {
  const widgets: WidgetState[] = scene.widgets.map((w) => ({ ...w, data: dataFor(w) }));
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    defaultTransitionId: scene.defaultTransitionId,
    widgets,
    safeArea,
  };
}

export type AssemblePushArgs = {
  scene: Scene;
  safeArea: { top: number; right: number; bottom: number; left: number };
  previousSceneId: string | null;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  explicitTransitionId?: string | null;
};

export function resolveTransition(args: AssemblePushArgs): TransitionDescriptor | null {
  if (args.previousSceneId === null) return null;
  if (args.previousSceneId === args.scene.id) return null;
  if (args.explicitTransitionId) {
    return args.transitions.getById(args.explicitTransitionId);
  }
  const overrideId = args.overrides.get(args.previousSceneId, args.scene.id);
  if (overrideId) return args.transitions.getById(overrideId);
  if (args.scene.defaultTransitionId) return args.transitions.getById(args.scene.defaultTransitionId);
  return null;
}

export function assemblePush(args: AssemblePushArgs): ScenePushPayload {
  const state = buildSceneState(args.scene, args.safeArea);
  const transition = resolveTransition(args);
  return transition ? { type: 'scene', state, transition } : { type: 'scene', state };
}
