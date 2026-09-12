import { fetchCatalog as defaultFetchCatalog } from './catalog.js';
import type { AerialCatalogStore } from './store.js';
import type { AerialCatalog } from './types.js';

/** Apple ships a new bundle a few times a year; weekly is plenty. */
export const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CatalogRefresher = {
  /** Fetch unconditionally. Rejects on failure so a UI can show why. */
  refreshNow(): Promise<AerialCatalog>;
  /** Fetch only when the stored catalog is missing or older than maxAge.
   *  Never rejects: a failed background refresh keeps the old catalog and
   *  logs. Resolves true only when a new catalog was stored. */
  refreshIfStale(maxAgeMs?: number): Promise<boolean>;
};

export function createCatalogRefresher(deps: {
  store: AerialCatalogStore;
  fetchCatalog?: () => Promise<AerialCatalog>;
  now?: () => number;
  log?: (msg: string) => void;
}): CatalogRefresher {
  const now = deps.now ?? (() => Date.now());
  const doFetch = deps.fetchCatalog ?? (() => defaultFetchCatalog({ now }));
  const log = deps.log ?? ((m) => console.warn(`[aerials] ${m}`));

  // One fetch at a time: a boot-time refresh, the hourly check, and an admin
  // clicking "Refresh" all share the same download.
  let inFlight: Promise<AerialCatalog> | null = null;

  function refreshNow(): Promise<AerialCatalog> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const cat = await doFetch();
        deps.store.set(cat);
        return cat;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    refreshNow,
    async refreshIfStale(maxAgeMs = CATALOG_MAX_AGE_MS) {
      const existing = deps.store.get();
      if (existing && now() - existing.fetchedAt <= maxAgeMs) return false;
      try {
        await refreshNow();
        return true;
      } catch (err) {
        log(`catalog refresh failed; keeping ${existing ? 'the previous catalog' : 'an empty catalog'}: ${String(err)}`);
        return false;
      }
    },
  };
}
