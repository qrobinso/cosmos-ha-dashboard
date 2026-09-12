import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createVideoFileStore } from '../src/musicvideo/fileStore.js';
import { createAerialCatalogStore } from '../src/aerials/store.js';
import { createCatalogRefresher } from '../src/aerials/refresh.js';
import { createAerialDownloader } from '../src/aerials/download.js';
import { registerAerialRoutes, readAerialMaxCacheMb, AERIAL_MAX_CACHE_MB_SETTING } from '../src/api/aerials.js';
import type { AerialCatalog } from '../src/aerials/types.js';

const ID = '009BA758-7060-4479-8EE8-FB9B40C8FB97';
const ID2 = '00BA71CD-2C54-415A-A68A-8358E677D750';

const catalog: AerialCatalog = {
  fetchedAt: 5000,
  source: 'https://example/feed.tar',
  assets: [
    { id: ID, name: 'Korea', category: 'earth', subcategory: 'Korea', previewUrl: 'https://p/1.png', sourceUrl: 'https://cdn/korea.mov' },
    { id: ID2, name: 'Dubai', category: 'city', previewUrl: 'https://p/2.png', sourceUrl: 'https://cdn/dubai.mov' },
  ],
};

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function harness(opts: { catalog?: AerialCatalog | null; maxMb?: number; upstream?: (url: string, init?: RequestInit) => Response; refreshFails?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'cosmos-aerials-'));
  const db = openDatabase(':memory:');
  runMigrations(db);
  const settings = createSettingsRepo(db);
  if (opts.maxMb !== undefined) settings.set(AERIAL_MAX_CACHE_MB_SETTING, String(opts.maxMb));
  const store = createAerialCatalogStore(settings);
  if (opts.catalog !== null) store.set(opts.catalog ?? catalog);
  const files = createVideoFileStore(db, { dir, table: 'aerial_file' });
  const upstreamCalls: Array<{ url: string; range?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    upstreamCalls.push({ url, range: h.Range ?? h.range });
    return opts.upstream ? opts.upstream(url, init) : new Response('APPLEBYTES', {
      status: 200,
      headers: { 'content-type': 'video/quicktime', 'content-length': '10', 'accept-ranges': 'bytes' },
    });
  }) as unknown as typeof fetch;
  const refresher = createCatalogRefresher({
    store,
    fetchCatalog: async () => {
      if (opts.refreshFails) throw new Error('feed down');
      return { ...catalog, fetchedAt: 9000 };
    },
  });
  const maxCacheBytes = () => readAerialMaxCacheMb(settings) * 1024 * 1024;
  const downloader = createAerialDownloader({ files, fetchImpl, maxCacheBytes, log: () => {} });
  const app = Fastify({ logger: false });
  registerAerialRoutes(app, { catalog: store, refresher, files, downloader, settings, fetchImpl, maxCacheBytes });
  return { app, store, files, settings, downloader, upstreamCalls };
}

describe('GET /api/aerials', () => {
  it('lists the catalog with a cached flag per clip', async () => {
    const h = harness();
    writeFileSync(h.files.pathFor(ID)!, 'x');
    h.files.record(ID, 1);
    const res = await h.app.inject({ method: 'GET', url: '/api/aerials' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      fetchedAt: 5000,
      assets: [
        { id: ID, name: 'Korea', category: 'earth', subcategory: 'Korea', previewUrl: 'https://p/1.png', cached: true },
        { id: ID2, name: 'Dubai', category: 'city', previewUrl: 'https://p/2.png', cached: false },
      ],
    });
  });

  it('returns an empty catalog before any fetch', async () => {
    const h = harness({ catalog: null });
    const res = await h.app.inject({ method: 'GET', url: '/api/aerials' });
    expect(res.json()).toEqual({ fetchedAt: null, assets: [] });
  });
});

