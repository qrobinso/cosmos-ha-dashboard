import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache } from '../src/musicvideo/cache.js';
import { createMusicVideoResolver } from '../src/musicvideo/resolver.js';
import type { VideoLookup, ResolvedVideo } from '../src/musicvideo/types.js';

const HEROES: ResolvedVideo = {
  videoId: 'abc123',
  streamUrl: 'https://rr1.googlevideo.com/x',
  duration: 214,
  title: 'Heroes',
};

/** A lookup whose search resolution the test controls by hand. */
function deferredLookup() {
  let release: (v: ResolvedVideo | null) => void = () => {};
  const searches: string[] = [];
  const lookup: VideoLookup = {
    search: (q) => {
      searches.push(q);
      return new Promise((res) => {
        release = res;
      });
    },
    streamUrlFor: async () => null,
  };
  return { lookup, searches, release: (v: ResolvedVideo | null) => release(v) };
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
});
