import type { DB } from './db.js';
import type { TransitionDescriptor } from '../transitions/types.js';

export type TransitionsRepo = {
  list(): TransitionDescriptor[];
  getById(id: string): TransitionDescriptor | null;
  getByName(name: string): TransitionDescriptor | null;
};

export type OverridesRepo = {
  get(fromSceneId: string, toSceneId: string): string | null;
  set(fromSceneId: string, toSceneId: string, transitionId: string): void;
  clear(fromSceneId: string, toSceneId: string): void;
};

type TRow = { id: string; name: string; descriptor_json: string };

function rowToTransition(r: TRow): TransitionDescriptor {
  return JSON.parse(r.descriptor_json) as TransitionDescriptor;
}

export function createTransitionsRepo(db: DB): TransitionsRepo {
  const all = db.prepare<[], TRow>('SELECT id, name, descriptor_json FROM transitions ORDER BY name');
  const byId = db.prepare<[string], TRow>('SELECT id, name, descriptor_json FROM transitions WHERE id = ?');
  const byName = db.prepare<[string], TRow>('SELECT id, name, descriptor_json FROM transitions WHERE name = ?');
  return {
    list() {
      return all.all().map(rowToTransition);
    },
    getById(id) {
      const r = byId.get(id);
      return r ? rowToTransition(r) : null;
    },
    getByName(name) {
      const r = byName.get(name);
      return r ? rowToTransition(r) : null;
    },
  };
}

export function createOverridesRepo(db: DB): OverridesRepo {
  const select = db.prepare<[string, string], { transition_id: string }>(
    'SELECT transition_id FROM scene_transition_overrides WHERE from_scene_id = ? AND to_scene_id = ?'
  );
  const upsert = db.prepare(
    `INSERT INTO scene_transition_overrides (from_scene_id, to_scene_id, transition_id)
     VALUES (?, ?, ?)
     ON CONFLICT(from_scene_id, to_scene_id) DO UPDATE SET transition_id = excluded.transition_id`
  );
  const remove = db.prepare(
    'DELETE FROM scene_transition_overrides WHERE from_scene_id = ? AND to_scene_id = ?'
  );
  return {
    get(fromSceneId, toSceneId) {
      const r = select.get(fromSceneId, toSceneId);
      return r ? r.transition_id : null;
    },
    set(fromSceneId, toSceneId, transitionId) {
      upsert.run(fromSceneId, toSceneId, transitionId);
    },
    clear(fromSceneId, toSceneId) {
      remove.run(fromSceneId, toSceneId);
    },
  };
}
