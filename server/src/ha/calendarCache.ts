import type { CalendarEvent } from '../scenes/types.js';

/** Default TTL for cached calendar windows. Mirrors the weather-forecast cache
 *  added in 0.6.1 — long enough to absorb a canvas calling on a tick, short
 *  enough that "events I added in the past hour" surface within the window. */
export const DEFAULT_CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;

export type CalendarFetcher = (
  entityId: string,
  opts: { start: Date; end: Date },
) => Promise<CalendarEvent[]>;

export type CalendarCache = {
  get(entityId: string, startIso: string, endIso: string): Promise<CalendarEvent[]>;
};

type Entry = { promise: Promise<CalendarEvent[]>; expiresAt: number };

/** Day-bucket the ISO strings to YYYY-MM-DD so two canvases asking for
 *  "events from now to next Tuesday" within the same day reuse one upstream
 *  HA RPC. The underlying HA service still receives the full ISO datetimes
 *  so its server-side window math is correct — only the cache key is bucketed. */
function dayKey(iso: string): string {
  // First 10 chars of an ISO datetime are the date. Falls back to the input
  // unchanged for anything shorter; the caller has already validated parsing.
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export function createCalendarCache(
  fetcher: CalendarFetcher,
  opts: { ttlMs?: number; now?: () => number } = {},
): CalendarCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_CALENDAR_CACHE_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();

  return {
    get(entityId, startIso, endIso) {
      const key = `${entityId}|${dayKey(startIso)}|${dayKey(endIso)}`;
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        return existing.promise;
      }
      const promise = fetcher(entityId, { start: new Date(startIso), end: new Date(endIso) }).catch(
        (err) => {
          // Drop the failed entry so the next caller retries upstream rather
          // than serving the rejection for the rest of the TTL.
          entries.delete(key);
          throw err;
        },
      );
      entries.set(key, { promise, expiresAt: now() + ttlMs });
      return promise;
    },
  };
}
