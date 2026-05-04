import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
} from 'home-assistant-js-websocket';
import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import { createEntityCache } from './cache.js';

export type HaConfig = {
  url: string;       // e.g. http://homeassistant.local:8123
  token: string;     // long-lived access token
};

export async function makeHaClient(config: HaConfig): Promise<HaClient> {
  const cache = createEntityCache();
  const auth = createLongLivedTokenAuth(config.url, config.token);
  let connection: Connection | null = null;

  let readyResolve!: () => void;
  const readyPromise = new Promise<void>((r) => (readyResolve = r));
  let firstSnapshotReceived = false;

  connection = await createConnection({ auth });

  const unsubscribe = subscribeEntities(connection, (entities) => {
    const list: EntityState[] = Object.values(entities).map((e) => ({
      entity_id: e.entity_id,
      state: String(e.state),
      attributes: { ...e.attributes },
    }));
    cache.setMany(list);
    if (!firstSnapshotReceived) {
      firstSnapshotReceived = true;
      readyResolve();
    } else {
      // emit per-entity changes — subscribeEntities re-fires the whole map every time
      // but we only want subscribers to see what actually changed. Cheap approach:
      // emit every entity in the snapshot; downstream handlers can de-dup.
      for (const e of list) cache.emitChange(e);
    }
  });

  return {
    ready: () => readyPromise,
    getEntity: (id) => cache.get(id),
    listEntities: () => cache.list(),
    onStateChanged: (h: StateChangedHandler) => cache.onChange(h),
    close: async () => {
      unsubscribe();
      connection?.close();
    },
  };
}
