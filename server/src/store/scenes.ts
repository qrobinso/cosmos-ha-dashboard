import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; speed: 'slow' | 'medium' | 'fast'; style: 'mesh' | 'linear' | 'radial' };
export type Typography = { font_family: string; font_scale: number };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile';

export type Widget = {
  id: string;
  kind: WidgetKind;
  position: Position;
  config: Record<string, unknown>;
};

export type Scene = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  widgets: Widget[];
};

export type SceneInput = Omit<Scene, 'id' | 'widgets'> & {
  widgets: Omit<Widget, 'id'>[];
};

export type ScenesRepo = {
  create(input: SceneInput): Scene;
  get(id: string): Scene | null;
  list(): Scene[];
  update(id: string, input: SceneInput): Scene;
  delete(id: string): void;
  assignToDisplay(sceneId: string, displayId: string): void;
  unassignFromDisplay(sceneId: string, displayId: string): void;
  listAssignedTo(displayId: string): Scene[];
};

type SceneRow = {
  id: string;
  name: string;
  layout_json: string;
  background_json: string;
  typography_json: string;
};
type WidgetRow = {
  id: string;
  scene_id: string;
  kind: string;
  position_json: string;
  config_json: string;
};

function rowToScene(s: SceneRow, widgets: Widget[]): Scene {
  return {
    id: s.id,
    name: s.name,
    layout: JSON.parse(s.layout_json),
    background: JSON.parse(s.background_json),
    typography: JSON.parse(s.typography_json),
    widgets,
  };
}

function rowToWidget(r: WidgetRow): Widget {
  return {
    id: r.id,
    kind: r.kind as WidgetKind,
    position: JSON.parse(r.position_json),
    config: JSON.parse(r.config_json),
  };
}

export function createScenesRepo(db: DB): ScenesRepo {
  const insertScene = db.prepare(
    'INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)'
  );
  const updateScene = db.prepare(
    "UPDATE scenes SET name = ?, layout_json = ?, background_json = ?, typography_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const deleteScene = db.prepare('DELETE FROM scenes WHERE id = ?');
  const selectSceneById = db.prepare<[string], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json FROM scenes WHERE id = ?'
  );
  const selectAllScenes = db.prepare<[], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json FROM scenes ORDER BY name'
  );
  const insertWidget = db.prepare(
    'INSERT INTO widgets (id, scene_id, kind, position_json, config_json) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteWidgetsForScene = db.prepare('DELETE FROM widgets WHERE scene_id = ?');
  const selectWidgetsForScene = db.prepare<[string], WidgetRow>(
    'SELECT id, scene_id, kind, position_json, config_json FROM widgets WHERE scene_id = ?'
  );
  const insertAssignment = db.prepare(
    'INSERT OR IGNORE INTO scenes_displays (scene_id, display_id) VALUES (?, ?)'
  );
  const deleteAssignment = db.prepare(
    'DELETE FROM scenes_displays WHERE scene_id = ? AND display_id = ?'
  );
  const selectAssignedScenes = db.prepare<[string], SceneRow>(
    `SELECT s.id, s.name, s.layout_json, s.background_json, s.typography_json
     FROM scenes s
     JOIN scenes_displays sd ON sd.scene_id = s.id
     WHERE sd.display_id = ?
     ORDER BY s.name`
  );

  function loadWidgets(sceneId: string): Widget[] {
    return selectWidgetsForScene.all(sceneId).map(rowToWidget);
  }

  function writeWidgets(sceneId: string, ws: SceneInput['widgets']): Widget[] {
    deleteWidgetsForScene.run(sceneId);
    const out: Widget[] = [];
    for (const w of ws) {
      const id = randomUUID();
      insertWidget.run(id, sceneId, w.kind, JSON.stringify(w.position), JSON.stringify(w.config));
      out.push({ id, kind: w.kind, position: w.position, config: w.config });
    }
    return out;
  }

  function persist(input: SceneInput, sceneId: string, isUpdate: boolean): Scene {
    db.exec('BEGIN');
    try {
      const layout_json = JSON.stringify(input.layout);
      const background_json = JSON.stringify(input.background);
      const typography_json = JSON.stringify(input.typography);
      if (isUpdate) {
        updateScene.run(input.name, layout_json, background_json, typography_json, sceneId);
      } else {
        insertScene.run(sceneId, input.name, layout_json, background_json, typography_json);
      }
      const widgets = writeWidgets(sceneId, input.widgets);
      db.exec('COMMIT');
      return {
        id: sceneId,
        name: input.name,
        layout: input.layout,
        background: input.background,
        typography: input.typography,
        widgets,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    create(input) {
      return persist(input, randomUUID(), false);
    },
    get(id) {
      const row = selectSceneById.get(id);
      if (!row) return null;
      return rowToScene(row, loadWidgets(id));
    },
    list() {
      return selectAllScenes.all().map((row) => rowToScene(row, loadWidgets(row.id)));
    },
    update(id, input) {
      const existing = selectSceneById.get(id);
      if (!existing) throw new Error(`scene ${id} not found`);
      return persist(input, id, true);
    },
    delete(id) {
      deleteScene.run(id);
    },
    assignToDisplay(sceneId, displayId) {
      insertAssignment.run(sceneId, displayId);
    },
    unassignFromDisplay(sceneId, displayId) {
      deleteAssignment.run(sceneId, displayId);
    },
    listAssignedTo(displayId) {
      return selectAssignedScenes.all(displayId).map((row) => rowToScene(row, loadWidgets(row.id)));
    },
  };
}
