import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVideoFileStore } from '../src/musicvideo/fileStore.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache, type MusicVideoCache } from '../src/musicvideo/cache.js';
import { createMusicVideoOverrideRepo } from '../src/musicvideo/overrides.js';
import { registerMusicVideoRoutes, ADMIN_ENTITY_SETTING } from '../src/api/musicvideo.js';
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
      download: async () => false,
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

  it("preserves a stale stream url's previously known duration on re-derive", async () => {
    // duration currently has no reader, but the value must stay honest —
    // deriveStreamUrl used to clobber it to 0 whenever it re-derived an
    // expired url.
    let t = 0;
    const c = createMusicVideoCache(db, { now: () => t });
    c.putStream('abc123', 'https://old/url', 214);
    t = 5 * 60 * 60 * 1000; // past the 4h stream TTL — getStream now reports absent/stale
    expect(c.getStream('abc123')).toBeNull();

    const lookup2: VideoLookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: vi.fn(async () => 'https://fresh/url'),
      probe: async () => ({ status: 'none' }) as const,
      download: async () => false,
    };
    const app2 = Fastify({ logger: false });
    registerMusicVideoRoutes(app2, { cache: c, lookup: lookup2, fetchImpl: fetchImpl as unknown as typeof fetch });
    await app2.ready();

    const res = await app2.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(200);
    expect(c.getStream('abc123')).toMatchObject({ streamUrl: 'https://fresh/url', duration: 214 });
  });

  it('404s when the video cannot be resolved', async () => {
    lookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: async () => null,
      probe: async () => ({ status: 'none' }) as const,
      download: async () => false,
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
      download: async () => false,
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
    expect(res.json().rows[0]).toMatchObject({ trackKey: 'radiohead|karma police', videoId: null, artist: 'Radiohead' });
  });

  it('GET history?q= returns matches from beyond the capped recent list', async () => {
    const h = harness();
    h.cache.putVideoId('solange|weary', 'aaa11111111', { artist: 'Solange', title: 'Weary' });
    for (let i = 0; i < 80; i++) {
      h.cache.putVideoId(`filler${i}|song`, 'ccc33333333', { artist: `Filler ${i}`, title: 'Song' });
    }
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });

    // The unfiltered list is capped, so most of these 81 songs are unreachable
    // through it. (That the capped-out rows are still searchable is pinned
    // down deterministically in musicvideo.cache.test.ts, which controls the
    // clock; here the rows share a timestamp so ordering is not stable.)
    const unfiltered = await app.inject({ method: 'GET', url: '/api/musicvideo/history' });
    expect(unfiltered.json().rows).toHaveLength(50);
    // `total` reports everything reachable, not just this page.
    expect(unfiltered.json().total).toBe(81);

    const found = await app.inject({ method: 'GET', url: '/api/musicvideo/history?q=weary' });
    expect(found.statusCode).toBe(200);
    expect(found.json().rows.map((e: { trackKey: string }) => e.trackKey)).toEqual(['solange|weary']);
  });

  it('GET history with a blank q falls back to the recent list', async () => {
    const h = harness();
    h.cache.putVideoId('a|b', 'aaa11111111', { artist: 'A', title: 'B' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });

    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history?q=%20%20' });
    expect(res.json().rows).toHaveLength(1);
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

  it('GET now-playing reports non-music status for a denylisted content type, even if pinned', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'love island usa|s8 · e19', videoId: PIN, artist: 'Love Island USA', title: 'S8 · E19' });
    const settings = createSettingsRepo(h.db);
    settings.set('musicvideo.admin_entity', 'media_player.living_room');
    const haClient = fakeHaClientWith([
      { entity_id: 'media_player.living_room', state: 'playing',
        attributes: { media_artist: 'Love Island USA', media_title: 'S8 · E19', media_content_type: 'tvshow' } },
    ]);
    const app = await buildHttpApp({ ...baseDeps(h), settings, haClient, musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(res.json()).toMatchObject({
      entityId: 'media_player.living_room',
      artist: 'Love Island USA',
      title: 'S8 · E19',
      status: 'non-music',
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

describe('musicvideo admin entity settings routes', () => {
  function harness() {
    const db = freshDb();
    const settings = createSettingsRepo(db);
    return { db, settings };
  }

  it('GET settings reports null when nothing is configured', async () => {
    const h = harness();
    const cache = createMusicVideoCache(h.db);
    const app = await buildHttpApp({ ...baseDeps({ db: h.db, cache, lookup: {} as VideoLookup }), settings: h.settings });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entityId: null });
  });

  it('PUT settings saves a media_player entity id', async () => {
    const h = harness();
    const cache = createMusicVideoCache(h.db);
    const app = await buildHttpApp({ ...baseDeps({ db: h.db, cache, lookup: {} as VideoLookup }), settings: h.settings });
    const res = await app.inject({
      method: 'PUT', url: '/api/musicvideo/settings',
      payload: { entityId: 'media_player.kitchen' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entityId: 'media_player.kitchen' });
    expect(h.settings.get(ADMIN_ENTITY_SETTING)).toBe('media_player.kitchen');
  });

  it('PUT settings rejects a non-media_player entity', async () => {
    const h = harness();
    const cache = createMusicVideoCache(h.db);
    const app = await buildHttpApp({ ...baseDeps({ db: h.db, cache, lookup: {} as VideoLookup }), settings: h.settings });
    const res = await app.inject({
      method: 'PUT', url: '/api/musicvideo/settings',
      payload: { entityId: 'light.kitchen' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/media_player/i);
    expect(h.settings.get(ADMIN_ENTITY_SETTING)).toBeNull();
  });

  it('PUT settings clears the entity when given an empty string', async () => {
    const h = harness();
    h.settings.set(ADMIN_ENTITY_SETTING, 'media_player.kitchen');
    const cache = createMusicVideoCache(h.db);
    const app = await buildHttpApp({ ...baseDeps({ db: h.db, cache, lookup: {} as VideoLookup }), settings: h.settings });
    const res = await app.inject({ method: 'PUT', url: '/api/musicvideo/settings', payload: { entityId: '' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entityId: null });
    expect(h.settings.get(ADMIN_ENTITY_SETTING)).toBe('');
  });

  it('GET settings agrees with PUT after a clear — both report null, not empty string', async () => {
    const h = harness();
    h.settings.set(ADMIN_ENTITY_SETTING, 'media_player.kitchen');
    const cache = createMusicVideoCache(h.db);
    const app = await buildHttpApp({ ...baseDeps({ db: h.db, cache, lookup: {} as VideoLookup }), settings: h.settings });

    const putRes = await app.inject({ method: 'PUT', url: '/api/musicvideo/settings', payload: { entityId: '' } });
    expect(putRes.json()).toEqual({ entityId: null });

    const getRes = await app.inject({ method: 'GET', url: '/api/musicvideo/settings' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ entityId: null });
  });
});

describe('now-playing resolves tracks nothing else is watching', () => {
  /**
   * The regression this guards: the page's watched media_player and a scene
   * widget's `entity_id` are independent settings. For a player no widget
   * follows, nothing ever populated the cache, so the page reported
   * "unresolved" — rendered as "Looking…" — forever, while in fact nobody was
   * looking. now-playing must start the lookup itself.
   */
  function nowPlayingHarness(entityState = 'playing') {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const musicVideoOverrides = createMusicVideoOverrideRepo(db);
    const settings = createSettingsRepo(db);
    settings.set('musicvideo.admin_entity', 'media_player.kitchen');
    const haClient = fakeHaClientWith([
      {
        entity_id: 'media_player.kitchen',
        state: entityState,
        attributes: { media_artist: 'Radiohead', media_title: 'Karma Police', media_duration: 261 },
      },
    ]);
    return { db, cache, musicVideoOverrides, settings, haClient };
  }

  it('starts a lookup when nothing has resolved the track yet', async () => {
    const h = nowPlayingHarness();
    const calls: Array<{ artist?: string; title?: string }> = [];
    const musicVideoResolver = Object.assign(
      (_id: string, track: { artist?: string; title?: string }) => {
        calls.push(track);
        return { videoId: null };
      },
      { dispose() {}, gc() {}, inFlightCount: () => 0 },
    );

    const app = await buildHttpApp({
      ...baseDeps(h as never),
      settings: h.settings,
      haClient: h.haClient,
      musicVideoOverrides: h.musicVideoOverrides,
      musicVideoResolver: () => musicVideoResolver,
    });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });

    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ artist: 'Radiohead', title: 'Karma Police', durationSec: 261 }]);
  });

  it('does not re-resolve a track that already has a cached answer', async () => {
    const h = nowPlayingHarness();
    h.cache.putVideoId('radiohead|karma police', 'aaa11111111');
    let called = 0;
    const musicVideoResolver = Object.assign(
      () => { called++; return { videoId: null }; },
      { dispose() {}, gc() {}, inFlightCount: () => 0 },
    );

    const app = await buildHttpApp({
      ...baseDeps(h as never),
      settings: h.settings,
      haClient: h.haClient,
      musicVideoOverrides: h.musicVideoOverrides,
      musicVideoResolver: () => musicVideoResolver,
    });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });

    expect(called).toBe(0);
    expect(res.json()).toMatchObject({ status: 'auto', videoId: 'aaa11111111' });
  });

  it('does not resolve a track that is already pinned', async () => {
    const h = nowPlayingHarness();
    h.musicVideoOverrides.put({
      trackKey: 'radiohead|karma police',
      videoId: 'pinned12345',
      artist: 'Radiohead',
      title: 'Karma Police',
    });
    let called = 0;
    const musicVideoResolver = Object.assign(
      () => { called++; return { videoId: null }; },
      { dispose() {}, gc() {}, inFlightCount: () => 0 },
    );

    const app = await buildHttpApp({
      ...baseDeps(h as never),
      settings: h.settings,
      haClient: h.haClient,
      musicVideoOverrides: h.musicVideoOverrides,
      musicVideoResolver: () => musicVideoResolver,
    });
    await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(called).toBe(0);
  });

  it('does not resolve a paused player — a lookup is only worth it while playing', async () => {
    const h = nowPlayingHarness('paused');
    let called = 0;
    const musicVideoResolver = Object.assign(
      () => { called++; return { videoId: null }; },
      { dispose() {}, gc() {}, inFlightCount: () => 0 },
    );

    const app = await buildHttpApp({
      ...baseDeps(h as never),
      settings: h.settings,
      haClient: h.haClient,
      musicVideoOverrides: h.musicVideoOverrides,
      musicVideoResolver: () => musicVideoResolver,
    });
    await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(called).toBe(0);
  });

  it('reports why nothing was found, so the empty slot is explainable', async () => {
    const h = nowPlayingHarness();
    h.cache.putVideoId('radiohead|karma police', null, {
      artist: 'Radiohead',
      title: 'Karma Police',
      reason: 'None of the 5 results were on the artist’s channel.',
    });

    const app = await buildHttpApp({
      ...baseDeps(h as never),
      settings: h.settings,
      haClient: h.haClient,
      musicVideoOverrides: h.musicVideoOverrides,
    });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });

    expect(res.json()).toMatchObject({
      status: 'nothing-found',
      reason: 'None of the 5 results were on the artist’s channel.',
    });
  });
});

