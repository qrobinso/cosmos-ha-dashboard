import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import { createEntityCache } from './cache.js';

/** A fake HA client backed by the entity cache. Tests seed it with `set()` and emit changes with `emit()`. */
export type FakeHaClient = HaClient & {
  set(entity: EntityState): void;
  setMany(entities: EntityState[]): void;
  emit(entity: EntityState): void;
};

export function createFakeHaClient(initial: EntityState[] = []): FakeHaClient {
  const cache = createEntityCache();
  cache.setMany(initial);
  return {
    ready: async () => {},
    getEntity: (id) => cache.get(id),
    onStateChanged: (h) => cache.onChange(h),
    close: async () => {},
    set: (e) => cache.set(e),
    setMany: (es) => cache.setMany(es),
    emit: (e) => cache.emitChange(e),
  };
}
