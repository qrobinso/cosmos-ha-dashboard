import type { CalendarEvent, EntityState, StatisticsPoint } from '../scenes/types.js';

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
  /** Fetch calendar events from a `calendar.*` entity over a time window. */
  getCalendarEvents(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<CalendarEvent[]>;
  /** Fetch state history for a single entity over a time window. */
  getHistory(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<StatisticsPoint[]>;
  /** Disconnect cleanly. */
  close(): Promise<void>;
};