describe('POST /api/aerials/refresh', () => {
  it('fetches and reports the new count', async () => {
    const h = harness({ catalog: null });
    const res = await h.app.inject({ method: 'POST', url: '/api/aerials/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fetchedAt: 9000, count: 2 });
    expect(h.store.get()?.fetchedAt).toBe(9000);
  });

  it('reports a feed failure as 502 with the reason', async () => {
    const h = harness({ refreshFails: true });
    const res = await h.app.inject({ method: 'POST', url: '/api/aerials/refresh' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/feed down/);
    expect(h.store.get()?.fetchedAt).toBe(5000);
  });
});

describe('GET /api/aerials/stream/:id', () => {
  it('rejects ids that are not in the catalog or not safe', async () => {
    const h = harness();
    expect((await h.app.inject({ method: 'GET', url: '/api/aerials/stream/FFFFFFFF-0000-0000-0000-000000000009' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/api/aerials/stream/..%2Fetc' })).statusCode).toBe(400);
  });

  it('proxies Apple with Range forwarded and an mp4 content type, then caches the file', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}`, headers: { range: 'bytes=0-' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('APPLEBYTES');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(h.upstreamCalls).toContainEqual({ url: 'https://cdn/korea.mov', range: 'bytes=0-' });

    // The play also kicked off a background download of the whole clip.
    await h.downloader.settled();
    expect(h.files.has(ID)).toBe(true);

    // Second play never reaches Apple, and is the first one counted (the
    // row a play increments only exists once the file has landed).
    const calls = h.upstreamCalls.length;
    const res2 = await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}` });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toBe('APPLEBYTES');
    expect(h.files.playCount(ID)).toBe(1);
    const res3 = await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}`, headers: { range: 'bytes=2-5' } });
    expect(res3.statusCode).toBe(206);
    expect(res3.body).toBe('PLEB');
    expect(h.upstreamCalls.length).toBe(calls);
  });

  it('does not download when the cap is 0', async () => {
    const h = harness({ maxMb: 0 });
    await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}` });
    await h.downloader.settled();
    expect(h.files.has(ID)).toBe(false);
    expect(existsSync(join(dir, `${ID}.mp4.part`))).toBe(false);
  });

  it('evicts least-played clips once a download pushes the cache over the cap', async () => {
    const h = harness({ maxMb: 1 });
    // Pre-existing clip just under the cap, never played.
    writeFileSync(h.files.pathFor(ID2)!, Buffer.alloc(1024 * 1024 - 5));
    h.files.record(ID2, 1024 * 1024 - 5);
    await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}` });
    await h.downloader.settled();
    expect(h.files.has(ID)).toBe(true);
    expect(h.files.has(ID2)).toBe(false);
  });

  it('returns 502 and leaves no partial file when Apple fails', async () => {
    const h = harness({ upstream: () => new Response('nope', { status: 503 }) });
    const res = await h.app.inject({ method: 'GET', url: `/api/aerials/stream/${ID}` });
    expect(res.statusCode).toBe(502);
    await h.downloader.settled();
    expect(h.files.has(ID)).toBe(false);
    expect(existsSync(join(dir, `${ID}.mp4.part`))).toBe(false);
  });
});

describe('aerial storage settings', () => {
  it('reports the default cap and usage, and applies a new cap immediately', async () => {
    const h = harness();
    writeFileSync(h.files.pathFor(ID)!, Buffer.alloc(2 * 1024 * 1024));
    h.files.record(ID, 2 * 1024 * 1024);

    const get = await h.app.inject({ method: 'GET', url: '/api/aerials/storage' });
    expect(get.json()).toMatchObject({ maxMb: 4096, fileCount: 1, totalBytes: 2 * 1024 * 1024 });

    const put = await h.app.inject({ method: 'PUT', url: '/api/aerials/storage', payload: { maxMb: 1 } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ maxMb: 1, removed: 1, fileCount: 0 });
    expect(readAerialMaxCacheMb(h.settings)).toBe(1);
  });

  it('rejects a bad cap', async () => {
    const h = harness();
    expect((await h.app.inject({ method: 'PUT', url: '/api/aerials/storage', payload: { maxMb: -1 } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'PUT', url: '/api/aerials/storage', payload: { maxMb: 999999 } })).statusCode).toBe(400);
  });
});
