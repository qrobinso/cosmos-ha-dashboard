import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache } from '../src/musicvideo/cache.js';
import {
  createMusicVideoResolver,
  MAX_CONCURRENT_LOOKUPS,
  UNAVAILABLE_COOLDOWN_MS,
} from '../src/musicvideo/resolver.js';
import type { VideoLookup, ResolvedVideo, VideoSearchResult } from '../src/musicvideo/types.js';

const HEROES: ResolvedVideo = {
  videoId: 'abc123',
  streamUrl: 'https://rr1.googlevideo.com/x',
  duration: 214,
  title: 'Heroes',
};

/** A lookup whose search resolution the test controls by hand. */
function deferredLookup() {
  const pending: ((v: VideoSearchResult) => void)[] = [];
  const searches: string[] = [];
  const lookup: VideoLookup = {
    search: (q) => {
      searches.push(q);
      return new Promise((res) => {
        pending.push(res);
      });
    },
    streamUrlFor: async () => null,
  };
  /** Release every pending search; `null` means "ran, found nothing". */
  const release = (v: ResolvedVideo | null | VideoSearchResult) => {
    const result: VideoSearchResult =
      v === null ? { status: 'none' } : 'status' in v ? v : { status: 'ok', video: v };
    for (const res of pending.splice(0)) res(result);
  };
  return { lookup, searches, release };
}

