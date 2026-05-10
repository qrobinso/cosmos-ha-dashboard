import { describe, it, expect } from 'vitest';
import { createCalendarCache, type CalendarFetcher } from '../src/ha/calendarCache.js';
import type { CalendarEvent } from '../src/scenes/types.js';

function ev(summary: string, start: string, end: string): CalendarEvent {
  return { summary, start, end, all_day: false };
}

function trackingFetcher(events: CalendarEvent[]): { fetcher: CalendarFetcher; calls: Array<{ entity: string; start: Date; end: Date }> } {
  const calls: Array<{ entity: string; start: Date; end: Date }> = [];
  const fetcher: CalendarFetcher = async (entityId, opts) => {
    calls.push({ entity: entityId, start: opts.start, end: opts.end });
    return events;
  };
  return { fetcher, calls };
}

describe('calendar cache', () => {
  it('serves a hit on the second call within the TTL', async () => {
    const { fetcher, calls } = trackingFetcher([ev('a', '2026-05-09T10:00', '2026-05-09T11:00')]);
    const cache = createCalendarCache(fetcher, { ttlMs: 60_000 });
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(calls).toHaveLength(1);
  });

  it('day-buckets the cache key — different times within the same day reuse one fetch', async () => {
    const { fetcher, calls } = trackingFetcher([]);
    const cache = createCalendarCache(fetcher);
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    await cache.get('calendar.home', '2026-05-09T08:30:00Z', '2026-05-16T23:59:59Z');
    expect(calls).toHaveLength(1);
  });

  it('different day buckets each hit upstream', async () => {
    const { fetcher, calls } = trackingFetcher([]);
    const cache = createCalendarCache(fetcher);
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    await cache.get('calendar.home', '2026-05-10T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(calls).toHaveLength(2);
  });

  it('different entities each hit upstream', async () => {
    const { fetcher, calls } = trackingFetcher([]);
    const cache = createCalendarCache(fetcher);
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    await cache.get('calendar.work', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent in-flight calls', async () => {
    let resolveUpstream: (e: CalendarEvent[]) => void;
    const upstream = new Promise<CalendarEvent[]>((r) => { resolveUpstream = r; });
    let calls = 0;
    const fetcher: CalendarFetcher = async () => {
      calls++;
      return upstream;
    };
    const cache = createCalendarCache(fetcher);
    const a = cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    const b = cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(calls).toBe(1);
    resolveUpstream!([ev('a', '2026-05-09T10:00', '2026-05-09T11:00')]);
    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult).toBe(bResult); // same promise => same array
  });

  it('expires entries after TTL', async () => {
    let nowMs = 1_000_000;
    const { fetcher, calls } = trackingFetcher([]);
    const cache = createCalendarCache(fetcher, { ttlMs: 60_000, now: () => nowMs });
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    nowMs += 60_001;
    await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(calls).toHaveLength(2);
  });

  it('drops the entry when the upstream rejects so the next caller retries', async () => {
    let attempt = 0;
    const fetcher: CalendarFetcher = async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return [ev('ok', '2026-05-09T10:00', '2026-05-09T11:00')];
    };
    const cache = createCalendarCache(fetcher);
    await expect(cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z')).rejects.toThrow('boom');
    const events = await cache.get('calendar.home', '2026-05-09T00:00:00Z', '2026-05-16T00:00:00Z');
    expect(events).toHaveLength(1);
    expect(attempt).toBe(2);
  });
});
