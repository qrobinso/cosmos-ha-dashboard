import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache, type MusicVideoCache } from '../src/musicvideo/cache.js';
import { createMusicVideoOverrideRepo } from '../src/musicvideo/overrides.js';
import { registerMusicVideoRoutes } from '../src/api/musicvideo.js';
import { buildHttpApp, type HttpDeps } from '../src/api/http.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';
import type { VideoLookup, VideoSearchResult } from '../src/musicvideo/types.js';

function freshDb(): DB {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function fakeHaClientWith(entities: Parameters<typeof createFakeHaClient>[0]) {
  return createFakeHaClient(entities);
}

/** Minimal full HttpDeps, built around whatever a harness() call produced. */
function baseDeps(h: {
  db: DB;
  cache: MusicVideoCache;
  lookup: VideoLookup;
}): HttpDeps {
  return {
    displays: createDisplaysRepo(h.db),
    settings: createSettingsRepo(h.db),
    scenes: createScenesRepo(h.db),
    transitions: createTransitionsRepo(h.db),
    overrides: createOverridesRepo(h.db),
    designs: createDesignPacksRepo(h.db),
    musicVideoCache: h.cache,
    musicVideoLookup: h.lookup,
  };
}

function okResponse(body = 'VIDEOBYTES', headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), ...headers },
  });
}

describe('GET /api/musicvideo/stream/:videoId', () => {
  let app: FastifyInstance;
  let db: DB;
  let cache: MusicVideoCache;
  let lookup: VideoLookup;
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);
    cache = createMusicVideoCache(db);
    lookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: vi.fn(async () => 'https://fresh/url'),
      probe: async () => ({ status: 'none' }) as const,
    };
    fetchImpl = vi.fn(async () => okResponse());
    app = Fastify({ logger: false });
    registerMusicVideoRoutes(app, { cache, lookup, fetchImpl: fetchImpl as unknown as typeof fetch });
    await app.ready();
  });

  it('streams a cached video and forwards content-type', async () => {
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://rr1.googlevideo.com/x',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('forwards the Range header upstream and relays content-range', async () => {
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    fetchImpl.mockResolvedValueOnce(
      new Response('PART', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 100-103/1000',
          'content-length': '4',
          'accept-ranges': 'bytes',
        },
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/musicvideo/stream/abc123',
      headers: { range: 'bytes=100-103' },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 100-103/1000');
    expect(res.headers['accept-ranges']).toBe('bytes');
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Range).toBe('bytes=100-103');
  });

  it('re-derives a stale stream url before streaming', async () => {
    // Nothing cached at all — the route must ask the lookup.
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(200);
    expect(lookup.streamUrlFor).toHaveBeenCalledWith('abc123');
    expect(fetchImpl).toHaveBeenCalledWith('https://fresh/url', expect.anything());
    // And it persists the refreshed url.
    expect(cache.getStream('abc123')?.streamUrl).toBe('https://fresh/url');
  });

  it('404s when the video cannot be resolved', async () => {
    lookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: async () => null,
      probe: async () => ({ status: 'none' }) as const,
    };
    const app2 = Fastify({ logger: false });
    registerMusicVideoRoutes(app2, { cache, lookup, fetchImpl: fetchImpl as unknown as typeof fetch });
    await app2.ready();
    const res = await app2.inject({ method: 'GET', url: '/api/musicvideo/stream/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('404s and invalidates the cached url when upstream rejects it', async () => {
    cache.putStream('abc123', 'https://expired/url', 214);
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 403 }));
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(404);
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('404s when the upstream fetch throws', async () => {
    cache.putStream('abc123', 'https://x', 214);
    fetchImpl.mockRejectedValueOnce(new Error('network down'));
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(404);
  });

  it('503s when no cache or lookup is configured', async () => {
    const bare = Fastify({ logger: false });
    registerMusicVideoRoutes(bare, { cache: null, lookup: null });
    await bare.ready();
    const res = await bare.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a videoId with unexpected characters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/..%2Fetc' });
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets the browser cache the body: the bytes for a videoId never change', async () => {
    cache.putStream('abc123', 'https://x', 214);
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    const cc = String(res.headers['cache-control']);
    // Without this the kiosk re-downloaded the whole file through the proxy on
    // every loop of a short video under a longer song, and on every replay.
    expect(cc).not.toContain('no-store');
    expect(cc).toContain('immutable');
    expect(cc).toMatch(/max-age=\d+/);
  });

  it('collapses concurrent re-derivations of the same stale videoId', async () => {
    // Nothing cached, so every request must re-derive. Several displays (and
    // several ranged connections per display) hitting at once must not each
    // spawn yt-dlp.
    let calls = 0;
    let release: (v: string) => void = () => {};
    const slowLookup: VideoLookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: () => {
        calls++;
        return new Promise((res) => {
          release = res;
        });
      },
      probe: async () => ({ status: 'none' }) as const,
    };
    const app2 = Fastify({ logger: false });
    registerMusicVideoRoutes(app2, {
      cache,
      lookup: slowLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await app2.ready();

    const inFlight = [
      app2.inject({ method: 'GET', url: '/api/musicvideo/stream/dedupe1' }),
      app2.inject({ method: 'GET', url: '/api/musicvideo/stream/dedupe1' }),
      app2.inject({ method: 'GET', url: '/api/musicvideo/stream/dedupe1' }),
    ];
    await new Promise((r) => setTimeout(r, 0));
    release('https://derived/once');
    const results = await Promise.all(inFlight);

    expect(calls).toBe(1);
    for (const r of results) expect(r.statusCode).toBe(200);
  });
});