/** Let queued microtasks (the background lookup chain) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createMusicVideoResolver', () => {
  let db: DB;
  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });

  it('returns null immediately on a cache miss without awaiting the lookup', async () => {
    const { lookup, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    // Synchronous return — the lookup has NOT settled.
    expect(resolve('w1', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: null });
    expect(onUpdate).not.toHaveBeenCalled();

    release(HEROES);
    await flush();
    expect(onUpdate).toHaveBeenCalledWith('w1');
  });

  it('serves the videoId synchronously once cached, without spawning a lookup', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(resolve('w1', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it('persists the stream url alongside the videoId', async () => {
    const { lookup, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(cache.getStream('abc123')).toEqual({
      streamUrl: 'https://rr1.googlevideo.com/x',
      duration: 214,
    });
  });

  it('shares one in-flight lookup across concurrent widgets on the same track', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve('w2', { artist: 'David Bowie', title: 'Heroes' });
    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    expect(searches).toHaveLength(1);
    expect(resolve.inFlightCount()).toBe(1);

    release(HEROES);
    await flush();

    // Both widgets get told, exactly once each.
    expect(onUpdate.mock.calls.map((c) => c[0]).sort()).toEqual(['w1', 'w2']);
    expect(resolve.inFlightCount()).toBe(0);
  });

  it('negative-caches a failed lookup and does not retry it', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'Nobody', title: 'Nothing' });
    release(null);
    await flush();

    expect(resolve('w1', { artist: 'Nobody', title: 'Nothing' })).toEqual({ videoId: null });
    expect(searches).toHaveLength(1);
  });

  it('returns null and never searches when the track has no artist or title', () => {
    const { lookup, searches } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());

    expect(resolve('w1', {})).toEqual({ videoId: null });
    expect(resolve('w1', { artist: 'A' })).toEqual({ videoId: null });
    expect(resolve('w1', { title: 'T' })).toEqual({ videoId: null });
    expect(searches).toHaveLength(0);
  });

  it('appends the default query suffix', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());
    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();
    expect(searches[0]).toBe('David Bowie Heroes official music video');
  });

  it('honours a custom query suffix', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());
    resolve('w1', { artist: 'David Bowie', title: 'Heroes', querySuffix: 'live 1977' });
    release(HEROES);
    await flush();
    expect(searches[0]).toBe('David Bowie Heroes live 1977');
  });

  it('does not notify a widget that was disposed mid-lookup', async () => {
    const { lookup, release } = deferredLookup();
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.dispose('w1');
    release(HEROES);
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('gc drops widgets no longer on any scene', async () => {
    const { lookup, release } = deferredLookup();
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.gc(['w2', 'w3']);
    release(HEROES);
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('still caches the result even when every waiter was disposed', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.dispose('w1');
    release(HEROES);
    await flush();

    expect(cache.getVideoId('david bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
    expect(resolve('w2', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it('treats decorated variants of the same song as one cache entry', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(resolve('w1', { artist: 'DAVID BOWIE', title: 'Heroes - Remastered 2017' }))
      .toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it("does not negative-cache an 'unavailable' lookup, and retries after the cooldown", async () => {
    const cache = createMusicVideoCache(db);
    let clock = 1_000_000;
    let calls = 0;
    const lookup: VideoLookup = {
      search: async () => {
        calls++;
        return { status: 'unavailable' } as VideoSearchResult;
      },
      streamUrlFor: async () => null,
    };
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn(), { now: () => clock });

    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(1);
    // yt-dlp was missing — nothing was learned, so nothing is remembered.
    expect(cache.getVideoId('a|b')).toBeNull();

    // The next push must NOT spawn again: media_position ticks re-push several
    // times a second, and retrying each time was a spawn-and-log storm.
    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(1);

    // Once the cooldown lapses it retries on its own — no restart required.
    clock += UNAVAILABLE_COOLDOWN_MS + 1;
    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(2);
  });

  it('caps concurrent lookups and drops the overflow rather than queueing', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());

    for (let i = 0; i < 20; i++) {
      expect(resolve(`w${i}`, { artist: `Artist ${i}`, title: 'T' })).toEqual({ videoId: null });
    }
    expect(searches).toHaveLength(MAX_CONCURRENT_LOOKUPS);
    expect(resolve.inFlightCount()).toBe(MAX_CONCURRENT_LOOKUPS);

    // Once the in-flight lookups drain, new tracks can start again.
    release(null);
    await flush();
    expect(resolve.inFlightCount()).toBe(0);
    resolve('w99', { artist: 'Fresh', title: 'T' });
    expect(searches).toHaveLength(MAX_CONCURRENT_LOOKUPS + 1);
  });

  it('stops retrying after an unavailable lookup, then resumes past the cooldown', async () => {
    let clock = 1_000_000;
    let calls = 0;
    const lookup: VideoLookup = {
      search: async () => {
        calls++;
        return { status: 'unavailable' };
      },
      streamUrlFor: async () => null,
    };
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn(), { now: () => clock });

    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(1);

    // Every subsequent push inside the cooldown must NOT spawn another lookup.
    for (let i = 0; i < 25; i++) {
      clock += 1000;
      resolve('w1', { artist: 'A', title: 'B' });
      resolve('w1', { artist: 'C', title: 'D' });
    }
    await flush();
    expect(calls).toBe(1);

    // Unavailability is global, not per-track: a different song is also held.
    expect(resolve('w2', { artist: 'X', title: 'Y' })).toEqual({ videoId: null });
    await flush();
    expect(calls).toBe(1);

    // Past the cooldown it retries on its own, no restart needed.
    clock += UNAVAILABLE_COOLDOWN_MS + 1;
    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(2);
  });

  it('does not negative-cache an unavailable lookup during the cooldown', async () => {
    let clock = 1_000_000;
    const lookup: VideoLookup = {
      search: async () => ({ status: 'unavailable' }),
      streamUrlFor: async () => null,
    };
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn(), { now: () => clock });

    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    // The cooldown must not be implemented by poisoning the cache — that would
    // survive 24h and outlive the 5min backoff.
    expect(cache.getVideoId('a|b')).toBeNull();
  });

  it('still serves cache hits while the unavailable cooldown is active', async () => {
    let clock = 1_000_000;
    const lookup: VideoLookup = {
      search: async () => ({ status: 'unavailable' }),
      streamUrlFor: async () => null,
    };
    const cache = createMusicVideoCache(db);
    cache.putVideoId('david bowie|heroes', 'abc123');
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn(), { now: () => clock });

    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    clock += 1000;

    // A previously-resolved song must keep playing even though yt-dlp is down.
    expect(resolve('w1', { artist: 'David Bowie', title: 'Heroes' }))
      .toEqual({ videoId: 'abc123' });
  });

  it('never rejects when the lookup itself throws', async () => {
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const lookup: VideoLookup = {
      search: async () => {
        throw new Error('boom');
      },
      streamUrlFor: async () => null,
    };
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    expect(() => resolve('w1', { artist: 'A', title: 'B' })).not.toThrow();
    await flush();
    expect(resolve.inFlightCount()).toBe(0);
  });

  it('does not negative-cache a thrown lookup and retries on the next call', async () => {
    const cache = createMusicVideoCache(db);
    let calls = 0;
    const lookup: VideoLookup = {
      search: async () => {
        calls++;
        throw new Error('boom');
      },
      streamUrlFor: async () => null,
    };
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'A', title: 'B' });
    await flush();

    // No negative cache entry was written for the throwing lookup.
    expect(cache.getVideoId('a|b')).toBeNull();
    expect(calls).toBe(1);

    // A subsequent resolve for the same track must retry, not be suppressed.
    resolve('w1', { artist: 'A', title: 'B' });
    await flush();
    expect(calls).toBe(2);
  });
});
