import type { EntityState, StateChangedHandler } from './types.js';

export type EntityCache = {
  set(entity: EntityState): void;
  setMany(entities: EntityState[]): void;
  get(entityId: string): EntityState | null;
  list(): EntityState[];
  emitChange(entity: EntityState): void;
  onChange(handler: StateChangedHandler): () => void;
};

export function createEntityCache(): EntityCache {
  const map = new Map<string, EntityState>();
  const handlers = new Set<StateChangedHandler>();
  return {
    set(entity) {
      map.set(entity.entity_id, entity);
    },
    setMany(entities) {
      for (const e of entities) map.set(e.entity_id, e);
    },
    get(entityId) {
      return map.get(entityId) ?? null;
    },
    list() {
      return Array.from(map.values());
    },
    emitChange(entity) {
      map.set(entity.entity_id, entity);
      for (const h of handlers) h(entity);
    },
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
