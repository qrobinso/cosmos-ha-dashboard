import type { EntityState } from '../scenes/types.js';

export type { EntityState };

export type StateChangedHandler = (entity: EntityState) => void;

export type HaClient = {
  /** Resolve once the initial state snapshot is loaded. */
  ready(): Promise<void>;
  /** Look up an entity from the local cache; returns null if unknown. */
  getEntity(entityId: string): EntityState | null;
  /** Return all entities currently in the cache. */
  listEntities(): EntityState[];
  /** Subscribe to incremental state changes. Returns an unsubscribe function. */
  onStateChanged(handler: StateChangedHandler): () => void;
  /** Disconnect cleanly. */
  close(): Promise<void>;
};