describe('history pagination', () => {
  function seeded(n: number) {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const musicVideoOverrides = createMusicVideoOverrideRepo(db);
    const lookup: VideoLookup = {
      search: async () => ({ status: 'none' }) as const,
      streamUrlFor: async () => null,
      probe: async () => ({ status: 'none' }) as const,
      download: async () => false,
    };
    for (let i = 0; i < n; i++) {
      cache.putVideoId(`artist${i}|song${i}`, 'aaa11111111', {
        artist: `Artist ${i}`,
        title: `Song ${i}`,
      });
    }
    return { db, cache, lookup, musicVideoOverrides };
  }

  it('honours limit and offset, reporting the full total', async () => {
    const h = seeded(30);
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });

    const page1 = await app.inject({ method: 'GET', url: '/api/musicvideo/history?limit=10&offset=0' });
    expect(page1.json().rows).toHaveLength(10);
    expect(page1.json()).toMatchObject({ total: 30, limit: 10, offset: 0 });

    const page3 = await app.inject({ method: 'GET', url: '/api/musicvideo/history?limit=10&offset=20' });
    expect(page3.json().rows).toHaveLength(10);
    expect(page3.json().offset).toBe(20);

    const keys = (r: { json(): { rows: Array<{ trackKey: string }> } }) =>
      r.json().rows.map((e) => e.trackKey);
    expect(keys(page1).some((k) => keys(page3).includes(k))).toBe(false);
  });

  it('returns an empty page past the end rather than erroring', async () => {
    const h = seeded(5);
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history?limit=10&offset=500' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([]);
    expect(res.json().total).toBe(5);
  });

  it('clamps a hand-edited limit instead of running an unbounded query', async () => {
    const h = seeded(5);
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history?limit=999999' });
    expect(res.json().limit).toBe(200);
  });

  it('ignores junk limit/offset values', async () => {
    const h = seeded(5);
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history?limit=abc&offset=-9' });
    expect(res.json()).toMatchObject({ limit: 50, offset: 0 });
  });

  it('paginates a filtered search, with total reflecting the filter', async () => {
    const h = seeded(30);
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history?q=Artist&limit=8&offset=8' });
    expect(res.json().rows).toHaveLength(8);
    expect(res.json().total).toBe(30);
  });
});

