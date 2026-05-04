import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Display = {
  id: string;
  name: string;
  lastSeen: string | null;
  defaultSceneId: string | null;
  currentSceneId: string | null;
};

export type DisplaysRepo = {
  registerByName(name: string): Display;
  list(): Display[];
  touch(id: string): void;
  getByName(name: string): Display | null;
  getById(id: string): Display | null;
  setDefaultScene(id: string, sceneId: string | null): void;
  setCurrentScene(id: string, sceneId: string | null): void;
};

type Row = {
  id: string;
  name: string;
  last_seen: string | null;
  default_scene_id: string | null;
  current_scene_id: string | null;
};

function rowToDisplay(r: Row): Display {
  return {
    id: r.id,
    name: r.name,
    lastSeen: r.last_seen,
    defaultSceneId: r.default_scene_id,
    currentSceneId: r.current_scene_id,
  };
}

const SELECT_COLS = 'id, name, last_seen, default_scene_id, current_scene_id';

export function createDisplaysRepo(db: DB): DisplaysRepo {
  const selectByName = db.prepare<[string], Row>(`SELECT ${SELECT_COLS} FROM displays WHERE name = ?`);
  const selectById = db.prepare<[string], Row>(`SELECT ${SELECT_COLS} FROM displays WHERE id = ?`);
  const insert = db.prepare('INSERT INTO displays (id, name) VALUES (?, ?)');
  const selectAll = db.prepare<[], Row>(`SELECT ${SELECT_COLS} FROM displays ORDER BY name`);
  const updateLastSeen = db.prepare('UPDATE displays SET last_seen = CURRENT_TIMESTAMP WHERE id = ?');
  const updateDefaultScene = db.prepare('UPDATE displays SET default_scene_id = ? WHERE id = ?');
  const updateCurrentScene = db.prepare('UPDATE displays SET current_scene_id = ? WHERE id = ?');

  return {
    registerByName(name) {
      const existing = selectByName.get(name);
      if (existing) return rowToDisplay(existing);
      const id = randomUUID();
      insert.run(id, name);
      return rowToDisplay(selectByName.get(name)!);
    },
    list() {
      return selectAll.all().map(rowToDisplay);
    },
    touch(id) {
      updateLastSeen.run(id);
    },
    getByName(name) {
      const r = selectByName.get(name);
      return r ? rowToDisplay(r) : null;
    },
    getById(id) {
      const r = selectById.get(id);
      return r ? rowToDisplay(r) : null;
    },
    setDefaultScene(id, sceneId) {
      updateDefaultScene.run(sceneId, id);
    },
    setCurrentScene(id, sceneId) {
      updateCurrentScene.run(sceneId, id);
    },
  };
}
