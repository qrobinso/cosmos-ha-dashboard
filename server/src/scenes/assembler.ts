import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData } from './types.js';
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

export function buildSceneState(scene: Scene): SceneState {
  const widgets: WidgetState[] = scene.widgets.map((w) => ({ ...w, data: dataFor(w) }));
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    widgets,
  };
}