describe('override routes', () => {
  const PIN = 'dQw4w9WgXcQ';

  function harness(over: Partial<{ probeResult: VideoSearchResult }> = {}) {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const musicVideoOverrides = createMusicVideoOverrideRepo(db);
    let dirtied = 0;
    const lookup: VideoLookup = {
      search: async () => ({ status: 'none' } as const),
      streamUrlFor: async () => null,
      probe: async () =>
        over.probeResult ?? ({
          status: 'ok',
          video: { videoId: PIN, streamUrl: 'https://rr1.googlevideo.com/x', duration: 213, title: 'A Song (Official Video)' },
        } as const),
    };
    return { db, cache, musicVideoOverrides, lookup, dirtied: () => dirtied, onChanged: () => { dirtied++; } };
  }

  it('POST pins a video, returning the resolved title and duration', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides, onMusicVideoOverridesChanged: h.onChanged });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'Solange', title: 'Weary', url: `https://youtu.be/${PIN}?si=abc` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ trackKey: 'solange|weary', videoId: PIN, resolvedTitle: 'A Song (Official Video)', durationSec: 213 });
    expect(h.musicVideoOverrides.get('solange|weary')!.videoId).toBe(PIN);
    // The pin must be playable right away, without a second yt-dlp call.
    expect(h.cache.getStream(PIN)).toMatchObject({ streamUrl: 'https://rr1.googlevideo.com/x', duration: 213 });
    expect(h.dirtied()).toBe(1);
  });

  it('POST derives the track key server-side, so the client cannot disagree with the resolver', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      // Decoration that normalizeTrackKey strips.
      payload: { artist: 'Solange', title: 'Weary (feat. Nobody)', url: PIN },
    });
    expect(res.json().trackKey).toBe('solange|weary');
  });

  it('POST with block:true stores a block and never probes', async () => {
    const h = harness();
    let probed = 0;
    const lookup = { ...h.lookup, probe: async () => { probed++; return { status: 'none' } as const; } };
    const app = await buildHttpApp({ ...baseDeps({ ...h, lookup }), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'Solange', title: 'Weary', block: true },
    });
    expect(res.statusCode).toBe(200);
    expect(h.musicVideoOverrides.get('solange|weary')).toMatchObject({ videoId: null });
    expect(probed).toBe(0);
  });

  it('POST rejects an unparseable link without saving', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: 'https://vimeo.com/12345' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/youtube/i);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
  });

  it('POST rejects an unplayable video without saving', async () => {
    const h = harness({ probeResult: { status: 'none' } });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: PIN },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not be played/i);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
  });

  it('POST distinguishes yt-dlp being unavailable from a bad video', async () => {
    const h = harness({ probeResult: { status: 'unavailable' } });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: PIN },
    });
    expect(res.statusCode).toBe(400);
    // The user's next action differs: retry, don't hunt for another link.
    expect(res.json().error).toMatch(/yt-dlp|try again/i);
  });

  it('POST rejects a track with no usable artist/title', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: '', title: '', url: PIN },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET lists overrides newest first', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'a|b', videoId: PIN, artist: 'A', title: 'B' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/overrides' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('DELETE removes an override and marks displays dirty', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'a|b', videoId: PIN, artist: 'A', title: 'B' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides, onMusicVideoOverridesChanged: h.onChanged });
    const res = await app.inject({ method: 'DELETE', url: '/api/musicvideo/overrides/a%7Cb' });
    expect(res.statusCode).toBe(200);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
    expect(h.dirtied()).toBe(1);
  });

  it('DELETE of an unknown key is a 404', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'DELETE', url: '/api/musicvideo/overrides/nope%7Cnope' });
    expect(res.statusCode).toBe(404);
  });

  it('GET history lists recent resolutions including misses', async () => {
    const h = harness();
    h.cache.putVideoId('radiohead|karma police', null, { artist: 'Radiohead', title: 'Karma Police' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ trackKey: 'radiohead|karma police', videoId: null, artist: 'Radiohead' });
  });

  it('GET now-playing reports the configured entity and its override state', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'solange|weary', videoId: PIN, artist: 'Solange', title: 'Weary' });
    const settings = createSettingsRepo(h.db);
    settings.set('musicvideo.admin_entity', 'media_player.kitchen');
    const haClient = fakeHaClientWith([
      { entity_id: 'media_player.kitchen', state: 'playing',
        attributes: { media_artist: 'Solange', media_title: 'Weary', media_duration: 213 } },
    ]);
    const app = await buildHttpApp({ ...baseDeps(h), settings, haClient, musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(res.json()).toMatchObject({
      entityId: 'media_player.kitchen',
      artist: 'Solange',
      title: 'Weary',
      trackKey: 'solange|weary',
      status: 'pinned',
    });
  });

  it('GET now-playing reports an empty state when no entity is configured', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ entityId: null, status: 'no-entity' });
  });
});