describe('local video files', () => {
  let vdir: string;
  afterEach(() => { if (vdir) rmSync(vdir, { recursive: true, force: true }); });

  function harnessWithFiles(opts: { maxBytes?: number; downloadOk?: boolean } = {}) {
    vdir = mkdtempSync(join(tmpdir(), 'cosmos-api-vid-'));
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const files = createVideoFileStore(db, { dir: vdir });
    const downloads: string[] = [];
    const lookup: VideoLookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: async () => 'https://fresh/url',
      probe: async () => ({ status: 'none' }) as const,
      download: async (videoId, dest) => {
        downloads.push(videoId);
        if (opts.downloadOk === false) return false;
        writeFileSync(dest, Buffer.alloc(2048));
        return true;
      },
    };
    const app = Fastify({ logger: false });
    registerMusicVideoRoutes(app, {
      cache,
      lookup,
      files,
      maxCacheBytes: () => opts.maxBytes ?? 10_000_000,
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
    });
    return { app, cache, files, downloads, lookup };
  }

  it('serves the local file instead of reaching YouTube once downloaded', async () => {
    const h = harnessWithFiles();
    await h.app.ready();
    writeFileSync(h.files.pathFor('abc12345678')!, Buffer.from('LOCALBYTES'));
    h.files.record('abc12345678', 10);

    const res = await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('LOCALBYTES');
    expect(res.headers['accept-ranges']).toBe('bytes');
    // Nothing was fetched upstream — that is the entire point.
    expect(h.downloads).toEqual([]);
  });

  it('honours Range against a local file so the widget can still seek', async () => {
    const h = harnessWithFiles();
    await h.app.ready();
    writeFileSync(h.files.pathFor('abc12345678')!, Buffer.from('0123456789'));
    h.files.record('abc12345678', 10);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/musicvideo/stream/abc12345678',
      headers: { range: 'bytes=2-5' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe('2345');
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
  });

  it('416s on a range past the end rather than serving nonsense', async () => {
    const h = harnessWithFiles();
    await h.app.ready();
    writeFileSync(h.files.pathFor('abc12345678')!, Buffer.from('0123456789'));
    h.files.record('abc12345678', 10);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/musicvideo/stream/abc12345678',
      headers: { range: 'bytes=99-200' },
    });
    expect(res.statusCode).toBe(416);
  });

  it('proxies the first play and downloads for the next one', async () => {
    const h = harnessWithFiles();
    await h.app.ready();
    h.cache.putStream('abc12345678', 'https://rr1.googlevideo.com/x', 200);

    const res = await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678' });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => expect(h.files.has('abc12345678')).toBe(true));
    expect(h.downloads).toEqual(['abc12345678']);
    expect(h.files.stats().totalBytes).toBe(2048);
  });

  it('does not download when the cap is zero', async () => {
    const h = harnessWithFiles({ maxBytes: 0 });
    await h.app.ready();
    h.cache.putStream('abc12345678', 'https://rr1.googlevideo.com/x', 200);

    await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678' });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.downloads).toEqual([]);
    expect(h.files.has('abc12345678')).toBe(false);
  });

  it('keeps proxying when a download fails', async () => {
    const h = harnessWithFiles({ downloadOk: false });
    await h.app.ready();
    h.cache.putStream('abc12345678', 'https://rr1.googlevideo.com/x', 200);

    const res = await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678' });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.files.has('abc12345678')).toBe(false);
  });

  it('counts a play once per playback, not once per range request', async () => {
    const h = harnessWithFiles();
    await h.app.ready();
    writeFileSync(h.files.pathFor('abc12345678')!, Buffer.alloc(4096));
    h.files.record('abc12345678', 4096);

    // One play: an opening request plus the chunk requests that follow it.
    await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678', headers: { range: 'bytes=0-1023' } });
    await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678', headers: { range: 'bytes=1024-2047' } });
    await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc12345678', headers: { range: 'bytes=2048-4095' } });

    expect(h.files.playCount('abc12345678')).toBe(1);
  });

  it('evicts the least-played video when a new download breaches the cap', async () => {
    const h = harnessWithFiles({ maxBytes: 4096 });
    await h.app.ready();
    // Two files already at the cap; one is loved, one is not.
    for (const id of ['loved111111', 'unloved1111']) {
      writeFileSync(h.files.pathFor(id)!, Buffer.alloc(2048));
      h.files.record(id, 2048);
    }
    for (let i = 0; i < 5; i++) h.files.recordPlay('loved111111');

    h.cache.putStream('newvid00001', 'https://rr1.googlevideo.com/x', 200);
    await h.app.inject({ method: 'GET', url: '/api/musicvideo/stream/newvid00001' });

    await vi.waitFor(() => expect(h.files.has('newvid00001')).toBe(true));
    await vi.waitFor(() => expect(h.files.has('unloved1111')).toBe(false));
    expect(h.files.has('loved111111')).toBe(true);
    expect(h.files.stats().totalBytes).toBeLessThanOrEqual(4096);
  });
});

