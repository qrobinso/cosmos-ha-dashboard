import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache, type MusicVideoCache } from '../src/musicvideo/cache.js';
import { registerMusicVideoRoutes } from '../src/api/musicvideo.js';
import type { VideoLookup } from '../src/musicvideo/types.js';

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
    lookup = { search: async () => ({ status: 'none' }), streamUrlFor: vi.fn(async () => 'https://fresh/url') };
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
    lookup = { search: async () => ({ status: 'none' }), streamUrlFor: async () => null };
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
