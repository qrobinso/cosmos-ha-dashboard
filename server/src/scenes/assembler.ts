import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData, ScenePushPayload } from './types.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import type { EntityState } from './types.js';
import { MOCK_WEATHER, mockEntity } from './mockData.js';

export type EntityResolver = (entityId: string) => EntityState | Promise<EntityState>;

export const mockEntityResolver: EntityResolver = (entityId) => mockEntity(entityId);

async function dataFor(widget: Widget, resolver: EntityResolver): Promise<WidgetData> {
  switch (widget.kind) {
    case 'clock':
      return null;
    case 'weather':
      return MOCK_WEATHER;
    case 'entity_tile': {
      const entityId = String((widget.config as { entity_id?: string }).entity_id ?? '');
      return await resolver(entityId);
    }
  }
}

export async function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number },
  resolver: EntityResolver = mockEntityResolver
): Promise<SceneState> {
  const widgets: WidgetState[] = [];
  for (const w of scene.widgets) {
    widgets.push({ ...w, data: await dataFor(w, resolver) });
  }
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    defaultTransitionId: scene.defaultTransitionId,
    floatWidgets: scene.floatWidgets,
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
  resolver?: EntityResolver;
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

export async function assemblePush(args: AssemblePushArgs): Promise<ScenePushPayload> {
  const state = await buildSceneState(args.scene, args.safeArea, args.resolver);
  const transition = resolveTransition(args);
  return transition ? { type: 'scene', state, transition } : { type: 'scene', state };
}