describe('storage settings', () => {
  let sdir: string;
  afterEach(() => { if (sdir) rmSync(sdir, { recursive: true, force: true }); });

  function storageHarness() {
    sdir = mkdtempSync(join(tmpdir(), 'cosmos-store-'));
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const settings = createSettingsRepo(db);
    const files = createVideoFileStore(db, { dir: sdir });
    const lookup: VideoLookup = {
      search: async () => ({ status: 'none' }),
      streamUrlFor: async () => null,
      probe: async () => ({ status: 'none' }) as const,
      download: async () => false,
    };
    const app = Fastify({ logger: false });
    registerMusicVideoRoutes(app, { cache, lookup, settings, files, maxCacheBytes: () => 0 });
    return { app, files, settings };
  }

  function put(files: ReturnType<typeof createVideoFileStore>, id: string, bytes: number) {
    writeFileSync(files.pathFor(id)!, Buffer.alloc(bytes));
    files.record(id, bytes);
  }

  it('reports the default limit and current usage', async () => {
    const h = storageHarness();
    await h.app.ready();
    put(h.files, 'aaa11111111', 1024 * 1024);

    const res = await h.app.inject({ method: 'GET', url: '/api/musicvideo/storage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      maxMb: 1024, enabled: true, fileCount: 1, totalBytes: 1024 * 1024,
    });
  });

  it('saves a new limit', async () => {
    const h = storageHarness();
    await h.app.ready();
    const res = await h.app.inject({ method: 'PUT', url: '/api/musicvideo/storage', payload: { maxMb: 256 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxMb).toBe(256);
    expect((await h.app.inject({ method: 'GET', url: '/api/musicvideo/storage' })).json().maxMb).toBe(256);
  });

  it('applies a lowered limit immediately instead of waiting for the next download', async () => {
    const h = storageHarness();
    await h.app.ready();
    put(h.files, 'loved111111', 2 * 1024 * 1024);
    put(h.files, 'unloved1111', 2 * 1024 * 1024);
    for (let i = 0; i < 3; i++) h.files.recordPlay('loved111111');

    const res = await h.app.inject({ method: 'PUT', url: '/api/musicvideo/storage', payload: { maxMb: 2 } });
    expect(res.json().removed).toBe(1);
    // The least played one is the one that went.
    expect(h.files.has('loved111111')).toBe(true);
    expect(h.files.has('unloved1111')).toBe(false);
  });

  it('a limit of zero clears everything — turning downloads off', async () => {
    const h = storageHarness();
    await h.app.ready();
    put(h.files, 'aaa11111111', 1024);
    put(h.files, 'bbb22222222', 1024);

    const res = await h.app.inject({ method: 'PUT', url: '/api/musicvideo/storage', payload: { maxMb: 0 } });
    expect(res.json()).toMatchObject({ maxMb: 0, removed: 2, fileCount: 0, totalBytes: 0 });
  });

  it.each([
    ['a negative limit', -1],
    ['a non-number', 'lots'],
  ])('rejects %s', async (_label, maxMb) => {
    const h = storageHarness();
    await h.app.ready();
    const res = await h.app.inject({ method: 'PUT', url: '/api/musicvideo/storage', payload: { maxMb } });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a limit beyond the hard ceiling rather than letting it fill the disk', async () => {
    const h = storageHarness();
    await h.app.ready();
    const res = await h.app.inject({ method: 'PUT', url: '/api/musicvideo/storage', payload: { maxMb: 999_999 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cannot exceed/i);
  });

  it('reports disabled when no file store is wired', async () => {
    const db = freshDb();
    const bare = Fastify({ logger: false });
    registerMusicVideoRoutes(bare, {
      cache: createMusicVideoCache(db),
      lookup: null,
      settings: createSettingsRepo(db),
    });
    await bare.ready();
    const res = await bare.inject({ method: 'GET', url: '/api/musicvideo/storage' });
    expect(res.json()).toMatchObject({ enabled: false, fileCount: 0, totalBytes: 0 });
  });
});
